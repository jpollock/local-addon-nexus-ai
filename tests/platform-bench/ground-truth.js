#!/usr/bin/env node
/**
 * Ground truth for the platform benchmark, measured from the substrate.
 *
 * Every number a rubric or anchor asserts lives here, derived by running
 * WP-CLI over SSH against the demo sites — never copied from any column's
 * graded output (a key copied from the output you are grading is not a key).
 *
 * Modes:
 *   node ground-truth.js            measure everything, write keys.json
 *   node ground-truth.js --check    re-measure, diff against keys.json:
 *                                   exit 0 + measured snapshot on stdout, or
 *                                   exit 1 with every mismatch named.
 *
 * The stale-treatments count is DATE-RELATIVE ("not reviewed in 3 years"), so
 * it rots as calendar time passes even when nobody touches the site. That is
 * a feature: the --check gate catches time-rot the same way it catches edits.
 *
 * SSH routes (all verified live 2026-08-24/25):
 *   cedarvalehealt  ssh cedarvalehealt@cedarvalehealt.ssh.wpengine.net, cd sites/cedarvalehealt
 *   summitdermatol  ssh summitdermatol@summitdermatol.ssh.wpengine.net, cd sites/summitdermatol
 *   ridgeline       ssh hostinger-test, cd ~/domains/palegreen-capybara-114180.hostingersite.com/public_html
 *   willowcreekderm ssh willowcreekderm, cd /sites/willowcreekderm.com/files
 *   alpineoutfitte  ssh alpineoutfitte@alpineoutfitte.ssh.wpengine.net, cd sites/alpineoutfitte
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const KEYS_PATH = path.join(__dirname, 'keys.json');
const SSH_TIMEOUT_MS = 90_000;

const HOSTS = {
  cedarvalehealt: { target: 'cedarvalehealt@cedarvalehealt.ssh.wpengine.net', dir: 'sites/cedarvalehealt' },
  summitdermatol: { target: 'summitdermatol@summitdermatol.ssh.wpengine.net', dir: 'sites/summitdermatol' },
  ridgeline: { target: 'hostinger-test', dir: '~/domains/palegreen-capybara-114180.hostingersite.com/public_html' },
  willowcreekderm: { target: 'willowcreekderm', dir: '/sites/willowcreekderm.com/files' },
  alpineoutfitte: { target: 'alpineoutfitte@alpineoutfitte.ssh.wpengine.net', dir: 'sites/alpineoutfitte' },
};

/**
 * Run one wp-eval over SSH. The PHP must echo exactly one line starting with
 * NEXUSGT: followed by JSON — shell MOTDs and warnings make raw stdout
 * unparseable, so the marker line is the contract.
 */
function sshWpEval(hostKey, php) {
  const { target, dir } = HOSTS[hostKey];
  const script = `cd ${dir} || exit 1\nwp eval '${php.replace(/'/g, "'\\''")}'\n`;
  const out = execFileSync('ssh', ['-o', 'BatchMode=yes', target, 'bash -s'],
    { input: script, encoding: 'utf8', timeout: SSH_TIMEOUT_MS });
  const line = out.split('\n').find((l) => l.startsWith('NEXUSGT:'));
  if (!line) throw new Error(`${hostKey}: no NEXUSGT line in output:\n${out.slice(-500)}`);
  return JSON.parse(line.slice('NEXUSGT:'.length));
}

function sshRaw(hostKey, remoteCmd) {
  const { target, dir } = HOSTS[hostKey];
  return execFileSync('ssh', ['-o', 'BatchMode=yes', target, `cd ${dir} && ${remoteCmd}`],
    { encoding: 'utf8', timeout: SSH_TIMEOUT_MS }).trim();
}

/**
 * Plugin census by CLASS, not just count.
 *
 * `wp plugin list` distinguishes active / inactive / must-use / dropin. This is the
 * whole point of AO-S-01: the graph cache stores one `is_active` integer and collapses
 * must-use and dropins into 0, so a cache-derived answer calls eight always-on plugins
 * "inactive". Coworker's `list-plugins` ability has the opposite blind spot — it uses
 * the WordPress plugins REST API, which returns regular plugins ONLY, so must-use and
 * dropins are invisible to it entirely. Neither view is complete; the key holds the
 * truth both are measured against.
 */
