// ============ AUDIT REPORT GENERATION — regression check ============
//
// Offline, no DeepSeek, no browser. Stubs the handful of DOM globals that
// downloadAsWord() touches, then locks the two things that actually broke
// report generation in the field:
//
//   1. generateReport() must trigger EXACTLY ONE download. It both builds
//      the HTML and downloads it, and returns undefined. A caller that
//      treats the return value as HTML and downloads it again produces a
//      second .doc containing the literal string "undefined" and trips
//      Chrome's multiple-download block, so nothing usable reaches the user.
//   2. The generated HTML must never contain the literal "undefined" and
//      must carry the mandatory SA 700 blocks + signature details.
//
// Run: node test/report.test.mjs   (or npm test, which chains it)

import assert from 'node:assert/strict';

// ── DOM stubs (must exist before docExport is imported? no — only at call time)
const downloads = [];

globalThis.Blob = class Blob {
  constructor(parts) { this.parts = parts; }
};
globalThis.URL = {
  createObjectURL: () => 'blob:stub',
  revokeObjectURL: () => {},
};
globalThis.document = {
  createElement: () => ({
    href: '', download: '',
    click() { downloads.push({ name: this.download, body: currentBody }); },
  }),
  body: { appendChild() {}, removeChild() {} },
};

// downloadAsWord builds the Blob before creating the anchor, so we capture the
// payload by wrapping Blob construction.
let currentBody = '';
const RealBlob = globalThis.Blob;
globalThis.Blob = class extends RealBlob {
  constructor(parts, opts) { super(parts, opts); currentBody = parts.join(''); }
};

const { generateReport, buildReportHTML } = await import('../src/lib/docExport.js');

// ── Fixtures ────────────────────────────────────────────────────────────────
const analysis = {
  company: { name: 'Acme Widgets Private Limited', cin: 'U12345DL2020PTC000001', yearEnd: '31 March 2025' },
  keyMetrics: { revenueLakhs: 1200 },   // < 5000 → IFCoFR exempt, no Annexure B
  scheduleIIIIssues: [],
};

const caroOff = { applicability: { applies: false }, clauses: [] };
const caroOn  = {
  applicability: { applies: true },
  clauses: [{ topic: 'Property, Plant and Equipment', paragraph: '3(i)', remark: 'Records maintained.' }],
};

const rf = {
  firmName: 'Dhruv Dua & Co.', firmFRN: '028145N',
  partnerName: 'Dhruv Dua', partnerDesignation: 'Proprietor',
  membershipNo: '531607', udin: '', place: 'New Delhi',
  reportDate: '2025-09-30', accountingSoftware: 'TallyPrime',
  rule11a_litigation: 'The Company does not have any pending litigations.',
  rule11b_longTermContracts: 'No long-term contracts.',
  rule11c_iepf: 'No delay in transferring amounts to the IEPF.',
  rule11f_dividend: 'No dividend declared or paid.',
  rule11e_text: '', rule11g_text: '',   // blank → builder must fall back to standard wording
};

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

console.log('\naudit report generation');

// ── 1. Exactly one download per generateReport() call ────────────────────────
check('generateReport triggers exactly one download', () => {
  downloads.length = 0;
  generateReport(analysis, caroOff, rf);
  assert.equal(downloads.length, 1, `expected 1 download, got ${downloads.length}`);
  assert.match(downloads[0].name, /_Independent_Auditors_Report\.doc$/);
});

check('generateReport returns undefined (it is a side-effect, not an HTML builder)', () => {
  downloads.length = 0;
  const ret = generateReport(analysis, caroOff, rf);
  assert.equal(ret, undefined,
    'if this ever returns HTML, update the callers — a caller that downloads the return value double-downloads');
});

check('downloaded payload is real HTML, not the string "undefined"', () => {
  downloads.length = 0;
  generateReport(analysis, caroOff, rf);
  const body = downloads[0].body;
  assert.ok(body.length > 2000, `payload suspiciously short: ${body.length} bytes`);
  assert.ok(!/^﻿?undefined$/.test(body), 'payload is the literal string "undefined"');
});

// ── 2. Content integrity ─────────────────────────────────────────────────────
const html = buildReportHTML(analysis, caroOff, rf, false);

check('no literal "undefined" leaks into the report', () => {
  assert.ok(!html.includes('undefined'), 'found "undefined" in the generated report HTML');
});

check('carries the mandatory SA 700 headings', () => {
  for (const s of [
    'INDEPENDENT AUDITOR’S REPORT'.replace('’', "'"),
    'Basis for Opinion',
    'Report on Other Legal and Regulatory Requirements',
  ]) assert.ok(html.includes(s), `missing: ${s}`);
});

check('company name and signature block are populated', () => {
  assert.ok(html.includes(analysis.company.name), 'company name missing');
  assert.ok(html.includes('028145N'), 'FRN missing');
  assert.ok(html.includes('531607'), 'membership number missing');
  assert.ok(html.includes('__________________'), 'blank UDIN should render an underscore rule');
});

