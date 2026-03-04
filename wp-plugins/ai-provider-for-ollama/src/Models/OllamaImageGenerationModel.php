<?php

declare(strict_types=1);

namespace WordPress\OllamaAiProvider\Models;

use WordPress\AiClient\Common\Exception\InvalidArgumentException;
use WordPress\AiClient\Common\Exception\RuntimeException;
use WordPress\AiClient\Files\DTO\File;
use WordPress\AiClient\Files\Enums\FileTypeEnum;
use WordPress\AiClient\Messages\DTO\Message;
use WordPress\AiClient\Messages\DTO\TextMessagePart;
use WordPress\AiClient\Messages\Enums\MessageRoleEnum;
use WordPress\AiClient\Providers\ApiBasedImplementation\AbstractApiBasedModel;
use WordPress\AiClient\Providers\Http\DTO\Request;
use WordPress\AiClient\Providers\Http\DTO\RequestOptions;
use WordPress\AiClient\Providers\Http\Enums\HttpMethodEnum;
use WordPress\AiClient\Providers\Models\ImageGeneration\Contracts\ImageGenerationModelInterface;
use WordPress\AiClient\Results\DTO\Candidate;
use WordPress\AiClient\Results\DTO\GenerativeAiResult;
use WordPress\AiClient\Results\Enums\FinishReasonEnum;

/**
 * Class for an Ollama image generation model.
 *
 * CURRENTLY DISABLED: This class is ready for use but image generation is disabled
 * because Ollama's image models (x/z-image-turbo, flux, etc.) timeout and aren't
 * production-ready yet. To enable in the future:
 * 1. Remove the skip logic in OllamaModelMetadataDirectory.php (line ~172)
 * 2. Remove the experiment filter in plugin.php (ai_experiments_available filter)
 * 3. Ensure timeout is set to 120+ seconds in plugin.php http_request_args filter
 *
 * Unlike text generation models, Ollama image generation models use the
 * native Ollama API endpoint (/api/generate) rather than the OpenAI-compatible
 * endpoint (/v1/chat/completions). This class implements the ImageGenerationModelInterface
 * and handles the Ollama-specific request/response format.
 *
 * @since 1.0.0
 */