/**
 * Fleet-wide ACF spread, read from the graph via the sqlite3 CLI.
 *
 * Two things to know before trusting these numbers.
 *
 * PROVENANCE. Every other key here is measured over SSH from the site itself,
 * independent of anything Nexus caches. This one is not: it reads Nexus's own
 * graph, which is the system under test, so it cannot falsify the Nexus column's
 * RETRIEVAL. What it can still falsify is the column's REASONING — the add-on-slug
 * trap and the sites-vs-installs confusion are both errors a column commits with
 * perfect data in front of it, and eval-orG caught the second one three times.
 *
 * WHY THE CLI, NOT better-sqlite3. The module in node_modules is compiled for
 * whichever runtime last built it — Electron after `npm run rebuild`, system Node
 * after `npm install`. ground-truth.js runs under system Node and must not care
 * which state the tree is in, so it shells out.
 */
function fleetAcfSpread() {
  const DB = path.join(process.env.HOME, 'Library/Application Support/Local/nexus-ai/graph.db');
  const q = (sql) => execFileSync('sqlite3', [DB, sql], { encoding: 'utf8', timeout: 15_000 }).trim();
  const CORE_PRO = "p.slug IN ('advanced-custom-fields','advanced-custom-fields-pro')";
  const num = (sql) => Number(q(sql));
  return {
    // The answer to the scenario's question, as asked: distinct ACTIVE sites.
    sites_with_acf: num(`SELECT COUNT(DISTINCT p.site_id) FROM plugins p JOIN sites s ON s.id=p.site_id WHERE s.is_active=1 AND ${CORE_PRO};`),
    distinct_versions: num(`SELECT COUNT(DISTINCT p.version) FROM plugins p JOIN sites s ON s.id=p.site_id WHERE s.is_active=1 AND ${CORE_PRO};`),
    sites_le_6_3: num(`SELECT COUNT(DISTINCT p.site_id) FROM plugins p JOIN sites s ON s.id=p.site_id WHERE s.is_active=1 AND ${CORE_PRO} AND (p.version LIKE '6.1%' OR p.version LIKE '6.2%' OR p.version LIKE '6.3%');`),
    sites_with_both_core_and_pro: num(`SELECT COUNT(*) FROM (SELECT p.site_id FROM plugins p JOIN sites s ON s.id=p.site_id WHERE s.is_active=1 AND ${CORE_PRO} GROUP BY p.site_id HAVING COUNT(DISTINCT p.slug)=2);`),
    sites_on_beta: num(`SELECT COUNT(DISTINCT p.site_id) FROM plugins p JOIN sites s ON s.id=p.site_id WHERE s.is_active=1 AND ${CORE_PRO} AND p.version LIKE '%beta%';`),
    newest: q(`SELECT p.version FROM plugins p JOIN sites s ON s.id=p.site_id WHERE s.is_active=1 AND ${CORE_PRO} GROUP BY p.version ORDER BY COUNT(*) DESC LIMIT 1;`),
    oldest: q(`SELECT p.version FROM plugins p JOIN sites s ON s.id=p.site_id WHERE s.is_active=1 AND ${CORE_PRO} ORDER BY CAST(substr(p.version,1,instr(p.version,'.')-1) AS INT), CAST(substr(p.version, instr(p.version,'.')+1) AS INT) LIMIT 1;`),
    // The wrong answers, measured — so the rubric can name them instead of guessing.
    // eval-orG: Nexus answered 85, then 91, then "99 installs across 689 sites" to
    // the SAME question. It was switching denominators between runs, so the rubric
    // has to say which denominator it means and what the near-misses look like.
    wrong_prefix_sweep: num(`SELECT COUNT(DISTINCT p.site_id) FROM plugins p JOIN sites s ON s.id=p.site_id WHERE s.is_active=1 AND p.slug LIKE 'advanced-custom-fields%';`),
    wrong_including_inactive: num(`SELECT COUNT(DISTINCT p.site_id) FROM plugins p JOIN sites s ON s.id=p.site_id WHERE ${CORE_PRO};`),
    wrong_rows_not_sites: num(`SELECT COUNT(*) FROM plugins p JOIN sites s ON s.id=p.site_id WHERE s.is_active=1 AND ${CORE_PRO};`),
  };
}

