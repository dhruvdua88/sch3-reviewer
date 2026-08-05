// ============ ANALYZING PROGRESS ============
// Live progress UI for the Schedule III + CARO analysis.
//
// Mechanics:
//   - DeepSeek is called non-streaming (single round-trip JSON) by default.
//   - We can't get true per-test progress from a non-streaming call, so we
//     use a TIME-BASED determinate bar with an asymptotic tail (never 100%
//     until the phase actually completes — phase advances reset the bar).
//   - When the wrapper streams (onFirstToken provided), we still drive the
//     bar by time, but jump to ~80% the moment the first token arrives so
//     the user sees a visible signal that the model has begun writing.
//   - Stage labels cycle on a fixed schedule per phase, giving a sense of
//     what the reviewer is checking right now.

import React, { useEffect, useState, useRef } from 'react';
import { X, Brain, ShieldCheck } from 'lucide-react';
import { COLORS, FONTS, BTN_GHOST } from '../styles/tokens.js';

// Estimated durations per phase, by model. Tweak after observing real runs.
// SCH3 estimates were lifted after expanding the prompt from 46 to 73 tests
// (Mar-2026); the 240 s timeout still leaves comfortable headroom.
const PHASE_DURATIONS = {
  'analyzing-sch3': {
    'deepseek-v4-flash': 45_000,
  },
  'analyzing-caro': {
    'deepseek-v4-flash': 16_000,
  },
};

// Stage labels: [endTimeMs, label]. The last entry is shown for any time beyond it.
// Stretched to match the 73-test prompt; ICAI Guidance Note checks are explicit.
const SCH3_STAGES = [
  [8_000,  'Parsing the extracted statements…'],
  [18_000, 'Identifying balance sheet structure and key metrics…'],
  [32_000, 'Cross-checking the 2021 amendment regulatory disclosures…'],
  [45_000, 'Verifying share capital, borrowings and ageing schedules…'],
  [58_000, 'Evaluating AS compliance and CFS classification quality…'],
  [70_000, 'Reviewing P&L sub-classification and statutory disclosures…'],
  [Infinity, 'Drafting findings and finalising JSON…'],
];

const CARO_STAGES = [
  [6_000,  'Computing CARO 2020 applicability thresholds…'],
  [16_000, 'Mapping company facts to the 21 paragraphs…'],
  [Infinity, 'Drafting clause-level review notes…'],
];

function getEstimatedDuration(phase, model) {
  return PHASE_DURATIONS[phase]?.[model]
       ?? PHASE_DURATIONS[phase]?.['deepseek-v4-flash']
       ?? 45_000;
}

function getStageLabel(phase, elapsed, firstTokenAt) {
  if (firstTokenAt) {
    return phase === 'analyzing-caro'
      ? 'Drafting clause-level review notes…'
      : 'Drafting findings and finalising JSON…';
  }
  const stages = phase === 'analyzing-caro' ? CARO_STAGES : SCH3_STAGES;
  for (const [end, label] of stages) {
    if (elapsed < end) return label;
  }
  return stages[stages.length - 1][1];
}

// Asymptotic curve — capped at 95% until the phase completes externally.
// Linear ramp 0 → 80 over the estimated duration; then asymptote toward 95.
function computeProgress(elapsed, expected, firstTokenAt) {
  if (firstTokenAt) {
    // Streaming path — once first token arrives, jump to 80% and inch toward 95%.
    const sinceFirstToken = Date.now() - firstTokenAt;
    return Math.min(95, 80 + (15 * (1 - Math.exp(-sinceFirstToken / 8_000))));
  }
  if (elapsed < expected) {
    return Math.max(2, 80 * (elapsed / expected));
  }
  // Past the estimate — slow asymptote from 80 to 95
  const overshoot = elapsed - expected;
  return 80 + (15 * (1 - Math.exp(-overshoot / 12_000)));
}

