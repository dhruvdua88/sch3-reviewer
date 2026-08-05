// ============ EXPORT LOCK ============
// UI-layer single-flight guard for export buttons (Excel / Word / engagement
// JSON). A fast double-click fires two clicks before React re-renders the
// `disabled` prop, so a plain disabled attribute alone doesn't stop the
// second click. The cooldown here covers that gap: the lock stays held for
// `cooldownMs` after the export settles, well past a double-click's ~50-300ms
// spacing, so the second click is rejected even though the button hasn't
// visually updated yet. Keep this lock at the UI layer only — do NOT bake a
// cooldown into downloadAsWord/exportEngagement/exportExcel themselves, since
// test/report.test.mjs calls generateReport() three times in a row and
// expects a download every time.

export function createExportLock(cooldownMs = 500) {
  let locked = false;

  async function runExport(fn, setBusy) {
    if (locked) return false;
    locked = true;
    setBusy?.(true);
    try {
      await fn();
    } finally {
      setTimeout(() => {
        locked = false;
        setBusy?.(false);
      }, cooldownMs);
    }
    return true;
  }

  return { runExport };
}
