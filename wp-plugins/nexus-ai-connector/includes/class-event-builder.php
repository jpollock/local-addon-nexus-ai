<?php
/**
 * Event builder for Nexus AI Connector
 *
 * Creates standardized event payloads for different WordPress actions
 */

if (!defined('ABSPATH')) {
    exit;
}

class Nexus_AI_Event_Builder {
    /**
     * Build a post event (created or updated)
     *
     * @param string  $event_type 'post_created' or 'post_updated'
     * @param WP_Post $post       Post object
     * @return array Event payload
     */
    public static function build_post_event($event_type, $post) {
        $payload = self::sanitize_post_data($post);

        return [
            'site_id' => Nexus_AI_Config::get_site_id(),
            'event_type' => $event_type,
            'timestamp' => current_time('timestamp') * 1000, // Milliseconds
            'payload' => $payload,
        ];
    }

    /**
     * Build a post deleted event
     *
     * @param WP_Post $post Post object (before deletion)
     * @return array Event payload
     */
    public static function build_post_deleted_event($post) {
        return [
            'site_id' => Nexus_AI_Config::get_site_id(),
            'event_type' => 'post_deleted',
            'timestamp' => current_time('timestamp') * 1000,
            'payload' => [
                'post_id' => $post->ID,
                'post_type' => $post->post_type,
                'title' => $post->post_title,
                'deleted_at' => current_time('timestamp') * 1000,
            ],
        ];
    }

    /**
     * Sanitize post data for event payload
     *
     * Removes sensitive information and formats for consumption
     *
     * @param WP_Post $post Post object
     * @return array Sanitized post data
     */
    private static function sanitize_post_data($post) {
        // Basic post data
        $data = [
            'post_id' => $post->ID,
            'post_type' => $post->post_type,
            'title' => $post->post_title,
            'excerpt' => $post->post_excerpt,
            'status' => $post->post_status,
            'author_id' => $post->post_author,
            'created_at' => strtotime($post->post_date_gmt) * 1000,
            'updated_at' => strtotime($post->post_modified_gmt) * 1000,
        ];

        // Handle password-protected posts
        if (!empty($post->post_password)) {
            $data['content'] = '[Password Protected]';
            $data['is_protected'] = true;
        } else {
            $data['content'] = $post->post_content;
            $data['is_protected'] = false;
        }

        // Get categories
        $categories = get_the_category($post->ID);
        if ($categories) {
            $data['categories'] = array_map(function($cat) {
                return [
                    'id' => $cat->term_id,
                    'name' => $cat->name,
                    'slug' => $cat->slug,
                ];
            }, $categories);
        } else {
            $data['categories'] = [];
        }

        // Get tags
        $tags = get_the_tags($post->ID);
        if ($tags) {
            $data['tags'] = array_map(function($tag) {
                return [
                    'id' => $tag->term_id,
                    'name' => $tag->name,
                    'slug' => $tag->slug,
                ];
            }, $tags);
        } else {
            $data['tags'] = [];
        }

        // Get featured image
        if (has_post_thumbnail($post->ID)) {
            $thumbnail_id = get_post_thumbnail_id($post->ID);
            $data['featured_image'] = [
                'id' => $thumbnail_id,
                'url' => get_the_post_thumbnail_url($post->ID, 'full'),
            ];
        }

        // Get custom fields (sanitized)
        $meta = get_post_meta($post->ID);
        $sanitized_meta = [];

        foreach ($meta as $key => $values) {
            // Skip private meta (starts with _)
            if (strpos($key, '_') === 0) {
                continue;
            }

            // Skip sensitive fields
            $sensitive_keywords = ['password', 'api_key', 'secret', 'token', 'credential'];
            $is_sensitive = false;
            foreach ($sensitive_keywords as $keyword) {
                if (stripos($key, $keyword) !== false) {
                    $is_sensitive = true;
                    break;
                }
            }

            if ($is_sensitive) {
                continue;
            }

            // Include safe meta
            $sanitized_meta[$key] = $values[0]; // Get first value (meta can be arrays)
        }

        if (!empty($sanitized_meta)) {
            $data['meta'] = $sanitized_meta;
        }

        return $data;
    }

