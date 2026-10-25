/**
 * 🚧 The one rewind / generating / book derivation over the session store's records
 * (pr-6s2 G3). Pure.
 */
import { rewindStateWith, type RewindState } from "$lib/shared/sessions/rewind"
import type { SessionMessageRecord, SessionRecord, SessionRunRecord } from "./records"

/** 🚧 The book a session writes its story to and reads it from: its attached lorebook, else its own book (pr-6 B §B-3: every
 *  session has one). Null only for a session the boot pass has not reached. (The plan's `bookOf`.) */
export function sessionBookOf(
	row: { lorebookId?: number | null; ownBookId?: number | null } | null | undefined
): number | null {
	return row?.lorebookId ?? row?.ownBookId ?? null
}

/** 🚧 Back · Forward · Regenerate's state — the ONE computation (audit R4/D8): `rewindStateWith(record, rows)`; null without a record. */
export function rewindOf(
	record: SessionRecord | undefined,
	rows: readonly SessionMessageRecord[]
): RewindState | null {
	return record ? rewindStateWith(record, rows) : null
}

/** 🚧 The session is busy, as every press reads it: its newest held row is generating, or a run the host's door waits on is
 *  in flight — a run whose kind (`RunKind`, on every `sessions:runStatus` frame) is `reply` or `action`. A `routine` or
 *  `maintenance` run never makes the session busy here (the door still counts a routine: owner's open question, F option (a)). */
export function generatingOf(
	rows: readonly { isGenerating?: boolean | null }[],
	runs: readonly SessionRunRecord[]
): boolean {
	return !!rows.at(-1)?.isGenerating || runs.some((r) => r.kind === "reply" || r.kind === "action")
}

/** 🚧 The book lock as the page reads it: the server's word (`lorebookFixed`), or a held line that is not a greeting. */
export function lorebookFixedOf(
	record: SessionRecord | undefined,
	rows: readonly SessionMessageRecord[]
): boolean {
	if (!record) return false
	return (
		!!(record as { lorebookFixed?: boolean }).lorebookFixed ||
		rows.some((m) => (m.metadata as { isGreeting?: boolean } | null)?.isGreeting !== true)
	)
}

/** 🚧 The session's own story clock as a key: "" when it follows its line, else JSON of `{ year, month, day }`. */
export function storyClockKeyOf(record: SessionRecord | undefined): string {
	const r = record as
		| { storyClockYear?: number | null; storyClockMonth?: number | null; storyClockDay?: number | null }
		| undefined
	return r?.storyClockYear != null
		? JSON.stringify({ year: r.storyClockYear, month: r.storyClockMonth ?? null, day: r.storyClockDay ?? null })
		: ""
}
