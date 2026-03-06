<?php
/**
 * Configuration management for Nexus AI Connector
 *
 * Handles webhook URL and auth token configuration with hybrid approach:
 * 1. Check for constants (auto-injected by Local)
 * 2. Fall back to database settings (manual configuration)
 * 3. Auto-discover Local if running
 */

if (!defined('ABSPATH')) {
    exit;
}

class Nexus_AI_Config {
    /**
     * Get configuration (webhook URL and auth token)
     *
     * @return array|null Array with 'url', 'token', 'source' keys, or null if not configured
     */
    public static function get_config() {
        // Priority 1: Check for constants (injected by Local addon)
        if (defined('NEXUS_AI_WEBHOOK_URL') && defined('NEXUS_AI_AUTH_TOKEN')) {
            return [
                'url' => NEXUS_AI_WEBHOOK_URL,
                'token' => NEXUS_AI_AUTH_TOKEN,
                'source' => 'constants',
            ];
        }

        // Priority 2: Check database settings (manual configuration)
        $settings = get_option('nexus_ai_settings');
        if (!empty($settings['webhook_url']) && !empty($settings['auth_token'])) {
            return [
                'url' => $settings['webhook_url'],
                'token' => $settings['auth_token'],
                'source' => 'database',
            ];
        }

        // Priority 3: Not configured
        return null;
    }

    /**
     * Check if plugin is configured
     *
     * @return bool
     */
    public static function is_configured() {
        return self::get_config() !== null;
    }

    /**
     * Get site ID for event payloads
     *
     * Uses the site's directory name as a stable identifier
     *
     * @return string
     */
    public static function get_site_id() {
        // Use site path as ID (e.g., "the-curated-shelf" from "/Users/.../Local Sites/the-curated-shelf")
        $site_path = ABSPATH;
        $site_path = rtrim($site_path, '/');

        // Get parent directory name (site directory)
        // ABSPATH ends with /app/public, so we need to go up 3 levels
        $parts = explode('/', $site_path);
        $site_dir = $parts[count($parts) - 3]; // Parent of "app/public" directories

        return sanitize_title($site_dir);
    }

    /**
     * Auto-discover if Local is running
     *
     * @return bool True if Local detected, false otherwise
     */
    public static function auto_discover_local() {
        $response = wp_remote_get('http://localhost:10800/health', [
            'timeout' => 1,
            'sslverify' => false,
        ]);

        if (is_wp_error($response)) {
            return false;
        }

        $code = wp_remote_retrieve_response_code($response);
        return $code === 200;
    }

    /**
     * Save manual configuration to database
     *
     * @param string $webhook_url Webhook URL
     * @param string $auth_token  Auth token
     * @return bool
     */
    public static function save_settings($webhook_url, $auth_token) {
        $settings = [
            'webhook_url' => esc_url_raw($webhook_url),
            'auth_token' => sanitize_text_field($auth_token),
        ];

        return update_option('nexus_ai_settings', $settings);
    }

    /**
     * Test connection to Local
     *
     * @return array Result with 'success' boolean and 'message' string
     */
    public static function test_connection() {
        $config = self::get_config();

        if (!$config) {
            return [
                'success' => false,
                'message' => 'Not configured. Please enter webhook URL and auth token.',
            ];
        }

        // Try to reach the health endpoint
        $response = wp_remote_get($config['url'] . '/health', [
            'timeout' => 2,
            'sslverify' => false,
        ]);

        if (is_wp_error($response)) {
            return [
                'success' => false,
                'message' => 'Connection failed: ' . $response->get_error_message(),
            ];
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            return [
                'success' => false,
                'message' => 'Server returned HTTP ' . $code,
            ];
        }

        return [
            'success' => true,
            'message' => 'Connected successfully to Local (source: ' . $config['source'] . ')',
        ];
    }
}
