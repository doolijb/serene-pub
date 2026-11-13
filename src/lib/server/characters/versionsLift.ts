/**
 * ⏳ The `character-versions` boot pass (plan §32 §8, §33.4, §33.5): moves
 * every install onto character versions, once.
 *
 * - **Cards** get **v1** (`ensureCardVersion`), one transaction per owner (the
 *   card set).
 * - **Members** get a **base** (`memberProfileOf`: retold-ON fields own, the
 *   rest `follows`). An **overlay row** (`overlay_of` set) gets none: it holds
 *   only a session's writes.
 * - **Amendments** become complete versions, **per line, parents first**, so a
 *   branch is verified after the line it forks from. A member's cast amendments
 *   are never deleted or changed.
 * - **Verify.** For each (line, breakpoint, tier) from the lowest tier up, today's
 *   fold (`castAsOf` over `amendmentsForAppearance(amendmentsOnLine(…))`, layered
 *   by `layerMemberAsRead`) is compared with the pick
 *   (`versionInForce`, layered by `layerVersionAsRead`). Where they differ a
 *   version is inserted on that line, at that date, with that tier's life point.
 *   Date-first picking (★CV-1) is why: a branch amendment dated before a later
 *   main one reads differently once lifted, and the version on the branch at
 *   the later date puts it right (a nearer line outranks main on a date tie).
 * - **Lift anyway.** What a version still cannot say is lifted all the same,
 *   and the pass writes a `note` on the member's base listing line, date,
 *   appearance and fields, and counts the member in `noted`. Owner
 *   (2026-11-05 late), mixed greetings: "Own list, noted": "the member gets its
 *   own full list (its retold opener + the card's current others), listed in
 *   the upgrade note and count".
 * - **Seats.** Every character seat gets `seated_by_user_id` from the held
 *   card's owner (owner, 2026-11-05 late, "The person who seated it"; §33.4:
 *   "so nothing changes for existing seats").
 *
 * Rules it works under. Breakpoints are each amendment date on the line's chain
 * within its cuts; the tiers are below every life point, each amendment life
 * point and presence position, and null. Idempotent: a member with a base, or a
 * card with v1, is skipped; with nothing to do the pass reads ONE query. `failsHealth`:
 * a unit (a card set, a book) that throws is rolled back alone, counted in
 * `failed`, logged by id, and the pass goes on; after the loop a non-zero
 * `failed` throws one error naming the count. Inside `db.transaction` only `tx`
 * is used. The pass takes `db` as its first parameter and imports no database.
 *
 * Each member's rows are worked out in memory (the verify step reads them with
 * stand-in ids and write orders that rise in insert order) and inserted in one
 * go through the module's one INSERT, so the base can carry its note without a
 * second writer of `character_versions`.
 *
 * Within a (line, breakpoint, tier) at most ONE version is written: a date tie
 * between two amendments is folded by apply order (date, then id) before the
 * version is made, so the version's write order never has to carry that tie.
 * The head reads exactly what the last breakpoint reads (the same amendments,
 * the same versions), so it is not checked twice.
 *
 * ⏳ lives until the S5 drop (the drop's `before` hook runs the lift core when
 * this pass never ran).
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { NodeState, NodeVisibility } from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import {
	ensureCardVersion,
	insertCharacterVersions,
	memberProfileOf
} from "$lib/server/characters/versions"
import {
	layerMemberAsRead,
	layerVersionAsRead,
	type CardRowForReading,
	type MemberAsRead,
	type MemberRowForReading
} from "$lib/server/cast/memberAsRead"
import { mergeGreetings, profileOf } from "$lib/shared/characters/profile"
import type { CharacterTimbreInput } from "$lib/shared/characters/timbre"
import {
	amendmentsForAppearance,
	castAsOf
} from "$lib/shared/lorebooks/amendments"
import {
	amendmentsOnLine,
	lineOf,
	MAIN_LINE,
	versionInForce,
	type Line
} from "$lib/shared/lorebooks/lineReading"
import { ownNameValue } from "$lib/shared/lorebooks/memberIdentity"
import type { RetoldFlags } from "$lib/shared/lorebooks/retold"
import { compareDates, type StoryDate } from "$lib/shared/lorebooks/storyDate"

export interface CharacterVersionsLiftReport {
	/** Cards given v1. */
	cards: number
	/** Cast members given a base. */
	members: number
	/** Versions lifted from amendments, beyond the bases. */
	versions: number
	/** Members whose base carries a note: something still reads differently, or their greetings became their own list. */
	noted: number
	/** Character seats given their seater. */
	seats: number
	/** Units (a card set, a book, the seats) that threw and were rolled back. */
	failed: number
}

