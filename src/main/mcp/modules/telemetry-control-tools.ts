/**
 * Telemetry Control MCP Tools
 *
 * Tools for managing anonymous usage analytics (opt-in/opt-out, status, reset).
 */

import type { McpToolHandler } from '../types';
import {
  isTelemetryEnabled,
  setTelemetryEnabled,
  getInstallationId,
  isRegistered,
  readConfig,
  readEvents,
  clearEvents,
  resetAnalytics,
} from '../../telemetry/telemetry-config';
import type { ToolRegistry } from '../tool-registry';

// ============================================================================
// Get Telemetry Status
// ============================================================================

const getTelemetryStatusTool: McpToolHandler = {
  definition: {
    name: 'get_telemetry_status',
    description: 'Get the current telemetry (anonymous usage analytics) status — whether it is enabled, the installation ID, and the number of queued events. Nexus AI collects anonymous usage data to improve the product. Use set_telemetry_enabled to opt in or out.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  async execute() {
    const config = readConfig();
    const events = readEvents();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              enabled: isTelemetryEnabled(),
              installation_id: getInstallationId(),
              registered: isRegistered(),
              registered_at: config.registeredAt || null,
              prompted_at: config.telemetry.promptedAt || null,
              queued_events: events.length,
              privacy_note:
                'Only anonymous metrics collected. No PII, site names, or WordPress data.',
              opt_out: 'Use set_telemetry_enabled with enabled=false to disable',
            },
            null,
            2,
          ),
        },
      ],
      isError: false,
    };
  },
};

// ============================================================================
// Enable/Disable Telemetry
// ============================================================================

const setTelemetryEnabledTool: McpToolHandler = {
  definition: {
    name: 'set_telemetry_enabled',
    description:
      'Enable or disable anonymous usage analytics (telemetry). Telemetry is enabled by default — set enabled=false to opt out. When disabled, no usage data is collected or transmitted. Can also be disabled permanently with NEXUS_TELEMETRY=0 environment variable.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'True to enable telemetry, false to disable',
        },
      },
      required: ['enabled'],
    },
  },

  async execute(args) {
    const enabled = args.enabled as boolean;

    setTelemetryEnabled(enabled);

    const message = enabled
      ? 'Anonymous usage analytics enabled. Thank you for helping improve Nexus AI!'
      : 'Anonymous usage analytics disabled. No data will be transmitted.';

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              enabled,
              message,
              installation_id: getInstallationId(),
            },
            null,
            2,
          ),
        },
      ],
      isError: false,
    };
  },
};

// ============================================================================
// Clear Queued Events
// ============================================================================

const clearTelemetryEventsTool: McpToolHandler = {
  definition: {
    name: 'clear_telemetry_events',
    description: 'Clear all queued telemetry events from local storage without transmitting them. Use when you want to discard accumulated events, such as after testing or development work. Does not disable telemetry — use set_telemetry_enabled(false) to stop future collection.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  async execute() {
    const beforeCount = readEvents().length;

    clearEvents();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              events_cleared: beforeCount,
              message: `Cleared ${beforeCount} queued telemetry events`,
            },
            null,
            2,
          ),
        },
      ],
      isError: false,
    };
  },
};

// ============================================================================
// Reset Analytics
// ============================================================================

const resetTelemetryTool: McpToolHandler = {
  definition: {
    name: 'reset_telemetry',
    description:
      'Reset telemetry completely — clears all queued events, regenerates the installation ID and secret key, and disables telemetry. Use when you want a completely fresh telemetry state, such as when sharing a machine or handing off to another user. This cannot be undone — the previous installation ID is permanently discarded.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm reset',
        },
      },
      required: ['confirm'],
    },
  },

  async execute(args) {
    const confirm = args.confirm as boolean;

    if (!confirm) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'Reset requires confirmation. Set confirm=true to proceed.',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    const oldInstallationId = getInstallationId();

    resetAnalytics();

    const newInstallationId = getInstallationId();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Telemetry reset complete',
              old_installation_id: oldInstallationId,
              new_installation_id: newInstallationId,
              telemetry_enabled: false,
              note: 'All queued events cleared and new credentials generated',
            },
            null,
            2,
          ),
        },
      ],
      isError: false,
    };
  },
};

// ============================================================================
// Registration
// ============================================================================

export function registerTelemetryControlTools(registry: ToolRegistry): void {
  registry.register(getTelemetryStatusTool);
  registry.register(setTelemetryEnabledTool);
  registry.register(clearTelemetryEventsTool);
  registry.register(resetTelemetryTool);
}
