// ============ PDF MARKDOWN PREVIEW ============
// Shows extracted text after pdfjs runs.
// User can edit the markdown, re-extract, or proceed to analysis.
// Also chooses the model and toggles whether CARO runs after Schedule III.

import React, { useState, useRef } from 'react';
import {
  FileText, Edit3, RefreshCw, Sparkles, AlertTriangle, Eye, ChevronDown, ChevronUp,
  ShieldCheck, Zap, ScanLine, Loader2, FastForward, KeyRound,
} from 'lucide-react';
import { COLORS, FONTS, BTN_PRIMARY, BTN_GHOST } from '../styles/tokens.js';

const APPROX_CHARS_PER_TOKEN = 4;

export function PdfMarkdownPreview({
  markdown, pdfMeta,
  onAnalyze, onReExtract, onMarkdownChange,
  onQuickReview,           // run rule engine only — no API needed
  selectedModel, onModelChange,
  runCaro, onRunCaroChange,
  onRunOCR, ocrRunning, ocrProgress,
  hasApiKey,               // bool — drives the Deep AI CTA copy
}) {
  const [editing, setEditing]       = useState(false);
  const [localMd, setLocalMd]       = useState(markdown);
  const [expanded, setExpanded]     = useState(false);
  const textareaRef                 = useRef(null);

  // sync if parent updates (e.g. re-extract)
  React.useEffect(() => {
    setLocalMd(markdown);
    setEditing(false);
  }, [markdown]);

  const chars      = localMd.length;
  const approxTok  = Math.round(chars / APPROX_CHARS_PER_TOKEN).toLocaleString();
  const isScanned  = pdfMeta?.looksScanned;

  const handleEditToggle = () => {
    if (editing) {
      // save edits
      onMarkdownChange?.(localMd);
    }
    setEditing(!editing);
  };

  const handleAnalyze = () => {
    if (editing) {
      onMarkdownChange?.(localMd);
    }
    onAnalyze(localMd);
  };

  const handleQuickReview = () => {
    if (editing) {
      onMarkdownChange?.(localMd);
    }
    onQuickReview?.(localMd);
  };

  const previewLines = localMd.split('\n').slice(0, expanded ? Infinity : 30).join('\n');
  const hasMore      = localMd.split('\n').length > 30;

  return (
    <div className="fade-in" style={{ maxWidth: 860, margin: '0 auto' }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <FileText size={18} color={COLORS.PRIMARY} strokeWidth={1.5} />
            <h2 className="serif" style={{ fontSize: 22, fontWeight: 600, color: COLORS.TEXT, margin: 0 }}>
              Extracted Text Preview
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: COLORS.TEXT_MUTED }}>
            {pdfMeta && (
              <span>{pdfMeta.pageCount} page{pdfMeta.pageCount !== 1 ? 's' : ''}</span>
            )}
            <span>{chars.toLocaleString()} chars</span>
            <span>≈ {approxTok} tokens</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={onReExtract} style={{ ...BTN_GHOST, fontSize: 12 }}>
            <RefreshCw size={13} /> Re-extract
          </button>
          <button onClick={handleEditToggle} style={{ ...BTN_GHOST, fontSize: 12 }}>
            <Edit3 size={13} /> {editing ? 'Done editing' : 'Edit'}
          </button>
        </div>
      </div>

      {/* Scanned PDF warning + OCR option */}
      {isScanned && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8,
          padding: '14px 16px', marginBottom: 16, fontSize: 13, color: '#92400e',
        }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: onRunOCR ? 12 : 0 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <strong>Scanned PDF detected.</strong> Very few text items were found — the document is likely image-based.
              Analysis quality will be very low unless OCR is run first.
            </div>
          </div>
          {onRunOCR && (
            <div style={{
              display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
              borderTop: '1px solid #fcd34d', paddingTop: 12,
            }}>
              <button
                onClick={onRunOCR}
                disabled={ocrRunning}
                style={{
                  ...BTN_PRIMARY,
                  background: '#92400e',
                  padding: '8px 16px', fontSize: 13,
                  opacity: ocrRunning ? 0.7 : 1,
                  cursor: ocrRunning ? 'wait' : 'pointer',
                }}
              >
                {ocrRunning
                  ? <><Loader2 size={14} className="spin" /> Running OCR…</>
                  : <><ScanLine size={14} /> Run OCR on this PDF</>
                }
              </button>
              {ocrRunning && ocrProgress && (
                <span style={{ fontSize: 12, color: '#92400e' }}>
                  {ocrProgress.status}
                  {ocrProgress.current && ocrProgress.total
                    ? ` (page ${ocrProgress.current} of ${ocrProgress.total})`
                    : ''}
                  {typeof ocrProgress.progress === 'number'
                    ? ` · ${Math.round(ocrProgress.progress * 100)}%`
                    : ''}
                </span>
              )}
              {!ocrRunning && (
                <span style={{ fontSize: 11, color: '#92400e', opacity: 0.85 }}>
                  Uses Tesseract.js loaded from CDN. Typically 3–8 seconds per page.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Markdown panel */}
      <div
        className="card"
        style={{
          padding: 0, overflow: 'hidden', borderRadius: 10,
          border: editing ? `1.5px solid ${COLORS.PRIMARY}` : undefined,
        }}
      >
        {/* Panel header bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', borderBottom: `1px solid ${COLORS.BORDER}`,
          background: COLORS.BG_CREAM,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: COLORS.TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
            <Eye size={12} /> {editing ? 'Editing' : 'Preview'} · Markdown
          </div>
          {editing && (
            <span style={{ fontSize: 11, color: COLORS.PRIMARY }}>Changes apply to this session only</span>
          )}
        </div>

        {editing ? (
          <textarea
            ref={textareaRef}
            value={localMd}
            onChange={(e) => setLocalMd(e.target.value)}
            spellCheck={false}
            style={{
              width: '100%', minHeight: 420, padding: 16,
              fontFamily: FONTS.MONO, fontSize: 12, lineHeight: 1.6,
              background: COLORS.BG_CREAM, border: 'none', outline: 'none',
              color: COLORS.TEXT, resize: 'vertical', boxSizing: 'border-box',
            }}
          />
        ) : (
          <div style={{ position: 'relative' }}>
            <pre style={{
              margin: 0, padding: 16, fontFamily: FONTS.MONO, fontSize: 12,
              lineHeight: 1.6, color: COLORS.TEXT, whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', maxHeight: expanded ? 'none' : 480,
              overflow: expanded ? 'visible' : 'hidden',
              background: COLORS.BG_CREAM,
            }}>
              {previewLines}
              {!expanded && hasMore && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: 80,
                  background: `linear-gradient(transparent, ${COLORS.BG_CREAM})`,
                  pointerEvents: 'none',
                }} />
              )}
            </pre>

            {hasMore && (
              <button
                onClick={() => setExpanded(!expanded)}
                style={{
                  ...BTN_GHOST, width: '100%', justifyContent: 'center',
                  borderTop: `1px solid ${COLORS.BORDER}`, borderRadius: 0,
                  fontSize: 12, padding: '10px',
                }}
              >
                {expanded
                  ? <><ChevronUp size={13} /> Collapse</>
                  : <><ChevronDown size={13} /> Show all {localMd.split('\n').length.toLocaleString()} lines</>
                }
              </button>
            )}
          </div>
        )}
      </div>

      {/* Empty state */}
      {!localMd.trim() && (
        <div style={{ textAlign: 'center', padding: '40px 24px', color: COLORS.TEXT_MUTED, fontSize: 13 }}>
          No text extracted. Try re-extracting or paste the balance sheet text using the Edit button.
        </div>
      )}

      {/* CTA + per-run controls */}
      <div style={{ textAlign: 'center', marginTop: 28 }}>

        {/* Two-route choice */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14,
          maxWidth: 720, margin: '0 auto',
          textAlign: 'left',
        }}>
          {/* Route 1 — Quick Review (local, no API) */}
          <div style={{
            background: '#fffdf7',
            border: `1px solid ${COLORS.BORDER}`,
            borderLeft: `4px solid ${COLORS.PRIMARY}`,
            borderRadius: 10, padding: 18,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FastForward size={18} color={COLORS.PRIMARY} strokeWidth={1.7} />
              <h3 className="serif" style={{ fontSize: 16, fontWeight: 600, margin: 0, color: COLORS.TEXT }}>
                Quick Review
              </h3>
              <span style={{
                fontSize: 9, padding: '2px 6px',
                background: '#f4f7ee', color: '#3e6034',
                borderRadius: 3, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                No API key
              </span>
            </div>
            <p style={{ fontSize: 12, color: COLORS.TEXT_MUTED, margin: 0, lineHeight: 1.5 }}>
              Runs ~25 deterministic checks locally — key disclosures, arithmetic tie-outs, notes-to-face reconciliation. Instant. Free. Offline.
            </p>
            <button
              onClick={handleQuickReview}
              disabled={!localMd.trim()}
              style={{
                ...BTN_PRIMARY,
                padding: '10px 18px', fontSize: 13,
                opacity: localMd.trim() ? 1 : 0.4,
                cursor: localMd.trim() ? 'pointer' : 'not-allowed',
                width: '100%', justifyContent: 'center',
              }}
            >
              <FastForward size={14} /> Run Quick Review
            </button>
            <span style={{ fontSize: 10, color: COLORS.TEXT_FAINT, textAlign: 'center' }}>
              ~2 seconds · no DeepSeek call
            </span>
          </div>

          {/* Route 2 — Deep AI Review (DeepSeek + rule engine merged) */}
          <div style={{
            background: '#fffdf7',
            border: `1px solid ${COLORS.BORDER}`,
            borderLeft: `4px solid ${hasApiKey ? COLORS.HIGH : COLORS.BORDER_STRONG}`,
            borderRadius: 10, padding: 18,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={18} color={COLORS.HIGH} strokeWidth={1.7} />
              <h3 className="serif" style={{ fontSize: 16, fontWeight: 600, margin: 0, color: COLORS.TEXT }}>
                Deep AI Review
              </h3>
              <span style={{
                fontSize: 9, padding: '2px 6px',
                background: hasApiKey ? '#fdf6ed' : '#fbf8ed',
                color: hasApiKey ? COLORS.HIGH : COLORS.MED,
                borderRadius: 3, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {hasApiKey ? 'DeepSeek ready' : 'API key required'}
              </span>
            </div>
            <p style={{ fontSize: 12, color: COLORS.TEXT_MUTED, margin: 0, lineHeight: 1.5 }}>
              Full <strong>73-test</strong> AI pass over the entire document. Runs Quick Review first, then layers DeepSeek on top for the semantic / judgement checks.
            </p>
            <button
              onClick={handleAnalyze}
              disabled={!localMd.trim()}
              style={{
                ...BTN_PRIMARY,
                background: hasApiKey ? COLORS.HIGH : COLORS.PRIMARY,
                padding: '10px 18px', fontSize: 13,
                opacity: localMd.trim() ? 1 : 0.4,
                cursor: localMd.trim() ? 'pointer' : 'not-allowed',
                width: '100%', justifyContent: 'center',
              }}
            >
              {hasApiKey
                ? <><Sparkles size={14} /> Run Deep AI Review</>
                : <><KeyRound size={14} /> Add API key &amp; run Deep AI Review</>}
            </button>
            <span style={{ fontSize: 10, color: COLORS.TEXT_FAINT, textAlign: 'center' }}>
              ~75 seconds · DeepSeek call · {hasApiKey ? 'API cost applies' : 'paste your DeepSeek key next'}
            </span>
          </div>
        </div>

        {/* CARO toggle */}
        {onRunCaroChange && (
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            marginTop: 18, fontSize: 13, color: COLORS.TEXT,
            cursor: 'pointer', userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={!!runCaro}
              onChange={(e) => onRunCaroChange(e.target.checked)}
              style={{ accentColor: COLORS.PRIMARY, cursor: 'pointer' }}
            />
            <ShieldCheck size={14} color={runCaro ? COLORS.PRIMARY : COLORS.TEXT_FAINT} />
            <span>
              Include <strong>CARO 2020</strong> evaluation (Deep AI Review only — Quick Review uses client-side applicability arithmetic)
            </span>
          </label>
        )}

        {/* Model — flash is the only model this app uses, static readout */}
        {selectedModel && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            marginTop: 14, fontSize: 12, color: COLORS.TEXT_MUTED,
          }}>
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, fontSize: 10 }}>
              AI model
            </span>
            <span className="mono" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 999,
              border: `1px solid ${COLORS.BORDER_STRONG}`, background: COLORS.BG_CREAM,
              fontSize: 12, fontWeight: 600, color: COLORS.TEXT,
            }}>
              <Zap size={13} /> {selectedModel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
