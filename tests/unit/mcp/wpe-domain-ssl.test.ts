/**
 * Unit tests for WPE domain, SSL, and SSH key MCP handlers
 */
import { getDomainsHandler } from '../../../src/main/mcp/modules/wpe/get-domains';
import { createDomainHandler } from '../../../src/main/mcp/modules/wpe/create-domain';
import { updateDomainHandler } from '../../../src/main/mcp/modules/wpe/update-domain';
import { deleteDomainHandler } from '../../../src/main/mcp/modules/wpe/delete-domain';
import { checkDomainStatusHandler } from '../../../src/main/mcp/modules/wpe/check-domain-status';
import { getSslCertificatesHandler } from '../../../src/main/mcp/modules/wpe/get-ssl-certificates';
import { requestSslCertificateHandler } from '../../../src/main/mcp/modules/wpe/request-ssl-certificate';
import { getSshKeysHandler } from '../../../src/main/mcp/modules/wpe/get-ssh-keys';
import { createSshKeyHandler } from '../../../src/main/mcp/modules/wpe/create-ssh-key';
import { deleteSshKeyHandler } from '../../../src/main/mcp/modules/wpe/delete-ssh-key';

function getText(result: any): string {
  return result.content[0].text;
}

function makeMockServices(capiDirect: jest.Mock) {
  return {
    localServices: {
      capiDirect,
      capiGetAccounts: jest.fn(),
      capiGetInstalls: jest.fn(),
      capiCreateBackup: jest.fn(),
      isCAPIAvailable: jest.fn().mockReturnValue(true),
    },
    siteData: { getSites: jest.fn().mockReturnValue({}) },
  } as any;
}

// --- wpe_get_domains ---

