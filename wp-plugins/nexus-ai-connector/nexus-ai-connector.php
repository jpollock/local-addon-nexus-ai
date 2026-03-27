<?php
/**
 * Plugin Name: Nexus AI Connector
 * Plugin URI: https://github.com/getflywheel/local-addon-nexus-ai
 * Description: Sends real-time WordPress events to Local's Nexus AI addon for intelligent site management
 * Version: 1.0.0
 * Author: WP Engine
 * Author URI: https://wpengine.com
 * License: MIT
 * Requires at least: 5.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

// Plugin constants
define('NEXUS_AI_VERSION', '1.0.0');
define('NEXUS_AI_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('NEXUS_AI_PLUGIN_URL', plugin_dir_url(__FILE__));

// Load dependencies
require_once NEXUS_AI_PLUGIN_DIR . 'includes/class-config.php';
require_once NEXUS_AI_PLUGIN_DIR . 'includes/class-event-builder.php';
require_once NEXUS_AI_PLUGIN_DIR . 'includes/class-http-client.php';
require_once NEXUS_AI_PLUGIN_DIR . 'includes/class-admin-settings.php';

/**
 * Initialize plugin
 */
function nexus_ai_init() {
    // Register admin settings page
    if (is_admin()) {
        Nexus_AI_Admin_Settings::init();
    }

    // Register event hooks
    nexus_ai_register_hooks();
}
add_action('plugins_loaded', 'nexus_ai_init');

/**
 * Register WordPress action hooks
 */
function nexus_ai_register_hooks() {
    // Content events
    add_action('save_post', 'nexus_ai_handle_post_save', 10, 3);
    add_action('delete_post', 'nexus_ai_handle_post_delete', 10, 1);
    add_action('wp_trash_post', 'nexus_ai_handle_post_trash', 10, 1);
    add_action('untrashed_post', 'nexus_ai_handle_post_untrash', 10, 1);

    // Plugin events
    add_action('activated_plugin', 'nexus_ai_handle_plugin_activated', 10, 2);
    add_action('deactivated_plugin', 'nexus_ai_handle_plugin_deactivated', 10, 2);
    add_action('upgrader_process_complete', 'nexus_ai_handle_upgrader_complete', 10, 2);
    add_action('deleted_plugin', 'nexus_ai_handle_plugin_deleted', 10, 2);

    // Theme events
    add_action('switch_theme', 'nexus_ai_handle_theme_activated', 10, 3);
    add_action('deleted_theme', 'nexus_ai_handle_theme_deleted', 10, 2);

    // User events
    add_action('user_register', 'nexus_ai_handle_user_created', 10, 1);
    add_action('profile_update', 'nexus_ai_handle_user_updated', 10, 2);
    add_action('delete_user', 'nexus_ai_handle_user_deleted', 10, 2);

    // Allow HTTP requests to localhost (required for Local integration)
    add_filter('http_request_host_is_external', 'nexus_ai_allow_localhost', 10, 3);
}

/**
 * Allow HTTP requests to localhost/127.0.0.1
 * WordPress blocks these by default for security
 *
 * @param bool   $is_external Whether the URL is external
 * @param string $host        Hostname
 * @param string $url         Full URL
 * @return bool
 */
function nexus_ai_allow_localhost($is_external, $host, $url) {
    // Allow localhost and 127.0.0.1
    if ($host === 'localhost' || $host === '127.0.0.1') {
        return true;
    }

    return $is_external;
}

/**
 * Handle post save (create or update)
 *
 * @param int     $post_id Post ID
 * @param WP_Post $post    Post object
 * @param bool    $update  Whether this is an update
 */
function nexus_ai_handle_post_save($post_id, $post, $update) {
    // Always log hook execution (even if we skip sending)
    error_log('[Nexus AI] save_post hook fired for post #' . $post_id . ' (status: ' . $post->post_status . ', update: ' . ($update ? 'yes' : 'no') . ')');

    // Skip autosaves
    if (wp_is_post_autosave($post_id)) {
        error_log('[Nexus AI] Skipping autosave');
        return;
    }

    // Skip revisions
    if (wp_is_post_revision($post_id)) {
        error_log('[Nexus AI] Skipping revision');
        return;
    }

    // Only published posts (skip drafts, pending, etc.)
    if ($post->post_status !== 'publish') {
        error_log('[Nexus AI] Skipping non-published post (status: ' . $post->post_status . ')');
        return;
    }

    // Build event
    $event_type = $update ? 'post_updated' : 'post_created';
    $event = Nexus_AI_Event_Builder::build_post_event($event_type, $post);

    error_log('[Nexus AI] Sending ' . $event_type . ' event for post #' . $post_id);

    // Send to Local
    Nexus_AI_HTTP_Client::send_event($event);
}

/**
 * Handle post deletion
 *
 * @param int $post_id Post ID
 */
