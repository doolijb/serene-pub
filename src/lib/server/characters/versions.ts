/**
 * 🚧 The **character versions** module: the one writer of `character_versions`
 * (plan §32 §8, §33). A card version is an authored release of a card; a cast
 * version is a cast member's profile at a point, naming in `follows` the
 * fields it reads from its parent card version. Nothing else inserts into or
 * updates the table (P2: two writers of one thing is a bug).
 *
 * ⚠ THIS MODULE MUST STAY A LEAF. It must not statically import
 * `$lib/server/db`, nor any module that does. `characterBindingSync.ts`
 * imports it, and that module is imported by `db/defaults.ts`, whose sync()
 * runs at module scope of `db/index.ts` — a static import of the db here would
 * make `db/index.ts` depend on a module that depends on it, through its own
 * boot path. Its imports are `drizzle-orm`, `$lib/server/db/schema`,
 * `$lib/server/db/rawRows`, `$lib/server/lorebooks/retold` (itself a leaf: it
 * imports the schema and `$lib/shared/*` only) and `$lib/shared/*`.
 *
 * ⚠ Every function takes its handle first (`tx: Db`) and never opens a
 * transaction: the caller owns it, and inside `db.transaction(async (tx) => …)`
 * only `tx` may be used.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { NodeState, NodeVisibility } from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { splitExampleDialogues } from "$lib/server/lorebooks/retold"
import {
	CHARACTER_PROFILE_FIELDS,
	creatorNotesOf,
	emptyCharacterProfile,
	followedProfile,
	isCharacterProfileField,
	mergeGreetings,
	nextVersionLabel,
	profileOf,
	type CharacterCreatorNotes,
	type CharacterGreeting,
	type CharacterProfileField,
	type CharacterProfileV1
} from "$lib/shared/characters/profile"
import {
	likenessOfExtensions,
	type CharacterLikenessInput
} from "$lib/shared/characters/likeness"
import { timbreOfExtensions } from "$lib/shared/characters/timbre"
import {
	MAIN_LINE,
	rowPassesSessionCut,
	rowReadsOnLine,
	versionInForce
} from "$lib/shared/lorebooks/lineReading"
import { ownNameValue } from "$lib/shared/lorebooks/memberIdentity"
import { compareDates, type StoryDate } from "$lib/shared/lorebooks/storyDate"
import type { LiftNoteV1 } from "./versionsLift"

type VersionRow = typeof schema.characterVersions.$inferSelect
type CardRow = typeof schema.characters.$inferSelect
type MemberRow = typeof schema.lorebookBindings.$inferSelect

/** The card columns a card version's profile is made from. */
type CardColumns = Pick<
	CardRow,
	| "name"
	| "nickname"
	| "aliases"
	| "summary"
	| "description"
	| "personality"
	| "scenario"
	| "firstMessage"
	| "alternateGreetings"
	| "groupOnlyGreetings"
	| "exampleDialogues"
	| "postHistoryInstructions"
	| "creatorNotes"
	| "creatorNotesMultilingual"
	| "strokes"
	| "avatarMediaId"
	| "extensions"
>

/** The member columns a cast version's own values are made from. */
type MemberColumns = Pick<
	MemberRow,
	| "name"
	| "aliases"
	| "summary"
	| "description"
	| "personality"
	| "scenario"
	| "firstMessage"
	| "alternateGreetings"
	| "exampleDialogues"
	| "faceMediaId"
	| "retold"
	| "ownName"
	| "ownNickname"
	| "timbre"
	| "spriteSet"
> & {
	/** The member's own greetings marked for group sessions only (a version holds them; the row has no column). */
	groupOnlyGreetings?: readonly string[] | null
	/** The member's own post-history instructions (a version holds them; the row has no column). */
	postHistoryInstructions?: string | null
	/** The member's own creator notes (a version holds them; the row has no column). */
	creatorNotes?: CharacterCreatorNotes | null
	/** The member's own likeness (a version holds it; the row has no column). */
	likeness?: CharacterLikenessInput | null
}

type NewVersion = Omit<
	typeof schema.characterVersions.$inferInsert,
	"id" | "writeOrder"
> & { writeOrder?: number }

// ── Pure conversions ──────────────────────────────────────────────────────

/**
 * A card's character profile, from a `characters` row: the opener, alternates
 * and group-only greetings merged into one list, the creator notes and their
 * translations into one field, and `serenepub.likeness` / `serenepub.timbre`
 * lifted out of `extensions` into their own fields. Never mutates the card.
 */
export function cardProfileOf(card: CardColumns): CharacterProfileV1 {
	const likeness = likenessOfExtensions(card.extensions)
	const timbre = timbreOfExtensions(card.extensions)

	const extensions: Record<string, unknown> = { ...(card.extensions ?? {}) }
	const serenepub = extensions.serenepub
	if (
		serenepub &&
		typeof serenepub === "object" &&
		!Array.isArray(serenepub)
	) {
		const {
			likeness: _l,
			timbre: _t,
			...rest
		} = serenepub as Record<string, unknown>
		if (Object.keys(rest).length) extensions.serenepub = rest
		else delete extensions.serenepub
	}

	return {
		name: card.name,
		nickname: card.nickname ?? null,
		aliases: Array.isArray(card.aliases) ? [...card.aliases] : [],
		summary: card.summary ?? null,
		description: card.description,
		personality: card.personality ?? null,
		scenario: card.scenario ?? null,
		greetings: mergeGreetings(
			card.firstMessage,
			card.alternateGreetings,
			card.groupOnlyGreetings
		),
		exampleDialogues: Array.isArray(card.exampleDialogues)
			? card.exampleDialogues.filter((d) => typeof d === "string")
			: [],
		postHistoryInstructions: card.postHistoryInstructions ?? null,
		creatorNotes: creatorNotesOf(
			card.creatorNotes,
			card.creatorNotesMultilingual
		),
		strokes: Array.isArray(card.strokes) ? [...card.strokes] : [],
		faceMediaId: card.avatarMediaId ?? null,
		likeness: Object.keys(likeness).length ? likeness : null,
		timbre: Object.keys(timbre).length ? timbre : null,
		spriteSet: null,
		extensions
	}
}

/**
 * A cast member's own values and `follows`, from its binding row and its
 * parent card version's profile (`card`; null = card-less). It reproduces
 * today's read (`layerMemberAsRead`) field for field:
 *
 * - **Card-less**: every field is own; `follows` is empty.
 * - **Carded**: the member's aliases, summary and sprite set are always its
 *   own; the name and nickname are own when the book gives one (an own empty
 *   nickname is own, meaning "no nickname here" — the `memberNames` rule); a
 *   retold field is own, every other follows; the face is own while retold
 *   and set; the timbre is own when the member has one. Post-history
 *   instructions, creator notes and likeness are own when retold (a row with
 *   none of those keys and no such flags follows them, as before); strokes
 *   and extensions always follow.
 * - **Greetings** follow when neither the opener nor the alternates are
 *   retold, and are the member's own list when both are, plus its own
 *   group-only greetings (`groupOnlyGreetings`, as the card-less member's
 *   are); the card's group-only greetings are dropped once either is
 *   retold. With **exactly one** retold (`mixedGreetings: true`), the
 *   member gets its own full list: the retold half from the member and the
 *   other half from the card's solo greetings, none group-only (owner,
 *   2026-11-05: "the member gets its own full list (its retold opener + the
 *   card's current others)"); that branch is the upgrade lift and ignores
 *   `groupOnlyGreetings`.
 *
 * Fields that follow hold the empty value in `own`: the reader ignores them.
 *
 * This is the one conversion the base insert (`insertCastMember`), the boot
 * lift and its verify step share.
 */
export function memberProfileOf(
	member: MemberColumns,
	card: CharacterProfileV1 | null
): {
	own: CharacterProfileV1
	follows: CharacterProfileField[]
	mixedGreetings: boolean
} {
	const own = emptyCharacterProfile()
	const follows: CharacterProfileField[] = []
	const retold = member.retold ?? {}
	const ownText = (field: "description" | "personality" | "scenario") =>
		card == null || retold[field] === true
	const memberAlternates = Array.isArray(member.alternateGreetings)
		? member.alternateGreetings
		: []

	own.aliases = Array.isArray(member.aliases) ? [...member.aliases] : []
	own.summary = member.summary ?? null
	own.spriteSet = member.spriteSet ?? null

	// The name and nickname: the `memberNames` rule, one field at a time.
	const ownName = ownNameValue(member.ownName) || null
	const ownNickname = ownNameValue(member.ownNickname)
	if (card == null || ownName != null) own.name = ownName ?? member.name
	else follows.push("name")
	if (card == null || ownNickname != null) own.nickname = ownNickname || null
	else follows.push("nickname")

	for (const field of ["description", "personality", "scenario"] as const) {
		if (ownText(field)) own[field] = member[field] ?? (card ? "" : null)
		else follows.push(field)
	}

	if (card == null || retold.exampleDialogues === true)
		own.exampleDialogues = splitExampleDialogues(member.exampleDialogues)
	else follows.push("exampleDialogues")

	let mixedGreetings = false
	const openerRetold = retold.firstMessage === true
	const alternatesRetold = retold.alternateGreetings === true
	if (card == null) {
		own.greetings = mergeGreetings(
			member.firstMessage,
			memberAlternates,
			member.groupOnlyGreetings
		)
	} else if (openerRetold && alternatesRetold) {
		own.greetings = mergeGreetings(
			member.firstMessage ?? "",
			memberAlternates,
			member.groupOnlyGreetings
		)
	} else if (openerRetold || alternatesRetold) {
		mixedGreetings = true
		const solo = card.greetings
			.filter((g: CharacterGreeting) => !g.groupOnly)
			.map((g) => g.text)
		own.greetings = openerRetold
			? mergeGreetings(member.firstMessage ?? "", solo.slice(1), [])
			: mergeGreetings(solo[0] ?? "", memberAlternates, [])
	} else {
		follows.push("greetings")
	}

	if (card == null) own.faceMediaId = member.faceMediaId ?? null
	else if (retold.face === true && typeof member.faceMediaId === "number")
		own.faceMediaId = member.faceMediaId
	else follows.push("faceMediaId")

	if (member.timbre != null)
		own.timbre = timbreOfExtensions({
			serenepub: { timbre: member.timbre }
		})
	else if (card != null) follows.push("timbre")

	if (card == null || retold.postHistoryInstructions === true)
		own.postHistoryInstructions = member.postHistoryInstructions ?? null
	else follows.push("postHistoryInstructions")
	if (card == null || retold.creatorNotes === true)
		own.creatorNotes = member.creatorNotes ?? null
	else follows.push("creatorNotes")
	if (card != null) follows.push("strokes")
	if (card == null || retold.likeness === true)
		own.likeness = member.likeness ?? null
	else follows.push("likeness")
	if (card != null) follows.push("extensions")

	return { own, follows, mixedGreetings }
}

