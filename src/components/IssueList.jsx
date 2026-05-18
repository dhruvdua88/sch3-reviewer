// ============ ISSUE LIST ============
// Wraps the Schedule III issues view with:
//   - filter toolbar (status chips, "show dismissed" toggle)
//   - keyboard nav (J/K = next/prev, Enter = toggle expand, X = dismiss,
//     A = accept, R = for-review, N = add note, Esc = clear focus)
//   - default-expansion policy (CRITICAL/HIGH expanded, lower collapsed)
//
// The orchestrator owns the source-of-truth state (issueStates, focusedIndex,
// expansionMap) — this component is presentational + dispatches events.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Filter, EyeOff, Eye, Search } from 'lucide-react';
import { COLORS, FONTS } from '../styles/tokens.js';
import { ISSUE_STATUS, getIssueState, countByStatus, defaultExpansion } from '../lib/issueState.js';
import { IssueCard } from './IssueCard.jsx';

export function IssueList({
  issues, issueStates,
  onSetStatus, onSetNote,
  onViewSource,
  partialChunkFailure,
}) {
  // ── Filter state ──
  // statusFilter is a Set of statuses to SHOW. By default we hide dismissed.
  const [statusFilter, setStatusFilter] = useState(() => new Set(['open', 'for-review', 'accepted']));

  const toggleStatus = (s) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else            next.add(s);
      return next;
    });
  };

  // ── Expansion state per issue id ──
  // Default policy is computed once per issue when first rendered; user
  // overrides win after that.
  const [expansion, setExpansion] = useState({});
  useEffect(() => {
    // Seed defaults for issues we haven't seen before.
    setExpansion((prev) => {
      const next = { ...prev };
      issues.forEach((iss) => {
        if (!iss?.id) return;
        if (next[iss.id] === undefined) {
          const status = getIssueState(issueStates, iss.id).status;
          next[iss.id] = defaultExpansion(iss, status);
        }
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues.length]);

  const toggleExpand = useCallback((id) => {
    setExpansion((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const expandAll = () => {
    setExpansion(Object.fromEntries(issues.map((i, idx) => [i.id || `idx-${idx}`, true])));
  };
  const collapseAll = () => {
    setExpansion(Object.fromEntries(issues.map((i, idx) => [i.id || `idx-${idx}`, false])));
  };

  // ── Apply filter ──
  const visibleIssues = useMemo(() => {
    return issues.filter((iss) => {
      const s = getIssueState(issueStates, iss?.id).status;
      return statusFilter.has(s);
    });
  }, [issues, issueStates, statusFilter]);

  // ── Keyboard navigation ──
  const [focusedIdx, setFocusedIdx] = useState(-1);

  // Reset focus when visible list shrinks past it
  useEffect(() => {
    if (focusedIdx >= visibleIssues.length) setFocusedIdx(-1);
  }, [visibleIssues.length, focusedIdx]);

  useEffect(() => {
    const handler = (e) => {
      // Ignore if user is typing in an input/textarea
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      // Ignore when modifier keys are involved (Cmd+K etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key.toLowerCase();
      if (k === 'j') {
        e.preventDefault();
        setFocusedIdx((i) => Math.min(visibleIssues.length - 1, (i < 0 ? 0 : i + 1)));
        return;
      }
      if (k === 'k') {
        e.preventDefault();
        setFocusedIdx((i) => Math.max(0, (i < 0 ? 0 : i - 1)));
        return;
      }
      if (k === 'escape') {
        if (focusedIdx >= 0) { e.preventDefault(); setFocusedIdx(-1); }
        return;
      }
      if (focusedIdx < 0) return;
      const iss = visibleIssues[focusedIdx];
      if (!iss?.id) return;

      if (k === 'enter') {
        e.preventDefault();
        toggleExpand(iss.id);
      } else if (k === 'a') {
        e.preventDefault();
        onSetStatus?.(iss.id, getIssueState(issueStates, iss.id).status === 'accepted' ? 'open' : 'accepted');
      } else if (k === 'x') {
        e.preventDefault();
        onSetStatus?.(iss.id, getIssueState(issueStates, iss.id).status === 'dismissed' ? 'open' : 'dismissed');
      } else if (k === 'r') {
        e.preventDefault();
        onSetStatus?.(iss.id, getIssueState(issueStates, iss.id).status === 'for-review' ? 'open' : 'for-review');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visibleIssues, focusedIdx, issueStates, onSetStatus, toggleExpand]);

  const counts = countByStatus(issues, issueStates);

  return (
    <div>
      {/* Partial-chunk-failure banner — shown when one or two of the three
          parallel SCH3 chunks rejected and we shipped the rest. */}
      {partialChunkFailure?.failed?.length > 0 && (
        <div role="status" style={{
          marginBottom: 14,
          padding: '10px 14px',
          background: '#fef9f1',
          border: `1px solid ${COLORS.BORDER_STRONG || COLORS.BORDER}`,
          borderLeft: `3px solid ${COLORS.CRIT}`,
          borderRadius: 6,
          fontSize: 12.5,
          color: COLORS.TEXT,
          lineHeight: 1.5,
        }}>
          <span style={{ fontWeight: 600 }}>Partial Deep AI result.</span>{' '}
          {partialChunkFailure.failed.length === 1
            ? `One review chunk failed (${partialChunkFailure.failed[0].name}); the other two completed.`
            : `${partialChunkFailure.failed.length} review chunks failed (${partialChunkFailure.failed.map((f) => f.name).join('; ')}); the remaining chunks completed.`}
          {' '}Click <strong>Re-run Deep AI Review</strong> to retry the full scan.
        </div>
      )}

      {/* Filter toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        flexWrap: 'wrap',
        padding: '10px 14px',
        background: COLORS.BG_CREAM,
        border: `1px solid ${COLORS.BORDER}`,
        borderRadius: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Filter size={13} color={COLORS.TEXT_MUTED} />
          <span style={{
            fontSize: 10, color: COLORS.TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.07em',
            fontWeight: 600,
          }}>
            Show
          </span>
        </div>
        {(['open', 'for-review', 'accepted', 'dismissed']).map((s) => {
          const meta = ISSUE_STATUS[s];
          const active = statusFilter.has(s);
          return (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 999,
                background: active ? meta.bg : 'transparent',
                color: active ? meta.color : COLORS.TEXT_FAINT,
                border: `1px solid ${active ? meta.color + '55' : COLORS.BORDER}`,
                fontSize: 11, fontWeight: 600, fontFamily: FONTS.BODY,
                cursor: 'pointer',
                opacity: active ? 1 : 0.55,
              }}
              title={active ? `Click to hide ${meta.label}` : `Click to show ${meta.label}`}
            >
              {active ? <Eye size={11} /> : <EyeOff size={11} />}
              {meta.label}
              <span style={{
                fontSize: 10, opacity: 0.75, marginLeft: 2, fontWeight: 500,
              }}>
                ({counts[s] || 0})
              </span>
            </button>
          );
        })}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={expandAll}
            style={ghostMicro}
            title="Expand all visible issues"
          >
            Expand all
          </button>
          <button
            onClick={collapseAll}
            style={ghostMicro}
            title="Collapse all visible issues"
          >
            Collapse all
          </button>
          <KbdHint />
        </div>
      </div>

      {/* Visible counts line */}
      {visibleIssues.length !== issues.length && (
        <div style={{
          fontSize: 11, color: COLORS.TEXT_MUTED, marginBottom: 12,
          paddingLeft: 4,
        }}>
          Showing {visibleIssues.length} of {issues.length} issues.
          {visibleIssues.length === 0 && (
            <span style={{ color: COLORS.TEXT_FAINT, fontStyle: 'italic' }}>
              {' '}— click the filter chips above to show more.
            </span>
          )}
        </div>
      )}

      {/* Issue cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {visibleIssues.map((iss, idx) => {
          const id = iss.id || `idx-${idx}`;
          const state = getIssueState(issueStates, iss.id);
          return (
            <IssueCard
              key={id}
              issue={iss}
              index={idx + 1}
              expanded={expansion[id] !== undefined ? expansion[id] : defaultExpansion(iss, state.status)}
              focused={idx === focusedIdx}
              onToggleExpand={() => toggleExpand(id)}
              status={state.status}
              note={state.note}
              history={state.history}
              onSetStatus={(next) => onSetStatus?.(iss.id, next)}
              onSetNote={(note) => onSetNote?.(iss.id, note)}
              onViewSource={onViewSource}
            />
          );
        })}
      </div>
    </div>
  );
}

const ghostMicro = {
  background: 'transparent', border: 'none',
  fontSize: 11, color: COLORS.TEXT_MUTED, cursor: 'pointer',
  fontFamily: FONTS.BODY, textDecoration: 'underline dotted', textUnderlineOffset: 3,
};

function KbdHint() {
  return (
    <span
      title="J / K = next / prev · Enter = expand · A = accept · X = dismiss · R = for review · Esc = clear"
      style={{
        fontSize: 10, color: COLORS.TEXT_FAINT,
        background: '#fffdf7',
        border: `1px solid ${COLORS.BORDER}`,
        padding: '3px 7px', borderRadius: 999,
        fontFamily: FONTS.MONO,
        cursor: 'help',
      }}
    >
      ⌨ J K Enter
    </span>
  );
}
