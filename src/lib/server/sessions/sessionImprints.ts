/**
 * 🚧 **Session imprints** — what a turn changed on its session, taken back
 * with the turn (ST3, 2026-11-11: "a turn owns what it wrote"). The module
 * owns every read and write of `session_imprints`: filing a row, retracting
 * the rows of a message, putting a retraction back, settling, and reading a
 * branch's rows. The sibling of `lorebooks/imprints.ts` (`lore_imprints`): the
 * same shape and the same **one retraction rule** (`retractionAct`), where a
 * session row is always reverted, like a session's own notes.
 *
 * It does NOT own the values it writes back. A seat's benched flag belongs to
 * `setSeatBench` (`sessions/seats.ts`, the one writer), the rest belong to
 * their writers' columns: it writes them by single-column raw SQL under the
 * annex lock, never through a row update, so no `updated_at` moves.
 *
 * One row per write, never per turn. When two turns draw from one deck and
 * the earlier is taken, the earlier turn's cards stay spent: the later card
 * was dealt from the position the earlier draw left (the rule's splice).
 *
 * ⚠ Every function takes its handle: inside a transaction the caller hands
 * its `tx` (the outer `db` deadlocks PGlite). Never statically imports
 * `$lib/server/db`. Nothing here emits.
 */
import { and, desc, eq, gt, inArray, lte, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	retractionAct,
	sameValue,
	unwrap,
	wrap,
	type Wrapped
} from "$lib/server/lorebooks/imprints"
import {
	migrateOwnerDocument,
	ownerVersionOf
} from "$lib/server/plugins/annexMigrate"
import { memberFormOn } from "$lib/server/state/memberForm"
import { loadSeatMap } from "$lib/server/state/seatRefs"
import { bumpedAnnexVersionsSql } from "./annexVersions"
import { CORE_RUNTIME_KEYS, lockSessionAnnex } from "./coreAnnex"
import { setSeatBench, type SeatChange } from "./seats"

export const SESSION_IMPRINT_KINDS = [
	"seat-bench",
	"ruleset-conversion",
	"deck",
	"annex"
] as const
export type SessionImprintKind = (typeof SESSION_IMPRINT_KINDS)[number]
export type SessionImprintRow = typeof schema.sessionImprints.$inferSelect
/** A row as Back keeps it: `id` absent only on a row converted from a record written before ST3. */
export type SessionImprintRecord = Omit<SessionImprintRow, "id"> & {
	id?: number
}
export interface SessionImprintAnchor {
	sessionId: number
	messageId: number | null
	runId: string | null
}

export const seatBenchKey = (kind: "character" | "player", seatId: number) =>
	`${kind}:${seatId}`
export const annexImprintKey = (owner: string, key: string) => `${owner}/${key}` // split at the LAST "/"

const S = schema.sessions
const I = schema.sessionImprints
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

const splitAnnexKey = (subjectKey: string): { owner: string; key: string } => {
	const at = subjectKey.lastIndexOf("/")
	return { owner: subjectKey.slice(0, at), key: subjectKey.slice(at + 1) }
}

const parseSeatKey = (
	subjectKey: string
): { kind: "character" | "player"; seatId: number } | null => {
	const [kind, id] = subjectKey.split(":")
	const seatId = Number(id)
	if (
		(kind !== "character" && kind !== "player") ||
		!Number.isInteger(seatId)
	)
		return null
	return { kind, seatId }
}

// ── Filing ──────────────────────────────────────────────────────────────────

/**
 * File what a write changed. No anchor message: nothing is filed (the write
 * is permanent at once). A write that changed nothing files nothing.
 */
export async function fileSessionImprint(
	tx: Db,
	anchor: SessionImprintAnchor,
	at: { kind: SessionImprintKind; key: string },
	before: unknown,
	after: unknown,
	annex?: {
		ownerVersion: string | null
		audienceBefore: string[] | null
		audienceAfter: string[] | null
	}
): Promise<void> {
	if (anchor.messageId == null) return
	const isAnnex = at.kind === "annex"
	if (
		sameValue(before, after) &&
		(!isAnnex ||
			sameValue(
				annex?.audienceBefore ?? null,
				annex?.audienceAfter ?? null
			))
	)
		return
	await tx.insert(I).values({
		sessionId: anchor.sessionId,
		messageId: anchor.messageId,
		runId: anchor.runId,
		subjectKind: at.kind,
		subjectKey: at.key,
		before: wrap(before),
		after: wrap(after),
		ownerVersion: isAnnex ? (annex?.ownerVersion ?? null) : null,
		audienceBefore: isAnnex ? (annex?.audienceBefore ?? null) : null,
		audienceAfter: isAnnex ? (annex?.audienceAfter ?? null) : null
	})
}

