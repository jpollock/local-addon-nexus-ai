import { formatLine } from '../../../src/main/logging/eventLog';
import { ZonedDate, localClock } from './simulatedZone';

const AT = new Date('2026-08-09T13:31:02.123Z');

/**
 * The expected timestamp, derived the way a READER derives it: from their own wall clock.
 * Hardcoding `13:31:02.123` would pin the UTC rendering of this instant and pass only on a
 * machine set to UTC — the defect this file now guards against.
 */
const T = localClock(AT);

describe('formatLine', () => {
  it('renders the documented shape', () => {
    expect(formatLine({
      at: AT, level: 'INFO', source: 'security-sentinel', runId: 'r_8f3a2c',
      event: 'run.start', fields: { trigger: 'cron', scope: 3 },
    })).toBe(`${T} INFO security-sentinel run=r_8f3a2c run.start trigger=cron scope=3`);
  });

  it('separates a free-text message with two spaces so the tail is parseable', () => {
    expect(formatLine({
      at: AT, level: 'WARN', source: 'log-processor', runId: 'r_1',
      event: 'finding', fields: { sev: 'high' }, message: 'unexpected file in wp-content',
    })).toBe(`${T} WARN log-processor run=r_1 finding sev=high  unexpected file in wp-content`);
  });

  it('omits absent parts rather than emitting empty slots', () => {
    expect(formatLine({ at: AT, level: 'DEBUG', source: 'chat', message: 'hello' }))
      .toBe(`${T} DEBUG chat  hello`);
  });

  it('leaves the two-space delimiter unique for EVERY level, including the 4-character ones', () => {
    // The padded level emitted two spaces after INFO/WARN and one after DEBUG/ERROR, so
    // `awk -F'  ' '{print $2}'` returned the message on a DEBUG line and the entire body on an
    // INFO line. Asserting one level could never have caught that — it takes all four.
    for (const level of ['INFO', 'WARN', 'DEBUG', 'ERROR'] as const) {
      const line = formatLine({
        at: AT, level, source: 'a', event: 'phase', fields: { name: 'scan' },
        message: 'the message',
      });
      const halves = line.split('  ');
      expect(halves).toHaveLength(2);            // exactly one two-space run in the whole line
      expect(halves[1]).toBe('the message');     // and it delimits the message, nothing else
      expect(halves[0]).toBe(`${T} ${level} a phase name=scan`);
    }
  });

  it('quotes values containing a space or an equals sign', () => {
    const line = formatLine({
      at: AT, level: 'INFO', source: 'a', event: 'mutation',
      fields: { before: 'acf 6.8.5', expr: 'a=b' },
    });
    expect(line).toContain('before="acf 6.8.5"');
    expect(line).toContain('expr="a=b"');
  });

  it('never emits a newline, so one event is always one line', () => {
    const line = formatLine({ at: AT, level: 'INFO', source: 'a', message: 'line one\nline two' });
    expect(line).not.toContain('\n');
    expect(line).toContain('line one line two');
  });

  it('redacts secrets in field values', () => {
    const line = formatLine({
      at: AT, level: 'INFO', source: 'a', event: 'tool.call',
      fields: { password: 'hunter2xyz', name: 'wp_config_set' },
    });
    expect(line).not.toContain('hunter2xyz');
    expect(line).toContain('name=wp_config_set');
  });

  it('redacts secrets in the free-text message', () => {
    // `error` on a tool result is raw provider output; a token can arrive inside it.
    // `message` never passes through redactParams, so its masking is NOT redundant — it is the
    // only pass this text gets, which is why it stays after renderValue's was removed.
    const line = formatLine({
      at: AT, level: 'ERROR', source: 'a',
      message: 'failed: Bearer sk-abcdefghijklmnopqrstuvwx',
    });
    expect(line).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });

  it('keeps a legal install name in target — the field that says WHICH install was changed', () => {
    // `redactParams` exempts `target`/`install_name` from the opaque-run rule when the whole
    // value is a legal install name. A second, key-blind masking pass in renderValue put that
    // bug straight back: `mutation op=wp_plugin_update target=[REDACTED]` on an ordinary name.
    const line = formatLine({
      at: AT, level: 'INFO', source: 'a', event: 'mutation',
      fields: { op: 'wp_plugin_update', target: 'acmeprod2026staging1', before: 'acf 6.8.5' },
    });
    expect(line).toContain('target=acmeprod2026staging1');
    expect(line).not.toContain('[REDACTED]');
  });

  it('still masks a credential in an ordinary field, with no key context to help it', () => {
    // The other direction of the same fix: removing renderValue's pass must not weaken
    // anything, because redactParams already masks by value shape on every string it walks.
    const line = formatLine({
      at: AT, level: 'INFO', source: 'a', event: 'tool.call',
      fields: { note: 'sk-abcdefghijklmnopqrstuvwx', name: 'wp_config_set' },
    });
    expect(line).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    expect(line).toContain('[REDACTED]');
    expect(line).toContain('name=wp_config_set');
  });

  it('never throws; pathological field values produce a fallback line', () => {
    const evil = {
      toString: () => { throw new Error('toString explodes'); },
    };
    const line = formatLine({
      at: AT, level: 'INFO', source: 'a', event: 'mutation',
      fields: { badValue: evil },
    });
    expect(line).toContain('badValue=[UNPRINTABLE]');
    expect(line).toContain('mutation');
  });

  it('quotes field keys containing a space', () => {
    const line = formatLine({
      at: AT, level: 'INFO', source: 'a',
      fields: { 'field name': 'value' },
    });
    expect(line).toContain('"field name"=value');
  });

  it('quotes field keys containing an equals sign', () => {
    const line = formatLine({
      at: AT, level: 'INFO', source: 'a',
      fields: { 'before=after': 'value' },
    });
    expect(line).toContain('"before=after"=value');
  });

  it('redacts secrets embedded in field key names', () => {
    const line = formatLine({
      at: AT, level: 'INFO', source: 'a',
      fields: { 'sk_test_abcdefghijk1234567': 'value', 'normal_key': 'data' },
    });
    // The secret-shaped key should be masked by maskSecretsInString
    expect(line).not.toContain('sk_test_abcdefghijk1234567');
    expect(line).toContain('normal_key=data');
  });

  it('outer guard: never throws on pathological e.source (toString explodes)', () => {
    // This test verifies the outer try/catch is necessary. Without it, this throws.
    const evilSource = { toString: () => { throw new Error('source toString explodes'); } };
    const line = formatLine({
      at: AT, level: 'INFO', source: evilSource as any,
    });
    // Should produce a fallback line with event=log.error, not throw
    expect(line).toContain('event=log.error');
    expect(line).toContain('Failed to format event');
    expect(line).not.toContain('\n');
  });

  it('outer guard: never throws on invalid e.at', () => {
    // This test verifies the outer try/catch is necessary. Without it, this throws.
    // new Date('invalid') is an Invalid Date; timeOf rejects it rather than rendering
    // NaN:NaN:NaN.NaN, exactly as the toISOString() it replaced did.
    const invalidDate = new Date('invalid');
    const line = formatLine({
      at: invalidDate, level: 'INFO', source: 'test',
    });
    // Should produce a fallback line, not throw
    expect(line).toContain('event=log.error');
    expect(line).toContain('Failed to format event');
    expect(line).toContain('HH:MM:SS.SSS');
    expect(line).not.toContain('\n');
  });

  it('outer guard: never throws on pathological e.level (String() fails)', () => {
    // This test verifies the outer try/catch is necessary. Without it, this throws.
    const evilLevel = { toString: () => { throw new Error('level toString explodes'); } };
    const line = formatLine({
      at: AT, level: evilLevel as any, source: 'test',
    });
    // Should produce a fallback line, not throw
    expect(line).toContain('event=log.error');
    expect(line).toContain('Failed to format event');
    expect(line).not.toContain('\n');
  });
});

describe('formatLine timestamps are LOCAL, not UTC', () => {
  // The line carries no `Z` and no offset, so a UTC stamp is simply the wrong time by the length
  // of the reader's offset — 7 hours, on the machine this was found on.
  //
  // The zone is simulated at the Date (see simulatedZone.ts) rather than pinned via process.env
  // .TZ, which Jest does not propagate to the runtime. That makes these deterministic on every
  // machine, UTC ones included, while still failing outright if the code goes back to reading
  // UTC components.

  it.each([
    ['ahead of UTC', 9, '2026-08-09T23:30:00Z'],   // 08:30 the next morning in UTC+9
    ['behind UTC', -7, '2026-08-09T02:30:00Z'],    // still the previous evening in UTC-7
  ])('renders the reader wall clock in a zone %s', (_label, offsetHours, iso) => {
    const at = new ZonedDate(iso, offsetHours as number);
    const utcTime = at.toISOString().slice(11, 23);
    const expected = localClock(at);
    expect(expected).not.toBe(utcTime);            // guard: the assertions below discriminate

    const line = formatLine({ at, level: 'INFO', source: 'a', message: 'evening' });
    expect(line.startsWith(`${expected} `)).toBe(true);
    expect(line).not.toContain(utcTime);
  });
});
