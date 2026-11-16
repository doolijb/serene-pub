# BRIEF — `perf-N` worker 3 — the conversation dossier keeps its reference while a reasoning reply streams

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal and evidence

The widget wire now skips a scoped section by **reference** (`postChangedFrom`, `src/lib/client/components/frames/widgetWire.svelte.ts`):
the same object as last delivered is neither serialised nor posted. The session page's conversation dossier
(`session_full`) is built by `projectConversationDossier` (`src/lib/client/components/sessionPage/sessionPageProjections.ts:627`),
run inside a `$derived` in `envelopeSections.svelte.ts:74` (not yours) and handed to every conversation mount.

Measured on the real page (200 rows, 3 conversation mounts, 50 streamed frames):
- content-only frames: the dossier keeps its reference → 0 `session_full` serialisations;
- frames that also stream **reasoning**: 150 serialisations of a 48.8 KB dossier (55 ms per 50 frames), **0 posts** —
  the content never changed. Cause: a reasoning delta replaces the generating row's `metadata` cell
  (`sessionStore.applyMessageDelta`, `src/lib/client/sessions/store/sessionStore.svelte.ts:300-318`), and the per-line
  cache key in the projection reads `m.metadata?.…` (`sessionPageProjections.ts:~761-780`), so the derived reruns and
  builds a new, equal dossier object every frame.

Make `projectConversationDossier` hand back **the previous dossier object** when a rerun builds content equal to it,
and a new object whenever anything differs.

## The change (exact)

In `sessionPageProjections.ts` only:

1. A module-level `const lastDossier = new WeakMap<DossierLineCache, ConversationDossierV1>()` beside
   `DossierLineCache` (`:575`), with a one-line doc comment: the dossier last handed out per line cache (one cache per
   page), returned again when a rerun builds the same content. Keyed by the cache the caller already passes, so the
   signature and `envelopeSections.svelte.ts` do not change.
2. A small **unexported** helper `samePlainData(a: unknown, b: unknown): boolean` — structural equality for JSON-shaped
   data: `Object.is` → true; both arrays → same length and every element `samePlainData`; both plain objects
   (`Object.getPrototypeOf(x)` is `Object.prototype` or `null`) → same own-key count, every key of `a` own in `b`, every
   value `samePlainData`; anything else (Set, Map, Date, class instance, function) → false unless identical. A key
   present with `undefined` and a missing key are **different** (structured clone keeps the difference). Stop at the
   first difference.
3. At the end of `projectConversationDossier`, build the object into `const next: ConversationDossierV1 = { …unchanged… }`,
   then `const prev = lastDossier.get(lineCache); if (prev && samePlainData(prev, next)) return prev;
   lastDossier.set(lineCache, next); return next`. The object literal's fields are unchanged, byte for byte.
4. A comment at that return saying why (the reasoning-frame cause above, in two or three lines) and the contract it keeps:
   the same object is returned only when its content is equal, so a widget misses nothing; an object embedded by
   reference that someone mutated in place would be missed — the page's owners replace (`sessionFrames`,
   `storyCalendar`, `lorebookAnnexView` are assigned, never mutated).

Nothing else in the file changes. No new export, option or name visible outside the file.

## Test — new `src/lib/client/components/sessionPage/conversationDossier.identity.dom.test.svelte.ts`

- Use a real `createSessionStore()` and compose the session the way the page does
  (`sessionPageData.svelte.ts:99-104`: `{ ...record, ...cast, sessionMessages: rows }` from `store.session(id)`,
  `store.messagesOf(id)`, `store.castOf(id)`). Load ~40 rows with the last one generating — copy the payload and
  loading steps from `src/lib/client/sessions/store/sessionStore.streaming.dom.test.svelte.ts` (and
  `sessionStore.delta.dom.test.svelte.ts` for `applyMessageDelta`).
