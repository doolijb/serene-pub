/**
 * 🚧 **Starter lorebooks** (PLAN-lorebook-kinds §B, ruled 2026-10-21): a static
 * template a new lorebook — or a new session's notes — is copied from, whole.
 * Starting from a kit always copies (ruling 4); nothing reads a kit itself.
 *
 * Two sources, one ending:
 *
 * - a **shipped kit** is an SDK primer (`primers()`, `core:primer/…@N` or a
 *   plugin's): catalogue data, never a row, so it is immutable by
 *   construction. `writePrimerInto` writes its world into a row.
 * - an **admin kit** is a `lorebooks` row of book kind `starter_kit`, owned by
 *   the admin who saved or cloned it, edited in place with the ordinary
 *   lorebook sockets. It is copied with `duplicateLorebookRows`; a copy for
 *   anyone but its owner takes its cast's character cards as its own
 *   (`ownCastCards`), so no kit ever lends out a card.
 *
 * Either way the target row ends with the kit's Rules (`primary_ruleset`,
 * `ruleset_version`) and the book kind it was made as (`bookFromKit`).
 *
 * ⚠ The ruleset's compendium is NOT copied in (`primerDerivedEntries` is never
 * called): the compendium is shown under a book, as the ruleset's library
 * (plan §C), and a primer's `compendiumMode` is not read.
 *
 * ⚠ Every write takes the `tx` it is handed. The work that needs the module
 * `db` — character avatars, a cover's file, the vectorizer — is what
 * `afterKitCopy` does once the transaction has committed.
 */

