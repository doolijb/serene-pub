/**
 * 🚧 The `seat-keys` boot pass (plan §34.1, seat-cast S4): flips the stored
 * keys of a carded seat's state from card form to member form. A character
 * seat's values `{ kind: "session_cast", id: <cardId> }` become
 * `{ kind: "seated_member", id: <cast member id> }`; a player seat's become
 * `{ kind: "player_seat", id: <session_personas.id> }` — exactly what
 * `seatOf("character:<card>")` answers today, through the one translator
 * (`state/seatRefs.ts`: `loadSeatMap`, `memberFormOf`, `memberFormTargetsOf`).
 * ⏳ Lives until S5 drops card form.
 *
 * This module holds every store, one step each, in this order: the owner
 * columns (`attribute_values`, `attribute_configs`, `zone_contents`,
 * `owner_sheets`, `attribute_carries`), `state_proposals`, then the JSON
 * stores — `zone_towards` (a tie's other end in a zone's held entries),
 * `annex_core` (the `turn_order` and `turn_tally` columns, and the `core` annex
 * document's Dungeon Crawler `progress.fates`), `annex_audiences`, `genre_fields`
 * (`speechAutoVoice:` keys), `widget_settings` (`chosenImages`, `pickMembers`),
 * `message_speakers` (`session_messages.metadata.speaker`), `message_blocks`
 * (a `core:blocks` part's `addressee` / `answered.by`), `rewind_taken` (what Back
 * took) and `annex_imprints` (the `annex` rows of `session_imprints`: a key's
 * audiences, and the Dungeon Crawler's `progress.fates` in its values). Each JSON store is a pure rewrite of the parsed
 * document (the `rekey…` functions) plus a thin step that writes back only a row that
 * changed, as raw SQL so no `updated_at` moves.
 *
 * **Two rules for a card-form ref in JSON.** A *value held per seat*, or a set
 * of who may see (audiences, fates, auto-voice keys, `pickMembers`), goes to
 * **every** seat holding the card (★K-2), de-duplicated. A *designation of one
 * participant* (who spoke, who is addressed, a tie's other end, a turn, a
 * tally's last speaker) goes to **one** seat — `memberFormOf`, or where the item
 * says which seat kind it is (a turn candidate's `kind`, a message row's
 * persona / character) that seat kind's. Only an exact `character:<digits>` is
 * ever translated; names, `envoy:`, `user:`, `owner`, member forms and bare
 * numbers are left as they are.
 *
 * **Precondition.** The `seat-members` pass (earlier at boot) gives every live
 * carded seat its cast member first, so this pass never mints one.
 *
 * **Leaves** (★K-3, not owner keys of a seat's
 * values): genre-scoped `session_layout_presets.layout.widgetSettings`,
 * `lorebooks.annex_audiences`, `rankings.speaker_ref`, receipts' portrayals,
 * `session_changes.payload`, the Mundi annex.
 *
 * - **Not critical.** One transaction per session, using only `tx`. A session
 *   that throws is rolled back alone, counted in `failed` and logged by id; the
 *   rest are not rolled back with it. After the loop a non-zero `failed`
 *   throws one error naming the count, so the startup task (`failsHealth`)
 *   reports it.
 * - **A no-op fast path.** One query names the sessions holding a card-form
 *   row in any store. None: zeros, and nothing else is read.
 * - **Idempotent.** A second run changes nothing. What no seat can take (a
 *   hard-deleted card, a member-less seat) is left in card form and counted in
 *   `left` again on every run, until S5.
 *   A store whose left items recur keeps its session a candidate on every run:
 *   a chosen image on a player seat (`widget_settings`) and any card-form item
 *   no seat can take.
 * - **Not in the startup list until wave 3**, together with the readers' flip;
 *   nothing runs it before then.
 *
 * ⚠ Must not statically import `$lib/server/db`; the handle is the first argument.
 */