function nexus_ai_handle_post_delete($post_id) {
    error_log('[Nexus AI] delete_post hook fired for post #' . $post_id);

    // Get post data before it's deleted
    $post = get_post($post_id);

    if (!$post) {
        error_log('[Nexus AI] Post #' . $post_id . ' not found, skipping');
        return;
    }

    // Build event
    $event = Nexus_AI_Event_Builder::build_post_deleted_event($post);

    error_log('[Nexus AI] Sending post_deleted event for post #' . $post_id);

    // Send to Local
    Nexus_AI_HTTP_Client::send_event($event);
}

/**
 * Handle post trash
 *
 * @param int $post_id Post ID
 */
function nexus_ai_handle_post_trash($post_id) {
    error_log('[Nexus AI] wp_trash_post hook fired for post #' . $post_id);

    // Get post data
    $post = get_post($post_id);

    if (!$post) {
        error_log('[Nexus AI] Post #' . $post_id . ' not found, skipping');
        return;
    }

    // Build event
    $event = Nexus_AI_Event_Builder::build_post_event('post_trashed', $post);

    error_log('[Nexus AI] Sending post_trashed event for post #' . $post_id);

    // Send to Local
    Nexus_AI_HTTP_Client::send_event($event);
}

/**
 * Handle post untrash (restore from trash)
 *
 * @param int $post_id Post ID
 */
function nexus_ai_handle_post_untrash($post_id) {
    error_log('[Nexus AI] untrashed_post hook fired for post #' . $post_id);

    // Get post data
    $post = get_post($post_id);

    if (!$post) {
        error_log('[Nexus AI] Post #' . $post_id . ' not found, skipping');
        return;
    }

    // Build event
    $event = Nexus_AI_Event_Builder::build_post_event('post_untrashed', $post);

    error_log('[Nexus AI] Sending post_untrashed event for post #' . $post_id);

    // Send to Local
    Nexus_AI_HTTP_Client::send_event($event);
}

/**
 * Handle plugin activation
 *
 * @param string $plugin_file Plugin file path (e.g., 'akismet/akismet.php')
 * @param bool   $network_wide Whether plugin was network activated
 */
function nexus_ai_handle_plugin_activated($plugin_file, $network_wide) {
    error_log('[Nexus AI] activated_plugin hook fired for ' . $plugin_file);

    // Build event
    $event = Nexus_AI_Event_Builder::build_plugin_event('plugin_activated', $plugin_file);

    error_log('[Nexus AI] Sending plugin_activated event for ' . $plugin_file);

    // Send to Local
    Nexus_AI_HTTP_Client::send_event($event);
}

/**
 * Handle plugin deactivation
 *
 * @param string $plugin_file Plugin file path
 * @param bool   $network_wide Whether plugin was network deactivated
 */
function nexus_ai_handle_plugin_deactivated($plugin_file, $network_wide) {
    error_log('[Nexus AI] deactivated_plugin hook fired for ' . $plugin_file);

    // Build event
    $event = Nexus_AI_Event_Builder::build_plugin_event('plugin_deactivated', $plugin_file);

    error_log('[Nexus AI] Sending plugin_deactivated event for ' . $plugin_file);

    // Send to Local
    Nexus_AI_HTTP_Client::send_event($event);
}

/**
 * Handle plugin/theme installs and updates via upgrader
 *
 * @param WP_Upgrader $upgrader WP_Upgrader instance
 * @param array       $options  Array of bulk item update data
 */
function nexus_ai_handle_upgrader_complete($upgrader, $options) {
    $type = $options['type'] ?? null;
    $action = $options['action'] ?? null;

    if (!$type || !$action) {
        return;
    }

    error_log('[Nexus AI] upgrader_process_complete hook fired (type: ' . $type . ', action: ' . $action . ')');

    // Handle plugin installs and updates
    if ($type === 'plugin') {
        // Get list of plugins
        $plugins = [];
        if (isset($options['plugins']) && is_array($options['plugins'])) {
            $plugins = $options['plugins'];
        } elseif (isset($options['plugin'])) {
            $plugins = [$options['plugin']];
        }

        // Determine event type based on action
        $event_type = ($action === 'install') ? 'plugin_installed' : 'plugin_updated';

        // Send event for each plugin
        foreach ($plugins as $plugin_file) {
            error_log('[Nexus AI] Sending ' . $event_type . ' event for ' . $plugin_file);

            $event = Nexus_AI_Event_Builder::build_plugin_event($event_type, $plugin_file);
            Nexus_AI_HTTP_Client::send_event($event);
        }
    }

    // Handle theme installs
    if ($type === 'theme' && $action === 'install') {
        // Get theme slug
        $theme_slug = $options['theme'] ?? null;

        if ($theme_slug) {
            error_log('[Nexus AI] Sending theme_installed event for ' . $theme_slug);

            $event = Nexus_AI_Event_Builder::build_theme_event('theme_installed', $theme_slug);
            Nexus_AI_HTTP_Client::send_event($event);
        }
    }
}

/**
 * Handle plugin deletion
 *
 * @param string $plugin_file Plugin file path
 * @param bool   $deleted     Whether the plugin was successfully deleted
 */
