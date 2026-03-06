<?php
/**
 * Admin settings page for Nexus AI Connector
 *
 * Provides UI for manual configuration and connection testing
 */

if (!defined('ABSPATH')) {
    exit;
}

class Nexus_AI_Admin_Settings {
    /**
     * Initialize admin hooks
     */
    public static function init() {
        add_action('admin_menu', [__CLASS__, 'register_menu']);
        add_action('admin_init', [__CLASS__, 'register_settings']);
        add_action('admin_notices', [__CLASS__, 'show_notices']);
        add_action('admin_enqueue_scripts', [__CLASS__, 'enqueue_assets']);

        // Handle test connection AJAX
        add_action('wp_ajax_nexus_ai_test_connection', [__CLASS__, 'ajax_test_connection']);
    }

    /**
     * Register settings menu
     */
    public static function register_menu() {
        add_options_page(
            'Nexus AI Connector',           // Page title
            'Nexus AI',                      // Menu title
            'manage_options',                // Capability
            'nexus-ai-settings',             // Menu slug
            [__CLASS__, 'render_settings_page'] // Callback
        );
    }

    /**
     * Register settings
     */
    public static function register_settings() {
        register_setting('nexus_ai_settings', 'nexus_ai_settings', [
            'sanitize_callback' => [__CLASS__, 'sanitize_settings'],
        ]);
    }

    /**
     * Sanitize settings before saving
     *
     * @param array $input Raw input
     * @return array Sanitized input
     */
    public static function sanitize_settings($input) {
        $sanitized = [];

        if (isset($input['webhook_url'])) {
            $sanitized['webhook_url'] = esc_url_raw($input['webhook_url']);
        }

        if (isset($input['auth_token'])) {
            $sanitized['auth_token'] = sanitize_text_field($input['auth_token']);
        }

        return $sanitized;
    }

    /**
     * Show admin notices
     */
    public static function show_notices() {
        // Only show on our settings page
        $screen = get_current_screen();
        if (!$screen || $screen->id !== 'settings_page_nexus-ai-settings') {
            return;
        }

        // Show saved notice
        if (isset($_GET['settings-updated']) && $_GET['settings-updated']) {
            echo '<div class="notice notice-success is-dismissible"><p>Settings saved.</p></div>';
        }
    }

    /**
     * Enqueue admin assets
     */
    public static function enqueue_assets($hook) {
        // Only load on our settings page
        if ($hook !== 'settings_page_nexus-ai-settings') {
            return;
        }

        // Inline styles for simplicity
        $css = '
        .nexus-ai-status {
            padding: 15px;
            margin: 20px 0;
            border-left: 4px solid #ddd;
            background: #fff;
        }
        .nexus-ai-status.connected {
            border-left-color: #46b450;
            background: #f7fcf7;
        }
        .nexus-ai-status.disconnected {
            border-left-color: #dc3232;
            background: #fcf7f7;
        }
        .nexus-ai-status.warning {
            border-left-color: #ffb900;
            background: #fffbf0;
        }
        .nexus-ai-status h3 {
            margin-top: 0;
            margin-bottom: 10px;
        }
        .nexus-ai-test-btn {
            margin-top: 10px;
        }
        .nexus-ai-test-result {
            margin-top: 10px;
            padding: 10px;
            background: #f0f0f1;
            border-radius: 3px;
        }
        ';

        wp_add_inline_style('wp-admin', $css);

        // Inline JavaScript for test connection
        $js = "
        jQuery(document).ready(function($) {
            $('#nexus-ai-test-connection').on('click', function(e) {
                e.preventDefault();
                var btn = $(this);
                var result = $('#nexus-ai-test-result');

                btn.prop('disabled', true).text('Testing...');
                result.html('');

                $.post(ajaxurl, {
                    action: 'nexus_ai_test_connection',
                    _wpnonce: '" . wp_create_nonce('nexus_ai_test_connection') . "'
                }, function(response) {
                    btn.prop('disabled', false).text('Test Connection');

                    if (response.success) {
                        result.html('<span style=\"color: #46b450;\">✓ ' + response.data.message + '</span>');
                    } else {
                        result.html('<span style=\"color: #dc3232;\">✗ ' + response.data.message + '</span>');
                    }
                }).fail(function() {
                    btn.prop('disabled', false).text('Test Connection');
                    result.html('<span style=\"color: #dc3232;\">✗ Request failed</span>');
                });
            });
        });
        ";

        wp_add_inline_script('jquery', $js);
    }

    /**
     * AJAX handler for test connection
     */
    public static function ajax_test_connection() {
        check_ajax_referer('nexus_ai_test_connection');

        if (!current_user_can('manage_options')) {
            wp_send_json_error(['message' => 'Permission denied']);
        }

        $result = Nexus_AI_Config::test_connection();

        if ($result['success']) {
            wp_send_json_success(['message' => $result['message']]);
        } else {
            wp_send_json_error(['message' => $result['message']]);
        }
    }

