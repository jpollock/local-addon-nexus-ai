# Workflow: New Site Setup

Create and configure a new local WordPress development site.

## Steps

1. **Create the site**
   ```
   local_create_site({ name: "My Project" })
   ```
   This provisions a new WordPress site with PHP, MySQL, and a web server. Default credentials are admin/admin.

2. **Wait for provisioning**
   Site creation takes 30-60 seconds. The tool returns the site ID and domain when complete.

3. **Start the site** (if not auto-started)
   ```
   local_start_site({ site: "{site_id}" })
   ```

4. **Trust SSL certificate**
   ```
   local_trust_ssl({ site: "{site_id}" })
   ```
   Enables HTTPS for the local domain (e.g., `https://my-project.local`).

5. **Verify WordPress**
   ```
   wp_core_version({ site: "{site_id}" })
   wp_plugin_list({ site: "{site_id}" })
   ```

## Options

- **PHP version**: Pass `phpVersion` to `local_create_site` (e.g., "8.2.0")
- **Web server**: Pass `webServer` to `local_create_site` (e.g., "nginx")

## After Setup

- Access the site at `https://{site-name}.local`
- Access wp-admin at `https://{site-name}.local/wp-admin`
- Install plugins: `wp_plugin_install({ site: "{site_id}", slug: "woocommerce" })`
- Index for search: `reindex_site({ site: "{site_id}" })`