type VersionRow = typeof schema.characterVersions.$inferSelect
type NewVersion = Parameters<typeof insertCharacterVersions>[1][number]

const EMPTY_SETS = { member: [], card: [] } as const

/** Rows of one insert, so a big book stays inside the driver's parameter limit. */
const INSERT_CHUNK = 100

const MEMBER_COLUMNS = {
	id: schema.lorebookBindings.id,
	lorebookId: schema.lorebookBindings.lorebookId,
	characterId: schema.lorebookBindings.characterId,
	name: schema.lorebookBindings.name,
	aliases: schema.lorebookBindings.aliases,
	summary: schema.lorebookBindings.summary,
	description: schema.lorebookBindings.description,
	personality: schema.lorebookBindings.personality,
	scenario: schema.lorebookBindings.scenario,
	firstMessage: schema.lorebookBindings.firstMessage,
	alternateGreetings: schema.lorebookBindings.alternateGreetings,
	exampleDialogues: schema.lorebookBindings.exampleDialogues,
	faceMediaId: schema.lorebookBindings.faceMediaId,
	retold: schema.lorebookBindings.retold,
	ownName: schema.lorebookBindings.ownName,
	ownNickname: schema.lorebookBindings.ownNickname,
	timbre: schema.lorebookBindings.timbre,
	spriteSet: schema.lorebookBindings.spriteSet,
	nodeState: schema.lorebookBindings.nodeState,
	nodeVisibility: schema.lorebookBindings.nodeVisibility
} as const

const CARD_COLUMNS = {
	id: schema.characters.id,
	name: schema.characters.name,
	nickname: schema.characters.nickname,
	description: schema.characters.description,
	personality: schema.characters.personality,
	scenario: schema.characters.scenario,
	firstMessage: schema.characters.firstMessage,
	alternateGreetings: schema.characters.alternateGreetings,
	exampleDialogues: schema.characters.exampleDialogues,
	groupOnlyGreetings: schema.characters.groupOnlyGreetings,
	avatarMediaId: schema.characters.avatarMediaId,
	extensions: schema.characters.extensions
} as const

type MemberRow = Pick<
	typeof schema.lorebookBindings.$inferSelect,
	keyof typeof MEMBER_COLUMNS
>

// ── The pass ──────────────────────────────────────────────────────────────

export async function liftCharacterVersions(
	db: Db
): Promise<CharacterVersionsLiftReport> {
	const report: CharacterVersionsLiftReport = {
		cards: 0,
		members: 0,
		versions: 0,
		noted: 0,
		seats: 0,
		failed: 0
	}
	// One query: a card with no version, a member (not an overlay row) with
	// none, a character seat with no seater whose card exists.
	const [pending] = rawRows<{
		cards: unknown
		members: unknown
		seats: unknown
	}>(
		await db.execute(sql`
		select
			exists (select 1 from characters c
				where not exists (select 1 from character_versions v where v.card_id = c.id)) as cards,
			exists (select 1 from lorebook_bindings b
				where b.overlay_of is null
					and not exists (select 1 from character_versions v where v.cast_member_id = b.id)) as members,
			exists (select 1 from session_characters sc
				join characters c on c.id = sc.character_id
				where sc.seated_by_user_id is null) as seats
	`)
	)
	if (!pending || !(pending.cards || pending.members || pending.seats))
		return report

	if (pending.cards) {
		const owners = rawRows<{ user_id: unknown }>(
			await db.execute(sql`
			select distinct c.user_id from characters c
			where not exists (select 1 from character_versions v where v.card_id = c.id)
			order by c.user_id
		`)
		).map((r) => Number(r.user_id))
		for (const userId of owners) {
			try {
				report.cards += await db.transaction(async (tx) =>
					giveCardSetItsVersions(tx as unknown as Db, userId)
				)
			} catch (err) {
				report.failed++
				console.error(
					`[character-versions] the cards of user ${userId} were left as they were:`,
					err
				)
			}
		}
	}

	if (pending.members) {
		const books = rawRows<{ lorebook_id: unknown }>(
			await db.execute(sql`
			select distinct b.lorebook_id from lorebook_bindings b
			where b.overlay_of is null
				and not exists (select 1 from character_versions v where v.cast_member_id = b.id)
			order by b.lorebook_id
		`)
		).map((r) => Number(r.lorebook_id))
		for (const bookId of books) {
			try {
				const done = await db.transaction(async (tx) =>
					liftBook(tx as unknown as Db, bookId)
				)
				report.members += done.members
				report.versions += done.versions
				report.noted += done.noted
			} catch (err) {
				report.failed++
				console.error(
					`[character-versions] book ${bookId} was left as it was:`,
					err
				)
			}
		}
	}

	if (pending.seats) {
		try {
			report.seats = rawRows(
				await db.execute(sql`
				update session_characters sc set seated_by_user_id = c.user_id
				from characters c
				where c.id = sc.character_id and sc.seated_by_user_id is null
				returning sc.id
			`)
			).length
		} catch (err) {
			report.failed++
			console.error(
				"[character-versions] the seats were left as they were:",
				err
			)
		}
	}

	if (report.failed > 0)
		throw new Error(
			`${report.failed} unit(s) could not be lifted onto character versions; see the log`
		)
	return report
}

