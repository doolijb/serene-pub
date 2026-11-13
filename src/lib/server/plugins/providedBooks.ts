/**
 * 🚧 (M2c) **Provided books**: the lorebooks a plugin ships
 * (`provides.lorebooks`), imported by core's own importer.
 *
 * Nothing here runs in the sandbox, and nothing is a new kind of book. A
 * provided book is an ordinary lorebook owned by the admin who enabled the
 * plugin, read from a file the package carries under its `assets.dir`, written
 * by the same function `lorebooks:import` runs (`importLorebookDocument`).
 * What makes it *provided* is a mark in two JSON columns that exist already
 * (`providedMarks.ts`); no table or column was added.
 *
 * ## When
 * `syncProvidedBooks` runs whenever the live manager is synced for a plugin
 * (`sockets/plugins.ts syncManager`: enable, approve, allow) and at boot for
 * every enabled plugin. It only acts for an ENABLED plugin whose
 * `applet:lorebooks:write` is in force (declared, reviewed, not denied), and
 * only for a package that declares the book. Idempotent.
 *
 * ## Key and verbs
 * The key is (plugin, slug, version, the file's sha256); the slug is the file's
 * basename without `.lorebook.json` / `.json`.
 *  · no book carries the mark → import it, as the admin who enabled the plugin;
 *  · same version and same file → nothing; same version and a changed file →
 *    the same diff a newer version takes (a reinstall that changes the shipped
 *    book without a version bump still brings it in, and says so);
 *  · a newer version → a diff under the BOOK's write mode (`bookLoreWriteMode`):
 *    - `full`: an entry the person has not touched (its row hash is the one
 *      recorded) and that changed upstream is rewritten; an entry new upstream
 *      is added; an entry the person edited is KEPT (the person wins); an entry
 *      gone upstream is left alone;
 *    - the same rule carries the book's **cast members** (a binding and its
 *      card), by the file's stable key for each, and its **stat values**
 *      (template layer, undated, on the book, a cast member or a place): the
 *      mark keeps what each row held when written and the file's item that was
 *      written, so a row the person changed keeps theirs, an untouched one
 *      that changed upstream is rewritten, a new one is added, and one gone
 *      upstream (or deleted by the person) is left alone. A book imported
 *      before this was carried has no baselines: what matches the file is
 *      recorded, what differs is kept as the person's, what is missing is added;
 *    - the book's **rules** (its two ruleset columns) are carried the same way
 *      when the file names them: rules a person changed since the last write
 *      are kept, untouched ones follow the file, a file naming none changes none;
 *    - `review` / `off`: nothing is written. There is no session-less
 *      proposal path for lore entries to hand a diff to, so the newer version
 *      (or the changed file) is only recorded as *held* (the plugin page says so).
 *
 * ## Disabled, never deleted (M2e)
 * A provided book can't be deleted (`lorebooks:delete` refuses it); an
 * administrator disables it. The mark is `extra_json.provided.disabled` on the
 * book itself (`isDisabledProvidedBook` / `shownLorebook` decide "hidden").
 * Upgrades still land while disabled. A slug disabled before it had a row
 * waits in `plugins.provided.disabled[slug]` and lands disabled at its fresh
 * import (the same function drops the entry).
 */
import { createHash } from "node:crypto"
import { readFile, realpath, stat } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import { profileOf } from "$lib/shared/characters/profile"
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	ensureCardVersion,
	insertCastMember,
	memberProfileOf,
	reparentFromBookPresent,
	resolveFollows,
	writeCastVersion,
	type CastVersionChanges
} from "$lib/server/characters/versions"
import { memberColumnsOfVersion } from "$lib/server/lorebooks/retold"
import { actingPersonFor } from "$lib/server/auth/actingPerson"
import { disabledProvidedBooks, providedOutcomes } from "./providedMarks"
import { ensurePackageEntryTypes } from "./packageEntryTypes"
import { isDeclaredEntryType } from "$lib/server/entries/declarations"
import { isDerivedEntryTypeId } from "$lib/shared/entries/types"
import { getAppDataDir } from "$lib/server/utils/appDataDir"
import { hashCanonicalJson } from "$lib/server/utils/contentHash"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import {
	entryTypeIdOf,
	importedKeyColumns,
	importedStatRows,
	mapImportedEntry,
	normalizeNativeWorldInfoEntry,
	type ImportedStatRow
} from "$lib/server/utils/lorebookImportMapper"
import { getAttributeSlot, resolveSlotConfig } from "@serene-pub/sdk"
import { ownNameValue } from "$lib/shared/lorebooks/memberIdentity"
import { bookLoreWriteMode } from "$lib/server/state/loreWriteMode"
import { BOOK_DEFAULT_RULES } from "$lib/shared/rulesets/rulesOffer"
import { purgeLorebook } from "$lib/server/lorebooks/tableRegistry"
import { makeMemberCardless } from "$lib/server/cast/cardless"
import { fillSeatsBeforeCardDelete } from "$lib/server/sessions/seats"
import { pluginPackageDirOf } from "./packageDir"
import { safeAssetsDir } from "./packageHost"
import {
	appletGrant,
	declaredPermissions,
	effectivePermissions
} from "./permissions"
import {
	compareVersions,
	markedBook,
	markedCharacter,
	providedSlugOf,
	type ProvidedBookMark,
	type ProvidedCastMark,
	type ProvidedEntryMark,
	type ProvidedStatMark
} from "./providedMarks"

/** The most a provided file is read at (the importer's own ceiling). */
const MAX_BYTES = 32 * 1024 * 1024

type PluginRow = typeof schema.plugins.$inferSelect

// ── declaration ─────────────────────────────────────────────────────────

/** The package-relative paths a manifest declares under `provides.lorebooks` that sit under its assets folder. */
export function providedPathsOf(manifest: unknown): string[] {
	const dir = safeAssetsDir(manifest)
	const raw = (manifest as { provides?: { lorebooks?: unknown } } | null)?.provides?.lorebooks
	if (!dir || !Array.isArray(raw)) return []
	return [
		...new Set(
			raw.filter(
				(p): p is string =>
					typeof p === "string" &&
					p.startsWith(`${dir.replace(/\/+$/, "")}/`) &&
					!p.includes("\\") &&
					!p.split("/").some((x) => !x || x === "." || x === "..")
			)
		)
	]
}

/** Whether `applet:lorebooks:write` is in force for this row (declared, reviewed, not denied). */
export function lorebookWriteInForce(row: Pick<PluginRow, "manifest" | "adminDenied">): boolean {
	const eff = effectivePermissions(
		declaredPermissions(row.manifest as any),
		row.adminDenied as string[] | null
	)
	return appletGrant(eff).lorebooks === "write"
}

/** A provided file's text from the installed package folder, jailed under the assets folder. */
async function readProvidedFile(
	row: PluginRow,
	rel: string
): Promise<string | null> {
	const dir = safeAssetsDir(row.manifest)
	if (!dir) return null
	try {
		const root = join(getAppDataDir(), pluginPackageDirOf(row.pluginId, row.version))
		const folder = join(root, dir)
		const full = resolve(root, rel)
		if (!full.startsWith(folder + sep)) return null
		const realFolder = await realpath(folder)
		const real = await realpath(full)
		if (!real.startsWith(realFolder + sep)) return null
		const info = await stat(real)
		if (!info.isFile() || info.size > MAX_BYTES) return null
		return await readFile(real, "utf8")
	} catch {
		return null
	}
}

// ── entries: identity and hashes ────────────────────────────────────────

/** The row columns a person's edit can change and an upgrade can rewrite. */
export const CONTENT_COLUMNS = [
	"title",
	"fields",
	"keys",
	"secondaryKeys",
	"selectiveLogic",
	"matchMode",
	"useRegex",
	"caseSensitive",
	"recursionDepth",
	"content",
	"constant",
	"enabled",
	"archived"
] as const

type EntryRow = typeof schema.lorebookEntries.$inferSelect

/** The hash of what a row holds of its content: changes when a person edits it. */
export function rowHashOf(row: Record<string, unknown>): string {
	const picked: Record<string, unknown> = {}
	for (const c of CONTENT_COLUMNS) picked[c] = row[c] ?? null
	return hashCanonicalJson(picked)
}

interface FileEntry {
	key: string
	typeId: string
	entry: any
	/** The ordinal among the file's entries of this type, as the importer's `position`. */
	ordinal: number
	up: string
}

