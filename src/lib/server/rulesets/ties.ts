/**
 * 🚧 **Ties on the lorebook graph** — the host's half (PLAN-rulesets-functions
 * "Ties on the graph", owner rulings T1–T5, GO 2026-10-23; SDK `ties.ts`).
 *
 * A tie's numbers live on the **held** relational entry, one per side (T1);
 * the lorebook graph keeps the words, as a projection of the fields that
 * **read onto the lorebook** (T2). Nothing is stored twice:
 *
 *  · **One writer** (`writeLandings`, T2): whatever lands — a held tie side's
 *    field, a held thing's field, an attribute — is written onto the column
 *    it reads onto wherever its owner lives, through the outlet that wrote
 *    the value, never from a function (R8). The tie is one instance: its
 *    "where it lives" is its relationship row (the side's own perspective
 *    row on a two-sided tie), found by its `edge`, else by its ends, else made.
 *  · **One history** (T3): the held entry owns the truth; the row's words are
 *    written in place and carry the run that wrote them
 *    (`narrative_relationships.rules_run_id`). How the row changed is read
 *    back from those runs' receipts (`tieHistory`), never a second versioned
 *    source.
 *  · **Both ways, one owner** (T4): a tie drawn on the lorebook makes the
 *    held sides (`drawTieSides`, one per side); a function adding a side makes
 *    the row (a landing with no row yet); a deleted row retires its held
 *    sides (`retireTieSides`) — and never the reverse.
 *  · **Shared with the model per field** (T5): the ruleset's voice and the
 *    retrieval arm read each field's `modelShare` — words on, the number off
 *    — through `tieWordsFor` / `tieShareForRows`.
 *
 * Where a write lands follows the session's routing rule
 * (`loreWriteTargetFor`): the attached book when its owner may write it at
 * Full, else the session's own notes — where a tie row of the book is
 * overlaid by the notes' own copy, which the session then reads; 🚧 and
 * (★5, lane T3) a held thing's or a place's field and a cast member's state
 * by the notes' **rule-fed overlay** (`ruleFedOverlayOf`), which the
 * session's readers lay over the book's (the lore read, the graph's cast).
 * 🚧 (sense-b4) Whatever the route, an entry or a row that lives in the
 * session's own book is an own-book landing: written there directly, forking no line.
 */

import { and, desc, eq, inArray, or, sql } from "drizzle-orm"
import {
	getRuleset,
	i18nText,
	modelShareOf,
	tieSidesOf,
	ZONE_HOLDS_ANY,
	type FieldDecl,
	type ReadsOnto,
	type RulesetDecl,
	type RulesetEntryTypeDecl,
	type ZoneTypeDecl
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { StateOwner } from "$lib/server/state/owners"
import { loadSeatMap, memberFormOf, storedSeatOwner, storedSeatRef, type SeatMap } from "$lib/server/state/seatRefs"
import { memberFormOn } from "$lib/server/state/memberForm"
import { cardsNow } from "$lib/server/cast/seatedCast"
import { memberAsRead } from "$lib/server/cast/memberAsRead"
import { seatOf } from "$lib/server/sessions/seats"
import { attributeSlotsOf, sectionsOf } from "./functionRun"
import {
	CARRIED,
	entryTypesOf,
	fieldsOf,
	writeZones,
	zonesFor,
	zoneTypesOf,
	type ZoneWrite
} from "./zones"
import type { EngineInput, ZoneEntry } from "./types"
import type { ImprintAnchor } from "$lib/server/lorebooks/imprints"

type Db = any

// ── Reading ─────────────────────────────────────────────────────────────────

/** A ruleset's ties: its relational entry types that say their far end, by id. */
export function tieTypesOf(ruleset: object): Map<string, RulesetEntryTypeDecl> {
	return new Map(
		[...entryTypesOf(ruleset)].filter(
			([, e]) => tieSidesOf(e) !== undefined
		)
	)
}

/** The field of an entry type that reads onto a column, or null. */
export function fieldOnto(
	e: RulesetEntryTypeDecl,
	target: ReadsOnto
): string | null {
	for (const [field, t] of Object.entries(e.readsOnto ?? {}))
		if (t === target) return field
	return null
}

/** A field's words, as a person reads its label. */
const fieldLabel = (e: RulesetEntryTypeDecl, field: string): string =>
	i18nText((fieldsOf(e)[field] as FieldDecl | undefined)?.label) ?? field

/** Whether a field holds a number. */
const isNumberField = (e: RulesetEntryTypeDecl, field: string): boolean => {
	const t = (fieldsOf(e)[field] as FieldDecl | undefined)?.type
	return t === "integer" || t === "number"
}

/** The words a tie's row is typed by when no field says: the entry type's own name. */
const typeWords = (e: RulesetEntryTypeDecl): string =>
	(i18nText(e.name) ?? e.id).toLowerCase()

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)
const edgeOf = (e: ZoneEntry): number | null => {
	const n = Number(e.fields.edge)
	return Number.isSafeInteger(n) && n > 0 ? n : null
}

// ── What lands (pure) ───────────────────────────────────────────────────────

/** One column a landing writes: the field it reads from, its new value and what it held. */
export interface LandedColumn {
	target: ReadsOnto
	field: string
	value: unknown
	was: unknown
}

/**
 * 🚧 What lands on the lorebook from one held entry (T2): a **tie** side
 * (its row's columns, `made` when the side is new), or a **held** thing
 * (its source entry's fields). `index` addresses the entry in its zone write,
 * so a row made for a side can be stamped back as its `edge`.
 */
export interface LoreLanding {
	kind: "tie" | "held"
	ownerKey: string
	zoneType: string
	index: number
	entry: ZoneEntry
	entryType: string
	columns: LandedColumn[]
	/** Every field that moved, numbers too — what the receipt tells (T3). */
	moved: Record<string, { from: unknown; to: unknown }>
	made: boolean
	note?: string
}

/** The held entry a written one was before, if it was held. */
function before(
	prev: readonly ZoneEntry[],
	e: ZoneEntry,
	tie: boolean
): ZoneEntry | undefined {
	if (tie)
		return prev.find(
			(p) =>
				p.entryType === e.entryType &&
				p.fields.towards === e.fields.towards
		)
	return prev.find(
		(p) =>
			p.entryType === e.entryType &&
			(e.entryId != null ? p.entryId === e.entryId : p.name === e.name)
	)
}

/**
 * 🚧 What a moment's zone writes land on the lorebook (pure, T2/T4): every
 * written tie side that is new (its row is made, or found) or whose fields
 * reading onto the lorebook moved, and every held thing whose such fields
 * moved. Nothing for a ruleset that says no tie and reads nothing onto the
 * lorebook.
 */
export function landingsOf(
	input: Pick<EngineInput, "ruleset" | "zones">,
	writes: readonly ZoneWrite[]
): LoreLanding[] {
	const types = entryTypesOf(input.ruleset)
	const out: LoreLanding[] = []
	for (const w of writes) {
		const prev = input.zones?.[w.ownerKey]?.[w.zoneType] ?? []
		w.entries.forEach((e, index) => {
			const decl = types.get(e.entryType)
			if (!decl) return
			const tie = tieSidesOf(decl) !== undefined
			if (!tie && !decl.readsOnto) return
			const was = before(prev, e, tie)
			const moved: Record<string, { from: unknown; to: unknown }> = {}
			for (const k of new Set([
				...Object.keys(e.fields),
				...Object.keys(was?.fields ?? {})
			]))
				if (
					k !== "edge" &&
					k !== "towards" &&
					JSON.stringify(e.fields[k]) !==
						JSON.stringify(was?.fields[k])
				)
					moved[k] = { from: was?.fields[k], to: e.fields[k] }
			const columns: LandedColumn[] = []
			for (const [field, target] of Object.entries(decl.readsOnto ?? {}))
				if (!was || field in moved)
					columns.push({
						target,
						field,
						value: e.fields[field],
						was: was?.fields[field]
					})
			const made = tie && (!was || edgeOf(e) === null)
			if (!columns.length && !made) return
			if (!tie && e.entryId == null) return
			out.push({
				kind: tie ? "tie" : "held",
				ownerKey: w.ownerKey,
				zoneType: w.zoneType,
				index,
				entry: e,
				entryType: e.entryType,
				columns,
				moved,
				made,
				...(w.note ? { note: w.note } : {})
			})
		})
	}
	return out
}

// ── Where it lives ──────────────────────────────────────────────────────────

/** The session facts a landing is routed by. */
interface Routing {
	sessionId: number
	books: number[]
	attachedId: number | null
	/** 🚧 The session's own book; an entry or row living there is an own-book landing. */
	ownBookId: number | null
	target: { route: "book" | "own-book"; lorebookId: number }
}

async function routingOf(
	db: Db,
	sessionId: number,
	anchorMessageId: number | null
): Promise<Routing> {
	const { lorebooksReadBy, loreWriteTargetFor } = await import(
		"$lib/server/lorebooks/ownBook"
	)
	// Routed only: a branch session's line forks inside the transaction of the
	// write that makes a row (`rowForSide`), after its checks.
	const t = await loreWriteTargetFor(db, sessionId, {
		anchorMessageId,
		fork: false
	})
	const books = await lorebooksReadBy(db, sessionId)
	// No line is read here: a first write to the book forks its own, so
	// `rowForSide` takes the line `ensureSessionLine` answers for the row it makes.
	const ids = books.ids.includes(t.lorebookId)
		? books.ids
		: [...books.ids, t.lorebookId]
	return {
		sessionId,
		books: ids,
		attachedId: books.attachedId,
		ownBookId: books.ownBookId,
		target: { route: t.route, lorebookId: t.lorebookId }
	}
}

/** One end of a relationship row, from an owner key: a cast member's binding, or an entry. */
type End =
	| { nodeId: number; entryId?: undefined }
	| { entryId: number; nodeId?: undefined }

