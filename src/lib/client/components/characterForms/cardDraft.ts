/**
 * The card editor's greetings and creator notes between the draft and the
 * wire. The wire still speaks the columns (`firstMessage`,
 * `alternateGreetings`, `groupOnlyGreetings`; `creatorNotes`,
 * `creatorNotesMultilingual`); the draft holds ONE greetings list and the
 * notes as `{text, lang, variants}`. Pure.
 *
 * `notesColumnsOf` is the client's twin of the server's `cardNotesColumns`
 * (server/characters/cardIO.ts) — read, not imported.
 */
import {
	creatorNotesOf,
	legacyGreetingsOf,
	mergeGreetings,
	type CharacterGreeting
} from "$lib/shared/characters/profile"

/** One other-language row of the notes editor. */
export interface NoteLanguageRow {
	lang: string
	text: string
}

/** The notes as the draft holds them. */
export interface NotesDraft {
	creatorNotes: string
	/** The main text's language code; empty: not said. */
	creatorNotesLang: string
	creatorNotesVariants: NoteLanguageRow[]
}

/** The greetings list from a card's three columns. */
export function greetingsOfColumns(card: {
	firstMessage?: string | null
	alternateGreetings?: readonly unknown[] | null
	groupOnlyGreetings?: readonly unknown[] | null
}): CharacterGreeting[] {
	return mergeGreetings(
		card.firstMessage,
		card.alternateGreetings,
		card.groupOnlyGreetings
	)
}

/** The three greeting columns from the draft's list, as the form sent them before (the opener `""` when none). */
export function greetingColumnsOf(greetings: readonly CharacterGreeting[]): {
	firstMessage: string
	alternateGreetings: string[]
	groupOnlyGreetings: string[]
} {
	const legacy = legacyGreetingsOf(greetings)
	return { ...legacy, firstMessage: legacy.firstMessage ?? "" }
}

/** Index of the first greeting not marked group-only (the opener), or -1. */
export function openerIndex(greetings: readonly CharacterGreeting[]): number {
	return greetings.findIndex((g) => !g.groupOnly)
}

/**
 * The opener's text edited alone (the simplified form): into the first
 * unmarked greeting, or a new first greeting. A lone opener emptied is
 * removed, as an empty opener loads as none.
 */
export function withOpenerText(
	greetings: readonly CharacterGreeting[],
	text: string
): CharacterGreeting[] {
	const next = greetings.map((g) => ({ ...g }))
	const at = openerIndex(next)
	if (at < 0) return text ? [{ text }, ...next] : next
	if (!text && next.filter((g) => !g.groupOnly).length === 1) {
		next.splice(at, 1)
		return next
	}
	next[at] = { ...next[at], text }
	return next
}

/** The notes draft from a card's two columns. */
export function notesDraftOf(card: {
	creatorNotes?: string | null
	creatorNotesMultilingual?: Record<string, unknown> | null
}): NotesDraft {
	const notes = creatorNotesOf(
		card.creatorNotes,
		card.creatorNotesMultilingual
	)
	return {
		creatorNotes: notes?.text ?? "",
		creatorNotesLang: notes?.lang ?? "",
		creatorNotesVariants: Object.entries(notes?.variants ?? {}).map(
			([lang, text]) => ({ lang, text })
		)
	}
}

const code = (value: string) => value.trim().toLowerCase()

/** The language codes the draft names, empty rows dropped, trimmed and lower-cased. */
function variantRows(draft: NotesDraft): NoteLanguageRow[] {
	return draft.creatorNotesVariants
		.map((r) => ({ lang: code(r.lang), text: r.text }))
		.filter((r) => r.lang)
}

/** A sentence when one language code is named twice (the main one counts); else null. */
export function noteLanguageProblem(draft: NotesDraft): string | null {
	const seen = new Set<string>()
	const main = code(draft.creatorNotesLang)
	if (main) seen.add(main)
	for (const row of variantRows(draft)) {
		if (seen.has(row.lang)) return `Language "${row.lang}" is named twice.`
		seen.add(row.lang)
	}
	return null
}

/**
 * The notes as the two columns: the main text, and every language's text (the
 * main one under its code, when it has text). Empty: `""` and `{}`, as the form
 * sent them before.
 */
export function notesColumnsOf(draft: NotesDraft): {
	creatorNotes: string
	creatorNotesMultilingual: Record<string, string>
} {
	const main = code(draft.creatorNotesLang)
	const multilingual: Record<string, string> = {}
	if (main && draft.creatorNotes) multilingual[main] = draft.creatorNotes
	for (const row of variantRows(draft)) multilingual[row.lang] = row.text
	return {
		creatorNotes: draft.creatorNotes,
		creatorNotesMultilingual: multilingual
	}
}
