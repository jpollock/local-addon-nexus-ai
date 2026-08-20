/**
 * WP-47 · the theme micro — measured, then aligned.
 *
 * MEASUREMENT FIRST (2026-08-20, this tree, `grep -rn` over `src/`):
 *   - four `new MutationObserver` sites exist and NONE of them is a theme observer
 *     (nav re-injection, the unwired sidebar badge manager, the search-button
 *     re-injection, and the docked panel's `data-location` watch);
 *   - `osThemeChange` was ALREADY subscribed and unsubscribed (`index.tsx`), so the
 *     recon's "two better handles you're probably not using" is half stale against
 *     this code — we had the event, we did not have `currentThemeName`;
 *   - zero `matchMedia` / `prefers-color-scheme` / `nativeTheme` / `shouldUseDarkColors`
 *     anywhere in `src/`.
 *
 * So there was no MutationObserver theme sniffing to delete. What is aligned here is the
 * remaining half: the resolved theme now comes from `localPreferences.currentThemeName`
 * (recon §4, themecop-init.tsx:13-17) when the host publishes it, and falls back to the
 * `Theme__Dark` class on <html> — which recon §4 confirms is the intended mechanism and
 * §7 rates as effectively public — when it does not.
 */
import { resolveHostTheme } from '../../../src/renderer/utils/theme';

function docWithClass(...classes: string[]): Document {
  const el = { classList: { contains: (c: string) => classes.includes(c) } };
  return { documentElement: el } as unknown as Document;
}

describe('resolveHostTheme — the host preference is the first source', () => {
  it('reads dark from localPreferences.currentThemeName', () => {
    const scope = { localPreferences: { currentThemeName: 'theme--dark' } };
    expect(resolveHostTheme(scope, docWithClass())).toBe('dark');
  });

  it('reads light from localPreferences.currentThemeName', () => {
    const scope = { localPreferences: { currentThemeName: 'theme--light' } };
    expect(resolveHostTheme(scope, docWithClass('Theme__Dark'))).toBe('light');
  });

  it('prefers the host preference over the class when the two disagree', () => {
    // The class is applied by themecop-init from the same value, so a disagreement means
    // the DOM is mid-update. The published value is the one Local considers current.
    const scope = { localPreferences: { currentThemeName: 'theme--dark' } };
    expect(resolveHostTheme(scope, docWithClass('Theme__Light'))).toBe('dark');
  });
});

describe('resolveHostTheme — the class read is the fallback, not the source', () => {
  it('falls back to Theme__Dark on <html> when the host publishes no preference', () => {
    expect(resolveHostTheme({}, docWithClass('Theme__Dark'))).toBe('dark');
    expect(resolveHostTheme({}, docWithClass('Theme__Light'))).toBe('light');
  });

  it('falls back when currentThemeName is an unrecognised string', () => {
    // 'auto' never reaches the renderer — ThemeCop resolves it first (recon §4) — but a
    // value we do not recognise must not be guessed at.
    const scope = { localPreferences: { currentThemeName: 'auto' } };
    expect(resolveHostTheme(scope, docWithClass('Theme__Dark'))).toBe('dark');
    expect(resolveHostTheme(scope, docWithClass())).toBe('light');
  });

  it('falls back when localPreferences is present but empty, or not an object', () => {
    expect(resolveHostTheme({ localPreferences: {} }, docWithClass('Theme__Dark'))).toBe('dark');
    expect(resolveHostTheme({ localPreferences: 'nope' }, docWithClass('Theme__Dark'))).toBe('dark');
    expect(resolveHostTheme({ localPreferences: null }, docWithClass('Theme__Dark'))).toBe('dark');
  });
});

describe('resolveHostTheme — light is the answer only when nothing says otherwise', () => {
  it('returns light when neither source is readable', () => {
    expect(resolveHostTheme(undefined, undefined)).toBe('light');
    expect(resolveHostTheme(null, docWithClass())).toBe('light');
  });

  it('never throws on a hostile scope or document', () => {
    const hostileScope = {
      get localPreferences(): unknown {
        throw new Error('boom');
      },
    };
    const hostileDoc = {
      get documentElement(): unknown {
        throw new Error('boom');
      },
    } as unknown as Document;
    expect(resolveHostTheme(hostileScope, hostileDoc)).toBe('light');
  });
});
