function text(value) {
  return String(value ?? '').trim();
}

const AP_STUDENT_GAP_RULE_ID = 'ap_block_students_compact_daily_schedule';
const DAY_LABELS = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五' };
const GRADE_LABELS = { 10: '高一', 11: '高二', 12: '高三' };

export function qualityAffectedStudents(validation = {}, students = []) {
  const studentById = new Map((students || []).map(student => [student.id, student]));
  const grouped = new Map();
  for (const violation of validation.soft_violations || []) {
    if (violation?.rule_id !== AP_STUDENT_GAP_RULE_ID || !text(violation.target_id)) continue;
    const studentId = text(violation.target_id);
    const student = studentById.get(studentId) || {};
    if (!grouped.has(studentId)) {
      const grade = Number(student.grade);
      grouped.set(studentId, {
        student_id: studentId,
        student_name: text(student.name) || studentId,
        english_name: text(student.english_name),
        grade: Number.isInteger(grade) ? grade : null,
        grade_label: GRADE_LABELS[grade] || '年级未知',
        day_details: [],
      });
    }
    const day = Number(violation.day);
    grouped.get(studentId).day_details.push({
      day,
      day_label: DAY_LABELS[day] || `第 ${day} 天`,
      missing_periods: [...new Set((violation.missing_periods || []).map(Number).filter(Number.isInteger))]
        .sort((left, right) => left - right),
    });
  }
  const rows = [...grouped.values()]
    .map(row => ({ ...row, day_details: row.day_details.sort((left, right) => left.day - right.day) }))
    .sort((left, right) => (left.grade ?? 99) - (right.grade ?? 99)
      || left.student_name.localeCompare(right.student_name, 'zh-CN')
      || left.student_id.localeCompare(right.student_id));
  return {
    affected_students: rows.length,
    affected_student_days: rows.reduce((total, row) => total + row.day_details.length, 0),
    rows,
  };
}

export function systemStatusReview(status) {
  if (!status) {
    return {
      label: '状态未知',
      tone: 'neutral',
      items: [],
      guidance: '尚未连接到系统，无法执行发布前检查。',
      ordinary_publication_allowed: false,
      quality_exception_available: false,
    };
  }

  const items = (status.review_items || [])
    .map(item => text(item?.message))
    .filter(Boolean)
    .filter((message, index, messages) => messages.indexOf(message) === index);
  if (status.review_required || status.publication_status === 'review_required') {
    return {
      label: items.length ? `${items.length} 项待复核` : '存在待复核项',
      tone: 'warning',
      items,
      guidance: items.length
        ? '请逐项核对并处理完再发布；确需保留的例外应填写说明。'
        : '当前课表尚未通过发布检查，请打开课表审查页查看详情后再发布。',
      ordinary_publication_allowed: false,
      quality_exception_available: true,
    };
  }
  if (status.publication_status === 'ready') {
    return {
      label: '发布前检查已通过',
      tone: 'success',
      items: [],
      guidance: '当前课表已通过硬约束和质量门槛检查。',
      ordinary_publication_allowed: true,
      quality_exception_available: false,
    };
  }
  if (status.publication_status === 'ready_with_quality_exception') {
    return {
      label: '已批准带例外发布',
      tone: 'warning',
      items,
      guidance: '当前版本包含已人工确认的质量例外，发布前请再次核对说明。',
      ordinary_publication_allowed: false,
      quality_exception_available: false,
    };
  }
  return {
    label: '尚无可发布课表',
    tone: 'neutral',
    items: [],
    guidance: '请先完成排课，再进行发布前检查。',
    ordinary_publication_allowed: false,
    quality_exception_available: false,
  };
}
