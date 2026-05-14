import { UI_COLORS } from '../../common/constants';

const STYLE_ID = 'nexus-ai-theme-vars';

/**
 * Injects Nexus AI CSS custom properties into the document head.
 * Must be called from the root component (SiteNexusSection) on mount.
 * Idempotent — safe to call multiple times.
 */
export function injectThemeVars(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    :root {
      --nxai-card-bg: #ffffff;
      --nxai-card-border: #e5e7eb;
      --nxai-card-label: #6b7280;
      --nxai-card-sub: #6b7280;
      --nxai-card-text: #111827;
      --nxai-section-label: #374151;
      --nxai-section-bg: #f9fafb;
      --nxai-code-bg: #f3f4f6;
      --nxai-table-hover: #f9fafb;
      --nxai-input-bg: #ffffff;
      --nxai-input-border: #d1d5db;
      --nxai-score-bg: #e5e7eb;
      --nxai-score-fill: ${UI_COLORS.WPE_BRAND};
      --nxai-warn-text: #d97706;
      --nxai-status-neutral: #9ca3af;
      --nxai-danger-text: #ef4444;
      --nxai-chat-user-bg: #e0f2fe;
      --nxai-chat-assistant-bg: #fef3c7;
      --nxai-filter-bg: #f0fdf4;
      --nxai-error-bg: #fef2f2;
    }
    .Theme__Dark {
      --nxai-card-bg: #2a2a2a;
      --nxai-card-border: #404040;
      --nxai-card-label: #9ca3af;
      --nxai-card-sub: #9ca3af;
      --nxai-card-text: #f3f4f6;
      --nxai-section-label: #d1d5db;
      --nxai-section-bg: #222222;
      --nxai-code-bg: #1f1f1f;
      --nxai-table-hover: #333333;
      --nxai-input-bg: #2a2a2a;
      --nxai-input-border: #555555;
      --nxai-score-bg: #404040;
      --nxai-score-fill: ${UI_COLORS.WPE_BRAND};
      --nxai-warn-text: #fbbf24;
      --nxai-status-neutral: #6b7280;
      --nxai-danger-text: #f87171;
      --nxai-chat-user-bg: #0c4a6e;
      --nxai-chat-assistant-bg: #78350f;
      --nxai-filter-bg: #052e16;
      --nxai-error-bg: #450a0a;
    }
  `;
  document.head.appendChild(style);
}
