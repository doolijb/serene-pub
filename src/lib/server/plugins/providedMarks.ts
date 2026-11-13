/**
 * 🚧 (M2c) The mark a plugin's **provided book** carries, and the pure helpers
 * around it. No schema change: the ownership rule is data in two JSON
 * columns that exist already (no column was added for it). The M2e helpers
 * (`providedOwnerPresent`, `providedOwnersPresent`) take the `db` (or `tx`) they are handed.
 *
 *  · a book: `lorebooks.extra_json.provided = { plugin, slug, version, sha256,
 *    uuid, entries, cast?, stats?, rules? }` (the last three since lane pb,
 *    2026-11-05: what the cast members, stat values and rules held when written);
 *  · a character the book brought: `characters.extensions.serenepub.provided =
 *    { plugin, slug, version, uuid }`.
 *
 * ## A mark only counts on the row it was written for
 * Each mark names the row's own `uuid`. A copy of a book (`duplicateLorebookRows`
 * drops the uuid and mints a fresh one) or a character card re-imported from a
 * file reads as no plugin's: the mark is there, the uuid is not the row's.
 * `markedBook` / `markedCharacter` are the only readers, and both check it.
 *
 * ## A person's edit can never mint it
 * `lorebooks:update` writes an allowlist with no `extra_json`; a book file's
 * `extra_json` is rebuilt from three numbers (`extractLorebookLevelExtraJson`);
 * the character update keeps the STORED mark and drops a sent one
 * (`keepStoredProvidedMark`), and a character import drops a file's
 * (`withoutProvidedMark`).
 */

/** What the book remembers of one provided entry. */
export interface ProvidedEntryMark {
	/** The `lorebook_entries.id` it landed as. */
	id: number
	/** The row's content hash when the plugin last wrote it: a different hash now means a person edited it. */
	hash: string
	/** The hash of the file's entry that was written: the same upstream means nothing to do. */
	up: string
}

/** What the book remembers of one provided cast member (a binding, and the card it carries). */
export interface ProvidedCastMark {
	/** The `lorebook_bindings.id` it landed as. */
	binding: number
	/** The card (`characters.id`) bound to it when written; null for a binding with no card. */
	character: number | null
	/** The sha256 of what the binding and its card hold now, when the plugin last wrote it: a different one now means a person edited it. */
	hash: string
	/** The sha256 of the file's cast member that was written: the same upstream means nothing to do. */
	up: string
}

/** What the book remembers of one provided stat value (a template-layer `attribute_values` row). */
export interface ProvidedStatMark {
	/** The `attribute_values.id` it landed as. */
	id: number
	/** The sha256 of the row's value and note when the plugin last wrote it: a different one now means a person edited it. */
	hash: string
	/** The sha256 of the file's stat value that was written: the same upstream means nothing to do. */
	up: string
}

export interface ProvidedBookMark {
	plugin: string
	slug: string
	version: string
	sha256: string
	uuid: string
	entries: Record<string, ProvidedEntryMark>
	/**
	 * The cast members written, by the file's stable key (`providedBooks.ts fileCastOf`). Absent on a book
	 * imported before cast was carried: its first upgrade finds each member by name and records what matches.
	 */
	cast?: Record<string, ProvidedCastMark>
	/** The stat values written, by `<owner kind>|<owner key>|<slot id>`. Absent as `cast` is. */
	stats?: Record<string, ProvidedStatMark>
	/**
	 * The book's rules (its two ruleset columns) as the last import or upgrade left them: the baseline an upgrade
	 * compares the row against, so rules a person changed since are kept and rules nobody touched follow the file.
	 * Absent on a book imported before the file could name rules: its first upgrade reads a default as untouched.
	 */
	rules?: { primaryRuleset: string | null; rulesetVersion: string | null }
	/** A newer version that was NOT written (the book's write mode is Review or Off). */
	held?: { version: string; sha256: string; mode: "review" | "off" }
	/** 🚧 (M2e) An administrator switched this book off: hidden from lists, pickers and attach menus, rows kept. Absent: shown. */
	disabled?: true
}

