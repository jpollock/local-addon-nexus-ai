/**
 * UpdateSettingsSchema validation tests
 *
 * Guards against the class of bug where a new settings field is added to
 * NexusSettings / ipc-handlers but forgotten in UpdateSettingsSchema.
 * Because the schema uses .strict(), forgotten fields are silently stripped
 * before reaching registryStorage — settings appear to save but don't persist.
 */

import { UpdateSettingsSchema, validateInput } from '../../../src/common/schemas';

const base = {
  autoIndex: true,
  excludedSiteIds: [],
};

describe('UpdateSettingsSchema — known fields are accepted', () => {
  it('accepts empty object (all fields optional)', () => {
    expect(() => validateInput(UpdateSettingsSchema, {})).not.toThrow();
  });

  it('accepts autoIndex + excludedSiteIds', () => {
    expect(() => validateInput(UpdateSettingsSchema, base)).not.toThrow();
  });

  it('accepts wpeOperationPermissions', () => {
    const perms = {
      wpeOperationPermissions: {
        wpcli: { production: false, staging: true, development: true },
        push:  { production: false, staging: true, development: true },
        pull:  { production: true,  staging: true, development: true },
        delete:{ production: false, staging: false, development: false },
      },
    };
    const result = validateInput(UpdateSettingsSchema, perms);
    expect(result.wpeOperationPermissions?.wpcli?.production).toBe(false);
    expect(result.wpeOperationPermissions?.push?.production).toBe(false);
  });

  it('accepts wpeOperationPermissions with partial env flags', () => {
    const perms = {
      wpeOperationPermissions: {
        wpcli: { production: true },
      },
    };
    const result = validateInput(UpdateSettingsSchema, perms);
    expect(result.wpeOperationPermissions?.wpcli?.production).toBe(true);
    expect(result.wpeOperationPermissions?.wpcli?.staging).toBeUndefined();
  });

  it('accepts wpeSiteExceptions', () => {
    const exceptions = {
      wpeSiteExceptions: [
        { installName: 'mystore', environment: 'production', overrides: { wpcli: true } },
      ],
    };
    const result = validateInput(UpdateSettingsSchema, exceptions);
    expect(result.wpeSiteExceptions).toHaveLength(1);
    expect(result.wpeSiteExceptions![0].installName).toBe('mystore');
    expect(result.wpeSiteExceptions![0].overrides.wpcli).toBe(true);
  });

  it('accepts multiple site exceptions', () => {
    const exceptions = {
      wpeSiteExceptions: [
        { installName: 'site-a', environment: 'production', overrides: { push: true, wpcli: true } },
        { installName: 'site-b', environment: 'staging',    overrides: { push: false } },
      ],
    };
    const result = validateInput(UpdateSettingsSchema, exceptions);
    expect(result.wpeSiteExceptions).toHaveLength(2);
  });

  it('accepts null wpeSiteExceptions (clear all exceptions)', () => {
    const result = validateInput(UpdateSettingsSchema, { wpeSiteExceptions: null });
    expect(result.wpeSiteExceptions).toBeNull();
  });

  it('accepts wpeAccountFilter', () => {
    const result = validateInput(UpdateSettingsSchema, { wpeAccountFilter: ['account-1', 'account-2'] });
    expect(result.wpeAccountFilter).toEqual(['account-1', 'account-2']);
  });

  it('accepts null wpeAccountFilter (include all accounts)', () => {
    const result = validateInput(UpdateSettingsSchema, { wpeAccountFilter: null });
    expect(result.wpeAccountFilter).toBeNull();
  });

  it('accepts wpeAllowedEnvironments (legacy migration field)', () => {
    expect(() => validateInput(UpdateSettingsSchema, {
      wpeAllowedEnvironments: ['staging', 'development'],
    })).not.toThrow();
  });

  it('accepts a slashed model id', () => {
    // Was "accepts aiProvider 'power' with a slashed model id (IW Phase 1)".
    // v0.6.0 removed 'power' from the enum, but the slash concern is unrelated
    // to which provider is set and is still worth pinning: a `vendor/model` id
    // must survive strict-mode parsing.
    const result = validateInput(UpdateSettingsSchema, {
      aiProvider: 'anthropic',
      aiModel: 'anthropic/claude-haiku-4-5',
    });
    expect(result.aiProvider).toBe('anthropic');
    expect(result.aiModel).toBe('anthropic/claude-haiku-4-5');
  });

  it('accepts full settings object with all v2 access control fields together', () => {
    const full = {
      ...base,
      wpeOperationPermissions: {
        wpcli: { production: false, staging: true, development: true },
        push:  { production: false, staging: true, development: true },
      },
      wpeSiteExceptions: [
        { installName: 'mystore', environment: 'production', overrides: { wpcli: true, push: true } },
      ],
      wpeAccountFilter: ['account-abc'],
    };
    const result = validateInput(UpdateSettingsSchema, full);
    expect(result.wpeOperationPermissions?.wpcli?.production).toBe(false);
    expect(result.wpeSiteExceptions).toHaveLength(1);
    expect(result.wpeAccountFilter).toEqual(['account-abc']);
  });

  it('accepts both external refresh keys', () => {
    const parsed = UpdateSettingsSchema.parse({
      externalRefreshAutoEnabled: true,
      externalRefreshIntervalHours: 12,
    });
    expect(parsed.externalRefreshAutoEnabled).toBe(true);
    expect(parsed.externalRefreshIntervalHours).toBe(12);
  });
});

