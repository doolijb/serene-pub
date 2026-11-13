# BRIEF playtest3-S7-w4 — the compile modal saves only from a real entry

Lane `playtest3-S7`, worker 4 (client). The supervisor checks your diff against this brief. Your final message must give: changed files, exact test command, pass/fail counts, prettier result, and Noticed-not-done.

## Goal
`src/lib/client/components/modals/CompileHistoryEntryModal.svelte`, in by-date mode (`byDate` given, `historyEntry` undefined). The modal works on `entry`, which is `historyEntry ?? (adoptedId != null ? (entryOf?.(adoptedId) ?? stubOf(adoptedId)) : stubOf(0))` (~113–118). `stubOf` is a stand-in dated at the asked day. For *Undated* it is dated Year 1/1/1. The server, though, files undated scenes under the line's NEWEST dated entry, and that entry can be another line's. Today `saveAt = compileSaveOf(entry, reading)` (~120) and `save()`'s `changedFields(…, { content: entry.content, … })` (~408) can come from the stub. That is wrong twice:
- A stub's `branchId` is the reading's, so `compileSaveOf` says "patch the entry" where it should say "amendment at the entry's date".
- A stub's `content` is `""`, so `changedFields` compares against nothing.

**Rule: `saveAt` and `changedFields` never come from the stub.**
1. Add `let savedEntry = $derived(historyEntry ?? (adoptedId != null ? entryOf?.(adoptedId) : undefined))`. It is the real row, or undefined while the by-date entry's row is not known. Doc it in one line. If a better local name fits the file's vocabulary, use it, but it must be a component-local `let`, not a prop.
2. `saveAt` = `savedEntry ? compileSaveOf(savedEntry, reading) : null`. Make the template reads null-safe (`saveAt?.kind === "amendment"` at ~580 and ~587; the `saveAt.date` reads sit inside those branches).
3. `canSave` also requires `savedEntry != null`. The Save button is simply disabled until the row is known. Add NO new copy or string.
4. `save()`: `if (saving || loreWrites.off || !savedEntry || !saveAt) return` (or equivalent), then use `savedEntry` (not `entry`) for `changedFields`' base, the amendment's `lorebookId`/`entryId`, the update's `id`/`lorebookId`/`match`, and `onSaved?.({ ...savedEntry, content, isCompleted: true })`.
5. `entry` (with the stub) stays for display only: `hasExistingContent`, `diffParts`, `useLoreWritesOff(() => entry.lorebookId)`, `LoreWritesOffNotice lorebookId`. Add one comment line on `stubOf` saying it is a display stand-in that never decides where or what Save writes.
6. **Adoption (~237–247) stays as it is.** A dated ask is already narrowed to the asked day via `isAskedDay(entryOf?.(a.historyEntryId))`. Do not change the Undated branch (the supervisor is raising it as a question).

## Tests: `src/lib/client/components/modals/CompileHistoryEntryModal.dom.test.svelte.ts`
Follow its `describe("CompileHistoryEntryModal — compile by date")` patterns (`renderByDate`, `activity`, `activities`, `settle`, `sent`, `dayEntry`/`mainEntry`). Read how the existing save tests assert what is sent: `entries:update` vs the amendment event (`fileEntryAmendments`, see `$lib/client/lorebooks/editor/entrySave`) and how they click Save.
- **A — no save from the stub.** By date, adopt an activity in `review` with a `pendingResult` whose `historyEntryId` `entryOf` does not know (returns undefined). For a dated ask the day check would refuse adoption, so use `byDate.date: null` (Undated), where adoption takes any new matching activity. The Save button is disabled. Find it the way the other tests find buttons. Nothing save-related is sent when it is clicked.
- **B — Undated saves where the real entry is.** Undated, reading on line `NORTH`. `entryOf` returns a main entry (`branchId: null`, a date like Year 4/2, content "Old.") for the adopted id. Adopt a `review` activity, edit or keep the content, click Save. What is sent is an AMENDMENT on `NORTH` dated at that entry's own date (`atEntryDate`), not an `entries:update` of the entry. Also assert the stub's Year 1/1/1 appears nowhere in what is sent.
- Every existing test stays green.

## Files owned (the only files you may edit)
- `src/lib/client/components/modals/CompileHistoryEntryModal.svelte`: only what is listed above.
- `src/lib/client/components/modals/CompileHistoryEntryModal.dom.test.svelte.ts`

A server worker edits `src/lib/server/**` beside you; never touch those. Re-read each file immediately before every edit. Use Edit, never Write, on existing files.

## Rules your work depends on (quoted)
- "Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24." This task adds no prop, no event, no copy. Component-local `let`s only.
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "Sockets: … views register listeners for local state and never call `toaster`" beyond what the modal already does. Don't add toasts.
- STYLE-GUIDE: a disabled control stays visible. Don't hide Save, just disable it via `canSave`.
- Do what was asked, at the size asked. Anything else goes under **Noticed, not done**.

## Run (capped; never pipe vitest into `head`)
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/components/modals/CompileHistoryEntryModal.dom.test.svelte.ts src/lib/client/components/modals/loreWritesOff.dom.test.svelte.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S7-w4.log 2>&1; echo exit=$?'`. Read the log. Re-run after your last edit. Then `npx prettier --check` on both files: report it, fix only lines you touched, never `--write`.

## Stop and report (don't decide) when
Save can't be gated without new copy; a prop or name seems needed; another file must change.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No SDK build is needed.)
- Never `git checkout`, `git restore` or `git clean`. Never a full `npm test`, `npm run check`, or project-wide `tsc`.
