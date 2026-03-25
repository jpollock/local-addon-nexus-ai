/**
 * Auto-Generate AI Context File
 *
 * Automatically generates AI-CONTEXT.md for sites on startup if missing.
 * Called by lifecycle hook in lifecycle-hooks.ts.
 *
 * Silently succeeds or logs errors — never throws.
 */
import { AIContextGenerator } from './AIContextGenerator';
import type { AIContextData } from './AIContextGenerator';
import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import type { RegistryStorage } from '../content/IndexRegistry';
import type { SiteMetadataCache } from '../metadata/SiteMetadataCache';

interface AutoGenerateLogger {
  info(...args: any[]): void;
  error(...args: any[]): void;
}

interface SiteInfo {
  id: string;
  name: string;
  path: string;
  url?: string;
  domain?: string;
  phpVersion?: string;
  mysqlPort?: number;
}

export async function autoGenerateContextFile(
  site: SiteInfo,
  localServices: LocalServicesBridge,
  metadataCache: SiteMetadataCache | undefined,
  registryStorage: RegistryStorage,
  logger: AutoGenerateLogger,
): Promise<void> {
  try {
    const fs = require('fs').promises;
    const path = require('path');

    // Check if file already exists
    const filePath = path.join(site.path, 'app', 'public', 'AI-CONTEXT.md');
    try {
      await fs.access(filePath);
      // File exists, no need to generate
      logger.info(`[NexusAI] AI context file already exists for ${site.name}, skipping auto-generation`);
      return;
    } catch {
      // File doesn't exist, continue with generation
    }

    // Get site metadata
    const metadata = metadataCache?.getWithAge(site.id);

    // Get AI Gateway info
    const proxyInfo = registryStorage.get('ai_proxy_info') as any;

    // Find active theme from metadata
    let activeTheme: AIContextData['theme'];
    if (metadata?.activeTheme && metadata?.themes) {
      const themeData = metadata.themes.find(t => t.name === metadata.activeTheme);
      if (themeData) {
        activeTheme = {
          name: themeData.name,
          title: themeData.title,
          version: themeData.version,
        };
      }
    }

    // Build AI context data
    const contextData: AIContextData = {
      siteName: site.name,
      siteUrl: site.url || `http://${site.domain}`,
      sitePath: site.path,
      wpVersion: metadata?.wpVersion,
      phpVersion: site.phpVersion,
      mysqlPort: site.mysqlPort,
      plugins: metadata?.plugins,
      theme: activeTheme,
      generatedAt: Date.now(),
    };

    // Add AI Gateway config if available
    if (proxyInfo?.url && proxyInfo?.authToken) {
      contextData.aiGateway = {
        url: proxyInfo.url,
        token: proxyInfo.authToken,
        models: proxyInfo.models ?? [],
      };
    }

    // Generate context markdown
    const generator = new AIContextGenerator();
    const markdown = generator.generateContext(contextData);

    // Write to site root
    await fs.writeFile(filePath, markdown, 'utf-8');

    logger.info(`[NexusAI] Auto-generated AI context file for ${site.name}: ${filePath}`);
  } catch (err) {
    // Log error but don't throw - this is a best-effort operation
    logger.error(`[NexusAI] Auto-generate context file failed for ${site.name}:`, err);
  }
}
