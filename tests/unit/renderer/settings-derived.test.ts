/**
 * The handoff says these figures broke four times during the prototype's own
 * build, so they get the heaviest tests in the spec. The membership rules are
 * the part a future reader will "simplify" back into one set — MEMBERSHIP.md
 * exists because group and cost are different predicates.
 */
import { computeDerived, JOBS } from '../../../src/renderer/components/settings/derived';

const base = (over: any = {}) => {
  const { settings: settingsOver, ...rest } = over;
  return {
    settings: {
      wpeRefreshAutoEnabled: true,  wpeRefreshIntervalHours: 4,
      wpeSyncAutoEnabled: true,     wpeSyncIntervalHours: 4,
      wpeContentIndexAutoEnabled: true, wpeContentIndexIntervalHours: 12,
      externalRefreshAutoEnabled: true, externalRefreshIntervalHours: 12,
      externalContentIndexAutoEnabled: true, externalContentIndexIntervalHours: 12,
      localContentIndexAutoEnabled: true, localContentIndexIntervalHours: 4,
      haltedSiteRefreshIntervalHours: 24,
      backgroundWorkPaused: false,
      ...(settingsOver ?? {}),
    },
    installCount: 331,
    externalHostCount: 13,
    localSiteCount: 37,
    durations: {} as Record<string, number | null>,
    ...rest,
  };
};

describe('derived — the job table', () => {
  test('there are seven jobs, and none is the cut event hook', () => {
    expect(JOBS).toHaveLength(7);
    expect(JOBS.map(j => j.name)).not.toContain('Notice when a local site stops');
  });

  test('a wpe job at 4h with 331 installs reads passes and connections', () => {
    const d = computeDerived(base());
    const row = d.rows.find(r => r.key === 'wpeRefresh')!;
    expect(row.costLabel).toBe('6 passes a day · 1,986 connections');
  });

  test('an off job reads "nothing while off", never 0', () => {
    const d = computeDerived(base({ settings: { wpeRefreshAutoEnabled: false } }));
    const row = d.rows.find(r => r.key === 'wpeRefresh')!;
    expect(row.costLabel).toBe('nothing while off');
    expect(row.costLabel).not.toContain('0');
  });
});

describe('derived — membership is three different subsets', () => {
  test('the WP Engine index sits in the wpe group but contributes nothing', () => {
    const row = JOBS.find(j => j.key === 'wpeContentIndex')!;
    expect(row.group).toBe('wpe');
    expect(row.conn).toBeNull();
    const d = computeDerived(base());
    expect(d.rows.find(r => r.key === 'wpeContentIndex')!.costLabel)
      .toBe('2 passes a day · no extra connections');
  });

  test('externalRefresh feeds the other-hosts figure, not the WP Engine one', () => {
    const d = computeDerived(base());
    // 331 installs × 6 passes (wpeRefresh) + 331 × 6 (wpeSync) = 3,972
    expect(d.summary.wpe!.figure).toBe(3972);
    // 13 hosts × 2 passes × 2 external jobs = 52
    expect(d.summary.ext!.figure).toBe(52);
  });

  test('the two figures are never summed into one', () => {
    const d = computeDerived(base());
    expect(d.summary.wpe!.unit).toBe('connections a day');
    expect(d.summary.ext!.unit).toBe('SSH sessions a day');
    expect(JSON.stringify(d.summary)).not.toContain('4024'); // 3972 + 52
  });

  test('the switchable denominator is 6 with an external host', () => {
    const d = computeDerived(base());
    expect(d.switchableTotal).toBe(6);
    expect(d.navNote).toBe('6 of 6 on');
  });

  test('the denominator is 4 with no external host, and the ext group vanishes', () => {
    const d = computeDerived(base({ externalHostCount: 0 }));
    expect(d.switchableTotal).toBe(4);
    expect(d.summary.ext).toBeNull();
    expect(d.rows.map(r => r.key)).not.toContain('externalRefresh');
  });

  test('haltedSiteRefresh is always on and never in the denominator', () => {
    const d = computeDerived(base());
    const row = d.rows.find(r => r.key === 'haltedSiteRefresh')!;
    expect(row.alwaysOn).toBe(true);
    expect(row.enabled).toBe(true);
    expect(row.costLabel).toBe('free');
    // 6 switchable, and it is not one of them
    expect(d.switchableTotal).toBe(6);
  });

  test('haltedSiteRefresh keeps an adjustable interval', () => {
    // Its on/off is absent; its interval is a live control today
    // (SettingsTab.tsx:407). "not adjustable" would remove a shipping control.
    const row = JOBS.find(j => j.key === 'haltedSiteRefresh')!;
    expect(row.enableKey).toBeNull();
    expect(row.intervalKey).toBe('haltedSiteRefreshIntervalHours');
  });
});

describe('derived — thresholds come from the destination', () => {
  test('a wpe job ambers at 2h, not at 4h', () => {
    expect(computeDerived(base({ settings: { wpeRefreshIntervalHours: 4 } }))
      .rows.find(r => r.key === 'wpeRefresh')!.amber).toBe(false);
    expect(computeDerived(base({ settings: { wpeRefreshIntervalHours: 2 } }))
      .rows.find(r => r.key === 'wpeRefresh')!.amber).toBe(true);
  });

  test('an ext job ambers below 6h, where the same interval is fine for wpe', () => {
    const d = computeDerived(base({ settings: {
      externalRefreshIntervalHours: 4, wpeRefreshIntervalHours: 4,
    }}));
    expect(d.rows.find(r => r.key === 'externalRefresh')!.amber).toBe(true);
    expect(d.rows.find(r => r.key === 'wpeRefresh')!.amber).toBe(false);
  });
});

describe('derived — absent data omits its clause', () => {
  test('with no recorded runs there is no duration and no minutes clause', () => {
    const d = computeDerived(base());
    expect(d.rows.every(r => r.durationMin === null)).toBe(true);
    expect(d.summary.time.minsPerDay).toBeNull();
  });

  test('a recorded run produces both', () => {
    const d = computeDerived(base({ durations: { wpeRefresh: 660_000 } }));
    expect(d.rows.find(r => r.key === 'wpeRefresh')!.durationMin).toBe(11);
    expect(d.summary.time.minsPerDay).toBe(66); // 6 passes × 11 min
  });
});

describe('derived — the zero-interval trap', () => {
  test('localContentIndexIntervalHours 0 is off, not Infinity', () => {
    // This interval alone is min(0); every other is min(1). round(24/0) is
    // Infinity and would render "Infinity passes a day".
    const d = computeDerived(base({ settings: { localContentIndexIntervalHours: 0 } }));
    const row = d.rows.find(r => r.key === 'localContentIndex')!;
    expect(row.costLabel).toBe('nothing while off');
    expect(JSON.stringify(d)).not.toContain('Infinity');
  });
});

describe('derived — the master pause', () => {
  test('pausing zeroes the schedule without changing any per-job flag', () => {
    const input = base({ settings: { backgroundWorkPaused: true } });
    const d = computeDerived(input);
    expect(d.paused).toBe(true);
    expect(d.summary.time.nextInHours).toBeNull();
    // The flags the user set are untouched — this is the whole point.
    expect(input.settings.wpeRefreshAutoEnabled).toBe(true);
    expect(d.rows.find(r => r.key === 'wpeRefresh')!.enabled).toBe(true);
  });
});