export interface ProvidedCharacterMark {
	plugin: string
	slug: string
	version: string
	uuid: string
}

import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { primerRowEditRefusal } from "$lib/shared/lorebooks/primerRow"

const isObject = (v: unknown): v is Record<string, any> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/** The book's mark when it is genuinely this row's (`uuid` matches), else null. */
export function markedBook(
	extraJson: unknown,
	bookUuid: string
): ProvidedBookMark | null {
	const m = isObject(extraJson) ? extraJson.provided : undefined
	if (
		!isObject(m) ||
		typeof m.plugin !== "string" ||
		typeof m.slug !== "string" ||
		typeof m.version !== "string" ||
		m.uuid !== bookUuid
	)
		return null
	return {
		plugin: m.plugin,
		slug: m.slug,
		version: m.version,
		sha256: typeof m.sha256 === "string" ? m.sha256 : "",
		uuid: m.uuid,
		entries: isObject(m.entries) ? (m.entries as ProvidedBookMark["entries"]) : {},
		...(isObject(m.cast) ? { cast: m.cast as ProvidedBookMark["cast"] } : {}),
		...(isObject(m.stats) ? { stats: m.stats as ProvidedBookMark["stats"] } : {}),
		...(isObject(m.rules) &&
		(typeof m.rules.primaryRuleset === "string" || m.rules.primaryRuleset === null) &&
		(typeof m.rules.rulesetVersion === "string" || m.rules.rulesetVersion === null)
			? { rules: { primaryRuleset: m.rules.primaryRuleset, rulesetVersion: m.rules.rulesetVersion } }
			: {}),
		...(isObject(m.held) ? { held: m.held as ProvidedBookMark["held"] } : {}),
		...(m.disabled === true ? { disabled: true as const } : {})
	}
}

/** 🚧 (M2e) A provided book's delete refusal (one sentence; the Delete control is also absent). */
export const PROVIDED_BOOK_DELETE_REFUSAL =
	"A lorebook that comes with the pub or a plugin can't be deleted; an administrator can disable it to hide it everywhere."

// 🚧 (m2e-F-D) The read-only sentence lives in `$lib/shared` so the client says the same; re-exported here.
export { primerRowEditRefusal }

/**
 * 🚧 (m2e-F-D) The names of the given plugins (`plugins.name`, else the id), for
 * a primer row's sentence and its `readOnly.pluginName`. `core` is never asked:
 * core's rows name "the pub" (`null`). Takes the `db` (or `tx`) it is handed.
 */
export async function providedOwnerNames(
	db: Db,
	pluginIds: Iterable<string>
): Promise<ReadonlyMap<string, string>> {
	const ids = [...new Set(pluginIds)].filter((id) => id !== "core")
	if (!ids.length) return new Map()
	const rows = await db
		.select({ id: schema.plugins.pluginId, name: schema.plugins.name })
		.from(schema.plugins)
		.where(inArray(schema.plugins.pluginId, ids))
	return new Map(rows.map((r) => [r.id, r.name || r.id]))
}

/**
 * 🚧 (m2e-F-D) The one decider for "a person may not edit this book": the refusal sentence when the book is
 * a primer row (`kind = "starter_kit"`, its OWN genuine provided mark, the mark's owner present), else null.
 * Called at the socket doors that act for a person, never by the syncs or the admin disable/enable.
 * Takes the `db` (or `tx`) it is handed.
 */
