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
    lastRunAt: {} as Record<string, number | null>,
    now: Date.now(),
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
    // 331 installs × 6 passes (wpeRefresh) + 331 × 6 (wpeSync at 4h from fixture) = 3,972
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
    expect(row.userEnabled).toBe(true);
    expect(row.canRun).toBe(true);
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
    expect(d.rows.find(r => r.key === 'wpeRefresh')!.userEnabled).toBe(true);
  });
});

// NEW TESTS for the 8 fixes

describe('derived — FIX 1: correct defaultHours', () => {
  test('wpeSync defaults to 8h, not 24h', () => {
    const d = computeDerived(base({ settings: { wpeSyncIntervalHours: undefined } }));
    const row = d.rows.find(r => r.key === 'wpeSync')!;
    expect(row.hours).toBe(8);
    expect(JOBS.find(j => j.key === 'wpeSync')!.defaultHours).toBe(8);
  });

  test('localContentIndex defaults to 8h, not 4h', () => {
    const d = computeDerived(base({ settings: { localContentIndexIntervalHours: undefined } }));
    const row = d.rows.find(r => r.key === 'localContentIndex')!;
    expect(row.hours).toBe(8);
    expect(JOBS.find(j => j.key === 'localContentIndex')!.defaultHours).toBe(8);
  });
});

describe('derived — FIX 2: amber keys on conn, not group', () => {
  test('wpeContentIndex never ambers (conn=null, group=wpe)', () => {
    // At ≤2h, a wpe-group job with conn=wpe would amber. wpeContentIndex has conn=null.
    const d = computeDerived(base({ settings: { wpeContentIndexIntervalHours: 2 } }));
    const row = d.rows.find(r => r.key === 'wpeContentIndex')!;
    expect(row.amber).toBe(false);
  });
});

describe('derived — FIX 3: singular "1 pass a day"', () => {
  test('24h interval renders "1 pass a day", not "1 passes"', () => {
    const d = computeDerived(base({ settings: { wpeRefreshIntervalHours: 24 } }));
    const row = d.rows.find(r => r.key === 'wpeRefresh')!;
    expect(row.costLabel).toContain('1 pass a day');
    expect(row.costLabel).not.toContain('1 passes');
  });
});

describe('derived — FIX 4: expose per-group job counts', () => {
  test('summary.wpe includes jobsOn and jobsTotal', () => {
    const d = computeDerived(base());
    expect(d.summary.wpe!.jobsOn).toBe(3);
    expect(d.summary.wpe!.jobsTotal).toBe(3);
  });

  test('summary.ext includes jobsOn and jobsTotal', () => {
    const d = computeDerived(base());
    expect(d.summary.ext!.jobsOn).toBe(2);
    expect(d.summary.ext!.jobsTotal).toBe(2);
  });
});

describe('derived — FIX 5: nextInHours is a countdown from lastRunAt', () => {
  test('with no runs, nextInHours is null', () => {
    const d = computeDerived(base({ lastRunAt: {} }));
    expect(d.summary.time.nextInHours).toBeNull();
  });

  test('with one run 2h ago on a 4h job, nextInHours is 2h', () => {
    const now = Date.now();
    const twoHoursAgo = now - 2 * 3600_000;
    const d = computeDerived(base({
      settings: { wpeRefreshIntervalHours: 4 },
      lastRunAt: { wpeRefresh: twoHoursAgo },
      now,
    }));
    expect(d.summary.time.nextInHours).toBeCloseTo(2, 1);
  });
});

describe('derived — FIX 6: userEnabled vs canRun separation', () => {
  test('userEnabled=true + interval=0 gives userEnabled=true, canRun=false', () => {
    const d = computeDerived(base({ settings: {
      localContentIndexAutoEnabled: true,
      localContentIndexIntervalHours: 0,
    }}));
    const row = d.rows.find(r => r.key === 'localContentIndex')!;
    expect(row.userEnabled).toBe(true);
    expect(row.canRun).toBe(false);
  });
});

