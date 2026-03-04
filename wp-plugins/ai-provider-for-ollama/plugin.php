<?php

/**
 * Plugin Name: AI Provider for Ollama
 * Plugin URI: https://github.com/getflywheel/local-addon-nexus-ai
 * Description: AI Provider for Ollama for the WordPress AI Client. Connects to a locally running Ollama instance — no API keys required.
 * Requires at least: 6.9
 * Requires PHP: 7.4
 * Version: 1.0.0
 * Author: WP Engine
 * License: GPL-2.0-or-later
 * License URI: https://spdx.org/licenses/GPL-2.0-or-later.html
 * Text Domain: ai-provider-for-ollama
 *
 * @package WordPress\OllamaAiProvider
 */

declare(strict_types=1);

namespace WordPress\OllamaAiProvider;

use WordPress\AiClient\AiClient;
use WordPress\OllamaAiProvider\Provider\OllamaProvider;

if (!defined('ABSPATH')) {
    return;
}

require_once __DIR__ . '/src/autoload.php';

/**
 * Registers the AI Provider for Ollama with the AI Client.
 *
 * IMPORTANT: This registers with whichever registry is active.
 * The 'ai' plugin bundles its own php-ai-client which creates a separate registry.
 * We register on 'init' priority 5 to run early, and again on priority 10
 * to catch both core and plugin registries.
 *
 * @since 1.0.0
 *
 * @return void
 */
function register_provider(): void
{
    if (!class_exists(AiClient::class)) {
        return;
    }

    $registry = AiClient::defaultRegistry();

    // Always try to register, even if already registered (might be different registry)
    try {
        if (!$registry->hasProvider('ollama')) {
            $registry->registerProvider(OllamaProvider::class);

            // Set up HTTP transporter using WordPress HTTP API
            if (class_exists('WordPress\\AiClient\\Providers\\Http\\WordPressHttpTransporter')) {
                $httpTransporter = new \WordPress\AiClient\Providers\Http\WordPressHttpTransporter();
                $registry->setHttpTransporter('ollama', $httpTransporter);
            }

            // Set dummy API key credentials (Ollama doesn't need authentication, but framework requires it)
            $credentials = get_option('wp_ai_client_provider_credentials', []);
            if (!isset($credentials['ollama'])) {
                $credentials['ollama'] = 'ollama-local';
                update_option('wp_ai_client_provider_credentials', $credentials);
            }

            error_log('Ollama provider registered with registry ' . spl_object_hash($registry));
        }
    } catch (\Exception $e) {
        error_log('Ollama provider registration failed: ' . $e->getMessage());
    }
}

// Register very early (priority 1) to ensure it's available before any experiments initialize
add_action('init', __NAMESPACE__ . '\\register_provider', 1);

// Register again at priority 5 and 10 to catch any late-loading registries
add_action('init', __NAMESPACE__ . '\\register_provider', 5);
add_action('init', __NAMESPACE__ . '\\register_provider', 10);

// Prepend Ollama models to the experiment preferred models list.
add_filter('ai_experiments_preferred_models_for_text_generation', function ($models) {
    if (!class_exists(AiClient::class)) {
        error_log('Ollama filter: AiClient class not found');
        return $models;
    }

    $registry = AiClient::defaultRegistry();
    // Check by provider ID, not class name
    if (!$registry->hasProvider('ollama')) {
        error_log('Ollama filter: Provider not registered');
        return $models;
    }

    // Also check if it's configured
    if (!$registry->isProviderConfigured('ollama')) {
        error_log('Ollama filter: Provider not configured');
        return $models;
    }

    try {
        $modelMetadataList = OllamaProvider::modelMetadataDirectory()->listModelMetadata();

        $ollamaModels = [];
        foreach ($modelMetadataList as $modelMetadata) {
            // Only add text generation models to this filter
            $hasTextGeneration = false;
            foreach ($modelMetadata->getSupportedCapabilities() as $capability) {
                if ($capability->isTextGeneration()) {
                    $hasTextGeneration = true;
                    break;
                }
            }

            if ($hasTextGeneration) {
                // Format: [providerId, modelId] - numeric indexed array
                $ollamaModels[] = ['ollama', $modelMetadata->getId()];
            }
        }

        return array_merge($ollamaModels, $models);
    } catch (\Exception $e) {
        error_log('Ollama filter error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        return $models;
    }
});

// Disable image generation experiment
// Ollama DOES support image generation models (x/z-image-turbo, flux, etc.) BUT they
// timeout and aren't production-ready yet. The implementation exists in
// OllamaImageGenerationModel.php and can be enabled when Ollama's image models become stable.
add_filter('ai_experiments_available', function ($experiments) {
    if (isset($experiments['image_generation'])) {
        unset($experiments['image_generation']);
        error_log('Ollama: Disabled image_generation experiment (models timeout - not production-ready)');
    }
    return $experiments;
}, 20);

// Allow localhost requests to Ollama
add_filter('http_request_host_is_external', function ($is_external, $host, $url) {
    // Allow localhost for Ollama API calls
    if ($host === 'localhost' && strpos($url, 'localhost:11434') !== false) {
        return true;
    }
    return $is_external;
}, 10, 3);

// Bypass WordPress localhost blocking for Ollama and increase timeout
add_filter('http_request_args', function ($args, $url) {
    if (strpos($url, 'localhost:11434') !== false) {
        $args['reject_unsafe_urls'] = false;
        $args['timeout'] = 60; // 60 seconds for model inference
    }
    return $args;
}, 10, 2);

// Bypass credential validation — Ollama needs no API keys.
add_filter('ai_experiments_pre_has_valid_credentials_check', function ($valid) {
    error_log('ai_experiments_pre_has_valid_credentials_check called with: ' . var_export($valid, true));

    if ($valid !== null) {
        error_log('  Returning early with: ' . var_export($valid, true));
        return $valid;
    }

    if (!class_exists(AiClient::class)) {
        error_log('  AiClient class not found');
        return $valid;
    }

    $registry = AiClient::defaultRegistry();
    $isConfigured = $registry->isProviderConfigured('ollama');
    error_log('  Ollama isProviderConfigured: ' . ($isConfigured ? 'YES' : 'NO'));

    if ($isConfigured) {
        error_log('  Returning TRUE for Ollama');
        return true;
    }

    error_log('  Returning NULL');
    return $valid;
});


// Debug: Log when WordPress searches for models
add_action('init', function() {
    if (!class_exists(AiClient::class)) {
        return;
    }

    $registry = AiClient::defaultRegistry();

    // Try to find text generation models through the registry
    try {
        $requirements = new \WordPress\AiClient\Providers\Models\DTO\ModelRequirements(
            [\WordPress\AiClient\Providers\Models\Enums\CapabilityEnum::textGeneration()],
            []
        );
        $results = $registry->findModelsMetadataForSupport($requirements);
        error_log('Registry findModelsMetadataForSupport returned ' . count($results) . ' provider groups');
        foreach ($results as $providerModels) {
            $providerId = $providerModels->getProvider()->getId();
            $models = $providerModels->getModels();
            error_log('  Provider ' . $providerId . ' has ' . count($models) . ' text generation models');
        }
    } catch (\Exception $e) {
        error_log('Registry search ERROR: ' . $e->getMessage());
    }
}, 999);
