<?php

declare(strict_types=1);

namespace WordPress\LocalGatewayAiProvider\Metadata;

use WordPress\AiClient\Providers\Contracts\ModelMetadataDirectoryInterface;
use WordPress\AiClient\Providers\Models\DTO\ModelMetadata;
use WordPress\AiClient\Providers\Models\DTO\SupportedOption;
use WordPress\AiClient\Providers\Models\Enums\CapabilityEnum;
use WordPress\AiClient\Providers\Models\Enums\OptionEnum;

/**
 * Model metadata directory for the Local AI Gateway.
 *
 * Exposes text generation and image generation models available through the
 * Local Gateway. Models are determined by the NEXUS_AI_PROVIDER constant
 * (set by the nexus-ai-connector-config.php MU plugin) which mirrors the
 * global AI provider preference in Local.
 *
 * The gateway routes requests to the underlying provider (Anthropic, OpenAI,
 * Google) based on the model ID via MODEL_PROVIDER_MAP in AIGatewayRoutes.ts.
 *
 * @since 1.0.0
 */
class LocalGatewayModelMetadataDirectory implements ModelMetadataDirectoryInterface
{
    /** @var array<string, ModelMetadata>|null */
    private $modelCache = null;

    /** {@inheritDoc} */
    public function listModelMetadata(): array
    {
        if ($this->modelCache !== null) {
            return array_values($this->modelCache);
        }
        $this->modelCache = $this->getAvailableModels();
        return array_values($this->modelCache);
    }

    /** {@inheritDoc} */
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

    /** {@inheritDoc} */
    public function hasModelMetadata(string $modelId): bool
    {
        if ($this->modelCache === null) {
            $this->modelCache = $this->getAvailableModels();
        }
        return isset($this->modelCache[$modelId]);
    }

    /**
     * Build the model map for the currently configured provider.
     *
     * @return array<string, ModelMetadata>
     */
    private function getAvailableModels(): array
    {
        $provider = defined('NEXUS_AI_PROVIDER') ? NEXUS_AI_PROVIDER : 'anthropic';
        $modelMap = [];

        // --- Text generation capabilities / options (shared) ---
        $textCaps = [
            CapabilityEnum::textGeneration(),
            CapabilityEnum::chatHistory(),
        ];
        $textOpts = [
            new SupportedOption(OptionEnum::systemInstruction()),
            new SupportedOption(OptionEnum::maxTokens()),
            new SupportedOption(OptionEnum::temperature()),
            new SupportedOption(OptionEnum::topP()),
            new SupportedOption(OptionEnum::stopSequences()),
            new SupportedOption(OptionEnum::candidateCount()),
            new SupportedOption(OptionEnum::inputModalities()),
            new SupportedOption(OptionEnum::outputModalities()),
        ];

        // --- Image generation capabilities / options ---
        $imageCaps = [
            CapabilityEnum::imageGeneration(),
        ];
        // These three options are required by Generate_Image ability:
        // - inputModalities: fromPromptData() adds this for every text prompt
        // - outputModalities: generateImageResult() calls includeOutputModalities(image)
        // - outputFileType: as_output_file_type(FileTypeEnum::inline()) is called before generation
        // SupportedOption with no value argument sets supportedValues=null → isSupportedValue() returns true for any value.
        $imageOpts = [
            new SupportedOption(OptionEnum::inputModalities()),
            new SupportedOption(OptionEnum::outputModalities()),
            new SupportedOption(OptionEnum::outputFileType()),
        ];

        // -----------------------------------------------------------------------
        // Text models
        // -----------------------------------------------------------------------
        if ($provider === 'openai') {
            $textModels = [
                'gpt-4.1'      => 'GPT-4.1',
                'gpt-4.1-mini' => 'GPT-4.1 Mini',
                'gpt-4.1-nano' => 'GPT-4.1 Nano',
                'gpt-4o'       => 'GPT-4o',
                'gpt-4o-mini'  => 'GPT-4o Mini',
            ];
        } elseif ($provider === 'google') {
            $textModels = [
                'gemini-2.5-pro'        => 'Gemini 2.5 Pro',
                'gemini-2.5-flash'      => 'Gemini 2.5 Flash',
                'gemini-2.0-flash'      => 'Gemini 2.0 Flash',
                'gemini-2.0-flash-lite' => 'Gemini 2.0 Flash Lite',
                'gemini-1.5-pro'        => 'Gemini 1.5 Pro',
                'gemini-1.5-flash'      => 'Gemini 1.5 Flash',
            ];
        } else {
            // Default: Anthropic Claude models (current IDs)
            $textModels = [
                'claude-opus-4-6'           => 'Claude Opus 4.6',
                'claude-sonnet-4-6'         => 'Claude Sonnet 4.6',
                'claude-haiku-4-5-20251001' => 'Claude Haiku 4.5',
            ];
        }

        foreach ($textModels as $modelId => $modelName) {
            $modelMap[$modelId] = new ModelMetadata(
                $modelId,
                $modelName,
                $textCaps,
                $textOpts,
                'local-gateway'
            );
        }

        // -----------------------------------------------------------------------
        // Image generation models (only for providers that support it)
        // -----------------------------------------------------------------------
        if ($provider === 'openai') {
            $imageModels = [
                'gpt-image-1'      => 'GPT Image 1',
                'gpt-image-1.5'    => 'GPT Image 1.5',
                'gpt-image-1-mini' => 'GPT Image 1 Mini',
                'dall-e-3'         => 'DALL·E 3',
                'dall-e-2'         => 'DALL·E 2',
            ];
        } elseif ($provider === 'google') {
            $imageModels = [
                'imagen-4.0-generate-001'       => 'Imagen 4',
                'imagen-4.0-ultra-generate-001' => 'Imagen 4 Ultra',
                'imagen-4.0-fast-generate-001'  => 'Imagen 4 Fast',
            ];
        } else {
            $imageModels = []; // Anthropic has no image generation
        }

        foreach ($imageModels as $modelId => $modelName) {
            $modelMap[$modelId] = new ModelMetadata(
                $modelId,
                $modelName,
                $imageCaps,
                $imageOpts,
                'local-gateway'
            );
        }

        return $modelMap;
    }
}
