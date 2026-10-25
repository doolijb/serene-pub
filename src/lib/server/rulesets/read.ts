/**
 * 🚧 What the ruleset handler reads from a session (BACKBONE §4.2, §4.8).
 *
 * The session's ruleset and rigour (its row), its resolved state (`stateFor`
 * — the same resolution `core:query/session-state@1` publishes), the owners
 * a turn names, the pieces they hold (inline, compendium rows and lore
 * entries, overrides laid over), the ties between owners present
 * (`narrative_relationships` in every lorebook the session reads — its own
 * and its notes, `lorebooksReadBy`), the story's present. The round (a turn) is `rounds.ts`'s.
 *
 * Reads only. `db` is passed in, never imported, so a test hands its own.
 */

import { and, eq, inArray, isNull, ne, or } from "drizzle-orm"
import {
	_entryTypeAsRepertoire,
	attributeSlots,
	getAttributeSlot,
	getRepertoire,
	getRuleset,
	i18nText,
	isSlotPiece,
	parseRepertoireAddress,
	type PieceProps,
	type RulesetDecl,
	type SessionStateRepertoireV1,
	type SlotPiece,
	type SlotPieceResolved,
	type SlotValue,
	type StoryCalendar
} from "@serene-pub/sdk"
import { pieceFacts } from "@serene-pub/core-catalog/session-state"
import * as schema from "$lib/server/db/schema"
import { stateFor, type ResolvedState, type TrackedSlot } from "$lib/server/state/resolve"
import { qualifiedSlotKey, slotKey } from "$lib/server/state/keys"
import { bookCalendarOf, clockOf, clockOfNow, sessionStoryNowOf } from "$lib/server/state/storyTime"
import type { StoryClock } from "$lib/shared/lorebooks/storyDate"
import { storedRulesetSettings, type StoredRulesetSettings } from "./settings"
import type { StateOwner } from "$lib/server/state/owners"
import { lorebooksReadBy } from "$lib/server/lorebooks/ownBook"
import { byString, compendiumRow, loreEntriesById, type EntryText } from "./common"
import { attributeSlotsOf, sectionsOf } from "./functionRun"
import type { HeldPiece, HeldRepertoire, OwnerCustomField, OwnerStat, OwnerView, Tie } from "./types"
import { attachedOrOwnBookOf } from "$lib/server/lorebooks/ownBook"

type Db = Parameters<typeof stateFor>[0]

/** The session row facts the handler needs. */
export interface RulesetSession {
	id: number
	lorebookId: number | null
	lorebookBranchId: number | null
	primaryRuleset: string
	rigour: string
	clock: ReturnType<typeof clockOf>
	/** What the session chose for each ruleset's settings (0105). */
	rulesetSettings: StoredRulesetSettings
}

