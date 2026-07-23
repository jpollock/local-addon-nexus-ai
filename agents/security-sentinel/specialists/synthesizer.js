'use strict';

const schema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['active-compromise', 'high-risk', 'misconfiguration', 'clean'] },
    attackSummary: { type: 'string', description: 'Two-paragraph narrative of what happened and how' },
    entryPoint: { type: 'string', description: 'How the attacker likely gained initial access' },
    temporalNarrative: {
      type: 'string',
      description: 'Timeline of the attack: what happened when, in what order',
    },
    attackerItems: {
      type: 'array',
      description: 'Items confirmed or probable as attacker-introduced',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['plugin', 'user', 'file', 'database', 'option'] },
          name: { type: 'string' },
          confidence: { type: 'string', enum: ['confirmed', 'probable', 'possible'] },
          reasoning: { type: 'string' },
          action: { type: 'string', description: 'Recommended remediation action' },
        },
        required: ['type', 'name', 'confidence', 'reasoning', 'action'],
      },
    },
    legitimateItems: {
      type: 'array',
      description: 'Items confirmed pre-existing and legitimate',
      items: { type: 'object', properties: { type: { type: 'string' }, name: { type: 'string' } }, required: ['type', 'name'] },
    },
    blindSpots: {
      type: 'array',
      description: 'Things that were NOT checked — explicit disclosure of coverage limits',
      items: { type: 'string' },
    },
    remediationSteps: {
      type: 'array',
      description: 'Ordered list of remediation steps, most critical first',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'integer' },
          label: { type: 'string' },
          command: { type: 'string', description: 'Exact WP-CLI or shell command, or empty if manual' },
          tier: { type: "string", enum: ["1", "2", "3"] },
          requiresApproval: { type: 'boolean' },
        },
        required: ['priority', 'label', 'tier', 'requiresApproval'],
      },
    },
  },
  required: ['verdict', 'attackSummary', 'entryPoint', 'temporalNarrative', 'attackerItems', 'legitimateItems', 'blindSpots', 'remediationSteps'],
};

function buildPrompt(data) {
  return `You are a senior WordPress security analyst synthesizing findings from five specialist agents.
Your job: correlate, elevate, and produce a remediation plan. You must also explicitly disclose blind spots.

SITE: ${data.installName} (${data.environment}, ${data.postCount} posts, created: ${data.siteCreatedAt})
LAST WPE SSH SYNC: ${data.lastSyncAt}

## Tier 1 signals (static analysis)
${data.tier1Signals}

## Enumerator findings
${JSON.stringify(data.enumeratorResult, null, 2)}

## Integrity findings
${JSON.stringify(data.integrityResult, null, 2)}

## Pattern scanner findings (includes temporal cluster analysis)
${JSON.stringify(data.patternResult, null, 2)}

## Database findings
${JSON.stringify(data.databaseResult, null, 2)}

## Behavioral findings
${JSON.stringify(data.behavioralResult, null, 2)}
${data.logCorroboration ? `
## Access log corroboration (30-day aggregate from log-processor)
${data.logCorroboration}
` : ''}
SYNTHESIS RULES:
1. CRITICAL from any specialist leads the report — do not bury it.
2. Temporal cluster from the pattern scanner IS the attack session boundary. All items within the
   cluster window are suspect regardless of whether their name matches a known-bad list.
3. Cross-agent correlation: a file flagged by pattern scanner AND in the temporal cluster window
   becomes CONFIRMED. A file flagged by only one agent is PROBABLE.
4. Always name the entry point — how did the attacker first get in? This is the most important
   question for preventing recurrence.
5. If access log data is present: use auth attack volume and IP cardinality to calibrate severity.
   A brute-force campaign that succeeded (new admin account + high login volume) is more urgent
   than a static signal alone. Corroborate — don't just repeat.
6. Remediation steps must be ordered: stop active exfiltration first, then remove persistence,
   then close entry point, then verify clean.
7. BLIND SPOTS — always include these unless the specialist explicitly covered them:
   - Premium plugins (no checksums available from WordPress.org)
   - Runtime-assembled payloads (encrypted DB fragments assembled in memory at request time)
   - Time-triggered or IP-conditional code
   - Image EXIF data
   - Binary files (detected but not decompiled)
   - Any network-fetched payload (code that downloads its payload at runtime leaves no local trace)
   - wp_comments table if >10k rows (sampled only)
   Add any other gaps specific to this site that the specialists flagged.`;
}

module.exports = { schema, buildPrompt };
