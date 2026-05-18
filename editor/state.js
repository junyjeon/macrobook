/**
 * state.js — Pure transformations over the editor's event array.
 * All functions return new arrays/objects; never mutate inputs.
 *
 * Event shape:
 *   { id, seq, type, selector?, value?, url?, duration_ms?, note?, disabled?, ... }
 */

function genId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'e_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function hydrate(events) {
  if (!Array.isArray(events)) return [];
  return events.map((e) => ({
    ...e,
    id: e && e.id ? e.id : genId(),
    disabled: !!(e && e.disabled)
  }));
}

function indexOfId(events, id) {
  return events.findIndex((e) => e.id === id);
}

function reorder(events, fromId, toId, position = 'before') {
  if (fromId === toId) return events.slice();
  const fromIdx = indexOfId(events, fromId);
  if (fromIdx < 0) return events.slice();
  const moved = events[fromIdx];
  const without = events.slice(0, fromIdx).concat(events.slice(fromIdx + 1));
  const toIdx = indexOfId(without, toId);
  if (toIdx < 0) return events.slice();
  const insertAt = position === 'after' ? toIdx + 1 : toIdx;
  return without.slice(0, insertAt).concat([moved], without.slice(insertAt));
}

function insert(events, afterId, newEvent) {
  const out = events.slice();
  if (afterId == null) {
    out.push(newEvent);
    return out;
  }
  if (afterId === '') {
    out.unshift(newEvent);
    return out;
  }
  const idx = indexOfId(out, afterId);
  if (idx < 0) {
    out.push(newEvent);
    return out;
  }
  out.splice(idx + 1, 0, newEvent);
  return out;
}

function remove(events, id) {
  return events.filter((e) => e.id !== id);
}

function update(events, id, patch) {
  return events.map((e) => (e.id === id ? { ...e, ...patch } : e));
}

function duplicate(events, id) {
  const idx = indexOfId(events, id);
  if (idx < 0) return events.slice();
  const source = events[idx];
  const copy = { ...source, id: genId() };
  return events.slice(0, idx + 1).concat([copy], events.slice(idx + 1));
}

function renumber(events) {
  return events.map((e, i) => ({ ...e, seq: i + 1 }));
}

function templates() {
  return {
    wait: { type: 'wait', duration_ms: 1000 },
    memo: { type: 'memo', note: '' },
    click: { type: 'click', selector: { text: '' }, url: '' }
  };
}

const api = {
  genId,
  hydrate,
  reorder,
  insert,
  remove,
  update,
  duplicate,
  renumber,
  templates,
  indexOfId
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.MacrobookState = api;
}
