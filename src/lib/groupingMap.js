// ============ GROUPING MAPPER — engine ============
//
// Takes a Schedule III Automation Tool trial-balance ("T_B" style) — either
// pasted as TSV or read from an .xlsx/.xlsm/.csv — and, for every ledger,
// proposes a clean three-level grouping that is PASTEABLE straight back into
// the tool's data-validated columns:
//
//     Face Grouping   (Level 1)  — must equal a Drop_List head  (FACE_HEADS)
//     Note Grouping   (Level 2)  — must equal a Drop_List note   (NOTES_BY_FACE)
//     Sub-Note Group  (Level 3)  — free presentation label the AI drafts so the
//                                  face of the balance sheet reads well
//
// The Face/Note come from the tool's OWN dependent-dropdown vocabulary
// (extracted from the workbook's data-validation named ranges), so a paste
// never breaks the workbook's validations. Sub-Note is free text (no dropdown).
//
// AI is used ONLY for judgement (which head, which note, and how to group
// similar ledgers into a tidy sub-note). Everything else is mechanical.
//
// NOT for: reading the whole .xlsb binary workbook (ExcelJS can't) — the user
// copies the T_B columns or saves the sheet as .xlsx. Paste is the primary path.

import { callDeepSeek, AuthError, ApiError } from './deepseek.js';

// A chunk error that will recur on every chunk (bad key, no credits, user abort)
// should ABORT the whole run with a clear message, not silently degrade every
// row to "review". Transient/per-chunk errors (timeout, one bad response, a 5xx)
// degrade that chunk only.
export function isFatalRunError(err) {
  if (err?.name === 'AbortError') return true;                 // user cancelled
  if (err instanceof AuthError) return true;                   // bad/expired key
  if (err?.name === 'AuthError') return true;                  // (cross-realm safety)
  if (err instanceof ApiError && err.status === 402) return true; // out of credits
  if (err?.status === 402) return true;
  return false;
}
import {
  FACE_HEADS, NOTES_BY_FACE, canonicalFace, canonicalNote,
} from '../data/sch3Vocab.js';

// ---- Column detection ---------------------------------------------------
// Header aliases (lower-cased, spaces collapsed) → canonical field.
const HEADER_ALIASES = {
  'name of ledger': 'ledger', 'ledger': 'ledger', 'ledger name': 'ledger',
  'particulars': 'ledger', 'account': 'ledger', 'account name': 'ledger',
  'system primary grouping': 'sysPrimary', 'system parent grouping': 'sysParent',
  'group': 'sysPrimary', 'primary group': 'sysPrimary', 'parent group': 'sysParent',
  'face grouping_current year': 'face', 'face grouping': 'face',
  'face grouping current year': 'face', 'face': 'face',
  'note grouping_current year': 'note', 'note grouping': 'note',
  'note grouping current year': 'note', 'note': 'note',
  'sub-note grouping_current year': 'subNote', 'sub-note grouping': 'subNote',
  'sub note grouping': 'subNote', 'subnote': 'subNote', 'sub-note': 'subNote',
  // Previous-year grouping — used for a year-over-year consistency check.
  'face grouping_previous year': 'pyFace', 'face grouping previous year': 'pyFace',
  'note grouping_previous year': 'pyNote', 'note grouping previous year': 'pyNote',
  // Explicit amount header (optional — the real T_B uses a date header, so amount
  // is normally found by numeric probing; these just let a labelled column win).
  'amount': 'amount', 'amount cy': 'amount', 'amount current year': 'amount',
  'balance': 'amount', 'closing balance': 'amount', 'net amount': 'amount',
};

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// A row whose ledger cell is an UNAMBIGUOUS total/subtotal/balance marker from a
// raw TB export — matched by exact (normalised) label so real ledgers that merely
// start with "Total"/"Opening" (e.g. "Total Systems Pvt Ltd") are never dropped.
const _SUMMARY_ROWS = new Set([
  'total', 'grand total', 'sub total', 'subtotal', 'sub-total', 'net total',
  'opening balance', 'closing balance', 'difference in opening balance',
  'total dr', 'total cr', 'total debit', 'total credit', 'balance c/f', 'balance b/f',
]);
export function isSummaryRow(ledger) {
  return _SUMMARY_ROWS.has(norm(ledger).replace(/[:]+$/, '').trim());
}

// Parse an amount robustly. Handles "(1,234.50)" (bracket-negative), a leading OR
// symbol-preceded minus ("-1234.5", "₹ -45,000", "Rs. -1000"), Indian digit
// grouping, currency symbols/words (₹ $ € £ Rs INR), and Tally's Cr/Dr suffix
// convention (credit = negative, debit = positive). The SIGN matters — it drives
// the asset/liability sign checks — so a symbol before the minus must not flip it.
function parseAmt(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/,/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  const isDr = /\bdr\b/i.test(s);                 // explicit debit overrides to positive
  if (/\bcr\b/i.test(s)) neg = true;              // "45000 Cr" = credit = negative
  s = s.replace(/[₹$€£]|\brs\.?|\binr\b|\bcr\b|\bdr\b/gi, '').trim();
  if (s.includes('-')) neg = true;               // minus anywhere (after symbol strip)
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (!isFinite(n)) return null;
  return (neg && !isDr) ? -n : n;
}

/**
 * Parse a raw 2-D grid (array of arrays) into structured ledger rows.
 * Auto-detects the header row (the first row that contains a "ledger" column),
 * then maps known columns by alias. Rows with a non-empty ledger name are kept.
 *
 * If NO recognisable header is found, falls back to: col0 = ledger,
 * col1 = amount (single-column paste of ledger names also works).
 *
 * @returns {{ rows: Array, cols: object, headerRow: number, amountCol: number|null }}
 */
export function parseGrid(grid) {
  if (!Array.isArray(grid) || grid.length === 0) {
    return { rows: [], cols: {}, headerRow: -1, amountCol: null };
  }

  // Find header row = row with the most alias hits, must include a 'ledger'.
  let headerRow = -1, best = {};
  const scan = Math.min(grid.length, 15);
  for (let r = 0; r < scan; r++) {
    const map = {};
    (grid[r] || []).forEach((cell, c) => {
      const key = HEADER_ALIASES[norm(cell)];
      if (key && map[key] === undefined) map[key] = c;
    });
    if (map.ledger !== undefined && Object.keys(map).length > Object.keys(best).length) {
      best = map; headerRow = r;
    }
  }

  let cols = best, amountCol = null;
  if (headerRow === -1) { headerRow = -1; cols = { ledger: 0 }; }

  // Amount detection: prefer an explicit "Amount"/"Balance" header if one was
  // aliased; otherwise pick the FIRST column right of the ledger that is mostly
  // numeric across the data rows — skipping blank columns and the already-mapped
  // text columns (face/note/sub/py/sys). Left-to-right so a current-year amount
  // wins over a previous-year one. Robust to blank gaps and text columns between.
  if (cols.amount != null) {
    amountCol = cols.amount;
  } else {
    const known = new Set([cols.ledger, cols.face, cols.note, cols.subNote,
      cols.pyFace, cols.pyNote, cols.sysPrimary, cols.sysParent].filter((v) => v != null));
    const sample = grid.slice(headerRow + 1, headerRow + 60).filter(Boolean);
    const width = Math.max(0, ...sample.map((r) => r.length), ...grid.slice(0, 60).map((r) => (r ? r.length : 0)));
    const startCol = headerRow === -1 ? 1 : (cols.ledger ?? 0) + 1;
    for (let c = startCol; c < width; c++) {
      if (known.has(c)) continue;
      let num = 0, nonEmpty = 0;
      for (const row of sample) {
        const cell = row[c];
        if (cell === '' || cell == null) continue;
        nonEmpty++;
        if (parseAmt(cell) != null) num++;
      }
      if (num >= 1 && num >= nonEmpty * 0.5) { amountCol = c; break; }
    }
  }

  const rows = [];
  // `layout` records the source-row sequence from the first kept ledger down:
  // each entry is a kept row's idx, or null for a skipped interior row (blank
  // ledger / total marker). It lets the G:I copy stay ROW-ALIGNED to the source
  // by emitting blank lines at the skip positions. Trailing nulls are trimmed.
  const layout = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const ledger = String(row[cols.ledger] ?? '').trim();
    // Skip blank-ledger rows, the header repeated, and unambiguous total/subtotal/
    // balance markers (EXACT-match, so "Total Systems Pvt Ltd"/"Opening Stock"
    // are NOT dropped).
    if (!ledger || norm(ledger) === 'name of ledger' || isSummaryRow(ledger)) {
      if (rows.length > 0) layout.push(null);  // interior (post-first-ledger) skip
      continue;
    }
    layout.push(rows.length);                  // this row's idx
    rows.push({
      idx: rows.length,
      excelRow: r + 1,
      ledger,
      sysPrimary: cols.sysPrimary != null ? String(row[cols.sysPrimary] ?? '').trim() : '',
      sysParent:  cols.sysParent  != null ? String(row[cols.sysParent]  ?? '').trim() : '',
      amount: amountCol != null ? parseAmt(row[amountCol]) : null,
      curFace: cols.face    != null ? String(row[cols.face]    ?? '').trim() : '',
      curNote: cols.note    != null ? String(row[cols.note]    ?? '').trim() : '',
      curSub:  cols.subNote != null ? String(row[cols.subNote] ?? '').trim() : '',
      pyFace:  cols.pyFace  != null ? String(row[cols.pyFace]  ?? '').trim() : '',
      pyNote:  cols.pyNote  != null ? String(row[cols.pyNote]  ?? '').trim() : '',
    });
  }
  while (layout.length && layout[layout.length - 1] === null) layout.pop(); // trim trailing skips
  const interiorSkips = layout.filter((x) => x === null).length;
  return { rows, cols, headerRow, amountCol, interiorSkips, layout };
}

