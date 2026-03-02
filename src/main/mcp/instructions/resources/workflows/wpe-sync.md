# Workflow: WP Engine Sync

Push and pull between local development sites and WP Engine cloud environments.

## Pull from WP Engine to Local

1. **Discover available installs**
   ```
   nexus_list_sites()
   ```
   Find the WPE install name and ID in the response.

2. **Ensure a local site exists**
   If no local site is linked, create one:
   ```
   local_create_site({ name: "my-site" })
   ```

3. **Start the local site**
   ```
   local_start_site({ site: "my-site" })
   ```

4. **Pull from WPE**
   ```
   local_wpe_pull({ site: "my-site", remote_install_id: "{install_id}", include_database: true })
   ```
   This is an async operation. Check the Local app for progress.

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

2. **Push to WPE**
   ```
   local_wpe_push({ site: "my-site", remote_install_id: "{install_id}" })
   ```
   First call returns a confirmation prompt. Call again with the `_confirmationToken` to proceed.

3. **Monitor progress**
   Check the Local app for push progress. The remote environment will reflect local changes once complete.

## Best Practices

- Always pull before pushing to avoid overwriting remote changes
- Push to staging/development environments first, never directly to production
- Verify the remote install ID is correct before pushing
- Include the database only when you specifically need database changes synced