export async function primerRowEditProblem(
	db: Db,
	lorebookId: number
): Promise<string | null> {
	const [book] = await db
		.select({
			kind: schema.lorebooks.kind,
			uuid: schema.lorebooks.uuid,
			extraJson: schema.lorebooks.extraJson
		})
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	if (!book || book.kind !== "starter_kit") return null
	const mark = markedBook(book.extraJson, book.uuid)
	if (!mark || !(await providedOwnerPresent(db, mark.plugin))) return null
	if (mark.plugin === "core") return primerRowEditRefusal(null)
	const names = await providedOwnerNames(db, [mark.plugin])
	return primerRowEditRefusal(names.get(mark.plugin) ?? mark.plugin)
}

/** §0-D (2026-11-04): a provided or primer book keeps its cast's own names and faces; the person's clone takes them. */
export const PROVIDED_BOOK_CAST_REFUSAL =
	"A lorebook that comes with the pub or a plugin keeps its cast's names and faces; clone it to give them your own."

/** 🚧 (M2e) True when the row's OWN provided mark says disabled. Pure; the one JS-side decider for "hidden". */
export function isDisabledProvidedBook(
	extraJson: unknown,
	bookUuid: string
): boolean {
	return markedBook(extraJson, bookUuid)?.disabled === true
}

/**
 * 🚧 (M2e) True when attaching this book would be a NEW attach of a disabled provided book: a session
 * already reading it (its `lorebookId` is this book) keeps reading it. Not a permission check.
 */
export async function isNewAttachOfDisabledBook(
	db: Db,
	lorebookId: number,
	sessionId?: number | null
): Promise<boolean> {
	const [book] = await db
		.select({ uuid: schema.lorebooks.uuid, extraJson: schema.lorebooks.extraJson })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	if (!book || !isDisabledProvidedBook(book.extraJson, book.uuid)) return false
	if (sessionId == null) return true
	const [now] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return now?.lorebookId !== lorebookId
}

/**
 * 🚧 (m3-core, ★M3-1 "Pub wide", owner 2026-11-05) The ids, among `lorebookIds` (every lorebook when absent), of the
 * provided books every signed-in person may READ though they are not theirs: own genuine mark, owner present, not
 * disabled, never a session's own notes. `userId == null` → empty; an empty `lorebookIds` → empty without a query.
 * Not a write permission: every write keeps `assertOwnedBook`; not `isDisabledProvidedBook` / `shownLorebook` (which
 * only hide). Takes the `db` (or `tx`) it is handed.
 */
export async function providedBooksReadableBy(
	db: Db,
	userId: number | null | undefined,
	lorebookIds?: readonly number[]
): Promise<ReadonlySet<number>> {
	if (userId == null) return new Set()
	if (lorebookIds && lorebookIds.length === 0) return new Set()
	const rows = await db
		.select({
			id: schema.lorebooks.id,
			uuid: schema.lorebooks.uuid,
			extraJson: schema.lorebooks.extraJson
		})
		.from(schema.lorebooks)
		.where(
			and(
				isNull(schema.lorebooks.sessionId),
				sql`${schema.lorebooks.extraJson}->'provided' IS NOT NULL`,
				shownLorebook(),
				lorebookIds ? inArray(schema.lorebooks.id, [...lorebookIds]) : undefined
			)
		)
	const live = rows.filter((r) => markedBook(r.extraJson, r.uuid))
	const present = await providedOwnersPresent(db, live)
	return new Set(
		live
			.filter((r) => {
				const m = markedBook(r.extraJson, r.uuid)
				return !!m && present.has(m.plugin) && !isDisabledProvidedBook(r.extraJson, r.uuid)
			})
			.map((r) => r.id)
	)
}

/**
 * 🚧 (M2e) SQL twin of `isDisabledProvidedBook`: TRUE unless the row's provided
 * mark is its own (`uuid` matches) and `disabled` is true. Every list, picker
 * and attach reader ANDs this in; no one re-derives it. Readers that load a
 * book INTO a session do not use it.
 */
export function shownLorebook(
	table: { extraJson: unknown; uuid: unknown } = schema.lorebooks
): SQL {
	const extra = table.extraJson as SQL
	const uuid = table.uuid as SQL
	return sql`NOT (coalesce(${extra}->'provided'->>'uuid' = ${uuid}::text, false) AND coalesce(${extra}->'provided'->>'disabled' = 'true', false))`
}