// ── The subjects: read now, write ───────────────────────────────────────────

const json = (v: unknown) => JSON.stringify(v)

/** The value a subject holds now (`undefined` = absent; a seat reads as its benched flag, `undefined` when it is gone). */
async function readSubject(
	tx: Db,
	row: SessionImprintRecord
): Promise<unknown> {
	const { sessionId, subjectKey } = row
	switch (row.subjectKind as SessionImprintKind) {
		case "seat-bench": {
			const seat = parseSeatKey(subjectKey)
			if (!seat) return undefined
			const t =
				seat.kind === "character"
					? schema.sessionCharacters
					: schema.sessionPersonas
			const [r] = await tx
				.select({ isActive: t.isActive })
				.from(t)
				.where(and(eq(t.id, seat.seatId), eq(t.sessionId, sessionId)))
				.limit(1)
			return r ? r.isActive === false : undefined
		}
		case "ruleset-conversion": {
			const [r] = await tx
				.select({ v: S.rulesetVersion })
				.from(S)
				.where(eq(S.id, sessionId))
				.limit(1)
			return r?.v ?? undefined
		}
		case "deck": {
			const [r] = await tx
				.select({ v: S.rulesetDecks })
				.from(S)
				.where(eq(S.id, sessionId))
				.limit(1)
			const decks = r?.v
			return isPlainObject(decks) && subjectKey in decks
				? decks[subjectKey]
				: undefined
		}
		case "annex": {
			const { owner, key } = splitAnnexKey(subjectKey)
			const [r] = await tx
				.select({ v: S.annex })
				.from(S)
				.where(eq(S.id, sessionId))
				.limit(1)
			const doc = r?.v?.[owner]
			return isPlainObject(doc) && key in doc ? doc[key] : undefined
		}
	}
}

/** Write the annex key (value, audience) under the annex lock: raw column writes, one statement, the owner's version bumped. */
async function writeAnnexKey(
	tx: Db,
	sessionId: number,
	owner: string,
	key: string,
	value: unknown,
	audience: string[] | null
): Promise<void> {
	await lockSessionAnnex(tx, sessionId)
	const [cur] = await tx
		.select({ annex: S.annex, audiences: S.annexAudiences })
		.from(S)
		.where(eq(S.id, sessionId))
		.limit(1)
	if (!cur) return
	const annex: Record<string, unknown> = isPlainObject(cur.annex)
		? { ...cur.annex }
		: {}
	const audiences: Record<string, Record<string, string[]>> = isPlainObject(
		cur.audiences
	)
		? { ...cur.audiences }
		: {}
	const doc = isPlainObject(annex[owner])
		? { ...(annex[owner] as Record<string, unknown>) }
		: {}
	if (value === undefined) delete doc[key]
	else doc[key] = value
	if (Object.keys(doc).length) annex[owner] = doc
	else delete annex[owner]
	const aud = isPlainObject(audiences[owner]) ? { ...audiences[owner] } : {}
	if (audience == null) delete aud[key]
	else aud[key] = audience
	if (Object.keys(aud).length) audiences[owner] = aud
	else delete audiences[owner]
	await tx.execute(sql`
		UPDATE ${S} SET
			${sql.identifier(S.annex.name)} = ${json(annex)}::jsonb,
			${sql.identifier(S.annexAudiences.name)} = ${json(audiences)}::jsonb,
			${sql.identifier(S.annexVersions.name)} = ${bumpedAnnexVersionsSql(S.annexVersions, owner)}
		WHERE ${S.id} = ${sessionId}
	`)
}

/**
 * Write a subject to `value` (`undefined` = absent). A seat goes through the
 * one writer; every refusal is the answer `false` (nothing written). `true`
 * when the subject was written; a seat's `changes` come back.
 */