import { and, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { lockSessionAnnex } from "$lib/server/sessions/coreAnnex"
import { SPEECH_AUTO_VOICE_PREFIX } from "$lib/shared/sessions/speechSettings"
import {
	loadSeatMap,
	memberFormOf,
	memberFormTargetsOf,
	type SeatMap
} from "$lib/server/state/seatRefs"

/** Every store the pass rekeys, in the order its steps run. */
export const SEAT_KEY_STORES = [
	"attribute_values",
	"attribute_configs",
	"zone_contents",
	"owner_sheets",
	"attribute_carries",
	"state_proposals",
	"zone_towards",
	"annex_core",
	"annex_audiences",
	"genre_fields",
	"widget_settings",
	"message_speakers",
	"message_blocks",
	"rewind_taken",
	"annex_imprints"
] as const
export type SeatKeyStore = (typeof SEAT_KEY_STORES)[number]

export interface SeatKeysReport {
	/** Sessions whose transaction changed something. */
	sessions: number
	/** Rows (or JSON documents) moved to member form, per store. */
	rekeyed: Record<SeatKeyStore, number>
	/** ★K-2: extra rows written so each seat holding one card keeps the value it shows today. */
	copied: number
	/** Merged-pair rows dropped on a unique key (the survivor's, else the newest, is kept). */
	dropped: number
	/** Card-form items no seat can take (a hard-deleted card, a member-less seat) — counted and left. */
	left: number
	/** Sessions whose transaction threw and was rolled back. */
	failed: number
}

const zeroRekeyed = () =>
	Object.fromEntries(SEAT_KEY_STORES.map((s) => [s, 0])) as Record<
		SeatKeyStore,
		number
	>

/** What one session's steps did; merged into the report only after the transaction commits. */
export interface SeatRefsTally {
	rekeyed: Record<SeatKeyStore, number>
	copied: number
	dropped: number
	left: number
}

const changed = (t: SeatRefsTally): boolean =>
	t.copied > 0 || t.dropped > 0 || Object.values(t.rekeyed).some((n) => n > 0)

// ─── The translator: what a rekey moves ──────────────────────────────────────

/** Which seat(s) a ref lands on: a value per seat → every; a designation → one, hinted where the item says. */
export type SeatPick = "every" | "one" | "player" | "character"

/** 🚧 What a rekey moves and where: the boot pass's card-form translator, or a fold's member move. */
export interface SeatRefTranslator {
	/** Owner kinds whose rows it may move (`session_cast` for card form). */
	ownerKinds: readonly string[]
	/** POSIX regex text (no anchors) matching a ref it may move inside JSON text, for the SQL pre-filters (card form: `"character:[0-9]`). */
	refSql: string
	/** The owner(s) an owner row becomes: null = not moved by this translator; [] = should move but no target (counted in `left`). */
	owner(
		owner: { kind: string; id: number },
		pick: SeatPick
	): { kind: string; id: number }[] | null
	/** The ref(s) a ref string becomes: null = not moved; [] = left. */
	ref(ref: string, pick: SeatPick): string[] | null
	/** When a merged pair's rows land on one unique key: the moved owner id (a card id for card form) whose row wins, else the newest wins. */
	survivor?(target: { kind: string; id: number }): number | null
}

const CARD_REF = /^character:\d+$/

/**
 * PURE — the member form(s) a card-form ref stands for; `[]` when no seat can
 * take it. `every`: one per seat (a value per seat, a set of who may see —
 * ★K-2). `one`: the seat `seatOf` finds (a designation of one participant).
 * `player` / `character`: the designation of the seat kind the stored item
 * says it is, else `one`.
 */
function cardTargets(map: SeatMap, ref: string, pick: SeatPick): string[] {
	if (pick === "every") return memberFormTargetsOf(map, ref)
	if (pick === "player" || pick === "character") {
		const prefix = pick === "player" ? "player-seat:" : "seated-member:"
		const hit = memberFormTargetsOf(map, ref).find((t) =>
			t.startsWith(prefix)
		)
		if (hit) return [hit]
	}
	const one = memberFormOf(map, ref)
	return one === null ? [] : [one]
}

/**
 * The boot pass's translator: card form to member form through one session's
 * seat map. Only an exact `character:<digits>` and an owner of kind
 * `session_cast` are moved; names, `envoy:`, `user:`, `owner`, member forms and
 * bare numbers are not.
 */
function cardFormTranslator(map: SeatMap): SeatRefTranslator {
	return {
		...CARD_FORM_SQL,
		owner(owner, pick) {
			if (owner.kind !== "session_cast") return null
			const targets =
				pick === "every"
					? memberFormTargetsOf(map, owner)
					: [memberFormOf(map, owner)]
			return targets.flatMap((t) =>
				t === null ? [] : [{ kind: String(t.kind), id: t.id as number }]
			)
		},
		ref(ref, pick) {
			if (!CARD_REF.test(ref)) return null
			return cardTargets(map, ref, pick)
		},
		survivor(target) {
			if (target.kind !== "seated_member") return null
			return (
				map.seats.find(
					(s) =>
						s.kind === "character" && s.castMemberId === target.id
				)?.cardId ?? null
			)
		}
	}
}

const SEATED_MEMBER_REF = /^seated-member:(\d+)$/

/**
 * 🚧 PURE — the translator of a fold: a cast member's id in `moves` becomes the
 * id it maps to, in an owner row `{ kind: "seated_member", id }` and in a ref
 * string `seated-member:<id>`. One target for any pick. Every other owner and
 * ref (a player seat, card form, a member not in `moves`) is not moved, so a
 * caller never parses a ref string itself.
 */
export function memberMoveTranslator(
	moves: ReadonlyMap<number, number>
): SeatRefTranslator {
	return {
		ownerKinds: ["seated_member"],
		refSql: `"seated-member:[0-9]`,
		owner(owner) {
			const to =
				owner.kind === "seated_member" ? moves.get(owner.id) : undefined
			return to === undefined ? null : [{ kind: "seated_member", id: to }]
		},
		ref(ref) {
			const hit = SEATED_MEMBER_REF.exec(ref)
			const to = hit ? moves.get(Number(hit[1])) : undefined
			return to === undefined ? null : [`seated-member:${to}`]
		}
	}
}

// ─── Pure: one row, one payload ──────────────────────────────────────────────

type OwnerRow = { ownerKind: string; ownerId: number }

const sameOwner = (a: OwnerRow, b: OwnerRow) =>
	a.ownerKind === b.ownerKind && a.ownerId === b.ownerId

/**
 * PURE — the rows one owner-column row becomes (★K-2): the row itself under
 * the first target, then a copy under each further target (the seats that hold
 * a card). `left` is true (and `rows` empty) when the translator moves the row
 * and has no target for it. A row the translator does not move comes back as
 * `[row]` with `moved` false.
 */
function rekeyOwnerRow<R extends OwnerRow>(
	row: R,
	tr: SeatRefTranslator
): { rows: R[]; left: boolean; moved: boolean } {
	const targets = tr.owner({ kind: row.ownerKind, id: row.ownerId }, "every")
	if (targets === null) return { rows: [row], left: false, moved: false }
	const rows: R[] = []
	for (const t of targets) {
		const next = { ...row, ownerKind: t.kind, ownerId: t.id }
		// Two seats of one member name one key: the value is written once.
		if (!rows.some((r) => sameOwner(r, next))) rows.push(next)
	}
	return { rows, left: rows.length === 0, moved: true }
}

/**
 * PURE — a `state_proposals` payload (or one held elsewhere) with its
 * `owner` moved by the translator and every other key as it was. A proposal
 * names one owner, so the first target only. `left` is true when the translator
 * moves the owner and has no target for it (the payload is then returned as it
 * is). A `clock` or `library` payload, or one whose owner is not moved, is
 * unchanged.
 */
function rekeyProposalPayload(
	payload: Record<string, unknown>,
	tr: SeatRefTranslator
): { payload: Record<string, unknown>; changed: boolean; left: boolean } {
	const owner = payload.owner as { kind?: unknown; id?: unknown } | undefined
	if (
		!owner ||
		typeof owner !== "object" ||
		typeof owner.kind !== "string" ||
		typeof owner.id !== "number"
	)
		return { payload, changed: false, left: false }
	const targets = tr.owner({ kind: owner.kind, id: owner.id }, "one")
	if (targets === null) return { payload, changed: false, left: false }
	const [target] = targets
	if (target === undefined) return { payload, changed: false, left: true }
	return {
		payload: { ...payload, owner: target },
		changed: true,
		left: false
	}
}

// ─── Owner-column stores ─────────────────────────────────────────────────────

/** SQL: the translator's owner kinds as a parameter list. */
const kindList = (tr: SeatRefTranslator): SQL =>
	sql.join(
		tr.ownerKinds.map((k) => sql`${k}`),
		sql`, `
	)

/** Set-based: the tables that can hold thousands of rows of a session and have no unique owner key. */
async function rekeyBulk(
	tx: Db,
	store: SeatKeyStore,
	table: PgTable,
	tableName: string,
	sessionId: number,
	tr: SeatRefTranslator,
	tally: SeatRefsTally
): Promise<void> {
	const t = sql.raw(tableName)
	const cols = sql.raw(
		Object.values(getTableColumns(table))
			.map((c) => c.name)
			.filter((n) => n !== "id" && n !== "owner_kind" && n !== "owner_id")
			.map((n) => `"${n}"`)
			.join(", ")
	)
	const owners = rawRows<{ owner_kind: string; owner_id: number; n: number }>(
		await tx.execute(sql`
			select owner_kind, owner_id, count(*)::int as n from ${t}
				where session_id = ${sessionId} and owner_kind in (${kindList(tr)})
				group by owner_kind, owner_id order by owner_kind, owner_id`)
	)
	for (const { owner_kind, owner_id, n } of owners) {
		const fromId = Number(owner_id)
		const { rows: targets, moved: isMoved } = rekeyOwnerRow(
			{ ownerKind: owner_kind, ownerId: fromId },
			tr
		)
		if (!isMoved) continue
		if (targets.length === 0) {
			tally.left += Number(n)
			continue
		}
		// Copies first, from the rows still in card form.
		for (const extra of targets.slice(1)) {
			const done = rawRows(
				await tx.execute(sql`
					insert into ${t} (${cols}, owner_kind, owner_id)
					select ${cols}, ${extra.ownerKind}::text, ${extra.ownerId}::int from ${t}
						where session_id = ${sessionId} and owner_kind = ${owner_kind} and owner_id = ${fromId}
						order by id
					returning id`)
			)
			tally.copied += done.length
		}
		const first = targets[0]!
		const moved = rawRows(
			await tx.execute(sql`
				update ${t} set owner_kind = ${first.ownerKind}, owner_id = ${first.ownerId}
					where session_id = ${sessionId} and owner_kind = ${owner_kind} and owner_id = ${fromId}
					returning id`)
		)
		tally.rekeyed[store] += moved.length
	}
}

interface UniqueRow extends OwnerRow {
	id: number
	createdAt: Date
}

interface Plan<R extends UniqueRow> {
	deleteIds: number[]
	updates: { id: number; ownerKind: string; ownerId: number }[]
	inserts: R[]
	rekeyed: number
	copied: number
	dropped: number
	left: number
}

/**
 * PURE — the writes for a store with a unique owner key. `existing` are the
 * session's rows the translator does not move; `moving` the rows it does. Rows
 * that land on one key: the translator's survivor row wins (card form: the
 * survivor seat's card's), else the newest (`created_at`, then `id`).
 */
function planUnique<R extends UniqueRow>(
	existing: R[],
	moving: R[],
	tr: SeatRefTranslator,
	keyOf: (row: R) => string
): Plan<R> {
	interface Cand {
		row: R
		copy: boolean
		existing: boolean
	}
	const plan: Plan<R> = {
		deleteIds: [],
		updates: [],
		inserts: [],
		rekeyed: 0,
		copied: 0,
		dropped: 0,
		left: 0
	}
	const groups = new Map<string, Cand[]>()
	const add = (row: R, cand: Cand) => {
		const key = `${row.ownerKind}:${row.ownerId}|${keyOf(row)}`
		const g = groups.get(key)
		if (g) g.push(cand)
		else groups.set(key, [cand])
	}
	for (const row of existing) add(row, { row, copy: false, existing: true })
	// The owner id each moved candidate came from, by its place in the plan.
	const fromOf = new Map<Cand, number>()
	for (const row of moving) {
		const { rows, left } = rekeyOwnerRow(row, tr)
		if (left) plan.left++
		rows.forEach((next, i) => {
			const cand: Cand = { row: next, copy: i > 0, existing: false }
			fromOf.set(cand, row.ownerId)
			add(next, cand)
		})
	}
	const newest = (a: Cand, b: Cand) =>
		b.row.createdAt.getTime() - a.row.createdAt.getTime() ||
		b.row.id - a.row.id
	for (const group of groups.values()) {
		let winner: Cand | undefined
		if (group.length > 1) {
			const owner = group[0]!.row
			const survivor =
				tr.survivor?.({ kind: owner.ownerKind, id: owner.ownerId }) ??
				null
			winner =
				survivor != null
					? group.find(
							(c) => !c.existing && fromOf.get(c) === survivor
						)
					: undefined
			winner ??= [...group].sort(newest)[0]
		} else winner = group[0]
		for (const cand of group) {
			if (cand === winner) {
				if (cand.existing) continue
				if (cand.copy) {
					plan.inserts.push(cand.row)
					plan.copied++
				} else {
					plan.updates.push({
						id: cand.row.id,
						ownerKind: cand.row.ownerKind,
						ownerId: cand.row.ownerId
					})
					plan.rekeyed++
				}
				continue
			}
			plan.dropped++
			if (!cand.copy) plan.deleteIds.push(cand.row.id)
		}
	}
	return plan
}

/** Run a plan: deletes, then updates, then inserts, so no write meets the unique index. */
async function applyPlan<R extends UniqueRow>(
	tx: Db,
	table: PgTable & { id: unknown },
	plan: Plan<R>
): Promise<void> {
	const t = table as unknown as typeof schema.ownerSheets
	if (plan.deleteIds.length)
		await tx.delete(t).where(inArray(t.id, plan.deleteIds))
	for (const u of plan.updates)
		await tx
			.update(t)
			.set({ ownerKind: u.ownerKind, ownerId: u.ownerId })
			.where(eq(t.id, u.id))
	if (plan.inserts.length)
		await tx.insert(t).values(
			plan.inserts.map((r) => {
				const { id: _id, ...rest } =
					r as unknown as typeof t.$inferSelect
				return rest
			})
		)
}

/** A store's rows split by the translator: the ones it moves, and the rest. */
function splitRows<R extends OwnerRow>(
	rows: R[],
	tr: SeatRefTranslator
): { existing: R[]; moving: R[] } {
	const isMoving = (r: R) =>
		tr.owner({ kind: r.ownerKind, id: r.ownerId }, "every") !== null
	return {
		existing: rows.filter((r) => !isMoving(r)),
		moving: rows.filter(isMoving)
	}
}

async function rekeyOwnerSheets(
	tx: Db,
	sessionId: number,
	tr: SeatRefTranslator,
	tally: SeatRefsTally
): Promise<void> {
	const t = schema.ownerSheets
	const rows = await tx.select().from(t).where(eq(t.sessionId, sessionId))
	const { existing, moving } = splitRows(rows, tr)
	const plan = planUnique(existing, moving, tr, (r) => r.sheetId)
	await applyPlan(tx, t, plan)
	tally.rekeyed.owner_sheets += plan.rekeyed
	tally.copied += plan.copied
	tally.dropped += plan.dropped
	tally.left += plan.left
}

async function rekeyAttributeCarries(
	tx: Db,
	sessionId: number,
	tr: SeatRefTranslator,
	tally: SeatRefsTally
): Promise<void> {
	const t = schema.attributeCarries
	const rows = await tx.select().from(t).where(eq(t.sessionId, sessionId))
	const { existing, moving } = splitRows(rows, tr)
	const plan = planUnique(existing, moving, tr, (r) => r.slotId)
	await applyPlan(tx, t, plan)
	tally.rekeyed.attribute_carries += plan.rekeyed
	tally.copied += plan.copied
	tally.dropped += plan.dropped
	tally.left += plan.left
}

// ─── state_proposals ─────────────────────────────────────────────────────────

async function rekeyProposals(
	tx: Db,
	sessionId: number,
	tr: SeatRefTranslator,
	tally: SeatRefsTally
): Promise<void> {
	const t = schema.stateProposals
	const rows = await tx
		.select({ id: t.id, payload: t.payload })
		.from(t)
		.where(
			sql`${t.sessionId} = ${sessionId} and ${t.payload} -> 'owner' ->> 'kind' in (${kindList(tr)})`
		)
		.orderBy(t.id)
	for (const row of rows) {
		const next = rekeyProposalPayload(row.payload, tr)
		if (next.left) tally.left++
		if (!next.changed) continue
		await tx
			.update(t)
			.set({ payload: next.payload })
			.where(eq(t.id, row.id))
		tally.rekeyed.state_proposals++
	}
}

// ─── JSON stores: pure rewrites on the parsed document ───────────────────────

/** What a pure rewrite of one document answers. `doc` is the input itself when nothing moved. */
interface Rekeyed<T> {
	doc: T
	changed: boolean
	/** Card-form items no seat can take — left as they were. */
	left: number
	/** ★K-2 extra entries written so each seat holding one card keeps its value. */
	copied: number
}

interface Acc {
	left: number
	copied: number
}

/** A ref the translator moves. For card form only an exact `character:<digits>` is one; the seat-ref translator also reads a bare number as a state key, which a JSON store must never hand it. */
const moves =
	(tr: SeatRefTranslator) =>
	(v: unknown): v is string =>
		typeof v === "string" && tr.ref(v, "one") !== null
const isRec = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/** PURE — the ref(s) a ref string becomes; `[ref]` when the translator does not move it, `[]` when it moves it and has no target. */
const pickTargets = (
	tr: SeatRefTranslator,
	ref: string,
	pick: SeatPick
): string[] => tr.ref(ref, pick) ?? [ref]

/** A designation of one participant: the new ref, or the value itself (not card form, or left — counted). */
function designate(
	tr: SeatRefTranslator,
	ref: unknown,
	acc: Acc,
	pick: SeatPick = "one"
): unknown {
	if (!moves(tr)(ref)) return ref
	const [target] = pickTargets(tr, ref, pick)
	if (target === undefined) {
		acc.left++
		return ref
	}
	return target
}

/** A list of participant refs; card-form items replaced (every target, or one) and the list de-duplicated, first kept. A list with no card-form item comes back as it is. */
function rekeyRefs(
	list: unknown,
	tr: SeatRefTranslator,
	acc: Acc,
	pick: SeatPick
): unknown {
	if (!Array.isArray(list) || !list.some(moves(tr))) return list
	const out: unknown[] = []
	const seen = new Set<string>()
	const put = (s: string): boolean => {
		if (seen.has(s)) return false
		seen.add(s)
		out.push(s)
		return true
	}
	for (const item of list) {
		if (typeof item !== "string") {
			out.push(item)
			continue
		}
		if (!moves(tr)(item)) {
			put(item)
			continue
		}
		const targets = pickTargets(tr, item, pick)
		if (targets.length === 0) {
			acc.left++
			put(item)
			continue
		}
		let added = 0
		for (const t of targets) if (put(t)) added++
		if (added > 1) acc.copied += added - 1
	}
	return out
}

/**
 * A map keyed by participant ref. `every` (a value per seat): a key the
 * translator does not move wins, else the first translated. `sum` (a count per participant,
 * one target): keys landing on one target add up.
 */
function rekeyKeys(
	obj: unknown,
	tr: SeatRefTranslator,
	acc: Acc,
	mode: "every" | "sum"
): unknown {
	if (!isRec(obj) || !Object.keys(obj).some(moves(tr))) return obj
	const plain = new Set<string>(Object.keys(obj).filter((k) => !moves(tr)(k)))
	const out: Record<string, unknown> = {}
	const add = (key: string, value: unknown) => {
		if (mode === "sum" && key in out) {
			const was = out[key]
			if (typeof was === "number" && typeof value === "number")
				out[key] = was + value
			return
		}
		out[key] = value
	}
	for (const [key, value] of Object.entries(obj)) {
		if (!moves(tr)(key)) {
			add(key, value)
			continue
		}
		const targets = pickTargets(tr, key, mode === "sum" ? "one" : "every")
		if (targets.length === 0) {
			acc.left++
			add(key, value)
			continue
		}
		let added = 0
		for (const t of targets) {
			if (mode === "every" && (plain.has(t) || t in out)) continue
			add(t, value)
			added++
		}
		if (added > 1) acc.copied += added - 1
	}
	return out
}

/** Run a rewrite and report it; `changed` compares the stored text, key order included. */
function rewrite<T>(doc: T, fn: (acc: Acc) => T): Rekeyed<T> {
	const acc: Acc = { left: 0, copied: 0 }
	const next = fn(acc)
	const changed = JSON.stringify(next) !== JSON.stringify(doc)
	return { doc: changed ? next : doc, changed, ...acc }
}

const mapAll = (list: unknown, fn: (item: unknown) => unknown): unknown =>
	Array.isArray(list) ? list.map(fn) : list

/** A zone's held entries: each `fields.towards` (a tie's other end) in member form. */
function entriesIn(entries: unknown, tr: SeatRefTranslator, acc: Acc): unknown {
	return mapAll(entries, (e) => {
		if (!isRec(e) || !isRec(e.fields) || !moves(tr)(e.fields.towards))
			return e
		return {
			...e,
			fields: {
				...e.fields,
				towards: designate(tr, e.fields.towards, acc)
			}
		}
	})
}

/** PURE — `zone_contents.entries` with every tie end in member form. */
function rekeyZoneEntries(
	entries: unknown,
	tr: SeatRefTranslator
): Rekeyed<unknown> {
	return rewrite(entries, (acc) => entriesIn(entries, tr, acc))
}

const candidatePick = (kind: unknown): SeatPick =>
	kind === "persona" ? "player" : kind === "character" ? "character" : "one"

function orderIn(order: unknown, tr: SeatRefTranslator, acc: Acc): unknown {
	if (!isRec(order)) return order
	const next = { ...order }
	next.order = mapAll(order.order, (e) =>
		isRec(e) && moves(tr)(e.ref)
			? { ...e, ref: designate(tr, e.ref, acc) }
			: e
	)
	next.candidates = mapAll(order.candidates, (c) =>
		isRec(c) && moves(tr)(c.ref)
			? { ...c, ref: designate(tr, c.ref, acc, candidatePick(c.kind)) }
			: c
	)
	for (const k of ["order", "candidates"]) if (!(k in order)) delete next[k]
	return next
}

function tallyIn(tally: unknown, tr: SeatRefTranslator, acc: Acc): unknown {
	if (!isRec(tally) || !isRec(tally.lanes)) return tally
	const lanes: Record<string, unknown> = {}
	for (const [name, lane] of Object.entries(tally.lanes)) {
		if (!isRec(lane)) {
			lanes[name] = lane
			continue
		}
		const next = { ...lane }
		if ("lastSpeaker" in lane)
			next.lastSpeaker = designate(tr, lane.lastSpeaker, acc)
		if ("turnsBy" in lane)
			next.turnsBy = rekeyKeys(lane.turnsBy, tr, acc, "sum")
		if ("spoke" in lane) next.spoke = rekeyRefs(lane.spoke, tr, acc, "one")
		if ("persons" in lane)
			next.persons = rekeyRefs(lane.persons, tr, acc, "one")
		lanes[name] = next
	}
	return { ...tally, lanes }
}

/** PURE — a `TurnTallyV1` (or null) with its refs in member form. */
function rekeyTurnTally(
	tally: unknown,
	tr: SeatRefTranslator
): Rekeyed<unknown> {
	return rewrite(tally, (acc) => tallyIn(tally, tr, acc))
}

/** The Dungeon Crawler's progress key in the `core` document (`DUNGEON_CRAWLER_ANNEX_KEYS.progress`). */
const PROGRESS_KEY = "dungeon-crawler-progress"

function coreIn(
	core: Record<string, unknown>,
	tr: SeatRefTranslator,
	acc: Acc
): Record<string, unknown> {
	const next = { ...core }
	const progress = core[PROGRESS_KEY]
	if (isRec(progress) && "fates" in progress)
		next[PROGRESS_KEY] = {
			...progress,
			fates: rekeyKeys(progress.fates, tr, acc, "every")
		}
	return next
}

/**
 * PURE — the `core` annex owner's document with its seat refs in member form:
 * the Dungeon Crawler's `progress.fates` keys. (The turn order and the turn
 * tally are columns now: `rekeyAnnexCore` rewrites them with `orderIn` and
 * `tallyIn`.) Every other
 * key (`progress.heroes` is keyed `user:<id>`) byte-identical.
 */
export function rekeyCoreDocument(
	core: Record<string, unknown>,
	map: SeatMap
): Rekeyed<Record<string, unknown>> {
	return rekeyCoreWith(core, cardFormTranslator(map))
}

const rekeyCoreWith = (
	core: Record<string, unknown>,
	tr: SeatRefTranslator
): Rekeyed<Record<string, unknown>> =>
	rewrite(core, (acc) => coreIn(core, tr, acc))

/** A map of key → refs (annex audiences): every target, de-duplicated. */
function audiencesIn(
	audiences: unknown,
	tr: SeatRefTranslator,
	acc: Acc
): unknown {
	if (!isRec(audiences)) return audiences
	return Object.fromEntries(
		Object.entries(audiences).map(([k, refs]) => [
			k,
			rekeyRefs(refs, tr, acc, "every")
		])
	)
}

/** PURE — `sessions.annex_audiences` (owner → key → refs): who may see, every target. */
export function rekeyAnnexAudiences(
	audiences: unknown,
	map: SeatMap
): Rekeyed<unknown> {
	return rekeyAudiencesWith(audiences, cardFormTranslator(map))
}

const rekeyAudiencesWith = (
	audiences: unknown,
	tr: SeatRefTranslator
): Rekeyed<unknown> =>
	rewrite(audiences, (acc) =>
		isRec(audiences)
			? Object.fromEntries(
					Object.entries(audiences).map(([owner, keys]) => [
						owner,
						audiencesIn(keys, tr, acc)
					])
				)
			: audiences
	)

function sideIn(
	side: unknown,
	owner: unknown,
	tr: SeatRefTranslator,
	acc: Acc
): unknown {
	if (!isRec(side)) return side
	const next = { ...side }
	if ("audiences" in side)
		next.audiences = audiencesIn(side.audiences, tr, acc)
	if (owner === "core" && isRec(side.document))
		next.document = coreIn(side.document, tr, acc)
	return next
}

/** PURE — one side (`before` / `after`) of an annex delta: audiences every target; the document only for owner `core`. */
export function rekeyDeltaSide(
	side: unknown,
	owner: string,
	map: SeatMap
): Rekeyed<unknown> {
	return rekeyDeltaSideWith(side, owner, cardFormTranslator(map))
}

const rekeyDeltaSideWith = (
	side: unknown,
	owner: string,
	tr: SeatRefTranslator
): Rekeyed<unknown> => rewrite(side, (acc) => sideIn(side, owner, tr, acc))

/** PURE — `sessions.genre_fields`: `speechAutoVoice:character:<n>` becomes one key per seat (a voice per seat); an existing target key keeps its value. */
function rekeyGenreFields(
	fields: unknown,
	tr: SeatRefTranslator
): Rekeyed<unknown> {
	return rewrite(fields, (acc) => {
		if (!isRec(fields)) return fields
		const refOf = (k: string): string | null =>
			k.startsWith(SPEECH_AUTO_VOICE_PREFIX) &&
			moves(tr)(k.slice(SPEECH_AUTO_VOICE_PREFIX.length))
				? k.slice(SPEECH_AUTO_VOICE_PREFIX.length)
				: null
		if (!Object.keys(fields).some((k) => refOf(k))) return fields
		const out: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(fields)) {
			const ref = refOf(k)
			if (ref === null) {
				out[k] = v
				continue
			}
			const targets = pickTargets(tr, ref, "every")
			if (targets.length === 0) {
				acc.left++
				out[k] = v
				continue
			}
			let added = 0
			for (const t of targets) {
				const key = SPEECH_AUTO_VOICE_PREFIX + t
				if (key in fields || key in out) continue
				out[key] = v
				added++
			}
			if (added > 1) acc.copied += added - 1
		}
		return out
	})
}

