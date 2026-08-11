import * as fs from 'fs';
import * as path from 'path';

const PROVIDERS = ['ollama', 'local-gateway', 'power'];
const dir = path.join(__dirname, '../../../src/main/chat/providers');

describe('every provider states its usage-reporting position', () => {
  // A provider that silently reports nothing is indistinguishable from one that is broken. Each
  // of these must say, in a comment, either that it parses usage or why it cannot — so the next
  // person to wonder "why is cost missing for Ollama?" finds the answer in the file.
  for (const p of PROVIDERS) {
    it(`${p} mentions token usage explicitly`, () => {
      const src = fs.readFileSync(path.join(dir, `${p}.ts`), 'utf-8');
      expect(src.toLowerCase()).toMatch(/token usage|usage is not|no usage/);
    });
  }
});
