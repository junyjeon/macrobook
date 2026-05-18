const test = require('node:test');
const assert = require('node:assert');
const {
  buildClickExpr,
  buildInputExpr,
  buildSubmitExpr,
  buildNavigateArgs,
  resolveSecret
} = require('../runners/actionbook');

test.describe('buildClickExpr', () => {
  test('emits a self-invoking expression that calls .click()', () => {
    const expr = buildClickExpr({ type: 'click', fields: { target: '#login-btn' } });
    assert.match(expr, /el\.click\(\)/);
    assert.match(expr, /document\.querySelector/);
    assert.ok(expr.includes('#login-btn'));
  });

  test('scrolls the element into view before clicking', () => {
    const expr = buildClickExpr({ type: 'click', fields: { target: '#x' } });
    assert.match(expr, /scrollIntoView/);
  });

  test('returns an error marker (not throw) when element is missing in-page', () => {
    const expr = buildClickExpr({ type: 'click', fields: { target: '#missing' } });
    assert.match(expr, /ERR:/);
  });
});

test.describe('buildInputExpr', () => {
  test('for plain text input, assigns value and dispatches input + change events', () => {
    const step = { seq: 1, type: 'input', fields: { target: '[name="email"]', value: 'a@b.c', input_type: 'email' } };
    const expr = buildInputExpr(step, 'a@b.c');
    assert.match(expr, /el\.value\s*=/);
    assert.match(expr, /dispatchEvent\(new Event\('input'/);
    assert.match(expr, /dispatchEvent\(new Event\('change'/);
    assert.ok(expr.includes('"a@b.c"'));
  });

  test('for checkbox, toggles only when the desired state differs from current', () => {
    const step = { seq: 2, type: 'input', fields: { target: '#agree', value: true, input_type: 'checkbox' } };
    const expr = buildInputExpr(step, true);
    assert.match(expr, /el\.checked\s*!==\s*true/);
    assert.match(expr, /el\.click\(\)/);
  });

  test('for radio, behaves like checkbox', () => {
    const step = { seq: 3, type: 'input', fields: { target: '[name="size"]', value: true, input_type: 'radio' } };
    const expr = buildInputExpr(step, true);
    assert.match(expr, /el\.checked\s*!==\s*true/);
  });

  test('JSON-stringifies the value so quotes and unicode in user input are safe', () => {
    const step = { seq: 4, type: 'input', fields: { target: '[name="x"]', value: 'say "hi" 한글', input_type: 'text' } };
    const expr = buildInputExpr(step, 'say "hi" 한글');
    assert.ok(expr.includes('"say \\"hi\\" 한글"'));
  });
});

test.describe('buildSubmitExpr', () => {
  test('walks up to the closest form and calls requestSubmit when available', () => {
    const expr = buildSubmitExpr({ fields: { target: '#login-form' } });
    assert.match(expr, /closest\('form'\)/);
    assert.match(expr, /requestSubmit/);
  });

  test('falls back to form.submit() then to el.click() if no form', () => {
    const expr = buildSubmitExpr({ fields: { target: '#submit-btn' } });
    assert.match(expr, /form\.submit\(\)/);
    assert.match(expr, /el\.click\(\)/);
  });
});

test.describe('buildNavigateArgs', () => {
  test('returns argv suitable for `actionbook browser goto <url>`', () => {
    const args = buildNavigateArgs({ fields: { url: 'https://example.com/path?q=1' } });
    assert.deepStrictEqual(args, ['browser', 'goto', 'https://example.com/path?q=1']);
  });
});

test.describe('resolveSecret', () => {
  test('returns the env value when MACRO_SECRET_<seq> is set', () => {
    const v = resolveSecret(7, { env: { MACRO_SECRET_7: 'hunter2' } });
    assert.strictEqual(v, 'hunter2');
  });

  test('throws a descriptive error when the env var is missing', () => {
    assert.throws(
      () => resolveSecret(7, { env: {} }),
      /MACRO_SECRET_7/
    );
  });

  test('falls back to process.env when no env map is provided', () => {
    try {
      process.env.MACRO_SECRET_99 = 'from-process-env-99';
      assert.strictEqual(resolveSecret(99), 'from-process-env-99');
    } finally {
      delete process.env.MACRO_SECRET_99;
    }
  });
});
