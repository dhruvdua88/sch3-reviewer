// ============ SOURCE ANCHORING — selection-order lock ============
//
// anchorIssuesToPages was rewritten for speed (pages normalised once per run
// instead of once per issue per page per strategy). The rewrite flipped
// strategy 2 from page-major to window-major with an early return, which is
// only equivalent because the original guarded its update with
// `w > best.overlap`. That guard encodes the real contract:
//
//     largest consecutive-word window wins
//       → ties go to the earliest page
//         → ties go to the earliest window position in the quote
//
// These tests pin that ordering so a future "tidy-up" of the loop cannot
// silently start anchoring issues to the wrong page.
//
// Run: node test/sourceAnchor.test.mjs

import assert from 'node:assert/strict';
import { matchQuoteToPage, anchorIssuesToPages, extractSourceContext } from '../src/lib/sourceAnchor.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

const page = (pageNum, text) => ({ pageNum, text });

console.log('\nsource anchoring');

check('exact substring anchors to the containing page', () => {
  const pages = [
    page(1, 'Balance Sheet as at 31 March 2025'),
    page(2, 'Trade payables include dues to micro and small enterprises of Rs 4.20 lakh.'),
  ];
  const m = matchQuoteToPage('dues to micro and small enterprises', pages);
  assert.equal(m.pageNum, 2);
  assert.equal(m.confidence, 'exact');
});

check('case and smart-quote differences still match exactly', () => {
  const pages = [page(7, 'The Company’s BORROWINGS are secured by hypothecation of stock.')];
  const m = matchQuoteToPage("the company's borrowings are secured", pages);
  assert.equal(m.pageNum, 7);
  assert.equal(m.confidence, 'exact');
});

check('a larger window on a LATER page beats a smaller one on an earlier page', () => {
  // Page 1 matches a 4-word run; page 2 matches an 8-word run. Neither holds
  // the whole 10-word quote, so strategy 1 cannot fire and strategy 2 decides.
  // Page 2 must win — this is the case the original `w > best.overlap` guard
  // existed to handle, and the case a naive page-major early return breaks.
  const quote = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet';
  const pages = [
    page(1, 'prefix alpha bravo charlie delta zzz'),
    page(2, 'prefix alpha bravo charlie delta echo foxtrot golf hotel zzz'),
  ];
  const m = matchQuoteToPage(quote, pages);
  assert.equal(m.pageNum, 2, 'larger overlap must win regardless of page order');
  assert.equal(m.confidence, 'partial');
  assert.equal(m.matchedSpan, 'alpha bravo charlie delta echo foxtrot golf hotel');
});

check('equal window size ties break to the EARLIEST page', () => {
  const quote = 'alpha bravo charlie delta echo';
  const pages = [
    page(3, 'xx alpha bravo charlie delta echo yy'),
    page(4, 'xx alpha bravo charlie delta echo yy'),
  ];
  assert.equal(matchQuoteToPage(quote, pages).pageNum, 3);
});

check('within a page, the earliest window position wins', () => {
  // Both 4-word windows exist on the page; the span returned must be the
  // earliest one in the quote, not the last one tested.
  const quote = 'alpha bravo charlie delta echo';
  const pages = [page(1, 'bravo charlie delta echo ... alpha bravo charlie delta ...')];
  const m = matchQuoteToPage(quote, pages);
  assert.equal(m.matchedSpan, 'alpha bravo charlie delta', `got "${m.matchedSpan}"`);
});

check('token-overlap fallback fires when no 4-word run matches', () => {
  const quote = 'depreciation charged straight-line method useful lives prescribed';
  const pages = [
    page(1, 'Nothing relevant on this page whatsoever.'),
    page(2, 'Depreciation is provided; useful lives are prescribed; the method is straight-line.'),
  ];
  const m = matchQuoteToPage(quote, pages);
  assert.equal(m.pageNum, 2);
  assert.equal(m.confidence, 'fuzzy');
});

