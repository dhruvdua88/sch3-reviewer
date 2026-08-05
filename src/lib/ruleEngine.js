// ============ RULE ENGINE — DETERMINISTIC SCHEDULE III CHECKER ============
//
// Runs the rule-definitions catalogue + arithmetic / tie-out checks
// against the extracted markdown. Returns a payload in the same shape
// as DeepSeek so downstream UI and exports don't need to differentiate.
//
// Tagging:
//   - Every issue from this module carries source: 'rule'.
//   - When the orchestrator later merges with a DeepSeek run, the merge
//     promotes shared-test-ID issues to source: 'rule+ai'.

import {
  extractMetricsFromText,
  parseIndianAmount,
  approxEqual,
  isValidCIN,
} from './metricsExtract.js';
import { runKeywordRules } from '../data/ruleDefinitions.js';

// ════════════════════════════════════════════════════════════
// ARITHMETIC CHECKS — coded as dedicated functions
// ════════════════════════════════════════════════════════════

// R-T01 — Tax–PBT alignment.
// If PBT > 0 we expect either (a) current tax > 0, or (b) explicit MAT /
// Sec 80-IAC / 115BAA-BAB / brought-forward-loss / exempt-income mention.
function checkTaxPBTAlignment(markdown, metrics) {
  if (metrics.profitBeforeTaxLakhs == null) return null;
  if ((metrics.profitBeforeTaxLakhs ?? 0) <= 0) return null;
  if ((metrics.currentTaxLakhs ?? 0) > 0) return null;

  const exemptMentions = /(?:section\s+115\s*BA[ABC]|section\s+80[\s-]*IAC|minimum\s+alternate\s+tax|\bMAT\b|brought\s+forward\s+(?:loss|losses)|unabsorbed\s+depreciation|tax\s+holiday|exempt\s+income)/i;
  if (exemptMentions.test(markdown)) return null;

  return {
    id: 'T01', section: 'A', severity: 'CRITICAL', category: 'Computation',
    title: 'Profit before tax positive but current tax is nil',
    observation: `PBT of Rs ${metrics.profitBeforeTaxLakhs.toFixed(2)} lakhs reported, yet current tax expense detected as Rs ${(metrics.currentTaxLakhs ?? 0).toFixed(2)} lakhs. No MAT / Sec 115BAA-BAB / 80-IAC / brought-forward-loss mention located.`,
    evidenceQuote: `Computed from extracted figures · PBT ${metrics.profitBeforeTaxLakhs.toFixed(2)} L vs Current tax ${(metrics.currentTaxLakhs ?? 0).toFixed(2)} L`,
    noteRef: 'Statement of Profit & Loss',
    implication: 'Likely under-provision of current tax OR missing rationale for nil tax.',
    recommendation: 'Cross-check the tax computation against the books; if exempt, disclose the basis in the Tax Note.',
    source: 'rule',
  };
}

// R-T03 — Cash flow tie-back. Opening − Closing should equal CFS net change.
function checkCashFlowTieBack(markdown) {
  // Try to find the three figures from a CFS extract.
  const openingMatch = markdown.match(/cash\s+and\s+cash\s+equivalents\s+at\s+the\s+beginning[^\n]{0,80}?([\d,]+(?:\.\d+)?)/i);
  const closingMatch = markdown.match(/cash\s+and\s+cash\s+equivalents\s+at\s+the\s+end[^\n]{0,80}?([\d,]+(?:\.\d+)?)/i);
  const netChangeMatch = markdown.match(/net\s+(?:increase|decrease|change)\s+in\s+cash[^\n]{0,80}?\(?([\d,]+(?:\.\d+)?)\)?/i);
  if (!openingMatch || !closingMatch || !netChangeMatch) return null;

  const opening   = parseIndianAmount(openingMatch[1]);
  const closing   = parseIndianAmount(closingMatch[1]);
  const netChange = parseIndianAmount(netChangeMatch[1]);
  if (opening == null || closing == null || netChange == null) return null;

  const implied = closing - opening;
  if (approxEqual(implied, netChange, { absTol: 1, relTol: 0.005 })) return null;

  return {
    id: 'T03', section: 'A', severity: 'CRITICAL', category: 'Computation',
    title: 'Cash Flow Statement does not tie to Balance Sheet',
    observation: `Opening cash + net change should equal closing. Computed implied net change ${implied.toFixed(2)} vs disclosed net change ${netChange.toFixed(2)}. Variance ${(implied - netChange).toFixed(2)}.`,
    evidenceQuote: `Opening ${opening.toFixed(2)} · Closing ${closing.toFixed(2)} · Net change ${netChange.toFixed(2)}`,
    noteRef: 'Cash Flow Statement',
    implication: 'CFS arithmetic does not reconcile to the Balance Sheet cash balance.',
    recommendation: 'Recompute the CFS net-change row; verify it ties to (Closing − Opening) cash and cash equivalents.',
    source: 'rule',
  };
}

