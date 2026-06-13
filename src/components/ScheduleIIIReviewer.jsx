// ============ SCHEDULE III REVIEWER — MAIN ORCHESTRATOR ============
// Manages all state, phases, and routing between feature components.
//
// Phase machine:
//   upload → extracting → preview → analyzing-sch3 → analyzing-caro → done | error

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Layers, ShieldCheck, Hash, FileSignature, XCircle, RotateCcw, Building2, FilePlus2,
} from 'lucide-react';

import { COLORS, FONTS, SEVERITY, BTN_PRIMARY } from '../styles/tokens.js';
import { CARO_PROMPT, NOTES_DRAFT_PROMPT } from '../data/prompts.js';
import { runSch3Sectioned }                from '../lib/sch3Run.js';
import { STANDARD_CARO_REMARKS }                 from '../data/caroRemarks.js';
import { DEFAULT_REPORT_FIELDS }                 from '../data/reportDefaults.js';
import { extractPdfToMarkdown }                  from '../lib/pdfExtract.js';
import { extractExcelToMarkdown, isExcelFile }   from '../lib/excelExtract.js';
import { ocrPdfToMarkdown }                      from '../lib/ocrPdf.js';
import { callDeepSeek, chatDeepSeek, AuthError, RateLimitError, ApiError } from '../lib/deepseek.js';
import { generateReport, downloadAsWord, downloadAccountingPoliciesWord } from '../lib/docExport.js';
import { exportExcel }                           from '../lib/excelExport.js';
import { fmtLakhs }                              from '../lib/format.js';
import {
  getApiKey, getSettings, saveEngagement, loadEngagement, importEngagement,
  exportEngagement, getRunPrefs, saveRunPrefs,
} from '../lib/engagementStore.js';
import { computeCaroApplicability, synthesiseExemptCaroResult } from '../lib/caroApplicability.js';
import { sanitiseSch3Response } from '../lib/sch3Sanitise.js';
import { anchorIssuesToPages } from '../lib/sourceAnchor.js';
import { setIssueStatus, setIssueNote } from '../lib/issueState.js';
import { runRuleEngine, mergeAnalyses } from '../lib/ruleEngine.js';
import { SourceModal } from './SourceModal.jsx';
import { IssueList } from './IssueList.jsx';

import { SettingsGate }          from './SettingsGate.jsx';
import { SettingsPanel }         from './SettingsPanel.jsx';
import { EngagementHeader }      from './EngagementHeader.jsx';
import { FileUpload }            from './FileUpload.jsx';
import { PdfMarkdownPreview }    from './PdfMarkdownPreview.jsx';
import { AnalyzingProgress }     from './AnalyzingProgress.jsx';
import { SeveritySummary }       from './SeveritySummary.jsx';
import { CaroApplicabilityView } from './CaroApplicabilityView.jsx';
import { ClauseRow }             from './ClauseRow.jsx';
import { AuditReportTab }        from './AuditReportTab.jsx';
import { SuggestedNotesTab }     from './SuggestedNotesTab.jsx';
import { ChatLauncher, EngagementChat, CHAT_MAX_TURNS } from './EngagementChat.jsx';

// ── CompanyHeader ────────────────────────────────────────────────────────────
function Metric({ label, value, alert }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: COLORS.TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 13, fontWeight: 500, color: alert ? COLORS.CRIT : COLORS.TEXT }}>
        {value}
      </div>
    </div>
  );
}

