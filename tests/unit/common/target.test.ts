import {
  parseTarget, requireLocalTarget, requireWpeTarget, formatTarget,
} from '../../../src/common/target';

describe('parseTarget', () => {
  it('parses an explicit local target', () => {
    expect(parseTarget('mysite@local')).toEqual({
      type: 'local', original: 'mysite@local', siteName: 'mysite',
    });
  });

  it('treats a bare name as local', () => {
    expect(parseTarget('mysite')).toEqual({
      type: 'local', original: 'mysite', siteName: 'mysite',
    });
  });

  it('parses a full WPE target into installName', () => {
    expect(parseTarget('wpe:acct/myinstall@production')).toEqual({
      type: 'wpe',
      original: 'wpe:acct/myinstall@production',
      account: 'acct',
      installName: 'myinstall',
      environment: 'production',
    });
  });

  it('lazily matches so the install portion may contain slashes', () => {
    expect(parseTarget('wpe:acct/a/b@staging').installName).toBe('a/b');
  });

  it.each(['production', 'staging', 'development'])('accepts %s', (env) => {
    expect(parseTarget(`wpe:a/b@${env}`).environment).toBe(env);
  });

  it('throws terse text for an incomplete WPE target by default', () => {
    expect(() => parseTarget('wpe:acct/inst'))
      .toThrow('Incomplete WPE target: wpe:acct/inst. Expected wpe:account/install@environment');
  });

  it('throws verbose text for an incomplete WPE target when asked', () => {
    expect(() => parseTarget('wpe:acct/inst', { verboseErrors: true }))
      .toThrow(/Expected: wpe:account\/install@environment/);
  });

  it('throws terse text for invalid syntax by default', () => {
    expect(() => parseTarget('mysite@production'))
      .toThrow("Invalid target syntax: mysite@production. Expected 'mysite', 'mysite@local', or 'wpe:account/install@environment'");
  });

  it('throws the shorthand-needs-a-link hint only in verbose mode', () => {
    expect(() => parseTarget('mysite@production', { verboseErrors: true }))
      .toThrow(/Shorthand syntax 'mysite@production' requires a link/);
  });

  it('throws terse text for an unknown @suffix in verbose mode too', () => {
    expect(() => parseTarget('mysite@nonsense', { verboseErrors: true }))
      .toThrow(/Invalid target syntax/);
  });
});

describe('requireLocalTarget', () => {
  it('returns the site name', () => {
    expect(requireLocalTarget('mysite@local')).toBe('mysite');
  });
  it('rejects a WPE target', () => {
    expect(() => requireLocalTarget('wpe:a/b@production')).toThrow(/Expected local target/);
  });
});

describe('requireWpeTarget', () => {
  it('returns installName and the deprecated installId alias', () => {
    expect(requireWpeTarget('wpe:acct/inst@staging')).toEqual({
      account: 'acct', installName: 'inst', installId: 'inst', environment: 'staging',
    });
  });
  it('rejects a local target', () => {
    expect(() => requireWpeTarget('mysite@local')).toThrow(/Expected WPE target/);
  });
});

describe('formatTarget', () => {
  it('formats local', () => {
    expect(formatTarget(parseTarget('mysite@local'))).toBe('mysite@local');
  });
  it('formats wpe', () => {
    expect(formatTarget(parseTarget('wpe:a/b@production'))).toBe('wpe:a/b@production');
  });
});
