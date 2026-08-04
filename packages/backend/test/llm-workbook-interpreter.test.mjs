import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  AI_ASSISTANT_PROMPT,
  AI_SCHEDULING_STRATEGY_PROMPT,
  askAiAssistant,
  assistantContextSnapshot,
  interpretWorkbook,
  planSchedulingStrategy,
  workbookFromInterpretation,
  workbookSnapshot,
} from '../src/llm-workbook-interpreter.mjs';

test('builds aggregate-only context for the page assistant', () => {
  const snapshot = assistantContextSnapshot({
    meta: { revision: 12 },
    solve_status: 'valid',
    students: [{ id: '202501', name: '张三', grade: 10 }, { id: '202502', name: '李四', grade: 11 }],
    teachers: [{ id: 'T1', name: '老师' }],
    classes: [{ id: 'AC1', class_type: 'admin' }],
    courses: [{ id: 'C1', name: '课程一', type: 'required', grade: 10 }],
    manual_plan: { status: 'confirmed', locks: [{ section_id: 'S1' }] },
  }, {
    view: 'student-timetable',
    selected: { student_name: '张三', student_id: '202501', select_class: '教学班 1 班' },
  });
  assert.equal(snapshot.current_page, 'student-timetable');
  assert.deepEqual(snapshot.current_selection, { select_class: '教学班 1 班' });
  assert.equal(snapshot.system_summary.student_count, 2);
  assert.deepEqual(snapshot.system_summary.students_by_grade, { '10': 1, '11': 1 });
  assert.equal(JSON.stringify(snapshot).includes('张三'), false);
  assert.equal(JSON.stringify(snapshot).includes('202501'), false);
});

test('includes a selected teacher’s concrete timetable and locally safe move candidates without student identifiers', () => {
  const snapshot = assistantContextSnapshot({
    teachers: [{ id: 'T1', name: '甲老师' }, { id: 'T2', name: '乙老师' }],
    courses: [{ id: 'MATH', name: '数学' }, { id: 'ENG', name: '英语' }],
    teaching_classes: [{ id: 'TC1', name: '教学 1 班' }, { id: 'TC2', name: '教学 2 班' }],
    schedule: {
      sections: [
        { id: 'SEC1', teacher_id: 'T1', course_id: 'MATH', class_id: 'TC1', class_type: 'teaching', student_ids: ['S1'] },
        { id: 'SEC2', teacher_id: 'T2', course_id: 'ENG', class_id: 'TC2', class_type: 'teaching', student_ids: ['S1'] },
      ],
      meetings: [
        { section_id: 'SEC1', slot_id: 'D1P1' },
        { section_id: 'SEC2', slot_id: 'D1P2' },
      ],
      locks: [],
    },
  }, { view: 'teacher-timetable', selected: { teacher_id: 'T1' } });
  assert.equal(snapshot.selected_teacher_schedule.teacher_name, '甲老师');
  assert.equal(snapshot.selected_teacher_schedule.weekly_meeting_count, 1);
  assert.deepEqual(snapshot.selected_teacher_schedule.daily_meeting_counts[0], { day: 1, label: '周一', count: 1 });
  const candidate = snapshot.selected_teacher_schedule.move_candidates[0];
  assert.equal(candidate.from_slot, 'D1P1');
  assert.equal(candidate.from_label, '周一第1节');
  assert.equal(candidate.candidate_targets.some(target => target.slot_id === 'D1P2'), false);
  assert.equal(candidate.candidate_targets[0].local_check, '教师与本 section 当前学生均无同一时段冲突');
  assert.equal(JSON.stringify(snapshot).includes('S1'), false);
});