/** `chosenImages` entries `<ref>=<image>`: a card-form left side held only by character seats becomes `seated-member:<id>=…`; any other is left as it is (the SDK reads it through `cardId` until S5). */
function chosenIn(list: unknown, tr: SeatRefTranslator, acc: Acc): unknown {
	if (!Array.isArray(list)) return list
	const leftOf = (e: unknown): { at: number; left: string } | null => {
		if (typeof e !== "string") return null
		const at = e.indexOf("=")
		return at < 0 ? null : { at, left: e.slice(0, at).trim() }
	}
	const taken = new Set<string>()
	for (const e of list) {
		const p = leftOf(e)
		if (p && !moves(tr)(p.left)) taken.add(p.left)
	}
	const out: unknown[] = []
	for (const e of list) {
		const p = leftOf(e)
		if (!p || !moves(tr)(p.left)) {
			out.push(e)
			continue
		}
		const targets = pickTargets(tr, p.left, "every")
		if (
			targets.length === 0 ||
			!targets.every((t) => t.startsWith("seated-member:"))
		) {
			acc.left++
			out.push(e)
			continue
		}
		const rest = (e as string).slice(p.at)
		let added = 0
		for (const t of targets) {
			if (taken.has(t)) continue
			taken.add(t)
			out.push(t + rest)
			added++
		}
		if (added > 1) acc.copied += added - 1
	}
	return out
}

