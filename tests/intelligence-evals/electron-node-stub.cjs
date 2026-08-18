/**
 * Harness hotfix (2026-08-17, architect session) — electron stub for CLI runs.
 *
 * The WP-20e probes import AgentDispatcher, which drags src/main's
 * electron-importing modules (KeyVault, getAIProvider, ipc-handlers) into the
 * sitting CLI's require chain. Under jest, moduleNameMapper substitutes
 * tests/__mocks__/electron.ts; under plain Node there is no electron at all,
 * and the jest mock is unusable here (it calls jest.fn at module scope).
 *
 * This hook applies the same substitution for ts-node CLI runs, with one
 * deliberate difference: safeStorage reports encryption UNAVAILABLE, so
 * KeyVault takes its documented outside-Electron path and the sitting harness
 * sources the provider key from NEXUS_EVAL_API_KEY — the WP-13b design.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 npx ts-node \
 *     -r ./tests/intelligence-evals/electron-node-stub.cjs \
 *     --project tsconfig.test.json tests/intelligence-evals/sitting.ts ...
 *
 * Registered follow-up: probes should lazy-import the dispatcher (or the
 * electron requires should move inside the functions that use them), at which
 * point this file is deletable. Until then it is load-bearing for the sitting.
 */
'use strict';

const Module = require('module');
const os = require('os');
const path = require('path');

const noop = () => {};
const tmpBase = path.join(os.tmpdir(), 'nexus-sitting-userdata');

const electronStub = {
  ipcMain: { handle: noop, removeHandler: noop, on: noop, once: noop, removeAllListeners: noop },
  app: {
    getPath: () => tmpBase,
    getVersion: () => '0.0.0-sitting',
    getName: () => 'nexus-sitting',
    isPackaged: false,
    on: noop,
    once: noop,
    whenReady: () => Promise.resolve(),
  },
  BrowserWindow: Object.assign(function BrowserWindow() { throw new Error('BrowserWindow is not available in the sitting CLI'); }, {
    getAllWindows: () => [],
    fromWebContents: () => null,
  }),
  shell: { openExternal: () => Promise.resolve(), openPath: () => Promise.resolve('') },
  safeStorage: {
    // Deliberately unavailable: KeyVault must refuse, and the harness must
    // source the key from NEXUS_EVAL_API_KEY. Never fake decryption here.
    isEncryptionAvailable: () => false,
    encryptString: () => { throw new Error('safeStorage is not available outside Electron'); },
    decryptString: () => { throw new Error('safeStorage is not available outside Electron'); },
  },
  clipboard: { writeText: noop, readText: () => '' },
  dialog: { showMessageBox: () => Promise.resolve({ response: 0 }) },
  nativeTheme: { shouldUseDarkColors: false, on: noop },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};
