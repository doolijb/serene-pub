# BRIEF — build lane `kn-4b` — an SDK write for knowledge ties, with recipes, placed by no shipped pipeline (programme 1.4, second half)

Repos `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-knowledge-screens-2026-11-16.md` §1, §6, §7 (**re-verify every file:line**),
`../serene-pub-sdk/INTEGRATING.md` §1p and the step that documents write outlets (grep `link-lore-entries`),
`plans/REPORT-kn-2a-2026-11-16.md`, `NOMENCLATURE.md` §1, §24, rows ~959–965, the SDK guide
`guides/genres-presets-and-routines.md` (the knowledge section ~502–537 and how a `js recipe` fence is written).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write`. Never commit. Never `npm test` / `npm run build`
at the SDK root (`npm run sdk:test` from the app root, capped, is the SDK suite: four known failures). Before
`npm run sdk:build` (app root): `pgrep -af "vite"` (dev / preview up → do not build, report "blocked on your dev
server") and wait until no vitest is up (`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`).
Tests only as `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-4b-<n>.log 2>&1"`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No migration. Inside `db.transaction`
only `tx`. No full run, no `npm run build`.

## Owner (2026-11-15; verify in `plans/PLAN-entry-time-and-lines-2026-11-14.md` ~360–362)

"(hand: **Knows** and **Kept from**; play's rows show their own reason): 'That works, lets add SDK api for it as
well, though we won't plug it in anywhere. Can add some recipes for how to use it.'" Also: "Yes everyone by
default. A modder or us in the future can add AI determinism for filtering that stuff later. But for now, we
will try to keep things cheap." Standing: P1 (off in core until a genre opts in; every automatic action shows
its cause and how to undo it), P2 (the module that owns the data owns every write), SDK should feel like
Drizzle; no `@2` bumps before 0.7.

## Build

### A. One write outlet

🚧 `core:outlet/note-entry-knowledge@1` (name is the lane's proposal, ★ in the report; follow §24 and the
sibling outlets' naming): a step states that **a cast member came to know an entry**, or no longer does.
- In-ports / params, modelled on `link-lore-entries@1` (`contracts/src/outlets.ts` ~2076): the session scope,
  the member (a speaker ref or a cast member ref, as sibling outlets take one), the entry (id, or a name
  resolved the way `link-lore-entries` resolves ends), and the **reason**: `was_told` or `has_been_there`
  (play's kinds). **Play never writes the hand kinds** `knows` / `kept_from` and never ends or overwrites a hand
  tie: a hand **Kept from** wins over what play notes (state how, from `judgeEntryKnowledge`; if the judging
  does not already give that precedence, stop and report). A second param ends play's own tie for the pair.
- It **does not** set or clear an entry's not-common-knowledge mark (that is the lorebook owner's consent
  setting): no outlet for the mark in this lane; say so in the docs.
- The app binds it (`pipelines/runtime/bindings.outlets.ts`, a `commit` case in `host.ts`, a helper in
  `host.loreWrites.ts`) by calling `writeKnowledgeTie` / `endKnowledgeTie` in `server/lorebooks/entryKnowledge.ts`:
  no SQL in the host. Those functions are owner-gated for a person; a run writes as the session's owner the way
  other lore writes do: find how `link-lore-entries` passes the acting person and where a lore write lands when
  the session's lorebook is not on Full (`lorebooks/ownBook.ts` `loreWriteTargetFor` ~399; overlay links exclude
  knowledge ties, ~1598). **A knowledge tie written by play must follow the same routing as a link written by
  play**: straight to the lorebook on Full, held in the session's notes otherwise, visible in the same Apply /
  Take back review, and removed by Back / a swipe that removes the reply that wrote it (imprints). If the notes
  overlay cannot hold a knowledge tie today, build the smallest change that lets it (and say what), or stop and
  report if that needs a migration or a visible change.
- `causesEvent`: none new unless siblings require one for conformance (C39 `LORE_WRITES`: add the outlet there
  if the list is "every lore write").
- Receipts and the panel's wording (`config/panel/flows.ts` ~169) describe the write in one sentence.
- Registry hash pins, `declaredReads` / `readsPairing` if a new bindings file is added (prefer the existing
  `bindings.outlets.ts`), `wiring.test.ts` excuses: the outlet is placed by no shipped spec, so excuse it with
  the reason "owner 2026-11-15: an SDK API no shipped pipeline places" wherever a conformance test demands a
  placement.

### B. Recipes (in the SDK guide, each a checked example)

In `guides/genres-presets-and-routines.md`'s knowledge section, three short recipes, each a spec fragment a
modder can paste, each exercised by a test (an SDK test that the fragment validates, and one app integration
test per recipe that runs it and then shows `knownToSpeaker` letting the entry through for that member):
1. **Told in the scene**: after a reply, every cast member in the scene comes to know the entries the reply
   named (`entries-named@1` → the outlet, reason `was_told`).
2. **Has been there**: when a scene closes at a place, its cast comes to know that place's entry
   (`has_been_there`). (Programme 1.6 will ship this in core later; here it is a recipe.)
3. **A model decides** (clearly marked as costing a model call): a judge step picks which named entries were
   actually revealed; only those are noted.
If a recipe cannot be written with existing nodes, say which node is missing; do not add nodes beyond the outlet.

### C. Docs and names