// ── The one INSERT, and the sequence ──────────────────────────────────────

/** `count` ids from the table's own sequence, ascending. */
async function drawIds(tx: Db, count: number): Promise<number[]> {
	const res = await tx.execute(
		sql`select nextval(pg_get_serial_sequence('character_versions', 'id')) as id from generate_series(1, ${sql.raw(String(Math.trunc(count)))})`
	)
	return rawRows<{ id: unknown }>(res)
		.map((r) => Number(r.id))
		.sort((a, b) => a - b)
}

/** The rule "a version with `follows` has a parent", and "`follows` holds profile fields only". */
function checkFollows(row: NewVersion): void {
	const follows = row.follows ?? []
	for (const field of follows) {
		if (!isCharacterProfileField(field))
			throw new Error(
				`"${field}" is not a character profile field, so a version cannot follow it. The fields are ${CHARACTER_PROFILE_FIELDS.join(", ")}.`
			)
	}
	if (follows.length && row.parentVersionId == null)
		throw new Error(
			`A version that follows ${follows.join(", ")} needs a parent card version to read them from, and this one has none.`
		)
}

/** A profile value with U+0000 removed from every string in it (PG refuses `\u0000` in jsonb and text). */
function stripNul<T>(value: T): T {
	if (typeof value === "string")
		return value.replaceAll("\u0000", "") as unknown as T
	if (Array.isArray(value)) return value.map(stripNul) as unknown as T
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, stripNul(v)])
		) as T
	return value
}

/** `row` with U+0000 stripped from its profile fields. */
function withoutNul<T extends object>(row: T): T {
	const out = { ...row } as Record<string, unknown>
	for (const field of CHARACTER_PROFILE_FIELDS)
		if (out[field] !== undefined) out[field] = stripNul(out[field])
	return out as T
}

/** The table's only INSERT; `skipExisting` skips a card version number already taken. */
async function insertRows(
	tx: Db,
	rows: readonly NewVersion[],
	skipExisting: boolean
): Promise<VersionRow[]> {
	if (!rows.length) return []
	for (const row of rows) checkFollows(row)
	const ids = await drawIds(tx, rows.length)
	const insert = tx.insert(schema.characterVersions).values(
		rows.map((row, i) => ({
			...withoutNul(row),
			id: ids[i],
			writeOrder: row.writeOrder ?? ids[i]
		}))
	)
	const inserted = await (skipExisting
		? insert
				.onConflictDoNothing({
					target: [
						schema.characterVersions.cardId,
						schema.characterVersions.number
					]
				})
				.returning()
		: insert.returning())
	const byId = new Map(inserted.map((v) => [v.id, v]))
	return ids.flatMap((id) => {
		const row = byId.get(id)
		return row ? [row] : []
	})
}

/**
 * The one INSERT of `character_versions`; the boot lift calls it too. It
 * refuses a `follows` that is not empty on a version with no parent, and a
 * `follows` entry that is not a profile field; draws each id from the table's
 * sequence and sets `write_order` from it, unless the caller gives the write
 * order of the row it copies. Answers the inserted rows in input order.
 * Every other function here inserts through it.
 */
export async function insertCharacterVersions(
	tx: Db,
	rows: readonly NewVersion[]
): Promise<VersionRow[]> {
	return insertRows(tx, rows, false)
}

/** The next write order: what a **retire mark** takes (§33.2: `retired_order` = the next write order). */
export async function nextWriteOrder(tx: Db): Promise<number> {
	return (await drawIds(tx, 1))[0]
}

// ── Card versions ─────────────────────────────────────────────────────────

async function currentCardVersion(
	tx: Db,
	cardId: number
): Promise<VersionRow | null> {
	const [row] = await tx
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.cardId, cardId))
		.orderBy(desc(schema.characterVersions.number))
		.limit(1)
	return row ?? null
}

/** A card's first version, made from its `characters` row. */
function firstVersionOf(card: CardRow, writtenBy: string | null): NewVersion {
	return {
		cardId: card.id,
		number: 1,
		label: card.characterVersion || "1.0",
		writtenBy,
		...cardProfileOf(card)
	}
}

/**
 * The card's **current** card version (the highest `number`). A card with no
 * version gets **v1** from its `characters` row, labelled with
 * `characters.characterVersion` (else "1.0"), written by `lift`: a card that
 * was inserted raw, or that predates versions, is lifted the first time
 * anything asks. A soft-deleted card still gets one. A card id with no row
 * answers null. Race-safe: the insert skips a v1 someone else just wrote, and
 * the row is read again.
 */
export async function ensureCardVersion(
	tx: Db,
	cardId: number
): Promise<VersionRow | null> {
	const current = await currentCardVersion(tx, cardId)
	if (current) return current
	const [card] = await tx
		.select()
		.from(schema.characters)
		.where(eq(schema.characters.id, cardId))
	if (!card) return null
	await insertRows(tx, [firstVersionOf(card, "lift")], true)
	return currentCardVersion(tx, cardId)
}

/**
 * Inserts a card and its **v1**, as `ensureCardVersion` would make it: the
 * label is `values.characterVersion`, else "1.0"; `writtenBy` is
 * `opts.writtenBy`, default null.
 */
export async function insertCard(
	tx: Db,
	values: typeof schema.characters.$inferInsert,
	opts?: { writtenBy?: string | null }
): Promise<{ card: CardRow; version: VersionRow }> {
	// A NUL in a card's own text or json must not fail the insert.
	const clean = Object.fromEntries(
		Object.entries(values).map(([key, value]) => [
			key,
			typeof value === "string" ||
			Array.isArray(value) ||
			(value != null && Object.getPrototypeOf(value) === Object.prototype)
				? stripNul(value)
				: value
		])
	) as typeof values
	const [card] = await tx.insert(schema.characters).values(clean).returning()
	const [version] = await insertRows(
		tx,
		[firstVersionOf(card, opts?.writtenBy ?? null)],
		false
	)
	return { card, version }
}

/**
 * ⏳ The four card copies (plan §31 §8): `characters.name`, `nickname` and
 * `avatar_media_id` (for library screens), and `description` (which
 * `embed_text_hash` is generated from) are kept as copies of the **current**
 * card version, written only here.
 */
async function writeCardCopies(
	tx: Db,
	cardId: number,
	profile: CharacterProfileV1
): Promise<void> {
	await tx
		.update(schema.characters)
		.set({
			name: profile.name ?? "",
			nickname: profile.nickname,
			avatarMediaId: profile.faceMediaId,
			description: profile.description ?? ""
		})
		.where(eq(schema.characters.id, cardId))
}

/**
 * Writes a new card version of `cardId` from `profile`: its `number` is the
 * current one plus one, its label `opts.label` when given (even ""), else the
 * suggested next label (`nextVersionLabel`). It becomes the current version,
 * so the ⏳ card copies are written. Throws when the card does not exist.
 */
export async function newCardVersion(
	tx: Db,
	cardId: number,
	profile: CharacterProfileV1,
	opts?: { label?: string | null; writtenBy?: string | null }
): Promise<VersionRow> {
	const current = await ensureCardVersion(tx, cardId)
	if (!current || current.number == null)
		throw new Error(`Card ${cardId} does not exist, so it has no versions.`)
	const [version] = await insertRows(
		tx,
		[
			{
				cardId,
				number: current.number + 1,
				label:
					opts?.label !== undefined
						? opts.label
						: nextVersionLabel(current.label),
				writtenBy: opts?.writtenBy ?? null,
				...profile
			}
		],
		false
	)
	await writeCardCopies(tx, cardId, profileOf(version))
	return version
}

/**
 * Writes `changes` in place on a **card** version — any version of a card, not
 * only the current one (owner: "Card editing → any version, with a picker
 * (Save writes the chosen version; it reaches that version's followers)").
 * Followers read it by `follows`, so nothing else is written, except the ⏳
 * card copies when this is the card's current version. Refuses a cast version
 * and an unknown id. `opts.label`, when given, renames the version too (an
 * in-place save can rename it; a label alone is a save); only the label is
 * written, never `characters.character_version`.
 */
export async function updateCardVersion(
	tx: Db,
	versionId: number,
	changes: Partial<CharacterProfileV1>,
	opts?: { label?: string | null }
): Promise<VersionRow> {
	const [row] = await tx
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.id, versionId))
	if (!row) throw new Error(`Character version ${versionId} does not exist.`)
	if (row.cardId == null)
		throw new Error(
			`Character version ${versionId} is a cast member's version, not a card version, and is written only by the session writer.`
		)

	const merged = profileOf({ ...profileOf(row), ...changes })
	const set: Record<string, unknown> = {}
	for (const field of CHARACTER_PROFILE_FIELDS)
		if (changes[field] !== undefined) set[field] = stripNul(merged[field])
	if (opts?.label !== undefined) set.label = opts.label
	if (!Object.keys(set).length) return row

	const [updated] = await tx
		.update(schema.characterVersions)
		.set(set)
		.where(eq(schema.characterVersions.id, versionId))
		.returning()
	const current = await currentCardVersion(tx, row.cardId)
	if (current?.id === versionId)
		await writeCardCopies(tx, row.cardId, profileOf(updated))
	return updated
}

