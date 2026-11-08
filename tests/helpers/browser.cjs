const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
const STORAGE_KEY = 'trump-cut-app-phrases-v1';
const BACKUP_KEY = 'trump-cut-app-phrases-backup-v1';
const URL = 'https://true-cut.test/';

// A shared origin with one Storage facade per tab. Writes are atomic; storage
// events are queued for OTHER tabs only, so tests can edit a deliberately stale UI.
class StorageOrigin {
  constructor(initial = {}) {
    this.data = new Map(Object.entries(initial));
    this.tabs = new Set();
    this.pending = [];
    this.writes = [];
    this.failRead = () => false;
    this.failWrite = () => false;
  }

  attach(window) {
    const origin = this;
    const storage = {
      get length() { return origin.data.size; },
      key(index) { return [...origin.data.keys()][index] ?? null; },
      getItem(key) {
        key = String(key);
        if (origin.failRead(key, window)) {
          throw new window.DOMException('Storage access denied', 'SecurityError');
        }
        return origin.data.get(key) ?? null;
      },
      setItem(key, value) {
        key = String(key);
        value = String(value);
        if (origin.failWrite(key, value, window)) {
          throw new window.DOMException('Storage quota exceeded', 'QuotaExceededError');
        }
        const oldValue = origin.data.get(key) ?? null;
        origin.data.set(key, value);
        origin.writes.push({ key, value });
        if (oldValue !== value) origin.queue(window, key, oldValue, value);
      },
      removeItem(key) {
        key = String(key);
        const oldValue = origin.data.get(key) ?? null;
        if (origin.data.delete(key)) origin.queue(window, key, oldValue, null);
      },
      clear() {
        if (!origin.data.size) return;
        origin.data.clear();
        origin.queue(window, null, null, null);
      }
    };
    Object.defineProperty(window, 'localStorage', { value: storage });
    this.tabs.add(window);
  }

  queue(source, key, oldValue, newValue) {
    for (const target of this.tabs) {
      if (target !== source) this.pending.push({ target, key, oldValue, newValue });
    }
  }

  flushEvents() {
    for (const { target, ...event } of this.pending.splice(0)) {
      if (this.tabs.has(target)) target.dispatchEvent(new target.StorageEvent('storage', {
        ...event, url: URL
      }));
    }
  }

  state(key = STORAGE_KEY) {
    const raw = this.data.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  }
}

function openApp(t, origin = new StorageOrigin()) {
  const errors = [];
  const alerts = [];
  const confirmations = [];
  const downloads = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, {
    url: URL,
    runScripts: 'dangerously',
    virtualConsole,
    beforeParse(window) {
      origin.attach(window);
      window.confirm = message => { confirmations.push(message); return true; };
      window.alert = message => alerts.push(message);
      // Capture the real export handler's payload without creating a download.
      window.Blob = Blob;
      window.URL.createObjectURL = blob => {
        downloads.push(blob);
        return 'blob:https://true-cut.test/export';
      };
      window.URL.revokeObjectURL = () => {};
      window.HTMLAnchorElement.prototype.click = () => {};
      window.fetch = () => { throw new Error('Network access is forbidden in storage tests'); };
    }
  });
  const { window } = dom;
  t.after(() => {
    origin.tabs.delete(window);
    window.close();
    assert.deepEqual(errors, [], 'No uncaught application or DOM errors');
  });
  const element = id => {
    const result = window.document.getElementById(id);
    assert.ok(result, `Missing #${id}`);
    return result;
  };
  const click = id => element(id).click();
  return {
    window, origin, alerts, confirmations, downloads, element, click,
    edit(position, text) {
      const input = element(`phrase-input-${position}`);
      input.focus();
      input.value = text;
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    orient(position, value) {
      const select = element(`phrase-orientation-${position}`);
      select.value = value;
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    },
    async importFile(text) {
      const input = element('importPhrasesFile');
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: text === null ? [] : [{ text: async () => text }]
      });
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
      // Let the async file-change handler finish, including catch/finally.
      await new Promise(resolve => setImmediate(resolve));
    },
    async exported() {
      click('exportPhrasesBtn');
      return JSON.parse(await downloads.at(-1).text());
    }
  };
}

function phraseState(prefix = '') {
  return Object.fromEntries(Array.from({ length: 52 }, (_, i) => [String(i + 1), {
    text: prefix ? `${prefix}${i + 1}` : '',
    orientation: prefix && i % 2 ? 'front' : 'back',
    autoFrom: null
  }]));
}

function assertInputs(app, expected) {
  assert.equal(app.window.document.querySelectorAll('#phraseGrid input[data-position]').length, 52);
  assert.equal(app.window.document.querySelectorAll('#phraseGrid select[data-position]').length, 52);
  for (let position = 1; position <= 52; position++) {
    const entry = expected[String(position)];
    assert.equal(app.element(`phrase-input-${position}`).value, entry.text, `text ${position}`);
    assert.equal(app.element(`phrase-orientation-${position}`).value, entry.orientation, `orientation ${position}`);
    assert.equal(app.element(`phrase-input-${position}`).dataset.autoFrom, entry.autoFrom ? String(entry.autoFrom) : '', `autoFrom ${position}`);
    assert.equal(app.element(`phrase-auto-${position}`).style.visibility, entry.autoFrom ? 'visible' : 'hidden', `badge ${position}`);
  }
}

module.exports = { StorageOrigin, openApp, phraseState, assertInputs, STORAGE_KEY, BACKUP_KEY };
