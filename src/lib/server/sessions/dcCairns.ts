/**
 * ⏳ The `dc-cairns` boot pass (plan `PLAN-history-one-per-date-2026-11-10`,
 * build scope item 6; owner GO 2026-11-10, ★H4 Q3 third round: "each existing
 * cairn becomes a `deceased` cast version plus a `progress.fallen` entry, and
 * the epitaph is retyped in place to character lore bound to the matched
 * member (world lore when none matches)"). Dungeon Crawler once filed a
 * history entry — a cairn, "Here lies ‹name›[, ‹class›], level ‹n›, who fell[
 * in ‹place›]." — into the session's own book on each death. Today a death
 * writes a `deceased` cast version and a `progress.fallen` item. This pass
 * brings the old cairns across, and is deleted with the attic at the RC1
 * squash.
 *
 * **Owns:** reading the old cairns of Dungeon Crawler sessions' own books,
 * and — per book, in one transaction — the three writes that follow. It
 * writes the cast version through the one writer (`writeCastVersion`), the
 * annex document under the annex's lock, and the retyped entry row. It does
 * **not** own the death flow, the cast-version rules, the Planner's people
 * filter (it drops a character-lore row anchored to a `progress.fallen`
 * `castMemberId`, so no other marker is written) or cairns in an attached
 * (non-own) book, which are left.
 *
 * - **Which rows.** `core:entry/history` rows of a book whose `session_id` is
 *   a session with genre `core:genre/dungeon-crawler` and whose trimmed
 *   `content` has the epitaph's shape. Any other history row is never
 *   touched. Zero rows: zeros, and nothing else is read.
 * - **Which member.** (1) By the turn: the `fate = dead` row anchored at the
 *   cairn's `source_message_id` names the seat; with several, the one whose
 *   seat name matches the epitaph's name, uniquely. (2) By name: a unique,
 *   case-insensitive seat name among the session's seats, removed ones
 *   included (seat name, else the card's name, else the removal snapshot).
 *   (3) Else none; two seats of one name are none. A seat with no
 *   `cast_member_id` is a seat without a member.
 * - **Writes.** A `deceased` version tied to the cairn's turn (`ownAnchor`,
 *   so an older turn is not refused as sealed) unless the member already
 *   reads deceased or the turn is gone (`unanchored`); the `progress.fallen`
 *   item unless the member (or, member-less, the name and place) is already
 *   there; the row retyped in place (same id, content, source message, keys,
 *   line and provenance) to character lore anchored to the member — or its
 *   overlay row where the member lives in another book, or world lore
 *   "Cairn of ‹name›" 🚧 when there is no member or nothing to anchor to.
 *   Fields the target type does not declare (the history date's `year`,
 *   `month`, `day`, `isCompleted`, `graphed`) are dropped.
 * - **Not critical.** A book whose transaction throws rolls back alone and is
 *   counted in `failed`, logged by session id; after the loop a non-zero
 *   `failed` throws one error naming the count (`failsHealth`).
 * - **Idempotent.** A retyped row does not match: a second boot reads one
 *   query and changes nothing.
 */