/**
 * 🚧 The cast-version columns a **cast tag** (`{{char:N}}`) can sit in: every
 * text-bearing profile column. The tag site `castVersion` in
 * `utils/castTags.ts` reads this list.
 */
export const CAST_VERSION_TAG_COLUMNS = [
	"name",
	"nickname",
	"aliases",
	"summary",
	"description",
	"personality",
	"scenario",
	"greetings",
	"exampleDialogues",
	"postHistoryInstructions",
	"creatorNotes"
] as const

/**
 * 🚧 Writes rewritten cast-tag text onto ONE **cast** version, **in place**,
 * retired rows included, with no retire step. Refuses a key outside
 * `CAST_VERSION_TAG_COLUMNS`, a card version and an unknown id. Touches nothing
 * else (no `write_order`, `retired_order`, `follows`, parent).
 *
 * Why in place and no retire: the retire mark (§33.2: "an in-place change of a
 * row some descendant reads … marks the row retired … then inserts the new
 * row") is for a change of *what a reading says*. A tag rewrite is the book
 * renaming a member everywhere at once: the absorbed or deleted member is gone
 * for every line, so a branch reading an old row must see the new tag too;
 * retiring would leave the branch reading a tag that names nobody. Same as
 * every other tag site (entries are rewritten in place whatever line reads
 * them).
 */
export async function writeCastVersionTagText(
	tx: Db,
	versionId: number,
	set: Record<string, unknown>
): Promise<void> {
	const allowed = CAST_VERSION_TAG_COLUMNS as readonly string[]
	for (const key of Object.keys(set))
		if (!allowed.includes(key))
			throw new Error(
				`"${key}" is not a cast version column a cast tag can sit in.`
			)
	const [row] = await tx
		.select({
			id: schema.characterVersions.id,
			cardId: schema.characterVersions.cardId
		})
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.id, versionId))
	if (!row) throw new Error(`Character version ${versionId} does not exist.`)
	if (row.cardId != null)
		throw new Error(
			`Character version ${versionId} is a card version; cast tags are rewritten only on a cast member's versions.`
		)
	const clean: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(set)) clean[k] = stripNul(v)
	if (!Object.keys(clean).length) return
	await tx
		.update(schema.characterVersions)
		.set(clean)
		.where(eq(schema.characterVersions.id, versionId))
}

// ── Cast members ──────────────────────────────────────────────────────────

/**
 * Inserts a cast member (a `lorebook_bindings` row) and its **base** version:
 * the member's book, main, undated, no source, no life point; the parent is
 * the card's current card version (`ensureCardVersion`) when the member has a
 * card, null when it is card-less or the card is gone; the own values and
 * `follows` come from `memberProfileOf`; the node state and visibility are the
 * member's.
 *
 * An **overlay row** (`values.overlayOf` set) gets no base (`base: null`): it
 * holds only a session's writes, written later by the session writer.
 */
export async function insertCastMember(
	tx: Db,
	values: typeof schema.lorebookBindings.$inferInsert,
	opts?: { writtenBy?: string | null }
): Promise<{ member: MemberRow; base: VersionRow | null }> {
	const [member] = await tx
		.insert(schema.lorebookBindings)
		.values(values)
		.returning()
	if (member.overlayOf != null) return { member, base: null }
	const base = await insertMemberBase(tx, member, opts?.writtenBy ?? null)
	return { member, base }
}

/**
 * 🚧 Inserts one cast member **without** a base: the book copy only. Its
 * versions are copied right after by the `character_versions` spec of the
 * table registry, so `insertCastMember` would add a second base beside them.
 */
export async function insertCastMemberCopy(
	tx: Db,
	values: typeof schema.lorebookBindings.$inferInsert
): Promise<MemberRow> {
	const [member] = await tx
		.insert(schema.lorebookBindings)
		.values(values)
		.returning()
	return member
}

/** A member's **base** version (see `insertCastMember`); the one place it is made. */
async function insertMemberBase(
	tx: Db,
	member: MemberRow,
	writtenBy: string | null
): Promise<VersionRow> {
	const parent =
		member.characterId != null
			? await ensureCardVersion(tx, member.characterId)
			: null
	const { own, follows } = memberProfileOf(
		member,
		parent ? profileOf(parent) : null
	)
	const [base] = await insertRows(
		tx,
		[
			{
				castMemberId: member.id,
				lorebookId: member.lorebookId,
				parentVersionId: parent?.id ?? null,
				personalPosition: null,
				nodeState: member.nodeState,
				nodeVisibility: member.nodeVisibility,
				writtenBy,
				...own,
				follows
			}
		],
		false
	)
	return base
}

/**
 * Re-parents the member's cast versions whose parent is an **older** version
 * of the same card as `cardVersionId` onto it; answers how many, both kinds
 * below (plan §32 §9: "Update is authoring. It re-parents only that member's
 * versions whose parent is an older version of the same card"). Retired rows
 * are never touched. The retire step (§33.2): a row a session forked from
 * still reads (`descendantReads`) is **retired** and a copy with the new
 * parent is inserted with the same provenance; every other row is updated in
 * place. Refuses a cast version, and an unknown id, as the target.
 */
export async function updateMemberToCardVersion(
	tx: Db,
	castMemberId: number,
	cardVersionId: number
): Promise<number> {
	const V = schema.characterVersions
	const [target] = await tx.select().from(V).where(eq(V.id, cardVersionId))
	if (!target)
		throw new Error(`Character version ${cardVersionId} does not exist.`)
	if (target.cardId == null || target.number == null)
		throw new Error(
			`Character version ${cardVersionId} is a cast member's version; a member can only be updated to a card version.`
		)
	const rows = await tx
		.select()
		.from(V)
		.where(
			and(
				eq(V.castMemberId, castMemberId),
				isNull(V.retiredOrder),
				sql`${V.parentVersionId} in (select "id" from "character_versions" where "card_id" = ${target.cardId} and "number" < ${target.number})`
			)
		)
		.orderBy(V.id)
	let member: MemberRow | null = null
	for (const row of rows) {
		if (
			row.sourceSessionId != null &&
			(await descendantReads(tx, row.sourceSessionId, row))
		) {
			member ??= await memberOf(tx, castMemberId)
			await retireAndCopyCastVersion(
				tx,
				row,
				member,
				profileOf(row),
				row.follows as CharacterProfileField[],
				cardVersionId
			)
		} else {
			await tx
				.update(V)
				.set({ parentVersionId: cardVersionId })
				.where(eq(V.id, row.id))
		}
	}
	return rows.length
}

/**
 * Makes followers independent: for every cast version with a non-empty
 * `follows` whose parent is a version of `scope.cardId` (when given) and/or
 * which belongs to `scope.castMemberId` (when given; at least one is
 * required), copies each followed field's value from the parent card version
 * into the version's own column and clears `follows`. A version whose parent
 * is gone gets the empty values. `detach: true` — the member is now card-less
 * — also clears `parent_version_id`, on every version in scope that has one,
 * even one that follows nothing. Answers how many versions changed.
 *
 * Runs first on every delete path the app owns: card unlink (`detach`), card
 * delete, Copy-from, starters (lead decision, cv-schema scope review) — so a
 * follower never reads empty fields because its parent went away.
 */
export async function resolveFollows(
	tx: Db,
	scope: { cardId?: number; castMemberId?: number },
	opts?: { detach?: boolean }
): Promise<number> {
	if (scope.cardId == null && scope.castMemberId == null)
		throw new Error(
			"resolveFollows needs a card or a cast member to resolve for."
		)
	const detach = opts?.detach === true
	const V = schema.characterVersions
	const conditions = [
		sql`${V.castMemberId} IS NOT NULL`,
		detach
			? sql`(cardinality(${V.follows}) > 0 OR ${V.parentVersionId} IS NOT NULL)`
			: sql`cardinality(${V.follows}) > 0`
	]
	if (scope.cardId != null)
		conditions.push(
			sql`${V.parentVersionId} in (select "id" from "character_versions" where "card_id" = ${scope.cardId})`
		)
	if (scope.castMemberId != null)
		conditions.push(eq(V.castMemberId, scope.castMemberId))

	const versions = await tx
		.select()
		.from(V)
		.where(and(...conditions))
	if (!versions.length) return 0

	const parents = new Map<number, CharacterProfileV1>()
	for (const version of versions) {
		const parentId = version.parentVersionId
		if (parentId == null || parents.has(parentId)) continue
		const [parent] = await tx.select().from(V).where(eq(V.id, parentId))
		if (parent) parents.set(parentId, profileOf(parent))
	}

	for (const version of versions) {
		const resolved = followedProfile(
			profileOf(version),
			version.follows,
			version.parentVersionId != null
				? (parents.get(version.parentVersionId) ?? null)
				: null
		)
		const set: Record<string, unknown> = { follows: [] }
		for (const field of version.follows)
			if (isCharacterProfileField(field)) set[field] = resolved[field]
		if (detach) set.parentVersionId = null
		await tx.update(V).set(set).where(eq(V.id, version.id))
	}
	return versions.length
}

/** A stable JSON of `value`: object keys sorted, `undefined` as null. */
function stableJson(value: unknown): string {
	const norm = (v: unknown): unknown => {
		if (v === undefined) return null
		if (Array.isArray(v)) return v.map(norm)
		if (v && typeof v === "object")
			return Object.fromEntries(
				Object.entries(v as Record<string, unknown>)
					.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
					.map(([k, x]) => [k, norm(x)])
			)
		return v
	}
	return JSON.stringify(norm(value))
}

/**
 * Retires a cast version a session forked from still reads (`retired_order` =
 * the next write order) and inserts its copy with the same provenance, the
 * given own fields, `follows` and parent (§33.2).
 */
