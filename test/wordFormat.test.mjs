// ============ WORD EXPORT FORMATTING — regression check ============
//
// Offline, no DeepSeek, no browser. Stubs the handful of DOM globals that
// downloadAsWord() touches (same pattern as test/report.test.mjs), then
// locks the shared Word shell added to fix "formatting is not nice":
//
//   1. Real page geometry (@page WordSection1) + Print Layout on open
//      (<w:View>Print</w:View>) instead of Word falling back to Web Layout.
//   2. A "Page X of Y" footer via MSO field codes, wrapped in an
//      [if gte mso 9] conditional comment so Google Docs / browsers drop it.
//   3. page-break-before on the two annexure headings and page-break-inside
//      avoidance on the signature block, so annexures start on a fresh page
//      and the signature never splits across a page boundary.
//   4. downloadAccountingPoliciesWord uses the SAME shell.
//
// None of this may touch a single character of the statutory SA 700 / CARO /
// Rule 11 / Annexure B prose — that is locked separately by test/report.test.mjs.
//
// Run: node test/wordFormat.test.mjs

import assert from 'node:assert/strict';

// ── DOM stubs (mirrors test/report.test.mjs) ─────────────────────────────
const downloads = [];

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
globalThis.Blob = class Blob {
  constructor(parts) { currentBody = parts.join(''); this.parts = parts; }
};

const { generateReport, buildReportHTML, downloadAccountingPoliciesWord } =
  await import('../src/lib/docExport.js');

// ── Fixtures ───────────────────────────────────────────────────────────────
const analysis = {
  company: { name: 'Acme Widgets Private Limited', cin: 'U12345DL2020PTC000001', yearEnd: '31 March 2025' },
  keyMetrics: { revenueLakhs: 6000 },   // >= 5000 → IFCoFR applies, Annexure B emitted
  scheduleIIIIssues: [],
};

const caroOn = {
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
  rule11e_text: '', rule11g_text: '',
};

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

console.log('\nword export formatting');

// ── 1. Page geometry + Print Layout ──────────────────────────────────────
const html = buildReportHTML(analysis, caroOn, rf, true);

check('report carries A4 @page geometry', () => {
  assert.ok(html.includes('@page WordSection1'), 'missing @page WordSection1 rule');
  assert.ok(html.includes('595.3pt 841.9pt'), 'missing A4 page size');
});

check('report footer wired via mso-footer + mso-element:footer', () => {
  assert.ok(html.includes('mso-footer: f1'), 'missing mso-footer: f1 in @page rule');
  assert.ok(html.includes('mso-element:footer'), 'missing footer div mso-element');
  assert.ok(html.includes('id="f1"'), 'footer div id does not match @page mso-footer target');
});

check('footer uses PAGE / NUMPAGES field codes', () => {
  assert.ok(html.includes('PAGE'), 'missing PAGE field code');
  assert.ok(html.includes('NUMPAGES'), 'missing NUMPAGES field code');
  assert.ok(html.includes('mso-element:field-begin'), 'missing field-begin marker');
  assert.ok(html.includes('mso-element:field-separator'), 'missing field-separator marker');
  assert.ok(html.includes('mso-element:field-end'), 'missing field-end marker');
});

check('body is wrapped in div.WordSection1', () => {
  assert.ok(html.includes('class="WordSection1"'), 'missing class="WordSection1" wrapper');
});

check('head forces Print Layout on open', () => {
  assert.ok(html.includes('<w:View>Print</w:View>'), 'missing <w:View>Print</w:View> — Word will open in Web Layout');
});

// ── 2. Footer sits inside an [if gte mso 9] conditional comment ─────────
check('footer markup is inside an [if gte mso 9] conditional comment', () => {
  const openIdx = html.indexOf('<!--[if gte mso 9]>');
  assert.ok(openIdx !== -1, 'no [if gte mso 9] conditional comment found');
  // Find the conditional block that actually contains the footer div.
  const footerIdx = html.indexOf('mso-element:footer');
  assert.ok(footerIdx !== -1, 'footer div not found at all');
  const precedingOpen = html.lastIndexOf('<!--[if gte mso 9]>', footerIdx);
  const followingClose = html.indexOf('<![endif]-->', footerIdx);
  assert.ok(precedingOpen !== -1 && precedingOpen < footerIdx,
    'footer div is not preceded by an [if gte mso 9] opening comment');
  assert.ok(followingClose !== -1,
    'footer div is not followed by a closing <![endif]--> comment');
});

// ── 3. Page breaks: annexures start fresh, signature block never splits ──
check('CARO on + IFCoFR on → at least 2 page-break-before:always occurrences', () => {
  const count = (html.match(/page-break-before:always/g) || []).length;
  assert.ok(count >= 2, `expected >= 2 page-break-before:always, got ${count}`);
});

check('signature block carries page-break-inside:avoid', () => {
  assert.ok(html.includes('page-break-inside:avoid'), 'missing page-break-inside:avoid on signature block');
  assert.ok(html.includes('class="sig-block"'), 'signature table missing class="sig-block"');
});

// ── 4. downloadAccountingPoliciesWord uses the same shell, one download ──
check('downloadAccountingPoliciesWord triggers exactly one download with expected filename', () => {
  downloads.length = 0;
  downloadAccountingPoliciesWord(
    { noteTitle: 'Note 2 — Significant Accounting Policies', introText: 'Intro.', subPolicies: [{ heading: 'PPE', body: 'Body text.' }] },
    { name: 'Acme Widgets Private Limited' },
    rf,
  );
  assert.equal(downloads.length, 1, `expected 1 download, got ${downloads.length}`);
  assert.match(downloads[0].name, /_Accounting_Policies_Note\.doc$/);
});

check('accounting policies Word body carries the shared page shell and no literal "undefined"', () => {
  const body = downloads[0].body;
  assert.ok(body.includes('@page WordSection1'), 'accounting policies export missing @page WordSection1');
  assert.ok(!body.includes('undefined'), 'literal "undefined" leaked into accounting policies export');
});

// ── 5. Statutory wording is untouched — spot-check exact SA 700 sentences ─
check('no statutory-wording regression — SA 700 sentences survive verbatim', () => {
  for (const s of [
    'We have audited the accompanying standalone financial statements of',
    'We conducted our audit of the standalone financial statements in accordance with the Standards on Auditing specified under Section 143(10) of the Act ("SAs").',
    'As required by Section 143(3) of the Act, based on our audit, we report that:',
    'As required by the Companies (Auditor\'s Report) Order, 2020 ("the Order"), issued by the Central Government in terms of Section 143(11) of the Act, we give in',
    'We have audited the internal financial controls with reference to financial statements of',
  ]) {
    assert.ok(html.includes(s), `statutory sentence missing/altered: "${s}"`);
  }
});

// ── 6. generateReport() side-effect contract is unaffected by the shell ──
check('generateReport still triggers exactly one download and returns undefined', () => {
  downloads.length = 0;
  const ret = generateReport(analysis, caroOn, rf);
  assert.equal(downloads.length, 1, `expected 1 download, got ${downloads.length}`);
  assert.equal(ret, undefined, 'generateReport must return undefined');
  assert.ok(!downloads[0].body.includes('undefined'), 'literal "undefined" leaked into report export');
});

console.log(failures === 0 ? '\nall word-format checks passed\n' : `\n${failures} word-format check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