class OllamaImageGenerationModel extends AbstractApiBasedModel implements ImageGenerationModelInterface
{
    /**
     * Constructor.
     *
     * @since 1.0.0
     */
    public function __construct($modelMetadata, $providerMetadata)
    {
        error_log('OllamaImageGenerationModel::__construct() called for model: ' . $modelMetadata->getId());
        try {
            parent::__construct($modelMetadata, $providerMetadata);

            // Image generation can take 30-120 seconds depending on model complexity
            $options = new RequestOptions();
            $options->setTimeout(120);  // 2 minutes
            $this->setRequestOptions($options);

            error_log('OllamaImageGenerationModel: Constructor succeeded, timeout set to 120s');
        } catch (\Exception $e) {
            error_log('OllamaImageGenerationModel: Constructor ERROR: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * Generate an image based on the provided prompt.
     *
     * @since 1.0.0
     *
     * @param array $prompt Array of Message objects containing the text prompt.
     * @return GenerativeAiResult The generated image result.
     * @throws InvalidArgumentException If the prompt is invalid.
     * @throws RuntimeException If image generation fails.
     */
    public function generateImageResult(array $prompt): GenerativeAiResult
    {
        error_log('OllamaImageGenerationModel::generateImageResult() called');

        // Extract prompt text from Message array
        $promptText = $this->extractPromptText($prompt);
        error_log('OllamaImageGenerationModel: Extracted prompt text: ' . substr($promptText, 0, 100));

        // Build request data for Ollama's native /api/generate endpoint
        $requestData = [
            'model' => $this->metadata()->getId(),
            'prompt' => $promptText,
            'stream' => false,
        ];

        // Add custom options if provided (e.g., seed, width, height)
        $customOptions = $this->getConfig()->getCustomOptions();
        if (!empty($customOptions)) {
            $requestData['options'] = $customOptions;
            error_log('OllamaImageGenerationModel: Added custom options: ' . json_encode($customOptions));
        }

        // Create HTTP request to Ollama's native API
        $request = $this->createRequest(
            HttpMethodEnum::post(),
            '/api/generate',
            ['Content-Type' => 'application/json'],
            json_encode($requestData)
        );

        error_log('OllamaImageGenerationModel: Sending request to Ollama...');

        // Send the request
        try {
            $response = $this->getHttpTransporter()->send($request, $this->getRequestOptions());
            error_log('OllamaImageGenerationModel: Received response');
        } catch (\Exception $e) {
            error_log('OllamaImageGenerationModel: Request failed: ' . $e->getMessage());
            throw new RuntimeException('Failed to connect to Ollama server: ' . $e->getMessage());
        }

        // Parse Ollama's response
        $responseBody = $response->getBody();
        $data = json_decode($responseBody, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            error_log('OllamaImageGenerationModel: JSON decode error: ' . json_last_error_msg());
            throw new RuntimeException('Invalid JSON response from Ollama: ' . json_last_error_msg());
        }

        // Validate response contains image data
        if (empty($data['image'])) {
            error_log('OllamaImageGenerationModel: Response missing image data. Response: ' . $responseBody);
            throw new RuntimeException('Ollama response missing image data. Response: ' . substr($responseBody, 0, 200));
        }

        error_log('OllamaImageGenerationModel: Successfully received image data (length: ' . strlen($data['image']) . ' chars)');

        // Create File DTO with base64 image data
        $file = File::fromArray([
            'fileType' => FileTypeEnum::inline()->value,
            'base64Data' => $data['image'],
            'mimeType' => 'image/png',  // Ollama returns PNG format
        ]);

        // Create Message containing the File part
        $message = Message::fromArray([
            'role' => MessageRoleEnum::model()->value,
            'parts' => [$file->toArray()],
        ]);

        // Create Candidate with the message
        $candidate = Candidate::fromArray([
            'message' => $message->toArray(),
            'finishReason' => FinishReasonEnum::stop()->value,
        ]);

        // Create and return GenerativeAiResult
        $result = GenerativeAiResult::fromArray([
            'id' => uniqid('ollama-img-'),
            'candidates' => [$candidate->toArray()],
            'providerMetadata' => $this->providerMetadata()->toArray(),
            'modelMetadata' => $this->metadata()->toArray(),
        ]);

        error_log('OllamaImageGenerationModel: Successfully created GenerativeAiResult');
        return $result;
    }

    /**
     * Create an HTTP request for Ollama's native API.
     *
     * Note: This uses the base Ollama URL (localhost:11434) WITHOUT the /v1 prefix
     * that is used for OpenAI-compatible endpoints.
     *
     * @since 1.0.0
     *
     * @param HttpMethodEnum $method The HTTP method.
     * @param string $path The API path (e.g., '/api/generate').
     * @param array $headers Optional headers.
     * @param mixed $data Optional request body.
     * @return Request The HTTP request object.
     */
    protected function createRequest(
        HttpMethodEnum $method,
        string $path,
        array $headers = [],
        $data = null
    ): Request {
        // Use Ollama base URL without /v1 prefix for native API
        $url = 'http://localhost:11434' . $path;
        error_log('OllamaImageGenerationModel::createRequest() path=' . $path . ' url=' . $url);

        return new Request(
            $method,
            $url,
            $headers,
            $data,
            $this->getRequestOptions()
        );
    }

    /**
     * Extract text content from the prompt message array.
     *
     * WordPress AI Client passes prompts as an array of Message objects.
     * This method extracts the text from the first TextMessagePart found.
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

        $message = $prompt[0];
        $parts = $message->getParts();

        foreach ($parts as $part) {
            if ($part instanceof TextMessagePart) {
                return $part->getText();
            }
        }

        throw new InvalidArgumentException('No text content found in prompt');
    }
}
