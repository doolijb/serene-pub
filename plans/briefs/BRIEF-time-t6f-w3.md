# BRIEF — worker `time-t6f-w3` (firsthand: a scene with no live lines is judged by its stored cast; docs)

Supervisor: lane `time-t6f`. App repo `/home/jody/github/serene-pub`. Report path: your final message (the
supervisor reads it). Keep it under ~450 words.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**You never run `sdk:build`.** Never `git checkout / restore / stash`. Never `prettier --write`. Never `kill -9`.
Never pipe vitest into `head`/`tail`: redirect to a log and read it. No migration (stop if one seems needed). Read
only on the plain `db` in the loader; never the outer `db` inside a `db.transaction`. Comments state the rule, not
the story. No other product's name in any file.

**Test runs — strictly one at a time across the lane, only in this form** (the lock serialises you with the
supervisor):

```
cd /home/jody/github/serene-pub && flock /home/jody/github/serene-pub/plans/time-t6f.lock \
  systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet \
  bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t6f-w3-<n>.log 2>&1"
```

## Owner ruling, 2026-11-15 (in his words)

- A scene compiled into History with no messages left: "Stored cast list, when messages are outside the context
  window, we won't be querying them anyway. Scenes/history are what persist."

## Goal

### C. `src/lib/server/sessions/firsthandFilter.ts`

Today `keptSceneIds` (~260–272) keeps a scene with no live lines (`if (!lines.length) return true`), so such a scene
counts as attended by everyone, for the summary rule and — through `leftOutEntryIds` (~275) — the History-entry
rule. Change: a scene with **no live lines** that is **not open** (`view.openSceneIds`) is kept for the member only
when the member is in the scene's **stored cast**: a `scene_characters` row with `scene_id` = the scene,
`binding_id` = the member id (the member id *is* `lorebook_bindings.id`, the same id as
`session_messages.cast_member_id`) and `role = 'participant'` (a *mentioned* character was not there). Not in it
(including an empty stored cast) → left out. An open scene with no live lines stays kept. A scene with live lines
is judged exactly as today. Both rules (summary, History entry) follow automatically through `keptSceneIds`.

Shape (decided by the supervisor; keep it):
- `FirsthandView` gains `storedCastSceneIds: Set<number>` — doc comment: scenes with no live line whose stored cast
  (`scene_characters`, participant) holds the member.
- `firsthandViewOf` input gains optional `storedCastSceneIds?: ReadonlySet<number>`; the view holds a `Set` copy
  (empty when absent). The pure core stays pure.
- `loadFirsthandView`: after `firsthandViewOf(...)`, compute the closed scenes with no live line (`sceneLines` empty
  and not in `openSceneIds`); **only if at least one exists**, one grouped read: `select scene_id from
  scene_characters where scene_id in (…) and binding_id = memberId and role = 'participant'` (drizzle
  `schema.sceneCharacters`, `inArray`, `eq`), and add each to `view.storedCastSceneIds`. No query per scene; no
  read at all when no such scene exists.
- Update the header comment's rule 3 ("A scene with no live line is kept.") and the "No query per message and none
  per scene" sentence to state the new rule and the one grouped read. Receipts stay as they are (they remain
  true).

Tests:
- `src/lib/server/sessions/firsthandFilter.test.ts`: the existing test "a compiled scene with no live line counts as
  there" (~181) states the old rule — rewrite it to the new one, and add pure cases: no live lines + in stored cast
  → kept; not in it → left out (summary and History entry); open scene with no live lines → kept; a scene with live
  lines → unchanged by stored cast (e.g. member in stored cast but missed the lines → still left out).
- `src/lib/server/sessions/firsthandFilter.int.test.ts`: one int case with real rows — a closed range scene whose
  lines are all hidden, compiled into a History entry, with `scene_characters` holding member A as participant and
  not member B: A keeps the summary/entry, B does not; and a statement-count check that the extra read happens
  only when such a scene exists (if the file pins statement counts, re-pin with a `(was …)` note where they move).