function CompanyHeader({ company, metrics, counts, caroApplies, caroRun }) {
  const totalIssues = (counts.CRITICAL || 0) + (counts.HIGH || 0) + (counts.MEDIUM || 0) + (counts.LOW || 0);
  const caroLabel = !caroRun
    ? 'Not run'
    : (caroApplies ? 'Applies' : 'Does not apply');
  const caroColor = !caroRun
    ? COLORS.TEXT_MUTED
    : (caroApplies ? COLORS.CRIT : '#3e6034');
  return (
    <div className="card fade-in" style={{ padding: 24, borderRadius: 12, marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, marginBottom: 20 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Building2 size={14} color={COLORS.TEXT_MUTED} />
            <span style={{ fontSize: 11, color: COLORS.TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Auditee
            </span>
          </div>
          <h2 className="serif" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.15, marginBottom: 4 }}>
            {company.name}
          </h2>
          <div className="mono" style={{ fontSize: 12, color: COLORS.TEXT_MUTED }}>
            {company.cin} · FY ending {company.yearEnd}
          </div>
          {company.isFirstYear && (
            <div style={{
              display: 'inline-block', marginTop: 8, padding: '3px 10px',
              background: '#fef9f1', border: `1px solid ${COLORS.BORDER_STRONG}`,
              borderRadius: 999, fontSize: 11, color: COLORS.PRIMARY,
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>
              First reporting period
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: COLORS.TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Issues flagged
          </div>
          <div className="serif" style={{ fontSize: 36, fontWeight: 600, lineHeight: 1, color: (counts.CRITICAL || 0) > 0 ? COLORS.CRIT : COLORS.PRIMARY }}>
            {totalIssues}
          </div>
          <div style={{ fontSize: 11, color: COLORS.TEXT_MUTED, marginTop: 4 }}>
            CARO 2020:{' '}
            <strong style={{ color: caroColor }}>
              {caroLabel}
            </strong>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, paddingTop: 16, borderTop: `1px solid ${COLORS.BORDER}` }}>
        <Metric label="Revenue"             value={fmtLakhs(metrics.revenueLakhs)} />
        <Metric label="PBT"                 value={fmtLakhs(metrics.profitBeforeTaxLakhs)} />
        <Metric label="Current tax"         value={fmtLakhs(metrics.currentTaxLakhs)}
          alert={metrics.profitBeforeTaxLakhs > 0 && metrics.currentTaxLakhs === 0} />
        <Metric label="Capital + Reserves"  value={fmtLakhs((metrics.paidUpCapitalLakhs || 0) + (metrics.reservesLakhs || 0))} />
        <Metric label="Borrowings"          value={fmtLakhs(metrics.totalBorrowingsLakhs)} />
        <Metric label="PPE"                 value={fmtLakhs(metrics.fixedAssetsLakhs)}
          alert={metrics.fixedAssetsLakhs === 0} />
      </div>
    </div>
  );
}

// ── Tab button ───────────────────────────────────────────────────────────────
function TabBtn({ active, onClick, children, count }) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      style={{
        padding: '12px 18px', background: 'transparent', border: 'none',
        borderBottom: active ? `2px solid ${COLORS.PRIMARY}` : '2px solid transparent',
        marginBottom: -1, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 13, fontFamily: FONTS.BODY,
        color: active ? COLORS.PRIMARY : COLORS.TEXT_MUTED,
        fontWeight: active ? 600 : 500, transition: 'color 150ms',
      }}
    >
      {children}
      {count !== undefined && (
        <span style={{
          background: active ? COLORS.PRIMARY : COLORS.BG_CREAM,
          color:      active ? '#faf6ee'      : COLORS.TEXT_MUTED,
          padding: '1px 7px', borderRadius: 999, fontSize: 11,
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function ScheduleIIIReviewer() {
  // ── Settings / API key ──
  const [apiKey,      setApiKey]      = useState(() => getApiKey() || '');
  const [settings,    setSettings]    = useState(() => getSettings());
  const [showSettings, setShowSettings] = useState(false);
  // Soft-gate — user can dismiss the API-key prompt and use Quick Review only
  const [gateSkipped, setGateSkipped] = useState(false);
  // Tracks last-analysis source so the Done screen can show appropriate CTAs
  const [analysisSource, setAnalysisSource] = useState(null);  // 'rule' | 'rule+ai'

  // ── Upload phase ──
  const [file,     setFile]     = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState('');

  // ── Extract phase ──
  const [phase,        setPhase]        = useState('upload');
  const [markdown,     setMarkdown]     = useState('');
  const [pdfMeta,      setPdfMeta]      = useState(null);
  const [pdfPages,     setPdfPages]     = useState([]);  // [{pageNum, text}] for source anchoring
  const [extractError, setExtractError] = useState('');

  // ── Source modal (issue → page click-through) ──
  const [sourceModalIssue, setSourceModalIssue] = useState(null);

  // ── OCR (for scanned PDFs) ──
  const [ocrRunning,  setOcrRunning]  = useState(false);
  const [ocrProgress, setOcrProgress] = useState(null);

  // ── Accounting policies drafter ──
  // Now a SINGLE comprehensive note: { noteTitle, introText, subPolicies: [{heading, body}] }
  const [draftedPolicy,   setDraftedPolicy]   = useState(null);   // null = not yet generated
  const [notesGenerating, setNotesGenerating] = useState(false);
  const [notesProgress,   setNotesProgress]   = useState(null);
  const notesAbortRef = useRef(null);

  // ── Engagement chat ──
  const [chatOpen,     setChatOpen]     = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatSending,  setChatSending]  = useState(false);

  // ── Issue review state (Accept / Dismiss / For-review + audit trail) ──
  // Shape: { [issueId]: { status, history, note } } — see lib/issueState.js
  const [issueStates,        setIssueStates]        = useState({});
  const [currentEngagementId, setCurrentEngagementId] = useState(null);

  // ── Analysis ──
  const [analysis,    setAnalysis]    = useState(null);
  const [caro,        setCaro]        = useState(null);
  const [analysisError, setAnalysisError] = useState('');
  const [tokenUsage,  setTokenUsage]  = useState({ sch3: null, caro: null });
  const abortRef = useRef(null);

  // ── Per-run controls (overridable in PdfMarkdownPreview before each Analyse) ──
  // Restore last-used choices from localStorage so the user's preferences
  // survive across engagements. The Settings panel still owns the global default.
  const [selectedModel, setSelectedModel] = useState(() => {
    const prefs = getRunPrefs();
    return prefs.model || getSettings().model || 'deepseek-v4-pro';
  });
  const [runCaro, setRunCaro] = useState(() => getRunPrefs().runCaro);
  // Tracks whether the model has begun streaming output for the active call.
  const [analysisStartedAt,    setAnalysisStartedAt]    = useState(null);
  const [firstTokenReceivedAt, setFirstTokenReceivedAt] = useState(null);

  // Keep selectedModel in sync if the user changes the default in Settings —
  // but only when there's no explicit per-run pref saved.
  useEffect(() => {
    const prefs = getRunPrefs();
    if (!prefs.model && settings.model && settings.model !== selectedModel) {
      setSelectedModel(settings.model);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.model]);

  // Persist per-run preferences whenever the user changes them.
  useEffect(() => {
    saveRunPrefs({ model: selectedModel, runCaro });
  }, [selectedModel, runCaro]);

  // ── Results ──
  const [tab,          setTab]         = useState('issues');
  const [reportFields, setReportFields] = useState({ ...DEFAULT_REPORT_FIELDS });
  const [exporting,    setExporting]   = useState(false);

  // ── Import ref (hidden input for engagement JSON) ──
  const importRef = useRef(null);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'e' && phase === 'done') {
        e.preventDefault();
        handleExportExcel();
      }
      // Cmd/Ctrl+K toggles the engagement chat in the Done state
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && phase === 'done') {
        e.preventDefault();
        setChatOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, analysis, caro, reportFields]);

  // ── Sync firm defaults into report fields when settings change ──
  useEffect(() => {
    setReportFields((prev) => ({
      ...prev,
      firmName:    settings.firmName    || prev.firmName,
      firmFRN:     settings.firmFRN     || prev.firmFRN,
      partnerName: settings.partnerName || prev.partnerName,
      membershipNo:settings.membershipNo || prev.membershipNo,
      place:       settings.place       || prev.place,
    }));
  }, [settings]);

  // ════════════════════════════════════════════════════
  // FILE HANDLING
  // ════════════════════════════════════════════════════
  const handleFile = useCallback((f) => {
    if (!f) return;
    const isPdf   = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
    const isExcel = isExcelFile(f);
    // Reject legacy .xls / .ods explicitly — ExcelJS reads .xlsx / .xlsm only.
    if (!isPdf && !isExcel) {
      if (/\.(xls|ods|csv)$/i.test(f.name || '')) {
        setFileError('Legacy .xls / .ods / .csv is not supported. Please re-save as .xlsx and retry.');
      } else {
        setFileError('Please upload a PDF (.pdf) or an Excel workbook (.xlsx).');
      }
      return;
    }
    if (f.size > 30 * 1024 * 1024) {
      setFileError('File too large (> 30 MB). Please compress and retry.');
      return;
    }
    setFile(f);
    setFileError('');
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  // ════════════════════════════════════════════════════
  // EXTRACT → PREVIEW
  // ════════════════════════════════════════════════════
  // OCR the currently-uploaded scanned PDF and replace the markdown / pages
  // with the OCR output. Stays in preview phase throughout.
  const runOCR = async () => {
    if (!file || ocrRunning) return;
    setOcrRunning(true);
    setOcrProgress({ phase: 'ocr-init', status: 'Initialising OCR engine…' });
    try {
      const buf = await file.arrayBuffer();
      const result = await ocrPdfToMarkdown(buf, {
        onProgress: (p) => setOcrProgress(p),
      });
      setMarkdown(result.markdown);
      setPdfMeta({
        pageCount:    result.pageCount,
        charCount:    result.charCount,
        looksScanned: false,
        ocrApplied:   true,
      });
      setPdfPages(result.pages || []);
    } catch (err) {
      console.error('OCR failed:', err);
      alert('OCR failed: ' + (err.message || 'Unknown error'));
    } finally {
      setOcrRunning(false);
      setOcrProgress(null);
    }
  };

  const runExtract = async (f = file) => {
    if (!f) return;
    setPhase('extracting');
    setExtractError('');
    const excel = isExcelFile(f);
    try {
      const buf = await f.arrayBuffer();
      // Excel and PDF both normalise to the same markdown shape, so everything
      // downstream (metricsExtract, rule engine, AI prompt) is format-agnostic.
      const result = excel
        ? await extractExcelToMarkdown(buf, { onProgress: () => {} })
        : await extractPdfToMarkdown(buf,   { onProgress: () => {} });
      setMarkdown(result.markdown);
      setPdfMeta({
        kind:         excel ? 'excel' : 'pdf',
        pageCount:    result.pageCount,    // sheets for Excel, pages for PDF
        charCount:    result.charCount,
        looksScanned: result.looksScanned, // always false for Excel — no OCR path
        grid:         result.grid || null, // structured cells (Excel only)
      });
      setPdfPages(result.pages || []);
      setPhase('preview');
    } catch (err) {
      console.error(`${excel ? 'Excel' : 'PDF'} extract failed:`, err);
      setExtractError(
        err.message ||
        (excel ? 'Failed to read the Excel workbook.' : 'Failed to extract text from PDF.')
      );
      setPhase('upload');
    }
  };

  // ════════════════════════════════════════════════════
  // ANALYSIS (SCH3 → optionally CARO)
  // ════════════════════════════════════════════════════

  // Internal helper: decide CARO applicability client-side from keyMetrics, then
  // either (a) skip the API call entirely and synthesise a "Does not apply"
  // object, or (b) fire the CARO LLM call. Returns the merged CARO object.
  const _runCaroCall = async (sch3, ctrl) => {
    const metrics = sch3.keyMetrics || {};
    const applicability = computeCaroApplicability(metrics);

    // (a) Client-side exempt — skip the API call entirely.
    if (!applicability.applies) {
      // Stub token usage so the header reflects "0 tokens" for CARO rather than null.
      setTokenUsage((prev) => ({ ...prev, caro: { input_tokens: 0, output_tokens: 0 } }));
      return synthesiseExemptCaroResult(metrics);
    }

    // (b) CARO applies — call DeepSeek for clause-level review.
    const caroJson = await callDeepSeek({
      apiKey,
      model:        selectedModel,
      systemPrompt: 'You are a senior Chartered Accountant applying CARO 2020 to Indian companies. Quote verbatim from the source where you cite figures or text. Do not paraphrase. Do not infer facts that are not in the document.',
      userPrompt:   CARO_PROMPT(
        sch3.keyMetrics,
        sch3.company?.name,
        sch3.company?.isFirstYear,
        sch3.company?.natureOfBusiness,
      ),
      signal:       ctrl.signal,
      temperature:  0.0,
      top_p:        0.1,
      onUsage:      (u) => setTokenUsage((prev) => ({ ...prev, caro: u })),
      onFirstToken: () => setFirstTokenReceivedAt(Date.now()),
    });

    // Trust client-side applicability if it disagrees with the LLM — arithmetic
    // is more reliable than the model. We only use the LLM for clause review.
    const finalApplicability = caroJson.applicability?.applies !== undefined
      ? (applicability.applies ? caroJson.applicability : applicability)
      : applicability;

    // Merge ICAI standard wording with AI-flagged review status
    const statusMap = new Map();
    (caroJson.clauseStatus || []).forEach((s) => statusMap.set(s.paragraph, s));

    const mergedClauses = finalApplicability.applies
      ? STANDARD_CARO_REMARKS.map((std) => {
          const status = statusMap.get(std.paragraph) || { needsReview: false, reviewNote: '' };
          return {
            paragraph:     std.paragraph,
            topic:         std.topic,
            applicability: status.needsReview ? 'Review' : 'Standard',
            needsReview:   !!status.needsReview,
            reviewNote:    status.reviewNote || '',
            remark:        std.standard,
            edited:        false,
          };
        })
      : [];

    return { applicability: finalApplicability, clauses: mergedClauses };
  };

  // ════════════════════════════════════════════════════
  // QUICK REVIEW — deterministic, no API call.
  // Runs the rule engine, optionally synthesises CARO applicability
  // client-side, and lands on the Done screen instantly.
  // ════════════════════════════════════════════════════
  const runQuickReview = async (mdText) => {
    if (!mdText?.trim()) return;
    setAnalysisError('');

    setPhase('analyzing-sch3');
    setAnalysisStartedAt(Date.now());
    setTokenUsage({ sch3: { input_tokens: 0, output_tokens: 0 }, caro: null });

    // Rule engine is synchronous; wrap in microtask just so the loading state shows briefly.
    await new Promise((r) => setTimeout(r, 200));

    const ruleResult = runRuleEngine(mdText);
    // Anchor issues to PDF pages so the "View source" chip still works on rule findings.
    const anchored = anchorIssuesToPages(ruleResult, pdfPages);
    setAnalysis(anchored);
    setAnalysisSource('rule');

    // Synthesise CARO applicability locally too (deterministic arithmetic).
    const caroLocal = synthesiseExemptCaroResult(ruleResult.keyMetrics);
    // If the metrics suggest CARO applies, leave it unanalysed but keep
    // the applicability conclusion so the user can opt into the AI CARO call.
    setCaro(caroLocal.applicability.applies
      ? { applicability: computeCaroApplicability(ruleResult.keyMetrics), clauses: [] }
      : caroLocal);

    // Reset issue states + start a new engagement entry.
    setIssueStates({});
    const newId = saveEngagement({ analysis: anchored, caro: caroLocal, reportFields, issueStates: {} });
    setCurrentEngagementId(newId);

    setPhase('done');
    setTab('issues');
  };

  const runAnalysis = async (mdText, opts = {}) => {
    if (!mdText?.trim()) return;
    const shouldRunCaro = opts.runCaro !== undefined ? opts.runCaro : runCaro;
    setAnalysisError('');

    // Fresh AbortController for this run
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      // ── Phase 1: Schedule III ──────────────────────────────────────────
      setPhase('analyzing-sch3');
      setTokenUsage({ sch3: null, caro: null });
      setAnalysisStartedAt(Date.now());
      setFirstTokenReceivedAt(null);

      // Fan the 73-test prompt out into six per-section DeepSeek calls run
      // concurrently, then merge. Wall-clock ≈ the slowest section instead of
      // the sum, and DeepSeek's prefix cache is hit on the shared
      // [system preamble + document] across the six calls. See lib/sch3Run.js.
      const rawSch3 = await runSch3Sectioned({
        apiKey,
        model:         selectedModel,
        systemRole:    'You are a senior Chartered Accountant reviewing Indian company financial statements for Schedule III compliance. Quote verbatim from the source document where you cite figures or disclosure text. Do not paraphrase. Do not infer facts that are not present in the document. If a required disclosure is absent, say so explicitly with the phrase "Disclosure not located in the document".',
        markdown:      mdText,
        signal:        ctrl.signal,
        timeoutMs:     240_000,    // 4-minute ceiling per section
        onUsage:       (u) => setTokenUsage((prev) => ({ ...prev, sch3: u })),
        // Treat the first resolved section as "model has started responding"
        // so the progress UI advances (non-streaming has no token callback).
        onSectionDone: () => setFirstTokenReceivedAt((t) => t || Date.now()),
      });
      // Sanity-filter the AI response.
      const sanitised = sanitiseSch3Response(rawSch3);

      // Run the deterministic rule engine and merge with the AI findings.
      // Rule-engine catches arithmetic/tie-out issues the AI tends to miss;
      // AI catches semantic/judgement issues the rule engine can't reason about.
      const ruleResult = runRuleEngine(mdText);
      const merged    = mergeAnalyses(ruleResult, sanitised);

      // Stamp source-page anchors on the merged issue list.
      const sch3 = anchorIssuesToPages(merged, pdfPages);
      setAnalysis(sch3);
      setAnalysisSource('rule+ai');

      // ── Phase 2: CARO (optional) ───────────────────────────────────────
      let finalCaro = null;
      if (shouldRunCaro) {
        setPhase('analyzing-caro');
        setAnalysisStartedAt(Date.now());
        setFirstTokenReceivedAt(null);
        finalCaro = await _runCaroCall(sch3, ctrl);
        setCaro(finalCaro);
      } else {
        setCaro(null);
      }

      // ── Auto-save engagement ───────────────────────────────────────────
      // Reset issue states for a fresh engagement.
      setIssueStates({});
      const newId = saveEngagement({ analysis: sch3, caro: finalCaro, reportFields, issueStates: {} });
      setCurrentEngagementId(newId);

      setPhase('done');
      setTab('issues');
    } catch (err) {
      if (err.name === 'AbortError') {
        // User cancelled — go back to preview
        setPhase('preview');
        return;
      }
      console.error('Analysis failed:', err);
      let msg = err.message || 'Analysis failed.';
      if (err instanceof AuthError)     msg = 'Invalid DeepSeek API key. Please check your key in Settings.';
      if (err instanceof RateLimitError) msg = 'DeepSeek rate limit hit. Please wait a moment and try again.';
      setAnalysisError(msg);
      setPhase('error');
    }
  };

  // Run CARO standalone — used from the Done state when CARO was skipped initially.
  const runCaroOnly = async () => {
    if (!analysis) return;
    setAnalysisError('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      setPhase('analyzing-caro');
      setAnalysisStartedAt(Date.now());
      setFirstTokenReceivedAt(null);
      // Don't reset SCH3 token usage — we're only adding CARO usage.
      setTokenUsage((prev) => ({ ...prev, caro: null }));
      const finalCaro = await _runCaroCall(analysis, ctrl);
      setCaro(finalCaro);
      saveEngagement({ analysis, caro: finalCaro, reportFields, issueStates, id: currentEngagementId });
      setPhase('done');
    } catch (err) {
      if (err.name === 'AbortError') {
        setPhase('done');
        return;
      }
      console.error('CARO analysis failed:', err);
      let msg = err.message || 'CARO analysis failed.';
      if (err instanceof AuthError)     msg = 'Invalid DeepSeek API key. Please check your key in Settings.';
      if (err instanceof RateLimitError) msg = 'DeepSeek rate limit hit. Please wait a moment and try again.';
      setAnalysisError(msg);
      setPhase('error');
    }
  };

  const cancelAnalysis = () => {
    abortRef.current?.abort();
  };

  // ════════════════════════════════════════════════════
  // CARO CLAUSE EDITS
  // ════════════════════════════════════════════════════
  const updateCaroClause = (paragraph, newRemark) =>
    setCaro((prev) => prev ? {
      ...prev,
      clauses: prev.clauses.map((c) =>
        c.paragraph === paragraph ? { ...c, remark: newRemark, edited: true } : c
      ),
    } : prev);

  const resetCaroClause = (paragraph) => {
    const std = STANDARD_CARO_REMARKS.find((s) => s.paragraph === paragraph);
    if (!std) return;
    setCaro((prev) => prev ? {
      ...prev,
      clauses: prev.clauses.map((c) =>
        c.paragraph === paragraph ? { ...c, remark: std.standard, edited: false } : c
      ),
    } : prev);
  };

  // ════════════════════════════════════════════════════
  // EXPORTS
  // ════════════════════════════════════════════════════
  const handleExportExcel = async () => {
    if (!analysis || exporting) return;
    setExporting(true);
    try {
      await exportExcel({ analysis, caro, reportFields });
    } catch (err) {
      console.error('Excel export failed:', err);
      alert('Excel export failed: ' + (err.message || 'Unknown error'));
    } finally {
      setExporting(false);
    }
  };

  // Filter issues to those that look like missing-disclosure findings — these
  // are what the auto-drafter can write a note for. Computational / arithmetic
  // / classification issues are skipped (the prompt would have to invent context).
  const eligibleNotesIssues = (analysis?.scheduleIIIIssues || []).filter((iss) => {
    if (!iss) return false;
    if (iss.severity === 'LOW') return false;
    const cat = (iss.category || '').toLowerCase();
    const obs = (iss.observation || '').toLowerCase();
    const evq = (iss.evidenceQuote || '').toLowerCase();
    const isDisclosureType  = cat.includes('disclosure');
    const looksMissing      = /missing|not\s+(provided|disclosed|located|present|given|made)|absent|omitted/i.test(obs)
                              || /not\s+(located|provided|present|disclosed)/i.test(evq);
    return isDisclosureType || looksMissing;
  });

  // Single-call accounting policies drafter. Produces ONE comprehensive
  // "Significant Accounting Policies" note (Note 2) covering every relevant
  // sub-policy for the engagement. Cancellable; respects the global timeout.
  const handleGenerateNotes = async () => {
    if (!analysis || notesGenerating) return;

    const ctrl = new AbortController();
    notesAbortRef.current = ctrl;

    setNotesGenerating(true);
    setDraftedPolicy(null);
    setNotesProgress({ current: 0, total: 1 });

    try {
      const result = await callDeepSeek({
        apiKey,
        model:        selectedModel,
        systemPrompt: 'You are a senior Indian Chartered Accountant drafting the "Significant Accounting Policies" note for an Indian private/unlisted company\'s Schedule III Division I financial statements. Draft ONLY policies governing the recognition and measurement of BALANCE-SHEET items (assets, liabilities, equity) — this is a policies note, not a disclosures note. Exclude all P&L-only and disclosure-only policies (revenue recognition, EPS, segment, cash-flow statement, related-party disclosure, CSR). Use canonical Indian audit-firm phrasing, cite the relevant Accounting Standard (AS), and use [BRACKETED CAPS] placeholders only where a true preparer choice is required (depreciation method WDV/SLM, inventory cost formula, useful-life override).',
        userPrompt:   NOTES_DRAFT_PROMPT(analysis.scheduleIIIIssues || [], analysis.company, analysis.keyMetrics),
        signal:       ctrl.signal,
        temperature:  0.0,
        top_p:        0.1,
      });

      const policy = result?.accountingPolicies;
      if (!policy || !Array.isArray(policy.subPolicies)) {
        throw new Error('Model returned an invalid policy shape — see console for the raw payload.');
      }
      setDraftedPolicy(policy);
      setNotesProgress({ current: 1, total: 1 });
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn('Accounting policies drafting cancelled.');
      } else {
        console.error('Accounting policies drafting failed:', err);
        alert('Accounting policies drafting failed: ' + (err.message || 'Unknown error'));
      }
    } finally {
      setNotesGenerating(false);
      setNotesProgress(null);
      notesAbortRef.current = null;
    }
  };

  const handleCancelNotes = () => {
    notesAbortRef.current?.abort();
  };

  const handleDownloadNotesWord = () => {
    if (!draftedPolicy) return;
    downloadAccountingPoliciesWord(draftedPolicy, analysis?.company, reportFields);
  };

  // ════════════════════════════════════════════════════
  // ISSUE REVIEW ACTIONS — Accept / Dismiss / For-review / Note
  // ════════════════════════════════════════════════════
  const reviewerName = settings.partnerName || settings.firmName || 'Reviewer';

  const handleSetIssueStatus = useCallback((issueId, nextStatus) => {
    setIssueStates((prev) => setIssueStatus(prev, issueId, nextStatus, reviewerName));
  }, [reviewerName]);

  const handleSetIssueNote = useCallback((issueId, note) => {
    setIssueStates((prev) => setIssueNote(prev, issueId, note));
  }, []);

  // Persist issue-state changes to the current engagement entry so they
  // survive page reloads. Skipped before the engagement is first saved.
  useEffect(() => {
    if (!currentEngagementId || !analysis) return;
    saveEngagement({ analysis, caro, reportFields, issueStates, id: currentEngagementId });
  }, [issueStates]);  // intentionally only on issueStates change

  // Build the chat system prompt — packs the engagement context so the model
  // can answer with specific facts rather than generic Schedule III boilerplate.
  const buildChatSystemPrompt = () => {
    if (!analysis) return 'You are a senior Indian Chartered Accountant.';
    const co = analysis.company || {};
    const m  = analysis.keyMetrics || {};
    const issuesBrief = (analysis.scheduleIIIIssues || []).slice(0, 40).map(
      (i) => `- [${i.id || '—'}] ${i.severity}: ${i.title} — ${i.observation?.slice(0, 200)}`
    ).join('\n');
    const caroBrief = caro?.applicability
      ? (caro.applicability.applies
          ? `CARO 2020 applies. ${caro.clauses?.filter(c => c.needsReview).length || 0} clause(s) flagged for review.`
          : `CARO 2020 does not apply. Reason: ${caro.applicability.reasoning}`)
      : 'CARO 2020 not evaluated for this engagement.';
    return `You are a senior Indian Chartered Accountant answering follow-up questions on a specific audit engagement. Be precise, cite test IDs when relevant, quote rupee figures from the engagement context where available, and decline to fabricate facts that are not in the context.

ENGAGEMENT CONTEXT
==================
Company: ${co.name || '—'} (CIN: ${co.cin || '—'}, FY ending ${co.yearEnd || '—'}, nature: ${co.natureOfBusiness || '—'})
First reporting year: ${co.isFirstYear ? 'Yes' : 'No'}

Key metrics (Rs in lakhs):
- Revenue: ${(m.revenueLakhs ?? 0).toFixed(2)} | PBT: ${(m.profitBeforeTaxLakhs ?? 0).toFixed(2)} | PAT: ${(m.profitAfterTaxLakhs ?? 0).toFixed(2)}
- Current tax: ${(m.currentTaxLakhs ?? 0).toFixed(2)} | Advance tax: ${(m.advanceTaxLakhs ?? 0).toFixed(2)}
- Paid-up capital: ${(m.paidUpCapitalLakhs ?? 0).toFixed(2)} | Reserves: ${(m.reservesLakhs ?? 0).toFixed(2)}
- Total borrowings: ${(m.totalBorrowingsLakhs ?? 0).toFixed(2)} | Total assets: ${(m.totalAssetsLakhs ?? 0).toFixed(2)}
- Trade receivables: ${(m.tradeReceivablesLakhs ?? 0).toFixed(2)} | PPE: ${(m.fixedAssetsLakhs ?? 0).toFixed(2)}

SCHEDULE III ISSUES FLAGGED (up to 40 shown):
${issuesBrief || 'None.'}

CARO 2020: ${caroBrief}

INSTRUCTIONS
============
- When the user asks "why was test X flagged?", quote the actual observation from the context.
- If asked to draft text (note, review memo, qualification language), produce ready-to-paste prose in standard Indian audit / Schedule III style.
- If the user asks about a fact not in the context, say so explicitly rather than inventing.
- Keep responses focused and concise unless the user asks for detail.`;
  };

  const sendChatMessage = async (text) => {
    if (!analysis || chatSending) return;
    const userMsg = { role: 'user', content: text };
    const nextMessages = [...chatMessages, userMsg];
    setChatMessages(nextMessages);
    setChatSending(true);
    try {
      // Trim history to last MAX_TURNS messages (keeps cost bounded for long chats)
      const trimmed = nextMessages.slice(-CHAT_MAX_TURNS * 2);
      const reply = await chatDeepSeek({
        apiKey,
        model:        selectedModel,
        systemPrompt: buildChatSystemPrompt(),
        messages:     trimmed,
      });
      setChatMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      console.error('Chat failed:', err);
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '⚠️ ' + (err instanceof AuthError
            ? 'Invalid API key. Check Settings.'
            : err.message || 'Could not get a response.'),
        },
      ]);
    } finally {
      setChatSending(false);
    }
  };

  const handleGenerateWord = () => {
    if (!analysis) return;
    const ifcofrApplies = (analysis.keyMetrics?.revenueLakhs || 0) >= 5000;
    const html = generateReport(analysis, caro, reportFields, ifcofrApplies);
    const safeName = (analysis.company?.name || 'Company').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40);
    downloadAsWord(html, `${safeName}_Independent_Auditors_Report.doc`);
  };

  // ════════════════════════════════════════════════════
  // ENGAGEMENT SAVE / LOAD / EXPORT / IMPORT
  // ════════════════════════════════════════════════════
  const handleExportEngagement = () => {
    if (!analysis) return;
    exportEngagement({ analysis, caro, reportFields, issueStates });
  };

  const handleImportEngagement = async (f) => {
    try {
      const eng = await importEngagement(f);
      applyEngagement(eng);
    } catch (err) {
      alert('Could not import engagement: ' + (err.message || 'Invalid file'));
    }
  };

  const handleLoadEngagement = (eng) => {
    const full = loadEngagement(eng.id);
    if (full) applyEngagement(full);
  };

  const applyEngagement = (eng) => {
    // loadEngagement returns a list entry with { data: {analysis,caro,reportFields,issueStates} }
    // importEngagement returns { analysis, caro, reportFields, issueStates } directly
    const analysis    = eng.data?.analysis    ?? eng.analysis;
    const caro        = eng.data?.caro        ?? eng.caro        ?? null;
    const reportFields = eng.data?.reportFields ?? eng.reportFields ?? { ...DEFAULT_REPORT_FIELDS };
    const restoredIssueStates = eng.data?.issueStates ?? eng.issueStates ?? {};
    const engId = eng.id || eng.data?.id || null;
    if (!analysis) return;
    setAnalysis(analysis);
    setCaro(caro);
    setReportFields(reportFields);
    setIssueStates(restoredIssueStates);
    setCurrentEngagementId(engId);
    setPhase('done');
    setTab('issues');
    setMarkdown('');
    setFile(null);
    // Imported engagement has no PDF in memory, so source-page modal will
    // gracefully degrade to its "not anchored" state.
    setPdfPages([]);
  };

  // ════════════════════════════════════════════════════
  // RESET
  // ════════════════════════════════════════════════════
  const handleReset = () => {
    setFile(null); setMarkdown(''); setPdfMeta(null); setPdfPages([]);
    setSourceModalIssue(null);
    setDraftedPolicy(null); setNotesGenerating(false);
    setChatOpen(false); setChatMessages([]); setChatSending(false);
    setIssueStates({}); setCurrentEngagementId(null);
    setAnalysis(null); setCaro(null);
    setAnalysisSource(null);
    setPhase('upload');
    setFileError(''); setExtractError(''); setAnalysisError('');
    setReportFields({ ...DEFAULT_REPORT_FIELDS });
    setTokenUsage({ sch3: null, caro: null });
    setTab('issues');
    // Reset per-run controls back to defaults
    setRunCaro(true);
    setSelectedModel(settings.model || 'deepseek-v4-pro');
    setAnalysisStartedAt(null);
    setFirstTokenReceivedAt(null);
  };

  // ════════════════════════════════════════════════════
  // DERIVED VALUES
  // ════════════════════════════════════════════════════
  function buildCounts(issues) {
    const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    issues.forEach((i) => { if (c[i.severity] !== undefined) c[i.severity]++; });
    return c;
  }

  const counts       = analysis ? buildCounts(analysis.scheduleIIIIssues || []) : { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const issuesSorted = analysis
    ? [...(analysis.scheduleIIIIssues || [])].sort((a, b) => (SEVERITY[a.severity]?.rank ?? 9) - (SEVERITY[b.severity]?.rank ?? 9))
    : [];

  // ════════════════════════════════════════════════════
  // FIRST-RUN GATE — soft gate, can be skipped for Quick Review only
  // ════════════════════════════════════════════════════
  if (!apiKey && !gateSkipped) {
    return (
      <SettingsGate
        onUnlock={(key) => {
          setApiKey(key);
          setSettings(getSettings());
        }}
        onSkip={() => setGateSkipped(true)}
      />
    );
  }

  // ════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: '100vh', background: COLORS.BG, fontFamily: FONTS.BODY }}>

      {/* Header */}
      <EngagementHeader
        settings={settings}
        phase={phase}
        exporting={exporting}
        tokenUsage={tokenUsage}
        onSettingsClick={() => setShowSettings(true)}
        onReset={handleReset}
        onExportExcel={handleExportExcel}
        onExportEngagement={handleExportEngagement}
        onImportEngagement={handleImportEngagement}
        onLoadEngagement={handleLoadEngagement}
      />

      {/* Settings slide-in */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          apiKey={apiKey}
          onSettingsChange={(s) => { setSettings(s); }}
          onApiKeyChange={(k) => setApiKey(k)}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Main content */}
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '48px 32px 80px' }}>

        {/* ── UPLOAD ── */}
        {phase === 'upload' && (
          <FileUpload
            file={file}
            dragOver={dragOver}
            error={fileError || extractError}
            onFile={handleFile}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onAnalyze={() => runExtract()}
          />
        )}

        {/* ── EXTRACTING ── */}
        {phase === 'extracting' && (
          <div className="fade-in" style={{ maxWidth: 480, margin: '120px auto', textAlign: 'center' }}>
            <div className="pulse-dot" style={{
              width: 56, height: 56, borderRadius: '50%', background: COLORS.PRIMARY,
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#faf6ee" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <h2 className="serif" style={{ fontSize: 24, fontWeight: 600, marginBottom: 8, color: COLORS.TEXT }}>
              Extracting text…
            </h2>
            <p style={{ color: COLORS.TEXT_MUTED, fontSize: 14 }}>
              Running pdfjs · page-by-page extraction
            </p>
          </div>
        )}

        {/* ── PREVIEW ── */}
        {phase === 'preview' && (
          <PdfMarkdownPreview
            markdown={markdown}
            pdfMeta={pdfMeta}
            onMarkdownChange={setMarkdown}
            onReExtract={() => runExtract()}
            onQuickReview={(md) => runQuickReview(md)}
            onAnalyze={(md) => {
              if (!apiKey) {
                // Deep AI clicked without a key — open the Settings drawer so user can paste one.
                setShowSettings(true);
                return;
              }
              runAnalysis(md, { runCaro });
            }}
            hasApiKey={!!apiKey}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            runCaro={runCaro}
            onRunCaroChange={setRunCaro}
            onRunOCR={runOCR}
            ocrRunning={ocrRunning}
            ocrProgress={ocrProgress}
          />
        )}

        {/* ── ANALYZING ── */}
        {(phase === 'analyzing-sch3' || phase === 'analyzing-caro') && (
          <AnalyzingProgress
            phase={phase}
            onCancel={cancelAnalysis}
            model={selectedModel}
            runCaro={runCaro}
            startedAt={analysisStartedAt}
            firstTokenAt={firstTokenReceivedAt}
          />
        )}

        {/* ── ERROR ── */}
        {phase === 'error' && (
          <div className="fade-in" style={{ maxWidth: 560, margin: '80px auto 0', textAlign: 'center' }}>
            <XCircle size={40} color={COLORS.CRIT} style={{ marginBottom: 16 }} />
            <h2 className="serif" style={{ fontSize: 24, marginBottom: 10, color: COLORS.TEXT }}>
              Couldn't complete the review
            </h2>
            <p style={{ color: COLORS.TEXT_MUTED, marginBottom: 24, fontSize: 14 }}>
              {analysisError}
            </p>
            <button onClick={() => setPhase('preview')} style={{ ...BTN_PRIMARY, marginRight: 10 }}>
              Back to preview
            </button>
            <button onClick={handleReset} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: `1px solid ${COLORS.BORDER_STRONG}`,
              padding: '9px 18px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
              fontFamily: FONTS.BODY, color: COLORS.TEXT,
            }}>
              <RotateCcw size={14} /> Start over
            </button>
          </div>
        )}

        {/* ── DONE ── */}
        {phase === 'done' && analysis && (
          <div className="fade-in">
            <CompanyHeader
              company={analysis.company || {}}
              metrics={analysis.keyMetrics || {}}
              counts={counts}
              caroApplies={caro?.applicability?.applies}
              caroRun={!!caro}
            />

            {/* Tab bar */}
            <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${COLORS.BORDER}`, marginBottom: 24 }}>
              <TabBtn active={tab === 'issues'} onClick={() => setTab('issues')} count={issuesSorted.length}>
                <Layers size={14} /> Schedule III Issues
              </TabBtn>
              <TabBtn active={tab === 'caro'} onClick={() => setTab('caro')}>
                <ShieldCheck size={14} /> CARO 2020 Applicability
              </TabBtn>
              {caro?.applicability?.applies && caro.clauses?.length > 0 && (
                <TabBtn active={tab === 'clauses'} onClick={() => setTab('clauses')} count={caro.clauses.length}>
                  <Hash size={14} /> CARO Clauses
                </TabBtn>
              )}
              <TabBtn
                active={tab === 'suggested-notes'}
                onClick={() => setTab('suggested-notes')}
                count={draftedPolicy?.subPolicies?.length}
              >
                <FilePlus2 size={14} /> Accounting Policies
              </TabBtn>
              <TabBtn active={tab === 'audit-report'} onClick={() => setTab('audit-report')}>
                <FileSignature size={14} /> Audit Report
              </TabBtn>
            </div>

            {/* Issues tab */}
            {tab === 'issues' && (
              <div className="fade-in">
                <SeveritySummary counts={counts} />

                {/* Banner — when only the deterministic rule engine has run,
                    offer to layer Deep AI Review on top. */}
                {analysisSource === 'rule' && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 14, flexWrap: 'wrap',
                    background: '#fdf6ed',
                    border: `1px solid ${COLORS.HIGH}55`,
                    borderRadius: 8, padding: '12px 16px',
                    marginBottom: 14,
                  }}>
                    <div style={{ fontSize: 13, color: COLORS.TEXT, lineHeight: 1.5 }}>
                      <strong style={{ color: COLORS.HIGH }}>Quick Review complete.</strong>
                      {' '}{issuesSorted.length} finding{issuesSorted.length === 1 ? '' : 's'} from ~25 deterministic checks.
                      The full 73-test Deep AI Review covers semantic checks the rule engine can't reason about.
                    </div>
                    <button
                      onClick={() => {
                        if (!apiKey) { setShowSettings(true); return; }
                        // Re-extract markdown? We don't keep it after analysis. Need user to re-upload —
                        // but the file is still in memory IF still in this session.
                        if (file && markdown) {
                          runAnalysis(markdown, { runCaro });
                        } else {
                          alert('Please re-upload the PDF to run Deep AI Review — the source markdown is no longer in memory for this engagement.');
                        }
                      }}
                      style={{ ...BTN_PRIMARY, background: COLORS.HIGH, fontSize: 12, padding: '8px 14px' }}
                    >
                      {apiKey ? 'Run Deep AI Review on top →' : 'Add API key to run Deep AI →'}
                    </button>
                  </div>
                )}

                {issuesSorted.length === 0 ? (
                  <div style={{
                    textAlign: 'center', padding: '48px 24px',
                    color: COLORS.TEXT_MUTED, fontSize: 14,
                  }}>
                    No Schedule III issues flagged. ✓
                  </div>
                ) : (
                  <IssueList
                    issues={issuesSorted}
                    issueStates={issueStates}
                    onSetStatus={handleSetIssueStatus}
                    onSetNote={handleSetIssueNote}
                    onViewSource={(it) => setSourceModalIssue(it)}
                  />
                )}
              </div>
            )}

            {/* CARO applicability tab — shows empty state with "Run now" CTA when CARO was skipped */}
            {tab === 'caro' && (
              <CaroApplicabilityView
                app={caro?.applicability}
                onRunCaroNow={runCaroOnly}
              />
            )}

            {/* CARO clauses tab */}
            {tab === 'clauses' && caro?.clauses && (
              <div className="fade-in">
                <div style={{
                  background: '#fef9f1', border: `1px solid ${COLORS.BORDER}`,
                  borderRadius: 8, padding: '12px 16px', marginBottom: 16,
                }}>
                  <div style={{ fontSize: 13, color: COLORS.TEXT, lineHeight: 1.5 }}>
                    <strong style={{ color: COLORS.PRIMARY }}>Standard ICAI illustrative wording</strong> shown for each of the 21 paragraphs.
                    Click any clause to expand and edit before exporting. Items flagged{' '}
                    <span style={{ color: COLORS.HIGH, fontWeight: 600 }}>"Review"</span> contain a fact-pattern that contradicts the default — edit those before exporting Annexure A.
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {caro.clauses.map((c, i) => (
                    <ClauseRow
                      key={c.paragraph + i}
                      clause={c}
                      onUpdate={updateCaroClause}
                      onReset={resetCaroClause}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Suggested Notes tab — single comprehensive Accounting Policies note */}
            {tab === 'suggested-notes' && (
              <SuggestedNotesTab
                draftedPolicy={draftedPolicy}
                generating={notesGenerating}
                progress={notesProgress}
                onGenerate={handleGenerateNotes}
                onCancel={handleCancelNotes}
                onDownloadWord={handleDownloadNotesWord}
                onUpdatePolicy={setDraftedPolicy}
                hasAnalysis={!!analysis}
              />
            )}

            {/* Audit report tab */}
            {tab === 'audit-report' && (
              <AuditReportTab
                analysis={analysis}
                caro={caro}
                reportFields={reportFields}
                setReportFields={setReportFields}
                onGenerate={handleGenerateWord}
              />
            )}
          </div>
        )}
      </main>

      <footer style={{
        borderTop: `1px solid ${COLORS.BORDER}`, marginTop: 80,
        padding: '24px 32px', textAlign: 'center',
        fontSize: 11, color: COLORS.TEXT_MUTED,
        textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>
        AI-assisted review · Always verify findings against the underlying records
      </footer>

      {/* Source modal — appears on top of all content when an issue's
          "View page" chip is clicked. pdfPages may be empty if the
          engagement was imported rather than freshly analysed. */}
      {sourceModalIssue && (
        <SourceModal
          issue={sourceModalIssue}
          pages={pdfPages}
          onClose={() => setSourceModalIssue(null)}
        />
      )}

      {/* Engagement chat — floating launcher + side panel.
          Only available in the Done state, when we have an analysis to discuss. */}
      {phase === 'done' && analysis && !chatOpen && (
        <ChatLauncher onOpen={() => setChatOpen(true)} />
      )}
      <EngagementChat
        open={chatOpen && phase === 'done' && !!analysis}
        onClose={() => setChatOpen(false)}
        onSendMessage={sendChatMessage}
        messages={chatMessages}
        sending={chatSending}
        companyName={analysis?.company?.name}
      />
    </div>
  );
}
