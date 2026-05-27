<?php

declare(strict_types=1);

namespace WordPress\LocalGatewayAiProvider\Availability;

use WordPress\AiClient\Providers\Contracts\ProviderAvailabilityInterface;

/**
 * Local Gateway provider availability check.
 *
 * Checks if the Local AI Gateway is running by making a direct HTTP request
 * to the webhook server health endpoint using WordPress's HTTP API.
 *
 * @since 1.0.0
 */
class LocalGatewayProviderAvailability implements ProviderAvailabilityInterface
{
    /** @var bool|null Cached per-request result to avoid repeated health pings. */
    private static $cachedResult = null;

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    public function isConfigured(): bool
    {
        // Cache per request — isConfigured() is called multiple times per page load.
        if (self::$cachedResult !== null) {
            return self::$cachedResult;
        }

        // If the MU plugin has defined the constant, the gateway is configured.
        // We trust the constant rather than doing a live health ping here — the gateway
        // may be slow to start (e.g. Local is still loading), and caching a false negative
        // would suppress the connector for the entire page load. The actual request path
        // handles gateway-unreachable errors gracefully.
        if (defined('NEXUS_AI_WEBHOOK_URL') && NEXUS_AI_WEBHOOK_URL !== '') {
            self::$cachedResult = true;
            return true;
        }

        // No MU plugin constant — fall back to a live health ping using the WP option
        // or the default port so manually configured sites still work.
        $webhookInfo = get_option('nexus_ai_webhook_info');
        $baseUrl = ($webhookInfo && isset($webhookInfo['url']))
            ? rtrim($webhookInfo['url'], '/')
            : 'http://127.0.0.1:13000';

        $response = wp_remote_get($baseUrl . '/health', [
            'timeout'            => 3,
            'sslverify'          => false,
            'reject_unsafe_urls' => false,
        ]);

        self::$cachedResult = !is_wp_error($response)
            && wp_remote_retrieve_response_code($response) === 200;

        return self::$cachedResult;
    }
}
