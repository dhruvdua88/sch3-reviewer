// ============ FILE UPLOAD ============
// Drag-drop + file picker. Accepts a PDF or an Excel workbook (.xlsx/.xlsm), < 30MB.
// Validation (type + size) lives in the orchestrator's handleFile.

import React, { useCallback, useRef } from 'react';
import { Upload, AlertCircle, Layers, ShieldCheck, FileSpreadsheet, Sparkles } from 'lucide-react';
import { COLORS, FONTS, BTN_PRIMARY } from '../styles/tokens.js';

export function FileUpload({ file, dragOver, error, onFile, onDragOver, onDragLeave, onDrop, onAnalyze }) {
  const fileRef = useRef(null);

  const handlePick = (e) => {
    const f = e.target.files[0];
    if (f) onFile(f);
  };

  return (
    <div className="fade-in">
      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px',
          borderRadius: 999, background: COLORS.BG_CREAM, border: `1px solid ${COLORS.BORDER}`,
          fontSize: 12, color: COLORS.TEXT_MUTED, marginBottom: 18,
        }}>
          <Sparkles size={13} /> Powered by DeepSeek · Schedule III Div I + CARO 2020
        </div>
        <h1 className="serif" style={{ fontSize: 44, fontWeight: 600, lineHeight: 1.05, marginBottom: 14, letterSpacing: '-0.02em', color: COLORS.TEXT }}>
          Upload a balance sheet.<br />
          <span style={{ fontStyle: 'italic', color: COLORS.PRIMARY }}>Get the audit memo.</span>
        </h1>
        <p style={{ color: COLORS.TEXT_MUTED, maxWidth: 560, margin: '0 auto', fontSize: 15, lineHeight: 1.55 }}>
          Substantive Schedule III checks, mandatory amended-paragraph compliance, and a paragraph-by-paragraph CARO 2020 review when applicable.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload PDF or Excel — click or drag and drop"
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
        style={{
          background: dragOver ? COLORS.BG_CREAM : COLORS.BG_CARD,
          border: `2px dashed ${dragOver ? COLORS.PRIMARY : COLORS.BORDER_STRONG}`,
          borderRadius: 12,
          padding: '56px 32px',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all 200ms ease',
          maxWidth: 720,
          margin: '0 auto',
          outline: 'none',
        }}
      >
        <input ref={fileRef} type="file" accept="application/pdf,.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handlePick} style={{ display: 'none' }} />
        <div style={{
          width: 64, height: 64, borderRadius: '50%', background: COLORS.PRIMARY,
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px',
        }}>
          <Upload size={26} color="#faf6ee" strokeWidth={1.5} />
        </div>
        <div className="serif" style={{ fontSize: 22, fontWeight: 500, marginBottom: 6, color: COLORS.TEXT }}>
          {file ? file.name : 'Drop a PDF or Excel here'}
        </div>
        <div style={{ color: COLORS.TEXT_MUTED, fontSize: 13 }}>
          {file
            ? `${(file.size / 1024).toFixed(0)} KB · ready to extract`
            : 'or click to browse · Max 30 MB · PDF or Excel (.xlsx)'}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          maxWidth: 720, margin: '16px auto 0', padding: '12px 16px',
          background: '#fdf3f0', border: '1px solid #f5d0c8', borderRadius: 8,
          color: COLORS.CRIT, fontSize: 13, display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Action button */}
      {file && !error && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button onClick={onAnalyze} style={{ ...BTN_PRIMARY, padding: '14px 32px', fontSize: 15 }}>
            <Sparkles size={16} /> Extract &amp; Analyse
          </button>
          <p style={{ marginTop: 8, fontSize: 11, color: COLORS.TEXT_FAINT }}>
            Text is extracted in your browser, then sent to DeepSeek for analysis
          </p>
        </div>
      )}

      {/* Feature cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 720, margin: '56px auto 0' }}>
        <FeatureCard icon={Layers}         title="Schedule III, Div I"  body="Substantive review against the 2021-amended paragraph 6 disclosures." />
        <FeatureCard icon={ShieldCheck}    title="CARO 2020"             body="Threshold test under Para 1(2)(iv); 21-clause review when applicable." />
        <FeatureCard icon={FileSpreadsheet} title="Working paper"        body="Multi-sheet Excel for archival, with status & reviewer note columns." />
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, body }) {
  return (
    <div className="card" style={{ padding: 18, borderRadius: 10 }}>
      <Icon size={20} color={COLORS.PRIMARY} strokeWidth={1.6} />
      <div className="serif" style={{ fontSize: 15, fontWeight: 600, marginTop: 10, marginBottom: 4, color: COLORS.TEXT }}>{title}</div>
      <div style={{ fontSize: 12, color: COLORS.TEXT_MUTED, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}