async function endOf(db: Db, key: string, r: Routing): Promise<End | null> {
	// 🚧 ⏳ Flip on (`memberForm.ts`): a `seated-member:<M>` end *is* the binding `M` (no card lookup); a `player-seat:<S>` end is its seat's member, else its card's binding. `character:` ends (stray rows) read as before.
	if (memberFormOn() && typeof key === "string") {
		const sm = /^seated-member:(\d+)$/.exec(key.trim())
		if (sm) {
			const [b] = await db
				.select({ id: schema.lorebookBindings.id })
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, Number(sm[1])))
				.limit(1)
			return b ? { nodeId: b.id } : null
		}
		if (/^player-seat:\d+$/.test(key.trim())) {
			const seat = await seatOf(db, r.sessionId, key.trim())
			if (seat?.castMemberId != null) return endOf(db, `seated-member:${seat.castMemberId}`, r)
			return seat?.cardId != null ? endOf(db, `character:${seat.cardId}`, r) : null
		}
	}
	// 🚧 A `seated-member:<id>` end reads as its seat's stored key (plan §27 S2); a member with no seat is on no row.
	const stored = typeof key === "string" && key.trim().startsWith("seated-member:") ? await storedSeatRef(db, r.sessionId, key) : key
	if (stored === null) return null
	const m = /^(character|location|entry):(\d+)$/.exec(String(stored))
	if (!m) return null
	const id = Number(m[2])
	if (m[1] === "character") {
		const rows = await db
			.select({
				id: schema.lorebookBindings.id,
				lorebookId: schema.lorebookBindings.lorebookId
			})
			.from(schema.lorebookBindings)
			.where(
				and(
					eq(schema.lorebookBindings.characterId, id),
					inArray(schema.lorebookBindings.lorebookId, r.books)
				)
			)
		// The book a row is written to first, then the attached one, then any the session reads.
		const pick =
			rows.find(
				(b: { lorebookId: number }) =>
					b.lorebookId === r.target.lorebookId
			) ??
			rows.find(
				(b: { lorebookId: number }) => b.lorebookId === r.attachedId
			) ??
			rows[0]
		return pick ? { nodeId: pick.id } : null
	}
	const [entry] = await db
		.select({ id: schema.lorebookEntries.id })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, id))
		.limit(1)
	return entry ? { entryId: entry.id } : null
}

const endColumns = (from: End, to: End) => ({
	fromNodeId: from.nodeId ?? null,
	fromEntryId: from.entryId ?? null,
	toNodeId: to.nodeId ?? null,
	toEntryId: to.entryId ?? null
})

const R = schema.narrativeRelationships

/**
 * The relationship row a tie side reads onto (T4): its `edge` when that row
 * stands in a book the session reads, else the active row between its ends
 * (its own perspective on a two-sided tie), the book written to first. A row
 * of a book the session may not write is overlaid by the notes' own copy;
 * none at all, and one is made. Null when an end is in no book.
 */
async function rowForSide(
	db: Db,
	r: Routing,
	landing: LoreLanding,
	decl: RulesetEntryTypeDecl,
	runId: string | null,
	anchor: ImprintAnchor | null = null
): Promise<
	{ id: number; made: boolean; overlaid: boolean } | { skipped: string }
> {
	const side = landing.entry.sideOwner ?? landing.ownerKey
	const towards =
		typeof landing.entry.fields.towards === "string"
			? landing.entry.fields.towards
			: ""
	let found: typeof R.$inferSelect | undefined
	const edge = edgeOf(landing.entry)
	if (edge !== null) {
		;[found] = await db
			.select()
			.from(R)
			.where(and(eq(R.id, edge), inArray(R.lorebookId, r.books)))
			.limit(1)
	}
	let ends: [End, End] | null = null
	const endsOf = async (): Promise<[End, End] | null> => {
		if (ends) return ends
		const a = await endOf(db, side, r)
		const b = towards ? await endOf(db, towards, r) : null
		return a && b ? (ends = [a, b]) : null
	}
	if (!found) {
		const e = await endsOf()
		if (!e)
			return {
				skipped: `${side} → ${towards || "nobody"} is not on the lorebook, so the tie has no row`
			}
		const c = endColumns(e[0], e[1])
		const rows = await db
			.select()
			.from(R)
			.where(
				and(
					inArray(R.lorebookId, r.books),
					eq(R.status, "active"),
					c.fromNodeId != null
						? eq(R.fromNodeId, c.fromNodeId)
						: eq(R.fromEntryId, c.fromEntryId!),
					c.toNodeId != null
						? eq(R.toNodeId, c.toNodeId)
						: eq(R.toEntryId, c.toEntryId!)
				)
			)
			.orderBy(desc(R.id))
		found =
			rows.find(
				(x: { lorebookId: number }) =>
					x.lorebookId === r.target.lorebookId
			) ?? rows[0]
	}
	const words = (target: ReadsOnto): string | undefined => {
		const f = fieldOnto(decl, target)
		const v = f ? landing.entry.fields[f] : undefined
		return typeof v === "string" && v.trim() ? v.trim() : undefined
	}
	// 🚧 A tie made in the notes for a room that has since been applied: both its
	// entry ends are the lorebook's now and this session writes the lorebook, so
	// the tie follows the room there (made on the lorebook, the notes' row gone).
	// Without this the lorebook's room never gets its tie.
	let retire: number | null = null
	if (found && found.lorebookId === r.ownBookId && r.target.route === "book") {
		const ends = [found.fromEntryId, found.toEntryId].filter((x): x is number => x != null)
		if (ends.length) {
			const where = await db
				.select({ lorebookId: schema.lorebookEntries.lorebookId })
				.from(schema.lorebookEntries)
				.where(inArray(schema.lorebookEntries.id, ends))
			if (!where.some((x: { lorebookId: number }) => x.lorebookId === r.ownBookId))
				retire = found.id
		}
	}
	if (
		found &&
		retire == null &&
		(found.lorebookId === r.target.lorebookId || found.lorebookId === r.ownBookId)
	)
		return { id: found.id, made: false, overlaid: false }
	// Made, or overlaid in the notes: a copy of the book's row, worded as the side now says.
	const e = found
		? ([
				found.fromNodeId != null
					? { nodeId: found.fromNodeId }
					: { entryId: found.fromEntryId! },
				found.toNodeId != null
					? { nodeId: found.toNodeId }
					: { entryId: found.toEntryId! }
			] as [End, End])
		: await endsOf()
	if (!e)
		return {
			skipped: `${side} → ${towards || "nobody"} is not on the lorebook, so the tie has no row`
		}
	const c = endColumns(e[0], e[1])
	const castTie = c.fromNodeId != null && c.toNodeId != null
	// 🚧 (sense-b4) A row with an end in the session's own book is made there,
	// on no line: it forks nothing, whatever the route.
	const entryEnds = [c.fromEntryId, c.toEntryId].filter((x): x is number => x != null)
	const inOwnBook =
		r.ownBookId != null &&
		entryEnds.length > 0 &&
		(
			await db
				.select({ lorebookId: schema.lorebookEntries.lorebookId })
				.from(schema.lorebookEntries)
				.where(inArray(schema.lorebookEntries.id, entryEnds))
		).some((x: { lorebookId: number }) => x.lorebookId === r.ownBookId)
	const writeBookId = inOwnBook ? r.ownBookId! : r.target.lorebookId
	// One transaction for the fork and the row: the line forks only now, after
	// the checks above, and a second first writer waits on the book's lock. A
	// row for the session's notes (`own-book`) is on no line and forks nothing.
	const { ensureSessionLine } = await import("$lib/server/lorebooks/sessionLine")
	const made = await db.transaction(async (tx: Db) => {
		const branchId =
			r.target.route === "book" && !inOwnBook
				? await ensureSessionLine(tx as unknown as Db, r.sessionId)
				: null
		if (retire != null) await tx.delete(R).where(eq(R.id, retire))
		const [row] = await tx
			.insert(R)
			.values({
				lorebookId: writeBookId,
				branchId,
				...c,
				relationshipType:
					words("relationship-type") ??
					found?.relationshipType ??
					typeWords(decl),
				title: words("relationship-name") ?? found?.title ?? "",
				reverseRelationshipType: castTie
					? null
					: (found?.reverseRelationshipType ?? null),
				description: found?.description ?? "",
				visibility: found?.visibility ?? "acknowledged",
				status: "active",
				rulesRunId: runId
			})
			.returning({ id: R.id })
		return row
	})
	// 🚧 RF fix 4: a row the moment made goes with its message.
	if (anchor) {
		const { imprintMade } = await import("$lib/server/lorebooks/imprints")
		await imprintMade(db, anchor, { lorebookId: writeBookId, subject: "relationship", subjectId: made.id })
	}
	return { id: made.id, made: !found || retire != null, overlaid: !!found && retire == null }
}

// ── The notes' rule-fed overlay (★5) ────────────────────────────────────────

/**
 * 🚧 **The rule-fed overlay** (★5, lane T3, 2026-10-23): what the rules fed
 * onto a book the session may not write at Full, kept in the session's own
 * notes — as a tie's row is overlaid by the notes' copy (T2) — and read by
 * the session in the book's place:
 *
 *  · `entryFields` — a held thing's source entry's field, or a place
 *    entry's (`entry-field`), by entry id;
 *  · `castStates` — a cast member's state on the graph (`cast-state`), by
 *    the book's member (its binding id);
 *  · 🚧 `placeValues` — a world-scope attribute value of the attached book's
 *    place (★pl-1, owner 2026-11-05), by entry id then slot id; null is
 *    cleared, and the book's own value is read.
 *
 * Kept on the notes' own row (`lorebooks.extra_json.ruleFed`), never as a
 * copied entry or member: a copy would be offered by *Apply to the lorebook*
 * as a second entry and read twice by retrieval. ⚠ Not a **dated overlay**
 * (an amendment, which a book's owner writes into the book).
 */
export interface RuleFedOverlay {
	entryFields: Record<string, Record<string, unknown>>
	castStates: Record<string, string>
	/** 🚧 (★pl-1) A world-scope value of the attached book's place: entry id → slot id → value. Absent until one is laid. */
	placeValues?: Record<string, Record<string, unknown>>
}

const RULE_FED = "ruleFed"

const overlayOfJson = (raw: unknown): RuleFedOverlay => {
	const o = isRecord(raw) ? raw : {}
	return {
		entryFields: isRecord(o.entryFields) ? (o.entryFields as RuleFedOverlay["entryFields"]) : {},
		castStates: isRecord(o.castStates) ? (o.castStates as RuleFedOverlay["castStates"]) : {},
		...(isRecord(o.placeValues) ? { placeValues: o.placeValues as NonNullable<RuleFedOverlay["placeValues"]> } : {})
	}
}

/** One value's place on the overlay: `entryFields.<entry id>.<field>`, `castStates.<member id>`. */
const overlayPath = {
	entryField: (entryId: number | string, field: string) => `entryFields.${entryId}.${field}`,
	castState: (bindingId: number | string) => `castStates.${bindingId}`,
	/** 🚧 (★pl-1) A slot id may hold `.`; `atOverlayPath` rejoins the rest. */
	placeValue: (entryId: number | string, slotId: string) => `placeValues.${entryId}.${slotId}`
}
const atOverlayPath = (o: RuleFedOverlay, path: string): unknown => {
	const [kind, id, ...rest] = path.split(".")
	const at = (o as unknown as Record<string, Record<string, unknown>>)[kind!]?.[id!]
	return rest.length ? (at as Record<string, unknown> | undefined)?.[rest.join(".")] : at
}