    /**
     * Render settings page
     */
    public static function render_settings_page() {
        if (!current_user_can('manage_options')) {
            return;
        }

        $config = Nexus_AI_Config::get_config();
        $is_configured = $config !== null;

        ?>
        <div class="wrap">
            <h1>Nexus AI Connector</h1>

            <p>Connect your WordPress site to Local's Nexus AI addon for intelligent site management.</p>

            <!-- Connection Status -->
            <?php if ($is_configured): ?>
                <div class="nexus-ai-status connected">
                    <h3>✓ Connected to Local</h3>
                    <p>
                        <strong>Source:</strong> <?php echo esc_html(ucfirst($config['source'])); ?>
                        <?php if ($config['source'] === 'constants'): ?>
                            <br><small>Configuration automatically injected by Local</small>
                        <?php endif; ?>
                    </p>
                    <p>
                        <strong>Webhook URL:</strong> <code><?php echo esc_html($config['url']); ?></code>
                    </p>
                    <p>
                        <strong>Site ID:</strong> <code><?php echo esc_html(Nexus_AI_Config::get_site_id()); ?></code>
                    </p>
                </div>
            <?php elseif (Nexus_AI_Config::auto_discover_local()): ?>
                <div class="nexus-ai-status warning">
                    <h3>⚠ Local Detected but Not Configured</h3>
                    <p>Local is running on your machine, but this site is not yet connected.</p>
                    <p>Enter the webhook URL and auth token below to connect.</p>
                </div>
            <?php else: ?>
                <div class="nexus-ai-status disconnected">
                    <h3>✗ Not Connected</h3>
                    <p>Local is not running or not configured.</p>
                    <p>Enter the webhook URL and auth token below to connect manually.</p>
                </div>
            <?php endif; ?>

            <!-- Settings Form -->
            <form method="post" action="options.php">
                <?php settings_fields('nexus_ai_settings'); ?>

                <h2>Manual Configuration</h2>
                <p>If auto-configuration doesn't work, you can manually enter the webhook URL and auth token.</p>

                <table class="form-table">
                    <tr>
                        <th scope="row">
                            <label for="webhook_url">Webhook URL</label>
                        </th>
                        <td>
                            <input type="url"
                                   id="webhook_url"
                                   name="nexus_ai_settings[webhook_url]"
                                   value="<?php echo esc_attr($config['url'] ?? ''); ?>"
                                   class="regular-text"
                                   placeholder="http://localhost:10800" />
                            <p class="description">
                                The URL of your Local's Nexus AI webhook endpoint.
                                <br>Default: <code>http://localhost:10800</code>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="auth_token">Auth Token</label>
                        </th>
                        <td>
                            <input type="password"
                                   id="auth_token"
                                   name="nexus_ai_settings[auth_token]"
                                   value="<?php echo esc_attr($config['token'] ?? ''); ?>"
                                   class="regular-text"
                                   placeholder="Enter auth token" />
                            <p class="description">
                                The authentication token for your Local instance.
                                <br>Find this in Local's MCP connection info file.
                            </p>
                        </td>
                    </tr>
                </table>

                <p class="submit">
                    <?php submit_button('Save Settings', 'primary', 'submit', false); ?>
                    <button type="button" id="nexus-ai-test-connection" class="button nexus-ai-test-btn">
                        Test Connection
                    </button>
                </p>

                <div id="nexus-ai-test-result" class="nexus-ai-test-result"></div>
            </form>

            <!-- Event Log (Future Enhancement) -->
            <h2>Event Status</h2>
            <p>
                <strong>Plugin Version:</strong> <?php echo esc_html(NEXUS_AI_VERSION); ?>
                <br>
                <strong>Events Sent:</strong> <em>Coming soon</em>
                <br>
                <strong>Last Event:</strong> <em>Coming soon</em>
            </p>

            <hr>

            <h2>How It Works</h2>
            <ol>
                <li><strong>Create or update content</strong> in WordPress</li>
                <li><strong>Events are sent</strong> to Local's Nexus AI addon in real-time</li>
                <li><strong>AI context updates</strong> automatically (no manual reindexing needed)</li>
                <li><strong>Ask questions</strong> and AI has up-to-date information</li>
            </ol>

            <h3>Supported Events</h3>
            <ul>
                <li>✓ Post created</li>
                <li>✓ Post updated</li>
                <li>✓ Post deleted</li>
                <li>Coming soon: Plugin activated/deactivated</li>
                <li>Coming soon: Theme changed</li>
            </ul>
        </div>
        <?php
    }
}
