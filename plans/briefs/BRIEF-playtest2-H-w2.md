# BRIEF playtest2-H-w2 — Back's title words: a table's lines and Story's one message (shared reader, SDK strip, docs)

Lane `playtest2-H` · worker 2 · the supervisor reads your final message (no report file).
App: `/home/jody/github/serene-pub`. SDK: `/home/jody/github/serene-pub-sdk` (edit the SDK there).

## Goal
Owner rulings 2026-11-04 (plan `plans/PLAN-story-playtest-fixes-2026-11-03.md` § Rulings): *"A Back: one message per press in **Story**; Lair and Dungeon Crawler keep the whole turn. Trailing routine lines (Time passes, notes) go with the message."* and *"6 Back title (★H2): count person lines at a table (2 lines and 3 replies (…)). In Story the one-message title names the message's author."*
Worker 1 (in parallel) makes the server's `rewindStateOf` send two new optional fields on `rewind.backTakes`. You make every reader carry them and the strip word them. The header components (`Header.svelte`, `FullscreenExit.svelte`) already print `Back: ${takes}` and need **no** change; don't edit them.

The server's `backTakes` after worker 1 (today's three fields unchanged):
```ts
{ count: number; names: string[]; throughId: number
  /** 🚧 present only at a table (2 or more) */ personLines?: number
  /** 🚧 present only when the genre takes one message per press */ newestMessage?: { author: string | null; yours: boolean; filed: number } }
```
`count`/`names`: the unit's story-lane rows that are not a person's line, and their distinct names. `personLines`: the person lines the unit holds. `newestMessage.author`: who wrote the one message (a character's name, a persona's name, or null); `yours`: it is the session owner's own line; `filed`: how many story-lane rows go with it (a *Time passes* line, a note).

### 1. Shared reader — `src/lib/shared/sessions/rewind.ts`
- `RewindBackTakes` (`:31-39`) gains the two optional fields above, each with a one-line `/** 🚧 … */` doc.
- `rewindStateOf` (`:57-82`) keeps them when well-formed and drops each one alone when not (the other fields still read): `personLines` a non-negative integer; `newestMessage` an object whose `yours` is a boolean and `filed` a non-negative integer (`author` a string, else `null`). An old host's `{ count, names, throughId }` reads exactly as today (no new keys added, not even `undefined` — spread them in only when present, the file's own style).
- `rewindStateWith` passes `backTakes` through whole already; check it still does.
- Tests in `src/lib/shared/sessions/rewind.test.ts` (a new `test(...)` or two in the file's describe): old shape unchanged (`toEqual` the three fields exactly); the two new fields kept; a malformed `personLines` / `newestMessage` dropped while the rest stays; `rewindStateWith` keeps them while fresh and drops the whole `backTakes` once a newer story row is loaded (as today).

### 2. SDK — the words
- `sdk/src/sessionDossier.ts` `ConversationRewindV1.backTakes` (`:378`): add the same two optional fields (no `throughId` — the dossier never had it). Touch nothing else in that file.
- `core-catalog/src/shared/ui/conversation/rewindStrip.ts`, the **non-exported** `backTakesText` (`:56-61`; keep it unexported — `export *` re-exports this file, so an exported helper would be a new published name):
  - `newestMessage` present → head = `yours ? "your line" : "the newest message" + (author ? " (" + author + ")" : "")`; then, when `filed > 0`, ` and ${filed} ${filed === 1 ? "line" : "lines"} filed on it`. E.g. *the newest message (Ash)* · *the newest message (Ash) and 1 line filed on it* · *your line*.
  - otherwise (the turn) → head = `personLines >= 2 ? "${personLines} lines" : "your line"`; then as today: count 0 → head alone; else `${head} and ${n} ${n === 1 ? "reply" : "replies"}` + ` (names…)` when names. E.g. *your line and 3 replies (Ash, Birch)* (unchanged) · *2 lines and 3 replies (Ash, Birch)* · *2 lines*.
  - numbers truncated, never negative; absent fields → exactly today's words.
  - Update `RewindPressState.takes`'s doc example line to list the three shapes.
- `sdk-tests/rewindStrip.test.ts`: extend the existing `'Back says what it takes, in words; …'` test's neighbourhood with ONE new `test(...)` (node:test + assert/strict, the file's style) for the shapes above; the existing tests pass unchanged.
- Run only that file, in a capped scope (it has DOM tests): `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test rewindStrip.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-H-w2-sdk.log 2>&1; echo exit=$?'`. Never the SDK root `npm test` / `npm run build`; no `sdk:build` (the supervisor does that).