/** Split one delimited line, honouring double-quoted fields (RFC-4180 basics):
 *  a quoted field may contain the delimiter and newlines-escaped-as-quotes, and
 *  "" inside a quoted field is a literal quote. Tab-delimited Excel pastes rarely
 *  quote, but CSV party names ("Rao, Sanjay & Co") and amounts ("1,234") do. */
export function splitDelimited(line, delim) {
  if (delim !== ',' || !line.includes('"')) return line.split(delim);
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') { q = true; }
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Parse pasted clipboard text (TSV, or CSV) into a grid, then structure it. */
export function parsePasted(text) {
  const raw = String(text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!raw.trim()) return { rows: [], cols: {}, headerRow: -1, amountCol: null };
  const delim = raw.includes('\t') ? '\t' : (raw.split('\n')[0].includes(',') ? ',' : '\t');
  const grid = raw.split('\n').map((line) => splitDelimited(line, delim));
  return parseGrid(grid);
}

// ---- Prompt -------------------------------------------------------------

// Compact the controlled vocabulary for the prompt (face => notes).
function vocabBlock() {
  return FACE_HEADS.map((f) => `- ${f}: ${NOTES_BY_FACE[f].join(' | ')}`).join('\n');
}

// The persona + validation vocabulary + all classification rules are IDENTICAL
// for every chunk, so they live in the SYSTEM prompt. DeepSeek's server-side
// context cache reuses this large static prefix across the parallel chunk calls
// (cache-hit tokens are far cheaper) — only the per-chunk ledger list varies.
const SYSTEM_PROMPT =
  'You are a senior Indian Chartered Accountant preparing a Schedule III (Division I, ' +
  'Companies Act 2013) balance sheet. You map trial-balance ledgers to the correct ' +
  'Face head and Note grouping, and you draft tidy Sub-Note presentation groups. ' +
  'You never invent Face or Note values outside the supplied controlled vocabulary. ' +
  'Return ONLY valid JSON.\n\n' + `You are filling the Schedule III Automation Tool's grouping columns. The
tool ENFORCES these exact data validations (dependent dropdowns):
  * Face grouping (col G): must be one of the Face heads listed below.
  * Note grouping (col H): dependent dropdown = INDIRECT(SUBSTITUTE(Face," ","_")).
    It MUST be one of THAT face's allowed notes listed below — nothing else, or
    the paste breaks the workbook's validation.
  * Sub-Note grouping (col I): free text (no dropdown) — YOU draft it for a clean
    balance-sheet presentation.

VALIDATION VOCABULARY — "Face head" => allowed Note groupings (verbatim):
${vocabBlock()}

RULES
1. For EACH ledger return face, note, subNote.
2. "face" MUST be copied character-for-character from a Face head above. "note"
   MUST be copied character-for-character from THAT face's allowed notes above.
   Do not paraphrase, re-case, singularise, or invent — an unlisted value is a
   validation error. If the ledger truly fits no listed note, pick the face's
   "Specify at level 3" (if present) and put the detail in subNote.
2a. Prefer the MOST SPECIFIC valid note over a generic catch-all: a supplier /
   vendor advance -> "Short term loans and advances" > "Advances to suppliers"
   (not "Other current assets" > "Others"); a capital advance -> "Capital
   Advances"; a security deposit -> "Security Deposits". Only fall back to
   "Others" / "Other payables" when no specific note fits.
3. Use the sign of "amount" and the Tally sysGroup as evidence: negative =
   credit balance (liability / income / capital); positive = debit (asset /
   expense). A ledger named like a bank/party/tax tells you its head.
   Examples honouring the lists: TDS/GST/PF/ESI/Prof-tax payable ->
   "Other current liabilities" > "Statutory dues"; vendor advances ->
   "Short term loans and advances" > "Advances to suppliers"; prepaid/interest
   accrued receivable -> "Other current assets" > "Others"/"Interest accrued".
3a. DISAMBIGUATION — always pick a listed note, never leave it blank:
   - "credit card" (Axis/HDFC/Kotak etc. card, credit balance) -> "Other current
     liabilities" > "Other payables" (card dues repayable).
   - Clearing & forwarding / C&F / freight / cartage (expense) -> "Other expenses"
     > "Freight outward" (outward) or "Freight Inward" (inward/purchase).
   - "share application money" RECEIVED (credit) -> face "Share application money
     pending allotment" > "Specify at level 3"; share application money PAID by us
     (debit, an asset) -> "Short term loans and advances" > "Others".
   - Rent/electricity/utility PAYABLE, or a bare person/party name with a credit
     balance and no loan context, under current liabilities -> "Other payables".
   - Security/rent DEPOSIT paid (debit, non-current) -> "Other non current assets"
     > "Security Deposits"; if clearly < 12 months -> "Short term loans and
     advances" > "Others".
   - GST input / ITC / RCM input (debit) -> "Other current assets" > "Others".
   - Accrued / unbilled revenue / accrued income (debit) is an ASSET ->
     "Other current assets" > "Interest accrued" (if interest) else "Others";
     never a payable. Income received in advance / unearned (credit) ->
     "Other current liabilities" > "Income received in advance".
   - Bank overdraft / cash-credit / OD / CC limit (credit) is SECURED against
     current assets -> "Short term borrowings" > "Secured Loans repayable on
     demand from banks" (NOT the Unsecured line).
   - INTEREST: only interest on BORROWINGS (bank OD, term loans, debentures,
     unsecured loans) is a finance cost -> "Finance costs" > "Interest expense".
     Interest on LATE / DELAYED STATUTORY dues (GST, TDS, income tax, customs,
     PF) is a penal charge, NOT a borrowing cost -> "Other expenses" > "Rates
     and taxes". Keep all such statutory-interest ledgers consistent.
   - BANK CHARGES: general bank / account-maintenance / transaction charges are
     NOT a finance cost -> "Other expenses" > "Other Business Administrative
     Expenses". Only borrowing-related fees (loan processing / arrangement /
     prepayment) -> "Finance costs" > "Other borrowing costs".
   - Imprest / staff advance / salary advance (debit) is an EMPLOYEE advance ->
     "Short term loans and advances" > "Loans and advances to employees" (not
     "Others" or "Advances to suppliers").
   - Provisions (credit): "Provision for income tax / taxation" -> "Short term
     provisions" > "Provision for income tax". "Provision for gratuity / leave /
     bonus / employee benefits" -> "Short term provisions" (current) or "Long
     term provisions" > "Provision for employee benefits". Do NOT park provisions
     under "Other current liabilities" > "Other payables". ("Provision for
     doubtful debts" is the exception — it stays a contra under receivables/loans.)
   - Under "Other expenses" pick the SPECIFIC note, consistently: electricity /
     power / fuel / diesel -> "Power and fuel" (never "Indirect expenses");
     travel / conveyance / reimbursement of travel -> "Travelling Expenses";
     insurance -> "Insurance"; telephone / internet / mobile ONLY -> "Telephone
     expenses"; rent -> "Rent"; audit fee -> "Auditors' Remuneration". Postage /
     courier / printing / stationery are NOT telephone -> "Other Business
     Administrative Expenses" (or "Miscellaneous expenses"). Software / web /
     domain / hosting / SaaS subscription charges are NOT "Repairs" -> "Other
     Business Administrative Expenses". Fines / penalties / late fees for
     non-compliance are NOT "Rates and taxes" (which is statutory levies -
     property tax, professional tax, ROC/stamp/registration) -> "Miscellaneous
     expenses". Only use "Miscellaneous expenses" / "Other Expenses" when no
     specific note fits.
3b. The Tally "sysGroup" (primary > parent group) is STRONG evidence for the
   FACE — trust it unless the ledger name clearly contradicts:
     Sundry Creditors -> "Trade payables due to others" (or MSME if micro/small)
     Sundry Debtors -> "Trade receivables"
     Duties & Taxes -> credit: "Other current liabilities">"Statutory dues";
       debit (input/ITC): "Other current assets">"Others"
     Fixed Assets -> "Property Plant and Equipment" / "Intangible assets"
     Loans & Advances (Asset) -> short/long "... loans and advances"
     Deposits (Asset) -> "Other non current assets">"Security Deposits"
     Bank OD A/c / Secured Loans -> "Short term borrowings">"Secured Loans
       repayable on demand from banks"; Unsecured Loans -> the Unsecured lines
     Bank Accounts -> "Cash and Cash Equivalents">"Balances with banks in
       current accounts"; Cash-in-hand -> "Cash on hand"
     Capital Account -> "Share capital" / "Reserves and surplus"
     Provisions -> "Short term provisions"/"Long term provisions"
     Direct/Purchase -> COGS/purchases faces; Indirect Expenses -> "Other
       expenses"; Sales -> "Revenue from operations"; Indirect Incomes ->
       "Other Income".
   Use the amount SIGN and ledger name to choose current vs non-current and the
   exact allowed note within that face.
   - When still genuinely unsure of the note, use the face's catch-all that IS in
     its list — "Other payables" / "Others" / "Other Expenses" / "Specify at level
     3" — rather than returning an empty note.
4. If curFace/curNote are already present AND valid (appear verbatim in the lists),
   KEEP them unless clearly wrong; then action:"keep". If blank, action:"fill".
   If you correct a wrong/unlisted value, action:"change".
4a. pyFace/pyNote (if given) are LAST YEAR's grouping — a strong prior. When
   curFace/curNote are blank, prefer last year's grouping unless the ledger's
   nature clearly changed (consistency of presentation year over year).
5. subNote — Level 3, drafted by YOU for clean balance-sheet presentation:
   - GROUP similar ledgers under ONE shared, well-worded label so the note reads
     well. Examples: all TDS/TCS ledgers -> "TDS / TCS Payable"; PF & ESI ->
     "PF & ESI Payable"; GST ledgers -> "GST Payable"; multiple vendor advances
     -> "Advances to Vendors"; salary/bonus/incentive payables -> "Employee
     Dues Payable"; audit/professional fee payables -> "Provision for Expenses".
   - CANONICAL LABELS — use these EXACT sub-notes so every variant collapses to
     one line: input GST / ITC / RCM-input -> "GST Input Credit"; output GST
     (CGST/SGST/IGST/import/RCM payable) -> "GST Payable"; TDS payable -> "TDS
     Payable"; TDS receivable -> "TDS Receivable"; provident fund -> "PF Payable";
     ESI/ESIC -> "ESIC Payable"; profession tax -> "Profession Tax Payable"; any
     staff imprest -> "Imprest to Staff"; any prepayment -> "Prepaid Expenses";
     bank / account charges (incl. their GST component) -> "Bank Charges".
   - LEAVE subNote BLANK ("") for Trade payables (creditors) and Trade
     receivables (debtors) — these are shown in aggregate with an MSME/others +
     ageing schedule, NOT by individual party. Never put a party name there.
   - Otherwise where a ledger must be shown by name (related-party loans,
     individual directors, specific investments), use the cleaned ledger name.
   - SUFFIX CONSISTENCY: for a liability-side note end the label "... Payable"
     (never "Dues"/"Outstanding"); for an asset-side note use "... Receivable" or
     "Advance to ...". Keep the SAME suffix for every sibling so they render as
     one line, e.g. always "Credit Card Payable" (not sometimes "Credit Card Dues").
   - Title Case, <= 6 words, no trailing punctuation, consistent across siblings.
6. confidence: 0-1. reason: <= 12 words, why this head/note.

Each user message gives a LEDGERS JSON array. RETURN ONLY this JSON, one object
per ledger with the same "i":
{"mappings":[{"i":0,"face":"","note":"","subNote":"","action":"fill|keep|change","confidence":0.0,"reason":""}]}`;

// Per-chunk user prompt — ONLY the varying ledger list (keeps the cached prefix
// in the system prompt intact for DeepSeek context caching).
function buildUserPrompt(chunk) {
  const ledgers = chunk.map((r) => ({
    i: r.idx,
    ledger: r.ledger,
    sysGroup: [r.sysPrimary, r.sysParent].filter(Boolean).join(' > ') || undefined,
    amount: r.amount ?? undefined,
    curFace: r.curFace || undefined,
    curNote: r.curNote || undefined,
    curSub: r.curSub || undefined,
    pyFace: r.pyFace || undefined,
    pyNote: r.pyNote || undefined,
  }));
  return `LEDGERS (JSON):\n${JSON.stringify(ledgers)}`;
}

// Key AI mappings by NUMERIC index. DeepSeek's json_object sometimes emits "i"
// as a string ("5"), which would silently miss the numeric r.idx lookup and drop
// the mapping (row falls to current/catch-all values with NO review flag). Coerce
// to an integer; skip un-parseable ids; on duplicate i the last mapping wins.
export function buildIndexMap(list) {
  const map = new Map();
  for (const m of (Array.isArray(list) ? list : [])) {
    const i = Number(m?.i);
    if (Number.isInteger(i)) map.set(i, m);
  }
  return map;
}

// ---- Validation ---------------------------------------------------------

// Faces shown in aggregate + ageing schedule — individual parties are never
// listed on the face of the BS, so these carry NO per-ledger sub-note.
const AGGREGATE_FACES = new Set([
  'Trade payables due to MSME',
  'Trade payables due to others',
  'Trade receivables',
]);

// Generic "bucket" notes, in preference order — used to complete a valid face
// whose note the AI left blank, so the paste is never incomplete. All are real
// dropdown values; only assigned when present in that face's allowed list.
const CATCHALL_NOTES = [
  'Other payables', 'Others', 'Other Expenses', 'Other investments',
  'Other non-current investments', 'Miscellaneous expenses', 'Specify at level 3',
];

function validateMapping(row, m) {
  const face = canonicalFace(m?.face) || canonicalFace(row.curFace);
  let note = '', status = 'ok', flags = [];

  if (!face) {
    status = 'review';
    flags.push('face not in the tool\'s Face list');
  } else {
    note = canonicalNote(face, m?.note) || canonicalNote(face, row.curNote);
    const opts = NOTES_BY_FACE[face] || [];
    // Deterministic fallback: if the face's dependent dropdown has exactly one
    // valid note (e.g. "Captured from FAR"), assign it — no ambiguity.
    if (!note && opts.length === 1) note = opts[0];
    // Catch-all: a valid face but a note the AI left blank must not paste empty.
    // Assign the face's generic bucket note (still in-vocab) and flag it so the
    // reviewer confirms — never leave a resolvable face with an empty note.
    if (!note) {
      const catchAll = CATCHALL_NOTES.find((c) => opts.includes(c));
      if (catchAll) { note = catchAll; flags.push('catch-all note assigned — confirm'); }
    }
    if (!note) { status = 'review'; flags.push('no note could be assigned for this face'); }
  }

  // Faces that are presented in AGGREGATE (with an ageing / MSME-vs-others
  // schedule) and NEVER line up individual party ledgers on the face or in the
  // note — trade payables (creditors) and trade receivables (debtors). A
  // per-party sub-note there is wrong, so force it blank regardless of the AI.
  let subNote = (m?.subNote || row.curSub || '').trim();
  if (face && AGGREGATE_FACES.has(face)) {
    subNote = '';
  } else if (!subNote) {
    flags.push('sub-note blank');
  }

  const action = m?.action || (row.curFace ? 'keep' : 'fill');
  const changed =
    (face && norm(face) !== norm(row.curFace)) ||
    (note && norm(note) !== norm(row.curNote)) ||
    (subNote && norm(subNote) !== norm(row.curSub));

  return {
    ...row,
    face, note, subNote,
    action, changed,
    status,               // 'ok' | 'review'
    flags,
    confidence: typeof m?.confidence === 'number' ? m.confidence : null,
    reason: m?.reason || '',
    accepted: true,       // reviewer can toggle later
  };
}

// ---- Runner -------------------------------------------------------------

const CHUNK_SIZE = 55;

/**
 * Map all ledgers. Fires per-chunk DeepSeek calls concurrently.
 *
 * @param {object} opts
 * @param {Array}  opts.rows      - parsed rows from parseGrid/parsePasted
 * @param {string} opts.apiKey
 * @param {string} [opts.model]   - default 'deepseek-v4-flash'
 * @param {AbortSignal} [opts.signal]
 * @param {(done:number,total:number)=>void} [opts.onProgress]
 * @param {(u)=>void} [opts.onUsage]
 * @returns {Promise<{ results: Array, stats: object }>}
 */
export async function mapGroupings({
  rows, apiKey, model = 'deepseek-v4-flash', signal, onProgress, onUsage,
}) {
  if (!apiKey) throw new Error('Add your DeepSeek API key to run the mapping.');
  if (!rows?.length) throw new Error('No ledgers found to map. Check the pasted data or file.');

  const chunks = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) chunks.push(rows.slice(i, i + CHUNK_SIZE));

  let done = 0;
  const byIdx = new Map();

  await Promise.all(chunks.map(async (chunk) => {
    let parsed = null;
    try {
      parsed = await callDeepSeek({
        apiKey, model, signal,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(chunk),
        temperature: 0.0, top_p: 0.1,
        timeoutMs: 180_000,
        onUsage,
      });
    } catch (err) {
      // Fatal (bad key / no credits / cancelled) → abort the whole run so the UI
      // shows the real reason, instead of silently flagging every row for review.
      if (isFatalRunError(err)) throw err;
      // Otherwise degrade: this chunk yields current-value rows flagged for review.
      parsed = { mappings: chunk.map((r) => ({ i: r.idx })) };
      parsed._error = err.message;
    }
    const list = Array.isArray(parsed?.mappings) ? parsed.mappings : [];
    const map = buildIndexMap(list);
    chunk.forEach((r) => {
      const v = validateMapping(r, map.get(r.idx) || {});
      if (parsed._error) { v.status = 'review'; v.flags = [...v.flags, 'AI call failed — verify manually']; }
      byIdx.set(r.idx, v);
    });
    done += chunk.length;
    if (onProgress) onProgress(Math.min(done, rows.length), rows.length);
  }));

  const results = rows.map((r) => byIdx.get(r.idx)).filter(Boolean);

  // Deterministic presentation pass, in order:
  //  (a) canonical sub-notes for well-known statutory/tax patterns (reproducible,
  //      collapses AI wording drift for the biggest clusters);
  //  (b) surface-form normalise (casing/spacing/noise);
  //  (c) token-set canonicalise within each bucket (word-order/plural/status).
  const deterministicNotes = applyDeterministicNotes(results);
  const tallyReviewFlags = flagTallyReview(results);
  const signReviewFlags = flagSignAnomalies(results);
  const provisionFlags = flagProvisionPlacement(results);
  const yoyReclassFlags = flagYoyReclassification(results);
  const deterministicSubNotes = applyDeterministicSubNotes(results);
  for (const r of results) if (r.subNote) r.subNote = formatSubNote(r.subNote);
  const subNoteMerges = canonicalizeSubNotes(results);
  const redundantSubNotes = stripRedundantSubNotes(results);
  // Materiality runs LAST — on the final, canonicalised sub-notes.
  const immaterialSubNotes = flagImmaterialSubNotes(results);

  const stats = {
    total: results.length,
    filled: results.filter((r) => r.action === 'fill').length,
    changed: results.filter((r) => r.action === 'change').length,
    kept: results.filter((r) => r.action === 'keep').length,
    review: results.filter((r) => r.status === 'review').length,
    subNoteGroups: new Set(results.map((r) => r.subNote).filter(Boolean)).size,
    subNoteMerges,
    redundantSubNotes,
    deterministicSubNotes,
    deterministicNotes,
    tallyReviewFlags,
    signReviewFlags,
    provisionFlags,
    yoyReclassFlags,
    immaterialSubNotes,
  };

  return { results, stats };
}