async function writeSubject(
	tx: Db,
	row: SessionImprintRecord,
	value: unknown,
	audience: string[] | null
): Promise<{ ok: boolean; seatChanges: SeatChange[] }> {
	const { sessionId, subjectKey } = row
	switch (row.subjectKind as SessionImprintKind) {
		case "seat-bench": {
			const seat = parseSeatKey(subjectKey)
			if (!seat) return { ok: false, seatChanges: [] }
			const r = await setSeatBench(tx, {
				sessionId,
				...seat,
				benched: value === true
			})
			return r.ok
				? { ok: true, seatChanges: r.changes }
				: { ok: false, seatChanges: [] }
		}
		case "ruleset-conversion": {
			const version = typeof value === "string" ? value : null
			await tx.execute(sql`
				UPDATE ${S} SET ${sql.identifier(S.rulesetVersion.name)} = ${version}
				WHERE ${S.id} = ${sessionId}
			`)
			return { ok: true, seatChanges: [] }
		}
		case "deck": {
			const col = sql.identifier(S.rulesetDecks.name)
			const held = sql`coalesce(${S.rulesetDecks}, '{}'::jsonb)`
			await tx.execute(
				value === undefined
					? sql`UPDATE ${S} SET ${col} = ${held} - ${subjectKey}::text WHERE ${S.id} = ${sessionId}`
					: sql`UPDATE ${S} SET ${col} = ${held} || jsonb_build_object(${subjectKey}::text, ${json(value)}::jsonb) WHERE ${S.id} = ${sessionId}`
			)
			return { ok: true, seatChanges: [] }
		}
		case "annex": {
			const { owner, key } = splitAnnexKey(subjectKey)
			await writeAnnexKey(tx, sessionId, owner, key, value, audience)
			return { ok: true, seatChanges: [] }
		}
	}
}

// ── Retracting ──────────────────────────────────────────────────────────────

export type TakenSessionImprint =
	| { act: "reverted"; imprint: SessionImprintRecord }
	| {
			act: "spliced"
			imprint: SessionImprintRecord
			later: {
				id: number
				before: Wrapped
				audienceBefore: string[] | null
			}
	  }
	| { act: "dropped"; imprint: SessionImprintRecord }

/**
 * **Take back what the messages changed on their session** — the one
 * retraction rule (`retractionAct`), every standing row anchored to one of
 * `messageIds`, newest first. Returns what was done, for
 * `restoreSessionImprints`.
 */
export async function retractSessionImprints(
	tx: Db,
	sel: { sessionId: number; messageIds: readonly number[] },
	opts?: {
		/** A replacement's `keepOnRetell`: true leaves the row as it is — not taken, not listed. */
		keep?: (row: SessionImprintRow) => boolean | Promise<boolean>
		/** Rows with an id above this are taken in full, `keep` or not (a failed re-tell's own writes). */
		above?: number
	}
): Promise<{
	taken: TakenSessionImprint[]
	seatChanges: SeatChange[]
	changed: boolean
}> {
	const out = {
		taken: [] as TakenSessionImprint[],
		seatChanges: [] as SeatChange[],
		changed: false
	}
	if (!sel.messageIds.length) return out
	const batch = await tx
		.select()
		.from(I)
		.where(
			and(
				eq(I.sessionId, sel.sessionId),
				inArray(I.messageId, [...sel.messageIds]),
				eq(I.status, "standing")
			)
		)
		.orderBy(desc(I.id))
	for (const row of batch) {
		if (
			opts?.keep &&
			!(opts.above != null && row.id > opts.above) &&
			(await opts.keep(row))
		)
			continue
		// Rows taken in this pass are already deleted, so they never count as a later one.
		const [later] = await tx
			.select()
			.from(I)
			.where(
				and(
					eq(I.sessionId, row.sessionId),
					eq(I.subjectKind, row.subjectKind),
					eq(I.subjectKey, row.subjectKey),
					eq(I.status, "standing"),
					gt(I.id, row.id)
				)
			)
			.orderBy(I.id)
			.limit(1)
		let act = retractionAct({
			after: row.after,
			later: later ?? null,
			alwaysRevert: true,
			now: undefined
		})
		if (act === "spliced") {
			await tx
				.update(I)
				.set(
					row.subjectKind === "annex"
						? {
								before: row.before,
								audienceBefore: row.audienceBefore
							}
						: { before: row.before }
				)
				.where(eq(I.id, later!.id))
			await tx.delete(I).where(eq(I.id, row.id))
			out.taken.push({
				act: "spliced",
				imprint: row,
				later: {
					id: later!.id,
					before: later!.before,
					audienceBefore: later!.audienceBefore
				}
			})
			continue
		}
		if (act === "reverted") {
			const w = await writeSubject(
				tx,
				row,
				unwrap(row.before),
				row.audienceBefore
			)
			if (w.ok) {
				out.seatChanges.push(...w.seatChanges)
				if (row.subjectKind !== "seat-bench" || w.seatChanges.length) out.changed = true
				// A person's later bench or drag wins without a special case: a seat that
				// already reads `before` moved nothing, so the row is dropped, not taken
				// (Forward does not bench it again).
				if (row.subjectKind === "seat-bench" && !w.seatChanges.length) act = "dropped"
			} else act = "dropped" // a seat gone or removed: nothing to take back
		}
		await tx.delete(I).where(eq(I.id, row.id))
		out.taken.push({ act: act as "reverted" | "dropped", imprint: row })
	}
	return out
}