/**
 * Lay one value on the notes' rule-fed overlay. 🚧 RF fix 4: each place it
 * moves (`paths`) is imprinted under `anchor`, so the value goes back with
 * its message — the notes always revert.
 */
async function overlayInNotes(
	db: Db,
	notesId: number,
	lay: (o: RuleFedOverlay) => void,
	imprint?: { anchor: ImprintAnchor | null; paths: readonly string[] }
): Promise<void> {
	const [book] = await db
		.select({ extraJson: schema.lorebooks.extraJson })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, notesId))
		.limit(1)
	if (!book) return
	const extra = isRecord(book.extraJson) ? book.extraJson : {}
	const o = overlayOfJson(extra[RULE_FED])
	const was = (imprint?.paths ?? []).map((p) => structuredClone(atOverlayPath(o, p)))
	lay(o)
	await db
		.update(schema.lorebooks)
		.set({ extraJson: { ...extra, [RULE_FED]: o } })
		.where(eq(schema.lorebooks.id, notesId))
	if (!imprint?.anchor) return
	const { imprintField } = await import("$lib/server/lorebooks/imprints")
	for (const [i, path] of imprint.paths.entries())
		await imprintField(
			db,
			imprint.anchor,
			{ lorebookId: notesId, subject: "overlay", subjectId: notesId, field: path },
			was[i],
			atOverlayPath(o, path)
		)
}

/**
 * 🚧 The rule-fed overlay a session's notes hold (★5), or null when the
 * notes hold none (or there are no notes). What the session's readers lay
 * over the attached book: the lore read (`entryFields`), the graph's cast
 * (`castStates`).
 */
export async function ruleFedOverlayOf(
	db: Db,
	sessionId: number
): Promise<RuleFedOverlay | null> {
	const [notes] = await db
		.select({ extraJson: schema.lorebooks.extraJson })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.sessionId, sessionId))
		.limit(1)
	const raw = isRecord(notes?.extraJson) ? notes.extraJson[RULE_FED] : undefined
	if (!isRecord(raw)) return null
	const o = overlayOfJson(raw)
	return Object.keys(o.entryFields).length ||
		Object.keys(o.castStates).length ||
		Object.keys(o.placeValues ?? {}).length
		? o
		: null
}

/**
 * 🚧 (★pl-1, owner 2026-11-05: "In the notes' overlay, like the rules' place
 * fields.") The world-scope values the notes hold for the attached book's
 * places — a place's entry id, then a slot id, to the value — from the notes
 * row's `extra_json`; `{}` when none. Pure, so a reader that already holds
 * the notes row asks no second query.
 */
export function placeValuesOf(extraJson: unknown): Record<string, Record<string, unknown>> {
	return overlayOfJson(isRecord(extraJson) ? extraJson[RULE_FED] : undefined).placeValues ?? {}
}

/**
 * 🚧 (★pl-1) Lay one world-scope value of the attached book's place on the
 * notes' overlay, keyed by the book's place (entry) id. `anchor` imprints it
 * under its message so Back takes it; null imprints nothing. The only writer
 * of `placeValues`.
 */
export async function layPlaceValue(
	db: Db,
	notesId: number,
	entryId: number,
	slotId: string,
	value: unknown,
	anchor: ImprintAnchor | null
): Promise<void> {
	await overlayInNotes(
		db,
		notesId,
		(o) => {
			const places = (o.placeValues ??= {})
			places[String(entryId)] = { ...(places[String(entryId)] ?? {}), [slotId]: value }
		},
		{ anchor, paths: [overlayPath.placeValue(entryId, slotId)] }
	)
}

// ── The one writer ──────────────────────────────────────────────────────────

/** What a landing came to, as the receipt tells it (T3). */
export interface LandingFact {
	kind: "tie" | "held" | "attribute"
	owner: string
	entryType?: string
	towards?: string
	attribute?: string
	/** The relationship row (a tie). */
	relationshipId?: number
	/** The entry or cast member written (a held thing, an attribute). */
	entryId?: number
	bindingId?: number
	lorebookId?: number
	made?: true
	overlaid?: true
	columns: { target: ReadsOnto; field: string; from: unknown; to: unknown }[]
	moved?: Record<string, { from: unknown; to: unknown }>
	skipped?: string
	note?: string
}

/** The node states a cast member may be in on the graph. */
const NODE_STATES = new Set(["active", "deceased", "missing", "departed"])

/**
 * Write one column of one row — the instance's only path (T2): a
 * relationship row's type or name, an entry's own field, a cast member's
 * state. Returns why it could not, or null.
 */
async function writeColumn(
	db: Db,
	at: { relationshipId?: number; entryId?: number; bindingId?: number },
	target: ReadsOnto,
	field: string,
	value: unknown,
	runId: string | null,
	/** 🚧 RF fix 4: where the write's lore imprint is filed — what it held goes back with its message. */
	anchor: ImprintAnchor | null = null
): Promise<string | null> {
	const { imprintField } = await import("$lib/server/lorebooks/imprints")
	if (target === "relationship-type" || target === "relationship-name") {
		if (at.relationshipId == null) return "no relationship row"
		if (typeof value !== "string" || !value.trim())
			return `${field} holds no words to read onto it`
		const column = target === "relationship-type" ? "relationshipType" : "title"
		const [was] = await db
			.select({ lorebookId: R.lorebookId, words: R[column], rulesRunId: R.rulesRunId })
			.from(R)
			.where(eq(R.id, at.relationshipId))
			.limit(1)
		try {
			await db
				.update(R)
				.set({ [column]: value.trim(), rulesRunId: runId })
				.where(eq(R.id, at.relationshipId))
		} catch (e) {
			return `the lorebook already says that link that way (${(e as Error).message.split("\n")[0]})`
		}
		if (anchor && was) {
			const on = { lorebookId: was.lorebookId, subject: "relationship" as const, subjectId: at.relationshipId }
			await imprintField(db, anchor, { ...on, field: column }, was.words ?? undefined, value.trim())
			await imprintField(db, anchor, { ...on, field: "rulesRunId" }, was.rulesRunId ?? undefined, runId ?? undefined)
		}
		return null
	}
	if (target === "entry-field") {
		if (at.entryId == null) return "no entry behind it"
		const [row] = await db
			.select({ fields: schema.lorebookEntries.fields, lorebookId: schema.lorebookEntries.lorebookId })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, at.entryId))
			.limit(1)
		if (!row) return "its entry is gone"
		const fields = isRecord(row.fields) ? row.fields : {}
		await db
			.update(schema.lorebookEntries)
			.set({
				fields: {
					...fields,
					[field]: value
				}
			})
			.where(eq(schema.lorebookEntries.id, at.entryId))
		if (anchor) {
			const { entryFieldAddress } = await import("$lib/server/lorebooks/imprints")
			await imprintField(
				db,
				anchor,
				{ lorebookId: row.lorebookId, subject: "entry", subjectId: at.entryId, field: entryFieldAddress(field) },
				fields[field],
				value
			)
		}
		return null
	}
	if (target === "cast-state") {
		if (at.bindingId == null) return "the cast member is in no lorebook"
		if (typeof value !== "string" || !NODE_STATES.has(value))
			return `'${String(value)}' is no state a cast member is in`
		// The state is a cast version's (the member's column is frozen): the one
		// writer's story write, which routes itself (the book, or the session's
		// overlay row), dates itself, anchors to the turn so Back takes it, and
		// forks the line inside this transaction. Nothing is written when the
		// member already reads so in this session.
		if (!anchor) throw new Error("A cast member's state is written in a session.")
		const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
		const { writeCastVersion } = await import("$lib/server/characters/versions")
		const read = (await membersAsRead(db, [at.bindingId], { sessionId: anchor.sessionId })).get(at.bindingId)
		if (read?.nodeState === value) return null
		const memberId = at.bindingId
		await db.transaction((tx: Db) =>
			writeCastVersion(tx as unknown as Db, {
				member: memberId,
				changes: { nodeState: value as schema.NodeState },
				// The run's, else the session's (as `durable.ts` files its rows).
				writtenBy: anchor.runId ? `run:${anchor.runId}` : `session:${anchor.sessionId}`,
				session: { id: anchor.sessionId, messageId: anchor.messageId }
			})
		)
		return null
	}
	return `nothing reads onto '${String(target)}'`
}

/** 🚧 RF fix 4: where a moment's landings file their lore imprints — the anchor its zones take. */
async function landingAnchor(
	db: Db,
	ctx: { sessionId: number; runId: string | null; messageId: number | null }
): Promise<ImprintAnchor> {
	const { imprintAnchorFor } = await import("$lib/server/lorebooks/imprints")
	return imprintAnchorFor(db, ctx.sessionId, { turnMessageId: ctx.messageId, runId: ctx.runId })
}

/**
 * 🚧 **The one writer** (T2, T4): what a moment landed, written onto the
 * lorebook where each instance lives — a tie side's relationship row (found,
 * overlaid in the notes, or made; its id stamped back as the side's `edge`
 * on the zone write before it is written), a held thing's source entry. A
 * book the session may not write keeps a held thing's entry as it is (said,
 * never an error). Each written row carries the run (`rules_run_id`).
 */