async function retireAndCopyCastVersion(
	tx: Db,
	row: VersionRow,
	member: MemberRow,
	own: Partial<CharacterProfileV1>,
	follows: CharacterProfileField[],
	parentVersionId: number | null
): Promise<void> {
	const V = schema.characterVersions
	await tx
		.update(V)
		.set({ retiredOrder: await nextWriteOrder(tx) })
		.where(eq(V.id, row.id))
	const copy = copyOf(
		row,
		{
			own,
			follows,
			nodeState: row.nodeState ?? member.nodeState,
			nodeVisibility: row.nodeVisibility ?? member.nodeVisibility
		},
		member.id,
		row.lorebookId!,
		{
			branchId: row.branchId,
			year: row.year,
			month: row.month,
			day: row.day,
			historyEntryId: row.historyEntryId,
			atHour: row.atHour,
			atMinute: row.atMinute,
			personalPosition: row.personalPosition,
			sourceSessionId: row.sourceSessionId,
			sourceMessageId: row.sourceMessageId,
			validFromMessageId: row.validFromMessageId,
			writtenBy: row.writtenBy,
			note: row.note
		}
	)
	await insertRows(tx, [{ ...copy, parentVersionId }], false)
}

/**
 * 🚧 Re-parents a member's cast versions onto a card version of `cardId`, or
 * makes them card-less (`cardId: null`). It serves a link of a card-less
 * member, a card swap, a dated card change, a starter copy, a provided-book
 * member whose card appears, and the undo of a dated card change.
 *
 * - **Scope.** `from` absent or null: every cast version of the member (an
 *   undated link or swap). Given: the versions that come at or after that
 *   point on the member's timeline: those on a line where a version placed at
 *   (`branchId`, `date`) reads (`lineOfBook` per line of the book, then
 *   `rowReadsOnLine`) and dated at or after `date`. An undated version never
 *   counts for a dated `from`; earlier versions stay as they were. Retired
 *   rows are never touched. `onCard`, when the key is given, keeps only the
 *   versions whose parent is a version of that card (null: only card-less
 *   ones). `until` keeps only the versions dated before it (an undated one
 *   counts as before any date).
 * - **Target.** `cardVersionId` is the exact card version to land on and must
 *   be a version of `cardId`; absent, it is the card's current version
 *   (`ensureCardVersion`).
 * - **Follows.** `follows` given is the set of fields that **may** follow the
 *   new card: each version follows those of them it already followed, or whose
 *   own value equals the reference's, and keeps its own words for the rest
 *   (★CV-13). The reference is the version the member reads just before the
 *   move point (with `from`: the version in force on that line just before
 *   `from.date`; without: the member's base), resolved against its own
 *   parent, read once before any update. Absent: each keeps its own
 *   `follows` (a swap: what followed the old card follows the new), and a
 *   card-less version follows nothing.
 *
 * Per version, one rule: a field it followed and will not follow afterwards
 * is first resolved into its own column from its OLD parent (as
 * `resolveFollows` does), then the parent is set (null when card-less), then
 * `follows` is set and each followed field holds the empty value in its own
 * column (as `memberProfileOf` does). The one exception: when the target is
 * card-less and the reference is card-less too, a field that stops following
 * takes the reference's value, which restores the words a link replaced.
 * `keepCardWords` turns that exception off: a field that stops following
 * always takes the words it read from its old parent (an unlink from the
 * book's present keeps the card's words, even when a link at the same present
 * has just replaced the earlier ones).
 *
 * A row a session forked from this one still reads (`descendantReads`, §33.2)
 * is **retired** (`retired_order` = the next write order) instead of changed,
 * and the re-parented copy is inserted with the same provenance; every other
 * row is updated in place. It does not touch `lorebook_bindings.character_id`
 * (the caller's link key). Answers how many versions changed, both kinds.
 */
export async function reparentCastVersions(
	tx: Db,
	castMemberId: number,
	input: {
		cardId: number | null
		/** The exact card version to land on; must be a version of `cardId`. Absent: `cardId`'s current card version (`ensureCardVersion`), as today. */
		cardVersionId?: number
		follows?: readonly CharacterProfileField[]
		from?: { branchId: number | null; date: StoryDate } | null
		/** Present (even null): only versions whose parent is a version of this card are in scope; null = only card-less ones. Absent: no filter. */
		onCard?: number | null
		/** Only versions dated before this (exclusive). An undated version counts as before any date. */
		until?: StoryDate
		/** Card-less target only: a field that stops following keeps the words of its old parent, never the reference's. */
		keepCardWords?: boolean
	}
): Promise<number> {
	const V = schema.characterVersions
	const member = await memberOf(tx, castMemberId)
	let target: VersionRow | null = null
	if (input.cardVersionId != null) {
		if (input.cardId == null)
			throw new Error(
				`Character version ${input.cardVersionId} belongs to a card, so it cannot be used to make ${member.name} card-less; give the card it belongs to.`
			)
		const [found] = await tx
			.select()
			.from(V)
			.where(eq(V.id, input.cardVersionId))
		if (!found || found.cardId !== input.cardId)
			throw new Error(
				`Character version ${input.cardVersionId} is not a version of card ${input.cardId}.`
			)
		target = found
	} else if (input.cardId != null) {
		target = await ensureCardVersion(tx, input.cardId)
		if (!target)
			throw new Error(
				`Card ${input.cardId} does not exist, so ${member.name} cannot be moved onto it.`
			)
	}
	const given = input.follows ? [...new Set(input.follows)] : null
	if (target == null && given?.length)
		throw new Error(
			`A cast version cannot follow ${given.join(", ")} with no card to read them from.`
		)

	const all = await tx
		.select()
		.from(V)
		.where(eq(V.castMemberId, castMemberId))
		.orderBy(V.id)
	const dateOf = (row: VersionRow): StoryDate | null =>
		row.year == null
			? null
			: { year: row.year, month: row.month ?? null, day: row.day ?? null }

	const parents = new Map<number, CharacterProfileV1>()
	const parentRows = new Map<number, VersionRow>()
	const parentOf = async (id: number | null) => {
		if (id == null) return null
		let row = parentRows.get(id)
		if (!row) {
			const [p] = await tx.select().from(V).where(eq(V.id, id))
			if (!p) return null
			row = p
			parentRows.set(id, p)
			parents.set(id, profileOf(p))
		}
		return parents.get(id) ?? null
	}

	// The reference, before any update.
	let reference: VersionRow | null = null
	if (input.from) {
		const { from } = input
		const { lineOfBook } = await import("$lib/server/state/reading")
		const line = await lineOfBook(tx, member.lorebookId, from.branchId)
		reference = versionInForce(
			all.filter((row) => {
				if (row.retiredOrder != null) return false
				const date = dateOf(row)
				return date == null || compareDates(date, from.date) < 0
			}),
			line,
			from.date,
			null
		)
	} else {
		reference =
			all.find((row) => row.retiredOrder == null && isBaseVersion(row)) ??
			null
	}
	const referenceProfile = reference
		? followedProfile(
				profileOf(reference),
				reference.follows,
				await parentOf(reference.parentVersionId)
			)
		: null

	let rows = all.filter((row) => row.retiredOrder == null)
	if (input.from) {
		const { from } = input
		const { lineOfBook } = await import("$lib/server/state/reading")
		const branches = await tx
			.select({ id: schema.lorebookBranches.id })
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.lorebookId, member.lorebookId))
		const reading = new Set<number | null>()
		for (const lineId of [null, ...branches.map((b) => b.id)]) {
			const line = await lineOfBook(tx, member.lorebookId, lineId)
			if (rowReadsOnLine({ branchId: from.branchId }, line, from.date))
				reading.add(lineId)
		}
		rows = rows.filter(
			(row) =>
				row.year != null &&
				reading.has(row.branchId ?? null) &&
				compareDates(dateOf(row)!, from.date) >= 0
		)
	}
	if (input.onCard !== undefined) {
		const { onCard } = input
		const parentIds = [
			...new Set(
				rows.flatMap((r) =>
					r.parentVersionId != null ? [r.parentVersionId] : []
				)
			)
		]
		const cardOf = new Map<number, number | null>()
		if (parentIds.length)
			for (const p of await tx
				.select({ id: V.id, cardId: V.cardId })
				.from(V)
				.where(inArray(V.id, parentIds)))
				cardOf.set(p.id, p.cardId)
		rows = rows.filter((row) =>
			onCard === null
				? row.parentVersionId == null
				: row.parentVersionId != null &&
					cardOf.get(row.parentVersionId) === onCard
		)
	}
	if (input.until) {
		const { until } = input
		rows = rows.filter((row) => {
			const date = dateOf(row)
			return date == null || compareDates(date, until) < 0
		})
	}

	const empty = emptyCharacterProfile()
	const cardless =
		target == null &&
		reference?.parentVersionId == null &&
		!input.keepCardWords
	let changed = 0
	for (const row of rows) {
		const own = profileOf(row)
		let follows: CharacterProfileField[] = []
		if (target != null) {
			if (given)
				follows = given.filter(
					(field) =>
						row.follows.includes(field) ||
						(referenceProfile != null &&
							stableJson(own[field]) ===
								stableJson(referenceProfile[field]))
				)
			else follows = row.follows as CharacterProfileField[]
		}
		const parentId = target?.id ?? null
		const same =
			row.parentVersionId === parentId &&
			row.follows.length === follows.length &&
			row.follows.every((f, i) => f === follows[i])
		if (same) continue

		const oldParent = await parentOf(row.parentVersionId)
		const resolved = followedProfile(own, row.follows, oldParent)
		const set: Record<string, unknown> = {
			parentVersionId: parentId,
			follows
		}
		for (const field of row.follows)
			if (isCharacterProfileField(field) && !follows.includes(field))
				set[field] = stripNul(
					target == null && cardless && referenceProfile
						? referenceProfile[field]
						: resolved[field]
				)
		for (const field of follows) set[field] = empty[field]
		checkFollows({ follows, parentVersionId: parentId } as NewVersion)

		if (
			row.sourceSessionId != null &&
			(await descendantReads(tx, row.sourceSessionId, row))
		) {
			await retireAndCopyCastVersion(
				tx,
				row,
				member,
				Object.fromEntries(
					Object.entries(set).filter(([key]) =>
						isCharacterProfileField(key)
					)
				) as Partial<CharacterProfileV1>,
				follows,
				parentId
			)
		} else {
			await tx.update(V).set(set).where(eq(V.id, row.id))
		}
		changed++
	}
	return changed
}

