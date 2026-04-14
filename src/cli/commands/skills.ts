/**
 * Skills Commands
 *
 * Install Nexus AI Claude Code skills to ~/.claude/skills/ so they work
 * in any project — not just the nexus-ai repo.
 *
 * Skills use `Bash(nexus *)` to run CLI commands directly, so they work
 * without MCP. This is the CLI-native integration for Claude Code.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the skills directory bundled with this package.
 * Works whether installed globally (npm -g) or linked locally (npm link).
 * process.argv[1] is always bin/nexus.js → package root is two levels up.
 */
function resolvePackageSkillsDir(): string {
  const packageRoot = path.dirname(path.dirname(path.resolve(process.argv[1])));
  return path.join(packageRoot, '.claude', 'skills');
}

/** Target directory where user-level Claude Code skills live. */
function resolveUserSkillsDir(): string {
  return path.join(os.homedir(), '.claude', 'skills');
}

/** Recursively copy src → dest, returning list of copied skill names. */
function copySkills(src: string, dest: string, overwrite: boolean): string[] {
  if (!fs.existsSync(src)) return [];

  const installed: string[] = [];
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const skillName = entry.name;
    const skillSrc  = path.join(src, skillName);
    const skillDest = path.join(dest, skillName);
    const exists    = fs.existsSync(skillDest);

    if (exists && !overwrite) {
      installed.push(`  ⏭  ${skillName} (already exists — use --overwrite to replace)`);
      continue;
    }

    fs.mkdirSync(skillDest, { recursive: true });

    for (const file of fs.readdirSync(skillSrc)) {
      fs.copyFileSync(
        path.join(skillSrc, file),
        path.join(skillDest, file),
      );
    }

    installed.push(`  ✅  /${skillName}`);
  }

  return installed;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

const skillsCommand = new Command('skills').description(
  'Manage Claude Code skills for the Nexus CLI',
);

/**
 * nexus skills setup
 *
 * Copies bundled skills from the package to ~/.claude/skills/ so they are
 * available as slash commands in Claude Code from any project directory.
 */
skillsCommand
  .command('setup')
  .description('Install Nexus CLI skills into ~/.claude/skills/ (works in any project)')
  .option('--overwrite', 'Replace existing skills with the bundled versions')
  .action((options) => {
    const srcDir  = resolvePackageSkillsDir();
    const destDir = resolveUserSkillsDir();

    if (!fs.existsSync(srcDir)) {
      console.error('\n❌ Skills directory not found in this package.');
      console.error(`   Expected: ${srcDir}`);
      console.error('   Try reinstalling: npm install -g @local-labs-jpollock/local-addon-nexus-ai\n');
      process.exit(1);
    }

    console.log('\nNexus AI — Claude Code Skills Setup');
    console.log('─'.repeat(44));
    console.log(`  Source:      ${srcDir.replace(os.homedir(), '~')}`);
    console.log(`  Destination: ${destDir.replace(os.homedir(), '~')}`);
    console.log('');

    const results = copySkills(srcDir, destDir, options.overwrite ?? false);

    if (results.length === 0) {
      console.log('  No skills found in package.\n');
      return;
    }

    results.forEach((line) => console.log(line));

    const installed = results.filter((l) => l.includes('✅')).length;
    const skipped   = results.filter((l) => l.includes('⏭')).length;

    console.log('');
    if (installed > 0) {
      console.log(`✅  ${installed} skill${installed === 1 ? '' : 's'} installed to ~/.claude/skills/`);
      console.log('');
      console.log('   Available in Claude Code from any directory:');
      results
        .filter((l) => l.includes('✅'))
        .map((l) => l.trim().replace('✅  ', ''))
        .forEach((name) => console.log(`     ${name}`));
      console.log('');
      console.log('   No restart needed — skills are available immediately.');
    }
    if (skipped > 0) {
      console.log(`⏭   ${skipped} skill${skipped === 1 ? '' : 's'} skipped (already installed).`);
      console.log('   Run with --overwrite to replace them.');
    }
    console.log('');
  });

/**
 * nexus skills list
 *
 * Show which Nexus skills are installed at the user level.
 */
skillsCommand
  .command('list')
  .description('List Nexus skills installed in ~/.claude/skills/')
  .action(() => {
    const destDir = resolveUserSkillsDir();
    const srcDir  = resolvePackageSkillsDir();

    console.log('\nNexus AI — Installed Skills');
    console.log('─'.repeat(44));

    if (!fs.existsSync(destDir)) {
      console.log('  No skills installed yet.');
      console.log('  Run: nexus skills setup\n');
      return;
    }

    const installed = fs.readdirSync(destDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('nexus'))
      .map((e) => e.name);

    const available = fs.existsSync(srcDir)
      ? fs.readdirSync(srcDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : [];

    if (installed.length === 0) {
      console.log('  No nexus-* skills found in ~/.claude/skills/');
      console.log('  Run: nexus skills setup\n');
      return;
    }

    installed.forEach((name) => {
      const upToDate = available.includes(name) ? '' : ' (not in current package)';
      console.log(`  ✅  /${name}${upToDate}`);
    });

    const missing = available.filter((n) => !installed.includes(n));
    if (missing.length > 0) {
      console.log('');
      missing.forEach((name) => console.log(`  ➕  /${name} (available — run nexus skills setup)`));
    }

    console.log('');
    console.log(`  ${installed.length} skill${installed.length === 1 ? '' : 's'} installed · ~/.claude/skills/`);
    console.log('');
  });

export { skillsCommand };