// Balance Sheet balancing — Total Assets = Total Equity + Liabilities.
function checkBalanceSheetBalance(metrics) {
  const ta = metrics.totalAssetsLakhs;
  const tel = metrics.totalEquityAndLiabilitiesLakhs;
  if (ta == null || tel == null) return null;
  if (approxEqual(ta, tel, { absTol: 1, relTol: 0.005 })) return null;

  return {
    id: 'R-BS-BAL', section: 'A', severity: 'CRITICAL', category: 'Computation',
    title: 'Balance Sheet does not balance',
    observation: `Total Assets ${ta.toFixed(2)} L vs Total Equity + Liabilities ${tel.toFixed(2)} L. Difference ${(ta - tel).toFixed(2)} L.`,
    evidenceQuote: 'Computed from extracted face-of-Balance-Sheet figures.',
    noteRef: 'Balance Sheet',
    implication: 'Fundamental FS integrity break. Typically a sub-total typo or a misclassified line.',
    recommendation: 'Re-foot the Balance Sheet; reconcile every sub-total against the Trial Balance.',
    source: 'rule',
  };
}

// Comparative-year presence — every BS / P&L should have two columns of figures.
function checkComparativePresence(markdown) {
  // Heuristic — look for "As at <date>" appearing at least twice, OR a column
  // header pair like "31 March 20XX" + "31 March 20XY".
  const dateColumns = (markdown.match(/(?:31|31st)\s+march\s+\d{4}/gi) || []).length;
  if (dateColumns >= 2) return null;

  return {
    id: 'R-COMP', section: 'C', severity: 'MEDIUM', category: 'Presentation',
    title: 'Comparative period columns may be missing',
    observation: `Only ${dateColumns} reporting-date column header(s) detected. Schedule III requires comparative figures for every line on the BS, P&L, CFS and notes.`,
    evidenceQuote: 'Heuristic — counted "31 March YYYY" header occurrences.',
    noteRef: 'Sch III Div I — Comparative figures',
    implication: 'If comparatives are absent, the FS are not Schedule III compliant.',
    recommendation: 'Confirm both reporting periods are presented; if first reporting year, add the standard note explaining absence of comparatives.',
    source: 'rule',
  };
}

// CIN format validity.
function checkCINFormat(company) {
  if (!company.cin) return null;
  if (isValidCIN(company.cin)) return null;
  return {
    id: 'R-CIN', section: 'E', severity: 'LOW', category: 'Presentation',
    title: 'CIN does not match Companies Act format',
    observation: `Extracted CIN "${company.cin}" does not match the canonical [L/U/F]##### + state(2) + year(4) + class(3) + reg(6) format.`,
    evidenceQuote: company.cin,
    noteRef: 'Sec 7, Companies Act 2013',
    implication: 'Likely typo in cover sheet or Notes to FS.',
    recommendation: 'Re-verify the CIN against the MCA master data and correct in every page where it appears.',
    source: 'rule',
  };
}

