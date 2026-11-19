# BRIEF — worker `tl-2c-w4` — tests, part two (items 3, 4, 5, 6)

Supervisor: lane `tl-2c`. Your brief is **`plans/briefs/BRIEF-tl-2c-w2.md`**, read all of it: its rules, the
verbatim lines, "What was built", Tests and Report sections apply to you word for word. You build its items
**3** (`host.historyWrites.int.test.ts` re-pin), **4** (the backstop test, new file), **5** (the guard, new file)
and **6** (`sockets/sessions.lairWalk.int.test.ts`). Worker w2 builds items 1, 2 and 7 at the same time: edit only
the files of your items; vitest runs never overlap (always wait with the brief's `pgrep` loop first). Name your
logs `plans/tl-2c-w4-<n>.log`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
