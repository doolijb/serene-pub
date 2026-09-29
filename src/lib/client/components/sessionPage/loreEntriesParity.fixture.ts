/**
 * Test fixture for core's Lore entries parity (R21): the book both copies
 * were shown, the page's answers over it, and what a copy drew, in terms the
 * native panel and the remote component share. The native panel's drawings
 * over these cases were recorded before it was deleted
 * (`remoteLoreEntries.native.json`); never imported by the app.
 */
import type { SessionEntryV1 } from "@serene-pub/sdk"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"

/* ── the book, and the server over it ─────────────────────────────────── */

const HOUR = 3600_000
const entry = (id: number, title: string, over: Partial<SessionEntryV1> = {}): SessionEntryV1 => ({
	id,
	typeId: WORLD_LORE_TYPE_ID,
	title,
	keys: [],
	off: false,
	pinned: false,
	timesJudged: 0,
	timesIncluded: 0,
	lastJudgedAt: null,
	lastIncluded: null,
	lastReason: null,
	lastRank: null,
	...over
})

/**
 * The session's lorebook as `entries:sessionEntries` reads it
 * (`server/sockets/entries.ts`). The server resolves the session's READING
 * before it pages: only rows on the session's line at its story clock are
 * listed (a fork's own rows, main's rows up to the fork cut, no history dated
 * past the clock), archived rows are out, and each listed row's title, keys
 * and marks are the line's amendments applied at that clock. `rows` here are
 * that result — the fake models the paging, search, filter and sort done over
 * it, not the reading itself (the handler's own int tests cover that).
 */
export interface Book {
	rows: SessionEntryV1[]
	lorebookId: number | null
	ownerOnly: boolean
	/** Never answer a page (the loading state). */
	silent?: boolean
	/** Refuse every mark with this. */
	refuseMarks?: string
}

export const fullBook = (): Book => ({
	lorebookId: 7,
	ownerOnly: false,
	rows: [
		entry(1, "Mira", {
			keys: ["mira", "the smith"],
			timesJudged: 4,
			timesIncluded: 3,
			lastJudgedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
			lastIncluded: true,
			lastRank: 2
		}),
		entry(2, "The Old Mill", { timesJudged: 2, timesIncluded: 0, lastIncluded: false, off: true }),
		entry(3, "", { pinned: true })
	]
})

/**
 * A widget's `session-entries` ask, in the widget's words: it searches with
 * `titleOrKey` (the request adapter maps it onto the socket's `query`, and
 * refuses a widget that sends `query` itself — so does this fake).
 */
export interface PageAsk {
	titleOrKey?: string
	sort?: "name" | "lastRead" | "timesRead" | "rank"
	filter?: "all" | "fired" | "pinned" | "off"
	offset?: number
	limit?: number
}

/** `a` before `b` with nulls last, then by id — the server's ORDER BY. */
const byThenId = <T>(key: (r: SessionEntryV1) => T | null, cmp: (a: T, b: T) => number) =>
	(a: SessionEntryV1, b: SessionEntryV1) => {
		const ka = key(a)
		const kb = key(b)
		if (ka === null && kb !== null) return 1
		if (kb === null && ka !== null) return -1
		const c = ka === null || kb === null ? 0 : cmp(ka, kb)
		return c || a.id - b.id
	}