export async function rulesetSessionOf(db: Db, sessionId: number): Promise<RulesetSession | null> {
	const [row] = await db
		.select({
			id: schema.sessions.id,
			lorebookId: schema.sessions.lorebookId,
			lorebookBranchId: schema.sessions.lorebookBranchId,
			primaryRuleset: schema.sessions.primaryRuleset,
			rigour: schema.sessions.rigour,
			rulesetSettings: schema.sessions.rulesetSettings,
			storyClockYear: schema.sessions.storyClockYear,
			storyClockMonth: schema.sessions.storyClockMonth,
			storyClockDay: schema.sessions.storyClockDay,
			storyClockHour: schema.sessions.storyClockHour,
			storyClockMinute: schema.sessions.storyClockMinute
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row) return null
	return {
		id: row.id,
		lorebookId: row.lorebookId,
		lorebookBranchId: row.lorebookBranchId,
		primaryRuleset: row.primaryRuleset,
		rigour: row.rigour,
		clock: clockOf(row),
		rulesetSettings: storedRulesetSettings(row.rulesetSettings)
	}
}

// ── Owner references ────────────────────────────────────────────────────────

/** An owner a turn names, read: its key, and the owner a write lands on. */
export interface OwnerRef {
	key: string
	owner: StateOwner
	facet: "world" | "cast" | "location"
}

/**
 * Read one owner reference: `world`, `session:<id>` (the world), the
 * participant references `character:<id>` / `player-seat:<id>`,
 * `location:<entryId>`, or a state owner `{ kind, id }` of one of those.
 * Null for anything else.
 */
export function ownerRefOf(raw: unknown, sessionId: number | null): OwnerRef | null {
	let kind: string | undefined
	let id: number | undefined
	if (typeof raw === "string") {
		const s = raw.trim()
		if (s === "world") {
			if (sessionId === null) return null
			return { key: "world", owner: { kind: "session", id: sessionId }, facet: "world" }
		}
		const m = /^(session|character|player-seat|location):(\d+)$/.exec(s)
		if (!m) return null
		kind = { session: "session", character: "session_cast", "player-seat": "player_seat", location: "session_location" }[m[1]!]
		id = Number(m[2])
	} else if (raw && typeof raw === "object") {
		kind = String((raw as { kind?: unknown }).kind ?? "")
		id = (raw as { id?: unknown }).id as number
		if (kind === "location") kind = "session_location"
	}
	if (!Number.isInteger(id) || (id as number) <= 0) return null
	switch (kind) {
		case "session":
			return { key: "world", owner: { kind: "session", id: id! }, facet: "world" }
		case "session_cast":
			return { key: `character:${id}`, owner: { kind: "session_cast", id: id! }, facet: "cast" }
		case "player_seat":
			return { key: `player-seat:${id}`, owner: { kind: "player_seat", id: id! }, facet: "cast" }
		case "session_location":
			return { key: `location:${id}`, owner: { kind: "session_location", id: id! }, facet: "location" }
		default:
			return null
	}
}

/**
 * The session a turn's owners name, when the call's `scope` port is not
 * wired: the world's own owner among `owners` — `session:<id>` or
 * `{ kind: 'session', id }`.
 */
export function sessionOfOwners(raw: unknown): number | null {
	for (const ref of Array.isArray(raw) ? raw : [raw]) {
		const r = ownerRefOf(ref, null)
		if (r?.owner.kind === "session") return r.owner.id
	}
	return null
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/**
 * 🚧 A compendium reference's row, looked up in the repertoire the holding
 * field names first (P2-5, the 100-turn walk's B17: a wizard's spell
 * _Shield_ read as the armour piece _Shield_ — row ids are unique only within
 * their repertoire), then anywhere in its ruleset (a piece kept in a field
 * that names no repertoire).
 */
function rowOf(compendiumId: string, pieceId: string, repertoireId?: string) {
	return (repertoireId !== undefined ? compendiumRow(compendiumId, pieceId, repertoireId) : undefined) ?? compendiumRow(compendiumId, pieceId)
}

/** A stored piece's props: an inline piece itself, a compendium row, or a lore entry — overrides laid over. */
function pieceProps(item: SlotPiece, entries: ReadonlyMap<number, EntryText>, repertoireId?: string): PieceProps {
	if (item.kind === "inline") {
		const { kind: _k, count: _c, ...props } = item
		return props as PieceProps
	}
	if (item.kind === "compendium") {
		const rowProps = rowOf(item.compendiumId, item.pieceId, repertoireId)?.props ?? {}
		return {
			name: item.name ?? item.pieceId,
			description: "",
			...rowProps,
			...(item.overrides ?? {})
		} as PieceProps
	}
	const entry = entries.get(item.entryId)
	return {
		name: entry?.title || item.name || `entry ${item.entryId}`,
		description: entry?.content ?? "",
		...(item.overrides ?? {})
	} as PieceProps
}

function heldPieces(value: SlotValue | undefined, entries: ReadonlyMap<number, EntryText>, repertoireId?: string): HeldPiece[] {
	if (!Array.isArray(value)) return []
	return value
		.filter(isSlotPiece)
		.map((item) => {
			const props = pieceProps(item, entries, repertoireId)
			return {
				key: String(props.name ?? "").trim().toLowerCase(),
				props,
				count: typeof item.count === "number" ? item.count : 1,
				form: item.kind,
				item
			}
		})
		.sort((a, b) => byString(a.key, b.key))
}

// ── Pieces on the wire (§8: the host reads a reference; a widget never carries a compendium) ──

/**
 * 🚧 A referenced piece as the host read it (`SlotPieceResolved`): the entry
 * or the row BEFORE the holder's overrides (the widget lays those over),
 * with its key facts already in words.
 */
export type PieceReading = SlotPieceResolved

/** 🚧 A repertoire as a widget needs it. */
export type RepertoireOnWire = SessionStateRepertoireV1

const textOr = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined)

/**
 * 🚧 A compendium reference's row, read: its name, description, prose and
 * traits, and its key facts labelled by its repertoire's piece shape. The
 * row is looked up in `repertoireId` — the repertoire the holding field
 * names — first, then in every repertoire of its ruleset (P2-5: ids are
 * unique within a repertoire only); `undefined` when the ruleset is not
 * installed or has no such row.
 */
export function compendiumReadingOf(item: { compendiumId: string; pieceId: string }, repertoireId?: string): PieceReading | undefined {
	const decl = getRuleset(item.compendiumId)
	const found = decl
		? ((repertoireId !== undefined ? compendiumRow(decl, item.pieceId, repertoireId) : undefined) ?? compendiumRow(decl, item.pieceId))
		: undefined
	if (!decl || !found) return undefined
	const { props } = found
	const shape = decl.repertoires.find((r) => r.id === found.repertoireId)?.piece
	const traits = Array.isArray(props.traits) ? props.traits.filter((t): t is string => typeof t === "string") : []
	const compendiumName = i18nText(decl.name)
	return {
		name: textOr(props.name) ?? item.pieceId,
		...(textOr(props.description) ? { description: props.description as string } : {}),
		...(textOr(props.prose) ? { prose: props.prose as string } : {}),
		...(traits.length ? { traits } : {}),
		keyProps: pieceFacts(props, shape).map((f) => ({ key: f.key, label: f.label, value: f.text })),
		...(compendiumName ? { compendiumName } : {})
	}
}

/** 🚧 A lore piece's entry, read: its title and its text. A lore entry has no piece fields, so no key facts. */
export const loreReadingOf = (entry: EntryText): PieceReading => ({
	name: entry.title,
	...(entry.content.trim() ? { description: entry.content } : {}),
	keyProps: []
})

/** One stored value with each reference piece's `resolved` filled; untouched (same object) when it holds none. */
function valueRead(value: unknown, entries: ReadonlyMap<number, EntryText>, repertoireId?: string): unknown {
	if (!Array.isArray(value) || !value.some((i) => isSlotPiece(i) && i.kind !== "inline")) return value
	return value.map((item) => {
		if (!isSlotPiece(item) || item.kind === "inline") return item
		const entry = item.kind === "lore" ? entries.get(item.entryId) : undefined
		const resolved = item.kind === "compendium" ? compendiumReadingOf(item, repertoireId) : entry ? loreReadingOf(entry) : undefined
		return resolved ? { ...item, resolved } : item
	})
}

/**
 * 🚧 The repertoire each list field holds, by the keys a state bag files it
 * under (its bare and its qualified key) — what a bag's compendium pieces
 * are looked up in (P2-5). From the slot declarations' `config.repertoire`.
 */
function repertoireByKey(): ReadonlyMap<string, string> {
	const out = new Map<string, string>()
	for (const decl of attributeSlots()) {
		const address = (decl.config as { repertoire?: unknown } | undefined)?.repertoire
		const parsed = typeof address === "string" ? parseRepertoireAddress(address) : undefined
		if (!parsed) continue
		out.set(slotKey(decl.id), parsed.repertoire)
		out.set(qualifiedSlotKey(decl.id), parsed.repertoire)
	}
	return out
}

const bagRead = (bag: Record<string, unknown>, entries: ReadonlyMap<number, EntryText>, reps: ReadonlyMap<string, string> = repertoireByKey()): Record<string, unknown> => {
	let out: Record<string, unknown> | null = null
	for (const [k, v] of Object.entries(bag)) {
		const read = valueRead(v, entries, reps.get(k))
		if (read !== v) (out ??= { ...bag })[k] = read
	}
	return out ?? bag
}

/** An index (`cast`, `locations`): `byId` and every slug key, one bag read once where both name it. */
function indexRead<I extends { byId?: Record<string, unknown> }>(
	index: I | undefined,
	entries: ReadonlyMap<number, EntryText>,
	reps: ReadonlyMap<string, string> = repertoireByKey()
): I | undefined {
	if (!index || typeof index !== "object") return index
	const memo = new Map<object, object>()
	const one = (bag: unknown) => {
		if (!bag || typeof bag !== "object" || Array.isArray(bag)) return bag
		if (!memo.has(bag)) memo.set(bag, bagRead(bag as Record<string, unknown>, entries, reps))
		return memo.get(bag)
	}
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(index))
		out[k] = k === "byId" && v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([id, bag]) => [id, one(bag)])) : one(v)
	return out as I
}

