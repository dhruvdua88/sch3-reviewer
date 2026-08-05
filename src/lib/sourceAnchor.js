// ============ SOURCE ANCHORING ============
//
// After SCH3 analysis, each issue carries an evidenceQuote (≤30 words verbatim
// from the document) or the explicit "Disclosure not located..." marker.
//
// This module client-side-matches the evidenceQuote against the per-page text
// (captured by pdfExtract.js) and stamps each issue with `sourcePage` so the
// UI can offer a "View source" jump. We do NOT trust the LLM to know page
// numbers — page detection is purely string-matching against the extracted
// per-page text.
//
// Matching strategy (in order of strictness):
//   1. Exact case-insensitive substring of the quote on a single page.
//   2. Longest-overlap match: pick the page that contains the most consecutive
//      words from the quote (4+ word overlap required).
//   3. Token-overlap fallback: page with the most distinct 5+ char tokens from
//      the quote present. Returns null if score is too low.
//
// "Disclosure not located in the document" issues are explicitly NOT anchored —
// they have no source by definition.

const NOT_LOCATED_RX = /(disclosure not located|not located in the document|not present in the document|not found in the document)/i;

function normalise(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")  // smart quotes → straight
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenise(s) {
  return normalise(s)
    .split(/[^a-z0-9.]+/)
    .filter((t) => t.length >= 5 && !/^\d+$/.test(t));
}

// Normalise (and lazily tokenise) each page ONCE per anchoring run, instead of
// once per issue per page per strategy — with 60 issues over 40 pages that
// repeated work dominated anchoring time.
function prepPages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages
    .filter((p) => p && p.text)
    .map((p) => ({ pageNum: p.pageNum, norm: normalise(p.text), tokens: null, raw: p.text }));
}

function matchQuotePrepped(quote, prepped) {
  if (!quote || prepped.length === 0)  return null;
  if (NOT_LOCATED_RX.test(quote))      return null;

  const q = normalise(quote);
  if (q.length < 5) return null;

  // ── Strategy 1: exact case-insensitive substring ──
  for (const p of prepped) {
    if (p.norm.includes(q)) {
      return { pageNum: p.pageNum, matchedSpan: quote, confidence: 'exact' };
    }
  }

  // ── Strategy 2: longest consecutive-word overlap ──
  // Windows built once per size (not per page). Iteration order preserves the
  // original selection: largest window wins, ties go to the earliest page,
  // then the earliest window position within the quote.
  const qWords = q.split(' ').filter((w) => w.length > 0);
  for (let w = Math.min(qWords.length, 12); w >= 4; w--) {
    const slices = [];
    for (let i = 0; i + w <= qWords.length; i++) slices.push(qWords.slice(i, i + w).join(' '));
    for (const p of prepped) {
      for (const slice of slices) {
        if (p.norm.includes(slice)) {
          return { pageNum: p.pageNum, matchedSpan: slice, confidence: 'partial' };
        }
      }
    }
  }

  // ── Strategy 3: token-overlap fallback ──
  const qTokens = new Set(tokenise(quote));
  if (qTokens.size === 0) return null;
  let topPage = null;
  let topScore = 0;
  for (const p of prepped) {
    if (!p.tokens) p.tokens = new Set(tokenise(p.raw));
    let score = 0;
    qTokens.forEach((tok) => { if (p.tokens.has(tok)) score++; });
    if (score > topScore) {
      topScore = score;
      topPage  = p.pageNum;
    }
  }
  // Require at least 40% of the quote's distinct tokens to appear on the page.
  if (topPage && topScore >= Math.max(2, Math.ceil(qTokens.size * 0.4))) {
    return { pageNum: topPage, matchedSpan: quote, confidence: 'fuzzy' };
  }
  return null;
}

/**
 * For one evidenceQuote, find the best-matching page.
 *
 * @param {string} quote - the verbatim quote from the issue
 * @param {Array<{pageNum:number, text:string}>} pages - per-page plaintext
 * @returns {{pageNum:number, matchedSpan:string, confidence:string} | null}
 */
export function matchQuoteToPage(quote, pages) {
  if (!quote || !Array.isArray(pages) || pages.length === 0) return null;
  return matchQuotePrepped(quote, prepPages(pages));
}

/**
 * Stamp each SCH3 issue with sourcePage / sourceMatch fields (in-place — returns
 * a new analysis object). Issues that can't be anchored (or that are the
 * "Disclosure not located" type) get sourcePage: null.
 *
 * @param {object} analysis - sanitised SCH3 response
 * @param {Array<{pageNum, text}>} pages - per-page plaintext from extractor
 * @returns {object} analysis with anchored issues
 */
export function anchorIssuesToPages(analysis, pages) {
  if (!analysis || !Array.isArray(analysis.scheduleIIIIssues)) return analysis;
  const prepped = prepPages(pages);
  const anchored = analysis.scheduleIIIIssues.map((iss) => {
    if (!iss) return iss;
    const result = matchQuotePrepped(iss.evidenceQuote, prepped);
    if (!result) return { ...iss, sourcePage: null, sourceMatch: null };
    return {
      ...iss,
      sourcePage:  result.pageNum,
      sourceMatch: result.matchedSpan,
      sourceConfidence: result.confidence,
    };
  });
  return { ...analysis, scheduleIIIIssues: anchored };
}

/**
 * Given a page text and a matched span, return the surrounding context
 * (one paragraph before / after) for display in the source modal.
 */
export function extractSourceContext(pageText, matchedSpan, contextChars = 400) {
  if (!pageText || !matchedSpan) return { before: '', match: matchedSpan || '', after: '' };
  const normPage = pageText;
  const normSpan = matchedSpan;
  const idx = normPage.toLowerCase().indexOf(normSpan.toLowerCase());
  if (idx < 0) {
    return { before: '', match: normSpan, after: '' };
  }
  const start = Math.max(0, idx - contextChars);
  const end   = Math.min(normPage.length, idx + normSpan.length + contextChars);
  return {
    before: (start > 0 ? '…' : '') + normPage.slice(start, idx),
    match:  normPage.slice(idx, idx + normSpan.length),
    after:  normPage.slice(idx + normSpan.length, end) + (end < normPage.length ? '…' : ''),
  };
}
