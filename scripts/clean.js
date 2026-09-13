#!/usr/bin/env node
'use strict';

/**
 * Remove lib/, cross-platform.
 *
 * Replaces `rm -rf lib`. That happened to survive on the Windows runner because
 * `rm` resolves to Git-for-Windows' rm.exe on PATH — but it survives by luck of
 * PATH order, not by design, and a runner image without Git's usr/bin would
 * break the build with no warning.
 *
 * A file rather than `node -e "..."` deliberately: npm runs scripts through
 * cmd.exe on Windows, whose quote handling differs from sh, and an inline
 * one-liner makes the build depend on getting that escaping right on a platform
 * this project cannot test locally.
 */

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'lib');
fs.rmSync(target, { recursive: true, force: true });
