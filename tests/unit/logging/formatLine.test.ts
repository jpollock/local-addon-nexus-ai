import { formatLine } from '../../../src/main/logging/eventLog';

const AT = new Date('2026-08-09T13:31:02.123Z');

describe('formatLine', () => {
  it('renders the documented shape', () => {
    expect(formatLine({
      at: AT, level: 'INFO', source: 'security-sentinel', runId: 'r_8f3a2c',
      event: 'run.start', fields: { trigger: 'cron', scope: 3 },
    })).toBe('13:31:02.123 INFO  security-sentinel run=r_8f3a2c run.start trigger=cron scope=3');
  });

  it('separates a free-text message with two spaces so the tail is parseable', () => {
    expect(formatLine({
      at: AT, level: 'WARN', source: 'log-processor', runId: 'r_1',
      event: 'finding', fields: { sev: 'high' }, message: 'unexpected file in wp-content',
    })).toBe('13:31:02.123 WARN  log-processor run=r_1 finding sev=high  unexpected file in wp-content');
  });

  it('omits absent parts rather than emitting empty slots', () => {
    expect(formatLine({ at: AT, level: 'DEBUG', source: 'chat', message: 'hello' }))
      .toBe('13:31:02.123 DEBUG chat  hello');
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
    const line = formatLine({
      at: AT, level: 'ERROR', source: 'a',
      message: 'failed: Bearer sk-abcdefghijklmnopqrstuvwx',
    });
    expect(line).not.toContain('sk-abcdefghijklmnopqrstuvwx');
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

  it('outer guard: never throws on invalid e.at (toISOString fails)', () => {
    // This test verifies the outer try/catch is necessary. Without it, this throws.
    // new Date('invalid') produces an Invalid Date; accessing its toISOString() throws.
    const invalidDate = new Date('invalid');
    const line = formatLine({
      at: invalidDate, level: 'INFO', source: 'test',
    });
    // Should produce a fallback line, not throw
    expect(line).toContain('event=log.error');
    expect(line).toContain('Failed to format event');
    expect(line).not.toContain('\n');
  });

  it('outer guard: never throws on pathological e.level (padEnd fails)', () => {
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
