/**
 * WP-54 · ITEM 8 — ACTIONS RENDER AS THE DESIGN SYSTEM'S BUTTON.
 *
 * The owner, on the live Now screen: *"Approve / Not now are hand-styled, not
 * `local-components`' Button. Nothing hand-drawn"* — the same rule the designer
 * applied to the brand mark, applied to controls.
 *
 * WHY THIS IS A GUARDED `require` AND NOT AN `import`. `@getflywheel/
 * local-components` is an OPTIONAL PEER DEPENDENCY (`package.json`): Local
 * supplies it at runtime and it is not installed in this repo's `node_modules`,
 * so a static import would fail the build and every test. `NexusOverview.tsx`
 * already reaches for `toast` exactly this way, and this module is that pattern
 * given a name so a component does not have to carry the try/catch.
 *
 * THE FALLBACK IS A PLAIN `button`, NOT A HAND-STYLED ONE. Where the design
 * system is absent — under jest, and in any host that does not provide it — the
 * control renders as the platform's own button with no inline styling at all. A
 * fallback that reproduced the system's look would be the hand-drawn control
 * this rule exists to remove, drawn one layer further down where nobody would
 * look for it.
 *
 * `hasDesignSystem` is exported so a pin can tell the two paths apart rather
 * than passing vacuously against whichever one the test environment happens to
 * take (vacuous-guard shape: a test that cannot distinguish its subject).
 */
import React from 'react';

let resolved: React.ElementType | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const localComponents = require('@getflywheel/local-components');
  const candidate = localComponents?.Button;
  if (typeof candidate === 'function' || typeof candidate === 'object') {
    resolved = candidate as React.ElementType;
  }
} catch {
  /* Local is not the host here; the platform's own button is the honest fallback */
}

/** True when the real design-system Button is what `Button` resolves to. */
export const hasDesignSystem = resolved !== null;

/**
 * The design system's Button, or a plain `button` element type.
 *
 * Used as an element TYPE (`React.createElement(Button, props, …)`), so both
 * paths take the same props: `onClick`, `disabled`, children.
 */
export const Button: React.ElementType = resolved ?? 'button';
