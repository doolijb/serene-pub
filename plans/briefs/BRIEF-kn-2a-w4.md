# BRIEF — kn-2a worker 4: docs, names, and the pins the change moved

Supervisor: lane `kn-2a`. Report back as your final message (the supervisor reads it; do not write a report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout / restore / stash` in either repo; never `prettier --write`; you need no `sdk:build`. Other lanes edit other files at the same time (one is fixing standing test failures in some pinned tests): re-read a file right before you edit it and make small targeted edits; never rewrite a whole file. Never pipe vitest into `head`.

## What changed (the facts you document; all built and tested)

- Owner 2026-11-15: "When querying on a characters history/knowledge, have it be a toggle that's on by default, that way a modder can disable it if they want to do somethign custom. Since it's an SDK built-in, I'm thinking it should be in the query markup, not in the helper tooling that core genres use."
- 🚧 New param **`knownToSpeaker`** (boolean, default `true`, label *Only what the speaker knows*) on ten reads: `core:query/world-lore@1`, `character-lore@1`, `history-entries@1`, `lorebook-triggers@1`, `lorebook-entries@1` (and its `withLinks`), `vector-search@1`, `entity-search@1`, `entity-link@1`, `relationship-search@1` (the link hop), `entries-named@1`. Description (SDK): "Leaves out the entries the speaking character does not know (marked not common knowledge with no knowledge tie to it, or kept from it; the place it stands in always counts as known), and does nothing on a turn no single character speaks, such as the narrator's." (the hop: "…and the links that lead to them"; the listing: "…and the links that name them").
- **The rule** (unchanged for knowledge, `lorebooks/entryKnowledge.ts`): an entry marked *not common knowledge* is left out unless the speaker has a knowledge tie to it; an entry a *kept from* tie wins for is left out, marked or not; **new:** the place entry the speaker stands in (the value of `core:slot/location@1` on its own state owner, else the session's world value; an entry reference or a name matched to a place entry) counts as known, even against a *kept from* tie (owner 2026-11-15, plan ~315: "the place a character stands in counts as known": "Yes, add it to the plan.").
- **Who the speaker is:** the read's own `speaker` in-port when wired, else the character the run speaks as (`scope`: `currentCharacterId`, or `currentCastMemberId` for a card-less seat). A run that speaks as nobody (a narrator's turn, routine, action, envoy, a step writing for several characters) reads everything. A card that sits in no seat (Story's side character) reads everything. Chat's assistant and the Guide's envoy are not cast members: they read everything (no change).
- **Dropped at the source:** the host's `lorebook_entries` read drops what the speaker does not know before any mechanism sees it. So: the three lore lanes; triggers (an unknown entry neither triggers nor is scanned in recursion); the place listing and its ways (no listed row's link names an unknown entry); vector and entity search (a hit with no visible row is withheld); entity-link; the hop (never arrives at nor names an unknown entry; a card-less seat's hop is now judged as that seat); entries-named (neither text nor name). Pinned entries come from the same read, so they are dropped too.
- **One load per run and speaker** (the per-run memo of the host's lore read; freed with the run's host). Statements: nothing marked +0 vs before (the old node's one statement moved into the reads); with something left out, the judgement as before, plus one select for the left-out place entries, plus the place value only when a place is left out.
- **Shown (P1):** each read logs a receipt note: *No entries left out: nothing here is marked not common knowledge or kept from anyone* · *‹n› entries left out: not known by ‹name›* (and the kept-from and mixed forms; *1 entry …*) · *No entries left out for ‹name›* · *Reads everything: not one cast member's turn*. These sentences existed already; none is new.
- **`false`**: no shipped spec sets it. Story's reply and the Lair's delver voice no longer place a node: they get the default. The Lair's shared gather is filtered on a delver's run and reads everything on the Castellan's.
- **Not covered (state these as limits):** `turn-plan@1`'s `locationPassage` (prose for the room the party are heading into, with no entry id stored beside it); `relationships-known@1` / `-perspectives@1` carry cast-to-cast ties only (no entry end can appear); `mention-spans@1` returns message text spans; session history, earlier scenes and recalled lines are not judged for knowledge (presence is a separate, later change: `firsthandFor` / `firsthandBy` are **unchanged**, document nothing new about them, and do not remove their text).
- **Removed, never released** (verified: no release tag contains the commits that added them): `core:query/unknown-entries@1` (`C.unknownEntries`, UI *Entries not known*), its placements in Story (`gather.unknownEntries.read`) and the Lair (`…pick.picked.unknownEntries`), its `validate()` law `entry knowledge 2026-11-15` and that law's two sentences, and in the app `KNOWLEDGE_SOURCES`, `knowledgeExclusions`, `knowledgeExclusionReason` (the reasons *Not known by ‹name›.* / *Kept from ‹name›.* are no longer emitted anywhere).
- **New internal names (app):** in `lorebooks/entryKnowledge.ts` `KnowledgeDrop`, `noteKnowledgeDrop`, `knowledgeDropOf`, `knowledgeDropReceipt`, `standingPlaceIds` (module-private); in `pipelines/runtime/loreMatch.ts` `entriesNamedIn` options `leaveOut`, `onLeftOut`; query field `knownToSpeaker` on the host's `lorebook_entries` read.

## Files owned

- SDK `/home/jody/github/serene-pub-sdk`: `INTEGRATING.md` §1p (the `unknown-entries` bullet ~1560 and any line of §1p that names it; rewrite for the param), `guides/genres-presets-and-routines.md` (the *What a character does not know* section ~502–533 and any line naming `unknown-entries`; the firsthand sections ~399–453 only where they name `unknown-entries`).
- App `/home/jody/github/serene-pub`: `docs/pipelines.md` (*What a character does not know*, ~344–372), `docs/lorebooks.md` (~116–122), `docs/genre-story.md` (~70) and `docs/genre-lair.md` (~68) only where they describe the knowledge filter, `NOMENCLATURE.md`.
- App pins: `src/lib/server/pipelines/boot/registryHashes.test.ts`, `src/lib/server/pipelines/boot/specHashes.test.ts`, `src/lib/server/pipelines/runtime/receipts.int.test.ts` (~268), `src/lib/server/sockets/pipelines.scoping.int.test.ts` (~1253), `src/lib/server/pipelines/parity/harness.int.test.ts` (only if it moves).

## Work

1. **Docs** (user-facing behaviour, plain words, the session's vocabulary; comments and docs state the rule, not the story; no other product's name): rewrite each section above for the param and the rule as it now stands, including who the speaker is, the standing-place exception, the receipt notes, how to switch it off (`knownToSpeaker: false` on the node; say a modder does this for a custom pipeline), and the limits list. `docs/lorebooks.md` ~120 says "a reply pipeline has to ask for it; Story and the Lair ask…": now every read leaves it out by default.
2. **NOMENCLATURE.md** (read §1, §23, §24 first; record in §25 in the same change):
   - §14 row **unknown entries** (~961): remove the row; add a §23 *Retired words* entry (never shipped: replaced by the reads' param, owner 2026-11-15 quoted above).
   - New §14 row 🚧 **known to the speaker** (`knownToSpeaker`) with the charter: *Purpose* (leave out of one character's prompt what it does not know, on every lore read, by default), *Owns* (nothing but the switch on each read), *Does not own* (the decision: `lorebooks/entryKnowledge.ts`; who knows what: knowledge ties; presence: `firsthand`, unchanged), the ten reads, the UI label *Only what the speaker knows* (🚧 names pass, DISCUSS-LATER D1), the receipt notes, the limits.
   - Rows **not common knowledge** (~959) and **known** (~963): the *Does not own* / filter mention now points at the param; **known**: add the standing-place exception.
   - §25 ledger entry `2026-11-16 (lane kn-2a — …owner quote…; 🚧 provisional)`: *new* param and label; *new* internal names above; *retired* `core:query/unknown-entries@1` (`C.unknownEntries`, *Entries not known*), law `entry knowledge 2026-11-15` and its sentences, `KNOWLEDGE_SOURCES`, `knowledgeExclusions`, `knowledgeExclusionReason`, the reasons *Not known by ‹name›.* / *Kept from ‹name›.*; the standing-place exception.
3. **App pins** — run the file, read the new value, re-pin with a comment `Moved 2026-11-16 (kn-2a): <why> (was <old>)`:
   - `registryHashes.test.ts`: the `core:query/unknown-entries@1` row goes; the ten reads above each move (their params slot gained `knownToSpeaker`). Any other row that moves is a finding: report it, do not re-pin it.
   - `specHashes.test.ts`: `story-respond` and `lair-reply` should return to their pre-time-t6f values (the SDK's own pins went back to exactly those: Story's catalogue digest `d997da157b5f16ab`, lair-reply `c4fe814f1e089`); read the old values from the `(was …)` comments at ~208 and ~1887. Other spec hashes that move because the ten reads' descriptors moved: re-pin with that reason; anything else is a finding.
   - `receipts.int.test.ts` ~268 and `pipelines.scoping.int.test.ts` ~1253: the expected node lists lose `gather.unknownEntries.read` / `unknownEntries`.
   - `parity/harness.int.test.ts`: run it; re-pin only if it moves for this reason.
4. **Run** (one at a time, capped, after waiting for no vitest):
   `until ! ps -eo pid,args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 20; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-2-w4-<n>.log 2>&1"`
   Files: the four pinned test files above, `src/lib/server/pipelines/scripts/guideRecipes.int.test.ts` (the guide's recipes must still run), `src/lib/server/pipelines/runtime/openRenders.test.ts`.

## Stop and ask (in your report) when

A pin moves that the facts above do not explain; a doc you own contradicts the facts; a NOMENCLATURE rule (R1–R6, §24) objects to `knownToSpeaker` or the label (say which, do not rename).

## Report

Changed files; each re-pin old → new with its reason; tests with pass/fail; NOMENCLATURE entries added/retired; anything noticed and not done.