/** The book's present on main: its story clock, else the newest dated history entry; null when it has neither. */
export async function bookPresentOf(
	tx: Db,
	lorebookId: number
): Promise<{ date: StoryDate; historyEntryId: number | null } | null> {
	const { momentOf, readingOf, writeDatingAt } = await import(
		"$lib/server/state/reading"
	)
	const [book] = await tx
		.select({
			storyClockYear: schema.lorebooks.storyClockYear,
			storyClockMonth: schema.lorebooks.storyClockMonth,
			storyClockDay: schema.lorebooks.storyClockDay
		})
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
	const clock = momentOf(book)
	if (clock) {
		const dating = await writeDatingAt(
			tx,
			await readingOf(tx, lorebookId, { moment: clock })
		)
		return {
			date: clock,
			historyEntryId:
				dating && compareDates(dating.date, clock) === 0
					? dating.historyEntryId
					: null
		}
	}
	const dating = await writeDatingAt(tx, await readingOf(tx, lorebookId))
	return dating
		? { date: dating.date, historyEntryId: dating.historyEntryId }
		: null
}

/**
 * 🚧 The cast version each of `members` has in force at its book's present on
 * main (`bookPresentOf`; no present reads main at its head): "the most
 * recently active" version, which the member page shows and saves (owner
 * 2026-11-06). The reading `reparentFromBookPresent` builds. One read per
 * book; a member with no version is absent from the answer.
 */
export async function versionsAtBookPresent(
	h: Db,
	members: readonly { id: number; lorebookId: number }[]
): Promise<Map<number, VersionRow>> {
	const out = new Map<number, VersionRow>()
	if (!members.length) return out
	const { lineOfBook } = await import("$lib/server/state/reading")
	const { castVersionsInForce } = await import(
		"$lib/server/cast/memberAsRead"
	)
	const byBook = new Map<number, number[]>()
	for (const m of members) {
		const ids = byBook.get(m.lorebookId) ?? []
		ids.push(m.id)
		byBook.set(m.lorebookId, ids)
	}
	for (const [lorebookId, ids] of byBook) {
		const present = await bookPresentOf(h, lorebookId)
		const inForce = await castVersionsInForce(h, ids, {
			reading: {
				branchId: null,
				moment: present?.date ?? null,
				forkedAt: null,
				line: await lineOfBook(h, lorebookId, null)
			},
			appearance: null
		})
		for (const id of ids) {
			const version = inForce.get(id)?.version
			if (version) out.set(id, version)
		}
	}
	return out
}

/**
 * 🚧 Re-parents a member's cast versions onto `cardId`'s current card version
 * **from the book's present** (main's present: the book's story clock, else
 * the newest dated history entry). Owner, 2026-11-06: "a link from the member
 * page applies from 'The book's present' (earlier versions keep their own
 * words)". With a present, it first writes a no-op **carrier** version at the
 * present on main (so the member's words as of then are a version of their own
 * that follows the card), then re-parents from that date (`reparentCastVersions`
 * with `from`); with no present it re-parents every version, as an undated
 * link does. Answers the present (null when there is none) and how many
 * versions changed.
 *
 * With `cardId: null` it **unlinks** the same way (owner, 2026-11-06: "Yes,
 * from the book's present"): versions from the present on become card-less
 * keeping the card's words (`keepCardWords`), earlier ones stay on the card;
 * with no present every version is detached (`resolveFollows`). `follows` is
 * not accepted without a card.
 */
export async function reparentFromBookPresent(
	tx: Db,
	castMemberId: number,
	input:
		| {
				cardId: number
				follows?: readonly CharacterProfileField[]
				writtenBy: string
		  }
		| { cardId: null; follows?: undefined; writtenBy: string }
): Promise<{ present: StoryDate | null; changed: number }> {
	const member = await memberOf(tx, castMemberId)
	const present = await bookPresentOf(tx, member.lorebookId)
	if (!present) {
		if (input.cardId == null) {
			const changed = await resolveFollows(
				tx,
				{ castMemberId },
				{ detach: true }
			)
			return { present: null, changed }
		}
		const changed = await reparentCastVersions(tx, castMemberId, {
			cardId: input.cardId,
			follows: input.follows
		})
		return { present: null, changed }
	}
	const { lineOfBook } = await import("$lib/server/state/reading")
	const { castVersionsInForce } = await import(
		"$lib/server/cast/memberAsRead"
	)
	const line = await lineOfBook(tx, member.lorebookId, null)
	const source = (
		await castVersionsInForce(tx, [castMemberId], {
			reading: {
				branchId: null,
				moment: present.date,
				forkedAt: null,
				line
			},
			appearance: null
		})
	).get(castMemberId)?.version
	await writeCastVersion(tx, {
		member: castMemberId,
		changes: { nodeState: source?.nodeState ?? member.nodeState },
		writtenBy: input.writtenBy,
		at: {
			branchId: null,
			date: present.date,
			historyEntryId: present.historyEntryId,
			personalPosition: null
		}
	})
	const changed = await reparentCastVersions(tx, castMemberId, {
		cardId: input.cardId,
		follows: input.follows,
		from: { branchId: null, date: present.date },
		keepCardWords: input.cardId == null ? true : undefined
	})
	return { present: present.date, changed }
}

// ── The session write (writeCastVersion) ──────────────────────────────────

/**
 * 🚧 What one cast-version write changes: profile fields (a value is the
 * version's own for that field; `{ follow: true }` makes the field follow its
 * parent card version again), and the member's node state and visibility.
 */
export type CastVersionChanges = {
	[K in CharacterProfileField]?: CharacterProfileV1[K] | { follow: true }
} & { nodeState?: NodeState; nodeVisibility?: NodeVisibility }

const NODE_KEYS = ["nodeState", "nodeVisibility"] as const

const isFollow = (value: unknown): value is { follow: true } =>
	!!value &&
	typeof value === "object" &&
	!Array.isArray(value) &&
	(value as Record<string, unknown>).follow === true &&
	Object.keys(value).length === 1

/** What `changes` make of a version's profile: the changed own values, the new `follows`, the node fields. */
type Applied = {
	own: Partial<CharacterProfileV1>
	follows: CharacterProfileField[]
	nodeState: NodeState
	nodeVisibility: NodeVisibility
}

/** Refuses a `changes` that is empty or names a key that is not writable; answers the keys with a value. */
function changeKeysOf(changes: CastVersionChanges): string[] {
	const keys = Object.keys(changes).filter(
		(key) => (changes as Record<string, unknown>)[key] !== undefined
	)
	if (!keys.length)
		throw new Error(
			"A cast version write needs something to change, and this one changes nothing."
		)
	for (const key of keys)
		if (
			!isCharacterProfileField(key) &&
			!(NODE_KEYS as readonly string[]).includes(key)
		)
			throw new Error(
				`"${key}" is not a character profile field, so a cast version cannot change it. The fields are ${CHARACTER_PROFILE_FIELDS.join(", ")}, ${NODE_KEYS.join(", ")}.`
			)
	return keys
}

/** `changes` applied over the version they copy; a follow on a version with no parent card version is refused in words. */
function applyChanges(
	source: VersionRow,
	changes: CastVersionChanges,
	member: MemberRow
): Applied {
	const follows = new Set<string>(source.follows)
	const own: Record<string, unknown> = {}
	let nodeState = source.nodeState ?? member.nodeState
	let nodeVisibility = source.nodeVisibility ?? member.nodeVisibility
	for (const [key, value] of Object.entries(changes)) {
		if (value === undefined) continue
		if (key === "nodeState") nodeState = value as NodeState
		else if (key === "nodeVisibility")
			nodeVisibility = value as NodeVisibility
		else if (isFollow(value)) {
			if (source.parentVersionId == null)
				throw new Error(
					`${member.name} has no card to follow, so ${key} stays their own.`
				)
			follows.add(key)
		} else {
			own[key] = value
			follows.delete(key)
		}
	}
	return {
		own: own as Partial<CharacterProfileV1>,
		follows: [...follows] as CharacterProfileField[],
		nodeState,
		nodeVisibility
	}
}

/** A complete copy of `source` with `applied`, for the target `castMemberId` in `lorebookId`, to be placed at `place`. */
function copyOf(
	source: VersionRow,
	applied: Applied,
	castMemberId: number,
	lorebookId: number,
	place: Pick<
		NewVersion,
		| "branchId"
		| "year"
		| "month"
		| "day"
		| "historyEntryId"
		| "atHour"
		| "atMinute"
		| "personalPosition"
		| "sourceSessionId"
		| "sourceMessageId"
		| "validFromMessageId"
		| "writtenBy"
		| "note"
	>
): NewVersion {
	return {
		...profileOf(source),
		...applied.own,
		castMemberId,
		lorebookId,
		parentVersionId: source.parentVersionId,
		follows: applied.follows,
		nodeState: applied.nodeState,
		nodeVisibility: applied.nodeVisibility,
		...place
	}
}

/** Writes `applied` onto an existing version in place; nothing else about the row changes. */
async function updateInPlace(
	tx: Db,
	row: VersionRow,
	changes: CastVersionChanges,
	applied: Applied
): Promise<VersionRow> {
	checkFollows({
		follows: applied.follows,
		parentVersionId: row.parentVersionId
	} as NewVersion)
	const set: Record<string, unknown> = {
		follows: applied.follows,
		nodeState: applied.nodeState,
		nodeVisibility: applied.nodeVisibility
	}
	for (const field of CHARACTER_PROFILE_FIELDS)
		if (
			changes[field] !== undefined &&
			!isFollow(changes[field]) &&
			applied.own[field] !== undefined
		)
			set[field] = stripNul(applied.own[field])
	const [updated] = await tx
		.update(schema.characterVersions)
		.set(set)
		.where(eq(schema.characterVersions.id, row.id))
		.returning()
	return updated
}

