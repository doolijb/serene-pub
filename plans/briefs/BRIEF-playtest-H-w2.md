# BRIEF playtest-H-w2 — Back: the double-press guard and the "Back takes" words (SDK strip + header)

Lane `playtest-H` · worker 2 · supervisor reads your final message (no report file).
App: `/home/jody/github/serene-pub`. SDK: `/home/jody/github/serene-pub-sdk` (edit the SDK there).

## Goal
Item 6 of `plans/PLAN-story-playtest-fixes-2026-11-03.md` (lines 351–390), the client half. The unit Back takes does not change.

### 1. Double press — `src/lib/client/components/sessionPage/requests/rewindTurn.ts`
`rewindPresses` (`:30-35`) has no in-flight guard: a fast double click sends two `sessions:rewindTurn` and takes two turns. Add ONE pending flag shared by Back and Forward (a Back in flight also blocks a Forward, and the reverse). A press while pending sends nothing. Send through the existing `awaitReply` (`src/lib/client/utils/awaitReply.ts`) instead of the bare `socket.emit`:
```ts
awaitReply({ socket, event, params: { sessionId: id }, errorEvent: `${event}:error`,
	match: (d) => d.sessionId === id,
	matchError: (d) => (d as { sessionId?: unknown } | null)?.sessionId === id })
	.catch(() => {}) // the refusal's toast is Layout's ("sessions:rewindTurn:error" → "Could not go back")
	.finally(() => { pending = false })
```
(default 15 s timeout: a lost reply frees the press). Keep the signature `rewindPresses(socket: Pick<TypedSocket, "emit">, sessionId)` so `+page.svelte` needs no change. Update the docstring in one line (one press at a time; cleared on the reply or its `:error`). Views never call `toaster`; the one listener for the error toast is `Layout.svelte:366` — do not add a toast.
Tests in `rewindTurn.test.ts`: mock `$lib/client/sockets/interest.svelte` exactly like `src/lib/client/utils/awaitReply.test.ts:10-20` (a `handlers` map keyed by event, `declareInterest` returning a release). Cases: a double press sends one emit; after the `sessions:rewindTurn` reply for that session the next press sends again; a reply for **another** session does not clear it; the `:error` sibling clears it; Back pending blocks Forward. The existing test `"rewindPresses: one emit path…; no session id, nothing sent"` (`:39-53`) must still pass — if its two consecutive presses now collide with the guard, settle the first press with its reply in the test (keep its assertions); say so in the report.

### 2. SDK: the strip words what Back takes
- `sdk/src/sessionDossier.ts` `ConversationRewindV1` (`:370-377`): add
  ```ts
  /** 🚧 What Back would take now (playtest item 6): the rows besides the person's line, and the names on them, each once. Absent: the host did not say, or the count went stale. */
  backTakes?: { count: number; names: string[] }
  ```
  Touch nothing else in that file.
- `core-catalog/src/shared/ui/conversation/rewindStrip.ts`: `RewindPressState` gains
  `/** Back's alone, when it may be pressed: what it takes, in words — "your line and 3 replies (Ash, Birch, Narrator)". */ takes?: string`.
  In `rewindStripState`, when Back is NOT disabled and `r.backTakes` is present, `back` is `{ disabled: false, takes }`. Words, from a **non-exported** helper in the same file (`export *` re-exports this file, so an exported helper would be a new published name):
  - count 0 → `your line`
  - count 1 → `your line and 1 reply (Ash)`
  - count n → `your line and 3 replies (Ash, Birch, Narrator)`
  - names empty → no parentheses (`your line and 2 replies`). `count` truncated, never negative.
  Forward never gets `takes`. A disabled Back never gets `takes`.
