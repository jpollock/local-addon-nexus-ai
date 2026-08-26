#!/usr/bin/env node
/**
 * spike/power-ai-sdk · the last variables. Full real registry is ACCEPTED at
 * stream:false/max_tokens:16 — so the chat 400 is one of: stream:true,
 * max_tokens:8192, the ~9KB system prompt, or the model. One request per
 * cell, cheapest matrix that isolates the variable.
 *
 * Usage: POWER_API_KEY=wpe_xxx node scripts/spike-power-matrix-probe.mjs [tools.json]
 */
import { readFileSync } from 'node:fs';

const API_KEY = process.env.POWER_API_KEY;
const TOOLS_PATH = process.argv[2] || '/tmp/tools.json';
if (!API_KEY) { console.error('POWER_API_KEY required'); process.exit(1); }

const raw = JSON.parse(readFileSync(TOOLS_PATH, 'utf8'));
const tools = raw.map((t) => {
  const parameters = JSON.parse(JSON.stringify(t.inputSchema ?? { type: 'object', properties: {} }));
  if (parameters.properties?._confirmationToken) delete parameters.properties._confirmationToken;
  if (Array.isArray(parameters.required)) {
    parameters.required = parameters.required.filter((r) => r !== '_confirmationToken');
    if (parameters.required.length === 0) delete parameters.required;
  }
  return { type: 'function', function: { name: t.name, description: t.description, parameters } };
});

const SYSTEM_9KB = 'You are Nexus AI, a WordPress site management assistant. ' + 'Use tools to get real data. '.repeat(320); // ~9KB, prose like the real prompt

async function attempt(label, { model, stream, max_tokens, system }) {
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: 'Reply with exactly: OK' },
  ];
  const res = await fetch('https://api.ai.wpengine.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model, messages, stream, max_tokens, tools }),
  });
  let detail = '';
  if (!res.ok) detail = `${res.status} ${(await res.text()).slice(0, 120).replace(/\s+/g, ' ')}`;
  else { try { if (stream) { for await (const _ of res.body) { /* drain */ } } else await res.text(); } catch { /* drain errors irrelevant */ } }
  console.log(`  ${res.ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  → ' + detail : ''}`);
  return res.ok;
}

const M45 = 'anthropic/claude-sonnet-4-5';
const M5 = 'anthropic/claude-sonnet-5';

console.log(`matrix over ${tools.length} real tools:\n`);
// One variable at a time off the known-good baseline (false/16/none/4-5):
await attempt('A stream:true            (4-5, mt 16, no sys)', { model: M45, stream: true, max_tokens: 16 });
await attempt('B max_tokens:8192        (4-5, no stream, no sys)', { model: M45, stream: false, max_tokens: 8192 });
await attempt('C system ~9KB            (4-5, no stream, mt 16)', { model: M45, stream: false, max_tokens: 16, system: SYSTEM_9KB });
// The real chat shape, then the original model:
await attempt('D chat shape             (4-5, stream, mt 8192, sys)', { model: M45, stream: true, max_tokens: 8192, system: SYSTEM_9KB });
await attempt('E chat shape on sonnet-5 (5,   stream, mt 8192, sys)', { model: M5, stream: true, max_tokens: 8192, system: SYSTEM_9KB });

console.log(`\nReading: a FAIL names the variable. All ok incl. D+E → the route was
fixed upstream; the cap's premise is gone either way.`);
