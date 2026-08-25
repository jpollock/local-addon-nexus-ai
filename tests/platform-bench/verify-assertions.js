#!/usr/bin/env node
/**
 * Assertion self-test for the platform benchmark.
 *
 * Every assertion in promptfooconfig.yaml is a claim about which answers are
 * right and which are wrong. This runs the REAL assertion objects — loaded from
 * the config, not copied — against canned answers whose correctness we already
 * know from the sites themselves, and fails if a wrong answer passes or a right
 * answer fails.
 *
 * This exists because eval-t7J-2026-08-24T22:22:15 shipped two assertions that
 * could not fail: `icontains-any: ["8","eight"]` (any date passes) and a reach
 * test whose one clause accepted the union of every possible outcome. Both looked
 * fine in review. Only running answers through them shows it.
 *
 * Usage:  node tests/platform-bench/verify-assertions.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { execFileSync } = require('child_process');
const { PF_VERSION } = require('./providers/isolation');

const CONFIG = path.join(__dirname, 'promptfooconfig.yaml');
const real = yaml.load(fs.readFileSync(CONFIG, 'utf8'));

/** Find a test by the prefix of its description. */
function testByPrefix(prefix) {
  const t = real.tests.find((x) => x.description.startsWith(prefix));
  if (!t) throw new Error(`No test in promptfooconfig.yaml starting with "${prefix}"`);
  return t;
}

