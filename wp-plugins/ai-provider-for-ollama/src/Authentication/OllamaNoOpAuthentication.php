<?php

declare(strict_types=1);

namespace WordPress\OllamaAiProvider\Authentication;

use WordPress\AiClient\Providers\Http\Contracts\RequestAuthenticationInterface;
use WordPress\AiClient\Providers\Http\DTO\Request;

/**
 * No-op authentication for Ollama.
 *
 * Ollama runs locally and requires no API keys or authentication headers.
 * This class satisfies the RequestAuthenticationInterface contract by
 * returning the request unchanged.
 *
 * @since 1.0.0
 */
class OllamaNoOpAuthentication implements RequestAuthenticationInterface
{
    /**
     * {@inheritDoc}
     *
     * Returns the request unchanged — Ollama needs no authentication.
     *
     * @since 1.0.0
     */
    public function authenticateRequest(Request $request): Request
    {
        return $request;
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    public static function getJsonSchema(): array
    {
        return [
            'type'       => 'object',
            'properties' => new \stdClass(),
        ];
    }
}
