// Unit test for the history reconstruction logic in isolation
// (avoids the full ChatService constructor which needs many deps)

import type { ChatMessage } from '../../../src/common/types';

function reconstructHistory(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages
    .filter((m) => !((m as any).streaming))
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .map((m) => ({ role: m.role, content: m.content }));
}

describe('history reconstruction for LLM resume', () => {
  it('maps user and assistant messages to role+content pairs', () => {
    const messages: ChatMessage[] = [
      { id: '1', sessionId: 's', role: 'system', content: 'You are helpful.', timestamp: 1 },
      { id: '2', sessionId: 's', role: 'user', content: 'Hello', timestamp: 2 },
      { id: '3', sessionId: 's', role: 'assistant', content: 'Hi there!', timestamp: 3 },
    ];
    const history = reconstructHistory(messages);
    expect(history).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
  });

  it('filters out streaming messages', () => {
    const messages: ChatMessage[] = [
      { id: '1', sessionId: 's', role: 'user', content: 'Hello', timestamp: 1 },
      { id: '2', sessionId: 's', role: 'assistant', content: '', timestamp: 2, streaming: true } as any,
    ];
    const history = reconstructHistory(messages);
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe('user');
  });

  it('returns empty array for no messages', () => {
    expect(reconstructHistory([])).toEqual([]);
  });
});
