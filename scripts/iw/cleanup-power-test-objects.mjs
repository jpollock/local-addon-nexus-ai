#!/usr/bin/env node
/**
 * Deletes the throwaway objects our API probes created in the Power project:
 *   agents:      nexus-test-agent, nexus-jwt-bridge-test
 *   collections: nexus-test-collection
 *
 * Lists first, matches by name, then DELETEs by id. Safe to re-run — if an
 * object is already gone it is simply skipped.
 *
 * Usage:
 *   API_KEY=wpe_xxx PROJECT_ID=proj_cE8Ib44IuegI3rH5l1MbBy \
 *     node scripts/cleanup-power-test-objects.mjs
 *
 * PROJECT_ID defaults to the t2 project used during testing.
 */

const BASE = 'https://api.ai.wpengine.com'
const apiKey = process.env.API_KEY
const projectId = process.env.PROJECT_ID ?? 'proj_cE8Ib44IuegI3rH5l1MbBy'

const AGENT_NAMES = new Set(['nexus-test-agent', 'nexus-jwt-bridge-test'])
const COLLECTION_NAMES = new Set(['nexus-test-collection'])

if (!apiKey || !apiKey.startsWith('wpe_')) {
  console.error('Usage: API_KEY=wpe_xxx [PROJECT_ID=proj_xxx] node scripts/cleanup-power-test-objects.mjs')
  process.exit(1)
}

const headers = {
  'Authorization': `Bearer ${apiKey}`,
  'WPEngine-Project': projectId,
  'Content-Type': 'application/json',
}

async function json(url, options = {}) {
  const res = await fetch(url, { headers, ...options })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, body }
}

// Objects may expose their id under different keys depending on the resource.
const idOf = (o) => o.id ?? o.agent_id ?? o.collection_id
const nameOf = (o) => o.name ?? ''

async function cleanup(kind, listPath, deletePathFor, names) {
  console.log(`\n=== ${kind} ===`)
  const { status, body } = await json(`${BASE}${listPath}`)
  if (status >= 300) {
    console.log(`✗ ${status}  could not list ${kind}: ${JSON.stringify(body).slice(0, 120)}`)
    return
  }
  const items = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
  const targets = items.filter((o) => names.has(nameOf(o)))

  if (targets.length === 0) {
    console.log(`✓ nothing to delete (${items.length} ${kind} in project, none match test names)`)
    return
  }

  for (const t of targets) {
    const id = idOf(t)
    if (!id) {
      console.log(`✗ skipping "${nameOf(t)}" — no id field found`)
      continue
    }
    const del = await json(`${BASE}${deletePathFor(id)}`, { method: 'DELETE' })
    const icon = del.status < 300 ? '✓' : '✗'
    console.log(`${icon} ${del.status}  deleted ${kind.slice(0, -1)} "${nameOf(t)}" (${id})`)
  }
}

console.log(`Project: ${projectId}`)

await cleanup(
  'agents',
  `/v1/agents?project_id=${projectId}`,
  (id) => `/v1/agents/${encodeURIComponent(id)}`,
  AGENT_NAMES,
)

await cleanup(
  'collections',
  `/v1/kb/collections`,
  (id) => `/v1/kb/collections/${encodeURIComponent(id)}`,
  COLLECTION_NAMES,
)

console.log('\nDone.')
