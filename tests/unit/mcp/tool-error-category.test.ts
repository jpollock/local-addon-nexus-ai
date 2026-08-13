import { categorizeToolError } from '../../../src/main/mcp/tool-registry';

describe('categorizeToolError (P1-7)', () => {
  it.each([
    ['Site "x" not found.', 'site_not_found'],
    ['The site is not running', 'site_not_running'],
    ['Request timed out after 20s', 'timeout'],
    ['connect ECONNREFUSED 127.0.0.1', 'network_error'],
    ['getaddrinfo ENOTFOUND api.example.com', 'network_error'],
    ['install_name is required', 'validation_error'],
    ['Invalid confirmation token', 'validation_error'],
    ['something exploded', 'unknown'],
  ])('maps %j -> %s', (message, expected) => {
    expect(categorizeToolError(message)).toBe(expected);
  });
});