/** PURE — `widget_settings.values`: `chosenImages` and `pickMembers` in member form; every other key and line as it was. */
function rekeyWidgetValues(
	values: unknown,
	tr: SeatRefTranslator
): Rekeyed<unknown> {
	return rewrite(values, (acc) => {
		if (!isRec(values)) return values
		const next = { ...values }
		if ("chosenImages" in values)
			next.chosenImages = chosenIn(values.chosenImages, tr, acc)
		if ("pickMembers" in values)
			next.pickMembers = rekeyRefs(values.pickMembers, tr, acc, "every")
		return next
	})
}

/** The seat kind a message row says its speaker is: voiced as a persona → player seat; said by a character → character seat. */
const speakerPick = (
	ref: string,
	row: { personaId: number | null; characterId: number | null }
): SeatPick => {
	const card = Number(
		CARD_REF.test(ref) ? ref.slice("character:".length) : NaN
	)
	if (row.personaId === card) return "player"
	if (row.characterId === card) return "character"
	return "one"
}

/** PURE — a message's `metadata` with a card-form `speaker` in member form, hinted by the row's own persona / character. */
function rekeyMessageSpeaker(
	metadata: unknown,
	row: { personaId: number | null; characterId: number | null },
	tr: SeatRefTranslator
): Rekeyed<unknown> {
	return rewrite(metadata, (acc) => {
		if (!isRec(metadata) || !moves(tr)(metadata.speaker)) return metadata
		return {
			...metadata,
			speaker: designate(
				tr,
				metadata.speaker,
				acc,
				speakerPick(metadata.speaker, row)
			)
		}
	})
}