// R-T06 — Reserves arithmetic. Opening + additions ± transfers − distributions = closing.
function checkReservesArithmetic(markdown) {
  // Detect a "Reserves and Surplus" movement block where opening and closing
  // are stated. Conservative — only fires when both year-end totals AND a
  // "Profit for the year" line are present.
  const block = markdown.match(/reserves?\s+and\s+surplus[\s\S]{0,3000}?(?:total|closing\s+balance)/i);
  if (!block) return null;
  const opening = block[0].match(/opening\s+balance[^\n]{0,40}?([\d,]+(?:\.\d+)?)/i);
  const closing = block[0].match(/closing\s+balance[^\n]{0,40}?([\d,]+(?:\.\d+)?)/i);
  const profit  = block[0].match(/profit\s+for\s+the\s+year[^\n]{0,40}?([\d,]+(?:\.\d+)?)/i);
  if (!opening || !closing || !profit) return null;

  const o = parseIndianAmount(opening[1]);
  const c = parseIndianAmount(closing[1]);
  const p = parseIndianAmount(profit[1]);
  if (o == null || c == null || p == null) return null;

  // Allow ±5% slack — the surplus has dividends/transfers/tax-on-dividends.
  const implied = o + p;
  const diff = c - implied;
  // We only flag when the variance is > 20% AND > 50 lakhs absolute
  // (otherwise too many false positives from un-extracted transfers).
  if (Math.abs(diff) <= Math.max(50, Math.abs(implied) * 0.2)) return null;

  return {
    id: 'T06', section: 'A', severity: 'HIGH', category: 'Computation',
    title: 'Reserves & Surplus movement does not reconcile',
    observation: `Opening + profit ≈ ${implied.toFixed(2)} L but closing ${c.toFixed(2)} L. Unexplained variance ${diff.toFixed(2)} L — typically transfers, dividends, OCI or appropriations that should be visible in the movement schedule.`,
    evidenceQuote: `Opening ${o.toFixed(2)} · Profit ${p.toFixed(2)} · Closing ${c.toFixed(2)}`,
    noteRef: 'Reserves & Surplus note',
    implication: 'Movement schedule omits or misstates transfers / dividends / appropriations.',
    recommendation: 'Expand the Reserves & Surplus movement to disclose every reconciling line between opening and closing.',
    source: 'rule',
  };
}

// Within-note arithmetic — try to detect a note whose components don't add
// to the "Total" stated on the same note. This is a soft check using simple
// table-row pattern matching; only fires when extraction confidence is high.
function checkWithinNoteArithmetic(markdown) {
  const issues = [];
  // Match note blocks like "Note 5\n... line items ...\nTotal  1,234"
  // Limited to the first ~50 notes to bound work.
  const noteBlocks = markdown.split(/\n(?=Note\s+\d+\b|\d+\.\s+[A-Z])/g).slice(0, 50);
  for (const block of noteBlocks) {
    const totalMatch = block.match(/(?:^|\n)\s*Total\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*$/im);
    if (!totalMatch) continue;
    const stated = parseIndianAmount(totalMatch[1]);
    if (stated == null) continue;

    // Pull every line that ends with a single rupee figure (excluding the Total line).
    const lineRe = /^([^\n|]+?)\s+([\d,]+(?:\.\d+)?)\s*$/gim;
    const components = [];
    let m;
    while ((m = lineRe.exec(block)) !== null) {
      const label = m[1].trim();
      const amt = parseIndianAmount(m[2]);
      if (label.toLowerCase().startsWith('total')) continue;
      if (amt == null) continue;
      components.push(amt);
    }
    if (components.length < 2) continue;

    const sum = components.reduce((a, b) => a + b, 0);
    if (approxEqual(sum, stated, { absTol: 1, relTol: 0.005 })) continue;

    // Conservative — only flag when there's a clear mismatch.
    if (Math.abs(sum - stated) <= 5) continue;

    const heading = (block.split('\n')[0] || '').slice(0, 60).trim();
    issues.push({
      id: `R-NOTE-${issues.length + 1}`,
      section: 'A', severity: 'HIGH', category: 'Computation',
      title: `Note totals do not foot — "${heading}"`,
      observation: `Detected line-item sum ${sum.toFixed(2)} vs stated total ${stated.toFixed(2)}. Variance ${(sum - stated).toFixed(2)}.`,
      evidenceQuote: `Heading: ${heading}`,
      noteRef: heading,
      implication: 'Note arithmetic does not foot to the disclosed total.',
      recommendation: 'Re-foot the note; reconcile each component to source records.',
      source: 'rule',
    });
    // Bound output to first 5 such issues to avoid drowning the reviewer.
    if (issues.length >= 5) break;
  }
  return issues;
}

