# BRIEF — vn-C-w1: the reading place and the reading pace (pure modules)

Supervisor: lane `vn-C`. Repo: **`/home/jody/github/serene-pub-sdk`** (the SDK). Plan: `/home/jody/github/serene-pub/plans/PLAN-visual-novel-layout-2026-11-11.md` §1.2 and §1.3 (read both; they are the behaviour you implement).

Context: a new core widget, the **Dialogue box** (`dialogue-box`), shows the story one line at a time. A later worker builds the Svelte component; you build the two **pure** modules it calls, and their unit tests. No Svelte, no DOM, no timers, no `Date.now()` inside the functions (time is always a parameter).

## Goal

### 1. `core-catalog/src/shared/ui/conversation/readingPlace.ts` (new)

The **reading place** is a message id, client-only. Rows are the widget's rows in host order (oldest first; ids ascend).

```ts
/** The fields of a row the reading place reads (a `MessageV1` satisfies it). */
export interface ReadingRow {
	id: number
	role?: string
	characterId?: number | null
	personaId?: number | null
	castMemberId?: number | null
	isNarratorResponse?: boolean
	isGenerating?: boolean
	metadata?: unknown
}

/**
 * A row a reader stops at: a line a character, a person, the narrator or an envoy spoke,
 * or a row being written. A change line or a marker is passed over.
 */
export function isReadLine(row: ReadingRow): boolean

/** The place after the rows (or the viewer's own newest id) changed. */
export function settlePlace(rows: readonly ReadingRow[], place: number | null, ownId?: number | null): number | null

/** **Next line**: one row on, then the passing rule. */
export function nextLinePlace(rows: readonly ReadingRow[], place: number | null, ownId?: number | null): number | null

export interface QueuedSummary {
	/** Finished read lines after the place. */
	lines: number
	/** Distinct speaker names of those lines, in order; empty when any of them has no name. */
	repliedBy: string[]
	/** A read line after the place is being written: its speaker's name, `''` when it has none; null when none is. */
	writing: string | null
}
export function queuedSummary(rows: readonly ReadingRow[], place: number | null, nameOf: (row: ReadingRow) => string | null): QueuedSummary

/** What the reading bar says about what waits; null when nothing does. */
export function queuedText(summary: QueuedSummary): string | null
```

Rules, exactly:

- **`isReadLine`**: `false` when `metadata.tableLine === true`, or `metadata.anchorMessageId != null`, or `role === 'system'`. Otherwise `true` when `isGenerating`, `isNarratorResponse`, `characterId != null`, `personaId != null`, `castMemberId != null`, `metadata.speaker` is a string starting `envoy:`, or `role === 'user'`. Otherwise `false`. Read `metadata` defensively (it is `unknown`).
- **`settlePlace`**: rows empty → `null`. Then:
  1. `place === null` → the newest row's id (mount: "Opening a session starts at the newest line").
  2. `place` no longer among the rows (removed by Back or delete) → the greatest remaining id ≤ `place`; if none, the newest.
  3. **Catching up:** `ownId` not null/undefined, `ownId > place`, and `ownId` is one of `rows`' ids → the place jumps to `ownId`. (An own id that is not one of these rows — another channel's row — never moves the place.)
  4. **Passing rule:** while a row follows the place and the row at the place is the viewer's own line (`row.id === ownId`) or `!isReadLine(row)`, move to the next row. Otherwise hold.
- **`nextLinePlace`**: place not among rows (or null) → `settlePlace(rows, place, ownId)`. Place is the newest → unchanged. Else move one row on, then apply the passing rule (step 4 only — no catching up).
- **`queuedSummary`**: consider the rows after the place (all rows when the place is null? — no: null place means nothing is queued; return `{ lines: 0, repliedBy: [], writing: null }`). Among those, only `isReadLine` rows. `writing` is the name of the first one with `isGenerating` (`nameOf(row) ?? ''`), else null. `lines` counts the ones not generating; `repliedBy` their distinct `nameOf` values in order, `[]` if any of them returns null or `''`.
- **`queuedText`**: parts, joined with `' · '`; `null` when no part.
  - `lines > 0`: if `repliedBy.length === lines` and `lines <= 2` → `'Osk has replied'` (one) or `'Osk and Bren have replied'` (two); else `'1 more line'` / `'3 more lines'`.
  - `writing !== null`: `'Osk is writing…'` (the `…` character, U+2026), or `'Writing…'` when `writing === ''`.

