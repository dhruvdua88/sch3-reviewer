// ============ ISSUE CARD ============
// A single Schedule III finding card with:
//   - collapsible body (click header to toggle)
//   - per-issue actions (Accept / Dismiss / For Review / Note)
//   - audit-trail history of all status changes
//   - source-anchor "View page" chip
//   - keyboard-focused outline when nav-focused

import React, { useState, useRef, useEffect } from 'react';
import {
  FileText, ExternalLink, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, AlertCircle, MessageSquarePlus, Clock,
} from 'lucide-react';
import { SEVERITY, COLORS, FONTS } from '../styles/tokens.js';
import { ISSUE_STATUS, formatRelativeTime } from '../lib/issueState.js';

// Tight, low-key field row — title carries the weight, labels recede.
function IssueField({ label, body, last }) {
  return (
    <div style={{ marginBottom: last ? 0 : 8 }}>
      <div style={{
        fontSize: 9, color: COLORS.TEXT_FAINT, textTransform: 'uppercase',
        letterSpacing: '0.04em', marginBottom: 2, fontWeight: 500,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: COLORS.TEXT }}>{body}</div>
    </div>
  );
}

function EvidenceField({ quote, noteRef, sourcePage, onViewSource }) {
  if (!quote && !noteRef && !sourcePage) return null;
  return (
    <div style={{
      marginBottom: 8,
      background: COLORS.BG_CREAM,
      border: `1px solid ${COLORS.BORDER}`,
      borderRadius: 6,
      padding: '8px 12px',
    }}>
      <div style={{
        fontSize: 9, color: COLORS.TEXT_FAINT, textTransform: 'uppercase',
        letterSpacing: '0.04em', marginBottom: 6, fontWeight: 500,
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <span>Evidence</span>
        {noteRef && (
          <span className="mono" style={{
            background: '#fffdf7',
            border: `1px solid ${COLORS.BORDER}`,
            padding: '1px 6px',
            borderRadius: 3,
            fontSize: 10,
            color: COLORS.TEXT_MUTED,
            textTransform: 'none',
            letterSpacing: 0,
            fontWeight: 500,
          }}>
            {noteRef}
          </span>
        )}
        {sourcePage && (
          <button
            onClick={(e) => { e.stopPropagation(); onViewSource?.(); }}
            title="Open the source page in the PDF preview"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: COLORS.PRIMARY, color: '#faf6ee',
              border: 'none', padding: '2px 8px', borderRadius: 3,
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.05em', cursor: 'pointer', fontFamily: FONTS.BODY,
            }}
          >
            <FileText size={10} /> Page {sourcePage}
            <ExternalLink size={9} />
          </button>
        )}
      </div>
      {quote && (
        <div style={{
          fontSize: 12,
          fontStyle: 'italic',
          lineHeight: 1.55,
          color: COLORS.TEXT_MUTED,
        }}>
          “{quote}”
        </div>
      )}
    </div>
  );
}

// Source pill — distinguishes deterministic rule-engine findings from AI findings.
const SOURCE_META = {
  'rule':    { label: 'Rule',    color: '#5c5e58', bg: '#f4f4ef', tooltip: 'Detected by the deterministic rule engine (no AI used).' },
  'ai':      { label: 'AI',      color: '#1a3d2e', bg: '#f4f7ee', tooltip: 'Detected by the DeepSeek AI review.' },
  'rule+ai': { label: 'Rule + AI', color: '#8c721b', bg: '#fbf8ed', tooltip: 'Detected by BOTH the rule engine and the AI review — high-confidence finding.' },
};
function SourcePill({ source }) {
  if (!source) return null;
  const meta = SOURCE_META[source];
  if (!meta) return null;
  return (
    <span
      title={meta.tooltip}
      style={{
        fontSize: 10, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.05em',
        padding: '1px 6px', borderRadius: 3,
        background: meta.bg, color: meta.color,
        border: `1px solid ${meta.color}33`,
      }}
    >
      {meta.label}
    </span>
  );
}

function StatusPill({ status }) {
  if (!status || status === 'open') return null;
  const meta = ISSUE_STATUS[status];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: meta.bg, color: meta.color,
      border: `1px solid ${meta.color}33`,
      padding: '2px 8px', borderRadius: 4,
      fontSize: 10, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      <Icon size={11} /> {meta.label}
    </span>
  );
}