export async function writeLandings(
	db: Db,
	ctx: {
		sessionId: number
		ruleset: RulesetDecl
		runId: string | null
		messageId: number | null
	},
	landings: readonly LoreLanding[],
	writes: ZoneWrite[]
): Promise<LandingFact[]> {
	if (!landings.length) return []
	const r = await routingOf(db, ctx.sessionId, ctx.messageId)
	const anchor = await landingAnchor(db, ctx)
	const types = entryTypesOf(ctx.ruleset)
	const facts: LandingFact[] = []
	for (const l of landings) {
		const decl = types.get(l.entryType)!
		const fact: LandingFact = {
			kind: l.kind,
			owner: l.entry.sideOwner ?? l.ownerKey,
			entryType: l.entryType,
			columns: [],
			...(Object.keys(l.moved).length ? { moved: l.moved } : {}),
			...(l.note ? { note: l.note } : {})
		}
		if (l.kind === "tie") {
			fact.towards = String(l.entry.fields.towards ?? "")
			const row = await rowForSide(db, r, l, decl, ctx.runId, anchor)
			if ("skipped" in row) {
				facts.push({ ...fact, skipped: row.skipped })
				continue
			}
			fact.relationshipId = row.id
			if (row.made) fact.made = true
			if (row.overlaid) fact.overlaid = true
			// The side's edge, stamped on the snapshot before it is written.
			const w = writes.find(
				(x) => x.ownerKey === l.ownerKey && x.zoneType === l.zoneType
			)
			if (
				w &&
				w.entries[l.index] &&
				edgeOf(w.entries[l.index]!) !== row.id
			)
				w.entries[l.index] = {
					...w.entries[l.index]!,
					fields: {
						...w.entries[l.index]!.fields,
						edge: String(row.id)
					}
				}
			const [before] = await db
				.select({
					type: R.relationshipType,
					title: R.title,
					lorebookId: R.lorebookId
				})
				.from(R)
				.where(eq(R.id, row.id))
				.limit(1)
			fact.lorebookId = before?.lorebookId
			for (const c of l.columns) {
				const from =
					c.target === "relationship-type"
						? before?.type
						: before?.title
				const why = await writeColumn(
					db,
					{ relationshipId: row.id },
					c.target,
					c.field,
					c.value,
					ctx.runId,
					anchor
				)
				if (why)
					fact.skipped = fact.skipped
						? `${fact.skipped}; ${why}`
						: why
				else if (from !== c.value)
					fact.columns.push({
						target: c.target,
						field: c.field,
						from,
						to: c.value
					})
			}
			if (!l.columns.length && ctx.runId) {
				const [was] = await db
					.select({ lorebookId: R.lorebookId, rulesRunId: R.rulesRunId })
					.from(R)
					.where(eq(R.id, row.id))
					.limit(1)
				await db
					.update(R)
					.set({ rulesRunId: ctx.runId })
					.where(eq(R.id, row.id))
				if (was && !row.made) {
					const { imprintField } = await import("$lib/server/lorebooks/imprints")
					await imprintField(
						db,
						anchor,
						{ lorebookId: was.lorebookId, subject: "relationship", subjectId: row.id, field: "rulesRunId" },
						was.rulesRunId ?? undefined,
						ctx.runId
					)
				}
			}
			facts.push(fact)
			continue
		}
		// A held thing: its own entry, when the session writes the book it is in —
		// 🚧 ★5: else, for the attached book, the notes' rule-fed overlay.
		const entryId = l.entry.entryId!
		const [entry] = await db
			.select({ lorebookId: schema.lorebookEntries.lorebookId })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, entryId))
			.limit(1)
		fact.entryId = entryId
		if (!entry) fact.skipped = "its entry is gone"
		else if (
			entry.lorebookId !== r.target.lorebookId &&
			r.target.route === "own-book" &&
			entry.lorebookId === r.attachedId
		) {
			await overlayInNotes(
				db,
				r.target.lorebookId,
				(o) => {
					const now = (o.entryFields[String(entryId)] ??= {})
					for (const c of l.columns) now[c.field] = c.value
				},
				{ anchor, paths: l.columns.map((c) => overlayPath.entryField(entryId, c.field)) }
			)
			fact.overlaid = true
			for (const c of l.columns)
				fact.columns.push({ target: c.target, field: c.field, from: c.was, to: c.value })
			facts.push({ ...fact, lorebookId: r.target.lorebookId })
			continue
		} else if (
			entry.lorebookId !== r.target.lorebookId &&
			entry.lorebookId !== r.ownBookId
		)
			fact.skipped =
				"this session does not write the lorebook its entry is in; the held copy keeps the change"
		else
			for (const c of l.columns) {
				const why = await writeColumn(
					db,
					{ entryId },
					c.target,
					c.field,
					c.value,
					ctx.runId,
					anchor
				)
				if (why) fact.skipped = why
				else
					fact.columns.push({
						target: c.target,
						field: c.field,
						from: c.was,
						to: c.value
					})
			}
		fact.lorebookId = entry?.lorebookId
		facts.push(fact)
	}
	return facts
}

/** 🚧 ⏳ Flip on: the owner a cast-state landing reads for a seat's owner — `seated_member` is the binding itself, `player_seat` its seat's member else its card; anything else as it is. */
async function castStateOwnerOf(
	db: Db,
	sessionId: number,
	owner: { kind?: string; id: number }
): Promise<{ kind?: string; id: number }> {
	if (owner.kind === "seated_member") return { kind: "cast_member", id: owner.id }
	if (owner.kind !== "player_seat") return owner
	const seat = await seatOf(db, sessionId, `player-seat:${owner.id}`)
	if (seat?.castMemberId != null) return { kind: "cast_member", id: seat.castMemberId }
	return seat?.cardId != null ? { kind: "session_cast", id: seat.cardId } : owner
}

/**
 * 🚧 What an outlet's attribute changes land on the lorebook (T2): each
 * applied value of an attribute that reads onto it — a cast member's state on
 * the graph, a place entry's field — through the same one writer.
 */
export async function writeAttributeLandings(
	db: Db,
	ctx: {
		sessionId: number
		ruleset: RulesetDecl
		runId: string | null
		messageId: number | null
	},
	applied: readonly {
		owner?: { kind?: string; id?: number }
		slotId?: string
		value?: unknown
	}[]
): Promise<LandingFact[]> {
	const attrs = sectionsOf(ctx.ruleset).attributes ?? []
	if (!attrs.some((a) => a.readsOnto)) return []
	const { attributeOf } = attributeSlotsOf(ctx.ruleset)
	const facts: LandingFact[] = []
	let r: Routing | null = null
	let anchor: ImprintAnchor | null = null
	for (const c of applied) {
		const attr = c.slotId
			? attrs.find((a) => a.id === attributeOf.get(c.slotId!))
			: undefined
		if (!attr?.readsOnto || !c.owner || typeof c.owner.id !== "number")
			continue
		r ??= await routingOf(db, ctx.sessionId, ctx.messageId)
		anchor ??= await landingAnchor(db, ctx)
		const value = isRecord(c.value) && "v" in c.value ? c.value.v : c.value
		// 🚧 ⏳ Flip on: a seat's own owner reads as the cast member it stands for — a `seated_member` *is* the binding; a `player_seat` is its seat's member, else its card.
		const owner: { kind?: string; id: number } = memberFormOn()
			? await castStateOwnerOf(db, ctx.sessionId, { kind: c.owner.kind, id: c.owner.id })
			: { kind: c.owner.kind, id: c.owner.id }
		const fact: LandingFact = {
			kind: "attribute",
			owner: `${c.owner.kind}:${c.owner.id}`,
			attribute: attr.id,
			columns: []
		}
		if (
			attr.readsOnto === "cast-state" &&
			(owner.kind === "session_cast" || owner.kind === "cast_member")
		) {
			const cols = {
				id: schema.lorebookBindings.id,
				lorebookId: schema.lorebookBindings.lorebookId
			}
			// The member in the book written to, else 🚧 (★5) in the attached book the notes overlay.
			const [b] =
				owner.kind === "cast_member"
					? await db
							.select(cols)
							.from(schema.lorebookBindings)
							.where(eq(schema.lorebookBindings.id, owner.id))
							.limit(1)
					: await db
							.select(cols)
							.from(schema.lorebookBindings)
							.where(
								and(
									eq(
										schema.lorebookBindings.characterId,
										owner.id
									),
									inArray(
										schema.lorebookBindings.lorebookId,
										[r.target.lorebookId, ...(r.attachedId != null ? [r.attachedId] : [])]
									)
								)
							)
							.orderBy(
								sql`${schema.lorebookBindings.lorebookId} = ${r.target.lorebookId} DESC`
							)
							.limit(1)
			const overlaid =
				!!b &&
				b.lorebookId !== r.target.lorebookId &&
				r.target.route === "own-book" &&
				b.lorebookId === r.attachedId
			if (overlaid) {
				if (typeof value !== "string" || !NODE_STATES.has(value))
					fact.skipped = `'${String(value)}' is no state a cast member is in`
				else {
					await overlayInNotes(
						db,
						r.target.lorebookId,
						(o) => {
							o.castStates[String(b!.id)] = value
						},
						{ anchor, paths: [overlayPath.castState(b!.id)] }
					)
					fact.bindingId = b!.id
					fact.lorebookId = r.target.lorebookId
					fact.overlaid = true
					fact.columns.push({
						target: "cast-state",
						field: attr.id,
						from: undefined,
						to: value
					})
				}
			} else if (!b || b.lorebookId !== r.target.lorebookId)
				fact.skipped =
					"the cast member is in no lorebook this session writes"
			else {
				fact.bindingId = b.id
				fact.lorebookId = b.lorebookId
				const why = await writeColumn(
					db,
					{ bindingId: b.id },
					"cast-state",
					attr.id,
					value,
					ctx.runId,
					anchor
				)
				if (why) fact.skipped = why
				else
					fact.columns.push({
						target: "cast-state",
						field: attr.id,
						from: undefined,
						to: value
					})
			}
		} else if (
			attr.readsOnto === "entry-field" &&
			(c.owner.kind === "session_location" || c.owner.kind === "location")
		) {
			const [e] = await db
				.select({ lorebookId: schema.lorebookEntries.lorebookId })
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, c.owner.id))
				.limit(1)
			fact.entryId = c.owner.id
			if (
				e &&
				e.lorebookId !== r.target.lorebookId &&
				r.target.route === "own-book" &&
				e.lorebookId === r.attachedId
			) {
				// 🚧 ★5: the attached book's place, overlaid in the notes.
				await overlayInNotes(
					db,
					r.target.lorebookId,
					(o) => {
						;(o.entryFields[String(c.owner!.id)] ??= {})[attr.id] = value
					},
					{ anchor, paths: [overlayPath.entryField(c.owner.id!, attr.id)] }
				)
				fact.lorebookId = r.target.lorebookId
				fact.overlaid = true
				fact.columns.push({
					target: "entry-field",
					field: attr.id,
					from: undefined,
					to: value
				})
			} else if (
				!e ||
				(e.lorebookId !== r.target.lorebookId && e.lorebookId !== r.ownBookId)
			)
				fact.skipped =
					"this session does not write the lorebook the place is in"
			else {
				fact.lorebookId = e.lorebookId
				const why = await writeColumn(
					db,
					{ entryId: c.owner.id },
					"entry-field",
					attr.id,
					value,
					ctx.runId,
					anchor
				)
				if (why) fact.skipped = why
				else
					fact.columns.push({
						target: "entry-field",
						field: attr.id,
						from: undefined,
						to: value
					})
			}
		} else continue
		facts.push(fact)
	}
	return facts
}

/**
 * 🚧 The lines a moment's landings tell (the in-play outcome's "the graph
 * follows the bond" rows, screen 4): one per tie side whose row's words
 * moved or was made — in member words, never the ruleset's.
 */
