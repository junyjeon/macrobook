const recordBtn = document.getElementById('record');
const stopBtn = document.getElementById('stop');
const copyBtn = document.getElementById('copy');
const copyLabel = document.getElementById('copy-label');
const exportBtn = document.getElementById('export');
const openEditorBtn = document.getElementById('open-editor');
const statusEl = document.getElementById('status');
const stateLabel = document.getElementById('state-label');
const countEl = document.getElementById('count');

function ask(action) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action }, (response) => {
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

  recordBtn.disabled = recording;
  stopBtn.disabled = !recording;
  copyBtn.disabled = events.length === 0;
  exportBtn.disabled = events.length === 0;

  statusEl.classList.toggle('recording', recording);
  stateLabel.textContent = recording ? '녹화 중' : '대기 중';
  countEl.textContent = events.length;
}

// --- formatter (foldable multi-line) ----------------------------------------

function escapeStr(v) {
  return JSON.stringify(v == null ? '' : String(v));
}

function field(key, value) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean' || typeof value === 'number') {
    return `    ${key}: ${value}`;
  }
  return `    ${key}: ${escapeStr(value)}`;
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

  const sel = event.selector;

  if (event.type === 'input') {
    const valueRepr = event.sensitive
      ? '[REDACTED]'
      : (event.value === undefined ? '' : escapeStr(event.value));
    const targetRepr = sel?.name ? `[name="${sel.name}"]`
                     : sel?.id ? `#${sel.id}`
                     : sel?.text ? `"${sel.text}"`
                     : '?';
    return `${valueRepr} → ${targetRepr}`;
  }

  if (!sel) return null;
  if (sel.text)      return sel.text;
  if (sel.aria)      return sel.aria;
  if (sel.labelText) return sel.labelText;
  if (sel.id)        return `#${sel.id}`;
  if (sel.name)      return `[name="${sel.name}"]`;
  return null;
}

function formatEvent(event, index) {
  const seq = String(index + 1).padStart(3, '0');
  const summary = pickSummary(event);

  let head;
  if (summary == null) {
    head = `[${seq}] ${event.type}`;
  } else if (event.type === 'navigate' || event.type === 'input') {
    head = `[${seq}] ${event.type} ${summary}`;
  } else {
    head = `[${seq}] ${event.type} ${escapeStr(summary)}`;
  }

  const lines = [head];

  if (event.type === 'navigate') {
    lines.push(field('url', event.url));
    if (event.from) lines.push(field('from', event.from));
    return lines.filter(Boolean).join('\n');
  }

  const target = strongestTarget(event.selector);
  if (target) lines.push(field('target', target));

  const sel = event.selector;
  if (sel) {
    if (sel.text)      lines.push(field('text', sel.text));
    if (sel.aria)      lines.push(field('aria', sel.aria));
    if (sel.id)        lines.push(field('id', sel.id));
    if (sel.name)      lines.push(field('name', sel.name));
    if (sel.tag)       lines.push(field('tag', sel.tag));
    if (sel.role)      lines.push(field('role', sel.role));
    if (sel.type)      lines.push(field('type', sel.type));
    if (sel.labelText) lines.push(field('label', sel.labelText));
    if (sel.css) {
      lines.push(field('css', sel.css));
      lines.push('    target_confidence: low');
    }
  }

  if ('value' in event) {
    if (event.sensitive) {
      lines.push(field('value', '[REDACTED]'));
      lines.push('    sensitive: true');
    } else {
      lines.push(field('value', event.value));
    }
  }
  if (event.inputType) lines.push(field('input_type', event.inputType));
  lines.push(field('url', event.url));

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

recordBtn.addEventListener('click', async () => {
  await ask('start');
  await refresh();
});

stopBtn.addEventListener('click', async () => {
  await ask('stop');
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