/** 🚧 (M2e) Whether a mark's owner is present: core always, a plugin while its row exists. */
export async function providedOwnerPresent(
	db: Db,
	pluginId: string
): Promise<boolean> {
	if (pluginId === "core") return true
	const [r] = await db
		.select({ id: schema.plugins.pluginId })
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, pluginId))
		.limit(1)
	return !!r
}

/** 🚧 (M2e) The owners, among the plugin ids the given books' genuine marks name, that are present ("core" always). */
export async function providedOwnersPresent(
	db: Db,
	books: ReadonlyArray<{ extraJson: unknown; uuid: string }>
): Promise<ReadonlySet<string>> {
	const named = new Set<string>()
	for (const b of books) {
		const m = markedBook(b.extraJson, b.uuid)
		if (m) named.add(m.plugin)
	}
	const present = new Set<string>(named.has("core") ? ["core"] : [])
	const ids = [...named].filter((x) => x !== "core")
	if (ids.length) {
		const rows = await db
			.select({ id: schema.plugins.pluginId })
			.from(schema.plugins)
			.where(inArray(schema.plugins.pluginId, ids))
		for (const r of rows) present.add(r.id)
	}
	return present
}

/** The character's mark when it is genuinely this row's, else null. */
export function markedCharacter(
	extensions: unknown,
	characterUuid: string
): ProvidedCharacterMark | null {
	const m = isObject(extensions) ? extensions.serenepub?.provided : undefined
	if (
		!isObject(m) ||
		typeof m.plugin !== "string" ||
		typeof m.slug !== "string" ||
		m.uuid !== characterUuid
	)
		return null
	return {
		plugin: m.plugin,
		slug: m.slug,
		version: typeof m.version === "string" ? m.version : "",
		uuid: m.uuid
	}
}

/**
 * The SQL twin of `markedCharacter` (as `shownLorebook` is of
 * `isDisabledProvidedBook`): TRUE when the card's `extensions.serenepub.provided`
 * is a genuine mark (`plugin` and `slug` strings, `uuid` its own). Such a card
 * is a provided book's hidden **carrier** card (★S4-1, 2026-11-08). Every card
 * list, picker and search reader ANDs `NOT genuineProvidedMarkSql()`; no one
 * re-derives it. A read of one card by id does not use it.
 */
export function genuineProvidedMarkSql(): SQL {
	const mark = sql`${schema.characters.extensions}->'serenepub'->'provided'`
	return sql`coalesce(json_typeof(${mark}->'plugin') = 'string' AND json_typeof(${mark}->'slug') = 'string' AND ${mark}->>'uuid' = ${schema.characters.uuid}::text, false)`
}

/** `extensions` without any `serenepub.provided` (a file or a form cannot mint one). */
export function withoutProvidedMark<T extends Record<string, unknown> | undefined>(
	extensions: T
): T {
	const sp = isObject(extensions) ? (extensions as any).serenepub : undefined
	if (!isObject(sp) || !("provided" in sp)) return extensions
	const { provided: _drop, ...rest } = sp
	return { ...(extensions as object), serenepub: rest } as unknown as T
}

/** `next` carrying exactly the STORED mark (or none): a save never changes it. */
export function keepStoredProvidedMark(
	next: Record<string, unknown> | undefined,
	stored: unknown
): Record<string, unknown> | undefined {
	const cleaned = withoutProvidedMark(next)
	const kept = isObject(stored) ? (stored as any).serenepub?.provided : undefined
	if (!isObject(kept) || !isObject(cleaned)) return cleaned
	const sp = isObject((cleaned as any).serenepub) ? (cleaned as any).serenepub : {}
	return { ...cleaned, serenepub: { ...sp, provided: kept } }
}