export function landingLines(
	facts: readonly LandingFact[],
	nameOf: (key: string) => string
): { owner: string; text: string; follows: string }[] {
	const out: { owner: string; text: string; follows: string }[] = []
	for (const f of facts) {
		if (f.kind !== "tie" || f.relationshipId == null) continue
		const type = f.columns.find((c) => c.target === "relationship-type")
		const name = f.columns.find((c) => c.target === "relationship-name")
		if (!type && !name && !f.made) continue
		const who = nameOf(f.owner)
		const other = f.towards ? nameOf(f.towards) : ""
		const words = type
			? `now reads ${String(type.to)}`
			: name
				? `is now called ${String(name.to)}`
				: "is on the lorebook now"
		out.push({
			owner: f.owner,
			text: `Lorebook: ${who}'s side of the tie with ${other} ${words}`,
			follows: f.entryType ?? ""
		})
	}
	return out
}

// ── Both ways (T4) ──────────────────────────────────────────────────────────

/** The sessions that read a lorebook: those attached to it, and the one whose notes it is. */
async function sessionsReading(
	db: Db,
	lorebookId: number
): Promise<{ id: number; primaryRuleset: string }[]> {
	const [book] = await db
		.select({ sessionId: schema.lorebooks.sessionId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	return db
		.select({
			id: schema.sessions.id,
			primaryRuleset: schema.sessions.primaryRuleset
		})
		.from(schema.sessions)
		.where(
			book?.sessionId != null
				? or(
						eq(schema.sessions.lorebookId, lorebookId),
						eq(schema.sessions.id, book.sessionId)
					)
				: eq(schema.sessions.lorebookId, lorebookId)
		)
}

/** The zone a tie side is kept in by its holder: one the ruleset says holds it, else the carried one. */
function zoneForTie(
	ruleset: object,
	tie: RulesetEntryTypeDecl,
	facet: "cast" | "world" | "location"
): ZoneTypeDecl | undefined {
	const zones = zoneTypesOf(ruleset)
	return (
		zones.find(
			(z) =>
				z.id !== CARRIED &&
				z.holds !== ZONE_HOLDS_ANY &&
				z.holds.includes(tie.id) &&
				z.owners.includes(facet)
		) ??
		zones.find(
			(z) =>
				z.id !== CARRIED &&
				z.holds === ZONE_HOLDS_ANY &&
				z.owners.includes(facet)
		) ??
		zones.find((z) => z.id === CARRIED && z.owners.includes(facet))
	)
}

/** An owner key as the zone store keys its owner. */
function ownerOfKey(key: string, sessionId: number): StateOwner | null {
	if (key === "world") return { kind: "session", id: sessionId } as StateOwner
	const m = /^(character|location|player-seat|seated-member):(\d+)$/.exec(key)
	// ⏳ A `seated-member:` key is read only once the flip is on (`memberForm.ts`).
	if (!m || (m[1] === "seated-member" && !memberFormOn())) return null
	return {
		kind:
			m[1] === "character"
				? "session_cast"
				: m[1] === "player-seat"
					? "player_seat"
					: m[1] === "seated-member"
						? "seated_member"
						: "session_location",
		id: Number(m[2])
	} as StateOwner
}

/**
 * 🚧 ⏳ A row's end as the session keys it, flip on (`memberForm.ts`): the
 * seat whose member *is* the binding (`seated-member:<M>` / `player-seat:<S>`),
 * else the seat holding the end's card; no seat keeps the card-form key.
 * Flip off: the key as it is.
 */
function seatEndKeyIn(map: SeatMap | null, end: { key: string; nodeId: number | null }): string {
	if (!map) return end.key
	if (end.nodeId != null) {
		const seat = map.seats.find((x) => x.castMemberId === end.nodeId)
		if (seat) return seat.kind === "player" ? `player-seat:${seat.seatId}` : `seated-member:${end.nodeId}`
	}
	return memberFormOf(map, end.key) ?? end.key
}

/** A row's end as an owner key: a cast member by their card, a place by its entry. */
async function keyOfEnd(
	db: Db,
	nodeId: number | null,
	entryId: number | null
): Promise<{ key: string; name: string; place: boolean; nodeId: number | null } | null> {
	if (nodeId != null) {
		const [b] = await db
			.select({ characterId: schema.lorebookBindings.characterId })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, nodeId))
			.limit(1)
		if (!b?.characterId) return null
		// The member as read on Main (a tie is drawn on the book, no session named), else the card's current version.
		let name = (await memberAsRead(db, nodeId))?.name as string | undefined
		if (!name)
			name =
				(await cardsNow(db, [b.characterId])).get(b.characterId)?.name ??
				`character ${b.characterId}`
		return { key: `character:${b.characterId}`, name, place: false, nodeId }
	}
	if (entryId != null) {
		const [e] = await db
			.select({
				title: schema.lorebookEntries.title,
				typeId: schema.lorebookEntries.typeId
			})
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, entryId))
			.limit(1)
		if (!e) return null
		const place = e.typeId === LOCATION_TYPE_ID
		return {
			key: `${place ? "location" : "entry"}:${entryId}`,
			name: e.title ?? `entry ${entryId}`,
			place,
			nodeId: null
		}
	}
	return null
}

/**
 * 🚧 A row's end named in one session: a cast member by the name they are
 * read with there (`memberAsRead` — their own name, else their active
 * card's), else the name the row's end already has.
 */
async function endNameIn(
	db: Db,
	sessionId: number,
	end: { key: string; name: string },
	nodeId: number | null
): Promise<string> {
	if (nodeId == null || !/^character:\d+$/.test(end.key)) return end.name
	const read = await memberAsRead(db, nodeId, { sessionId })
	return read?.name || end.name
}

/** The tie type a drawn row is: person to person, to a place, or to any entry — the first the ruleset says. */
function tieTypeForRow(
	ruleset: object,
	to: { key: string; place: boolean }
): RulesetEntryTypeDecl | undefined {
	const ties = [...tieTypesOf(ruleset).values()]
	const want = to.key.startsWith("character:")
		? "person"
		: to.place
			? "place"
			: "entry"
	return (
		ties.find((t) => t.farEnd === want) ??
		(want !== "person" ? ties.find((t) => t.farEnd === "entry") : undefined)
	)
}

/**
 * 🚧 **A tie drawn on the lorebook makes its held sides** (T4): for every
 * session reading the row's book whose ruleset has a tie of its ends' kind,
 * one held side per side (`stampTieSides` — two for a person to a person,
 * each in its person's zone; one, the world's), unless that side is held
 * already. The drawn side's `edge` is the row; the other side's, its own
 * perspective row when one stands. A field reading onto the row's words
 * starts at them when they are its words. Returns the sides made.
 */
export async function drawTieSides(
	db: Db,
	row: typeof R.$inferSelect
): Promise<{ sessionId: number; owner: string; towards: string }[]> {
	const made: { sessionId: number; owner: string; towards: string }[] = []
	const from = await keyOfEnd(db, row.fromNodeId, row.fromEntryId)
	const to = await keyOfEnd(db, row.toNodeId, row.toEntryId)
	if (!from || !to) return made
	const { stampTieSides } = await import("@serene-pub/sdk")
	for (const s of await sessionsReading(db, row.lorebookId)) {
		const ruleset = getRuleset(s.primaryRuleset)
		if (!ruleset) continue
		const tie = tieTypeForRow(ruleset, to)
		if (!tie) continue
		// The other perspective, when the book holds one: the far side's edge.
		const [back] =
			row.fromNodeId != null && row.toNodeId != null
				? await db
						.select({
							id: R.id,
							type: R.relationshipType,
							title: R.title
						})
						.from(R)
						.where(
							and(
								eq(R.lorebookId, row.lorebookId),
								eq(R.fromNodeId, row.toNodeId),
								eq(R.toNodeId, row.fromNodeId),
								eq(R.status, "active")
							)
						)
						.orderBy(desc(R.id))
						.limit(1)
				: []
		const seeded = (
			words: { type?: string | null; title?: string | null } | undefined
		): Record<string, unknown> => {
			const out: Record<string, unknown> = {}
			for (const [target, v] of [
				["relationship-type", words?.type],
				["relationship-name", words?.title]
			] as const) {
				const f = fieldOnto(tie, target)
				const decl = f
					? (fieldsOf(tie)[f] as FieldDecl & {
							of?: readonly string[]
						})
					: undefined
				if (!f || typeof v !== "string" || !v.trim()) continue
				if (decl?.type === "enum" ? decl.of?.includes(v.trim()) : true)
					out[f] = v.trim()
			}
			return out
		}
		// 🚧 ⏳ Flip on: each end is the seat's member-form key in this session.
		const seatMap = memberFormOn() ? await loadSeatMap(db, s.id) : null
		const sides = stampTieSides(
			tie,
			{ id: null, name: to.name },
			{
				from: seatEndKeyIn(seatMap, from),
				towards: seatEndKeyIn(seatMap, to),
				names: {
					from: await endNameIn(db, s.id, to, to.nodeId),
					towards: await endNameIn(db, s.id, from, from.nodeId)
				}
			},
			{
				from: {
					...seeded({ type: row.relationshipType, title: row.title }),
					edge: String(row.id)
				},
				...(back
					? { towards: { ...seeded(back), edge: String(back.id) } }
					: {})
			}
		)
		const owners = sides
			.map((x) => ({ key: x.holder, owner: ownerOfKey(x.holder, s.id) }))
			.filter((o): o is { key: string; owner: StateOwner } => !!o.owner)
		const zones = await zonesFor(db, s.id, ruleset.id, owners as never)
		const writes: ZoneWrite[] = []
		for (const side of sides) {
			const owner = ownerOfKey(side.holder, s.id)
			if (!owner) continue
			const facet =
				side.holder === "world"
					? "world"
					: side.holder.startsWith("location:")
						? "location"
						: "cast"
			const zone = zoneForTie(ruleset, tie, facet)
			if (!zone) continue
			const now = writes.find(
				(w) => w.ownerKey === side.holder && w.zoneType === zone.id
			)?.entries ?? [...(zones[side.holder]?.[zone.id] ?? [])]
			const towards = String(side.held.fields.towards)
			const at = now.findIndex(
				(e) =>
					e.entryType === tie.id &&
					e.fields.towards === towards &&
					(e.sideOwner ?? side.holder) ===
						(side.held.sideOwner ?? side.holder)
			)
			if (at >= 0) {
				// Held already: a side with no row yet takes this one as its own — nothing else of it moves.
				const had = now[at]!
				if (edgeOf(had) !== null || side.held.fields.edge === undefined)
					continue
				now[at] = {
					...had,
					fields: { ...had.fields, edge: side.held.fields.edge }
				}
			} else
				now.push({
					...(side.held as ZoneEntry),
					fields: { ...side.held.fields }
				})
			const wi = writes.findIndex(
				(w) => w.ownerKey === side.holder && w.zoneType === zone.id
			)
			const w: ZoneWrite = {
				owner,
				ownerKey: side.holder,
				zoneType: zone.id,
				entries: now,
				note: `a tie drawn on the lorebook`
			}
			if (wi >= 0) writes[wi] = w
			else writes.push(w)
			made.push({
				sessionId: s.id,
				owner: side.held.sideOwner ?? side.holder,
				towards
			})
		}
		if (writes.length)
			await writeZones(
				db,
				{
					sessionId: s.id,
					rulesetId: ruleset.id,
					messageId: null,
					updatedBy: "lorebook"
				},
				writes
			)
	}
	return made
}

