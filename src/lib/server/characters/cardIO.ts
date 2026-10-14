/**
 * A chara card's strokes and extensions, in and out (DESIGN-card-strokes
 * §A.6) — the pure half of card import and export.
 *
 * ## Out
 *
 * `characters.extensions` is the starting point, so whatever another tool put
 * on the card leaves with it; Serene Pub overlays only its own keys. Keyword
 * strokes become `character_book.entries[]`, one each, AFTER any entries the
 * card's own lorebook exports — a reader that knows no strokes still gets the
 * conditional prose, in the slot the spec made for it.
 *
 * ## In
 *
 * `extensions.serenepub.strokes` wins when present. Else the card is the
 * legacy shape — never auto-split — unless its `character_book` is **small and
 * plain** (`plainBookStrokes`): then its entries become keyword strokes beside
 * the card's own prose as two whole `always` strokes, and the book is not
 * offered as a lorebook. Every decision is a summary line a person reads.
 *
 * Strokes paused (`STROKES_ENABLED` off, 2026-10-11): import keeps the prose
 * and holds every book; export writes no stroke entries and no
 * `serenepub.strokes`. Extensions and the dowry are not gated.
 *
 * Pure: no database, no socket.
 */

import { STROKE_LIMITS, type CardDowry, type Stroke } from "@serene-pub/sdk"
import {
	applyStrokesToCard,
	strokeCompiledText,
	StrokesRefused
} from "$lib/server/characters/strokes"
import { STROKES_ENABLED } from "$lib/shared/characters/strokesFlag"
import {
	likenessFromCardExtensions,
	readLikeness,
	withLikeness
} from "$lib/server/characters/likeness"

/** The ceiling on a card's foreign extension JSON kept on the row. */
export const CARD_EXTENSIONS_MAX_BYTES = 256 * 1024

/** "Small and plain" (A.9 #1, ruled 2026-10-11). */
export const PLAIN_BOOK_LIMITS = Object.freeze({
	maxEntries: 24,
	maxContentChars: 600
} as const)

// ── Export ──────────────────────────────────────────────────────────────────

/** One `character_book` entry made from a keyword stroke. */
export interface StrokeBookEntry {
	id: number
	keys: string[]
	name: string
	content: string
	enabled: true
	constant: false
	insertion_order: number
	use_regex: boolean
	case_sensitive?: boolean
	extensions: { serenepub: { stroke: string | number } }
}

/**
 * The keyword strokes as book entries, numbered from `firstId`. Off strokes
 * and `always` strokes are not conditional and never reach the book.
 */
export function strokeBookEntries(
	strokes: readonly Stroke[] | null | undefined,
	firstId = 1
): StrokeBookEntry[] {
	const out: StrokeBookEntry[] = []
	for (const [index, stroke] of (strokes ?? []).entries()) {
		if (stroke.when.mode !== "keywords") continue
		const content = strokeCompiledText(stroke)
		if (!content) continue
		const name =
			stroke.label?.trim() || stroke.slug || stroke.text.trim().slice(0, 40)
		out.push({
			id: firstId + out.length,
			keys: [...stroke.when.keys],
			name,
			content,
			enabled: true,
			constant: false,
			insertion_order: 100 + out.length,
			use_regex: stroke.when.matchMode === "regex",
			...(stroke.when.caseSensitive !== undefined
				? { case_sensitive: stroke.when.caseSensitive }
				: {}),
			extensions: { serenepub: { stroke: stroke.slug ?? index } }
		})
	}
	return out
}

/**
 * The card's `character_book`: its own lorebook's entries (ids kept — a
 * lorebook export's graph may name them), then one entry per keyword stroke,
 * numbered after the highest id the book already uses. Undefined when there
 * is neither.
 */
export function mergeStrokeBook(
	book: Record<string, any> | undefined,
	strokes: readonly Stroke[] | null | undefined,
	cardName: string
): Record<string, any> | undefined {
	const bookEntries: any[] = Array.isArray(book?.entries) ? book!.entries : []
	const highest = bookEntries.reduce(
		(max, e) => (typeof e?.id === "number" && e.id > max ? e.id : max),
		bookEntries.length
	)
	// Strokes paused: no stroke reaches the book; the card's own book as is.
	if (!STROKES_ENABLED) return book
	const fromStrokes = strokeBookEntries(strokes, highest + 1)
	if (!fromStrokes.length) return book
	if (!book) return { name: cardName, extensions: {}, entries: fromStrokes }
	return { ...book, entries: [...bookEntries, ...fromStrokes] }
}