// ---- Year-over-year reclassification flag (quality control, non-mutating) -
// If the trial balance carries previous-year groupings (T_B cols O/P), a ledger
// whose CURRENT-year Face/Note differs from last year's is a reclassification —
// a standard audit red flag (consistency of presentation). Flag it for the
// reviewer; never change the value. No PY columns -> no-op.
export function flagYoyReclassification(results) {
  let n = 0;
  for (const r of results) {
    const pf = canonicalFace(r.pyFace);
    if (!pf || !r.face) continue;                       // no PY grouping to compare
    const faceChanged = pf !== r.face;
    const pn = canonicalNote(r.face, r.pyNote);
    const noteChanged = !faceChanged && pn && r.note && pn !== r.note;
    if (faceChanged || noteChanged) {
      const was = faceChanged ? r.pyFace : `${r.pyFace} > ${r.pyNote}`;
      const msg = `verify: reclassified from last year (was ${was})`;
      if (!r.flags.includes(msg)) { r.flags.push(msg); n++; }
    }
  }
  return n;
}

// ---- Provision-placement review flag (quality control, non-mutating) ----
// A "Provision for income tax / gratuity / leave / employee benefits" belongs on
// the dedicated Short/Long term provisions face, not "Other current liabilities
// > Other payables" where preparers often park it. Flag the mismatch for the
// reviewer (non-mutating). Excludes "provision for doubtful debts", which is a
// legitimate contra under Trade receivables / loans & advances.
const _PROVISION_RE = /provision(s)?\s+(for|of)\s+(income\s*tax|taxation|\btax\b|gratuity|leave|bonus|employee|superannuation|pension)/i;
// Only liability faces where a provision is commonly MIS-parked. A provision on a
// P&L face (Tax Expenses) is a charge/write-back, not a BS provision — skip it.
const _PROVISION_MISPLACED_FACES = new Set(['Other current liabilities', 'Other Long term liabilities']);
export function flagProvisionPlacement(results) {
  let n = 0;
  for (const r of results) {
    if (!r.face || !_PROVISION_RE.test(r.ledger)) continue;
    if (/doubtful|excess|short|written\s*(back|off)|reversal|reverse/i.test(r.ledger)) continue; // contra / P&L movement
    if (_PROVISION_MISPLACED_FACES.has(r.face)) {
      const msg = 'verify: provision — consider Short/Long term provisions';
      if (!r.flags.includes(msg)) { r.flags.push(msg); n++; }
    }
  }
  return n;
}

