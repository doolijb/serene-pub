/**
 * 🚧 A cast member **as read** (plan §27 S2; owner ruling 2026-11-05: "Cards
 * seed cast, cast defaults to reading active linked card"; members carry
 * voice and sprites, own over card).
 *
 * One function every S2 reader uses to get what a cast member (a
 * `lorebook_bindings` row) *is*, on one reading.
 *
 * ## From a character version (plan §32 §6, §33)
 *
 * A member is read from the ONE character version in force on the reading
 * (`versionInForce`: the line, the moment, the life point, the session cuts
 * and the overlay chain), its `follows` fields from the exact parent card
 * version it names. The active card is that parent version's card ("Everything
 * in session is cast -> active card", owner 2026-11-05). The version's node
 * state is returned as data, never filtered: a later `deceased` version wins.
 *
 * ## A member with no base
 *
 * A member with no version that reads on the reading is a logged error
 * (`console.error`, once per member id) and is absent from the map, as an
 * unknown id is. Every member gets a base when it is made, and the boot lift
 * gave every older one theirs, so it should not happen. There is no legacy
 * read; the old member columns are frozen (⏳ dropped in S5).
 *
 * ⚠ Must not statically import `$lib/server/db`; every function takes its
 * handle first (the `castMemberCards` rule).
 */
