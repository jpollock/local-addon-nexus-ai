<?php

declare(strict_types=1);

namespace WordPress\LocalGatewayAiProvider\Metadata;

use WordPress\AiClient\Providers\Contracts\ModelMetadataDirectoryInterface;
use WordPress\AiClient\Providers\Models\DTO\ModelMetadata;
use WordPress\AiClient\Providers\Models\DTO\SupportedOption;
use WordPress\AiClient\Providers\Models\Enums\CapabilityEnum;
use WordPress\AiClient\Providers\Models\Enums\OptionEnum;

/**
 * Class for the Local Gateway model metadata directory.
 *
 * Lists the AI models available through the Local Gateway. Initially supports
 * Anthropic Claude models, with potential for OpenAI, Google, and others.
 *
 * The Local Gateway routes requests to the appropriate provider based on the
 * model ID (e.g., "claude-haiku-4-5" routes to Anthropic, "gpt-4" to OpenAI).
 *
 * @since 1.0.0
 */
class LocalGatewayModelMetadataDirectory implements ModelMetadataDirectoryInterface
{
    /**
     * Cached models to avoid repeated lookups.
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
        error_log('LocalGatewayModelMetadataDirectory::listModelMetadata() called');

        if ($this->modelCache !== null) {
            error_log('LocalGatewayModelMetadataDirectory: Returning cached models: ' . count($this->modelCache));
            return array_values($this->modelCache);
        }

        $this->modelCache = $this->getAvailableModels();
        error_log('LocalGatewayModelMetadataDirectory: Built ' . count($this->modelCache) . ' models');
        return array_values($this->modelCache);
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    public function getModelMetadata(string $modelId): ModelMetadata
    {
        error_log('LocalGatewayModelMetadataDirectory::getModelMetadata() called for: ' . $modelId);

        if ($this->modelCache === null) {
            $this->modelCache = $this->getAvailableModels();
        }

        if (!isset($this->modelCache[$modelId])) {
            error_log('LocalGatewayModelMetadataDirectory: Model not found: ' . $modelId . ' (available: ' . implode(', ', array_keys($this->modelCache)) . ')');
            throw new \InvalidArgumentException(
                sprintf('Model "%s" not available through Local Gateway', $modelId)
            );
        }

        error_log('LocalGatewayModelMetadataDirectory: Returning metadata for ' . $modelId);
        return $this->modelCache[$modelId];
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    public function hasModelMetadata(string $modelId): bool
    {
        error_log('LocalGatewayModelMetadataDirectory::hasModelMetadata() called for: ' . $modelId);

        if ($this->modelCache === null) {
            $this->modelCache = $this->getAvailableModels();
        }

        $hasModel = isset($this->modelCache[$modelId]);
        error_log('LocalGatewayModelMetadataDirectory: hasModelMetadata(' . $modelId . ') = ' . ($hasModel ? 'true' : 'false'));

        return $hasModel;
    }

    /**
     * Get the list of available models.
     *
     * Initially supports Anthropic Claude models. Can be extended to support
     * other providers (OpenAI, Google, etc.) as the gateway implementation expands.
     *
     * @since 1.0.0
     * @return array<string, ModelMetadata>
     */
    private function getAvailableModels(): array
    {
        error_log('LocalGatewayModelMetadataDirectory::getAvailableModels() building model list');

        $modelMap = [];

        // Standard capabilities for text generation models
        $capabilities = [
            CapabilityEnum::textGeneration(),
            CapabilityEnum::chatHistory(),
        ];

        // Standard options supported by most providers
        $options = [
            new SupportedOption(OptionEnum::systemInstruction()),
            new SupportedOption(OptionEnum::maxTokens()),
            new SupportedOption(OptionEnum::temperature()),
            new SupportedOption(OptionEnum::topP()),
            new SupportedOption(OptionEnum::stopSequences()),
        ];

        // Anthropic Claude models (default)
        // The gateway will route these to Anthropic API
        $claudeModels = [
            'claude-haiku-4-5-20251001' => 'Claude Haiku 4.5',
            'claude-sonnet-4-5-20250514' => 'Claude Sonnet 4.5',
            'claude-opus-4-6-20251015' => 'Claude Opus 4.6',
        ];

        foreach ($claudeModels as $modelId => $displayName) {
            $modelMap[$modelId] = new ModelMetadata(
                $modelId,
                $displayName,
                $capabilities,
                $options,
                'local-gateway' // Provider ID
            );
            error_log('LocalGatewayModelMetadataDirectory: Created metadata for ' . $modelId);
        }

        // Future: Add OpenAI models (gpt-4, gpt-4o, etc.)
        // Future: Add Google models (gemini-1.5-pro, etc.)
        // For now, focus on Anthropic Claude as the default provider

        error_log('LocalGatewayModelMetadataDirectory: Returning ' . count($modelMap) . ' models');
        return $modelMap;
    }
}