/**
 * The file's entries with a stable key each: its `id` when the author's export
 * states one, else its title, else its first key, else its place — suffixed
 * when two share one. The ordinal is what the importer counted as `position`.
 */
function fileEntriesOf(entries: unknown[]): FileEntry[] {
	const counts = new Map<string, number>()
	const taken = new Map<string, number>()
	const out: FileEntry[] = []
	entries.forEach((entry: any, i) => {
		if (!entry || typeof entry !== "object") return
		const typeId = entryTypeIdOf(entry)
		const ordinal = counts.get(typeId) ?? 0
		counts.set(typeId, ordinal + 1)
		const meta = entry.extensions?.serenepub ?? {}
		const title = [entry.name, entry.comment].find(
			(v): v is string => typeof v === "string" && v.trim().length > 0
		)
		const first = Array.isArray(entry.keys) ? entry.keys[0] : Array.isArray(entry.key) ? entry.key[0] : undefined
		const identity =
			typeof meta.uuid === "string"
				? `u:${meta.uuid}`
				: Number.isInteger(entry.id)
					? `i:${entry.id}`
					: title
						? `t:${title.trim()}`
						: typeof first === "string"
							? `k:${first}`
							: `n:${i}`
		const base = `${typeId}|${identity}`
		const seen = taken.get(base) ?? 0
		taken.set(base, seen + 1)
		out.push({
			key: seen ? `${base}#${seen}` : base,
			typeId,
			entry,
			ordinal,
			up: hashCanonicalJson(entry)
		})
	})
	return out
}

/** The values a file entry becomes as a row (the importer's mapping), without the book-level columns. */
function valuesOf(fe: FileEntry, lorebookId: number, position: number) {
	const normalized = normalizeNativeWorldInfoEntry(fe.entry)
	const mapped = mapImportedEntry(normalized, fe.typeId as any, position)
	return {
		...entryInsert({
			...(mapped as any),
			typeId: fe.typeId,
			lorebookId,
			lorebookBindingId: null
		}),
		...importedKeyColumns(normalized),
		...(mapped.provenance ? { provenance: mapped.provenance } : {})
	}
}

// ── cast members and stat values: identity and hashes ───────────────────

type BindingRow = typeof schema.lorebookBindings.$inferSelect
type StatRow = typeof schema.attributeValues.$inferSelect

/** One cast member of the file: a binding of `extensions.serenepub.bindings` and the card it names. */
interface FileCastMember {
	/** Stable key: `u:<card uuid>`, else `n:<card name>`, else `t:<binding text>`; `#1`, `#2` … when two share one. */
	key: string
	/** The key without its `#n` suffix. */
	base: string
	/** The card's own uuid and name (null for a binding with no card). */
	uuid: string | null
	name: string | null
	/** The file's binding `localId`s that land on this one row: its own, then any later binding of the same card (the importer folds those into it). */
	localIds: number[]
	bindingText: string
	/** The embedded card's `data` (its `character_book` too), or null. */
	cardData: any | null
	spriteSet: string | null
	ownName: string | null
	ownNickname: string | null
	/** The file's sha256 of this member: the card without its book, and the binding's three columns. */
	up: string
}

/**
 * The sha256 of a cast member as it is held: the card without its book (as
 * `matchEmbeddedCharacter` compares it) and the binding's three columns.
 * One function for the file's side and the row's, so equal means equal.
 */
function castHashOf(
	card: unknown,
	spriteSet: string | null,
	ownName: string | null,
	ownNickname: string | null
): string {
	return hashCanonicalJson({ card, spriteSet, ownName, ownNickname })
}

/**
 * The file's cast members, each with a stable key and its sha256. The three
 * binding columns are read exactly as the importer reads them
 * (`restoreBoundEntities`). A persona-bound binding is out of scope: it is
 * not a member here, only counted (`personas`), and `ownOrder` keeps its place
 * (null) so the importer's own order can be walked.
 */
async function fileCastOf(serenepub: unknown): Promise<{
	members: FileCastMember[]
	ownOrder: Array<FileCastMember | null>
	personas: number
}> {
	const sp = (serenepub ?? {}) as Record<string, any>
	const { extractCharacterUuid } = await import("$lib/server/sockets/characters")
	const { LOREBOOK_IMPORT_LIMITS } = await import("$lib/server/sockets/lorebooks")
	const max = LOREBOOK_IMPORT_LIMITS.maxNameChars
	const cards = new Map<unknown, any>()
	for (const e of Array.isArray(sp.characters) ? sp.characters : [])
		if (e?.card?.data) cards.set(e.localId, e.card.data)
	const ownText = (v: unknown) => {
		const t = ownNameValue(v)
		return t != null && t.length <= max ? t : null
	}
	const members: FileCastMember[] = []
	const ownOrder: Array<FileCastMember | null> = []
	const byCard = new Map<unknown, FileCastMember>()
	const personaSeen = new Set<unknown>()
	const taken = new Map<string, number>()
	let personas = 0
	for (const b of Array.isArray(sp.bindings) ? sp.bindings : []) {
		if (!b || typeof b !== "object") continue
		const cardData = b.characterLocalId != null ? (cards.get(b.characterLocalId) ?? null) : null
		if (!cardData && b.personaLocalId != null) {
			if (!personaSeen.has(b.personaLocalId)) {
				personaSeen.add(b.personaLocalId)
				personas++
				ownOrder.push(null)
			}
			continue
		}
		const folded = cardData ? byCard.get(b.characterLocalId) : undefined
		if (folded) {
			if (typeof b.localId === "number") folded.localIds.push(b.localId)
			continue
		}
		const spriteSet =
			typeof b.spriteSet === "string" && b.spriteSet.trim() && b.spriteSet.length <= max
				? b.spriteSet
				: null
		const ownName = cardData ? ownText(b.ownName) || null : null
		const ownNickname = cardData ? ownText(b.ownNickname) : null
		const uuid = cardData ? (extractCharacterUuid(cardData) ?? null) : null
		const name = cardData ? String(cardData.name || "Unnamed Character").trim() : null
		const bindingText = typeof b.bindingText === "string" ? b.bindingText : ""
		const base = uuid ? `u:${uuid}` : name !== null ? `n:${name}` : `t:${bindingText.trim()}`
		const seen = taken.get(base) ?? 0
		taken.set(base, seen + 1)
		const { character_book: _book, ...cardWithoutBook } = cardData ?? {}
		const member: FileCastMember = {
			key: seen ? `${base}#${seen}` : base,
			base,
			uuid,
			name,
			localIds: typeof b.localId === "number" ? [b.localId] : [],
			bindingText,
			cardData,
			spriteSet,
			ownName,
			ownNickname,
			up: castHashOf(cardData ? cardWithoutBook : null, spriteSet, ownName, ownNickname)
		}
		members.push(member)
		ownOrder.push(member)
		if (cardData) byCard.set(b.characterLocalId, member)
	}
	return { members, ownOrder, personas }
}

/** A binding of the book and the card it carries (null for none). */
interface LiveMember {
	binding: BindingRow
	character: { id: number; uuid: string; name: string; extensions: unknown } | null
}

/** The book's bindings with their cards, in the order they landed (by id). */
async function liveCastOf(db: Db, lorebookId: number): Promise<LiveMember[]> {
	const rows = await db
		.select({
			binding: schema.lorebookBindings,
			characterId: schema.characters.id,
			uuid: schema.characters.uuid,
			name: schema.characters.name,
			extensions: schema.characters.extensions
		})
		.from(schema.lorebookBindings)
		.leftJoin(schema.characters, eq(schema.characters.id, schema.lorebookBindings.characterId))
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
		.orderBy(asc(schema.lorebookBindings.id))
	return rows.map((r) => ({
		binding: r.binding,
		character:
			r.characterId == null
				? null
				: { id: r.characterId, uuid: r.uuid!, name: r.name!, extensions: r.extensions }
	}))
}

/**
 * What a cast member holds now of the three things the file's hash names beside
 * the card, read from the member's **base** version (the binding's columns are
 * frozen), mapped back to the file's meaning: the sprite set as held, the own
 * name when the base does not follow the card's name (else null), the own
 * nickname likewise (`""` is an own empty nickname). A member with no base yet
 * (a lift straggler) is read from its binding columns.
 */
