<?php

declare(strict_types=1);

namespace WordPress\OllamaAiProvider\Provider;

use WordPress\AiClient\Common\Exception\RuntimeException;
use WordPress\AiClient\Providers\ApiBasedImplementation\AbstractApiProvider;
use WordPress\AiClient\Providers\Contracts\ModelMetadataDirectoryInterface;
use WordPress\AiClient\Providers\Contracts\ProviderAvailabilityInterface;
use WordPress\AiClient\Providers\DTO\ProviderMetadata;
use WordPress\AiClient\Providers\Enums\ProviderTypeEnum;
use WordPress\AiClient\Providers\Http\Enums\RequestAuthenticationMethod;
use WordPress\AiClient\Providers\Models\Contracts\ModelInterface;
use WordPress\AiClient\Providers\Models\DTO\ModelMetadata;
use WordPress\OllamaAiProvider\Availability\OllamaProviderAvailability;
use WordPress\OllamaAiProvider\Metadata\OllamaModelMetadataDirectory;
use WordPress\OllamaAiProvider\Models\OllamaImageGenerationModel;
use WordPress\OllamaAiProvider\Models\OllamaTextGenerationModel;

/**
 * Class for the Ollama provider.
 *
 * Ollama exposes an OpenAI-compatible API at localhost:11434/v1,
 * so this provider is mostly glue code on top of the existing
 * OpenAI-compatible base classes.
 *
 * @since 1.0.0
 */
class OllamaProvider extends AbstractApiProvider
{
    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    protected static function baseUrl(): string
    {
        return 'http://localhost:11434/v1';
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
        error_log('OllamaProvider::createModel() called for: ' . $modelMetadata->getId());

        $capabilities = $modelMetadata->getSupportedCapabilities();
        foreach ($capabilities as $capability) {
            // Check image generation FIRST (before text generation)
            if ($capability->isImageGeneration()) {
                error_log('OllamaProvider: Creating OllamaImageGenerationModel for ' . $modelMetadata->getId());
                try {
                    $model = new OllamaImageGenerationModel($modelMetadata, $providerMetadata);
                    error_log('OllamaProvider: Image generation model created successfully');
                    return $model;
                } catch (\Exception $e) {
                    error_log('OllamaProvider: ERROR creating image generation model: ' . $e->getMessage());
                    throw $e;
                }
            }

            if ($capability->isTextGeneration()) {
                error_log('OllamaProvider: Creating OllamaTextGenerationModel for ' . $modelMetadata->getId());
                try {
                    $model = new OllamaTextGenerationModel($modelMetadata, $providerMetadata);
                    error_log('OllamaProvider: Text generation model created successfully');
                    return $model;
                } catch (\Exception $e) {
                    error_log('OllamaProvider: ERROR creating text generation model: ' . $e->getMessage());
                    throw $e;
                }
            }
        }

        error_log('OllamaProvider: No supported capability found');
        throw new RuntimeException(
            'Unsupported model capabilities: ' . implode(', ', $capabilities)
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
            'ollama',
            'Ollama',
            ProviderTypeEnum::server(),
            null,  // No credentials URL — Ollama needs no API keys.
            RequestAuthenticationMethod::apiKey()  // Use apiKey method but with empty key.
        );
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    protected static function createProviderAvailability(): ProviderAvailabilityInterface
    {
        // Check availability by pinging the Ollama server directly.
        // We can't use ListModelsApiBasedProviderAvailability because it requires
        // the HTTP transporter to be set up first, which creates a chicken-and-egg problem.
        return new OllamaProviderAvailability();
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    protected static function createModelMetadataDirectory(): ModelMetadataDirectoryInterface
    {
        return new OllamaModelMetadataDirectory();
    }
}
