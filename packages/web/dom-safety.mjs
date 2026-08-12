const HTML_ENTITIES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
});

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => HTML_ENTITIES[character]);
}

export function safeDataAttribute(value) {
  return escapeHtml(value);
}