// ---- Sign / polarity review flags (quality control, non-mutating) -------
// TB convention: DEBIT balance is positive, CREDIT balance is negative. An
// asset or expense face normally carries a DEBIT balance; a liability, equity or
// income face carries a CREDIT balance. A MATERIAL balance with the opposite
// sign usually means a misclassification (e.g. a "receivable" that is really an
// advance received) or a contra. Flag it for the reviewer — never change it.
// Legitimate contras (provisions, accumulated depreciation, "less:" lines) are
// skipped so the signal stays high-precision.
const _CREDIT_SIDE_FACES = new Set([
  'Share capital', 'Reserves and surplus', 'Money received against share warrants',
  'Share application money pending allotment', 'Long term borrowings',
  'Deferred tax liabilities Net', 'Other Long term liabilities', 'Long term provisions',
  'Short term borrowings', 'Trade payables due to MSME', 'Trade payables due to others',
  'Other current liabilities', 'Short term provisions', 'Revenue from operations', 'Other Income',
]);
const _SIGN_CONTRA_RE = /provision|doubtful|\bless\b|reclassified|accumulated|redeem|written off|written back|impairment|depreciation|round\s*off|closing stock|opening stock|suspense/i;
// Faces whose balance is legitimately either sign — never sign-flag them.
const _SIGN_SKIP_FACES = new Set([
  'Change in Inventories of work in progress and finished goods',
  'Exceptional item', 'Extraordinary Item', 'Prior Period Item',
]);
const _SIGN_MATERIAL = 1000;   // ignore trivial / opening-only balances
export function flagSignAnomalies(results) {
  let n = 0;
  for (const r of results) {
    if (!r.face || _SIGN_SKIP_FACES.has(r.face)) continue;
    if (typeof r.amount !== 'number' || Math.abs(r.amount) < _SIGN_MATERIAL) continue;
    if (_SIGN_CONTRA_RE.test(`${r.note} ${r.subNote} ${r.ledger}`)) continue; // legit contra
    const expectCredit = _CREDIT_SIDE_FACES.has(r.face);
    const isCredit = r.amount < 0;                 // negative = credit balance
    if (expectCredit !== isCredit) {
      const msg = `verify: ${isCredit ? 'credit' : 'debit'} balance unusual for ${r.face}`;
      if (!r.flags.includes(msg)) { r.flags.push(msg); n++; }
    }
  }
  return n;
}