### 2. `core-catalog/src/shared/ui/conversation/index.ts` — one line

Add `export * from './readingPlace.js'` at the end, with a one-line `// 🚧` comment in the file's style ("the Dialogue box's reading place (PLAN-visual-novel-layout §1.2)"). This is the only edit to that file.

### 3. `core-catalog/components/shared/messages/readingPace.ts` (new, beside `spokenLine.ts`)

Read `spokenLine.ts` first; follow its style (types only from `@serene-pub/sdk/component`; a file-head doc comment). This file is **new**: do not edit `spokenLine.ts` or any other file in `messages/`.

```ts
export type LineSpeechPhase = 'none' | 'awaiting' | 'speaking' | 'ready' | 'playing' | 'paused' | 'ended' | 'blocked'
/** The last thing the shown line's player said: from its `play`, `pause` and `ended` events. */
export type HeardPlayback = 'none' | 'playing' | 'paused' | 'ended' | 'refused'

/** The never-before grace after a line settles: its speech marker is written just after. */
export const SETTLE_GRACE_MS = 1_500
/** A speech marker older than this with no audio counts as no voice. */
export const STALE_MARKER_MS = 90_000
/** Audio there but no `play` heard this long after it was seen: the browser did not start it. */
export const AUTOPLAY_START_GRACE_MS = 5_000

export function heardAfter(prev: HeardPlayback, event: 'play' | 'pause' | 'ended'): HeardPlayback

export interface LineSpeechFacts {
	readAloud: 'off' | 'make' | 'play'
	playback: 'auto' | 'click' | 'never'
	/** The pub can speak (`dossier.speech?.canSpeak !== false`). */
	canSpeak: boolean
	/** A live speak run's marker time (`metadata.spoken.pending.at`), null when no run is live. */
	pendingAt: string | null
	/** The line has its spoken audio. */
	hasAudio: boolean
	/** When the widget first saw the line holding audio (ms), null while it has none. */
	audioSeenAt: number | null
	heard: HeardPlayback
	/** When the widget saw the line stop generating (ms); null while it is still generating. */
	settledAt: number | null
	now: number
}
export function lineSpeechPhase(f: LineSpeechFacts): LineSpeechPhase

/** How long a line stays when it has no voice: its words at `wordsPerMinute`, never under 1.5 s. */
export function readingTimeMs(text: string, wordsPerMinute: number): number

export interface ReadOnFacts {
	phase: LineSpeechPhase
	/** A row waits after the place. */
	queued: boolean
	/** The bar's **Pause** is pressed. */
	held: boolean
	/** When the reading timer counts from: the moment the line was shown, or the moment Pause was released. */
	timerFrom: number
	settledAt: number | null
	readingMs: number
	now: number
}
export interface ReadOnState {
	/** Move to the next line now. */
	due: boolean
	/** The reading timer the progress bar fills over (ms); null when none runs. */
	timer: { elapsed: number; total: number } | null
}
export function readOnState(f: ReadOnFacts): ReadOnState
```

Rules, exactly:

- **`heardAfter`**: `play` → `'playing'`. `ended` → `'ended'`. `pause`: from `'playing'` → `'paused'`; from `'ended'` → `'ended'`; from `'paused'` → `'paused'`; from `'none'` or `'refused'` → `'refused'` (the host answers a play the browser refuses with a `pause` event and no `play` — `sdk/src/hostElements.ts`, the `audio` entry). Note: a media element fires `pause` and then `ended` when it plays through, so `paused` → `ended` must work.
- **`lineSpeechPhase`**, checks in this order:
  1. not (`readAloud === 'play'` and `playback === 'auto'` and `canSpeak`) → `'none'` (no automatic voice).
  2. `heard`: `'ended'` → `'ended'`; `'playing'` → `'playing'`; `'paused'` → `'paused'`; `'refused'` → `'blocked'`.
  3. `hasAudio`: `audioSeenAt !== null && now - audioSeenAt >= AUTOPLAY_START_GRACE_MS` → `'blocked'`, else `'ready'`.
  4. `pendingAt !== null`: if `Date.parse(pendingAt)` is finite and `now - it > STALE_MARKER_MS` → `'none'`; else `'speaking'`.
  5. `settledAt === null` → `'awaiting'`; `now < settledAt + SETTLE_GRACE_MS` → `'awaiting'`; else `'none'` (no marker arrived, or it cleared with no audio).
