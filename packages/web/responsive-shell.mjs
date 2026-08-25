export const AI_ASSISTANT_OVERLAY_BREAKPOINT = 1480;

export function shouldAutoCollapseAiAssistant(viewportWidth) {
  const width = Number(viewportWidth);
  return Number.isFinite(width) && width <= AI_ASSISTANT_OVERLAY_BREAKPOINT;
}
