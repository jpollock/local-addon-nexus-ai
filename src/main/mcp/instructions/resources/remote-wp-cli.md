# Remote WP-CLI via SSH

WP-CLI tools (`wp_*`) can execute commands on remote WP Engine installs via SSH, in addition to local execution.

## Two Execution Modes

### Local Execution
Pass the `site` parameter (site name, ID, or domain):
```
wp_plugin_list({ site: "my-blog" })
```
Commands run against the local WordPress installation via Local's WP-CLI.

### Remote Execution
Pass the `install_name` parameter (WPE install name):
```
wp_plugin_list({ install_name: "myblogprod" })
```
Commands run via SSH on the remote WP Engine environment.

**Never pass both `site` and `install_name` — use one or the other.**

## Remote-Capable Tools

These 9 tools support the `install_name` parameter:
- `wp_core_version`
- `wp_plugin_list`
- `wp_plugin_install`
- `wp_plugin_activate`
- `wp_plugin_deactivate`
- `wp_plugin_update`
- `wp_theme_list`
- `wp_user_list`
- `wp_option_get`

## Local-Only Tools

These tools only work with the `site` parameter:
- `wp_db_export` — Database export
- `wp_search_replace` — Search and replace in database
- `wp_site_health` — WordPress site health check

## Blocked Commands

For security, these commands are blocked on remote execution:
- `eval` — Arbitrary PHP execution
- `eval-file` — PHP file execution
- `shell` — Interactive shell
- `db query` — Direct database queries
- `db cli` — Database CLI access

## SSH Requirements

Remote execution requires:
- Local must be authenticated with WP Engine (via the Connect feature)
- An SSH key must exist at `{Local data dir}/ssh/wpe-connect`
- The WPE install must be accessible via `{install_name}.ssh.wpengine.net`

## Safety Flags

All remote commands run with `--skip-plugins --skip-themes` to avoid triggering plugin/theme code during CLI operations.