import * as schema from "$lib/server/db/schema"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import {
	attributeSlots,
	getAttributeSlot,
	getPrimer,
	getRuleset,
	i18nText,
	primers,
	repertoireAddress,
	type PrimerContent,
	type PrimerDecl
} from "@serene-pub/sdk"
import { locationSlot } from "@serene-pub/core-catalog"
import { duplicateLorebookRows } from "$lib/server/utils/lorebookDuplicate"
import { entryInsert, nextPosition } from "$lib/server/utils/lorebookEntries"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import { entryDeclaration } from "$lib/server/entries/declarations"
import { clockColumns } from "$lib/server/state/storyTime"
import { LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"

/** The two book kinds (`lorebooks.kind`). */
export const BOOK_KINDS = ["book", "starter_kit"] as const
export type BookKind = (typeof BOOK_KINDS)[number]
export const STARTER_KIT_KIND: BookKind = "starter_kit"

/** Which kit a request names: a shipped one by primer id, an admin one by its row. */
export type StarterKitRef = { primerId: string } | { lorebookId: number }

/** A kit, found. */
export type ResolvedKit =
	| { source: "primer"; primer: PrimerDecl; name: string }
	| {
			source: "book"
			row: {
				id: number
				name: string
				userId: number
				primaryRuleset: string
				rulesetVersion: string | null
			}
			name: string
	  }

/** The sentences a kit request is answered with (ruling 7: what the person can do). */
export const STARTER_KIT_SENTENCES = Object.freeze({
	unknown:
		"That starter lorebook isn't on this pub. Choose one from the starter lorebooks listed.",
	adminOnly:
		"Starter lorebooks are made by the pub's admins. Start a lorebook from one instead.",
	saveOwnBook: "Choose one of your own lorebooks to save as a starter lorebook.",
	shippedKeep:
		"Starter lorebooks that come with the pub stay as they are. Clone one to make one you can edit.",
	share: "Starter lorebooks are open to everyone on this pub already. Share a lorebook made from it instead.",
	kitAndBook:
		"A session starts from one lorebook or one starter lorebook. Choose one of them."
})

/** Said when a starter lorebook is offered where a lorebook is read. */
export const kitIsNotReadSentence = (name: string): string =>
	`'${name}' is a starter lorebook. Start a session from it, or make a lorebook from it.`

/** The card id a kit is listed under: `primer:<primer id>` or `book:<lorebook id>`. */
export const kitCardId = (ref: StarterKitRef): string =>
	"primerId" in ref ? `primer:${ref.primerId}` : `book:${ref.lorebookId}`

/** A card id back to the kit it names, or null when it names none. */
export function kitRefOfCardId(id: unknown): StarterKitRef | null {
	if (typeof id !== "string") return null
	if (id.startsWith("primer:")) {
		const primerId = id.slice("primer:".length)
		return primerId ? { primerId } : null
	}
	if (id.startsWith("book:")) {
		const n = Number(id.slice("book:".length))
		return Number.isSafeInteger(n) && n > 0 ? { lorebookId: n } : null
	}
	return null
}

/** A request's `starterKit`, checked for shape (not for existence). */
export function kitRefOf(raw: unknown): StarterKitRef | null {
	if (raw == null || typeof raw !== "object") return null
	const r = raw as Record<string, unknown>
	if (typeof r.primerId === "string" && r.primerId)
		return { primerId: r.primerId }
	if (Number.isSafeInteger(r.lorebookId) && (r.lorebookId as number) > 0)
		return { lorebookId: r.lorebookId as number }
	return null
}

/** Nothing to copy: Freeform's Blank primer — New lorebook's Blank covers it. */
export const primerIsEmpty = (c: PrimerContent): boolean =>
	!c.entries.length &&
	!c.places.length &&
	!c.cast.length &&
	!c.relationships.length &&
	!c.leads.length &&
	!c.calendar &&
	!c.clock

/** The shipped kits: every registered primer that holds something. */
export const shippedKits = (): PrimerDecl[] =>
	primers().filter((p) => !primerIsEmpty(p.content))

const primerName = (p: PrimerDecl): string => i18nText(p.name) ?? p.id

/**
 * The kit a ref names, or refused in words. A row must be of book kind
 * `starter_kit` (a lorebook is not a kit); a primer must hold something.
 * Anyone signed in may start from any kit.
 */
export async function resolveKit(
	db: Db,
	ref: StarterKitRef | null
): Promise<ResolvedKit> {
	if (ref && "primerId" in ref) {
		const primer = getPrimer(ref.primerId)
		if (!primer || primerIsEmpty(primer.content))
			throw new Error(STARTER_KIT_SENTENCES.unknown)
		return { source: "primer", primer, name: primerName(primer) }
	}
	if (ref && "lorebookId" in ref) {
		const [row] = await db
			.select({
				id: schema.lorebooks.id,
				name: schema.lorebooks.name,
				userId: schema.lorebooks.userId,
				primaryRuleset: schema.lorebooks.primaryRuleset,
				rulesetVersion: schema.lorebooks.rulesetVersion
			})
			.from(schema.lorebooks)
			.where(
				and(
					eq(schema.lorebooks.id, ref.lorebookId),
					eq(schema.lorebooks.kind, STARTER_KIT_KIND),
					isNull(schema.lorebooks.sessionId)
				)
			)
			.limit(1)
		if (!row) throw new Error(STARTER_KIT_SENTENCES.unknown)
		return { source: "book", row, name: row.name }
	}
	throw new Error(STARTER_KIT_SENTENCES.unknown)
}

/** The kit's Rules, as a book or a session takes them. */
export function kitRules(kit: ResolvedKit): {
	primaryRuleset: string
	rulesetVersion: string | null
} {
	return kit.source === "primer"
		? { primaryRuleset: kit.primer.ruleset, rulesetVersion: null }
		: {
				primaryRuleset: kit.row.primaryRuleset,
				rulesetVersion: kit.row.rulesetVersion
			}
}

/**
 * Why `lorebookId` may not be read into a session because it is a starter
 * kit, or null when it is not one (or is missing — the caller's own
 * not-found answers that).
 */
export async function kitReadRefusal(
	db: Db,
	lorebookId: unknown
): Promise<string | null> {
	if (!Number.isSafeInteger(lorebookId)) return null
	const [row] = await db
		.select({ name: schema.lorebooks.name, kind: schema.lorebooks.kind })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId as number))
		.limit(1)
	return row?.kind === STARTER_KIT_KIND
		? kitIsNotReadSentence(row.name)
		: null
}

// ── The card list ───────────────────────────────────────────────────────────

