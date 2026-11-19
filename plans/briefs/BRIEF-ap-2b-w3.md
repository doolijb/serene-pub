# BRIEF — worker `ap-2b-w3` — the start form sends a provided lorebook as a starter lorebook

App repo `/home/jody/github/serene-pub`. Supervisor: lane `ap-2b`. SDK is read-only. A server worker changes `sessions:create` in parallel: from now on the server refuses a live provided lorebook sent as `session.lorebookId` for a new session and takes it as `starterKit: { lorebookId }` instead (copied into the session's notes; the genre's `castFromLorebook` seats from the copy, for a provided lorebook and for every starter lorebook; picked card-less members of the provided lorebook, `castMemberIds`, are accepted and mapped to the copy). You only change the client.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: do not run one.)

The repo is staged by the lead: run **no git command that changes the index or the working tree** (`git diff` / `git status` to read are fine). Never run prettier with `--write` or pipe its output into a file. No `npm run build`, no full test run.

## Owner ruling (quoted)

2026-11-17 AP2: "Let's just clone the starter lorebook instead on session start so we are never superimposing on something that can get deleted." 2026-11-05: "Plugins can only ship lorebooks as starters." Seating reads "the attached book, else its starter copy".

## Rules (CLAUDE.md, STYLE-GUIDE)

- Comments state the rule, never history (no "now", "used to", "was", dates of change). `src/lib/shared/conformance/commentHistory.test.ts` checks it.
- **No new user-facing sentence.** For a provided lorebook the form says what it says for a starter lorebook: the existing `KIT_SESSION_NOTE` (`$lib/client/lorebooks/starterKitCards`, already imported in `StartSessionForm.svelte`). The existing confirm line `Who is in it: the world's own people` is reused.
- Views never toast. No new event. `$state(new Set())` is not reactive: use `SvelteSet`.
- New internal code name allowed: `lorebookIsProvided` (a field of `CreateSessionInput` and a `$state` on the flow class). Anything else new: stop and ask.

## Files owned (edit only these)

- `src/lib/client/components/sessionForms/createSession.svelte.ts`
- `src/lib/client/components/sessionForms/StartSessionForm.svelte`
- `src/lib/client/components/sessionForms/createSession.test.ts` (add cases)
- New DOM test `src/lib/client/components/sessionForms/startSessionProvidedBook.dom.test.svelte.ts` (copy the mocks and mount helpers of `startSessionBookSources.dom.test.svelte.ts` / `startSessionCast.dom.test.svelte.ts`)

Not yours (never edit): `EditSessionForm.svelte`, `SessionViewPanel.svelte`, the session settings form components, `shared/sockets/types.ts`, server files, docs.

## Build

1. **`CreateSessionInput`** (~459–484): `lorebookIsProvided?: boolean` with a doc line (the chosen `lorebookId` is a live provided lorebook: it is sent as `starterKit`, since a session starts from a copy of it in its notes and never reads it).
2. **`buildCreatePayload`** (~518–548): when `!input.starterKit && input.lorebookIsProvided && input.lorebookId != null`, send `session.lorebookId: null` and `starterKit: { lorebookId: input.lorebookId }`; otherwise exactly as now. `castMemberIds` travel unchanged.
3. **The flow class**: `lorebookIsProvided = $state(false)` beside `lorebookRules` (~697), with a doc line (said by the component that holds the lorebook list, like `lorebookRules`); reset to `false` wherever `lorebookRules` is reset (~1057 and any other). In the flow's payload build (~1090–1110) pass `lorebookIsProvided: this.lorebookIsProvided && (this.mode === "new" || this.mode === "new-world")` (a next chapter and a branch keep the lorebook they follow; the server reads it from the followed session). Update the `BookPickKind` doc (~566–579): a provided lorebook picked as `book` is sent as `starterKit`.
4. **`StartSessionForm.svelte`**:
   - In the `$effect` that sets `flow.lorebookRules` (~1544–1547) also set `flow.lorebookIsProvided = !!(chosenLorebook as { provided?: unknown } | null)?.provided`.
   - `seatsCastFromBook` (~438–461): true also when a starter lorebook is chosen (`flow.starterKit`), not only a `lorebookId`; update its comment to the server's rule (the attached book, else the starter copy).
   - Under each **plugin book group** (`pluginBookGroups`, two places: ~3240–3260 the book pick, ~3515–3535 the plain Lorebook card), when the chosen `flow.fields.lorebookId` is one of that group's rows, show the existing note exactly as the kit picker does: `<p class="text-surface-600-400 mt-2 text-xs" data-start-kit-note>{KIT_SESSION_NOTE}</p>`.
   - The cast picker (`memberBookId`, ~1209–1240) and the confirm line (`confirmFacts`, ~470) keep keying on `flow.fields.lorebookId`, which still holds the provided lorebook: verify they work for it and change nothing there unless a test shows otherwise.

## Tests

- `createSession.test.ts`: `buildCreatePayload` with `lorebookIsProvided: true` sends `starterKit: { lorebookId }` and `session.lorebookId: null`, keeps `castMemberIds`; with it false or absent the shape is unchanged; with a `starterKit` already set the kit wins.
- `startSessionProvidedBook.dom.test.svelte.ts`: a lorebook list with a provided row (`provided: { … }` as the list sends it; see how `startSessionBookSources.dom.test.svelte.ts` builds one): picking it shows `data-start-kit-note` with `KIT_SESSION_NOTE` under its group, and an own book shows none; Start sends `sessions:create` with `starterKit: { lorebookId: <provided id> }` and `session.lorebookId` null; for a genre declaring `castFromLorebook`, the confirm facts include `Who is in it: the world's own people` for the provided lorebook and for a chosen starter lorebook (see `startSessionApplet.dom.test.svelte.ts` for confirm facts and an applet prefill with `lorebookId`); an applet prefill naming the provided lorebook also sends it as `starterKit`.

## Done means

- Each test run as: first `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ap-2b-w3-<n>.log 2>&1"` (always at least one path; one run at a time; never pipe vitest into `head`).
- Green: `createSession.test.ts`, the new DOM test, and every `src/lib/client/components/sessionForms/startSession*.dom.test.svelte.ts`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — 0 errors in your files; `NODE_OPTIONS=--max-old-space-size=10240 npm run check` — 0 errors in your files (report warnings in them).
- `commentHistory.test.ts` (same wrapper): no finding in your files. `npx prettier --check` on changed files.

## Report

Write to `/home/jody/github/serene-pub/plans/ap-2b-w3-report.md`: changed files, tests with pass counts and log paths, assumptions, **Noticed, not done**.