/** Installed version of one slug from a census, or null if absent. */
function versionOf(census, slug) {
  const hit = census.roster.find((r) => r.slug === slug);
  return hit ? hit.version : null;
}

function sshPluginCensus(hostKey) {
  const raw = sshRaw(hostKey, 'wp plugin list --format=json --skip-plugins --skip-themes 2>/dev/null');
  const start = raw.indexOf('[');
  if (start < 0) throw new Error(`${hostKey}: no JSON array in wp plugin list output:\n${raw.slice(-400)}`);
  const rows = JSON.parse(raw.slice(start));
  const by = (st) => rows.filter((r) => r.status === st).length;
  return {
    entries_total: rows.length,
    active: by('active'),
    inactive: by('inactive'),
    mustuse: by('must-use'),
    dropin: by('dropin'),
    // What a REST-API-shaped view (Coworker) can see: regular plugins only.
    regular_only_total: by('active') + by('inactive'),
    // Provenance, not an assertion. Named `roster` (not `plugins`) so diffKeys can
    // IGNORE it by key without also ignoring the counts above — the counts are what
    // the rubrics assert, and they must stay gated. Any plugin version a rubric
    // actually quotes is promoted to its own scalar key below, so it stays gated too.
    roster: rows.map((r) => ({ slug: r.name, version: r.version, status: r.status })),
  };
}

/**
 * Maintenance facts from the wp.org plugin directory — NOT from either column.
 *
 * WC-S-01 turns on the difference between currency and maintenance, and that
 * difference is only visible here: `search-everything` is at its LATEST published
 * version and has not been touched since 2017. An update check answers "0 updates"
 * and calls the site healthy. This is also the one key source in the suite that is
 * genuinely independent of Nexus AND of Coworker, which is why wp.org-anchored
 * plugin facts are preferred wherever a scenario allows them.
 *
 * Returns null for a plugin the directory does not carry (commercial, host-bundled,
 * or ours) — absence is a real answer, not a failure.
 */
