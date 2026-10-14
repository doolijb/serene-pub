/**
 * **Retold fields** at the read seams (PLAN-cast-retold-fields-2026-10-13).
 *
 * A session seats a CARD; when the session's lorebook has that card as a cast
 * member, and the member retells some of the card's fields
 * (`lorebook_bindings.retold`), the member's own text is read in their place.
 * With `retold = {}` — every member until someone toggles a field — nothing
 * here changes a byte of what a session reads.
 *
 * ⚠ Must not statically import `$lib/server/db`; every function takes its
 * handle (the `castMemberCards` rule).
 */
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { MediaVisibility } from "$lib/shared/constants/MediaVisibility"
import {
	parseRetoldFlags,
	RETOLD_TEXT_FIELDS,
	type RetoldFlags
} from "$lib/shared/lorebooks/retold"
import type { Amendment } from "$lib/shared/lorebooks/amendments"
import type { EntryReading } from "$lib/server/state/entriesOnReading"

/** A cast member's retold columns, as one reading has them. */
export interface RetoldMember {
	id: number
	characterId: number | null
	description: string | null
	personality: string | null
	scenario: string | null
	firstMessage: string | null
	alternateGreetings: string[]
	exampleDialogues: string | null
	faceMediaId: number | null
	retold: RetoldFlags
}

/** The `lorebook_bindings` columns a `RetoldMember` is read from. */
export const RETOLD_MEMBER_COLUMNS = {
	id: schema.lorebookBindings.id,
	characterId: schema.lorebookBindings.characterId,
	description: schema.lorebookBindings.description,
	personality: schema.lorebookBindings.personality,
	scenario: schema.lorebookBindings.scenario,
	firstMessage: schema.lorebookBindings.firstMessage,
	alternateGreetings: schema.lorebookBindings.alternateGreetings,
	exampleDialogues: schema.lorebookBindings.exampleDialogues,
	faceMediaId: schema.lorebookBindings.faceMediaId,
	retold: schema.lorebookBindings.retold
} as const

/** Whether a member retells anything at all. */
export function retellsAnything(member: Pick<RetoldMember, "retold">): boolean {
	const r = member.retold
	return !!r && typeof r === "object" && Object.values(r).some((v) => v === true)
}

/** A resolved row, normalised — an overlay may have set any of these to anything. */
function asRetoldMember(row: Record<string, unknown>): RetoldMember {
	const text = (v: unknown) => (typeof v === "string" ? v : null)
	const retold =
		row.retold && typeof row.retold === "object" && !Array.isArray(row.retold)
			? (row.retold as RetoldFlags)
			: {}
	return {
		id: row.id as number,
		characterId: (row.characterId as number | null) ?? null,
		description: text(row.description),
		personality: text(row.personality),
		scenario: text(row.scenario),
		firstMessage: text(row.firstMessage),
		alternateGreetings: Array.isArray(row.alternateGreetings)
			? row.alternateGreetings.filter((g): g is string => typeof g === "string")
			: [],
		exampleDialogues: text(row.exampleDialogues),
		faceMediaId:
			typeof row.faceMediaId === "number" ? row.faceMediaId : null,
		retold
	}
}

/**
 * The card as the member tells it: each retold prose field replaced by the
 * member's text (`""` when the member's column is empty — retold means the
 * member's text is read, even when it says nothing), greetings as a list.
 * Retelling the description or the personality drops the card's strokes,
 * which would otherwise beat the prose. Returns the SAME object when the
 * member retells no field of the card's text, so an untouched card stays
 * identical.
 *
 * `face` is not applied here — the card's avatar is the card's; the member's
 * face travels as `castFaces` on `sessions:get`.
 */
/** A member's example-dialogue text as the card shape: one entry per `<START>`. */
export function splitExampleDialogues(text: unknown): string[] {
	if (typeof text !== "string") return []
	return text
		.split("<START>")
		.map((d) => d.trim())
		.filter((d) => d !== "")
}