/** Put a record's row back: with its id when it has one. */
async function insertRecord(
	tx: Db,
	imprint: SessionImprintRecord
): Promise<void> {
	await tx.insert(I).values(imprint as never)
}

/**
 * 🚧 ⏳ S4, flip on (`memberForm.ts`): an `annex` row with both sides and both
 * audiences in the seats' member form, through the boot pass's translator
 * (`rekeyDeltaSide`, exact card-form strings only). Any other row, or the flip
 * off: as it is.
 */
async function annexRowInMemberForm(
	tx: Db,
	imprint: SessionImprintRecord,
	seatMaps: Map<number, Awaited<ReturnType<typeof loadSeatMap>>>
): Promise<SessionImprintRecord> {
	if (imprint.subjectKind !== "annex" || !memberFormOn()) return imprint
	const { owner, key } = splitAnnexKey(imprint.subjectKey)
	let map = seatMaps.get(imprint.sessionId)
	if (!map) seatMaps.set(imprint.sessionId, (map = await loadSeatMap(tx, imprint.sessionId)))
	const { rekeyDeltaSide } = await import("./seatKeys")
	const side = (value: Wrapped, audience: string[] | null) => {
		const v = unwrap(value)
		const out = rekeyDeltaSide(
			{
				document: v === undefined ? {} : { [key]: v },
				audiences: audience == null ? {} : { [key]: audience }
			},
			owner,
			map!
		).doc as { document?: Record<string, unknown>; audiences?: Record<string, string[]> }
		return { value: wrap(out.document?.[key]), audience: out.audiences?.[key] ?? null }
	}
	const before = side(imprint.before, imprint.audienceBefore)
	const after = side(imprint.after, imprint.audienceAfter)
	return {
		...imprint,
		before: before.value,
		audienceBefore: before.audience,
		after: after.value,
		audienceAfter: after.audience
	}
}

/**
 * **Put back what `retractSessionImprints` took** — a replacement that failed
 * replaced nothing; Forward lands a turn again. Oldest first, the reverse of
 * the retraction: a taken row is written to what the run wrote while the
 * subject still reads what the retraction left, then the row is re-filed.
 */
export async function restoreSessionImprints(
	tx: Db,
	taken: readonly TakenSessionImprint[]
): Promise<{ seatChanges: SeatChange[]; changed: boolean }> {
	const out = { seatChanges: [] as SeatChange[], changed: false }
	const seatMaps = new Map<number, Awaited<ReturnType<typeof loadSeatMap>>>()
	for (const t of [...taken].reverse()) {
		if (t.act === "dropped") continue
		// 🚧 ⏳ S4, flip on: an `annex` row taken in card form goes back — value,
		// audiences and the re-filed row alike — in the seats' member form.
		const imprint = await annexRowInMemberForm(tx, t.imprint, seatMaps)
		if (t.act === "spliced") {
			await tx
				.update(I)
				.set(
					imprint.subjectKind === "annex"
						? {
								before: t.later.before,
								audienceBefore: t.later.audienceBefore
							}
						: { before: t.later.before }
				)
				.where(eq(I.id, t.later.id))
			await insertRecord(tx, imprint)
			continue
		}
		// reverted: only while the subject still reads what the retraction left
		// (as the retraction wrote it, or in member form since the flip).
		// A row is filed again only when its value went back: a record whose
		// `after` never landed would later revert over what a person set since.
		let landed = false
		const reads = await readSubject(tx, imprint)
		if (sameValue(reads, unwrap(t.imprint.before)) || sameValue(reads, unwrap(imprint.before))) {
			let after = unwrap(imprint.after)
			const audienceAfter = imprint.audienceAfter
			if (
				imprint.subjectKind === "annex" &&
				imprint.ownerVersion != null
			) {
				const { owner, key } = splitAnnexKey(imprint.subjectKey)
				if (
					imprint.ownerVersion !==
						(await ownerVersionOf(tx, owner)) &&
					after !== undefined
				)
					after = (
						await migrateOwnerDocument(
							tx,
							owner,
							imprint.sessionId,
							{ [key]: after },
							imprint.ownerVersion
						)
					)[key]
			}
			const w = await writeSubject(tx, imprint, after, audienceAfter)
			if (w.ok) {
				landed = true
				out.seatChanges.push(...w.seatChanges)
				if (
					imprint.subjectKind !== "seat-bench" ||
					w.seatChanges.length
				)
					out.changed = true
			}
		}
		if (landed) await insertRecord(tx, imprint)
	}
	return out
}

