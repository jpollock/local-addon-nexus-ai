#!/usr/bin/env node
/**
 * Tests whether a JWT minted by the Hub Plugin on a connected local site
 * can be used directly from Node.js against api.ai.wpengine.com.
 *
 * Also decodes the JWT to check expiry (answers Q5).
 *
 * Usage — get JWT from MCP wp_eval first, then pass as env var:
 *
 *   JWT="eyJ..." PROJECT_ID="proj_xxx" node scripts/test-jwt-bridge.mjs
 *
 * Get JWT via Nexus MCP (in Claude Code):
 *   wp_eval on t2: echo json_encode(['token' => wpe_auth_get_token(), 'project_id' => wpe_auth_get_project_id()])
 */

const BASE = 'https://api.ai.wpengine.com'

const token = process.env.JWT
const projectId = process.env.PROJECT_ID

if (!token || !token.includes('.')) {
  console.error('Usage: JWT="eyJ..." PROJECT_ID="proj_xxx" node scripts/test-jwt-bridge.mjs')
  console.error('Get JWT from Nexus MCP wp_eval: echo wpe_auth_get_token()')
  process.exit(1)
}

const clientId = process.env.CLIENT_ID ?? '(not provided)'

// Decode JWT (no verification — just inspect claims)
const [header, payload] = token.split('.')
const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString())
const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString())
const expiresInSec = decodedPayload.exp
  ? Math.round((decodedPayload.exp * 1000 - Date.now()) / 1000)
  : null

console.log('JWT Header:  ', JSON.stringify(decodedHeader))
console.log('JWT Subject: ', decodedPayload.sub ?? '(none)')
console.log('JWT Issuer:  ', decodedPayload.iss ?? '(none)')
console.log('JWT Expiry:  ', expiresInSec !== null ? `${expiresInSec}s from now` : 'no exp claim')
console.log('Project ID:  ', projectId)
console.log('Client ID:   ', clientId)

const headers = {
  'Authorization': `Bearer ${token}`,
  'WPEngine-Project': projectId,
  'Content-Type': 'application/json',
}

async function check(label, url, options = {}) {
  try {
    const res = await fetch(url, { headers, ...options })
    const text = await res.text()
    let preview = ''
    try {
      const json = JSON.parse(text)
      if (json.data) preview = `(${json.data.length} items)`
      else if (json.error) preview = json.error.message ?? ''
      else preview = JSON.stringify(json).slice(0, 80)
    } catch {
      preview = text.slice(0, 80)
    }
    const icon = res.status < 300 ? '✓' : '✗'
    console.log(`${icon} ${res.status}  ${label}  ${preview}`)
    return res.status
  } catch (err) {
    console.log(`✗ ERR  ${label}  ${err.message}`)
    return 0
  }
}

console.log('\n=== Inference / Meta ===')
await check('GET  /v1/models',         `${BASE}/v1/models`)
await check('GET  /v1/credits',        `${BASE}/v1/credits`)

console.log('\n=== Content Tooling ===')
await check('POST /v1/content/summarize', `${BASE}/v1/content/summarize`, {
  method: 'POST',
  body: JSON.stringify({ content: 'WordPress is an open-source CMS used by millions of websites.' }),
})

console.log('\n=== Agent Registry ===')
await check('GET  /v1/agents',         `${BASE}/v1/agents?project_id=${projectId}`)
await check('POST /v1/agents (dry)',   `${BASE}/v1/agents`, {
  method: 'POST',
  body: JSON.stringify({
    name: 'nexus-jwt-bridge-test',
    model: 'anthropic/claude-haiku-4-5',
    project_id: projectId,
  }),
})

console.log('\n=== Sessions ===')
await check('GET  /v1/sessions',       `${BASE}/v1/sessions?project_id=${projectId}`)

console.log('\n=== Knowledge Base ===')
await check('GET  /v1/kb/collections', `${BASE}/v1/kb/collections`)

console.log('\nDone.')
