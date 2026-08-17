/**
 * WP-22 · the precedence reducer, the route parse, and every string the strip says.
 *
 * The reducer is the packet's one subtle behaviour ("override beats navigation until
 * cleared"), so it is pinned here rather than only through the container: a rule that
 * exists in two places drifts, and this module is the one place it exists.
 *
 * The strings are pinned for Controlled Vocabulary v1 compliance. A vocabulary gate
 * that lives only in a review is not a gate — the forbidden words are asserted absent.
 */
import {
  readViewedSiteId,
  resolveSiteContext,
  selectionSiteIds,
  stripCopy,
} from '../../../src/renderer/components/DockedPanel/siteContextModel';

describe('readViewedSiteId — Local\'s route, not a guess', () => {
  it('reads the id from the route Local actually pushes', () => {
    // App.tsx: history.push(`/main/site-info/${siteID}`) — the /main prefix is the
    // whole reason the pre-existing readSiteId() never matched anything.
    expect(readViewedSiteId('/main/site-info/abc123')).toBe('abc123');
  });

  it('keeps the site when a subroute is open', () => {
    expect(readViewedSiteId('/main/site-info/abc123/nexus')).toBe('abc123');
    expect(readViewedSiteId('/main/site-info/abc123/database')).toBe('abc123');
  });

  it('accepts the un-prefixed form too', () => {
    expect(readViewedSiteId('/site-info/abc123')).toBe('abc123');
  });

  it('reads through a hash route', () => {
    expect(readViewedSiteId('#/main/site-info/abc123/nexus')).toBe('abc123');
  });

  it('is null on every screen that is not a site page', () => {
    expect(readViewedSiteId('/main/nexus')).toBeNull();
    expect(readViewedSiteId('/main')).toBeNull();
    expect(readViewedSiteId('/main/export-site/abc123')).toBeNull();
    expect(readViewedSiteId('/main/add-site')).toBeNull();
  });

  it('is null rather than empty-stringed when the route carries no id', () => {
    expect(readViewedSiteId('/main/site-info/')).toBeNull();
    expect(readViewedSiteId('/main/site-info')).toBeNull();
  });

  it('is null for absent input', () => {
    expect(readViewedSiteId(null)).toBeNull();
    expect(readViewedSiteId(undefined)).toBeNull();
    expect(readViewedSiteId('')).toBeNull();
  });

  it('does not match a route that merely contains the segment', () => {
    // A prefix match would scope the chat to a site from a screen that is not one.
    expect(readViewedSiteId('/main/blueprints/site-info/abc123')).toBeNull();
  });
});

describe('resolveSiteContext — the precedence reducer', () => {
  it('follows navigation when nothing was chosen', () => {
    expect(resolveSiteContext('viewed-1', null)).toEqual({ mode: 'viewed', siteId: 'viewed-1' });
  });

  it('is none when no site page is open and nothing was chosen', () => {
    expect(resolveSiteContext(null, null)).toEqual({ mode: 'none', siteId: null });
  });

  it('an explicit choice beats what is on screen', () => {
    expect(resolveSiteContext('viewed-1', 'chosen-2')).toEqual({ mode: 'override', siteId: 'chosen-2' });
  });

  it('the choice SURVIVES navigating to another site — the packet\'s subtle rule', () => {
    const before = resolveSiteContext('viewed-1', 'chosen-2');
    const afterNavigating = resolveSiteContext('viewed-9', 'chosen-2');
    expect(afterNavigating).toEqual(before);
    expect(afterNavigating.siteId).toBe('chosen-2');
  });

  it('the choice survives navigating AWAY from every site page', () => {
    expect(resolveSiteContext(null, 'chosen-2')).toEqual({ mode: 'override', siteId: 'chosen-2' });
  });

  it('clearing the choice hands scope back to navigation, not to nothing', () => {
    expect(resolveSiteContext('viewed-1', null)).toEqual({ mode: 'viewed', siteId: 'viewed-1' });
  });

  it('a choice that happens to equal the viewed site is still a choice', () => {
    // It must not silently decay to 'viewed': the user pinned it, and navigating away
    // has to keep it. Collapsing the two modes is how the pin would be lost.
    expect(resolveSiteContext('same', 'same')).toEqual({ mode: 'override', siteId: 'same' });
  });
});

