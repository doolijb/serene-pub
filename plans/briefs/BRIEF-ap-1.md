# BRIEF — build lane `ap-1` — Apply never writes into another person's lorebook: copy it to the session's owner first (owner ruling A1 of 2026-11-17)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then the block "Rulings page, third round, first answers" in
`plans/PLAN-programme-2026-11-15.md`, row D67 in `plans/DISCUSS-LATER.md`, `plans/REPORT-kn-6-2026-11-17.md`
(the Apply review, held changes, `heldPlayTiesIn`), `plans/REPORT-gs-2c-2026-11-17.md` (only the session's
owner sees the review; `isSessionOwner`), `plans/REPORT-lb-1-*.md` (`bookDeleteRefusal`, provided books kept in
use), `docs/lorebooks.md` (your session's own notes; Apply; **New world** and other copies; sharing),
`docs/sessions.md`, `NOMENCLATURE.md` §1, §24 and rows **Apply**, **held changes**, **notes**, **shared**,
**provided lorebook**, **New world** / **copy**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Both repos are staged by the lead: run no git command that changes the index or the working tree. `npx prettier
--check` only, never `--write`. **No migration** unless the Stop rule fires. Inside `db.transaction` only `tx`.
Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ap-1-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`.
Comments state the rule, never the history. Views never toast. Lane `gs-3a2` is live in
`sockets/sessions.update.ts`, `sessions/seats.ts`, `sessions/guestSeats.ts`, `EditSessionForm.svelte`: not
yours.

## Owner (2026-11-17, A1)

"Can't apply to a lorebook owned by someone else. On apply would require cloning the lorebook to the session
owner first. Sharing is for viewing only, not editing. We can add more granular permissions later to allow
co-editing/playing, but not in this sprint, just don't block the future permission structure from being able
to be implemented in core."
Standing: every session has a lorebook; a guest neither opens nor edits the notes (2026-11-16); starters are
disabled, never deleted; plugin books are starters; 0.6 is in users' hands (stored data changes need a forward
path and a second boot that changes nothing).

## Lead's reading (each ★ in the report)

- The Apply review is the **session owner's** (as built by `gs-2c`). When the lorebook under the notes is the
  session owner's own, Apply and Take back work as today.
- When it is **not** theirs (a shared or provided lorebook), Apply does not write into it. The review says so
  in one sentence and offers one action: **copy the lorebook to me, then apply** (★ wording). That makes the
  session owner's own copy by the existing copy path (find what **New world** / copying a shared or starter
  lorebook does today and reuse it; no second copy mechanism), points **this session** at the copy, and
  applies the held changes into it. Other sessions on the original are untouched. Take back needs no copy
  (it only discards what the notes hold: verify).
- The lorebook's owner, when a guest in that session, sees nothing of the review (no exception to the guest
  rule).
- **One function decides "may this person apply into this lorebook"** (today: owner only), used by the socket
  door and by what the client is told, so a later co-editing permission changes one place. No permission
  table, option or hook is added now.

## Build

1. Find today's rule and every place it is checked (`sockets/sessions.overlay.ts`, the Apply socket verbs, the
   review's payload): who may see the review, who may Apply, who may Take back, and what a session on a
   lorebook its owner does not own does today (the walk and D67 say: the session's owner sees held changes
   and cannot apply them). Write the table in the report.
2. The one function (name by §24), pure over (person, lorebook row); the doors and the payload use it.
3. The copy-then-apply action: one server verb or the existing copy verb followed by the existing apply, in
   one transaction if the code allows (inside it only `tx`); re-pointing the session to the copy uses the
   existing way a session's lorebook is changed (find it; if a session's lorebook cannot be changed after
   start today, **stop and report**: that is a new behaviour for the owner to rule). The copy keeps what a
   copy keeps today (timeline switch, cast, covers: report the list); held knowledge ties and cast members in
   the notes must land on the copy's entries and members, not the original's (map ids through the copy; test
   it).
4. Client: the review for a not-owned lorebook: the sentence, the one action, a confirmation built into the
   page (no `confirm()`), what it will do in words (a copy named ‹name›, this session moves to it). Reuse
   existing words for copies where they exist; new sentences are ★ with one alternative.
5. Docs: `docs/lorebooks.md`, `docs/sessions.md`; NOMENCLATURE (the function's row with its charter: what it
   answers today, that a later permission widens it here; §25 quoting A1).

## Tests

The function's table (owner / shared-with / provided / admin who is not the owner / guest). Apply into an
owned lorebook unchanged (existing tests stay green untouched). Session on a shared lorebook and on a provided
one: Apply is refused in words at the server; copy-then-apply makes one copy owned by the session's owner,
the session reads the copy, the held entries, cast members and knowledge ties are applied to the copy with
ids mapped, the original lorebook's rows are byte-for-byte unchanged, another session on the original still
reads the original; a second press makes no second copy; Take back on a not-owned lorebook; the lorebook's
owner as a guest gets no review payload. A second boot changes nothing. Client DOM for both states. `tsc` 0;
`npm run check` 0 errors in lane files.

## Files owned

`src/lib/server/sockets/sessions.overlay.ts` and the Apply verbs it calls, the new function's file, the Apply
review components, `shared/sockets/types.ts` for new fields, their tests, the two docs, NOMENCLATURE. The
lorebook copy code is **reused, not edited** (if it must change, say what and why before changing it).

## Stop and ask when

CLAUDE.md §Decisions applies; a session's lorebook cannot be changed after start; the copy path cannot map
held ids; copying needs a migration; a provided (plugin) lorebook may not be copied by a member today; Apply
on an owned lorebook would change in any way.

## Report

Final message = the report (lead saves `plans/REPORT-ap-1-<date>.md`), under about 600 words: today's table;
the function; the action (what is copied, what moves, what stays); every new sentence as ★; the readings as ★;
**Noticed, not done**.

## Cold review corrections (2026-11-17) — these rule over the text above

**No copy verb and no move.** A session keeps the lorebook it started with (★B-5, 2026-11-08, "never moved
after"; ★27-10, 2026-11-05, "No swapping lorebooks", `sessions/bookLock.ts` 1–15); "Clone with changes and
attach" is retired, never reintroduced (`NOMENCLATURE.md:1714`). The copy the owner asks for already exists:
**Merge ‹book› into these notes** (`lorebooks/foldInParent.ts`; ★27-10 "overlays can have their parent merged
in place"; in the panel at `SessionViewPanel.svelte` 400–410 with the ruled confirmation `FOLD_CONFIRM`,
`shared/lorebooks/sessionNotes.ts` 62–63). It copies the lorebook into the session owner's own notes, leaves
the original untouched, needs only read access, and after it nothing is held. So:

1. **The lane is: Apply and Take back are closed where the session's owner may not write the lorebook, and the
   review there says so in one sentence and offers the existing merge action with its existing words.** No
   new action, no re-pointing, no id mapping, no edit to `sockets/sessions.update.ts`. Strike build step 3 and
   the copy tests. The one new sentence is ★ with one alternative.
2. **The cases that exist.** A member cannot play directly on a shared lorebook (`sockets/sessions.shared.ts`
   119–141 `checkLorebookOwnership`; **New world** and starters copy): drop "session on a shared lorebook"
   from the tests. What remains: a session on a **live provided (plugin) lorebook**, and on a provided
   lorebook **disabled after the session started** (the session keeps reading it,
   `plugins/providedMarks.ts` 196–217; but `providedBooksReadableBy`, 227–257, leaves disabled books out, so
   the merge is refused with "Lorebook not found."). Test both; for the disabled case report exactly what the
   session's owner sees and can do, and **change nothing about read access** (report it as ★).
3. **One predicate, in the existing home.** `utils/ownedBook.ts` is "One lorebook ownership check" (1–10; "Every
   WRITE keeps `assertOwnedBook`", 82). Put the pure "may this person write this lorebook" predicate there,
   have `findOwnedBook` use it, and make the four inline Apply checks call it: `lorebooks/ownBook.ts:2080`
   (Apply), `:2709` (Take back), `:3120` (automatic Apply, compares with `session.userId`), `:3340`
   (`overlayAccessOf`). No Apply-only function. `utils/ownedBook.ts` and those four sites in `ownBook.ts` are
   added to Files owned. Behaviour of every other caller of `findOwnedBook` unchanged (its tests stay green
   untouched).
4. **The doors also require the session's owner.** `sessionsApplyOverlayHandler`
   (`sockets/sessions.overlay.ts` 53–80) never calls `checkSessionAccess`; `applyOverlayItems` and
   `takeBackApply` check only `book.userId === userId`, so a lorebook's owner can Apply or Take back another
   person's notes, in the session or not (`REPORT-gs-2c`, Noticed). Apply and Take back require
   `isSessionOwner` **and** the predicate. Tests: the lorebook's owner as a guest, and as a non-member,
   **calls** Apply and Take back and is refused in words, nothing changed.
5. **Take back writes the lorebook** (`ownBook.ts` 2673–2687: fields go back, entries and links move out): it
   needs the same check as Apply; delete the sentence above that says it needs no copy.
6. **Client entry points:** `SessionViewPanel.svelte` 387–399 offers **Share to ‹book›** (sends
   `sessions:applyOverlay`) to `isOwner` whatever `mayApply` says; `:588` still has `isOwner || mayApply`. Gate
   both by what the server's predicate says for this viewer (session's owner **and** may write).
7. **Not this lane (asked on the rulings page, AP1):** a provided lorebook is owned by the admin who enabled
   the plugin (`plugins/providedBooks.ts` 5–8), so today that admin's own session Applies **into the plugin's
   book**, against "plugin books are starters" (2026-11-05: "nobody's play (the enabling admin's included)
   touches the original"). Keep that admin's behaviour exactly as it is today and pin it with a test named so
   the owner's answer flips one expectation.
