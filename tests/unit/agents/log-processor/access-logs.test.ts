import {
  parseLogLine, classifyLine, emptyAggregate, foldLine,
  finalizeAggregate, enableIpTracking, TAXONOMY_VERSION,
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