import { and, eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { liveMessageWhere } from "$lib/server/messages/store"
import {
	CHARACTER_LORE_TYPE_ID,
	ENTRY_TYPE_VERSION,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import {
	declaredFields,
	entryDeclaration,
	fieldDefault
} from "$lib/server/entries/declarations"
import { buildFields, nextPosition } from "$lib/server/utils/lorebookEntries"
import { lockBookCalendar } from "$lib/server/state/storyTime"
import { lockSessionAnnex } from "$lib/server/sessions/coreAnnex"
import { bumpedAnnexVersionsSql } from "$lib/server/sessions/annexVersions"
import { cardsNow } from "$lib/server/cast/seatedCast"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"

export interface DcCairnsReport {
	/** Sessions with at least one cairn. */
	sessions: number
	cairns: number
	/** `deceased` cast versions written. */
	versions: number
	/** Cairns whose member already read deceased. */
	alreadyDeceased: number
	/** Cairns with a member but no live turn to tie a version to. */
	unanchored: number
	/** `progress.fallen` items added. */
	fallenAdded: number
	characterLore: number
	worldLore: number
	/** Books whose transaction threw and was rolled back. */
	failed: number
}

const DC_GENRE_ID = "core:genre/dungeon-crawler"
const SQL_EPITAPH = "^Here lies .+, level [0-9]+, who fell( in .+)?\\.$"
const EPITAPH =
	/^Here lies (.+?)(?:, ([^,]+))?, level (\d+), who fell(?: in (.+))?\.$/
const FATE_SLOT = "core:slot/fate@1"
const PROGRESS_KEY = "dungeon-crawler-progress"

interface CairnRow {
	id: number
	lorebookId: number
	sessionId: number
	title: string | null
	content: string
	sourceMessageId: number | null
}

interface Seat {
	id: number
	castMemberId: number | null
	name: string | null
}

interface Matched {
	/** The seat's participant ref, or null. */
	seat: string | null
	castMemberId: number | null
}

const NO_MATCH: Matched = { seat: null, castMemberId: null }
const isRec = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/** The epitaph's name and place; null when the content is not an epitaph. */
function parseEpitaph(
	title: string | null,
	content: string
): { name: string; where: string } | null {
	const text = content.trim()
	const m = EPITAPH.exec(text)
	if (!m) return null
	const name =
		title && text.startsWith(`Here lies ${title},`) ? title : m[1]!
	return { name, where: m[4] ?? "" }
}

const zeros = (): DcCairnsReport => ({
	sessions: 0,
	cairns: 0,
	versions: 0,
	alreadyDeceased: 0,
	unanchored: 0,
	fallenAdded: 0,
	characterLore: 0,
	worldLore: 0,
	failed: 0
})

export async function dcCairns(db: Db): Promise<DcCairnsReport> {
	const report = zeros()
	const found = rawRows<{
		id: number
		lorebook_id: number
		session_id: number
		title: string | null
		content: string
		source_message_id: number | null
	}>(
		await db.execute(sql`
			select e.id, e.lorebook_id, b.session_id, e.title, e.content, e.source_message_id
			from lorebook_entries e
				join lorebooks b on b.id = e.lorebook_id
				join sessions s on s.id = b.session_id
			where e.type_id = ${HISTORY_TYPE_ID}
				and s.genre_id = ${DC_GENRE_ID}
				and trim(e.content) ~ ${SQL_EPITAPH}
			order by b.id, e.id
		`)
	)
	if (!found.length) return report

	const books = new Map<number, CairnRow[]>()
	for (const r of found) {
		const row: CairnRow = {
			id: Number(r.id),
			lorebookId: Number(r.lorebook_id),
			sessionId: Number(r.session_id),
			title: r.title,
			content: r.content,
			sourceMessageId:
				r.source_message_id == null ? null : Number(r.source_message_id)
		}
		const list = books.get(row.lorebookId) ?? []
		list.push(row)
		books.set(row.lorebookId, list)
	}
	report.sessions = new Set(found.map((r) => Number(r.session_id))).size

	for (const [lorebookId, rows] of books) {
		const sessionId = rows[0]!.sessionId
		const part = zeros()
		try {
			await db.transaction(async (tx) => {
				await settleBook(tx as unknown as Db, lorebookId, sessionId, rows, part)
			})
			for (const k of Object.keys(part) as (keyof DcCairnsReport)[])
				if (k !== "sessions" && k !== "failed") report[k] += part[k]
		} catch (err) {
			report.failed++
			console.error(`[dc-cairns] session ${sessionId} failed and was left:`, err)
		}
	}
	if (report.failed > 0)
		throw new Error(
			`${report.failed} Dungeon Crawler session(s) could not have their cairns carried across; see the log`
		)
	return report
}

async function settleBook(
	tx: Db,
	lorebookId: number,
	sessionId: number,
	rows: CairnRow[],
	report: DcCairnsReport
): Promise<void> {
	await lockBookCalendar(tx, lorebookId)

	const seatRows = await tx
		.select({
			id: schema.sessionPersonas.id,
			castMemberId: schema.sessionPersonas.castMemberId,
			seatName: schema.sessionPersonas.seatName,
			personaId: schema.sessionPersonas.personaId,
			removedName: schema.sessionPersonas.removedName
		})
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
		.orderBy(schema.sessionPersonas.id)
	// A card's name is read from its version in force (frozen-column guard).
	const cardIds = [
		...new Set(
			seatRows
				.map((s) => s.personaId)
				.filter((id): id is number => id != null)
		)
	]
	const cards = cardIds.length ? await cardsNow(tx, cardIds) : new Map()
	const seats: Seat[] = seatRows.map((s) => {
		const card = s.personaId != null ? cards.get(s.personaId) : undefined
		const cardName = card ? resolveCharacterName(card, "") : ""
		return {
			id: s.id,
			castMemberId: s.castMemberId,
			name: s.seatName || cardName || s.removedName || null
		}
	})
	const bySeatId = new Map(seats.map((s) => [s.id, s]))
	const lower = (s: string | null) => (s ?? "").trim().toLowerCase()

	// The session's annex, read once under its lock and written once.
	await lockSessionAnnex(tx, sessionId)
	const [sessionRow] = await tx
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	const annex: Record<string, unknown> = isRec(sessionRow?.annex)
		? sessionRow!.annex
		: {}
	const core = annex.core
	if (core !== undefined && !isRec(core))
		throw new Error("the session annex's core document is not an object")
	const progress = core?.[PROGRESS_KEY]
	if (progress !== undefined && !isRec(progress))
		throw new Error("the Dungeon Crawler progress document is not an object")
	const fallenNow = progress?.fallen
	if (fallenNow !== undefined && !Array.isArray(fallenNow))
		throw new Error("the Dungeon Crawler progress `fallen` is not a list")
	const fallen: unknown[] = [...(fallenNow ?? [])]
	let fallenChanged = false

	const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
	const { writeCastVersion } = await import("$lib/server/characters/versions")

	for (const row of rows) {
		const epitaph = parseEpitaph(row.title, row.content)
		if (!epitaph) continue
		report.cairns++
		const name = epitaph.name

		// 1. By the turn, then 2. by name.
		const matched = await matchSeat(
			tx,
			sessionId,
			row.sourceMessageId,
			name,
			seats,
			bySeatId,
			lower
		)
		const memberId = matched.castMemberId

		// Cast version.
		if (memberId != null) {
			const read = (await membersAsRead(tx, [memberId], { sessionId })).get(
				memberId
			)
			if (read?.nodeState === "deceased") report.alreadyDeceased++
			else if (!(await liveTurn(tx, sessionId, row.sourceMessageId)))
				report.unanchored++
			else {
				await writeCastVersion(tx, {
					member: memberId,
					changes: { nodeState: "deceased" },
					writtenBy: "dc-cairns",
					session: {
						id: sessionId,
						messageId: row.sourceMessageId,
						ownAnchor: true
					}
				})
				report.versions++
			}
		}

		// progress.fallen.
		const present = fallen.some(
			(f) =>
				isRec(f) &&
				(memberId != null
					? f.castMemberId === memberId
					: f.castMemberId == null &&
						lower(String(f.name ?? "")) === lower(name) &&
						(f.where ?? "") === epitaph.where)
		)
		if (!present) {
			fallen.push({
				name,
				where: epitaph.where,
				seat: matched.seat,
				castMemberId: memberId
			})
			fallenChanged = true
			report.fallenAdded++
		}

		// Retype in place.
		const anchor =
			memberId != null ? await anchorFor(tx, lorebookId, memberId) : null
		const typeId =
			anchor != null ? CHARACTER_LORE_TYPE_ID : WORLD_LORE_TYPE_ID
		const decl = entryDeclaration(typeId)
		const [current] = await tx
			.select({ fields: schema.lorebookEntries.fields })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, row.id))
		const kept: Record<string, unknown> = {}
		for (const field of declaredFields(typeId))
			kept[field] =
				(current?.fields as Record<string, unknown> | null)?.[field] ??
				fieldDefault(typeId, field)
		const title = row.title?.trim() ? row.title : name
		await tx
			.update(schema.lorebookEntries)
			.set({
				typeId,
				typeVersion: decl?.version ?? ENTRY_TYPE_VERSION,
				title: decl?.roles.title
					? anchor != null
						? title
						: `Cairn of ${name}`
					: null,
				anchorBindingId: decl?.roles.anchor ? anchor : null,
				fields: buildFields(kept),
				position: await nextPosition(tx, lorebookId, typeId)
			})
			.where(eq(schema.lorebookEntries.id, row.id))
		if (anchor != null) report.characterLore++
		else report.worldLore++
	}

	if (fallenChanged) {
		const next = {
			...annex,
			core: {
				...(core ?? {}),
				[PROGRESS_KEY]: { ...(progress ?? {}), fallen }
			}
		}
		await tx
			.update(schema.sessions)
			.set({
				annex: sql`${JSON.stringify(next)}::jsonb`,
				annexVersions: bumpedAnnexVersionsSql(
					schema.sessions.annexVersions,
					"core"
				),
				// The session's `updated_at` stays: a boot pass is not activity.
				updatedAt: sql`${schema.sessions.updatedAt}`
			})
			.where(eq(schema.sessions.id, sessionId))
	}
}

