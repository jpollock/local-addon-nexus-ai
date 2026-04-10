# Workflow: WP Engine Sync

Push and pull between local development sites and WP Engine cloud environments.

## Pull from WP Engine to Local

1. **Discover available installs**
   ```
   nexus_list_sites()
   ```
   Find the WPE install name and ID in the response.

2. **Ensure a local site exists and is running**
   If no local site is linked, create one:
   ```
   local_create_site({ name: "my-site" })
   local_start_site({ site: "my-site" })
   ```

3. **Start the pull**
   ```
   local_wpe_pull({ site: "my-site", remote_install_id: "{install_id}", include_database: true })
   ```
   Returns immediately with `status: "in_progress"`.

4. **Poll for completion**
   Call every 15-30 seconds until `status === "completed"`:
   ```
   local_operation_status({ site: "my-site" })
   ```
   The response includes `last_message` (current phase) and `recent_files` (files being transferred).
   Pulls typically take 1-3 minutes depending on site size.

5. **Verify after pull completes**
   ```
   wp_core_version({ site: "my-site" })
   wp_plugin_list({ site: "my-site" })
   ```

## Push from Local to WP Engine

**Warning:** This is a Tier 3 destructive operation. It overwrites the remote environment.

1. **Verify the local site is ready**
   ```
   wp_core_version({ site: "my-site" })
   ```

2. **Push to WPE** (first call — returns confirmation prompt)
   ```
   local_wpe_push({ site: "my-site", remote_install_id: "{install_id}" })
   ```
   Returns a confirmation token. Call again with `_confirmationToken` to proceed.

3. **Confirm the push**
   ```
   local_wpe_push({ site: "my-site", remote_install_id: "{install_id}", _confirmationToken: "{token}" })
   ```
   Returns immediately with `status: "in_progress"`.

4. **Poll for completion**
   Call every 15-30 seconds until `status === "completed"`:
   ```
   local_operation_status({ site: "my-site" })
   ```
   Pushes typically take 2-5 minutes.

## Backups

Creating a WP Engine backup requires API credentials (basic auth), not OAuth.

Check if credentials are configured:
```
wpe_credentials_status()
```

If not configured, set them once:
```
wpe_set_api_credentials({ username: "...", password: "..." })
```

Then create the backup:
```
wpe_create_backup({ install_id: "{install_id}", description: "Pre-deploy backup" })
```

## Best Practices

- Always pull before pushing to avoid overwriting remote changes
- Push to staging/development first, never directly to production without confirmation
- Verify the remote install ID is correct before pushing
- Include the database only when you specifically need database changes synced
- Use `local_get_site_changes` after a pull to see what changed
