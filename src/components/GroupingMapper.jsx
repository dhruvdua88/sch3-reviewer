// ============ GROUPING MAPPER — standalone module ============
//
// A self-contained mode (not part of the PDF audit phase-machine): the user
// pastes / uploads a Schedule III Automation Tool trial balance, and DeepSeek
// proposes a validated, paste-ready Face / Note / Sub-Note grouping for every
// ledger. The three grouping columns copy straight back into the tool's
// data-validated cells; the Final Code is derived deterministically.
//
// All grouping state lives here (mode is isolated). Reuses the app's DeepSeek
// wrapper, localStorage key store, design tokens, and ExcelJS export path.

import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  Layers, Upload, ClipboardPaste, Play, Copy, Check, Download, Search,
  AlertTriangle, Sparkles, RefreshCw, KeyRound, X, Table2,
} from 'lucide-react';
import { COLORS, FONTS, BTN_PRIMARY } from '../styles/tokens.js';
import { Button } from './ui/Button.jsx';
import { Card } from './ui/Card.jsx';
import { getApiKey, setApiKey as persistApiKey, getSettings } from '../lib/engagementStore.js';
import { createExportLock } from '../lib/exportLock.js';
import { FACE_HEADS, NOTES_BY_FACE } from '../data/sch3Vocab.js';
import {
  parsePasted, readWorkbookToGrid, parseGrid, mapGroupings,
  toGroupingTSV, toFullTSV, downloadMappingExcel, sortSubNotesForFace,
} from '../lib/groupingMap.js';

const SAMPLE = `System Primary Grouping\tName of Ledger\tAmount\tFace Grouping\tNote Grouping\tSub-Note Grouping
Duties & Taxes\tTDS Payable - 194C\t-45000
Duties & Taxes\tTDS Payable - 194J\t-32000
Duties & Taxes\tGST Payable\t-206919
Duties & Taxes\tProfession Tax Payable\t-3600
Duties & Taxes\tESIC Payable\t-8972
Duties & Taxes\tProvident Fund Payable\t-14500
Current Liabilities\tAudit Fees Payable\t-50000
Capital Account\tEquity Share Capital\t-102010\tShare capital\tIssued Equity Share Capital
Bank Accounts\tHDFC Bank - Current A/c\t340000
Bank OD A/c\tICICI Bank Ltd OD-3967\t-931030
Sundry Debtors\tBharti Airtel Limited\t1250000
Deposits (Asset)\tRent Deposit - Noida\t85000`;

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  document.execCommand('copy'); document.body.removeChild(ta);
  return Promise.resolve();
}

const AMT_FMT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const fmtAmt = (n) => (n == null ? '' : AMT_FMT.format(n));