- Stub the rest of `DossierSources` minimally (read the function body for every field it dereferences: e.g.
  `data.getMessageCharacter`, `canControlMessage`, `canRerunMessage`, `offersWrite`, `userPersonasInSession: []`,
  `sessionChannels`, `actions.sessionActions: []`, `composerMenuActions`, `paletteActions`, `scenes.sceneList: []`,
  `stateStore.ledgerFor/pendingFor/ledgerHead/pending`, `composer.composerTray`, `remoteFaces.face/landed`,
  `snapshot: (v) => $state.snapshot(v)`). Cast the stub `as never` where the real types are page objects.
- Inside `$effect.root`, `const dossier = $derived.by(() => { runs++; return projectConversationDossier(src, cache) })`.
- Cases (each asserts both the rerun count and the reference):
  1. 50 content-only deltas (`reasoning: null`) → `runs` does not move, same reference (the baseline perf-F built).
  2. 50 deltas with a `reasoning` string → `runs` moves (prove the derived reruns) **and** `dossier` stays the very first
     reference.
  3. One real change → a new reference with the change in it: the settle (`upsertMessage` of the row with
     `isGenerating: false`) → `lines[id]` differs; and a session change the dossier reads (e.g. `patchSession` of a
     field the projection reads — `settledLine`, `composerStates`, or `lorebookId` for the composer tabs; read the
     body) → new reference with the new value.
  4. After a change, the new object is the one held: a further equal rerun returns the new object, not the old.
  5. `samePlainData` is not exported — test it through the projection only. One case where a field's content changes
     but the rows don't (e.g. `userCtx.user.isAdmin` with `contextDebuggingEnabled` → `debugPrompts`) → new reference.
- Log the counts (`console.log`) for the report.

## Files owned (edit only these)

- `src/lib/client/components/sessionPage/sessionPageProjections.ts` — only the three additions above.
- new `src/lib/client/components/sessionPage/conversationDossier.identity.dom.test.svelte.ts`

## Files readable

Anything under `src/`. Not yours to edit: `envelopeSections.svelte.ts`, `sessionStore.svelte.ts`, `sessionPageData.svelte.ts`.

## Rules (quoted from the lane brief and CLAUDE.md)

- P1: "a skipped post is one whose value is identical; a missed real change is a bug, not a saving. Tests prove both
  directions for every section touched."
- Svelte 5: "`$effect`/`$derived` reruns on any tracked read; use `untrack` deliberately and say why in a comment;
  `$state(new Map())` is not reactive." (The `WeakMap` here is a memo no reader tracks — say so in its comment.)
- "NOMENCLATURE §24/§25 for any new name" — you add none visible outside the file; if you think you need one, stop.
- "Changing what any section carries" is out of scope: the dossier's content must be byte-identical to before.

## Commands

- Tests, capped: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>` from `/home/jody/github/serene-pub`.
  Run your new file, then `src/lib/client/components/sessionPage/` whole (name any failure that is pre-existing by
  reading its assertion — `narrateDraft.dom.test.ts` C2 is a known baseline failure).
- `npx tsc --noEmit -p .` filtered: `| grep -E "sessionPageProjections|conversationDossier.identity"`.
- Prettier: `npx prettier --check` on the new test file (must pass; `--write` it is fine, it is new).
  `sessionPageProjections.ts` is unclean at HEAD: format your own lines by hand, never `--write` it.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

Never pipe vitest into `head`. Run int and dom tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`.

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`. Never `prettier --write` a file that was unclean at HEAD.

## Stop and ask when

CLAUDE.md §Decisions applies; case 2 shows the reference still moving with `samePlainData` in place (report which
top-level field differs between two consecutive equal-looking builds — e.g. a non-plain object rebuilt each time — and
stop; do not widen the equality to make it pass); you would need another file.

## Done means

The two files; cases 1–5 green; `sessionPage/` dom tests green apart from named baselines; `tsc` clean on both files;
prettier as above.

## Report

Final message: changed files; rerun and reference counts per case; any field that defeated the equality; test counts.
Nothing written to disk as a report.
