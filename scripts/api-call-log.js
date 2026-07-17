#!/usr/bin/env node
/**
 * API call log reader — parses ~/Desktop/nexus-api-calls.jsonl
 * and prints each logged call in readable form.
 *
 * Usage:
 *   node scripts/api-call-log.js               # show all
 *   node scripts/api-call-log.js --errors       # only 400/error calls
 *   node scripts/api-call-log.js --last 1       # most recent call
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const logFile = path.join(os.homedir(), 'Desktop', 'nexus-api-calls.jsonl');
const args = process.argv.slice(2);
const errorsOnly = args.includes('--errors');
const lastN = args.includes('--last') ? parseInt(args[args.indexOf('--last') + 1]) : null;

if (!fs.existsSync(logFile)) {
  console.log('No log file yet. Run the sentinel to generate calls.');
  console.log(`Expected: ${logFile}`);
  process.exit(0);
}

const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const filtered = errorsOnly ? entries.filter(e => e.status >= 400 || e.error) : entries;
const toShow = lastN ? filtered.slice(-lastN) : filtered;

console.log(`\nTotal calls logged: ${entries.length}  |  Showing: ${toShow.length}\n`);

for (const e of toShow) {
  const status = e.status ? `HTTP ${e.status}` : (e.error ? `ERROR: ${e.error}` : 'unknown');
  const ts = new Date(e.timestamp).toLocaleTimeString();
  console.log(`${'═'.repeat(80)}`);
  console.log(`[${ts}] ${e.provider} ${e.model}  →  ${status}  (${e.durationMs}ms)`);
  console.log(`schemaName: ${e.schemaName ?? '(none)'}  |  forceTool: ${e.forceTool ?? false}  |  tools: ${e.toolCount}`);
  console.log(`Request body (${e.requestBodyLen} chars):`);
  if (e.requestBody) {
    try {
      const body = JSON.parse(e.requestBody);
      // Show key fields without the full content blobs
      const summary = {
        model: body.model,
        contents: body.contents?.map(c => ({ role: c.role, textLen: c.parts?.[0]?.text?.length })),
        tools: body.tools?.map(t => ({ name: t.functionDeclarations?.[0]?.name, paramKeys: Object.keys(t.functionDeclarations?.[0]?.parameters?.properties ?? {}) })),
        tool_config: body.tool_config,
        systemInstruction: body.systemInstruction ? '(present)' : undefined,
      };
      console.log(JSON.stringify(summary, null, 2));
    } catch {
      console.log(e.requestBody.slice(0, 500));
    }
  }
  if (e.responseBody) {
    console.log(`Response body (${e.responseBodyLen} chars):`);
    try {
      const resp = JSON.parse(e.responseBody);
      // Show error or first candidate summary
      if (resp.error) console.log('ERROR:', JSON.stringify(resp.error));
      else if (resp.candidates) console.log('Candidates:', resp.candidates.length, '| finishReason:', resp.candidates[0]?.finishReason);
    } catch {
      console.log(e.responseBody.slice(0, 300));
    }
  }
  console.log();
}
