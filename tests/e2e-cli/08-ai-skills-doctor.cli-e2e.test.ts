/**
 * CLI E2E Tests — AI, Skills, Doctor, Update, MCP Commands
 *
 * Covers: nexus ai status/config/setup/switch-provider/models/abilities/run/sync-credentials
 *         nexus skills setup/list
 *         nexus doctor
 *         nexus update
 *         nexus mcp status/setup
 */

import { describe, it, expect } from '@jest/globals';
import { runCli, getLocalSites, skipTest } from './helpers/cli-test-utils';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('nexus doctor', () => {
  it('returns exit 0 and health checks', async () => {
    const r = await runCli('doctor');
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatch(/✅|⚠️|❌/);
  });

  it('output includes core components: Local, addon, GraphQL', async () => {
    const r = await runCli('doctor');
    expect(r.output.toLowerCase()).toMatch(/local|addon|graphql/);
  });
});

describe('nexus ai config', () => {
  it('returns current AI configuration (send n to skip interactive prompt)', async () => {
    // ai config shows current settings then prompts to reconfigure — send 'n' to exit
    const r = await runCli('ai config', { stdin: 'n', timeout: 15000 });
    expect([0, 1]).toContain(r.exitCode);
    // Should show at least the current provider/model before prompting
    expect(r.output.toLowerCase()).toMatch(/provider|model|ai|openai|anthropic|google|ollama/);
  });
});

describe('nexus ai models', () => {
  it('returns list of available models', async () => {
    const r = await runCli('ai models');
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus ai status', () => {
  it('requires a site target', async () => {
    const r = await runCli('ai status');
    expect(r.exitCode).toBe(1);
  });

  it('returns AI status for a real site', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(`ai status ${sites[0].name}@local`);
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus ai setup — argument validation', () => {
  it('requires a site target', async () => {
    const r = await runCli('ai setup');
    expect(r.exitCode).toBe(1);
  });
});

describe('nexus ai switch-provider — argument validation', () => {
  it('requires a site target', async () => {
    const r = await runCli('ai switch-provider');
    expect(r.exitCode).toBe(1);
  });
});

describe('nexus ai abilities', () => {
  it('requires a site target', async () => {
    const r = await runCli('ai abilities');
    expect(r.exitCode).toBe(1);
  });
});

describe('nexus skills setup', () => {
  it('exits 0 and installs skills to ~/.claude/skills/', async () => {
    const r = await runCli('skills setup --overwrite');
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('skills installed');
  });

  it('skills appear in ~/.claude/skills/', () => {
    const skillsDir = path.join(os.homedir(), '.claude', 'skills');
    const hasDoctorSkill = fs.existsSync(path.join(skillsDir, 'nexus-doctor', 'SKILL.md'));
    expect(hasDoctorSkill).toBe(true);
  });
});

describe('nexus skills list', () => {
  it('lists installed nexus skills', async () => {
    const r = await runCli('skills list');
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('nexus-doctor');
  });
});

describe('nexus mcp status', () => {
  it('returns MCP server status', async () => {
    const r = await runCli('mcp status');
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus mcp setup — argument validation', () => {
  it('--agent with invalid value fails gracefully', async () => {
    const r = await runCli('mcp setup --agent not-a-real-agent');
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/unknown|invalid|valid/);
  });

  it('prints config for claude-code without --write', async () => {
    const r = await runCli('mcp setup --agent claude-code');
    // Without --write, prints the command to run
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.toLowerCase()).toMatch(/claude|mcp|node/);
  });
});

describe('nexus update', () => {
  it('check flag reports version status without modifying anything', async () => {
    const r = await runCli('update --check', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});
