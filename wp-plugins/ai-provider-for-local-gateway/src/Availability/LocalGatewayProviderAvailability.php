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
    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    public function isConfigured(): bool
    {
        // Get gateway base URL
        $baseUrl = 'http://localhost:52847';

        // Try to detect webhook URL from site options (set by Nexus AI mu-plugin)
        $webhookInfo = get_option('nexus_ai_webhook_info');
        if ($webhookInfo && isset($webhookInfo['url'])) {
            $baseUrl = $webhookInfo['url'];
        } elseif (defined('NEXUS_AI_GATEWAY_URL')) {
            // Extract base URL from gateway URL (strip /ai-gateway/v1 suffix)
            $baseUrl = preg_replace('#/ai-gateway/v1$#', '', NEXUS_AI_GATEWAY_URL);
        }

        // Ping the webhook server health endpoint
        $response = wp_remote_get($baseUrl . '/health', [
            'timeout' => 3,
            'sslverify' => false,
            'reject_unsafe_urls' => false, // Allow localhost
        ]);

        if (is_wp_error($response)) {
            error_log('Local Gateway availability check failed: ' . $response->get_error_message());
            return false;
        }

        $status_code = wp_remote_retrieve_response_code($response);

        // Health endpoint should return 200
        if ($status_code === 200) {
            error_log('Local Gateway is available at ' . $baseUrl);
            return true;
        }

        error_log('Local Gateway health check returned status ' . $status_code);
        return false;
    }
}
