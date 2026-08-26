#!/usr/bin/env node
/**
 * spike/power-ai-sdk · which REAL tool schema makes Power 400?
 *
 * Usage: POWER_API_KEY=wpe_xxx node scripts/spike-power-real-tools-probe.mjs [tools.json]
 *
 * Context: the capProbe in spike-power-aisdk-live.mjs showed 200 DUMMY tools
 * are accepted — so POWER_MAX_TOOLS=128 (commit 502d3554) "fixed" the chat 400
 * by accident, not because a count cap exists. Two hypotheses remain:
 *
 *   SIZE    — the real registry is ~147KB of schemas; the dummy probe sent ~24KB
 *   CONTENT — some specific schema in the dropped tail (index >= 128) is
 *             rejected by Power's request validation
 *
 * This probe replays the REAL schemas (a tools/list capture — default
 * /tmp/tools.json) exactly as adaptToolsForChat ships them (with
 * _confirmationToken stripped), and:
 *   1. reproduces the failure with all of them
 *   2. tests SIZE with dummy tools padded to the same total bytes
 *   3. if CONTENT: finds the failing prefix length, then isolates the exact
 *      offending tool(s) by testing each tail tool alone on a known-good base
 */
import { readFileSync } from 'node:fs';

const API_KEY = process.env.POWER_API_KEY;
const MODEL = process.env.POWER_MODEL || 'anthropic/claude-sonnet-4-5';
const TOOLS_PATH = process.argv[2] || '/tmp/tools.json';
if (!API_KEY) {
  console.error('Usage: POWER_API_KEY=wpe_xxx node scripts/spike-power-real-tools-probe.mjs [tools.json]');
  process.exit(1);
}

// ── the real schemas, shaped exactly as chat ships them ─────────────────────
const raw = JSON.parse(readFileSync(TOOLS_PATH, 'utf8'));
const realTools = raw.map((t) => {
  const parameters = JSON.parse(JSON.stringify(t.inputSchema ?? { type: 'object', properties: {} }));
  if (parameters.properties?._confirmationToken) delete parameters.properties._confirmationToken;
  if (Array.isArray(parameters.required)) {
    parameters.required = parameters.required.filter((r) => r !== '_confirmationToken');
    if (parameters.required.length === 0) delete parameters.required;
  }
  return { type: 'function', function: { name: t.name, description: t.description, parameters } };
});
console.log(`${realTools.length} real tools loaded from ${TOOLS_PATH}`);

// ── one raw request, no SDK — the variable under test is the payload ────────
async function attempt(tools, label) {
  const res = await fetch('https://api.ai.wpengine.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      stream: false,
      max_tokens: 16,
      tools,
    }),
  });
  const ok = res.ok;
  let detail = '';
  if (!ok) {
    const body = await res.text();
    detail = `${res.status} ${body.slice(0, 140).replace(/\s+/g, ' ')}`;
  } else {
    await res.text();
  }
  console.log(`  ${label}: ${ok ? 'ok' : `FAIL ${detail}`}`);
  return ok;
}

const bytes = (tools) => JSON.stringify(tools).length;

// ── 1. reproduce with the full real registry ────────────────────────────────
console.log(`\n[1] full real registry (${realTools.length} tools, ${bytes(realTools)}B)`);
const fullFails = !(await attempt(realTools, 'all real tools'));
if (!fullFails) {
  console.log('! Full registry ACCEPTED — the original failure does not reproduce.');
  console.log('  Either the route changed, or the failing variable is elsewhere (model? stream? max_tokens?).');
  process.exit(0);
}

// ── 2. size hypothesis: dummies padded to the same total bytes ──────────────
{
  const target = bytes(realTools);
  const n = realTools.length;
  const padLen = Math.max(0, Math.floor(target / n) - 150);
  const dummies = Array.from({ length: n }, (_, i) => ({
    type: 'function',
    function: {
      name: `probe_tool_${i}`,
      description: `Dummy probe tool ${i}. Never call. ${'x'.repeat(padLen)}`,
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
    },
  }));
  console.log(`\n[2] size-matched dummies (${n} tools, ${bytes(dummies)}B vs real ${target}B)`);
  const sizeFails = !(await attempt(dummies, 'padded dummies'));
  if (sizeFails) {
    console.log('→ SIZE is the variable: same byte volume of benign schemas also fails.');
    console.log('  The right bound is bytes/tokens, not tool count. Measure the byte threshold next.');
    process.exit(0);
  }
  console.log('→ size alone is fine at this volume; the variable is CONTENT. Searching…');
}

// ── 3. content: find failing prefix, then isolate the offender(s) ───────────
{
  // Largest accepted prefix of the real list (registration order — the shipped
  // slice(0,128) works, so lo starts there).
  let lo = 128, hi = realTools.length;
  console.log(`\n[3a] prefix search in [${lo}, ${hi}]`);
  if (!(await attempt(realTools.slice(0, lo), `prefix ${lo}`))) {
    console.log('! prefix 128 fails here — differs from shipped behaviour; searching below');
    lo = 1;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    (await attempt(realTools.slice(0, mid), `prefix ${mid}`)) ? (lo = mid) : (hi = mid);
  }
  const suspect = realTools[hi - 1];
  console.log(`\nlargest good prefix = ${lo}; first failing tool by position = index ${hi - 1}: ${suspect.function.name}`);

  // One bad apple, or several? Test the suspect alone on a tiny benign base,
  // and the full set minus the suspect.
  console.log('\n[3b] isolation');
  const base = realTools.slice(0, 5);
  const aloneOk = await attempt([...base, suspect], `benign base + ${suspect.function.name} alone`);
  const withoutOk = await attempt(realTools.filter((t) => t !== suspect), `all real minus ${suspect.function.name}`);

  if (!aloneOk && withoutOk) {
    console.log(`\n✓ single offender: ${suspect.function.name} — its schema is what Power rejects.`);
    console.log('  Fix that schema (or exclude it for Power) and DELETE POWER_MAX_TOOLS.');
  } else if (!aloneOk && !withoutOk) {
    console.log(`\n${suspect.function.name} is one offender of several. Re-run this script with a
tools.json that excludes it to find the next one (or extend this loop).`);
  } else {
    console.log(`\n${suspect.function.name} is fine alone — the failure is combinatorial (order or
accumulation). Suspect SIZE-plus-content interaction; capture the exact failing pair next.`);
  }
}