async function ownOfMember(
	db: Db,
	binding: BindingRow
): Promise<{
	carded: boolean
	spriteSet: string | null
	ownName: string | null
	ownNickname: string | null
}> {
	const V = schema.characterVersions
	const [base] = await db
		.select()
		.from(V)
		.where(
			and(
				eq(V.castMemberId, binding.id),
				isNull(V.cardId),
				isNull(V.branchId),
				isNull(V.year),
				isNull(V.personalPosition),
				isNull(V.sourceSessionId)
			)
		)
		.orderBy(asc(V.id))
		.limit(1)
	if (!base)
		return {
			carded: binding.characterId != null,
			spriteSet: binding.spriteSet,
			ownName: binding.ownName,
			ownNickname: binding.ownNickname
		}
	const carded = base.parentVersionId != null
	const held = memberColumnsOfVersion(base, { carded })
	return {
		carded,
		spriteSet: held.spriteSet,
		ownName: held.ownName,
		ownNickname: held.ownNickname
	}
}

/** The sha256 of what a binding and its card hold now (the same function as the file's side). */
async function castHashNow(db: Db, binding: BindingRow): Promise<string> {
	const { buildExistingCharacterComparisonData } = await import("$lib/server/sockets/characters")
	const cmp =
		binding.characterId != null
			? await buildExistingCharacterComparisonData(binding.characterId, db)
			: null
	// The file's `character_version` is a card file's own text. A card version's label is its
	// name (and is "1.0" when the file said nothing), so it is not read here: the hash keeps
	// the value the card was written with, the one every recorded hash was made from.
	let card: unknown = null
	if (cmp && binding.characterId != null) {
		const [written] = await db
			.select({ characterVersion: schema.characters.characterVersion })
			.from(schema.characters)
			.where(eq(schema.characters.id, binding.characterId))
		card = { ...cmp.comparisonData, character_version: written?.characterVersion || "" }
	}
	const own = await ownOfMember(db, binding)
	return castHashOf(card, own.spriteSet, own.ownName, own.ownNickname)
}

/**
 * The book's existing binding for a file member, found by its key (a book
 * imported before cast was carried has no record of which): a card with the
 * file's uuid, or a card of this plugin's for this book with the file's name;
 * a member with no card by its binding text. Never one already taken.
 */
function findLiveMember(
	member: FileCastMember,
	live: readonly LiveMember[],
	taken: ReadonlySet<number>,
	pluginId: string,
	slug: string
): LiveMember | null {
	for (const m of live) {
		if (taken.has(m.binding.id)) continue
		const c = m.character
		if (!member.cardData) {
			if (!c && m.binding.binding === member.bindingText.trim()) return m
			continue
		}
		if (!c) continue
		if (member.uuid && c.uuid === member.uuid) return m
		const ours = markedCharacter(c.extensions, c.uuid)
		if (ours?.plugin === pluginId && ours.slug === slug && c.name.trim() === member.name) return m
	}
	return null
}

/** The entry types one reference on its own may name in a slot (the importer's `singleRefEntryTypesOf`, copied). */
function singleRefEntryTypesOf(slotId: string): readonly string[] | null | undefined {
	const decl = getAttributeSlot(slotId)
	if (!decl) return undefined
	return decl.type !== "list" ? (resolveSlotConfig(decl).entryTypes ?? null) : null
}

/** One stat value of the file, as a row of this book, with its key and sha256. */
interface FileStat {
	/** `<owner kind>|<owner key>|<slot id>`: owner key `book`, the cast member's key, or the place's entry key. */
	key: string
	row: ImportedStatRow
	up: string
}

/** The sha256 of a stat value as it is held: its value and note. */
const statHashOf = (row: { value?: unknown; note?: string | null }): string =>
	hashCanonicalJson({ value: row.value, note: row.note ?? null })

/**
 * The file's undated stat values as rows of this book, the importer's own
 * mapping (`importedStatRows`) over the owners that exist now. A dated value
 * (a history entry or a scene named) is left out: empty maps would land it
 * undated. Stat configs are not read.
 */
function fileStatsOf(
	serenepub: unknown,
	maps: {
		lorebookId: number
		bindingLocalIdToRealId: Map<number, number>
		entryLocalIdToRealId: Map<number, number>
		entryTypeIdByRealId: Map<number, string>
		castKeyByBindingId: ReadonlyMap<number, string>
		entryKeyById: ReadonlyMap<number, string>
	}
): FileStat[] {
	const sp = serenepub as Record<string, any> | null | undefined
	const stats = sp?.stats
	if (!stats || typeof stats !== "object" || !Array.isArray(stats.values)) return []
	const undated = {
		...sp,
		stats: {
			values: stats.values.filter(
				(v: any) =>
					!v ||
					typeof v !== "object" ||
					(typeof v.historyEntryLocalId !== "number" && typeof v.sceneLocalId !== "number")
			)
		}
	}
	const { values } = importedStatRows(undated, {
		lorebookId: maps.lorebookId,
		bindingLocalIdToRealId: maps.bindingLocalIdToRealId,
		entryLocalIdToRealId: maps.entryLocalIdToRealId,
		historyEntryLocalIdToRealId: new Map(),
		sceneLocalIdToRealId: new Map(),
		entryTypeIdByRealId: maps.entryTypeIdByRealId,
		singleRefEntryTypes: singleRefEntryTypesOf
	})
	const out = new Map<string, FileStat>()
	for (const row of values) {
		const owner =
			row.ownerKind === "lorebook"
				? "book"
				: row.ownerKind === "cast_member"
					? maps.castKeyByBindingId.get(row.ownerId)
					: maps.entryKeyById.get(row.ownerId)
		if (owner === undefined) continue
		const key = `${row.ownerKind}|${owner}|${row.slotId}`
		if (!out.has(key)) out.set(key, { key, row, up: statHashOf(row) })
	}
	return [...out.values()]
}

/** The template-layer (main, undated) rows now held for the owners the given stat values name, by owner and slot. */
async function liveStatsOf(
	db: Db,
	stats: readonly FileStat[]
): Promise<Map<string, StatRow>> {
	const byKind = new Map<string, Set<number>>()
	for (const s of stats) {
		const ids = byKind.get(s.row.ownerKind) ?? new Set<number>()
		ids.add(s.row.ownerId)
		byKind.set(s.row.ownerKind, ids)
	}
	const out = new Map<string, StatRow>()
	if (!byKind.size) return out
	const rows = await db
		.select()
		.from(schema.attributeValues)
		.where(
			and(
				isNull(schema.attributeValues.sessionId),
				isNull(schema.attributeValues.branchId),
				isNull(schema.attributeValues.historyEntryId),
				isNull(schema.attributeValues.sceneId),
				isNull(schema.attributeValues.validFromMessageId),
				or(
					...[...byKind].map(([kind, ids]) =>
						and(
							eq(schema.attributeValues.ownerKind, kind),
							inArray(schema.attributeValues.ownerId, [...ids])
						)
					)
				)
			)
		)
		.orderBy(asc(schema.attributeValues.id))
	for (const r of rows) {
		const key = `${r.ownerKind}|${r.ownerId}|${r.slotId}`
		if (!out.has(key)) out.set(key, r)
	}
	return out
}

/** What the file's entries point at, in this book now: the importer's `entryLocalId` space, the types, and each row's key. */
async function entryRefsOf(
	db: Db,
	lorebookId: number,
	fileEntries: readonly FileEntry[],
	marks: Record<string, ProvidedEntryMark>
) {
	const rows = await db
		.select({ id: schema.lorebookEntries.id, typeId: schema.lorebookEntries.typeId })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
	const entryTypeIdByRealId = new Map(rows.map((r) => [r.id, r.typeId as string]))
	const entryLocalIdToRealId = new Map<number, number>()
	const entryKeyById = new Map<number, string>()
	for (const fe of fileEntries) {
		const id = marks[fe.key]?.id
		if (id === undefined || !entryTypeIdByRealId.has(id)) continue
		entryKeyById.set(id, fe.key)
		const local = fe.entry?.extensions?.serenepub?.entryLocalId
		if (typeof local === "number") entryLocalIdToRealId.set(local, id)
	}
	return { entryTypeIdByRealId, entryLocalIdToRealId, entryKeyById }
}