/** The lore entries every lore piece in these bags names. */
function lorePieceIds(state: { world?: unknown; cast?: unknown; locations?: unknown }): Set<number> {
	const ids = new Set<number>()
	const walk = (v: unknown, depth: number) => {
		if (Array.isArray(v)) {
			for (const i of v) if (isSlotPiece(i) && i.kind === "lore") ids.add(i.entryId)
		} else if (v && typeof v === "object" && depth < 3) for (const sub of Object.values(v)) walk(sub, depth + 1)
	}
	walk(state.world, 1)
	walk(state.cast, 0)
	walk(state.locations, 0)
	return ids
}

/**
 * 🚧 The state as a widget is sent it: every `lore` and `compendium` piece
 * with its `resolved` reading filled (§8 — the host reads a reference; the
 * widget carries no compendium and reads no lorebook). Pure; `entries` are
 * the lore entries the pieces name. Never stored: the write path drops
 * `resolved` (`slotValueForStorage`).
 */
export function piecesRead<S extends { world?: unknown; cast?: unknown; locations?: unknown }>(
	state: S,
	entries: ReadonlyMap<number, EntryText>
): S {
	const reps = repertoireByKey()
	return {
		...state,
		...(state.world && typeof state.world === "object" ? { world: bagRead(state.world as Record<string, unknown>, entries, reps) } : {}),
		...(state.cast ? { cast: indexRead(state.cast as { byId?: Record<string, unknown> }, entries, reps) } : {}),
		...(state.locations ? { locations: indexRead(state.locations as { byId?: Record<string, unknown> }, entries, reps) } : {})
	}
}

