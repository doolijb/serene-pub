# BRIEF — hist-B1-w2: the chat tool `write_entry` refuses history

Supervisor: lane hist-B1. Repo `/home/jody/github/serene-pub`. Report to `plans/briefs/REPORT-hist-B1-w2.md` (if the harness refuses the write, put the whole report in your final message).

## Goal

Owner direction (2026-11-10, verbatim): "We want to make sure we are encouraging pipelines/modders to be targeting scenes first for granular history updates, then history entries second, optimally compiling from scenes to history entries." A chat tool never writes history.

In `src/lib/server/pipelines/runtime/tools/writeTools.ts`:

1. Remove `history: "core:entry/history"` from `ENTRY_TYPES`.
2. In `writeEntry.run`, after the name/content check and before anything is filed: when `kind === "history"`, throw
   `new ToolError("History comes from scenes: capture the moment and compile it, or write world lore.")` — exactly that sentence. Nothing reaches `ctx.fileLore`.
3. Leave the tool's `parameters` enum (`lore|person|place|note`) as it is; it never offered history.
4. Update the file's header comment only if a line in it now says something untrue (it doesn't mention history today; likely no change).

In `src/lib/server/pipelines/runtime/tools/writeTools.test.ts`: one `it` — `write_entry` with `kind: "history"` rejects with a `ToolError` whose message is that sentence, and nothing was filed (`filed` stays empty). Keep the existing tests as they are.

Run: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 src/lib/server/pipelines/runtime/tools/; echo test-exit=$?'`

## Files owned

- `src/lib/server/pipelines/runtime/tools/writeTools.ts`
- `src/lib/server/pipelines/runtime/tools/writeTools.test.ts`

## Files readable

Anything under `src/lib/server/pipelines/runtime/tools/`.

## Out of scope

`host.ts` (another worker), any other tool, docs, NOMENCLATURE.

## Stop and ask when

A name or copy beyond the sentence above is needed, or the change reaches another file. Say so in your report; don't build it.

## Rules (quoted)

- Check `git diff` on both files before editing; never overwrite work you didn't make. **Never run `prettier --write` on a file**; format your own hunks by hand (tabs, no semicolons, double quotes).
- Never pipe vitest into `head`. Scratch files start with `hist-B1-w2-`.
- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)
- Never `git checkout`, `restore` or `clean` in either repo.

## Report

The diff hunks, test results (counts), Noticed-not-done.
