'use strict';

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

SITE: ${data.installName}

## WP core verify-checksums output
${data.coreChecksums}

## Plugin checksum results (wp plugin verify-checksums per slug)
${data.pluginChecksums}

## wp-config.php modification time vs. expected (site created: ${data.siteCreatedAt})
${data.configPhpMtime}

Return the integrity status for core, each plugin, and wp-config.php.
Mark plugins not on WordPress.org as 'unverifiable'. List every failed file.`;
}

module.exports = { schema, buildPrompt };
