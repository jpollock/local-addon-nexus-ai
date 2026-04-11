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
        // Cache per request — isConfigured() is called multiple times per page load
        // (once per registered priority), and the health ping adds ~3s latency each time.
        if (self::$cachedResult !== null) {
            return self::$cachedResult;
        }

        // Resolve the webhook server URL — this is where /health and /ai-gateway/v1/* live.
        // Priority: NEXUS_AI_WEBHOOK_URL constant (set by MU plugin) > wp option > fallback.
        if (defined('NEXUS_AI_WEBHOOK_URL')) {
            $baseUrl = rtrim(NEXUS_AI_WEBHOOK_URL, '/');
        } else {
            $webhookInfo = get_option('nexus_ai_webhook_info');
            $baseUrl = ($webhookInfo && isset($webhookInfo['url']))
                ? rtrim($webhookInfo['url'], '/')
                : 'http://127.0.0.1:13000';
        }

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