// ---- Tally-group review flags (quality control, non-mutating) -----------
// The Tally System Primary Group is strong evidence for the face. When the
// assigned face contradicts a HIGH-CONFIDENCE group, flag the row for the
// reviewer's attention — WITHOUT changing the value (the contradiction is often
// a legitimate name-based override, e.g. auditor under Sundry Creditors, so the
// human decides). Only groups whose deviation is usually worth a second look are
// listed; noisy ones (Sundry Creditors, Duties & Taxes) are deliberately omitted.
const _TALLY_EXPECT = {
  'Sundry Debtors': ['Trade receivables'],
  'Fixed Assets': ['Property Plant and Equipment', 'Intangible assets', 'Capital work in progress', 'Intangible assets under development'],
  'Bank Accounts': ['Cash and Cash Equivalents'],
  'Cash-in-hand': ['Cash and Cash Equivalents'],
  'Deposits (Asset)': ['Other non current assets', 'Short term loans and advances', 'Long term loans and advances'],
  'Unsecured Loans': ['Long term borrowings', 'Short term borrowings'],
  'Secured Loans': ['Long term borrowings', 'Short term borrowings'],
  'Bank OD A/c': ['Short term borrowings'],
  'Capital Account': ['Share capital', 'Reserves and surplus'],
  'Provisions': ['Short term provisions', 'Long term provisions', 'Other current liabilities'],
  'Sales Accounts': ['Revenue from operations'],
};
export function flagTallyReview(results) {
  let n = 0;
  for (const r of results) {
    const grp = (r.sysPrimary || '').trim();
    const expect = _TALLY_EXPECT[grp];
    if (!expect || !r.face) continue;
    if (!expect.includes(r.face)) {
      const msg = `verify: Tally group "${grp}" suggests ${expect[0]}`;
      if (!r.flags.includes(msg)) r.flags.push(msg);
      n++;
    }
  }
  return n;
}

// ---- Materiality review flags (presentation, non-mutating) --------------
// On the face of the BS a note with many tiny singleton sub-notes reads badly;
// standard practice rolls immaterial items into an "Others" line. Flag a
// singleton sub-note (one ledger) whose amount is < MATERIAL_PCT of its note's
// total, but ONLY inside a busy note (>= MIN_LINES distinct sub-notes) where
// consolidation actually improves presentation. Never touches the value — the
// reviewer decides whether to group. Aggregate faces (blank sub-notes) skipped.
const _MATERIAL_PCT = 0.01;     // < 1% of the note total
const _MIN_LINES = 5;           // only worth it when the note has many lines
export function flagImmaterialSubNotes(results) {
  // Build per-note stats: distinct sub-notes, note total, and per-sub totals+count.
  const notes = new Map();       // face|note -> { total, subs: Map(sub -> {total,count}) }
  for (const r of results) {
    if (!r.subNote || !r.face || AGGREGATE_FACES.has(r.face)) continue;
    const key = `${r.face}|${r.note}`;
    if (!notes.has(key)) notes.set(key, { total: 0, subs: new Map() });
    const nb = notes.get(key);
    nb.total += r.amount || 0;
    const sb = nb.subs.get(r.subNote) || { total: 0, count: 0 };
    sb.total += r.amount || 0; sb.count += 1;
    nb.subs.set(r.subNote, sb);
  }
  const immaterial = new Set();   // face|note|sub keys that qualify
  for (const [key, nb] of notes) {
    if (nb.subs.size < _MIN_LINES || Math.abs(nb.total) === 0) continue;
    const floor = Math.abs(nb.total) * _MATERIAL_PCT;
    for (const [sub, sb] of nb.subs) {
      // Non-zero but tiny singleton — a nil (0) balance is "empty", not immaterial.
      if (sb.count === 1 && Math.abs(sb.total) > 0 && Math.abs(sb.total) < floor) immaterial.add(`${key}|${sub}`);
    }
  }
  let n = 0;
  for (const r of results) {
    if (!r.subNote) continue;
    if (immaterial.has(`${r.face}|${r.note}|${r.subNote}`)) {
      if (!r.flags.includes('immaterial')) { r.flags.push('immaterial'); n++; }
    }
  }
  return n;
}

// ---- Deterministic MAIN-NOTE corrections (unmistakable, in-vocab) --------
// A few ledger patterns have a Schedule III note that is not a judgement call.
// Correct the AI's note ONLY when the pattern is unmistakable AND the target
// note is valid for the face the AI already chose (never changes the face).
// e.g. a bank overdraft / cash-credit is SECURED against current assets, so it
// belongs in "Secured Loans repayable on demand from banks", not the Unsecured
// line the model sometimes picks.
const _NOTE_RULES = [
  {
    face: 'Short term borrowings',
    re: /overdraft|\bo\/?d\b|cash\s*credit|\bcc\s*(a\/?c|limit|account)|bank.*\bod\b/i,
    note: 'Secured Loans repayable on demand from banks',
  },
  {
    // Electricity / power / fuel expense -> "Power and fuel" (Sch III standard),
    // never the generic "Indirect expenses". Excludes "electrical parts/goods/
    // equipment/repairs" which are repairs, not utilities.
    face: 'Other expenses',
    re: /\belectricity\b|\bpower\s*(and|&)?\s*fuel\b|\bdiesel\b|\bpetrol\b|generator\s*fuel/i,
    exclude: /parts|equipment|goods|electronics|repair|fitting|installation/i,
    note: 'Power and fuel',
  },
  {
    // Imprest / staff advance is an EMPLOYEE advance, not "Others"/"suppliers".
    face: 'Short term loans and advances',
    re: /\bimprest\b|staff\s*advance|salary\s*advance|advance\s*to\s*staff/i,
    note: 'Loans and advances to employees',
  },
];
export function applyDeterministicNotes(results) {
  let n = 0;
  for (const r of results) {
    if (!r.face) continue;
    const hit = _NOTE_RULES.find((x) => x.face === r.face && x.re.test(r.ledger) && !(x.exclude && x.exclude.test(r.ledger)));
    if (hit && (NOTES_BY_FACE[r.face] || []).includes(hit.note) && r.note !== hit.note) {
      r.note = hit.note;
      if (!r.flags.includes('deterministic note')) r.flags.push('deterministic note');
      n++;
    }
  }
  return n;
}