// ── Cards ─────────────────────────────────────────────────────────────────

/** v1 for each card of one owner that has none; answers how many it made. */
async function giveCardSetItsVersions(tx: Db, userId: number): Promise<number> {
	const c = schema.characters
	const ids = await tx
		.select({ id: c.id })
		.from(c)
		.where(
			and(
				eq(c.userId, userId),
				sql`not exists (select 1 from character_versions v where v.card_id = ${c.id})`
			)
		)
		.orderBy(asc(c.id))
	let made = 0
	for (const { id } of ids) if (await ensureCardVersion(tx, id)) made++
	return made
}

/** The cards a unit meets: their current version, and the row today's read layers a member over. */
function cardsOf(tx: Db) {
	const versions = new Map<number, VersionRow | null>()
	const versionsById = new Map<number, VersionRow>()
	const readings = new Map<number, CardRowForReading | null>()
	return {
		async version(cardId: number | null): Promise<VersionRow | null> {
			if (cardId == null) return null
			if (!versions.has(cardId)) {
				const version = await ensureCardVersion(tx, cardId)
				versions.set(cardId, version)
				if (version) versionsById.set(version.id, version)
			}
			return versions.get(cardId) ?? null
		},
		byId(versionId: number): VersionRow | undefined {
			return versionsById.get(versionId)
		},
		async reading(
			cardId: number | null
		): Promise<CardRowForReading | null> {
			if (cardId == null) return null
			if (!readings.has(cardId)) {
				const [row] = await tx
					.select(CARD_COLUMNS)
					.from(schema.characters)
					.where(eq(schema.characters.id, cardId))
				readings.set(cardId, row ?? null)
			}
			return readings.get(cardId) ?? null
		}
	}
}

// ── Books ─────────────────────────────────────────────────────────────────

interface LineEntry {
	branchId: number | null
	name: string
	line: Line
}

interface MemberAmendment {
	id: number
	branchId: number | null
	year: number
	month: number | null
	day: number | null
	fields: Record<string, unknown>
	personalPosition: number | null
	historyEntryId: number | null
}

