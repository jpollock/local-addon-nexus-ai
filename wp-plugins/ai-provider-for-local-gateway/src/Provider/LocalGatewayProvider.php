<?php

declare(strict_types=1);

namespace WordPress\LocalGatewayAiProvider\Provider;

use WordPress\AiClient\Common\Exception\RuntimeException;
use WordPress\AiClient\Providers\ApiBasedImplementation\AbstractApiProvider;
use WordPress\AiClient\Providers\Contracts\ModelMetadataDirectoryInterface;
use WordPress\AiClient\Providers\Contracts\ProviderAvailabilityInterface;
use WordPress\AiClient\Providers\DTO\ProviderMetadata;
use WordPress\AiClient\Providers\Enums\ProviderTypeEnum;
use WordPress\AiClient\Providers\Http\Enums\RequestAuthenticationMethod;
use WordPress\AiClient\Providers\Models\Contracts\ModelInterface;
use WordPress\AiClient\Providers\Models\DTO\ModelMetadata;
use WordPress\LocalGatewayAiProvider\Availability\LocalGatewayProviderAvailability;
use WordPress\LocalGatewayAiProvider\Metadata\LocalGatewayModelMetadataDirectory;
use WordPress\LocalGatewayAiProvider\Models\LocalGatewayTextGenerationModel;

/**
 * Class for the Local AI Gateway provider.
 *
 * The Local Gateway acts as a reverse proxy that routes AI requests from
 * WordPress to provider APIs (Anthropic, OpenAI, etc.) through the Local
 * addon. This enables:
 * - Centralized credential management (no API keys in WordPress DB)
 * - Usage tracking and cost monitoring
 * - Rate limiting per site
 * - Testing with mock responses
 *
 * The gateway exposes an OpenAI-compatible API at localhost, so this provider
 * is mostly glue code on top of the existing OpenAI-compatible base classes.
 *
 * @since 1.0.0
 */
class LocalGatewayProvider extends AbstractApiProvider
{
    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    protected static function baseUrl(): string
    {
        // The AI Gateway routes (/ai-gateway/v1/*) run on the webhook server, NOT the Ollama proxy.
        // NEXUS_AI_WEBHOOK_URL = webhook server (e.g. http://127.0.0.1:13000) — this is correct.
        // NEXUS_AI_GATEWAY_URL = Ollama proxy (e.g. http://127.0.0.1:13100) — do NOT use this.

        if (defined('NEXUS_AI_WEBHOOK_URL')) {
            return rtrim(NEXUS_AI_WEBHOOK_URL, '/') . '/ai-gateway/v1';
        }

        // Fallback: read from WordPress option set by the connector plugin
        $webhookInfo = get_option('nexus_ai_webhook_info');
        if ($webhookInfo && isset($webhookInfo['url'])) {
            return rtrim($webhookInfo['url'], '/') . '/ai-gateway/v1';
        }

        // Final fallback
        return 'http://localhost:13000/ai-gateway/v1';
    }

    /**
     * Get the full URL for a given path.
     *
     * @since 1.0.0
     * @param string $path The API path.
     * @return string The full URL.
     */
    public static function url(string $path = ''): string
    {
        // Add leading slash if path doesn't start with one
        if ($path !== '' && $path[0] !== '/') {
            $path = '/' . $path;
        }
        return static::baseUrl() . $path;
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    protected static function createModel(
        ModelMetadata $modelMetadata,
        ProviderMetadata $providerMetadata
    ): ModelInterface {
        error_log('LocalGatewayProvider::createModel() called for: ' . $modelMetadata->getId());

        $capabilities = $modelMetadata->getSupportedCapabilities();
        foreach ($capabilities as $capability) {
            if ($capability->isTextGeneration()) {
                error_log('LocalGatewayProvider: Creating LocalGatewayTextGenerationModel for ' . $modelMetadata->getId());
                try {
                    $model = new LocalGatewayTextGenerationModel($modelMetadata, $providerMetadata);
                    error_log('LocalGatewayProvider: Text generation model created successfully');
                    return $model;
                } catch (\Exception $e) {
                    error_log('LocalGatewayProvider: ERROR creating text generation model: ' . $e->getMessage());
                    throw $e;
                }
            }
        }

        error_log('LocalGatewayProvider: No supported capability found');
        throw new RuntimeException(
            'Unsupported model capabilities: ' . implode(', ', array_map(function($cap) {
                return $cap->getValue();
            }, $capabilities))
        );
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    protected static function createProviderMetadata(): ProviderMetadata
    {
        return new ProviderMetadata(
            'local-gateway',
            'Local AI Gateway',
            ProviderTypeEnum::server(),
            null,  // No credentials URL — credentials are managed in Local UI.
            RequestAuthenticationMethod::apiKey()  // Uses token authentication via X-Auth-Token header.
        );
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    protected static function createProviderAvailability(): ProviderAvailabilityInterface
    {
        // Check availability by pinging the Local Gateway health endpoint.
        return new LocalGatewayProviderAvailability();
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    protected static function createModelMetadataDirectory(): ModelMetadataDirectoryInterface
    {
        return new LocalGatewayModelMetadataDirectory();
    }
}