/**
 * A fresh import's baselines for cast and stats: what the file's members and
 * values became, so the next upgrade knows what a person changed. A member is
 * paired with the binding the importer made for it by walking the importer's
 * own order (bindings land in the file's order, a card bound twice folds into
 * its first); if the counts disagree it is found by key instead.
 */
async function landedBaselines(
	db: Db,
	row: PluginRow,
	slug: string,
	book: typeof schema.lorebooks.$inferSelect,
	serenepub: unknown,
	fileEntries: readonly FileEntry[],
	entries: Record<string, ProvidedEntryMark>
): Promise<{ cast: Record<string, ProvidedCastMark>; stats: Record<string, ProvidedStatMark> }> {
	const cast: Record<string, ProvidedCastMark> = {}
	const stats: Record<string, ProvidedStatMark> = {}
	const file = await fileCastOf(serenepub)
	const live = await liveCastOf(db, book.id)
	const rowOf = new Map<string, LiveMember>()
	if (live.length === file.ownOrder.length)
		file.ownOrder.forEach((m, i) => m && rowOf.set(m.key, live[i]))
	else {
		const taken = new Set<number>()
		for (const m of file.members) {
			const found = findLiveMember(m, live, taken, row.pluginId, slug)
			if (found) {
				taken.add(found.binding.id)
				rowOf.set(m.key, found)
			}
		}
	}
	const bindingLocalIdToRealId = new Map<number, number>()
	const castKeyByBindingId = new Map<number, string>()
	for (const m of file.members) {
		const at = rowOf.get(m.key)
		if (!at) continue
		cast[m.key] = {
			binding: at.binding.id,
			character: at.binding.characterId,
			hash: await castHashNow(db, at.binding),
			up: m.up
		}
		castKeyByBindingId.set(at.binding.id, m.key)
		for (const l of m.localIds) bindingLocalIdToRealId.set(l, at.binding.id)
	}
	const refs = await entryRefsOf(db, book.id, fileEntries, entries)
	const fileStats = fileStatsOf(serenepub, {
		lorebookId: book.id,
		bindingLocalIdToRealId,
		entryLocalIdToRealId: refs.entryLocalIdToRealId,
		entryTypeIdByRealId: refs.entryTypeIdByRealId,
		castKeyByBindingId,
		entryKeyById: refs.entryKeyById
	})
	const liveStats = await liveStatsOf(db, fileStats)
	for (const s of fileStats) {
		const at = liveStats.get(`${s.row.ownerKind}|${s.row.ownerId}|${s.row.slotId}`)
		if (at) stats[s.key] = { id: at.id, hash: statHashOf(at), up: s.up }
	}
	return { cast, stats }
}

// ── serialisation ───────────────────────────────────────────────────────

const running = new Map<string, Promise<unknown>>()

/** One sync at a time per plugin: enable and boot can overlap, and an import is not re-entrant. */
export function serial<T>(pluginId: string, work: () => Promise<T>): Promise<T> {
	const prior = running.get(pluginId) ?? Promise.resolve()
	const next = prior.catch(() => {}).then(work)
	running.set(pluginId, next)
	const clear = () => {
		if (running.get(pluginId) === next) running.delete(pluginId)
	}
	next.then(clear, clear)
	return next
}

// ── the sync ────────────────────────────────────────────────────────────

export interface ProvidedSyncReport {
	imported: string[]
	upgraded: string[]
	held: string[]
	/** Slugs re-imported because the shipped file changed at the same version. */
	reimported: string[]
	/** Entries, cast members, stat values and rules an upgrade left alone because a person changed them. */
	keptEdited: number
	/** Entries, cast members and stat values gone upstream that an upgrade left alone. */
	goneUpstream: number
	/** What an import or upgrade said in words (rules the pub lacks, a version it does not keep); each is also logged. */
	warnings: string[]
	problems: string[]
}

const emptyReport = (): ProvidedSyncReport => ({
	imported: [],
	upgraded: [],
	held: [],
	reimported: [],
	keptEdited: 0,
	goneUpstream: 0,
	warnings: [],
	problems: []
})

/** The book currently carrying this plugin's mark for `slug`, whoever owns it now. */
async function findProvidedBook(db: Db, pluginId: string, slug: string) {
	const rows = await db
		.select()
		.from(schema.lorebooks)
		.where(
			and(
				sql`${schema.lorebooks.extraJson}->'provided'->>'plugin' = ${pluginId}`,
				sql`${schema.lorebooks.extraJson}->'provided'->>'slug' = ${slug}`
			)
		)
	for (const book of rows) {
		const mark = markedBook(book.extraJson, book.uuid)
		if (mark) return { book, mark }
	}
	return null
}

/**
 * Import or upgrade every book this plugin provides. Best-effort: a problem
 * is in the report (and logged), never thrown. Acts only for an enabled plugin
 * whose lorebook write grant is in force, as the admin who enabled it.
 */
export function syncProvidedBooks(db: Db, pluginId: string): Promise<ProvidedSyncReport> {
	return serial(pluginId, async () => {
		const report = emptyReport()
		try {
			const [row] = await db
				.select()
				.from(schema.plugins)
				.where(eq(schema.plugins.pluginId, pluginId))
			if (!row || !row.enabled || row.pluginId === "core") return report
			const paths = providedPathsOf(row.manifest)
			if (!paths.length || !lorebookWriteInForce(row)) return report
			const person = await actingPersonFor(db, { via: "install", pluginId })
			if (!person) {
				report.problems.push("no administrator to import as")
				return report
			}
			// 🚧 (M2c fix) The package's own entry types first — registered in this
			// process and with their registry rows — so a book naming one imports
			// it typed instead of failing its insert or reading it as world lore.
			try {
				report.problems.push(...(await ensurePackageEntryTypes(db, pluginId)))
			} catch (e) {
				report.problems.push(`its entry types: ${e instanceof Error ? e.message : String(e)}`)
			}
			for (const path of paths) {
				const slug = providedSlugOf(path)
				try {
					const refused = await syncOne(db, row, person.userId, path, report)
					await recordOutcome(db, pluginId, slug, { failed: null, ...(refused ? { refused } : {}) })
				} catch (e) {
					// The cause too: a driver's "Failed query" names the statement, not the constraint.
					const cause = (e as { cause?: unknown })?.cause
					const causeText =
						cause instanceof Error ? cause.message : cause ? String(cause) : ""
					const reason =
						(e instanceof Error ? e.message : String(e)) +
						(causeText ? ` (cause: ${causeText.slice(0, 400)})` : "")
					const msg = `${path}: ${reason}`
					report.problems.push(msg)
					console.warn(`[plugins] '${pluginId}' provided book ${msg}`)
					await recordOutcome(db, pluginId, slug, { failed: reason }).catch(() => {})
				}
			}
		} catch (e) {
			report.problems.push(String(e))
			console.warn(`[plugins] '${pluginId}' provided books failed:`, e)
		}
		return report
	})
}

/** Import or upgrade one book; answers the entries it refused (undefined when it did nothing). */
async function syncOne(
	db: Db,
	row: PluginRow,
	adminId: number,
	path: string,
	report: ProvidedSyncReport
): Promise<string[] | undefined> {
	const slug = providedSlugOf(path)
	const found = await findProvidedBook(db, row.pluginId, slug)
	if (found && compareVersions(row.version, found.mark.version) < 0) return
	const sameVersion = !!found && found.mark.version === row.version
	const raw = await readProvidedFile(row, path)
	if (raw === null) {
		if (sameVersion) return
		throw new Error("the package has no such file")
	}
	const sha256 = createHash("sha256").update(raw).digest("hex")
	// Same version: only a changed file (its sha256 differs from the mark's) goes on.
	if (found && sameVersion && found.mark.sha256 === sha256) return
	// 🚧 (M2c fix) An entry of a ruleset type nothing here declares is refused
	// out loud — never imported as world lore in its place.
	const { text, refused } = withoutUndeclaredTypes(raw)
	if (!found) {
		const waiting = disabledProvidedBooks((row as { provided?: unknown }).provided).has(slug)
		sayWarnings(report, row.pluginId, slug, await importFresh(db, row, adminId, slug, text, sha256, waiting))
		if (waiting) await clearDisabledLedger(db, row.pluginId, slug)
		report.imported.push(slug)
		return refused
	}
	const applied = report.upgraded.length
	await upgrade(db, row, found.book, found.mark, text, sha256, report)
	if (sameVersion && report.upgraded.length > applied) {
		report.reimported.push(slug)
		console.info(
			`[plugins] '${row.pluginId}' provided book ${found.book.name}: its content changed (same version) — re-imported.`
		)
	}
	return refused
}