// ---- Deterministic sub-note dictionary (well-known statutory/tax lines) --
// For the highest-frequency, unambiguous ledger patterns, force a single
// canonical sub-note so presentation is REPRODUCIBLE run-to-run and every
// sibling collapses to one line — e.g. all input-GST/ITC ledgers (however
// worded) become "GST Input Credit". Keyed on the ledger name AND the face
// SIDE (asset vs liability) so an expense like "Admin Charges on PF" is never
// mislabelled "PF Payable". Only overrides when the pattern is unmistakable.
const _ASSET_FACES = new Set([
  'Property Plant and Equipment', 'Intangible assets', 'Capital work in progress',
  'Intangible assets under development', 'Non current investments', 'Current investments',
  'Deferred tax assets net', 'Long term loans and advances', 'Short term loans and advances',
  'Other non current assets', 'Other current assets', 'Inventories', 'Trade receivables',
  'Cash and Cash Equivalents',
]);
const _LIAB_FACES = new Set([
  'Other current liabilities', 'Other Long term liabilities',
  'Short term provisions', 'Long term provisions',
]);
// { re: ledger test, side: 'asset'|'liab', sub: canonical } — first match wins.
const _DSUB_RULES = [
  { re: /(input|itc)\s*(c|s|i|ut)?gst|(c|s|i|ut)?gst\s*(input|itc|credit)|\binput tax credit\b|\bitc\b|rcm\s*(input\s*)?(c|s|i|ut)?gst/i, side: 'asset', sub: 'GST Input Credit' },
  { re: /\btds\b|tax deducted at source/i,               side: 'asset', sub: 'TDS Receivable' },
  { re: /\btds\b|\btcs\b|tax deducted|tax collected/i,   side: 'liab',  sub: 'TDS Payable' },
  { re: /provident\s*fund|\bepf\b|\bp\.?f\.?\b/i,        side: 'liab',  sub: 'PF Payable' },
  { re: /\besic?\b|employee'?s?\s*state\s*insurance/i,   side: 'liab',  sub: 'ESIC Payable' },
  { re: /profession(al)?\s*tax|\bp\.?tax\b/i,            side: 'liab',  sub: 'Profession Tax Payable' },
  // Output GST payable (CGST/SGST/IGST/import/RCM) -> ONE "GST Payable" line.
  // exclude: penalties / interest / non-compliance / any input-side wording.
  { re: /\b(c|s|i|ut)?gst\b|goods\s*(and|&)?\s*service\s*tax|rcm.*gst|gst.*rcm/i,
    exclude: /non.?compliance|penalt|interest|late\s*fee|refund|input|\bitc\b|receivable|cash\s*balance/i,
    side: 'liab',  sub: 'GST Payable' },
  // Staff imprests (petty-cash floats) are immaterial and shown in aggregate —
  // collapse the per-person lines to ONE "Imprest to Staff" presentation line.
  { re: /\bimprest\b/i,                                 side: 'asset', sub: 'Imprest to Staff' },
  // All prepayments (insurance / rent / AMC / etc.) present as one "Prepaid
  // Expenses" line on the face.
  { re: /\bprepaid\b/i,                                 side: 'asset', sub: 'Prepaid Expenses' },
];
export function applyDeterministicSubNotes(results) {
  let n = 0;
  for (const r of results) {
    if (!r.face || AGGREGATE_FACES.has(r.face)) continue;   // aggregate faces carry no sub-note
    const side = _ASSET_FACES.has(r.face) ? 'asset' : _LIAB_FACES.has(r.face) ? 'liab' : null;
    if (!side) continue;                                    // expense/income/equity — leave AI's label
    const hit = _DSUB_RULES.find((rule) => rule.side === side && rule.re.test(r.ledger)
      && !(rule.exclude && rule.exclude.test(r.ledger)));
    if (hit && r.subNote !== hit.sub) {
      r.subNote = hit.sub;
      if (!r.flags.includes('deterministic sub-note')) r.flags.push('deterministic sub-note');
      n++;
    }
  }
  return n;
}

// ---- Sub-note ordering for the face (presentation) ----------------------
// Standard Schedule III presentation lists the residual "Others" / "Miscellaneous"
// line LAST in a note regardless of its size; every other sub-note is ordered
// material-first (|amount| desc). `items` are objects with { subNote, total }.
// Returns a NEW sorted array; does not mutate.
const _RESIDUAL_SUBNOTE_RE = /^(others?|miscellaneous.*|other expenses|specify at level 3)$/i;
export function sortSubNotesForFace(items) {
  const isResidual = (s) => !s || _RESIDUAL_SUBNOTE_RE.test(String(s).trim());
  return [...items].sort((a, b) => {
    const ra = isResidual(a.subNote), rb = isResidual(b.subNote);
    if (ra !== rb) return ra ? 1 : -1;                 // residuals sink to the bottom
    return Math.abs(b.total || 0) - Math.abs(a.total || 0); // else material-first
  });
}

// ---- Redundant sub-note removal (presentation) --------------------------
// A sub-note that merely repeats its Note (or Face) name adds nothing on the
// face — "Professional Fees" under the note "Professional fees" is tautological.
// Blank it so those ledgers roll straight up to the note line, decluttering the
// schedule. Never touches aggregate faces (already blank).
function _normLoose(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
export function stripRedundantSubNotes(results) {
  let n = 0;
  for (const r of results) {
    if (!r.subNote) continue;
    const sn = _normLoose(r.subNote);
    if (sn && (sn === _normLoose(r.note) || sn === _normLoose(r.face))) {
      r.subNote = '';
      if (!r.flags.includes('redundant sub-note removed')) r.flags.push('redundant sub-note removed');
      n++;
    }
  }
  return n;
}

// ---- Deterministic sub-note presentation formatting ---------------------
// Uniform surface form so lines read consistently on the face of the BS.
// Fixes: whitespace, "&" spacing, trailing bookkeeping noise, and casing —
// Title Case for ordinary words, small joining words kept lower (unless first),
// and known accounting acronyms forced UPPER so "gst"/"Gst"/"GST" never diverge.
const _SUBNOTE_ACRONYMS = new Set([
  'TDS', 'TCS', 'GST', 'CGST', 'SGST', 'IGST', 'UTGST', 'RCM', 'ITC', 'HSN',
  'PF', 'ESI', 'ESIC', 'PT', 'MLWF', 'LWF', 'MAT', 'TAN', 'PAN', 'GSTIN',
  'CCTV', 'AMC', 'EMI', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'POS', 'OD', 'CC',
  'HDFC', 'ICICI', 'SBI', 'IDBI', 'RBL', 'IDFC', 'PNB', 'BOB', 'L&T',
  'MSME', 'TReDS', 'ROC', 'MCA', 'DTA', 'DTL', 'FD', 'RD', 'NBFC',
]);
const _SUBNOTE_SMALL = new Set(['of', 'to', 'and', 'for', 'on', 'in', 'the', 'a', 'an', 'at', 'by', 'as', 'or']);
// Common English words that are NOT acronyms even when a ledger types them in
// caps — force Title Case ("FLOOR RENT" -> "Floor Rent"). Genuine abbreviations
// (FF, GF, WH, DG, EDLI) are absent, so they keep their caps.
const _NOT_ACRONYM_WORDS = new Set([
  'FLOOR', 'RENT', 'FEES', 'FEE', 'STAFF', 'SALARY', 'WAGES', 'CASH', 'LOAN',
  'SHOP', 'ROOM', 'HALL', 'GATE', 'ROAD', 'SITE', 'WORK', 'PART', 'SALE',
  'SALES', 'STOCK', 'DUTY', 'CESS', 'FUND', 'FUNDS', 'SIR', 'MISC', 'TOTAL',
  'OTHER', 'MAIN', 'NEW', 'OLD', 'NET', 'TAX', 'BANK', 'PETTY', 'PLANT',
]);
const _SUBNOTE_TAIL = /\s*[-–—]?\s*(a\/c|account|ledger|g\/l)\.?$/i;

export function formatSubNote(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/\s+/g, ' ').trim();
  s = s.replace(_SUBNOTE_TAIL, '').trim();      // strip "A/c"/"Account"/"Ledger" tail FIRST
  // Space out initials glued by a dot ("S.santha" -> "S. santha") so the name
  // part gets cased. Lookahead (not a capture) on the trailing letter so
  // CONSECUTIVE initials all split in ONE pass ("S.K.Verma" -> "S. K. Verma"),
  // which also makes formatSubNote idempotent. Digits (2.5) are untouched.
  s = s.replace(/([A-Za-z])\.(?=[A-Za-z])/g, '$1. ');
  // Space "&" and "/" only when they join full words (≥2 chars each) — keeps
  // "L&T" and "A/c" tight while fixing "Repairs&Maintenance", "TDS/TCS".
  s = s.replace(/(\w{2,})\s*&\s*(\w{2,})/g, '$1 & $2');
  s = s.replace(/(\w{2,})\s*\/\s*(\w{2,})/g, '$1 / $2');
  s = s.replace(/\s{2,}/g, ' ').trim();
  // Case EVERY alphanumeric run (not just space-delimited tokens) so words after
  // "(", "-" or "." also format — "(gst)" -> "(GST)", "-adaptor" -> "-Adaptor".
  s = s.replace(/[A-Za-z][A-Za-z0-9]*/g, (w, offset, full) => {
    // Ordinal suffix right after a digit ("1St"/"2Nd" -> "1st"/"2nd").
    if (offset > 0 && /[0-9]/.test(full[offset - 1]) && /^(st|nd|rd|th)$/i.test(w)) return w.toLowerCase();
    const up = w.toUpperCase();
    if (_SUBNOTE_ACRONYMS.has(up)) return up;                 // known acronym
    // Preserve genuine short all-caps abbreviations (CCTV, MLWF, EDLI, FF, DG).
    // Cap the heuristic at 4 chars: 5-char all-caps is far more often a proper
    // noun typed in caps (BAJAJ, NOIDA, DELHI) than an acronym — those Title-Case;
    // genuine 5-char acronyms (GSTIN, UTGST) are kept via the allow-list above.
    if (!_NOT_ACRONYM_WORDS.has(up) && /^[A-Z0-9]{2,4}$/.test(w) && !/[a-z]/.test(w)) return w;
    // A lone letter that prefixes a unit/plot code ("A-143", "B-35") -> uppercase,
    // not lowercased as the article "a".
    if (w.length === 1 && full[offset + 1] === '-' && /[0-9]/.test(full[offset + 2] || '')) return up;
    const lw = w.toLowerCase();
    const atWordStart = offset === 0 || full[offset - 1] === ' ';
    if (offset > 0 && atWordStart && _SUBNOTE_SMALL.has(lw)) return lw; // small joining word
    return lw.charAt(0).toUpperCase() + lw.slice(1);          // Title Case
  });
  // Normalise company suffixes so party lines read consistently on the face:
  // "Private Limited"/"Pvt. Ltd." -> "Pvt Ltd", standalone "Limited" -> "Ltd".
  // Order matters (Private Limited before bare Limited). Only touches suffix words.
  s = s.replace(/\bPrivate\s+Limited\b\.?/g, 'Pvt Ltd')
       .replace(/\bPvt\.?\s*Ltd\.?\b/g, 'Pvt Ltd')
       .replace(/\bLimited\b\.?/g, 'Ltd')
       .replace(/\bLtd\.\B/g, 'Ltd')
       .replace(/\bL\.?L\.?P\.?\b/gi, 'LLP');
  // Drop trailing GST-rate noise so the same concept doesn't fragment by rate:
  // "Consumables (GST)" / "Consumables @12% GST" -> "Consumables". Guarded so it
  // never blanks the label (keeps the original if the strip would empty it).
  {
    const stripped = s
      .replace(/\s*[@(]?\s*\d+(?:\.\d+)?\s*%\s*(?:c|s|i|ut)?gst\)?$/i, '')
      .replace(/\s*@\s*\d+(?:\.\d+)?\s*%$/i, '')
      .replace(/\s*\(\s*gst\s*\)$/i, '')
      // dash-separated GST-component suffix ("Bank Charges - GST" -> "Bank
      // Charges"); the dash requirement spares "Interest on GST" (GST is the object).
      .replace(/\s*[-–—]\s*gst$/i, '')
      .trim();
    if (stripped) s = stripped;
  }
  // Defensive final polish: drop leading/trailing separators an upstream strip
  // could leave (e.g. "- Delhi Electricity", "Rent Noida -", "Name ,") and
  // collapse any doubled separators. A real label never starts/ends with these.
  s = s.replace(/^[\s\-–—,.;:&/]+/, '').replace(/[\s\-–—,.;:&/]+$/, '');
  s = s.replace(/\s*([-–—/])\s*\1+\s*/g, ' $1 ');   // "- -" / "//" -> single
  return s.replace(/\s{2,}/g, ' ').trim();
}

// ---- Deterministic sub-note canonicalisation ----------------------------
// Within one (Face, Note) bucket, sub-notes that reduce to the SAME token set
// after lower-casing, dropping punctuation/noise words, and singularising are
// the same presentation line written differently ("Input CGST Credit" vs
// "CGST Input Credit"; "Advances to Vendors" vs "Advance to Vendor"). Collapse
// each such family to one canonical surface form = the most frequent variant
// (tie -> shortest -> alphabetical). This is conservative: genuinely different
// items keep different token sets (CGST vs IGST, TDS vs TCS) and are NOT merged.
const _SUBNOTE_STOP = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'for', 'on', 'in', 'as',
  // status / polarity suffixes — same concept whether written "Dues", "Payable",
  // "Outstanding" or "Paid" (e.g. "Credit Card Dues" == "Credit Card Payable",
  // "Custom Duty" == "Custom Duty Paid"). Dropping them merges the split line.
  'payable', 'payables', 'receivable', 'receivables',
  'due', 'dues', 'outstanding', 'paid', 'payment', 'recoverable',
  // trailing category words — "Repairs & Maintenance" == "Repairs & Maintenance
  // Expenses"; "Handling Charges" == "Handling". Content stays (Freight Inward
  // keeps "inward"), so distinct items are not over-merged.
  'expense', 'expenses', 'charge', 'charges', 'fee', 'fees',
  'ac', 'account', 'accounts',
]);
function subNoteKey(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(Boolean).map((w) => w.replace(/s$/, ''))
    .filter((w) => !_SUBNOTE_STOP.has(w)).sort().join(' ');
}
export function canonicalizeSubNotes(results) {
  const families = new Map(); // face|note|tokenKey -> Map(surface -> count)
  for (const r of results) {
    if (!r.subNote) continue;
    const k = subNoteKey(r.subNote);
    if (!k) continue;                       // sub-note was only noise words
    const key = `${r.face}|${r.note}|${k}`;
    if (!families.has(key)) families.set(key, new Map());
    const m = families.get(key);
    m.set(r.subNote, (m.get(r.subNote) || 0) + 1);
  }
  const canonical = new Map();
  for (const [key, m] of families) {
    if (m.size < 2) { canonical.set(key, [...m.keys()][0]); continue; }
    const best = [...m.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]),
    )[0][0];
    canonical.set(key, best);
  }
  let merged = 0;
  for (const r of results) {
    if (!r.subNote) continue;
    const k = subNoteKey(r.subNote);
    if (!k) continue;
    const c = canonical.get(`${r.face}|${r.note}|${k}`);
    if (c && c !== r.subNote) { r.subNote = c; merged++; }
  }
  return merged;
}

