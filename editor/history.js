/**
 * history.js — Undo/redo stack for snapshot states.
 *
 * createHistory(initial, { capacity }) returns an object with
 *   current()         → latest state (reference, until next push)
 *   push(state)       → record state; drops oldest if over capacity
 *   undo() | redo()   → walk past/future; returns true on success
 *   canUndo|canRedo() → booleans for UI affordance
 *
 * Snapshots are stored by reference. Callers should treat them as
 * immutable (mutate by replacing, not in place).
 */

function shallowEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

function createHistory(initial, { capacity = 50 } = {}) {
  const past = [];
  let cur = initial;
  const future = [];

  return {
    current() {
      return cur;
    },
    push(next) {
      if (shallowEqual(next, cur)) return;
      past.push(cur);
      if (past.length > capacity) past.shift();
      cur = next;
      future.length = 0;
    },
    undo() {
      if (past.length === 0) return false;
      future.unshift(cur);
      cur = past.pop();
      return true;
    },
    redo() {
      if (future.length === 0) return false;
      past.push(cur);
      cur = future.shift();
      return true;
    },
    canUndo() {
      return past.length > 0;
    },
    canRedo() {
      return future.length > 0;
    }
  };
}

const api = { createHistory };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.MacrobookHistory = api;
}