describe('derived — FIX 7: pause applied uniformly', () => {
  test('paused snapshot is internally consistent', () => {
    const d = computeDerived(base({ settings: { backgroundWorkPaused: true } }));

    // Figures are zero
    expect(d.summary.wpe!.figure).toBe(0);
    expect(d.summary.ext!.figure).toBe(0);
    expect(d.summary.time.minsPerDay).toBeNull();
    expect(d.summary.time.nextInHours).toBeNull();

    // Every row with userEnabled=true reads "nothing while off · paused"
    const enabledRows = d.rows.filter(r => r.userEnabled);
    enabledRows.forEach(row => {
      if (row.key !== 'haltedSiteRefresh') {
        expect(row.costLabel).toBe('nothing while off · paused');
      }
    });

    // canRun is false for all paused rows
    expect(d.rows.filter(r => r.canRun).length).toBe(0);

    // navNote reflects userEnabled, not canRun
    expect(d.navNote).toBe('6 of 6 on');
  });
});

describe('derived — FIX 8: summary.wpe collapses to null with installCount=0', () => {
  test('with installCount=0, summary.wpe is null — but the wpe ROWS stay', () => {
    // The figure collapses ("0 connections a day across 0 installs" is noise).
    // The rows must not: MEMBERSHIP.md:30 conditions rows 4 and 5 only, on
    // external hosts. Hiding the wpe rows here stranded six settings —
    // `wpeSyncAutoEnabled` among them, which is what makes the count non-zero.
    const d = computeDerived(base({ installCount: 0 }));
    expect(d.summary.wpe).toBeNull();
    expect(d.rows.filter(r => r.group === 'wpe').map(r => r.key))
      .toEqual(['wpeRefresh', 'wpeSync', 'wpeContentIndex']);
  });

  test('with installCount=0 the nav-note denominator is still 6, not 3', () => {
    // MEMBERSHIP.md:72-73 allows exactly two denominators: 6 with an external
    // host connected, 4 without. A third ("N of 3", or "0 of 1") means rows
    // were dropped from the switchable set.
    const d = computeDerived(base({ installCount: 0 }));
    expect(d.switchableTotal).toBe(6);
    expect(d.navNote).toBe('6 of 6 on');
  });

  test('with installCount=0 AND no external host, the denominator is 4', () => {
    const d = computeDerived(base({ installCount: 0, externalHostCount: 0 }));
    expect(d.switchableTotal).toBe(4);
    expect(d.navNote).toBe('4 of 4 on');
    expect(d.summary.wpe).toBeNull();
    expect(d.summary.ext).toBeNull();
  });

  test('a wpe row with 0 installs still reads its passes, and costs 0 connections', () => {
    const d = computeDerived(base({ installCount: 0 }));
    const row = d.rows.find(r => r.key === 'wpeRefresh')!;
    expect(row.costLabel).toBe('6 passes a day · 0 connections');
    // The toggle is still operable — that is the whole point.
    expect(row.enableKey).toBe('wpeRefreshAutoEnabled');
  });
});

describe('derived — FIX 9: ≥49h intervals do not render "0 passes a day"', () => {
  test('168h interval omits passes clause, shows connections only', () => {
    const d = computeDerived(base({ settings: { wpeRefreshIntervalHours: 168 } }));
    const row = d.rows.find(r => r.key === 'wpeRefresh')!;
    // round(24/168) = 0, so passes clause is omitted
    expect(row.costLabel).not.toContain('passes');
    expect(row.costLabel).not.toContain('0');
    // But connections figure is computed from unrounded rate: round(24/168 * 331) = 47
    expect(row.costLabel).toContain('47 connections');
  });

  test('168h job contributes real load to the figure, not 0', () => {
    const d = computeDerived(base({ settings: { wpeRefreshIntervalHours: 168 } }));
    // round(24/168 * 331) = 47 from wpeRefresh, plus wpeSync at 4h (fixture) = 6*331 = 1986
    expect(d.summary.wpe!.figure).toBe(2033); // 47 + 1986
  });
});