### 3. Docs — `docs/sessions.md` § *Back and Forward* (`:232-249`)
Edit the section's first paragraph (`:234`) so it says, in member words, in one paragraph: in **Story** each press of **Back** takes one message — the newest — with any line filed on it (*Time passes*, a note); in the other genres (the Lair, the Dungeon Crawler, …) it takes the last turn: your line and every reply that answered it (at a table of several players, the whole round). Keep the paragraph's "Everything that turn changed goes back…" sentence (say *that message or turn*), and replace the closing example so the button's words show the three forms: *Back: the newest message (Ash)* in Story, *Back: your line and 2 replies (Ash, Birch)*, and at a table *Back: 2 lines and 3 replies (Ash, Birch)*. Don't touch the other bullets or sections (lane S owns § Scenes in this file — touch nothing outside § Back and Forward). Sentence case; no machinery words (never *rewind*, *unit*, *routine*, *anchor*).

## Run (app)
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/shared/sessions/rewind.test.ts src/lib/client/components/sessionPage/requests/rewindTurn.test.ts src/lib/client/components/headerBackTakes.dom.test.svelte.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-H-w2-<n>.log 2>&1; echo exit=$?'` then read the log. (If `systemd-run` is refused, `timeout 900` with the same NODE_OPTIONS.) **Never pipe vitest into `head`.** The last two files are run to prove they still pass; don't edit them. Then `npx prettier --check` on every file you changed (app root for app files; in the SDK repo from its root) — report the result, don't reformat lines you didn't touch.

## Files owned (edit only these; re-read each immediately before every edit — other lanes work in the same trees; Edit, never Write, on existing files)
App: `src/lib/shared/sessions/rewind.ts` · `src/lib/shared/sessions/rewind.test.ts` · `docs/sessions.md` (§ Back and Forward only).
SDK: `sdk/src/sessionDossier.ts` (`ConversationRewindV1.backTakes` only) · `core-catalog/src/shared/ui/conversation/rewindStrip.ts` · `sdk-tests/rewindStrip.test.ts`.

## Out of scope — never build
Server files (worker 1), `Header.svelte`, `FullscreenExit.svelte`, `src/app.d.ts`, `+page.svelte`, `shared/sockets/types.ts`, `descriptors.ts`, `NOMENCLATURE.md`, any other docs file or section. Any change to what Back takes, the button's label, or a new control. No refresh of the words on reply end (★H1 is not yours).

## Stop and ask (in your final message) when
A name beyond `personLines`, `newestMessage` (`author`, `yours`, `filed`) is needed; a file outside Files owned needs a change; an existing test must change.

## Rules that apply (quoted)
- STYLE-GUIDE §10: "Sentence case everywhere" · "One name per thing … the thing you open is a session, never a chat" · "Counts live in the copy where they help".
- NOMENCLATURE §24 rewound turn: "Never say _rewind_ to a member." Member copy: **Back** · **Forward** · _2 turns ahead_. R3: "qualify, never the bare noun".
- "0.6 is in users' hands": an additive field is fine only if every reader still works on data that lacks it — test the old shape.
- CLAUDE.md: browser code runs on plain-http LAN addresses and phones: "no `crypto.randomUUID`, no `navigator.clipboard`."
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You run no sdk:build.)

## Report (your final message)
Changed files (both repos) with a one-line summary each · test commands and pass/fail counts · prettier results · anything stopped · Noticed, not done.