/** What `buildCharacterCardV3` lays over the stored extensions. */
export interface CardExtensionOverlay {
	depth_prompt: { prompt: string; depth: number; role: string }
	source?: string[]
	group_only_greetings?: string[]
	serenepub: Record<string, unknown>
}

/** The exported `extensions`: Serene Pub's keys typed, everything else as it came. */
export type ExportedExtensions = Record<string, any> & {
	depth_prompt: CardExtensionOverlay["depth_prompt"] | Record<string, unknown>
	source?: string[]
	group_only_greetings?: string[]
	serenepub: Record<string, any>
}

/**
 * The exported `extensions`: the stored ones (foreign keys verbatim), with
 * Serene Pub's own keys laid over. A stored `serenepub` is never trusted — it
 * is rebuilt from the row. `depth_prompt` has no column here, so a stored
 * one (from the card that was imported) is kept unless the input says
 * otherwise.
 */
export function exportedExtensions(
	stored: Record<string, unknown> | null | undefined,
	overlay: CardExtensionOverlay,
	explicitDepthPrompt: boolean
): ExportedExtensions {
	const { serenepub: _old, ...foreign } =
		stored && typeof stored === "object" && !Array.isArray(stored)
			? stored
			: ({} as Record<string, unknown>)
	const out = { ...foreign } as ExportedExtensions
	if (explicitDepthPrompt || !isPlainObject(foreign.depth_prompt))
		out.depth_prompt = overlay.depth_prompt
	if (overlay.source) out.source = overlay.source
	if (overlay.group_only_greetings)
		out.group_only_greetings = overlay.group_only_greetings
	out.serenepub = overlay.serenepub
	// 🚧 The likeness (DESIGN-image-generation §5) has no column: the stored
	// `serenepub.likeness` IS the row's value, so it is the one stored
	// `serenepub` key carried out — sanitized, never trusted as written.
	const likeness = readLikeness(stored)
	if (likeness && out.serenepub.likeness === undefined)
		out.serenepub = { ...out.serenepub, likeness }
	return out
}

/** `serenepub.strokes` / `serenepub.dowry`, each only when it has something in it. */
export function serenepubStrokesAndDowry(
	strokes: readonly Stroke[] | null | undefined,
	dowry: CardDowry | null | undefined
): { strokes?: Stroke[]; dowry?: CardDowry } {
	return {
		// Strokes paused: the export carries no `serenepub.strokes`.
		...(STROKES_ENABLED && strokes && strokes.length
			? { strokes: [...strokes] }
			: {}),
		...(dowry ? { dowry } : {})
	}
}

// ── Import ──────────────────────────────────────────────────────────────────

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/** A book's entries, the legacy object-keyed shape included. */
export function bookEntriesOf(book: unknown): any[] {
	const entries = (book as any)?.entries
	if (Array.isArray(entries)) return entries
	if (isPlainObject(entries)) return Object.values(entries)
	return []
}

/** True for an entry that `strokeBookEntries` wrote. */
export const isStrokeBookEntry = (entry: unknown): boolean =>
	isPlainObject((entry as any)?.extensions?.serenepub) &&
	(entry as any).extensions.serenepub.stroke !== undefined

const PLAIN_POSITIONS = new Set(["before_char", "after_char"])

/**
 * Why a book is NOT small and plain, or null when it is. Each rule is the
 * ruled one (A.6): ≤ 24 entries, each ≤ 600 chars, no selective/secondary
 * keys, not constant, placed before/after the card or not at all, and keyed.
 * A disabled entry also makes a book not plain: a stroke has no "keyed but
 * off" state to land it in without losing its keys.
 */