- `src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts`: run it; if a pinned number or a case moves,
  update it with a `(was …)` note and say why.

### Docs (one or two sentences each; plain, short, user words; 🚧 stays where it is)

1. `docs/pipelines.md` § *What a character was there for* (~344–360): the **Summaries** bullet gets the stored-cast
   case; in *Limits*, replace "a scene whose messages were all deleted counts as one the character was there for"
   with the new rule (a scene whose lines are all gone — deleted, hidden or taken **Back** — counts for the
   characters its stored cast lists, and for nobody else).
2. `docs/pipelines.md` § *What a character does not know* (~362): replace "No shipped pipeline does this yet;" with
   a sentence saying Story's reply and the Lair's delver voices do this on a character's own turn (the narrator,
   the Castellan and room drafts read everything), keeping the pointer for pipeline authors.
3. `docs/lorebooks.md` ~120: "a reply pipeline has to ask for it, and no shipped pipeline does yet" → Story and the
   Lair ask for it on a character's own turn.
4. `docs/genre-story.md`: one sentence near the reply's switches (~70): what a character does not know is left out
   of its own turn (an entry marked not common knowledge that it is not tied to), linking
   `./pipelines.md#what-a-character-does-not-know`; the narrator reads everything.
5. `docs/genre-lair.md`: one sentence in *How a turn runs* step 5 *The voices* (~68), same meaning for a delver.

### NOMENCLATURE.md (this lane owns it for this build)

- §14 row **firsthand** (~957): add the stored-cast sentence to the rule; in *Does not own*, "a scene's cast
  (`scene_characters`: not who was there)" becomes: the scene's cast (`scene_characters`), read only for a closed
  scene with no live line left, whose participants count as there.
- §25 Change ledger: one new bullet at the end, `2026-11-15 (lane time-t6f — owner rulings 2026-11-15 "Yes. It should
  be cheap enough, i think.", "Yes" (the warning), "Stored cast list, …"; 🚧 provisional)`, recording: Story's reply
  and the Lair's delver voice place `core:query/unknown-entries@1` (node keys `gather.unknownEntries.read`,
  `via.turn.channel.story.pick.picked.unknownEntries`); *new* `validate()` warning under law
  `firsthand 2026-11-15`: *'‹key›' leaves out the history entries the speaker was not there for, but its exclusions
  reach no eligibility check, so nothing is left out*, fix *wire $.‹key›.exclusions into the eligibility check's
  exclusions, beside the lore reads'*; §14 **firsthand**: a closed scene with no live line is judged by its stored
  cast (replaces ★T6C1-3's "counts as attended"); *new* `FirsthandView.storedCastSceneIds` and the
  `firsthandViewOf` input of the same name. Match the style of the bullets above it.

## Files owned

`src/lib/server/sessions/firsthandFilter.ts`, `firsthandFilter.test.ts`, `firsthandFilter.int.test.ts`,
`src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts` (re-pins only), `docs/pipelines.md`,
`docs/lorebooks.md`, `docs/genre-story.md`, `docs/genre-lair.md`, `NOMENCLATURE.md` (the two places named).

## Out of scope

`bindings.ts`, receipts' wording, the SDK, `docs/sessions.md`, any other doc or row, any new name beyond the two
above, any setting or migration.

## Stop and ask when

The member id does not map to `scene_characters.binding_id` as stated (say what you found); the change needs a
query per scene or a change outside the files owned.

## Done means

Edits above; one run of `src/lib/server/sessions/firsthandFilter.test.ts src/lib/server/sessions/firsthandFilter.int.test.ts src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts`
green (or each failure explained as pre-existing with evidence); `npx prettier --check` on the changed code files.
Report: changed files with line ranges, test names added/changed, results with log path, statement numbers (the
extra read: 0 when no such scene, 1 when one exists), any `/tmp/serene-pub-vitest-*` dir left (by name).