/** The slug of a provided file: its basename without `.lorebook.json` / `.json`. */
export function providedSlugOf(path: string): string {
	const base = path.split("/").pop() ?? path
	return base.replace(/\.lorebook\.json$/i, "").replace(/\.json$/i, "")
}

/** `a.b.c` versions in order (numeric parts, then a prerelease tail as text); negative: a < b. */
export function compareVersions(a: string, b: string): number {
	const split = (v: string) => {
		const [core, pre = ""] = v.split(/-(.*)/s)
		return { n: core.split(".").map((x) => parseInt(x, 10) || 0), pre }
	}
	const x = split(a)
	const y = split(b)
	for (let i = 0; i < Math.max(x.n.length, y.n.length); i++) {
		const d = (x.n[i] ?? 0) - (y.n[i] ?? 0)
		if (d) return d
	}
	if (x.pre === y.pre) return 0
	if (!x.pre) return 1
	if (!y.pre) return -1
	// Prerelease tails like "pr-7": compare their numbers, then the text.
	const nx = parseInt(/(\d+)$/.exec(x.pre)?.[1] ?? "", 10)
	const ny = parseInt(/(\d+)$/.exec(y.pre)?.[1] ?? "", 10)
	if (Number.isFinite(nx) && Number.isFinite(ny) && nx !== ny) return nx - ny
	return x.pre < y.pre ? -1 : 1
}

/**
 * 🚧 (M2c) What core keeps on the plugin's row about the things it provides
 * (`plugins.provided`): `disabled` — a provided book switched off BEFORE it
 * had a row, by slug (once the book exists the mark lives on the book:
 * `ProvidedBookMark.disabled`, and the next sync moves this entry there).
 * The old `dismissed` tombstones are turned into `disabled` by a boot pass.
 */
export interface PluginProvidedState {
	disabled?: Record<string, ProvidedBookDisablement>
	/** 🚧 (M2c fix) A provided book whose last import or upgrade failed, by slug: the sentence and when. Cleared by the next success. */
	failed?: Record<string, { at: string; reason: string }>
	/** 🚧 (M2c fix) Entries the last import or upgrade refused, by slug: each names its entry and the type nothing here declares. */
	refused?: Record<string, string[]>
}

/** 🚧 (M2c fix) The failed and refused records out of a `plugins.provided` value (empty when absent or malformed). Pure. */
export function providedOutcomes(provided: unknown): {
	failed: ReadonlyMap<string, string>
	refused: ReadonlyMap<string, readonly string[]>
} {
	const failed = new Map<string, string>()
	const refused = new Map<string, readonly string[]>()
	const f = isObject(provided) ? provided.failed : undefined
	if (isObject(f))
		for (const [slug, v] of Object.entries(f))
			if (isObject(v) && typeof v.reason === "string") failed.set(slug, v.reason)
	const r = isObject(provided) ? provided.refused : undefined
	if (isObject(r))
		for (const [slug, v] of Object.entries(r))
			if (Array.isArray(v) && v.length) refused.set(slug, v.filter((x): x is string => typeof x === "string"))
	return { failed, refused }
}

/** One disabled provided book that has no row yet: when, by whom (null: unknown), at which version. */
export interface ProvidedBookDisablement {
	at: string
	by: number | null
	version: string
}

/** The disabled-before-imported slugs out of a `plugins.provided` value already read (empty when absent or malformed). Pure. */
export function disabledProvidedBooks(
	provided: unknown
): ReadonlyMap<string, ProvidedBookDisablement> {
	const out = new Map<string, ProvidedBookDisablement>()
	const d = isObject(provided) ? provided.disabled : undefined
	if (!isObject(d)) return out
	for (const [slug, v] of Object.entries(d))
		if (isObject(v) && typeof v.at === "string")
			out.set(slug, {
				at: v.at,
				by: typeof v.by === "number" ? v.by : null,
				version: typeof v.version === "string" ? v.version : ""
			})
	return out
}