/**
 * Refuses, in words, a member that holds no version: the boot upgrade lifts
 * every member onto character versions, and a base is never made at runtime
 * (a straggler would be hidden, not shown). A member whose amendments the
 * boot pass has not lifted yet holds no version either.
 */
async function ensureMemberBase(tx: Db, member: MemberRow): Promise<void> {
	const V = schema.characterVersions
	const [held] = await tx
		.select({ id: V.id })
		.from(V)
		.where(eq(V.castMemberId, member.id))
		.limit(1)
	if (held) return
	throw new Error(
		`${member.name} hasn't been moved onto character versions yet; restart the server so the upgrade lifts them.`
	)
}

const sameDate = (
	row: { year: number | null; month: number | null; day: number | null },
	date: StoryDate | null
) =>
	row.year === (date?.year ?? null) &&
	row.month === (date?.month ?? null) &&
	row.day === (date?.day ?? null)

/** Whether a session forked from `sessionId` still reads `row` (its session cuts pass it). */
async function descendantReads(
	tx: Db,
	sessionId: number,
	row: VersionRow
): Promise<boolean> {
	const { sessionCutsOf } = await import("$lib/server/state/reading")
	const descendants = await tx
		.select({ id: schema.sessions.id })
		.from(schema.sessions)
		.where(
			sql`${schema.sessions.branchAncestry} @> ${JSON.stringify([{ sessionId }])}::jsonb`
		)
	for (const { id } of descendants) {
		const sessionCuts = await sessionCutsOf(tx, id)
		if (rowPassesSessionCut(row, { ...MAIN_LINE, sessionCuts })) return true
	}
	return false
}

/**
 * 🚧 **Retire or take** the cast versions a retraction reaches (plan §33.2:
 * Back, a swipe or a message delete). A row some descendant session still
 * reads (`descendantReads`) is **retired** — `retired_order` = the next write
 * order — never deleted, so the branch keeps reading it; any other row is
 * deleted (**taken**). A row with no `sourceSessionId` is not a session's
 * write and is skipped, in neither list. Answers the rows **as they were
 * before** (`retiredOrder` null in both lists), for `restoreVersions`.
 */
export async function retireOrTakeVersions(
	tx: Db,
	rows: readonly VersionRow[]
): Promise<{ taken: VersionRow[]; retired: VersionRow[] }> {
	const taken: VersionRow[] = []
	const retired: VersionRow[] = []
	for (const row of rows) {
		if (row.sourceSessionId == null) continue
		if (await descendantReads(tx, row.sourceSessionId, row)) {
			await tx
				.update(schema.characterVersions)
				.set({ retiredOrder: await nextWriteOrder(tx) })
				.where(eq(schema.characterVersions.id, row.id))
			retired.push(row)
		} else {
			await tx
				.delete(schema.characterVersions)
				.where(eq(schema.characterVersions.id, row.id))
			taken.push(row)
		}
	}
	return { taken, retired }
}

/**
 * 🚧 **Forward puts the versions back** (plan §33.2): the rows
 * `retireOrTakeVersions` answered, exactly as given — **id and `write_order`
 * kept**, the retire mark cleared. A row still there (it was retired) only
 * loses its mark (`ON CONFLICT (id) DO UPDATE`); a row that was deleted, or
 * retired and then swept, is inserted again. Returns how many rows it wrote.
 *
 * This is the one other INSERT of `character_versions` besides
 * `insertCharacterVersions`: a restore gives a row back its own id, so it
 * never draws one from the sequence.
 */
export async function restoreVersions(
	tx: Db,
	rows: readonly VersionRow[]
): Promise<number> {
	if (!rows.length) return 0
	const written = await tx
		.insert(schema.characterVersions)
		.values(rows.map((row) => ({ ...row, retiredOrder: null })))
		.onConflictDoUpdate({
			target: schema.characterVersions.id,
			set: { retiredOrder: null }
		})
		.returning({ id: schema.characterVersions.id })
	return written.length
}

/**
 * 🚧 **Sweep the retired rows nobody reads** (plan §33.2: "swept when the last
 * descendant goes"). For each source session id, every row written by it that
 * carries a retire mark and that no live descendant reads any more is
 * deleted. Called after a session is deleted, with that session's ancestry
 * ids. Returns how many rows it deleted.
 */
export async function sweepRetiredVersions(
	tx: Db,
	sourceSessionIds: readonly number[]
): Promise<number> {
	let swept = 0
	for (const sessionId of new Set(sourceSessionIds)) {
		const retired = await tx
			.select()
			.from(schema.characterVersions)
			.where(
				and(
					eq(schema.characterVersions.sourceSessionId, sessionId),
					sql`${schema.characterVersions.retiredOrder} IS NOT NULL`
				)
			)
		for (const row of retired) {
			if (await descendantReads(tx, sessionId, row)) continue
			await tx
				.delete(schema.characterVersions)
				.where(eq(schema.characterVersions.id, row.id))
			swept++
		}
	}
	return swept
}

/**
 * 🚧 The cast-version write — a session's story write, or an author's (plan
 * §32 §4, §33.2). Takes `tx` and never opens a transaction; the caller's is
 * the one the state lock lasts to. Nothing but this writes a cast member's
 * evolution.
 *
 * **Story write** (`input.session`): takes `lockStateVersion` first; picks the
 * **target** — the member itself when the session may write its book
 * (`loreWriteTargetFor` says `book`; that call forks the session's line if it
 * is still riding its parent's — `ensureSessionLine`) or when the member is in
 * the session's own book, otherwise the session's **overlay row** in its own
 * book (made on demand: `overlay_of` the member, no card link, no base);
 * dates it at the session's day (its clock, else its line's present, else the
 * latest dated history entry it sees, else undated) and its time of day;
 * anchors it to the **world's** turn (`anchorFor`, `storyWrite`), so Back
 * takes it. The row it copies is the one the session reads
 * (`castVersionsInForce`); the copy keeps its life point (★CV-15) and takes a
 * fresh write order. A second write that has the same key — (target, line,
 * session, anchor, date, time of day, life point) — updates the row in place
 * (`coalesced: true`), unless a session forked from this one still reads it:
 * that row is then **retired** (§33.2) and the changed copy inserted.
 *
 * **Author write** (`input.at`): the member itself, at that line, date and
 * life point. A version already at exactly that key, with no source and no
 * retire mark, is updated in place; otherwise a complete copy of the version
 * in force there is inserted with the changes.
 *
 * A member with no version yet is refused in words (see `ensureMemberBase`):
 * a base is never made at runtime.
 * `changes` are `{ field: value | { follow: true } }`; a follow is refused in
 * words for a version with no card.
 */
export async function writeCastVersion(
	tx: Db,
	input: {
		/** The cast member as the caller names it (a `lorebook_bindings` id). */
		member: number
		changes: CastVersionChanges
		/** `user:<id>` · `run:<id>` · `script:<id>` · `plugin:<id>`. */
		writtenBy: string
		note?: string | null
		/** A story write (a session's). */
		session?: { id: number; messageId?: number | null; ownAnchor?: boolean }
		/** An author's write with no session: where on the member's line it lands. */
		at?: {
			branchId: number | null
			date: StoryDate | null
			historyEntryId?: number | null
			personalPosition: number | null
		}
	}
): Promise<{ version: VersionRow; coalesced: boolean }> {
	changeKeysOf(input.changes)
	if (input.session && input.at)
		throw new Error(
			"A cast version write is a session's or an author's, not both."
		)
	if (!input.session && !input.at)
		throw new Error(
			"A cast version write needs a session or a place on the member's line to land at, and this one has neither."
		)
	const written = input.session
		? await storyWrite(tx, input, input.session)
		: await authorWrite(tx, input, input.at!)
	if (written.version.branchId == null && touchesName(input.changes))
		await writeBackShownName(tx, input.member)
	return written
}

/** Whether `changes` sets or follows a name or nickname: the only writes that can move the shown name. */
const touchesName = (changes: CastVersionChanges | undefined): boolean =>
	changes?.name !== undefined || changes?.nickname !== undefined

/**
 * The member's shown name at its book's present on Main, written back to
 * `lorebook_bindings.name` when it differs (owner 2026-11-08, ★cp-names-1):
 * for sort and search only — the vocabulary claims names by the base name.
 * After a cast version write, edit or delete on Main; the card sync and
 * session Back/Forward call it too. 🚧
 */
export async function writeBackShownName(tx: Db, memberId: number): Promise<void> {
	const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
	const shown = (await membersAsRead(tx, [memberId])).get(memberId)?.shownName
	if (!shown) return
	await tx
		.update(schema.lorebookBindings)
		.set({ name: shown })
		.where(
			and(
				eq(schema.lorebookBindings.id, memberId),
				sql`${schema.lorebookBindings.name} <> ${shown}`
			)
		)
}

type WriteInput = Parameters<typeof writeCastVersion>[1]

async function memberOf(tx: Db, id: number): Promise<MemberRow> {
	const [member] = await tx
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, id))
		.limit(1)
	if (!member) throw new Error(`Cast member ${id} does not exist.`)
	return member
}

