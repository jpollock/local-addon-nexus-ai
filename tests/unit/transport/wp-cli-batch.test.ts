// tests/unit/transport/wp-cli-batch.test.ts
import {
  buildExternalWpCliBatch,
  parseWpCliBatchOutput,
} from '../../../src/main/transport/ssh-args';

describe('buildExternalWpCliBatch', () => {
  it('joins commands with indexed delimiters', () => {
    const cmd = buildExternalWpCliBatch([['core', 'version'], ['option', 'get', 'siteurl']]);
    expect(cmd).toBe(
      "wp 'core' 'version'; echo '<<<NEXUS:1>>>'; wp 'option' 'get' 'siteurl'; echo '<<<NEXUS:2>>>'"
    );
  });

  it('applies --path and an explicit wp binary to every command', () => {
    const cmd = buildExternalWpCliBatch([['core', 'version'], ['cli', 'version']], '/var/www', '/usr/local/bin/wp');
    expect(cmd).toContain("'/usr/local/bin/wp' --path='/var/www' 'core' 'version'");
    expect(cmd).toContain("'/usr/local/bin/wp' --path='/var/www' 'cli' 'version'");
  });

  it('escapes arguments — a crafted option name cannot inject a command', () => {
    const cmd = buildExternalWpCliBatch([['option', 'get', "x'; rm -rf /; echo '"]]);
    // The dangerous sequence is escaped and appears only within quotes
    expect(cmd).toContain("'x'\\''");
    expect(cmd).toContain("rm -rf /");
    expect(cmd).toContain("echo '\\'''");
    // Verify the dangerous part is NOT executable (it's inside shell quotes)
    const parts = cmd.split("'option'");
    expect(parts[1]).toMatch(/'get'\s+'x'\\'';\s*rm\s+-rf\s+\/;\s*echo\s+'\\'''/);
  });

  it('returns an empty string for no commands', () => {
    expect(buildExternalWpCliBatch([])).toBe('');
  });
});

describe('parseWpCliBatchOutput', () => {
  it('splits sections by index', () => {
    const out = "6.8.0\n<<<NEXUS:1>>>\nhttps://example.com\n<<<NEXUS:2>>>\n";
    expect(parseWpCliBatchOutput(out, 2)).toEqual(['6.8.0', 'https://example.com']);
  });

  it('returns null for a sub-command that produced no output', () => {
    const out = "6.8.0\n<<<NEXUS:1>>>\n<<<NEXUS:2>>>\nadmin@example.com\n<<<NEXUS:3>>>\n";
    expect(parseWpCliBatchOutput(out, 3)).toEqual(['6.8.0', null, 'admin@example.com']);
  });

  it('preserves multi-line output within a section', () => {
    const out = "line1\nline2\n<<<NEXUS:1>>>\n";
    expect(parseWpCliBatchOutput(out, 1)).toEqual(['line1\nline2']);
  });

  it('nulls trailing sections when the stream is truncated, never shifts them', () => {
    const out = "6.8.0\n<<<NEXUS:1>>>\nhttps://example.com\n";  // delimiter 2 never arrived
    expect(parseWpCliBatchOutput(out, 3)).toEqual(['6.8.0', null, null]);
  });

  it('nulls a section whose delimiter is missing but keeps later indexed ones', () => {
    const out = "a\n<<<NEXUS:1>>>\nb\n<<<NEXUS:3>>>\n";  // 2 never emitted
    expect(parseWpCliBatchOutput(out, 3)).toEqual(['a', null, 'b']);
  });

  it('returns all nulls for empty output', () => {
    expect(parseWpCliBatchOutput('', 2)).toEqual([null, null]);
  });
});
