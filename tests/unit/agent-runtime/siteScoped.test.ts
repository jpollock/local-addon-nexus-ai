import * as fs from 'fs';
import * as path from 'path';

describe('siteScoped travels from definition to renderer', () => {
  it('the agentStatus GraphQL query actually requests siteScoped', () => {
    // A field absent here arrives undefined in the renderer and falls back to its default,
    // so a siteScoped:false agent renders as scoped with no error anywhere.
    const src = fs.readFileSync(
      path.join(__dirname, '../../../src/renderer/components/agents/AgentConsoleTab.tsx'),
      'utf-8',
    );
    const query = src.match(/\{\s*agentStatus\s*\{[^}]*\}/);
    expect(query).toBeTruthy();
    expect(query![0]).toContain('siteScoped');
  });

  it('the GraphQL schema declares siteScoped on AgentStatus', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../src/main/graphql/schema.ts'),
      'utf-8',
    );
    expect(src).toMatch(/siteScoped:\s*Boolean/);
  });

  it('the resolver defaults an undeclared agent to true', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../src/main/graphql/resolvers.ts'),
      'utf-8',
    );
    // Conservative default: an agent that never declared the field keeps today's behaviour.
    expect(src).toMatch(/siteScoped:\s*\(def as any\)\.siteScoped \?\? true/);
  });
});