/** 🚧 `piecesRead`, with the lore entries its pieces name read from the database in one query. */
export async function withPiecesRead<S extends { world?: unknown; cast?: unknown; locations?: unknown }>(db: Db, state: S): Promise<S> {
	return piecesRead(state, await loreEntriesById(db, lorePieceIds(state)))
}

/**
 * 🚧 The repertoires an owner's list stats hold (`config.repertoire`), by
 * address — each one's name and piece shape, from the SDK's registry. What a
 * widget labels a piece's facts and draws its form from (§8). `undefined`
 * when the owner holds none, or none this install declares.
 */
export function repertoiresOnWire(
	configs: Readonly<Record<string, Readonly<Record<string, unknown>>>>
): Record<string, RepertoireOnWire> | undefined {
	const out: Record<string, RepertoireOnWire> = {}
	for (const config of Object.values(configs)) {
		const address = config?.repertoire
		if (typeof address !== "string" || !address || out[address]) continue
		const rep = getRepertoire(address)
		if (rep) out[address] = { label: i18nText(rep.label) ?? rep.id, piece: rep.piece }
	}
	return Object.keys(out).length ? out : undefined
}

// ── Owners ──────────────────────────────────────────────────────────────────

function bagOf(state: ResolvedState, ref: OwnerRef): { bag: Record<string, SlotValue>; name: string; configKey: string } | null {
	if (ref.facet === "world") return { bag: state.world, name: "The world", configKey: "world" }
	if (ref.facet === "location") {
		const entry = state.locations?.byId?.[String(ref.owner.id)]
		return entry ? { bag: entry as Record<string, SlotValue>, name: entry.name, configKey: `location:${ref.owner.id}` } : null
	}
	const key = ref.owner.kind === "player_seat" ? `player_seat:${ref.owner.id}` : String(ref.owner.id)
	const entry = state.cast?.byId?.[key]
	return entry ? { bag: entry as Record<string, SlotValue>, name: entry.name, configKey: key } : null
}

