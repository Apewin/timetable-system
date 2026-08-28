import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const directory = mkdtempSync(join(tmpdir(), 'timetable-browser-e2e-'));
const stateFile = join(directory, 'state.json');
const aiConfigFile = join(directory, 'ai.env');
writeFileSync(aiConfigFile, [
  'DEEPSEEK_API_KEY=browser-e2e-placeholder',
  'DEEPSEEK_API_URL=http://127.0.0.1:9',
  'DEEPSEEK_MODEL=browser-e2e',
  '',
].join('\n'), { encoding: 'utf8', mode: 0o600 });
writeFileSync(stateFile, `${JSON.stringify({
  schema_version: 1,
  version: '0.1.0',
  meta: { revision: 1, school: '真实浏览器测试学校' },
  config: { time_model: { days: 5, periods_per_day: 10, lunch_break_after_period: 5 } },
  teachers: [
    {
      id: 'T_MATH', name: '数学任课教师', can_teach: ['MATH'],
      available_slots: [], max_per_day: 5, max_per_week: 20,
    },
    {
      id: 'T_OTHER', name: '安生监考教师', can_teach: [],
      available_slots: [], max_per_day: 5, max_per_week: 20,
    },
    {
      id: 'T_BIO', name: '生物任课教师', can_teach: ['BIO'],
      available_slots: [], max_per_day: 5, max_per_week: 20,
    },
  ],
  rooms: [{ id: 'R1', name: '教室一', type: 'classroom', capacity: 30 }],
  courses: [{
    id: 'MATH', name: '数学', type: 'required', grade: 10,
    weekly_hours: 1, required_room_type: 'classroom',
  }, {
    id: 'BIO', name: '生物', type: 'required', grade: 10,
    weekly_hours: 1, required_room_type: 'classroom',
  }],
  students: [
    { id: 'S1', name: '学生一', grade: 10, admin_class_id: 'G10A', teaching_class_id: 'G10T' },
    { id: 'S2', name: '学生二', grade: 10, admin_class_id: 'G10A', teaching_class_id: 'G10T' },
  ],
  admin_classes: [{ id: 'G10A', name: '高一行政班', grade: 10, student_ids: ['S1', 'S2'], fixed_room_id: 'R1' }],
  teaching_classes: [{ id: 'G10T', name: '高一教学班', grade: 10, student_ids: ['S1', 'S2'], fixed_room_id: 'R1' }],
  teaching_assignments: [{
    id: 'TA_MATH', teacher_id: 'T_MATH', course_id: 'MATH',
    class_id: 'G10T', class_ids: ['G10T'], class_type: 'teaching', weekly_hours: 1,
  }, {
    id: 'TA_BIO', teacher_id: 'T_BIO', course_id: 'BIO',
    class_id: 'G10T', class_ids: ['G10T'], class_type: 'teaching', weekly_hours: 1,
  }],
  teaching_tasks: [],
  selection_blocks: [],
  constraints: [],
}, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

process.env.STATE_FILE = stateFile;
process.env.STATE_BACKUP_DIR = join(directory, 'backups');
process.env.TIMETABLE_JOB_FILE = join(directory, 'jobs.json');
process.env.TIMETABLE_AUDIT_FILE = join(directory, 'audit.jsonl');
process.env.TIMETABLE_AUTH_MODE = 'off';
process.env.TIMETABLE_ENV_FILE = aiConfigFile;
// Environment variables take precedence over the temporary config file in
// production. Override them as well so browser tests can never contact a
// developer's real model endpoint or use their API key.
process.env.DEEPSEEK_API_KEY = 'browser-e2e-placeholder';
process.env.DEEPSEEK_API_URL = 'http://127.0.0.1:9';
process.env.DEEPSEEK_MODEL = 'browser-e2e';

const { startServer } = await import('../../backend/src/server.mjs');
const server = startServer({ port: 4177, host: '127.0.0.1' });

function shutdown() {
  server.close(() => {
    rmSync(directory, { recursive: true, force: true });
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