/** What an import or upgrade said in words: into the report, and one log line each. */
function sayWarnings(report: ProvidedSyncReport, pluginId: string, slug: string, warnings: string[]): void {
	for (const w of warnings) {
		report.warnings.push(w)
		console.info(`[plugins] '${pluginId}' provided book ${slug}: ${w}`)
	}
}

/**
 * 🚧 (M2c fix) A provided file with every entry whose type marker is a ruleset
 * type id (`<owner>:entry/<ruleset>.<repertoire>`) that no registered ruleset
 * declares taken out, and one sentence per entry taken. A file is the plugin's
 * own; an unknown type in it is a mistake to show, not lore to reinterpret.
 * Anything this cannot read passes through for the importer to refuse.
 */
function withoutUndeclaredTypes(text: string): { text: string; refused: string[] } {
	let data: any
	try {
		data = JSON.parse(text.replace(/^\uFEFF/, ""))
	} catch {
		return { text, refused: [] }
	}
	const refused: string[] = []
	const keep = (entry: any, at: string): boolean => {
		const marker = entry?.extensions?.serenepub?.entryType
		if (typeof marker !== "string") return true
		const bare = marker.replace(/@\d+$/, "")
		if (!isDerivedEntryTypeId(bare) || isDeclaredEntryType(bare)) return true
		const title = [entry?.name, entry?.comment].find((v) => typeof v === "string" && v.trim()) ?? at
		refused.push(`'${String(title).trim()}': its type ${bare} is declared by no ruleset on this pub`)
		return false
	}
	const book = data && typeof data === "object" ? (data.data && typeof data.data === "object" && "entries" in data.data ? data.data : data) : null
	if (!book || !book.entries || typeof book.entries !== "object") return { text, refused }
	if (Array.isArray(book.entries)) book.entries = book.entries.filter((e: any, i: number) => keep(e, `entry ${i + 1}`))
	else
		for (const [k, e] of Object.entries(book.entries as Record<string, unknown>))
			if (!keep(e, `entry ${k}`)) delete (book.entries as Record<string, unknown>)[k]
	return refused.length ? { text: JSON.stringify(data), refused } : { text, refused }
}

/** 🚧 (M2c fix) Write one book's last outcome onto its plugin's row (`plugins.provided.failed` / `.refused`). */
async function recordOutcome(
	db: Db,
	pluginId: string,
	slug: string,
	outcome: { failed: string | null; refused?: string[] }
): Promise<void> {
	const [row] = await db
		.select({ provided: schema.plugins.provided })
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, pluginId))
		.limit(1)
	if (!row) return
	const state = { ...((row.provided ?? {}) as Record<string, any>) }
	const failed = { ...(state.failed ?? {}) }
	if (outcome.failed) failed[slug] = { at: new Date().toISOString(), reason: outcome.failed }
	else delete failed[slug]
	const refused = { ...(state.refused ?? {}) }
	if (outcome.refused) {
		if (outcome.refused.length) refused[slug] = outcome.refused
		else delete refused[slug]
	}
	const next = { ...state, failed, refused }
	if (JSON.stringify(next) === JSON.stringify(row.provided ?? {})) return
	await db.update(schema.plugins).set({ provided: next as never }).where(eq(schema.plugins.pluginId, pluginId))
}

/** Import a new provided book and write its marks. */
async function importFresh(
	db: Db,
	row: PluginRow,
	adminId: number,
	slug: string,
	text: string,
	sha256: string,
	disabled = false
): Promise<string[]> {
	const { importLorebookDocument } = await import("$lib/server/sockets/lorebooks")
	// The cards the book brings are the ones that did not exist before it.
	const before = new Set(
		(
			await db
				.select({ id: schema.characters.id })
				.from(schema.characters)
				.where(eq(schema.characters.userId, adminId))
		).map((r) => r.id)
	)
	const { book, card, warnings } = await importLorebookDocument(adminId, text)
	// The rules the book landed on, the baseline for the next upgrade (re-read when the import's row lacks them).
	const landedRules =
		typeof book.primaryRuleset === "string"
			? book
			: (
					await db
						.select({
							primaryRuleset: schema.lorebooks.primaryRuleset,
							rulesetVersion: schema.lorebooks.rulesetVersion
						})
						.from(schema.lorebooks)
						.where(eq(schema.lorebooks.id, book.id))
				)[0]
	const fileEntries = fileEntriesOf(card.entries)
	const rows = await db
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, book.id))
		.orderBy(asc(schema.lorebookEntries.typeId), asc(schema.lorebookEntries.position))
	const byPlace = new Map(rows.map((r) => [`${r.typeId}#${r.position}`, r]))
	const entries: Record<string, ProvidedEntryMark> = {}
	for (const fe of fileEntries) {
		const landed = byPlace.get(`${fe.typeId}#${fe.ordinal}`)
		if (landed) entries[fe.key] = { id: landed.id, hash: rowHashOf(landed), up: fe.up }
	}
	// The cast and stat values the file brought, as baselines for the next upgrade. The import is
	// already committed: a failure here leaves them out (the book then reads as one imported before
	// they were carried) rather than failing a book that is in.
	let baselines: Awaited<ReturnType<typeof landedBaselines>> | undefined
	try {
		baselines = await landedBaselines(
			db,
			row,
			slug,
			book,
			card.extensions?.serenepub,
			fileEntries,
			entries
		)
	} catch (e) {
		console.warn(`[plugins] '${row.pluginId}' provided book ${slug}: its cast and stat baselines were not recorded:`, e)
	}
	await db
		.update(schema.lorebooks)
		.set({
			extraJson: {
				...(book.extraJson as object),
				provided: {
					plugin: row.pluginId,
					slug,
					version: row.version,
					sha256,
					uuid: book.uuid,
					entries,
					...(baselines ?? {}),
					...(landedRules
						? {
								rules: {
									primaryRuleset: landedRules.primaryRuleset ?? null,
									rulesetVersion: landedRules.rulesetVersion ?? null
								}
							}
						: {}),
					...(disabled ? { disabled: true as const } : {})
				} satisfies ProvidedBookMark
			}
		})
		.where(eq(schema.lorebooks.id, book.id))
	await markBroughtCharacters(db, row, slug, book.id, before)
	return warnings
}

/** Stamp the cards a fresh import created (not ones the person already had). */
async function markBroughtCharacters(
	db: Db,
	row: PluginRow,
	slug: string,
	lorebookId: number,
	before: Set<number>
): Promise<void> {
	const bound = await db
		.select({ id: schema.lorebookBindings.characterId })
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	const ids = [
		...new Set(bound.map((b) => b.id).filter((id): id is number => id != null && !before.has(id)))
	]
	if (!ids.length) return
	const cards = await db
		.select({
			id: schema.characters.id,
			uuid: schema.characters.uuid,
			extensions: schema.characters.extensions
		})
		.from(schema.characters)
		.where(inArray(schema.characters.id, ids))
	for (const c of cards) await stampProvidedCharacter(db, row, slug, c)
}

/** Write the plugin's provided mark onto one card (the card's `extensions.serenepub.provided`). */
async function stampProvidedCharacter(
	db: Db,
	row: PluginRow,
	slug: string,
	c: { id: number; uuid: string; extensions: unknown }
): Promise<void> {
	const ext = ((c.extensions ?? {}) as Record<string, any>) ?? {}
	await db
		.update(schema.characters)
		.set({
			extensions: {
				...ext,
				serenepub: {
					...(ext.serenepub ?? {}),
					provided: { plugin: row.pluginId, slug, version: row.version, uuid: c.uuid }
				}
			}
		})
		.where(eq(schema.characters.id, c.id))
}

/**
 * The cast members and stat values of an upgrade, under the same rule as the
 * entries (the person wins), inside the upgrade's transaction: `tx` alone.
 * Answers the next baselines, the writes made, and the cards whose bindings'
 * names must be synced once the transaction has committed.
 */
