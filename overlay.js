/**
 * overlay.js — Floating widget injected into every recorded page.
 *
 * Why: the popup only appears when clicked, so the user can't see what's
 * being captured live and has to round-trip through the extension icon to
 * start/stop or copy. This overlay keeps a small panel on the page itself
 * with a live event list, per-row delete, and copy/start/stop controls —
 * matching the workflow "see what would be copied → trim noise → copy".
 *
 * Design notes:
 *   - Closed shadow DOM keeps page CSS out and our internal nodes hidden.
 *   - The host has data-macrobook="overlay" so content.js can skip events
 *     that originate inside the widget (we don't record our own clicks).
 *   - State is read from chrome.storage.local; the listener re-renders on
 *     any change so popup/editor/overlay all stay in sync automatically.
 */
(function () {
  if (window !== window.top) return;
  if (document.getElementById('macrobook-overlay-host')) return;

  // ---------------------------------------------------------------- state --

  let isRecording = false;
  let events = [];
  let collapsed = false;
  let position = { x: null, y: null };

  // -------------------------------------------------------------- DOM host --

  const host = document.createElement('div');
  host.id = 'macrobook-overlay-host';
  host.setAttribute('data-macrobook', 'overlay');
  host.style.cssText = [
    'position: fixed',
    'top: 16px',
    'right: 16px',
    'z-index: 2147483647',
    'all: initial',
  ].join(';');
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  shadow.innerHTML = `
    <style>
      :host, * { box-sizing: border-box; }
      .widget {
        font-family: "Apple SD Gothic Neo", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        color: #111;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06);
        width: 320px;
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .widget.collapsed {
        width: auto;
        max-height: none;
      }
      .header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
        cursor: grab;
        user-select: none;
      }
      .header:active { cursor: grabbing; }
      .widget.collapsed .header {
        border-bottom: none;
        padding: 6px 10px;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #9ca3af;
        flex-shrink: 0;
      }
      .dot.recording {
        background: #ef4444;
        animation: pulse 1.2s infinite;
      }
      @keyframes pulse { 50% { opacity: 0.3; } }
      .title {
        font-weight: 600;
        font-size: 12px;
        flex: 1;
        white-space: nowrap;
      }
      .title .count { color: #6b7280; font-weight: 500; margin-left: 4px; }
      .icon-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        color: #6b7280;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 13px;
        line-height: 1;
      }
      .icon-btn:hover { background: #f3f4f6; color: #111; }

      .actions {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px;
        padding: 6px 8px;
        border-bottom: 1px solid #f3f4f6;
      }
      .action {
        padding: 6px 4px;
        border: 1px solid #e5e7eb;
        background: #fff;
        border-radius: 5px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 500;
        color: #374151;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
      }
      .action:hover:not(:disabled) { background: #f9fafb; border-color: #d1d5db; }
      .action:disabled { opacity: 0.4; cursor: not-allowed; }
      .action.record { color: #ef4444; }
      .action.stop { color: #b91c1c; }
      .action.copy { color: #14b8a6; }
      .action.copy.copied { background: #ccfbf1; border-color: #14b8a6; color: #0f766e; }
      .action.edit { color: #3b82f6; }

      .events {
        flex: 1;
        overflow-y: auto;
        padding: 4px;
      }
      .empty {
        color: #9ca3af;
        text-align: center;
        padding: 20px 8px;
        font-size: 11px;
        line-height: 1.5;
      }
      .event {
        display: grid;
        grid-template-columns: 28px 56px 1fr 22px;
        gap: 6px;
        align-items: center;
        padding: 4px 6px;
        border-radius: 4px;
        font-size: 11px;
      }
      .event:hover { background: #f9fafb; }
      .event .seq {
        font-variant-numeric: tabular-nums;
        color: #9ca3af;
        font-size: 10px;
        text-align: right;
      }
      .event .type {
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        padding: 2px 4px;
        border-radius: 3px;
        color: white;
        text-align: center;
      }
      .event .type[data-type="navigate"] { background: #6b7280; }
      .event .type[data-type="click"]    { background: #ef4444; }
      .event .type[data-type="input"]    { background: #3b82f6; }
      .event .type[data-type="submit"]   { background: #f59e0b; }
      .event .type[data-type="wait"]     { background: #eab308; color: #422006; }
      .event .type[data-type="memo"]     { background: #8b5cf6; }
      .event .summary {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #1f2937;
      }
      .event .del {
        background: transparent;
        border: 1px solid transparent;
        color: #9ca3af;
        cursor: pointer;
        padding: 0;
        border-radius: 3px;
        font-size: 12px;
        line-height: 1;
        width: 20px;
        height: 20px;
      }
      .event .del:hover { color: #ef4444; border-color: #ef4444; background: #fef2f2; }

      .footer {
        font-size: 10px;
        color: #9ca3af;
        text-align: center;
        padding: 4px;
        border-top: 1px solid #f3f4f6;
      }

      .hint {
        position: absolute;
        bottom: 6px;
        right: 8px;
        background: #111;
        color: #fff;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 10px;
        opacity: 0;
        transition: opacity 0.2s;
        pointer-events: none;
      }
      .hint.visible { opacity: 0.9; }
    </style>

    <div class="widget" id="widget">
      <div class="header" id="header">
        <span class="dot" id="dot"></span>
        <span class="title">
          <span id="state-label">Macrobook</span>
          <span class="count" id="count">· 0</span>
        </span>
        <button class="icon-btn" id="collapse" title="접기/펴기">−</button>
      </div>

      <div class="actions" id="actions">
        <button class="action record" id="record" title="녹화 시작">⏺ 녹화</button>
        <button class="action stop" id="stop" title="녹화 정지" disabled>⏸ 정지</button>
        <button class="action copy" id="copy" title="클립보드 복사" disabled>📋 복사</button>
        <button class="action edit" id="edit" title="편집기 열기" style="grid-column: span 3">✏ 전체 편집기 열기</button>
      </div>

      <div class="events" id="events"></div>

      <div class="footer" id="footer">drag header to move · X for per-row delete</div>
      <div class="hint" id="hint"></div>
    </div>
  `;

  // --------------------------------------------------------------- refs ---

  const $widget = shadow.getElementById('widget');
  const $header = shadow.getElementById('header');
  const $dot = shadow.getElementById('dot');
  const $stateLabel = shadow.getElementById('state-label');
  const $count = shadow.getElementById('count');
  const $collapse = shadow.getElementById('collapse');
  const $actions = shadow.getElementById('actions');
  const $record = shadow.getElementById('record');
  const $stop = shadow.getElementById('stop');
  const $copy = shadow.getElementById('copy');
  const $edit = shadow.getElementById('edit');
  const $events = shadow.getElementById('events');
  const $footer = shadow.getElementById('footer');
  const $hint = shadow.getElementById('hint');

  // ------------------------------------------------------------ helpers ---

  function send(action, extra = {}) {
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime.sendMessage({ action, ...extra }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {
      // context invalidated (extension reloaded) — harmless
    }
  }

  function flash(text) {
    $hint.textContent = text;
    $hint.classList.add('visible');
    clearTimeout(flash._t);
    flash._t = setTimeout(() => $hint.classList.remove('visible'), 1100);
  }

  function escapeStr(v) { return JSON.stringify(v == null ? '' : String(v)); }

  function summaryOf(ev) {
    if (ev.type === 'navigate') return ev.url || '';
    if (ev.type === 'wait') return `${ev.duration_ms || 0} ms`;
    if (ev.type === 'memo') return ev.note || '(메모)';
    const sel = ev.selector || {};
    if (ev.type === 'input') {
      const v = ev.sensitive ? '[REDACTED]' : (ev.value == null ? '' : String(ev.value));
      const t = sel.name ? `[name="${sel.name}"]`
              : sel.id   ? `#${sel.id}`
              : sel.text ? `"${sel.text}"`
              : '?';
      return `${v.length > 30 ? v.slice(0, 30) + '…' : v} → ${t}`;
    }
    return sel.text || sel.aria || sel.labelText || (sel.id ? `#${sel.id}` : '')
        || (sel.name ? `[name="${sel.name}"]` : '') || sel.css || '';
  }

  // -------- .txt export (mirrors popup.js / editor.js format) ------------

  function strongestTarget(sel) {
    if (!sel) return null;
    if (sel.text) return sel.text;
    if (sel.aria) return `[aria="${sel.aria}"]`;
    if (sel.id)   return `#${sel.id}`;
    if (sel.name) return `[name="${sel.name}"]`;
    if (sel.css)  return sel.css;
    return null;
  }
  function pickSummaryForTxt(ev) {
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
    const sum = pickSummaryForTxt(ev);
    const head = sum == null ? `[${seq}] ${ev.type}`
               : (ev.type === 'navigate' || ev.type === 'input' || ev.type === 'wait')
                 ? `[${seq}] ${ev.type} ${sum}`
                 : `[${seq}] ${ev.type} ${escapeStr(sum)}`;
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
  function buildExportText(list) {
    const header = [
      '# Macro recorder export',
      `# Recorded: ${new Date().toISOString()}`,
      `# Events: ${list.length}`,
      '# Format: each event is `[NNN] type "summary"` + indented `key: "JSON-escaped"` body.',
      ''
    ].join('\n');
    return header + list.map(formatEvent).join('\n\n') + '\n';
  }

  // ---------------------------------------------------------- rendering --

  function render() {
    $dot.classList.toggle('recording', isRecording);
    $stateLabel.textContent = isRecording ? '녹화 중' : (events.length ? '대기' : 'Macrobook');
    $count.textContent = `· ${events.length}`;
    $record.disabled = isRecording;
    $stop.disabled = !isRecording;
    $copy.disabled = events.length === 0;

    $events.innerHTML = '';
    if (events.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = isRecording
        ? '⏺ 녹화 중 — 페이지에서 클릭/입력/제출 시 여기 쌓여요'
        : '⏺ 녹화 누르고 페이지에서 동작하면 한 줄씩 쌓여요';
      $events.appendChild(empty);
    } else {
      events.forEach((ev, i) => $events.appendChild(renderEvent(ev, i)));
      $events.scrollTop = $events.scrollHeight;
    }
  }

  function renderEvent(ev, idx) {
    const row = document.createElement('div');
    row.className = 'event';

    const seq = document.createElement('span');
    seq.className = 'seq';
    seq.textContent = String(idx + 1).padStart(3, '0');
    row.appendChild(seq);

    const type = document.createElement('span');
    type.className = 'type';
    type.dataset.type = ev.type;
    type.textContent = ev.type;
    row.appendChild(type);

    const summary = document.createElement('span');
    summary.className = 'summary';
    summary.textContent = summaryOf(ev);
    summary.title = summary.textContent;
    row.appendChild(summary);

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.title = '이 행만 삭제';
    del.addEventListener('click', () => {
      if (!ev.id) {
        flash('id 없음 — 재녹화 필요');
        return;
      }
      send('removeEvent', { eventId: ev.id });
    });
    row.appendChild(del);

    return row;
  }

  // ---------------------------------------------------------- actions ----

  $record.addEventListener('click', () => send('start'));
  $stop.addEventListener('click', () => send('stop'));
  $edit.addEventListener('click', () => send('openEditor'));

  $copy.addEventListener('click', async () => {
    if (events.length === 0) return;
    try {
      await navigator.clipboard.writeText(buildExportText(events));
      $copy.classList.add('copied');
      flash('📋 복사됨');
      setTimeout(() => $copy.classList.remove('copied'), 1100);
    } catch {
      flash('복사 실패 — 페이지 포커스 확인');
    }
  });

  // ---------------------------------------------------------- collapse ---

  $collapse.addEventListener('click', () => {
    collapsed = !collapsed;
    $widget.classList.toggle('collapsed', collapsed);
    $actions.style.display = collapsed ? 'none' : 'grid';
    $events.style.display = collapsed ? 'none' : 'block';
    $footer.style.display = collapsed ? 'none' : 'block';
    $collapse.textContent = collapsed ? '+' : '−';
    chrome.storage.local.set({ overlayCollapsed: collapsed });
  });

  // ---------------------------------------------------------- drag ------

  let dragOffset = null;
  $header.addEventListener('mousedown', (e) => {
    if (e.target === $collapse) return;
    const rect = host.getBoundingClientRect();
    dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragOffset) return;
    const x = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dragOffset.x));
    const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragOffset.y));
    host.style.left = x + 'px';
    host.style.top = y + 'px';
    host.style.right = 'auto';
    position = { x, y };
  });
  window.addEventListener('mouseup', () => {
    if (dragOffset) {
      dragOffset = null;
      chrome.storage.local.set({ overlayPosition: position });
    }
  });

  // ---------------------------------------------------------- bootstrap -

  chrome.storage.local.get(['isRecording', 'events', 'overlayCollapsed', 'overlayPosition'], (r) => {
    isRecording = !!r.isRecording;
    events = r.events || [];
    if (r.overlayCollapsed) {
      collapsed = true;
      $widget.classList.add('collapsed');
      $actions.style.display = 'none';
      $events.style.display = 'none';
      $footer.style.display = 'none';
      $collapse.textContent = '+';
    }
    if (r.overlayPosition && r.overlayPosition.x != null) {
      host.style.left = r.overlayPosition.x + 'px';
      host.style.top = r.overlayPosition.y + 'px';
      host.style.right = 'auto';
      position = r.overlayPosition;
    }
    render();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.isRecording) isRecording = !!changes.isRecording.newValue;
    if (changes.events) events = changes.events.newValue || [];
    if (changes.isRecording || changes.events) render();
  });
})();
