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
 * The key is (plugin, slug, version); the slug is the file's basename without
 * `.lorebook.json` / `.json`.
 *  · no book carries the mark → import it, as the admin who enabled the plugin;
 *  · same version → nothing;
 *  · a newer version → a diff under the BOOK's write mode (`bookLoreWriteMode`):
 *    - `full`: an entry the person has not touched (its row hash is the one
 *      recorded) and that changed upstream is rewritten; an entry new upstream
 *      is added; an entry the person edited is KEPT (the person wins); an entry
 *      gone upstream is left alone;
 *    - `review` / `off`: nothing is written. There is no session-less
 *      proposal path for lore entries to hand a diff to, so the newer version
 *      is only recorded as *held* (the plugin page says so).
 *
 * ⚠ Deleting a provided book while its plugin stays enabled brings it back at
 * the next sync: with no schema change there is nowhere to remember "deleted
 * on purpose".
 */
import { createHash } from "node:crypto"
import { readFile, realpath, stat } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { actingPersonFor } from "$lib/server/auth/actingPerson"
import { dismissedProvidedBooks, providedOutcomes } from "./providedMarks"
import { ensurePackageEntryTypes } from "./packageEntryTypes"
import { isDeclaredEntryType } from "$lib/server/entries/declarations"
import { isDerivedEntryTypeId } from "$lib/shared/entries/types"
import { getAppDataDir } from "$lib/server/utils/appDataDir"
import { hashCanonicalJson } from "$lib/server/utils/contentHash"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import {
	entryTypeIdOf,
	importedKeyColumns,
	mapImportedEntry,
	normalizeNativeWorldInfoEntry
} from "$lib/server/utils/lorebookImportMapper"
import { bookLoreWriteMode } from "$lib/server/state/loreWriteMode"
import { purgeLorebook } from "$lib/server/lorebooks/tableRegistry"
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
	type ProvidedEntryMark
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
const CONTENT_COLUMNS = [
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

// ── serialisation ───────────────────────────────────────────────────────

const running = new Map<string, Promise<unknown>>()

/** One sync at a time per plugin: enable and boot can overlap, and an import is not re-entrant. */
function serial<T>(pluginId: string, work: () => Promise<T>): Promise<T> {
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
	/** Entries an upgrade left alone because a person edited them. */
	keptEdited: number
	/** Entries gone upstream that an upgrade left alone. */
	goneUpstream: number
	/** 🚧 (M2c) Slugs an administrator deleted by hand: never imported again. */
	dismissed: string[]
	problems: string[]
}

const emptyReport = (): ProvidedSyncReport => ({
	imported: [],
	upgraded: [],
	held: [],
	keptEdited: 0,
	goneUpstream: 0,
	dismissed: [],
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
					const reason = e instanceof Error ? e.message : String(e)
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
	// 🚧 (M2c) Deleted by an administrator's hand: it stays deleted.
	if (!found && dismissedProvidedBooks((row as { provided?: unknown }).provided).has(slug)) {
		report.dismissed.push(slug)
		return
	}
	if (found && found.mark.version === row.version) return
	if (found && compareVersions(row.version, found.mark.version) < 0) return
	const raw = await readProvidedFile(row, path)
	if (raw === null) throw new Error("the package has no such file")
	const sha256 = createHash("sha256").update(raw).digest("hex")
	// 🚧 (M2c fix) An entry of a ruleset type nothing here declares is refused
	// out loud — never imported as world lore in its place.
	const { text, refused } = withoutUndeclaredTypes(raw)
	if (!found) {
		await importFresh(db, row, adminId, slug, text, sha256)
		report.imported.push(slug)
		return refused
	}
	await upgrade(db, row, found.book, found.mark, text, sha256, report)
	return refused
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

/**
 * 🚧 (M2c) Write a hand-deleted provided book's tombstone onto its plugin's row
 * (`plugins.provided.dismissed[slug]`), inside the delete's own transaction.
 * A book whose plugin is gone (no row) needs none.
 */
export async function recordDismissedProvidedBook(
	tx: Db,
	mark: { plugin: string; slug: string; version: string },
	byUserId: number | null
): Promise<void> {
	const entry = JSON.stringify({ at: new Date().toISOString(), by: byUserId, version: mark.version })
	await tx.execute(sql`
		update ${schema.plugins}
		set ${sql.identifier("provided")} = jsonb_set(
			coalesce(${schema.plugins.provided}, '{}'::jsonb) || jsonb_build_object('dismissed', coalesce(${schema.plugins.provided} -> 'dismissed', '{}'::jsonb)),
			ARRAY['dismissed', ${mark.slug}]::text[],
			${entry}::jsonb,
			true
		)
		where ${schema.plugins.pluginId} = ${mark.plugin}
	`)
}

/** Import a new provided book and write its marks. */
async function importFresh(
	db: Db,
	row: PluginRow,
	adminId: number,
	slug: string,
	text: string,
	sha256: string
): Promise<void> {
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
	const { book, card } = await importLorebookDocument(adminId, text)
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
					entries
				} satisfies ProvidedBookMark
			}
		})
		.where(eq(schema.lorebooks.id, book.id))
	await markBroughtCharacters(db, row, slug, book.id, before)
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
	for (const c of cards) {
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
		await tx
			.update(schema.lorebooks)
			.set({
				extraJson: {
					...(book.extraJson as object),
					provided: {
						...mark,
						version: row.version,
						sha256,
						entries: next,
						held: undefined
					}
				}
			})
			.where(eq(schema.lorebooks.id, book.id))
	})
	if (written) {
		const { queueImportedBook } = await import("$lib/server/sockets/lorebooks")
		queueImportedBook(book.id, book.name)
	}
	report.upgraded.push(mark.slug)
}

async function saveMark(
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
	if (ids.length)
		await db
			.update(schema.characters)
			.set({ isDeleted: true })
			.where(inArray(schema.characters.id, ids))
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
		const dismissal = found ? undefined : dismissedProvidedBooks(row.provided).get(slug)
		if (dismissal) {
			out.push({
				slug,
				name: slug,
				version: dismissal.version || row.version,
				lorebookId: null,
				state: "dismissed",
				why: "Deleted by an administrator, so it is not imported again. To bring it back, uninstall the plugin and install it again."
			})
			continue
		}
		if (!found) {
			const reason = failed.get(slug)
			out.push({
				slug,
				name: slug,
				version: row.version,
				lorebookId: null,
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
