# BRIEF — worker `kn-6-w2` (client rows, docs, NOMENCLATURE): a knowledge tie play wrote to the notes is offered in Apply

App repo `/home/jody/github/serene-pub`; SDK repo `/home/jody/github/serene-pub-sdk` (**docs only**: two Markdown
files below; never a `.ts` file there, never a build). Supervisor: lane `kn-6` (`plans/briefs/BRIEF-kn-6.md`).
Worker `kn-6-w1` builds the server side at the same time (`lorebooks/ownBook.ts`, `entryKnowledge.ts`,
`sockets/sessions.overlay.ts`, `host.loreWrites.ts`); do not touch those. The shared socket types are **already
edited** (`src/lib/shared/sockets/types.ts`, do not edit): `Sockets.Sessions.OverlayItems.Item.kind` gains
`"knowledge-tie"` and `tieId?: number`; `AppliedBatches.Item` the same; `ApplyOverlay.Params.tieIds`;
`ApplyOverlay.Response.appliedTies`, `droppedTies`, `supersededTies` (all `number[]`, optional).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This lane runs no `sdk:build` at all.)

Also: both repos are staged by the lead — run **no git command that changes the index or working tree** (no add,
reset, checkout, restore, stash, commit). Never `prettier --write`. Other lanes edit `NOMENCLATURE.md` and
`docs/lorebooks.md` too: **re-read the exact lines right before each edit and make small targeted edits** (never
rewrite a paragraph you were not asked to change).

## What the server now does (describe exactly this; do not invent more)

Owner rulings: D41 (2026-11-16) "Offer it in Apply"; D39 (2026-11-16) "A hand tie always wins over what play
wrote"; S3 (2026-11-11) "Only Apply settles".
- A **knowledge tie** a pipeline writes in play (*was told*, *has been there*; the outlet **Note who knows an
  entry**) lands in the lorebook when the session's owner owns it and its write setting in force is **Full**;
  otherwise in the session's notes. **Before:** "never applied". **Now:** when both the cast member and the entry
  are the lorebook's, the tie is **a row of the *This session only* card** (Apply review), worded 🚧
  *‹member› was told about ‹entry›* / *‹member› has been to ‹entry›*, with its own **Apply to the lorebook** button,
  and included in **Apply all** and **Share to ‹book›**.
- **Apply** moves that same tie into the lorebook on the session's line, dated as a link is (onto the lorebook's
  day of the same date, else undated); other sessions on that line then know the entry.
- **Before Apply** the tie is that session's own knowledge; **Back** or a swipe takes it with the reply. **After
  Apply** it is the lorebook's: Back no longer takes it; **Take back** of that Apply returns it to the notes with
  everything else that Apply carried (refused, with a sentence, if the tie is no longer in the lorebook).
- **Your hand wins:** when the lorebook's owner has set **Knows** or **Kept from** by hand for that member and
  entry in the lorebook, the tie in the notes is not listed, and the next Apply removes it from the notes (counted
  as superseded; it never holds back the settle line). When the lorebook already holds the same live tie (same
  kind, line and day), Apply drops the copy instead of adding a second.
- A tie on an entry the session made in its notes is not a row of its own: it goes with that entry when the entry
  is applied (this was already so). A tie from a cast member who is only in the session's cast stays in the notes.
  A **Knows** / **Kept from** set in the session's notes is never offered.
- **By itself:** when the lorebook applies a session's changes by itself as scenes close (Full, your own book), it
  carries waiting ties with the rest. A tie waits in the notes on such a book only when it was written before the
  setting became Full.
- **A lorebook someone else owns:** listed for the session as links are; only the lorebook's owner can apply it.
- The tool's record (receipt) when the tie goes to the notes now reads 🚧 *Kept in this session's notes; Apply offers
  it to the lorebook.* (or, on an entry only in the notes, *…with ‹entry›; it goes to the lorebook when ‹entry› is
  applied.*; a member only in the session's cast, *…: ‹member› is in this session's cast only.*).
- The **Applied to the lorebook** list names an applied tie as 🚧 *‹sentence› · knowledge* and counts it.

## Build

Files owned: `src/lib/client/components/sessionForms/SessionViewPanel.svelte` (the overlay rows only, ~154–280 and
~666–790), `src/lib/client/contexts/sessionOutcomes.svelte.ts` and its `sessionOutcomes.dom.test.svelte.ts`,
`docs/lorebooks.md`, `docs/pipelines.md`, `NOMENCLATURE.md`, SDK `INTEGRATING.md` and
`guides/genres-presets-and-routines.md`.