function nexus_ai_handle_plugin_deleted($plugin_file, $deleted) {
    error_log('[Nexus AI] deleted_plugin hook fired for ' . $plugin_file);

    if (!$deleted) {
        error_log('[Nexus AI] Plugin deletion failed, skipping event');
        return;
    }

    // Get plugin data before it's fully deleted
    // Note: At this point, plugin files are deleted but we can still extract slug
    if (!function_exists('get_plugins')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }

    $all_plugins = get_plugins();
    $plugin_data = isset($all_plugins[$plugin_file]) ? $all_plugins[$plugin_file] : [];

    // Build event
    $event = Nexus_AI_Event_Builder::build_plugin_deleted_event($plugin_file, $plugin_data);

    error_log('[Nexus AI] Sending plugin_deleted event for ' . $plugin_file);

    // Send to Local
    Nexus_AI_HTTP_Client::send_event($event);
}

/**
 * Handle user creation
 *
 * @param int $user_id User ID
 */
function nexus_ai_handle_user_created($user_id) {
    error_log('[Nexus AI] user_register hook fired for user #' . $user_id);

    // Build event
    $event = Nexus_AI_Event_Builder::build_user_event('user_created', $user_id);

    if (!$event) {
        error_log('[Nexus AI] User #' . $user_id . ' not found, skipping');
        return;
    }

    error_log('[Nexus AI] Sending user_created event for user #' . $user_id);

    // Send to Local
    Nexus_AI_HTTP_Client::send_event($event);
}

/**
 * Handle user update (profile changes)
 *
 * @param int     $user_id       User ID
 * @param WP_User $old_user_data Old user data object
 */
function nexus_ai_handle_user_updated($user_id, $old_user_data) {
    error_log('[Nexus AI] profile_update hook fired for user #' . $user_id);

    // Build event
    $event = Nexus_AI_Event_Builder::build_user_event('user_updated', $user_id);

    if (!$event) {
        error_log('[Nexus AI] User #' . $user_id . ' not found, skipping');
        return;
    }

    error_log('[Nexus AI] Sending user_updated event for user #' . $user_id);

    // Send to Local
    Nexus_AI_HTTP_Client::send_event($event);
}

/**
 * Handle user deletion
 *
 * @param int      $user_id  User ID
 * @param int|null $reassign ID of user to reassign posts to (or null)
 */
function nexus_ai_handle_user_deleted($user_id, $reassign) {
    error_log('[Nexus AI] delete_user hook fired for user #' . $user_id);

    // Get user data before deletion
    $user = get_userdata($user_id);

    if (!$user) {
        error_log('[Nexus AI] User #' . $user_id . ' not found, skipping');
        return;
    }

    // Build event
    $event = Nexus_AI_Event_Builder::build_user_deleted_event($user_id, $user);

    error_log('[Nexus AI] Sending user_deleted event for user #' . $user_id);

    // Send to Local
    Nexus_AI_HTTP_Client::send_event($event);
}

/**
 * Handle theme activation (when user switches themes)
 *
 * @param string   $new_name  New theme name
 * @param WP_Theme $new_theme New theme object
 * @param WP_Theme $old_theme Old theme object
 */
function nexus_ai_handle_theme_activated($new_name, $new_theme, $old_theme) {
    error_log('[Nexus AI] switch_theme hook fired - new theme: ' . $new_name);

    // Build event for newly activated theme
    $event = Nexus_AI_Event_Builder::build_theme_event('theme_activated', $new_theme->get_stylesheet());

    error_log('[Nexus AI] Sending theme_activated event for ' . $new_theme->get_stylesheet());

    // Send to Local
    Nexus_AI_HTTP_Client::send_event($event);
}

/**
 * Handle theme deletion
 *
 * @param string $stylesheet Theme stylesheet (slug)
 * @param bool   $deleted    Whether the theme was successfully deleted
 */
function nexus_ai_handle_theme_deleted($stylesheet, $deleted) {
    error_log('[Nexus AI] deleted_theme hook fired for ' . $stylesheet);

    if (!$deleted) {
        error_log('[Nexus AI] Theme deletion failed, skipping event');
        return;
    }

    // Build event (theme is already deleted, so we only have the slug)
    $event = Nexus_AI_Event_Builder::build_theme_deleted_event($stylesheet);

    error_log('[Nexus AI] Sending theme_deleted event for ' . $stylesheet);

    // Send to Local
    Nexus_AI_HTTP_Client::send_event($event);
}

/**
 * Activation hook
 */
function nexus_ai_activate() {
    // Nothing to do on activation yet
    // Future: Create database tables, set default options, etc.
}
register_activation_hook(__FILE__, 'nexus_ai_activate');

/**
 * Deactivation hook
 */
function nexus_ai_deactivate() {
    // Nothing to do on deactivation
    // We don't delete settings - user might want to reactivate
}
register_deactivation_hook(__FILE__, 'nexus_ai_deactivate');