test('page assistant uses a bounded read-only prompt and page summary', async () => {
  assert.match(AI_ASSISTANT_PROMPT, /不能直接写入/);
  assert.match(AI_ASSISTANT_PROMPT, /不分配教室/);
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.max_tokens, 1600);
    assert.deepEqual(request.response_format, { type: 'json_object' });
    assert.equal(request.messages[0].role, 'system');
    assert.match(request.messages[0].content, /不能直接写入/);
    const payload = JSON.parse(request.messages.at(-1).content);
    assert.equal(payload.page_snapshot.current_page, 'courses');
    assert.equal(payload.page_snapshot.system_summary.student_count, 1);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ response: '请在课程管理中核对。', action: null }) } }] }) };
  };
  const result = await askAiAssistant({
    message: '这个页面有什么要检查？',
    context: { view: 'courses' },
    state: { students: [{ id: 'S1', name: '隐私姓名', grade: 10 }] },
  }, {
    fetchImpl,
    config: { apiKey: 'test-key', apiUrl: 'https://example.test/v1', model: 'test-model' },
  });
  assert.equal(result.response, '请在课程管理中核对。');
  assert.equal(result.model, 'test-model');
});

test('accepts only a validated teacher-swap proposal from the model', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({
        response: '已整理为待确认的教师调换。',
        action: { type: 'swap_teaching_assignments', assignment_ids: ['TA_1', 'TA_2'] },
      }) } }],
    }),
  });
  const result = await askAiAssistant({
    message: '把两位老师的课程调换一下',
    state: {
      meta: { revision: 3 },
      teachers: [
        { id: 'T_1', name: '甲老师', can_teach: ['C_1', 'C_2'] },
        { id: 'T_2', name: '乙老师', can_teach: ['C_1', 'C_2'] },
      ],
      courses: [{ id: 'C_1', name: '课程甲' }, { id: 'C_2', name: '课程乙' }],
      teaching_assignments: [
        { id: 'TA_1', teacher_id: 'T_1', course_id: 'C_1', class_ids: ['TC1'], class_type: 'teaching', weekly_hours: 2 },
        { id: 'TA_2', teacher_id: 'T_2', course_id: 'C_2', class_ids: ['TC2'], class_type: 'teaching', weekly_hours: 2 },
      ],
    },
  }, {
    fetchImpl,
    config: { apiKey: 'test-key', apiUrl: 'https://example.test/v1', model: 'test-model' },
  });
  assert.equal(result.action.type, 'swap_teaching_assignments');
  assert.deepEqual(result.action.assignment_ids, ['TA_1', 'TA_2']);
});

test('bounds workbook data sent to the model', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(
    Array.from({ length: 20 }, (_, row) => Array.from({ length: 20 }, (_, column) => `${row}:${column}`)),
  ), 'Sheet1');
  const snapshot = workbookSnapshot(workbook, { maxRowsPerSheet: 3, maxColumns: 4, maxCells: 12 });
  assert.equal(snapshot.sheets[0].rows.length, 3);
  assert.equal(snapshot.sheets[0].rows[0].length, 4);
});

test('turns validated model output into a canonical workbook', () => {
  const workbook = workbookFromInterpretation({
    sheets: [{
      name: 'ABC',
      headers: ['Student ID', '中文姓名', 'A组'],
      rows: [{ 'Student ID': '202301', 中文姓名: '张三', A组: 'AP Language' }],
    }],
  });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.ABC, { header: 1, defval: '' });
  assert.deepEqual(rows[0], ['Student ID', '中文姓名', 'A组']);
  assert.deepEqual(rows[1], ['202301', '张三', 'AP Language']);
});

test('calls the model once and validates its JSON response', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['odd'], ['layout']]), 'Raw');
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.equal(request.messages.length, 2);
    assert.deepEqual(request.response_format, { type: 'json_object' });
    assert.deepEqual(request.thinking, { type: 'disabled' });
    assert.match(request.messages[0].content, /不推测、不补全/);
    assert.match(request.messages[0].content, /不确定字段保留空值/);
    assert.match(request.messages[0].content, /并排放置多份纵向课程名单/);
    assert.match(request.messages[0].content, /德语名单/);
    assert.match(request.messages[0].content, /并排的多列区块/);
    assert.match(request.messages[0].content, /力学基础学生名单/);
    assert.match(request.messages[0].content, /只有姓名、没有课程标题的汇总工作表/);
    assert.match(request.messages[0].content, /GERMAN（德语）/);
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              document_type: 'elective_selections',
              confidence: 0.95,
              sheets: [{
                name: 'ABC',
                headers: ['Student ID', '中文姓名', 'A组', 'B组', 'C组'],
                rows: [['202301', '张三', '', '线性代数', '日语']],
              }],
            }),
          },
        }],
      }),
    };
  };
  const result = await interpretWorkbook(workbook, {
    expectedType: 'elective_selections',
    courseCatalog: [{ id: 'GERMAN', name: '德语', type: 'required_elective', grade: 12, elective_group: 'C' }],
    fetchImpl,
    config: { apiKey: 'test-key', apiUrl: 'https://example.test/v1', model: 'test-model' },
  });
  assert.equal(calls, 1);
  assert.equal(result.interpretation.confidence, 0.95);
});

