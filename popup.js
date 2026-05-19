const recordToggleBtn = document.getElementById('record-toggle');
const recordIcon = document.getElementById('record-icon');
const recordLabel = document.getElementById('record-label');
const clearBtn = document.getElementById('clear');
const copyBtn = document.getElementById('copy');
const copyLabel = document.getElementById('copy-label');
const exportBtn = document.getElementById('export');
const openEditorBtn = document.getElementById('open-editor');
const statusEl = document.getElementById('status');
const stateLabel = document.getElementById('state-label');
const countEl = document.getElementById('count');

const RECORD_ICON_SVG = '<circle cx="12" cy="12" r="7" fill="currentColor"/>';
const STOP_ICON_SVG   = '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>';

function ask(action, extra = {}) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action, ...extra }, (response) => {
        void chrome.runtime.lastError;
        resolve(response);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function refresh() {
  const state = await ask('getState');
  const recording = !!state?.isRecording;
  const events = state?.events || [];

  if (recording) {
    recordToggleBtn.className = 'action-btn stop';
    recordToggleBtn.title = '녹화 정지';
    recordIcon.innerHTML = STOP_ICON_SVG;
    recordLabel.textContent = '정지';
  } else {
    recordToggleBtn.className = 'action-btn record';
    recordToggleBtn.title = '녹화 시작';
    recordIcon.innerHTML = RECORD_ICON_SVG;
    recordLabel.textContent = '녹화';
  }

  clearBtn.disabled = events.length === 0;
  copyBtn.disabled = events.length === 0;
  exportBtn.disabled = events.length === 0;

  statusEl.classList.toggle('recording', recording);
  stateLabel.textContent = recording ? '녹화 중' : '대기 중';
  countEl.textContent = events.length;
}

// --- text formatting --------------------------------------------------------

function asString(v) {
  return JSON.stringify(v == null ? '' : String(v));
}

function strongestTarget(selector) {
  if (!selector) return null;
  if (selector.text) return selector.text;
  if (selector.aria) return `[aria="${selector.aria}"]`;
  if (selector.id)   return `#${selector.id}`;
  if (selector.name) return `[name="${selector.name}"]`;
  if (selector.css)  return selector.css;
  return null;
}

function pickSummary(event) {
  if (event.type === 'navigate') return event.url || null;
  if (event.type === 'wait') return `${event.duration_ms || 0}ms`;
  if (event.type === 'memo') return event.note || null;
  const sel = event.selector;
  if (event.type === 'input') {
    const v = event.sensitive ? '[REDACTED]' : (event.value === undefined ? '' : asString(event.value));
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
  return `    ${key}: ${asString(value)}`;
}

function formatEvent(event, index) {
  const seq = String(index + 1).padStart(3, '0');
  const summary = pickSummary(event);

  let head;
  if (summary == null) {
    head = `[${seq}] ${event.type}`;
  } else if (event.type === 'navigate' || event.type === 'input' || event.type === 'wait') {
    head = `[${seq}] ${event.type} ${summary}`;
  } else {
    head = `[${seq}] ${event.type} ${asString(summary)}`;
  }

  const lines = [head];
  if (event.disabled) lines.push('    disabled: true');

  if (event.type === 'navigate') {
    lines.push(bodyLine('url', event.url));
    if (event.from) lines.push(bodyLine('from', event.from));
    return lines.filter(Boolean).join('\n');
  }

  if (event.type === 'wait') {
    lines.push(bodyLine('duration_ms', event.duration_ms));
    return lines.filter(Boolean).join('\n');
  }
  if (event.type === 'memo') {
    lines.push(bodyLine('note', event.note));
    return lines.filter(Boolean).join('\n');
  }

  const target = strongestTarget(event.selector);
  if (target) lines.push(bodyLine('target', target));

  const sel = event.selector;
  if (sel) {
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
  }

  if ('value' in event) {
    if (event.sensitive) {
      lines.push(bodyLine('value', '[REDACTED]'));
      lines.push('    sensitive: true');
    } else {
      lines.push(bodyLine('value', event.value));
    }
  }
  if (event.inputType) lines.push(bodyLine('input_type', event.inputType));
  lines.push(bodyLine('url', event.url));

  return lines.filter(Boolean).join('\n');
}

function buildHeader(count) {
  return [
    '# Macro recorder export',
    `# Recorded: ${new Date().toISOString()}`,
    `# Events: ${count}`,
    '# Format: each event is `[NNN] type "summary"` + indented `key: "JSON-escaped"` body.',
    '# Editors fold by indentation. Selector priority for AI replay: text > aria > id > name > css.',
    '# Sensitive inputs (password, *-password autocomplete, cc-*) are stored as value="[REDACTED]".',
    ''
  ].join('\n');
}

function buildExportText(events) {
  return buildHeader(events.length)
    + events.map(formatEvent).join('\n\n')
    + '\n';
}

// --- handlers ---------------------------------------------------------------

recordToggleBtn.addEventListener('click', async () => {
  const state = await ask('getState');
  await ask(state?.isRecording ? 'stop' : 'start');
  await refresh();
});

clearBtn.addEventListener('click', async () => {
  const state = await ask('getState');
  const n = (state?.events || []).length;
  if (n === 0) return;
  if (!confirm(`녹화된 ${n}개 이벤트를 모두 지울까요?\n이 작업은 되돌릴 수 없어요.`)) return;
  await ask('clearEvents');
  await refresh();
});

let copyFeedbackTimer = null;
function flashCopiedFeedback() {
  if (copyFeedbackTimer) {
    clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = null;
  }
  copyBtn.classList.add('copied');
  copyLabel.textContent = '복사됨';
  copyFeedbackTimer = setTimeout(() => {
    copyBtn.classList.remove('copied');
    copyLabel.textContent = '복사';
    copyFeedbackTimer = null;
  }, 1200);
}

copyBtn.addEventListener('click', async () => {
  const state = await ask('getState');
  const events = state?.events || [];
  if (events.length === 0) return;

  const text = buildExportText(events);
  try {
    await navigator.clipboard.writeText(text);
    flashCopiedFeedback();
  } catch (_) {
    copyLabel.textContent = '실패';
    setTimeout(() => { copyLabel.textContent = '복사'; }, 1200);
  }
});

exportBtn.addEventListener('click', async () => {
  const state = await ask('getState');
  const events = state?.events || [];
  if (events.length === 0) return;

  const blob = new Blob([buildExportText(events)], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url,
    filename: `macro-${Date.now()}.txt`,
    saveAs: true
  }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  });
});

openEditorBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('editor/editor.html') });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.events || changes.isRecording) refresh();
});

refresh();
