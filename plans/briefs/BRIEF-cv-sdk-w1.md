# BRIEF cv-sdk-w1 — the SDK half: character profile, cast-member query and outlet, update-character names

Worker for lane **cv-sdk** (supervisor: cv-sdk lane-supervisor). SDK repo `/home/jody/github/serene-pub-sdk`; commands run from the app root `/home/jody/github/serene-pub`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

**Do not run `npm run sdk:build` at all** — the supervisor builds. You run `npm run sdk:test` (from the app root) only.

## Goal
Declare in the SDK, all 🚧 (provisional) and `@experimental`:
1. The **character profile** shape, mirroring the app's `/home/jody/github/serene-pub/src/lib/shared/characters/profile.ts` **exactly** (same field names, same order, same nullability), plus `CastMemberV1`.
2. `core:query/cast-member@1` and `core:outlet/update-cast-member@1` in contracts.
3. `core:outlet/update-character@1`'s docs: its `changes` take the character profile names; `first_mes` / `mes_example` are gone.
4. `INTEGRATING.md` section, a new sdk-tests file, and the moved goldens re-pinned with dated comments.

## Rulings you are applying (quote, don't reinterpret)
- Owner (2026-11-05 late): **"Reconcile what we have for character cards. API should start with the same shape, can update both with what's best. We should also make sure we merge together any fields where there's an arbitrary duplicate like greeting and additional greetings."**
- Owner on the shape's name: **"Character profile?"** → 🚧 **character profile** (`CharacterProfileV1`, `CHARACTER_PROFILE_FIELDS`), always qualified (NOMENCLATURE R3 "qualify, never the bare noun": a bare _profile_ stays the export, docs, image-generation and evidence profiles).
- Owner on `update-character@1`: **"New names now, old removed"** — `first_mes` / `mes_example` removed, not kept as aliases.
- Plan §33.1: summary is a separate optional one-liner (readers fall back to the description's first sentence); greetings keep empty entries (today's swipes); creator notes `{text, lang?, variants}`.
- Plan §32 §10 (with §33 deltas): `core:query/cast-member@1` — in: `seated-member:<id>` · `player-seat:<id>` · a cast member id; out `CastMemberV1` = `{castMemberId, cardId, cardVersion, cardless, behindCard, follows, profile}`. `core:outlet/update-cast-member@1` — in: `member` and `changes: {[profile field]: value | {follow: true}}`; review covers `changes`; out `{ main, castVersionId }`; it writes or coalesces as one story write, and Back takes it with its turn; gated by the genre's `writes.lore` and the lore write mode (Review or Off → the session's overlay row). A genre must wire it — no core genre or spec places it (P1: a new automatic behaviour is off in core until a genre opts in).
- SDK canon (SDK CLAUDE.md): "Catalogue ids evolve **in place at `@1`** until 0.7 / SDK 1.0 — no `@2` bumps." "Feels like Drizzle: typed, predictable, one way to do a thing, refuses early." "`npm run sdk:test` … pins spec hashes, golden documents and counts …; a pin that moves on purpose is re-pinned with a dated comment saying why."
- No new names beyond: `CharacterProfileV1`, `CHARACTER_PROFILE_FIELDS`, `CharacterProfileField`, `CharacterGreeting`, `CharacterCreatorNotes` (all already the app's names, NOMENCLATURE §25), `CastMemberV1`, `castMember` / `core:query/cast-member@1`, `updateCastMember` / `core:outlet/update-cast-member@1`. Likeness and timbre go **inline** as anonymous object types inside `CharacterProfileV1` (no new exported names for them). If you think you need any other exported name, stop and say so in your report.

## Files owned (edit only these)
- NEW `/home/jody/github/serene-pub-sdk/sdk/src/characterProfile.ts`
- `/home/jody/github/serene-pub-sdk/sdk/src/index.ts` — one `export * from './characterProfile.js'` line with a one-line comment, placed near `participants.js`.
- `/home/jody/github/serene-pub-sdk/contracts/src/queries.ts` — the `castMember` definition only (place it right after `castPresences`, ~line 1213).
- `/home/jody/github/serene-pub-sdk/contracts/src/outlets.ts` — the `updateCastMember` definition (right after `updateCharacter`, ~line 2088) and `updateCharacter`'s doc comment (~2062–2070). Do not change `updateCharacter`'s ports or review (S.json stays; the names are the host's to check — the app's `library/writes.ts` `CHARACTER_CHANGE_FIELDS` = `name, description, personality, scenario, greetings, exampleDialogues`, and refuses any other key with "'<k>' is not a field that can be changed on a character here.").
- `/home/jody/github/serene-pub-sdk/INTEGRATING.md` — a new section `## 1k. Character profile and cast members (2026-11-06)` inserted just before `## 2. Seams that will need work` (after §1j, ~line 1345).
- NEW `/home/jody/github/serene-pub-sdk/sdk-tests/castMember.test.ts`
- Golden pins that move because of these declarations (expected: `sdk-tests/coreCatalog.test.ts`'s registry digest `'b937273e348af471'` ~line 1088, perhaps a count elsewhere). Re-pin ONLY pins this change moved, each with a dated comment in the file's existing style, e.g. `// Moved 2026-11-06 (cv-sdk, character versions wave 3): core:query/cast-member@1 and core:outlet/update-cast-member@1 join the contracts. (was '<old>')`. If a pin moves that you can't explain by these two declarations, do not re-pin it — report it.

## Files readable
App: `src/lib/shared/characters/profile.ts`, `likeness.ts` (`CharacterLikenessInput`), `timbre.ts` (`CharacterTimbreInput`, `TimbreSettings`); `src/lib/server/library/writes.ts` ~40–60, ~150–175. SDK: `contracts/src/queries.ts` (`castPresences` ~1165–1213 as the model), `contracts/src/outlets.ts` (`updateLoreEntry` ~1722–1770, `updateCharacter` ~2062–2087), `sdk/src/participants.ts` (`SessionCastV1` ~380–470 for doc style), `sdk/src/strokes.ts` (`Stroke`), `sdk-tests/writes.test.ts` ~300–315 (test style), `INTEGRATING.md` §1j ~1317–1345.

## What to write

### `sdk/src/characterProfile.ts`
File note: 🚧 the character profile — the one shape a character version holds, card and cast alike (plan §32 §2, §33.1; quote the owner's "Reconcile…" ruling and "Character profile?"); always qualified (R3); mirrors the app's `shared/characters/profile.ts` field for field — an edit to one is an edit to both. What the host fills, what it never does (no reading or writing here; types and the field list only).
- `CharacterGreeting { text: string; groupOnly?: boolean }`, `CharacterCreatorNotes { text: string; lang?: string; variants: Record<string, string> }` — same doc lines as the app.
- `CharacterProfileV1` — the 17 fields in the app's order and types. `strokes: Stroke[]` (import type from `./strokes.js`). `likeness: { imageMediaId?: number; prompt?: string; negative?: string } | null` and `timbre: { description?: string; voice?: string; narrationVoice?: string; language?: string; settings?: { speed?: number; stability?: number; similarity?: number; style?: number; seed?: number; speakerBoost?: boolean }; silent?: boolean } | null` — copy the app's one-line docs for each member (likeness.ts lines 10–17, timbre.ts lines 18–69).
- `CHARACTER_PROFILE_FIELDS` — same 17 strings, same order, `as const satisfies readonly (keyof CharacterProfileV1)[]`; `CharacterProfileField` type.
- `CastMemberV1`:
  - `castMemberId: number` — the member (the host's `lorebook_bindings.id`);
  - `cardId: number | null` — the card the member is drawn with on this reading (its version in force's parent card); null when card-less;
  - `cardVersion: { id: number; number: number; label: string | null } | null` — that parent card version; null when card-less;
  - `cardless: boolean`;
  - `behindCard: boolean` — the parent card version is below the card's current (highest) version: the card has moved on since;
  - `follows: CharacterProfileField[]` — the profile fields read from the parent card version; [] when card-less;
  - `profile: CharacterProfileV1` — the profile as the session reads it, followed fields already filled from the card.
- Every exported symbol carries `@experimental` and 🚧 in its TSDoc.

### `core:query/cast-member@1` (`castMember`, queries.ts)
Model on `castPresences`. `describeQueryDefinition({ id: 'core:query/cast-member@1', i18n: { name: { en: 'Cast member' } }, timeoutMs: 2000, ports: { in: { scope: S.sessionScope, member: S.json }, out: { main: S.json } } })`. No `optional`. Doc comment: one cast member as the scope session reads them (its line, its clock, the session's own notes over the book); `member` is `seated-member:<castMemberId>`, `player-seat:<seatId>` (that seat's cast member), or a cast member id (number) of the session's lorebook or its own; anything else, a seat with no cast member, or a member the session doesn't read is refused with a sentence; `main` is `CastMemberV1` (name the type). `@experimental`.

### `core:outlet/update-cast-member@1` (`updateCastMember`, outlets.ts)
Model on `updateLoreEntry`. `describeOutletDefinition({ id: 'core:outlet/update-cast-member@1', i18n: { name: { en: 'Change a cast member' } }, effects: 'write', review: { fields: ['changes'] }, timeoutMs: 10000, ports: { in: { member: S.json, changes: S.json }, out: { main: S.writeResult, castVersionId: S.writeResult } } })`. Put a short doc comment on `review` (what the change says may be retyped; which member it changes may not — the rule `update-lore-entry@1` states), and on each port. Doc comment on the definition:
- `member` as the query's; `changes` an object of character profile fields (`CHARACTER_PROFILE_FIELDS`), each a new value in the field's own shape or `{ follow: true }` (read that field from the member's card again; refused for a card-less member). Other keys are refused, never dropped.
- How it lands is the host's: one story write — a cast version dated at the session's story time and tied to the turn, so Back takes it with the turn; a second change in the same turn and moment updates that version (coalesces). The genre's `writes.lore` and the session's lore write mode decide where: the book's line, or under Review / Off the session's own notes (an overlay of the member).
- A genre must place it: no core genre or spec does. ⚠ It causes no event yet (🚧).
- `castVersionId` is the cast version written. `@experimental`.

### `updateCharacter` doc comment
Replace "(name, description, personality, scenario, first_mes, mes_example)" with the character profile names: `name`, `description`, `personality`, `scenario`, `greetings` (`{ text, groupOnly? }[]` — the whole list, replacing the card's), `exampleDialogues` (`string[]`); say the change writes the card's **current version**; add "`first_mes` and `mes_example` are no longer accepted (owner 2026-11-05: new names now, old removed); any other key is refused." Keep the rest. (Leave `createCharacter`'s doc alone — it describes a V3 card file, whose spec names stay.)

### `INTEGRATING.md` §1k
Short (≈15–25 lines, the file's style — see §1j): 🚧 declared in the SDK (lane cv-sdk), host half the app's. Bullets: the character profile (`CharacterProfileV1`, `CHARACTER_PROFILE_FIELDS`; merged greetings with `groupOnly`; creator notes `{text, lang?, variants}`; summary a separate optional one-liner; mirrors the app's `shared/characters/profile.ts`); `CastMemberV1`; the query (in-forms, refusals, read through the session's reading — the app's `membersAsRead`); the outlet (`changes`, `{follow: true}`, review on `changes`, one story write through the app's one writer `writeCastVersion`, anchored to the turn, coalescing, `writes.lore` + lore write mode → overlay row, a genre must wire it, no event yet); `update-character@1` takes the profile names and writes the card's current version, `first_mes` / `mes_example` removed.

### `sdk-tests/castMember.test.ts`
`node:test` + `node:assert/strict`, the style of `sdk-tests/writes.test.ts`. Tests:
1. `CHARACTER_PROFILE_FIELDS` is exactly the 17 names in order (literal array) and has no duplicates.
2. `C.castMember`: id, kind query, in-ports `scope` + `member`, out-port `main`.
3. `C.updateCastMember`: id, effects `write`, `review.fields` deep-equals `['changes']`, in-ports `member` + `changes`, out-ports `main` + `castVersionId`.
4. `C.updateCharacter` keeps its ports and `review.fields` `['changes']` (the rename is the host's).
Find how other sdk-tests read a definition's ports (grep `ports.in` / `.descriptor` in sdk-tests) and follow it; import `C` the way `writes.test.ts` does.

## Stop and ask (in your report, don't decide) when
A new exported name beyond the list; any change to a spec, genre or core-catalog file; a pin that moves for a reason other than these two declarations; anything in CLAUDE.md §Decisions.

## Done means
`npm run sdk:test` (from `/home/jody/github/serene-pub`) green — run it to a log file in your scratch dir, never piped into `head`; `npx prettier --check` on each edited SDK file (report results; fix only your own lines). Report: names and signatures, changed files, every pin moved (old → new, why), test results, anything you stopped on.
