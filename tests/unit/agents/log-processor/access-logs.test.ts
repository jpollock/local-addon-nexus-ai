import {
  parseLogLine, classifyLine, emptyAggregate, foldLine,
  finalizeAggregate, enableIpTracking, TAXONOMY_VERSION,
  parseS3XmlError, extractDateRange, probeBucketRegion, findSiblingPrefixWithLogs,
  parseInstallIdFromKey, scanBucketForInstalls,
  type S3Object,
} from '../../../../agents/log-processor/access-logs';

const LOGIN_POST  = '1.2.3.4 example.com - [01/Jul/2026:14:22:01 +0000] "POST /wp-login.php HTTP/1.1" 403 5501 "http://www.google.com" "curl/7.0"';
const REST_USER   = '5.6.7.8 example.com - [01/Jul/2026:14:22:01 +0000] "GET /wp-json/wp/v2/users HTTP/1.1" 200 1234 "-" "python-requests/2.0"';
const PROBE_LINE  = '9.9.9.9 example.com - [01/Jul/2026:14:22:01 +0000] "GET /.env HTTP/1.1" 404 0 "-" "masscan/1.0"';
const AUTHOR_SCAN = '2.2.2.2 example.com - [01/Jul/2026:14:22:01 +0000] "GET /?author=1 HTTP/1.1" 200 500 "-" "Mozilla/5.0"';

describe('parseLogLine', () => {
  it('parses a valid Apache-style line', () => {
    const l = parseLogLine(LOGIN_POST)!;
    expect(l.ip).toBe('1.2.3.4');
    expect(l.method).toBe('POST');
    expect(l.path).toBe('/wp-login.php');
    expect(l.status).toBe(403);
    expect(l.day).toBe('2026-07-01');
  });

  it('returns null for malformed lines', () => {
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine('not a log line')).toBeNull();
  });
});

describe('classifyLine', () => {
  it('classifies wp-login POST as attack', () => {
    expect(classifyLine(parseLogLine(LOGIN_POST)!).cls).toBe('attack');
  });
  it('classifies REST user endpoint as attack', () => {
    expect(classifyLine(parseLogLine(REST_USER)!).cls).toBe('attack');
  });
  it('classifies .env probe as attack', () => {
    expect(classifyLine(parseLogLine(PROBE_LINE)!).cls).toBe('attack');
  });
});

describe('foldLine — attack schema', () => {
  it('populates authAttack with hour and status distribution', () => {
    const agg = emptyAggregate('site', '2026-07-01');
    const l = parseLogLine(LOGIN_POST)!;
    foldLine(agg, l, classifyLine(l));
    expect(agg.attack.requests).toBe(1);
    const bucket = agg.attack.authAttack['14'];
    expect(bucket).toBeDefined();
    expect(bucket.loginPosts['403']).toBe(1);
  });

  it('populates enumeration.userRestApi with status', () => {
    const agg = emptyAggregate('site', '2026-07-01');
    const l = parseLogLine(REST_USER)!;
    foldLine(agg, l, classifyLine(l));
    expect(agg.attack.enumeration.userRestApi['200']).toBe(1);
  });

  it('populates enumeration.authorScan with status', () => {
    const agg = emptyAggregate('site', '2026-07-01');
    const l = parseLogLine(AUTHOR_SCAN)!;
    foldLine(agg, l, classifyLine(l));
    expect(agg.attack.enumeration.authorScan['200']).toBe(1);
  });

  it('populates probe histogram with status', () => {
    const agg = emptyAggregate('site', '2026-07-01');
    const l = parseLogLine(PROBE_LINE)!;
    foldLine(agg, l, classifyLine(l));
    expect(agg.attack.probes['/.env']?.hits).toBe(1);
    expect(agg.attack.probes['/.env']?.statuses['404']).toBe(1);
  });
});

describe('finalizeAggregate', () => {
  it('computes ipCardinality from _ipCounts and strips _ipCounts', () => {
    const agg = emptyAggregate('site', '2026-07-01');
    enableIpTracking(agg);
    agg._ipCounts!.set('1.1.1.1', 1);
    agg._ipCounts!.set('2.2.2.2', 3);
    agg._ipCounts!.set('3.3.3.3', 10);
    const clean = finalizeAggregate(agg);
    expect(clean._ipCounts).toBeUndefined();
    expect(clean.attack.ipCardinality.distinct).toBe(3);
    expect(clean.attack.ipCardinality.histogram['1']).toBe(1);
    expect(clean.attack.ipCardinality.histogram['2-5']).toBe(1);
    expect(clean.attack.ipCardinality.histogram['6-20']).toBe(1);
    expect(clean.attack.ipCardinality.histogram['21+']).toBe(0);
  });
});

