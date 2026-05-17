describe('users query logic', () => {
  it('parses roles JSON from DB row', () => {
    const row = { user_id: 1, username: 'admin', email: 'admin@example.com', roles: '["administrator"]' };
    const roles = (() => { try { return JSON.parse(row.roles ?? '[]'); } catch { return []; } })();
    expect(roles).toEqual(['administrator']);
  });

  it('handles null roles gracefully', () => {
    const row = { user_id: 2, username: 'editor', email: 'ed@example.com', roles: null };
    const roles = (() => { try { return JSON.parse(row.roles ?? '[]'); } catch { return []; } })();
    expect(roles).toEqual([]);
  });

  it('flags external email domain', () => {
    const users = [
      { username: 'admin', email: 'admin@mysite.com', roles: ['administrator'] },
      { username: 'client', email: 'client@external.com', roles: ['editor'] },
    ];
    const siteDomain = 'mysite.com';
    const external = users.filter(u => !u.email.endsWith(siteDomain));
    expect(external).toHaveLength(1);
    expect(external[0].username).toBe('client');
  });
});