`INTEGRATING.md` (§1p: the outlet, its routing, that the mark has no outlet); the guide; `docs/pipelines.md`
(one paragraph where lore writes are listed); `NOMENCLATURE.md` (the outlet's row with its charter: purpose,
owns, does not own; §25).

## Files owned

SDK: `contracts/src/outlets.ts`, `conformance/src/index.ts` (the one list), the guide, `INTEGRATING.md`, SDK
tests. App: `pipelines/runtime/bindings.outlets.ts`, `host.ts` (one `commit` case), `host.loreWrites.ts`,
`server/lorebooks/entryKnowledge.ts` (only what the outlet needs: a run's write path), `lorebooks/ownBook.ts`
(only if the overlay must hold a tie), `config/panel/flows.ts`, pinned tests, the recipe tests,
`docs/pipelines.md`, `NOMENCLATURE.md`. Lane `kn-4a` is building the screens and a socket door over the same
`entryKnowledge.ts`: touch only the functions you call, small targeted edits, re-read before editing.

## Out of scope

Placing the outlet in any shipped genre or preset; the screens (`kn-4a`); an outlet for the mark; changing the
judging; presence.

## Stop and ask when

CLAUDE.md §Decisions applies; hand vs play precedence is not what this brief assumes; the notes overlay cannot
hold a tie without a migration; Back / swipe cannot take a tie back with the reply.

## Done means

SDK: `sdk:build`; `npm run sdk:test` (capped) only the four known failures. App tests (capped): the binding
(each reason; ends its own tie; never touches a hand tie; refused for an entry or member outside the book);
routing on Full and not on Full; Back removes it; the three recipe tests; pins re-pinned with "(was …)".
`tsc` 0; `npm run check` 0 errors in lane files.

## Report

Final message = the report (lead saves `plans/REPORT-kn-4b-<date>.md`): the outlet's shape and name; precedence;
routing and take-back as built; the recipes; changed files; tests; open ★; **Noticed, not done**. Under about 700 words.

## Cold review corrections (2026-11-16) — these rule over the text above

1. **Routing (replaces "the same routing as a link … the same Apply / Take back review").** Whether a tie kept
   in a session's notes is ever applied to the lorebook is an open owner question
   (`PLAN-entry-time-and-lines-2026-11-14.md:337`; DISCUSS-LATER D41), and Apply cannot carry a tie today
   (`ownBook.ts:1598`). Build what works with no migration and no new review row:
   - the session's lorebook on **Full**, owned by the session's owner → the tie is written to the book;
   - **otherwise** (not on Full, or a shared book the session's owner does not own, `ownBook.ts` ~370) → the
     tie is written to the session's notes as the session's own tie (`writeKnowledgeTie` already reaches the
     notes book, `entryKnowledge.ts` 449–461; the judge reads it as nearest), **never applied**; the receipt and
     the docs say so in one sentence. Play never writes into someone else's book.
   - Back and a swipe remove it with the reply through `imprintMade(subject: "relationship")`
     (`lorebooks/imprints.ts` 366–385, 555–572), as links go. Test it.
2. **Precedence (replaces "a hand Kept from wins … if not, stop").** Today the later date wins and a dated tie
   beats an undated hand tie (`entryKnowledge.ts` 161–176); that is DISCUSS-LATER D39, not changed here. So the
   outlet **refuses at write time when an active hand tie (`knows` or `kept_from`) exists for the pair**, with a
   receipt note naming it: play never writes over the owner's hand. Document the remaining limit: a hand tie
   set later still loses to an earlier dated play tie until D39 is ruled.
3. **Idempotence and ending.** Cast→entry rows have no unique index and `writeKnowledgeTie` always inserts;
   `endKnowledgeTie` takes a tie id. Add, in `entryKnowledge.ts` (owned): a lookup by (member, entry, play
   kinds). A write for a pair that already has a live play tie of that reason returns `written: false`; ending
   ends play's live ties for the pair. Called with `tx` inside the commit's transaction that also calls
   `imprintMade`. Lane `kn-4a1` is editing the same file (it may add an optional `tx` parameter to the same
   functions): re-read before each edit, small targeted edits, keep both call shapes working.
4. **Who writes.** `link-lore-entries` passes no acting person; it relies on `loreWriteRefusal` (`writes.lore`,
   `host.ts` ~7209) and the route. Do the same: the `loreWriteRefusal` check is required (a reference-lorebook
   genre writes no lore), and the person passed to `writeKnowledgeTie` is the **session's owner**
   (`sessions.user_id`), never `scope.userId` (which can be a member).
5. **The outlet is singular** (one member, one entry, like `update-cast-member`'s `member`); fan-out is the
   SDK's `each` clause with its mandatory `max` (`sdk/src/builder.ts` 300–325; shipped use
   `core-catalog/src/genres/dungeon-crawler/secrets.ts` 140–152).
6. **Recipes are spec fragments, not scripts:** write them as ` ```ts ` fences type-checked by
   `sdk-tests/guideSnippets.test.ts` (or ` ```playground ` fences, `guides.test.ts`), never ` ```js recipe `
   (those are scripts with a runner map). Recipe 1 is a nested `each` over members × named entries. Recipe 2:
   `scene-closed` carries only the scene and its line (`sdk/src/events.ts` 948–958), so the fragment reads the
   place (the location slot) and the scene's cast itself. The app integration test per recipe stays.
