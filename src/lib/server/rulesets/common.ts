/**
 * 🚧 What the ruleset handler's modules share (audit C3, 2026-10-17): one
 * slot-reference normaliser, one compendium row lookup, one unit → minutes,
 * one story-date reading, one lore-entry read, the render depths and the
 * byte-stable string order. Each existed two to four times, and the copies
 * had started to disagree (a row's metadata stripped in one reader and not
 * another; `health` reaching `hp` only inside the Dungeon Crawler's scripts).
 */

import { inArray } from "drizzle-orm"
import { getRuleset, type CompendiumRow, type RenderDepth, type RulesetDecl, type StoryTime } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"

/** The render depths, shallowest first. */
export const DEPTHS: readonly RenderDepth[] = ["index", "summary", "full"]

/** Code-unit order — never the locale's, so the same state renders the same bytes everywhere. */
export const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

// ── Slot references ─────────────────────────────────────────────────────────

/**
 * A slot as a model or a script names it, reduced to the bare key a sheet
 * files it under: lower-cased, its `<namespace>:slot/` prefix and `@<n>`
 * version gone, spaces as dashes — `core:slot/HP@1`, `hp` and `HP` are one.
 */
export function normaliseSlotRef(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/^[a-z0-9_-]+:slot\//, "")
		.replace(/@\d+$/, "")
		.replace(/\s+/g, "-")
}

/**
 * The slot among `slots` a reference names: by id, by bare key, or by its
 * label — the alias table is the owner's own labels (`Health` → `hp`,
 * `Class` → `character-class`), so a ruleset's words reach its slots without
 * a hand-kept list. The first match in that order wins.
 */
export function slotNamed<S extends { slotId: string; label: string; selector?: string }>(
	slots: readonly S[],
	raw: unknown
): S | undefined {
	if (typeof raw !== "string" || !raw.trim()) return undefined
	const want = normaliseSlotRef(raw)
	return (
		slots.find((s) => s.slotId === raw.trim()) ??
		slots.find((s) => normaliseSlotRef(s.slotId) === want || (s.selector !== undefined && s.selector === want)) ??
		slots.find((s) => normaliseSlotRef(s.label) === want)
	)
}

// ── Compendium rows ─────────────────────────────────────────────────────────

/** A compendium row found: the repertoire it is filed under, the row, and its piece's props. */
export interface CompendiumRowFound {
	repertoireId: string
	row: CompendiumRow
	/** The row's piece (`row.piece`) — its bookkeeping is nested apart since 2026-10-17. */
	props: Record<string, unknown>
}

/**
 * The one compendium lookup: the row `ref` names in `ruleset` (a
 * declaration or a ruleset id) — by its id, else by its piece's name in any
 * case (a model names a row as it reads it) — searched in `repertoireId`
 * when given, else every repertoire. 🚧 Row ids are unique within their
 * repertoire only (P2-5, the 100-turn walk's B17: Vis Itineris's spell
 * _Shield_ and armour _Shield_), so a reader that knows the field a piece is
 * held in passes its repertoire, falling back to every repertoire for a piece
 * kept in a field that names none. Undefined when the ruleset is not
 * installed or holds no such row.
 */
export function compendiumRow(
	ruleset: RulesetDecl | string | undefined,
	ref: string,
	repertoireId?: string
): CompendiumRowFound | undefined {
	const decl = typeof ruleset === "string" ? getRuleset(ruleset) : ruleset
	const rows = decl?.compendium?.rows ?? {}
	const lists = repertoireId !== undefined ? [[repertoireId, rows[repertoireId] ?? []] as const] : Object.entries(rows)
	const want = ref.trim().toLowerCase()
	const found = (match: (r: CompendiumRow) => boolean): CompendiumRowFound | undefined => {
		for (const [rep, list] of lists) {
			const row = list.find(match)
			if (row) return { repertoireId: rep, row, props: { ...(row.piece as unknown as Record<string, unknown>) } }
		}
		return undefined
	}
	const nameOf = (r: CompendiumRow): unknown => (r.piece as { name?: unknown } | undefined)?.name
	return (
		found((r) => r.id === ref || r.id === want) ??
		found((r) => {
			const n = nameOf(r)
			return typeof n === "string" && n.toLowerCase() === want
		})
	)
}

// ── Time ────────────────────────────────────────────────────────────────────

/**
 * Story minutes in one `unit` — the one conversion every reader uses (a
 * round is `roundSeconds`, six when unsaid). Null for a unit no clock counts
 * (`scene`, `turn`, `until-removed`…).
 */
export function minutesPer(unit: string | undefined, roundSeconds = 6): number | null {
	switch (unit) {
		case "round":
			return roundSeconds / 60
		case "minute":
			return 1
		case "hour":
			return 60
		case "day":
			return 1440
		default:
			return null
	}
}

/** `'412-03-05 22:30'` (date parts and time each optional below the year) → the story time it names, or null. */
export function parseAtTime(at: string): StoryTime | null {
	const m = /^\s*(-?\d+)(?:-(\d{1,2}))?(?:-(\d{1,2}))?(?:[ T](\d{1,2}):(\d{2}))?\s*$/.exec(at)
	if (!m) return null
	return {
		year: Number(m[1]),
		...(m[2] ? { month: Number(m[2]) } : {}),
		...(m[3] ? { day: Number(m[3]) } : {}),
		...(m[4] ? { hour: Number(m[4]), minute: Number(m[5]) } : {})
	}
}

// ── Lore entries ────────────────────────────────────────────────────────────

/** A lore entry as a piece reads it. */
export interface EntryText {
	title: string
	content: string
}

/** The lore entries `ids` name, in one query — the title and the text a lore piece reads. */
export async function loreEntriesById(db: any, ids: Iterable<number>): Promise<Map<number, EntryText>> {
	const want = [...new Set(ids)]
	const out = new Map<number, EntryText>()
	if (!want.length) return out
	const rows = await db
		.select({ id: schema.lorebookEntries.id, title: schema.lorebookEntries.title, content: schema.lorebookEntries.content })
		.from(schema.lorebookEntries)
		.where(inArray(schema.lorebookEntries.id, want))
	for (const r of rows as { id: number; title: string | null; content: string | null }[])
		out.set(r.id, { title: r.title ?? "", content: r.content ?? "" })
	return out
}
