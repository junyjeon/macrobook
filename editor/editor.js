/* eslint-disable no-undef */
/**
 * editor.js — Wires the foldable event list GUI to chrome.storage and
 * the pure state/history modules. DOM-bound; pure logic lives in
 * state.js and history.js.
 */
(function () {
  const S = window.MacrobookState;
  const H = window.MacrobookHistory;

  // --- module state ---------------------------------------------------------

  let history = H.createHistory([]);
  let focusedId = null;
  const expanded = new Set();
  let saveTimer = null;
  let dragId = null;
  let savingOurOwn = false;

  // --- DOM refs -------------------------------------------------------------

  const $rows = document.getElementById('rows');
  const $count = document.getElementById('count');
  const $empty = document.getElementById('empty');
  const $undo = document.getElementById('undo');
  const $redo = document.getElementById('redo');
  const $hint = document.getElementById('hint');
  const $addMenu = document.getElementById('add-menu');

  // --- state access --------------------------------------------------------

  function getState() {
    return history.current();
  }

  function setState(next) {
    history.push(next);
    render();
    saveDebounced();
  }

  function saveDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      savingOurOwn = true;
      chrome.storage.local.set({ events: S.renumber(getState()) }, () => {
        savingOurOwn = false;
      });
    }, 200);
  }

  // --- helpers --------------------------------------------------------------

  function el(tag, attrs = {}) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') node.className = v;
      else if (k === 'textContent') node.textContent = v;
      else if (k === 'value') node.value = v;
      else node.setAttribute(k, v);
    }
    return node;
  }

  function actionBtn(text, title, onClick, cls = '') {
    const b = el('button', { textContent: text, title });
    if (cls) b.className = cls;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function flash(text) {
    $hint.textContent = text;
    $hint.classList.add('visible');
    clearTimeout(flash._t);
    flash._t = setTimeout(() => $hint.classList.remove('visible'), 1200);
  }

  // --- summary for the header line -----------------------------------------

  function summaryOf(ev) {
    if (ev.type === 'navigate') return ev.url || '';
    if (ev.type === 'wait') return `${ev.duration_ms || 0} ms`;
    if (ev.type === 'memo') return ev.note || '(메모 비어있음)';

    const sel = ev.selector || {};
    if (ev.type === 'input') {
      const v = ev.sensitive ? '[REDACTED]' : (ev.value == null ? '' : ev.value);
      const target =
        sel.name ? `[name="${sel.name}"]` :
        sel.id   ? `#${sel.id}` :
        sel.text ? `"${sel.text}"` :
                   '?';
      return `${JSON.stringify(String(v))} → ${target}`;
    }
    return sel.text || sel.aria || sel.id || (sel.name ? `[name="${sel.name}"]` : '') || sel.css || '';
  }

  // --- rendering ------------------------------------------------------------

  function render() {
    const events = getState();
    $count.textContent = events.length;
    $empty.style.display = events.length === 0 ? 'block' : 'none';

    $rows.innerHTML = '';
    for (const ev of events) {
      $rows.appendChild(renderRow(ev));
    }

    $undo.disabled = !history.canUndo();
    $redo.disabled = !history.canRedo();
  }

  function renderRow(ev) {
    const row = el('div', { className: 'row' });
    row.dataset.id = ev.id;
    if (ev.disabled) row.classList.add('disabled');
    if (expanded.has(ev.id)) row.classList.add('expanded');
    if (ev.id === focusedId) row.classList.add('focused');

    const handle = el('div', { className: 'handle', textContent: '⋮⋮', draggable: 'true' });
    handle.addEventListener('dragstart', (e) => onDragStart(e, ev.id));
    handle.addEventListener('dragend', onDragEnd);
    row.appendChild(handle);

    row.appendChild(el('div', { className: 'seq', textContent: String(ev.seq || 0).padStart(3, '0') }));

    const type = el('div', { className: 'type', textContent: ev.type });
    type.dataset.type = ev.type;
    row.appendChild(type);

    const summary = el('div', { className: 'summary', textContent: summaryOf(ev) });
    summary.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      startSummaryEdit(ev.id, summary);
    });
    row.appendChild(summary);

    const actions = el('div', { className: 'actions' });

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !ev.disabled;
    chk.title = '활성/비활성 (Space)';
    chk.addEventListener('change', () => toggleDisabled(ev.id));
    chk.addEventListener('click', (e) => e.stopPropagation());
    actions.appendChild(chk);

    actions.appendChild(actionBtn('▾', '펼치기 (e)', () => toggleExpand(ev.id)));
    actions.appendChild(actionBtn('⎘', '복제 (d)', () => doDuplicate(ev.id)));
    actions.appendChild(actionBtn('×', '삭제 (x)', () => doDelete(ev.id), 'delete'));
    row.appendChild(actions);

    if (expanded.has(ev.id)) {
      row.appendChild(renderBody(ev));
    }

    row.addEventListener('dragover', (e) => onDragOver(e, ev.id));
    row.addEventListener('dragleave', onDragLeave);
    row.addEventListener('drop', (e) => onDrop(e, ev.id));
    row.addEventListener('click', (e) => {
      if (e.target.matches('input, textarea, button')) return;
      focusedId = ev.id;
      render();
    });

    return row;
  }

  function renderBody(ev) {
    const body = el('div', { className: 'body' });
    const grid = el('div', { className: 'body-grid' });

    const addField = (label, key, value, kind = 'input') => {
      grid.appendChild(el('label', { textContent: label }));
      const input = document.createElement(kind === 'textarea' ? 'textarea' : 'input');
      input.value = value == null ? '' : String(value);
      input.addEventListener('blur', () => updateField(ev.id, key, input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && kind !== 'textarea') input.blur();
        if (e.key === 'Escape') {
          input.value = value == null ? '' : String(value);
          input.blur();
        }
      });
      input.addEventListener('click', (e) => e.stopPropagation());
      grid.appendChild(input);
    };

    if (ev.type === 'navigate') {
      addField('url', 'url', ev.url);
    } else if (ev.type === 'wait') {
      addField('duration_ms', 'duration_ms', ev.duration_ms);
    } else if (ev.type === 'memo') {
      addField('note', 'note', ev.note, 'textarea');
    } else {
      const sel = ev.selector || {};
      addField('text', 'selector.text', sel.text);
      addField('aria', 'selector.aria', sel.aria);
      addField('id', 'selector.id', sel.id);
      addField('name', 'selector.name', sel.name);
      addField('css', 'selector.css', sel.css);
      addField('tag', 'selector.tag', sel.tag);
      addField('role', 'selector.role', sel.role);
      if (ev.type === 'input') {
        addField('value', 'value', ev.sensitive ? '[REDACTED]' : ev.value);
        addField('input_type', 'inputType', ev.inputType);
      }
      addField('url', 'url', ev.url);
    }

    body.appendChild(grid);
    return body;
  }

  // --- action handlers ------------------------------------------------------

  function toggleExpand(id) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    render();
  }

  function toggleDisabled(id) {
    const events = getState();
    const ev = events.find((e) => e.id === id);
    if (!ev) return;
    setState(S.update(events, id, { disabled: !ev.disabled }));
  }

  function doDuplicate(id) {
    setState(S.duplicate(getState(), id));
    flash('복제됨');
  }

  function doDelete(id) {
    setState(S.remove(getState(), id));
    if (focusedId === id) focusedId = null;
    expanded.delete(id);
    flash('삭제됨 · ⌘Z 되돌리기');
  }

  function updateField(id, key, value) {
    const events = getState();
    const ev = events.find((e) => e.id === id);
    if (!ev) return;

    let patch;
    if (key.startsWith('selector.')) {
      const k = key.slice('selector.'.length);
      const next = { ...(ev.selector || {}) };
      if (value === '' || value == null) delete next[k];
      else next[k] = value;
      patch = { selector: next };
    } else if (key === 'duration_ms') {
      patch = { duration_ms: parseInt(value, 10) || 0 };
    } else {
      patch = { [key]: value };
    }
    setState(S.update(events, id, patch));
  }

  function startSummaryEdit(id, summaryEl) {
    const events = getState();
    const ev = events.find((e) => e.id === id);
    if (!ev) return;
    const current = summaryOf(ev);

    const input = document.createElement('input');
    input.value = current;
    summaryEl.textContent = '';
    summaryEl.appendChild(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = (cancel) => {
      if (committed) return;
      committed = true;
      if (cancel || input.value === current) {
        render();
        return;
      }
      const patch = summaryToPatch(ev, input.value);
      setState(S.update(events, id, patch));
    };
    input.addEventListener('blur', () => commit(false));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') commit(true);
    });
  }

  function summaryToPatch(ev, newSummary) {
    if (ev.type === 'navigate') return { url: newSummary };
    if (ev.type === 'memo') return { note: newSummary };
    if (ev.type === 'wait') return { duration_ms: parseInt(newSummary, 10) || 0 };
    return { selector: { ...(ev.selector || {}), text: newSummary } };
  }

  // --- drag and drop --------------------------------------------------------

  function onDragStart(e, id) {
    dragId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    const row = document.querySelector(`.row[data-id="${id}"]`);
    if (row) row.classList.add('dragging');
  }

  function onDragOver(e, id) {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    const row = e.currentTarget;
    const rect = row.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    row.classList.toggle('drop-target-before', before);
    row.classList.toggle('drop-target-after', !before);
    e.dataTransfer.dropEffect = 'move';
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove('drop-target-before', 'drop-target-after');
  }

  function onDrop(e, id) {
    e.preventDefault();
    const row = e.currentTarget;
    const before = row.classList.contains('drop-target-before');
    row.classList.remove('drop-target-before', 'drop-target-after');
    if (!dragId || dragId === id) return;
    setState(S.reorder(getState(), dragId, id, before ? 'before' : 'after'));
  }

  function onDragEnd() {
    document.querySelectorAll('.row.dragging').forEach((r) => r.classList.remove('dragging'));
    document.querySelectorAll('.drop-target-before, .drop-target-after').forEach((r) => {
      r.classList.remove('drop-target-before', 'drop-target-after');
    });
    dragId = null;
  }

  // --- keyboard navigation --------------------------------------------------

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    const mod = e.metaKey || e.ctrlKey;

    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); doRedo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }

    const events = getState();
    if (events.length === 0) return;
    const idx = focusedId ? events.findIndex((ev) => ev.id === focusedId) : -1;

    if (mod && e.key === 'ArrowDown' && idx >= 0 && idx < events.length - 1) {
      e.preventDefault();
      setState(S.reorder(events, focusedId, events[idx + 1].id, 'after'));
      return;
    }
    if (mod && e.key === 'ArrowUp' && idx > 0) {
      e.preventDefault();
      setState(S.reorder(events, focusedId, events[idx - 1].id, 'before'));
      return;
    }

    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = idx < 0 ? 0 : Math.min(idx + 1, events.length - 1);
      focusedId = events[next].id;
      render();
      scrollIntoView(focusedId);
      return;
    }
    if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = idx < 0 ? events.length - 1 : Math.max(idx - 1, 0);
      focusedId = events[prev].id;
      render();
      scrollIntoView(focusedId);
      return;
    }
    if (!focusedId) return;
    if (e.key === 'e') { e.preventDefault(); toggleExpand(focusedId); return; }
    if (e.key === 'x') { e.preventDefault(); doDelete(focusedId); return; }
    if (e.key === 'd') { e.preventDefault(); doDuplicate(focusedId); return; }
    if (e.key === ' ') { e.preventDefault(); toggleDisabled(focusedId); return; }
  });

  function scrollIntoView(id) {
    const row = document.querySelector(`.row[data-id="${id}"]`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // --- undo / redo ----------------------------------------------------------

  function doUndo() {
    if (history.undo()) { render(); saveDebounced(); flash('Undo'); }
  }
  function doRedo() {
    if (history.redo()) { render(); saveDebounced(); flash('Redo'); }
  }
  $undo.addEventListener('click', doUndo);
  $redo.addEventListener('click', doRedo);

  // --- add menu -------------------------------------------------------------

  document.getElementById('add-trigger').addEventListener('click', (e) => {
    e.stopPropagation();
    $addMenu.classList.toggle('open');
  });
  document.addEventListener('click', () => $addMenu.classList.remove('open'));
  $addMenu.querySelectorAll('[data-template]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = S.templates()[btn.dataset.template];
      const newEv = { id: S.genId(), ...t, disabled: false };
      const events = getState();
      const afterId = focusedId || (events.length ? events[events.length - 1].id : null);
      setState(S.insert(events, afterId, newEv));
      focusedId = newEv.id;
      expanded.add(newEv.id);
      $addMenu.classList.remove('open');
      render();
      flash('추가됨');
    });
  });

  // --- copy / export (mirrors popup.js .txt format) ------------------------

  function escapeStr(v) { return JSON.stringify(v == null ? '' : String(v)); }

  function strongestTarget(sel) {
    if (!sel) return null;
    if (sel.text) return sel.text;
    if (sel.aria) return `[aria="${sel.aria}"]`;
    if (sel.id)   return `#${sel.id}`;
    if (sel.name) return `[name="${sel.name}"]`;
    if (sel.css)  return sel.css;
    return null;
  }

  function pickSummary(ev) {
    if (ev.type === 'navigate') return ev.url || null;
    if (ev.type === 'wait') return `${ev.duration_ms || 0}ms`;
    if (ev.type === 'memo') return ev.note || null;
    const sel = ev.selector;
    if (ev.type === 'input') {
      const v = ev.sensitive ? '[REDACTED]' : (ev.value === undefined ? '' : escapeStr(ev.value));
      const t = sel?.name ? `[name="${sel.name}"]`
              : sel?.id   ? `#${sel.id}`
              : sel?.text ? `"${sel.text}"`
              : '?';
      return `${v} → ${t}`;
    }
    if (!sel) return null;
    return sel.text || sel.aria || sel.labelText
        || (sel.id ? `#${sel.id}` : sel.name ? `[name="${sel.name}"]` : null);
  }

  function bodyLine(key, value) {
    if (value == null || value === '') return null;
    if (typeof value === 'boolean' || typeof value === 'number') return `    ${key}: ${value}`;
    return `    ${key}: ${escapeStr(value)}`;
  }

  function formatEvent(ev, index) {
    const seq = String(index + 1).padStart(3, '0');
    const summary = pickSummary(ev);
    const head = summary == null ? `[${seq}] ${ev.type}`
               : (ev.type === 'navigate' || ev.type === 'input' || ev.type === 'wait')
                 ? `[${seq}] ${ev.type} ${summary}`
                 : `[${seq}] ${ev.type} ${escapeStr(summary)}`;
    const lines = [head];
    if (ev.disabled) lines.push('    disabled: true');

    if (ev.type === 'navigate') {
      lines.push(bodyLine('url', ev.url));
      if (ev.from) lines.push(bodyLine('from', ev.from));
    } else if (ev.type === 'wait') {
      lines.push(bodyLine('duration_ms', ev.duration_ms));
    } else if (ev.type === 'memo') {
      lines.push(bodyLine('note', ev.note));
    } else {
      const target = strongestTarget(ev.selector);
      if (target) lines.push(bodyLine('target', target));
      const sel = ev.selector || {};
      if (sel.text)      lines.push(bodyLine('text', sel.text));
      if (sel.aria)      lines.push(bodyLine('aria', sel.aria));
      if (sel.id)        lines.push(bodyLine('id', sel.id));
      if (sel.name)      lines.push(bodyLine('name', sel.name));
      if (sel.tag)       lines.push(bodyLine('tag', sel.tag));
      if (sel.role)      lines.push(bodyLine('role', sel.role));
      if (sel.type)      lines.push(bodyLine('type', sel.type));
      if (sel.labelText) lines.push(bodyLine('label', sel.labelText));
      if (sel.css) {
        lines.push(bodyLine('css', sel.css));
        lines.push('    target_confidence: low');
      }
      if ('value' in ev) {
        if (ev.sensitive) {
          lines.push(bodyLine('value', '[REDACTED]'));
          lines.push('    sensitive: true');
        } else {
          lines.push(bodyLine('value', ev.value));
        }
      }
      if (ev.inputType) lines.push(bodyLine('input_type', ev.inputType));
      lines.push(bodyLine('url', ev.url));
    }
    return lines.filter(Boolean).join('\n');
  }

  function buildExportText(events) {
    const header = [
      '# Macro recorder export',
      `# Recorded: ${new Date().toISOString()}`,
      `# Events: ${events.length}`,
      '# Format: each event is `[NNN] type "summary"` + indented `key: "JSON-escaped"` body.',
      ''
    ].join('\n');
    return header + events.map(formatEvent).join('\n\n') + '\n';
  }

  document.getElementById('copy').addEventListener('click', async () => {
    const text = buildExportText(S.renumber(getState()));
    try {
      await navigator.clipboard.writeText(text);
      flash('📋 복사됨');
    } catch {
      flash('복사 실패');
    }
  });
  document.getElementById('export').addEventListener('click', () => {
    const text = buildExportText(S.renumber(getState()));
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url,
      filename: `macro-${Date.now()}.txt`,
      saveAs: true
    }, () => setTimeout(() => URL.revokeObjectURL(url), 5000));
  });

  // --- external sync (e.g., new recording while editor is open) ------------

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.events) return;
    if (savingOurOwn) return;
    const incoming = S.hydrate(changes.events.newValue || []);
    history = H.createHistory(incoming);
    render();
  });

  // --- bootstrap ------------------------------------------------------------

  chrome.storage.local.get(['events'], (result) => {
    const events = S.hydrate(result.events || []);
    history = H.createHistory(events);
    render();
  });
})();
