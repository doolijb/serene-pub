# BRIEF — build lane `time-t4b` — the cast member page: versions on a timeline

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/REPORT-time-t4a-2026-11-14.md` and `plans/briefs/BRIEF-time-t4a.md` with its Corrections (this lane gives
the cast member page what that lane gave the entry form; the owner's rulings there apply here),
`plans/REPORT-edit-history-b-2026-11-14.md`, `plans/PLAN-entry-time-and-lines-2026-11-14.md` §1, §2, §5,
`NOMENCLATURE.md` §1, §24, §23 and the rows for *cast version*, *entry version*, *presence*, **Edit history**,
`STYLE-GUIDE.md` (forms, container queries, copy, a11y, §6.19 version rail), `docs/lorebooks.md`,
`docs/lorebook-time.md`, `docs/characters.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

In a lorebook that keeps a timeline, a cast member's **Member** tab shows the member's versions on the same
vertical rail as an entry's (lane `time-t4a`), so time reads the same across the lorebook:

- the rail lists the member's cast versions in story order (*From the beginning*, then each dated version);
  selecting one shows that version in the form and **moves the moment bar** to its date;
- **Save** saves the version shown; **Save as a new version…** and *+ Add a version here* add one at a date;
  a dated version's date can be changed in place; a dated version can be deleted;
- each version's **edit history** rows sit under it, with the same **Edits** toggle;
- this **replaces**, on the cast member page, **Save as of ‹date›**, **Change the base** and the *Amendments*
  list (`AmendmentList` is then mounted only for history entries).

No storage change, no migration, no SDK change. No new socket event unless the inventory shows one is
unavoidable (then stop and ask).

## Owner rulings this lane builds (quote them in worker briefs)

- 2026-11-13: "Also make a pass on cast history and make sure it behaves similar so it's familiar across the
  entire lorebook."
- 2026-11-14 (cast Memory discussion): "Also provide a vertical time view like i suggested for other entries."
- 2026-11-13 (versions): "show the option to change the effective date of that version. Save edits that
  version, but also need a button to save as a new dated version … navigate the dated versions like a vertical
  timeline, adding new versions before or after."
- 2026-11-14: the chosen screen (the rail beside the fields, a strip when narrow) and "Yes, move the moment bar".
- 2026-11-14: "hide all the extra time management noise in entries and the lorebook when timelines aren't
  enabled": with the Timeline off, no rail, no dates; one plain form with its edit-history fold.
- Standing: cast members get no Beginning and no Decay (a presence says when they are there); "Members never
  see or touch model plumbing"; it is a session, never a chat.
- 2026-11-14: "continue with the feature completion buildouts" — the go.

## What differs from an entry (re-verify each line)

- A cast version is a **whole profile row** in `character_versions` at (line, date, life point), not a sparse
  dated change; `src/lib/server/characters/versions.ts` is its only writer. The member page's Save on the base
  goes `writeCastVersion` → `authorWrite` → `updateInPlace`; a dated change of a member is made through
  `amendments:create` with `castId` (the cast branch of `sockets/amendments.ts`) and edited through
  `rewriteCastChange`. A version a descendant session still reads is retired and copied on edit.
- A version may carry a **personal position / life point** (`personalPosition`) besides its date, and
  **follows** (fields that follow the card). The rail must not hide either: show them as the form shows them
  today.
- The entry form's **zones** (Keywords, Pinned, Off, Part of) do not exist for a member. What is the member's at
  every date (the card link, own name and nickname, the retire mark, sprites, gallery) stays where it is today;
  this lane does not move fields between tabs.
- **Presences** (`PresencesPanel`) and the member's **Timeline** tab (`cast/MemberTimeline.svelte`) stay as they
  are. If the rail makes the Timeline tab redundant, say so under Noticed; do not remove it.
- The edit history is per cast version already (`EditHistory` with a `characterVersionId` subject, mounted on the
  Member tab after `AmendmentList`, `CastWorkspace.svelte`).

## Build

### A. Inventory first (supervisor, read-only, before any worker) — report with file:line

1. `src/lib/client/lorebooks/cast/CastMemberForm.svelte` and `CastWorkspace.svelte`: how the shown version is
   chosen at a moment; what **Save**, **Save as of**, **Change the base** and "change later versions" each send;
   what the `AmendmentList` mount offers for a member (re-date, delete, other lines' versions, the *not yet*
   count); what the Timeline tab shows.
2. What the server offers: listing a member's versions with dates and lines; create at a date; edit; re-date;
   delete; what happens on a second version at the same (member, line, date, life point) — is one-per-key
   enforced (the unique index in `db/schema.ts` on `character_versions`)?
