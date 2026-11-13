# Rules every lane-ed worker follows (quoted by the supervisor; read this whole file)

**Verbatim (multi-agent guide):**
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- **You do not run `sdk:build` at all in this lane** — the supervisor builds. Never `git checkout`/`restore`/`stash` anywhere (above all in `../serene-pub-sdk`).

**CLAUDE.md (quoted):**
- Decisions: *Decide implementation inside the asked scope (structure, helpers, tests, existing patterns); name the choice in your report. Propose and wait — one recommendation and its trade-off, marked ★ — on anything a user sees or that outlives the change: behaviour, layout, copy, a new name / setting / flag / abstraction / event / table / migration, reshaping or deleting data, files outside the asked area.* Copy given in your brief is ruled or supervisor-proposed: use it exactly. Any other new user-facing sentence: write it, mark it 🚧 in a comment, and list it in your report as ★.
- *Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.*
- Hard rules: *Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.* · *Never add a top-level `await` to `src/lib/server/db/index.ts`.* · *Never seed a row at a hardcoded id.* · *Migrations are generated* (this lane makes none). · *`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`.* · *It is a **session**, never a chat.*
- *0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing.* Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Sockets: *one domain context per event family is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`. An event in `SCOPED_EVENTS` must carry its scope key in the payload.*
- NOMENCLATURE R1 one word, one meaning · R2 distinctive words for new concepts · R3 qualify, never the bare noun · R4 casual words are not type names · R6 mark ⏳ transitional / 🚧 provisional. §24: grep a new name first across `src`, the SDK and the schema; say what it is NOT when a near-neighbour exists. §23: never reintroduce a retired word — **"Honour mode" is leaving the UI and docs (owner ruling ★sl-4, 2026-11-05)**: no new user-facing "Honour mode".
- Re-read a shared file right before each edit; additive hunks; **never reformat a file** (most are dirty at HEAD; no prettier --write on whole files).

**Tests:** run only your targeted files. `npx vitest run <files>` from `/home/jody/github/serene-pub`. **Never pipe vitest into `head`/`tail -n` while it runs** (SIGPIPE leaks PGlite temp dirs): redirect to a log file in `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/` (name it `ed-w<n>-*.log`) and grep the log. An int test that opens a DB inside an `it` needs a 60 s timeout. SDK DOM tests (sdk-tests with happy-dom) run inside a capped scope: `systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test <file>.test.ts > <log> 2>&1'`, and **never hand a DOM node to an assertion** (compare `x === null` to `true`). `npx tsc --noEmit -p .` for typecheck (grep its output for your files).

**Report:** write it to the report path in your brief: changed files, tests run with counts, every choice you made, ★ (copy or anything else needing a ruling), Noticed-not-done. Never commit.