describe('wpe_get_domains', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('returns domain table on success', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      results: [
        { id: 'd1', name: 'example.com', primary: true, status: 'active', redirect_to: null },
        { id: 'd2', name: 'www.example.com', primary: false, status: 'active', redirect_to: 'example.com' },
      ],
    });
    const result = await getDomainsHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Domains for Install');
    expect(text).toContain('example.com');
    expect(text).toContain('✓');
  });

  it('returns empty message when no domains', async () => {
    mockCapiDirect.mockResolvedValueOnce({ results: [] });
    const result = await getDomainsHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('No domains found');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await getDomainsHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_create_domain ---

describe('wpe_create_domain', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('adds domain and returns confirmation with next steps', async () => {
    mockCapiDirect.mockResolvedValueOnce({ id: 'd-new', name: 'newsite.com' });
    const result = await createDomainHandler.execute(
      { install_id: 'inst-1', name: 'newsite.com' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Domain Added');
    expect(text).toContain('newsite.com');
    expect(text).toContain('wpe_check_domain_status');
    expect(text).toContain('wpe_request_ssl_certificate');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('401'));
    const result = await createDomainHandler.execute(
      { install_id: 'inst-1', name: 'newsite.com' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_update_domain ---

describe('wpe_update_domain', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('updates domain and returns confirmation', async () => {
    mockCapiDirect.mockResolvedValueOnce({});
    const result = await updateDomainHandler.execute(
      { install_id: 'inst-1', domain_id: 'd1', primary: true },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('updated successfully');
    expect(getText(result)).toContain('d1');
  });

  it('returns validation error when no update fields provided', async () => {
    const result = await updateDomainHandler.execute(
      { install_id: 'inst-1', domain_id: 'd1' },
      makeMockServices(jest.fn()),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('primary');
    expect(getText(result)).toContain('redirect_to');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await updateDomainHandler.execute(
      { install_id: 'inst-1', domain_id: 'd1', primary: false, redirect_to: 'example.com' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_delete_domain ---

describe('wpe_delete_domain', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('pre-confirmation with primary domain: shows extra strong warning', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      id: 'd1',
      name: 'example.com',
      primary: true,
    });
    const result = await deleteDomainHandler.execute(
      { install_id: 'inst-1', domain_id: 'd1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Confirm Deletion');
    expect(text).toContain('PRIMARY domain');
    expect(text).toContain('example.com');
    expect(text).toContain('_confirmationToken');
  });

  it('pre-confirmation with non-primary domain: shows standard warning without primary alert', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      id: 'd2',
      name: 'www.example.com',
      primary: false,
    });
    const result = await deleteDomainHandler.execute(
      { install_id: 'inst-1', domain_id: 'd2' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Confirm Deletion');
    expect(text).not.toContain('PRIMARY domain');
    expect(text).toContain('www.example.com');
  });

  it('confirmed: calls DELETE and returns success', async () => {
    mockCapiDirect.mockResolvedValueOnce({});
    const result = await deleteDomainHandler.execute(
      { install_id: 'inst-1', domain_id: 'd1', _confirmationToken: 'confirm' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('removed');
    expect(mockCapiDirect).toHaveBeenCalledWith(
      '/installs/inst-1/domains/d1',
      'DELETE',
    );
  });

  it('returns auth error on 401 during pre-confirmation fetch', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await deleteDomainHandler.execute(
      { install_id: 'inst-1', domain_id: 'd1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });

  it('returns auth error on 401 during DELETE', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('401'));
    const result = await deleteDomainHandler.execute(
      { install_id: 'inst-1', domain_id: 'd1', _confirmationToken: 'confirm' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_check_domain_status ---

describe('wpe_check_domain_status', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('returns DNS status details on success', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      name: 'example.com',
      status: 'active',
      resolves_to: '1.2.3.4',
    });
    const result = await checkDomainStatusHandler.execute(
      { install_id: 'inst-1', domain_id: 'd1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('DNS Status');
    expect(text).toContain('example.com');
    expect(text).toContain('active');
    expect(text).toContain('1.2.3.4');
  });

  it('includes errors list when present', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      name: 'example.com',
      status: 'pending',
      resolves_to: null,
      errors: ['DNS not yet propagated'],
    });
    const result = await checkDomainStatusHandler.execute(
      { install_id: 'inst-1', domain_id: 'd1' },
      makeMockServices(mockCapiDirect),
    );
    expect(getText(result)).toContain('DNS not yet propagated');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('401'));
    const result = await checkDomainStatusHandler.execute(
      { install_id: 'inst-1', domain_id: 'd1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_get_ssl_certificates ---

describe('wpe_get_ssl_certificates', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('shows valid certificate with future expiry', async () => {
    const futureDate = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
    mockCapiDirect.mockResolvedValueOnce({
      results: [
        { domains: ['example.com'], expires_at: futureDate, status: 'active', type: "Let's Encrypt" },
      ],
    });
    const result = await getSslCertificatesHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('SSL Certificates');
    expect(text).toContain('example.com');
    // 90 days out means normal "expires in X days" — no warning emoji
    expect(text).not.toContain('⚠️ expires');
    expect(text).not.toContain('❌ expired');
  });

  it('shows warning emoji for certificate expiring within 14 days', async () => {
    const soonDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    mockCapiDirect.mockResolvedValueOnce({
      results: [{ domains: ['example.com'], expires_at: soonDate, status: 'active', type: 'managed' }],
    });
    const result = await getSslCertificatesHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(getText(result)).toContain('⚠️ expires in');
  });

  it('shows expired emoji for expired certificate', async () => {
    const pastDate = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    mockCapiDirect.mockResolvedValueOnce({
      results: [{ domains: ['example.com'], expires_at: pastDate, status: 'expired', type: 'managed' }],
    });
    const result = await getSslCertificatesHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(getText(result)).toContain('❌ expired');
  });

  it('returns empty message when no certs', async () => {
    mockCapiDirect.mockResolvedValueOnce({ results: [] });
    const result = await getSslCertificatesHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(getText(result)).toContain('No SSL certificates found');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await getSslCertificatesHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_request_ssl_certificate ---

describe('wpe_request_ssl_certificate', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('requests certificate and returns guidance', async () => {
    mockCapiDirect.mockResolvedValueOnce({});
    const result = await requestSslCertificateHandler.execute(
      { install_id: 'inst-1', domain_ids: ['d1', 'd2'] },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('SSL Certificate Requested');
    expect(text).toContain('2 domain(s)');
    expect(text).toContain("Let's Encrypt");
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('401'));
    const result = await requestSslCertificateHandler.execute(
      { install_id: 'inst-1', domain_ids: ['d1'] },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_get_ssh_keys ---

describe('wpe_get_ssh_keys', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('returns SSH key table on success', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      results: [
        { id: 'key-1', label: 'Laptop', fingerprint: 'ab:cd:ef', created_at: '2024-01-01' },
        { id: 'key-2', label: 'CI/CD', fingerprint: '12:34:56', created_at: '2024-02-01' },
      ],
    });
    const result = await getSshKeysHandler.execute({}, makeMockServices(mockCapiDirect));
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('SSH Keys (2)');
    expect(text).toContain('Laptop');
    expect(text).toContain('CI/CD');
  });

  it('returns empty message when no keys', async () => {
    mockCapiDirect.mockResolvedValueOnce({ results: [] });
    const result = await getSshKeysHandler.execute({}, makeMockServices(mockCapiDirect));
    expect(getText(result)).toContain('No SSH keys found');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await getSshKeysHandler.execute({}, makeMockServices(mockCapiDirect));
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_create_ssh_key ---

describe('wpe_create_ssh_key', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('adds SSH key and returns details', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      id: 'key-new',
      label: 'Laptop',
      fingerprint: 'ab:cd:ef:00',
    });
    const result = await createSshKeyHandler.execute(
      { label: 'Laptop', public_key: 'ssh-ed25519 AAAA...' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('SSH Key Added');
    expect(text).toContain('Laptop');
    expect(text).toContain('ab:cd:ef:00');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('401'));
    const result = await createSshKeyHandler.execute(
      { label: 'Laptop', public_key: 'ssh-rsa AAAA...' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_delete_ssh_key ---

describe('wpe_delete_ssh_key', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('pre-confirmation: shows key label in confirmation prompt', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      results: [
        { id: 'key-1', label: 'Laptop', fingerprint: 'ab:cd:ef' },
      ],
    });
    const result = await deleteSshKeyHandler.execute(
      { ssh_key_id: 'key-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Confirm Deletion');
    expect(text).toContain('Laptop');
    expect(text).toContain('key-1');
    expect(text).toContain('_confirmationToken');
  });

  it('pre-confirmation: shows "Unknown" when key not found in list', async () => {
    mockCapiDirect.mockResolvedValueOnce({ results: [] });
    const result = await deleteSshKeyHandler.execute(
      { ssh_key_id: 'key-missing' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('Unknown');
  });

  it('confirmed: calls DELETE and returns success', async () => {
    mockCapiDirect.mockResolvedValueOnce({});
    const result = await deleteSshKeyHandler.execute(
      { ssh_key_id: 'key-1', _confirmationToken: 'confirm' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('removed');
    expect(mockCapiDirect).toHaveBeenCalledWith('/ssh_keys/key-1', 'DELETE');
  });

  it('returns auth error on 401 during pre-confirmation fetch', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await deleteSshKeyHandler.execute(
      { ssh_key_id: 'key-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});
