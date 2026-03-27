/**
 * Diagnostic test for Nexus AI Connector plugin
 *
 * Tests whether the connector can successfully send events to Local
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { McpClient } from './helpers/client';
import { getClient, getTestSite, expectSuccess, resultText } from './helpers/environment';

describe('17 — Connector Diagnostic', () => {
  let client: McpClient;
  let siteName: string;

  beforeAll(async () => {
    client = getClient();
    const site = getTestSite();
    siteName = site.name;
  });

  it('connector can send a test event to Local', async () => {
    // Build a simple test event
    const testCode = `
      if (!class_exists('Nexus_AI_Event_Builder')) {
        echo 'EVENT_BUILDER_NOT_FOUND';
        exit;
      }
      if (!class_exists('Nexus_AI_HTTP_Client')) {
        echo 'HTTP_CLIENT_NOT_FOUND';
        exit;
      }

      // Create a valid test event (use site_initialized which doesn't require much payload)
      $event = [
        'site_id' => Nexus_AI_Config::get_site_id(),
        'event_type' => 'site_initialized',
        'timestamp' => time(),
        'payload' => ['message' => 'Diagnostic test from WordPress'],
      ];

      // Try to send it
      $result = Nexus_AI_HTTP_Client::send_event_sync($event);

      if (is_wp_error($result)) {
        echo 'ERROR:' . $result->get_error_message();
      } else {
        echo 'SUCCESS:HTTP_' . $result['code'];
      }
    `;

    const result = await client.callTool('wp_eval', { site: siteName, code: testCode });
    expectSuccess(result);

    const output = resultText(result).trim();
    console.log(`[Diagnostic] Connector send result: ${output}`);

    // Should successfully send and get HTTP 200
    expect(output).not.toContain('NOT_FOUND');
    expect(output).not.toContain('ERROR:');
    expect(output).toContain('SUCCESS:HTTP_200');
  }, 15000);

  it('connector configuration is correct', async () => {
    const configCode = `
      $config = Nexus_AI_Config::get_config();
      if (!$config) {
        echo 'NOT_CONFIGURED';
        exit;
      }

      echo 'source:' . $config['source'] . '\\n';
      echo 'url:' . $config['url'] . '\\n';
      echo 'token_length:' . strlen($config['token']);
    `;

    const result = await client.callTool('wp_eval', { site: siteName, code: configCode });
    expectSuccess(result);

    const output = resultText(result);
    console.log(`[Diagnostic] Connector config:\\n${output}`);

    expect(output).not.toContain('NOT_CONFIGURED');
    expect(output).toContain('source:constants');
    expect(output).toContain('url:http://127.0.0.1:');
    expect(output).toMatch(/token_length:\d+/);
  }, 10000);

  it('connector sends events with correct site_id', async () => {
    // First check what's actually defined in constants
    const constantsCheck = `
      if (defined('NEXUS_AI_SITE_ID')) {
        echo 'CONSTANT_DEFINED:' . NEXUS_AI_SITE_ID;
      } else {
        echo 'CONSTANT_NOT_DEFINED';
      }
    `;

    const constantResult = await client.callTool('wp_eval', { site: siteName, code: constantsCheck });
    expectSuccess(constantResult);
    const constantOutput = resultText(constantResult).trim();
    console.log(`[Diagnostic] Constant check: ${constantOutput}`);

    // Now check what get_site_id() returns
    const siteIdCode = `
      $site_id = Nexus_AI_Config::get_site_id();
      echo 'site_id:' . $site_id;
    `;

    const result = await client.callTool('wp_eval', { site: siteName, code: siteIdCode });
    expectSuccess(result);

    const output = resultText(result).trim();
    console.log(`[Diagnostic] Connector site_id check: ${output}`);

    // Extract the site_id value
    const match = output.match(/site_id:(.+)/);
    expect(match).not.toBeNull();
    const connectorSiteId = match![1].trim();

    console.log(`[Diagnostic] Site ID from connector: "${connectorSiteId}"`);

    // Should not be empty
    expect(connectorSiteId.length).toBeGreaterThan(0);

    // If constant is defined, they should match
    if (constantOutput.startsWith('CONSTANT_DEFINED:')) {
      const constantValue = constantOutput.replace('CONSTANT_DEFINED:', '');
      console.log(`[Diagnostic] Constant value: "${constantValue}", get_site_id(): "${connectorSiteId}"`);
      expect(connectorSiteId).toBe(constantValue);
    } else {
      console.warn('[Diagnostic] NEXUS_AI_SITE_ID constant is not defined - MU plugin may not have been written correctly');
    }
  }, 10000);
});
