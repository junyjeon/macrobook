const STATE_KEY = 'isRecording';
const EVENTS_KEY = 'events';

/**
 * Idempotent init. Called on both onInstalled and onStartup because MV3
 * service workers are killed regularly; relying on onInstalled alone leaves
 * the storage keys undefined after a worker restart on a clean profile boot,
 * which silently drops the first recorded event (codex finding #4).
 */
async function ensureInit() {
  const result = await chrome.storage.local.get([STATE_KEY, EVENTS_KEY]);
  const patch = {};
  if (result[STATE_KEY] === undefined) patch[STATE_KEY] = false;
  if (result[EVENTS_KEY] === undefined) patch[EVENTS_KEY] = [];
  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
}

chrome.runtime.onInstalled.addListener(() => { ensureInit(); });
chrome.runtime.onStartup.addListener(() => { ensureInit(); });

/**
 * Serialized write queue.
 *
 * chrome.storage.local.get + set is not atomic; if two recordEvent
 * messages arrive within the same animation frame both reads see the
 * same events array and one push is lost when the second set overwrites
 * the first. Chaining every mutation through this single Promise
 * enforces happens-before ordering across all writers (codex finding #1).
 */
let writeQueue = Promise.resolve();
function enqueue(work) {
  writeQueue = writeQueue.then(work).catch(() => {});
  return writeQueue;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'recordEvent') {
    enqueue(async () => {
      await ensureInit();
      const result = await chrome.storage.local.get([STATE_KEY, EVENTS_KEY]);
      if (!result[STATE_KEY]) return;
      const events = result[EVENTS_KEY] || [];
      events.push(msg.event);
      await chrome.storage.local.set({ [EVENTS_KEY]: events });
    });
    return false;
  }

  if (msg.action === 'start') {
    enqueue(async () => {
      await chrome.storage.local.set({ [STATE_KEY]: true, [EVENTS_KEY]: [] });
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'stop') {
    enqueue(async () => {
      await chrome.storage.local.set({ [STATE_KEY]: false });
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'removeEvent') {
    enqueue(async () => {
      const result = await chrome.storage.local.get([EVENTS_KEY]);
      const events = (result[EVENTS_KEY] || []).filter((e) => e && e.id !== msg.eventId);
      await chrome.storage.local.set({ [EVENTS_KEY]: events });
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'openEditor') {
    chrome.tabs.create({ url: chrome.runtime.getURL('editor/editor.html') });
    return false;
  }

  if (msg.action === 'getState') {
    enqueue(async () => {
      await ensureInit();
      const result = await chrome.storage.local.get([STATE_KEY, EVENTS_KEY]);
      sendResponse({
        isRecording: !!result[STATE_KEY],
        events: result[EVENTS_KEY] || []
      });
    });
    return true;
  }
});
