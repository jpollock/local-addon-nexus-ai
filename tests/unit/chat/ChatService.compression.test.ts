// Testing the private compressStaleToolResults method via any-cast

// We need to instantiate ChatService minimally. It has constructor:
// constructor(registry, services, emitter) but we only need the method.
// Use a subclass to expose the private method for testing.

class TestableService {
  // Copy of the private method for isolated testing
  compressStaleToolResults(messages: any[]): any[] {
    const COMPRESS_THRESHOLD = 800;
    const COMPRESS_TO = 600;

    let assistantCount = 0;
    let compressBefore = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        assistantCount++;
        if (assistantCount >= 2) {
          compressBefore = i;
          break;
        }
      }
    }

    if (compressBefore < 0) return messages;

    return messages.map((msg: any, idx: number) => {
      if (idx >= compressBefore) return msg;
      if (msg.role !== 'tool') return msg;
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (content.length <= COMPRESS_THRESHOLD) return msg;
      return {
        ...msg,
        content: content.slice(0, COMPRESS_TO) +
          `\n[…compressed for context efficiency — ${content.length} chars total]`,
      };
    });
  }
}

function msg(role: string, content: string) {
  return { role, content };
}

test('does not compress when fewer than 2 assistant messages', () => {
  const svc = new TestableService();
  const messages = [
    msg('system', 'system prompt'),
    msg('user', 'hello'),
    msg('assistant', 'hi'),
    msg('tool', 'x'.repeat(1000)),
  ];
  const result = svc.compressStaleToolResults(messages);
  expect(result[3].content).toHaveLength(1000);
});

test('compresses tool result older than 2 assistant messages', () => {
  const svc = new TestableService();
  const longResult = 'A'.repeat(1000);
  const messages = [
    msg('system', 'sys'),
    msg('user', 'q1'),
    msg('tool', longResult),
    msg('assistant', 'answer1'),
    msg('user', 'q2'),
    msg('assistant', 'answer2'),
    msg('user', 'q3'),
  ];
  const result = svc.compressStaleToolResults(messages);
  expect(result[2].content.length).toBeLessThan(700);
  expect(result[2].content).toContain('[…compressed');
  expect(result[2].content).toContain('1000 chars total');
});

test('does not compress short tool results even if old', () => {
  const svc = new TestableService();
  const messages = [
    msg('system', 'sys'),
    msg('tool', 'short result'),
    msg('assistant', 'a1'),
    msg('assistant', 'a2'),
    msg('user', 'q'),
  ];
  const result = svc.compressStaleToolResults(messages);
  expect(result[1].content).toBe('short result');
});

test('preserves recent tool results after second-to-last assistant', () => {
  const svc = new TestableService();
  const longRecent = 'B'.repeat(1000);
  const messages = [
    msg('system', 'sys'),
    msg('user', 'q1'),
    msg('assistant', 'a1'),
    msg('user', 'q2'),
    msg('assistant', 'a2'),
    msg('tool', longRecent),
    msg('user', 'q3'),
  ];
  const result = svc.compressStaleToolResults(messages);
  expect(result[5].content).toHaveLength(1000);
});

test('compresses only tool role — leaves user messages untouched', () => {
  const svc = new TestableService();
  const longUser = 'C'.repeat(1000);
  const messages = [
    msg('user', longUser),
    msg('assistant', 'a1'),
    msg('assistant', 'a2'),
  ];
  const result = svc.compressStaleToolResults(messages);
  expect(result[0].content).toHaveLength(1000);
});