/**
 * 🚧 **A deleted row retires its held sides** (T4) — never the reverse: in
 * every session reading its book, each zone holding a side whose `edge` is
 * the row is written again without it.
 */
export async function retireTieSides(
	db: Db,
	row: { id: number; lorebookId: number }
): Promise<
	{ sessionId: number; owner: string; zone: string; retired: number }[]
> {
	const out: {
		sessionId: number
		owner: string
		zone: string
		retired: number
	}[] = []
	const edge = String(row.id)
	for (const s of await sessionsReading(db, row.lorebookId)) {
		const rows = rawRows<{
			owner_kind: string
			owner_id: number
			ruleset_id: string
			zone_type: string
			entries: unknown
		}>(
			await db.execute(sql`
				SELECT DISTINCT ON (owner_kind, owner_id, ruleset_id, zone_type) owner_kind, owner_id, ruleset_id, zone_type, entries
				FROM ${schema.zoneContents}
				WHERE session_id = ${s.id}
				ORDER BY owner_kind, owner_id, ruleset_id, zone_type, id DESC
			`)
		)
		for (const z of rows) {
			const entries = (
				Array.isArray(z.entries) ? z.entries : []
			) as ZoneEntry[]
			const kept = entries.filter(
				(e) =>
					!(
						isRecord(e) &&
						isRecord(e.fields) &&
						String(e.fields.edge ?? "") === edge
					)
			)
			if (kept.length === entries.length) continue
			const ownerKey =
				z.owner_kind === "session"
					? "world"
					: `${z.owner_kind === "session_cast" ? "character" : z.owner_kind === "seated_member" ? "seated-member" : memberFormOn() && z.owner_kind === "player_seat" ? "player-seat" : "location"}:${z.owner_id}`
			await writeZones(
				db,
				{
					sessionId: s.id,
					rulesetId: z.ruleset_id,
					messageId: null,
					updatedBy: "lorebook"
				},
				[
					{
						owner: {
							kind: z.owner_kind,
							id: Number(z.owner_id)
						} as StateOwner,
						ownerKey,
						zoneType: z.zone_type,
						entries: kept,
						note: "its tie was taken off the lorebook"
					}
				]
			)
			out.push({
				sessionId: s.id,
				owner: ownerKey,
				zone: z.zone_type,
				retired: entries.length - kept.length
			})
		}
	}
	return out
}

// ── One history (T3) ────────────────────────────────────────────────────────

/** 🚧 One change to a rule-fed row, as its run's receipt tells it. */
export interface TieHistoryLine {
	runId: string
	at: number
	sessionId: number | null
	owner: string
	ownerName: string
	towards?: string
	towardsName?: string
	made?: true
	columns: { target: ReadsOnto; from: unknown; to: unknown }[]
	moved?: Record<string, { from: unknown; to: unknown }>
	note?: string
}

/**
 * 🚧 **How a rule-fed row changed** (T3): read from the receipts of the runs
 * that wrote it — each resolve step's `facts.landings` naming the row — newest
 * first. Never a second versioned source: the row's own words are written in
 * place.
 *
 * 🚧 A run whose moment was taken back — its reply swiped, regenerated or
 * deleted (RF fix 4) — is not history: the receipt stays, but the zone
 * snapshot that moment wrote beside its landings (`updated_by = run:<id>`)
 * went with its message, and so does its line here.
 */
export async function tieHistory(
	db: Db,
	relationshipId: number,
	opts: { limit?: number } = {}
): Promise<TieHistoryLine[]> {
	const [row] = await db
		.select({ lorebookId: R.lorebookId })
		.from(R)
		.where(eq(R.id, relationshipId))
		.limit(1)
	if (!row) return []
	const sessions = (await sessionsReading(db, row.lorebookId)).map(
		(s) => s.id
	)
	if (!sessions.length) return []
	const runs = rawRows<{
		run_id: string
		session_id: number | null
		started_at: Date | string
		receipt: unknown
	}>(
		await db.execute(sql`
			SELECT run_id, session_id, started_at, receipt FROM ${schema.pipelineRuns}
			WHERE session_id IN (${sql.join(
				sessions.map((s) => sql`${s}`),
				sql`, `
			)})
			  AND jsonb_path_exists(receipt::jsonb, '$.nodes[*].output.facts.landings[*] ? (@.relationshipId == $id)', jsonb_build_object('id', ${relationshipId}::int))
			  AND EXISTS (
				SELECT 1 FROM ${schema.zoneContents} z
				WHERE z.session_id = ${schema.pipelineRuns}.session_id AND z.updated_by = 'run:' || ${schema.pipelineRuns}.run_id
			  )
			ORDER BY started_at DESC, id DESC
			LIMIT ${opts.limit ?? 50}
		`)
	)
	const out: TieHistoryLine[] = []
	for (const run of runs) {
		const receipt = (
			typeof run.receipt === "string"
				? JSON.parse(run.receipt)
				: run.receipt
		) as { nodes?: { output?: { facts?: { landings?: LandingFact[] } } }[] }
		for (const n of receipt?.nodes ?? [])
			for (const f of n.output?.facts?.landings ?? [])
				if (f.relationshipId === relationshipId)
					out.push({
						runId: run.run_id,
						at: new Date(run.started_at).getTime(),
						sessionId: run.session_id,
						owner: f.owner,
						ownerName: await nameOfKey(db, f.owner, run.session_id),
						...(f.towards
							? {
									towards: f.towards,
									towardsName: await nameOfKey(db, f.towards, run.session_id)
								}
							: {}),
						...(f.made ? { made: true as const } : {}),
						columns: f.columns.map((c) => ({
							target: c.target,
							from: c.from,
							to: c.to
						})),
						...(f.moved ? { moved: f.moved } : {}),
						...(f.note ? { note: f.note } : {})
					})
	}
	return out
}

// ── The sides of a row, as the lens reads them ──────────────────────────────

/** 🚧 One held side of a rule-fed row, as the lorebook's lens reads it. */
export interface RowSide {
	sessionId: number
	owner: string
	ownerName: string
	towards: string
	zone: string
	entryType: string
	/** The fields that read onto the row (words), by field. */
	onto: { field: string; target: ReadsOnto; label: string; value: unknown }[]
	/** Its number fields, with their bounds. */
	numbers: {
		field: string
		label: string
		value: number | null
		min?: number
		max?: number
	}[]
	exposed: boolean
}

/**
 * 🚧 The held sides a row reads from (screen 3): in the session whose run
 * last wrote it — else every session reading the book — each zone side whose
 * `edge` is the row. Empty for a row drawn and worded by hand.
 */
export async function sidesOfRow(
	db: Db,
	relationshipId: number
): Promise<RowSide[]> {
	const [row] = await db
		.select({ lorebookId: R.lorebookId, rulesRunId: R.rulesRunId })
		.from(R)
		.where(eq(R.id, relationshipId))
		.limit(1)
	if (!row) return []
	let sessions: { id: number; primaryRuleset: string }[] =
		await sessionsReading(db, row.lorebookId)
	if (row.rulesRunId) {
		const [run] = await db
			.select({ sessionId: schema.pipelineRuns.sessionId })
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.runId, row.rulesRunId))
			.limit(1)
		if (run?.sessionId != null)
			sessions = sessions
				.filter((s) => s.id === run.sessionId)
				.concat(sessions.filter((s) => s.id !== run.sessionId))
	}
	const edge = String(relationshipId)
	for (const s of sessions) {
		const ruleset = getRuleset(s.primaryRuleset)
		if (!ruleset) continue
		const ties = tieTypesOf(ruleset)
		if (!ties.size) continue
		const rows = rawRows<{
			owner_kind: string
			owner_id: number
			zone_type: string
			entries: unknown
		}>(
			await db.execute(sql`
				SELECT DISTINCT ON (owner_kind, owner_id, zone_type) owner_kind, owner_id, zone_type, entries
				FROM ${schema.zoneContents}
				WHERE session_id = ${s.id} AND ruleset_id = ${ruleset.id}
				ORDER BY owner_kind, owner_id, zone_type, id DESC
			`)
		)
		const out: RowSide[] = []
		// The row's own side first, then — a two-sided tie — the other person's side towards them,
		// whichever row it reads onto: one tie, both its sides.
		type Found = { z: (typeof rows)[number]; e: ZoneEntry }
		const all: Found[] = rows.flatMap((z) =>
			((Array.isArray(z.entries) ? z.entries : []) as ZoneEntry[])
				.filter(
					(e) =>
						isRecord(e) &&
						isRecord(e.fields) &&
						ties.has(e.entryType)
				)
				.map((e) => ({ z, e }))
		)
		const keyOf = (f: Found) =>
			f.e.sideOwner ??
			(f.z.owner_kind === "session"
				? "world"
				: `${f.z.owner_kind === "session_cast" ? "character" : f.z.owner_kind === "player_seat" ? "player-seat" : f.z.owner_kind === "seated_member" ? "seated-member" : "location"}:${f.z.owner_id}`)
		const own = all.filter((f) => String(f.e.fields.edge ?? "") === edge)
		const back = own.flatMap((f) =>
			tieSidesOf(ties.get(f.e.entryType)) === 2
				? all.filter(
						(g) =>
							g !== f &&
							g.e.entryType === f.e.entryType &&
							keyOf(g) === f.e.fields.towards &&
							g.e.fields.towards === keyOf(f) &&
							!own.includes(g)
					)
				: []
		)
		for (const { z, e } of [...own, ...back]) {
			const tie = ties.get(e.entryType)
			if (!tie) continue
			const ownerKey = keyOf({ z, e })
			const fields = fieldsOf(tie)
			out.push({
				sessionId: s.id,
				owner: ownerKey,
				ownerName: await nameOfKey(db, ownerKey, s.id),
				towards: String(e.fields.towards ?? ""),
				zone: z.zone_type,
				entryType: tie.id,
				onto: Object.entries(tie.readsOnto ?? {}).map(
					([field, target]) => ({
						field,
						target,
						label: fieldLabel(tie, field),
						value: e.fields[field]
					})
				),
				numbers: Object.entries(fields)
					.filter(([k]) => isNumberField(tie, k))
					.map(([k, f]) => {
						const b = f as { min?: number; max?: number }
						const v = e.fields[k]
						return {
							field: k,
							label: fieldLabel(tie, k),
							value: typeof v === "number" ? v : null,
							...(typeof b.min === "number"
								? { min: b.min }
								: {}),
							...(typeof b.max === "number" ? { max: b.max } : {})
						}
					}),
				exposed: e.exposed === true
			})
		}
		if (out.length) return out
	}
	return []
}

