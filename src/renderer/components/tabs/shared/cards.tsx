import * as React from 'react';

export const cardContainerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '16px',
  marginBottom: '24px',
};

export const cardStyle: React.CSSProperties = {
  borderRadius: '10px',
  padding: '20px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
};

export const cardTitleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  color: 'var(--nxai-card-label, #6b7280)',
  marginBottom: '12px',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--nxai-section-label, #374151)',
  marginBottom: '12px',
  marginTop: '8px',
};

export function renderSectionLabel(text: string): React.ReactNode {
  return React.createElement('div', { style: sectionLabelStyle }, text);
}

export const bigNumberStyle: React.CSSProperties = {
  fontSize: '36px',
  fontWeight: 700,
  lineHeight: 1,
  marginBottom: '8px',
};

export const subStatStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--nxai-card-sub, #6b7280)',
  lineHeight: 1.6,
};

export const dotStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  backgroundColor: color,
  marginRight: '6px',
});

export const btnStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  color: 'var(--nxai-card-text, #111827)',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
};

export const codeBlockStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '12px',
  backgroundColor: 'var(--nxai-code-bg, #f3f4f6)',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  borderRadius: '8px',
  padding: '14px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  lineHeight: 1.5,
  color: 'var(--nxai-card-text, #111827)',
};