export function plainBookRefusal(book: unknown): string | null {
	const entries = bookEntriesOf(book)
	const L = PLAIN_BOOK_LIMITS
	if (!entries.length) return "it has no entries"
	// A Serene Pub lorebook export (its container or an entry says so) is a
	// lorebook somebody chose to send with the card — never strokes.
	if (
		isPlainObject((book as any)?.extensions?.serenepub) ||
		entries.some(
			(e) => isPlainObject(e?.extensions?.serenepub) && !isStrokeBookEntry(e)
		)
	)
		return "it is a Serene Pub lorebook"
	if (entries.length > L.maxEntries)
		return `it has ${entries.length} entries (more than ${L.maxEntries})`
	for (const e of entries) {
		if (!isPlainObject(e)) return "an entry is not readable"
		if (typeof e.content !== "string" || !e.content.trim())
			return "an entry has no text"
		if (e.content.length > L.maxContentChars)
			return `an entry is longer than ${L.maxContentChars} characters`
		// Postgres keeps no NUL in text or jsonb. A stroke holding one would
		// refuse the whole character row; held as a book, only the book fails.
		if (e.content.includes("\u0000") || (Array.isArray(e.keys) && e.keys.some((k: unknown) => typeof k === "string" && k.includes("\u0000"))))
			return "an entry holds a byte the database refuses"
		if (e.selective) return "an entry uses secondary keys"
		if (Array.isArray(e.secondary_keys) && e.secondary_keys.some((k: unknown) => typeof k === "string" && k.trim()))
			return "an entry uses secondary keys"
		if (e.constant) return "an entry is always on"
		if (e.enabled === false) return "an entry is switched off"
		if (e.position !== undefined && e.position !== null && !PLAIN_POSITIONS.has(e.position as string))
			return "an entry is placed somewhere other than before or after the card"
		const stPosition = (e.extensions as any)?.position
		if (typeof stPosition === "number" && stPosition !== 0 && stPosition !== 1)
			return "an entry is placed somewhere other than before or after the card"
		const keys = Array.isArray(e.keys) ? e.keys.filter((k: unknown) => typeof k === "string" && k.trim()) : []
		if (!keys.length) return "an entry has no keys"
	}
	return null
}

/**
 * The card's own prose as whole `always` strokes, then one keyword stroke per
 * book entry. Never a split: description and personality each stay one piece.
 */
export function plainBookStrokes(
	book: unknown,
	description: string,
	personality: string | null
): Stroke[] {
	const strokes: Stroke[] = []
	if (description.trim())
		strokes.push({ kind: "description", text: description, when: { mode: "always" } })
	if (personality?.trim())
		strokes.push({ kind: "personality", text: personality, when: { mode: "always" } })
	for (const e of bookEntriesOf(book)) {
		const name = typeof e.name === "string" ? e.name.trim() : ""
		const label = name && name.length <= STROKE_LIMITS.maxLabelChars ? name : undefined
		let text: string = e.content.trim()
		// Our own export writes `Label: text` (the compile); take the label back off.
		if (label && text.startsWith(`${label}: `)) text = text.slice(label.length + 2).trim()
		strokes.push({
			kind: "description",
			...(label ? { label } : {}),
			text,
			when: {
				mode: "keywords",
				keys: (e.keys as unknown[])
					.filter((k): k is string => typeof k === "string" && !!k.trim())
					.map((k) => k.trim()),
				...(e.use_regex ? { matchMode: "regex" as const } : {}),
				...(e.case_sensitive === true ? { caseSensitive: true } : {})
			}
		})
	}
	return strokes
}

/** What a card's import decided about its strokes, book and extensions. */
export interface CardImportPlan {
	/** Spread into the `characters` row: strokes, the compiled prose, extensions. */
	fields: {
		strokes: Stroke[]
		description: string
		personality: string | null
		extensions: Record<string, unknown>
	}
	/**
	 * The card's book: `none` — there is none; `strokes` — it became keyword
	 * strokes and is not offered; `held` — offered as a lorebook, as before.
	 * With Serene Pub strokes, the entries the strokes made are not "the book"
	 * — `heldBook` is what is left after they are taken out.
	 */
	book: "none" | "strokes" | "held"
	/** The book to offer when `book` is `held`. */
	heldBook?: Record<string, unknown>
	/** `extensions.serenepub.dowry`, unvalidated — `importCardDowry` judges it. */
	dowry?: unknown
	/** What a person reads, one line each. */
	summary: string[]
}

/**
 * Decide a card's strokes, book and extensions from its parsed V3 `data`.
 * `book` overrides `data.character_book` (the parser's book, which also reads
 * V1 cards' top-level one).
 */