// ── Settling, and a branch ──────────────────────────────────────────────────

/** The settle line passed: every standing row at or before it is settled, its `before` gone (nothing takes it back). */
export async function settleSessionImprints(
	tx: Db,
	sessionId: number,
	line: number
): Promise<void> {
	await tx
		.update(I)
		.set({ status: "settled", before: null, audienceBefore: null })
		.where(
			and(
				eq(I.sessionId, sessionId),
				eq(I.status, "standing"),
				lte(I.messageId, line)
			)
		)
}

/** The session's standing rows after a fork point, newest first (a branch folds them backwards). */
export async function sessionImprintsAfter(
	db: Db,
	sessionId: number,
	forkMessageId: number
): Promise<SessionImprintRow[]> {
	return db
		.select()
		.from(I)
		.where(
			and(
				eq(I.sessionId, sessionId),
				eq(I.status, "standing"),
				gt(I.messageId, forkMessageId)
			)
		)
		.orderBy(desc(I.id))
}

/**
 * The seats' benched flags as the newest `seat-bench` row of each says:
 * `<kind>:<seatId>` → its `after`. A seat no row names is absent. A row that
 * stands is one not taken back (a taken row is deleted), so a **settled** row
 * counts too: the settle line passing a bench does not unsay it.
 */
export async function standingSeatBenches(
	db: Db,
	sessionId: number
): Promise<Map<string, boolean>> {
	const rows = await db
		.select()
		.from(I)
		.where(
			and(
				eq(I.sessionId, sessionId),
				eq(I.subjectKind, "seat-bench")
			)
		)
		.orderBy(I.id)
	const out = new Map<string, boolean>()
	for (const r of rows) out.set(r.subjectKey, unwrap(r.after) === true)
	return out
}

/**
 * A branch inherits the parent's session imprints anchored at or before the
 * fork, standing and settled alike: each row's `message_id` moved to its copy
 * (`messageRemap`; a row whose message is not copied is skipped) and, for a
 * `seat-bench`, the seat id in its key moved to the branch's seat (skipped when
 * unmapped). Ids are new, in the parent's order. The module owns the write.
 */
export async function copySessionImprintsToBranch(
	tx: Db,
	input: {
		fromSessionId: number
		toSessionId: number
		forkMessageId: number
		messageRemap: ReadonlyMap<number, number>
		seatRemap: {
			character: ReadonlyMap<number, number>
			player: ReadonlyMap<number, number>
		}
	}
): Promise<void> {
	const rows = await tx
		.select()
		.from(I)
		.where(
			and(
				eq(I.sessionId, input.fromSessionId),
				lte(I.messageId, input.forkMessageId)
			)
		)
		.orderBy(I.id)
	for (const row of rows) {
		const messageId =
			row.messageId == null
				? undefined
				: input.messageRemap.get(row.messageId)
		if (messageId === undefined) continue
		let subjectKey = row.subjectKey
		if (row.subjectKind === "seat-bench") {
			const seat = parseSeatKey(subjectKey)
			const moved = seat
				? input.seatRemap[seat.kind].get(seat.seatId)
				: undefined
			if (!seat || moved === undefined) continue
			subjectKey = seatBenchKey(seat.kind, moved)
		}
		const { id: _id, ...rest } = row
		await tx.insert(I).values({
			...rest,
			sessionId: input.toSessionId,
			messageId,
			subjectKey
		})
	}
}

// ── A record written before ST3 ─────────────────────────────────────────────

const isInt = (v: unknown): v is number =>
	typeof v === "number" && Number.isInteger(v)

