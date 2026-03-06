<?php
/**
 * HTTP client for Nexus AI Connector
 *
 * Sends events to Local's HTTP webhook endpoint
 */

if (!defined('ABSPATH')) {
    exit;
}

class Nexus_AI_HTTP_Client {
    /**
     * Send event to Local
     *
     * @param array $event Event payload
     * @return bool True if sent successfully, false otherwise
     */
    public static function send_event($event) {
        // Get configuration
        $config = Nexus_AI_Config::get_config();

        if (!$config) {
            // Not configured - fail silently
            error_log('[Nexus AI] Not configured, skipping event: ' . $event['event_type']);
            return false;
        }

        // Always log during development
        error_log('[Nexus AI] Sending event: ' . $event['event_type'] . ' to ' . $config['url'] . '/wp-events');

        // Build webhook URL
        $webhook_url = $config['url'] . '/wp-events';

        // Use blocking mode in WP-CLI context (non-blocking doesn't work reliably in CLI)
        $is_cli = defined('WP_CLI') && WP_CLI;
        $blocking = $is_cli ? true : false;
        $timeout = $is_cli ? 5 : 1;

        // Prepare request
        $args = [
            'timeout' => $timeout,
            'blocking' => $blocking,
            'sslverify' => false,     // Allow local SSL
            'headers' => [
                'Authorization' => 'Bearer ' . $config['token'],
                'Content-Type' => 'application/json',
            ],
            'body' => wp_json_encode($event),
        ];

        // Send request
        $response = wp_remote_post($webhook_url, $args);

        // Log errors (but don't throw - fail silently)
        if (is_wp_error($response)) {
            error_log('[Nexus AI] Event send failed: ' . $response->get_error_message());
            return false;
        }

        // Log response for debugging
        if ($blocking) {
            $code = wp_remote_retrieve_response_code($response);
            error_log('[Nexus AI] Event sent (blocking): ' . $event['event_type'] . ' - HTTP ' . $code);
        } else {
            error_log('[Nexus AI] Event sent (non-blocking): ' . $event['event_type']);
        }

        return true;
    }

    /**
     * Send event synchronously (for testing)
     *
     * @param array $event Event payload
     * @return array|WP_Error Response or error
     */
    public static function send_event_sync($event) {
        $config = Nexus_AI_Config::get_config();

        if (!$config) {
            return new WP_Error('not_configured', 'Nexus AI not configured');
        }

        $webhook_url = $config['url'] . '/wp-events';

        $args = [
            'timeout' => 5,           // Longer timeout for sync
            'blocking' => true,       // Wait for response
            'sslverify' => false,
            'headers' => [
                'Authorization' => 'Bearer ' . $config['token'],
                'Content-Type' => 'application/json',
            ],
            'body' => wp_json_encode($event),
        ];

        $response = wp_remote_post($webhook_url, $args);

        if (is_wp_error($response)) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);

        return [
            'code' => $code,
            'body' => $body,
            'success' => $code >= 200 && $code < 300,
        ];
    }
}