function blocksIn(blocks: unknown, tr: SeatRefTranslator, acc: Acc): unknown {
	return mapAll(blocks, (b) => {
		if (!isRec(b)) return b
		const next = { ...b }
		if (moves(tr)(b.addressee))
			next.addressee = designate(tr, b.addressee, acc)
		if (isRec(b.answered) && moves(tr)(b.answered.by))
			next.answered = {
				...b.answered,
				by: designate(tr, b.answered.by, acc)
			}
		if ("blocks" in b) next.blocks = blocksIn(b.blocks, tr, acc)
		return next
	})
}

/** PURE — a `core:blocks` part's `data` with every block's `addressee` and `answered.by` in member form (groups nest). */
function rekeyBlocksData(
	data: unknown,
	tr: SeatRefTranslator
): Rekeyed<unknown> {
	return rewrite(data, (acc) =>
		isRec(data) && "blocks" in data
			? { ...data, blocks: blocksIn(data.blocks, tr, acc) }
			: data
	)
}

/**
 * Owner-column rows as JSON (a rewind record's): the first row keeps its `id`,
 * a ★K-2 copy is written without one so Forward's insert gives it a fresh id.
 */
function rowsIn(
	rows: unknown,
	tr: SeatRefTranslator,
	acc: Acc,
	zones: boolean
): unknown {
	if (!Array.isArray(rows)) return rows
	const out: unknown[] = []
	for (const raw of rows) {
		if (!isRec(raw)) {
			out.push(raw)
			continue
		}
		const row =
			zones && "entries" in raw
				? { ...raw, entries: entriesIn(raw.entries, tr, acc) }
				: raw
		if (
			typeof row.ownerKind !== "string" ||
			typeof row.ownerId !== "number"
		) {
			out.push(row)
			continue
		}
		const {
			rows: moved,
			left,
			moved: isMoved
		} = rekeyOwnerRow(row as typeof row & OwnerRow, tr)
		if (!isMoved) {
			out.push(row)
			continue
		}
		if (left) {
			acc.left++
			out.push(row)
			continue
		}
		moved.forEach((r, i) => {
			if (i === 0) return out.push(r)
			const { id: _id, ...copy } = r
			acc.copied++
			out.push(copy)
		})
	}
	return out
}