    /**
     * Detect changes between old and new post
     *
     * @param WP_Post $old_post Old post object
     * @param WP_Post $new_post New post object
     * @return array Changed fields
     */
    public static function detect_changes($old_post, $new_post) {
        $changes = [];

        // Check title
        if ($old_post->post_title !== $new_post->post_title) {
            $changes['title'] = true;
        }

        // Check content
        if ($old_post->post_content !== $new_post->post_content) {
            $changes['content'] = true;
        }

        // Check excerpt
        if ($old_post->post_excerpt !== $new_post->post_excerpt) {
            $changes['excerpt'] = true;
        }

        // Check status
        if ($old_post->post_status !== $new_post->post_status) {
            $changes['status'] = true;
        }

        // Could check categories, tags, meta, etc.
        // For MVP, we send full post data on every update

        return $changes;
    }

    /**
     * Build a plugin event (activated, deactivated, or updated)
     *
     * @param string $event_type 'plugin_activated', 'plugin_deactivated', or 'plugin_updated'
     * @param string $plugin_file Plugin file path (e.g., 'akismet/akismet.php')
     * @return array Event payload
     */
    public static function build_plugin_event($event_type, $plugin_file) {
        $plugin_data = self::get_plugin_data($plugin_file);

        return [
            'site_id' => Nexus_AI_Config::get_site_id(),
            'event_type' => $event_type,
            'timestamp' => current_time('timestamp') * 1000,
            'payload' => $plugin_data,
        ];
    }

    /**
     * Build a plugin deleted event
     *
     * @param string $plugin_file Plugin file path
     * @param array  $plugin_data Plugin data (from before deletion)
     * @return array Event payload
     */
    public static function build_plugin_deleted_event($plugin_file, $plugin_data) {
        // Extract slug from plugin file (e.g., 'akismet/akismet.php' -> 'akismet')
        $slug = dirname($plugin_file);
        if ($slug === '.') {
            $slug = basename($plugin_file, '.php');
        }

        $payload = [
            'slug' => $slug,
            'name' => isset($plugin_data['Name']) ? $plugin_data['Name'] : $slug,
            'version' => isset($plugin_data['Version']) ? $plugin_data['Version'] : '',
            'is_active' => false,
        ];

        if (isset($plugin_data['Author'])) {
            $payload['author'] = $plugin_data['Author'];
        }

        return [
            'site_id' => Nexus_AI_Config::get_site_id(),
            'event_type' => 'plugin_deleted',
            'timestamp' => current_time('timestamp') * 1000,
            'payload' => $payload,
        ];
    }

    /**
     * Build a user event (created or updated)
     *
     * @param string $event_type 'user_created' or 'user_updated'
     * @param int    $user_id    User ID
     * @return array Event payload
     */
    public static function build_user_event($event_type, $user_id) {
        $user = get_userdata($user_id);

        if (!$user) {
            return null;
        }

        $payload = [
            'user_id' => $user->ID,
            'username' => $user->user_login,
            'email' => $user->user_email,
            'roles' => $user->roles,
            'created_at' => strtotime($user->user_registered) * 1000,
        ];

        return [
            'site_id' => Nexus_AI_Config::get_site_id(),
            'event_type' => $event_type,
            'timestamp' => current_time('timestamp') * 1000,
            'payload' => $payload,
        ];
    }

