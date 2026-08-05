// ============ PER-ISSUE STATE + AUDIT TRAIL ============
//
// Each Schedule III finding can be moved through one of four review states:
//
//   open        — default; reviewer has not acted yet.
//   accepted    — reviewer agrees with the finding (will be addressed in FS).
//   dismissed   — reviewer rejects the finding (false positive / out of scope).
//   for-review  — escalated for partner / manager attention.
//
// Each state change is logged into a per-issue history array with
// reviewer name and timestamp. This is the artefact ICAI peer review
// expects when an audit firm uses an AI assistant — proof that the
// CA exercised judgement on each AI-generated finding.
//
// The active reviewer note is a free-text field separate from history.

import { CheckCircle2, XCircle, EyeOff, AlertCircle } from 'lucide-react';

export const ISSUE_STATUS = {
  open:        { label: 'Open',          color: '#5c5e58', bg: '#fef9f1', icon: AlertCircle,  rank: 0 },
  'for-review':{ label: 'For Review',    color: '#a85d1a', bg: '#fdf6ed', icon: AlertCircle,  rank: 1 },
  accepted:    { label: 'Accepted',      color: '#3e6034', bg: '#f4f7ee', icon: CheckCircle2, rank: 2 },
  dismissed:   { label: 'Dismissed',     color: '#9a2920', bg: '#fdf3f0', icon: XCircle,      rank: 3 },
};

export const DEFAULT_STATUS = 'open';

// ── Pure helpers — no I/O, no React ──────────────────────────────────

// Shared frozen default — a stable reference so memoized issue cards don't
// see a "new" state object on every render for untouched issues.
const EMPTY_STATE = Object.freeze({ status: DEFAULT_STATUS, history: Object.freeze([]), note: '' });

export function getIssueState(issueStates, issueId) {
  if (!issueId) return EMPTY_STATE;
  return issueStates?.[issueId] || EMPTY_STATE;
}

/**
 * Update an issue's status. Appends a history entry.
 *
 * @param {object} issueStates - the current map
 * @param {string} issueId
 * @param {'open'|'accepted'|'dismissed'|'for-review'} status
 * @param {string} actor - reviewer name (from settings)
 * @param {string} [comment] - optional reason
 * @returns {object} new map (immutable update)
 */
export function setIssueStatus(issueStates, issueId, status, actor, comment = '') {
  if (!issueId || !ISSUE_STATUS[status]) return issueStates;
  const prev = getIssueState(issueStates, issueId);
  if (prev.status === status && !comment) return issueStates;  // no-op
  const entry = {
    action:  status,
    by:      actor || 'Reviewer',
    at:      new Date().toISOString(),
    comment: comment || '',
  };
  return {
    ...(issueStates || {}),
    [issueId]: {
      ...prev,
      status,
      history: [...(prev.history || []), entry],
    },
  };
}

/**
 * Update an issue's reviewer note (free text). Does not append to history —
 * notes are working scratchpad, not audit-trail events.
 */
export function setIssueNote(issueStates, issueId, note) {
  if (!issueId) return issueStates;
  const prev = getIssueState(issueStates, issueId);
  return {
    ...(issueStates || {}),
    [issueId]: { ...prev, note: note || '' },
  };
}

/**
 * Counts by status across an issue array, defaulting unknown issues to 'open'.
 */
export function countByStatus(issues, issueStates) {
  const c = { open: 0, accepted: 0, dismissed: 0, 'for-review': 0 };
  (issues || []).forEach((iss) => {
    const s = getIssueState(issueStates, iss.id).status;
    if (c[s] !== undefined) c[s]++;
    else c.open++;
  });
  return c;
}

/**
 * Default expansion policy — CRITICAL and HIGH start expanded, others collapsed.
 * Dismissed issues collapse regardless of severity.
 */
export function defaultExpansion(issue, status) {
  if (status === 'dismissed') return false;
  return issue.severity === 'CRITICAL' || issue.severity === 'HIGH';
}

/**
 * Friendly relative-time formatter for history entries ("2 mins ago", "yesterday").
 */
export function formatRelativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return '';
  const diff = Date.now() - then;
  const s = Math.floor(diff / 1000);
  if (s < 60)    return s <= 5 ? 'just now' : `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 7)    return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
