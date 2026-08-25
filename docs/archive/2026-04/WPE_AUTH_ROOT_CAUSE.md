# WP Engine Backup Endpoint - Root Cause Analysis

## CONFIRMED: Not Our Bug

**Date**: 2026-04-09
**Status**: RESOLVED - External API Limitation

## The Problem

`wpe_get_installs` works fine, but `wpe_create_backup` fails with 401 Unauthorized, despite using the same OAuth token.

## Root Cause

**The WP Engine backup endpoint does not accept OAuth authentication.**

### Proof

Direct curl test with OAuth Bearer token:
```bash
curl -X POST "https://api.wpengineapi.com/v1/installs/{id}/backups" \
  -H "Authorization: Bearer {OAUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"description":"test","notificationEmails":["test@example.com"]}'

Response: {"message":"Bad Credentials"}
```

The SAME OAuth token that successfully authenticates for:
- `GET /installs` ✅
- `GET /accounts` ✅
- Other CAPI endpoints ✅

Returns 401 for:
- `POST /installs/{id}/backups` ❌

### Why This Happens

The backup endpoint is documented as:
> **NOTICE** This is an alpha feature that should not be relied upon for programmatic backups.

It appears WP Engine restricts backup creation to basic authentication only, not OAuth.

## What Works

Basic authentication with API credentials:
```bash
curl -X POST "https://api.wpengineapi.com/v1/installs/{id}/backups" \
  -u "$WPE_API_USER_ID:$WPE_API_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"description":"test","notificationEmails":["user@example.com"]}'
```

This works successfully.

## Solutions

### Option 1: Use Basic Auth for Backups Only (Recommended)

Keep OAuth for all other operations, but fall back to basic auth specifically for backup creation.

**Pros**:
- Works immediately
- No changes to existing OAuth flow
- Isolated to one endpoint

**Cons**:
- Requires storing WP Engine API credentials
- User must provide API username/password
- Two auth mechanisms in the codebase

**Implementation**:
1. Add `wpe_set_credentials` tool to store API username/password
2. Modify `capiCreateBackup` to use basic auth instead of OAuth
3. Keep all other CAPI calls using OAuth

### Option 2: Document Limitation

Simply document that backup creation isn't supported and users should use WP Engine portal.

**Pros**:
- No code changes needed
- Users use official portal UI

**Cons**:
- Feature gap in our tooling
- Less convenient for automation

### Option 3: Request WP Engine Fix OAuth Support

File an issue with WP Engine to add OAuth support to the backup endpoint.

**Pros**:
- Proper long-term solution
- Consistent auth across all endpoints

**Cons**:
- Out of our control
- Likely slow (endpoint is "alpha")
- May never be fixed

## Recommendation

**Implement Option 1** with the following approach:

1. Add optional basic auth credentials storage in addon settings
2. Check if basic auth credentials are available before attempting backup
3. If credentials exist: use basic auth for backup endpoint only
4. If no credentials: return helpful error message with instructions
5. Keep OAuth for all other CAPI operations

This gives users the choice:
- Want backup automation? Provide API credentials.
- Don't want to store credentials? Use WP Engine portal for backups.

## Code Changes Needed

### 1. Add Credentials Storage
```typescript
// In local-services-bridge.ts
async wpeSetApiCredentials(username: string, password: string): Promise<void> {
  const userData = svc('userData');
  userData.set({
    name: 'wpeApiCredentials',
    data: { username, password },
    encrypted: true,
  });
}
```

### 2. Modify Backup Method
```typescript
// In local-services-bridge.ts
async capiCreateBackup(installId: string, description: string) {
  const userData = svc('userData');
  const creds = userData.get('wpeApiCredentials');

  if (!creds?.username || !creds?.password) {
    throw new Error(
      'Backup creation requires WP Engine API credentials. ' +
      'Run `wpe_set_credentials` or create backups in the WP Engine portal.'
    );
  }

  // Use basic auth for backup endpoint only
  const auth = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
  const response = await fetch(
    `https://api.wpengineapi.com/v1/installs/${installId}/backups`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description,
        notificationEmails: ['no-reply@getflywheel.com'],
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Backup creation failed: ${response.statusText}`);
  }

  const backup = await response.json();
  return backup;
}
```

### 3. Add MCP Tool
```typescript
// In modules/wpe/set-credentials.ts
export const setCredentialsHandler = {
  definition: {
    name: 'wpe_set_credentials',
    description: 'Store WP Engine API credentials for backup creation (basic auth). Required for wpe_create_backup.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'WP Engine API username' },
        password: { type: 'string', description: 'WP Engine API password' },
      },
      required: ['username', 'password'],
    },
  },
  async execute(args, services) {
    await services.localServices.wpeSetApiCredentials(
      args.username as string,
      args.password as string
    );
    return { content: [{ type: 'text', text: '✅ WP Engine API credentials stored securely' }] };
  },
};
```

## Timeline Estimate

- Basic auth implementation: 2-3 hours
- Testing: 1 hour
- Documentation: 30 minutes
- **Total**: ~4 hours

## Alternative: Quick Workaround

For immediate unblocking, document that users should:
1. Use WP Engine portal for backups, OR
2. Use basic auth curl directly, OR
3. Wait for proper OAuth support from WP Engine

This takes 15 minutes (documentation only).
