# WP Engine Backup Creation

## How It Works

Backup creation uses **hybrid authentication**:

1. If WP Engine API credentials are stored → uses basic auth ✅
2. If no credentials → attempts OAuth → fails with helpful error

WP Engine's backup endpoint (`POST /installs/{id}/backups`) requires basic auth. OAuth works for all other endpoints (listing installs, purging cache, etc.).

## Setup

**Via Preferences UI:**
1. Open Local → Nexus AI Preferences
2. Go to **WP Engine API Credentials** section
3. Enter username and password from [my.wpengine.com](https://my.wpengine.com)
4. Click **Apply**

**Via CLI:**
```bash
nexus wpe set-credentials <username> <password>
nexus wpe credentials-status   # verify
```

**Via MCP:**
```
wpe_set_api_credentials  username="..." password="..."
wpe_credentials_status
```

## Creating Backups

```bash
# Default notification email
nexus wpe backup wpe:account/install@production --description "Pre-deploy"

# Custom notification email
nexus wpe backup wpe:account/install@production --description "Pre-deploy" --emails "you@example.com"
```

## Security

Credentials are encrypted using OS-level encryption:
- **macOS**: Keychain
- **Windows**: DPAPI
- **Linux**: libsecret

Same security as WP Engine OAuth tokens stored by Local.

## Clearing Credentials

```bash
nexus wpe clear-credentials
```

Or via Preferences: click **Clear** then **Apply**.
