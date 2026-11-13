# BRIEF s27-S3G-w1 — core-catalog genre scripts read host-filled identity (seat-cast S3)

Worker for lane **s27-S3G** (supervisor: lane-supervisor, Opus). You type; you do not decide names, copy or scope. Report back to the supervisor as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal
The genre scripts (sandbox JS strings in core-catalog) stop **building** participant refs and state keys from card ids and stop **parsing** card ids out of refs. They read the identity the host now fills in, and fall back to today's card form only when that field is absent (a host from before S3). Output on today's data must not change.

### What the host fills (SDK names, built by lane s27-S3K — use exactly these)
- Seat rows of the cast read, `doc.cast.sessionCharacters[]` and `doc.cast.sessionPersonas[]`: optional **`ref`** (the seat's participant ref — today `character:<cardId>` for a seat with a card, `player-seat:<seatId>` for a card-less player seat; in S4 `seated-member:<memberId>` and `player-seat:<seatId>` for every player seat), **`castMemberId`** (the seat's cast member id, or null), **`cardId`** (the member's active card on the timeline, null when card-less).
- `state.cast.byId[<key>]` entries: optional **`ref`**, **`castMemberId`**, **`cardId`** on each entry (same meanings). The key itself is opaque: card id today, may be member-keyed in S4.
- Messages / history rows: optional **`castMemberId`** (the speaker's cast member).
- New ref kind 🚧 `seated-member:<id>` (a seated cast member by cast member id). ⏳ `character:<id>` stays readable until S5.

### The rules (quoted from the lane contract, BRIEF-s27-S3-common.md)
- "**Host fills, consumers read.** … read them and fall back to today's card form only when a field is absent (a host before S3)."
- "**Look up, never parse.** A consumer that needs the `state.cast.byId` entry for a ref finds the entry whose `ref` (or `castMemberId`) matches; it never parses a card id out of a ref or a key, and never does `Number(key)`."
- "**Tests on both shapes:** every switched consumer gets a test on today's data (output unchanged) and on S4-shaped data (member refs `seated-member:<id>`, `player-seat:<id>` for carded player seats, member-keyed `byId`)."
- "**No stored key changes, no migration, no removal.**"
- Card ids and member ids share one number range: a card-form fallback must never pick the entry of a *different* person. That is why the fallback below applies only when the entry under the legacy key carries no `ref` of its own.

## The one lookup (use this shape in both preambles; plain ES5, inside the template strings — mind the doubled backslashes in regexes inside the TS template literal)
```js
// The state.cast.byId key a participant reference reads under: the entry
// whose host-filled `ref` is this ref (look up, never parse). ⏳ A host
// before S3 fills no `ref`: then today's card-form key — only when the entry
// under it carries no `ref` of its own (card and member ids share one range).
function stateKeyOf(ref, byId) {
	var r = String(ref), b = byId && typeof byId === "object" ? byId : {};
	for (var k in b) { var e = b[k]; if (e && typeof e === "object" && e.ref === r) return k; }
	var m = /^player-seat:(\d+)$/.exec(r), c = /^character:(\d+)$/.exec(r);
	var key = m ? "player_seat:" + m[1] : c ? c[1] : r;
	var at = b[key];
	return at && typeof at === "object" && at.ref !== undefined ? r : key;
}
```
Every caller passes the `byId` it has in scope (`state.cast.byId`). Where a caller uses the key for `state.configs` too, the same key serves (configs are keyed like `byId`; verify in one or two places, say so in your report).

Seat ref: `seat.ref` when it is a non-empty string, else today's build (`"character:" + persona.id` / `"player-seat:" + seatId`).

## Items (inventory line numbers are approximate — find the code)
All under `/home/jody/github/serene-pub-sdk/core-catalog/src/`.
1. `shared/reckoning.ts` `STORY_PREAMBLE`: `stateKeyOf` → the lookup above (callers pass `byId`; ~297–303 `byId[stateKeyOf(p.ref)]`). `peopleOf` (~175–188): each person's `ref` is the seat row's `ref` when present, else today's build; each person also carries `castMemberId: s.castMemberId` (null/undefined passes through) so the Story reckon can name a row by it. **The reckoning's sheet line (`bagLine(heard(own(byId[...])))`) must not print the three host-filled identity fields `ref`, `castMemberId`, `cardId`** (a byId entry is printed as a bag of `key: value`; without this, lane C filling those fields would change the model-facing text). Skip exactly those three keys there; nothing else changes. Check whether any `people` object is emitted wholesale anywhere (output document, prompt); if it is, tell the supervisor before adding the field.
2. `genres/dungeon-crawler/preamble.ts`: `seatRefOf` (~186) reads `seat.ref` first; its `stateKeyOf` copy (~187–193) → the same lookup; every caller passes `byId` — `seatsOf` (~266), `ucNow` (~647), and anything else in the preamble. `seatsOf` puts the seat's `castMemberId` on each sheet object (`sheet.castMemberId = s.castMemberId`) for `story.ts`. `companionsOf` (~284–297): find what feeds `d.cast.characters` (grep the app read-only: `/home/jody/github/serene-pub/src/lib/server`, and the sdk-tests fixtures — `cast: { sessionPersonas, characters }`); a companion's `ref` is the row's `ref` when present, else `"character:" + ch.id`, and "is a seat" compares those refs (plus, when both sides carry `castMemberId`, equal member ids). Report what feeds `cast.characters` and whether it carries `ref`.
3. `genres/dungeon-crawler/roundScript.ts`: `refOf` (~83) reads `s.ref` first; `fateOf` (~84–89) finds the byId entry through the lookup (`stateKeyOf(refOf(s), byId)` — copy the helper in if the round script does not open on the preamble; check), `mirror[refOf(s)]` unchanged otherwise; `hasDeclared` (~117–121): keep the `user:` check; then `declared.indexOf(s.ref) >= 0` when `s.ref` is present, else today's two card-form checks.
4. `genres/dungeon-crawler/story.ts`: `seatOfLine` (~190–196): after the `m.speaker` match, when `m.castMemberId != null` match the seat whose `castMemberId` equals it; then today's `personaId` form as the fallback; then userId; then the single seat. The `cast.byId[stateKeyOf(ref)]` sites (~323, 474, 497, 593) pass `byId`.
5. `genres/dungeon-crawler/rest.ts` (~129–136), `scripts.ts` (~261, 278, 394, 512–513, 557, 564), `secrets.ts` `userFor` (~70): pass `byId` to `stateKeyOf`; refs come from `seatRefOf`. No other change.
6. `genres/lair/scripts.ts`: `peopleOf` (~77–94) reads each seat row's `ref` first (and carries `castMemberId`); look at what the `seat: "persona:" + pe.id` key is used for and report it — change it only if it is compared with a ref. The dice `by` regex (~334) widens to `/^(character|seated-member|player-seat):\d+$/` (doubled backslashes inside the template).
7. `genres/story/reckon.ts` (~170–174): `who` = the person whose `castMemberId` equals `row.castMemberId` (when the row carries one), else today's `named["character:" + …]` lookups, else the role words. Use `people` from the preamble.
8. Any other site in these files that builds `"character:" + …` / `"player-seat:" + …` from an id, or parses one with a regex, or does `Number(key)`: switch it the same way, or list it in your report if switching needs a decision.

## Tests — Done means
Write **one new file** `/home/jody/github/serene-pub-sdk/sdk-tests/seatCastScripts.test.ts` (node:test + `node:assert/strict`, the style of `dungeonCrawlerWalk100.test.ts` / `lair.test.ts` / `writes.test.ts` — reuse how they run a script). For each switched script (reckoning preamble + sweep, Crawler preamble seats/companions/ucNow, round script fate + declared, story seatOfLine, Lair peopleOf + dice `by`, Story reckon line names):
- **today's data** (rows with no `ref`/`castMemberId`/`cardId`) → the same output as before your change;
- **S3-filled card form** (rows carrying `ref: "character:3"`, `castMemberId: 7`, `cardId: 3`; byId entry `"3"` with `ref: "character:3"`) → identical output to today's, and the reckoning's sheet line shows no `ref`/`castMemberId`/`cardId`;
- **S4 shape** (seat `ref: "seated-member:7"`, `castMemberId: 7`, `cardId: 3` or null; a carded player seat `ref: "player-seat:4"`; byId keyed by member e.g. `"seated_member:7"` with `ref: "seated-member:7"`) → the right person's sheet/fate/name;
- **the collision case**: byId `"3"` belongs to person A (`ref: "seated-member:3"`) while person B's ref is `"character:3"` → B never reads A's entry.
Never hand a DOM node to an assertion. Name test cases in plain words.

Run, from `/home/jody/github/serene-pub-sdk/sdk-tests`, inside a memory cap, writing output to a file and then reading it (never pipe a test runner into `head`/`tail`):
```
systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test seatCastScripts.test.ts dungeonCrawler.test.ts dungeonCrawlerStory.test.ts dungeonCrawlerWalk3.test.ts dungeonCrawlerWalk100.test.ts dungeonCrawlerMultiplayer.test.ts dungeonCrawlerRuleset.test.ts lair.test.ts lairSanctumTab.test.ts writes.test.ts keeperClock.test.ts forms.test.ts coreCatalog.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/s27-S3G-w1-tests.txt 2>&1'
```
and `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p . > <scratch>/s27-S3G-w1-tsc.txt 2>&1` (covers core-catalog sources).
- **Hash pins and goldens that move because the scripts changed** (spec hashes, the `coreCatalog.test.ts` golden, Crawler/Lair/Story spec pins): **do not repin**. List each in your report (file:line, recorded → computed). The supervisor repins.
- A failure that also fails without your change (check the failing assertion's subject, not by stashing) — list it as pre-existing.

## Files owned (edit only these)
- `/home/jody/github/serene-pub-sdk/core-catalog/src/shared/reckoning.ts`
- `/home/jody/github/serene-pub-sdk/core-catalog/src/genres/dungeon-crawler/{preamble,roundScript,story,rest,scripts,secrets}.ts`
- `/home/jody/github/serene-pub-sdk/core-catalog/src/genres/lair/scripts.ts`
- `/home/jody/github/serene-pub-sdk/core-catalog/src/genres/story/reckon.ts`
- `/home/jody/github/serene-pub-sdk/sdk-tests/seatCastScripts.test.ts` (new)
## Files readable
Anything in `/home/jody/github/serene-pub-sdk` and `/home/jody/github/serene-pub` (read-only), including `sdk/src/participants.ts`, `sdk/src/widgets.ts`, `contracts/src/queries.ts` (`session-state@1` prose), the app's `src/lib/server/state/resolve.ts`.

## Out of scope (never build)
View-models and components under `core-catalog/src/shared/ui/**` and `core-catalog/components/**` (worker w2), `core-catalog/src/registry/**`, any SDK `sdk/src/**` file, any stored key or stored data form, any exported name rename/removal, repinning tests, NOMENCLATURE, docs, the app, mundi.

## Stop and ask (finish what you can, then put it in your report) when
- a change needs a new exported name, a new user-visible word, or a stored-data change;
- a site cannot switch without parsing a ref or guessing (say why);
- a pin moves for a reason you cannot trace to your change.

## Working rules (CLAUDE.md and the guides)
- Edit **hunks only**. Most of this repo is other people's uncommitted work: never reformat a file, never run `prettier --write` on an existing file. `npx prettier --check <your new test file>` only.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not need `sdk:build`; sdk-tests read sources. Do not run it.)
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.
- Targeted tests only; never pipe a test runner into `head`. Scratch files go in `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/` and start with `s27-S3G-w1-`.
- Comments in the code: plain, short; mark transitional fallbacks ⏳ (removed in S5).
- It is a **session**, never a chat. Every session has a lorebook — never write "no book".

## Report (final message)
Changed files with the hunks in one line each · what switched (file → field read) · what still builds card form and why · what feeds `cast.characters` · Lair's `seat:` key · tests run with exact counts · pins that moved (recorded → computed) · pre-existing failures · anything you stopped on · Noticed, not done.
