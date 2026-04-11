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
     * Adds auth headers for the Local AI Gateway.
     *
     * The gateway validates X-Auth-Token against the webhook auth token
     * (NEXUS_AI_AUTH_TOKEN, set by the nexus-ai-connector-config.php MU plugin).
     * X-WP-Site-ID tells the gateway which site is making the request.
     *
     * @since 1.0.0
     */
    protected function createRequest(HttpMethodEnum $method, string $path, array $headers = [], $data = null): Request
    {
        $url = LocalGatewayProvider::url($path);

        // Use the webhook auth token — it's stable across Local restarts
        // and is stored in http_webhook_info on the gateway side.
        if (defined('NEXUS_AI_AUTH_TOKEN')) {
            $headers['X-Auth-Token'] = NEXUS_AI_AUTH_TOKEN;
        } elseif (defined('NEXUS_AI_GATEWAY_TOKEN')) {
            // Fallback for older MU plugins that don't set NEXUS_AI_AUTH_TOKEN
            $headers['X-Auth-Token'] = NEXUS_AI_GATEWAY_TOKEN;
        }

        // Send site ID so the gateway can track usage per site
        if (defined('NEXUS_AI_SITE_ID')) {
            $headers['X-WP-Site-ID'] = NEXUS_AI_SITE_ID;
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