3. Which of `time/VersionRail.svelte`, `time/VersionDateDialog.svelte`, `time/entryVersions.ts` can be reused as
   they are, and what must be generalised (the rail takes `EntryVersion`s built from `amendmentsOnLine`; a cast
   version list comes from elsewhere). Prefer giving the rail a subject-neutral version shape over a second
   rail component; keep the entry form's behaviour and tests unchanged.
4. Every job of the three replaced controls on the cast page, and where each goes on the rail. A job with no
   home is reported, not dropped.

### B. The page

As `time-t4a` built for entries, with these rules carried over exactly: rail order and "which version is in
force" come from the reader's own functions, never from sorting by date alone; an inherited version (another
line's) is read-only with *from ‹line›* and **Open on ‹line›**; other lines' versions the reading does not read
go under **Elsewhere**; selecting a version sets the moment through the same route call the moment bar uses;
with unsaved edits a change of version asks once (keep editing / discard); **Save as a new version…** at a taken
date says the date already has a version and that Save will change it; deleting a version says its edit history
goes too; one `characterVersions:redlines` ask per shown version at most, and rows refresh after a save; the
narrow layout (container query on the form's own width) is a strip above the fields; with the Timeline off none
of it is drawn; read-only pages show and select only. The moment bar's sentence on the Cast board
(`momentSaveSentence(onCast)`, `time/moment.ts`, `MomentBar`'s `onCast` prop) becomes the entry sentence's
equivalent for a member: one sentence for both, then drop the `onCast` prop if nothing else needs it.

### C. What goes

**Save as of ‹date›**, **Change the base** and the `AmendmentList` mount on the cast member page, once every job
has a home (inventory item 4). `AmendmentList.svelte` stays for history entries. STYLE-GUIDE §6.1's
split-button example (moved to the cast form by `time-t4a`) moves to the History editor, the last user.

### D. Docs and names

`docs/lorebooks.md` (the cast member's versions), `docs/lorebook-time.md`, `docs/characters.md` if it describes
the member page; `NOMENCLATURE.md`: the *cast version* row says how it is shown (the rail), the §23 retirements
of `time-t4a` extend to the cast page, a §25 line per new name. No other product's name in any file.

## Files owned

- `src/lib/client/lorebooks/CastWorkspace.svelte`, `src/lib/client/lorebooks/cast/CastMemberForm.svelte`, new
  pure helpers under `src/lib/client/lorebooks/cast/` or `time/`
- `src/lib/client/lorebooks/time/VersionRail.svelte`, `VersionDateDialog.svelte`, `entryVersions.ts` (only to
  generalise the version shape), `time/moment.ts`, `time/MomentBar.svelte` (the sentence and the `onCast` prop),
  `src/lib/client/lorebooks/LorebooksWorkspace.svelte` (only the `onCast` prop at the `MomentBar` mount)
- `src/lib/client/lorebooks/editHistory/EditHistory.svelte` only if rows-per-version needs it for the version
  subject
- tests beside each; the docs above; `NOMENCLATURE.md`; `STYLE-GUIDE.md` §6.1 / §6.19
- Server: none expected. If inventory item 2 shows a second version at one key is possible, the smallest refusal
  or merge in the cast branch of `src/lib/server/sockets/amendments.ts`, with a test, is in scope.

## Out of scope (write down, never build)

Cast Memory, knowledge ties, presence per message (T6); moving a member between lines (T8); presences and the
Timeline tab's content; the character editor (cards); `src/lib/server/characters/versions.ts`; any SDK or
`src/lib/server/pipelines/**` file; the entry form beyond keeping it working.

## Stop and ask when

CLAUDE.md §Decisions applies; a job of a replaced control has no home on the rail; the life point or follows
cannot be shown on a version without a design choice; a server change beyond the one named or a new event seems
needed.

## Done means

- Tests (targeted files only, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t4b-<name>.log 2>&1"`
  from the repo root, one at a time; check for a running vitest first; never pipe vitest into `head`): the
  rail's order and selection for a member; Save on the base and on a dated version sends what the page sends
  today for that case; Save as a new version; change a date; delete; inherited and Elsewhere; edits under their
  version and refreshed after a save; the narrow layout; Timeline off; read-only; the entry form's tests
  (`entryWorkspace.versions.dom`, `time/versionRail.dom`, `time/entryVersions.test`) still pass; the cast tests
  for removed controls are removed with them (list them).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` has 0 errors, **and**
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` has 0 errors (the last lane's props errors were only
  caught there). Do not run the full suite.
- Comments state the rule, not the story. Never `prettier --write` a file beyond the lines you changed.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t4b-2026-11-14.md`): the inventory
with file:line; what each replaced control's job became; changed files; tests with results; every name, sentence
and label added; open ★; **Noticed, not done**. Under about 1,000 words.

## Corrections after the cold review (2026-11-14) — these rule over the text above

1. **Save writes the selected version** (owner, 2026-11-14, shown both rulings: 2026-11-06 "the most recently
   active" version is the one "the member page shows and saves"; 2026-11-13 "Save edits that version" — answer:
   "The selected version"). The page still **opens** on the version in force at the lorebook's present (the
   2026-11-06 rule holds on open); after a version is picked on the rail, Save writes that one.
   - Today `lorebooks:updateBinding` always writes `onto: "shown"` (`sockets/lorebooks.ts` ~2815), the client
     never gets the base version's id (only `baseColumns`, `shared/sockets/types.ts` ~8951) and the amendments
     list leaves the base out (`sockets/amendments.ts` ~369–370). **In scope, server:** the smallest additive
     change that lets the page name the version it saves: the base version's id on the wire, and a target on the
     member save that writes that version (refused when it is not this member's, or is read-only per
     correction 2). `src/lib/shared/sockets/types.ts` and `src/lib/server/sockets/lorebooks.ts` (the member
     update handler and the cast row it sends) are added to Files owned for that. No new event.
   - A dated version saves through `amendments:update` (`rewriteCastChange` rebuilds the version from the one
     before plus `fields`: send its own fields plus the diff, never a folded whole).
   - The card link and unlink keep applying "from the book's present" (2026-11-06, `versions.ts` ~1282–1291):
     they are not version fields; they stay outside the rail's selection and say so where they sit.
2. **Several versions at one date: each is its own node** (owner, 2026-11-14: "Each as its own node").
   - Legitimate cases: a session-written version beside a person's, and versions at different life points
     (`personalPosition`); the in-place update and the refusal compare the life point and skip session-written
     rows (`characters/versions.ts` ~1798–1800, ~2181–2184).
   - The rail's order and "which is in force" follow the **server's reader** for cast (`versionInForce`,
     `shared/lorebooks/lineReading.ts` ~597–624: the higher life point, then the write order), never
     `amendmentsOnLine`'s date-and-id order and never `entryVersions`' one-version-per-date fold.
   - Each node at a shared date carries a chip saying what it is: its life point, or *written in ‹session›*. A
     session-written version is **read-only** on the rail (it is changed from its session); the wire gains what
     the chip needs (`sourceSessionId` and the session's name as the asker may see it, and the write order) on
     the cast row: additive, in `types.ts` and the reply builder, in scope.
   - Selecting a node that is not the one in force at its date still shows it in the form; the moment bar moves
     to its date, and the rail marks which node the lorebook reads there (*read at this date*). 🚧
   - The page does not show or write a life point today: the chip shows it; editing it is out of scope.
   - **Save as a new version…** at a date that has only a session-written version adds the person's own (no
     "Save will change it" sentence there); at a date that has the person's own version, Save changes it and the
     dialog says so.
3. **Edit history: one request, for the selected version.** `characterVersions:redlines` takes one
   `characterVersionId`. Only the selected node shows its edit rows (loaded when selected); the other nodes show
   a count only if it is already known, else nothing. When a save retires and copies the version
   (`versions.ts` ~2095–2098) the reply carries the new id: re-key the selection to it. Deleting a version a
   descendant session still reads keeps its row and history (`deleteCastVersion` ~2347): the delete sentence
   says "its edit history goes too" only when it does.
4. **Files and jobs.** The rail takes its writes as **callbacks from the page** (today `VersionRail` calls
   `updateEntryAmendment` / `deleteEntryAmendment` from `editor/entrySave.ts`, which wait for an entry reply):
   make the entry form pass its own, unchanged in behaviour. `src/lib/client/lorebooks/cast/castSave.ts` and
   `cast/castVersionRead.ts` are added to Files owned. **Change later versions too** (★CV-13,
   `CastMemberForm.svelte` ~1886–1906; `rewriteCastChange`'s `changeLater`) keeps its home on Save of a version.
   The cast page's menu item is **Change the member** (~1996), not "Change the base".
5. **Two parts**, as `time-t4a`: part 1 the server addition, the rail's neutral version shape and write
   callbacks, selection, Save, Save as a new version, change a date, delete, Elsewhere, chips; part 2 the edit
   rows, the moment sentence and the `onCast` prop, the removals, docs. The vertical-time-view ruling is dated
   2026-11-13.
6. Checked and fine: the Member **Timeline** tab lists the scenes the member is in, not versions; it stays.
   One-version-per-key is already enforced for a person's writes (`versions.ts` ~1771–1810, ~2163–2191).