// Canned answers. Correctness is established in the config's answer-key comments,
// each verified by wp eval against the live sites on 2026-08-24.
const CASES = [
  // ── CV-A-01 ────────────────────────────────────────────────────────────────
  { t: 'CV-A-01', col: 'Nexus', want: true, name: 'correct — summit missing, cedarvale has',
    out: 'summitdermatol locations are missing opening hours entirely. cedarvalehealt has hours on all 25 locations.' },
  { t: 'CV-A-01', col: 'Coworker', want: false, name: 'wrong — the "neither" answer Coworker gave',
    out: 'Neither site has opening hours data. An aggregation on metadata.acf_hours returns zero buckets for summitdermatol and cedarvalehealt alike.' },
  { t: 'CV-A-01', col: 'Nexus', want: false, name: 'wrong — inverted',
    out: 'cedarvalehealt is missing opening hours; summitdermatol has them on every location.' },
  // The three below are verbatim from eval-VWU-2026-08-25T02:50:14. Runs 2 and 3
  // were scored FAIL against correct answers: the old `icontains: "cedarvalehealt
  // has"` cannot see across markdown bold. The corpus missed this class because
  // every canned answer above is plain text, and models emphasise site names.
  // Real output is the fixture; invented output is how the gap survived.
  { t: 'CV-A-01', col: 'Nexus', want: true, name: 'correct — bolded name (real run 2, was a false negative)',
    out: "## Answer: **summitdermatol** has the gap. **cedarvalehealt** has the data.\n\n**cedarvalehealt — 25 locations, all with hours**\n\nEvery location carries a full 7-day hours repeater, indexed as sub-fields:\n\nhours_0_day: monday, hours_0_opens: 07:30\nhours: 7\n\n**summitdermatol — 2 locations, zero hours fields**\n\nNeither location has *any* `hours*` field. Not empty values — the field is entirely absent from the indexed schema for the `location` post type." },
  { t: 'CV-A-01', col: 'Nexus', want: true, name: 'correct — bolded name (real run 3, was a false negative)',
    out: "## Answer: **summitdermatol** has the gap. **cedarvalehealt** has the hours data.\n\n### Summit Dermatology Partners (`summitdermatol`) — missing opening hours\n\nBoth of its 2 `location` records have **no hours fields at all**. Not empty values — the fields don't exist. Hours are the single missing dimension.\n\n### Cedar & Vale Health (`cedarvalehealt`) — hours present on all 25 locations\n\nAll 25 locations carry a 7-day repeater." },
  // Verbatim from eval-NHz-2026-08-25T12:47:28, a correct answer scored FAIL
  // because the gap clause required the literal "no hours" and it wrote "no
  // opening hours at all". One word of natural phrasing defeated the literal.
  { t: 'CV-A-01', col: 'Nexus', want: true, name: 'correct — "no OPENING hours" (real, was a false negative)',
    out: "## Answer: `summitdermatol` has the gap\n\n**`cedarvalehealt` — has opening hours.** All 25 location records carry a full 7-day hours repeater, indexed as `hours: 7` plus expanded sub-fields. Coverage is 25/25 on the `hours` field.\n\n**`summitdermatol` — no opening hours at all.** Its `location` post type has 2 records, and neither has an `hours` field, nor any `hours_*` sub-field." },
  // Heading-then-body: the site name and the gap phrase land in different
  // clauses. This is why the gap check is not scoped to a summitdermatol clause.
  { t: 'CV-A-01', col: 'Nexus', want: true, name: 'correct — gap phrase in a separate clause from the name',
    out: "### summitdermatol\n\nNo hours fields at all on either location.\n\n### cedarvalehealt\n\nAll 25 locations carry a 7-day hours repeater." },
  // Names both sites and says cedarvalehealt has hours, but never identifies a
  // gap anywhere. The gap clause is the only thing standing between this and a pass.
  { t: 'CV-A-01', col: 'Nexus', want: false, name: 'wrong — no gap identified at all',
    out: "cedarvalehealt has hours on all 25 locations. summitdermatol was also reviewed." },
  { t: 'CV-A-01', col: 'Nexus', want: true, name: 'correct — full domain (dots must not split the claim)',
    out: 'cedarvalehealt.wpenginepowered.com has hours on all 25 locations. summitdermatol.wpenginepowered.com is missing them.' },
  { t: 'CV-A-01', col: 'Nexus', want: false, name: 'wrong — inverted, comma-joined (no clause boundary to hide behind)',
    out: '**cedarvalehealt** is missing opening hours, while summitdermatol has them.' },
  // Both verbs in one clause, correct order. Guards the nearer-verb-wins rule:
  // testing for negation first would read summitdermatol's verb as cedarvalehealt's
  // and fail a correct answer.
  { t: 'CV-A-01', col: 'Nexus', want: true, name: 'correct — both verbs in one clause, comma-joined',
    out: 'cedarvalehealt has hours on all 25 locations, summitdermatol is missing them entirely.' },

  // ── CV-B-01 ────────────────────────────────────────────────────────────────
  { t: 'CV-B-01', col: 'Nexus', want: true, name: 'correct — 23-provider overlap, named',
    out: 'Yes. 23 providers are accepting new patients at both sites — every accepting provider on Ridgeline is also accepting at Cedar & Vale. They include Elian Mills PA-C (NPI 1274960149), Elias Lowe DO, and Cielo Wehner MD.' },
  { t: 'CV-B-01', col: 'Nexus', want: false, name: 'wrong — the stale key\'s single-provider answer',
    out: 'Yes — Elian Mills, PA-C (NPI 1274960149) is listed as accepting new patients at both Phoenix and Boulder simultaneously.' },
  { t: 'CV-B-01', col: 'Coworker', want: false, name: 'wrong — denies the overlap',
    out: 'No provider appears on both sites. There is no overlap between the two accepting rosters.' },
  { t: 'CV-B-01', col: 'Nexus', want: false, name: 'wrong — right count, hallucinated third site',
    out: 'I found 23 overlapping providers including Elias Lowe, drawing on cedarvalehealt, palegreen and willowcreekderm.' },

  // ── CV-G-01 ────────────────────────────────────────────────────────────────
  { t: 'CV-G-01', col: 'Nexus', want: true, name: 'correct — 10 of 45, 8 overdue + 2 unreviewed',
    out: '10 of 45 treatment pages have not been clinically reviewed in three years: 8 are marked overdue (review dates 2021-2022) and 2 are unreviewed with no review date at all.' },
  { t: 'CV-G-01', col: 'Coworker', want: false, name: 'wrong — the stale key\'s answer, 8 only',
    out: '8 of 45 treatment pages are overdue for clinical review, with review dates in 2021 and 2022.' },
  { t: 'CV-G-01', col: 'Nexus', want: false, name: 'vacuous-pass probe — a bare date must not pass',
    out: 'As of 2026-08-24 I was unable to determine the clinical review status of the treatment pages.' },

  // ── Reach ──────────────────────────────────────────────────────────────────
  { t: 'Reach', col: 'Nexus', want: true, name: 'Nexus answers from its SSH host',
    out: 'willowcreekderm.com is running WordPress 6.9.7.' },
  { t: 'Reach', col: 'Nexus', want: false, name: 'Nexus declines a site it can reach',
    out: 'I do not have access to willowcreekderm.com — it is not in my configured sites.' },
  { t: 'Reach', col: 'Coworker', want: true, name: 'Coworker declines, as it must',
    out: 'willowcreekderm.com is not one of the collections available to me, so I cannot determine its WordPress version.' },
  { t: 'Reach', col: 'Coworker', want: false, name: 'Coworker states a version it cannot know',
    out: 'willowcreekderm.com is running WordPress 6.9.7.' },
  { t: 'Reach', col: 'Coworker', want: false, name: 'Coworker neither answers nor declines',
    out: 'WordPress sites should always be kept up to date with the latest release.' },
];