// ---- small building blocks ----------------------------------------------
function Stat({ label, value, color }) {
  return (
    <div style={{ padding: '10px 16px', borderRight: `1px solid ${COLORS.BORDER}` }}>
      <div style={{ fontSize: 22, fontWeight: 600, fontFamily: FONTS.SERIF, color: color || COLORS.TEXT }}>{value}</div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.TEXT_MUTED, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function CopyBtn({ text, label, icon: Icon = Copy, disabled }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      disabled={disabled}
      onClick={async () => { await copyToClipboard(text); setDone(true); setTimeout(() => setDone(false), 1600); }}
      style={done ? { borderColor: COLORS.LOW, color: COLORS.LOW } : undefined}
    >
      {done ? <Check size={14} /> : <Icon size={14} />}
      {done ? 'Copied' : label}
    </Button>
  );
}

// =========================================================================
export function GroupingMapper() {
  const [apiKey, setApiKeyState] = useState(() => getApiKey() || '');
  // Flash is the only model this app uses — no picker, no setter needed.
  const model = getSettings().mapperModel || 'deepseek-v4-flash';
  const [showKey, setShowKey] = useState(false);

  const [pasteText, setPasteText] = useState('');
  const [parsed, setParsed] = useState(null);      // { rows, cols, headerRow }
  const [fileName, setFileName] = useState('');
  const [parseErr, setParseErr] = useState('');

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState(null);    // Array
  const [stats, setStats] = useState(null);
  const [runErr, setRunErr] = useState('');

  const [filter, setFilter] = useState('all');     // all | fill | change | review
  const [query, setQuery] = useState('');
  const [view, setView] = useState('rows');        // rows | subnotes
  const abortRef = useRef(null);
  const fileRef = useRef(null);

  // Excel download — own single-flight guard, isolated from the reviewer mode's.
  const [xlsxExporting, setXlsxExporting] = useState(false);
  const exportLockRef = useRef(createExportLock());

  const saveKey = (k) => { setApiKeyState(k); persistApiKey(k); };

  // ---- ingest ----
  const ingestGrid = useCallback((grid, srcName) => {
    setParseErr(''); setRunErr(''); setResults(null); setStats(null);
    const p = parseGrid(grid);
    if (!p.rows.length) { setParsed(null); setParseErr('No ledger rows detected. Make sure a "Name of Ledger" column is present (or paste ledger names in the first column).'); return; }
    setParsed(p); if (srcName) setFileName(srcName);
  }, []);

  const onPaste = (text) => {
    setPasteText(text);
    setFileName('');
    if (!text.trim()) { setParsed(null); setParseErr(''); return; }
    const p = parsePasted(text);
    setParseErr(''); setRunErr(''); setResults(null); setStats(null);
    if (!p.rows.length) { setParsed(null); setParseErr('No ledger rows detected in the pasted text.'); return; }
    setParsed(p);
  };

  const onFile = async (file) => {
    if (!file) return;
    setPasteText('');
    try {
      const grid = await readWorkbookToGrid(file);
      ingestGrid(grid, file.name);
    } catch (err) {
      setParsed(null);
      setParseErr(`Could not read "${file.name}": ${err.message}. If the CDN is blocked, copy-paste the T_B columns instead.`);
    }
  };

  // ---- run ----
  const run = async () => {
    if (!parsed?.rows?.length) return;
    if (!apiKey) { setShowKey(true); setRunErr('Add your DeepSeek API key first.'); return; }
    setRunning(true); setRunErr(''); setResults(null); setStats(null);
    setProgress({ done: 0, total: parsed.rows.length });
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const { results: res, stats: st } = await mapGroupings({
        rows: parsed.rows, apiKey, model, signal: ctrl.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResults(res); setStats(st);
      setView(st.review > 0 ? 'rows' : 'rows');
    } catch (err) {
      if (err.name !== 'AbortError') setRunErr(err.message || 'Mapping failed.');
    } finally {
      setRunning(false); abortRef.current = null;
    }
  };
  const cancel = () => { abortRef.current?.abort(); setRunning(false); };

  // ---- edit a result row ----
  const editRow = (idx, patch) => {
    setResults((prev) => prev.map((r) => {
      if (r.idx !== idx) return r;
      const next = { ...r, ...patch };
      if (patch.face !== undefined) {
        // face changed → note may no longer be valid
        const opts = NOTES_BY_FACE[next.face] || [];
        if (!opts.includes(next.note)) next.note = opts.length === 1 ? opts[0] : '';
        next.status = next.face && next.note ? 'ok' : 'review';
      }
      if (patch.note !== undefined) next.status = next.face && next.note ? 'ok' : 'review';
      return next;
    }));
  };

  // ---- derived ----
  const filtered = useMemo(() => {
    if (!results) return [];
    const q = query.trim().toLowerCase();
    const rows = results.filter((r) => {
      if (filter === 'review' && r.status !== 'review') return false;
      if (filter === 'fill' && r.action !== 'fill') return false;
      if (filter === 'change' && r.action !== 'change') return false;
      if (filter === 'verify' && !(r.flags || []).some((f) => f.startsWith('verify:'))) return false;
      if (q && !(`${r.ledger} ${r.face} ${r.note} ${r.subNote}`.toLowerCase().includes(q))) return false;
      return true;
    });
    // Review-oriented filters: show the MATERIAL items first (display only — the
    // G:I copy/export use `results`, so paste order is unaffected). 'all'/'fill'
    // keep the original trial-balance order for context.
    if (filter === 'verify' || filter === 'review' || filter === 'change') {
      return [...rows].sort((a, b) => Math.abs(b.amount || 0) - Math.abs(a.amount || 0));
    }
    return rows;
  }, [results, filter, query]);

  const subNoteGroups = useMemo(() => {
    if (!results) return [];
    const map = new Map();
    results.forEach((r) => {
      const k = `${r.face}||${r.note}||${r.subNote}`;
      if (!map.has(k)) map.set(k, { face: r.face, note: r.note, subNote: r.subNote, ledgers: [], total: 0, immaterial: false });
      const g = map.get(k); g.ledgers.push(r.ledger); g.total += r.amount || 0;
      if ((r.flags || []).includes('immaterial')) g.immaterial = true;
    });
    return [...map.values()].sort((a, b) =>
      (a.face || '').localeCompare(b.face || '') || (a.note || '').localeCompare(b.note || '') || (a.subNote || '').localeCompare(b.subNote || ''));
  }, [results]);

  const acceptedTSV = results ? toGroupingTSV(results, parsed?.layout) : '';
  const verifyCount = useMemo(
    () => (results || []).filter((r) => (r.flags || []).some((f) => f.startsWith('verify:'))).length,
    [results],
  );

  // ============ RENDER ============
  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 20px 80px' }}>
      {/* intro */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, margin: '26px 0 18px' }}>
        <div style={{ background: COLORS.PRIMARY, color: '#faf6ee', borderRadius: 10, padding: 10, display: 'flex' }}>
          <Layers size={22} />
        </div>
        <div>
          <h1 style={{ fontFamily: FONTS.SERIF, fontSize: 26, color: COLORS.TEXT, margin: 0, fontWeight: 600 }}>Grouping Mapper</h1>
          <p style={{ color: COLORS.TEXT_MUTED, fontSize: 14, margin: '4px 0 0', maxWidth: 760, lineHeight: 1.55 }}>
            Paste or upload your trial balance. AI assigns a validated <b>Face</b>, <b>Note</b> and a
            well-drafted <b>Sub-Note</b> grouping to every ledger — copy the three columns straight back
            into the Schedule III tool's data-validated cells. Face and Note are constrained to the tool's exact dropdown lists; Sub-Note is free text you can tune.
          </p>
        </div>
      </div>

      {/* API key + model bar */}
      <Card style={{ marginBottom: 16, padding: 14 }} accentColor={apiKey ? COLORS.LOW : COLORS.HIGH}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: COLORS.TEXT_MUTED, fontSize: 12 }}>
            <KeyRound size={15} /> DeepSeek key
          </div>
          <div style={{ position: 'relative', flex: '1 1 320px', minWidth: 240 }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => saveKey(e.target.value)}
              placeholder="sk-…  (stored only in your browser)"
              style={{
                width: '100%', padding: '8px 34px 8px 10px', background: COLORS.BG_CREAM,
                border: `1px solid ${COLORS.BORDER_STRONG}`, borderRadius: 5,
                fontSize: 13, fontFamily: FONTS.MONO, color: COLORS.TEXT, boxSizing: 'border-box',
              }}
            />
            <button
              type="button"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              onClick={() => setShowKey((s) => !s)}
              style={{ position: 'absolute', right: 6, top: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: COLORS.TEXT_FAINT, fontSize: 11 }}
            >{showKey ? 'hide' : 'show'}</button>
          </div>
          {/* Flash is the only model this app uses — static readout, no picker */}
          <div style={{ padding: '8px 10px', background: COLORS.BG_CREAM, border: `1px solid ${COLORS.BORDER_STRONG}`, borderRadius: 5, fontSize: 13, fontFamily: FONTS.MONO, color: COLORS.TEXT_MUTED }}>
            {model}
          </div>
        </div>
      </Card>

      {/* input */}
      {!results && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Upload .xlsb / .xlsx / .xls / .csv
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xlsb,.xls,.ods,.csv" style={{ display: 'none' }}
              onChange={(e) => onFile(e.target.files?.[0])} />
            <Button variant="ghost" onClick={() => onPaste(SAMPLE)}>
              <Sparkles size={14} /> Load sample
            </Button>
            {(pasteText || parsed) && (
              <Button variant="ghost" onClick={() => { setPasteText(''); setParsed(null); setFileName(''); setParseErr(''); }}>
                <X size={14} /> Clear
              </Button>
            )}
            <div style={{ flex: 1 }} />
            {fileName && <span style={{ alignSelf: 'center', fontSize: 12, color: COLORS.TEXT_MUTED }}><Table2 size={13} style={{ verticalAlign: -2 }} /> {fileName}</span>}
          </div>

          {!fileName && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: COLORS.TEXT_MUTED, fontSize: 12, marginBottom: 6 }}>
                <ClipboardPaste size={14} /> Paste the T_B columns (Ledger, Amount, and any existing Face / Note / Sub-Note)
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => onPaste(e.target.value)}
                placeholder={'Name of Ledger\tAmount\tFace Grouping\tNote Grouping\tSub-Note Grouping\nTDS Payable - 194C\t-45000\n…'}
                spellCheck={false}
                style={{
                  width: '100%', minHeight: 150, padding: 12, boxSizing: 'border-box',
                  background: COLORS.BG_CREAM, border: `1px solid ${COLORS.BORDER_STRONG}`, borderRadius: 6,
                  fontFamily: FONTS.MONO, fontSize: 12.5, color: COLORS.TEXT, lineHeight: 1.5, resize: 'vertical',
                }}
              />
            </>
          )}

          {parseErr && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: COLORS.HIGH_BG, border: `1px solid ${COLORS.HIGH}`, borderRadius: 6, color: COLORS.HIGH, fontSize: 12.5, display: 'flex', gap: 8 }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {parseErr}
            </div>
          )}

          {parsed && (
            <>
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: COLORS.TEXT }}>
                  <b>{parsed.rows.length}</b> ledgers detected
                  {parsed.cols.face != null && <span style={{ color: COLORS.TEXT_MUTED }}> · existing Face/Note columns found</span>}
                </span>
                <div style={{ flex: 1 }} />
                <Button onClick={run} disabled={running}>
                  <Play size={14} /> Map {parsed.rows.length} ledgers with AI
                </Button>
              </div>
              {parsed.interiorSkips > 0 && (
                <div style={{ marginTop: 10, padding: '9px 12px', background: COLORS.HIGH_BG, border: `1px solid ${COLORS.HIGH}`, borderRadius: 6, color: COLORS.HIGH, fontSize: 12, display: 'flex', gap: 8 }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  {parsed.interiorSkips} blank/total row(s) sit between ledgers and were skipped. The
                  "Copy Face·Note·Sub-Note (G:I)" block inserts blank lines at those positions so it
                  stays row-aligned with your source on a block-paste.
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* running */}
      {running && (
        <Card style={{ marginBottom: 16 }} accentColor={COLORS.PRIMARY}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RefreshCw size={18} className="gm-spin" style={{ color: COLORS.PRIMARY }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: COLORS.TEXT, marginBottom: 6 }}>
                Mapping ledgers to Schedule III groupings… {progress.done}/{progress.total}
              </div>
              <div style={{ height: 6, background: COLORS.BORDER, borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress.total ? (progress.done / progress.total) * 100 : 5}%`, background: COLORS.PRIMARY, transition: 'width 300ms' }} />
              </div>
            </div>
            <Button variant="danger" onClick={cancel}><X size={14} /> Cancel</Button>
          </div>
        </Card>
      )}

      {runErr && !running && (
        <div style={{ marginBottom: 16, padding: '12px 14px', background: COLORS.CRIT_BG, border: `1px solid ${COLORS.CRIT}`, borderRadius: 8, color: COLORS.CRIT, fontSize: 13, display: 'flex', gap: 8 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {runErr}
        </div>
      )}

      {/* results */}
      {results && stats && (
        <>
          {/* stat strip + actions */}
          <Card style={{ marginBottom: 14, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
              <Stat label="Ledgers" value={stats.total} />
              <Stat label="Blanks filled" value={stats.filled} color={COLORS.LOW} />
              <Stat label="Reclassified" value={stats.changed} color={COLORS.HIGH} />
              <Stat label="Sub-note groups" value={stats.subNoteGroups} color={COLORS.PRIMARY} />
              <button type="button" disabled={!verifyCount}
                onClick={() => { setView('rows'); setFilter('verify'); }}
                style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', textAlign: 'left', cursor: verifyCount ? 'pointer' : 'default' }}
                title={verifyCount ? 'Show rows flagged to verify' : 'Nothing flagged'}>
                <Stat label="To verify" value={verifyCount} color={verifyCount ? COLORS.HIGH : COLORS.TEXT_MUTED} />
              </button>
              <Stat label="Needs review" value={stats.review} color={stats.review ? COLORS.CRIT : COLORS.TEXT_MUTED} />
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap' }}>
                <CopyBtn text={acceptedTSV} label="Copy Face·Note·Sub-Note (G:I)" icon={Copy} disabled={!acceptedTSV} />
                <CopyBtn text={toFullTSV(results)} label="Copy full table" icon={Copy} />
                <Button
                  variant="ghost"
                  disabled={xlsxExporting}
                  onClick={() => exportLockRef.current.runExport(
                    () => downloadMappingExcel(results, fileName || 'Grouping'),
                    setXlsxExporting,
                  )}
                >
                  <Download size={14} /> Excel
                </Button>
                <Button variant="ghost" onClick={() => { setResults(null); setStats(null); }}>
                  <RefreshCw size={14} /> New
                </Button>
              </div>
            </div>
          </Card>

          {stats.review > 0 && (
            <div style={{ marginBottom: 12, padding: '9px 12px', background: COLORS.CRIT_BG, border: `1px solid ${COLORS.CRIT}`, borderRadius: 6, color: COLORS.CRIT, fontSize: 12.5, display: 'flex', gap: 8 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              {stats.review} ledger(s) need review — fix the Face/Note below before pasting. The G:I copy only includes accepted rows.
            </div>
          )}

          {verifyCount > 0 && filter !== 'verify' && (
            <button type="button"
              onClick={() => { setView('rows'); setFilter('verify'); }}
              style={{ width: '100%', marginBottom: 12, padding: '9px 12px', background: COLORS.HIGH_BG, border: `1px solid ${COLORS.HIGH}`, borderRadius: 6, color: COLORS.HIGH, fontSize: 12.5, display: 'flex', gap: 8, cursor: 'pointer', alignItems: 'center', textAlign: 'left', font: 'inherit' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              {verifyCount} ledger(s) flagged to verify (sign / Tally / provision) — valid to paste, but worth a second look. Click to filter.
            </button>
          )}

          {/* view toggle + filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', border: `1px solid ${COLORS.BORDER_STRONG}`, borderRadius: 8, overflow: 'hidden' }}>
              {[['rows', 'Ledger view'], ['subnotes', 'Sub-note groups']].map(([k, lbl]) => (
                <button key={k} type="button" onClick={() => setView(k)}
                  style={{ padding: '7px 14px', border: 'none', cursor: 'pointer', fontSize: 12.5, fontFamily: FONTS.BODY,
                    background: view === k ? COLORS.PRIMARY : 'transparent', color: view === k ? '#faf6ee' : COLORS.TEXT_MUTED }}>
                  {lbl}
                </button>
              ))}
            </div>
            {view === 'rows' && (
              <>
                <div style={{ display: 'inline-flex', gap: 4 }}>
                  {[['all', 'All'], ['fill', 'Filled'], ['change', 'Changed'], ['verify', 'Verify'], ['review', 'Review']].map(([k, lbl]) => (
                    <button key={k} type="button" onClick={() => setFilter(k)}
                      style={{ padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontFamily: FONTS.BODY,
                        border: `1px solid ${filter === k ? COLORS.PRIMARY : COLORS.BORDER_STRONG}`,
                        background: filter === k ? COLORS.PRIMARY : 'transparent', color: filter === k ? '#faf6ee' : COLORS.TEXT_MUTED }}>
                      {lbl}
                    </button>
                  ))}
                </div>
                <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 300 }}>
                  <Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: COLORS.TEXT_FAINT }} />
                  <input value={query} aria-label="Search ledgers" onChange={(e) => setQuery(e.target.value)} placeholder="Search ledgers…"
                    style={{ width: '100%', padding: '7px 10px 7px 30px', background: COLORS.BG_CREAM, border: `1px solid ${COLORS.BORDER_STRONG}`, borderRadius: 6, fontSize: 12.5, fontFamily: FONTS.BODY, color: COLORS.TEXT, boxSizing: 'border-box' }} />
                </div>
              </>
            )}
          </div>

          {view === 'rows' ? (
            <RowsTable rows={filtered} onEdit={editRow} />
          ) : (
            <SubNotePanel groups={subNoteGroups} />
          )}
        </>
      )}

      <style>{`@keyframes gm-spin{to{transform:rotate(360deg)}}.gm-spin{animation:gm-spin 1s linear infinite}`}</style>
    </div>
  );
}

// ---- rows table ---------------------------------------------------------
function RowsTable({ rows, onEdit }) {
  if (!rows.length) return <Card style={{ textAlign: 'center', color: COLORS.TEXT_MUTED, fontSize: 13 }}>No ledgers match this filter.</Card>;
  const th = { textAlign: 'left', padding: '9px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: COLORS.TEXT_MUTED, fontWeight: 600, borderBottom: `1px solid ${COLORS.BORDER}`, position: 'sticky', top: 0, background: COLORS.BG_CARD };
  const selStyle = { width: '100%', padding: '5px 6px', background: COLORS.BG_CREAM, border: `1px solid ${COLORS.BORDER}`, borderRadius: 4, fontSize: 12, fontFamily: FONTS.BODY, color: COLORS.TEXT, boxSizing: 'border-box' };
  return (
    <div style={{ border: `1px solid ${COLORS.BORDER}`, borderRadius: 10, overflow: 'auto', maxHeight: '68vh', background: COLORS.BG_CARD }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
        <thead>
          <tr>
            <th style={th}>Ledger</th>
            <th style={{ ...th, textAlign: 'right' }}>Amount</th>
            <th style={th}>Face grouping</th>
            <th style={th}>Note grouping</th>
            <th style={th}>Sub-note grouping</th>
            <th style={{ ...th, textAlign: 'center' }}>Flag</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const bg = r.status === 'review' ? COLORS.CRIT_BG : r.action === 'change' ? COLORS.HIGH_BG : 'transparent';
            return (
              <tr key={r.idx} style={{ background: bg, borderBottom: `1px solid ${COLORS.BORDER}` }}>
                <td style={{ padding: '7px 10px', fontSize: 12.5, color: COLORS.TEXT, maxWidth: 240 }}>
                  {r.ledger}
                  {r.reason && <div style={{ fontSize: 10.5, color: COLORS.TEXT_FAINT, marginTop: 1 }}>{r.reason}</div>}
                  {(r.flags || []).filter((f) => f.startsWith('verify:')).map((f) => (
                    <div key={f} style={{ fontSize: 10.5, color: COLORS.HIGH, marginTop: 1 }}>⚑ {f.replace('verify: ', '')}</div>
                  ))}
                </td>
                <td style={{ padding: '7px 10px', fontSize: 12, textAlign: 'right', fontFamily: FONTS.MONO, color: r.amount < 0 ? COLORS.CRIT : COLORS.TEXT }}>{fmtAmt(r.amount)}</td>
                <td style={{ padding: '6px 8px', minWidth: 170 }}>
                  <select aria-label={`Face grouping for ${r.ledger}`} value={r.face} onChange={(e) => onEdit(r.idx, { face: e.target.value })} style={selStyle}>
                    <option value="">— select —</option>
                    {FACE_HEADS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </td>
                <td style={{ padding: '6px 8px', minWidth: 190 }}>
                  <select aria-label={`Note grouping for ${r.ledger}`} value={r.note} onChange={(e) => onEdit(r.idx, { note: e.target.value })} style={selStyle} disabled={!r.face}>
                    <option value="">— select —</option>
                    {(NOTES_BY_FACE[r.face] || []).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td style={{ padding: '6px 8px', minWidth: 170 }}>
                  <input aria-label={`Sub-note grouping for ${r.ledger}`} value={r.subNote} onChange={(e) => onEdit(r.idx, { subNote: e.target.value })} style={selStyle} placeholder="presentation label" />
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'center' }}>
                  {r.status === 'review'
                    ? <AlertTriangle size={14} style={{ color: COLORS.CRIT }} />
                    : r.action === 'fill' ? <span style={{ fontSize: 10, color: COLORS.LOW, fontWeight: 600 }}>FILLED</span>
                    : r.action === 'change' ? <span style={{ fontSize: 10, color: COLORS.HIGH, fontWeight: 600 }}>CHANGED</span>
                    : <Check size={13} style={{ color: COLORS.TEXT_FAINT }} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- sub-note presentation panel (balance-sheet face preview) -----------
// Mirrors how the note schedule reads on the BS: sub-notes sorted material-first
// (by |amount| desc), a subtotal per Note, and a Face total in the header. Notes
// and Faces are ordered by absolute magnitude so the big lines come first.
function SubNotePanel({ groups }) {
  const byFace = useMemo(() => {
    const m = new Map();
    groups.forEach((g) => {
      if (!m.has(g.face)) m.set(g.face, new Map());
      const notes = m.get(g.face);
      if (!notes.has(g.note)) notes.set(g.note, []);
      notes.get(g.note).push(g);
    });
    // build ordered structure with subtotals
    const faces = [...m.entries()].map(([face, notes]) => {
      const noteList = [...notes.entries()].map(([note, subs]) => {
        const sorted = sortSubNotesForFace(subs);          // material-first, "Others" last
        const total = sorted.reduce((s, x) => s + x.total, 0);
        return { note, subs: sorted, total };
      }).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
      const total = noteList.reduce((s, n) => s + n.total, 0);
      return { face, notes: noteList, total };
    }).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    return faces;
  }, [groups]);

  const amtStyle = (v) => ({ padding: '6px 8px', fontSize: 12.5, textAlign: 'right', fontFamily: FONTS.MONO, color: v < 0 ? COLORS.CRIT : COLORS.TEXT });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {byFace.map(({ face, notes, total }) => (
        <Card key={face} accentColor={COLORS.PRIMARY} padding={0}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 18px', borderBottom: `1px solid ${COLORS.BORDER}` }}>
            <span style={{ fontFamily: FONTS.SERIF, fontSize: 16, color: COLORS.TEXT, fontWeight: 600 }}>{face || '(unassigned)'}</span>
            <span style={{ fontFamily: FONTS.MONO, fontSize: 13, fontWeight: 600, color: total < 0 ? COLORS.CRIT : COLORS.TEXT }}>{fmtAmt(total)}</span>
          </div>
          <div style={{ padding: '6px 18px 16px' }}>
            {notes.map(({ note, subs, total: noteTotal }) => (
              <div key={note} style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: COLORS.TEXT_MUTED, fontWeight: 600 }}>{note || '(no note)'}</span>
                  <span style={{ fontSize: 12, fontFamily: FONTS.MONO, color: COLORS.TEXT_MUTED }}>{fmtAmt(noteTotal)}</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {subs.map((s) => (
                      <tr key={s.subNote} style={{ borderBottom: `1px solid ${COLORS.BORDER}`, opacity: s.immaterial ? 0.62 : 1 }}>
                        <td style={{ padding: '6px 8px', fontSize: 13, color: COLORS.TEXT, width: '38%' }}>
                          {s.subNote || <span style={{ color: COLORS.TEXT_FAINT }}>(blank)</span>}
                          {s.immaterial && <span title="Singleton < 1% of note total — consider grouping into Others" style={{ marginLeft: 6, fontSize: 9.5, color: COLORS.HIGH, border: `1px solid ${COLORS.HIGH}`, borderRadius: 4, padding: '0 4px', verticalAlign: 'middle' }}>immaterial</span>}
                        </td>
                        <td style={{ padding: '6px 8px', fontSize: 11.5, color: COLORS.TEXT_FAINT }}>{s.ledgers.length} ledger{s.ledgers.length > 1 ? 's' : ''}: {s.ledgers.slice(0, 4).join(', ')}{s.ledgers.length > 4 ? '…' : ''}</td>
                        <td style={amtStyle(s.total)}>{fmtAmt(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
