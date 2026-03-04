<?php

declare(strict_types=1);

namespace WordPress\OllamaAiProvider\Availability;

use WordPress\AiClient\Providers\Contracts\ProviderAvailabilityInterface;

/**
 * Ollama provider availability check.
 *
 * Checks if Ollama is running at localhost:11434 by making a direct
 * HTTP request using WordPress's HTTP API.
 *
 * @since 1.0.0
 */
class OllamaProviderAvailability implements ProviderAvailabilityInterface
{
    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    public function isConfigured(): bool
    {
        // Try to connect to Ollama at localhost:11434
        $response = wp_remote_get('http://localhost:11434/v1/models', [
            'timeout' => 5,
            'sslverify' => false,
        ]);

        if (is_wp_error($response)) {
            return false;
        }

        $status_code = wp_remote_retrieve_response_code($response);
        return $status_code === 200;
    }
}
