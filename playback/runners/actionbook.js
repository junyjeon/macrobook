/**
 * runners/actionbook.js — Translate parsed events into `actionbook` CLI
 * calls. The pure expression-builders below are unit-tested; the
 * spawnSync glue is exercised via the integration entry point in
 * playback.js.
 */

const { spawnSync } = require('child_process');
const { findElementJs } = require('../selector');

// --- pure builders ----------------------------------------------------------

/**
 * Wrap a body of statements into a self-invoking expression so the whole
 * thing returns a string from `actionbook browser eval`. Inner ERR
 * markers propagate back to the runner without throwing in the page.
 */
function wrapExpr(body) {
  return `(() => { try { ${body} } catch (e) { return 'ERR: ' + e.message; } })()`;
}

/**
 * @param {{ fields: { target: string, role?: string } }} step
 * @returns {string}
 */
function buildClickExpr(step) {
  const finder = findElementJs(step.fields.target, step.fields);
  return wrapExpr(
    `const el = ${finder};`
    + ` if (!el) return 'ERR: element not found';`
    + ` el.scrollIntoView({ block: 'center', behavior: 'instant' });`
    + ` el.click();`
    + ` return 'clicked';`
  );
}

/**
 * @param {{ fields: { target: string, role?: string, input_type?: string, value?: any } }} step
 * @param {string | boolean} resolvedValue
 * @returns {string}
 */
function buildInputExpr(step, resolvedValue) {
  const finder = findElementJs(step.fields.target, step.fields);
  const inputType = (step.fields.input_type || '').toLowerCase();

  if (inputType === 'checkbox' || inputType === 'radio') {
    const desired =
      step.fields.value === true ||
      step.fields.value === 'true' ||
      step.fields.value === '1';
    return wrapExpr(
      `const el = ${finder};`
      + ` if (!el) return 'ERR: element not found';`
      + ` if (el.checked !== ${desired}) el.click();`
      + ` return 'set ' + el.checked;`
    );
  }

  const raw = String(resolvedValue ?? '');
  return wrapExpr(
    `const el = ${finder};`
    + ` if (!el) return 'ERR: element not found';`
    + ` el.focus();`
    + ` el.value = ${JSON.stringify(raw)};`
    + ` el.dispatchEvent(new Event('input', { bubbles: true }));`
    + ` el.dispatchEvent(new Event('change', { bubbles: true }));`
    + ` return 'filled';`
  );
}

/**
 * @param {{ fields: { target: string, role?: string } }} step
 * @returns {string}
 */
function buildSubmitExpr(step) {
  const finder = findElementJs(step.fields.target, step.fields);
  return wrapExpr(
    `const el = ${finder};`
    + ` if (!el) return 'ERR: form not found';`
    + ` const form = el.tagName === 'FORM' ? el : el.closest('form');`
    + ` if (form && typeof form.requestSubmit === 'function') form.requestSubmit();`
    + ` else if (form) form.submit();`
    + ` else el.click();`
    + ` return 'submitted';`
  );
}

/**
 * @param {{ fields: { url: string } }} step
 * @returns {string[]}
 */
function buildNavigateArgs(step) {
  return ['browser', 'goto', step.fields.url];
}

/**
 * @param {number} seq
 * @param {{ env?: Record<string, string | undefined> }} [opts]
 * @returns {string}
 */
function resolveSecret(seq, opts = {}) {
  const env = opts.env || process.env;
  const key = `MACRO_SECRET_${seq}`;
  const v = env[key];
  if (!v) {
    throw new Error(`step ${seq} has value="[REDACTED]" — provide via env ${key}=<value>`);
  }
  return v;
}

// --- spawn glue -------------------------------------------------------------

function ab(args, { verbose = true } = {}) {
  if (verbose) console.log('  $ actionbook', args.join(' '));
  const r = spawnSync('actionbook', args, { encoding: 'utf8', timeout: 30_000 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(
      `actionbook ${args[0]} ${args[1] || ''} → exit ${r.status}: ${(r.stderr || r.stdout || '').trim()}`
    );
  }
  const out = r.stdout.trim();
  if (out.includes('ERR:')) {
    throw new Error(out.replace(/^.*ERR:\s*/, '').replace(/['"]+$/, ''));
  }
  return out;
}

function openSession(navStep, opts) {
  ab(['browser', 'open', navStep.fields.url], opts);
}

/**
 * @param {{ seq: number, type: string, fields: object }} step
 * @param {{ env?: object, verbose?: boolean }} [opts]
 */
function runStep(step, opts = {}) {
  switch (step.type) {
    case 'navigate':
      ab(buildNavigateArgs(step), opts);
      return;
    case 'click':
      ab(['browser', 'eval', buildClickExpr(step)], opts);
      return;
    case 'input': {
      const value = step.fields.value === '[REDACTED]'
        ? resolveSecret(step.seq, opts)
        : step.fields.value;
      ab(['browser', 'eval', buildInputExpr(step, value)], opts);
      return;
    }
    case 'submit':
      ab(['browser', 'eval', buildSubmitExpr(step)], opts);
      return;
    default:
      console.warn(`  ! unknown event type "${step.type}", skipping`);
  }
}

module.exports = {
  buildClickExpr,
  buildInputExpr,
  buildSubmitExpr,
  buildNavigateArgs,
  resolveSecret,
  ab,
  openSession,
  runStep
};
