/** Read-only WP-CLI commands — these use the wpcli_read permission (allowed on every environment by default). */
const WPCLI_READ_COMMANDS = new Set([
  'plugin list', 'plugin get',
  'theme list', 'theme get',
  'core version',
  'user list', 'user get',
  'option get',
  'site health',
  'post list', 'post get',
  'post-type list',
  'db export',
]);

/**
 * Classify arbitrary WP-CLI argv as a read or a write, for the permission gate.
 *
 * FAILS CLOSED: anything not explicitly known to be read-only is treated as a
 * write, so an unrecognised command is refused on production rather than
 * permitted. Never invert this default.
 */
export function classifyWpCliOp(command: string[]): 'wpcli_read' | 'wpcli' {
  const key = command.slice(0, 2).join(' ').toLowerCase();
  return WPCLI_READ_COMMANDS.has(key) ? 'wpcli_read' : 'wpcli';
}