async function upgradeCastAndStats(
	tx: Db,
	row: PluginRow,
	book: typeof schema.lorebooks.$inferSelect,
	mark: ProvidedBookMark,
	serenepub: unknown,
	fileEntries: readonly FileEntry[],
	entries: Record<string, ProvidedEntryMark>,
	report: ProvidedSyncReport
): Promise<{
	cast: Record<string, ProvidedCastMark>
	stats: Record<string, ProvidedStatMark>
	written: number
	syncCharacterIds: Set<number>
}> {
	const slug = mark.slug
	const { createCharacterFromParsedData, overwriteCharacterFromParsedData } = await import(
		"$lib/server/sockets/characters"
	)
	const { deriveNextBindingToken } = await import("$lib/server/utils/lorebookBindingToken")
	const cast: Record<string, ProvidedCastMark> = { ...(mark.cast ?? {}) }
	const stats: Record<string, ProvidedStatMark> = { ...(mark.stats ?? {}) }
	const syncCharacterIds = new Set<number>()
	let written = 0

	// ── cast members ──
	const file = await fileCastOf(serenepub)
	const live = await liveCastOf(tx, book.id)
	const liveById = new Map(live.map((m) => [m.binding.id, m]))
	// A recorded member keeps its row: matching by key never claims it for another.
	const taken = new Set<number>()
	for (const m of file.members) {
		const known = mark.cast?.[m.key]
		if (known && liveById.has(known.binding)) taken.add(known.binding)
	}
	const bindingLocalIdToRealId = new Map<number, number>()
	const castKeyByBindingId = new Map<number, string>()
	const land = (m: FileCastMember, bindingId: number) => {
		castKeyByBindingId.set(bindingId, m.key)
		for (const l of m.localIds) bindingLocalIdToRealId.set(l, bindingId)
	}
	for (const m of file.members) {
		const known = mark.cast?.[m.key]
		if (known) {
			const at = liveById.get(known.binding)
			if (!at) continue // the person removed it: theirs to decide
			land(m, at.binding.id)
			if ((await castHashNow(tx, at.binding)) !== known.hash) {
				report.keptEdited++ // the person edited it: the person wins
				continue
			}
			if (known.up === m.up) continue
			let characterId = at.binding.characterId
			if (m.cardData) {
				if (at.character) {
					const ours = markedCharacter(at.character.extensions, at.character.uuid)
					if (ours?.plugin !== row.pluginId || ours.slug !== slug) {
						report.keptEdited++ // a card of the person's own is never rewritten
						continue
					}
					// Keeps the avatar (none is passed); the overwrite replaces `extensions`, so the mark is written again.
					// Never a dowry: a card embedded in a book carries none, and the overwrite's
					// `replace` would delete the card's own stats, which the cast hash does not see.
					const sp = m.cardData.extensions?.serenepub
					const cardData =
						sp && typeof sp === "object" && "dowry" in sp
							? (() => {
									const { dowry: _dowry, ...rest } = sp
									return { ...m.cardData, extensions: { ...m.cardData.extensions, serenepub: rest } }
								})()
							: m.cardData
					const updated = await overwriteCharacterFromParsedData(
						at.character.id,
						cardData,
						undefined,
						book.userId,
						tx
					)
					await stampProvidedCharacter(tx, row, slug, updated)
				} else {
					const created = await createCharacterFromParsedData(m.cardData, undefined, book.userId, tx)
					await stampProvidedCharacter(tx, row, slug, created)
					characterId = created.id
				}
			} else if (at.character) continue // a card the file does not show is left alone
			// The overwrite added a new card version; the member stays pinned to the one it had (the person gets the Update offer).
			// Sprite set and own names are the base's now, not the binding's frozen columns.
			const held = await ownOfMember(tx, at.binding)
			const changes: CastVersionChanges = {}
			if (m.spriteSet !== held.spriteSet) changes.spriteSet = m.spriteSet
			if (m.ownName !== held.ownName) {
				if (m.ownName != null) changes.name = m.ownName
				else if (held.carded) changes.name = { follow: true }
			}
			if (m.ownNickname !== held.ownNickname) {
				if (m.ownNickname != null) changes.nickname = m.ownNickname || null
				else if (held.carded) changes.nickname = { follow: true }
			}
			if (Object.keys(changes).length)
				await writeCastVersion(tx, {
					member: at.binding.id,
					changes,
					writtenBy: `plugin:${row.pluginId}`,
					at: { branchId: null, date: null, personalPosition: null }
				})
			const [b] = await tx
				.update(schema.lorebookBindings)
				.set({ characterId })
				.where(eq(schema.lorebookBindings.id, at.binding.id))
				.returning()
			// A card-less member that is given a card reads it from the book's present on: its versions
			// follow every field the file does not set on the member (the file carries no retold text).
			if (characterId != null && at.binding.characterId == null) {
				const cardV = await ensureCardVersion(tx, characterId)
				await reparentFromBookPresent(tx, at.binding.id, {
					cardId: characterId,
					writtenBy: `plugin:${row.pluginId}`,
					follows: memberProfileOf(
						{
							name: "",
							aliases: [],
							summary: null,
							description: null,
							personality: null,
							scenario: null,
							firstMessage: null,
							alternateGreetings: [],
							exampleDialogues: null,
							faceMediaId: null,
							retold: {},
							ownName: m.ownName,
							ownNickname: m.ownNickname,
							timbre: null,
							spriteSet: m.spriteSet
						},
						cardV ? profileOf(cardV) : null
					).follows
				})
			}
			cast[m.key] = { binding: b.id, character: b.characterId, hash: await castHashNow(tx, b), up: m.up }
			if (b.characterId != null) syncCharacterIds.add(b.characterId)
			written++
			continue
		}
		const found = findLiveMember(m, live, taken, row.pluginId, slug)
		if (found) {
			// No record of it (the book was imported before cast was carried, or the person made it):
			// what already matches the file is recorded; what differs stays the person's.
			taken.add(found.binding.id)
			land(m, found.binding.id)
			const now = await castHashNow(tx, found.binding)
			if (now === m.up)
				cast[m.key] = { binding: found.binding.id, character: found.binding.characterId, hash: now, up: m.up }
			else report.keptEdited++
			continue
		}
		// A member with no card, in a book with no record of its cast, is not guessed at: its text
		// is the importer's to number, so a miss here may only be a different tag.
		if (!m.cardData && mark.cast === undefined) continue
		let characterId: number | null = null
		if (m.cardData) {
			const created = await createCharacterFromParsedData(m.cardData, undefined, book.userId, tx)
			await stampProvidedCharacter(tx, row, slug, created)
			characterId = created.id
		}
		const { member: b } = await insertCastMember(tx, {
			lorebookId: book.id,
			characterId,
			binding: await deriveNextBindingToken(book.id, tx),
			spriteSet: m.spriteSet,
			ownName: m.ownName,
			ownNickname: m.ownNickname
		})
		land(m, b.id)
		cast[m.key] = { binding: b.id, character: characterId, hash: await castHashNow(tx, b), up: m.up }
		if (characterId != null) syncCharacterIds.add(characterId)
		written++
	}
	const fileCastKeys = new Set(file.members.map((m) => m.key))
	report.goneUpstream += Object.keys(mark.cast ?? {}).filter((k) => !fileCastKeys.has(k)).length

	// ── stat values ──
	const refs = await entryRefsOf(tx, book.id, fileEntries, entries)
	const fileStats = fileStatsOf(serenepub, {
		lorebookId: book.id,
		bindingLocalIdToRealId,
		entryLocalIdToRealId: refs.entryLocalIdToRealId,
		entryTypeIdByRealId: refs.entryTypeIdByRealId,
		castKeyByBindingId,
		entryKeyById: refs.entryKeyById
	})
	const liveStats = await liveStatsOf(tx, fileStats)
	for (const s of fileStats) {
		const at = liveStats.get(`${s.row.ownerKind}|${s.row.ownerId}|${s.row.slotId}`)
		const known = mark.stats?.[s.key]
		if (known) {
			if (!at) continue // the person deleted it: theirs to decide
			if (statHashOf(at) !== known.hash) {
				report.keptEdited++ // the person edited it: the person wins
				continue
			}
			if (known.up === s.up) continue
			const [updated] = await tx
				.update(schema.attributeValues)
				.set({ value: s.row.value!, note: s.row.note, updatedBy: s.row.updatedBy })
				.where(eq(schema.attributeValues.id, at.id))
				.returning()
			stats[s.key] = { id: updated.id, hash: statHashOf(updated), up: s.up }
			written++
			continue
		}
		if (at) {
			const now = statHashOf(at)
			if (now === s.up) stats[s.key] = { id: at.id, hash: now, up: s.up }
			else report.keptEdited++
			continue
		}
		const [created] = await tx
			.insert(schema.attributeValues)
			.values({
				ownerKind: s.row.ownerKind,
				ownerId: s.row.ownerId,
				slotId: s.row.slotId,
				value: s.row.value!,
				historyEntryId: null,
				sceneId: null,
				updatedBy: s.row.updatedBy,
				note: s.row.note
			})
			.returning()
		stats[s.key] = { id: created.id, hash: statHashOf(created), up: s.up }
		written++
	}
	const fileStatKeys = new Set(fileStats.map((s) => s.key))
	report.goneUpstream += Object.keys(mark.stats ?? {}).filter((k) => !fileStatKeys.has(k)).length
	return { cast, stats, written, syncCharacterIds }
}

