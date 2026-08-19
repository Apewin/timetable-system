import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function declaration(selector, property) {
  const rule = styles.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`));
  assert.ok(rule, `missing CSS rule for ${selector}`);
  const value = rule[1].match(new RegExp(`(?:^|;)\\s*${property}:\\s*(#[0-9a-f]{6})\\s*(?:;|$)`, 'i'));
  assert.ok(value, `missing ${property} in ${selector}`);
  return value[1];
}

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map(channel => Number.parseInt(channel, 16) / 255);
  const linear = channels.map(channel => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test('dark-theme AI messages and action cards keep readable text contrast', () => {
  const selectors = [
    ':root[data-theme="dark"] .ai-assistant-message.assistant',
    ':root[data-theme="dark"] .ai-assistant-message.user',
    ':root[data-theme="dark"] .ai-assistant-message.error',
    ':root[data-theme="dark"] .ai-assistant-action',
    ':root[data-theme="dark"] .ai-assistant-action-complete',
  ];

  for (const selector of selectors) {
    const foreground = declaration(selector, 'color');
    const background = declaration(selector, 'background');
    assert.ok(
      contrastRatio(foreground, background) >= 4.5,
      `${selector} must meet WCAG AA text contrast`,
    );
  }
});