function ActionMenu({ status, onSetStatus, onAddNote }) {
  // Three primary actions — toggle off if already that status.
  const btnStyle = (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: active ? COLORS.BG_CREAM : 'transparent',
    color: COLORS.TEXT_MUTED,
    border: `1px solid ${active ? COLORS.BORDER_STRONG : COLORS.BORDER}`,
    padding: '4px 9px', borderRadius: 5,
    fontSize: 11, fontWeight: 500, fontFamily: FONTS.BODY,
    cursor: 'pointer',
    transition: 'background 100ms, color 100ms',
  });
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
    >
      <button
        onClick={() => onSetStatus(status === 'accepted' ? 'open' : 'accepted')}
        style={{
          ...btnStyle(status === 'accepted'),
          color: status === 'accepted' ? '#3e6034' : COLORS.TEXT_MUTED,
          borderColor: status === 'accepted' ? '#3e6034' : COLORS.BORDER,
        }}
        title="Reviewer agrees with this finding"
      >
        <CheckCircle2 size={12} /> Accept
      </button>
      <button
        onClick={() => onSetStatus(status === 'for-review' ? 'open' : 'for-review')}
        style={{
          ...btnStyle(status === 'for-review'),
          color: status === 'for-review' ? '#a85d1a' : COLORS.TEXT_MUTED,
          borderColor: status === 'for-review' ? '#a85d1a' : COLORS.BORDER,
        }}
        title="Escalate to partner / manager review"
      >
        <AlertCircle size={12} /> For Review
      </button>
      <button
        onClick={() => onSetStatus(status === 'dismissed' ? 'open' : 'dismissed')}
        style={{
          ...btnStyle(status === 'dismissed'),
          color: status === 'dismissed' ? '#9a2920' : COLORS.TEXT_MUTED,
          borderColor: status === 'dismissed' ? '#9a2920' : COLORS.BORDER,
        }}
        title="Mark as false positive / out of scope"
      >
        <XCircle size={12} /> Dismiss
      </button>
      <button
        onClick={onAddNote}
        style={btnStyle(false)}
        title="Add or edit reviewer note"
      >
        <MessageSquarePlus size={12} /> Note
      </button>
    </div>
  );
}