/**
 * The book's rules in an upgrade, inside its transaction (`tx` alone). The file names rules → they are
 * `importedBookRules`' columns; the mark's `rules` is what the last write left. The row now is not that →
 * a person changed it, theirs are kept. A book with no baseline (imported before a file could name rules)
 * reads a default as untouched and anything else as the person's. A file naming none changes none.
 * Answers the columns to write (absent: none), the baseline to record, and the words to say.
 */
async function upgradeRules(
	tx: Db,
	book: typeof schema.lorebooks.$inferSelect,
	mark: ProvidedBookMark,
	serenepub: unknown,
	report: ProvidedSyncReport
): Promise<{
	columns?: { primaryRuleset: string; rulesetVersion: string | null }
	rules: ProvidedBookMark["rules"]
	warnings: string[]
}> {
	const { importedBookRules } = await import("$lib/server/sockets/lorebooks")
	const named = await importedBookRules(tx, serenepub, book.name)
	if (!("primaryRuleset" in named.columns) && !("rulesetVersion" in named.columns))
		return { rules: mark.rules, warnings: [] }
	const now = { primaryRuleset: book.primaryRuleset ?? null, rulesetVersion: book.rulesetVersion ?? null }
	const target = {
		primaryRuleset: named.columns.primaryRuleset ?? book.primaryRuleset,
		rulesetVersion: named.columns.rulesetVersion ?? null
	}
	const untouched = mark.rules
		? now.primaryRuleset === mark.rules.primaryRuleset && now.rulesetVersion === mark.rules.rulesetVersion
		: (now.primaryRuleset === null || now.primaryRuleset === BOOK_DEFAULT_RULES) && now.rulesetVersion === null
	if (!untouched) {
		report.keptEdited++ // the person changed the book's rules: the person wins
		return { rules: mark.rules, warnings: [] }
	}
	if (target.primaryRuleset === now.primaryRuleset && target.rulesetVersion === now.rulesetVersion)
		return { rules: now, warnings: named.warnings }
	return { columns: target, rules: target, warnings: named.warnings }
}

/** A newer version of a book already here: a diff under the book's write mode. */
async function upgrade(
	db: Db,
	row: PluginRow,
	book: typeof schema.lorebooks.$inferSelect,
	mark: ProvidedBookMark,
	text: string,
	sha256: string,
	report: ProvidedSyncReport
): Promise<void> {
	if (mark.sha256 === sha256) {
		// A new version of the package, the same book: just move the version.
		await saveMark(db, book, { ...mark, version: row.version, held: undefined })
		return
	}
	const mode = await bookLoreWriteMode(db, book.id)
	if (mode !== "full") {
		if (mark.held?.sha256 !== sha256 || mark.held?.version !== row.version) {
			await saveMark(db, book, { ...mark, held: { version: row.version, sha256, mode } })
		}
		report.held.push(mark.slug)
		return
	}
	const { readLorebookImport } = await import("$lib/server/sockets/lorebooks")
	const { card } = readLorebookImport(text)
	const fileEntries = fileEntriesOf(card.entries)
	const live = new Map(
		(
			await db
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, book.id))
		).map((r) => [r.id, r as EntryRow])
	)
	const next: Record<string, ProvidedEntryMark> = { ...mark.entries }
	const nextPosition = new Map<string, number>()
	for (const r of live.values())
		nextPosition.set(r.typeId, Math.max(nextPosition.get(r.typeId) ?? -1, r.position))
	const seen = new Set<string>()
	let written = 0
	let syncCharacterIds = new Set<number>()
	const said: string[] = []
	await db.transaction(async (tx) => {
		for (const fe of fileEntries) {
			seen.add(fe.key)
			const known = mark.entries[fe.key]
			if (!known) {
				// New upstream: appended at the end of its type.
				const position = (nextPosition.get(fe.typeId) ?? -1) + 1
				nextPosition.set(fe.typeId, position)
				const [created] = await tx
					.insert(schema.lorebookEntries)
					.values({ ...valuesOf(fe, book.id, position) } as any)
					.returning()
				next[fe.key] = { id: created.id, hash: rowHashOf(created), up: fe.up }
				written++
				continue
			}
			const current = live.get(known.id)
			if (!current) continue // the person deleted it: theirs to decide
			if (rowHashOf(current) !== known.hash) {
				report.keptEdited++ // the person edited it: the person wins
				continue
			}
			if (known.up === fe.up) continue
			const values = valuesOf(fe, book.id, current.position) as Record<string, unknown>
			const set: Record<string, unknown> = {}
			for (const c of CONTENT_COLUMNS) set[c] = values[c]
			const [updated] = await tx
				.update(schema.lorebookEntries)
				.set(set as any)
				.where(eq(schema.lorebookEntries.id, known.id))
				.returning()
			next[fe.key] = { id: known.id, hash: rowHashOf(updated), up: fe.up }
			written++
		}
		report.goneUpstream += Object.keys(mark.entries).filter((k) => !seen.has(k)).length
		// The cast members and stat values, after the entries they may name.
		const more = await upgradeCastAndStats(
			tx as unknown as Db,
			row,
			book,
			mark,
			card.extensions?.serenepub,
			fileEntries,
			next,
			report
		)
		written += more.written
		syncCharacterIds = more.syncCharacterIds
		// The book's rules, under the same rule: the person wins, an untouched book follows the file.
		const rules = await upgradeRules(tx as unknown as Db, book, mark, card.extensions?.serenepub, report)
		if (rules.columns) written++
		said.push(...rules.warnings)
		await tx
			.update(schema.lorebooks)
			.set({
				...(rules.columns ?? {}),
				extraJson: {
					...(book.extraJson as object),
					provided: {
						...mark,
						version: row.version,
						sha256,
						entries: next,
						cast: more.cast,
						stats: more.stats,
						rules: rules.rules,
						held: undefined
					}
				}
			})
			.where(eq(schema.lorebooks.id, book.id))
	})
	if (syncCharacterIds.size) {
		// Committed: the bindings take their names from their cards, as the importer does after its own commit.
		const { syncLorebookBindingsForCharacter } = await import("$lib/server/utils/characterBindingSync")
		for (const id of syncCharacterIds)
			await syncLorebookBindingsForCharacter(id, db).catch((e) =>
				console.warn(`[plugins] '${row.pluginId}' provided book ${mark.slug}: the cast's names were not synced:`, e)
			)
	}
	sayWarnings(report, row.pluginId, mark.slug, said)
	if (written) {
		const { queueImportedBook } = await import("$lib/server/sockets/lorebooks")
		queueImportedBook(book.id, book.name)
	}
	report.upgraded.push(mark.slug)
}

export async function saveMark(
	db: Db,
	book: typeof schema.lorebooks.$inferSelect,
	mark: ProvidedBookMark
): Promise<void> {
	await db
		.update(schema.lorebooks)
		.set({ extraJson: { ...(book.extraJson as object), provided: mark } })
		.where(eq(schema.lorebooks.id, book.id))
}

// ── uninstall ───────────────────────────────────────────────────────────

/**
 * Delete the books and cards carrying this plugin's mark (`providedBooks:
 * 'delete'` on uninstall). Books by the one deletion rule (`purgeLorebook`),
 * cards the way `characters:delete` does (soft). Anything without a genuine
 * mark (a copy, a card a person made) is never touched.
 */