/** 🚧 An entry type of a ruleset in sections, read as the repertoire its list slots hold (D5). */
function entryTypeRepertoire(ruleset: RulesetDecl, id: string) {
	const et = sectionsOf(ruleset).entryTypes?.find((e) => e.id === id && e.entryable !== false)
	return et ? _entryTypeAsRepertoire(et) : undefined
}

const valueIn = (bag: Record<string, SlotValue>, slotId: string): SlotValue | undefined =>
	bag[qualifiedSlotKey(slotId)] ?? bag[slotKey(slotId)]

const labelOf = (slot: TrackedSlot): string => i18nText(getAttributeSlot(slot.id)?.label) ?? slot.key

/** Build each named owner's view: the ruleset's stats, its repertoires, and every other field as prose. */
export async function ownerViews(
	db: Db,
	state: ResolvedState,
	ruleset: RulesetDecl,
	refs: readonly OwnerRef[]
): Promise<OwnerView[]> {
	// 🚧 The ruleset's own attributes (a ruleset in sections, D2) are its
	// stats too: each filed under the slot it names, else its derived one.
	const statIds = new Map<string, { id: string; config?: Record<string, unknown> }>(ruleset.stats.map((s) => [s.id, s]))
	const attributeVis = new Map<string, string>()
	/** 🚧 The free text attributes' slots (RF fix 2, item 2): read as sentences. */
	const proseIds = new Set<string>()
	for (const a of sectionsOf(ruleset).attributes ?? []) {
		const id = attributeSlotsOf(ruleset).slotOf.get(a.id)
		if (!id) continue
		if (!statIds.has(id)) statIds.set(id, { id, ...(a.config ? { config: a.config as Record<string, unknown> } : {}) })
		if (a.visibility) attributeVis.set(id, a.visibility)
		if (a.kind === "text") proseIds.add(id)
	}
	const views: { ref: OwnerRef; found: NonNullable<ReturnType<typeof bagOf>> }[] = []
	for (const ref of refs) {
		const found = bagOf(state, ref)
		if (found) views.push({ ref, found })
	}
	// Lore pieces read their entry's title and text, once for every owner.
	const entryIds = new Set<number>()
	for (const { found } of views)
		for (const v of Object.values(found.bag))
			if (Array.isArray(v)) for (const i of v) if (isSlotPiece(i) && i.kind === "lore") entryIds.add(i.entryId)
	const entries = await loreEntriesById(db, entryIds)
	return views.map(({ ref, found }) => {
		const stats: OwnerStat[] = []
		const repertoires: HeldRepertoire[] = []
		const custom: OwnerCustomField[] = []
		// 🚧 What this holder does not carry is not read for them (attribute carries, RF fix 2 item 3).
		const off = new Set(state.notCarried?.[found.configKey] ?? [])
		for (const slot of state.slots) {
			if (!slot.appliesTo.includes(ref.facet)) continue
			if (off.has(slot.id)) continue
			const decl = getAttributeSlot(slot.id)
			const value = valueIn(found.bag, slot.id)
			const config = { ...(decl?.config ?? {}), ...(state.configs?.[found.configKey]?.[slot.id] ?? {}) }
			const address = typeof config.repertoire === "string" ? parseRepertoireAddress(config.repertoire) : undefined
			if (statIds.has(slot.id)) {
				const entry = statIds.get(slot.id)! as { config?: Record<string, unknown> }
				stats.push({
					slotId: slot.id,
					selector: slotKey(slot.id),
					type: slot.type,
					value,
					...(decl?.type === "derived" && typeof decl.derive === "string" ? { derive: decl.derive } : {}),
					...(entry.config?.showNumbers === true || (config as Record<string, unknown>).showNumbers === true
						? { showNumbers: true }
						: {}),
					...(slot.earshot === "holder" || attributeVis.get(slot.id) === "holder" ? { holderOnly: true } : {}),
					...(attributeVis.has(slot.id) ? { visibility: attributeVis.get(slot.id) } : {}),
					...(proseIds.has(slot.id) ? { prose: true as const } : {}),
					label: labelOf(slot),
					...(typeof (config as Record<string, unknown>).max === "number" ? { max: (config as Record<string, unknown>).max as number } : {})
				})
			} else if (address?.ruleset === ruleset.id) {
				// 🚧 A ruleset in sections (D5): its entry types are its repertoires.
				const rep = ruleset.repertoires.find((r) => r.id === address.repertoire) ?? entryTypeRepertoire(ruleset, address.repertoire)
				if (rep) repertoires.push({ slotId: slot.id, repertoire: rep, pieces: heldPieces(value, entries, rep.id) })
			} else if (address && slot.type === "list")
				// 🚧 A repertoire of a ruleset the session does not play (PLAN §15
				// B: it degrades to its pieces' names and words, never drops) —
				// kept as a field in words, empty or not, so a change the turn
				// proposes for it still lands (P2-6, owner ruling ★10: the Story
				// ruleset keeps a sheet with items in words).
				custom.push({
					slotId: slot.id,
					label: labelOf(slot),
					value: value ?? [],
					parked: address,
					...(slot.earshot === "holder" ? { holderOnly: true } : {})
				})
			else if (value !== undefined && value !== null && slot.type !== "derived")
				// A field the ruleset does not own reads as prose.
				custom.push({ slotId: slot.id, label: labelOf(slot), value, ...(slot.earshot === "holder" ? { holderOnly: true } : {}) })
		}
		// Fields in the ruleset's order, repertoires in its declaration order.
		const order = new Map([...statIds.keys()].map((id, i) => [id, i]))
		stats.sort((a, b) => order.get(a.slotId)! - order.get(b.slotId)!)
		const repOrder = new Map([...ruleset.repertoires.map((r) => r.id), ...(sectionsOf(ruleset).entryTypes ?? []).map((e) => e.id)].map((id, i) => [id, i]))
		repertoires.sort((a, b) => repOrder.get(a.repertoire.id)! - repOrder.get(b.repertoire.id)! || (a.slotId < b.slotId ? -1 : 1))
		custom.sort((a, b) => byString(a.slotId, b.slotId))
		return {
			key: ref.key,
			owner: ref.owner,
			name: found.name,
			stats,
			repertoires,
			custom,
			bag: found.bag
		}
	})
}