function HistorySection({ history }) {
  const [open, setOpen] = useState(false);
  if (!history || history.length === 0) return null;
  return (
    <div style={{
      marginTop: 10, paddingTop: 8,
      borderTop: `1px dashed ${COLORS.BORDER}`,
    }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: 'transparent', border: 'none', padding: 0,
          fontSize: 10, fontWeight: 600, color: COLORS.TEXT_MUTED,
          textTransform: 'uppercase', letterSpacing: '0.05em',
          cursor: 'pointer', fontFamily: FONTS.BODY,
        }}
      >
        <Clock size={11} />
        Audit trail ({history.length})
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {open && (
        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, fontSize: 11, color: COLORS.TEXT_MUTED }}>
          {[...history].reverse().map((h, i) => (
            <li key={i} style={{ padding: '4px 0', lineHeight: 1.45 }}>
              <span style={{
                display: 'inline-block', minWidth: 80,
                color: ISSUE_STATUS[h.action]?.color || COLORS.TEXT_MUTED,
                fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 10,
              }}>
                {ISSUE_STATUS[h.action]?.label || h.action}
              </span>
              <span>{' '}by {h.by} · {formatRelativeTime(h.at)}</span>
              {h.comment && (
                <div style={{ marginLeft: 80, fontStyle: 'italic', color: COLORS.TEXT, marginTop: 2 }}>
                  "{h.comment}"
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteEditor({ initial, onSave, onCancel }) {
  const [text, setText] = useState(initial || '');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: 8, padding: 10,
        background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6,
      }}
    >
      <div style={{
        fontSize: 9, color: '#92400e', textTransform: 'uppercase',
        letterSpacing: '0.04em', marginBottom: 4, fontWeight: 600,
      }}>
        Reviewer note
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Note to self or for the working paper…"
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: 8, fontFamily: FONTS.BODY, fontSize: 12, lineHeight: 1.5,
          background: '#fffdf7', border: `1px solid ${COLORS.BORDER}`, borderRadius: 4,
          outline: 'none', resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
        <button
          onClick={onCancel}
          style={{
            padding: '4px 10px', fontSize: 11, background: 'transparent',
            border: `1px solid ${COLORS.BORDER_STRONG}`, borderRadius: 4,
            color: COLORS.TEXT_MUTED, cursor: 'pointer', fontFamily: FONTS.BODY,
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(text)}
          style={{
            padding: '4px 10px', fontSize: 11, background: COLORS.PRIMARY,
            color: '#faf6ee', border: 'none', borderRadius: 4,
            cursor: 'pointer', fontFamily: FONTS.BODY, fontWeight: 600,
          }}
        >
          Save note
        </button>
      </div>
    </div>
  );
}

// Memoized: with 60-issue lists a single status click used to re-render every
// card. Callbacks receive ids (expandId / issue.id) so the parent can pass
// stable function references instead of per-card closures.
export const IssueCard = React.memo(function IssueCard({
  issue, index, expandId,
  expanded, focused, onToggleExpand,
  status, note, history,
  onSetStatus, onSetNote,
  onViewSource,
}) {
  const cfg  = SEVERITY[issue.severity] || SEVERITY.MEDIUM;
  const Icon = cfg.icon;
  const cardRef = useRef(null);
  const [editingNote, setEditingNote] = useState(false);

  // Auto-scroll into view when focused via keyboard
  useEffect(() => {
    if (focused && cardRef.current) {
      cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focused]);

  const isDismissed = status === 'dismissed';

  return (
    <div
      ref={cardRef}
      data-issue-card
      style={{
        background: '#fffdf7',
        border: focused ? `1px solid ${COLORS.PRIMARY}` : '1px solid #e8e1d2',
        borderLeft: `4px solid ${cfg.bar}`,
        boxShadow: focused ? `0 0 0 3px ${COLORS.PRIMARY}1a` : 'none',
        borderRadius: 8,
        padding: 18,
        opacity: isDismissed ? 0.72 : 1,
        transition: 'box-shadow 120ms, border-color 120ms, opacity 120ms',
      }}
    >
      {/* Header row — clickable to toggle expand */}
      <div
        onClick={() => onToggleExpand?.(expandId)}
        style={{ cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{
            background: cfg.chipBg, color: cfg.chipText,
            padding: '2px 8px', borderRadius: 4, fontSize: 10,
            textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <Icon size={11} /> {cfg.label}
          </span>
          <span className="mono" style={{ fontSize: 10, color: COLORS.TEXT_MUTED }}>
            #{String(index).padStart(2, '0')}
          </span>
          {issue.id && (
            <span className="mono" style={{
              fontSize: 10, color: COLORS.PRIMARY,
              background: COLORS.BG_CREAM,
              border: `1px solid ${COLORS.BORDER}`,
              padding: '1px 6px', borderRadius: 3, fontWeight: 600,
            }}>
              {issue.id}
            </span>
          )}
          <span style={{ fontSize: 10, color: COLORS.TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {issue.category}
          </span>
          <SourcePill source={issue.source} />
          <StatusPill status={status} />
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {expanded
              ? <ChevronDown  size={16} color={COLORS.TEXT_MUTED} />
              : <ChevronRight size={16} color={COLORS.TEXT_MUTED} />}
          </div>
        </div>

        <div className="serif" style={{
          fontSize: 17, fontWeight: 600, lineHeight: 1.3,
          marginBottom: expanded ? 12 : 0,
          textDecoration: isDismissed ? 'line-through' : 'none',
          textDecorationColor: COLORS.TEXT_FAINT,
        }}>
          {issue.title}
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <>
          <IssueField label="Observation"    body={issue.observation} />
          <EvidenceField
            quote={issue.evidenceQuote}
            noteRef={issue.noteRef}
            sourcePage={issue.sourcePage}
            onViewSource={() => onViewSource?.(issue)}
          />
          <IssueField label="Implication"    body={issue.implication} />
          <IssueField label="Recommendation" body={issue.recommendation} last />

          {/* Saved note (read-only display when not editing) */}
          {note && !editingNote && (
            <div
              onClick={(e) => { e.stopPropagation(); setEditingNote(true); }}
              style={{
                marginTop: 10,
                background: '#fffbeb', border: '1px solid #fcd34d',
                borderRadius: 6, padding: '8px 12px', cursor: 'pointer',
              }}
              title="Click to edit"
            >
              <div style={{ fontSize: 9, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: 4 }}>
                Reviewer note
              </div>
              <div style={{ fontSize: 12, color: COLORS.TEXT, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{note}</div>
            </div>
          )}

          {/* Note editor */}
          {editingNote && (
            <NoteEditor
              initial={note}
              onSave={(t) => { onSetNote?.(issue.id, t); setEditingNote(false); }}
              onCancel={() => setEditingNote(false)}
            />
          )}

          {/* Action bar — separated visually */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginTop: 14, paddingTop: 10, gap: 10, flexWrap: 'wrap',
            borderTop: `1px solid ${COLORS.BORDER}`,
          }}>
            <ActionMenu
              status={status || 'open'}
              onSetStatus={(next) => onSetStatus?.(issue.id, next)}
              onAddNote={() => setEditingNote(true)}
            />
            <span style={{ fontSize: 10, color: COLORS.TEXT_FAINT }}>
              {history?.length > 0 && `Last action ${formatRelativeTime(history[history.length - 1].at)}`}
            </span>
          </div>

          <HistorySection history={history} />
        </>
      )}
    </div>
  );
});
