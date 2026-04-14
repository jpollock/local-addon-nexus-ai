---
title: WP Engine Authentication
description: Authenticate the CLI with WP Engine using nexus wpe login, logout, and status
keywords: [authentication, wpe, login, logout, credentials, oauth]
---

# WP Engine Authentication

Authenticate the Nexus CLI with your WP Engine account to list installs, create backups, manage domains, and sync sites.

## Prerequisites

- Local by WP Engine is installed and running
- The Nexus AI addon is active in Local

## Commands

### `nexus wpe login`

Open a browser to authenticate with WP Engine. The CLI polls until authentication completes (up to 3 minutes).

```bash
nexus wpe login
```

**What happens:**

1. The addon starts a short-lived local Express server to receive the OAuth callback.
2. Your default browser opens to the WP Engine login page.
3. Complete login in the browser. The CLI detects success automatically.

**Output:**

```
Browser opened for WP Engine authentication.
Complete the login in your browser, then wait...

...........

Authenticated as jane@example.com (Acme Agency)
```

**Timeout behavior:** If the browser login is not completed within 3 minutes, the CLI prints a timeout warning. Run `nexus wpe status` afterward to check whether authentication succeeded.

---

### `nexus wpe logout`

Revoke the stored WP Engine session.

```bash
nexus wpe logout
```

**Output:**

```
Logged out of WP Engine
```

---

### `nexus wpe status`

Show whether the CLI is currently authenticated, and which account is active.

```bash
nexus wpe status
```

**Output when authenticated:**

```
Authenticated as jane@example.com (Acme Agency)
```

**Output when not authenticated:**

```
Not authenticated with WP Engine

Run: nexus wpe login
```

---

## How Authentication Works

The WP Engine authentication flow uses OAuth. The addon starts a local Express server to receive the OAuth callback from WP Engine after you complete login in the browser.

**Session storage:** The OAuth token is stored inside Local's data directory by the addon. It is not a file you manage directly.

**Per-machine:** Each machine requires its own login. There is no shared credential file.

**Scope:** Authentication grants access to the WP Engine Customer API (CAPI). This is the same credential used in Local's built-in WP Engine Connect feature.

---

## API Credentials for Backups

WP Engine backup creation uses Basic Auth, which is separate from OAuth. You need to provide your WP Engine API credentials explicitly.

Get your API credentials from [my.wpengine.com](https://my.wpengine.com) under API Access.

### Store API credentials

```bash
nexus wpe set-credentials <username> <password>
```

**Example:**

```bash
nexus wpe set-credentials jdoe-api abc123secretkey
```

**Output:**

```
WP Engine API credentials stored securely
Backup creation will now use basic authentication
```

### Check credential status

```bash
nexus wpe credentials-status
```

**Output when configured:**

```
WP Engine API credentials are configured
  Username: jdoe-api
  Backup creation will use basic authentication
```

**Output when not configured:**

```
WP Engine API credentials are NOT configured
  Backup creation will fail (OAuth not supported by WP Engine)

To enable backup creation:
1. Get your API credentials from https://my.wpengine.com
2. Run: nexus wpe set-credentials <username> <password>
```

### Remove stored credentials

```bash
nexus wpe clear-credentials
```

---

## Troubleshooting

### Browser does not open

Some environments block automatic browser launching. If the browser does not open, copy the URL printed in the terminal and paste it manually.

If no URL is printed, check that Local is running and the Nexus AI addon is enabled:

```bash
nexus doctor
```

### Authentication times out

The poll window is 3 minutes. If you complete login after the timeout, run:

```bash
nexus wpe status
```

If the status shows authenticated, you are good. If not, run `nexus wpe login` again.

### "Could not connect to Local"

The CLI communicates with Local via a local GraphQL server. If Local is not running, authentication commands will fail:

```bash
# Check overall system health
nexus doctor
```

Open the Local app and ensure the Nexus AI addon is enabled, then retry.

### Already authenticated but commands fail

Your session may have expired. Log out and log in again:

```bash
nexus wpe logout
nexus wpe login
```

---

## Next Steps

- [WP Engine Site Management](./wpe-sites.md) — list installs, create backups, manage domains
- [Sync Sites](./wpe-sites.md#pull-and-push) — pull WPE installs to local, push local to WPE
- [Command Reference](./commands.md) — full command tree