/** One book's members with no base, lifted under the book's write lock. */
async function liftBook(
	tx: Db,
	bookId: number
): Promise<{ members: number; versions: number; noted: number }> {
	// The book's write lock, the one its other writers take.
	await tx.execute(sql`select pg_advisory_xact_lock(${bookId})`)
	const lb = schema.lorebookBindings
	const members: MemberRow[] = await tx
		.select(MEMBER_COLUMNS)
		.from(lb)
		.where(
			and(
				eq(lb.lorebookId, bookId),
				isNull(lb.overlayOf),
				sql`not exists (select 1 from character_versions v where v.cast_member_id = ${lb.id})`
			)
		)
		.orderBy(asc(lb.id))
	if (!members.length) return { members: 0, versions: 0, noted: 0 }
	const memberIds = members.map((m) => m.id)

	const amendmentsOf = new Map<number, MemberAmendment[]>()
	for (const a of await tx
		.select()
		.from(schema.castAmendments)
		.where(
			and(
				eq(schema.castAmendments.lorebookId, bookId),
				inArray(schema.castAmendments.lorebookBindingId, memberIds)
			)
		)
		.orderBy(asc(schema.castAmendments.id))) {
		const list = amendmentsOf.get(a.lorebookBindingId) ?? []
		list.push({
			id: a.id,
			branchId: a.branchId ?? null,
			year: a.year,
			month: a.month ?? null,
			day: a.day ?? null,
			fields: (a.fields ?? {}) as Record<string, unknown>,
			personalPosition: a.personalPosition ?? null,
			historyEntryId: a.historyEntryId ?? null
		})
		amendmentsOf.set(a.lorebookBindingId, list)
	}
	const presenceOf = new Map<number, number[]>()
	for (const p of await tx
		.select({
			memberId: schema.castPresences.lorebookBindingId,
			position: schema.castPresences.personalPosition
		})
		.from(schema.castPresences)
		.where(
			and(
				eq(schema.castPresences.lorebookId, bookId),
				inArray(schema.castPresences.lorebookBindingId, memberIds)
			)
		)) {
		const list = presenceOf.get(p.memberId) ?? []
		list.push(p.position)
		presenceOf.set(p.memberId, list)
	}

	// Every line of the book, parents first: a branch comes after the line it forks from.
	const branches = await tx
		.select()
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, bookId))
	const lines: LineEntry[] = [
		{ branchId: null, name: "main", line: MAIN_LINE },
		...branches
			.map((b) => ({
				branchId: b.id as number | null,
				name: b.name,
				line: lineOf(b.id, branches)
			}))
			.sort(
				(a, b) =>
					a.line.steps.length - b.line.steps.length ||
					a.branchId! - b.branchId!
			)
	]

	const cards = cardsOf(tx)
	let standIn = 0
	const rows: VersionRow[] = []
	let noted = 0
	for (const member of members) {
		const lifted = await liftMember({
			member,
			amendments: amendmentsOf.get(member.id) ?? [],
			positions: presenceOf.get(member.id) ?? [],
			lines,
			cards,
			nextId: () => ++standIn
		})
		rows.push(...lifted.rows)
		if (lifted.noted) noted++
	}

	for (let i = 0; i < rows.length; i += INSERT_CHUNK)
		await insertCharacterVersions(
			tx,
			rows.slice(i, i + INSERT_CHUNK).map(insertRowOf)
		)
	return {
		members: members.length,
		versions: rows.length - members.length,
		noted
	}
}

// ── One member ────────────────────────────────────────────────────────────

interface Tier {
	/** The appearance the read is made at: below every life point, one of them, or null (every appearance). */
	at: number | null
	/** The life point a version written for this tier carries. */
	position: number | null
}

/**
 * 🚧 One place where the lifted member still reads differently from the old
 * cast changes. Data, not prose: the admin list words it.
 */
export interface LiftDifference {
	/** The line the difference is on; null is main. */
	branchId: number | null
	/** The line's name at lift time. */
	line: string
	at: { kind: "date"; date: StoryDate } | { kind: "before-first-change" }
	/** The appearance (life point) it reads at; null is every appearance. */
	appearance: number | null
	fields: string[]
}

/**
 * 🚧 What a lifted member's base holds in `note` (a text column) when
 * `written_by = 'lift'`: `JSON.stringify` of this.
 */
export interface LiftNoteV1 {
	v: 1
	differences: LiftDifference[]
	/** One half of the greetings was retold, so the member got its own list. */
	mixedGreetings?: true
}

/** The lift note a base holds; null for null, text that is not JSON, or another shape. Never throws. */
export function parseLiftNote(note: string | null): LiftNoteV1 | null {
	if (note == null) return null
	try {
		const o = JSON.parse(note) as unknown
		if (!o || typeof o !== "object" || Array.isArray(o)) return null
		const n = o as Record<string, unknown>
		if (n.v !== 1 || !Array.isArray(n.differences)) return null
		if (n.mixedGreetings !== undefined && n.mixedGreetings !== true)
			return null
		return o as LiftNoteV1
	} catch {
		return null
	}
}