function proposalRowsIn(
	rows: unknown,
	tr: SeatRefTranslator,
	acc: Acc
): unknown {
	return mapAll(rows, (r) => {
		if (!isRec(r) || !isRec(r.payload)) return r
		const next = rekeyProposalPayload(r.payload, tr)
		if (next.left) acc.left++
		return next.changed ? { ...r, payload: next.payload } : r
	})
}

/** The annex key a session imprint of the Dungeon Crawler's progress is filed under. */
const PROGRESS_IMPRINT_KEY = `core/${PROGRESS_KEY}`

/** A wrapped `{ v }` value with its progress `fates` keys in member form (any other value as it is). */
function wrappedProgressIn(
	w: unknown,
	tr: SeatRefTranslator,
	acc: Acc
): unknown {
	if (!isRec(w) || !isRec(w.v) || !("fates" in w.v)) return w
	return { ...w, v: { ...w.v, fates: rekeyKeys(w.v.fates, tr, acc, "every") } }
}

/**
 * PURE — what one `annex` session imprint (a row, or a rewind record's copy of
 * one, both camelCase) holds in member form: its audiences, every target; and,
 * for the Dungeon Crawler's progress key, the `fates` keys in `before` /
 * `after`. `later` (a splice's carried side) has no `after`.
 */
function annexImprintIn(
	imprint: unknown,
	subjectKey: unknown,
	tr: SeatRefTranslator,
	acc: Acc
): unknown {
	if (!isRec(imprint)) return imprint
	const next = { ...imprint }
	for (const k of ["audienceBefore", "audienceAfter"])
		if (k in imprint) next[k] = rekeyRefs(imprint[k], tr, acc, "every")
	if (subjectKey === PROGRESS_IMPRINT_KEY)
		for (const k of ["before", "after"])
			if (k in imprint) next[k] = wrappedProgressIn(imprint[k], tr, acc)
	return next
}

/** PURE — `state.sessionImprints` of a rewind record (`[{ act, imprint, later? }]`): its `annex` imprints in member form. */
function imprintsTakenIn(
	taken: unknown,
	tr: SeatRefTranslator,
	acc: Acc
): unknown {
	return mapAll(taken, (t) => {
		if (!isRec(t) || !isRec(t.imprint)) return t
		if (t.imprint.subjectKind !== "annex") return t
		const key = t.imprint.subjectKey
		const next: Record<string, unknown> = {
			...t,
			imprint: annexImprintIn(t.imprint, key, tr, acc)
		}
		if ("later" in t) next.later = annexImprintIn(t.later, key, tr, acc)
		return next
	})
}

function deltasTakenIn(
	taken: unknown,
	tr: SeatRefTranslator,
	acc: Acc
): unknown {
	return mapAll(taken, (t) => {
		if (!isRec(t) || !isRec(t.row)) return t
		const row = { ...t.row }
		for (const side of ["before", "after"])
			if (side in t.row)
				row[side] = sideIn(t.row[side], t.row.owner, tr, acc)
		return { ...t, row }
	})
}

/**
 * PURE — a `session_messages.rewind_taken` record (`RewoundTakenV1`) with the
 * seat keys of what Back took in member form: state rows (values, configs,
 * zones and their tie ends, proposals, annex deltas, session imprints), the turn's tally and
 * what its runs wrote elsewhere. Everything else byte-identical.
 */
function rekeyRewindTaken(
	record: unknown,
	tr: SeatRefTranslator
): Rekeyed<unknown> {
	return rewrite(record, (acc) => {
		if (!isRec(record)) return record
		const next = { ...record }
		if (isRec(record.state)) {
			const s = { ...record.state }
			if ("values" in s) s.values = rowsIn(s.values, tr, acc, false)
			if ("configs" in s) s.configs = rowsIn(s.configs, tr, acc, false)
			if ("zones" in s) s.zones = rowsIn(s.zones, tr, acc, true)
			if ("proposals" in s)
				s.proposals = proposalRowsIn(s.proposals, tr, acc)
			if ("annexDeltas" in s)
				s.annexDeltas = deltasTakenIn(s.annexDeltas, tr, acc)
			if ("sessionImprints" in s)
				s.sessionImprints = imprintsTakenIn(s.sessionImprints, tr, acc)
			next.state = s
		}
		if (isRec(record.turn)) {
			const t = { ...record.turn }
			if ("tally" in t) t.tally = tallyIn(t.tally, tr, acc)
			if (isRec(t.elsewhere)) {
				const e = { ...t.elsewhere }
				if ("values" in e) e.values = rowsIn(e.values, tr, acc, false)
				if ("configs" in e)
					e.configs = rowsIn(e.configs, tr, acc, false)
				if ("proposals" in e)
					e.proposals = proposalRowsIn(e.proposals, tr, acc)
				t.elsewhere = e
			}
			next.turn = t
		}
		return next
	})
}

// ─── JSON stores: the steps ──────────────────────────────────────────────────

/** `jsonb` / `json` text of a card-form ref in a path (the fast path and the pre-filters). */
const CARD_AT = `"character:[0-9]`

/** What the boot pass's fast path and its translator filter on: card form. */
const CARD_FORM_SQL = { ownerKinds: ["session_cast"], refSql: CARD_AT } as const

/** A rewind record holds a moved form as an owner column or a ref string. */
const rewindFormRegex = (
	tr: Pick<SeatRefTranslator, "ownerKinds" | "refSql">
) => `"ownerKind":\\s*"(${tr.ownerKinds.join("|")})"|${tr.refSql}`
const REWIND_CARD_FORM = rewindFormRegex(CARD_FORM_SQL)

/** SQL: a jsonb `core` document holds a form the pass moves at a path it rewrites. */
const coreFormSql = (doc: SQL, refSql: string): SQL =>
	sql`((${doc} -> 'turnOrder')::text ~ ${refSql}
		or (${doc} -> 'turnTally')::text ~ ${refSql}
		or (${doc} -> 'dungeon-crawler-progress' -> 'fates')::text ~ ${refSql})`
const coreCardSql = (doc: SQL): SQL => coreFormSql(doc, CARD_AT)

/**
 * Write one JSON column back as raw SQL: a key migration is no edit, so
 * `updated_at` (a drizzle `$onUpdate`) must not move.
 */
async function putJson(
	tx: Db,
	table: string,
	column: string,
	id: number,
	value: unknown,
	cast: "json" | "jsonb"
): Promise<void> {
	await tx.execute(
		sql`update ${sql.raw(table)} set ${sql.raw(`"${column}"`)} = ${JSON.stringify(value)}::${sql.raw(cast)} where id = ${id}`
	)
}

const settle = (tally: SeatRefsTally, store: SeatKeyStore, r: Rekeyed<unknown>) => {
	tally.left += r.left
	tally.copied += r.copied
	if (r.changed) tally.rekeyed[store]++
}

