'use strict';

const { untrusted, UNTRUSTED_DATA_RULE, SEVERITY_SCALE } = require('./_shared');

const schema = {
  type: 'object',
  properties: {
    coreVerification: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['passed', 'failed', 'unavailable'] },
        failures: { type: 'array', items: { type: 'string' } },
      },
      required: ['status', 'failures'],
    },
    pluginVerification: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          status: { type: 'string', enum: ['passed', 'failed', 'unverifiable'] },
          failures: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string', description: 'Why unverifiable if applicable' },
        },
        required: ['slug', 'status', 'failures'],
      },
    },
    configPhpModified: {
      type: 'boolean',
      description: 'Whether wp-config.php was modified after the site was last known clean',
    },
  },
  required: ['coreVerification', 'pluginVerification', 'configPhpModified'],
};

function buildPrompt(data) {
  return `You are a WordPress integrity verification specialist. Analyze the following checksum and modification data.

${UNTRUSTED_DATA_RULE}

${SEVERITY_SCALE}

SITE: ${data.installName}

## WP core verify-checksums output
${untrusted('core_checksums', data.coreChecksums)}

## Plugin checksum results (wp plugin verify-checksums per slug)
${untrusted('plugin_checksums', data.pluginChecksums)}

## wp-config.php modification time vs. expected (site created: ${data.siteCreatedAt})
${untrusted('config_mtime', data.configPhpMtime)}

NOTE: If any section above shows "(not collected)" or is empty, treat it as no data available — do
not infer findings from it. In particular, if plugin checksum data is "(not collected)", mark every
plugin 'unverifiable' rather than reporting any as passed or failed; absence of data is not evidence
of integrity, and it is not evidence of tampering either.

Return the integrity status for core, each plugin, and wp-config.php.
Mark plugins not on WordPress.org as 'unverifiable'. List every failed file.`;
}

module.exports = { schema, buildPrompt };