test('tells the elective interpreter how to split a headerless side-by-side senior roster', async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['力学基础学生名单', '', '', '', 'AP 商业学生名单', '', '', '', '', '线性代数学生名单'],
    [1, '何子盈', '', '', 1, '李之乔', '', '', '', 1, '厉潇蔓'],
  ]);
  sheet['!merges'] = [
    XLSX.utils.decode_range('A1:C1'),
    XLSX.utils.decode_range('E1:G1'),
    XLSX.utils.decode_range('J1:L1'),
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['只是一张姓名汇总']]), 'Sheet2');

  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    const prompt = request.messages[0].content;
    assert.match(prompt, /文档语义判定/);
    assert.match(prompt, /课程花名册/);
    assert.match(prompt, /学生选课汇总表/);
    assert.match(prompt, /预分班结果或辅助名单/);
    assert.match(prompt, /证据不足时不得把名单猜成选课/);
    assert.match(prompt, /绝不能使用横向位置、区块数量或出现顺序推断 A\/B\/C 组别/);
    assert.match(prompt, /力学基础、商业、线性代数.*都写入 B组/);
    assert.match(prompt, /输出前逐项核对/);
    assert.match(prompt, /英美文学史及选读（20人）-416教室/);
    assert.match(prompt, /AP LC.*AP Language and Composition/);
    assert.match(prompt, /AP Lit\.&Com\..*AP Literature and Composition/);
    assert.match(prompt, /三个区块均写入 A组/);
    assert.match(prompt, /无表头的三栏横向名单/);
    assert.match(prompt, /A1:C1.*力学基础/);
    assert.match(prompt, /E1:G1.*AP 商业/);
    assert.match(prompt, /J1:L1.*线性代数/);
    assert.match(prompt, /A\/E\/J 是序号，B\/F\/K/);
    assert.match(prompt, /何子盈.*力学基础/);
    assert.match(prompt, /李之乔.*商业/);
    assert.match(prompt, /厉潇蔓.*线性代数/);
    assert.deepEqual(request.messages[1].content.includes('A1:C1'), true);
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              document_type: 'elective_selections',
              confidence: 0.98,
              sheets: [{
                name: '高三选课',
                headers: ['Student ID', '中文姓名', '姓名拼音', '英文名', 'A组', 'B组', 'C组'],
                rows: [
                  ['', '何子盈', '', '', '', '力学基础', ''],
                  ['', '李之乔', '', '', '', '商业', ''],
                  ['', '厉潇蔓', '', '', '', '线性代数', ''],
                ],
              }],
            }),
          },
        }],
      }),
    };
  };

  const result = await interpretWorkbook(workbook, {
    expectedType: 'elective_selections',
    fetchImpl,
    config: { apiKey: 'test-key', apiUrl: 'https://example.test/v1', model: 'test-model' },
  });
  assert.equal(result.interpretation.sheets[0].rows.length, 3);
});