async function authorWrite(
	tx: Db,
	input: WriteInput,
	at: NonNullable<WriteInput["at"]>
): Promise<{ version: VersionRow; coalesced: boolean }> {
	if (at.date == null && (at.branchId != null || at.personalPosition != null))
		throw new Error(
			"An undated cast version can only be on main with no life point, so a version on a line or at a life point needs a date."
		)
	const member = await memberOf(tx, input.member)
	await ensureMemberBase(tx, member)
	const V = schema.characterVersions
	const [same] = await tx
		.select()
		.from(V)
		.where(
			and(
				eq(V.castMemberId, member.id),
				at.branchId == null
					? isNull(V.branchId)
					: eq(V.branchId, at.branchId),
				at.date == null ? isNull(V.year) : eq(V.year, at.date.year),
				at.date?.month == null
					? isNull(V.month)
					: eq(V.month, at.date.month),
				at.date?.day == null ? isNull(V.day) : eq(V.day, at.date.day),
				at.personalPosition == null
					? isNull(V.personalPosition)
					: eq(V.personalPosition, at.personalPosition),
				isNull(V.sourceSessionId),
				isNull(V.retiredOrder)
			)
		)
		.orderBy(desc(V.id))
		.limit(1)
	if (same)
		return {
			version: await updateInPlace(
				tx,
				same,
				input.changes,
				applyChanges(same, input.changes, member)
			),
			coalesced: true
		}

	const { lineOfBook } = await import("$lib/server/state/reading")
	const { castVersionsInForce } = await import(
		"$lib/server/cast/memberAsRead"
	)
	const line = await lineOfBook(tx, member.lorebookId, at.branchId)
	const source = (
		await castVersionsInForce(tx, [member.id], {
			reading: {
				branchId: at.branchId,
				moment: at.date,
				forkedAt: null,
				line
			},
			appearance: at.personalPosition
		})
	).get(member.id)?.version
	if (!source)
		throw new Error(
			`${member.name} has no version in force there to copy, so nothing could be written.`
		)
	const [version] = await insertRows(
		tx,
		[
			copyOf(
				source,
				applyChanges(source, input.changes, member),
				member.id,
				member.lorebookId,
				{
					branchId: at.branchId,
					year: at.date?.year ?? null,
					month: at.date?.month ?? null,
					day: at.date?.day ?? null,
					historyEntryId: at.historyEntryId ?? null,
					atHour: null,
					atMinute: null,
					personalPosition: at.personalPosition,
					sourceSessionId: null,
					sourceMessageId: null,
					validFromMessageId: null,
					writtenBy: input.writtenBy,
					note: input.note ?? null
				}
			)
		],
		false
	)
	return { version, coalesced: false }
}

const NO_ANCHOR =
	"A session's change to a cast member needs the turn it belongs to, and this one names none; an author's change uses a place on the member's line instead."

async function storyWrite(
	tx: Db,
	input: WriteInput,
	session: NonNullable<WriteInput["session"]>
): Promise<{ version: VersionRow; coalesced: boolean }> {
	const S = session.id
	const { lockStateVersion, anchorFor } = await import(
		"$lib/server/state/write"
	)
	await lockStateVersion(tx, S)

	if (session.messageId === null) throw new Error(NO_ANCHOR)
	const member = await memberOf(tx, input.member)
	const [row] = await tx
		.select({
			name: schema.sessions.name,
			lorebookId: schema.sessions.lorebookId,
			storyClockYear: schema.sessions.storyClockYear,
			storyClockMonth: schema.sessions.storyClockMonth,
			storyClockDay: schema.sessions.storyClockDay,
			storyClockHour: schema.sessions.storyClockHour,
			storyClockMinute: schema.sessions.storyClockMinute
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, S))
		.limit(1)
	if (!row) throw new Error(`Session ${S} not found.`)

	// The target: the member itself, or the session's overlay row for it.
	const { loreWriteTargetFor, ownBookFor, ownBookOf } = await import(
		"$lib/server/lorebooks/ownBook"
	)
	let direct: boolean
	if (row.lorebookId != null && member.lorebookId === row.lorebookId)
		direct = (await loreWriteTargetFor(tx, S)).route === "book"
	else direct = (await ownBookOf(tx, S))?.id === member.lorebookId
	let target: MemberRow = member
	if (!direct) {
		const own = await ownBookFor(tx, S)
		const [overlay] = await tx
			.select()
			.from(schema.lorebookBindings)
			.where(
				and(
					eq(schema.lorebookBindings.lorebookId, own.id),
					eq(schema.lorebookBindings.overlayOf, member.id)
				)
			)
			.limit(1)
		if (overlay) target = overlay
		else {
			const { deriveNextBindingToken } = await import(
				"$lib/server/utils/lorebookBindingToken"
			)
			target = (
				await insertCastMember(tx, {
					lorebookId: own.id,
					binding: await deriveNextBindingToken(own.id, tx),
					characterId: null,
					name: member.name,
					overlayOf: member.id
				})
			).member
		}
	}

	// Where: a target in the attached book lands on the session's line (forked
	// above when it was still riding its parent's), dated by that book's
	// history; a target in an own book is on its main, unless the session
	// reads its own notes alone on a line: then it lands on that line, dated
	// the same way.
	const inAttached = target.lorebookId === row.lorebookId
	const { sessionReadingOf, writeDatingAt, momentOf } = await import(
		"$lib/server/state/reading"
	)
	const attachedReading =
		row.lorebookId != null ? await sessionReadingOf(tx, S) : null
	const ownLineReading =
		row.lorebookId == null ? await sessionReadingOf(tx, S) : null
	const onOwnLine =
		ownLineReading != null &&
		ownLineReading.onOwnBook === true &&
		ownLineReading.branchId != null &&
		target.lorebookId === ownLineReading.lorebookId
	const reading = onOwnLine ? ownLineReading : attachedReading
	const dating = reading ? await writeDatingAt(tx, reading) : null
	const date = reading ? reading.moment : momentOf(row)
	const when: StoryDate | null = date ?? dating?.date ?? null
	const branchId =
		inAttached || onOwnLine ? (reading?.branchId ?? null) : null

	const anchor = await anchorFor(
		tx,
		{
			sessionId: S,
			updatedBy: input.writtenBy,
			messageId: session.messageId,
			ownAnchor: session.ownAnchor
		},
		{ kind: "cast_member", id: target.id },
		undefined,
		{ storyWrite: true }
	)
	// No open turn to belong to: refused. The overlay row above was inserted in
	// the caller's transaction, so this throw rolls it back with the rest.
	if (anchor == null) throw new Error(NO_ANCHOR)

	const { castVersionsInForce } = await import(
		"$lib/server/cast/memberAsRead"
	)
	const inForce = async () =>
		(await castVersionsInForce(tx, [member.id], { sessionId: S })).get(
			member.id
		)?.version
	let source = await inForce()
	if (!source) {
		await ensureMemberBase(tx, member)
		source = await inForce()
	}
	if (!source)
		throw new Error(
			`${member.name} has no version this session reads, so nothing could be written.`
		)

	const applied = applyChanges(source, input.changes, member)
	const hour = row.storyClockHour ?? null
	const minute = row.storyClockMinute ?? null
	const sameKey =
		source.castMemberId === target.id &&
		source.sourceSessionId === S &&
		source.branchId === branchId &&
		source.sourceMessageId === anchor &&
		source.validFromMessageId === anchor &&
		sameDate(source, when) &&
		source.atHour === hour &&
		source.atMinute === minute &&
		source.retiredOrder == null
	if (sameKey) {
		if (!(await descendantReads(tx, S, source)))
			return {
				version: await updateInPlace(
					tx,
					source,
					input.changes,
					applied
				),
				coalesced: true
			}
		// §33.2: a row some descendant reads is retired, never changed.
		await tx
			.update(schema.characterVersions)
			.set({ retiredOrder: await nextWriteOrder(tx) })
			.where(eq(schema.characterVersions.id, source.id))
	}

	const [version] = await insertRows(
		tx,
		[
			copyOf(source, applied, target.id, target.lorebookId, {
				branchId,
				year: when?.year ?? null,
				month: when?.month ?? null,
				day: when?.day ?? null,
				historyEntryId: inAttached
					? (dating?.historyEntryId ?? null)
					: null,
				atHour: hour,
				atMinute: minute,
				// ★CV-15: a story write keeps the life point of the version it copies.
				personalPosition: source.personalPosition,
				sourceSessionId: S,
				sourceMessageId: anchor,
				validFromMessageId: anchor,
				writtenBy: input.writtenBy,
				note: input.note ?? null
			})
		],
		false
	)
	return { version, coalesced: false }
}

// ── Editing, removing and re-pointing cast versions (the author's) ────────

/** 🚧 Provisional refusal sentences of the author's edit and removal. */
const NO_EDIT = "There is nothing to change in that cast version."
const BASE_MOVE =
	"The first cast version is who they are from the start, so it cannot be moved to another date or line."
const BASE_REMOVE =
	"The first cast version is who they are, so it cannot be removed; remove the cast member to remove them."
const UNDATED_PLACE =
	"An undated cast version can only be on main with no life point, so a version on a line or at a life point needs a date."

/** 🚧 A member's **base** version: on main, undated, no life point, no source session. */
export const isBaseVersion = (v: VersionRow) =>
	v.branchId == null &&
	v.year == null &&
	v.personalPosition == null &&
	v.sourceSessionId == null

async function castVersionOf(tx: Db, versionId: number): Promise<VersionRow> {
	const [row] = await tx
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.id, versionId))
	if (!row) throw new Error(`Character version ${versionId} does not exist.`)
	if (row.castMemberId == null)
		throw new Error(
			`Character version ${versionId} is a card version, not a cast member's; card versions are changed from the card.`
		)
	return row
}

/**
 * 🚧 Edits ONE cast version in place: an authored one, or one a session wrote
 * (★CV-2): the edit an author makes from the member's **Changes** list.
 * `changes` mean what they do in `writeCastVersion` (through `applyChanges`);
 * `place` is a re-date or move (a full place: `historyEntryId` absent = null,
 * as `writeCastVersion`'s `at`).
 *
 * Refuses an unknown id, a card version, a retired cast version, nothing to
 * change (no changes, or a place equal to the row's), moving the member's
 * **base** (undated, main, no life point, no source), an undated place on a
 * line or at a life point, and a place where the member already has another
 * live authored version at exactly that key (branch, date, life point, no
 * source, not retired).
 *
 * A row a session wrote that a descendant session still reads
 * (`descendantReads`) is **retired** (§33.2) and the edited copy inserted
 * (new id, new write order, same provenance); the new row is answered. Any
 * other row is updated in place. A session-written row keeps its source and
 * anchor either way, so Back still takes it. The calendar check
 * (`assertDateLands`) and the book lock stay the caller's.
 */