describe('TAXONOMY_VERSION', () => {
  it('is stamped on empty aggregates', () => {
    expect(TAXONOMY_VERSION).toBe('2026-07');
    expect(emptyAggregate('s', '2026-07-01').taxonomyVersion).toBe('2026-07');
  });
});

describe('parseS3XmlError', () => {
  it('extracts Code and Message from an S3 error response', () => {
    const body = '<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>';
    expect(parseS3XmlError(body)).toEqual({ code: 'NoSuchBucket', message: 'The specified bucket does not exist' });
  });

  it('falls back to the code as the message when Message is missing', () => {
    const body = '<Error><Code>AccessDenied</Code></Error>';
    expect(parseS3XmlError(body)).toEqual({ code: 'AccessDenied', message: 'AccessDenied' });
  });

  it('returns null for a body with no recognizable error code', () => {
    expect(parseS3XmlError('not xml at all')).toBeNull();
  });
});

describe('extractDateRange', () => {
  it('extracts oldest/newest from WPE filename-embedded dates', () => {
    const objects: S3Object[] = [
      { key: 'wpe_logs/nginx/20260805-0017-site.apachestyle.log.gz', size: 100 },
      { key: 'wpe_logs/nginx/20260801-0017-site.apachestyle.log.gz', size: 100 },
      { key: 'wpe_logs/nginx/20260803-0017-site.apachestyle.log.gz', size: 100 },
    ];
    expect(extractDateRange(objects)).toEqual({ oldest: '2026-08-01', newest: '2026-08-05' });
  });

  it('returns an empty object when no key has a parseable date', () => {
    expect(extractDateRange([{ key: 'no-date-here.log', size: 1 }])).toEqual({});
  });

  it('returns an empty object for an empty list', () => {
    expect(extractDateRange([])).toEqual({});
  });
});

describe('probeBucketRegion', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('reads x-amz-bucket-region from an unsigned HEAD, even on a non-2xx response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      headers: { get: (k: string) => (k === 'x-amz-bucket-region' ? 'us-west-2' : null) },
    }) as unknown as typeof fetch;
    expect(await probeBucketRegion('some-bucket')).toBe('us-west-2');
  });

  it('returns undefined when the header is absent or the request throws', async () => {
    global.fetch = jest.fn().mockResolvedValue({ headers: { get: () => null } }) as unknown as typeof fetch;
    expect(await probeBucketRegion('some-bucket')).toBeUndefined();

    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    expect(await probeBucketRegion('some-bucket')).toBeUndefined();
  });
});