test('tells the AP workbook interpreter to merge side-by-side Block rosters into one course', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['AP Biology'],
    ['', 'Senior 2&Senior 3 Class 2 - Block2', '', '', '', '', '', 'Senior 2&Senior 3 Class 3 - Block3'],
    ['', 'No.', 'Name (Chinese)', 'Name (Pin Yin)', 'English Name', '', '', 'No.', 'Name (Chinese)'],
    ['S2', 1, '张三', 'Zhang San', 'Alex', '', 'S2', 1, '李四'],
  ]), 'AP Biology - 2 blocks');
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    const prompt = request.messages[0].content;
    assert.match(prompt, /横向并排放置两个或多个名单区块/);
    assert.match(prompt, /预分班或并行 Block/);
    assert.match(prompt, /合并到.*同一门 AP 课程/);
    assert.match(prompt, /不得把 Block1、Block2、Class1、Class2 写进 title/);
    assert.match(prompt, /只出现于 1 门或 2 门 AP 课程页是正常且完整的记录/);
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              document_type: 'ap_selections',
              confidence: 0.92,
              sheets: [{
                name: 'AP Biology', title: 'AP Biology',
                headers: ['Name (Chinese)', 'Name (Pinyin)', 'English Name'],
                rows: [['张三', 'Zhang San', 'Alex'], ['李四', '', '']],
              }],
            }),
          },
        }],
      }),
    };
  };
  const result = await interpretWorkbook(workbook, {
    expectedType: 'ap_selections',
    fetchImpl,
    config: { apiKey: 'test-key', apiUrl: 'https://example.test/v1', model: 'test-model' },
  });
  assert.equal(result.interpretation.sheets[0].rows.length, 2);
  assert.equal(result.interpretation.sheets[0].title, 'AP Biology');
});

test('retries once when JSON mode returns an empty model response', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['名单']]), 'Raw');
  let calls = 0;
  const requests = [];
  const fetchImpl = async (_url, options) => {
    calls++;
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => calls === 1
        ? { choices: [{ finish_reason: 'stop', message: { content: '' } }] }
        : {
          choices: [{
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                document_type: 'elective_selections',
                sheets: [{ name: 'ABC', headers: ['中文姓名', 'B组'], rows: [['张三', '商业']] }],
              }),
            },
          }],
        },
    };
  };
  const result = await interpretWorkbook(workbook, {
    expectedType: 'elective_selections',
    fetchImpl,
    config: { apiKey: 'test-key', apiUrl: 'https://example.test/v1', model: 'test-model' },
  });
  assert.equal(calls, 2);
  assert.deepEqual(requests[0].response_format, { type: 'json_object' });
  assert.equal(requests[1].response_format, undefined);
  assert.deepEqual(requests[1].thinking, { type: 'disabled' });
  assert.equal(result.interpretation.sheets[0].rows[0][0], '张三');
});

test('uses the model only for a validated scheduling strategy', async () => {
  assert.match(AI_SCHEDULING_STRATEGY_PROMPT, /manual_locks/);
  assert.match(AI_SCHEDULING_STRATEGY_PROMPT, /不得输出最终课表/);
  assert.match(AI_SCHEDULING_STRATEGY_PROMPT, /自习.*空位/);
  const problem = {
    sections: [{
      id: 'SEC_1', course_id: 'C1', teacher_id: 'T1', class_id: 'TC1',
      class_type: 'teaching', grades: [11], weekly_hours: 1,
    }],
    rules: [
      { id: 'HARD', name: '硬规则', type: 'forbid_slots', hard: true, scope: 'section', target_ids: ['SEC_1'] },
      { id: 'SOFT', name: '软规则', type: 'preferred_slots', hard: false, weight: 3, scope: 'section', target_ids: ['SEC_1'] },
    ],
  };
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.match(request.messages[0].content, /绝对不得移动/);
    assert.match(request.messages[1].content, /D1P2/);
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              priority_section_ids: ['SEC_1'],
              soft_rule_weight_overrides: { SOFT: 9 },
              warnings: [],
              notes: ['先排锁定课程附近的高约束课程'],
            }),
          },
        }],
      }),
    };
  };
  const strategy = await planSchedulingStrategy(problem, {
    locks: [{ section_id: 'SEC_1', slot_id: 'D1P2' }],
    fetchImpl,
    config: { apiKey: 'test-key', apiUrl: 'https://example.test/v1', model: 'test-model' },
  });
  assert.deepEqual(strategy.priority_section_ids, ['SEC_1']);
  assert.deepEqual(strategy.soft_rule_weight_overrides, { SOFT: 9 });
});
