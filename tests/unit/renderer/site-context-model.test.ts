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
  contentAgeChip,
  asContentStatus,
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

/**
 * WP-22b · the content-age chip.
 *
 * The chip renders one state out of five (four the read can report, plus "nothing came
 * back"), and the four it stays silent for are the point: `no-sync`, `ambiguous` and
 * `unlinked` are three different absences with three different remedies, and `null` is
 * a fact about Nexus AI rather than about the copy. A chip reading "content age
 * unknown" would collapse all four into one shrug, in the space where the answer goes.
 */
describe('contentAgeChip — pulled, or nothing', () => {
  const pulled = (behindSeconds: number, sourceName = 'the live site') => ({
    state: 'pulled' as const,
    sourceName,
    behindSeconds,
  });

  it('renders the vocabulary\'s phrase: pulled from <source> <time> ago', () => {
    expect(contentAgeChip(pulled(11 * 86_400))).toBe('Pulled from the live site 11 days ago');
  });

  it('measures content in TIME, never in items (docs finding №3)', () => {
    const chip = contentAgeChip(pulled(11 * 86_400))!;
    expect(chip).toMatch(/\d+ (day|hour)s? ago$/);
    for (const itemWord of ['item', 'plugin', 'post', 'change', 'commit']) {
      expect(chip.toLowerCase()).not.toContain(itemWord);
    }
  });

  it('keeps the source\'s disambiguating name intact', () => {
    // Finding №6: users call their own copy "dev" too, so WP Engine's development
    // environment is never named bare — and the chip must not re-shorten it.
    expect(contentAgeChip(pulled(3 * 86_400, 'development (at WP Engine)'))).toBe(
      'Pulled from development (at WP Engine) 3 days ago',
    );
  });

  it('is ABSENT for each of the three absences, not "unknown"', () => {
    expect(contentAgeChip({ state: 'no-sync', sourceName: 'the live site' })).toBeNull();
    expect(contentAgeChip({ state: 'ambiguous' })).toBeNull();
    expect(contentAgeChip({ state: 'unlinked' })).toBeNull();
  });

  it('is gated on the STATE, not on the fields that happen to accompany it', () => {
    // The producer never puts an age on a `no-sync` status, so the field guards below
    // hide the state check — which is exactly how a state check gets deleted as dead
    // code. `no-sync` means no sync is on record; a chip saying "pulled from the live
    // site" over that would be the one thing this surface must never do, and the
    // shape is reachable from any payload the boundary guard lets through.
    expect(
      contentAgeChip({ state: 'no-sync', sourceName: 'the live site', behindSeconds: 86_400 }),
    ).toBeNull();
    expect(
      contentAgeChip({ state: 'ambiguous', sourceName: 'the live site', behindSeconds: 86_400 }),
    ).toBeNull();
    expect(
      contentAgeChip({ state: 'unlinked', sourceName: 'the live site', behindSeconds: 86_400 }),
    ).toBeNull();
  });

  it('is absent when nothing is recording, or nothing has answered yet', () => {
    expect(contentAgeChip(null)).toBeNull();
    expect(contentAgeChip(undefined)).toBeNull();
  });

  it('renders no half-sentence: an age with no source, or a source with no age', () => {
    expect(contentAgeChip({ state: 'pulled', behindSeconds: 86_400 })).toBeNull();
    expect(contentAgeChip({ state: 'pulled', sourceName: 'the live site' })).toBeNull();
    expect(
      contentAgeChip({ state: 'pulled', sourceName: 'the live site', behindSeconds: NaN }),
    ).toBeNull();
  });

  it('reads in plain English at every scale, singular included', () => {
    expect(contentAgeChip(pulled(0))).toBe('Pulled from the live site less than an hour ago');
    expect(contentAgeChip(pulled(3600))).toBe('Pulled from the live site 1 hour ago');
    expect(contentAgeChip(pulled(7200))).toBe('Pulled from the live site 2 hours ago');
    expect(contentAgeChip(pulled(86_400))).toBe('Pulled from the live site 1 day ago');
  });

  it('never says a forbidden word', () => {
    const text = contentAgeChip(pulled(11 * 86_400))!.toLowerCase();
    for (const forbidden of ['lineage', 'upstream', 'snapshot', 'divergen', 'drift', 'stale', 'twin', 'ledger']) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('stripCopy — the chip rides with the band it belongs to', () => {
  const pulled = { state: 'pulled' as const, sourceName: 'the live site', behindSeconds: 11 * 86_400 };

  it('carries the chip in the viewed state', () => {
    const copy = stripCopy({ mode: 'viewed', siteName: 'cedarvale', viewedSiteName: 'cedarvale', content: pulled });
    expect(copy.chip).toBe('Pulled from the live site 11 days ago');
    expect(copy.primary).toBe('Currently in: cedarvale — your copy');
  });

  it('carries the chip in the override state, WITHOUT dropping the disclosure', () => {
    const copy = stripCopy({ mode: 'override', siteName: 'alpine', viewedSiteName: 'cedarvale', content: pulled });
    expect(copy.chip).toBe('Pulled from the live site 11 days ago');
    expect(copy.secondary).toContain("You're viewing cedarvale");
  });

  it('has no chip in the none state — no site, no copy, nothing to be about', () => {
    expect(stripCopy({ mode: 'none', siteName: null, viewedSiteName: null, content: pulled }).chip).toBeUndefined();
  });

  it('is the band WP-22 shipped when no content status is supplied at all', () => {
    const before = stripCopy({ mode: 'viewed', siteName: 'cedarvale', viewedSiteName: 'cedarvale' });
    expect(before.chip).toBeUndefined();
    expect(before).toEqual({ primary: 'Currently in: cedarvale — your copy', actionLabel: 'Change' });
  });
});

describe('asContentStatus — the boundary guard', () => {
  it('passes a well-formed status through', () => {
    expect(asContentStatus({ state: 'pulled', sourceName: 'the live site', behindSeconds: 60 })).toEqual({
      state: 'pulled',
      sourceName: 'the live site',
      behindSeconds: 60,
    });
  });

  it('keeps the three absences distinct rather than flattening them', () => {
    expect(asContentStatus({ state: 'no-sync' })!.state).toBe('no-sync');
    expect(asContentStatus({ state: 'ambiguous' })!.state).toBe('ambiguous');
    expect(asContentStatus({ state: 'unlinked' })!.state).toBe('unlinked');
  });

  it('refuses anything it was not designed for', () => {
    expect(asContentStatus(null)).toBeNull();
    expect(asContentStatus(undefined)).toBeNull();
    expect(asContentStatus('pulled')).toBeNull();
    expect(asContentStatus({ state: 'made-up' })).toBeNull();
    expect(asContentStatus({})).toBeNull();
  });

  it('drops fields of the wrong shape instead of carrying them', () => {
    const status = asContentStatus({ state: 'pulled', sourceName: 42, behindSeconds: 'ages' })!;
    expect(status).toEqual({ state: 'pulled' });
  });
});