/** What `starterKits:list` shows of one kit. */
export interface StarterKitCard {
	/** `primer:<id>` or `book:<lorebookId>` — what `starterKit` / `starterKits:clone` take. */
	id: string
	/** Where it comes from: core's catalogue, a plugin's, or a pub admin. */
	source: "core" | "plugin" | "admin"
	name: string
	description: string
	rulesId: string
	rulesName: string
	counts: { entries: number; places: number; cast: number }
	/** The admin who made it. Admin kits only. */
	ownerName?: string
	/** True when the asker made it (and so edits it in place). Admin kits only. */
	mine?: boolean
}

const rulesNameOf = (id: string): string => i18nText(getRuleset(id)?.name) ?? id

/** Every kit anyone may start from: the shipped ones, then the pub's admin kits by name. */
export async function starterKitCards(
	db: Db,
	userId: number
): Promise<StarterKitCard[]> {
	const shipped: StarterKitCard[] = shippedKits().map((p) => ({
		id: kitCardId({ primerId: p.id }),
		source: p.id.startsWith("core:") ? "core" : "plugin",
		name: primerName(p),
		description: i18nText(p.description) ?? "",
		rulesId: p.ruleset,
		rulesName: rulesNameOf(p.ruleset),
		counts: {
			entries: p.content.entries.length + p.content.leads.length,
			places: p.content.places.length,
			cast: p.content.cast.length
		}
	}))
	const rows = await db
		.select({
			id: schema.lorebooks.id,
			name: schema.lorebooks.name,
			description: schema.lorebooks.description,
			userId: schema.lorebooks.userId,
			primaryRuleset: schema.lorebooks.primaryRuleset,
			username: schema.users.username,
			displayName: schema.users.displayName
		})
		.from(schema.lorebooks)
		.innerJoin(schema.users, eq(schema.users.id, schema.lorebooks.userId))
		.where(
			and(
				eq(schema.lorebooks.kind, STARTER_KIT_KIND),
				isNull(schema.lorebooks.sessionId)
			)
		)
		.orderBy(schema.lorebooks.name, schema.lorebooks.id)
	const ids = rows.map((r) => r.id)
	const entryCounts = ids.length
		? await db
				.select({
					lorebookId: schema.lorebookEntries.lorebookId,
					places: sql<number>`count(*) filter (where ${schema.lorebookEntries.typeId} = ${LOCATION_TYPE_ID})::int`,
					entries: sql<number>`count(*) filter (where ${schema.lorebookEntries.typeId} <> ${LOCATION_TYPE_ID})::int`
				})
				.from(schema.lorebookEntries)
				.where(
					and(
						inArray(schema.lorebookEntries.lorebookId, ids),
						eq(schema.lorebookEntries.archived, false),
						isNull(schema.lorebookEntries.branchId)
					)
				)
				.groupBy(schema.lorebookEntries.lorebookId)
		: []
	const castCounts = ids.length
		? await db
				.select({
					lorebookId: schema.lorebookBindings.lorebookId,
					cast: sql<number>`count(*)::int`
				})
				.from(schema.lorebookBindings)
				.where(inArray(schema.lorebookBindings.lorebookId, ids))
				.groupBy(schema.lorebookBindings.lorebookId)
		: []
	const admin: StarterKitCard[] = rows.map((r) => {
		const e = entryCounts.find((c) => c.lorebookId === r.id)
		return {
			id: kitCardId({ lorebookId: r.id }),
			source: "admin",
			name: r.name,
			description: r.description,
			rulesId: r.primaryRuleset,
			rulesName: rulesNameOf(r.primaryRuleset),
			counts: {
				entries: Number(e?.entries ?? 0),
				places: Number(e?.places ?? 0),
				cast: Number(
					castCounts.find((c) => c.lorebookId === r.id)?.cast ?? 0
				)
			},
			ownerName: r.displayName || r.username,
			mine: r.userId === userId
		}
	})
	return [...shipped, ...admin]
}

// ── One kit, copied into a row ──────────────────────────────────────────────

