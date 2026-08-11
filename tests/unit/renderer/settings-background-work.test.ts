/**
 * BackgroundWorkSection: The argument for what background work costs.
 *
 * NOTE ON SERIALIZATION. These call `new Component(props).render()` rather than
 * `serializeTree(createElement(Component, props))` — the latter serializes to
 * the props bag and makes every assertion vacuous. See sites-tab.test.ts.
 */
import { BackgroundWorkSection } from '../../../src/renderer/components/settings/BackgroundWorkSection';
import { computeDerived } from '../../../src/renderer/components/settings/derived';

const derived = (over: any = {}) => computeDerived({
  settings: {
    wpeRefreshAutoEnabled: true, wpeRefreshIntervalHours: 4,
    wpeSyncAutoEnabled: true, wpeSyncIntervalHours: 4,
    wpeContentIndexAutoEnabled: true, wpeContentIndexIntervalHours: 12,
    externalRefreshAutoEnabled: true, externalRefreshIntervalHours: 12,
    externalContentIndexAutoEnabled: true, externalContentIndexIntervalHours: 12,
    localContentIndexAutoEnabled: true, localContentIndexIntervalHours: 4,
    haltedSiteRefreshIntervalHours: 24,
    ...(over.settings ?? {}),
  },
  installCount: 331, externalHostCount: 13, localSiteCount: 37,
  durations: {}, lastRunAt: {}, now: Date.now(), ...over,
});

const tree = (over: any = {}) => JSON.stringify(
  new (BackgroundWorkSection as any)({ derived: derived(over), onSave: jest.fn() }).render());

describe('BackgroundWorkSection', () => {
  test('renders three destination group headers', () => {
    const t = tree();
    expect(t).toContain('ON YOUR WP ENGINE ACCOUNT');
    expect(t).toContain("ON OTHER PEOPLE'S SERVERS");
    expect(t).toContain('ON THIS MAC');
  });

  test('the external cost explanation is stated once, at the group', () => {
    const t = tree();
    const marker = 'Shared hosting limits how many you may open at once';
    expect(t.split(marker)).toHaveLength(2); // exactly one occurrence
  });

  test('the two figures use different units and are never summed', () => {
    const t = tree();
    expect(t).toContain('connections a day');
    expect(t).toContain('SSH sessions a day');
    expect(t).not.toContain('4024');
  });

  test('the always-on row shows a static label, not a disabled toggle', () => {
    const t = tree();
    expect(t).toContain('ALWAYS ON');
    expect(t).not.toContain('"disabled":true');
  });

  test('the always-on row keeps an adjustable interval', () => {
    // haltedSiteRefreshIntervalHours has a live number input today
    // (SettingsTab.tsx:407). "not adjustable" would remove a shipping control.
    expect(tree()).not.toContain('not adjustable');
  });

  test('with no external host the whole middle group is absent', () => {
    const t = tree({ externalHostCount: 0 });
    expect(t).not.toContain("ON OTHER PEOPLE'S SERVERS");
    expect(t).not.toContain('SSH sessions a day');
    expect(t).not.toContain('Check other hosts');
  });

  test('the paused copy promises the per-job settings survive', () => {
    const t = tree({ settings: { backgroundWorkPaused: true } });
    expect(t).toContain('Background work is paused');
    expect(t).toContain('switching this back on restores them');
  });

  test('no hardcoded brand colour', () => {
    expect(tree().toLowerCase()).not.toContain('0ecad4');
  });
});

// Re-homed regression guards from Task 5
describe('BackgroundWorkSection — regression guards from Task 5', () => {

  test('toggling a job persists the field the strict schema actually accepts', () => {
    // UpdateSettingsSchema is .strict(): a field absent from it is stripped
    // silently, the save reports success, and the value never persists. This
    // asserts the exact key travels through onSave.
    const onSave = jest.fn();
    const inst = new (BackgroundWorkSection as any)({
      derived: derived(),
      onSave,
    });
    const tree = inst.render();

    // Find the toggle for externalContentIndexAutoEnabled and simulate a change
    inst.handleToggle('externalContentIndexAutoEnabled', true);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ externalContentIndexAutoEnabled: true })
    );
    // Verify exact key spelling
    const call = onSave.mock.calls[0][0];
    expect(Object.prototype.hasOwnProperty.call(call, 'externalContentIndexAutoEnabled')).toBe(true);
  });

  test('the interval is clamped to the range the schema enforces', () => {
    // The schema rejects 0 and 999 outright, so an unclamped input would make
    // the whole settings write fail rather than just that field.
    const onSave = jest.fn();
    const inst = new (BackgroundWorkSection as any)({
      derived: derived(),
      onSave,
    });

    inst.handleIntervalChange('externalContentIndexIntervalHours', 0);
    inst.handleIntervalChange('externalContentIndexIntervalHours', 999);

    const values = onSave.mock.calls.map(c => c[0].externalContentIndexIntervalHours);
    expect(values).toEqual([1, 168]);
  });
});