async function wpOrgPluginFacts(slug) {
  const res = await fetch(`https://api.wordpress.org/plugins/info/1.0/${slug}.json`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const d = await res.json();
  if (!d || d.error) return null;
  return {
    version: d.version ?? null,
    last_updated: (d.last_updated ?? '').slice(0, 10) || null,
    tested_up_to: d.tested ?? null,
  };
}

// ── PHP measurement snippets (postmeta keys are the unprefixed ACF names) ─────

const PHP_PROVIDERS = `
$ids = get_posts(["post_type"=>"provider","posts_per_page"=>-1,"fields"=>"ids","post_status"=>"publish"]);
$acc = [];
foreach ($ids as $id) {
  if ((string) get_post_meta($id, "accepting_new_patients", true) === "1") {
    $acc[(string) get_post_meta($id, "npi", true)] = get_the_title($id);
  }
}
echo "NEXUSGT:" . json_encode(["total"=>count($ids), "accepting"=>count($acc), "npis"=>$acc]) . "\\n";
`;

const PHP_TREATMENTS = `
$ids = get_posts(["post_type"=>"treatment","posts_per_page"=>-1,"fields"=>"ids","post_status"=>"publish"]);
$cut = strtotime("-3 years");
$overdue = 0; $unreviewed = 0; $stale = 0;
foreach ($ids as $id) {
  $st = (string) get_post_meta($id, "review_status", true);
  $rd = (string) get_post_meta($id, "review_date", true);
  if ($st === "overdue") $overdue++;
  if ($st === "unreviewed") $unreviewed++;
  $t = $rd !== "" ? strtotime($rd) : false;
  if ($t === false || $t < $cut) $stale++;
}
echo "NEXUSGT:" . json_encode(["total"=>count($ids), "overdue"=>$overdue, "unreviewed"=>$unreviewed, "stale"=>$stale]) . "\\n";
`;

const PHP_LOCATIONS = `
$ids = get_posts(["post_type"=>"location","posts_per_page"=>-1,"fields"=>"ids","post_status"=>"publish"]);
$with = 0;
foreach ($ids as $id) { if ((int) get_post_meta($id, "hours", true) > 0) $with++; }
echo "NEXUSGT:" . json_encode(["total"=>count($ids), "with_hours"=>$with]) . "\\n";
`;

const PHP_FINGERPRINT = `
global $wpdb;
$r = $wpdb->get_row("SELECT COUNT(*) c, MAX(post_modified_gmt) m FROM {$wpdb->posts} WHERE post_status = " . chr(39) . "publish" . chr(39), ARRAY_A);
echo "NEXUSGT:" . json_encode(["published_posts"=>(int)$r["c"], "last_modified_gmt"=>$r["m"]]) . "\\n";
`;


// ── Alpine Outfitters (in-site intelligence) ─────────────────────────────────
// These atoms are structural, not date-relative: they describe what the site
// HAS and, more importantly, what it LACKS. The absence facts are the point —
// no audience taxonomy, no kids SKU, no trip a party of three can book — and
// an audit answer that cannot reach them is the failure this family measures.

const PHP_ALPINE_CONTENT = `
$posts = get_posts(["post_type"=>"post","posts_per_page"=>-1,"fields"=>"ids","post_status"=>"publish"]);
$uncat = 0; $fam = 0;
foreach ($posts as $id) {
  $cats = wp_get_post_terms($id, "category", ["fields"=>"slugs"]);
  if (count($cats) === 1 && $cats[0] === "uncategorized") $uncat++;
  if (preg_match("/(kid|child|famil|toddler)/i", get_the_title($id))) $fam++;
}
$tags = (array) get_terms(["taxonomy"=>"post_tag","hide_empty"=>false,"fields"=>"slugs"]);
$aud = array_values(array_filter($tags, function($s){ return preg_match("/(famil|kid|child|youth|age|audience)/i", $s); }));
$tagged = get_posts(["post_type"=>"post","posts_per_page"=>-1,"fields"=>"ids","post_status"=>"publish","tax_query"=>[["taxonomy"=>"post_tag","field"=>"slug","terms"=>["family","families","kids","children"],"operator"=>"IN"]]]);
$dtax = (array) get_object_taxonomies("destination"); sort($dtax);
echo "NEXUSGT:" . json_encode([
  "posts_total"=>count($posts),
  "posts_uncategorized"=>$uncat,
  "posts_family_focused"=>$fam,
  "posts_tagged_family"=>count($tagged),
  "post_tags_total"=>count($tags),
  "post_tags_audience"=>$aud,
  "destination_taxonomies"=>array_values($dtax)
]) . "\\n";
`;

// products_kids counts TITLE and CATEGORY only, deliberately. A body-copy scan
// returns exactly one false positive on this substrate — the verb "baby" in
// "you do not have to baby your gear" (Zephyr Ridge 38L Ultralight Pack).
// Zero is therefore the honest count, and this comment is why a future reader
// should not "fix" the detector when it reports none.
const PHP_ALPINE_INVENTORY = `
$dest = get_posts(["post_type"=>"destination","posts_per_page"=>-1,"post_status"=>"publish"]);
$d1 = 0; $dle2 = 0; $d1fam = 0;
foreach ($dest as $p) {
  $d = (int) get_post_meta($p->ID, "difficulty", true);
  if ($d === 1) { $d1++; if (preg_match("/(famil|kid|child)/i", $p->post_content)) $d1fam++; }
  if ($d > 0 && $d <= 2) $dle2++;
}
$trips = get_posts(["post_type"=>"trip","posts_per_page"=>-1,"fields"=>"ids","post_status"=>"publish"]);
$g = [];
foreach ($trips as $id) { $g[] = (int) get_post_meta($id, "group_size_min", true); }
$prod = get_posts(["post_type"=>"product","posts_per_page"=>-1,"fields"=>"ids","post_status"=>"publish"]);
$kids = 0;
foreach ($prod as $id) {
  $c = wp_get_post_terms($id, "product_cat", ["fields"=>"names"]);
  $blob = get_the_title($id) . " " . implode(" ", (array) $c);
  if (preg_match("/(kid|child|youth|junior|toddler)/i", $blob)) $kids++;
}
$cats = array_filter((array) get_terms(["taxonomy"=>"product_cat","hide_empty"=>false]), function($t){ return $t->count > 0; });
echo "NEXUSGT:" . json_encode([
  "destinations_total"=>count($dest),
  "destinations_difficulty1"=>$d1,
  "destinations_difficulty_le2"=>$dle2,
  "destinations_difficulty1_family_mention"=>$d1fam,
  "trips_total"=>count($g),
  "trips_group_size_min_min"=>(count($g) ? min($g) : 0),
  "trips_bookable_by_three"=>count(array_filter($g, function($x){ return $x <= 3; })),
  "products_total"=>count($prod),
  "product_categories"=>count($cats),
  "products_kids"=>$kids
]) . "\\n";
`;

async function measure() {
  process.stderr.write('measuring cedarvalehealt…\n');
  const cvProviders = sshWpEval('cedarvalehealt', PHP_PROVIDERS);
  const cvTreatments = sshWpEval('cedarvalehealt', PHP_TREATMENTS);
  const cvLocations = sshWpEval('cedarvalehealt', PHP_LOCATIONS);
  const cvFp = sshWpEval('cedarvalehealt', PHP_FINGERPRINT);

  process.stderr.write('measuring summitdermatol…\n');
  const smLocations = sshWpEval('summitdermatol', PHP_LOCATIONS);
  const smFp = sshWpEval('summitdermatol', PHP_FINGERPRINT);

  process.stderr.write('measuring ridgeline…\n');
  const rgProviders = sshWpEval('ridgeline', PHP_PROVIDERS);
  const rgFp = sshWpEval('ridgeline', PHP_FINGERPRINT);

  process.stderr.write('measuring willowcreekderm…\n');
  const wcVersion = sshRaw('willowcreekderm', 'wp core version');
  const wcPlugins = sshPluginCensus('willowcreekderm');

  process.stderr.write('measuring alpineoutfitte…\n');
  const aoContent = sshWpEval('alpineoutfitte', PHP_ALPINE_CONTENT);
  const aoInventory = sshWpEval('alpineoutfitte', PHP_ALPINE_INVENTORY);
  const aoPlugins = sshPluginCensus('alpineoutfitte');
  const aoFp = sshWpEval('alpineoutfitte', PHP_FINGERPRINT);

  // WC-S-01's discriminator: two plugins, both at their latest published version,
  // one shipped this month and one abandoned in 2017. Measured from wp.org, which is
  // neither column's data. Slugs are named rather than swept so the key states which
  // contrast it rests on; a plugin the directory does not carry returns null.
  process.stderr.write('measuring wp.org maintenance facts…\n');
  const wcMaintenance = {};
  for (const slug of ['search-everything', 'limit-login-attempts-reloaded']) {
    wcMaintenance[slug] = await wpOrgPluginFacts(slug);
  }

  // Overlap: NPIs accepting at BOTH sites; names from the flagship's roster.
  const overlapNpis = Object.keys(rgProviders.npis).filter((npi) => npi in cvProviders.npis);
  const overlapNames = overlapNpis.map((npi) => cvProviders.npis[npi]).sort();

  process.stderr.write('measuring fleet ACF spread…\n');
  const acf = fleetAcfSpread();

  return {
    measuredAt: new Date().toISOString(),
    fleet_acf: acf,
    sites: {
      cedarvalehealt: {
        providers_total: cvProviders.total, providers_accepting: cvProviders.accepting,
        treatments_total: cvTreatments.total, treatments_overdue: cvTreatments.overdue,
        treatments_unreviewed: cvTreatments.unreviewed, treatments_stale_total: cvTreatments.stale,
        locations_total: cvLocations.total, locations_with_hours: cvLocations.with_hours,
        fingerprint: cvFp,
      },
      summitdermatol: {
        locations_total: smLocations.total, locations_with_hours: smLocations.with_hours,
        fingerprint: smFp,
      },
      ridgeline: {
        providers_total: rgProviders.total, providers_accepting: rgProviders.accepting,
        fingerprint: rgFp,
      },
      willowcreekderm: {
        wp_version: wcVersion,
        plugins: wcPlugins,
        // WC-S-01 turns on this pair being at their LATEST version while one is
        // abandoned — so the installed versions are part of the claim, not detail.
        search_everything_version: versionOf(wcPlugins, 'search-everything'),
        limit_login_version: versionOf(wcPlugins, 'limit-login-attempts-reloaded'),
        wporg: wcMaintenance,
      },
      alpineoutfitte: {
        ...aoContent, ...aoInventory,
        plugins: aoPlugins,
        // Quoted verbatim by AO-S-01's rubric, so gated as scalars rather than left
        // inside the ignored roster. A silent bump here would leave the rubric
        // asserting a version the site no longer runs.
        acf_version: versionOf(aoPlugins, 'advanced-custom-fields-pro'),
        woocommerce_version: versionOf(aoPlugins, 'woocommerce'),
        fingerprint: aoFp,
      },
    },
    npi_overlap: { count: overlapNpis.length, names: overlapNames },
  };
}

/** Compare measured vs stored, ignoring volatile non-key fields. */
function diffKeys(stored, measured) {
  const mismatches = [];
  // `roster` is the full per-plugin list: provenance for a human reading keys.json,
  // not something any rubric asserts. Gating on it would trip the drift gate on every
  // unrelated plugin bump, and a gate that cries wolf is a gate people set
  // BENCH_SKIP_DRIFT to silence. The counts and the quoted versions stay gated.
  const IGNORE = new Set(['measuredAt', 'last_modified_gmt', 'published_posts', 'roster']);
  (function walk(a, b, trail) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (IGNORE.has(k)) continue;
      const p = trail ? `${trail}.${k}` : k;
      const av = a[k], bv = b[k];
      if (av !== null && bv !== null && typeof av === 'object' && typeof bv === 'object') {
        if (Array.isArray(av) || Array.isArray(bv)) {
          if (JSON.stringify(av) !== JSON.stringify(bv)) mismatches.push(`${p}: stored ${JSON.stringify(av).slice(0, 60)}… ≠ measured ${JSON.stringify(bv).slice(0, 60)}…`);
        } else walk(av, bv, p);
      } else if (av !== bv) {
        mismatches.push(`${p}: stored ${JSON.stringify(av)} ≠ measured ${JSON.stringify(bv)}`);
      }
    }
  })(stored, measured, '');
  return mismatches;
}