import { and, asc, eq, inArray, max, ne, notInArray, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import type { NodeState, NodeVisibility } from "$lib/server/db/schema"
import {
	followedProfile,
	legacyGreetingsOf,
	mergeGreetings,
	profileOf,
	type CharacterCreatorNotes,
	type CharacterGreeting,
	type CharacterProfileField
} from "$lib/shared/characters/profile"
import type { CharacterLikenessInput } from "$lib/shared/characters/likeness"
import { MAIN_LINE, versionInForce, type Line } from "$lib/shared/lorebooks/lineReading"
import { onLineAtSql, sessionCutSql } from "$lib/server/state/lineSql"
import type { Stroke } from "@serene-pub/sdk"
import {
	RETOLD_FIELDS,
	retoldFieldList,
	type RetoldField,
	type RetoldFlags
} from "$lib/shared/lorebooks/retold"
import {
	memberFaceMediaId,
	memberNames
} from "$lib/shared/lorebooks/memberIdentity"
import {
	timbreOfExtensions,
	type CharacterTimbreInput
} from "$lib/shared/characters/timbre"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import { splitExampleDialogues } from "$lib/server/lorebooks/retold"
import type { EntryReading } from "$lib/server/state/entriesOnReading"
import type { LineReading } from "$lib/server/state/reading"
import { compareDates } from "$lib/shared/lorebooks/storyDate"

/** 🚧 A cast member as read: the character version in force on one reading, its followed fields read from its parent card version. */
export interface MemberAsRead {
	castMemberId: number
	lorebookId: number
	/** The version in force (`character_versions.id`); null only from `layerMemberAsRead`, the boot lift's comparison. */
	castVersionId: number | null
	/** The parent card version of the version in force; null when card-less. */
	cardVersion: { id: number; number: number; label: string | null } | null
	/** The member's stored linked card (`lorebook_bindings.character_id`). */
	linkedCardId: number | null
	/** The card the member is drawn with on this reading: the in-force version's parent's card. */
	activeCardId: number | null
	/** No active card on this reading: every field is the member's own. */
	cardless: boolean
	/** The parent card version is below that card's highest version number: the card has moved on since. */
	behindCard: boolean
	/** The profile fields the in-force version reads from its parent card version; [] when card-less. */
	follows: CharacterProfileField[]
	/** Node state at this point of the story (a version's own; never filtered). */
	nodeState: NodeState
	nodeVisibility: NodeVisibility
	name: string
	nickname: string | null
	/** nickname || name (memberShownName rule). */
	shownName: string
	aliases: string[] // member's own (amended)
	summary: string | null // member's own (amended)
	description: string | null
	personality: string | null
	scenario: string | null
	/** The merged greetings: the opener, the alternates, the group-only ones marked. */
	greetings: CharacterGreeting[]
	/** ⏳ Derived from `greetings` (`legacyGreetingsOf`) until the readers move onto it (wave 3). */
	firstMessage: string | null
	/** ⏳ Derived from `greetings` until the readers move onto it. */
	alternateGreetings: string[]
	/** The card's shape: one entry per dialogue (member text split with `splitExampleDialogues`). */
	exampleDialogues: string[]
	/** ⏳ Derived from `greetings` until the readers move onto it. */
	groupOnlyGreetings: string[]
	postHistoryInstructions: string | null
	creatorNotes: CharacterCreatorNotes | null
	strokes: Stroke[]
	likeness: CharacterLikenessInput | null
	extensions: Record<string, unknown>
	/** ⏳ Alias of `follows` in retold-field words until 0.7; [] when cardless. */
	followsCard: RetoldField[]
	faceMediaId: number | null
	timbre: CharacterTimbreInput | null
	voiceFrom: "member" | "card" | null
	spriteSets: {
		id: number
		name: string
		isDefault: boolean
		position: number
	}[]
	spriteSetsFrom: "member" | "card" | null
	/** The member's chosen set by name (`lorebook_bindings.sprite_set`, amendable), as stored. */
	spriteSet: string | null
	/** Card-only (the active card's tag names); [] when cardless. */
	tags: string[]
}

/** A reading, with the book it is of and whether that is the session's own notes, when the caller has them. */
type MemberReading = EntryReading & Partial<Pick<LineReading, "lorebookId" | "onOwnBook">>

export interface MemberAsReadOptions {
	reading?: MemberReading
	sessionId?: number
	/**
	 * The life point to read at (`versionInForce`'s `appearance`). Null (the
	 * default) = every life point, as sessions read; the roster passes each
	 * appearance later.
	 */
	appearance?: number | null
}

/**
 * 🚧 A cast member as one reading has it (already `castMemberAt`-resolved
 * WITHOUT `keepCard`): `characterId` is the ACTIVE card. `linkedCardId` is the
 * stored row's.
 */
export interface MemberRowForReading {
	id: number
	lorebookId: number
	/** The active card on this reading. */
	characterId: number | null
	/** The stored linked card. */
	linkedCardId: number | null
	name: string
	aliases: string[]
	summary: string | null
	description: string | null
	personality: string | null
	scenario: string | null
	firstMessage: string | null
	alternateGreetings: string[]
	/** The member's ONE text (`<START>`-separated). */
	exampleDialogues: string | null
	faceMediaId: number | null
	ownName: string | null
	ownNickname: string | null
	retold: RetoldFlags
	timbre: CharacterTimbreInput | null
	spriteSet: string | null
}

/** 🚧 The columns of the active card a reading needs. */
export interface CardRowForReading {
	id: number
	name: string
	nickname: string | null
	description: string | null
	personality: string | null
	scenario: string | null
	firstMessage: string | null
	alternateGreetings: string[]
	exampleDialogues: string[]
	groupOnlyGreetings: string[] | null
	avatarMediaId: number | null
	extensions: unknown
}

interface SpriteSetRow {
	id: number
	name: string
	isDefault: boolean
	position: number
}

/** The retold fields still read from the card: RETOLD_FIELDS minus the retold ones. */
export function followsCardFields(
	retold: RetoldFlags | null | undefined
): RetoldField[] {
	const own = new Set<RetoldField>(retoldFieldList(retold))
	return RETOLD_FIELDS.filter((field) => !own.has(field))
}

function sortedSets(rows: readonly SpriteSetRow[]): SpriteSetRow[] {
	return rows
		.map(({ id, name, isDefault, position }) => ({
			id,
			name,
			isDefault,
			position
		}))
		.sort((a, b) => a.position - b.position || a.id - b.id)
}

/**
 * 🚧 PURE: the boot lift's comparison (`characters/versionsLift.ts`). Layers
 * a member's frozen columns over its card the way the old read did (plan §27
 * S2), to compare with today's fold of the lifted versions. Reads no table;
 * `membersAsRead` does not call it. `sets` are the member's own sprite sets
 * and the card's; `tags` the card's tag names.
 */
export function layerMemberAsRead(
	member: MemberRowForReading,
	card: CardRowForReading | null,
	sets: { member: readonly SpriteSetRow[]; card: readonly SpriteSetRow[] },
	tags: readonly string[]
): MemberAsRead {
	const retold = member.retold ?? {}
	const own = (field: RetoldField) => retold[field] === true
	const memberGreetings = Array.isArray(member.alternateGreetings)
		? [...member.alternateGreetings]
		: []

	const names = card
		? memberNames(member, card)
		: memberNames(member, { name: member.name, nickname: null })

	let description: string | null
	let personality: string | null
	let scenario: string | null
	let firstMessage: string | null
	let alternateGreetings: string[]
	let exampleDialogues: string[]
	let groupOnlyGreetings: string[]
	if (card) {
		description = own("description")
			? (member.description ?? "")
			: (card.description ?? null)
		personality = own("personality")
			? (member.personality ?? "")
			: (card.personality ?? null)
		scenario = own("scenario")
			? (member.scenario ?? "")
			: (card.scenario ?? null)
		firstMessage = own("firstMessage")
			? (member.firstMessage ?? "")
			: (card.firstMessage ?? null)
		alternateGreetings = own("alternateGreetings")
			? memberGreetings
			: [...(card.alternateGreetings ?? [])]
		exampleDialogues = own("exampleDialogues")
			? splitExampleDialogues(member.exampleDialogues)
			: [...(card.exampleDialogues ?? [])]
		groupOnlyGreetings =
			own("firstMessage") || own("alternateGreetings")
				? []
				: [...(card.groupOnlyGreetings ?? [])]
	} else {
		description = member.description ?? null
		personality = member.personality ?? null
		scenario = member.scenario ?? null
		firstMessage = member.firstMessage ?? null
		alternateGreetings = memberGreetings
		exampleDialogues = splitExampleDialogues(member.exampleDialogues)
		groupOnlyGreetings = []
	}

	let timbre: CharacterTimbreInput | null = null
	let voiceFrom: "member" | "card" | null = null
	if (member.timbre != null) {
		timbre = timbreOfExtensions({ serenepub: { timbre: member.timbre } })
		voiceFrom = "member"
	} else if (card) {
		const fromCard = timbreOfExtensions(card.extensions)
		if (Object.keys(fromCard).length) {
			timbre = fromCard
			voiceFrom = "card"
		}
	}

	const memberSets = sortedSets(sets.member)
	const cardSets = card ? sortedSets(sets.card) : []
	const spriteSets = memberSets.length ? memberSets : cardSets
	const spriteSetsFrom: "member" | "card" | null = memberSets.length
		? "member"
		: cardSets.length
			? "card"
			: null

	return {
		castMemberId: member.id,
		lorebookId: member.lorebookId,
		castVersionId: null,
		cardVersion: null,
		linkedCardId: member.linkedCardId,
		activeCardId: card ? card.id : null,
		cardless: card == null,
		behindCard: false,
		follows: [],
		// The legacy read holds no node state; `membersAsRead` fills the folded row's.
		nodeState: "active",
		nodeVisibility: "normal",
		name: names.name,
		nickname: names.nickname,
		shownName: resolveCharacterName(names, ""),
		aliases: Array.isArray(member.aliases) ? [...member.aliases] : [],
		summary: member.summary ?? null,
		description,
		personality,
		scenario,
		greetings: mergeGreetings(
			firstMessage,
			alternateGreetings,
			groupOnlyGreetings
		),
		firstMessage,
		alternateGreetings,
		exampleDialogues,
		groupOnlyGreetings,
		postHistoryInstructions: null,
		creatorNotes: null,
		strokes: [],
		likeness: null,
		extensions: {},
		followsCard: card ? followsCardFields(retold) : [],
		faceMediaId: card
			? memberFaceMediaId({ ...member, retold }, card)
			: (member.faceMediaId ?? null),
		timbre,
		voiceFrom,
		spriteSets,
		spriteSetsFrom,
		spriteSet: member.spriteSet ?? null,
		tags: card ? [...tags] : []
	}
}

type VersionRow = typeof schema.characterVersions.$inferSelect

/** Each retold field's profile field: a retold field is followed when its profile field is in `follows`. */
const PROFILE_FIELD_OF: Record<RetoldField, CharacterProfileField> = {
	description: "description",
	personality: "personality",
	scenario: "scenario",
	firstMessage: "greetings",
	alternateGreetings: "greetings",
	exampleDialogues: "exampleDialogues",
	face: "faceMediaId",
	postHistoryInstructions: "postHistoryInstructions",
	creatorNotes: "creatorNotes",
	likeness: "likeness"
}

/**
 * 🚧 PURE: one member as read from its version in force (plan §32 §6).
 * `member` is the asked binding; `version` the in-force `character_versions`
 * row; `parent` its parent card version or null (card-less); `maxCardNumber`
 * the parent's card's highest version number (null when no parent). `sets`
 * are the member's own sprite sets and the parent card's; `tags` the parent
 * card's tag names.
 *
 * A version whose `follows` is non-empty with no parent reads those fields
 * empty (`followedProfile`); the caller logs it.
 */
export function layerVersionAsRead(
	member: { id: number; lorebookId: number; characterId: number | null },
	version: VersionRow,
	parent: VersionRow | null,
	maxCardNumber: number | null,
	sets: { member: readonly SpriteSetRow[]; card: readonly SpriteSetRow[] },
	tags: readonly string[]
): MemberAsRead {
	const profile = followedProfile(
		profileOf(version),
		version.follows,
		parent ? profileOf(parent) : null
	)
	const follows = parent
		? (version.follows as CharacterProfileField[])
		: ([] as CharacterProfileField[])
	const followed = new Set<string>(version.follows)
	const name = profile.name ?? ""
	const nickname = profile.nickname || null

	let timbre: CharacterTimbreInput | null = null
	let voiceFrom: "member" | "card" | null = null
	if (!followed.has("timbre")) {
		if (profile.timbre != null) {
			timbre = timbreOfExtensions({
				serenepub: { timbre: profile.timbre }
			})
			voiceFrom = "member"
		}
	} else {
		const fromCard = timbreOfExtensions({
			serenepub: { timbre: profile.timbre }
		})
		if (Object.keys(fromCard).length) {
			timbre = fromCard
			voiceFrom = "card"
		}
	}

	const memberSets = sortedSets(sets.member)
	const cardSets = parent ? sortedSets(sets.card) : []
	const spriteSets = memberSets.length ? memberSets : cardSets
	const legacy = legacyGreetingsOf(profile.greetings)

	return {
		castMemberId: member.id,
		lorebookId: member.lorebookId,
		castVersionId: version.id,
		cardVersion: parent
			? {
					id: parent.id,
					// A card version always has its number (the table's check).
					number: parent.number!,
					label: parent.label
				}
			: null,
		linkedCardId: member.characterId,
		activeCardId: parent?.cardId ?? null,
		cardless: parent == null,
		behindCard:
			parent != null &&
			parent.number != null &&
			maxCardNumber != null &&
			parent.number < maxCardNumber,
		follows,
		nodeState: version.nodeState ?? "active",
		nodeVisibility: version.nodeVisibility ?? "normal",
		name,
		nickname,
		shownName: resolveCharacterName({ name, nickname }, ""),
		aliases: profile.aliases,
		summary: profile.summary,
		description: profile.description,
		personality: profile.personality,
		scenario: profile.scenario,
		greetings: profile.greetings,
		firstMessage: legacy.firstMessage,
		alternateGreetings: legacy.alternateGreetings,
		exampleDialogues: profile.exampleDialogues,
		groupOnlyGreetings: legacy.groupOnlyGreetings,
		postHistoryInstructions: profile.postHistoryInstructions,
		creatorNotes: profile.creatorNotes,
		strokes: profile.strokes,
		likeness: profile.likeness,
		extensions: profile.extensions,
		followsCard: parent
			? RETOLD_FIELDS.filter((field) =>
					followed.has(PROFILE_FIELD_OF[field])
				)
			: [],
		faceMediaId: profile.faceMediaId,
		timbre,
		voiceFrom,
		spriteSets,
		spriteSetsFrom: memberSets.length
			? "member"
			: cardSets.length
				? "card"
				: null,
		spriteSet: profile.spriteSet,
		tags: parent ? [...tags] : []
	}
}

const MEMBER_COLUMNS = {
	id: schema.lorebookBindings.id,
	lorebookId: schema.lorebookBindings.lorebookId,
	characterId: schema.lorebookBindings.characterId
} as const

/** One member id is logged about once per process. */
const loggedNoVersion = new Set<number>()
const warnedOrphan = new Set<number>()

/** The reading to read at and the overlay chain: `opts.reading`, else the session's, else Main at its head. */
async function readingAndChainOf(
	db: Db,
	opts: MemberAsReadOptions
): Promise<{
	reading: MemberReading
	chain: number[]
	chainLines: Map<number, Line>
}> {
	const { MAIN_HEAD } = await import("$lib/server/state/entriesOnReading")
	const { sessionReadingOf, sessionCutsOf, overlayChainOf } = await import(
		"$lib/server/state/reading"
	)
	let reading: MemberReading | null = opts.reading ?? null
	if (!reading && opts.sessionId != null) {
		reading = await sessionReadingOf(db, opts.sessionId)
		if (!reading) {
			// No book to read (no own book either): Main at its head, with the session's own cuts.
			const sessionCuts = await sessionCutsOf(db, opts.sessionId)
			reading = sessionCuts.length
				? { ...MAIN_HEAD, line: { ...MAIN_LINE, sessionCuts } }
				: MAIN_HEAD
		}
	}
	reading ??= MAIN_HEAD
	const chain =
		opts.sessionId != null ? await overlayChainOf(db, opts.sessionId) : []
	const chainLines =
		opts.sessionId != null
			? await ancestorLinesOf(db, opts.sessionId, chain, reading)
			: new Map<number, Line>()
	return { reading, chain, chainLines }
}

/**
 * The line each ancestor's own book is read along (★s4-fold2-1): a branch's
 * ancestry entry may name the line the ancestor read its own notes on at the
 * fork (`lineId`). Keyed by that book's id, with the reading's session cuts on
 * it. An entry with no `lineId`, or one naming a deleted or foreign line, has
 * no key: that book reads at its main, as before.
 */
async function ancestorLinesOf(
	db: Db,
	sessionId: number,
	chain: readonly number[],
	reading: MemberReading
): Promise<Map<number, Line>> {
	const out = new Map<number, Line>()
	if (!chain.length) return out
	const { lineOfBook, BranchRefusal } = await import("$lib/server/state/reading")
	const [session] = await db
		.select({ branchAncestry: schema.sessions.branchAncestry })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const named = (session?.branchAncestry ?? []).filter(
		(a): a is typeof a & { lineId: number } => a.lineId != null
	)
	if (!named.length) return out
	const books = await db
		.select({ id: schema.lorebooks.id, sessionId: schema.lorebooks.sessionId })
		.from(schema.lorebooks)
		.where(
			inArray(
				schema.lorebooks.sessionId,
				named.map((a) => a.sessionId)
			)
		)
	for (const a of named) {
		const book = books.find(
			(b) => b.sessionId === a.sessionId && chain.includes(b.id)
		)
		if (!book || out.has(book.id)) continue
		try {
			const line = await lineOfBook(db, book.id, a.lineId)
			out.set(book.id, { ...line, sessionCuts: reading.line.sessionCuts })
		} catch (e) {
			if (!(e instanceof BranchRefusal)) throw e
		}
	}
	return out
}

type VersionInForce = { version: VersionRow; overlayDepth: number | null }

/** The pick on one reading: one query for the members' and their overlay rows, then `versionInForce` per member. */
async function pickVersions(
	db: Db,
	ids: readonly number[],
	reading: MemberReading,
	chain: readonly number[],
	chainLines: ReadonlyMap<number, Line>,
	appearance: number | null
): Promise<Map<number, VersionInForce>> {
	const cv = schema.characterVersions
	const lb = schema.lorebookBindings
	const line = reading.line
	const ownLineBookId = reading.onOwnBook && reading.lorebookId != null ? reading.lorebookId : null
	const dateCols = { year: cv.year, month: cv.month, day: cv.day }
	const onLine = onLineAtSql(cv.branchId, dateCols, line, reading.moment)
	const onBookMain = onLineAtSql(
		cv.branchId,
		dateCols,
		MAIN_LINE,
		reading.moment
	)
	// An ancestor's own book whose ancestry entry names its line at the fork
	// reads along that line, not at its main (★s4-fold2-1).
	const linedBooks = chain.filter((id) => chainLines.has(id))
	const mainBooks = linedBooks.length
		? chain.filter((id) => !chainLines.has(id))
		: chain
	const rows = await db
		.select({ version: cv, overlayOf: lb.overlayOf })
		.from(cv)
		.leftJoin(lb, eq(lb.id, cv.castMemberId))
		.where(
			and(
				// The asked members' rows, and — in the overlay chain's books —
				// the rows of the bindings that overlay them.
				chain.length
					? or(
							inArray(cv.castMemberId, [...ids]),
							and(
								inArray(lb.overlayOf, [...ids]),
								inArray(cv.lorebookId, [...chain])
							)
						)
					: inArray(cv.castMemberId, [...ids]),
				// A row in an own book of the chain reads at that book's main —
				// except the book the reading is of (the session's own notes,
				// read alone), which reads along the line; every other row
				// reads along the line.
				chain.length
					? or(
							ownLineBookId != null
								? and(eq(cv.lorebookId, ownLineBookId), onLine)
								: undefined,
							mainBooks.length
								? and(
										inArray(cv.lorebookId, [...mainBooks]),
										ownLineBookId != null ? ne(cv.lorebookId, ownLineBookId) : undefined,
										onBookMain
									)
								: undefined,
							...linedBooks.map((id) =>
								and(
									eq(cv.lorebookId, id),
									onLineAtSql(cv.branchId, dateCols, chainLines.get(id)!, reading.moment)
								)
							),
							and(notInArray(cv.lorebookId, [...chain]), onLine)
						)
					: onLine,
				sessionCutSql(cv, line)
			)
		)
		.orderBy(asc(cv.id))
	const asked = new Set(ids)
	const byMember = new Map<
		number,
		(VersionRow & { overlayDepth: number | null })[]
	>()
	for (const { version, overlayOf } of rows) {
		const owner = asked.has(version.castMemberId!)
			? version.castMemberId!
			: overlayOf
		if (owner == null) continue
		const depth = chain.indexOf(version.lorebookId ?? -1)
		const list = byMember.get(owner) ?? []
		list.push({ ...version, overlayDepth: depth >= 0 ? depth : null })
		byMember.set(owner, list)
	}
	const out = new Map<number, VersionInForce>()
	const pick = (rows: (VersionRow & { overlayDepth: number | null })[]) =>
		versionInForce(rows, line, reading.moment, appearance)
	for (const [memberId, candidates] of byMember) {
		let picked = null as (VersionRow & { overlayDepth: number | null }) | null
		if (ownLineBookId == null && !linedBooks.length) picked = pick(candidates)
		else {
			// The notes the reading is of, and each ancestor's own book read along
			// its named line, read along a line: `versionInForce` must not read
			// them on main as an overlay row. Each is picked alone, then the group
			// winners are combined: the later date wins, and on a date tie the
			// nearer holder (the reading's own notes beat the rest, as the nearest
			// holder does).
			const alone = (bookId: number, line: Line) => {
				const held = candidates.filter((c) => c.lorebookId === bookId)
				const won = versionInForce(
					held.map((c) => ({ ...c, overlayDepth: null })),
					line,
					reading.moment,
					appearance
				)
				return won
					? { ...won, overlayDepth: held[0]?.overlayDepth ?? null }
					: null
			}
			const groups: { won: (VersionRow & { overlayDepth: number | null }) | null; near: number }[] = []
			if (ownLineBookId != null) groups.push({ won: alone(ownLineBookId, line), near: -1 })
			for (const id of linedBooks)
				groups.push({ won: alone(id, chainLines.get(id)!), near: chain.indexOf(id) })
			const apart = new Set<number | null>([ownLineBookId, ...linedBooks])
			const rest = pick(candidates.filter((c) => !apart.has(c.lorebookId)))
			groups.push({ won: rest, near: rest?.overlayDepth ?? Infinity })
			const dateOf = (v: VersionRow) =>
				v.year == null ? null : { year: v.year, month: v.month ?? null, day: v.day ?? null }
			let best: (typeof groups)[number] | null = null
			for (const g of groups) {
				if (!g.won) continue
				if (!best?.won) {
					best = g
					continue
				}
				const a = dateOf(g.won)
				const b = dateOf(best.won)
				const byDate = a == null ? (b == null ? 0 : -1) : b == null ? 1 : compareDates(a, b)
				if (byDate > 0 || (byDate === 0 && g.near < best.near)) best = g
			}
			picked = best?.won ?? null
		}
		if (!picked) continue
		const { overlayDepth, ...version } = picked
		out.set(memberId, { version, overlayDepth })
	}
	return out
}

/**
 * 🚧 The character version in force for each asked cast member on one
 * reading — exactly the pick `membersAsRead` reads from (the session writer
 * calls it to find the row it copies). The reading is `opts.reading`, else the
 * session's (carrying its session cuts), else Main at its head; the overlay
 * chain is the session's own book and its ancestors' (`overlayChainOf`).
 * `overlayDepth` is the holder's place in that chain, null for the attached
 * book. A member with no candidate is absent.
 */
export async function castVersionsInForce(
	db: Db,
	memberIds: readonly number[],
	opts: MemberAsReadOptions = {}
): Promise<Map<number, { version: VersionRow; overlayDepth: number | null }>> {
	const ids = [...new Set(memberIds)]
	if (!ids.length) return new Map()
	const { reading, chain, chainLines } = await readingAndChainOf(db, opts)
	return pickVersions(db, ids, reading, chain, chainLines, opts.appearance ?? null)
}

/**
 * 🚧 Cast members as one reading has them (plan §32 §6): each from the one
 * character version in force, its followed fields from the exact parent card
 * version. The reading is `opts.reading`, else the session's
 * (`opts.sessionId`), else Main at its head. One round of queries, not one per
 * member. An unknown id is absent from the map; no ids reads nothing.
 *
 * A member with no version that reads on this reading is a logged error
 * (once per member id) and is absent from the map, as an unknown id is.
 */
export async function membersAsRead(
	db: Db,
	memberIds: readonly number[],
	opts: MemberAsReadOptions = {}
): Promise<Map<number, MemberAsRead>> {
	const ids = [...new Set(memberIds)]
	if (!ids.length) return new Map()
	const rows = await db
		.select(MEMBER_COLUMNS)
		.from(schema.lorebookBindings)
		.where(inArray(schema.lorebookBindings.id, ids))
		.orderBy(asc(schema.lorebookBindings.id))
	if (!rows.length) return new Map()

	const { reading, chain, chainLines } = await readingAndChainOf(db, opts)
	const picks = await pickVersions(
		db,
		rows.map((r) => r.id),
		reading,
		chain,
		chainLines,
		opts.appearance ?? null
	)

	// A member with no version that reads here is absent and logged. A lifted
	// member's undated base on main always reads, so this is an error.
	const missing = rows.filter((r) => !picks.has(r.id))
	if (missing.length) {
		const hasVersions = new Set<number>()
		for (const r of await db
			.selectDistinct({ id: schema.characterVersions.castMemberId })
			.from(schema.characterVersions)
			.where(
				inArray(
					schema.characterVersions.castMemberId,
					missing.map((r) => r.id)
				)
			))
			if (r.id != null) hasVersions.add(r.id)
		for (const row of missing) {
			if (loggedNoVersion.has(row.id)) continue
			loggedNoVersion.add(row.id)
			console.error(
				hasVersions.has(row.id)
					? `[cast] cast member ${row.id} has character versions, but none reads on this reading; it is left out`
					: `[cast] cast member ${row.id} has no character version at all; it is left out`
			)
		}
	}

	// The parent card versions of the versions in force, with each card's
	// highest version number.
	const parents = new Map<
		number,
		{ row: VersionRow; latest: number | null }
	>()
	const parentIds = [
		...new Set(
			[...picks.values()]
				.map((p) => p.version.parentVersionId)
				.filter((id): id is number => id != null)
		)
	]
	if (parentIds.length) {
		const cv = schema.characterVersions
		const latest = alias(schema.characterVersions, "card_latest")
		for (const r of await db
			.select({ parent: cv, latest: max(latest.number) })
			.from(cv)
			.leftJoin(latest, eq(latest.cardId, cv.cardId))
			.where(inArray(cv.id, parentIds))
			.groupBy(cv.id))
			parents.set(r.parent.id, { row: r.parent, latest: r.latest })
	}

	const cardIds = [
		...new Set(
			[...parents.values()]
				.map((p) => p.row.cardId)
				.filter((id): id is number => id != null)
		)
	]
	const tagsOf = new Map<number, string[]>()
	if (cardIds.length) {
		const tagRows = await db
			.select({
				characterId: schema.characterTags.characterId,
				name: schema.tags.name
			})
			.from(schema.characterTags)
			.innerJoin(
				schema.tags,
				eq(schema.tags.id, schema.characterTags.tagId)
			)
			.where(inArray(schema.characterTags.characterId, cardIds))
			.orderBy(asc(schema.tags.name), asc(schema.tags.id))
		for (const t of tagRows) {
			const list = tagsOf.get(t.characterId) ?? []
			list.push(t.name)
			tagsOf.set(t.characterId, list)
		}
	}

	const memberSets = new Map<number, SpriteSetRow[]>()
	const cardSets = new Map<number, SpriteSetRow[]>()
	const s = schema.spriteSets
	const memberIdsRead = rows.map((r) => r.id)
	const setRows = await db
		.select({
			id: s.id,
			characterId: s.characterId,
			castMemberId: s.castMemberId,
			name: s.name,
			isDefault: s.isDefault,
			position: s.position
		})
		.from(s)
		.where(
			cardIds.length
				? or(
						inArray(s.castMemberId, memberIdsRead),
						inArray(s.characterId, cardIds)
					)
				: inArray(s.castMemberId, memberIdsRead)
		)
		.orderBy(asc(s.position), asc(s.id))
	for (const r of setRows) {
		const [map, key] =
			r.castMemberId != null
				? [memberSets, r.castMemberId]
				: [cardSets, r.characterId]
		if (key == null) continue
		const list = map.get(key) ?? []
		list.push(r)
		map.set(key, list)
	}

	const out = new Map<number, MemberAsRead>()
	for (const row of rows) {
		const pick = picks.get(row.id)
		if (!pick) continue
		const parent = pick.version.parentVersionId
			? (parents.get(pick.version.parentVersionId) ?? null)
			: null
		if (
			!parent &&
			pick.version.follows.length &&
			!warnedOrphan.has(pick.version.id)
		) {
			warnedOrphan.add(pick.version.id)
			console.warn(
				`[cast] character version ${pick.version.id} follows its card but the card version is gone; those fields read empty`
			)
		}
		const cardId = parent?.row.cardId ?? null
		out.set(
			row.id,
			layerVersionAsRead(
				row,
				pick.version,
				parent?.row ?? null,
				parent?.latest ?? null,
				{
					member: memberSets.get(row.id) ?? [],
					card: cardId != null ? (cardSets.get(cardId) ?? []) : []
				},
				cardId != null ? (tagsOf.get(cardId) ?? []) : []
			)
		)
	}
	return out
}

/** 🚧 One cast member as read, or null when there is no such member. */
export async function memberAsRead(
	db: Db,
	memberId: number,
	opts: MemberAsReadOptions = {}
): Promise<MemberAsRead | null> {
	return (await membersAsRead(db, [memberId], opts)).get(memberId) ?? null
}