/** The base, then the versions lifted from the member's amendments, with the base's note. */
async function liftMember(args: {
	member: MemberRow
	amendments: MemberAmendment[]
	positions: number[]
	lines: LineEntry[]
	cards: ReturnType<typeof cardsOf>
	nextId: () => number
}): Promise<{ rows: VersionRow[]; noted: boolean }> {
	const { member, amendments, lines, cards } = args
	const stored = member as unknown as Record<string, unknown>
	const drafts: VersionRow[] = []
	const differences: LiftDifference[] = []
	let mixedGreetings = false

	/** A complete version of the member as `folded` reads (the stored row for the base). */
	const draft = async (
		folded: Record<string, unknown>,
		at: {
			branchId: number | null
			date: StoryDate | null
			position: number | null
			from: MemberAmendment | null
		}
	): Promise<VersionRow> => {
		const row = asMemberRow(folded, member.characterId)
		const parent = await cards.version(row.characterId)
		const converted = memberProfileOf(
			row,
			parent ? profileOf(parent) : null
		)
		if (converted.mixedGreetings) mixedGreetings = true
		const id = args.nextId()
		return {
			id,
			cardId: null,
			castMemberId: member.id,
			number: null,
			label: null,
			parentVersionId: parent?.id ?? null,
			lorebookId: member.lorebookId,
			branchId: at.branchId,
			year: at.date?.year ?? null,
			month: at.date?.month ?? null,
			day: at.date?.day ?? null,
			historyEntryId: at.from?.historyEntryId ?? null,
			atHour: null,
			atMinute: null,
			personalPosition: at.position,
			sourceSessionId: null,
			sourceMessageId: null,
			writtenBy: "lift",
			note: null,
			liftedFromAmendmentId: at.from?.id ?? null,
			validFromMessageId: null,
			writeOrder: id,
			retiredOrder: null,
			...converted.own,
			nodeState: ((folded.nodeState as NodeState | undefined) ??
				"active") as NodeState,
			nodeVisibility: ((folded.nodeVisibility as
				| NodeVisibility
				| undefined) ?? "normal") as NodeVisibility,
			follows: converted.follows,
			createdAt: new Date(0),
			updatedAt: new Date(0)
		}
	}

	/** Today's read of a folded row, and the pick's read of the version in force. */
	const compare = async (
		folded: Record<string, unknown>,
		pick: VersionRow | null
	): Promise<string[]> => {
		const row = asMemberRow(folded, member.characterId)
		const old = layerMemberAsRead(
			row,
			await cards.reading(row.characterId),
			EMPTY_SETS,
			[]
		)
		if (!pick) return Object.keys(oldComparable(old, folded))
		const parent =
			pick.parentVersionId != null
				? (cards.byId(pick.parentVersionId) ?? null)
				: null
		const now = layerVersionAsRead(
			member,
			pick,
			parent,
			parent?.number ?? null,
			EMPTY_SETS,
			[]
		)
		return differingFields(oldComparable(old, folded), newComparable(now))
	}

	// The base.
	const base = await draft(stored, {
		branchId: null,
		date: null,
		position: null,
		from: null
	})
	drafts.push(base)
	const unamended = await compare(stored, base)
	if (unamended.length)
		differences.push({
			branchId: null,
			line: "main",
			at: { kind: "before-first-change" },
			appearance: null,
			fields: unamended
		})

	// The tiers: below every life point, each of them, null.
	const positions = [
		...new Set([
			...amendments
				.map((a) => a.personalPosition)
				.filter((p): p is number => p != null),
			...args.positions
		])
	].sort((a, b) => a - b)
	const tiers: Tier[] = positions.length
		? [
				{
					at: positions[0] - 1,
					position: null
				},
				...positions.map((p) => ({
					at: p,
					position: p
				})),
				{
					at: null,
					position: positions[positions.length - 1]
				}
			]
		: [{ at: null, position: null }]

	for (const L of lines) {
		const onChain = amendmentsOnLine(amendments, L.line, null)
		if (!onChain.length) continue
		// The breakpoints: each distinct amendment date on the chain, within its cuts.
		const breakpoints: StoryDate[] = []
		for (const a of onChain)
			if (
				!breakpoints.some(
					(d) =>
						d.year === a.year &&
						(d.month ?? null) === a.month &&
						(d.day ?? null) === a.day
				)
			)
				breakpoints.push({ year: a.year, month: a.month, day: a.day })
		breakpoints.sort(compareDates)

		for (const D of breakpoints)
			for (const tier of tiers) {
				const applied = amendmentsForAppearance(
					amendmentsOnLine(amendments, L.line, D),
					tier.at
				)
				const folded = castAsOf(stored, applied, {
					line: L.line,
					moment: D
				})
				let fields = await compare(
					folded,
					versionInForce(drafts, L.line, D, tier.at)
				)
				if (!fields.length) continue
				// The latest amendment applied, by apply order, is the one the version comes from.
				const from = applied[applied.length - 1] ?? null
				if (from) {
					drafts.push(
						await draft(folded, {
							branchId: L.branchId,
							date: D,
							position: tier.position,
							from
						})
					)
					fields = await compare(
						folded,
						versionInForce(drafts, L.line, D, tier.at)
					)
				}
				if (!fields.length) continue
				// The every-appearance read is the highest life point's: not said twice.
				if (
					tier.at == null &&
					positions.length &&
					differences.some(
						(n) =>
							n.line === L.name &&
							n.at.kind === "date" &&
							compareDates(n.at.date, D) === 0 &&
							sameFields(n.fields, fields)
					)
				)
					continue
				differences.push({
					branchId: L.branchId,
					line: L.name,
					at: { kind: "date", date: D },
					appearance: tier.at,
					fields
				})
			}
	}

	if (differences.length || mixedGreetings) {
		const note: LiftNoteV1 = { v: 1, differences }
		if (mixedGreetings) note.mixedGreetings = true
		base.note = JSON.stringify(note)
	}
	return { rows: drafts, noted: differences.length > 0 || mixedGreetings }
}

