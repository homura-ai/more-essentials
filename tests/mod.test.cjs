const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'more-essentials.uc.js'), 'utf8');

function browser({ delayed = false, own = false } = {}) {
  const prefs = new Map();
  const timers = new Map();
  const events = new Map();
  let nextTimer = 0;
  let unload;
  let nativeCap = 12;
  const prototype = { get maxEssentialTabs() { return nativeCap; } };
  const manager = Object.create(prototype);
  if (own) Object.defineProperty(manager, 'maxEssentialTabs', {
    configurable: true, enumerable: true, get() { return nativeCap; },
  });
  const window = {
    location: { href: 'chrome://browser/content/browser.xhtml' },
    gZenPinnedTabManager: delayed ? undefined : manager,
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, callback) { events.set(name, callback); },
    removeEventListener(name, callback) { if (events.get(name) === callback) events.delete(name); },
    addUnloadListener(callback) { unload = callback; },
  };
  const context = vm.createContext({ window, console, Services: {
    prefs: { getStringPref(name, fallback) { return prefs.get(name) ?? fallback; } },
  } });
  const run = () => vm.runInContext(source, context);
  run();
  return {
    window, manager, prefs, timers, events, run,
    disable: () => unload(),
    native: (value) => { nativeCap = value; },
    custom(value) {
      prefs.set('mod.more-essentials.mode', 'custom');
      prefs.set('mod.more-essentials.cap', value);
    },
    tick() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach(callback => callback());
    },
  };
}

test('defaults to real Infinity and updates the admission boundary live', () => {
  const b = browser();
  assert.equal(b.manager.maxEssentialTabs, Infinity);
  b.custom('24');
  assert.ok(23 < b.manager.maxEssentialTabs);
  assert.ok(!(24 < b.manager.maxEssentialTabs));
  b.custom('0');
  assert.equal(b.manager.maxEssentialTabs, 0);
  b.custom(' 9007199254740991 ');
  assert.equal(b.manager.maxEssentialTabs, Number.MAX_SAFE_INTEGER);
  b.prefs.set('mod.more-essentials.mode', 'infinite');
  assert.equal(b.manager.maxEssentialTabs, Infinity);
});

test('invalid values defer to the current native cap', () => {
  const b = browser();
  b.native(18);
  for (const input of ['', ' ', '-1', '2.5', '1e3', '0x10', 'NaN', 'Infinity', '9007199254740992']) {
    b.custom(input);
    assert.equal(b.manager.maxEssentialTabs, 18, input);
  }
  b.prefs.set('mod.more-essentials.mode', 'unknown');
  assert.equal(b.manager.maxEssentialTabs, 18);
});

test('disable restores inherited and own getters and cleans up', () => {
  for (const own of [false, true]) {
    const b = browser({ own });
    b.native(20);
    b.disable();
    b.disable();
    assert.equal(b.manager.maxEssentialTabs, 20);
    assert.equal(Object.hasOwn(b.manager, 'maxEssentialTabs'), own);
    assert.equal(b.timers.size, 0);
    assert.equal(b.events.size, 0);
    assert.equal(b.window.__moreEssentials, undefined);
  }
});

test('supports delayed startup, reload, and cancellation before startup', () => {
  const b = browser({ delayed: true });
  assert.equal(b.timers.size, 1);
  b.window.gZenPinnedTabManager = b.manager;
  b.tick();
  assert.equal(b.manager.maxEssentialTabs, Infinity);
  b.run();
  b.disable();
  assert.equal(b.manager.maxEssentialTabs, 12);
  const pending = browser({ delayed: true });
  pending.disable();
  pending.window.gZenPinnedTabManager = pending.manager;
  pending.tick();
  assert.equal(pending.manager.maxEssentialTabs, 12);
});

test('window unload restores the cap; cleanup preserves a later override', () => {
  const b = browser();
  b.events.get('unload')();
  assert.equal(b.manager.maxEssentialTabs, 12);
  const c = browser();
  Object.defineProperty(c.manager, 'maxEssentialTabs', { configurable: true, value: 99 });
  c.disable();
  assert.equal(c.manager.maxEssentialTabs, 99);
});

test('package references existing files and settings match runtime defaults', () => {
  const theme = JSON.parse(fs.readFileSync(path.join(root, 'theme.json')));
  for (const field of ['id', 'name', 'description', 'homepage', 'version', 'createdAt', 'updatedAt', 'style', 'fork']) {
    assert.ok(Object.hasOwn(theme, field), `Missing metadata: ${field}`);
  }
  assert.equal(theme.homepage, 'https://github.com/homura-ai/more-essentials');
  assert.equal(theme.readme, 'https://raw.githubusercontent.com/homura-ai/more-essentials/main/README.md');
  assert.equal(theme.id, 'more-essentials');
  assert.ok(fs.existsSync(path.join(root, theme.style)));
  assert.ok(theme.fork.includes('zen'));
  assert.ok(Number.isFinite(Date.parse(theme.createdAt)));
  assert.ok(Date.parse(theme.updatedAt) > Date.parse('2026-09-22T03:01:27Z'));
  const prefs = JSON.parse(fs.readFileSync(path.join(root, theme.preferences)));
  for (const script of Object.keys(theme.scripts)) assert.ok(fs.existsSync(path.join(root, script)));
  assert.equal(theme.supportsUnload, true);
  const b = browser();
  for (const pref of prefs) b.prefs.set(pref.property, pref.defaultValue);
  assert.equal(b.manager.maxEssentialTabs, Infinity);
  b.prefs.set('mod.more-essentials.mode', 'custom');
  assert.equal(b.manager.maxEssentialTabs, 12);
});
