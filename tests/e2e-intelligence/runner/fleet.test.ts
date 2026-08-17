/**
 * WP-18 · Unit pins for the site picker.
 *
 * Two journeys need "a local site that is actually running" — `verify_site_live`
 * refuses anything else by design, and the enrichment journey seeds its own twin
 * through that same call. The picker reads `nexus_list_sites`, the tool the
 * fleet's own instructions say to call first.
 *
 * The status pin is the load-bearing one: the tool renders running sites in
 * bold and halted ones plain, in ONE list. A picker that ignored the `[status]`
 * tag would hand a halted site to `verify_site_live`, and the journey would
 * fail with "Site is halted" — a red that looks like a defect in the live-check
 * path and is not.
 *
 * Fixture shape taken from `nexus-list-sites.ts`'s rendering.
 */
import { localSites, firstRunningLocalSite } from './fleet';

const FLEET = [
  '## Fleet (3 local, 2 WPE, 1 external)',
  '',
  'Local sites = development copies. WP Engine installs = live environments.',
  '↔ indicates a linked pair (same site, different environments).',
  '',
  '### Local Sites',
  '- **alpha-site** (alpha.local) [running]',
  '- **beta-site** (beta.local) [running] ↔ wpe:betaprod',
  '- gamma-site (gamma.local) [halted]',
  '',
  '### WP Engine Environments (live fleet)',
  'Use install name OR id as remote_install_id= in local_wpe_pull/local_wpe_push.',
  '- **betaprod** (Beta, production, id:abc) ↔ local:beta-site',
  '',
  '### External SSH Hosts',
  'Use ssh:<alias>/<site>@<environment> as the target for wp_* tools and search_site_content.',
  '- **hostinger/mysite** (example.com) [production] — target: ssh:hostinger/mysite@production',
].join('\n');

describe('localSites', () => {
  const sites = localSites(FLEET);

  it('reads only the Local Sites section — not WPE installs or SSH hosts', () => {
    expect(sites.map((s) => s.name)).toEqual(['alpha-site', 'beta-site', 'gamma-site']);
  });

  it('reads each site\'s status', () => {
    expect(sites.map((s) => s.status)).toEqual(['running', 'running', 'halted']);
  });

  it('strips the bold markers from a running site\'s name', () => {
    // `**alpha-site**` reaching verify_site_live as a site name resolves to
    // nothing, and the journey reds on a formatting artifact.
    expect(sites[0].name).not.toContain('*');
  });

  it('keeps a linked site\'s name clean of the ↔ suffix', () => {
    expect(sites[1].name).toBe('beta-site');
  });

  it('returns nothing when there is no Local Sites section', () => {
    expect(localSites('## Fleet (0 local, 0 WPE, 0 external)\n\nNo sites found.')).toEqual([]);
  });
});

describe('firstRunningLocalSite', () => {
  it('picks a running site', () => {
    expect(firstRunningLocalSite(FLEET)).toBe('alpha-site');
  });

  it('returns undefined rather than a halted site when none is running', () => {
    const allHalted = FLEET.replace(/\[running\]/g, '[halted]');
    expect(firstRunningLocalSite(allHalted)).toBeUndefined();
  });
});