/**
 * What a `rewind_taken` record written before ST3 carries, as the rows Forward
 * now revives. Pure. Malformed entries are skipped; the lists keep the
 * record's order (newest first), annex deltas then seat benches then
 * conversions. No row has an `id`.
 */
export function sessionImprintsFromOldRecord(
	raw: {
		annexDeltas?: unknown
		seatBenches?: unknown
		conversions?: unknown
	},
	sessionId: number
): TakenSessionImprint[] {
	const out: TakenSessionImprint[] = []
	const record = (
		messageId: number,
		kind: SessionImprintKind,
		key: string,
		before: unknown,
		after: unknown,
		reverted: boolean,
		extra?: Partial<SessionImprintRecord>
	) => {
		const imprint: SessionImprintRecord = {
			sessionId,
			messageId,
			runId: null,
			subjectKind: kind,
			subjectKey: key,
			before: wrap(before),
			after: wrap(after),
			ownerVersion: null,
			audienceBefore: null,
			audienceAfter: null,
			status: "standing",
			createdAt: new Date(),
			...extra
		}
		out.push({ act: reverted ? "reverted" : "dropped", imprint })
	}

	if (Array.isArray(raw.annexDeltas)) {
		for (const entry of raw.annexDeltas) {
			if (
				!isPlainObject(entry) ||
				!isPlainObject(entry.row) ||
				entry.kept
			)
				continue
			const row = entry.row
			const owner = row.owner
			if (
				typeof owner !== "string" ||
				owner === "core:revision-points" ||
				!isInt(row.messageId)
			)
				continue
			const side = (s: unknown) => {
				if (!isPlainObject(s)) return null
				const document = isPlainObject(s.document) ? s.document : null
				const audiences = isPlainObject(s.audiences)
					? (s.audiences as Record<string, unknown>)
					: null
				return { document, audiences }
			}
			const before = side(row.before)
			const after = side(row.after)
			if (!before || !after) continue
			const skip =
				owner === "core"
					? new Set<string>(CORE_RUNTIME_KEYS)
					: new Set<string>()
			const keys = [
				...new Set([
					...Object.keys(before.document ?? {}),
					...Object.keys(after.document ?? {}),
					...Object.keys(before.audiences ?? {}),
					...Object.keys(after.audiences ?? {})
				])
			]
				.filter((k) => !skip.has(k))
				.sort()
			const list = (
				a: Record<string, unknown> | null,
				k: string
			): string[] | null =>
				a && Array.isArray(a[k]) ? (a[k] as string[]) : null
			const created =
				typeof row.createdAt === "string" ||
				row.createdAt instanceof Date
					? new Date(row.createdAt)
					: new Date()
			for (const k of keys) {
				const bv = before.document?.[k]
				const av = after.document?.[k]
				const ab = list(before.audiences, k)
				const aa = list(after.audiences, k)
				if (sameValue(bv, av) && sameValue(ab, aa)) continue
				record(
					row.messageId,
					"annex",
					annexImprintKey(owner, k),
					bv,
					av,
					entry.reverted === true,
					{
						runId: typeof row.runId === "string" ? row.runId : null,
						ownerVersion:
							typeof row.ownerVersion === "string"
								? row.ownerVersion
								: null,
						audienceBefore: ab,
						audienceAfter: aa,
						createdAt: Number.isNaN(created.getTime())
							? new Date()
							: created
					}
				)
			}
		}
	}
	if (Array.isArray(raw.seatBenches)) {
		for (const e of raw.seatBenches) {
			if (!isPlainObject(e) || !isInt(e.messageId) || !isInt(e.seatId))
				continue
			if (e.kind !== "character" && e.kind !== "player") continue
			if (typeof e.from !== "boolean" || typeof e.to !== "boolean")
				continue
			record(
				e.messageId,
				"seat-bench",
				seatBenchKey(e.kind, e.seatId),
				e.from,
				e.to,
				true
			)
		}
	}
	if (Array.isArray(raw.conversions)) {
		for (const e of raw.conversions) {
			if (
				!isPlainObject(e) ||
				!isInt(e.messageId) ||
				typeof e.rulesetId !== "string"
			)
				continue
			const version = (v: unknown) =>
				typeof v === "string" ? v : v == null ? undefined : null
			const from = version(e.from)
			const to = version(e.to)
			if (from === null || to === null) continue
			record(
				e.messageId,
				"ruleset-conversion",
				e.rulesetId,
				from,
				to,
				true
			)
		}
	}
	return out
}
