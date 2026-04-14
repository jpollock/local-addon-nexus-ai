<?php

declare(strict_types=1);

namespace WordPress\LocalGatewayAiProvider\Models;

use WordPress\AiClient\Common\Exception\InvalidArgumentException;
use WordPress\AiClient\Common\Exception\RuntimeException;
use WordPress\AiClient\Files\DTO\File;
use WordPress\AiClient\Messages\DTO\Message;
use WordPress\AiClient\Messages\DTO\MessagePart;
use WordPress\AiClient\Messages\Enums\MessageRoleEnum;
use WordPress\AiClient\Providers\ApiBasedImplementation\AbstractApiBasedModel;
use WordPress\AiClient\Providers\Http\DTO\Request;
use WordPress\AiClient\Providers\Http\DTO\RequestOptions;
use WordPress\AiClient\Providers\Http\Enums\HttpMethodEnum;
use WordPress\AiClient\Providers\Models\ImageGeneration\Contracts\ImageGenerationModelInterface;
use WordPress\AiClient\Results\DTO\Candidate;
use WordPress\AiClient\Results\DTO\GenerativeAiResult;
use WordPress\AiClient\Results\Enums\FinishReasonEnum;
use WordPress\LocalGatewayAiProvider\Provider\LocalGatewayProvider;

/**
 * Image generation model for the Local AI Gateway.
 *
 * Sends requests to /ai-gateway/v1/images/generations (OpenAI-compatible).
 * The gateway routes to the appropriate provider (OpenAI DALL-E / GPT-Image,
 * or Google Imagen) based on the model ID.
 *
 * Always requests b64_json so no public URL is needed — the image is returned
 * inline and imported directly into the WordPress media library.
 *
 * @since 1.0.0
 */
class LocalGatewayImageGenerationModel extends AbstractApiBasedModel implements ImageGenerationModelInterface
{
    /**
     * Constructor.
     *
     * @since 1.0.0
     */
    public function __construct($modelMetadata, $providerMetadata)
    {
        parent::__construct($modelMetadata, $providerMetadata);

        // Image generation can be slow (10-120s)
        $options = new RequestOptions();
        $options->setTimeout(120);
        $this->setRequestOptions($options);
    }

    /**
     * Generate an image from the provided prompt.
     *
     * @since 1.0.0
     *
     * @param array $prompt Array of Message objects.
     * @return GenerativeAiResult The generated image result.
     * @throws InvalidArgumentException If the prompt is empty.
     * @throws RuntimeException If image generation fails.
     */
    public function generateImageResult(array $prompt): GenerativeAiResult
    {
        $promptText = $this->extractPromptText($prompt);

        $requestData = json_encode([
            'model'           => $this->metadata()->getId(),
            'prompt'          => $promptText,
            'n'               => 1,
            'response_format' => 'b64_json',
        ]);

        $request = $this->createRequest(
            HttpMethodEnum::post(),
            '/images/generations',
            ['Content-Type' => 'application/json'],
            $requestData
        );

        try {
            $response = $this->getHttpTransporter()->send($request, $this->getRequestOptions());
        } catch (\Exception $e) {
            throw new RuntimeException('Failed to connect to Local AI Gateway: ' . $e->getMessage());
        }

        $body = $response->getBody();
        $data = json_decode($body, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new RuntimeException('Invalid JSON response from gateway: ' . json_last_error_msg());
        }

        // Check for gateway-level error
        if (!empty($data['error'])) {
            throw new RuntimeException('Gateway image error: ' . ($data['error']['message'] ?? 'Unknown error'));
        }

        $b64 = $data['data'][0]['b64_json'] ?? '';
        if (empty($b64)) {
            throw new RuntimeException('No image data in gateway response.');
        }

        // Build result using direct constructors — fromArray() chains fail because
        // File::toArray() returns {fileType,base64Data,mimeType} but MessagePart::fromArray()
        // expects the file nested under the 'file' key: {'file': {...}}.
        $file    = new File($b64, 'image/png');
        $part    = new MessagePart($file);
        $message = new Message(MessageRoleEnum::model(), [$part]);

        $candidate = Candidate::fromArray([
            'message'      => $message->toArray(),
            'finishReason' => FinishReasonEnum::stop()->value,
        ]);

        return GenerativeAiResult::fromArray([
            'id'               => uniqid('gateway-img-'),
            'candidates'       => [$candidate->toArray()],
            'providerMetadata' => $this->providerMetadata()->toArray(),
            'modelMetadata'    => $this->metadata()->toArray(),
        ]);
    }

    /**
     * Build an HTTP request for the Local AI Gateway.
     * Adds X-Auth-Token and X-WP-Site-ID headers for gateway authentication.
     *
     * @since 1.0.0
     */
    protected function createRequest(HttpMethodEnum $method, string $path, array $headers = [], $data = null): Request
    {
        $url = LocalGatewayProvider::url($path);

        if (defined('NEXUS_AI_AUTH_TOKEN')) {
            $headers['X-Auth-Token'] = NEXUS_AI_AUTH_TOKEN;
        } elseif (defined('NEXUS_AI_GATEWAY_TOKEN')) {
            $headers['X-Auth-Token'] = NEXUS_AI_GATEWAY_TOKEN;
        }

        if (defined('NEXUS_AI_SITE_ID')) {
            $headers['X-WP-Site-ID'] = NEXUS_AI_SITE_ID;
        }

        return new Request($method, $url, $headers, $data, $this->getRequestOptions());
    }

    /**
     * Extract text content from the prompt message array.
     *
     * @since 1.0.0
     *
     * @param array $prompt Array of Message objects.
     * @return string The extracted prompt text.
     * @throws InvalidArgumentException If no text content is found.
     */
    private function extractPromptText(array $prompt): string
    {
        if (empty($prompt)) {
            throw new InvalidArgumentException('Prompt cannot be empty');
        }

        foreach ($prompt[0]->getParts() as $part) {
            if ($part->getType()->isText() && $part->getText() !== null) {
                return $part->getText();
            }
        }

        throw new InvalidArgumentException('No text content found in prompt');
    }
}
