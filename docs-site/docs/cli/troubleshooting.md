---
title: CLI Troubleshooting
description: Common CLI issues and solutions
---

# CLI Troubleshooting

Common issues and solutions for the Nexus AI CLI and bootstrap system.

## Bootstrap Issues

### "Timed out waiting for Local"

**Symptoms:**
```
❌ Timed out waiting for Local. Is Local running?
```

**Causes:**
- Local failed to start (no display on Linux SSH)
- GraphQL server initialization failed
- Firewall blocking localhost

**Solutions:**

1. **Check Local is actually running:**
   ```bash
   # macOS
   ps aux | grep Local

   # Windows
   tasklist | findstr Local.exe

   # Linux
   ps aux | grep local
   ```

2. **Manually start Local:**
   ```bash
   # macOS
   open -a Local

   # Windows
   start "" "C:\Program Files\Local\Local.exe"

   # Linux (from desktop, not SSH)
   /opt/Local/local &
   ```

3. **Check GraphQL connection info:**
   ```bash
   # macOS
   cat ~/Library/Application\ Support/Local/graphql-connection-info.json

   # Windows
   type %APPDATA%\Local\graphql-connection-info.json

   # Linux
   cat ~/.config/Local/graphql-connection-info.json
   ```

4. **Enable debug mode:**
   ```bash
   DEBUG=true nexus sites list
   ```

### "Local is not installed"

**Symptoms:**
```
❌ Local is not installed. Download from https://localwp.com
```

**Solutions:**

1. **Download and install Local:**
   Visit [localwp.com](https://localwp.com) and install for your platform.

2. **Linux: Custom installation path**

   If Local is installed in a non-standard location, the CLI will prompt:
   ```
   Path to Local executable (or press Enter to skip): /custom/path/to/local
   ```

   This saves to `~/.nexus/config.json` for future runs.

### "Addon not found"

**Symptoms:**
```
❌ Failed to install addon
Addon not found. Please reinstall the CLI package.
```

**Solutions:**

1. **Reinstall the CLI:**
   ```bash
   npm install -g @local-labs-jpollock/local-addon-nexus-ai --force
   ```

2. **Check npm package integrity:**
   ```bash
   npm list -g @local-labs-jpollock/local-addon-nexus-ai
   ```

3. **Dev mode: Verify monorepo structure**
   ```bash
   ls -la $(dirname $(which nexus))/../
   # Should show addon-dist/ or src/
   ```

### Addon Won't Activate (Linux SSH)

**Symptoms:**
```
The CLI addon is installed but needs to be activated.

Please activate from Local desktop app:
  1. Open Local
  2. Go to Addons
  3. Enable "local-addon-nexus-ai"
```

**Cause:**
Can't start Local GUI from SSH session (no display).

**Solutions:**

1. **Activate from desktop:**
   - Log into desktop
   - Open Local
   - Go to Addons
   - Enable "Nexus AI"
   - Return to SSH session

2. **Or restart Local from desktop:**
   - Addon will auto-activate on restart

## Update Issues

### Update Check Fails Silently

**Expected behavior:** Network errors don't interrupt CLI.

**To force update check:**
```bash
nexus update --check
```

### Update Command Fails

**Symptoms:**
```
❌ Update failed
Try running: npm update -g @local-labs-jpollock/local-addon-nexus-ai
```

**Solutions:**

1. **Run npm update manually:**
   ```bash
   npm update -g @local-labs-jpollock/local-addon-nexus-ai
   ```

2. **Check npm permissions:**
   ```bash
   npm config get prefix
   # Should be writable by your user
   ```

3. **Use sudo (if necessary):**
   ```bash
   sudo npm update -g @local-labs-jpollock/local-addon-nexus-ai
   ```

## Performance Issues

### First Run is Slow (15-20s)

**Expected behavior:** First run installs and activates addon, restarts Local.

**Subsequent runs:** ~50ms (no bootstrap overhead)

**To speed up:**
- Ensure Local is already running before first CLI invocation
- Use SSD for faster file operations

### Every Run Shows "Connecting to Local..."

**Cause:** Local keeps stopping between runs.

**Solutions:**

1. **Keep Local running:**
   Local should stay running in background after first CLI use.

2. **Check Local preferences:**
   Ensure "Keep Local running in background" is enabled.

## Platform-Specific Issues

### macOS: "operation not permitted"

**Cause:** macOS security restrictions

**Solutions:**

1. **Grant Full Disk Access:**
   - System Settings → Privacy & Security → Full Disk Access
   - Add Terminal/iTerm to the list

2. **Grant Accessibility permissions (for restart):**
   - System Settings → Privacy & Security → Accessibility
   - Add Terminal/iTerm to the list

### Windows: "Local.exe not found"

**Cause:** Non-standard installation path

**Solutions:**

1. **Check installation path:**
   ```cmd
   where Local.exe
   ```

2. **Common paths:**
   - `C:\Program Files\Local\Local.exe`
   - `C:\Program Files (x86)\Local\Local.exe`
   - `%LOCALAPPDATA%\Programs\Local\Local.exe`

### Linux: "Cannot start Local: no display available"

**Cause:** SSH session without X11 forwarding

**Solutions:**

1. **Enable X11 forwarding:**
   ```bash
   ssh -X user@host
   ```

2. **Or start Local from desktop:**
   - Access the machine physically
   - Start Local GUI
   - Return to SSH session

## Debug Mode

Enable verbose output for troubleshooting:

```bash
DEBUG=true nexus sites list
```

**Output includes:**
- Bootstrap actions taken
- File paths checked
- Process detection results
- GraphQL polling attempts
- Error stack traces

## Getting Help

If you're still stuck:

1. **Check the logs:**
   ```bash
   # macOS
   ~/Library/Logs/local-addon-nexus-ai/

   # Windows
   %APPDATA%\local-addon-nexus-ai\logs\

   # Linux
   ~/.local/share/local-addon-nexus-ai/logs/
   ```

2. **Report an issue:**
   - Visit [GitHub Issues](https://github.com/wpengine/local-addon-nexus-ai/issues)
   - Include debug output (`DEBUG=true`)
   - Include platform and versions

3. **Community:**
   - [Local Community Forums](https://localwp.com/community)
   - [WP Engine Support](https://wpengine.com/support)

## Next Steps

- [Installation Guide](./installation.md)
- [CLI Commands](./commands.md)
- [Architecture](../architecture/cli-architecture.md)
