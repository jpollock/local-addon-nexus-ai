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
      --nxai-error-border: #fecaca;
      --nxai-error-text: #991b1b;
      /* Reset-row styling — amber and red levels from COPY.md.
         Amber follows the same light → dark darkening pattern as warn/error:
         --nxai-warn-text (#d97706 → #fbbf24) establishes the amber-text precedent,
         and the amber backgrounds follow --nxai-error-bg's (#fef2f2 → #450a0a) darkening ratio. */
      --nxai-amber-bg: #fffbeb;
      --nxai-amber-border: #fde68a;
      --nxai-amber-row-bg: #fffdf7;
      --nxai-amber-button-bg: #fffbeb;
      --nxai-amber-text: #b45309;
      --nxai-red-border: #fecaca;
      --nxai-red-row-bg: #fff5f5;
      --nxai-keeps-text: #4b5563;
      /* Primary action fill. Deliberately NOT UI_COLORS.WPE_BRAND (#0ECAD4):
         measured, the brand cyan is 2.02:1 against white and fails WCAG AA at
         any text size. #0a8189 is 4.65:1 against white, so white-on-accent
         passes AA in both themes — which is why the value is identical below.
         Use it as a FILL behind --nxai-accent-text, not as a text colour: as
         text on the dark card (#2a2a2a) it is 3.09:1 and fails AA for body copy. */
      --nxai-accent: #0a8189;
      --nxai-accent-text: #ffffff;
      /* Rail-specific tokens from PANEL-IMPLEMENTATION.md §3:
         - Teal tint (#ecfcfd) for the rail mark background
         - Amber pair (#fffbeb / #b45309) for the stuck marker
         - White (#fff) for badge border shadow
         All are spec-defined literals with no existing token. */
      --nxai-rail-mark-bg: #ecfcfd;
      --nxai-rail-stuck-bg: #fffbeb;
      --nxai-rail-stuck-text: #b45309;
      --nxai-rail-badge-shadow: #fff;
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
      --nxai-error-border: #991b1b;
      --nxai-error-text: #fca5a5;
      /* Reset-row styling — dark theme. Derived from the light → dark pattern:
         --nxai-error-bg goes #fef2f2 → #450a0a (very dark red).
         Amber follows the same darkening ratio, and amber-text follows
         --nxai-warn-text (#d97706 → #fbbf24). */
      --nxai-amber-bg: #78350f;
      --nxai-amber-border: #92400e;
      --nxai-amber-row-bg: #451a03;
      --nxai-amber-button-bg: #78350f;
      --nxai-amber-text: #fbbf24;
      --nxai-red-border: #991b1b;
      --nxai-red-row-bg: #450a0a;
      --nxai-keeps-text: #9ca3af;
      /* Same value as light: the pair is judged on accent-vs-accent-text
         (4.65:1), which does not change with the surrounding theme. */
      --nxai-accent: #0a8189;
      --nxai-accent-text: #ffffff;
      /* Rail tokens in dark theme — same values as light.
         The teal tint and amber pair are visually identical in both themes
         per the spec's non-theme-variant treatment of the rail. */
      --nxai-rail-mark-bg: #ecfcfd;
      --nxai-rail-stuck-bg: #fffbeb;
      --nxai-rail-stuck-text: #b45309;
      --nxai-rail-badge-shadow: var(--nxai-card-bg);
    }
  `;
  document.head.appendChild(style);
}