// Opening = prior-year closing — for movement schedules.
function checkOpeningEqualsPriorClosing(markdown) {
  const issues = [];
  // We look for two-column movement schedules where each column has both
  // "Opening balance" and "Closing balance" — current column's opening
  // should equal previous column's closing.
  //
  // This is best-effort. Tally-generated PDFs preserve the column order;
  // some templates reverse it.
  const movementBlocks = [
    /reserves?\s+and\s+surplus[\s\S]{0,2000}/i,
    /property,?\s+plant\s+and\s+equipment[\s\S]{0,3000}/i,
    /(?:capital|securities\s+premium)\s+reserve[\s\S]{0,1500}/i,
  ];

  for (const blockRe of movementBlocks) {
    const block = markdown.match(blockRe);
    if (!block) continue;
    const openingMatches = [...block[0].matchAll(/opening\s+balance[^\n]{0,40}?([\d,]+(?:\.\d+)?)/gi)];
    const closingMatches = [...block[0].matchAll(/closing\s+balance[^\n]{0,40}?([\d,]+(?:\.\d+)?)/gi)];

    if (openingMatches.length < 1 || closingMatches.length < 2) continue;
    // Heuristic — first opening (current year) should equal second closing (prior year).
    const currentOpening = parseIndianAmount(openingMatches[0][1]);
    const priorClosing   = parseIndianAmount(closingMatches[1][1]);
    if (currentOpening == null || priorClosing == null) continue;
    if (approxEqual(currentOpening, priorClosing, { absTol: 1, relTol: 0.005 })) continue;
    if (Math.abs(currentOpening - priorClosing) <= 5) continue;

    const heading = (block[0].split('\n')[0] || '').slice(0, 60).trim();
    issues.push({
      id: `R-OPENCLOSE-${issues.length + 1}`,
      section: 'A', severity: 'HIGH', category: 'Computation',
      title: `Opening balance does not equal prior-year closing — "${heading}"`,
      observation: `Current-year opening ${currentOpening.toFixed(2)} vs prior-year closing ${priorClosing.toFixed(2)}. Variance ${(currentOpening - priorClosing).toFixed(2)}.`,
      evidenceQuote: `Heading: ${heading}`,
      noteRef: heading,
      implication: 'Comparatives may have been restated without disclosure, or there is a roll-forward error.',
      recommendation: 'Either restate prior year explicitly in a reclassification note, or correct the current-year opening to tie to prior year.',
      source: 'rule',
    });
  }
  return issues;
}