/** What a copy leaves for after its transaction: the files and queues the module `db` writes. */
export interface KitCopy {
	lorebookId: number
	/** Cards made or copied for the asker, each with the avatar its copy still needs. */
	cards: {
		characterId: number
		name: string
		avatarFromMediaId: number | null
	}[]
	/** The kit row the copy came from, when its cover is to be re-stored for the copy. */
	coverFrom: number | null
}

/**
 * A new row from a kit, owned by `userId`, of book kind `kind` — a lorebook,
 * an admin kit (a clone), or a session's notes (`sessionId`). The kit's
 * Rules win over anything the caller had in mind. Runs on `tx` only.
 */
export async function bookFromKit(
	tx: Db,
	kit: ResolvedKit,
	opts: {
		userId: number
		name: string
		kind: BookKind
		sessionId?: number | null
	}
): Promise<KitCopy> {
	const rules = kitRules(kit)
	const own = {
		kind: opts.kind,
		sessionId: opts.sessionId ?? null,
		overlayOf: null,
		...rules
	}
	if (kit.source === "primer") {
		const [row] = await tx
			.insert(schema.lorebooks)
			.values({
				name: opts.name,
				description: i18nText(kit.primer.description) ?? "",
				userId: opts.userId,
				...own
			})
			.returning({ id: schema.lorebooks.id })
		const { characterIds } = await writePrimerInto(tx, {
			lorebookId: row.id,
			userId: opts.userId,
			primer: kit.primer
		})
		return {
			lorebookId: row.id,
			cards: characterIds.map((c) => ({ ...c, avatarFromMediaId: null })),
			coverFrom: null
		}
	}
	const { id } = await duplicateLorebookRows(
		tx,
		kit.row.id,
		opts.userId,
		opts.name
	)
	await tx
		.update(schema.lorebooks)
		.set(own)
		.where(eq(schema.lorebooks.id, id))
	const cards = await ownCastCards(tx, id, opts.userId)
	return { lorebookId: id, cards, coverFrom: kit.row.id }
}

/**
 * A copied book's cast, on cards the copy's owner owns: every card another
 * person owns is copied to `userId` (`characters:duplicate`'s column rule:
 * no folder, favourite, default-persona claim or card lorebook link) and the
 * copy's members, and its annotations' character keys, are pointed at the
 * copies. One copy per card, however many members bind it. Runs on `tx` only;
 * the avatars are `afterKitCopy`'s.
 */
export async function ownCastCards(
	tx: Db,
	lorebookId: number,
	userId: number
): Promise<KitCopy["cards"]> {
	const members = await tx
		.select({
			id: schema.lorebookBindings.id,
			characterId: schema.lorebookBindings.characterId
		})
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	const cardIds = [
		...new Set(
			members
				.map((m) => m.characterId)
				.filter((c): c is number => c != null)
		)
	]
	if (!cardIds.length) return []
	const foreign = await tx
		.select()
		.from(schema.characters)
		.where(
			and(
				inArray(schema.characters.id, cardIds),
				sql`${schema.characters.userId} <> ${userId}`
			)
		)
	const out: KitCopy["cards"] = []
	for (const original of foreign) {
		const {
			id: oldId,
			uuid: _uuid,
			userId: _userId,
			folderId: _folderId,
			isFavorite: _isFavorite,
			isDefaultPersona: _isDefaultPersona,
			avatarMediaId,
			createdAt: _createdAt,
			updatedAt: _updatedAt,
			embedding: _embedding,
			embeddingModel: _embeddingModel,
			embeddingSourceHash: _embeddingSourceHash,
			embedTextHash: _embedTextHash,
			vectorizedAt: _vectorizedAt,
			lorebookId: _lorebookId,
			...card
		} = original as typeof original & Record<string, any>
		const [copy] = await tx
			.insert(schema.characters)
			.values({ ...(card as any), userId, lorebookId: null })
			.returning({
				id: schema.characters.id,
				name: schema.characters.name
			})
		await tx
			.update(schema.lorebookBindings)
			.set({ characterId: copy.id })
			.where(
				and(
					eq(schema.lorebookBindings.lorebookId, lorebookId),
					eq(schema.lorebookBindings.characterId, oldId)
				)
			)
		// The copy's annotations name its card by id; the copied card is the one they mean now.
		const entryIds = tx
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
		await tx
			.update(schema.entryAnnotations)
			.set({ characterId: copy.id })
			.where(
				and(
					inArray(schema.entryAnnotations.entryId, entryIds),
					eq(schema.entryAnnotations.characterId, oldId)
				)
			)
		await tx
			.update(schema.entryAnnotations)
			.set({ entityKey: `character:${copy.id}` })
			.where(
				and(
					inArray(schema.entryAnnotations.entryId, entryIds),
					eq(schema.entryAnnotations.entityKey, `character:${oldId}`)
				)
			)
		out.push({
			characterId: copy.id,
			name: copy.name,
			avatarFromMediaId: avatarMediaId ?? null
		})
	}
	return out
}

