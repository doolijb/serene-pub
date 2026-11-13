# BRIEF — s4-fold worker 6 — a folded notes member's `{{char:N}}` tags follow it — 2026-11-08

Supervisor: lane `s4-fold`. You are a lane-worker; you cannot spawn agents. Small, exact task.

## Goal

Owner ruling ★bk-fold-3 (2026-11-08): **fold the notes' member into the copied member** — _"values/sheets/references move, turn ties kept, the emptied notes row deleted"_; the lead's brief: _"every reference to N re-pointed"_.

`src/lib/server/lorebooks/foldInParent.ts` (worker 4) folds a notes member N (a member of the session's own book O holding a card that a member M of the attached book P holds) into M′ (M's copy in O), then deletes N. One kind of reference was missed: **cast tags** `{{char:k}}` in O's own text where `k` is N's member number. After the fold N is gone, so the tag dangles. Fix: for each folded N, rewrite N's tags across O's lore texts to M′'s tag, inside the fold's transaction, **before N is deleted**, with the existing book-wide writer `rewriteBookCastTags(tx, lorebookId, from, to)` (`src/lib/server/utils/castTags.ts` ~344; it is what a cast merge uses — `from` is N's member number, `to` is `castTag(<M′'s member number>)`). Find the member-number column on `lorebook_bindings` and how `copyLorebookTables` gives M′ its number (`maps.tags`, fresh numbers when O already held members). First check how a `{{char:k}}` in an own-book entry is resolved for a session today (which book's members — grep the tag resolver used by the prompt / `castTagsIn` consumers) and confirm that before the fold the tag named N; if it named something else, stop and say what.

Copied P text never carries N's number (the registry gives P's members fresh numbers above O's when O held members) — verify with an assertion in the test rather than assuming. If `rewriteBookCastTags` requires the book's advisory lock, the fold already holds O's lock (`lockAndRead`) — check it is the same lock key and say so.

## Test (Done means)

In `src/lib/server/lorebooks/foldInParent.int.test.ts`, extend the existing ★bk-fold-3 test (or add one beside it): O holds an entry whose content names N's tag (`{{char:k}} waves`) and an O cast version text naming it; after the fold the entry's content names M′'s tag, no O row names `{{char:k}}`, and P's text is unchanged (P byte-identical except this session's captures — the existing dump helper). Run `foldInParent.int.test.ts` and `src/lib/server/utils/castTags*.test.ts` (if any); tsc for your files.

## Files owned

`src/lib/server/lorebooks/foldInParent.ts` (the N fold step only) and `foldInParent.int.test.ts`. Nothing else.

## Rules (quoted)

- CLAUDE.md: _"Inside `db.transaction(async (tx) => …)` use only `tx`."_ · P2: use the tag writer, never a second rewrite.
- No new exported names. Comment style: plain present-tense; no history comments (a ratchet test fails on them).

## Commands

- Tests: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w6-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w6-tests.log'` (never pipe vitest into `head`).
- tsc: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; cd /home/jody/github/serene-pub && npx tsc --noEmit -p . > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w6-tsc.log 2>&1; echo exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w6-tsc.log'`

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)

## Report

Final message: the hunk you changed; how tags resolve for an own-book entry (one sentence + file:line); tests with counts; tsc; Noticed, not done.
