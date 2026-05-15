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
});
