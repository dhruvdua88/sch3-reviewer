// ============ AUDIT REPORT TAB ============
// SA 700 (Revised) compliant Independent Auditor's Report builder.
// Each Rule 11 clause now has a "Scenario" dropdown drawing from
// rule11Wording.js — pick the variant that fits the engagement, then
// fine-tune the text before generating the Word report.

import React from 'react';
import {
  ShieldCheck, FileCheck2, Stamp, Edit3, Download, Check, RefreshCcw,
} from 'lucide-react';
import { COLORS, FONTS, BTN_PRIMARY, BTN_GHOST } from '../styles/tokens.js';
import { RULE_11_WORDING } from '../data/rule11Wording.js';

// ── Sub-components ──────────────────────────────────────────────────────────

function ApplicabilityCard({ icon: Icon, title, status, color, subnote }) {
  return (
    <div style={{
      background: '#fffdf7', border: '1px solid #e8e1d2',
      borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '14px 18px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon size={15} color={color} />
        <div style={{ fontSize: 11, color: COLORS.TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
          {title}
        </div>
      </div>
      <div style={{ fontSize: 13, color: COLORS.TEXT, fontWeight: 500 }}>{status}</div>
      {subnote && <div style={{ fontSize: 11, color: COLORS.TEXT_MUTED, marginTop: 4, fontStyle: 'italic' }}>{subnote}</div>}
    </div>
  );
}

function SectionCard({ icon: Icon, title, subtitle, children, accent }) {
  return (
    <div style={{
      background: '#fffdf7',
      border: `1px solid #e8e1d2`,
      borderLeft: accent ? `3px solid ${accent}` : `1px solid #e8e1d2`,
      borderRadius: 10, padding: 20, marginBottom: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Icon size={16} color={COLORS.PRIMARY} />
        <div className="serif" style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
      </div>
      {subtitle && <div style={{ fontSize: 12, color: COLORS.TEXT_MUTED, marginBottom: 16 }}>{subtitle}</div>}
      {children}
    </div>
  );
}

function InputField({ label, value, onChange, type = 'text', mono = false, placeholder, readOnly }) {
  return (
    <div>
      <label style={{
        fontSize: 10, color: COLORS.TEXT_MUTED, textTransform: 'uppercase',
        letterSpacing: '0.08em', fontWeight: 600, display: 'block', marginBottom: 4,
      }}>
        {label}
      </label>
      <input
        type={type}
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        style={{
          width: '100%', padding: '8px 10px',
          background: readOnly ? COLORS.BG_CREAM : '#fef9f1',
          border: `1px solid ${COLORS.BORDER_STRONG}`,
          borderRadius: 5, fontSize: 13,
          fontFamily: mono ? FONTS.MONO : FONTS.BODY,
          color: COLORS.TEXT, boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

// ── Rule 11 item with scenario dropdown + inline edit ────────────────────────
function Rule11Item({
  letter, label, value, onChange, reviewed, onToggleReview,
  variants, selectedVariantId, onPickVariant, extra,
}) {
  return (
    <div style={{
      borderTop: `1px solid #f0ead8`, paddingTop: 14, marginTop: 14,
      display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'flex-start',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.PRIMARY, marginBottom: 6 }}>
          <span className="mono" style={{ marginRight: 6 }}>{letter}</span>
          {label}
        </div>
        {extra && <div style={{ marginBottom: 10 }}>{extra}</div>}

        {/* Scenario dropdown */}
        {variants && variants.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap',
          }}>
            <label style={{
              fontSize: 10, color: COLORS.TEXT_MUTED, textTransform: 'uppercase',
              letterSpacing: '0.06em', fontWeight: 600,
            }}>
              Scenario
            </label>
            <select
              value={selectedVariantId || ''}
              onChange={(e) => {
                const id = e.target.value;
                const v = variants.find((x) => x.id === id);
                if (v) onPickVariant?.(v);
              }}
              style={{
                flex: '1 1 240px', minWidth: 200,
                padding: '6px 9px', fontSize: 12, fontFamily: FONTS.BODY,
                border: `1px solid ${COLORS.BORDER_STRONG}`, borderRadius: 5,
                background: COLORS.BG_CREAM, color: COLORS.TEXT, outline: 'none',
              }}
            >
              <option value="" disabled>— pick a standard variant —</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
            {selectedVariantId && (
              <button
                onClick={() => {
                  const v = variants.find((x) => x.id === selectedVariantId);
                  if (v) onChange?.(v.text);
                }}
                title="Reset text to the standard wording for the selected scenario"
                style={{ ...BTN_GHOST, fontSize: 10, padding: '4px 9px', gap: 4 }}
              >
                <RefreshCcw size={11} /> Reset
              </button>
            )}
          </div>
        )}

        <textarea
          value={value || ''}
          onChange={(e) => onChange?.(e.target.value)}
          rows={Math.min(12, Math.max(4, ((value || '').split('\n').length + 1)))}
          style={{
            width: '100%', padding: '8px 10px',
            background: '#fef9f1', border: `1px solid ${COLORS.BORDER_STRONG}`,
            borderRadius: 5, fontSize: 12, fontFamily: FONTS.BODY,
            color: COLORS.TEXT, lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box',
            whiteSpace: 'pre-wrap',
          }}
        />
      </div>
      <button
        onClick={onToggleReview}
        style={{
          background:  reviewed ? '#3e6034' : '#fef9f1',
          color:       reviewed ? '#faf6ee' : COLORS.HIGH,
          border:      `1px solid ${reviewed ? '#3e6034' : COLORS.HIGH}`,
          padding: '5px 11px', borderRadius: 4, fontSize: 10, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          whiteSpace: 'nowrap', fontFamily: FONTS.BODY,
        }}
      >
        {reviewed ? <><Check size={11} /> Reviewed</> : 'Review required'}
      </button>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function AuditReportTab({ analysis, caro, reportFields: rf, setReportFields, onGenerate, exporting }) {
  const ifcofrApplies = (analysis?.keyMetrics?.revenueLakhs || 0) >= 5000;
  const caroApplies   = !!caro?.applicability?.applies;
  const allReviewed   = rf.reviewed ? Object.values(rf.reviewed).every(Boolean) : false;

  const update       = (key, val) => setReportFields({ ...rf, [key]: val });
  const toggleReview = (k) => setReportFields({ ...rf, reviewed: { ...rf.reviewed, [k]: !rf.reviewed[k] } });

  // Helper — pick a variant + update both the text field and the chosen-variant tracker.
  // The "chosen variant" is purely UI state to keep the dropdown selection sticky;
  // we stash it under rf.scenario.<key> so it survives saves.
  const pickVariant = (clauseKey, fieldKey, variant) => {
    setReportFields({
      ...rf,
      [fieldKey]: variant.text,
      scenario: { ...(rf.scenario || {}), [clauseKey]: variant.id },
    });
  };
  const selectedVariant = (k) => rf.scenario?.[k] || null;

  // ── 11(g) needs a software-aware default. If the user picks the "throughout"
  //    variant we substitute the software name into the [SOFTWARE] token.
  const applyG = (variant) => {
    const filled = (variant.text || '').replaceAll('[SOFTWARE]', rf.accountingSoftware || '[SOFTWARE]');
    setReportFields({
      ...rf,
      rule11g_text: filled,
      scenario: { ...(rf.scenario || {}), g: variant.id },
    });
  };
  const applyE = (variant) => {
    setReportFields({
      ...rf,
      rule11e_text: variant.text,
      scenario: { ...(rf.scenario || {}), e: variant.id },
    });
  };

  return (
    <div className="fade-in">

      {/* Applicability strip */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 22 }}>
        <ApplicabilityCard
          icon={ShieldCheck}
          title="CARO 2020"
          status={caroApplies ? 'Applies — Annexure A will be attached' : 'Does not apply — no Annexure A'}
          color={caroApplies ? COLORS.HIGH : '#3e6034'}
        />
        <ApplicabilityCard
          icon={FileCheck2}
          title="IFCoFR — Sec 143(3)(i)"
          status={ifcofrApplies
            ? 'Applies — Annexure B will be attached'
            : `Exempt — turnover Rs ${((analysis?.keyMetrics?.revenueLakhs || 0) / 100).toFixed(2)} cr < Rs 50 cr`}
          color={ifcofrApplies ? COLORS.HIGH : '#3e6034'}
          subnote={!ifcofrApplies ? 'Turnover-only test applied (per practice convention)' : null}
        />
      </div>

      {/* Signature block */}
      <SectionCard icon={Stamp} title="Signature block" subtitle="Pre-filled with firm defaults; edit per engagement">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <InputField label="Firm name"                value={rf.firmName}            onChange={(v) => update('firmName', v)} />
          <InputField label="Firm Registration No (FRN)" value={rf.firmFRN}          onChange={(v) => update('firmFRN', v)} mono />
          <InputField label="Partner / Signatory name" value={rf.partnerName}         onChange={(v) => update('partnerName', v)} />
          <InputField label="Designation"              value={rf.partnerDesignation}  onChange={(v) => update('partnerDesignation', v)} />
          <InputField label="Membership Number"        value={rf.membershipNo}        onChange={(v) => update('membershipNo', v)} mono />
          <InputField label="UDIN"                     value={rf.udin}                onChange={(v) => update('udin', v)} mono placeholder="Enter at signing" />
          <InputField label="Place"                    value={rf.place}               onChange={(v) => update('place', v)} />
          <InputField label="Date of report"           value={rf.reportDate}          onChange={(v) => update('reportDate', v)} type="date" mono />
        </div>
      </SectionCard>

      {/* Rule 11 disclosures with scenario dropdowns */}
      <SectionCard
        icon={Edit3}
        title="Rule 11 disclosures"
        subtitle="Pick a scenario for each clause to load the standard ICAI wording, then edit as needed. Confirm reviewed before generating."
        accent={!allReviewed ? COLORS.HIGH : '#3e6034'}
      >
        <Rule11Item
          letter="(a)" label="Pending litigations [Rule 11(a)]"
          value={rf.rule11a_litigation}
          onChange={(v) => update('rule11a_litigation', v)}
          reviewed={rf.reviewed?.a}
          onToggleReview={() => toggleReview('a')}
          variants={RULE_11_WORDING.a}
          selectedVariantId={selectedVariant('a')}
          onPickVariant={(v) => pickVariant('a', 'rule11a_litigation', v)}
        />
        <Rule11Item
          letter="(b)" label="Long-term contracts incl. derivatives [Rule 11(b)]"
          value={rf.rule11b_longTermContracts}
          onChange={(v) => update('rule11b_longTermContracts', v)}
          reviewed={rf.reviewed?.b}
          onToggleReview={() => toggleReview('b')}
          variants={RULE_11_WORDING.b}
          selectedVariantId={selectedVariant('b')}
          onPickVariant={(v) => pickVariant('b', 'rule11b_longTermContracts', v)}
        />
        <Rule11Item
          letter="(c)" label="Investor Education and Protection Fund [Rule 11(c)]"
          value={rf.rule11c_iepf}
          onChange={(v) => update('rule11c_iepf', v)}
          reviewed={rf.reviewed?.c}
          onToggleReview={() => toggleReview('c')}
          variants={RULE_11_WORDING.c}
          selectedVariantId={selectedVariant('c')}
          onPickVariant={(v) => pickVariant('c', 'rule11c_iepf', v)}
        />
        <Rule11Item
          letter="(e)" label="Ultimate Beneficiary [Rule 11(e)] — three-part representation"
          value={rf.rule11e_text || RULE_11_WORDING.e[0].text}
          onChange={(v) => update('rule11e_text', v)}
          reviewed={rf.reviewed?.e}
          onToggleReview={() => toggleReview('e')}
          variants={RULE_11_WORDING.e}
          selectedVariantId={selectedVariant('e') || RULE_11_WORDING.e[0].id}
          onPickVariant={applyE}
        />
        <Rule11Item
          letter="(f)" label="Dividend declared/paid u/s 123 [Rule 11(f)]"
          value={rf.rule11f_dividend}
          onChange={(v) => update('rule11f_dividend', v)}
          reviewed={rf.reviewed?.f}
          onToggleReview={() => toggleReview('f')}
          variants={RULE_11_WORDING.f}
          selectedVariantId={selectedVariant('f')}
          onPickVariant={(v) => pickVariant('f', 'rule11f_dividend', v)}
        />
        <Rule11Item
          letter="(g)" label="Audit trail / accounting software [Rule 11(g)] — ICAI Impl. Guide (Rev. 2024)"
          extra={
            <InputField
              label="Accounting software name [SOFTWARE] token in the dropdown will be replaced with this"
              value={rf.accountingSoftware}
              onChange={(v) => update('accountingSoftware', v)}
            />
          }
          value={rf.rule11g_text || (RULE_11_WORDING.g[0].text || '').replaceAll('[SOFTWARE]', rf.accountingSoftware || '[SOFTWARE]')}
          onChange={(v) => update('rule11g_text', v)}
          reviewed={rf.reviewed?.g}
          onToggleReview={() => toggleReview('g')}
          variants={RULE_11_WORDING.g}
          selectedVariantId={selectedVariant('g') || RULE_11_WORDING.g[0].id}
          onPickVariant={applyG}
        />
      </SectionCard>

      {/* Generate button */}
      <div style={{
        marginTop: 28, padding: 20, background: '#fffdf7', border: '1px solid #e8e1d2',
        borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div>
          <div className="serif" style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>
            Ready to generate the Independent Auditor's Report
          </div>
          <div style={{ fontSize: 12, color: COLORS.TEXT_MUTED }}>
            SA 700 (Revised) compliant ·{' '}
            {caroApplies  && 'with Annexure A (CARO 2020)'}
            {caroApplies  && ifcofrApplies && ' and '}
            {ifcofrApplies && 'Annexure B (IFCoFR long-form)'}
            {!caroApplies && !ifcofrApplies && 'main report only'}
            {!allReviewed && (
              <span style={{ color: COLORS.HIGH, fontWeight: 600 }}>
                {' '}· {Object.values(rf.reviewed || {}).filter((x) => !x).length} Rule 11 item(s) still need review
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onGenerate}
          disabled={exporting}
          style={{
            ...BTN_PRIMARY, padding: '12px 22px', fontSize: 14,
            opacity: exporting ? 0.6 : (allReviewed ? 1 : 0.7),
            cursor: exporting ? 'wait' : 'pointer',
          }}
        >
          <Download size={15} /> Generate Word Report
        </button>
      </div>

      <p style={{ fontSize: 11, color: '#a39d8c', textAlign: 'center', marginTop: 14, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Output is a .doc file · opens cleanly in Microsoft Word and Google Docs
      </p>
    </div>
  );
}
