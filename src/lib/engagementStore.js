// ============ ENGAGEMENT STORE ============
// All localStorage operations. Keys are namespaced with 'ddandco_' prefix.

const KEY_API       = 'ddandco_deepseek_key';
const KEY_SETTINGS  = 'ddandco_settings';
const KEY_LIST      = 'ddandco_engagements';
const KEY_PREFS     = 'ddandco_run_prefs';   // last-used model + runCaro toggle

// ---- API Key ----
export function getApiKey()     { return localStorage.getItem(KEY_API) || ''; }
export function setApiKey(key)  { localStorage.setItem(KEY_API, key.trim()); }
export function clearApiKey()   { localStorage.removeItem(KEY_API); }

// ---- App Settings ----
const DEFAULT_SETTINGS = {
  // 'deepseek-v4-flash' is the ONE model this app uses (per explicit user
  // instruction — no Pro going ahead). It's a real, current canonical model
  // id on the live DeepSeek API — not a placeholder.
  model:       'deepseek-v4-flash',
  modelFlash:  'deepseek-v4-flash',
  mapperModel: 'deepseek-v4-flash',     // Grouping Mapper default
  firmName:    'Dhruv Dua & Co.',
  partnerName: 'Dhruv Dua',
  firmFRN:     '028145N',
  membershipNo:'531607',
  place:       'New Delhi',
};

// Anything that is not the one supported model is coerced to it on read.
// Without this, a browser that used the app before the flash-only switch keeps
// sending its persisted 'deepseek-chat' / 'deepseek-reasoner' forever, because
// the stored value wins over DEFAULT_SETTINGS in the spread below.
export const SUPPORTED_MODEL = 'deepseek-v4-flash';
const coerceModel = (m) => (m === SUPPORTED_MODEL ? m : SUPPORTED_MODEL);

export function getSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY_SETTINGS));
    const s = stored ? { ...DEFAULT_SETTINGS, ...stored } : { ...DEFAULT_SETTINGS };
    s.model       = coerceModel(s.model);
    s.modelFlash  = coerceModel(s.modelFlash);
    s.mapperModel = coerceModel(s.mapperModel);
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
}

// ---- Per-run preferences (model + CARO toggle from PdfMarkdownPreview) ----
const DEFAULT_RUN_PREFS = {
  model:   null,   // null = use settings.model; otherwise overrides
  runCaro: true,
};

export function getRunPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY_PREFS));
    const p = stored ? { ...DEFAULT_RUN_PREFS, ...stored } : { ...DEFAULT_RUN_PREFS };
    // A per-run override persisted before the flash-only switch would otherwise
    // outrank settings.model on every future run.
    if (p.model) p.model = coerceModel(p.model);
    return p;
  } catch {
    return { ...DEFAULT_RUN_PREFS };
  }
}

export function saveRunPrefs(p) {
  try {
    localStorage.setItem(KEY_PREFS, JSON.stringify(p));
  } catch { /* localStorage full or unavailable — silent fail */ }
}

// ---- Recent Engagements (last 5, metadata only) ----
function countsBySeverity(issues = []) {
  const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  issues.forEach((i) => { if (c[i.severity] !== undefined) c[i.severity]++; });
  return c;
}

export function listEngagements() {
  try {
    return JSON.parse(localStorage.getItem(KEY_LIST)) || [];
  } catch {
    return [];
  }
}

/**
 * Save an engagement. Keeps last 5.
 *
 * - If `id` matches an existing entry, that entry is updated in place
 *   (preserves its position in the list and original `date`). This is
 *   how per-issue state changes survive without polluting the list.
 * - If `id` is omitted or unmatched, a new entry is created at the top
 *   and the list is trimmed to 5.
 *
 * Returns the entry's id.
 */
export function saveEngagement({ analysis, caro, reportFields, issueStates, id } = {}) {
  const list = listEngagements();
  const dataPayload = { analysis, caro, reportFields, issueStates: issueStates || {} };

  const existingIdx = id ? list.findIndex((e) => e.id === id) : -1;
  if (existingIdx >= 0) {
    const existing = list[existingIdx];
    const updated = {
      ...existing,
      companyName: analysis?.company?.name || existing.companyName,
      cin:         analysis?.company?.cin  || existing.cin,
      yearEnd:     analysis?.company?.yearEnd || existing.yearEnd,
      counts:      countsBySeverity(analysis?.scheduleIIIIssues || []),
      caroApplies: !!caro?.applicability?.applies,
      lastModified: new Date().toISOString(),
      data:        dataPayload,
    };
    const newList = [...list];
    newList[existingIdx] = updated;
    localStorage.setItem(KEY_LIST, JSON.stringify(newList));
    return existing.id;
  }

  // New entry
  const entry = {
    id:          id || Date.now().toString(),
    companyName: analysis?.company?.name || 'Unknown',
    cin:         analysis?.company?.cin  || '',
    yearEnd:     analysis?.company?.yearEnd || '',
    date:        new Date().toISOString(),
    counts:      countsBySeverity(analysis?.scheduleIIIIssues || []),
    caroApplies: !!caro?.applicability?.applies,
    data:        dataPayload,
  };
  const updated = [entry, ...list].slice(0, 5);
  localStorage.setItem(KEY_LIST, JSON.stringify(updated));
  return entry.id;
}

export function loadEngagement(id) {
  const list = listEngagements();
  return list.find((e) => e.id === id) || null;
}

export function deleteEngagement(id) {
  const list = listEngagements().filter((e) => e.id !== id);
  localStorage.setItem(KEY_LIST, JSON.stringify(list));
}

// ---- Export / Import Engagement as JSON ----
export function exportEngagement({ analysis, caro, reportFields, issueStates }) {
  const payload = JSON.stringify({
    version:    2,
    exportedAt: new Date().toISOString(),
    analysis,
    caro,
    reportFields,
    issueStates: issueStates || {},
  }, null, 2);

  const blob    = new Blob([payload], { type: 'application/json' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  const safeName = (analysis?.company?.name || 'engagement')
    .replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40);

  a.href     = url;
  a.download = `${safeName}_engagement.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importEngagement(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.analysis) throw new Error('Missing analysis field');
        resolve(data);
      } catch (err) {
        reject(new Error('Could not parse engagement file: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}
