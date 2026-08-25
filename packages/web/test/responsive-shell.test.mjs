import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_ASSISTANT_OVERLAY_BREAKPOINT,
  shouldAutoCollapseAiAssistant,
} from '../responsive-shell.mjs';

test('the assistant yields the content column at laptop and compact desktop widths', () => {
  assert.equal(shouldAutoCollapseAiAssistant(1280), true);
  assert.equal(shouldAutoCollapseAiAssistant(AI_ASSISTANT_OVERLAY_BREAKPOINT), true);
  assert.equal(shouldAutoCollapseAiAssistant(AI_ASSISTANT_OVERLAY_BREAKPOINT + 1), false);
});
