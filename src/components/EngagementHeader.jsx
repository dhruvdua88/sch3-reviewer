// ============ ENGAGEMENT HEADER ============
// Persistent top bar. Shows firm identity, model, and action buttons.

import React, { useState, useRef } from 'react';
import { Scale, Settings, RotateCcw, FileSpreadsheet, Download, Upload, ChevronDown, Loader2, Save, Clock } from 'lucide-react';
import { COLORS, FONTS, BTN_PRIMARY, BTN_GHOST } from '../styles/tokens.js';
import { listEngagements } from '../lib/engagementStore.js';
import { fmtTokens, estimateCost } from '../lib/format.js';

export function EngagementHeader({
  settings, phase, exporting, tokenUsage,
  onSettingsClick, onReset, onExportExcel, onExportEngagement, onImportEngagement, onLoadEngagement,
}) {
  const [showRecent, setShowRecent] = useState(false);
  const importRef = useRef(null);
  const recent = listEngagements();
  const isDone = phase === 'done';

  const totalTokens = {
    input_tokens:  (tokenUsage?.sch3?.input_tokens  || 0) + (tokenUsage?.caro?.input_tokens  || 0),
    output_tokens: (tokenUsage?.sch3?.output_tokens || 0) + (tokenUsage?.caro?.output_tokens || 0),
  };
  const hasUsage = totalTokens.input_tokens > 0;

  return (
    <header style={{ borderBottom: `1px solid ${COLORS.BORDER}`, background: COLORS.BG_CARD, position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 64 }}>

        {/* Left: Logo + identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 6, background: COLORS.PRIMARY, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Scale size={18} color="#faf6ee" strokeWidth={1.5} />
          </div>
          <div>
            <div className="serif" style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.1, color: COLORS.TEXT }}>
              Schedule III Reviewer
            </div>
            <div style={{ fontSize: 10, color: COLORS.TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>
              {settings.firmName} · {settings.firmFRN} · {settings.model}
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

          {/* Token usage display */}
          {hasUsage && (
            <div title={`Input: ${totalTokens.input_tokens.toLocaleString()} tokens\nOutput: ${totalTokens.output_tokens.toLocaleString()} tokens`}
              style={{ fontSize: 11, color: COLORS.TEXT_MUTED, background: COLORS.BG_CREAM, border: `1px solid ${COLORS.BORDER}`, borderRadius: 5, padding: '4px 8px', cursor: 'default' }}>
              {estimateCost(totalTokens).display}
            </div>
          )}

          {/* Done-state actions */}
          {isDone && (
            <>
              <button
                onClick={onExportExcel}
                disabled={exporting}
                aria-label="Export Excel working paper (Ctrl+E)"
                style={{ ...BTN_PRIMARY, opacity: exporting ? 0.6 : 1, cursor: exporting ? 'wait' : 'pointer' }}
              >
                {exporting
                  ? <><Loader2 size={14} className="spin" /> Building…</>
                  : <><FileSpreadsheet size={14} /> Export Excel</>
                }
              </button>

              <button
                onClick={onExportEngagement}
                disabled={exporting}
                style={{ ...BTN_GHOST, opacity: exporting ? 0.6 : 1, cursor: exporting ? 'wait' : 'pointer' }}
                title="Export engagement JSON"
              >
                <Save size={14} /> Save
              </button>
            </>
          )}

          {/* Recent engagements */}
          {recent.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowRecent(!showRecent)}
                style={{ ...BTN_GHOST, gap: 4 }}
                aria-label="Recent engagements"
              >
                <Clock size={14} />
                <ChevronDown size={12} />
              </button>
              {showRecent && (
                <>
                  <div onClick={() => setShowRecent(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 4,
                    background: COLORS.BG_CARD, border: `1px solid ${COLORS.BORDER}`,
                    borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                    zIndex: 50, minWidth: 280, padding: 8,
                    fontFamily: FONTS.BODY,
                  }}>
                    <div style={{ fontSize: 10, color: COLORS.TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 8px 8px', fontWeight: 600 }}>
                      Recent engagements
                    </div>
                    {recent.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => { onLoadEngagement(e); setShowRecent(false); }}
                        style={{
                          display: 'block', width: '100%', padding: '10px 12px',
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          textAlign: 'left', borderRadius: 6, fontFamily: FONTS.BODY,
                        }}
                        onMouseEnter={(ev) => ev.currentTarget.style.background = COLORS.BG_CREAM}
                        onMouseLeave={(ev) => ev.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.TEXT }}>{e.companyName}</div>
                        <div style={{ fontSize: 11, color: COLORS.TEXT_MUTED, marginTop: 2 }}>
                          {e.yearEnd || 'FY —'} &nbsp;·&nbsp;
                          {Object.entries(e.counts).filter(([,v]) => v > 0).map(([k,v]) => `${v} ${k.toLowerCase()}`).join(', ') || 'No issues'}
                        </div>
                      </button>
                    ))}
                    <div style={{ borderTop: `1px solid ${COLORS.BORDER}`, margin: '6px 0 4px', paddingTop: 4 }}>
                      <button
                        onClick={() => { importRef.current?.click(); setShowRecent(false); }}
                        style={{ ...BTN_GHOST, width: '100%', justifyContent: 'center', fontSize: 11 }}
                      >
                        <Upload size={12} /> Import engagement JSON
                      </button>
                      <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }}
                        onChange={(e) => { if (e.target.files[0]) onImportEngagement(e.target.files[0]); e.target.value = ''; }} />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Import engagement (always visible when no recent) */}
          {recent.length === 0 && (
            <>
              <button onClick={() => importRef.current?.click()} style={BTN_GHOST} title="Import engagement JSON">
                <Upload size={14} />
              </button>
              <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files[0]) onImportEngagement(e.target.files[0]); e.target.value = ''; }} />
            </>
          )}

          {/* New engagement */}
          {phase !== 'upload' && phase !== 'settings' && (
            <button onClick={onReset} style={BTN_GHOST} aria-label="New engagement">
              <RotateCcw size={14} /> New
            </button>
          )}

          {/* Settings gear */}
          <button onClick={onSettingsClick} style={{ ...BTN_GHOST, padding: '9px 11px' }} aria-label="Open settings">
            <Settings size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
