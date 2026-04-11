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
        if ($this->modelCache !== null) {
            return array_values($this->modelCache);
        }

        $this->modelCache = $this->getAvailableModels();
        return array_values($this->modelCache);
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    public function getModelMetadata(string $modelId): ModelMetadata
    {

        if ($this->modelCache === null) {
            $this->modelCache = $this->getAvailableModels();
        }

        if (!isset($this->modelCache[$modelId])) {
            throw new \InvalidArgumentException(
                sprintf('Model "%s" not available through Local Gateway', $modelId)
            );
        }

        return $this->modelCache[$modelId];
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    public function hasModelMetadata(string $modelId): bool
    {

        if ($this->modelCache === null) {
            $this->modelCache = $this->getAvailableModels();
        }

        $hasModel = isset($this->modelCache[$modelId]);

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
        $modelMap = [];

        // Standard capabilities and options for all text generation models
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
        ];

        // Models are determined by the provider the gateway is currently routing to.
        // NEXUS_AI_PROVIDER is set by the nexus-ai-connector-config.php MU plugin
        // and mirrors the global AI provider preference in Local.
        $provider = defined('NEXUS_AI_PROVIDER') ? NEXUS_AI_PROVIDER : 'anthropic';

        if ($provider === 'openai') {
            $models = [
                'gpt-4o-mini' => 'GPT-4o Mini',
                'gpt-4o'      => 'GPT-4o',
                'gpt-4.1'     => 'GPT-4.1',
            ];
        } else {
            // Default: Anthropic Claude models
            $models = [
                'claude-haiku-4-5-20251001'  => 'Claude Haiku 4.5',
                'claude-sonnet-4-5-20250514' => 'Claude Sonnet 4.5',
                'claude-opus-4-6-20251015'   => 'Claude Opus 4.6',
            ];
        }

        foreach ($models as $modelId => $modelName) {
            $modelMap[$modelId] = new ModelMetadata(
                $modelId,
                $modelName,
                $capabilities,
                $options,
                'local-gateway'
            );
        }

        return $modelMap;
    }
}
