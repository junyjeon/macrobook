const test = require('node:test');
const assert = require('node:assert');
const {
  classifyTarget,
  extractAriaLabel,
  pickTextScope,
  findElementJs
} = require('../selector');

test.describe('classifyTarget', () => {
  test('classifies [aria="..."] as aria', () => {
    assert.strictEqual(classifyTarget('[aria="검색"]'), 'aria');
    assert.strictEqual(classifyTarget('[aria="Open menu"]'), 'aria');
  });

  test('classifies [name="..."] as css', () => {
    assert.strictEqual(classifyTarget('[name="email"]'), 'css');
  });

  test('classifies other [attr="..."] as css', () => {
    assert.strictEqual(classifyTarget('[data-testid="login"]'), 'css');
    assert.strictEqual(classifyTarget('[type="submit"]'), 'css');
  });

  test('classifies #id as css', () => {
    assert.strictEqual(classifyTarget('#login-btn'), 'css');
  });

  test('classifies .class as css', () => {
    assert.strictEqual(classifyTarget('.submit-btn'), 'css');
  });

  test('classifies multi-part CSS path as css', () => {
    assert.strictEqual(classifyTarget('button:nth-of-type(2)'), 'css');
    assert.strictEqual(classifyTarget('form > button'), 'css');
  });

  test('classifies plain text (including Korean) as text', () => {
    assert.strictEqual(classifyTarget('로그인'), 'text');
    assert.strictEqual(classifyTarget('More information...'), 'text');
    assert.strictEqual(classifyTarget('Sign in'), 'text');
  });

  test('returns "null" for nullish or empty target', () => {
    assert.strictEqual(classifyTarget(null), 'null');
    assert.strictEqual(classifyTarget(undefined), 'null');
    assert.strictEqual(classifyTarget(''), 'null');
  });
});

test.describe('extractAriaLabel', () => {
  test('returns the inner label from [aria="..."]', () => {
    assert.strictEqual(extractAriaLabel('[aria="검색"]'), '검색');
    assert.strictEqual(extractAriaLabel('[aria="Open menu"]'), 'Open menu');
  });

  test('returns null for non-aria targets', () => {
    assert.strictEqual(extractAriaLabel('[name="email"]'), null);
    assert.strictEqual(extractAriaLabel('#login'), null);
    assert.strictEqual(extractAriaLabel('로그인'), null);
  });
});

test.describe('pickTextScope', () => {
  test('returns link scope for role=link', () => {
    const scope = pickTextScope('link');
    assert.match(scope, /\ba\b/);
    assert.match(scope, /\[role=link\]/);
  });

  test('returns textbox scope for role=textbox', () => {
    const scope = pickTextScope('textbox');
    assert.match(scope, /\binput\b/);
    assert.match(scope, /\btextarea\b/);
  });

  test('returns checkbox scope for role=checkbox', () => {
    const scope = pickTextScope('checkbox');
    assert.match(scope, /\[type=checkbox\]/);
  });

  test('returns a generic clickable scope when role is empty or unknown', () => {
    const scope = pickTextScope('');
    assert.match(scope, /\bbutton\b/);
    assert.match(scope, /\ba\b/);
  });
});

test.describe('findElementJs', () => {
  test('aria target produces an aria-label finder expression', () => {
    const js = findElementJs('[aria="검색"]', {});
    assert.match(js, /aria-label/);
    assert.ok(js.includes('"검색"'));
  });

  test('[name="..."] target uses document.querySelector with the same selector', () => {
    const js = findElementJs('[name="email"]', {});
    assert.match(js, /document\.querySelector/);
    assert.ok(js.includes('[name=\\"email\\"]') || js.includes('[name="email"]'));
  });

  test('#id target uses document.querySelector', () => {
    const js = findElementJs('#login-btn', {});
    assert.match(js, /document\.querySelector/);
    assert.ok(js.includes('#login-btn'));
  });

  test('plain text target with role=link uses link scope text search', () => {
    const js = findElementJs('More information', { role: 'link' });
    assert.match(js, /textContent/);
    assert.match(js, /\[role=link\]/);
    assert.ok(js.includes('"More information"'));
  });

  test('plain text target with no role uses generic clickable scope', () => {
    const js = findElementJs('로그인', {});
    assert.match(js, /textContent/);
    assert.match(js, /button/);
  });

  test('returned expression is a non-empty string', () => {
    const js = findElementJs('로그인', { role: 'button' });
    assert.strictEqual(typeof js, 'string');
    assert.ok(js.length > 0);
  });
});