// Notes-to-face tie-out — for major BS lines, the face figure should equal
// the corresponding note total. Limited to a few high-confidence pairs.
function checkNotesToFaceTieOut(markdown, metrics) {
  const issues = [];

  const pairs = [
    {
      faceLabel: 'Property, Plant and Equipment',
      faceValue: metrics.fixedAssetsLakhs,
      noteRe:    /property,?\s+plant\s+(?:and|&)\s+equipment[\s\S]{0,3000}?(?:total|net\s+block)[^\n]{0,40}?([\d,]+(?:\.\d+)?)/i,
      testId:    'R-TIE-PPE',
    },
    {
      faceLabel: 'Trade Receivables',
      faceValue: metrics.tradeReceivablesLakhs,
      noteRe:    /trade\s+receivables?[\s\S]{0,2000}?total[^\n]{0,40}?([\d,]+(?:\.\d+)?)/i,
      testId:    'R-TIE-TR',
    },
    {
      faceLabel: 'Inventories',
      faceValue: metrics.inventoriesLakhs,
      noteRe:    /inventor(?:y|ies)[\s\S]{0,1500}?total[^\n]{0,40}?([\d,]+(?:\.\d+)?)/i,
      testId:    'R-TIE-INV',
    },
    {
      faceLabel: 'Reserves and Surplus',
      faceValue: metrics.reservesLakhs,
      noteRe:    /reserves?\s+(?:and|&)\s+surplus[\s\S]{0,2000}?total[^\n]{0,40}?([\d,]+(?:\.\d+)?)/i,
      testId:    'R-TIE-RES',
    },
  ];

  // metrics.faceValue is already in lakhs; the note figures are not normalised.
  // Detect the document rounding ONCE — it was previously recomputed inside the
  // loop, re-scanning the whole markdown up to 16 times per run.
  // (We trust the same rounding applies throughout the PDF.)
  const rounding = (markdown.match(/(rs?\.?|rupees?|amount(?:s)?)\s+in\s+crores?/i)) ? 100
                 : (markdown.match(/(rs?\.?|rupees?|amount(?:s)?)\s+in\s+lakhs?/i)) ? 1
                 : (markdown.match(/(rs?\.?|rupees?|amount(?:s)?)\s+in\s+millions?/i)) ? 10
                 : (markdown.match(/(rs?\.?|rupees?|amount(?:s)?)\s+in\s+thousands?/i)) ? 0.01
                 : 0.00001;

  for (const p of pairs) {
    if (p.faceValue == null) continue;
    const m = markdown.match(p.noteRe);
    if (!m) continue;
    const noteTotal = parseIndianAmount(m[1]);
    if (noteTotal == null) continue;

    const noteInLakhs = noteTotal * rounding;

    if (approxEqual(noteInLakhs, p.faceValue, { absTol: 1, relTol: 0.01 })) continue;
    // Skip when both figures are tiny — likely a parsing artifact.
    if (Math.abs(p.faceValue) < 10) continue;

    issues.push({
      id: p.testId,
      section: 'A', severity: 'HIGH', category: 'Computation',
      title: `Note total does not tie to face of Balance Sheet — ${p.faceLabel}`,
      observation: `Face of BS shows ${p.faceLabel} Rs ${p.faceValue.toFixed(2)} L, but the corresponding note total computes to Rs ${noteInLakhs.toFixed(2)} L. Variance Rs ${(p.faceValue - noteInLakhs).toFixed(2)} L.`,
      evidenceQuote: `Note total raw: ${noteTotal.toFixed(2)}; rounding factor inferred: ${rounding}`,
      noteRef: p.faceLabel,
      implication: 'Face / note mismatch — usually a sub-total typo or stale note version.',
      recommendation: `Reconcile the ${p.faceLabel} note total against the face of the Balance Sheet.`,
      source: 'rule',
    });
  }

  return issues;
}

// ════════════════════════════════════════════════════════════
// MAIN ENTRY
// ════════════════════════════════════════════════════════════

/**
 * Run the deterministic rule engine over the extracted markdown.
 *
 * @param {string} markdown
 * @returns {{
 *   company: object,
 *   keyMetrics: object,
 *   scheduleIIIIssues: Array,
 *   rounding: object,
 *   extractionConfidence: object,
 *   summary: { totalChecks: number, issuesEmitted: number }
 * }}
 */
export function runRuleEngine(markdown) {
  if (!markdown || typeof markdown !== 'string' || markdown.trim().length === 0) {
    return {
      company:           {},
      keyMetrics:        { isHoldingOrSubOfPublicCo: false },
      scheduleIIIIssues: [],
      rounding:          { unit: 'absolute', factorToLakhs: 0.00001 },
      extractionConfidence: {},
      summary:           { totalChecks: 0, issuesEmitted: 0 },
    };
  }

  const { company, keyMetrics, rounding, confidence } = extractMetricsFromText(markdown);

  const issues = [];

  // 1. Keyword-based catalogue checks (Section B + C + E disclosures)
  issues.push(...runKeywordRules(markdown));

  // 2. Arithmetic checks (Section A)
  const taxCheck = checkTaxPBTAlignment(markdown, keyMetrics);
  if (taxCheck) issues.push(taxCheck);

  const cfsCheck = checkCashFlowTieBack(markdown);
  if (cfsCheck) issues.push(cfsCheck);

  const reservesCheck = checkReservesArithmetic(markdown);
  if (reservesCheck) issues.push(reservesCheck);

  // 3. Structural checks
  const bsBalCheck = checkBalanceSheetBalance(keyMetrics);
  if (bsBalCheck) issues.push(bsBalCheck);

  const compCheck = checkComparativePresence(markdown);
  if (compCheck) issues.push(compCheck);

  const cinCheck = checkCINFormat(company);
  if (cinCheck) issues.push(cinCheck);

  // 4. Tie-out checks (the new ones the user asked for)
  issues.push(...checkWithinNoteArithmetic(markdown));
  issues.push(...checkOpeningEqualsPriorClosing(markdown));
  issues.push(...checkNotesToFaceTieOut(markdown, keyMetrics));

  // Sort by severity (matches AI prompt's sort order)
  const SEV_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  issues.sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));

  // Default company fields so the existing UI doesn't crash on missing values
  const finalCompany = {
    name:                 company.name        || 'Unknown Company',
    cin:                  company.cin         || '',
    yearEnd:              company.yearEnd     || '',
    incorporationDate:    '',
    registeredAddress:    '',
    natureOfBusiness:     '',
    isFirstYear:          false,
    auditFirm:            '',
    auditFirmFRN:         '',
  };

  // Total checks attempted = catalogue length + 9 arithmetic/structural/tie-out checks
  const totalChecks = 16 + 9;  // keyword (16) + arithmetic + structural + tie-outs

  return {
    company:           finalCompany,
    keyMetrics,
    scheduleIIIIssues: issues,
    rounding,
    extractionConfidence: confidence,
    summary:           { totalChecks, issuesEmitted: issues.length },
  };
}