// ── Reading, comparing, labelling ─────────────────────────────────────────

/** A row (or a folded row) as today's read takes it: what `memberAsRead.ts` does before it layers. */
function asMemberRow(
	row: Record<string, unknown>,
	linkedCardId: number | null
): MemberRowForReading {
	const text = (v: unknown) => (typeof v === "string" ? v : null)
	const list = (v: unknown) =>
		Array.isArray(v)
			? v.filter((g): g is string => typeof g === "string")
			: []
	const timbre =
		row.timbre &&
		typeof row.timbre === "object" &&
		!Array.isArray(row.timbre)
			? (row.timbre as CharacterTimbreInput)
			: null
	return {
		id: row.id as number,
		lorebookId: row.lorebookId as number,
		characterId:
			typeof row.characterId === "number" ? row.characterId : null,
		linkedCardId,
		name: text(row.name) ?? "",
		aliases: list(row.aliases),
		summary: text(row.summary),
		description: text(row.description),
		personality: text(row.personality),
		scenario: text(row.scenario),
		firstMessage: text(row.firstMessage),
		alternateGreetings: list(row.alternateGreetings),
		exampleDialogues: text(row.exampleDialogues),
		faceMediaId:
			typeof row.faceMediaId === "number" ? row.faceMediaId : null,
		ownName: ownNameValue(row.ownName),
		ownNickname: ownNameValue(row.ownNickname),
		retold:
			row.retold &&
			typeof row.retold === "object" &&
			!Array.isArray(row.retold)
				? (row.retold as RetoldFlags)
				: {},
		timbre,
		spriteSet: text(row.spriteSet)
	}
}

/** What the two reads are compared on: the greetings as ONE list, the node state from the fold today's read leaves out. */
function oldComparable(
	read: MemberAsRead,
	folded: Record<string, unknown>
): Record<string, unknown> {
	return {
		...comparableOf(read),
		greetings: mergeGreetings(
			read.firstMessage,
			read.alternateGreetings,
			read.groupOnlyGreetings
		),
		nodeState: folded.nodeState ?? "active",
		nodeVisibility: folded.nodeVisibility ?? "normal"
	}
}

function newComparable(read: MemberAsRead): Record<string, unknown> {
	return {
		...comparableOf(read),
		greetings: read.greetings,
		nodeState: read.nodeState,
		nodeVisibility: read.nodeVisibility
	}
}

function comparableOf(read: MemberAsRead): Record<string, unknown> {
	return {
		name: read.name,
		nickname: read.nickname,
		aliases: read.aliases,
		summary: read.summary,
		description: read.description,
		personality: read.personality,
		scenario: read.scenario,
		exampleDialogues: read.exampleDialogues,
		faceMediaId: read.faceMediaId,
		timbre: read.timbre,
		activeCardId: read.activeCardId,
		spriteSet: read.spriteSet
	}
}

function differingFields(
	a: Record<string, unknown>,
	b: Record<string, unknown>
): string[] {
	return Object.keys(a).filter((key) => stable(a[key]) !== stable(b[key]))
}

/** A value as stable JSON: object keys sorted, so two equal values print alike. */
function stable(value: unknown): string | undefined {
	return JSON.stringify(value, (_key, v) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, (v as Record<string, unknown>)[k]])
				)
			: v
	)
}

function sameFields(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((f, i) => f === b[i])
}

/** A draft as the one INSERT takes it: the id, write order and stamps are drawn there. */
function insertRowOf(row: VersionRow): NewVersion {
	const {
		id: _id,
		writeOrder: _writeOrder,
		createdAt: _createdAt,
		updatedAt: _updatedAt,
		...rest
	} = row
	return rest
}