async function rekeyZoneTowards(
	tx: Db,
	sessionId: number,
	tr: SeatRefTranslator,
	tally: SeatRefsTally
): Promise<void> {
	const t = schema.zoneContents
	const rows = await tx
		.select({ id: t.id, entries: t.entries })
		.from(t)
		.where(
			sql`${t.sessionId} = ${sessionId} and ${t.entries}::text ~ ${`"towards":\\s*${tr.refSql}`}`
		)
		.orderBy(t.id)
	for (const row of rows) {
		const r = rekeyZoneEntries(row.entries, tr)
		settle(tally, "zone_towards", r)
		if (r.changed)
			await putJson(
				tx,
				"zone_contents",
				"entries",
				row.id,
				r.doc,
				"jsonb"
			)
	}
}

async function rekeyAnnexCore(
	tx: Db,
	sessionId: number,
	tr: SeatRefTranslator,
	tally: SeatRefsTally
): Promise<void> {
	await lockSessionAnnex(tx, sessionId)
	const t = schema.sessions
	const [row] = await tx
		.select({ annex: t.annex, turnOrder: t.turnOrder, turnTally: t.turnTally })
		.from(t)
		.where(eq(t.id, sessionId))
	if (!row) return
	const order = row.turnOrder == null ? null : rewrite(row.turnOrder as unknown, (acc) => orderIn(row.turnOrder, tr, acc))
	const tallied = row.turnTally == null ? null : rewrite(row.turnTally as unknown, (acc) => tallyIn(row.turnTally, tr, acc))
	const doc = isRec(row.annex) && isRec(row.annex.core) ? rekeyCoreWith(row.annex.core, tr) : null
	const parts = [order, tallied, doc].filter((r): r is Rekeyed<never> => r !== null)
	if (!parts.length) return
	// One store, one count: the session counts once whichever of its columns and document moved.
	settle(tally, "annex_core", {
		doc: null,
		changed: parts.some((r) => r.changed),
		left: parts.reduce((n, r) => n + r.left, 0),
		copied: parts.reduce((n, r) => n + r.copied, 0)
	})
	if (order?.changed) await putJson(tx, "sessions", "turn_order", sessionId, order.doc, "jsonb")
	if (tallied?.changed) await putJson(tx, "sessions", "turn_tally", sessionId, tallied.doc, "jsonb")
	if (doc?.changed && isRec(row.annex))
		await putJson(tx, "sessions", "annex", sessionId, { ...row.annex, core: doc.doc }, "jsonb")
}

async function rekeyAnnexAudiencesStep(
	tx: Db,
	sessionId: number,
	tr: SeatRefTranslator,
	tally: SeatRefsTally
): Promise<void> {
	const t = schema.sessions
	const [row] = await tx
		.select({ audiences: t.annexAudiences })
		.from(t)
		.where(eq(t.id, sessionId))
	if (!row) return
	const r = rekeyAudiencesWith(row.audiences, tr)
	settle(tally, "annex_audiences", r)
	if (r.changed)
		await putJson(
			tx,
			"sessions",
			"annex_audiences",
			sessionId,
			r.doc,
			"jsonb"
		)
}

async function rekeyGenreFieldsStep(
	tx: Db,
	sessionId: number,
	tr: SeatRefTranslator,
	tally: SeatRefsTally
): Promise<void> {
	const t = schema.sessions
	const [row] = await tx
		.select({ fields: t.genreFields })
		.from(t)
		.where(eq(t.id, sessionId))
	if (!row) return
	const r = rekeyGenreFields(row.fields, tr)
	settle(tally, "genre_fields", r)
	if (r.changed)
		await putJson(tx, "sessions", "genre_fields", sessionId, r.doc, "json")
}

async function rekeyWidgetSettings(
	tx: Db,
	sessionId: number,
	tr: SeatRefTranslator,
	tally: SeatRefsTally
): Promise<void> {
	const t = schema.widgetSettings
	const rows = await tx
		.select({ id: t.id, values: t.values })
		.from(t)
		.where(eq(t.sessionId, sessionId))
		.orderBy(t.id)
	for (const row of rows) {
		const r = rekeyWidgetValues(row.values, tr)
		settle(tally, "widget_settings", r)
		if (r.changed)
			await putJson(
				tx,
				"widget_settings",
				"values",
				row.id,
				r.doc,
				"json"
			)
	}
}

async function rekeyMessageSpeakers(
	tx: Db,
	sessionId: number,
	tr: SeatRefTranslator,
	tally: SeatRefsTally
): Promise<void> {
	const t = schema.sessionMessages
	const rows = await tx
		.select({
			id: t.id,
			metadata: t.metadata,
			personaId: t.personaId,
			characterId: t.characterId
		})
		.from(t)
		.where(
			sql`${t.sessionId} = ${sessionId} and ${t.metadata}::text ~ ${`"speaker":\\s*${tr.refSql}`}`
		)
		.orderBy(t.id)
	for (const row of rows) {
		const r = rekeyMessageSpeaker(row.metadata, row, tr)
		settle(tally, "message_speakers", r)
		if (r.changed)
			await putJson(
				tx,
				"session_messages",
				"metadata",
				row.id,
				r.doc,
				"json"
			)
	}
}

async function rekeyMessageBlocks(
	tx: Db,
	sessionId: number,
	tr: SeatRefTranslator,
	tally: SeatRefsTally
): Promise<void> {
	const p = schema.messageParts
	const rows = await tx
		.select({ id: p.id, data: p.data })
		.from(p)
		.innerJoin(schema.messages, eq(schema.messages.id, p.messageId))
		.where(
			sql`${schema.messages.sessionId} = ${sessionId} and ${p.type} = 'core:blocks' and ${p.data}::text ~ ${`"(addressee|by)":\\s*${tr.refSql}`}`
		)
		.orderBy(p.id)
	for (const row of rows) {
		const r = rekeyBlocksData(row.data, tr)
		settle(tally, "message_blocks", r)
		if (r.changed)
			await putJson(tx, "message_parts", "data", row.id, r.doc, "json")
	}
}

async function rekeyRewindTakenStep(
	tx: Db,
	sessionId: number,
	tr: SeatRefTranslator,
	tally: SeatRefsTally
): Promise<void> {
	const t = schema.sessionMessages
	const rows = await tx
		.select({ id: t.id, taken: t.rewindTaken })
		.from(t)
		.where(
			sql`${t.sessionId} = ${sessionId} and ${t.rewindTaken} is not null and ${t.rewindTaken}::text ~ ${rewindFormRegex(tr)}`
		)
		.orderBy(t.id)
	for (const row of rows) {
		const r = rekeyRewindTaken(row.taken, tr)
		settle(tally, "rewind_taken", r)
		if (r.changed)
			await putJson(
				tx,
				"session_messages",
				"rewind_taken",
				row.id,
				r.doc,
				"json"
			)
	}
}

/** A jsonb column's value: SQL NULL stays SQL NULL (never the JSON `null`). */
const jsonOrNull = (v: unknown): SQL =>
	v == null ? sql`NULL` : sql`${JSON.stringify(v)}::jsonb`

