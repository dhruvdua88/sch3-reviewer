// ============ EXCEL → MARKDOWN EXTRACTOR ============
//
// Reads .xlsx / .xlsm workbooks client-side via ExcelJS — the SAME library the
// app already uses for the Excel working-paper export — lazy-loaded from cdnjs
// so it adds nothing to the main bundle. The workbook binary never leaves the
// browser; only the derived markdown (and, for AI runs, that markdown) is sent
// to DeepSeek.
//
// WHY THIS EXISTS
//   The whole downstream pipeline (metricsExtract.js, ruleEngine.js, the
//   keyword catalogue) is markdown-centric: it regexes a single string for
//   "<label> ... <number> <number>" lines. Excel is a STRICTLY BETTER input
//   than PDF for that pipeline because the numbers are already machine-readable
//   cells — no pdf.js layout guessing, no OCR digit corruption.
//
//   So this module normalises a workbook into the SAME line-shape that
//   pdfExtract.js produces, and the existing deterministic engine runs over it
//   unchanged. No AI is used for parsing — extraction is purely mechanical
//   (cell read) and the existing regex/alias dictionary identifies line items.
//
// RETURN SHAPE — identical to extractPdfToMarkdown() so the orchestrator and
// source-anchoring code don't need to branch:
//   { markdown, pageCount, charCount, looksScanned:false, pages, grid }
//   - pageCount : number of sheets (surfaced as "N pages" in the existing UI).
//   - pages     : [{ pageNum, text }] — one entry per sheet, for source anchoring.
//   - grid      : [{ sheet, rows: [[cell,...], ...] }] — structured cell values
//                 for EXACT footing / tie-out checks (Excel-only bonus; the
//                 markdown path remains what the rule engine reads today).
//
// NOTE: ExcelJS reads the OOXML formats (.xlsx / .xlsm). Legacy binary .xls and
// .ods are NOT supported — the caller surfaces a "save as .xlsx" message.

// Cells longer than this are clipped in the markdown (e.g. a whole policy
// paragraph in one cell). The full text still lands in the per-sheet `pages`
// text used for keyword matching, so nothing is lost for presence checks.
const MAX_CELL_CHARS = 4000;

// ---- Load ExcelJS from cdnjs (cached on window after first load) ----
// Mirrors loadExcelJS() in excelExport.js so both paths share one cached script.
function loadExcelJS() {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.ExcelJS) return resolve(window.ExcelJS);
    const existing = document.querySelector('script[data-exceljs]');
    if (existing) {
      existing.addEventListener('load',  () => window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('ExcelJS load incomplete')));
      existing.addEventListener('error', () => reject(new Error('ExcelJS script failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
    script.async = true;
    script.dataset.exceljs = 'true';
    let done = false;
    script.onload  = () => { if (!done) { done = true; window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('ExcelJS not on window')); } };
    script.onerror = () => { if (!done) { done = true; reject(new Error('Failed to load ExcelJS from cdnjs.cloudflare.com')); } };
    setTimeout(() => { if (!done) { done = true; reject(new Error('CDN load timeout (12 s)')); } }, 12000);
    document.head.appendChild(script);
  });
}

function clip(s) {
  return s.length > MAX_CELL_CHARS ? s.slice(0, MAX_CELL_CHARS) + '…' : s;
}

/**
 * Render one ExcelJS cell value to a string the downstream regex engine reads.
 * - Numbers: plain digits, NO thousands separators, with Indian-FS bracket
 *   convention for negatives — "(1234.5)" — so parseIndianAmount() reads the
 *   sign correctly (it treats a leading "(" / trailing ")" as negative).
 * - Dates: "dd Month yyyy" — human-readable AND matchable by YEAR_END_RE.
 * - Formula cells: the cached result is used; a formula with no cached result
 *   yields "" (we never evaluate formulas — purely mechanical read).
 * - Rich text / hyperlinks: the visible text.
 */