// ---- Output builders ----------------------------------------------------

/** TSV of just the 3 grouping columns (Face, Note, Sub-Note) in row order —
 *  paste directly into the tool's G:I.
 *
 *  Pass the parse `layout` (from parseGrid) to keep the output ROW-ALIGNED to the
 *  source when blank/total rows were skipped: a blank line is emitted at each skip
 *  position so a block-paste back into the tool lines up. Without a layout it
 *  emits one line per result in order (the clean, gap-free case). */
export function toGroupingTSV(results, layout) {
  const line = (r) => (r && r.accepted !== false ? [r.face, r.note, r.subNote].join('\t') : '\t\t');
  if (Array.isArray(layout) && layout.some((x) => x === null)) {
    const byIdx = new Map(results.map((r) => [r.idx, r]));
    return layout.map((x) => (x === null ? '\t\t' : line(byIdx.get(x)))).join('\n');
  }
  return results.filter((r) => r.accepted !== false).map(line).join('\n');
}

/** Human-readable, reviewer-ACTIONABLE flags for a row — the QC signals worth a
 *  second look (sign/Tally anomalies, catch-all confirm, AI failure) so they
 *  travel into the exported working paper. Internal/informational flags
 *  ("sub-note blank", "deterministic ...") are omitted. "; "-joined; empty when
 *  clean. */
