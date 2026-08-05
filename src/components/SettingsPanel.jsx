// ============ SETTINGS PANEL ============
// Slide-in panel accessible via the gear icon in the header.

import React, { useState } from 'react';
import { X, Eye, EyeOff, ExternalLink, Save, Trash2 } from 'lucide-react';
import { COLORS, FONTS, BTN_PRIMARY, BTN_GHOST, BTN_DANGER } from '../styles/tokens.js';
import { setApiKey as persistApiKey, clearApiKey, saveSettings } from '../lib/engagementStore.js';

export function SettingsPanel({ settings, apiKey, onSettingsChange, onApiKeyChange, onClose }) {
  const [localKey,      setLocalKey]      = useState(apiKey || '');
  const [showKey,       setShowKey]       = useState(false);
  const [localSettings, setLocalSettings] = useState({ ...settings });
  const [saved,         setSaved]         = useState(false);

  const update = (key, val) => setLocalSettings((prev) => ({ ...prev, [key]: val }));

  const handleSave = () => {
    if (localKey.trim()) {
      persistApiKey(localKey.trim());
      onApiKeyChange(localKey.trim());
    }
    saveSettings(localSettings);
    onSettingsChange(localSettings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClearKey = () => {
    if (!confirm('Remove your API key? You will need to enter it again to use the app.')) return;
    clearApiKey();
    setLocalKey('');
    onApiKeyChange('');
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
          zIndex: 99, backdropFilter: 'blur(2px)',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 400,
          background: COLORS.BG_CARD, borderLeft: `1px solid ${COLORS.BORDER}`,
          zIndex: 100, overflowY: 'auto', display: 'flex', flexDirection: 'column',
          fontFamily: FONTS.BODY,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px', borderBottom: `1px solid ${COLORS.BORDER}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: COLORS.PRIMARY, flexShrink: 0,
          }}
        >
          <div>
            <div className="serif" style={{ fontSize: 18, fontWeight: 600, color: '#faf6ee' }}>Settings</div>
            <div style={{ fontSize: 11, color: 'rgba(250,246,238,0.7)', marginTop: 2 }}>
              API key, model, and firm defaults
            </div>
          </div>
          <button onClick={onClose} aria-label="Close settings" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#faf6ee', display: 'flex' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 24, flex: 1 }}>

          {/* API Key */}
          <SectionHeader>DeepSeek API Key</SectionHeader>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>API Key</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={localKey}
                onChange={(e) => setLocalKey(e.target.value)}
                placeholder="sk-..."
                style={{ ...inputStyle, paddingRight: 36, fontFamily: FONTS.MONO }}
              />
              <button onClick={() => setShowKey(!showKey)} style={iconBtnStyle} aria-label={showKey ? 'Hide key' : 'Show key'}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer"
                 style={{ fontSize: 11, color: COLORS.PRIMARY, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                Get a key at platform.deepseek.com <ExternalLink size={10} />
              </a>
              <button onClick={handleClearKey} style={{ ...BTN_DANGER, padding: '4px 8px', fontSize: 10, gap: 4 }}>
                <Trash2 size={10} /> Clear
              </button>
            </div>
          </div>

          {/* Model — flash is the only model this app uses, no picker needed */}
          <SectionHeader>AI Model</SectionHeader>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Model</label>
            <div style={{ ...inputStyle, fontFamily: FONTS.MONO, color: COLORS.TEXT_MUTED }}>
              deepseek-v4-flash
            </div>
          </div>

          {/* Firm defaults */}
          <SectionHeader>Firm Defaults</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            <Field label="Firm name"     value={localSettings.firmName}    onChange={(v) => update('firmName', v)} />
            <Field label="Firm FRN"      value={localSettings.firmFRN}     onChange={(v) => update('firmFRN', v)} mono />
            <Field label="Partner name"  value={localSettings.partnerName} onChange={(v) => update('partnerName', v)} />
            <Field label="Membership No" value={localSettings.membershipNo} onChange={(v) => update('membershipNo', v)} mono />
            <Field label="Default place" value={localSettings.place}       onChange={(v) => update('place', v)} />
          </div>

          <p style={{ fontSize: 11, color: COLORS.TEXT_FAINT, lineHeight: 1.5, marginBottom: 20 }}>
            These values pre-fill new engagements. You can override them per-engagement in the Audit Report tab.
          </p>
        </div>

        {/* Save button */}
        <div style={{ padding: '16px 24px', borderTop: `1px solid ${COLORS.BORDER}`, flexShrink: 0, background: COLORS.BG_CREAM }}>
          <button onClick={handleSave} style={{ ...BTN_PRIMARY, width: '100%', justifyContent: 'center', padding: '11px 24px', fontSize: 13 }}>
            <Save size={14} /> {saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>
    </>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.PRIMARY, marginBottom: 10, marginTop: 4, paddingBottom: 6, borderBottom: `1px solid ${COLORS.BORDER}` }}>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, mono = false }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, fontFamily: mono ? FONTS.MONO : FONTS.BODY }}
      />
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.08em', color: COLORS.TEXT_MUTED, marginBottom: 4,
};

const inputStyle = {
  width: '100%', padding: '8px 10px',
  background: COLORS.BG_CREAM, border: `1px solid ${COLORS.BORDER_STRONG}`,
  borderRadius: 5, fontSize: 13, fontFamily: FONTS.BODY, color: COLORS.TEXT,
  boxSizing: 'border-box',
};

const iconBtnStyle = {
  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: COLORS.TEXT_MUTED, display: 'flex', alignItems: 'center',
};
