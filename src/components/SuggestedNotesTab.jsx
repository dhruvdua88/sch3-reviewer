// ============ SUGGESTED ACCOUNTING POLICIES TAB ============
// Drafts ONE "Significant Accounting Policies" note (Note 2) covering only the
// policies relevant to the BALANCE SHEET (recognition + measurement of assets,
// liabilities, equity) — the reviewer can edit each sub-policy in place and
// download the result as a Word document for the preparer to paste into the FS.

import React, { useEffect, useState } from 'react';
import {
  FileSignature, Copy, Check, Download, Loader2, FilePlus2, AlertCircle, X, Edit3,
} from 'lucide-react';
import { COLORS, FONTS, BTN_PRIMARY, BTN_GHOST } from '../styles/tokens.js';

export function SuggestedNotesTab({
  draftedPolicy,            // { noteTitle, introText, subPolicies: [{heading, body}] } | null
  generating,
  progress,                 // {current,total} — only meaningful in degenerate batched mode
  onGenerate,
  onCancel,
  onDownloadWord,
  onUpdatePolicy,           // called with the full updated draftedPolicy when reviewer edits
  hasAnalysis,              // bool — true if there's an analysis to base the policy on
}) {
  const [copiedHeading, setCopiedHeading] = useState(null);

  const copy = async (heading, body) => {
    try {
      await navigator.clipboard.writeText(`${heading}\n\n${body}`);
      setCopiedHeading(heading);
      setTimeout(() => setCopiedHeading(null), 1800);
    } catch { /* clipboard denied */ }
  };

  // ── Empty / first-run state ──
  if (!draftedPolicy) {
    return (
      <div className="fade-in">
        <div className="card" style={{
          padding: 36, borderRadius: 12,
          textAlign: 'center',
          border: `1px dashed ${COLORS.BORDER_STRONG}`,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: COLORS.BG_CREAM, border: `1px solid ${COLORS.BORDER}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 18px',
          }}>
            <FilePlus2 size={24} color={COLORS.TEXT_MUTED} strokeWidth={1.5} />
          </div>
          <h3 className="serif" style={{ fontSize: 22, fontWeight: 600, color: COLORS.TEXT, marginBottom: 8 }}>
            Draft the Significant Accounting Policies note
          </h3>
          <p style={{ fontSize: 13, color: COLORS.TEXT_MUTED, maxWidth: 540, margin: '0 auto 22px', lineHeight: 1.55 }}>
            A "Note 2 — Significant Accounting Policies" drafted in standard ICAI wording, covering only the policies relevant to the balance sheet — recognition and measurement of assets, liabilities and equity (PPE &amp; depreciation, impairment, inventories, receivables, investments, employee-benefit obligations, provisions, taxation, borrowing costs, etc.). Only policies for line items this engagement actually carries are drafted; P&amp;L-only and disclosure-only policies are excluded. Each sub-policy is editable before you download.
          </p>
          {hasAnalysis && !generating && (
            <button
              onClick={onGenerate}
              style={{ ...BTN_PRIMARY, padding: '12px 26px', fontSize: 14 }}
            >
              <FileSignature size={15} /> Draft accounting policies
            </button>
          )}
          {generating && (
            <GeneratingBlock progress={progress} onCancel={onCancel} />
          )}
          {!generating && (
            <p style={{ marginTop: 12, fontSize: 11, color: COLORS.TEXT_FAINT }}>
              Uses DeepSeek with the model selected for this engagement. Typically ~30–45 seconds.
            </p>
          )}
        </div>
      </div>
    );
  }

  const { noteTitle, introText, subPolicies = [] } = draftedPolicy;

  const updateField = (key, val) => {
    onUpdatePolicy?.({ ...draftedPolicy, [key]: val });
  };

  const updateSubBody = (idx, val) => {
    const next = subPolicies.map((p, i) => (i === idx ? { ...p, body: val } : p));
    onUpdatePolicy?.({ ...draftedPolicy, subPolicies: next });
  };
  const updateSubHeading = (idx, val) => {
    const next = subPolicies.map((p, i) => (i === idx ? { ...p, heading: val } : p));
    onUpdatePolicy?.({ ...draftedPolicy, subPolicies: next });
  };
  const removeSub = (idx) => {
    onUpdatePolicy?.({ ...draftedPolicy, subPolicies: subPolicies.filter((_, i) => i !== idx) });
  };
  const addSub = () => {
    const next = [...subPolicies, { heading: `2.${subPolicies.length + 1} New sub-policy`, body: '' }];
    onUpdatePolicy?.({ ...draftedPolicy, subPolicies: next });
  };

  return (
    <div className="fade-in">
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 18, gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <h3 className="serif" style={{ fontSize: 20, fontWeight: 600, color: COLORS.TEXT, margin: 0 }}>
            {subPolicies.length} sub-polic{subPolicies.length === 1 ? 'y' : 'ies'} drafted
          </h3>
          <p style={{ fontSize: 12, color: COLORS.TEXT_MUTED, marginTop: 4 }}>
            Click any field to edit. Placeholders like [WDV / SLM] are for the preparer to choose.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {generating ? (
            <button onClick={onCancel} style={{ ...BTN_GHOST, fontSize: 12, color: COLORS.CRIT, borderColor: COLORS.CRIT }}>
              <X size={13} /> Cancel
            </button>
          ) : (
            <button onClick={onGenerate} style={{ ...BTN_GHOST, fontSize: 12 }}>
              <FileSignature size={13} /> Re-draft
            </button>
          )}
          <button onClick={onDownloadWord} disabled={generating} style={{ ...BTN_PRIMARY, fontSize: 13, opacity: generating ? 0.6 : 1 }}>
            <Download size={14} /> Download as Word
          </button>
        </div>
      </div>

      {/* Note title (editable) */}
      <article style={{
        background: '#fffdf7',
        border: `1px solid ${COLORS.BORDER}`,
        borderLeft: `4px solid ${COLORS.PRIMARY}`,
        borderRadius: 8, padding: 20, marginBottom: 14,
      }}>
        <label style={smallLabel}>Note title</label>
        <input
          type="text"
          value={noteTitle || ''}
          onChange={(e) => updateField('noteTitle', e.target.value)}
          style={{
            ...editInput,
            fontSize: 18, fontWeight: 600, fontFamily: FONTS.SERIF,
            color: COLORS.TEXT,
          }}
        />
        <div style={{ marginTop: 14 }}>
          <label style={smallLabel}>Introductory paragraph</label>
          <textarea
            value={introText || ''}
            onChange={(e) => updateField('introText', e.target.value)}
            rows={3}
            style={{ ...editInput, fontSize: 13, lineHeight: 1.55 }}
          />
        </div>
      </article>

      {/* Sub-policies */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {subPolicies.map((p, idx) => (
          <article key={idx} style={{
            background: '#fffdf7', border: `1px solid ${COLORS.BORDER}`,
            borderRadius: 8, padding: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                value={p.heading || ''}
                onChange={(e) => updateSubHeading(idx, e.target.value)}
                style={{
                  ...editInput, flex: 1,
                  fontSize: 14, fontWeight: 600, fontFamily: FONTS.SERIF,
                }}
              />
              <button
                onClick={() => copy(p.heading, p.body)}
                style={{ ...BTN_GHOST, fontSize: 11, padding: '5px 10px' }}
                aria-label="Copy sub-policy"
              >
                {copiedHeading === p.heading
                  ? <><Check size={12} /> Copied</>
                  : <><Copy size={12} /> Copy</>
                }
              </button>
              <button
                onClick={() => removeSub(idx)}
                title="Remove this sub-policy"
                style={{
                  background: 'transparent', border: `1px solid ${COLORS.CRIT}`,
                  color: COLORS.CRIT, padding: '5px 8px', borderRadius: 4,
                  fontSize: 11, cursor: 'pointer', fontFamily: FONTS.BODY,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                <X size={11} />
              </button>
            </div>
            <textarea
              value={p.body || ''}
              onChange={(e) => updateSubBody(idx, e.target.value)}
              rows={5}
              style={{ ...editInput, fontSize: 13, lineHeight: 1.6 }}
            />
          </article>
        ))}

        <button
          onClick={addSub}
          style={{
            ...BTN_GHOST, justifyContent: 'center', padding: '10px 16px',
            background: COLORS.BG_CREAM, fontSize: 12,
          }}
        >
          <Edit3 size={13} /> Add sub-policy
        </button>
      </div>

      {/* Caveat */}
      <div style={{
        marginTop: 22, padding: '12px 16px',
        background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8,
        display: 'flex', gap: 10, fontSize: 12, color: '#92400e',
      }}>
        <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong>Always review before issuing.</strong> Drafts are AI-generated suggestions in standard Schedule III wording — verify every figure, every reference, and every fact before adopting in the financial statements.
        </div>
      </div>
    </div>
  );
}

// ── Styles ──
const smallLabel = {
  display: 'block', fontSize: 9, fontWeight: 500, textTransform: 'uppercase',
  letterSpacing: '0.04em', color: COLORS.TEXT_FAINT, marginBottom: 4,
};

const editInput = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 10px',
  background: COLORS.BG_CREAM, border: `1px solid ${COLORS.BORDER}`,
  borderRadius: 5,
  color: COLORS.TEXT, outline: 'none', fontFamily: FONTS.BODY,
  resize: 'vertical',
};

// ── Generating spinner block ──
function GeneratingBlock({ progress, onCancel }) {
  const current = progress?.current ?? 0;
  const total   = progress?.total   ?? 1;
  const pct     = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: COLORS.PRIMARY, color: '#faf6ee',
        padding: '12px 24px', borderRadius: 8,
        fontSize: 14, fontWeight: 500, fontFamily: FONTS.BODY, opacity: 0.85,
      }}>
        <Loader2 size={15} className="spin" />
        <span>Drafting accounting policies…</span>
      </div>

      <div style={{ marginTop: 14, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
        <div style={{
          width: '100%', height: 6, borderRadius: 999,
          background: COLORS.BORDER, overflow: 'hidden',
        }}>
          <div style={{
            width: `${pct}%`, height: '100%', background: COLORS.PRIMARY,
            borderRadius: 999, transition: 'width 300ms ease-out',
          }} />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <button
          onClick={onCancel}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'transparent', color: COLORS.CRIT,
            border: `1px solid ${COLORS.CRIT}`,
            padding: '7px 16px', borderRadius: 6,
            fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: FONTS.BODY,
          }}
        >
          <X size={13} /> Cancel drafting
        </button>
      </div>
    </div>
  );
}