function cellToString(v) {
  if (v == null) return '';
  const t = typeof v;

  if (t === 'number') {
    if (!isFinite(v)) return '';
    const abs = Math.abs(v);
    const s = Number.isInteger(v) ? String(abs) : String(+abs.toFixed(2));
    return v < 0 ? `(${s})` : s;
  }
  if (t === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (t === 'string')  return clip(v.trim());

  if (v instanceof Date) {
    const dd  = String(v.getUTCDate()).padStart(2, '0');
    const mon = v.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    return `${dd} ${mon} ${v.getUTCFullYear()}`;
  }

  if (t === 'object') {
    // Formula / shared-formula cell — use the cached result.
    if ('result' in v) return cellToString(v.result);
    // Hyperlink cell — { text, hyperlink }.
    if ('text' in v && typeof v.text !== 'object') return clip(String(v.text).trim());
    // Rich text — { richText: [{ text }, ...] }.
    if (Array.isArray(v.richText)) return clip(v.richText.map((r) => r.text || '').join('').trim());
    // Error cell or formula without a cached value — nothing usable.
    return '';
  }
  return '';
}

/**
 * Extract a workbook to markdown + structured grid.
 *
 * @param {ArrayBuffer} arrayBuffer   - raw workbook bytes
 * @param {object}      [opts]
 * @param {function}    [opts.onProgress] - ({phase, current, total}) callback
 * @returns {Promise<{markdown, pageCount, charCount, looksScanned, pages, grid}>}
 */
export async function extractExcelToMarkdown(arrayBuffer, { onProgress } = {}) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);

  const worksheets = wb.worksheets || [];
  const total = worksheets.length;

  let markdown = '';
  const pages = [];
  const grid = [];

  let s = 0;
  for (const ws of worksheets) {
    s += 1;
    const name = ws.name || `Sheet ${s}`;
    onProgress?.({ phase: 'extracting', current: s, total });

    markdown += `\n---\n## Sheet: ${name}\n\n`;
    let sheetText = '';
    const gridRows = [];
    let blankStreak = 0;

    ws.eachRow({ includeEmpty: true }, (row) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cells[colNumber - 1] = cellToString(cell.value);
      });
      // Normalise holes left by sparse columns, then trim trailing empties.
      for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
      while (cells.length && cells[cells.length - 1] === '') cells.pop();

      const isBlank = cells.length === 0 || cells.every((c) => c === '');
      if (isBlank) {
        // Collapse runs of blank rows into a single section break.
        if (blankStreak === 0) { markdown += '\n'; sheetText += '\n'; }
        blankStreak++;
        return;
      }
      blankStreak = 0;
      gridRows.push(cells);

      // CRITICAL: a label and its amounts must sit on ONE line, because the
      // downstream field regexes use "<label>[^\n]*?<number>". Joining the row
      // cells with a small gap reproduces the single-line shape that
      // pdfExtract.js emits for a detected table row.
      const line = cells.join('   ').replace(/\s+$/g, '');
      markdown += line + '\n';
      sheetText += line + '\n';
    });

    pages.push({ pageNum: s, text: sheetText.trim() });
    grid.push({ sheet: name, rows: gridRows });
  }

  const finalMarkdown = markdown.trim();
  return {
    markdown:    finalMarkdown,
    pageCount:   total,          // sheets, surfaced as "pages" in the existing UI
    charCount:   finalMarkdown.length,
    looksScanned: false,         // a workbook is never "scanned" — no OCR path
    pages,
    grid,
  };
}

/**
 * True if the file looks like a workbook we can parse, by MIME or extension.
 * Browsers are inconsistent about spreadsheet MIME types, so extension is the
 * reliable signal. ExcelJS handles .xlsx / .xlsm only.
 */
export function isExcelFile(file) {
  if (!file) return false;
  const name = (file.name || '').toLowerCase();
  if (/\.(xlsx|xlsm)$/.test(name)) return true;
  const t = file.type || '';
  return t === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}
