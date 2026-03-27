/**
 * Site Generator for Stress Tests
 *
 * Creates multiple test sites for fleet-scale testing.
 * Can create real sites or use fixtures for testing.
 */

import { McpClient } from '../../e2e/helpers/client';

export interface SiteConfig {
  name: string;
  wpVersion?: string;
  phpVersion?: string;
  blueprint?: string;
}

export class SiteGenerator {
  constructor(private client: McpClient) {}

  /**
   * Create multiple test sites
   */
  async createSites(configs: SiteConfig[]): Promise<string[]> {
    const siteNames: string[] = [];

    for (const config of configs) {
      try {
        const result = await this.client.callTool('local_create_site', {
          name: config.name,
          wpVersion: config.wpVersion,
          phpVersion: config.phpVersion,
          blueprint: config.blueprint,
        });

        if (!result.isError) {
          siteNames.push(config.name);
          console.log(`[SiteGenerator] Created site: ${config.name}`);
        } else {
          console.error(`[SiteGenerator] Failed to create site: ${config.name}`, result.content[0]?.text);
        }
      } catch (err) {
        console.error(`[SiteGenerator] Error creating site: ${config.name}`, err);
      }

      // Small delay to avoid overwhelming Local
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return siteNames;
  }

  /**
   * Delete multiple test sites
   */
  async deleteSites(siteNames: string[]): Promise<void> {
    for (const name of siteNames) {
      try {
        await this.client.callTool('local_delete_site', { site: name });
        console.log(`[SiteGenerator] Deleted site: ${name}`);
      } catch (err) {
        console.error(`[SiteGenerator] Error deleting site: ${name}`, err);
      }

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  /**
   * Generate site configs for stress testing
   */
  static generateConfigs(count: number, prefix: string = 'stress-test'): SiteConfig[] {
    const configs: SiteConfig[] = [];

    for (let i = 1; i <= count; i++) {
      configs.push({
        name: `${prefix}-${i}`,
        wpVersion: '6.4',
        phpVersion: '8.1',
      });
    }

    return configs;
  }

  /**
   * Create fixture data without creating real sites
   * (for testing at scale without resource constraints)
   */
  static createFixtures(count: number): Array<{ id: string; name: string; domain: string }> {
    const fixtures: Array<{ id: string; name: string; domain: string }> = [];

    for (let i = 1; i <= count; i++) {
      const name = `stress-fixture-${i}`;
      fixtures.push({
        id: name,
        name,
        domain: `${name}.local`,
      });
    }

    return fixtures;
  }
}
