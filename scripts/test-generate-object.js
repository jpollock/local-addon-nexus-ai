#!/usr/bin/env node
/**
 * Test script: does generateObject work reliably for specialist calls?
 *
 * Usage:
 *   GOOGLE_API_KEY=xxx node scripts/test-generate-object.js
 *   ANTHROPIC_API_KEY=xxx node scripts/test-generate-object.js --provider anthropic
 *
 * Runs three approaches in sequence and shows which one works:
 *   1. BROKEN:  noTools=true, ask for JSON in text (current broken approach)
 *   2. BROKEN:  tool-use, optional __output__ (model may ignore)
 *   3. FIXED:   tool-use, FORCED __output__ via tool_choice
 */
'use strict';

const https = require('https');

const PROVIDER = process.argv.includes('--provider')
  ? process.argv[process.argv.indexOf('--provider') + 1]
  : 'google';

const GOOGLE_KEY  = process.env.GOOGLE_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (PROVIDER === 'google' && !GOOGLE_KEY) {
  console.error('Set GOOGLE_API_KEY env var');
  process.exit(1);
}
if (PROVIDER === 'anthropic' && !ANTHROPIC_KEY) {
  console.error('Set ANTHROPIC_API_KEY env var');
  process.exit(1);
}

// Simple JSON schema — matches what the Pattern specialist uses
const SCHEMA = {
  type: 'object',
  properties: {
    temporalCluster: {
      type: 'object',
      properties: {
        detected: { type: 'boolean' },
        windowStart: { type: 'string' },
        windowEnd:   { type: 'string' },
        itemCount:   { type: 'number' },
        items:       { type: 'array', items: { type: 'string' } },
      },
      required: ['detected'],
    },
    criticalFindings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file:     { type: 'string' },
          pattern:  { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium'] },
        },
        required: ['file', 'pattern', 'severity'],
      },
    },
    filesScanned: { type: 'number' },
    filesClean:   { type: 'number' },
  },
  required: ['temporalCluster', 'criticalFindings', 'filesScanned', 'filesClean'],
};

const PROMPT = `You are a WordPress malware pattern scanner. Analyze this site data.

SITE: theawfulpmtest
RECENTLY MODIFIED FILES (last 30 days):
  fileorganizer/    2026-07-14T03:47:12Z
  filester/         2026-07-14T03:47:14Z
  wp-compat/        2026-07-14T03:47:31Z
  noted/            2026-07-14T03:47:33Z
  mu-plugins/index.php  2026-07-14T03:51:22Z

OBFUSCATION SCAN:
  wp-content/mu-plugins/index.php  eval+base64+gzinflate

If more than 3 files share timestamps within 10 minutes, flag as temporal cluster.
Report obfuscation findings as criticalFindings.`;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function post(hostname, path, headers, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({ hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.setTimeout(timeoutMs);
    req.write(payload);
    req.end();
  });
}

// ── Approach 1: BROKEN — ask for JSON in text, no tools ──────────────────────

async function approach1_noTools() {
  console.log('\n━━━ APPROACH 1: noTools=true, JSON-in-text (CURRENT BROKEN) ━━━');
  const instruction = `Respond ONLY with a valid JSON object matching this schema. No explanation, no markdown, just JSON.\nSchema:\n${JSON.stringify(SCHEMA, null, 2)}`;

  if (PROVIDER === 'google') {
    const r = await post('generativelanguage.googleapis.com',
      `/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_KEY}`,
      { 'Content-Type': 'application/json' },
      { contents: [{ role: 'user', parts: [{ text: `${instruction}\n\n${PROMPT}` }] }] }
    );
    const text = r.body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    console.log('Status:', r.status);
    console.log('Response text (first 300):', text.slice(0, 300));
    console.log('JSON found?', !!match);
    if (match) { try { JSON.parse(match[0]); console.log('Parsed OK ✅'); } catch(e) { console.log('Parse failed ❌', e.message); } }
    else console.log('No JSON object in response ❌');
  }

  if (PROVIDER === 'anthropic') {
    const r = await post('api.anthropic.com', '/v1/messages',
      { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      { model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: `${instruction}\n\n${PROMPT}` }] }
    );
    const text = r.body?.content?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    console.log('Status:', r.status);
    console.log('Response text (first 300):', text.slice(0, 300));
    console.log('JSON found?', !!match);
    if (match) { try { JSON.parse(match[0]); console.log('Parsed OK ✅'); } catch(e) { console.log('Parse failed ❌', e.message); } }
    else console.log('No JSON object in response ❌');
  }
}