export function applyRetold<T extends object>(
	card: T,
	member: Pick<RetoldMember, "retold"> &
		Partial<Omit<RetoldMember, "retold">>
): T {
	const r = member.retold ?? {}
	const fields: Record<string, unknown> = {}
	for (const field of RETOLD_TEXT_FIELDS)
		if (r[field] === true) fields[field] = member[field] ?? ""
	// The member's example dialogues are ONE text (the column is text, the
	// form writes each dialogue opened with `<START>`); the card's are an
	// array and the prompt reader (`characterExampleDialogue`) only reads an
	// array. Split the same way the card editor migrates an old string card.
	if (r.exampleDialogues === true)
		fields.exampleDialogues = splitExampleDialogues(member.exampleDialogues)
	if (r.alternateGreetings === true)
		fields.alternateGreetings = Array.isArray(member.alternateGreetings)
			? [...member.alternateGreetings]
			: []
	if (!Object.keys(fields).length) return card
	if (r.description === true || r.personality === true) fields.strokes = null
	// A member who retells their greetings replaces ALL of the card's,
	// group-only ones too: `buildCharacterFirstSessionMessage` reads a card's
	// `groupOnlyGreetings` first in a group session, so leaving them would
	// make the member's greetings silently lose there (review 2026-10-13).
	if (r.firstMessage === true || r.alternateGreetings === true)
		fields.groupOnlyGreetings = []
	return { ...card, ...fields } as T
}

/**
 * Each card → the member it is, as the reading has the member, kept to the
 * members that retell anything. Pure: the caller has the members, their
 * overlays and the book's card map already (the `session_cast` read does).
 */
export function retoldByCard(
	members: readonly Record<string, unknown>[],
	overlays: ReadonlyMap<number, readonly Amendment[]>,
	reading: EntryReading,
	memberOf: ReadonlyMap<number, number>,
	castMemberAt: <M extends { id: number; characterId?: number | null }>(
		member: M,
		overlays: ReadonlyMap<number, readonly Amendment[]>,
		reading: EntryReading,
		opts?: { keepCard?: boolean }
	) => M
): Map<number, RetoldMember> {
	const byMember = new Map<number, RetoldMember>()
	for (const row of members) {
		const resolved = asRetoldMember(
			castMemberAt(
				row as { id: number; characterId?: number | null },
				overlays,
				reading,
				{ keepCard: true }
			) as Record<string, unknown>
		)
		if (retellsAnything(resolved)) byMember.set(resolved.id, resolved)
	}
	const out = new Map<number, RetoldMember>()
	for (const [card, memberId] of memberOf) {
		const member = byMember.get(memberId)
		if (member) out.set(card, member)
	}
	return out
}

/**
 * The retelling members of a session's lorebook, by card, as the session's
 * reading has them — optionally kept to `cardIds`. Empty when the session has
 * no lorebook or nobody in it retells anything. One read of the book's
 * members; the overlays and card map are read only when someone retells.
 */
export async function retoldMembersForSession(
	db: Db,
	session: number | { id: number; lorebookId: number | null },
	cardIds?: readonly number[]
): Promise<Map<number, RetoldMember>> {
	const s =
		typeof session === "number"
			? (
					await db
						.select({
							id: schema.sessions.id,
							lorebookId: schema.sessions.lorebookId
						})
						.from(schema.sessions)
						.where(eq(schema.sessions.id, session))
						.limit(1)
				)[0]
			: session
	if (!s?.lorebookId) return new Map()
	if (cardIds && !cardIds.length) return new Map()
	const lorebookId = s.lorebookId
	const members = await db
		.select(RETOLD_MEMBER_COLUMNS)
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
		.orderBy(asc(schema.lorebookBindings.id))
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const { MAIN_HEAD, castOverlaysFor, castMemberAt } = await import(
		"$lib/server/state/entriesOnReading"
	)
	const reading = (await sessionReadingOf(db, s.id)) ?? MAIN_HEAD
	const overlays = await castOverlaysFor(db, lorebookId, reading)
	// Nobody retells and no overlay could make them: nothing to resolve.
	if (!members.some(retellsAnything) && !overlays.size) return new Map()
	const { castMemberCards } = await import("$lib/server/utils/castMemberCards")
	const { memberOf } = await castMemberCards(db, lorebookId)
	const all = retoldByCard(members, overlays, reading, memberOf, castMemberAt)
	if (!cardIds) return all
	const out = new Map<number, RetoldMember>()
	for (const id of cardIds) {
		const m = all.get(id)
		if (m) out.set(id, m)
	}
	return out
}

