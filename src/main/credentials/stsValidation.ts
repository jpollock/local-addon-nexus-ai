import { createHash, createHmac } from 'node:crypto';

export type AwsCreds = { accessKeyId: string; secretAccessKey: string };

export type StsValidationResult =
  | { valid: true; arn: string; userId: string; account: string }
  | { valid: false; code: string; message: string };

// --- SigV4 helpers ---

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function buildSigV4Headers(
  creds: AwsCreds,
  service: string,
  region: string,
  host: string,
  method: string,
  path: string,
  query: string,
  body: string,
): { url: string; headers: Record<string, string> } {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac('AWS4' + creds.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}${path}${query ? '?' + query : ''}`,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      host,
    },
  };
}

// --- XML extraction ---

function extractXml(body: string, tag: string): string {
  const m = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(body);
  return m?.[1] ?? '';
}

// --- Public API ---

export async function validateAwsCredentials(
  creds: AwsCreds,
  fetchFn: typeof fetch = fetch,
): Promise<StsValidationResult> {
  const host = 'sts.amazonaws.com';
  const body = 'Action=GetCallerIdentity&Version=2011-06-15';

  const { url, headers } = buildSigV4Headers(
    creds,
    'sts',
    'us-east-1',
    host,
    'POST',
    '/',
    '',
    body,
  );

  try {
    const res = await fetchFn(url, { method: 'POST', headers, body });
    const text = await res.text();

    if (res.ok) {
      return {
        valid: true,
        arn: extractXml(text, 'Arn'),
        userId: extractXml(text, 'UserId'),
        account: extractXml(text, 'Account'),
      };
    }

    const code = extractXml(text, 'Code') || `HTTP_${(res as Response).status}`;
    const message = extractXml(text, 'Message') || text.slice(0, 200);
    return { valid: false, code, message };
  } catch (e: unknown) {
    return { valid: false, code: 'NetworkError', message: (e as Error).message };
  }
}
