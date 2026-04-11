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
    // Define LOCAL_GATEWAY_API_KEY BEFORE registerProvider() so createDefaultProviderRequestAuthentication()
    // can find it when it runs internally during registration.
    // The AI Client derives the constant name as: strtoupper(provider_id) + '_' + strtoupper(field) = LOCAL_GATEWAY_API_KEY
    $gatewayToken = defined('NEXUS_AI_GATEWAY_TOKEN') ? NEXUS_AI_GATEWAY_TOKEN : 'missing-gateway-token';
    if (!defined('LOCAL_GATEWAY_API_KEY')) {
        define('LOCAL_GATEWAY_API_KEY', $gatewayToken);
    }

    try {
        if (!$registry->hasProvider('local-gateway')) {
            $registry->registerProvider(LocalGatewayProvider::class);

            // Set up HTTP transporter using WordPress HTTP API
            if (class_exists('WordPress\\AiClient\\Providers\\Http\\WordPressHttpTransporter')) {
                $httpTransporter = new \WordPress\AiClient\Providers\Http\WordPressHttpTransporter();
                $registry->setHttpTransporter('local-gateway', $httpTransporter);
            }

            // Also set the WordPress options as a fallback for the Connectors API
            if (!get_option('connectors_ai_local-gateway_api_key')) {
                update_option('connectors_ai_local-gateway_api_key', $gatewayToken);
            }

        }
    } catch (\Exception $e) {
        error_log('[NexusAI] Local Gateway provider registration failed: ' . $e->getMessage());
    }
}

// Register very early (priority 1) to ensure it's available before any experiments initialize
add_action('init', __NAMESPACE__ . '\\register_provider', 1);

// Register again at priority 5 and 10 to catch any late-loading registries
add_action('init', __NAMESPACE__ . '\\register_provider', 5);
add_action('init', __NAMESPACE__ . '\\register_provider', 10);

// Prepend Local Gateway models to the preferred models list.
// helpers.php applies 'wpai_preferred_text_models' via get_preferred_models_for_text_generation().
add_filter('wpai_preferred_text_models', function ($models) {
    if (!class_exists(AiClient::class)) {
        return $models;
    }

    $registry = AiClient::defaultRegistry();

    if (!$registry->hasProvider('local-gateway') || !$registry->isProviderConfigured('local-gateway')) {
        return $models;
    }

    try {
        $gatewayModels = [];
        foreach (LocalGatewayProvider::modelMetadataDirectory()->listModelMetadata() as $modelMetadata) {
            foreach ($modelMetadata->getSupportedCapabilities() as $capability) {
                if ($capability->isTextGeneration()) {
                    $gatewayModels[] = ['local-gateway', $modelMetadata->getId()];
                    break;
                }
            }
        }
        return array_merge($gatewayModels, $models);
    } catch (\Exception $e) {
        error_log('[NexusAI] wpai_preferred_text_models filter error: ' . $e->getMessage());
        return $models;
    }
});

// Helper: check if a URL is targeting the Local AI Gateway.
// The real AI Gateway (/ai-gateway/v1/*) runs on the webhook server (NEXUS_AI_WEBHOOK_URL).
function nexus_lg_is_gateway_url(string $url): bool {
    // Primary: webhook server hosts the /ai-gateway/v1/ routes
    if (defined('NEXUS_AI_WEBHOOK_URL')) {
        $webhookBase = rtrim(NEXUS_AI_WEBHOOK_URL, '/');
        if (strpos($url, $webhookBase . '/ai-gateway/') === 0) {
            return true;
        }
    }
    // Fallback hardcoded defaults (port 13000 = webhook server default)
    return strpos($url, 'http://127.0.0.1:13000/ai-gateway/') === 0
        || strpos($url, 'http://localhost:13000/ai-gateway/') === 0;
}

// Allow localhost/127.0.0.1 requests to Local Gateway
add_filter('http_request_host_is_external', function ($is_external, $host, $url) {
    if (nexus_lg_is_gateway_url($url)) {
        return true;
    }
    return $is_external;
}, 10, 3);

// Bypass WordPress localhost blocking for Local Gateway and set reasonable timeout
add_filter('http_request_args', function ($args, $url) {
    if (nexus_lg_is_gateway_url($url)) {
        $args['reject_unsafe_urls'] = false;
        $args['timeout'] = 30;
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
        return true;
    }

    return $valid;
});

/**
 * Override the Local Gateway connector registration to add the logo.
 *
 * The WordPress Connectors API auto-discovers providers from the AI Client registry,
 * but doesn't yet support logo_path from ProviderMetadata. We manually override
 * the connector to inject the logo_url.
 *
 * @since 1.0.0
 */
add_action('wp_connectors_init', function ($registry) {
    if (!$registry->is_registered('local-gateway')) {
        return;
    }

    // Unregister, add logo_url, re-register
    $connector = $registry->unregister('local-gateway');
    if ($connector) {
        $connector['logo_url'] = plugins_url('assets/local-icon.svg', __FILE__);
        $connector['description'] = __('Routes AI requests through Local for centralized credential management, usage tracking, and cost monitoring.', 'ai-provider-for-local-gateway');
        $registry->register('local-gateway', $connector);
    }
}, 100); // Late priority to ensure it runs after auto-discovery
