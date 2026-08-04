/**
 * Read-only WP-CLI commands — these use the wpcli_read permission (allowed on
 * every environment by default).
 *
 * `db export` is deliberately NOT in this set, and must not be added back. It
 * only reads the database, but it *writes a file*: with no path argument
 * WP-CLI drops `<dbname>-<date>.sql` into the SSH login directory, which on
 * most shared hosts and VPS layouts is the web root. That file holds every user
 * hash, every option row and whatever credentials live in wp_options, at a
 * guessable URL. Calling it a read let it run unchallenged on production —
 * which became reachable on arbitrary external hosts once nexusWpCommand
 * gained ssh: targets. It falls closed to `wpcli` like any other write.
 */
const WPCLI_READ_COMMANDS = new Set([
  'plugin list', 'plugin get',
  'theme list', 'theme get',
  'core version',
  'user list', 'user get',
  'option get',
  'site health',
  'post list', 'post get',
  'post-type list',
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