describe('UpdateSettingsSchema — invalid values are rejected', () => {
  it('rejects unknown top-level fields (strict mode)', () => {
    expect(() => validateInput(UpdateSettingsSchema, {
      unknownField: 'should not pass',
    })).toThrow(/Validation failed/);
  });

  it('rejects wpeSiteExceptions with missing installName', () => {
    expect(() => validateInput(UpdateSettingsSchema, {
      wpeSiteExceptions: [{ environment: 'production', overrides: {} }],
    })).toThrow(/Validation failed/);
  });

  it('rejects wpeSiteExceptions with non-boolean override values', () => {
    expect(() => validateInput(UpdateSettingsSchema, {
      wpeSiteExceptions: [
        { installName: 'mystore', environment: 'production', overrides: { wpcli: 'yes' } },
      ],
    })).toThrow(/Validation failed/);
  });

  it('rejects wpeOperationPermissions with non-boolean env values', () => {
    expect(() => validateInput(UpdateSettingsSchema, {
      wpeOperationPermissions: { wpcli: { production: 'false' } },
    })).toThrow(/Validation failed/);
  });

  it('rejects an out-of-range externalRefreshIntervalHours', () => {
    expect(() => UpdateSettingsSchema.parse({ externalRefreshIntervalHours: 0 })).toThrow();
    expect(() => UpdateSettingsSchema.parse({ externalRefreshIntervalHours: 999 })).toThrow();
  });
});

describe('external content-index settings survive the strict schema', () => {
  it('accepts both keys', () => {
    const parsed = UpdateSettingsSchema.parse({
      externalContentIndexAutoEnabled: true,
      externalContentIndexIntervalHours: 12,
    });
    expect(parsed.externalContentIndexAutoEnabled).toBe(true);
    expect(parsed.externalContentIndexIntervalHours).toBe(12);
  });

  it('rejects an out-of-range interval', () => {
    expect(() => UpdateSettingsSchema.parse({ externalContentIndexIntervalHours: 0 })).toThrow();
    expect(() => UpdateSettingsSchema.parse({ externalContentIndexIntervalHours: 999 })).toThrow();
  });
});

describe('capabilityGrants survives the strict schema (WP-20b)', () => {
  it('accepts a grant carrying only its capability — the rest comes from shipped law', () => {
    const parsed = UpdateSettingsSchema.parse({
      capabilityGrants: [{ capability: 'cap.bulk_plugin_update' }],
    });
    expect(parsed.capabilityGrants).toEqual([{ capability: 'cap.bulk_plugin_update' }]);
  });

  it('accepts the enable toggle and the reviewed-document pin', () => {
    const parsed = UpdateSettingsSchema.parse({
      capabilityGrants: [
        {
          capability: 'cap.bulk_plugin_update',
          enabled: false,
          runbookId: 'rb.bulk-plugin-update',
          runbookHash: 'sha256:abc',
        },
      ],
    });
    expect(parsed.capabilityGrants?.[0].enabled).toBe(false);
    expect(parsed.capabilityGrants?.[0].runbookHash).toBe('sha256:abc');
  });

  it("keeps the runbook's own scope vocabulary, which is not the three remote environments", () => {
    // `wpe_staging` is not `staging`: coercing it would widen a grant to every
    // external staging host (WP-20a finding 5).
    const parsed = UpdateSettingsSchema.parse({
      capabilityGrants: [
        {
          capability: 'cap.bulk_plugin_update',
          scope: { environments: ['local', 'wpe_staging'], targetRefs: ['wpe:mystore'] },
        },
      ],
    });
    expect(parsed.capabilityGrants?.[0].scope).toEqual({
      environments: ['local', 'wpe_staging'],
      targetRefs: ['wpe:mystore'],
    });
  });

  it('rejects a grant with no capability — the key an override matches on', () => {
    expect(() => UpdateSettingsSchema.parse({ capabilityGrants: [{ enabled: true }] })).toThrow();
    expect(() => UpdateSettingsSchema.parse({ capabilityGrants: [{ capability: '' }] })).toThrow();
  });
});

// v0.6.0 excision — see the IW-absence block in tests/main/safety.test.ts.
// These pin the shared surface: an ipc channel and a storage key outlive the
// module that used them, and a renderer calling a dead channel fails silently
// at runtime rather than at build time.
describe('Intelligent Web constants are absent (v0.6.0 excision)', () => {
  const constants = require('../../../src/common/constants');

  it('declares no IW ipc channels', () => {
    expect(Object.keys(constants.IPC_CHANNELS).filter((k: string) => k.startsWith('IW_'))).toEqual([]);
  });

  it('declares no IW storage key', () => {
    expect(Object.keys(constants.STORAGE_KEYS)).not.toContain('IW_SITE_BINDINGS');
  });
});

describe("aiProvider no longer accepts 'power' (v0.6.0 excision)", () => {
  it('rejects a write of power', () => {
    expect(UpdateSettingsSchema.safeParse({ aiProvider: 'power' }).success).toBe(false);
  });

  it('still accepts every retained provider', () => {
    for (const p of ['anthropic', 'openai', 'ollama', 'google', 'local-gateway']) {
      expect(UpdateSettingsSchema.safeParse({ aiProvider: p }).success).toBe(true);
    }
  });
});
