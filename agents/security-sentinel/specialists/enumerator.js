'use strict';

// Enumerator specialist: produce a complete inventory of what exists.
// No analysis — pure enumeration. Data is passed in; no tool calls needed.

const schema = {
  type: 'object',
  properties: {
    pluginDirectories: {
      type: 'array',
      description: 'All directories found under wp-content/plugins/',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          createdAt: { type: 'string', description: 'ISO timestamp or null if unknown' },
          fileCount: { type: 'integer' },
        },
        required: ['name', 'createdAt', 'fileCount'],
      },
    },
    unexpectedFiles: {
      type: 'array',
      description: 'Files with non-standard extensions in PHP-executable directories, or symlinks',
      items: { type: 'object', properties: { path: { type: 'string' }, reason: { type: 'string' } }, required: ['path', 'reason'] },
    },
    htaccessFiles: {
      type: 'array',
      description: 'All .htaccess files found anywhere in the web root',
      items: { type: 'string' },
    },
    nonStandardTables: {
      type: 'array',
      description: 'WordPress database tables not in the standard WP table set',
      items: { type: 'string' },
    },
    autoloadedOptions: {
      type: 'array',
      description: 'option_name values for all autoloaded WordPress options',
      items: { type: 'string' },
    },
  },
  required: ['pluginDirectories', 'unexpectedFiles', 'htaccessFiles', 'nonStandardTables', 'autoloadedOptions'],
};

function buildPrompt(data) {
  return `You are a WordPress forensics inventory specialist. Produce a complete structured inventory of the following site data.
Do not analyze or flag — only enumerate what exists. Return raw facts.

SITE: ${data.installName}

## Plugin directories (from filesystem scan)
${data.pluginDirectoriesRaw}

## Files in web root with non-standard extensions or locations
${data.unexpectedFilesRaw}

## .htaccess file paths found
${data.htaccessPathsRaw}

## Database: non-standard tables
${data.nonStandardTablesRaw}

## Database: autoloaded wp_options (option_name only)
${data.autoloadedOptionsRaw}

Return exactly the fields in the schema. For createdAt, use the filesystem mtime if available, or null.`;
}

module.exports = { schema, buildPrompt };