/**
 * An owner key's name: a cast member's, a place's title. 🚧 In a session, a
 * `character:<cardId>` key's name is its seat's cast member as read (their
 * own name, else their card's); a seat with no member yet, or no session
 * named, reads the card. A `seated-member:<id>` key is read as its seat's.
 */
async function nameOfKey(db: Db, key: string, sessionId: number | null = null): Promise<string> {
	// 🚧 ⏳ Flip on (`memberForm.ts`): a `seated-member:<M>` / `player-seat:<S>` key is named as its member is read in the session, else by its seat's card.
	if (memberFormOn() && sessionId != null && /^(seated-member|player-seat):\d+$/.test(key.trim())) {
		const t = key.trim()
		const seat = await seatOf(db, sessionId, t)
		const memberId = t.startsWith("seated-member:") ? Number(t.slice("seated-member:".length)) : (seat?.castMemberId ?? null)
		const read = memberId != null ? await memberAsRead(db, memberId, { sessionId }) : null
		if (read?.name) return read.name
		return seat?.cardId != null ? ((await cardsNow(db, [seat.cardId])).get(seat.cardId)?.name ?? key) : key
	}
	if (!memberFormOn() && sessionId != null && key.trim().startsWith("seated-member:")) key = (await storedSeatRef(db, sessionId, key)) ?? key
	const m = /^(character|location|entry):(\d+)$/.exec(key)
	if (!m) return key === "world" ? "The world" : key
	if (m[1] === "character") {
		const cardId = Number(m[2])
		const seat = sessionId != null ? await seatOf(db, sessionId, key) : null
		if (seat?.castMemberId != null) {
			const read = await memberAsRead(db, seat.castMemberId, {
				sessionId: sessionId!
			})
			if (read?.name) return read.name
		}
		return (await cardsNow(db, [cardId])).get(cardId)?.name ?? key
	}
	const [e] = await db
		.select({ title: schema.lorebookEntries.title })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, Number(m[2])))
		.limit(1)
	return e?.title ?? key
}

// ── A held field change, for review (screen 3's Set) ────────────────────────

/** 🚧 The payload of a held change that sets one field of a held entry (kind `value`, like an offer). */
export interface HeldFieldChange {
	heldField: {
		owner: string
		zone: string
		entryType: string
		towards?: string
		name?: string
		field: string
		value: unknown
	}
	ownerLabel?: string
	towardsLabel?: string
	fieldLabel?: string
}

/** Whether a proposal's payload is a held field change. */
export const isHeldFieldPayload = (p: unknown): p is HeldFieldChange =>
	isRecord(p) &&
	isRecord(p.heldField) &&
	typeof p.heldField.owner === "string" &&
	typeof p.heldField.field === "string" &&
	typeof p.heldField.entryType === "string"

/**
 * 🚧 File a held field change for review (screen 3's **Set…**): the game
 * master sets one side's number of a rule-fed row; it waits at the session's
 * gate as any held change does, and lands — with the row following — only
 * when accepted (`decideHeldField`). Refused unless the side is held.
 */
export async function fileHeldFieldChange(
	db: Db,
	input: {
		relationshipId: number
		owner: string
		field: string
		value: number
		userId: number
	}
): Promise<{ proposalId: number; sessionId: number }> {
	const sides = await sidesOfRow(db, input.relationshipId)
	const side = sides.find((s) => s.owner === input.owner)
	if (!side) throw new Error("That side of the tie is not held in a session.")
	const num = side.numbers.find((n) => n.field === input.field)
	if (!num) throw new Error("That is not a number on the tie.")
	if (!Number.isFinite(input.value)) throw new Error("Say a number.")
	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, side.sessionId))
		.limit(1)
	if (!session || session.userId !== input.userId)
		throw new Error("Only the session's game master can set it.")
	const { newestMessageId } = await import("$lib/server/state/write")
	const payload: HeldFieldChange = {
		heldField: {
			owner: side.owner,
			zone: side.zone,
			entryType: side.entryType,
			towards: side.towards,
			field: input.field,
			value: input.value
		},
		ownerLabel: side.ownerName,
		towardsLabel: await nameOfKey(db, side.towards, side.sessionId),
		fieldLabel: num.label
	}
	const [row] = await db
		.insert(schema.stateProposals)
		.values({
			sessionId: side.sessionId,
			messageId: await newestMessageId(db, side.sessionId),
			kind: "value",
			payload: payload as unknown as Record<string, unknown>,
			proposedBy: `user:${input.userId}`
		})
		.returning({ id: schema.stateProposals.id })
	return { proposalId: row.id, sessionId: side.sessionId }
}

/**
 * 🚧 Decide a held field change: Accept sets the field on the held side (a
 * zone snapshot anchored at the proposal's message) and writes what reads
 * onto the lorebook through the one writer; Reject drops it.
 */
export async function decideHeldField(
	tx: Db,
	proposal: {
		id: number
		sessionId: number
		messageId: number | null
		payload: unknown
		proposedBy: string
	},
	accept: boolean,
	mark: (status: "accepted" | "rejected") => Promise<void>
): Promise<{ status: "accepted" | "rejected"; line?: string }> {
	if (!accept) {
		await mark("rejected")
		return { status: "rejected" }
	}
	const p = proposal.payload as HeldFieldChange
	const [session] = await tx
		.select({ primaryRuleset: schema.sessions.primaryRuleset })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, proposal.sessionId))
		.limit(1)
	const ruleset = session ? getRuleset(session.primaryRuleset) : undefined
	if (!ruleset) throw new Error("This session's rules are not installed.")
	const { planZoneOps } = await import("./zones")
	const key = p.heldField.owner
	const facetOwner = ownerOfKey(key, proposal.sessionId)
	if (!facetOwner)
		throw new Error("That side is held by no one this session has.")
	// The holder of the side (its zone's owner): a two-sided tie's own person, else the world.
	const holder =
		tieSidesOf(entryTypesOf(ruleset).get(p.heldField.entryType)) === 1
			? "world"
			: key
	const holderOwner = ownerOfKey(holder, proposal.sessionId)!
	const owners = [
		{
			key: holder,
			owner: holderOwner,
			name: p.ownerLabel ?? holder,
			stats: [],
			repertoires: [],
			custom: [],
			bag: {}
		}
	]
	const zones = await zonesFor(
		tx,
		proposal.sessionId,
		ruleset.id,
		owners as never
	)
	const input = { ruleset, owners, zones } as unknown as EngineInput
	const plan = planZoneOps(input, [
		{
			op: "set",
			owner: holder,
			zone: p.heldField.zone,
			entry: p.heldField.towards
				? {
						entryType: p.heldField.entryType,
						towards: p.heldField.towards
					}
				: (p.heldField.name ?? ""),
			field: p.heldField.field,
			value: p.heldField.value,
			key: "set-by-hand"
		}
	])
	if (plan.refused.length) throw new Error(plan.refused[0]!.why)
	const landings = landingsOf(input, plan.writes)
	const runId = null
	await writeLandings(
		tx,
		{
			sessionId: proposal.sessionId,
			ruleset,
			runId,
			messageId: proposal.messageId
		},
		landings,
		plan.writes
	)
	await writeZones(
		tx,
		{
			sessionId: proposal.sessionId,
			rulesetId: ruleset.id,
			messageId: proposal.messageId,
			updatedBy: proposal.proposedBy || "user"
		},
		plan.writes
	)
	await mark("accepted")
	return { status: "accepted", line: plan.lines[0]?.text }
}

// ── Shared with the model (T5) ──────────────────────────────────────────────

/**
 * 🚧 What the model is told of one held tie side (T5), in words: the far
 * end's name, then each field it shares — words by default, a number only
 * when its field says so. `null` when it shares nothing.
 */
export function tieWordsFor(
	tie: RulesetEntryTypeDecl,
	e: ZoneEntry,
	otherName: string
): string | null {
	const parts: string[] = []
	for (const [k] of Object.entries(fieldsOf(tie))) {
		if (
			k === "towards" ||
			k === "edge" ||
			k === "name" ||
			k === "description"
		)
			continue
		const v = e.fields[k]
		if (v === undefined || v === null || v === "") continue
		const share = modelShareOf(tie.modelShare?.[k])
		if (isNumberField(tie, k)) {
			if (share.number && typeof v === "number")
				parts.push(`${fieldLabel(tie, k).toLowerCase()} ${v}`)
		} else if (share.words) parts.push(String(v))
	}
	return `${otherName}${parts.length ? ` (${parts.join(", ")})` : ""}`
}

/**
 * 🚧 The retrieval arm's reading of rule-fed rows (T5): for each row a held
 * side of this session reads onto, whether its words may be said (the field
 * reading onto its relationship type shares its words) and the numbers it
 * shares. Rows drawn by hand are not in the map.
 */
export async function tieShareForRows(
	db: Db,
	sessionId: number,
	rowIds: readonly number[]
): Promise<
	Map<number, { withholdType?: string; numbers?: Record<string, number> }>
> {
	const out = new Map<
		number,
		{ withholdType?: string; numbers?: Record<string, number> }
	>()
	if (!rowIds.length) return out
	const [s] = await db
		.select({ primaryRuleset: schema.sessions.primaryRuleset })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const ruleset = s ? getRuleset(s.primaryRuleset) : undefined
	if (!ruleset) return out
	const ties = tieTypesOf(ruleset)
	if (!ties.size) return out
	const want = new Set(rowIds.map(String))
	const rows = rawRows<{ entries: unknown }>(
		await db.execute(sql`
			SELECT DISTINCT ON (owner_kind, owner_id, zone_type) entries
			FROM ${schema.zoneContents}
			WHERE session_id = ${sessionId} AND ruleset_id = ${ruleset.id}
			ORDER BY owner_kind, owner_id, zone_type, id DESC
		`)
	)
	for (const z of rows)
		for (const e of (Array.isArray(z.entries)
			? z.entries
			: []) as ZoneEntry[]) {
			const edge =
				isRecord(e) && isRecord(e.fields)
					? String(e.fields.edge ?? "")
					: ""
			if (!want.has(edge)) continue
			const tie = ties.get(e.entryType)
			if (!tie) continue
			const share: {
				withholdType?: string
				numbers?: Record<string, number>
			} = {}
			const typeField = fieldOnto(tie, "relationship-type")
			if (typeField && !modelShareOf(tie.modelShare?.[typeField]).words)
				share.withholdType = typeWords(tie)
			for (const k of Object.keys(fieldsOf(tie)))
				if (
					isNumberField(tie, k) &&
					modelShareOf(tie.modelShare?.[k]).number &&
					typeof e.fields[k] === "number"
				)
					(share.numbers ??= {})[fieldLabel(tie, k).toLowerCase()] = e
						.fields[k] as number
			out.set(Number(edge), share)
		}
	return out
}

