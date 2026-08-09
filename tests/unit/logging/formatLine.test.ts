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
});