const checkMode = process.argv.includes('--check');

// measure() reaches wp.org for WC-S-01's maintenance facts, so the entrypoint is
// async. Nothing else about the contract changes: exit 0 and a snapshot on stdout,
// or exit 1 naming every mismatch.
async function main() {
  const measured = await measure();

  if (!checkMode) {
    fs.writeFileSync(KEYS_PATH, JSON.stringify(measured, null, 2) + '\n');
    process.stderr.write(`wrote ${KEYS_PATH}\n`);
    console.log(JSON.stringify(measured, null, 2));
    return;
  }

  if (!fs.existsSync(KEYS_PATH)) {
    process.stderr.write('DRIFT GATE: keys.json does not exist — run `node ground-truth.js` first.\n');
    process.exit(1);
  }
  const stored = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
  const mismatches = diffKeys(stored, measured);
  if (mismatches.length > 0) {
    process.stderr.write('DRIFT GATE: substrate disagrees with keys.json — a run now would grade correct answers as wrong (or wrong as correct).\n');
    for (const m of mismatches) process.stderr.write(`  ${m}\n`);
    process.stderr.write('Re-run `node tests/platform-bench/ground-truth.js`, review the diff, update the rubrics that quote changed numbers, and commit both.\n');
    process.exit(1);
  }
  console.log(JSON.stringify(measured, null, 2));
}

