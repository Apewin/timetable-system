export const OPERATIONS = [
  { name: 'system.status', category: 'system', method: 'GET', path: '/status', mutates: false },
  { name: 'system.state', category: 'system', method: 'GET', path: '/state', mutates: false },
  { name: 'system.settings.get', category: 'system', method: 'GET', path: '/settings', mutates: false },
  {
    name: 'system.settings.update', category: 'system', method: 'POST', path: '/settings', mutates: true,
    body: { required: [], optional: ['apiKey', 'apiUrl', 'model'] },
  },
  {
    name: 'system.ai.test', category: 'system', method: 'POST', path: '/ai/test', mutates: false,
    body: { required: [], optional: ['message'] },
  },

  { name: 'data.entity.list', category: 'data', method: 'GET', path: '/:entity', mutates: false },
  {
    name: 'data.entity.create', category: 'data', method: 'POST', path: '/:entity', mutates: true,
    body: { required: ['entity payload'], optional: [] },
  },
  {
    name: 'data.entity.update', category: 'data', method: 'PUT', path: '/:entity/:id', mutates: true,
    body: { required: ['changed fields'], optional: [] },
  },
  { name: 'data.entity.delete', category: 'data', method: 'DELETE', path: '/:entity/:id', mutates: true },
  { name: 'data.ap-selections.list', category: 'data', method: 'GET', path: '/ap_selections', mutates: false },
  {
    name: 'data.ap-selections.create', category: 'data', method: 'POST', path: '/ap_selections', mutates: true,
    body: { required: ['student_id', 'course_ids'], optional: [] },
  },
  {
    name: 'data.ap-selections.update', category: 'data', method: 'PUT', path: '/ap_selections/:studentId', mutates: true,
    body: { required: ['course_ids'], optional: [] },
  },
  { name: 'data.ap-selections.delete', category: 'data', method: 'DELETE', path: '/ap_selections/:studentId', mutates: true },

  { name: 'rules.list', category: 'rules', method: 'GET', path: '/rules', mutates: false },
  {
    name: 'rules.replace', category: 'rules', method: 'PUT', path: '/rules', mutates: true,
    body: { required: ['rules'], optional: [] },
  },
  {
    name: 'rules.compile', category: 'rules', method: 'POST', path: '/rules/compile', mutates: false,
    body: { required: ['rules'], optional: [] },
  },

  { name: 'schedule.input.validate', category: 'schedule', method: 'GET', path: '/validate-input', mutates: false },
  { name: 'schedule.validate', category: 'schedule', method: 'GET', path: '/validate', mutates: false },
  {
    name: 'schedule.preview', category: 'schedule', method: 'POST', path: '/solve/preview', mutates: false,
    body: { required: [], optional: ['rules'] },
  },
  { name: 'schedule.tasks.build', category: 'schedule', method: 'POST', path: '/build-tasks', mutates: true },
  {
    name: 'schedule.solve', category: 'schedule', method: 'POST', path: '/solve', mutates: true,
    body: {
      required: [],
      optional: ['max_time_seconds', 'candidate_count', 'random_seed', 'approved_rule_relaxations', 'approved_hard_rule_relaxations', 'quality_limits'],
    },
  },
  {
    name: 'schedule.clear-unlocked', category: 'schedule', method: 'POST', path: '/schedule/clear-unlocked', mutates: true,
    body: { required: ['expected_revision'], optional: ['confirmed_by'] },
  },
  { name: 'schedule.timetable', category: 'schedule', method: 'GET', path: '/timetable/:by/:id', mutates: false },
  {
    name: 'schedule.lock', category: 'schedule', method: 'POST', path: '/lock', mutates: true,
    body: { required: ['task_id', 'slot_id'], optional: [] },
  },
  {
    name: 'schedule.unlock', category: 'schedule', method: 'POST', path: '/unlock', mutates: true,
    body: { required: ['task_id', 'slot_id'], optional: [] },
  },
  {
    name: 'schedule.swap', category: 'schedule', method: 'POST', path: '/swap', mutates: true,
    body: { required: ['task_id', 'from_slot', 'to_slot'], optional: [] },
  },
  {
    name: 'schedule.teacher.drag-candidates', category: 'schedule', method: 'POST', path: '/teacher-timetable/drag-candidates', mutates: false,
    body: { required: ['teacher_id', 'task_id', 'from_slot'], optional: [] },
  },
  {
    name: 'schedule.teacher.adjust', category: 'schedule', method: 'POST', path: '/teacher-timetable/adjust', mutates: true,
    body: { required: ['teacher_id', 'task_id', 'from_slot', 'to_slot'], optional: ['action'] },
  },
  { name: 'schedule.editor.get', category: 'schedule', method: 'GET', path: '/schedule-editor', mutates: false },
  {
    name: 'schedule.overlay.add', category: 'schedule', method: 'POST', path: '/schedule-editor/overlays', mutates: true,
    body: { required: ['kind', 'title', 'class_id', 'start_slot_id'], optional: ['duration', 'color'] },
  },
  { name: 'schedule.overlay.delete', category: 'schedule', method: 'DELETE', path: '/schedule-editor/overlays/:overlayId', mutates: true },

  { name: 'manual-plan.get', category: 'manual-plan', method: 'GET', path: '/manual-plan', mutates: false },
  {
    name: 'manual-plan.draft', category: 'manual-plan', method: 'PUT', path: '/manual-plan/draft', mutates: true,
    body: { required: ['placements'], optional: [] },
  },
  {
    name: 'manual-plan.confirm', category: 'manual-plan', method: 'POST', path: '/manual-plan/confirm', mutates: true,
    body: { required: [], optional: ['placements', 'confirmed_by'] },
  },
  { name: 'manual-plan.unlock', category: 'manual-plan', method: 'POST', path: '/manual-plan/unlock', mutates: true },
  {
    name: 'manual-plan.solve', category: 'manual-plan', method: 'POST', path: '/manual-plan/ai-solve', mutates: true,
    body: { required: [], optional: ['use_ai_strategy', 'instruction', 'max_time_seconds', 'candidate_count', 'random_seed', 'approved_rule_relaxations', 'approved_hard_rule_relaxations', 'quality_limits'] },
  },

  { name: 'ap-block.get', category: 'ap-block', method: 'GET', path: '/ap-block-config', mutates: false },
  {
    name: 'ap-block.update', category: 'ap-block', method: 'PUT', path: '/ap-block-config', mutates: true,
    body: { required: ['enabled', 'blocks'], optional: [] },
  },
  { name: 'ap-block.sections.list', category: 'ap-block', method: 'GET', path: '/elective-sections', mutates: false },
  { name: 'ap-block.sections.suggestions', category: 'ap-block', method: 'GET', path: '/elective-sections/suggestions', mutates: false },
  { name: 'ap-block.sections.build', category: 'ap-block', method: 'POST', path: '/solve-sections', mutates: true },
  {
    name: 'ap-block.section.update', category: 'ap-block', method: 'PUT', path: '/elective-sections/:id', mutates: true,
    body: { required: [], optional: ['teacher_id', 'replan'] },
  },
  {
    name: 'ap-block.student.move', category: 'ap-block', method: 'POST', path: '/elective-sections/:id/move-student', mutates: true,
    body: { required: ['student_id'], optional: ['replan'] },
  },

  {
    name: 'import.generic.preview', category: 'import', method: 'POST', path: '/import/excel', mutates: false, transport: 'multipart',
    body: { required: ['file'], optional: ['expected_type', 'ai_organize'] },
  },
  {
    name: 'import.students.preview', category: 'import', method: 'POST', path: '/import/excel', mutates: false, transport: 'multipart',
    body: { required: ['file'], optional: ['ai_organize'] },
  },
  {
    name: 'import.ap.preview', category: 'import', method: 'POST', path: '/ap-selections/import/preview', mutates: false, transport: 'multipart',
    body: { required: ['file'], optional: ['ai_organize'] },
  },
  {
    name: 'import.elective.preview', category: 'import', method: 'POST', path: '/elective-selections/import/preview', mutates: false, transport: 'multipart',
    body: { required: ['file'], optional: ['ai_organize'] },
  },
  {
    name: 'import.generic.confirm', category: 'import', method: 'POST', path: '/import/confirm', mutates: true,
    body: { required: ['type', 'data'], optional: [] },
  },
  {
    name: 'import.ap.confirm', category: 'import', method: 'POST', path: '/ap-selections/import/confirm', mutates: true,
    body: { required: ['changes'], optional: ['mode'] },
  },
  {
    name: 'import.elective.confirm', category: 'import', method: 'POST', path: '/elective-selections/import/confirm', mutates: true,
    body: { required: ['changes'], optional: [] },
  },

  {
    name: 'export.preview', category: 'export', method: 'POST', path: '/export/templates/preview', mutates: false, transport: 'multipart',
    body: { required: [], optional: ['class_template', 'teacher_template'] },
  },
  {
    name: 'export.ai-match', category: 'export', method: 'POST', path: '/export/templates/ai-match', mutates: false, transport: 'multipart', external_ai: true,
    body: { required: [], optional: ['class_template', 'teacher_template'] },
  },
  {
    name: 'export.generate', category: 'export', method: 'POST', path: '/export/templates/generate', mutates: false, transport: 'multipart', writes_local_files: true,
    body: { required: [], optional: ['class_template', 'teacher_template', 'teacher_mappings'] },
  },

  { name: 'archive.list', category: 'archive', method: 'GET', path: '/schedule-archives', mutates: false },
  { name: 'archive.create', category: 'archive', method: 'POST', path: '/schedule-archives', mutates: true },
  { name: 'archive.get', category: 'archive', method: 'GET', path: '/schedule-archives/:archiveId', mutates: false },
  { name: 'archive.timetable', category: 'archive', method: 'GET', path: '/schedule-archives/:archiveId/timetable/:by/:id', mutates: false },

  { name: 'graduation.preview', category: 'graduation', method: 'GET', path: '/graduation/preview', mutates: false },
  {
    name: 'graduation.confirm', category: 'graduation', method: 'POST', path: '/graduation/confirm', mutates: true,
    body: { required: ['confirmation', 'expected_revision'], optional: ['confirmed_by'] },
  },
  { name: 'graduation.archives.list', category: 'graduation', method: 'GET', path: '/graduation-archives', mutates: false },
  { name: 'graduation.archives.get', category: 'graduation', method: 'GET', path: '/graduation-archives/:archiveId', mutates: false },

  {
    name: 'assistant.chat', category: 'assistant', method: 'POST', path: '/assistant/chat', mutates: false, external_ai: true,
    body: { required: ['message'], optional: ['context', 'history'] },
  },
  {
    name: 'assistant.teacher-swap', category: 'assistant', method: 'POST', path: '/assistant/actions/swap-teaching-assignments', mutates: true,
    body: { required: ['assignment_ids', 'expected_revision'], optional: [] },
  },
  {
    name: 'assistant.meeting-move', category: 'assistant', method: 'POST', path: '/assistant/actions/move-schedule-meeting', mutates: true,
    body: { required: ['section_id', 'from_slot', 'to_slot', 'expected_revision'], optional: [] },
  },
];

export function describeOperations(filter) {
  if (!filter) return OPERATIONS;
  return OPERATIONS.filter(operation => operation.category === filter || operation.name === filter);
}