/** The server's sort (`entries:sessionEntries`); an unnamed sort is by name. */
const ORDER: Record<string, (a: SessionEntryV1, b: SessionEntryV1) => number> = {
	lastRead: byThenId((r) => r.lastJudgedAt, (a, b) => b.localeCompare(a)),
	timesRead: byThenId((r) => r.timesIncluded, (a, b) => b - a),
	rank: byThenId((r) => r.lastRank, (a, b) => a - b),
	name: byThenId((r) => r.title.toLowerCase(), (a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** One page, answered as `answerSessionEntries` hands it to the widget. */
export function page(book: Book, ask: PageAsk) {
	if ((ask as { query?: unknown }).query !== undefined)
		throw new Error("session-entries searches with 'titleOrKey' — 'query' is not one of its words")
	const asked = ask.offset ?? 0
	// No book, or a book that is not this person's: nothing listed.
	if (book.lorebookId === null || book.ownerOnly)
		return { lorebookId: book.lorebookId, ownerOnly: book.ownerOnly, rows: [], total: 0, offset: asked }
	const q = (ask.titleOrKey ?? "").trim().toLowerCase()
	const matched = book.rows
		.filter(
			(r) =>
				// Title OR keys — a search never spans the two.
				(!q || r.title.toLowerCase().includes(q) || r.keys.join(" ").toLowerCase().includes(q)) &&
				(ask.filter === "pinned"
					? r.pinned
					: ask.filter === "off"
						? r.off
						: ask.filter === "fired"
							? // Read LAST time — not "ever read".
								r.lastIncluded === true
							: true)
		)
		.sort(ORDER[ask.sort ?? "name"] ?? ORDER.name)
	const limit = Math.min(Math.max(ask.limit ?? 50, 1), 200)
	// A page past the end is the last real page, never "no entries".
	const offset =
		asked > 0 && asked >= matched.length
			? matched.length
				? Math.floor((matched.length - 1) / limit) * limit
				: 0
			: asked
	return {
		lorebookId: book.lorebookId,
		ownerOnly: false,
		rows: matched.slice(offset, offset + limit),
		total: matched.length,
		offset
	}
}

export function mark(book: Book, ask: { entryId: number; off?: boolean; pinned?: boolean }) {
	if (book.refuseMarks) throw new Error(book.refuseMarks)
	const r = book.rows.find((x) => x.id === ask.entryId)!
	if (ask.off !== undefined) r.off = ask.off
	if (ask.pinned !== undefined) r.pinned = ask.pinned
	return { off: r.off, pinned: r.pinned }
}

/* ── what each drew ───────────────────────────────────────────────────── */

export const text = (n: Element | null | undefined) => (n?.textContent ?? "").replace(/\s+/g, " ").trim()
/** Relative times, normalised: the two copies drew them a moment apart. */
const ago = (s: string) => s.replace(/just now|\d+[mhd] ago/g, "<ago>")

/** The panel as a person meets it, in terms both copies share. */
export type Drawn = ReturnType<typeof drawn>

export function drawn(root: Element) {
	const search = root.querySelector<HTMLInputElement>("input:not([type='radio'])")
	const radios = [...root.querySelectorAll("[role='radiogroup'] > *")].map((r) => {
		const input = r.querySelector<HTMLInputElement>("input[type='radio']")
		return {
			label: text(r),
			checked: input ? input.checked : r.getAttribute("aria-checked") === "true"
		}
	})
	const select = root.querySelector("select")
	const combobox = root.querySelector("sp-combobox")
	const options = select
		? [...select.querySelectorAll("option")].map((o) => [o.getAttribute("value"), text(o)])
		: [...root.querySelectorAll("sp-option")].map((o) => [o.getAttribute("value"), text(o)])
	const button = (b: Element) => ({
		label: b.getAttribute("aria-label") ?? text(b),
		pressed: b.getAttribute("aria-pressed"),
		title: b.getAttribute("title"),
		disabled: b.hasAttribute("disabled")
	})
	const list = root.querySelector("ul[aria-label='Lore entries']")
	return {
		message: text(root.querySelector("p:not([role='alert'])")) || null,
		search: search ? { placeholder: search.getAttribute("placeholder"), label: text(search.closest("label")) } : null,
		radiogroup: root.querySelector("[role='radiogroup']")?.getAttribute("aria-label") ?? null,
		radios,
		sort: select ? { value: select.value, options } : combobox ? { value: combobox.getAttribute("value"), options } : null,
		rows: list
			? [...list.children].map((li) => ({
					text: ago(text(li)),
					struck: li.hasAttribute("data-off"),
					buttons: [...li.querySelectorAll("button")].map(button)
				}))
			: null,
		buttons: [...root.querySelectorAll("button")]
			.filter((b) => !b.closest("li") && !b.closest("[role='radiogroup']"))
			.map(button),
		pager: ago(text(root.querySelector("ul[aria-label='Lore entries'] + div")))
	}
}

/* ── the cases ─────────────────────────────────────────────────────────── */

/** A step a person takes on the panel, named so either copy can take it. */
export type Step = { check: "all" | "fired" | "pinned" | "off" } | { click: "Next" | "Pin Mira" }

export interface ParityCase {
	book: Book
	settings: Record<string, unknown>
	step?: Step
}

/** Every case, by name — the recording's keys. */
export const PARITY_CASES: Record<string, () => ParityCase> = {
	"a paged list": () => ({ book: fullBook(), settings: { pageSize: 2 } }),
	"the whole list, sorted by rank": () => ({ book: fullBook(), settings: { sort: "rank" } }),
	"an empty book": () => ({ book: { ...fullBook(), rows: [] }, settings: {} }),
	"a book that is its owner's alone (a guest's view)": () => ({ book: { ...fullBook(), ownerOnly: true }, settings: {} }),
	"a session with no lorebook": () => ({ book: { ...fullBook(), lorebookId: null, rows: [] }, settings: {} }),
	"loading: nothing answered yet": () => ({ book: { ...fullBook(), silent: true }, settings: {} }),
	"the Off filter": () => ({ book: fullBook(), settings: {}, step: { check: "off" } }),
	"a filter that matches nothing": () => ({
		book: { ...fullBook(), rows: fullBook().rows.filter((r) => !r.off) },
		settings: {},
		step: { check: "off" }
	}),
	"the next page": () => ({ book: fullBook(), settings: { pageSize: 2 }, step: { click: "Next" } }),
	"a mark set": () => ({ book: fullBook(), settings: {}, step: { click: "Pin Mira" } }),
	"a refused mark": () => ({
		book: { ...fullBook(), refuseMarks: "only the book's owner may mark its entries" },
		settings: {},
		step: { click: "Pin Mira" }
	})
}

/** The button a click step names: by its accessible label, or its text. */
export const buttonNamed = (root: Element, name: string) =>
	[...root.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? text(b)) === name)!