    /**
     * Build a user deleted event
     *
     * @param int      $user_id User ID
     * @param WP_User  $user    User object (before deletion)
     * @return array Event payload
     */
    public static function build_user_deleted_event($user_id, $user) {
        $payload = [
            'user_id' => $user->ID,
            'username' => $user->user_login,
            'email' => $user->user_email,
            'roles' => $user->roles,
            'created_at' => strtotime($user->user_registered) * 1000,
        ];

        return [
            'site_id' => Nexus_AI_Config::get_site_id(),
            'event_type' => 'user_deleted',
            'timestamp' => current_time('timestamp') * 1000,
            'payload' => $payload,
        ];
    }

    /**
     * Get plugin data from plugin file
     *
     * @param string $plugin_file Plugin file path (e.g., 'akismet/akismet.php')
     * @return array Plugin data
     */
    private static function get_plugin_data($plugin_file) {
        // Get all installed plugins
        if (!function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        $all_plugins = get_plugins();

        // Extract slug from plugin file
        $slug = dirname($plugin_file);
        if ($slug === '.') {
            $slug = basename($plugin_file, '.php');
        }

        // Get plugin data
        $plugin_info = isset($all_plugins[$plugin_file]) ? $all_plugins[$plugin_file] : [];

        // Check if plugin is active
        $is_active = is_plugin_active($plugin_file);

        $payload = [
            'slug' => $slug,
            'name' => isset($plugin_info['Name']) ? $plugin_info['Name'] : $slug,
            'version' => isset($plugin_info['Version']) ? $plugin_info['Version'] : '',
            'is_active' => $is_active,
        ];

        if (isset($plugin_info['Author'])) {
            $payload['author'] = strip_tags($plugin_info['Author']); // Remove HTML tags
        }

        if (isset($plugin_info['Description'])) {
            $payload['description'] = strip_tags($plugin_info['Description']);
        }

        return $payload;
    }

    /**
     * Build a theme event (installed or activated)
     *
     * @param string $event_type 'theme_installed' or 'theme_activated'
     * @param string $theme_slug Theme stylesheet (slug)
     * @return array Event payload
     */
    public static function build_theme_event($event_type, $theme_slug) {
        $theme_data = self::get_theme_data($theme_slug);

        return [
            'site_id' => Nexus_AI_Config::get_site_id(),
            'event_type' => $event_type,
            'timestamp' => current_time('timestamp') * 1000,
            'payload' => $theme_data,
        ];
    }

    /**
     * Build a theme deleted event
     *
     * @param string $theme_slug Theme stylesheet (slug)
     * @return array Event payload
     */
    public static function build_theme_deleted_event($theme_slug) {
        // Theme is already deleted, so we only have the slug
        $payload = [
            'slug' => $theme_slug,
            'name' => $theme_slug, // Fallback to slug as name
            'version' => '',
            'is_active' => false,
        ];

        return [
            'site_id' => Nexus_AI_Config::get_site_id(),
            'event_type' => 'theme_deleted',
            'timestamp' => current_time('timestamp') * 1000,
            'payload' => $payload,
        ];
    }

    /**
     * Get theme data from theme slug
     *
     * @param string $theme_slug Theme stylesheet (slug)
     * @return array Theme data
     */
    private static function get_theme_data($theme_slug) {
        $theme = wp_get_theme($theme_slug);

        // Check if theme exists
        if (!$theme->exists()) {
            return [
                'slug' => $theme_slug,
                'name' => $theme_slug,
                'version' => '',
                'is_active' => false,
            ];
        }

        // Check if this is the active theme
        $current_theme = wp_get_theme();
        $is_active = ($current_theme->get_stylesheet() === $theme_slug);

        $payload = [
            'slug' => $theme->get_stylesheet(),
            'name' => $theme->get('Name'),
            'version' => $theme->get('Version'),
            'is_active' => $is_active,
        ];

        if ($theme->get('Author')) {
            $payload['author'] = strip_tags($theme->get('Author'));
        }

        if ($theme->get('Description')) {
            $payload['description'] = strip_tags($theme->get('Description'));
        }

        return $payload;
    }
}