const _EXPORT_FLAG_DROP = /^(sub-note blank|deterministic sub-note|deterministic note|immaterial|redundant sub-note removed)$/;
export function reviewFlagsText(r) {
  return (r.flags || [])
    .filter((f) => !_EXPORT_FLAG_DROP.test(f))
    .map((f) => f.startsWith('verify: ') ? f.slice(8) : f)
    .join('; ');
}

/** Full review TSV incl. ledger, amount and QC flags — for records / re-paste with a key column. */
export function toFullTSV(results) {
  const head = ['Name of Ledger', 'Amount', 'Face Grouping', 'Note Grouping', 'Sub-Note Grouping', 'Action', 'Confidence', 'Reason', 'Review Flags'];
  const body = results.map((r) => [
    r.ledger, r.amount ?? '', r.face, r.note, r.subNote,
    r.action, r.confidence ?? '', r.reason, reviewFlagsText(r).replace(/\t/g, ' '),
  ].join('\t'));
  return [head.join('\t'), ...body].join('\n');
}

// ---- Excel export (ExcelJS, lazy from CDN — same as the rest of the app) ----
function loadExcelJS() {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.ExcelJS) return resolve(window.ExcelJS);
    const existing = document.querySelector('script[data-exceljs]');
    if (existing) {
      existing.addEventListener('load', () => window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('ExcelJS load incomplete')));
      existing.addEventListener('error', () => reject(new Error('ExcelJS script failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
    s.async = true; s.dataset.exceljs = 'true';
    let done = false;
    s.onload = () => { if (!done) { done = true; window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('ExcelJS not on window')); } };
    s.onerror = () => { if (!done) { done = true; reject(new Error('Failed to load ExcelJS')); } };
    setTimeout(() => { if (!done) { done = true; reject(new Error('CDN load timeout')); } }, 12000);
    document.head.appendChild(s);
  });
}

export async function downloadMappingExcel(results, companyName = 'Grouping') {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Grouping Map');
  ws.columns = [
    { header: 'Name of Ledger', key: 'ledger', width: 42 },
    { header: 'Amount', key: 'amount', width: 16 },
    { header: 'Face Grouping', key: 'face', width: 30 },
    { header: 'Note Grouping', key: 'note', width: 34 },
    { header: 'Sub-Note Grouping', key: 'sub', width: 28 },
    { header: 'Action', key: 'action', width: 10 },
    { header: 'Confidence', key: 'conf', width: 11 },
    { header: 'Reason', key: 'reason', width: 40 },
    { header: 'Review Flags', key: 'flags', width: 44 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3D2E' } };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFAF6EE' } };
  results.forEach((r) => {
    const flagsText = reviewFlagsText(r);
    const row = ws.addRow({
      ledger: r.ledger, amount: r.amount ?? '', face: r.face, note: r.note,
      sub: r.subNote, action: r.action,
      conf: r.confidence ?? '', reason: r.reason, flags: flagsText,
    });
    if (r.status === 'review') {
      row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF3F0' } }; });
    } else if (r.action === 'fill') {
      row.getCell('sub').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F7EE' } };
    }
    // Amber-tint the Review Flags cell when a verify/anomaly flag is present.
    if (/balance unusual|Tally group|catch-all/.test(flagsText)) {
      row.getCell('flags').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF6ED' } };
      row.getCell('flags').font = { color: { argb: 'FFA85D1A' } };
    }
  });
  ws.autoFilter = 'A1:J1';
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = String(companyName).replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40) || 'Grouping';
  a.href = url; a.download = `${safe}_grouping_map.xlsx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read an uploaded .xlsx/.xlsm/.csv into a grid the parser understands.
 *  Picks the sheet whose header row contains a "ledger" column (or the largest).
 *
 *  Uses SheetJS (xlsx) — lazy-loaded from CDN — so it reads EVERY spreadsheet
 *  format the preparer's tool emits: .xlsx / .xlsm / .xlsb (binary) / .xls /
 *  .ods / .csv. ExcelJS can't parse .xlsb; SheetJS can. */
function loadSheetJS() {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.XLSX) return resolve(window.XLSX);
    const existing = document.querySelector('script[data-sheetjs]');
    if (existing) {
      existing.addEventListener('load', () => window.XLSX ? resolve(window.XLSX) : reject(new Error('SheetJS load incomplete')));
      existing.addEventListener('error', () => reject(new Error('SheetJS script failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.async = true; s.dataset.sheetjs = 'true';
    let done = false;
    s.onload = () => { if (!done) { done = true; window.XLSX ? resolve(window.XLSX) : reject(new Error('SheetJS not on window')); } };
    s.onerror = () => { if (!done) { done = true; reject(new Error('Failed to load SheetJS from cdn.sheetjs.com')); } };
    setTimeout(() => { if (!done) { done = true; reject(new Error('CDN load timeout (12 s)')); } }, 12000);
    document.head.appendChild(s);
  });
}

export async function readWorkbookToGrid(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const text = await file.text();
    return text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map((l) => splitDelimited(l, ','));
  }
  const XLSX = await loadSheetJS();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, dense: false });

  // Choose the sheet that best looks like a grouping trial balance: score a
  // header row by how many of the KEY fields (ledger, face, note, subNote) it
  // carries — NOT by row count. A T_B sheet with all four beats a Notes sheet
  // that merely has a "Particulars"/"Name of Ledger" column.
  const KEY_FIELDS = ['ledger', 'face', 'note', 'subNote'];
  let bestGrid = null, bestScore = -1;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
    let fields = 0;
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const hit = new Set();
      (grid[r] || []).forEach((c) => { const k = HEADER_ALIASES[norm(c)]; if (KEY_FIELDS.includes(k)) hit.add(k); });
      if (hit.has('ledger')) fields = Math.max(fields, hit.size);
    }
    // Primary: field richness (needs ledger). Fallback: biggest sheet (÷1e5 so it never outranks a real match).
    const score = fields > 0 ? fields * 1e6 + grid.length : grid.length / 1e5;
    if (score > bestScore) { bestScore = score; bestGrid = grid; }
  }
  return bestGrid || [];
}