/**
 * What a kit copy does once its transaction has committed: each copied card
 * gets its own avatar file, the copy its own cover, and the copy and its new
 * cards go to the vectorizer. Best-effort, like `characters:duplicate`: the
 * book stands without a face or a cover. Uses the module `db`.
 */
export async function afterKitCopy(
	copy: KitCopy,
	userId: number,
	ownerName: string
): Promise<void> {
	const { db } = await import("$lib/server/db")
	const { readMedia } = await import("$lib/server/media")
	const { MediaVariant } = await import(
		"$lib/shared/constants/MediaVisibility"
	)
	const { handleCharacterAvatarUpload } = await import("$lib/server/utils")
	for (const card of copy.cards) {
		if (!card.avatarFromMediaId) continue
		try {
			const avatar = await readMedia(
				db as unknown as Db,
				card.avatarFromMediaId,
				MediaVariant.ORIGINAL
			)
			if (avatar)
				await handleCharacterAvatarUpload({
					character: { id: card.characterId, userId },
					avatarFile: Buffer.from(avatar.bytes)
				})
		} catch (error) {
			console.error("A starter lorebook's card kept no face:", error)
		}
	}
	if (copy.coverFrom != null) {
		const { ownCopiedCover } = await import("$lib/server/sockets/lorebooks")
		await ownCopiedCover(copy.lorebookId, userId)
	}
	try {
		const { autoEnqueueLorebook, autoEnqueueCharacter } = await import(
			"$lib/server/embedding/vectorizationQueue"
		)
		const [book] = await db
			.select({ name: schema.lorebooks.name })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, copy.lorebookId))
		if (book)
			await autoEnqueueLorebook(copy.lorebookId, book.name, ownerName)
		for (const card of copy.cards)
			await autoEnqueueCharacter(card.characterId, card.name)
	} catch (error) {
		console.error("A starter lorebook's copy was not queued for search:", error)
	}
}

// ── A primer's world, written ───────────────────────────────────────────────

/** `core:entry/world-lore@1` → the stored, unversioned `core:entry/world-lore`. */
const storedTypeId = (typeId: string): string => typeId.replace(/@\d+$/, "")

/** The category a primer's lead is filed under (world lore: free text). */
export const LEAD_CATEGORY = "lead"
/** How a lead reads toward what it involves (a lore link, one way). */
export const LEAD_LINK_TYPE = "involves"
/** How a place's way out reads (a lore link, one way). */
export const EXIT_LINK_TYPE = "leads to"

/** The first registered slot that holds `address`'s pieces for an owner of `facet`. */
function slotHolding(
	address: string,
	facet: "cast" | "location"
): string | undefined {
	return attributeSlots().find(
		(s) =>
			s.type === "list" &&
			(s.config as Record<string, unknown> | undefined)?.repertoire ===
				address &&
			(s.appliesTo as readonly string[]).includes(facet)
	)?.id
}

