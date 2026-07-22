import { validateAwsCredentials } from '../../../src/main/credentials/stsValidation';

describe('validateAwsCredentials', () => {
  it('returns valid=true with ARN on 200 response', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <GetCallerIdentityResponse>
          <GetCallerIdentityResult>
            <Arn>arn:aws:iam::123456789012:user/nexus-local-agent</Arn>
            <UserId>AIDAXXXXXXXXXXXXXXXXX</UserId>
            <Account>123456789012</Account>
          </GetCallerIdentityResult>
        </GetCallerIdentityResponse>
      `,
    });
    const result = await validateAwsCredentials(
      { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI' },
      mockFetch as any,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.arn).toBe('arn:aws:iam::123456789012:user/nexus-local-agent');
      expect(result.account).toBe('123456789012');
    }
  });

  it('returns valid=false with code on 403 response', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => `
        <ErrorResponse>
          <Error>
            <Code>InvalidAccessKeyId</Code>
            <Message>The AWS Access Key Id you provided does not exist.</Message>
          </Error>
        </ErrorResponse>
      `,
    });
    const result = await validateAwsCredentials(
      { accessKeyId: 'BADKEY', secretAccessKey: 'badsecret' },
      mockFetch as any,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('InvalidAccessKeyId');
    }
  });

  it('returns valid=false with SignatureDoesNotMatch for wrong secret', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => `
        <ErrorResponse>
          <Error>
            <Code>SignatureDoesNotMatch</Code>
            <Message>The request signature we calculated does not match the signature you provided.</Message>
          </Error>
        </ErrorResponse>
      `,
    });
    const result = await validateAwsCredentials(
      { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wrongsecret' },
      mockFetch as any,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('SignatureDoesNotMatch');
  });

  it('returns valid=false on network error', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('network failure'));
    const result = await validateAwsCredentials(
      { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'secret' },
      mockFetch as any,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('NetworkError');
  });
});