// THIRD FIX REPORT tests

describe('derived — FIX 10: row label arithmetic is self-consistent', () => {
  test('at 48h, label shows 1 pass × 331 = 331 connections (not unrounded rate)', () => {
    const d = computeDerived(base({ settings: { wpeRefreshIntervalHours: 48 } }));
    const row = d.rows.find(r => r.key === 'wpeRefresh')!;
    // 48h: passesRounded = round(24/48) = 1 (not 0)
    // Label must show: 1 pass × 331 = 331
    expect(row.costLabel).toContain('1 pass a day');
    expect(row.costLabel).toContain('331 connections');
    expect(row.costLabel).not.toContain('166'); // Would be round(0.5 * 331) from unrounded
  });

  test('at 7h, label shows 3 passes × 331 = 993 connections', () => {
    const d = computeDerived(base({ settings: { wpeRefreshIntervalHours: 7 } }));
    const row = d.rows.find(r => r.key === 'wpeRefresh')!;
    // 7h: passesRounded = round(24/7) = 3
    expect(row.costLabel).toContain('3 passes a day');
    expect(row.costLabel).toContain('993 connections'); // 3 × 331
    expect(row.costLabel).not.toContain('1,135'); // Would be round(3.43 * 331) from unrounded
  });
});

describe('derived — FIX 11: nextInHours never goes negative', () => {
  test('overdue job (ran 25h ago on 4h interval) clamps to 0', () => {
    const now = Date.now();
    const twentyFiveHoursAgo = now - 25 * 3600_000;
    const d = computeDerived(base({
      settings: { wpeRefreshIntervalHours: 4 },
      lastRunAt: { wpeRefresh: twentyFiveHoursAgo },
      now,
    }));
    // Should be: last + 4h - now = -21h, clamped to 0
    expect(d.summary.time.nextInHours).toBe(0);
    expect(d.summary.time.nextInHours).not.toBeLessThan(0);
  });
});

describe('derived — FIX 12: weekly job passesPerDay is never 0', () => {
  test('168h job with canRun=true has truthy passesPerDay', () => {
    const d = computeDerived(base({ settings: { wpeRefreshIntervalHours: 168 } }));
    const row = d.rows.find(r => r.key === 'wpeRefresh')!;
    expect(row.canRun).toBe(true);
    expect(row.passesPerDay).toBeTruthy(); // ~0.143, not 0
    expect(row.passesPerDay).toBeCloseTo(0.143, 2);
  });

  test('minsPerDay for 168h job is non-zero when duration exists', () => {
    const d = computeDerived(base({
      settings: { wpeRefreshIntervalHours: 168 },
      durations: { wpeRefresh: 660_000 }, // 11 min
    }));
    const row = d.rows.find(r => r.key === 'wpeRefresh')!;
    expect(row.durationMin).toBe(11);
    // minsPerDay = passesPerDay (0.143) × 11 ≈ 1.57, not 0
    // But we need to account for all enabled jobs, so check it's > 0
    expect(d.summary.time.minsPerDay).toBeGreaterThan(0);
  });
});

describe('derived — FIX 13: module is pure (no Date.now())', () => {
  test('source contains no Date.now() calls', () => {
    const fs = require('fs');
    const path = require('path');
    const derivedPath = path.join(__dirname, '../../../src/renderer/components/settings/derived.ts');
    const source = fs.readFileSync(derivedPath, 'utf8');
    expect(source).not.toContain('Date.now()');
  });

  test('same input produces same output (deterministic)', () => {
    const now = 1234567890000;
    const lastRunAt = { wpeRefresh: now - 2 * 3600_000 };
    const input = base({
      lastRunAt,
      now,
      settings: { wpeRefreshIntervalHours: 4 }
    });

    const result1 = computeDerived(input);
    const result2 = computeDerived(input);

    expect(result1.summary.time.nextInHours).toBe(result2.summary.time.nextInHours);
    expect(result1).toEqual(result2);
  });
});