- **`readingTimeMs`**: words = whitespace-separated non-empty tokens of `text`. `wordsPerMinute` not finite → 220; clamp to 80–600. Result `Math.max(1500, Math.round(words / wpm * 60_000))`.
- **`readOnState`**:
  - `!queued || held` → `{ due: false, timer: null }`.
  - phase `'ended'` → `{ due: true, timer: null }`.
  - phase `'none'` or `'blocked'`: `endAt = Math.max(timerFrom + readingMs, (settledAt ?? now) + SETTLE_GRACE_MS)`; `total = endAt - timerFrom`; `elapsed = Math.min(Math.max(now - timerFrom, 0), total)`; `due = settledAt !== null && now >= endAt`; `timer = { elapsed, total }`.
  - any other phase → `{ due: false, timer: null }` (voice coming or playing waits; a user pause holds).

## Tests (new files)

- `sdk-tests/readingPlace.test.ts` — import from `'../core-catalog/src/shared/ui/conversation/readingPlace.js'`. `node:test` + `node:assert/strict`, as `sdk-tests/spokenLine.test.ts` does. Cover at least: mount at the newest; **hold after a character line** (new rows queue); **queue** summary texts (one name, two names, the same speaker twice → `2 more lines`, a nameless line → `n more lines`, writing with and without a name, both parts joined); **Next line** shows the next one and stops at the newest; **change lines pass** (a table line / anchored row / system row after the place is passed while a row follows it; a trailing one is held); **the viewer's own line passes**; **catching up** (own id greater than the place jumps then passes to the first reply; a held place behind several lines jumps over them); **another channel's own line does not catch up** (own id not among the rows); **removed row** (greatest remaining ≤, else the newest); **no own id** (null and undefined); empty rows → null; `isReadLine` table.
- `sdk-tests/readingPace.test.ts` — import from `'../core-catalog/components/shared/messages/readingPace.js'`. Table tests for `heardAfter`, every `lineSpeechPhase` branch (including the stale 90 s marker and an unparsable `pendingAt`), `readingTimeMs` (empty text → 1500, clamp low/high, non-finite speed), and `readOnState` (not queued, held, ended, none before settle + 1.5 s, none after the reading time, blocked, playing/paused/speaking/awaiting wait, timer elapsed clamped).

## Files owned

Only: `core-catalog/src/shared/ui/conversation/readingPlace.ts` (new), the one line in `core-catalog/src/shared/ui/conversation/index.ts`, `core-catalog/components/shared/messages/readingPace.ts` (new), `sdk-tests/readingPlace.test.ts` (new), `sdk-tests/readingPace.test.ts` (new).

## Files readable

Anything. Useful: `core-catalog/components/shared/messages/spokenLine.ts`, `sdk-tests/spokenLine.test.ts`, `core-catalog/src/shared/ui/conversation/messageSpeaker.ts`, `sdk/src/hostElements.ts` (the `audio` entry).

## Out of scope

Any other file. No Svelte. No new exported names beyond those listed above (a private helper inside a file is fine). Do not touch `spokenLine.ts` or any other file under `messages/`.

## Stop and ask when

A rule above contradicts the plan or the code; you think a new exported name, setting or behaviour is needed; anything outside the files above would need to change. Write it in your report instead of deciding.

## Done means

```
cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test readingPlace.test.ts readingPace.test.ts; echo test-exit=$?
cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p . 2>&1 | grep -E "readingPlace|readingPace|conversation/index" ; echo tsc-done
npx prettier --check <each file you wrote>
```
All tests pass; no tsc error in your files (report any other tsc errors you see without fixing them — other lanes have uncommitted work); prettier clean or, if the repo's own neighbours are not prettier-clean either, say so.

## Report

Return in your final message: files changed, the test command output summary (pass/fail counts), any rule you could not follow and why, and **Noticed, not done**.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You never run `sdk:build` in this task.)
- Never `git checkout`, `restore` or `clean` in either repo. Never run `prettier --write` on a directory.
- Never pipe a test run into `head`.
- It is a **session**, never a *chat*.
- Scratch files start with `vn-C-`.
