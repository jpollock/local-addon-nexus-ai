import { buildWpeSshArgs, buildWpeSshExitArgs } from '../../../src/main/transport/ssh-args';

/**
 * Closing the multiplexed master after a one-pass sweep.
 *
 * WP Engine enforces FIVE concurrent SSH connections PER USER, account-wide —
 * not per install. Measured 2026-08-23, quoting the server: "The concurrent
 * connection limit of 5 connections per user has been reached. If you are
 * using ControlPersist, check your ControlPath and delete any persisting
 * connections that are no longer needed."
 *
 * `ControlPersist` is 10 minutes, so every install a fleet run touches keeps
 * its master alive long after its command finished. At MAX_CONCURRENCY 5 and
 * ~20s per site that is 12-20 masters accumulating inside one persist window;
 * 82 sockets were counted on disk against a limit of 5. Once the live total
 * crosses five, every further install is refused at authentication in under
 * 100ms — which is exactly the collapse seen twice.
 *
 * ControlPersist earns its keep for an AGENT hitting one install repeatedly.
 * A sweep visits each install once, so persistence buys nothing there and
 * spends the whole account quota.
 */
describe('buildWpeSshExitArgs — releases the connection a sweep is done with', () => {
  test('addresses the same control socket the session opened', () => {
    const controlPath = (a: string[]) => a.find(x => x.startsWith('ControlPath='));

    const open = buildWpeSshArgs('acflikebutton', 'wp post list', '/k');
    const exit = buildWpeSshExitArgs('acflikebutton', '/k');

    // Same socket, or `-O exit` silently addresses nothing and the leak stays.
    // `%C` hashes localhost/host/port/user, so the surrounding options must
    // agree too — comparing the resolved literal is what pins that.
    expect(controlPath(open)).toBeDefined();
    expect(controlPath(exit)).toBe(controlPath(open));
  });

  test('asks ssh to exit, and targets the same host', () => {
    const exit = buildWpeSshExitArgs('acflikebutton', '/k');

    expect(exit).toContain('-O');
    expect(exit).toContain('exit');
    expect(exit).toContain('local+ssh+acflikebutton@acflikebutton.ssh.wpengine.net');
  });
});