/**
 * 🚧 Write a primer's world into `lorebookId`, as rows of the book's own:
 *
 * - **entries** (`content.entries`, any core or derived entry type) and
 *   **leads** (world lore, category `lead`, joined one way — *involves* — to
 *   what they involve);
 * - **places** (`core:entry/location`), each way out a lore link
 *   (*leads to*, the exit's name and description) and, where a registered
 *   slot holds the ruleset's exits repertoire for places, an exit piece on
 *   the place (`towards: location:<id>`, as the Dungeon Crawler writes them);
 * - **cast**: a character card for `userId` and a cast member binding it
 *   (`deriveNextBindingToken`), its sheet's stats and its pieces (into the
 *   slot that holds each repertoire) and where it is found
 *   (`core:slot/location@1`) as the book's stats, on main;
 * - **relationships**: a cast tie is two perspective rows (the reverse label
 *   the far end's); a tie with an entry or place is one row, reverse kept;
 * - the **calendar** and main's **clock**.
 *
 * The book's Rules are set to the primer's. The compendium is never copied.
 * A primer is checked against its ruleset when it is declared
 * (`primerFindings`), so this trusts its shape. Runs on `tx` only.
 */
export async function writePrimerInto(
	tx: Db,
	input: { lorebookId: number; userId: number; primer: PrimerDecl }
): Promise<{ characterIds: { characterId: number; name: string }[] }> {
	const { lorebookId, userId, primer } = input
	const c = primer.content
	await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
	await tx
		.update(schema.lorebooks)
		.set({
			primaryRuleset: primer.ruleset,
			rulesetVersion: null,
			...(c.calendar ? { storyCalendar: c.calendar } : {}),
			...(c.clock ? clockColumns(c.clock as never) : {})
		})
		.where(eq(schema.lorebooks.id, lorebookId))

	/** Primer key → what it became: an entry id, or a cast member's binding id. */
	const entryOf = new Map<string, number>()
	const memberOf = new Map<string, number>()

	const insertEntry = async (row: {
		typeId: string
		title: string
		content: string
		keys?: readonly string[]
		fields?: Readonly<Record<string, unknown>>
	}): Promise<number> => {
		const typeId = storedTypeId(row.typeId)
		if (!entryDeclaration(typeId))
			throw new Error(
				`This starter lorebook needs the entry type '${typeId}', which this pub doesn't have installed.`
			)
		const [made] = await tx
			.insert(schema.lorebookEntries)
			.values(
				entryInsert({
					...(row.fields ?? {}),
					lorebookId,
					typeId,
					name: row.title,
					content: row.content,
					keys: [...(row.keys ?? [])],
					position: await nextPosition(tx, lorebookId, typeId)
				} as never)
			)
			.returning({ id: schema.lorebookEntries.id })
		return made.id
	}

	for (const e of c.entries)
		entryOf.set(
			e.key,
			await insertEntry({
				typeId: e.type,
				title: e.title,
				content: e.content,
				keys: e.keys,
				fields: e.fields
			})
		)
	for (const p of c.places)
		entryOf.set(
			p.key,
			await insertEntry({
				typeId: LOCATION_TYPE_ID,
				title: p.title,
				content: p.content,
				keys: p.keys,
				fields: p.fields
			})
		)
	for (const l of c.leads)
		entryOf.set(
			l.key,
			await insertEntry({
				typeId: WORLD_LORE_TYPE_ID,
				title: l.title,
				content: l.content,
				keys: [l.title],
				fields: { category: LEAD_CATEGORY }
			})
		)

	const values: (typeof schema.attributeValues.$inferInsert)[] = []
	const stat = (
		ownerKind: "cast_member" | "location",
		ownerId: number,
		slotId: string,
		v: unknown
	) =>
		values.push({
			ownerKind,
			ownerId,
			slotId,
			value: { v },
			updatedBy: "user"
		})

	// Ways out: a lore link each, and the exit piece where a slot holds them.
	const ruleset = getRuleset(primer.ruleset)
	const exitsRep = ruleset?.repertoires.find(
		(r) => r.relational && r.appliesTo?.includes("location")
	)
	const exitsSlot = exitsRep
		? slotHolding(
				repertoireAddress(primer.ruleset, exitsRep.id),
				"location"
			)
		: undefined
	for (const p of c.places) {
		const from = entryOf.get(p.key)!
		const pieces: unknown[] = []
		for (const x of p.exits ?? []) {
			const to = entryOf.get(x.towards)
			if (to == null || to === from) continue
			const { towards: _towards, ...props } = x
			await tx
				.insert(schema.narrativeRelationships)
				.values({
					lorebookId,
					fromEntryId: from,
					toEntryId: to,
					relationshipType: EXIT_LINK_TYPE,
					title: String(props.name ?? ""),
					description: String(props.description ?? "")
				})
				.onConflictDoNothing()
			pieces.push({ kind: "inline", ...props, towards: `location:${to}` })
		}
		if (exitsSlot && pieces.length)
			stat("location", from, exitsSlot, pieces)
	}

	// The cast: a card each, bound into the book, with its sheet and pieces.
	const made: { characterId: number; name: string }[] = []
	for (const m of c.cast) {
		const [card] = await tx
			.insert(schema.characters)
			.values({ userId, name: m.name, description: m.description })
			.returning({
				id: schema.characters.id,
				name: schema.characters.name
			})
		made.push({ characterId: card.id, name: card.name })
		const [member] = await tx
			.insert(schema.lorebookBindings)
			.values({
				lorebookId,
				characterId: card.id,
				binding: await deriveNextBindingToken(lorebookId, tx),
				name: m.name
			})
			.returning({ id: schema.lorebookBindings.id })
		memberOf.set(m.key, member.id)
		for (const [slotId, v] of Object.entries(m.sheet ?? {}))
			if (getAttributeSlot(slotId))
				stat("cast_member", member.id, slotId, v)
		for (const [repId, held] of Object.entries(m.pieces ?? {})) {
			const slotId = slotHolding(
				repertoireAddress(primer.ruleset, repId),
				"cast"
			)
			if (slotId && held.length)
				stat("cast_member", member.id, slotId, [...held])
		}
		const at = m.at ? entryOf.get(m.at) : undefined
		if (at != null)
			stat("cast_member", member.id, locationSlot.id, { entryId: at })
	}
	if (values.length) await tx.insert(schema.attributeValues).values(values)

	// Ties. An end is a cast member (`node`) or an entry.
	const endOf = (
		key: string
	): { node: number } | { entry: number } | null => {
		const node = memberOf.get(key)
		if (node != null) return { node }
		const entry = entryOf.get(key)
		return entry != null ? { entry } : null
	}
	const ends = (
		prefix: "from" | "to",
		end: { node: number } | { entry: number }
	) =>
		"node" in end
			? { [`${prefix}NodeId`]: end.node, [`${prefix}EntryId`]: null }
			: { [`${prefix}NodeId`]: null, [`${prefix}EntryId`]: end.entry }
	for (const r of c.relationships) {
		const from = endOf(r.from)
		const to = endOf(r.to)
		if (!from || !to) continue
		const description = r.description ?? ""
		if ("node" in from && "node" in to) {
			// A cast tie's other side is its own perspective row.
			await tx
				.insert(schema.narrativeRelationships)
				.values([
					{
						lorebookId,
						...ends("from", from),
						...ends("to", to),
						relationshipType: r.label,
						description
					} as never,
					{
						lorebookId,
						...ends("from", to),
						...ends("to", from),
						relationshipType: r.reverseLabel ?? r.label,
						description
					} as never
				])
		} else
			await tx
				.insert(schema.narrativeRelationships)
				.values({
					lorebookId,
					...ends("from", from),
					...ends("to", to),
					relationshipType: r.label,
					reverseRelationshipType: r.reverseLabel ?? null,
					description
				} as never)
				.onConflictDoNothing()
	}
	for (const l of c.leads) {
		const lead = entryOf.get(l.key)!
		for (const ref of l.involves ?? []) {
			const to = endOf(ref)
			if (!to || ("entry" in to && to.entry === lead)) continue
			await tx
				.insert(schema.narrativeRelationships)
				.values({
					lorebookId,
					fromEntryId: lead,
					fromNodeId: null,
					...ends("to", to),
					relationshipType: LEAD_LINK_TYPE
				} as never)
				.onConflictDoNothing()
		}
	}
	return { characterIds: made }
}
