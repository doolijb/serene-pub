# BRIEF lb-1-w2 — client: the delete confirm says a lorebook in use can't be deleted

Repo `/home/jody/github/serene-pub`. Supervisor: lane `lb-1`. You are a `lane-worker`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` in this task: do not run one.)

Also: never `git checkout` / `restore`; never `prettier --write`; no full test run; no `npm run build`; no `npm run check` (the supervisor runs it). Another worker is editing server files at the same time; edit only the files listed below. Re-read a file right before editing it.

## Goal (owner ruling D50, 2026-11-16)

Owner: "Refuse the delete while a session uses it, naming the sessions". The server now refuses `lorebooks:delete` while a session plays on the book, with a sentence naming the asker's sessions; that refusal already reaches the person through Layout's `:error` catch-all toast (keep it so: **no new toast site, never call `notify`/`toaster` for this**). Where the UI can know beforehand, the delete confirm must say so in words, with the sessions listed as links, **instead of offering a Delete that will be refused**.

The confirm already knows the asker's own reading sessions: the list row it is handed (`deletingBook`, from `lorebookList` in `LorebooksWorkspace.svelte` ~3391) carries `readBy?: { id: number; name: string | null }[]`, the asker's own sessions reading the book, newest first (server `buildLorebooksList`, `sockets/lorebooks.ts` ~422). Other people's sessions are not known to the client; the server's refusal covers them.

## Files you own

- `src/lib/client/lorebooks/deleteCopy.ts`, `src/lib/client/lorebooks/deleteCopy.test.ts`
- `src/lib/client/lorebooks/LorebookActions.svelte` (only the delete dialog, `deleteCopy`, and imports)
- new `src/lib/client/lorebooks/BookDeleteRefusal.svelte` and `src/lib/client/lorebooks/bookDeleteRefusal.dom.test.svelte.ts`

Readable, never edit: `src/lib/shared/lorebooks/sessionNotes.ts` (the supervisor wrote the words: `bookDeleteWords`, `bookDeleteSentence`, `readerName`, `BookDeleteReaders`, `BOOK_DELETE_NAMES_SHOWN` — **use them, never retype a sentence**; the file's rule: "One copy of each sentence: the server answers with them and the client draws them by import, never retyped"), `src/lib/client/lorebooks/BookReadBy.svelte` and `bookReadBy.dom.test.svelte.ts` (the link pattern and the DOM-test pattern to copy).

## Build

1. `deleteCopy.ts`:
   - `DeletingBook` gains `readBy?: readonly { id: number; name: string | null }[] | null` (doc: the asker's own sessions that read the book, newest first, off the list row).
   - New pure `deleteBookRefusal(book: DeletingBook | null): ReturnType<typeof bookDeleteWords> | null`: null when `book?.readBy` is empty/absent, else `bookDeleteWords(book.name ?? "", { named: book.readBy, others: 0 })`.
   - `deleteBookCopy`: remove the line "Sessions reading it … keep their messages but stop reading lore from it." and its `openSessionName` option (a delete now never goes while a session reads the book, so the line is no longer true). Keep everything else as is.
2. `BookDeleteRefusal.svelte` (props: `words` — the `bookDeleteWords` result —, `onOpen?: () => void`): draws, under the dialog's title, `<p>{lead}</p>`, then the shown sessions as a list of links `href="/sessions/{id}"` named by `readerName(r)`, each `data-book-delete-reader`, calling `onOpen` on click (so the dialog closes as the session opens); then, when `more > 0`, a line `and {more} more`; then `<p>{wayOut}</p>` when set. Link classes as `BookReadBy.svelte`'s (`text-primary-ink font-medium underline-offset-2 hover:underline`). Root element `data-book-delete-refusal`.
3. `LorebookActions.svelte`: `const deleteRefusal = $derived(deletingKit ? null : deleteBookRefusal(deletingBook))`. In the delete dialog: when `deleteRefusal`, the heading is `deleteRefusal.title` (keep the heading's existing classes but not the error colour: use the plain heading colour, since nothing is about to be deleted), the body is `<BookDeleteRefusal words={deleteRefusal} onOpen={() => (deletingId = null)} />`, and the only button is **Close** (`btn preset-tonal-surface`, sets `deletingId = null`); no Delete button. Otherwise the dialog is exactly as today. Remove `openSessionCtx` / `getContext` only if nothing else uses them after step 1.

## Tests

- `deleteCopy.test.ts`: drop the tests of the removed line/option; add `deleteBookRefusal` cases (no readers → null; readers → title `Can't delete "Umber City"`, `shown`, `more` past five, `wayOut` singular/plural).
- `bookDeleteRefusal.dom.test.svelte.ts` (copy `bookReadBy.dom.test.svelte.ts`'s mount/unmount): the lead sentence, each link's text and `href`, "and 2 more" with seven readers, the way out; clicking a link calls `onOpen`.

Run, one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/deleteCopy.test.ts src/lib/client/lorebooks/bookDeleteRefusal.dom.test.svelte.ts > plans/lb-1-w2-1.log 2>&1"
```

Never pipe vitest into `head`; read the log with `tail`/`grep`. `npx prettier --check` your changed files.

## Report (your final message, under 250 words)

Changed files; tests with pass/fail counts; any sentence you had to write yourself (should be none: "and ‹n› more" and **Close** are the only literal words); Noticed, not done.
