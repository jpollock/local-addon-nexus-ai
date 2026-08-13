// eslint-disable-next-line @typescript-eslint/no-var-requires
const { scanText } = require('../../../scripts/scan-secrets');

// Build fake secrets at runtime so this test file itself does not contain a literal that the
// scanner would flag when it scans the repo.
const fakeAnthropic = 'sk-' + 'ant-api03-' + 'A1b2C3d4E5'.repeat(5);
const fakeOpenAI = 'sk-' + 'A1b2C3d4E5'.repeat(5);
const fakeGoogle = 'AIza' + 'A1b2C3d4E5B6c7'.repeat(2) + 'A1b2C3d';
const fakePrivateKey = '-----BEGIN ' + 'PRIVATE KEY-----';

describe('scan-secrets: scanText (P1-2)', () => {
  it('flags an Anthropic-style key', () => {
    expect(scanText(`export KEY=${fakeAnthropic}`).length).toBeGreaterThan(0);
  });

  it('flags an OpenAI-style key', () => {
    expect(scanText(fakeOpenAI).length).toBeGreaterThan(0);
  });

  it('flags a Google API key', () => {
    expect(scanText(fakeGoogle).length).toBeGreaterThan(0);
  });

  it('flags a private-key PEM header', () => {
    expect(scanText(fakePrivateKey).length).toBeGreaterThan(0);
  });

  it('does not flag ordinary code / prose', () => {
    expect(scanText('const port = 13000; // gateway on localhost\nconst name = "deploy";')).toEqual([]);
  });

  it('does not flag a public key PEM header', () => {
    expect(scanText('-----BEGIN PUBLIC KEY-----')).toEqual([]);
  });
});
