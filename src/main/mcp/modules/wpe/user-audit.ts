import { McpToolHandler } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

// CAPI returns single-letter role codes: o=owner, b=billing, p=partial, full=full
const ROLE_LABELS: Record<string, string> = {
  o: 'owner',
  b: 'billing',
  p: 'partial',
  full: 'full',
  owner: 'owner',
  billing: 'billing',
  partial: 'partial',
};

// Elevated = owner, billing, or full access (checked against resolved labels)
const ELEVATED_ROLE_LABELS = new Set(['owner', 'billing', 'full']);

export const userAuditHandler: McpToolHandler = {
  definition: {
    name: 'wpe_user_audit',
    description:
      'Audit all WP Engine portal users across all accounts — who has access, their role (full/billing/partial), and which installs partial-role users can access. Use for security reviews, before offboarding staff, or to identify over-privileged accounts. For a single account users, use wpe_get_account_users.' +
      'Highlights users with elevated permissions or access to multiple accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'Scope to a single account. If omitted, audits all accounts.',
        },
      },
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    const scopedAccountId = args.account_id as string | undefined;

    try {
      let accountsToAudit: any[];

      if (scopedAccountId) {
        const accountData = await services.localServices!.capiDirect(
          `/accounts/${scopedAccountId}`,
        ) as any;
        accountsToAudit = [accountData];
      } else {
        accountsToAudit = await services.localServices!.capiGetAccounts() as any[];
      }

      if (!accountsToAudit || accountsToAudit.length === 0) {
        return ok('No accounts found.');
      }

      // Fetch users for all accounts in parallel
      const userResults = await Promise.all(
        accountsToAudit.map(async (account) => {
          try {
            const data = await services.localServices!.capiDirect(
              `/accounts/${account.id}/account_users?limit=100`,
            ) as any;
            return { account, users: data?.results ?? [], error: null };
          } catch (err: any) {
            return { account, users: [], error: err.message ?? String(err) };
          }
        }),
      );

      // Build a flat user map: email → { name, accounts: [{name, role}] }
      interface UserEntry {
        email: string;
        firstName: string;
        lastName: string;
        accounts: Array<{ accountName: string; role: string }>;
      }

      const userMap = new Map<string, UserEntry>();

      for (const { account, users } of userResults) {
        for (const u of users) {
          const email = u.user?.email ?? u.email ?? u.id ?? 'unknown';
          const firstName = u.first_name ?? u.user?.first_name ?? '';
          const lastName = u.last_name ?? u.user?.last_name ?? '';
          const rawRole = u.roles?.[0] ?? 'unknown';
          const role = ROLE_LABELS[rawRole] ?? rawRole;

          if (!userMap.has(email)) {
            userMap.set(email, { email, firstName, lastName, accounts: [] });
          }
          userMap.get(email)!.accounts.push({ accountName: account.name ?? account.id, role });
        }
      }

      const allUsers = Array.from(userMap.values());

      // Sort: multi-account users first, then by email
      allUsers.sort((a, b) => {
        if (b.accounts.length !== a.accounts.length) return b.accounts.length - a.accounts.length;
        return a.email.localeCompare(b.email);
      });

      const multiAccountUsers = allUsers.filter((u) => u.accounts.length > 1);
      const elevatedUsers = allUsers.filter((u) =>
        u.accounts.some((a) => ELEVATED_ROLE_LABELS.has(a.role)),
      );

      const lines = [
        `## WP Engine User Audit`,
        `${allUsers.length} user${allUsers.length !== 1 ? 's' : ''} across ${accountsToAudit.length} account${accountsToAudit.length !== 1 ? 's' : ''}`,
        '',
        '| User | Role(s) | Account(s) | Flags |',
        '|------|---------|-----------|-------|',
      ];

      for (const user of allUsers) {
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || '—';
        const roles = [...new Set(user.accounts.map((a) => a.role))].join(', ');
        const accountNames = user.accounts.map((a) => a.accountName).join(', ');
        const flags: string[] = [];

        if (user.accounts.length > 1) flags.push('🔀 multi-account');
        if (user.accounts.some((a) => ELEVATED_ROLE_LABELS.has(a.role))) {
          flags.push('⚠️ elevated');
        }

        const flagsLabel = flags.length > 0 ? flags.join(' ') : '—';
        lines.push(`| ${user.email} (${name}) | ${roles} | ${accountNames} | ${flagsLabel} |`);
      }

      lines.push('');
      lines.push('### Summary');
      lines.push(`- **Total users:** ${allUsers.length}`);
      lines.push(`- **Multi-account users:** ${multiAccountUsers.length}`);
      lines.push(`- **Users with elevated roles (owner/billing/full):** ${elevatedUsers.length}`);

      const errors = userResults.filter((r) => r.error);
      if (errors.length > 0) {
        lines.push('');
        lines.push(`⚠️ Could not fetch users for ${errors.length} account(s): ${errors.map((e) => `${e.account.name} (${e.error})`).join('; ')}`);
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