// Build a config that runs the REAL assert blocks against the canned answers.
// The `echo` provider returns the prompt verbatim, so the canned answer becomes
// the output under test. Two echo providers carry the labels the reach test
// branches on.
const cfg = {
  description: 'assertion self-test',
  providers: [
    { id: 'echo', label: 'Nexus' },
    { id: 'echo', label: 'Coworker' },
  ],
  tests: CASES.map((c, i) => ({
    description: `case${i}`,
    vars: { prompt: c.out },
    assert: testByPrefix(c.t).assert,
  })),
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-assert-'));
const cfgPath = path.join(dir, 'selftest.yaml');
const outPath = path.join(dir, 'out.json');
fs.writeFileSync(cfgPath, yaml.dump(cfg));

try {
  execFileSync('npx', [`promptfoo@${PF_VERSION}`, 'eval', '-c', cfgPath, '--no-cache', '-o', outPath], {
    cwd: dir, stdio: ['pipe', 'pipe', 'pipe'],
  });
} catch {
  // promptfoo exits non-zero when any case fails, which is expected here.
}

const results = JSON.parse(fs.readFileSync(outPath, 'utf8')).results.results;
let bad = 0;
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  const r = results.find(
    (x) => x.testCase.description === `case${i}` && x.provider.label === c.col,
  );
  if (!r) { console.log(`?? case${i} [${c.col}] ${c.name} — no result`); bad++; continue; }
  const got = r.success;
  const ok = got === c.want;
  if (!ok) bad++;
  const verdict = ok ? 'ok  ' : 'FAIL';
  console.log(`${verdict} ${c.t} [${c.col}] ${c.name} — want ${c.want ? 'pass' : 'fail'}, got ${got ? 'pass' : 'fail'}`);
  if (!ok) {
    const failed = (r.gradingResult?.componentResults ?? [])
      .filter((x) => x.pass !== c.want)
      .map((x) => `${x.assertion?.type}: ${String(x.reason).slice(0, 120)}`);
    failed.forEach((f) => console.log(`       ${f}`));
  }
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(bad === 0
  ? `\nAll ${CASES.length} assertion cases behaved as specified.`
  : `\n${bad} of ${CASES.length} cases misbehaved — the assertions do not say what they claim.`);
process.exit(bad === 0 ? 0 : 1);
