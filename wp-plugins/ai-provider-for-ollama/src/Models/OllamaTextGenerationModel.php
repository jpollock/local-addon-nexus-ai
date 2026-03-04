<?php

declare(strict_types=1);

namespace WordPress\OllamaAiProvider\Models;

use WordPress\AiClient\Providers\Http\DTO\Request;
use WordPress\AiClient\Providers\Http\DTO\RequestOptions;
use WordPress\AiClient\Providers\Http\Enums\HttpMethodEnum;
use WordPress\AiClient\Providers\OpenAiCompatibleImplementation\AbstractOpenAiCompatibleTextGenerationModel;
use WordPress\OllamaAiProvider\Provider\OllamaProvider;

/**
 * Class for an Ollama text generation model.
 *
 * Since Ollama exposes an OpenAI-compatible /v1/chat/completions endpoint,
 * this class only needs to implement createRequest(). All request formatting
 * and response parsing is handled by the base class.
 *
 * @since 1.0.0
 */
class OllamaTextGenerationModel extends AbstractOpenAiCompatibleTextGenerationModel
{
    /**
     * Constructor.
     *
     * @since 1.0.0
     */
    public function __construct($modelMetadata, $providerMetadata)
    {
        error_log('OllamaTextGenerationModel::__construct() called');
        try {
            parent::__construct($modelMetadata, $providerMetadata);

            // Set 60-second timeout for local Ollama inference
            $options = new RequestOptions();
            $options->setTimeout(60);
            $this->setRequestOptions($options);

            error_log('OllamaTextGenerationModel: Parent constructor succeeded, timeout set to 60s');
        } catch (\Exception $e) {
            error_log('OllamaTextGenerationModel: Parent constructor ERROR: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * {@inheritDoc}
     *
     * @since 1.0.0
     */
    protected function createRequest(HttpMethodEnum $method, string $path, array $headers = [], $data = null): Request
    {
        $url = OllamaProvider::url($path);
        error_log('OllamaTextGenerationModel::createRequest() path=' . $path . ' url=' . $url);

        return new Request(
            $method,
            $url,
            $headers,
            $data,
            $this->getRequestOptions()
        );
    }
}