main().catch((err) => {
  // A measurement that threw is not a passing gate. Fail loudly: a silent zero here
  // would let a run grade against a stale key and call the result verified.
  //
  // But say WHICH kind of failure it is. Both a transient SSH timeout and a real
  // substrate change exit 1, and run.sh prints "see mismatches above" either way —
  // so a flaky host reads as substrate corruption and invites someone to reach for
  // BENCH_SKIP_DRIFT, which is the one thing that must never become routine.
  // Measured 2026-08-26: one host stopped answering inside the 90s budget and the
  // gate reported failure with no mismatches printed at all.
  const msg = err && err.message ? err.message : String(err);
  const transient = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|Connection closed|kill.?ed|SIGTERM/i.test(msg);
  if (transient) {
    process.stderr.write(`GROUND TRUTH COULD NOT BE MEASURED (transient): ${msg}\n`);
    process.stderr.write('This is a REACHABILITY failure, not substrate drift — no key was compared.\n');
    process.stderr.write('Retry. If it repeats, check the host before suspecting the substrate,\n');
    process.stderr.write('and do NOT reach for BENCH_SKIP_DRIFT: an unmeasured gate is not a passed one.\n');
  } else {
    process.stderr.write(`GROUND TRUTH FAILED: ${msg}\n`);
  }
  process.exit(1);
});
