# BRIEF playtest2-T-w1 — narrator cadence: SDK field + script, server cadence, tests

Lane `playtest2-T` (supervisor writes the lane report; you report back to the supervisor in your final message). Worker id `w1`.

## Goal
Owner ruling (2026-11-04, plan `plans/PLAN-story-playtest-fixes-2026-11-03.md` § Rulings item 7): *"Narrator turn: **after the cast, every N rounds**; not a second reply under Next turn."* Out of scope (ruled): a position field, a per-character cadence, a second reply under Next turn, any new setting beyond re-shaping this one.

Today `NARRATOR_INTERJECTIONS_FIELD` is a boolean; `UNPROMPTED_MODES_SCRIPT` turns it into `"full"`/`"off"`; `unpromptedEntries` puts `{ ref: null, via: "unprompted", subject }` at the head of the order once a round, after the whole cast. You re-shape it into a cadence. Contract (fixed by the supervisor — use exactly these names, invent no others):

### 1. SDK field — `/home/jody/github/serene-pub-sdk/core-catalog/src/registry/genres.ts`, `NARRATOR_INTERJECTIONS_FIELD` ONLY (currently ~lines 244-260)
Another lane (m2e-D) just edited this file for `group`/`reach` keys: **re-read the file immediately before editing, use Edit (never Write), touch nothing but this one declaration and its doc comment.** Becomes:
```ts
export const NARRATOR_INTERJECTIONS_FIELD: FieldDecl = {
	type: "enum",
	label: { en: "Narrator asides" },
	group: "Turns",
	description: {
		en: "How often the narrator takes a turn of its own, after everyone else's. Each is another model call."
	},
	of: ["off", "every-round", "every-2nd-round", "every-3rd-round"],
	members: [
		{ key: "off", label: { en: "Off" } },
		{ key: "every-round", label: { en: "Every round" } },
		{ key: "every-2nd-round", label: { en: "Every 2nd round" } },
		{ key: "every-3rd-round", label: { en: "Every 3rd round" } }
	],
	default: "off",
	reach: "owner"
}
```
Doc comment: keep the 🚧 marker, say it is the cadence (ruled 2026-11-04, item 7: after the cast, every N rounds, counted from the narrator's last line on `main`; under Next turn its turn waits for a Continue, never a second reply); a stored `true` (before 2026-11-04) reads as every round, `false` as off — read by `UNPROMPTED_MODES_SCRIPT`, no migration. Copy the existing `difficulty` field's `of` + `members` pattern (same file, ~line 448) if the type checker wants it shaped differently.

### 2. SDK script — `/home/jody/github/serene-pub-sdk/core-catalog/src/factories/turnOrder.ts`, `UNPROMPTED_MODES_SCRIPT` (~line 55-75) + its doc comment, and the doc comment near line 234 if it names the boolean
The source stays ES5 (`var`, `function`), a function body over `value`. New output, additive:
`{ "side-cast": "full"|"off", "narrator-interjections": "full"|"off", "narrator-every": 1|2|3 }` — `"narrator-every"` present only when the narrator is on.
Mapping of `f.narratorInterjections`: `true`, `"full"`, `"review"`, `"every-round"` → on, every 1; `"every-2nd-round"` → 2; `"every-3rd-round"` → 3; anything else (`false`, `"off"`, absent, any other string) → off. **Use explicit `===` comparisons, never an object lookup** (`EVERY["constructor"]` would be truthy). `sideCast` mapping unchanged. Update the doc comment to say so.
The seeded script is refreshed at boot when its source differs (`src/lib/server/pipelines/boot/seedScripts.ts`), so no other change is needed for installs.

### 3. Server reader — `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/speakerRotation.ts`, `unpromptedEntries` ONLY (~lines 734-823) + its doc comment
Read `modes["narrator-every"]`: a positive integer, else 1 (an old script's output has none: every round). The narrator entry is added only when, besides today's conditions (round over, no narration since the person's newest line), the number of **`role === "user"` rows on `main` (the same `main` list the function already builds: visible, main channel) after the newest `isNarratorResponse` row on `main`** (all of `main` when there is none) is `>= every`. Every 2nd round therefore places the narrator after the cast on rounds 2, 4, … ; a person's own Narrate press resets the count (it is "since the narrator's last line" — say so in the comment). Side cast logic untouched. Do not touch `bindings.ts` (modes pass through as-is).

## Tests (write; run only these)
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/speakerRotation.unprompted.test.ts` — add cases: every 2 (`{ "narrator-interjections": "full", "narrator-every": 2 }`): round 1 `[user, said(1)]` (solo cast `[ash, me]`) → no narrator; `[user, said(1), user, said(1)]` → narrator entry; `+ narration` → nothing; `+ narration, user, said(1)` (round 3) → nothing; `+ user, said(1)` (round 4) → narrator. Every 3 places on round 3. Absent `narrator-every` → every round (unchanged existing cases). Off places none. A garbage `narrator-every` (`0`, `"2"`, `-1`) reads as 1.
- New SDK test `/home/jody/github/serene-pub-sdk/sdk-tests/coreNarratorTurns.test.ts` (node:test + `node:assert/strict`, the style of `sdk-tests/coreTurnOrder.test.ts`; import from `../core-catalog/src/index.js` or the factories/registry files directly): (a) `NARRATOR_INTERJECTIONS_FIELD` is an enum with exactly those four keys in that order, default `"off"`, group `"Turns"`, reach `"owner"`, a description; the Story genre's `fields.narratorInterjections` is that object. (b) evaluate the script: `const run = new Function(...UNPROMPTED_MODES_SCRIPT.varsIn, UNPROMPTED_MODES_SCRIPT.source)`, call with `{ session: { fields: {...} } }`: `true` → `{ "side-cast": "off", "narrator-interjections": "full", "narrator-every": 1 }`; `false`/absent/`"off"`/`"constructor"` → narrator off and no `"narrator-every"`; `"every-2nd-round"` → 2; `"every-3rd-round"` → 3; `"full"`/`"review"` → 1; `sideCast: true` → `"side-cast": "full"`; a non-object `value` → both off.
  Run: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test coreNarratorTurns.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-T-w1-sdk.log 2>&1; echo exit=$?` then read the log.
- `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.taskVoices.int.test.ts` — **write** two cases, do NOT run this file (it needs the rebuilt SDK dist; the supervisor runs it): (1) *every 2nd round under Whole round*: two characters, `narratorInterjections: "every-2nd-round"` set straight into `genreFields` (like `autoAdvance: "round"` is today, lines ~132-141 — add an optional `fields` param to `minimalWithTwo` or a sibling helper), no side cast: send #1 → no narrator row, `calls` 2; send #2 → exactly one narrator row, `calls` 3. (2) *Next turn never yields two replies*: one character, `autoAdvance: "next"`, `narratorInterjections: "every-round"`: one send → exactly one assistant row, no narrator row, `calls` 1. Each `it` keeps the file's 240_000 timeout. The existing `"full"`-via-`applyLegacyTasks` case already proves an old `true` reads as every round end to end — keep it untouched.

Run the unit test as:
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/pipelines/runtime/speakerRotation.unprompted.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-T-w1-unit.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`.

## Files owned (only these)
- `/home/jody/github/serene-pub-sdk/core-catalog/src/registry/genres.ts` — `NARRATOR_INTERJECTIONS_FIELD` and its comment only
- `/home/jody/github/serene-pub-sdk/core-catalog/src/factories/turnOrder.ts` — `UNPROMPTED_MODES_SCRIPT` and doc comments naming the boolean
- `/home/jody/github/serene-pub-sdk/sdk-tests/coreNarratorTurns.test.ts` (new)
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/speakerRotation.ts` — `unpromptedEntries` and its comment only
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/speakerRotation.unprompted.test.ts`
- `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.taskVoices.int.test.ts`

Re-read each file immediately before editing; Edit, never Write, on existing files. Another lane (S3) is editing scenes files right now; never touch `src/lib/server/sessions/settingsForm.ts`, `src/lib/shared/sockets/types.ts`, `src/lib/server/sockets/sessions.ts`, `contracts/src/tasks.ts`, `NOMENCLATURE.md`, or any golden/hash pin test (`sdk-tests/coreCatalog.test.ts`, `specHashes.test.ts`, `registryHashes.test.ts`) — if one of those needs a change, write it under "Needs elsewhere" in your report with file:line and exact text.

## Files readable
Everything.

## Rules you work under (quoted)
- CLAUDE.md P1: *"A new automatic behaviour is off in core until a genre opts in, and every automatic action shows its cause and how to undo or switch it off."* (default stays `"off"`).
- CLAUDE.md: *"0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass…"* — here no stored value is rewritten: old booleans are READ as the new choices (that is the design; test it).
- NOMENCLATURE R3: *"qualify, never the bare noun"*. Introduce no identifier beyond the ones in this brief (`"narrator-every"`, the four member keys). A local variable is fine.
- Hard rule: *"`$state(new Set())` / `new Map()` is not reactive"* (n/a here); *"Inside `db.transaction(async (tx) => …)` use only `tx`"*.
- Int tests that open a DB inside an `it` need a long timeout (this file uses 240_000).

## Stop and ask when
The enum cannot be declared with this FieldDecl shape without a new field kind; any name not in this brief seems needed; a test outside this list fails because of your change (report it, don't fix it).

## Done means
`speakerRotation.unprompted.test.ts` green, `coreNarratorTurns.test.ts` green, the two int cases written (not run). Report: changed files with a one-line summary each, exact commands + pass/fail counts, anything under "Needs elsewhere", Noticed-not-done.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* — you do not run `sdk:build` at all; the supervisor does.
