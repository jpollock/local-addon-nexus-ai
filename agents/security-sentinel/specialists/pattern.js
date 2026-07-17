'use strict';

const schema = {
  type: 'object',
  properties: {
    criticalFindings: {
      type: 'array',
      description: 'High-confidence malicious patterns',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          lineNumber: { type: 'integer' },
          pattern: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium'] },
          snippet: { type: 'string', description: 'First 120 chars of the matched line' },
        },
        required: ['file', 'pattern', 'severity'],
      },
    },
    htaccessFindings: {
      type: 'array',
      description: 'Suspicious .htaccess rules',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, rule: { type: 'string' }, reason: { type: 'string' } },
        required: ['file', 'rule', 'reason'],
      },
    },
    temporalCluster: {
      type: 'object',
      description: 'Burst of file modifications in a short window — primary attack signal',
      properties: {
        detected: { type: 'boolean' },
        windowStart: { type: 'string' },
        windowEnd: { type: 'string' },
        itemCount: { type: 'integer' },
        items: { type: 'array', items: { type: 'string' } },
      },
      required: ['detected'],
    },
    filesScanned: { type: 'integer' },
    filesClean: { type: 'integer' },
  },
  required: ['criticalFindings', 'htaccessFindings', 'temporalCluster', 'filesScanned', 'filesClean'],
};

function buildPrompt(data) {
  return `You are a WordPress malware pattern scanner. Analyze the following file scan results.

SITE: ${data.installName}
COMPROMISE WINDOW ESTIMATE: ${data.compromiseWindowEstimate ?? 'unknown'}

## PHP files with potential malicious patterns (pre-scanned output)
${data.patternScanOutput}

## All .htaccess file contents
${data.htaccessContents}

## File modification times (files modified in last 30 days)
${data.recentlyModifiedFiles}

RULES:
- CRITICAL: eval( combined with base64_decode, gzinflate, str_rot13, or gzuncompress
- CRITICAL: ELF binary header in any file
- CRITICAL: PHP execution in image/SVG extension (.jpg, .png, .svg containing <?php)
- HIGH: base64_decode on a string >500 chars
- HIGH: .htaccess RewriteRule sending to external domain
- TEMPORAL CLUSTER: If more than 3 files share modification timestamps within a 10-minute window,
  flag the entire cluster — rapid bulk modification is not consistent with normal site management.
  This is the primary signal for detecting attacker-installed plugins when plugin names are unfamiliar.

Return every finding. For temporalCluster, identify the window even if individual files look benign.`;
}

module.exports = { schema, buildPrompt };
