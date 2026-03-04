<?php

declare(strict_types=1);

namespace WordPress\OllamaAiProvider\Metadata;

use WordPress\AiClient\Providers\Contracts\ModelMetadataDirectoryInterface;
use WordPress\AiClient\Providers\Http\Exception\ResponseException;
use WordPress\AiClient\Providers\Models\DTO\ModelMetadata;
use WordPress\AiClient\Providers\Models\DTO\SupportedOption;
use WordPress\AiClient\Providers\Models\Enums\CapabilityEnum;
use WordPress\AiClient\Providers\Models\Enums\OptionEnum;

/**
 * Class for the Ollama model metadata directory.
 *
 * Discovers available models by querying Ollama's /v1/models endpoint
 * using WordPress's HTTP API directly (not the framework's HTTP transporter).
 *
 * @since 1.0.0
 */
class OllamaModelMetadataDirectory implements ModelMetadataDirectoryInterface
{
    /**
     * Cached models to avoid repeated HTTP requests.
     *
     * @since 1.0.0
     * @var array<string, ModelMetadata>|null
     */
    private $modelCache = null;

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    public function listModelMetadata(): array
    {
        error_log('OllamaModelMetadataDirectory::listModelMetadata() called');

        if ($this->modelCache !== null) {
            error_log('OllamaModelMetadataDirectory: Returning cached models: ' . count($this->modelCache));
            return array_values($this->modelCache);
        }

        $this->modelCache = $this->fetchModelsFromOllama();
        error_log('OllamaModelMetadataDirectory: Fetched ' . count($this->modelCache) . ' models from Ollama');
        return array_values($this->modelCache);
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    public function getModelMetadata(string $modelId): ModelMetadata
    {
        error_log('OllamaModelMetadataDirectory::getModelMetadata() called for: ' . $modelId);

        if ($this->modelCache === null) {
            $this->modelCache = $this->fetchModelsFromOllama();
        }

        if (!isset($this->modelCache[$modelId])) {
            error_log('OllamaModelMetadataDirectory: Model not found: ' . $modelId . ' (available: ' . implode(', ', array_keys($this->modelCache)) . ')');
            throw new \InvalidArgumentException(
                sprintf('Model "%s" not found in Ollama', $modelId)
            );
        }

        error_log('OllamaModelMetadataDirectory: Returning metadata for ' . $modelId);
        return $this->modelCache[$modelId];
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    public function hasModelMetadata(string $modelId): bool
    {
        error_log('OllamaModelMetadataDirectory::hasModelMetadata() called for: ' . $modelId);

        if ($this->modelCache === null) {
            $this->modelCache = $this->fetchModelsFromOllama();
        }

        $hasModel = isset($this->modelCache[$modelId]);
        error_log('OllamaModelMetadataDirectory: hasModelMetadata(' . $modelId . ') = ' . ($hasModel ? 'true' : 'false'));

        return $hasModel;
    }

    /**
     * Check if a model is an image generation model based on name patterns.
     *
     * @since 1.0.0
     * @param string $modelId The model ID to check.
     * @return bool True if this is an image generation model.
     */
    private function isImageGenerationModel(string $modelId): bool
    {
        // Common image generation model name patterns
        $imageModelPatterns = [
            'flux',
            'stable-diffusion',
            'sd-',
            'sdxl',
            'imagen',
            'dalle',
            'midjourney',
            'image-turbo',
            'img-',
            'pic-',
        ];

        $lowerModelId = strtolower($modelId);
        foreach ($imageModelPatterns as $pattern) {
            if (strpos($lowerModelId, $pattern) !== false) {
                return true;
            }
        }

        return false;
    }

    /**
     * Fetch models from Ollama using WordPress HTTP API.
     *
     * @since 1.0.0
     * @return array<string, ModelMetadata>
     */
    private function fetchModelsFromOllama(): array
    {
        error_log('OllamaModelMetadataDirectory::fetchModelsFromOllama() starting');

        $response = wp_remote_get('http://localhost:11434/v1/models', [
            'timeout' => 5,
            'sslverify' => false,
        ]);

        if (is_wp_error($response)) {
            error_log('OllamaModelMetadataDirectory: WP_Error: ' . $response->get_error_message());
            throw new ResponseException(
                'Failed to fetch models from Ollama: ' . $response->get_error_message()
            );
        }

        $status_code = wp_remote_retrieve_response_code($response);
        if ($status_code !== 200) {
            error_log('OllamaModelMetadataDirectory: HTTP ' . $status_code);
            throw new ResponseException(
                'Ollama returned HTTP ' . $status_code
            );
        }

        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if (!isset($data['data']) || !is_array($data['data'])) {
            error_log('OllamaModelMetadataDirectory: No data field in response');
            throw ResponseException::fromMissingData('Ollama', 'data');
        }

        $modelMap = [];
        foreach ($data['data'] as $modelData) {
            $modelId = $modelData['id'];

            $isImageModel = $this->isImageGenerationModel($modelId);

            if ($isImageModel) {
                // Skip image generation models - they timeout and aren't production-ready yet
                // Image generation implementation exists in OllamaImageGenerationModel.php
                // but is disabled until Ollama's image models become stable.
                error_log('OllamaModelMetadataDirectory: Skipping image generation model: ' . $modelId . ' (disabled - models timeout)');
                continue;
            }

            // Text/language models
            $capabilities = [
                CapabilityEnum::textGeneration(),
                CapabilityEnum::chatHistory(),
            ];

            $options = [
                new SupportedOption(OptionEnum::systemInstruction()),
                new SupportedOption(OptionEnum::maxTokens()),
                new SupportedOption(OptionEnum::temperature()),
                new SupportedOption(OptionEnum::topP()),
                new SupportedOption(OptionEnum::stopSequences()),
                new SupportedOption(OptionEnum::candidateCount()),
                new SupportedOption(OptionEnum::inputModalities()),
                new SupportedOption(OptionEnum::outputModalities()),
                new SupportedOption(OptionEnum::customOptions()),
            ];

            $modelMetadata = new ModelMetadata(
                $modelId,
                $modelId,  // Ollama model names are already human-readable
                $capabilities,
                $options,
                'ollama'   // Provider ID
            );
            $modelMap[$modelId] = $modelMetadata;
            error_log('OllamaModelMetadataDirectory: Created metadata for ' . $modelId . ' (text generation)');
        }

        error_log('OllamaModelMetadataDirectory: Returning ' . count($modelMap) . ' models');
        return $modelMap;
    }
}
