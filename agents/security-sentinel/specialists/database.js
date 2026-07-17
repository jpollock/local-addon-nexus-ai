'use strict';

const schema = {
  type: 'object',
  properties: {
    injectedContent: {
      type: 'array',
      description: 'Database rows containing injected scripts or code',
      items: {
        type: 'object',
        properties: {
          table: { type: 'string' },
          column: { type: 'string' },
          id: { type: 'string' },
          snippet: { type: 'string', description: 'First 200 chars of injected content' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium'] },
        },
        required: ['table', 'severity'],
      },
    },
    suspiciousCronHooks: {
      type: 'array',
      description: 'Scheduled cron hooks that map to unknown or missing functions',
      items: { type: 'object', properties: { hook: { type: 'string' }, schedule: { type: 'string' } }, required: ['hook'] },
    },
    optionAnomalies: {
      type: 'array',
      description: 'wp_options entries with suspicious values',
      items: {
        type: 'object',
        properties: { optionName: { type: 'string' }, reason: { type: 'string' } },
        required: ['optionName', 'reason'],
      },
    },
    nonStandardTableContent: {
      type: 'array',
      description: 'Content found in non-standard database tables',
      items: { type: 'object', properties: { table: { type: 'string' }, rowCount: { type: 'number' }, sample: { type: 'string' } }, required: ['table'] },
    },
    samplingNote: { type: 'string', description: 'What was sampled and what was skipped due to size' },
  },
  required: ['injectedContent', 'suspiciousCronHooks', 'optionAnomalies', 'nonStandardTableContent', 'samplingNote'],
};

function buildPrompt(data) {
  return `You are a WordPress database forensics specialist. Scan the following database contents for injected malicious content.

SITE: ${data.installName}

## wp_posts (all statuses, post_title + post_content sample)
${data.postsContent}

## wp_options — autoloaded values
${data.autoloadedOptions}

## wp_options — siteurl, home, active_plugins, cron
${data.criticalOptions}

## wp_usermeta — admin user meta (serialized objects)
${data.adminUsermeta}

## wp_comments — 50 most recent approved (content only)
${data.recentComments}

## Non-standard tables
${data.nonStandardTableData}

WHAT TO LOOK FOR:
- <script, <iframe, javascript:, base64, eval( in post_content
- siteurl or home pointing to unexpected domain
- active_plugins listing a slug not present on disk
- cron hooks calling functions from unknown plugins
- Serialized PHP objects in usermeta (O: pattern with callable methods)
- SEO spam in comment_content or post titles
- Any non-standard table content

State sampling limits explicitly — what rows were skipped due to table size.`;
}

module.exports = { schema, buildPrompt };