async function rekeyAnnexImprints(
	tx: Db,
	sessionId: number,
	tr: SeatRefTranslator,
	tally: SeatRefsTally
): Promise<void> {
	const t = schema.sessionImprints
	const rows = await tx
		.select({
			id: t.id,
			subjectKey: t.subjectKey,
			before: t.before,
			after: t.after,
			audienceBefore: t.audienceBefore,
			audienceAfter: t.audienceAfter
		})
		.from(t)
		.where(and(eq(t.sessionId, sessionId), eq(t.subjectKind, "annex")))
		.orderBy(t.id)
	for (const row of rows) {
		const { id, subjectKey, ...held } = row
		const r = rewrite<unknown>(held, (acc) =>
			annexImprintIn(held, subjectKey, tr, acc)
		)
		settle(tally, "annex_imprints", r)
		if (!r.changed) continue
		const next = r.doc as typeof held
		await tx.execute(sql`
			update ${t} set
				${sql.identifier(t.before.name)} = ${jsonOrNull(next.before)},
				${sql.identifier(t.after.name)} = ${jsonOrNull(next.after)},
				${sql.identifier(t.audienceBefore.name)} = ${jsonOrNull(next.audienceBefore)},
				${sql.identifier(t.audienceAfter.name)} = ${jsonOrNull(next.audienceAfter)}
			where ${t.id} = ${id}
		`)
	}
}

// ─── The pass ────────────────────────────────────────────────────────────────

/** One step per store, in this order; a store's step adds to the session's tally. */
const STEPS: {
	store: SeatKeyStore
	run: (
		tx: Db,
		sessionId: number,
		tr: SeatRefTranslator,
		tally: SeatRefsTally
	) => Promise<void>
}[] = [
	{
		store: "attribute_values",
		run: (tx, sessionId, tr, tally) =>
			rekeyBulk(
				tx,
				"attribute_values",
				schema.attributeValues,
				"attribute_values",
				sessionId,
				tr,
				tally
			)
	},
	{
		store: "attribute_configs",
		run: (tx, sessionId, tr, tally) =>
			rekeyBulk(
				tx,
				"attribute_configs",
				schema.attributeConfigs,
				"attribute_configs",
				sessionId,
				tr,
				tally
			)
	},
	{
		store: "zone_contents",
		run: (tx, sessionId, tr, tally) =>
			rekeyBulk(
				tx,
				"zone_contents",
				schema.zoneContents,
				"zone_contents",
				sessionId,
				tr,
				tally
			)
	},
	{ store: "owner_sheets", run: rekeyOwnerSheets },
	{ store: "attribute_carries", run: rekeyAttributeCarries },
	{ store: "state_proposals", run: rekeyProposals },
	{ store: "zone_towards", run: rekeyZoneTowards },
	{ store: "annex_core", run: rekeyAnnexCore },
	{ store: "annex_audiences", run: rekeyAnnexAudiencesStep },
	{ store: "genre_fields", run: rekeyGenreFieldsStep },
	{ store: "widget_settings", run: rekeyWidgetSettings },
	{ store: "message_speakers", run: rekeyMessageSpeakers },
	{ store: "message_blocks", run: rekeyMessageBlocks },
	{ store: "rewind_taken", run: rekeyRewindTakenStep },
	{ store: "annex_imprints", run: rekeyAnnexImprints }
]

/** The fast path: each branch selects the ids of sessions holding a card-form item in one store. */
const CANDIDATE_BRANCHES: SQL[] = [
	...[
		"attribute_values",
		"attribute_configs",
		"zone_contents",
		"owner_sheets",
		"attribute_carries"
	].map(
		(table) =>
			sql`select session_id from ${sql.raw(table)} where owner_kind = 'session_cast' and session_id is not null`
	),
	sql`select session_id from state_proposals where payload -> 'owner' ->> 'kind' = 'session_cast'`,
	// zone_towards
	sql`select session_id from zone_contents where session_id is not null and entries::text ~ ${`"towards":\\s*${CARD_AT}`}`,
	// annex_core, annex_audiences, genre_fields
	sql`select id as session_id from sessions where ${coreCardSql(sql`annex -> 'core'`)}
		or turn_order::text ~ ${CARD_AT}
		or turn_tally::text ~ ${CARD_AT}
		or annex_audiences::text ~ ${CARD_AT}
		or genre_fields::text ~ ${`"speechAutoVoice:character:[0-9]`}`,
	// widget_settings (a chosen image on a player seat is left, so its session stays a candidate on every run)
	sql`select session_id from widget_settings where session_id is not null and (
		("values"::jsonb -> 'chosenImages')::text ~ ${`"\\s*character:[0-9]+\\s*=`}
		or ("values"::jsonb -> 'pickMembers')::text ~ ${`"character:[0-9]+"`})`,
	// message_speakers
	sql`select session_id from session_messages where metadata::jsonb ->> 'speaker' ~ '^character:[0-9]'`,
	// message_blocks
	sql`select m.session_id from message_parts p join messages m on m.id = p.message_id
		where p.type = 'core:blocks' and p.data::text ~ ${`"(addressee|by)":\\s*${CARD_AT}`}`,
	// rewind_taken
	sql`select session_id from session_messages where rewind_taken is not null and rewind_taken::text ~ ${REWIND_CARD_FORM}`,
	// annex_imprints (the progress key's fates sit in its values)
	sql`select session_id from session_imprints where subject_kind = 'annex' and (
		audience_before::text ~ ${CARD_AT}
		or audience_after::text ~ ${CARD_AT}
		or (subject_key = ${PROGRESS_IMPRINT_KEY} and (
			(before -> 'v' -> 'fates')::text ~ ${CARD_AT}
			or (after -> 'v' -> 'fates')::text ~ ${CARD_AT})))`
]

/**
 * 🚧 Moves every ref of one session the translator names, in all fifteen
 * stores (`SEAT_KEY_STORES`, one step each, in order): owner columns, proposal
 * owners, and ref strings inside the JSON stores. It runs inside the caller's
 * transaction, using only `tx`, and never opens one. Returns what the steps did
 * per store. The boot pass is one caller (card form, through the seat map) and
 * a fold the other (a cast member's refs moved to another member).
 */
export async function rekeySessionRefs(
	tx: Db,
	sessionId: number,
	translate: SeatRefTranslator
): Promise<SeatRefsTally> {
	const tally: SeatRefsTally = {
		rekeyed: zeroRekeyed(),
		copied: 0,
		dropped: 0,
		left: 0
	}
	for (const step of STEPS) await step.run(tx, sessionId, translate, tally)
	return tally
}

async function rekeySession(tx: Db, sessionId: number): Promise<SeatRefsTally> {
	const map = await loadSeatMap(tx, sessionId)
	return rekeySessionRefs(tx, sessionId, cardFormTranslator(map))
}

export async function seatKeys(db: Db): Promise<SeatKeysReport> {
	const report: SeatKeysReport = {
		sessions: 0,
		rekeyed: zeroRekeyed(),
		copied: 0,
		dropped: 0,
		left: 0,
		failed: 0
	}
	const found = await db.execute(sql.join(CANDIDATE_BRANCHES, sql` union `))
	const ids = rawRows<{ session_id: number }>(found)
		.map((row) => Number(row.session_id))
		.sort((a, b) => a - b)
	for (const id of ids) {
		try {
			const settled = await db.transaction(async (tx) =>
				rekeySession(tx as unknown as Db, id)
			)
			if (changed(settled)) report.sessions++
			for (const s of SEAT_KEY_STORES)
				report.rekeyed[s] += settled.rekeyed[s]
			report.copied += settled.copied
			report.dropped += settled.dropped
			report.left += settled.left
		} catch (err) {
			report.failed++
			console.error(`[seat-keys] session ${id} was left as it was:`, err)
		}
	}
	if (report.failed > 0)
		throw new Error(
			`${report.failed} session(s) could not have their seat keys rekeyed; see the log`
		)
	return report
}