// ── Ties ────────────────────────────────────────────────────────────────────

/**
 * The relationships between owners present, from every lorebook the session
 * reads (its own and its notes). A `secret` tie never renders here — the
 * game-master-facing steps are a later lane — and only active ones do.
 */
export async function tiesBetween(db: Db, session: RulesetSession, views: readonly OwnerView[]): Promise<Tie[]> {
	const books = await lorebooksReadBy(db, { id: session.id, lorebookId: session.lorebookId })
	if (!books.ids.length) return []
	const castIds = views.filter((v) => v.owner.kind === "session_cast").map((v) => v.owner.id)
	const bindingKey = new Map<number, string>()
	if (castIds.length) {
		const bindings = await db
			.select({ id: schema.lorebookBindings.id, characterId: schema.lorebookBindings.characterId })
			.from(schema.lorebookBindings)
			.where(and(inArray(schema.lorebookBindings.lorebookId, books.ids), inArray(schema.lorebookBindings.characterId, castIds)))
		for (const b of bindings) if (b.characterId != null) bindingKey.set(b.id, `character:${b.characterId}`)
	}
	const entryKey = new Map<number, string>(
		views.filter((v) => v.owner.kind === "session_location").map((v) => [v.owner.id, v.key])
	)
	if (!bindingKey.size && !entryKey.size) return []
	const r = schema.narrativeRelationships
	const rows = await db
		.select({
			id: r.id,
			lorebookId: r.lorebookId,
			fromNodeId: r.fromNodeId,
			toNodeId: r.toNodeId,
			fromEntryId: r.fromEntryId,
			toEntryId: r.toEntryId,
			type: r.relationshipType,
			reverseType: r.reverseRelationshipType,
			title: r.title,
			description: r.description,
			branchId: r.branchId
		})
		.from(r)
		.where(
			and(
				inArray(r.lorebookId, books.ids),
				eq(r.status, "active"),
				ne(r.visibility, "secret"),
				// The attached book on the session's line; the notes are the session's own.
				or(
					isNull(r.branchId),
					session.lorebookBranchId != null ? eq(r.branchId, session.lorebookBranchId) : undefined,
					books.ownBookId != null ? eq(r.lorebookId, books.ownBookId) : undefined
				)
			)
		)
	const end = (node: number | null, entry: number | null) =>
		node != null ? bindingKey.get(node) : entry != null ? entryKey.get(entry) : undefined
	const ties: Tie[] = []
	// 🚧 A cast tie the session's notes overlay (ties on the graph, T2: a
	// rule-fed row of a book the session may not write) reads in the book's
	// row's place — one perspective, one row.
	const overlaid = new Set(
		books.ownBookId == null
			? []
			: rows
					.filter((r) => r.lorebookId === books.ownBookId && r.fromNodeId != null && r.toNodeId != null)
					.map((r) => `${r.fromNodeId}>${r.toNodeId}`)
	)
	for (const row of rows) {
		if (row.lorebookId !== books.ownBookId && row.fromNodeId != null && row.toNodeId != null && overlaid.has(`${row.fromNodeId}>${row.toNodeId}`)) continue
		const from = end(row.fromNodeId, row.fromEntryId)
		const to = end(row.toNodeId, row.toEntryId)
		if (!from || !to) continue
		ties.push({
			id: row.id,
			from,
			to,
			type: row.type,
			reverseType: row.reverseType,
			title: row.title,
			description: row.description
		})
	}
	return ties.sort((a, b) => a.id - b.id)
}

// ── Time and turns ──────────────────────────────────────────────────────────

/**
 * The story's present on the session's calendar — its own clock, else its
 * line's present — with the book's calendar (null for free-form) so the
 * engine sums dates with real month lengths. Null with no clock.
 */
export async function storyClockOf(
	db: Db,
	session: RulesetSession
): Promise<{ now: StoryClock; calendar: StoryCalendar | null } | null> {
	// 🚧 pr-6 (§B-3a): no shared book — the session's own book.
	const book = session.lorebookId ?? (await attachedOrOwnBookOf(db, session.id))
	const now = book != null ? await sessionStoryNowOf(db, session.id) : null
	const clock = now ? clockOfNow(now) : session.clock
	if (!clock) return null
	const calendar = book != null ? await bookCalendarOf(db, book) : null
	return { now: clock, calendar }
}