// ── On the sheet (screen 2) ─────────────────────────────────────────────────

/** An owner as the state read lists it: its kind and id, and whether it is the viewer's own. */
export interface SheetOwner {
	kind: string
	id: number
	label: string
	mine?: boolean
}

/** A sheet owner's key in the rules' own words: `character:4`, `player-seat:2`, `location:9`, `world` — 🚧 ⏳ and, once the flip is on (`memberForm.ts`), `seated-member:7` (a `seated_member` owner never exists before). */
const rulesKeyOf = (o: { kind: string; id: number }): string =>
	o.kind === "session"
		? "world"
		: o.kind === "session_cast"
			? `character:${o.id}`
			: o.kind === "player_seat"
				? `player-seat:${o.id}`
				: o.kind === "seated_member"
					? `seated-member:${o.id}`
					: `location:${o.id}`

/**
 * 🚧 **The sheet's ties** (screen 2, T1/T5): each owner's tie sides as the
 * stats widget draws them — towards whom, the relationship's name on the
 * lorebook, this side's words (the ones the graph reads always; the rest
 * with its numbers), its numbers where the viewer may see them (its holder,
 * the game master, a side shown to others, a zone everyone sees), and the
 * other person's side towards this owner: its words, its numbers once shown
 * or to the game master or to its own holder. Keyed `<kind>:<id>`.
 */
export async function tiesOnWire(
	db: Db,
	sessionId: number,
	owners: readonly SheetOwner[],
	viewer: { sessionOwner: boolean }
): Promise<Map<string, import("@serene-pub/sdk").SessionStateTieV1[]>> {
	const out = new Map<string, import("@serene-pub/sdk").SessionStateTieV1[]>()
	if (!owners.length) return out
	const [s] = await db
		.select({ primaryRuleset: schema.sessions.primaryRuleset })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const ruleset = s ? getRuleset(s.primaryRuleset) : undefined
	if (!ruleset) return out
	const ties = tieTypesOf(ruleset)
	if (!ties.size) return out
	const zones = new Map(zoneTypesOf(ruleset).map((z) => [z.id, z]))
	const rows = rawRows<{
		owner_kind: string
		owner_id: number
		zone_type: string
		entries: unknown
	}>(
		await db.execute(sql`
			SELECT DISTINCT ON (owner_kind, owner_id, zone_type) owner_kind, owner_id, zone_type, entries
			FROM ${schema.zoneContents}
			WHERE session_id = ${sessionId} AND ruleset_id = ${ruleset.id}
			ORDER BY owner_kind, owner_id, zone_type, id DESC
		`)
	)
	type Held = { holderKey: string; zone: string; entry: ZoneEntry }
	const held: Held[] = []
	for (const z of rows)
		for (const e of (Array.isArray(z.entries)
			? z.entries
			: []) as ZoneEntry[])
			if (isRecord(e) && isRecord(e.fields) && ties.has(e.entryType))
				held.push({
					holderKey: rulesKeyOf({
						kind: z.owner_kind,
						id: Number(z.owner_id)
					}),
					zone: z.zone_type,
					entry: e
				})
	if (!held.length) return out
	// The relationship's name on the lorebook, by each side's edge.
	const edges = [
		...new Set(
			held
				.map((h) => edgeOf(h.entry))
				.filter((x): x is number => x !== null)
		)
	]
	const titles = new Map<number, string>()
	if (edges.length)
		for (const r of await db
			.select({ id: R.id, title: R.title })
			.from(R)
			.where(inArray(R.id, edges)))
			if (r.title) titles.set(r.id, r.title)
	const byKey = new Map(owners.map((o) => [rulesKeyOf(o), o]))
	const nameOf = async (key: string) =>
		byKey.get(key)?.label ?? (await nameOfKey(db, key, sessionId))
	const fieldRow = (tie: RulesetEntryTypeDecl, k: string, v: unknown) => {
		const f = fieldsOf(tie)[k] as
			| (FieldDecl & { min?: number; max?: number })
			| undefined
		return {
			field: k,
			label: fieldLabel(tie, k),
			value: v as string | number,
			...(typeof f?.min === "number" ? { min: f.min } : {}),
			...(typeof f?.max === "number" ? { max: f.max } : {}),
			...(tie.readsOnto?.[k] ? { onto: true as const } : {})
		}
	}
	const sideParts = (
		tie: RulesetEntryTypeDecl,
		e: ZoneEntry,
		seen: boolean
	) => {
		const words: ReturnType<typeof fieldRow>[] = []
		const numbers: ReturnType<typeof fieldRow>[] = []
		for (const k of Object.keys(fieldsOf(tie))) {
			if (
				k === "towards" ||
				k === "edge" ||
				k === "name" ||
				k === "description"
			)
				continue
			const v = e.fields[k]
			if (isNumberField(tie, k)) {
				if (seen && typeof v === "number")
					numbers.push(fieldRow(tie, k, v))
			} else if (
				typeof v === "string" &&
				v.trim() &&
				(seen || tie.readsOnto?.[k])
			)
				words.push(fieldRow(tie, k, v))
		}
		return { words, numbers }
	}
	for (const o of owners) {
		const key = rulesKeyOf(o)
		const list: import("@serene-pub/sdk").SessionStateTieV1[] = []
		for (const h of held) {
			const side = h.entry.sideOwner ?? h.holderKey
			if (side !== key) continue
			const tie = ties.get(h.entry.entryType)!
			const towards =
				typeof h.entry.fields.towards === "string"
					? h.entry.fields.towards
					: ""
			if (!towards) continue
			const zoneSeen =
				zones.get(h.zone)?.visibility === "everyone" ||
				zones.get(h.zone)?.visibility === undefined
			const seen =
				viewer.sessionOwner ||
				o.mine === true ||
				h.entry.exposed === true ||
				zoneSeen
			const mine = sideParts(tie, h.entry, seen)
			const back = held.find(
				(x) =>
					x.entry.entryType === tie.id &&
					x.entry.fields.towards === key &&
					(x.entry.sideOwner ?? x.holderKey) === towards
			)
			const backZoneSeen = back
				? zones.get(back.zone)?.visibility === "everyone" ||
					zones.get(back.zone)?.visibility === undefined
				: false
			const otherSeen =
				!!back &&
				(viewer.sessionOwner ||
					back.entry.exposed === true ||
					backZoneSeen ||
					byKey.get(towards)?.mine === true)
			const edge = edgeOf(h.entry)
			list.push({
				entryType: tie.id,
				label: i18nText(tie.name) ?? tie.id,
				towards,
				towardsLabel: await nameOf(towards),
				...(edge !== null && titles.has(edge)
					? { name: titles.get(edge)! }
					: {}),
				words: mine.words,
				...(mine.numbers.length ? { numbers: mine.numbers } : {}),
				shown: h.entry.exposed === true,
				mayShow: viewer.sessionOwner || o.mine === true,
				...(back
					? (() => {
							const p = sideParts(tie, back.entry, otherSeen)
							return {
								other: {
									words: p.words,
									...(p.numbers.length
										? { numbers: p.numbers }
										: {}),
									shown: back.entry.exposed === true
								}
							}
						})()
					: {})
			})
		}
		if (list.length) out.set(`${o.kind}:${o.id}`, list)
	}
	return out
}

/**
 * 🚧 Show or hide one tie side's numbers to others (screen 2's switch,
 * `set-tie-shown`): the side's `exposed` flag, written as a zone snapshot
 * anchored at the session's newest line. The caller judged who may.
 */
export async function setTieSideShown(
	db: Db,
	input: {
		sessionId: number
		owner: { kind: string; id: number }
		entryType: string
		towards: string
		shown: boolean
		updatedBy: string
	}
): Promise<{ shown: boolean }> {
	const [s] = await db
		.select({ primaryRuleset: schema.sessions.primaryRuleset })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, input.sessionId))
		.limit(1)
	const ruleset = s ? getRuleset(s.primaryRuleset) : undefined
	if (!ruleset) throw new Error("This session's rules are not installed.")
	const tie = tieTypesOf(ruleset).get(input.entryType)
	if (!tie) throw new Error("That is no tie these rules keep.")
	// 🚧 A `seated_member` owner / `seated-member:` far end reads as its seat's stored key (plan §27 S2); a member with no seat holds no side.
	// ⏳ Flip on: a member-less character seat stays card form (the doors answer null for it), so its own key stands.
	const owner =
		(await storedSeatOwner(db, input.sessionId, input.owner)) ??
		(memberFormOn() && input.owner.kind === "session_cast" ? input.owner : null)
	const towards =
		(await storedSeatRef(db, input.sessionId, input.towards)) ??
		(memberFormOn() && /^character:\d+$/.test(input.towards.trim()) ? input.towards : null)
	if (!owner || towards === null) throw new Error("That side of the tie is not held.")
	const sideKey = rulesKeyOf(owner as { kind: string; id: number })
	const holder = tieSidesOf(tie) === 1 ? "world" : sideKey
	const holderOwner = ownerOfKey(holder, input.sessionId)
	if (!holderOwner)
		throw new Error("That side is held by no one this session has.")
	const owners = [
		{
			key: holder,
			owner: holderOwner,
			name: holder,
			stats: [],
			repertoires: [],
			custom: [],
			bag: {}
		}
	]
	const zones = await zonesFor(
		db,
		input.sessionId,
		ruleset.id,
		owners as never
	)
	const { planZoneOps } = await import("./zones")
	const plan = planZoneOps(
		{ ruleset, owners, zones } as unknown as EngineInput,
		[
			{
				op: input.shown ? "reveal" : "hide",
				owner: holder,
				entry: { entryType: tie.id, towards },
				key: "show-by-hand"
			}
		]
	)
	if (plan.refused.length)
		throw new Error("That side of the tie is not held.")
	await writeZones(
		db,
		{
			sessionId: input.sessionId,
			rulesetId: ruleset.id,
			messageId: null,
			updatedBy: input.updatedBy
		},
		plan.writes
	)
	return { shown: input.shown }
}