describe('findSiblingPrefixWithLogs', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  const CREDS = { accessKeyId: 'AKIA', secretAccessKey: 'secret' };

  it('returns the first sibling prefix that contains apache-style objects', async () => {
    global.fetch = jest.fn()
      // Parent listing (delimiter=/) — two sibling prefixes
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <ListBucketResult>
            <Prefix>wpe_logs/other/</Prefix>
          </ListBucketResult>
          <CommonPrefixes><Prefix>wpe_logs/nginx/</Prefix></CommonPrefixes>
          <CommonPrefixes><Prefix>wpe_logs/php/</Prefix></CommonPrefixes>
        `,
      })
      // Listing sibling #1 (nginx) — has an apachestyle object
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `<Contents><Key>wpe_logs/nginx/x.apachestyle.log.gz</Key><Size>10</Size></Contents>`,
      }) as unknown as typeof fetch;

    const result = await findSiblingPrefixWithLogs(CREDS, 'us-east-1', 'bucket', 'wpe_logs/other/');
    expect(result).toBe('wpe_logs/nginx/');
  });

  it('returns undefined when the parent listing fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, text: async () => '<Error></Error>' }) as unknown as typeof fetch;
    expect(await findSiblingPrefixWithLogs(CREDS, 'us-east-1', 'bucket', 'wpe_logs/other/')).toBeUndefined();
  });

  it('returns undefined when no sibling has apache-style objects', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `<CommonPrefixes><Prefix>wpe_logs/empty/</Prefix></CommonPrefixes>`,
      })
      .mockResolvedValueOnce({ ok: true, text: async () => '' }) as unknown as typeof fetch;
    expect(await findSiblingPrefixWithLogs(CREDS, 'us-east-1', 'bucket', 'wpe_logs/other/')).toBeUndefined();
  });
});

describe('parseInstallIdFromKey', () => {
  it('parses the dashed date-time form', () => {
    expect(parseInstallIdFromKey('20260807-0016-jeremypollock2.apachestyle.log.gz'))
      .toEqual({ installId: 'jeremypollock2', kind: 'apachestyle', date: '2026-08-07', time: '0016' });
  });

  it('parses the concatenated date-time form', () => {
    // Both shapes are live in real WP Engine buckets. A parser that handles only one silently
    // drops every object of the other, which looks like an install with no logs.
    expect(parseInstallIdFromKey('202607210625-localwpe.apachestyle.log.gz'))
      .toEqual({ installId: 'localwpe', kind: 'apachestyle', date: '2026-07-21', time: '0625' });
  });

  it('keeps access logs distinguishable rather than discarding them', () => {
    expect(parseInstallIdFromKey('20260807-0016-acfprod.access.log.gz')?.kind).toBe('access');
  });

  it('ignores the prefix and reads only the basename', () => {
    expect(parseInstallIdFromKey('wpe_logs/nginx/20260807-0016-acfprod.apachestyle.log.gz')?.installId).toBe('acfprod');
  });

  it('handles install names with hyphens and digits', () => {
    expect(parseInstallIdFromKey('20260807-0016-client-site-2.apachestyle.log.gz')?.installId).toBe('client-site-2');
  });

  it('accepts an uncompressed object', () => {
    expect(parseInstallIdFromKey('20260807-0016-acfprod.apachestyle.log')?.installId).toBe('acfprod');
  });

  it('lowercases the install id so the join is case-insensitive', () => {
    expect(parseInstallIdFromKey('20260807-0016-ACFProd.apachestyle.log.gz')?.installId).toBe('acfprod');
  });

  it('returns null rather than guessing at an unrecognised filename', () => {
    // A wrong guess here folds one install's traffic into another's aggregates, which is exactly
    // the class of bug this parser exists to prevent.
    expect(parseInstallIdFromKey('README.txt')).toBeNull();
    expect(parseInstallIdFromKey('wpe_logs/nginx/')).toBeNull();
    expect(parseInstallIdFromKey('20260807-acfprod.apachestyle.log.gz')).toBeNull();
    expect(parseInstallIdFromKey('20260807-0016-acfprod.error.log.gz')).toBeNull();
  });
});

describe('scanBucketForInstalls', () => {
  const CREDS = { accessKeyId: 'AKIA', secretAccessKey: 'secret' };
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  const obj = (key: string, size = 100) => `<Contents><Key>${key}</Key><Size>${size}</Size></Contents>`;

  function mockListing(body: string) {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => body }) as unknown as typeof fetch;
  }

  it('groups apache-style objects by the install id in each filename', async () => {
    mockListing(
      obj('wpe_logs/nginx/20260807-0016-alpha.apachestyle.log.gz', 300) +
      obj('wpe_logs/nginx/20260806-0016-alpha.apachestyle.log.gz', 200) +
      obj('wpe_logs/nginx/20260807-0016-beta.apachestyle.log.gz', 100),
    );
    const scan = await scanBucketForInstalls(CREDS, 'us-east-1', 'wpejpp', 'wpe_logs/nginx/');
    expect(scan.apacheStyleObjects).toBe(3);
    expect(scan.installs).toEqual([
      { installId: 'alpha', objectCount: 2, bytes: 500, oldest: '2026-08-06', newest: '2026-08-07', sampleKey: '20260807-0016-alpha.apachestyle.log.gz' },
      { installId: 'beta', objectCount: 1, bytes: 100, oldest: '2026-08-07', newest: '2026-08-07', sampleKey: '20260807-0016-beta.apachestyle.log.gz' },
    ]);
  });

  it('counts access logs in the total but never toward any apache-style number', async () => {
    // Roughly half the objects in the folder are .access.log.gz. Every count the UI shows has to
    // exclude them, or the halved number reads as data loss.
    mockListing(
      obj('20260807-0016-alpha.apachestyle.log.gz') +
      obj('20260807-0016-alpha.access.log.gz'),
    );
    const scan = await scanBucketForInstalls(CREDS, 'us-east-1', 'wpejpp', '');
    expect(scan.totalObjects).toBe(2);
    expect(scan.apacheStyleObjects).toBe(1);
    expect(scan.unparsedObjects).toBe(0);
    expect(scan.installs[0].objectCount).toBe(1);
  });

  it('surfaces unrecognised filenames rather than silently dropping them', async () => {
    mockListing(obj('20260807-0016-alpha.apachestyle.log.gz') + obj('wpe_logs/nginx/'));
    const scan = await scanBucketForInstalls(CREDS, 'us-east-1', 'wpejpp', '');
    expect(scan.unparsedObjects).toBe(1);
  });

  it('reports an empty bucket without inventing installs', async () => {
    mockListing('');
    const scan = await scanBucketForInstalls(CREDS, 'us-east-1', 'wpejpp', '');
    expect(scan).toEqual({ totalObjects: 0, apacheStyleObjects: 0, unparsedObjects: 0, installs: [], truncated: false });
  });

  it('flags a truncated listing so the counts are not read as totals', async () => {
    mockListing(obj('20260807-0016-alpha.apachestyle.log.gz') + obj('20260807-0017-alpha.apachestyle.log.gz'));
    const scan = await scanBucketForInstalls(CREDS, 'us-east-1', 'wpejpp', '', 2);
    expect(scan.truncated).toBe(true);
  });
});