// ── Approach 2: BROKEN — tool-use, optional (model may ignore) ───────────────

async function approach2_optionalTool() {
  console.log('\n━━━ APPROACH 2: tool-use, optional __output__ (ALSO BROKEN) ━━━');
  const tool = { name: '__output__', description: 'Call with the structured result', parameters: SCHEMA };

  if (PROVIDER === 'google') {
    const r = await post('generativelanguage.googleapis.com',
      `/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_KEY}`,
      { 'Content-Type': 'application/json' },
      {
        contents: [{ role: 'user', parts: [{ text: `You MUST call the __output__ tool with your response.\n\n${PROMPT}` }] }],
        tools: [{ function_declarations: [{ name: tool.name, description: tool.description, parameters: tool.parameters }] }],
      }
    );
    const call = r.body?.candidates?.[0]?.content?.parts?.[0]?.functionCall;
    console.log('Status:', r.status);
    console.log('Tool call found?', !!call);
    if (call) { console.log('Tool name:', call.name); console.log('Args (first 200):', JSON.stringify(call.args).slice(0, 200)); console.log('✅ Tool called correctly'); }
    else console.log('❌ No tool call — model responded in text');
  }

  if (PROVIDER === 'anthropic') {
    const r = await post('api.anthropic.com', '/v1/messages',
      { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      { model: 'claude-sonnet-4-6', max_tokens: 2000,
        tools: [{ name: tool.name, description: tool.description, input_schema: tool.parameters }],
        messages: [{ role: 'user', content: `You MUST call the __output__ tool with your response.\n\n${PROMPT}` }] }
    );
    const call = r.body?.content?.find(c => c.type === 'tool_use');
    console.log('Status:', r.status);
    console.log('Tool call found?', !!call);
    if (call) { console.log('Tool name:', call.name); console.log('Input (first 200):', JSON.stringify(call.input).slice(0, 200)); console.log('✅ Tool called correctly'); }
    else console.log('❌ No tool call — stop reason:', r.body?.stop_reason);
  }
}

// ── Approach 3: FIXED — forced tool_choice ────────────────────────────────────

async function approach3_forcedTool() {
  console.log('\n━━━ APPROACH 3: forced tool_choice (THE FIX) ━━━');
  const tool = { name: '__output__', description: 'Call with the structured result', parameters: SCHEMA };

  if (PROVIDER === 'google') {
    const r = await post('generativelanguage.googleapis.com',
      `/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_KEY}`,
      { 'Content-Type': 'application/json' },
      {
        contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
        tools: [{ function_declarations: [{ name: tool.name, description: tool.description, parameters: tool.parameters }] }],
        // Force the model to call __output__
        tool_config: { function_calling_config: { mode: 'ANY', allowed_function_names: ['__output__'] } },
      }
    );
    const call = r.body?.candidates?.[0]?.content?.parts?.[0]?.functionCall;
    console.log('Status:', r.status);
    console.log('Tool call found?', !!call);
    if (call) { console.log('Tool name:', call.name); console.log('Args (first 200):', JSON.stringify(call.args).slice(0, 200)); console.log('✅ WORKS — model forced to call tool'); }
    else { console.log('❌ Still no tool call'); console.log('Full response:', JSON.stringify(r.body).slice(0, 500)); }
  }

  if (PROVIDER === 'anthropic') {
    const r = await post('api.anthropic.com', '/v1/messages',
      { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      { model: 'claude-sonnet-4-6', max_tokens: 2000,
        tools: [{ name: tool.name, description: tool.description, input_schema: tool.parameters }],
        // Force the model to call __output__
        tool_choice: { type: 'tool', name: '__output__' },
        messages: [{ role: 'user', content: PROMPT }] }
    );
    const call = r.body?.content?.find(c => c.type === 'tool_use');
    console.log('Status:', r.status);
    console.log('Tool call found?', !!call);
    if (call) { console.log('Tool name:', call.name); console.log('Input (first 200):', JSON.stringify(call.input).slice(0, 200)); console.log('✅ WORKS — model forced to call tool'); }
    else { console.log('❌ Still no tool call'); console.log('Stop reason:', r.body?.stop_reason); }
  }
}

// ── Run all three ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nProvider: ${PROVIDER}`);
  console.log('Testing three approaches to structured output...\n');

  await approach1_noTools().catch(e => console.log('Approach 1 error:', e.message));
  await approach2_optionalTool().catch(e => console.log('Approach 2 error:', e.message));
  await approach3_forcedTool().catch(e => console.log('Approach 3 error:', e.message));

  console.log('\n━━━ DONE ━━━\n');
}

main();