/** Whether `messageId` is a live message of the session. */
async function liveTurn(
	tx: Db,
	sessionId: number,
	messageId: number | null
): Promise<boolean> {
	if (messageId == null) return false
	const [row] = await tx
		.select({ id: schema.messages.id })
		.from(schema.messages)
		.where(
			and(
				eq(schema.messages.id, messageId),
				eq(schema.messages.sessionId, sessionId),
				liveMessageWhere(schema.messages.rewindOrdinal)
			)
		)
		.limit(1)
	return !!row
}

async function matchSeat(
	tx: Db,
	sessionId: number,
	messageId: number | null,
	name: string,
	seats: Seat[],
	bySeatId: Map<number, Seat>,
	lower: (s: string | null) => string
): Promise<Matched> {
	const asMatched = (seat: Seat): Matched => ({
		seat: `player-seat:${seat.id}`,
		castMemberId: seat.castMemberId
	})
	if (messageId != null) {
		const dead = await tx
			.select({
				ownerKind: schema.attributeValues.ownerKind,
				ownerId: schema.attributeValues.ownerId
			})
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.sessionId, sessionId),
					eq(schema.attributeValues.slotId, FATE_SLOT),
					eq(schema.attributeValues.validFromMessageId, messageId),
					sql`${schema.attributeValues.value}->>'v' = 'dead'`,
					inArray(schema.attributeValues.ownerKind, [
						"player_seat",
						"seated_member"
					])
				)
			)
			.orderBy(schema.attributeValues.id)
		const candidates: { seat: Seat | null; matched: Matched }[] = []
		for (const d of dead) {
			if (d.ownerKind === "player_seat") {
				const seat = bySeatId.get(d.ownerId)
				if (seat) candidates.push({ seat, matched: asMatched(seat) })
			} else {
				const seat = seats.find((s) => s.castMemberId === d.ownerId) ?? null
				candidates.push({
					seat,
					matched: seat
						? asMatched(seat)
						: {
								seat: `seated-member:${d.ownerId}`,
								castMemberId: d.ownerId
							}
				})
			}
		}
		if (candidates.length === 1) return candidates[0]!.matched
		if (candidates.length > 1) {
			const named = candidates.filter(
				(c) => c.seat && lower(c.seat.name) === lower(name)
			)
			if (named.length === 1) return named[0]!.matched
		}
	}
	const byName = seats.filter((s) => s.name && lower(s.name) === lower(name))
	return byName.length === 1 ? asMatched(byName[0]!) : NO_MATCH
}

/** The binding a character-lore row of the member anchors to in this book, or null. */
async function anchorFor(
	tx: Db,
	lorebookId: number,
	memberId: number
): Promise<number | null> {
	const [member] = await tx
		.select({ lorebookId: schema.lorebookBindings.lorebookId })
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, memberId))
	if (!member) return null
	if (member.lorebookId === lorebookId) return memberId
	const [overlay] = await tx
		.select({ id: schema.lorebookBindings.id })
		.from(schema.lorebookBindings)
		.where(
			and(
				eq(schema.lorebookBindings.overlayOf, memberId),
				eq(schema.lorebookBindings.lorebookId, lorebookId)
			)
		)
		.orderBy(schema.lorebookBindings.id)
		.limit(1)
	return overlay?.id ?? null
}