export async function updateCastVersion(
	tx: Db,
	versionId: number,
	edit: Parameters<typeof editCastVersion>[2]
): Promise<VersionRow> {
	const before = await castVersionOf(tx, versionId)
	const updated = await editCastVersion(tx, versionId, edit)
	if (
		(before.branchId == null || updated.branchId == null) &&
		(edit.place || touchesName(edit.changes))
	)
		await writeBackShownName(tx, updated.castMemberId!)
	return updated
}

async function editCastVersion(
	tx: Db,
	versionId: number,
	edit: {
		changes?: CastVersionChanges
		place?: {
			branchId: number | null
			date: StoryDate | null
			historyEntryId?: number | null
			personalPosition: number | null
		}
	}
): Promise<VersionRow> {
	const row = await castVersionOf(tx, versionId)
	if (row.retiredOrder != null)
		throw new Error(
			"That cast version has been replaced by a later change, so it can't be edited."
		)
	const member = await memberOf(tx, row.castMemberId!)
	const V = schema.characterVersions

	const changes =
		edit.changes && changeKeysOfOrNone(edit.changes) ? edit.changes : null
	const place =
		edit.place &&
		!(
			edit.place.branchId === row.branchId &&
			sameDate(row, edit.place.date) &&
			edit.place.personalPosition === row.personalPosition &&
			(edit.place.historyEntryId ?? null) === row.historyEntryId
		)
			? edit.place
			: null
	if (!changes && !place) throw new Error(NO_EDIT)

	if (place) {
		if (isBaseVersion(row)) throw new Error(BASE_MOVE)
		if (
			place.date == null &&
			(place.branchId != null || place.personalPosition != null)
		)
			throw new Error(UNDATED_PLACE)
		const [clash] = await tx
			.select({ id: V.id })
			.from(V)
			.where(
				and(
					eq(V.castMemberId, member.id),
					sql`${V.id} <> ${row.id}`,
					place.branchId == null
						? isNull(V.branchId)
						: eq(V.branchId, place.branchId),
					place.date == null
						? isNull(V.year)
						: eq(V.year, place.date.year),
					place.date?.month == null
						? isNull(V.month)
						: eq(V.month, place.date.month),
					place.date?.day == null
						? isNull(V.day)
						: eq(V.day, place.date.day),
					place.personalPosition == null
						? isNull(V.personalPosition)
						: eq(V.personalPosition, place.personalPosition),
					isNull(V.sourceSessionId),
					isNull(V.retiredOrder)
				)
			)
			.limit(1)
		if (clash)
			throw new Error(
				`${member.name} already has a change of their own at that date and place, so this one can't be moved there; edit that one instead.`
			)
	}

	const applied: Applied = changes
		? applyChanges(row, changes, member)
		: {
				own: {},
				follows: row.follows as CharacterProfileField[],
				nodeState: row.nodeState ?? member.nodeState,
				nodeVisibility: row.nodeVisibility ?? member.nodeVisibility
			}
	const placeColumns = place
		? {
				branchId: place.branchId,
				year: place.date?.year ?? null,
				month: place.date?.month ?? null,
				day: place.date?.day ?? null,
				historyEntryId: place.historyEntryId ?? null,
				personalPosition: place.personalPosition
			}
		: null

	if (
		row.sourceSessionId != null &&
		(await descendantReads(tx, row.sourceSessionId, row))
	) {
		await tx
			.update(V)
			.set({ retiredOrder: await nextWriteOrder(tx) })
			.where(eq(V.id, row.id))
		const [copy] = await insertRows(
			tx,
			[
				copyOf(row, applied, member.id, row.lorebookId!, {
					branchId: row.branchId,
					year: row.year,
					month: row.month,
					day: row.day,
					historyEntryId: row.historyEntryId,
					atHour: row.atHour,
					atMinute: row.atMinute,
					personalPosition: row.personalPosition,
					sourceSessionId: row.sourceSessionId,
					sourceMessageId: row.sourceMessageId,
					validFromMessageId: row.validFromMessageId,
					writtenBy: row.writtenBy,
					note: row.note,
					...placeColumns
				})
			],
			false
		)
		return copy
	}

	let updated = row
	if (changes) updated = await updateInPlace(tx, row, changes, applied)
	if (placeColumns)
		[updated] = await tx
			.update(V)
			.set(placeColumns)
			.where(eq(V.id, row.id))
			.returning()
	return updated
}

/**
 * 🚧 **Follow the card's greetings** for a member the upgrade lift gave its own
 * greetings list (owner ruling 2026-11-05, "Own list, noted": one click,
 * Admin › Data and backups): the member's lift-written versions (the base
 * whatever wrote it) that still hold the lift's copy of the mixed list — the
 * base's greetings, JSON-equal — follow the card's greetings again, and the
 * base's note drops its `mixedGreetings` line (the note is null when no
 * difference is left). A version the member's author has since given other
 * greetings keeps them. Refuses a base whose note has no `mixedGreetings` and
 * a member that reads no card. Answers how many versions now follow. The
 * book lock is the caller's. Each row keeps its `writtenBy` (an edit in place
 * does not change who wrote it).
 */
export async function followCardGreetingsAfterLift(
	tx: Db,
	castMemberId: number
): Promise<number> {
	const { parseLiftNote } = await import("./versionsLift")
	const V = schema.characterVersions
	const rows = await tx
		.select()
		.from(V)
		.where(
			and(eq(V.castMemberId, castMemberId), isNull(V.retiredOrder))
		)
		.orderBy(V.id)
	const base = rows.find(isBaseVersion)
	if (!base) throw new Error(`Cast member ${castMemberId} has no first version.`)
	const note = parseLiftNote(base.note)
	if (!note?.mixedGreetings)
		throw new Error(
			"This cast member's greetings were not changed by the upgrade."
		)
	if (base.parentVersionId == null)
		throw new Error(
			"This cast member reads no card now, so there are no card greetings to follow."
		)
	const copy = stableJson(base.greetings)
	const targets = rows.filter(
		(r) =>
			(r.id === base.id || r.writtenBy === "lift") &&
			r.parentVersionId != null &&
			!r.follows.includes("greetings") &&
			stableJson(r.greetings) === copy
	)
	for (const t of targets)
		await updateCastVersion(tx, t.id, {
			changes: { greetings: { follow: true } }
		})
	const left: LiftNoteV1 = { v: 1, differences: note.differences }
	await tx
		.update(V)
		.set({
			note: note.differences.length ? JSON.stringify(left) : null
		})
		.where(eq(V.id, base.id))
	return targets.length
}

/** Whether `changes` carries at least one value; a key that is not writable is refused in words. */
function changeKeysOfOrNone(changes: CastVersionChanges): boolean {
	const any = Object.values(changes).some((v) => v !== undefined)
	if (any) changeKeysOf(changes)
	return any
}

/**
 * 🚧 Removes ONE cast version. Refuses an unknown id, a card version and the
 * member's **base** (the base is who they are; removing the cast member is
 * how they go). A row a session wrote goes through `retireOrTakeVersions`
 * (retired when a descendant session reads it, else deleted); an authored row
 * is deleted. Answers the rows as they were, for `restoreVersions`.
 */
export async function deleteCastVersion(
	tx: Db,
	versionId: number
): Promise<{ taken: VersionRow[]; retired: VersionRow[] }> {
	const row = await castVersionOf(tx, versionId)
	if (isBaseVersion(row)) throw new Error(BASE_REMOVE)
	let gone: { taken: VersionRow[]; retired: VersionRow[] }
	if (row.sourceSessionId != null) gone = await retireOrTakeVersions(tx, [row])
	else {
		await tx
			.delete(schema.characterVersions)
			.where(eq(schema.characterVersions.id, row.id))
		gone = { taken: [row], retired: [] }
	}
	if (row.branchId == null) await writeBackShownName(tx, row.castMemberId!)
	return gone
}

/**
 * 🚧 A fork copies a history entry, and the cast versions dated by the
 * original on the group's lines (`branchIds`, the same lines `pointOnto`'s
 * `ofGroup` takes) move to the copy: `history_entry_id` `fromEntryId` becomes
 * `toEntryId`. Cast versions only. Answers how many.
 */
export async function repointVersionHistory(
	tx: Db,
	fromEntryId: number,
	toEntryId: number,
	branchIds: readonly number[]
): Promise<number> {
	if (!branchIds.length) return 0
	const V = schema.characterVersions
	const moved = await tx
		.update(V)
		.set({ historyEntryId: toEntryId })
		.where(
			and(
				sql`${V.castMemberId} IS NOT NULL`,
				eq(V.historyEntryId, fromEntryId),
				inArray(V.branchId, [...branchIds])
			)
		)
		.returning({ id: V.id })
	return moved.length
}

/**
 * 🚧 Re-points the face and likeness picture of every version of a cast member
 * (retired rows included), old file id to new, in place: no retire and no new
 * version. Card versions are never touched. Answers how many rows it changed.
 */
export async function repointCastVersionFiles(
	tx: Db,
	castMemberId: number,
	files: Map<number, number>
): Promise<number> {
	if (!files.size) return 0
	const V = schema.characterVersions
	const rows = await tx
		.select({
			id: V.id,
			faceMediaId: V.faceMediaId,
			likeness: V.likeness
		})
		.from(V)
		.where(eq(V.castMemberId, castMemberId))
	let changed = 0
	for (const r of rows) {
		const face =
			r.faceMediaId != null ? files.get(r.faceMediaId) : undefined
		const like = r.likeness as { imageMediaId?: number | null } | null
		const likeImage =
			like?.imageMediaId != null
				? files.get(like.imageMediaId)
				: undefined
		if (face === undefined && likeImage === undefined) continue
		await tx
			.update(V)
			.set({
				...(face !== undefined ? { faceMediaId: face } : {}),
				...(likeImage !== undefined
					? { likeness: { ...like!, imageMediaId: likeImage } }
					: {})
			})
			.where(eq(V.id, r.id))
		changed++
	}
	return changed
}