export function planCardImport(data: any, book?: unknown): CardImportPlan {
	const summary: string[] = []
	const description: string = typeof data?.description === "string" ? data.description : ""
	const personality: string | null =
		typeof data?.personality === "string" && data.personality ? data.personality : null
	const ext = isPlainObject(data?.extensions) ? data.extensions : {}
	const serenepub = isPlainObject(ext.serenepub) ? ext.serenepub : undefined
	const theBook = book ?? data?.character_book
	const hasBook = bookEntriesOf(theBook).length > 0

	let strokes: Stroke[] = []
	let compiled = { description, personality }
	let bookFate: CardImportPlan["book"] = hasBook ? "held" : "none"
	let heldBook: Record<string, unknown> | undefined = hasBook
		? (theBook as Record<string, unknown>)
		: undefined

	const incoming = serenepub?.strokes
	if (!STROKES_ENABLED) {
		// Strokes paused: the card imports as its prose, `serenepub.strokes`
		// is ignored and no book becomes strokes — every embedded book is
		// held as a lorebook, as before strokes. The one exception is the
		// entries another install's strokes wrote into the book: their text
		// is already in the compiled prose, so holding them would say it
		// twice.
		if (hasBook && Array.isArray(incoming) && incoming.length > 0) {
			const rest = bookEntriesOf(theBook).filter((e) => !isStrokeBookEntry(e))
			if (rest.length) heldBook = { ...(theBook as object), entries: rest }
			else {
				bookFate = "none"
				heldBook = undefined
			}
		}
	} else if (Array.isArray(incoming) && incoming.length > 0) {
		try {
			const applied = applyStrokesToCard({ strokes: incoming as Stroke[], description, personality })
			strokes = applied.strokes ?? []
			compiled = { description: applied.description ?? "", personality: applied.personality ?? null }
			// The entries the strokes wrote are the strokes; what is left is the card's lorebook.
			if (hasBook) {
				const rest = bookEntriesOf(theBook).filter((e) => !isStrokeBookEntry(e))
				if (rest.length) heldBook = { ...(theBook as object), entries: rest }
				else {
					bookFate = "none"
					heldBook = undefined
				}
			}
		} catch (e) {
			if (!(e instanceof StrokesRefused)) throw e
			summary.push(
				`The card's strokes could not be read (${e.message}), so it was imported with its description and personality as written.`
			)
		}
	} else if (hasBook) {
		const n = bookEntriesOf(theBook).length
		const why = plainBookRefusal(theBook)
		let refused = why
		if (!why) {
			try {
				const made = plainBookStrokes(theBook, description, personality)
				const applied = applyStrokesToCard({ strokes: made, description, personality })
				strokes = applied.strokes ?? []
				compiled = { description: applied.description ?? "", personality: applied.personality ?? null }
				bookFate = "strokes"
				heldBook = undefined
				summary.push(
					`The card's lorebook was small and plain, so its ${n} ${n === 1 ? "entry became a keyword stroke" : "entries became keyword strokes"} on the card instead of a separate lorebook.`
				)
			} catch (e) {
				if (!(e instanceof StrokesRefused)) throw e
				refused = e.message
			}
		}
		if (refused)
			summary.push(
				`The card's lorebook (${n} ${n === 1 ? "entry" : "entries"}) is offered as a lorebook rather than as strokes: ${refused}.`
			)
	}

	const { serenepub: _sp, ...foreign } = ext
	let extensions: Record<string, unknown> = foreign
	const bytes = Buffer.byteLength(JSON.stringify(foreign))
	if (bytes > CARD_EXTENSIONS_MAX_BYTES) {
		extensions = {}
		summary.push(
			`The card's data from other apps is ${Math.ceil(bytes / 1024)} KiB, over the ${CARD_EXTENSIONS_MAX_BYTES / 1024} KiB kept, so it was left out; exporting this character will not include it.`
		)
	}
	// 🚧 The likeness — ours, else SillyTavern's `sd_character_prompt` read
	// into prompt and negative (R5, one direction). Kept under our own key on
	// the row; ST's key, when the card had one, stays a foreign key as written.
	const likeness = likenessFromCardExtensions(ext)
	if (likeness) extensions = withLikeness(extensions, likeness)

	return {
		fields: { strokes, ...compiled, extensions },
		book: bookFate,
		...(heldBook ? { heldBook } : {}),
		...(serenepub?.dowry !== undefined && serenepub?.dowry !== null
			? { dowry: serenepub.dowry }
			: {}),
		summary
	}
}