/**
 * Why a file cannot be a member's face, or null when it can: the asker's own
 * upload for this book (`files.lorebook_id`), or a gallery image of the
 * member's card (`files.character_id`).
 */
export async function faceMediaProblem(
	db: Db,
	opts: {
		fileId: number
		lorebookId: number
		/** A card this change itself links (a dated card swap), if any. */
		characterId: number | null
		/**
		 * The member, so a gallery image of ANY card they are drawn with — on
		 * any line, at any date — may be worn. A dated card "is the member's,
		 * on any line and at any date" (NOMENCLATURE, dated card); judging
		 * only the stored card refused a face picked while reading a date
		 * whose card was swapped (review 2026-10-13).
		 */
		memberId?: number | null
		userId: number
	}
): Promise<string | null> {
	const refusal =
		"That picture is not one this cast member can wear: use a picture from their card's gallery, or upload one to this lorebook."
	if (!Number.isInteger(opts.fileId) || opts.fileId <= 0) return refusal
	const [file] = await db
		.select({
			userId: schema.files.userId,
			lorebookId: schema.files.lorebookId,
			characterId: schema.files.characterId,
			kind: schema.files.kind,
			visibility: schema.files.visibility
		})
		.from(schema.files)
		.where(eq(schema.files.id, opts.fileId))
		.limit(1)
	if (!file || file.kind !== "image") return refusal
	// The asker's own picture (an upload to this book — or the row an upload
	// re-used, since files are one row per user and bytes): theirs to show,
	// unless it is private, which nobody else could see as a face.
	if (file.userId === opts.userId && file.visibility !== MediaVisibility.PRIVATE)
		return null
	if (file.characterId == null) return refusal
	if (opts.characterId != null && file.characterId === opts.characterId)
		return null
	if (opts.memberId != null) {
		const { castMemberCards } = await import(
			"$lib/server/utils/castMemberCards"
		)
		const { cardsOf } = await castMemberCards(db, opts.lorebookId)
		if ((cardsOf.get(opts.memberId) ?? []).includes(file.characterId))
			return null
	}
	return refusal
}

/**
 * Why a member edit's retold columns cannot be written, or null — the
 * `lorebooks:updateBinding` check. Text is text, the other greetings are a
 * list of text, `retold` is flags over retold fields, and a NEW face must be
 * one the asker may use (`faceMediaProblem`); the member's current face is
 * never re-judged. Normalises `retold` in place.
 */
export async function retoldUpdateProblem(
	db: Db,
	update: Record<string, unknown>,
	member: {
		id: number
		lorebookId: number
		characterId: number | null
		faceMediaId: number | null
	},
	userId: number
): Promise<string | null> {
	const words = {
		description: "description",
		personality: "personality",
		scenario: "scenario",
		firstMessage: "first message",
		exampleDialogues: "example dialogues"
	} as const
	for (const field of RETOLD_TEXT_FIELDS) {
		const v = update[field]
		if (v !== undefined && v !== null && typeof v !== "string")
			return `A cast member's ${words[field]} is text.`
	}
	if (
		update.alternateGreetings !== undefined &&
		!(
			Array.isArray(update.alternateGreetings) &&
			update.alternateGreetings.every((g) => typeof g === "string")
		)
	)
		return "A cast member's other greetings are a list of greetings."
	if (update.retold !== undefined) {
		const parsed = parseRetoldFlags(update.retold)
		if (!parsed.ok) return parsed.error
		update.retold = parsed.retold
	}
	const face = update.faceMediaId
	if (face !== undefined && face !== null && face !== member.faceMediaId) {
		if (typeof face !== "number")
			return "That picture is not one this cast member can wear."
		const problem = await faceMediaProblem(db, {
			fileId: face,
			lorebookId: member.lorebookId,
			characterId: member.characterId,
			memberId: member.id,
			userId
		})
		if (problem) return problem
	}
	return null
}
