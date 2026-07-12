import { defineAgent, cron, on, stream, webhook } from '../../../src/main/agent-sdk';

describe('defineAgent', () => {
  it('returns the definition unchanged', () => {
    const run = jest.fn();
    const def = defineAgent({
      name: 'test-agent',
      version: '1.0.0',
      triggers: [cron('* * * * *')],
      run,
    });
    expect(def.name).toBe('test-agent');
    expect(def.version).toBe('1.0.0');
    expect(def.run).toBe(run);
  });

  it('throws if name is empty', () => {
    expect(() => defineAgent({ name: '', version: '1.0.0', triggers: [], run: jest.fn() }))
      .toThrow('Agent name is required');
  });

  it('throws if triggers is empty', () => {
    expect(() => defineAgent({ name: 'x', version: '1.0.0', triggers: [], run: jest.fn() }))
      .toThrow('Agent must have at least one trigger');
  });
});

describe('trigger factories', () => {
  it('cron() returns a CronTrigger', () => {
    const t = cron('0 2 * * *');
    expect(t.type).toBe('cron');
    expect(t.expression).toBe('0 2 * * *');
  });

  it('on() returns an EventTrigger', () => {
    const t = on('wp:post.published', { site: 'mysite' });
    expect(t.type).toBe('event');
    expect(t.pattern).toBe('wp:post.published');
    expect(t.filter).toEqual({ site: 'mysite' });
  });

  it('stream() returns a StreamTrigger', () => {
    const t = stream('wp:order.*');
    expect(t.type).toBe('stream');
    expect(t.pattern).toBe('wp:order.*');
  });

  it('webhook() returns a WebhookTrigger', () => {
    const t = webhook('/on-deploy');
    expect(t.type).toBe('webhook');
    expect(t.path).toBe('/on-deploy');
  });
});