- `sdk-tests/rewindStrip.test.ts`: add a `test(...)` (node:test + assert/strict, the file's style) for the cases above, plus "greyed Back (not owner, generating, a server reason) has no takes" and "no backTakes → back is exactly `{ disabled: false }`" (the existing tests must pass unchanged).
- Run only that file: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test rewindStrip.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest-H-w2-sdk.log 2>&1; echo exit=$?`. Never the SDK root `npm test` / `npm run build`; no `sdk:build` (the supervisor does that).

### 3. Header and FullscreenExit show it
`src/lib/client/components/Header.svelte:117-118` and `FullscreenExit.svelte:78-79`, `backTitle`:
```ts
rewind?.back.reason ? `Back one turn — ${rewind.back.reason}`
	: rewind?.back.takes ? `Back: ${rewind.back.takes}`
	: "Back one turn"
```
The button keeps `aria-label="Back one turn"` and its icon. In Header (`:304-315`) the sr-only description span shows `rewind.back.reason` when there is one, else `Back: ${rewind.back.takes}` when there is that, and `aria-describedby` points at it whenever either is present. No new control, no new visible text. FullscreenExit's Back is a `RowMenu` item: only its `title` changes (via `backTitle`). The phone ⋯ menu item in Header uses `backTitle` already.
⚠ `SessionHeaderRewind` lives in `src/app.d.ts:501-514`, which you do NOT own: its `back` type is `{ disabled: boolean; reason?: string }`. The page builds it as `JSON.stringify({ back: strip.back, … })` (`src/routes/sessions/[id]/+page.svelte:277`), so `takes` reaches the header at runtime with no page change. The supervisor queues the one-line type change (`back: { disabled: boolean; reason?: string; takes?: string }`) for the lead; until it lands, `svelte-check` will flag `rewind.back.takes` — expected, do not work around it with casts in the components.
DOM test: a NEW file `src/lib/client/components/headerBackTakes.dom.test.svelte.ts`. Mount `Header` the way `headerNotice.dom.test.svelte.ts:141-160` does (stub localStorage; `openSessionCtx` context) with `back: { disabled: false, takes: "your line and 3 replies (Ash, Birch, Narrator)" }` (cast the literal `as never` / via a variable — it is the type the lead will add): the Back button's `title` is `Back: your line and 3 replies (Ash, Birch, Narrator)`, its `aria-describedby` element's text is the same; with `back: { disabled: true, reason: "Wait for the reply to finish." }` the title is `Back one turn — Wait for the reply to finish.`; with neither, `Back one turn` and no `aria-describedby`. If `FullscreenExit` mounts simply (see `fullscreenExit.dom.test.svelte.ts`), add one test that its Back menu item's title carries the words; if it needs a lot of scaffolding, skip it and say so. Compare strings and booleans, never hand a DOM node to an assertion (`x === null` compared to `true`).

## Run (app)
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/components/sessionPage/requests/rewindTurn.test.ts src/lib/client/components/headerBackTakes.dom.test.svelte.ts src/lib/client/components/headerNotice.dom.test.svelte.ts src/lib/client/components/fullscreenExit.dom.test.svelte.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest-H-w2-<n>.log 2>&1; echo exit=$?'`
(If `systemd-run` is refused, `timeout 900` with the same NODE_OPTIONS.) Never pipe vitest into `head`. The two existing DOM files are run to prove they still pass; do not edit them. Then `npx prettier --check` on every file you changed (both repos; in the SDK repo run prettier from the SDK root only if it has its own config — otherwise skip and say so).

## Files owned (edit only these)
App: `src/lib/client/components/sessionPage/requests/rewindTurn.ts` · `rewindTurn.test.ts` · `src/lib/client/components/Header.svelte` · `FullscreenExit.svelte` · NEW `src/lib/client/components/headerBackTakes.dom.test.svelte.ts`.
SDK: `core-catalog/src/shared/ui/conversation/rewindStrip.ts` · `sdk/src/sessionDossier.ts` (`ConversationRewindV1` only) · `sdk-tests/rewindStrip.test.ts`.

## Out of scope — never build
`src/app.d.ts`, `+page.svelte`, `Layout.svelte`, `MessagesWidget.svelte`, server files and `src/lib/shared/sessions/rewind.ts` (worker 1). Any change to what Back takes, its label, or a new control. NOMENCLATURE.md, docs.

## Stop and ask (in your final message) when
A name beyond the ones above is needed; anything needs a file outside Files owned; an existing test must change beyond the one allowance in §1.

## Rules that apply (quoted)
- STYLE-GUIDE §10: "Sentence case everywhere" · "One name per thing … the thing you open is a session, never a chat" · "Counts live in the copy where they help".
- NOMENCLATURE §24 rewound turn: "Never say _rewind_ to a member." Member copy: **Back** · **Forward** · _2 turns ahead_.
- CLAUDE.md Sockets: "one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." Browser code: "no `crypto.randomUUID`, no `navigator.clipboard`."
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You run no sdk:build.)

## Report (your final message)
Changed files (both repos) with a one-line summary each · test commands and pass/fail counts · prettier results · anything stopped · Noticed, not done.
