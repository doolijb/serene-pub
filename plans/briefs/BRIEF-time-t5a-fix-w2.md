# BRIEF — worker `time-t5a-fix-w2` — the note's words, the docs, one comment, the orphan on delete

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t5a-fix`. Return your report as your final message
(the harness refuses a write to a report path).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

No SDK edit, no `sdk:build`, no `npm run build`, no dev instance, no migration. Leave the owner's `vite preview`
(port 4173) alone. Another session shares this checkout: before EVERY vitest run, check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if one runs, wait (poll every 30 s) until none does.

## Context

A session that reads at a story date writes its change to a lorebook entry as a dated **version** of the entry
(`entry_amendments`, `base` NULL). A swipe/Back that cannot take a write back (someone changed it since) leaves a
**kept** record, shown on the entry as a note (`KeptImprintNote.svelte`, words in `keptImprints.ts`). Worker w1 is
adding, in parallel, an optional `versionDate?: string` to `KeptImprint` (`src/lib/shared/entries/types.ts` —
w1 owns that file; do not edit it): the version's date in words, set on every record whose subject is a version.
`field: null` + `versionDate` = the reply **made** that version; `field` set + `versionDate` = a field the reply
wrote in that version; no `versionDate` = an entry record (unchanged).

## Tasks

### A. The note's words (`src/lib/client/lorebooks/sections/keptImprints.ts`, `KeptImprintNote.svelte`)

In `keptImprintLine`:
- `field === null` and `versionDate` set → exactly:
  `The reply added the version dated ${versionDate}. Revert removes that version, with any later edits to it; the entry and its other dates stay.`
- `field` set and `versionDate` set → the existing field sentence with ` in the version dated ${versionDate}`
  after the value: `${label}: the reply set ${keptValueWords(after)} in the version dated ${versionDate}. ${back}`
- No `versionDate` → exactly as today, character for character (entry made: `The reply added this entry. Revert
  removes it.`; field: unchanged).
These two sentences are provisional copy (🚧): mark the function's doc comment with 🚧 and say what each case
says; update the file header's "(an entry the reply added is removed)" to cover a version too. In
`KeptImprintNote.svelte` only the doc comment changes (Revert "removes the entry the reply added" → also a version
it added); no markup change.

Tests: the existing `src/lib/client/lorebooks/sections/keptImprintNote.dom.test.svelte.ts` (read it; follow its
pattern). Add: the made-version sentence; the field-in-version sentence; an entry record's two sentences
unchanged (assert the exact strings).

### B. Docs (`docs/lorebooks.md`, section "Changes from a replaced reply", ~248–257)

- The **Revert** bullet (~254): after "For an entry the reply added, it removes the entry." add: "For a version
  the reply added, it removes that version, with any later edits to it; the entry and its other dates stay. 🚧"
- The paragraph "If someone changed it since…" (~252): add that a line about a version names the version's date,
  and that a version a session wrote also stays, with the note, when that session no longer reads this lorebook
  (Back never writes into a lorebook the session has left). One or two plain sentences, 🚧, the docs' voice
  (second person, no code names).

### C. One stale comment (`src/lib/server/lorebooks/ownBook.ts` ~1474–1476, doc comment on `heldChangeVerdict`)

Delete the clause ", and when the line already holds a version of the entry at that date (one version per entry,
line and date)" so it reads "A dated change waits, never done, when its date is before the entry's Beginning."
That rule is withdrawn. Nothing else in the file.

### D. Deleting a version deletes its records (`src/lib/server/sockets/amendments.ts`, `amendments:delete`, entry branch ~2088–2115)

Today a person's delete of a version calls `markImprintsKept` on it, then the row is gone, so the record is
orphaned (hidden from the note by an inner join). Replace that call with a delete, in the same transaction (`tx`),
of every `lore_imprints` row with `subject_kind = 'version'` and `subject_id = params.id`, only when the delete
removed a row. Taking a turn back after that changes nothing (a record with no row was dropped anyway). Write it
as an exported function in `src/lib/server/lorebooks/imprints.ts`? NO — w1 is editing that file now. Write the
delete inline in `amendments.ts` with `schema.loreImprints` and say so in your report (the supervisor may move it
later). Update the comment to state the rule: a deleted version takes its per-turn records with it.

Test: `src/lib/server/sockets/amendments.imprintsKept.int.test.ts`, test `"a delete keeps the records of the keys
the row held"` (~221) becomes: the version is gone and no `lore_imprints` row names it (any status). Keep the
file's other tests as they are.

## Files owned

`src/lib/client/lorebooks/sections/keptImprints.ts`, `src/lib/client/lorebooks/sections/KeptImprintNote.svelte`,
`src/lib/client/lorebooks/sections/keptImprintNote.dom.test.svelte.ts`, `docs/lorebooks.md` (only that section),
`src/lib/server/lorebooks/ownBook.ts` (only that comment), `src/lib/server/sockets/amendments.ts` (only the
delete's record handling), `src/lib/server/sockets/amendments.imprintsKept.int.test.ts`.

## Rules (quoted for you)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never seed a row at a hardcoded id.
- Comments state the rule, not the story (no "fix", no lane names, no dates).
- Never `prettier --write` beyond the lines you changed (check with `npx prettier --check <file>`; many of these
  files were not prettier-clean before you: compare with the lines you touched, fix only yours).
- An int test that opens a DB inside an `it` needs a 60 s timeout.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- No other new name or copy beyond the sentences above. Never `kill -9`. Never pipe vitest into `head`.

## Stop and ask when

Anything outside these files seems needed; a sentence does not fit; the delete change would alter what a
take-back does to lorebook text.

## Done means

Run, one at a time, each after the vitest check above:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/sections > plans/time-t5a-fix-w2-sections.log 2>&1"
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sockets/amendments > plans/time-t5a-fix-w2-amendments.log 2>&1"
```

All pass (a test that fails for a reason outside your change: report it with its error line). Report: changed
files, test counts from the logs, the docs sentences you wrote verbatim, Noticed-not-done. Under 300 words.
