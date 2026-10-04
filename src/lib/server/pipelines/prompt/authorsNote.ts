/**
 * 🚧 The session's **author's note** (2026-10-02, AN1): reading a genre's
 * stored `authorsNote` value, and placing it among the messages a prompt
 * carries.
 *
 * Beside `postHistory.ts`, and separate from it. The two blocks do
 * different jobs and are decided differently — the post-history reminder is
 * the pipeline's and the card's "how to respond", held back by a token
 * trigger; the note is the person's "what is true now", with no trigger and an
 * `interval` instead — so folding one into the other would hand the note the
 * reminder's trigger and authorship. What they share is the **index
 * arithmetic**, and that is the same expression here as there (and as
 * `resolveInjections`'): depth 0 is the seed placeholder's own iteration,
 * depth N lands N real messages earlier, clamped to the top.
 *
 * Nothing here renders. The template says where the note goes
 * (`{{#with ../authorsNote}}` in the Default template, before the injections
 * and the post-history block); this module only decides `targetIndex` and
 * whether it goes at all.
 */

import type { ProcessedSessionMessage } from "$lib/server/pipelines/prompt/contentProcessors"
import type {
	AuthorsNoteDiag,
	AuthorsNoteTemplateContext
} from "$lib/server/pipelines/prompt/promptTypes"

/**
 * Where a note goes when its `depth` was never set: **0, the end** — right
 * after the newest message, before the reply, where the post-history reminder
 * goes too (owner ruling 2026-10-03; it was 4). `AUTHORS_NOTE_FIELD`'s
 * declared default says the same, and a session that stored a depth keeps it.
 */
export const AUTHORS_NOTE_DEPTH_DEFAULT = 0

/** The value a session stores, read whole — what `AUTHORS_NOTE_FIELD` declares. */
export interface AuthorsNoteValue {
	text: string
	depth: number
	interval: number
	role: "system" | "user" | "assistant"
}

const whole = (v: unknown, floor: number, fallback: number): number => {
	const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
	return typeof n === "number" && Number.isFinite(n)
		? Math.max(floor, Math.floor(n))
		: fallback
}

/**
 * A genre field's stored value, read as an author's note — or null when it is
 * not one.
 *
 * ⚠ **An object only.** A plugin genre may declare a field it calls
 * `authorsNote` as plain text (the Writing Room does, and its own prompts
 * interpolate `{{authorsNote}}`); that is its vocabulary, and core's
 * resolution leaves it alone rather than guessing a depth for it. Missing keys
 * take the field's declared defaults (depth 0, interval 1, role system), and
 * numbers a form posted as text are read as numbers.
 */
export function readAuthorsNoteValue(value: unknown): AuthorsNoteValue | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null
	const v = value as Record<string, unknown>
	return {
		text: typeof v.text === "string" ? v.text : "",
		depth: whole(v.depth, 0, AUTHORS_NOTE_DEPTH_DEFAULT),
		interval: whole(v.interval, 1, 1),
		role:
			v.role === "user" || v.role === "assistant" ? v.role : "system"
	}
}

/**
 * Place the note, and decide whether this reply carries it.
 *
 * `replyCount` is the session's AI replies before this one (the cast read's
 * `replyCount`); the note goes in when it is a multiple of `interval`, so the
 * first reply carries it and, at an interval of 3, so do the fourth and the
 * seventh. Absent (no count supplied), every reply is one of them.
 */
export function resolveAuthorsNoteContext({
	renderMessages,
	note,
	replyCount
}: {
	/** [...sessionMessages].reverse() — oldest-first, seed placeholder last. */
	renderMessages: readonly ProcessedSessionMessage[] | readonly unknown[]
	/** The note, its text already interpolated. */
	note: AuthorsNoteValue
	replyCount: number | undefined
}): { authorsNote: AuthorsNoteTemplateContext; diagnostics: AuthorsNoteDiag } {
	const targetIndex = Math.max(0, renderMessages.length - 1 - note.depth)
	const count = whole(replyCount, 0, 0)
	const hasText = note.text.trim().length > 0
	const onInterval = count % note.interval === 0
	const included = hasText && onInterval
	return {
		authorsNote: {
			targetIndex,
			...(included ? { text: note.text } : {}),
			role: note.role,
			hasContent: included
		},
		diagnostics: {
			included,
			reason: !hasText ? "empty" : !onInterval ? "interval" : "included",
			depth: note.depth,
			interval: note.interval,
			replyCount: count,
			targetIndex,
			role: note.role
		}
	}
}
