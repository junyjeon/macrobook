/**
 * selector.js — Translate a recorded target into a JS expression that
 * resolves to the DOM element inside the browser.
 *
 * Target shapes (produced by popup.js targetToken):
 *   [aria="..."]    not a real CSS selector — our notation for aria-label
 *   [name="..."]    real CSS attribute selector
 *   [other="..."]   real CSS attribute selector
 *   #id             real CSS selector
 *   .class          real CSS selector
 *   tag:pseudo …    real CSS path
 *   plain text      visible text content match (last-resort fallback)
 */

const ARIA_RE = /^\[aria="(.+)"\]$/;

/**
 * Classify a target string.
 *
 * @param {unknown} target
 * @returns {'aria' | 'css' | 'text' | 'null'}
 */
function classifyTarget(target) {
  if (target == null || target === '') return 'null';
  const s = String(target);
  if (ARIA_RE.test(s)) return 'aria';
  if (s.startsWith('#')) return 'css';
  if (s.startsWith('[')) return 'css';
  if (/^\.\w/.test(s)) return 'css';
  if (/>/.test(s)) return 'css';
  if (/:nth-/.test(s)) return 'css';
  if (/^\w+:[\w-]/.test(s)) return 'css';
  return 'text';
}

/**
 * @param {unknown} target
 * @returns {string | null}
 */
function extractAriaLabel(target) {
  if (target == null) return null;
  const m = String(target).match(ARIA_RE);
  return m ? m[1] : null;
}

const TEXT_SCOPES = {
  link:     'a, [role=link]',
  textbox:  'input, textarea, [role=textbox]',
  checkbox: 'input[type=checkbox], [role=checkbox]',
  radio:    'input[type=radio], [role=radio]',
  button:   'button, [role=button]',
  default:  'button, a, input[type=submit], input[type=button], [role=button], [role=link], [onclick]'
};

/**
 * @param {string} role
 * @returns {string}
 */
function pickTextScope(role) {
  return TEXT_SCOPES[role] || TEXT_SCOPES.default;
}

/**
 * Build a JS expression that evaluates to the target Element|null inside
 * the browser. Suitable for `actionbook browser eval` or `page.evaluate`.
 *
 * @param {string} target
 * @param {{ role?: string }} fields
 * @returns {string}
 */
function findElementJs(target, fields = {}) {
  const kind = classifyTarget(target);

  if (kind === 'aria') {
    const label = extractAriaLabel(target);
    return `[...document.querySelectorAll('*')]`
      + `.find(e => (e.getAttribute('aria-label') || '').trim() === ${JSON.stringify(label)})`;
  }

  if (kind === 'css') {
    return `document.querySelector(${JSON.stringify(target)})`;
  }

  if (kind === 'text') {
    const scope = pickTextScope(fields.role || '');
    return `[...document.querySelectorAll(${JSON.stringify(scope)})]`
      + `.find(e => (e.textContent || '').replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(target)}))`;
  }

  return 'null';
}

module.exports = {
  classifyTarget,
  extractAriaLabel,
  pickTextScope,
  findElementJs,
  TEXT_SCOPES
};
