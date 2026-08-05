// ============ FLASH-ONLY MODEL MIGRATION ============
// The app standardised on a single DeepSeek model. Settings persist in
// localStorage and are merged as { ...DEFAULT_SETTINGS, ...stored }, so a
// browser that used the app BEFORE the switch keeps winning with its old
// stored id and would silently keep calling a legacy model forever.
// getSettings()/getRunPrefs() therefore coerce on read. These tests pin that.
//
// Run: node test/modelMigration.test.mjs

import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { getSettings, getRunPrefs, SUPPORTED_MODEL } = await import('../src/lib/engagementStore.js');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

console.log('\nflash-only model migration');

check('the one supported model is deepseek-v4-flash', () => {
  assert.equal(SUPPORTED_MODEL, 'deepseek-v4-flash');
});

check('a clean profile gets flash', () => {
  store.clear();
  const s = getSettings();
  assert.equal(s.model, 'deepseek-v4-flash');
  assert.equal(s.mapperModel, 'deepseek-v4-flash');
});

for (const legacy of ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro']) {
  check(`persisted "${legacy}" is coerced to flash on read`, () => {
    store.clear();
    store.set('ddandco_settings', JSON.stringify({
      model: legacy, modelFlash: legacy, mapperModel: legacy, firmName: 'Dhruv Dua & Co.',
    }));
    const s = getSettings();
    assert.equal(s.model, 'deepseek-v4-flash', 'settings.model not migrated');
    assert.equal(s.modelFlash, 'deepseek-v4-flash', 'settings.modelFlash not migrated');
    assert.equal(s.mapperModel, 'deepseek-v4-flash', 'settings.mapperModel not migrated');
    assert.equal(s.firmName, 'Dhruv Dua & Co.', 'unrelated settings must survive migration');
  });

  check(`persisted run-pref "${legacy}" is coerced to flash`, () => {
    store.clear();
    store.set('ddandco_run_prefs', JSON.stringify({ model: legacy, runCaro: false }));
    const p = getRunPrefs();
    assert.equal(p.model, 'deepseek-v4-flash', 'run-pref model override not migrated');
    assert.equal(p.runCaro, false, 'unrelated run prefs must survive migration');
  });
}

check('a null run-pref model stays null (falls through to settings)', () => {
  store.clear();
  assert.equal(getRunPrefs().model, null);
});

check('corrupt JSON falls back to defaults rather than throwing', () => {
  store.clear();
  store.set('ddandco_settings', '{not json');
  store.set('ddandco_run_prefs', '{not json');
  assert.equal(getSettings().model, 'deepseek-v4-flash');
  assert.equal(getRunPrefs().model, null);
});

console.log(failures === 0 ? '\nall model-migration checks passed\n' : `\n${failures} model-migration check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