export function AnalyzingProgress({
  phase, onCancel, model, runCaro, startedAt, firstTokenAt,
}) {
  const isCaro = phase === 'analyzing-caro';
  const expected = getEstimatedDuration(phase, model);

  // Fall back to "now" if startedAt isn't wired — keeps the UI alive even if
  // the parent forgot to set it on phase entry.
  const startRef = useRef(startedAt || Date.now());
  useEffect(() => {
    startRef.current = startedAt || Date.now();
  }, [startedAt, phase]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, []);

  const elapsed  = Date.now() - startRef.current;
  const progress = computeProgress(elapsed, expected, firstTokenAt);
  const label    = getStageLabel(phase, elapsed, firstTokenAt);
  const elapsedSec = Math.floor(elapsed / 1000);
  const expectedSec = Math.round(expected / 1000);

  return (
    <div className="fade-in" style={{ maxWidth: 720, margin: '0 auto' }}>

      {/* Phase indicator */}
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 12,
          padding: '10px 20px', borderRadius: 999,
          background: COLORS.BG_CREAM, border: `1px solid ${COLORS.BORDER}`,
          marginBottom: 20,
        }}>
          <span className="pulse-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.PRIMARY, display: 'inline-block' }} />
          <span style={{ fontSize: 13, color: COLORS.TEXT_MUTED }}>
            {runCaro
              ? (isCaro ? 'Phase 2 of 2' : 'Phase 1 of 2')
              : 'Phase 1 of 1'}
          </span>
          {model && (
            <span className="mono" style={{ fontSize: 11, color: COLORS.TEXT_FAINT, paddingLeft: 8, borderLeft: `1px solid ${COLORS.BORDER}` }}>
              {model}
            </span>
          )}
        </div>

        <h2 className="serif" style={{ fontSize: 26, fontWeight: 600, color: COLORS.TEXT, marginBottom: 8 }}>
          {isCaro ? 'CARO 2020 Evaluation' : 'Schedule III Review'}
        </h2>
        <p style={{ fontSize: 14, color: COLORS.TEXT_MUTED, maxWidth: 520, margin: '0 auto' }}>
          {isCaro
            ? 'Evaluating CARO applicability and drafting clause-level remarks.'
            : 'Running the Schedule III substantive checklist against the extracted financials.'}
        </p>
      </div>

      {/* Phase steps — collapses to single step when CARO is disabled */}
      <div style={{
        display: 'flex', gap: 0, maxWidth: 520, margin: '0 auto 32px',
        background: COLORS.BG_CREAM, border: `1px solid ${COLORS.BORDER}`,
        borderRadius: 10, overflow: 'hidden',
      }}>
        <PhaseStep
          icon={Brain}
          label="Schedule III"
          sublabel="46-test substantive checklist"
          active={!isCaro}
          done={isCaro}
        />
        {runCaro && (
          <>
            <div style={{ width: 1, background: COLORS.BORDER }} />
            <PhaseStep
              icon={ShieldCheck}
              label="CARO 2020"
              sublabel="Applicability + 21 clauses"
              active={isCaro}
              done={false}
            />
          </>
        )}
      </div>

      {/* Determinate progress bar */}
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 8, fontSize: 12, color: COLORS.TEXT_MUTED,
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            minHeight: 18,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: firstTokenAt ? '#3e6034' : COLORS.PRIMARY,
              animation: 'pulse 1.4s ease-in-out infinite',
              display: 'inline-block',
            }} />
            <span>{label}</span>
          </span>
          <span className="mono" style={{ fontSize: 11, color: COLORS.TEXT_FAINT }}>
            {Math.round(progress)}%
          </span>
        </div>

        <div style={{
          width: '100%', height: 8, borderRadius: 999,
          background: COLORS.BORDER, overflow: 'hidden',
        }}>
          <div style={{
            width: `${progress}%`, height: '100%',
            background: `linear-gradient(90deg, ${COLORS.PRIMARY} 0%, #2c5a45 100%)`,
            borderRadius: 999,
            transition: 'width 250ms ease-out',
          }} />
        </div>

        <div style={{
          marginTop: 8, fontSize: 11, color: COLORS.TEXT_FAINT,
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>
            {firstTokenAt ? 'Model is writing the response…' : 'Estimated ' + expectedSec + ' s · ' + (model || 'default model')}
          </span>
          <span className="mono">{elapsedSec}s elapsed</span>
        </div>
      </div>

      {/* Cancel */}
      <div style={{ textAlign: 'center', marginTop: 36 }}>
        <button onClick={onCancel} style={{ ...BTN_GHOST, fontSize: 12, color: COLORS.TEXT_MUTED }}>
          <X size={13} /> Cancel analysis
        </button>
      </div>
    </div>
  );
}

function PhaseStep({ icon: Icon, label, sublabel, active, done }) {
  const color = done
    ? COLORS.TEXT_MUTED
    : active ? COLORS.PRIMARY : COLORS.TEXT_FAINT;

  return (
    <div style={{
      flex: 1, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10,
      background: active ? `${COLORS.PRIMARY}0d` : 'transparent',
      opacity: done ? 0.55 : 1,
    }}>
      <Icon size={18} color={color} strokeWidth={1.5} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color, lineHeight: 1.2 }}>{label}</div>
        <div style={{ fontSize: 11, color: COLORS.TEXT_MUTED, marginTop: 2 }}>{sublabel}</div>
      </div>
      {active && (
        <div style={{ marginLeft: 'auto' }}>
          <span className="pulse-dot" style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: COLORS.PRIMARY,
          }} />
        </div>
      )}
      {done && (
        <div style={{ marginLeft: 'auto', fontSize: 16, color: COLORS.TEXT_MUTED }}>✓</div>
      )}
    </div>
  );
}