check('unrelated quote anchors nowhere rather than guessing', () => {
  const pages = [page(1, 'Balance Sheet as at 31 March 2025. Trade receivables 12,00,000.')];
  assert.equal(matchQuoteToPage('quantitative details of managerial remuneration paid abroad', pages), null);
});

check('"Disclosure not located" issues are never anchored', () => {
  const pages = [page(1, 'Disclosure not located in the document anywhere at all.')];
  assert.equal(matchQuoteToPage('Disclosure not located in the document', pages), null);
});

check('empty / missing pages are tolerated', () => {
  assert.equal(matchQuoteToPage('anything at all here', []), null);
  assert.equal(matchQuoteToPage('anything at all here', null), null);
  assert.equal(matchQuoteToPage('', [page(1, 'text')]), null);
  const withHoles = [page(1, ''), { pageNum: 2 }, null, page(3, 'trade payables ageing schedule disclosed')];
  assert.equal(matchQuoteToPage('trade payables ageing schedule', withHoles).pageNum, 3);
});

check('anchorIssuesToPages stamps every issue and never mutates the input', () => {
  const pages = [page(1, 'Trade payables ageing schedule has been disclosed in Note 8.')];
  const analysis = {
    company: { name: 'X' },
    scheduleIIIIssues: [
      { id: 'T1', evidenceQuote: 'Trade payables ageing schedule has been disclosed' },
      { id: 'T2', evidenceQuote: 'Disclosure not located in the document' },
      { id: 'T3', evidenceQuote: 'totally unrelated managerial remuneration wording' },
    ],
  };
  const before = JSON.stringify(analysis);
  const out = anchorIssuesToPages(analysis, pages);

  assert.equal(JSON.stringify(analysis), before, 'input analysis was mutated');
  assert.notEqual(out, analysis, 'must return a new object');
  assert.equal(out.scheduleIIIIssues[0].sourcePage, 1);
  assert.equal(out.scheduleIIIIssues[1].sourcePage, null, '"not located" must not anchor');
  assert.equal(out.scheduleIIIIssues[2].sourcePage, null);
  assert.equal(out.scheduleIIIIssues.length, 3, 'issue count changed');
});

check('page prep is shared across issues without cross-contaminating results', () => {
  // Guards the caching in prepPages: page 2's lazily-built token set must not
  // leak into page 1's score on the next issue.
  const pages = [
    page(1, 'Contingent liabilities not provided for include disputed income tax demands.'),
    page(2, 'Depreciation useful lives prescribed under Schedule II straight-line basis.'),
  ];
  const out = anchorIssuesToPages({
    scheduleIIIIssues: [
      { id: 'A', evidenceQuote: 'Contingent liabilities not provided for' },
      { id: 'B', evidenceQuote: 'Depreciation useful lives prescribed under Schedule II' },
      { id: 'C', evidenceQuote: 'Contingent liabilities not provided for' },
    ],
  }, pages);
  assert.equal(out.scheduleIIIIssues[0].sourcePage, 1);
  assert.equal(out.scheduleIIIIssues[1].sourcePage, 2);
  assert.equal(out.scheduleIIIIssues[2].sourcePage, 1, 'repeat issue drifted after page caching');
});

check('extractSourceContext returns the span with surrounding context', () => {
  const text = 'A'.repeat(50) + ' the disputed demand of Rs 12 lakh ' + 'B'.repeat(50);
  const ctx = extractSourceContext(text, 'disputed demand', 20);
  assert.equal(ctx.match, 'disputed demand');
  assert.ok(ctx.before.length > 0 && ctx.after.length > 0);
  const miss = extractSourceContext(text, 'not in there', 20);
  assert.equal(miss.before, '');
  assert.equal(miss.match, 'not in there');
});

console.log(failures === 0 ? '\nall source-anchor checks passed\n' : `\n${failures} source-anchor check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
