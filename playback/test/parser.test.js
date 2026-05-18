const test = require('node:test');
const assert = require('node:assert');
const { parseLine, parseFile } = require('../parser');

/*
 * Format (foldable, indentation-based):
 *
 *   [NNN] type "summary"
 *       key: "JSON-escaped-string"
 *       key: bareword
 *       key: 42
 *
 *   [NNN+1] ...
 *
 * Header lines start with '['. Body lines start with 4 spaces.
 * Comments start with '#'. Blank lines separate events.
 */

test.describe('parseLine (header)', () => {
  test('parses a navigate header with URL summary', () => {
    const r = parseLine('[001] navigate "https://example.com"');
    assert.deepStrictEqual(r, { kind: 'header', seq: 1, type: 'navigate', summary: 'https://example.com' });
  });

  test('parses a click header with Korean text summary', () => {
    const r = parseLine('[002] click "로그인"');
    assert.deepStrictEqual(r, { kind: 'header', seq: 2, type: 'click', summary: '로그인' });
  });

  test('parses a header with no summary (bare)', () => {
    const r = parseLine('[005] submit');
    assert.deepStrictEqual(r, { kind: 'header', seq: 5, type: 'submit', summary: null });
  });

  test('parses a header whose summary contains an arrow and quoted target', () => {
    const r = parseLine('[003] input "user@test.com" → [name="email"]');
    assert.strictEqual(r.kind, 'header');
    assert.strictEqual(r.seq, 3);
    assert.strictEqual(r.type, 'input');
    assert.ok(r.summary.includes('user@test.com'));
  });

  test('returns null for malformed header (missing brackets)', () => {
    assert.strictEqual(parseLine('001 click'), null);
  });
});

test.describe('parseLine (body)', () => {
  test('parses a quoted string value', () => {
    const r = parseLine('    target: "로그인"');
    assert.deepStrictEqual(r, { kind: 'body', key: 'target', value: '로그인' });
  });

  test('parses an escaped quote inside a quoted value', () => {
    const r = parseLine('    target: "[name=\\"email\\"]"');
    assert.strictEqual(r.value, '[name="email"]');
  });

  test('parses a bareword value (no quotes)', () => {
    const r = parseLine('    target_kind: text');
    assert.deepStrictEqual(r, { kind: 'body', key: 'target_kind', value: 'text' });
  });

  test('parses a boolean value', () => {
    const r = parseLine('    sensitive: true');
    assert.strictEqual(r.value, true);
  });

  test('parses a numeric value', () => {
    const r = parseLine('    delay_ms: 250');
    assert.strictEqual(r.value, 250);
  });

  test('preserves "[REDACTED]" sentinel literally', () => {
    const r = parseLine('    value: "[REDACTED]"');
    assert.strictEqual(r.value, '[REDACTED]');
  });

  test('returns null for body indentation without colon', () => {
    assert.strictEqual(parseLine('    just some indented text'), null);
  });
});

test.describe('parseLine (skip)', () => {
  test('returns null for comments and blanks', () => {
    assert.strictEqual(parseLine('# header line'), null);
    assert.strictEqual(parseLine(''), null);
    assert.strictEqual(parseLine('   '), null);
  });
});

test.describe('parseFile', () => {
  test('groups headers with their indented body into events', () => {
    const text = [
      '# Macro recorder export',
      '# Events: 2',
      '',
      '[001] navigate "https://example.com"',
      '    url: "https://example.com"',
      '',
      '[002] click "로그인"',
      '    target: "로그인"',
      '    tag: "button"',
      '    role: "button"',
      '    url: "https://example.com"',
      ''
    ].join('\n');

    const events = parseFile(text);
    assert.strictEqual(events.length, 2);

    assert.strictEqual(events[0].seq, 1);
    assert.strictEqual(events[0].type, 'navigate');
    assert.strictEqual(events[0].fields.url, 'https://example.com');

    assert.strictEqual(events[1].seq, 2);
    assert.strictEqual(events[1].type, 'click');
    assert.deepStrictEqual(events[1].fields, {
      target: '로그인',
      tag: 'button',
      role: 'button',
      url: 'https://example.com'
    });
  });

  test('preserves seq order', () => {
    const text = [
      '[001] navigate "https://a"',
      '    url: "https://a"',
      '',
      '[002] click "b"',
      '    target: "b"',
      '',
      '[003] click "c"',
      '    target: "c"'
    ].join('\n');
    const events = parseFile(text);
    assert.deepStrictEqual(events.map(e => e.seq), [1, 2, 3]);
  });

  test('handles sensitive [REDACTED] values within a body block', () => {
    const text = [
      '[004] input [REDACTED] → [name="password"]',
      '    target: "[name=\\"password\\"]"',
      '    value: "[REDACTED]"',
      '    sensitive: true',
      '    input_type: "password"',
      '    url: "https://example.com"'
    ].join('\n');
    const events = parseFile(text);
    assert.strictEqual(events[0].fields.value, '[REDACTED]');
    assert.strictEqual(events[0].fields.sensitive, true);
  });

  test('returns an empty array for an all-comment input', () => {
    const text = '# only comments\n# nothing real\n';
    assert.deepStrictEqual(parseFile(text), []);
  });

  test('an event with no body is still recognized', () => {
    const text = '[005] submit';
    const events = parseFile(text);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'submit');
    assert.deepStrictEqual(events[0].fields, {});
  });
});