export async function deleteProvidedBooks(
	db: Db,
	pluginId: string
): Promise<{ books: number; characters: number }> {
	const books = await db
		.select()
		.from(schema.lorebooks)
		.where(sql`${schema.lorebooks.extraJson}->'provided'->>'plugin' = ${pluginId}`)
	let deleted = 0
	for (const book of books) {
		if (!markedBook(book.extraJson, book.uuid)) continue
		await db.transaction(async (tx) => {
			await purgeLorebook(tx as unknown as Db, book.id)
			await tx.delete(schema.lorebooks).where(eq(schema.lorebooks.id, book.id))
		})
		deleted++
	}
	const cards = await db
		.select({
			id: schema.characters.id,
			uuid: schema.characters.uuid,
			extensions: schema.characters.extensions
		})
		.from(schema.characters)
		.where(sql`${schema.characters.extensions}->'serenepub'->'provided'->>'plugin' = ${pluginId}`)
	const ids = cards.filter((c) => markedCharacter(c.extensions, c.uuid)).map((c) => c.id)
	// Seats are filled first (★RF-1, 2026-11-09: a seat with no member gets the
	// card's member or a new one made from the card, while the card is live),
	// then followers are resolved, in the same transaction as the soft delete
	// (★27-6), then every member linked to a provided card (the plugin's own
	// books were purged above, so these sit in other books) becomes card-less
	// (★3, 2026-11-08): its words, sprites, gallery and stats are copied onto
	// it, so no member reads a deleted card. No push: no socket here.
	if (ids.length)
		await db.transaction(async (tx) => {
			for (const id of ids)
				await fillSeatsBeforeCardDelete(tx as unknown as Db, id)
			for (const id of ids)
				await resolveFollows(tx as unknown as Db, { cardId: id })
			const members = await tx
				.select({ id: schema.lorebookBindings.id })
				.from(schema.lorebookBindings)
				.where(inArray(schema.lorebookBindings.characterId, ids))
			for (const m of members)
				await makeMemberCardless(tx as unknown as Db, m.id, {
					cause: "provided-uninstall"
				})
			await tx
				.update(schema.characters)
				.set({ isDeleted: true })
				.where(inArray(schema.characters.id, ids))
		})
	return { books: deleted, characters: ids.length }
}

// ── the plugin page ─────────────────────────────────────────────────────

/** What the plugin page lists for a row: each declared book and where it stands. */
export async function providedBooksOf(
	db: Db,
	row: Pick<PluginRow, "pluginId" | "manifest" | "adminDenied" | "enabled" | "version"> & { provided?: unknown }
): Promise<Sockets.Plugins.ProvidedBook[]> {
	const paths = providedPathsOf(row.manifest)
	if (!paths.length) return []
	const inForce = row.enabled && lorebookWriteInForce(row as PluginRow)
	const { failed, refused } = providedOutcomes(row.provided)
	const out: Sockets.Plugins.ProvidedBook[] = []
	for (const path of paths) {
		const slug = providedSlugOf(path)
		const found = await findProvidedBook(db, row.pluginId, slug)
		if (!found) {
			const reason = failed.get(slug)
			out.push({
				slug,
				name: slug,
				version: row.version,
				lorebookId: null,
				disabled: disabledProvidedBooks(row.provided).has(slug),
				state: reason ? "failed" : inForce ? "pending" : "waiting",
				why: reason
					? `The import failed: ${reason}`
					: !row.enabled
						? "Switch the plugin on to import it."
						: inForce
							? "Not imported yet: it comes in the next time the plugin is synced."
							: "Waiting for approval: the plugin needs permission to add lorebooks."
			})
			continue
		}
		out.push({
			slug,
			name: found.book.name,
			version: found.mark.version,
			lorebookId: found.book.id,
			disabled: found.mark.disabled === true,
			state: failed.has(slug) ? "failed" : found.mark.held ? "held" : "imported",
			...(() => {
				const why = [
					failed.has(slug) ? `The last update failed: ${failed.get(slug)}` : "",
					found.mark.held
						? `Version ${found.mark.held.version} is not applied: this book's lore changes are on ${found.mark.held.mode === "off" ? "Off" : "Review"}.`
						: "",
					refused.get(slug)?.length
						? `${refused.get(slug)!.length === 1 ? "One entry was" : `${refused.get(slug)!.length} entries were`} not imported: ${refused.get(slug)!.join("; ")}.`
						: ""
				].filter(Boolean)
				return why.length ? { why: why.join(" ") } : {}
			})()
		})
	}
	return out
}

// ── disabled, never deleted (M2e) ───────────────────────────────────────

/** Drop one slug from the plugin row's disabled-before-imported ledger. */
async function clearDisabledLedger(db: Db, pluginId: string, slug: string): Promise<void> {
	await db.execute(sql`
		update ${schema.plugins}
		set ${sql.identifier("provided")} = ${schema.plugins.provided} #- ARRAY['disabled', ${slug}]::text[]
		where ${schema.plugins.pluginId} = ${pluginId} and ${schema.plugins.provided} -> 'disabled' ? ${slug}
	`)
}

/**
 * 🚧 (M2e) The one writer of the disabled mark. Finds the book by its mark
 * (`pluginId` may be "core"), sets or clears `disabled` on it; with no row yet
 * it writes or clears the plugin row's ledger entry. Returns the book id, or
 * null when no book row exists; throws when neither a book nor a ledger holder
 * exists (an unknown plugin or slug).
 */
export async function setProvidedBookDisabled(
	db: Db,
	pluginId: string,
	slug: string,
	disabled: boolean,
	byUserId: number | null
): Promise<{ lorebookId: number | null; owner: number | null }> {
	// One writer at a time with the sync: an upgrade reads the mark and saves it later, and must not wipe this switch.
	return serial(pluginId, async () => {
		const found = await findProvidedBook(db, pluginId, slug)
		if (found) {
			const { disabled: _drop, ...rest } = found.mark
			await saveMark(db, found.book, disabled ? { ...rest, disabled: true } : rest)
			return { lorebookId: found.book.id, owner: found.book.userId }
		}
		const [row] = await db
			.select({ provided: schema.plugins.provided })
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, pluginId))
			.limit(1)
		if (!row) throw new Error("No such provided book.")
		if (disabled) {
			const entry = JSON.stringify({ at: new Date().toISOString(), by: byUserId, version: "" })
			await db.execute(sql`
				update ${schema.plugins}
				set ${sql.identifier("provided")} = jsonb_set(
					coalesce(${schema.plugins.provided}, '{}'::jsonb) || jsonb_build_object('disabled', coalesce(${schema.plugins.provided} -> 'disabled', '{}'::jsonb)),
					ARRAY['disabled', ${slug}]::text[],
					${entry}::jsonb,
					true
				)
				where ${schema.plugins.pluginId} = ${pluginId}
			`)
		} else await clearDisabledLedger(db, pluginId, slug)
		return { lorebookId: null, owner: null }
	})
}

/** Uninstall with `providedBooks: 'keep'`: the kept books come back into view as ordinary books. */
export async function clearDisabledOnKeptBooks(db: Db, pluginId: string): Promise<number> {
	const books = await db
		.select()
		.from(schema.lorebooks)
		.where(sql`${schema.lorebooks.extraJson}->'provided'->>'plugin' = ${pluginId}`)
	let n = 0
	for (const book of books) {
		const mark = markedBook(book.extraJson, book.uuid)
		if (!mark?.disabled) continue
		const { disabled: _drop, ...rest } = mark
		await saveMark(db, book, rest)
		n++
	}
	return n
}

/**
 * 🚧 (M2e) Boot pass, before the provided-book sync: M2c's tombstones
 * (`plugins.provided.dismissed[slug]`) become the disabled ledger
 * (`disabled[slug]`, same `at`/`by`/`version`); the next sync re-imports each
 * book as disabled. Idempotent: a row with no `dismissed` is not written.
 */
export async function turnTombstonesIntoDisabled(db: Db): Promise<number> {
	const res: any = await db.execute(sql`
		update ${schema.plugins}
		set ${sql.identifier("provided")} =
			(${schema.plugins.provided} - 'dismissed')
			|| jsonb_build_object('disabled', coalesce(${schema.plugins.provided} -> 'disabled', '{}'::jsonb) || (${schema.plugins.provided} -> 'dismissed'))
		where jsonb_typeof(${schema.plugins.provided} -> 'dismissed') = 'object'
	`)
	return Number(res?.affectedRows ?? res?.rowCount ?? 0)
}
