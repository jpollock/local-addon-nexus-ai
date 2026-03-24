<?php

declare(strict_types=1);

namespace WordPress\LocalGatewayAiProvider\Models;

use WordPress\AiClient\Providers\Http\DTO\Request;
use WordPress\AiClient\Providers\Http\DTO\RequestOptions;
use WordPress\AiClient\Providers\Http\Enums\HttpMethodEnum;
use WordPress\AiClient\Providers\OpenAiCompatibleImplementation\AbstractOpenAiCompatibleTextGenerationModel;
use WordPress\LocalGatewayAiProvider\Provider\LocalGatewayProvider;

/**
 * Class for a Local Gateway text generation model.
 *
 * The Local Gateway exposes an OpenAI-compatible /chat/completions endpoint,
 * so this class only needs to implement createRequest() and add the auth token.
 * All request formatting and response parsing is handled by the base class.
 *
 * @since 1.0.0
 */
class LocalGatewayTextGenerationModel extends AbstractOpenAiCompatibleTextGenerationModel
{
    /**
     * Constructor.
     *
     * @since 1.0.0
     */
    public function __construct($modelMetadata, $providerMetadata)
    {
        error_log('LocalGatewayTextGenerationModel::__construct() called');
        try {
            parent::__construct($modelMetadata, $providerMetadata);

            // Set 30-second timeout for gateway + provider API call
            $options = new RequestOptions();
            $options->setTimeout(30);
            $this->setRequestOptions($options);

            error_log('LocalGatewayTextGenerationModel: Parent constructor succeeded, timeout set to 30s');
        } catch (\Exception $e) {
            error_log('LocalGatewayTextGenerationModel: Parent constructor ERROR: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * {@inheritDoc}
     *
     * Adds X-Auth-Token header for gateway authentication.
     *
     * @since 1.0.0
     */
    protected function createRequest(HttpMethodEnum $method, string $path, array $headers = [], $data = null): Request
    {
        $url = LocalGatewayProvider::url($path);
        error_log('LocalGatewayTextGenerationModel::createRequest() path=' . $path . ' url=' . $url);

        // Add auth token header (read from constant set by Nexus AI mu-plugin)
        if (defined('NEXUS_AI_GATEWAY_TOKEN')) {
            $headers['X-Auth-Token'] = NEXUS_AI_GATEWAY_TOKEN;
            error_log('LocalGatewayTextGenerationModel: Added X-Auth-Token header');
        } else {
            error_log('LocalGatewayTextGenerationModel: WARNING - NEXUS_AI_GATEWAY_TOKEN not defined');
        }

        return new Request(
            $method,
            $url,
            $headers,
            $data,
            $this->getRequestOptions()
        );
    }
}
