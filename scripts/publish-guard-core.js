'use strict';

/**
 * Pure core of the npm-publish safety guard (P0-4).
 *
 * ACF PRO is a paid WP Engine product and must never ship in a distributed
 * artifact. It is kept out of git by .gitignore only, and package.json's
 * `files` array lists both `lib` and the top-level `wp-plugins` — so the moment
 * a `.npmignore` appears (it OVERRIDES .gitignore for packing) or the ignore
 * rules drift, a local `npm publish` would upload it. The R2/package-addon path
 * already fails loud on this; the npm-publish path had no guard at all.
 *
 * Given the exact file list npm would publish, return every forbidden path.
 * Matching is by whole path segment (not substring), so a directory named
 * `advanced-custom-fields-pro` is caught while a file merely named
 * `advanced-custom-fields-pro.md` is not.
 */

const FORBIDDEN_SEGMENTS = ['advanced-custom-fields-pro'];

function segmentsOf(p) {
  return String(p).split(/[\\/]/);
}

function findForbiddenPublishFiles(paths) {
  if (!Array.isArray(paths)) return [];
  return paths.filter((p) => {
    const segs = segmentsOf(p);
    return FORBIDDEN_SEGMENTS.some((seg) => segs.includes(seg));
  });
}

/**
 * Content half of the publish guard (v0.6.0).
 *
 * The path half above catches a forbidden FILE. That is not enough here, and
 * the reason is worth stating precisely because the first draft of this got it
 * wrong. `lib/` is a compiled TREE mirroring `src/`, not a single bundle, so a
 * path rule WOULD catch `lib/main/mcp/modules/iw/*`. What it cannot catch is
 * the same product surface living inside legitimately-named files: measured on
 * this tree, `lib/main/ipc-handlers.js` carries "Intelligent Web" and "Hub
 * Plugin", and `lib/main/ai-gateway/AIGatewayRoutes.js` carries "WP Engine
 * Power". Those files must ship. Only their contents must not.
 *
 * Patterns are deliberately narrow. A guard with false positives gets deleted;
 * `powerful`, `AI-powered` and `superpowers` are all live in this codebase and
 * are pinned as must-survive in the suite.
 */
const FORBIDDEN_CONTENT = [
  {
    label: 'Intelligent Web MCP tool name',
    pattern: /\biw_(?:connect_site|disconnect_site|get_connection_status|fleet_status|list_kb_collections|get_kb_collection|search_kb)\b/,
  },
  { label: 'Intelligent Web product name', pattern: /Intelligent Web/ },
  { label: 'Hub Plugin product name', pattern: /Hub Plugin/ },
  { label: 'WP Engine Power inference endpoint', pattern: /api\.ai\.wpengine\.com/ },
  { label: 'WP Engine Power product name', pattern: /WP Engine Power/ },
];

/**
 * Given the packed files as {path, content}, return every rule hit.
 * Text-only: the caller is responsible for skipping binaries.
 */
function findForbiddenPublishContent(files) {
  if (!Array.isArray(files)) return [];
  const hits = [];
  for (const file of files) {
    if (!file || typeof file.content !== 'string') continue;
    for (const rule of FORBIDDEN_CONTENT) {
      if (rule.pattern.test(file.content)) {
        hits.push({ path: file.path, label: rule.label });
      }
    }
  }
  return hits;
}

module.exports = {
  findForbiddenPublishFiles,
  FORBIDDEN_SEGMENTS,
  findForbiddenPublishContent,
  FORBIDDEN_CONTENT,
};
