/**
 * GoLiveChecklist Component
 *
 * Runs 6 pre-launch health checks for a WP Engine install and shows pass/warn/fail status
 * for each item. Class-based React component — Local uses older React, no hooks or JSX.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';

interface GoLiveChecklistProps {
  electron: any;
  installId: string;
  installName: string;
  onClose: () => void;
}

type CheckStatus = 'pending' | 'running' | 'pass' | 'warn' | 'fail';

interface CheckItem {
  key: string;
  label: string;
  status: CheckStatus;
  message: string;
  fixLink?: string;
}

interface GoLiveChecklistState {
  checks: CheckItem[];
  running: boolean;
  done: boolean;
  exported: boolean;
}

const INITIAL_CHECKS: CheckItem[] = [
  { key: 'ssl',        label: 'SSL Certificate',      status: 'pending', message: 'Not checked' },
  { key: 'domain',     label: 'Domain Configured',    status: 'pending', message: 'Not checked' },
  { key: 'wp_version', label: 'WordPress Version',    status: 'pending', message: 'Not checked' },
  { key: 'php_version',label: 'PHP Version',          status: 'pending', message: 'Not checked' },
  { key: 'backup',     label: 'Backup Exists',        status: 'pending', message: 'Not checked' },
  { key: 'health',     label: 'Health Score',         status: 'pending', message: 'Not checked' },
];

function statusIcon(status: CheckStatus): string {
  switch (status) {
    case 'pass':    return '\u2705'; // ✅
    case 'warn':    return '\u26A0\uFE0F'; // ⚠️
    case 'fail':    return '\u274C'; // ❌
    case 'running': return '\u23F3'; // ⏳
    default:        return '\u25CB'; // ○
  }
}

function statusColor(status: CheckStatus): string {
  switch (status) {
    case 'pass':    return UI_COLORS.STATUS_RUNNING;
    case 'warn':    return UI_COLORS.STATUS_WARNING;
    case 'fail':    return UI_COLORS.STATUS_ERROR;
    case 'running': return UI_COLORS.WPE_BRAND;
    default:        return '#9ca3af';
  }
}

function parseVersion(v: string): number[] {
  return v.replace(/[^0-9.]/g, '').split('.').map(Number);
}

function compareVersion(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class GoLiveChecklist extends React.Component<GoLiveChecklistProps, GoLiveChecklistState> {
  private mounted = false;

  state: GoLiveChecklistState = {
    checks: INITIAL_CHECKS.map(c => ({ ...c })),
    running: false,
    done: false,
    exported: false,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.runChecks();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  updateCheck(key: string, update: Partial<CheckItem>): void {
    if (!this.mounted) return;
    this.setState(prev => ({
      checks: prev.checks.map(c => c.key === key ? { ...c, ...update } : c),
    }));
  }

  runChecks = async (): Promise<void> => {
    this.setState({ running: true, done: false });

    const ipc = this.props.electron.ipcRenderer;
    const { installId } = this.props;

    // Mark all as running sequentially
    for (const check of INITIAL_CHECKS) {
      this.updateCheck(check.key, { status: 'running', message: 'Checking…' });
    }

    // --- 1. SSL Certificate ---
    try {
      // Use the WPE diagnose-site endpoint which returns sslStatus
      const diagResult = await ipc.invoke(IPC_CHANNELS.WPE_DIAGNOSE_SITE, installId);
      const ssl = diagResult?.diagnostics?.sslStatus;
      if (ssl === 'active') {
        this.updateCheck('ssl', { status: 'pass', message: 'SSL is active and valid' });
      } else if (ssl === 'expiring_soon') {
        this.updateCheck('ssl', {
          status: 'warn',
          message: 'SSL certificate expires within 30 days',
          fixLink: 'https://wpengine.com/support/ssl/',
        });
      } else if (ssl) {
        this.updateCheck('ssl', {
          status: 'fail',
          message: `SSL status: ${ssl}`,
          fixLink: 'https://wpengine.com/support/ssl/',
        });
      } else {
        this.updateCheck('ssl', {
          status: 'warn',
          message: 'SSL status not available — check WPE dashboard',
          fixLink: 'https://wpengine.com/support/ssl/',
        });
      }
    } catch {
      this.updateCheck('ssl', {
        status: 'warn',
        message: 'Could not retrieve SSL status',
        fixLink: 'https://wpengine.com/support/ssl/',
      });
    }

    // --- 2. Domain Configured ---
    try {
      // Get site details which includes the domain
      const siteResult = await ipc.invoke(IPC_CHANNELS.WPE_GET_SITE_DETAILS, installId);
      const domain: string = siteResult?.site?.domain || '';
      if (!domain) {
        this.updateCheck('domain', {
          status: 'warn',
          message: 'No domain information available',
          fixLink: 'https://wpengine.com/support/add-domain/',
        });
      } else if (domain.endsWith('.wpengine.com') || domain.endsWith('.wpenginepowered.com')) {
        this.updateCheck('domain', {
          status: 'warn',
          message: `Only default WP Engine domain configured: ${domain}`,
          fixLink: 'https://wpengine.com/support/add-domain/',
        });
      } else {
        this.updateCheck('domain', {
          status: 'pass',
          message: `Custom domain configured: ${domain}`,
        });
      }
    } catch {
      this.updateCheck('domain', {
        status: 'warn',
        message: 'Could not retrieve domain info',
        fixLink: 'https://wpengine.com/support/add-domain/',
      });
    }

    // --- 3. WordPress Version ---
    try {
      const siteResult = await ipc.invoke(IPC_CHANNELS.WPE_GET_SITE_DETAILS, installId);
      const wpVersion: string = siteResult?.site?.wp_version || '';
      if (!wpVersion || wpVersion === 'unknown') {
        this.updateCheck('wp_version', {
          status: 'warn',
          message: 'WordPress version not available — run WPE sync to populate',
        });
      } else if (compareVersion(wpVersion, '6.4') < 0) {
        this.updateCheck('wp_version', {
          status: 'warn',
          message: `WordPress ${wpVersion} — recommend upgrading to 6.4+ before going live`,
          fixLink: 'https://wordpress.org/download/',
        });
      } else if (compareVersion(wpVersion, '6.0') < 0) {
        this.updateCheck('wp_version', {
          status: 'fail',
          message: `WordPress ${wpVersion} is below minimum recommended version (6.0)`,
          fixLink: 'https://wordpress.org/download/',
        });
      } else {
        this.updateCheck('wp_version', {
          status: 'pass',
          message: `WordPress ${wpVersion}`,
        });
      }
    } catch {
      this.updateCheck('wp_version', {
        status: 'warn',
        message: 'Could not retrieve WordPress version',
      });
    }

    // --- 4. PHP Version ---
    try {
      const siteResult = await ipc.invoke(IPC_CHANNELS.WPE_GET_SITE_DETAILS, installId);
      const phpVersion: string = siteResult?.site?.php_version || '';
      if (!phpVersion || phpVersion === 'unknown') {
        this.updateCheck('php_version', {
          status: 'warn',
          message: 'PHP version not available — run WPE sync to populate',
        });
      } else if (compareVersion(phpVersion, '7.4') < 0) {
        this.updateCheck('php_version', {
          status: 'fail',
          message: `PHP ${phpVersion} is end-of-life — upgrade immediately`,
          fixLink: 'https://wpengine.com/support/php/',
        });
      } else if (compareVersion(phpVersion, '8.0') < 0) {
        this.updateCheck('php_version', {
          status: 'warn',
          message: `PHP ${phpVersion} — recommend upgrading to PHP 8.1+`,
          fixLink: 'https://wpengine.com/support/php/',
        });
      } else if (compareVersion(phpVersion, '8.1') < 0) {
        this.updateCheck('php_version', {
          status: 'warn',
          message: `PHP ${phpVersion} — PHP 8.1+ recommended for best performance`,
          fixLink: 'https://wpengine.com/support/php/',
        });
      } else {
        this.updateCheck('php_version', {
          status: 'pass',
          message: `PHP ${phpVersion}`,
        });
      }
    } catch {
      this.updateCheck('php_version', {
        status: 'warn',
        message: 'Could not retrieve PHP version',
      });
    }

    // --- 5. Backup Exists ---
    try {
      // Try to get the last DB scan cache to check for recent backup metadata
      // Fall back to the WPE diagnose endpoint which has backupStatus
      const diagResult = await ipc.invoke(IPC_CHANNELS.WPE_DIAGNOSE_SITE, installId);
      const backupStatus = diagResult?.diagnostics?.backupStatus;
      if (backupStatus === 'recent') {
        this.updateCheck('backup', { status: 'pass', message: 'Recent backup exists (within 24h)' });
      } else if (backupStatus === 'old') {
        this.updateCheck('backup', {
          status: 'warn',
          message: 'No backup in the last 24h — consider creating one before launch',
          fixLink: 'https://wpengine.com/support/create-a-backup/',
        });
      } else {
        // No backup status info — advise creating one
        this.updateCheck('backup', {
          status: 'warn',
          message: 'Backup status unknown — use "Create WPE Backup" button to create one now',
          fixLink: 'https://wpengine.com/support/create-a-backup/',
        });
      }
    } catch {
      this.updateCheck('backup', {
        status: 'warn',
        message: 'Could not verify backup status — create a backup before going live',
        fixLink: 'https://wpengine.com/support/create-a-backup/',
      });
    }

    // --- 6. Health Score ---
    try {
      const healthResult = await ipc.invoke(IPC_CHANNELS.HEALTH_GET_SCORE, { siteId: installId });
      const score: number | undefined = healthResult?.score;
      if (score === undefined || score === null) {
        this.updateCheck('health', {
          status: 'warn',
          message: 'Health score not available — run a health check first',
        });
      } else if (score >= 80) {
        this.updateCheck('health', { status: 'pass', message: `Health score: ${score}/100` });
      } else if (score >= 60) {
        this.updateCheck('health', {
          status: 'warn',
          message: `Health score: ${score}/100 — review issues before launch`,
          fixLink: 'nexus:health',
        });
      } else {
        this.updateCheck('health', {
          status: 'fail',
          message: `Health score: ${score}/100 — critical issues need to be resolved`,
          fixLink: 'nexus:health',
        });
      }
    } catch {
      this.updateCheck('health', {
        status: 'warn',
        message: 'Could not retrieve health score',
      });
    }

    if (this.mounted) this.setState({ running: false, done: true });
  };

  buildExportText(): string {
    const { installName } = this.props;
    const { checks } = this.state;
    const now = new Date().toLocaleString();
    const passed = checks.filter(c => c.status === 'pass').length;
    const lines = [
      `Go-Live Checklist: ${installName}`,
      `Generated: ${now}`,
      `Result: ${passed} of ${checks.length} checks passed`,
      '',
      ...checks.map(c => `${statusIcon(c.status)} ${c.label}: ${c.message}`),
    ];
    return lines.join('\n');
  }

  handleExport = (): void => {
    const text = this.buildExportText();
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ exported: true });
      setTimeout(() => { if (this.mounted) this.setState({ exported: false }); }, 2500);
    });
  };

  render(): React.ReactNode {
    const { installName, onClose } = this.props;
    const { checks, running, done, exported } = this.state;

    const passed = checks.filter(c => c.status === 'pass').length;
    const warned = checks.filter(c => c.status === 'warn').length;
    const failed = checks.filter(c => c.status === 'fail').length;

    const cardStyle: React.CSSProperties = {
      backgroundColor: 'var(--nxai-card-bg, #fff)',
      border: '1px solid var(--nxai-card-border, #e5e7eb)',
      borderRadius: '12px',
      padding: '28px 32px',
      width: '540px',
      maxWidth: '90vw',
      maxHeight: '80vh',
      overflowY: 'auto' as const,
      color: 'var(--nxai-card-text, #111827)',
      boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
    };

    const headerStyle: React.CSSProperties = {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: '20px',
    };

    const titleStyle: React.CSSProperties = {
      fontSize: '17px',
      fontWeight: 700,
      color: 'var(--nxai-card-text)',
      lineHeight: 1.3,
    };

    const subtitleStyle: React.CSSProperties = {
      fontSize: '12px',
      color: 'var(--nxai-card-sub, #6b7280)',
      marginTop: '4px',
    };

    const closeBtnStyle: React.CSSProperties = {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      fontSize: '20px',
      lineHeight: 1,
      padding: '0 4px',
      opacity: 0.5,
      color: 'var(--nxai-card-text)',
    };

    const checkRowStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
      padding: '10px 0',
      borderBottom: '1px solid var(--nxai-card-border, #e5e7eb)',
    };

    const summaryStyle: React.CSSProperties = {
      marginTop: '16px',
      padding: '12px 16px',
      borderRadius: '8px',
      backgroundColor: failed > 0
        ? 'rgba(239,68,68,0.08)'
        : warned > 0
          ? 'rgba(245,158,11,0.08)'
          : 'rgba(81,195,86,0.08)',
      border: `1px solid ${failed > 0 ? 'rgba(239,68,68,0.25)' : warned > 0 ? 'rgba(245,158,11,0.25)' : 'rgba(81,195,86,0.25)'}`,
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--nxai-card-text)',
    };

    const footerStyle: React.CSSProperties = {
      display: 'flex',
      gap: '10px',
      marginTop: '20px',
      justifyContent: 'flex-end',
    };

    const btnBaseStyle: React.CSSProperties = {
      padding: '7px 16px',
      borderRadius: '6px',
      fontSize: '13px',
      fontWeight: 500,
      cursor: 'pointer',
    };

    const primaryBtnStyle: React.CSSProperties = {
      ...btnBaseStyle,
      backgroundColor: UI_COLORS.WPE_BRAND,
      color: '#fff',
      border: 'none',
    };

    const secondaryBtnStyle: React.CSSProperties = {
      ...btnBaseStyle,
      backgroundColor: 'transparent',
      border: '1px solid var(--nxai-card-border, #e5e7eb)',
      color: 'var(--nxai-card-text)',
    };

    const rerunBtnStyle: React.CSSProperties = {
      ...btnBaseStyle,
      backgroundColor: 'transparent',
      border: '1px solid var(--nxai-card-border, #e5e7eb)',
      color: 'var(--nxai-card-text)',
      opacity: running ? 0.5 : 1,
      cursor: running ? 'not-allowed' : 'pointer',
    };

    return React.createElement('div', { style: cardStyle },
      // Header
      React.createElement('div', { style: headerStyle },
        React.createElement('div', null,
          React.createElement('div', { style: titleStyle }, `Go-Live Checklist: ${installName}`),
          React.createElement('div', { style: subtitleStyle },
            running ? 'Running checks…' : done ? 'Checks complete' : 'Ready',
          ),
        ),
        React.createElement('button', { style: closeBtnStyle, onClick: onClose, title: 'Close' }, '\u00D7'),
      ),

      // Checklist items
      React.createElement('div', null,
        ...checks.map(check =>
          React.createElement('div', { key: check.key, style: checkRowStyle },
            React.createElement('span', { style: { fontSize: '18px', lineHeight: 1, flexShrink: 0, marginTop: '1px' } },
              statusIcon(check.status),
            ),
            React.createElement('div', { style: { flex: 1, minWidth: 0 } },
              React.createElement('div', {
                style: { fontSize: '13px', fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: '2px' },
              }, check.label),
              React.createElement('div', {
                style: { fontSize: '12px', color: statusColor(check.status), lineHeight: 1.4 },
              }, check.message),
              check.fixLink && check.status !== 'pass'
                ? React.createElement('a', {
                    href: '#',
                    style: { fontSize: '11px', color: UI_COLORS.WPE_BRAND, textDecoration: 'none', marginTop: '2px', display: 'inline-block' },
                    onClick: (e: React.MouseEvent) => {
                      e.preventDefault();
                      if (check.fixLink && !check.fixLink.startsWith('nexus:')) {
                        (window as any).open?.(check.fixLink, '_blank');
                      }
                    },
                  }, 'How to fix \u2192')
                : null,
            ),
          ),
        ),
      ),

      // Summary
      done
        ? React.createElement('div', { style: summaryStyle },
            `${passed} of ${checks.length} checks passed`,
            warned > 0 || failed > 0
              ? React.createElement('span', { style: { fontWeight: 400, marginLeft: '8px', color: 'var(--nxai-card-sub)' } },
                  `(${warned} warning${warned !== 1 ? 's' : ''}${failed > 0 ? `, ${failed} failure${failed !== 1 ? 's' : ''}` : ''})`,
                )
              : null,
          )
        : null,

      // Footer buttons
      React.createElement('div', { style: footerStyle },
        done
          ? React.createElement('button', {
              style: rerunBtnStyle,
              onClick: running ? undefined : this.runChecks,
              disabled: running,
            }, 'Re-run Checks')
          : null,
        done
          ? React.createElement('button', {
              style: secondaryBtnStyle,
              onClick: this.handleExport,
            }, exported ? 'Copied!' : 'Export Summary')
          : null,
        React.createElement('button', { style: primaryBtnStyle, onClick: onClose }, 'Close'),
      ),
    );
  }
}