check('blank rule11e/rule11g fall back to the standard ICAI wording', () => {
  assert.ok(html.includes('Ultimate Beneficiaries'), 'Rule 11(e) fallback text missing');
  assert.ok(html.includes('audit trail'), 'Rule 11(g) fallback text missing');
  assert.ok(html.includes('TallyPrime'), 'accounting software not substituted into Rule 11(g)');
  assert.ok(!html.includes('[SOFTWARE]'), 'unsubstituted [SOFTWARE] token left in the report');
});

// ── 3. Conditional annexures ─────────────────────────────────────────────────
check('CARO off → no Annexure A; IFCoFR exempt → no Annexure B', () => {
  assert.ok(!html.includes('ANNEXURE A'), 'Annexure A emitted while CARO does not apply');
  assert.ok(!html.includes('ANNEXURE B'), 'Annexure B emitted while IFCoFR is exempt');
  assert.ok(html.includes('not applicable to the Company as it is a private limited company'),
    'Sec 143(3)(f) exempt paragraph missing');
});

check('CARO on + IFCoFR applies → both annexures, both cross-references', () => {
  const big = { ...analysis, keyMetrics: { revenueLakhs: 6000 } };
  const h = buildReportHTML(big, caroOn, rf, true);
  assert.ok(h.includes('ANNEXURE A'), 'Annexure A missing when CARO applies');
  assert.ok(h.includes('ANNEXURE B'), 'Annexure B missing when IFCoFR applies');
  assert.ok(h.includes('Property, Plant and Equipment'), 'CARO clause topic missing from Annexure A');
  assert.ok(!h.includes('undefined'), 'found "undefined" in the full report variant');
});

// ── 4. Escaping — a bare '<' or '&' must not break the .doc markup ──────────
// Word parses the payload as HTML. An unescaped '<' in reviewer free text
// swallows everything up to the next '>', truncating the report body.
check('reviewer free text with < & > is escaped, not swallowed', () => {
  const dirty = {
    ...rf,
    firmName: 'Smith & Associates',
    rule11a_litigation: 'Claims < Rs 50 lakh & disputes > Rs 10 lakh are pending.',
    rule11f_dividend: 'Dividend <nil> for the year.',
  };
  const h = buildReportHTML(analysis, caroOff, dirty, false);
  assert.ok(h.includes('Claims &lt; Rs 50 lakh &amp; disputes &gt; Rs 10 lakh'),
    'Rule 11(a) free text not escaped');
  assert.ok(h.includes('Dividend &lt;nil&gt;'), 'Rule 11(f) free text not escaped');
  assert.ok(h.includes('Smith &amp; Associates'), 'firm name not escaped');
  assert.ok(!h.includes('<nil>'), 'raw <nil> tag leaked into the markup');
});

check('CARO clause topic/paragraph/remark from the model are escaped', () => {
  const dirtyCaro = {
    applicability: { applies: true },
    clauses: [{ topic: 'Loans & advances <granted>', paragraph: '3(iii)', remark: 'Balance < Rs 5 lakh & unsecured.' }],
  };
  const h = buildReportHTML(analysis, dirtyCaro, rf, false);
  assert.ok(h.includes('Loans &amp; advances &lt;granted&gt;'), 'CARO topic not escaped');
  assert.ok(h.includes('Balance &lt; Rs 5 lakh &amp; unsecured.'), 'CARO remark not escaped');
});

// ── 5. All 21 CARO paragraphs number in roman ───────────────────────────────
check('all 21 CARO clauses number in lower roman, not arabic', () => {
  const clauses = Array.from({ length: 21 }, (_, i) => ({
    topic: `Clause ${i + 1}`, paragraph: `3(${i + 1})`, remark: 'No adverse remarks.',
  }));
  const h = buildReportHTML(analysis, { applicability: { applies: true }, clauses }, rf, false);
  for (const r of ['i)', 'x)', 'xi)', 'xv)', 'xx)', 'xxi)']) {
    assert.ok(h.includes(`${r} Clause`), `roman numeral "${r}" missing from Annexure A`);
  }
  assert.ok(!/>\s*11\) Clause/.test(h), 'clause 11 fell back to an arabic numeral');
  assert.ok(!/>\s*21\) Clause/.test(h), 'clause 21 fell back to an arabic numeral');
});

// ── 6. Missing company must not crash the click ─────────────────────────────
check('analysis without a company object renders placeholders instead of throwing', () => {
  const h = buildReportHTML({ keyMetrics: {} }, caroOff, rf, false);
  assert.ok(h.includes('[Company Name]'), 'company placeholder missing');
  assert.ok(h.includes('31 March, 20YY'), 'year-end placeholder missing');
});

console.log(failures === 0 ? '\nall report checks passed\n' : `\n${failures} report check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
