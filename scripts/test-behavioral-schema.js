#!/usr/bin/env node
/**
 * Isolates whether the Behavioral schema or the prompt content causes HTTP 400.
 * Usage: GOOGLE_API_KEY=xxx node scripts/test-behavioral-schema.js
 */
'use strict';
const https = require('https');
const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_KEY) { console.error('Set GOOGLE_API_KEY'); process.exit(1); }

const behavioralSpec = require('../agents/security-sentinel/specialists/behavioral');

function post(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

function sanitize(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitize);
  const blocklist = new Set(['additionalProperties','$schema','$id','$ref','$defs','definitions','allOf','anyOf','oneOf','not','patternProperties','dependencies','if','then','else']);
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (blocklist.has(k)) continue;
    out[k] = sanitize(v);
  }
  return out;
}

const outputTool = {
  functionDeclarations: [{
    name: '__output__',
    description: 'Call with structured result',
    parameters: sanitize(behavioralSpec.schema),
  }],
};

async function main() {
  console.log('\n── Test 1: Schema only, simple prompt ──');
  const r1 = await post({
    contents: [{ role: 'user', parts: [{ text: 'Site: test.com. No cloaking detected. Login page returns 200. No xmlrpc. Analyze.' }] }],
    tools: [outputTool],
    tool_config: { function_calling_config: { mode: 'ANY', allowed_function_names: ['__output__'] } },
  });
  console.log('Status:', r1.status);
  const b1 = JSON.parse(r1.body);
  if (b1.error) console.log('Error:', b1.error.message.slice(0, 200));
  else console.log('Success! Tool call:', b1.candidates?.[0]?.content?.parts?.[0]?.functionCall?.name);

  console.log('\n── Test 2: Schema with actual behavioral prompt ──');
  const prompt = behavioralSpec.buildPrompt({
    installName: 'theawfulpm-test', siteUrl: 'https://theawfulpm-test.wpengine.com',
    standardResponse: { status: 404, headers: {}, bodyPreview: 'Site is not available' },
    googlebotResponse: { status: 404, headers: {}, bodyPreview: 'Site is not available' },
    googleReferrerResponse: { status: 404, headers: {}, bodyPreview: 'Site is not available' },
    loginPageStatus: 404, xmlrpcStatus: 404, usersApiStatus: 404, usersApiBody: '', randomPostStatuses: '(not collected)',
  });
  const r2 = await post({
    contents: [{ role: 'user', parts: [{ text: `Analyze the provided data and call the __output__ tool.\n\n${prompt}` }] }],
    tools: [outputTool],
    tool_config: { function_calling_config: { mode: 'ANY', allowed_function_names: ['__output__'] } },
  });
  console.log('Status:', r2.status);
  const b2 = JSON.parse(r2.body);
  if (b2.error) console.log('Error:', b2.error.message.slice(0, 200));
  else console.log('Success! Tool call:', b2.candidates?.[0]?.content?.parts?.[0]?.functionCall?.name);

  // ── Test 3: STREAMING endpoint (what the addon actually uses) ──
  console.log('\n── Test 3: Streaming endpoint (streamGenerateContent?alt=sse) + tool_config ──');
  const streamBody = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: `Analyze the provided data and call the __output__ tool.\n\n${prompt}` }] }],
    tools: [outputTool],
    tool_config: { function_calling_config: { mode: 'ANY', allowed_function_names: ['__output__'] } },
  });
  const r3 = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${GOOGLE_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(streamBody) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(streamBody);
    req.end();
  });
  console.log('Status:', r3.status);
  if (r3.status >= 400) {
    // Parse first JSON chunk from SSE stream or plain JSON error
    try {
      const errBody = JSON.parse(r3.body);
      console.log('Error:', errBody.error?.message?.slice(0, 200) ?? r3.body.slice(0, 200));
    } catch {
      console.log('Raw response (first 400):', r3.body.slice(0, 400));
    }
  } else {
    // Look for functionCall in SSE chunks
    const chunks = r3.body.split('\n').filter(l => l.startsWith('data: ')).map(l => {
      try { return JSON.parse(l.slice(6)); } catch { return null; }
    }).filter(Boolean);
    const call = chunks.flatMap(c => c.candidates?.[0]?.content?.parts ?? []).find(p => p.functionCall);
    if (call) console.log('Success! Tool call:', call.functionCall?.name);
    else {
      const text = chunks.flatMap(c => c.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('');
      console.log('No tool call — model responded in text:', text.slice(0, 200));
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