/**
 * Merge a DeepSeek (AI) analysis with a previous rule-engine result.
 * Rule-engine findings win on tests they cover (more reliable, deterministic);
 * AI fills the remaining tests. Tags merged issues with source 'rule+ai'
 * when both layers found the same test.
 *
 * @param {object} ruleResult  — output of runRuleEngine
 * @param {object} aiResult    — DeepSeek JSON (post-sanitise, post-anchor)
 * @returns {object} merged analysis (same shape as DeepSeek output)
 */
export function mergeAnalyses(ruleResult, aiResult) {
  if (!aiResult || !Array.isArray(aiResult.scheduleIIIIssues)) {
    return ruleResult;
  }
  if (!ruleResult || !Array.isArray(ruleResult.scheduleIIIIssues)) {
    // Stamp AI issues with source for consistency
    return {
      ...aiResult,
      scheduleIIIIssues: aiResult.scheduleIIIIssues.map((i) => ({ ...i, source: i.source || 'ai' })),
    };
  }

  const ruleById = new Map();
  ruleResult.scheduleIIIIssues.forEach((iss) => {
    if (iss?.id) ruleById.set(iss.id, iss);
  });

  const out = [];
  const seenIds = new Set();

  // Start with all rule-engine issues
  ruleResult.scheduleIIIIssues.forEach((iss) => {
    out.push({ ...iss, source: 'rule' });
    if (iss.id) seenIds.add(iss.id);
  });

  // Add AI issues, marking duplicates
  aiResult.scheduleIIIIssues.forEach((iss) => {
    if (!iss) return;
    if (iss.id && seenIds.has(iss.id)) {
      // Both layers caught it. Upgrade the existing rule issue to rule+ai
      // and keep the richer AI observation.
      const idx = out.findIndex((x) => x.id === iss.id);
      if (idx >= 0) {
        out[idx] = {
          ...out[idx],
          source: 'rule+ai',
          // AI usually has richer prose — promote AI fields where present.
          observation:    iss.observation    || out[idx].observation,
          implication:    iss.implication    || out[idx].implication,
          recommendation: iss.recommendation || out[idx].recommendation,
          evidenceQuote:  iss.evidenceQuote  || out[idx].evidenceQuote,
          noteRef:        iss.noteRef        || out[idx].noteRef,
          // Keep rule engine's severity (deterministic) but AI's title (richer phrasing)
          title:          iss.title          || out[idx].title,
        };
      }
    } else {
      out.push({ ...iss, source: 'ai' });
      if (iss.id) seenIds.add(iss.id);
    }
  });

  // Re-sort by severity
  const SEV_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  out.sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));

  // Prefer AI's company / keyMetrics (richer) but fall back to rule extraction.
  return {
    company:           { ...ruleResult.company, ...(aiResult.company || {}) },
    keyMetrics:        { ...ruleResult.keyMetrics, ...(aiResult.keyMetrics || {}) },
    scheduleIIIIssues: out,
  };
}
