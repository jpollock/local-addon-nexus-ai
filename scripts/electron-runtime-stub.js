/**
 * Permissive stub for Electron/Local peer modules (scripts/generate-built-in-tools.ts maps
 * 'electron', '@getflywheel/local' and '@getflywheel/local-components' here before importing the
 * real tool modules).
 *
 * Those packages are optional peerDependencies that a normal checkout does NOT install, yet the
 * tool modules import some of them at load time (e.g. security/KeyVault -> electron safeStorage).
 * Registration only BUILDS handler definitions and never calls into Electron, so every property
 * access, call, and construction resolves to another permissive value and the real tool names
 * load in plain Node. Chain-safe by construction: any property of a stub is a stub.
 */
'use strict';

function makePermissive() {
  const fn = function permissive() {
    return makePermissive();
  };
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === '__esModule') return false;
      if (prop === 'default') return makePermissive();
      if (prop === 'then') return undefined; // never look thenable to await
      if (prop === Symbol.toPrimitive) return () => '';
      return makePermissive();
    },
    apply() {
      return makePermissive();
    },
    construct() {
      return {};
    },
  });
}

module.exports = makePermissive();
