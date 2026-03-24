<?php

/**
 * Simple PSR-4 autoloader for Local Gateway AI Provider.
 *
 * @package WordPress\LocalGatewayAiProvider
 */

declare(strict_types=1);

spl_autoload_register(function ($class) {
    $prefix = 'WordPress\\LocalGatewayAiProvider\\';
    $baseDir = __DIR__ . '/';

    $len = strlen($prefix);
    if (strncmp($prefix, $class, $len) !== 0) {
        return;
    }

    $relativeClass = substr($class, $len);
    $file = $baseDir . str_replace('\\', '/', $relativeClass) . '.php';

    if (file_exists($file)) {
        require $file;
    }
});
