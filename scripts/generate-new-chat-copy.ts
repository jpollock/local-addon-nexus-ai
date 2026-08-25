/**
 * Generate `newChatCopy.generated.ts` from the designer's own fixture.
 *
 *   docs/handoff/new-chat/fixtures/scenario-new-chat.js
 *
 * Same discipline as `generate-opening-copy.ts`, and for the same reason: the
 * ratified wording must live in ONE place. Typing these strings into the
 * component would make the panel a second home for them, free to drift from
 * the sheet that ratified them — which is precisely what that generator's
 * header says it exists to prevent.
 *
 * The fixture is EVALUATED rather than pattern-matched. It is a committed,
 * reviewed file in this repo that assigns one object to `window`, so running
 * it is both faithful (no quoting or escaping to get wrong) and narrower than
 * a regex that would silently match the wrong string the day the file is
 * reformatted.
 *
 * Fails closed: `--check` exits non-zero when the generated file has drifted
 * from the fixture, and the generator refuses to emit if a required field is
 * missing rather than shipping a hole.
 *
 *   npm run fixtures:new-chat-copy
 *   npm run fixtures:new-chat-copy:check
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(REPO_ROOT, 'docs', 'handoff', 'new-chat', 'fixtures', 'scenario-new-chat.js');
const OUT = path.join(REPO_ROOT, 'src', 'renderer', 'components', 'DockedPanel', 'newChatCopy.generated.ts');

interface Suggestion { text: string; from: string }
interface NewChatFixture {
  headline: string;
  promise: string;
  placeholder: string;
  suggestions: Suggestion[];
  footnote: string;
  scope: { label: string; action: string };
  disclosure: { visible: string; tooltip: string };
  ambient: { line: string; door: string };
}

function readFixture(): NewChatFixture {
  const src = fs.readFileSync(FIXTURE, 'utf8');
  const sandbox: { window: Record<string, unknown> } = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(src, { filename: FIXTURE }).runInContext(sandbox);
  const f = sandbox.window.NEXUS_NEWCHAT as NewChatFixture | undefined;
  if (!f) throw new Error(`${FIXTURE} did not assign window.NEXUS_NEWCHAT`);

  // Refuse to emit a hole. A missing field is a changed sheet, and the right
  // response is to stop and say so, not to ship an empty string into the UI.
  const required: Array<[string, unknown]> = [
    ['headline', f.headline], ['promise', f.promise], ['placeholder', f.placeholder],
    ['footnote', f.footnote], ['suggestions', f.suggestions],
    ['scope.label', f.scope?.label], ['scope.action', f.scope?.action],
    ['disclosure.visible', f.disclosure?.visible], ['disclosure.tooltip', f.disclosure?.tooltip],
    ['ambient.line', f.ambient?.line], ['ambient.door', f.ambient?.door],
  ];
  for (const [name, v] of required) {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      throw new Error(`fixture is missing ${name} — refusing to emit`);
    }
  }
  if (!Array.isArray(f.suggestions) || f.suggestions.length === 0 || f.suggestions.length > 3) {
    throw new Error(`suggestions must be 1..3 (sheet pin: "at most three"); got ${f.suggestions?.length}`);
  }
  return f;
}

const q = (s: string) => JSON.stringify(s);

function render(f: NewChatFixture): string {
  return `/**
 * GENERATED — DO NOT EDIT. \`npm run fixtures:new-chat-copy\`.
 *
 * The new chat's ratified wording, extracted verbatim from the designer's own
 * fixture by \`scripts/generate-new-chat-copy.ts\`:
 *
 *   docs/handoff/new-chat/fixtures/scenario-new-chat.js
 *
 * Editing this file by hand is the defect the generator exists to prevent — it
 * would make this surface a SECOND place the ratified wording lives, free to
 * drift from the sheet that ratified it. \`npm run fixtures:new-chat-copy:check\`
 * fails closed on a stale copy.
 */

/** The invitation. The design system's ratified composer prompt, promoted. */
export const NEW_CHAT_HEADLINE = ${q(f.headline)};

/**
 * What the product differs on, said once, where a person decides whether to
 * trust what follows.
 */
export const NEW_CHAT_PROMISE = ${q(f.promise)};

/**
 * The companion drops the promise's SECOND clause rather than shrinking it —
 * a refusal states its own reason when it happens, so it is the clause a
 * 380px column can afford to lose.
 */
export const NEW_CHAT_PROMISE_SHORT = ${q(f.promise.split('. Where it cannot')[0] + '.')};

export const NEW_CHAT_PLACEHOLDER = ${q(f.placeholder)};
export const NEW_CHAT_PLACEHOLDER_SHORT = 'Ask about a site';

/** The one line about consequence — a session here is not a chat log. */
export const NEW_CHAT_FOOTNOTE = ${q(f.footnote)};

/**
 * Suggestions are QUESTIONS derived from what is true now, never actions: an
 * offer to ask is not a decision to make, which is what keeps this surface off
 * Now's turf. At most three, sized to content, never full-width.
 */
export const NEW_CHAT_SUGGESTIONS: ReadonlyArray<{ text: string; from: string }> = [
${f.suggestions.map((s) => `  { text: ${q(s.text)}, from: ${q(s.from)} },`).join('\n')}
];

export const NEW_CHAT_SCOPE = {
  label: ${q(f.scope.label)},
  action: ${q(f.scope.action)},
} as const;

/**
 * P0-5, amended 2026-08-25. The PROVIDER and the PAYLOAD are the disclosure —
 * they name who receives what — so they stay visible. The model VERSION moves
 * to the tooltip: it is the part a person cannot act on, and it changes
 * without them. An earlier draft of the sheet said "no model identifier in the
 * footer", which read as "no disclosure" and would have overridden a ratified
 * privacy line; this split is the correction.
 */
export const NEW_CHAT_DISCLOSURE = {
  visible: ${q(f.disclosure.visible)},
  tooltip: ${q(f.disclosure.tooltip)},
} as const;

/** The needs-you count as a DOOR at ambient weight — never the subject. */
export const NEW_CHAT_AMBIENT = {
  line: ${q(f.ambient.line)},
  door: ${q(f.ambient.door)},
} as const;
`;
}

const out = render(readFixture());
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== out) {
    console.error('newChatCopy.generated.ts is STALE — run `npm run fixtures:new-chat-copy`.');
    process.exit(1);
  }
  console.log('new-chat copy is current.');
} else {
  fs.writeFileSync(OUT, out);
  console.log(`wrote ${path.relative(REPO_ROOT, OUT)}`);
}