1. **`SessionViewPanel.svelte`:** `applyOverlay(entryIds?, amendmentIds?, linkIds?, tieIds?)` sends `tieIds` like
   `linkIds`. The `{#each overlayItems}` key gains `item.tieId != null ? \`t${item.tieId}\`` (before the link
   case). The row's Apply button calls `applyOverlay(undefined, undefined, undefined, [item.tieId])` for
   `item.kind === "knowledge-tie" && item.tieId != null`. The title needs no new fallback beyond what exists (the
   server always sends the sentence; keep "Untitled entry" as the last fallback). In the applied list add
   `{:else if item.kind === "knowledge-tie"}` → `{item.title} · knowledge` in the same markup as the link row, with
   `<!-- 🚧 Provisional copy: the owner has not seen this label. -->`. No other markup, class or layout change
   (STYLE-GUIDE §6.4 list rows: one more row of the same kind, no new layout).
2. **`sessionOutcomes.svelte.ts`:** the "nothing at all was waiting" test also checks `msg.appliedTies?.length`,
   `msg.droppedTies?.length`, `msg.supersededTies?.length`. Add one case to `sessionOutcomes.dom.test.svelte.ts`: an
   answer with `applied: []` and only `supersededTies: [5]` does not say *Nothing to share*.
3. **`docs/pipelines.md`** ~98 (**Note who knows an entry**): replace "otherwise it stays in the session's notes
   and is never applied to the lorebook" with words saying it is kept in the session's notes and offered in Apply
   (link `./lorebooks.md#bringing-a-sessions-changes-into-the-lorebook`), and that one on an entry the session made
   in its notes goes with that entry.
4. **`docs/lorebooks.md`:** in **Bringing a session's changes into the lorebook** (~298–304) add, in the page's
   plain user voice, what the card now lists (what characters came to know, the two sentences), what Apply does to
   it, Back before / after, Take back, the hand-tie precedence and the duplicate, the notes-born entry case, and
   that the scene-close Apply carries it; in **Taking an Apply back** add that a tie goes back to the notes. In the
   knowledge section (~116–131) add one sentence: a tie a pipeline notes while the lorebook isn't on Full waits in
   the session's notes and is offered in Apply, and your **Knows** / **Kept from** wins over it. Keep each addition
   short; no headings added.
5. **SDK `INTEGRATING.md`** ~1714 (§1p) and **`guides/genres-presets-and-routines.md`** ~547: replace "never
   applied to the lorebook" with "offered in Apply to the lorebook's owner (a tie on an entry born in the notes goes
   with that entry)". Nothing else.
6. **`NOMENCLATURE.md`:** row **knowledge tie** (~969): remove "the *This session only* card" from the left-out
   list and add one sentence: 🚧 a play tie held in a session's notes for a lorebook member and entry is a row of
   that card, kind `knowledge-tie`, applied by moving the row (`moveKnowledgeTieToBook`), dropped when a hand tie
   stands for its pair (`supersededTies`) or the lorebook holds a live twin (`droppedTies`) (lane kn-6, D41
   2026-11-16 "Offer it in Apply"). Row **Note who knows an entry** (~970): its routing words ("never applied" or
   equivalent) → offered in Apply. Add a §25 change-ledger entry dated 2026-11-17 in the ledger's existing format
   (look at the 2026-11-16 kn-4b entry ~4333): lane kn-6, owner D41 quote; *new* wire row kind `knowledge-tie` with
   `tieId` (`sessions:overlayItems`, `sessions:appliedBatches`), Apply param `tieIds`, result fields `appliedTies`,
   `droppedTies`, `supersededTies`; server functions `moveKnowledgeTieToBook`, `dropSupersededKnowledgeTies`,
   `handTieInBook` (`lorebooks/entryKnowledge.ts`); 🚧 provisional copy: the two sentences, *· knowledge*, the
   take-back refusal *The knowledge tie "‹sentence›" is no longer in the lorebook, so this can't be taken back.*, the
   three receipt sentences; no migration. Mark everything 🚧.

## Tests

Before any vitest run: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Run only:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/contexts/sessionOutcomes.dom.test.svelte.ts > plans/kn-6-w2-1.log 2>&1"`
and read `tail -n 40` of the log (never pipe vitest into `head`). Then
`npx prettier --check` on the two client files. Do not run `tsc` or `npm run check` (the supervisor runs them).

## Stop and ask (report back instead of deciding)
CLAUDE.md §Decisions applies; a name, label or sentence beyond the ones above is needed; anything needs a file
outside the list above; the docs would have to say something the "What the server now does" list does not.

## Report (your final message, under 300 words)
Changed files with the lines touched; the test result (log path); prettier result; Noticed, not done.
