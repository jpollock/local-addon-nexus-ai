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

module.exports = { findForbiddenPublishFiles, FORBIDDEN_SEGMENTS };
