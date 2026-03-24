<?php

/**
 * Plugin Name: AI Provider for Local Gateway
 * Plugin URI: https://github.com/getflywheel/local-addon-nexus-ai
 * Description: AI Provider for Local AI Gateway. Routes AI requests through Local's centralized gateway for tracking, rate limiting, and credential management.
 * Requires at least: 7.0
 * Requires PHP: 7.4
 * Version: 1.0.0
 * Author: WP Engine
 * License: GPL-2.0-or-later
 * License URI: https://spdx.org/licenses/GPL-2.0-or-later.html
 * Text Domain: ai-provider-for-local-gateway
 * Icon: assets/local-icon.svg
 *
 * @package WordPress\LocalGatewayAiProvider
 */

declare(strict_types=1);

namespace WordPress\LocalGatewayAiProvider;

use WordPress\AiClient\AiClient;
use WordPress\LocalGatewayAiProvider\Provider\LocalGatewayProvider;

if (!defined('ABSPATH')) {
    return;
}

require_once __DIR__ . '/src/autoload.php';

/**
 * Registers the AI Provider for Local Gateway with the AI Client.
 *
 * The Local Gateway acts as a reverse proxy that:
 * - Routes AI requests from WordPress to provider APIs (Anthropic, OpenAI, etc.)
 * - Centralizes credential management (no API keys in WordPress DB)
 * - Adds usage tracking, cost monitoring, and rate limiting
 * - Enables testing with mock responses
 *
 * @since 1.0.0
 *
 * @return void
 */
function register_provider(): void
{
    if (!class_exists(AiClient::class)) {
        return;
    }

    $registry = AiClient::defaultRegistry();

    // Always try to register, even if already registered (might be different registry)
    try {
        if (!$registry->hasProvider('local-gateway')) {
            $registry->registerProvider(LocalGatewayProvider::class);

            // Set up HTTP transporter using WordPress HTTP API
            if (class_exists('WordPress\\AiClient\\Providers\\Http\\WordPressHttpTransporter')) {
                $httpTransporter = new \WordPress\AiClient\Providers\Http\WordPressHttpTransporter();
                $registry->setHttpTransporter('local-gateway', $httpTransporter);
            }

            // Read gateway token from constant (set by Nexus AI mu-plugin)
            // If not set, use a placeholder (will fail authentication, but plugin can still load)
            $gatewayToken = defined('NEXUS_AI_GATEWAY_TOKEN')
                ? NEXUS_AI_GATEWAY_TOKEN
                : 'missing-gateway-token';

            // Store token as "API key" credential
            // WordPress 7.0 uses Connectors API
            if (!get_option('connectors_ai_local-gateway_api_key')) {
                update_option('connectors_ai_local-gateway_api_key', $gatewayToken);
            }

            error_log('Local Gateway provider registered with token: ' . substr($gatewayToken, 0, 8) . '...');
        }
    } catch (\Exception $e) {
        error_log('Local Gateway provider registration failed: ' . $e->getMessage());
    }
}

// Register very early (priority 1) to ensure it's available before any experiments initialize
add_action('init', __NAMESPACE__ . '\\register_provider', 1);

// Register again at priority 5 and 10 to catch any late-loading registries
add_action('init', __NAMESPACE__ . '\\register_provider', 5);
add_action('init', __NAMESPACE__ . '\\register_provider', 10);

// Prepend Local Gateway models to the experiment preferred models list.
add_filter('ai_experiments_preferred_models_for_text_generation', function ($models) {
    if (!class_exists(AiClient::class)) {
        return $models;
    }

    $registry = AiClient::defaultRegistry();

    // Check if provider is registered and configured
    if (!$registry->hasProvider('local-gateway') || !$registry->isProviderConfigured('local-gateway')) {
        return $models;
    }

    try {
        $modelMetadataList = LocalGatewayProvider::modelMetadataDirectory()->listModelMetadata();

        $gatewayModels = [];
        foreach ($modelMetadataList as $modelMetadata) {
            // Only add text generation models to this filter
            $hasTextGeneration = false;
            foreach ($modelMetadata->getSupportedCapabilities() as $capability) {
                if ($capability->isTextGeneration()) {
                    $hasTextGeneration = true;
                    break;
                }
            }

            if ($hasTextGeneration) {
                // Format: [providerId, modelId] - numeric indexed array
                $gatewayModels[] = ['local-gateway', $modelMetadata->getId()];
            }
        }

        // Prepend gateway models so they're preferred over direct provider access
        return array_merge($gatewayModels, $models);
    } catch (\Exception $e) {
        error_log('Local Gateway filter error: ' . $e->getMessage());
        return $models;
    }
});

// Allow localhost requests to Local Gateway
add_filter('http_request_host_is_external', function ($is_external, $host, $url) {
    // Allow localhost for Local Gateway API calls
    if ($host === 'localhost' && strpos($url, '/ai-gateway/v1') !== false) {
        return true;
    }
    return $is_external;
}, 10, 3);

// Bypass WordPress localhost blocking for Local Gateway and set reasonable timeout
add_filter('http_request_args', function ($args, $url) {
    if (strpos($url, '/ai-gateway/v1') !== false) {
        $args['reject_unsafe_urls'] = false;
        $args['timeout'] = 30; // 30 seconds for AI generation
    }
    return $args;
}, 10, 2);

// Bypass credential validation if gateway token is set
add_filter('ai_experiments_pre_has_valid_credentials_check', function ($valid) {
    if ($valid !== null) {
        return $valid;
    }

    if (!class_exists(AiClient::class)) {
        return $valid;
    }

    $registry = AiClient::defaultRegistry();
    $isConfigured = $registry->isProviderConfigured('local-gateway');

    if ($isConfigured) {
        error_log('Local Gateway provider configured, returning TRUE for credentials check');
        return true;
    }

    return $valid;
});

/**
 * Add Local icon to the provider display.
 *
 * This filter allows us to customize how the Local Gateway provider
 * appears in the WordPress admin UI by adding an icon.
 *
 * @since 1.0.0
 */
add_filter('ai_provider_icon_url', function ($icon_url, $provider_id) {
    if ($provider_id === 'local-gateway') {
        return plugins_url('assets/local-icon.svg', __FILE__);
    }
    return $icon_url;
}, 10, 2);

/**
 * Add Local icon via inline SVG data URI.
 * Fallback approach if icon_url filter doesn't exist.
 *
 * @since 1.0.0
 */
add_filter('ai_provider_icon', function ($icon, $provider_id) {
    if ($provider_id === 'local-gateway') {
        $svg_path = plugin_dir_path(__FILE__) . 'assets/local-icon.svg';
        if (file_exists($svg_path)) {
            $svg_content = file_get_contents($svg_path);
            return 'data:image/svg+xml;base64,' . base64_encode($svg_content);
        }
    }
    return $icon;
}, 10, 2);