describe('selectionSiteIds — what rides on CHAT_SEND', () => {
  it('carries exactly one site when a site page is open', () => {
    expect(selectionSiteIds(resolveSiteContext('viewed-1', null))).toEqual(['viewed-1']);
  });

  it('carries the chosen site, not the viewed one', () => {
    expect(selectionSiteIds(resolveSiteContext('viewed-1', 'chosen-2'))).toEqual(['chosen-2']);
  });

  it('is EMPTY when there is no site — never a placeholder id', () => {
    expect(selectionSiteIds(resolveSiteContext(null, null))).toEqual([]);
  });
});

describe('stripCopy — Controlled Vocabulary v1 governs every string', () => {
  it('the viewed state names the site and frames it as your copy', () => {
    const copy = stripCopy({ mode: 'viewed', siteName: 'cedarvale', viewedSiteName: 'cedarvale' });
    expect(copy.primary).toBe('Currently in: cedarvale — your copy');
    expect(copy.actionLabel).toBe('Change');
    expect(copy.secondary).toBeUndefined();
  });

  it('the none state says the answers will be fleet-wide', () => {
    const copy = stripCopy({ mode: 'none', siteName: null, viewedSiteName: null });
    expect(copy.primary).toBe('No site selected — answers will be fleet-wide');
    expect(copy.actionLabel).toBe('Choose a site');
    expect(copy.secondary).toBeUndefined();
  });

  it('the override state names the chosen site and offers to clear it', () => {
    const copy = stripCopy({ mode: 'override', siteName: 'alpine-outfitters', viewedSiteName: null });
    expect(copy.primary).toBe('Currently in: alpine-outfitters — your copy');
    expect(copy.actionLabel).toBe('Clear');
    expect(copy.secondary).toBe('You chose this site — it stays until you clear it.');
  });

  it('the override state DISCLOSES the site on screen when it differs', () => {
    // This is the visible half of "scope moved": the strip has to say that the chat is
    // not answering about the page the user is looking at.
    const copy = stripCopy({ mode: 'override', siteName: 'alpine-outfitters', viewedSiteName: 'cedarvale' });
    expect(copy.secondary).toBe("You're viewing cedarvale — it stays on alpine-outfitters until you clear it.");
  });

  it('does not claim a different screen when the chosen site IS the one on screen', () => {
    const copy = stripCopy({ mode: 'override', siteName: 'cedarvale', viewedSiteName: 'cedarvale' });
    expect(copy.secondary).toBe('You chose this site — it stays until you clear it.');
  });

  it('never says a forbidden word', () => {
    const all = [
      stripCopy({ mode: 'viewed', siteName: 'cedarvale', viewedSiteName: 'cedarvale' }),
      stripCopy({ mode: 'none', siteName: null, viewedSiteName: null }),
      stripCopy({ mode: 'override', siteName: 'alpine', viewedSiteName: 'cedarvale' }),
      stripCopy({ mode: 'override', siteName: 'alpine', viewedSiteName: null }),
    ]
      .flatMap((c) => [c.primary, c.secondary ?? '', c.actionLabel])
      .join(' ')
      .toLowerCase();

    // Vocabulary v1, "Never say" column — the words this surface is most likely to reach for.
    for (const forbidden of ['working copy', 'sandbox', 'clone', 'environment', 'production', 'staging']) {
      expect(all).not.toContain(forbidden);
    }
  });

  it('says "your copy" wherever a site is named', () => {
    expect(stripCopy({ mode: 'viewed', siteName: 'x', viewedSiteName: 'x' }).primary).toContain('your copy');
    expect(stripCopy({ mode: 'override', siteName: 'x', viewedSiteName: null }).primary).toContain('your copy');
  });
});
