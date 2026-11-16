/**
 * 🚧 **Redlines** — an **Edit history** (owner, 2026-11-13/14), of three
 * subjects: an entry, a cast version, a card version. Every save that changes
 * an entry's name, content, keys or typed fields, a dated change's fields, or
 * a version's counted profile keys (`VERSION_REDLINE_KEYS`) keeps what each
 * changed key held before and after, when, and who (`lore_redlines`). An
 * entry's and a cast version's rows are the lorebook's; a card version's are
 * the card owner's.
 *
 * - **One writer.** `recordRedline` is the only insert; every writer of an
 *   entry's text calls it (or `recordEntryRedline`) on the handle of the
 *   write it records — inside a transaction, its `tx`. An edit that changes
 *   nothing records nothing.
 * - **The limit.** After a row is written, its subject keeps its
 *   `REDLINES_KEPT` newest rows, and never loses the newest row a person
 *   wrote.
 * - **A turn taken back takes its row with it.** Back, a swipe, a regenerate
 *   and a delete record nothing: when the retraction reverts a run's write,
 *   its key goes from that write's row (`takeBackRedline`), and Forward puts
 *   it back (`putBackRedline`). Matched by entry + session + run + message.
 *   A write the retraction leaves standing (kept, spliced into a later run's
 *   write, or overwritten by a person) keeps its row: the text did pass
 *   through it.
 * - **A version a session made, taken back, takes its rows by cascade, and
 *   Forward puts them back** (`redlinesOfVersion` / `putBackVersionRedlines`).
 * - A cast version retired and copied by an edit hands its rows to the copy
 *   (`moveVersionRedlines`); Back deleting a version takes its rows by cascade.
 * - It never travels: not copied, not exported,
 *   cleared by Share as a lorebook (`tableRegistry.ts`, `ownBook.ts`).
 *
 * ⚠ Not the per-turn undo record (`lore_imprints`, `imprints.ts`): that is a
 * session's and goes with it. Every function takes its handle; never
 * statically imports `$lib/server/db`.
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { ENTRY_DATE_PARTS } from "$lib/shared/lorebooks/amendments"
import { profileOf } from "$lib/shared/characters/profile"

/** Why an edit was made: the values of the `lore_redlines.cause` CHECK. */
export const REDLINE_CAUSES = [
	"save",
	"routine",
	"apply",
	"revert",
	"take-back",
	"restore"
] as const
export type RedlineCause = (typeof REDLINE_CAUSES)[number]

/** How many rows an entry keeps (the newest a person wrote is kept beyond it). */
export const REDLINES_KEPT = 50

/** A value as kept: `{ v }`, or null where the key was absent. */
export type RedlineValue = { v: unknown } | null
export type RedlineChanges = Record<
	string,
	{ before: RedlineValue; after: RedlineValue }
>
export type RedlineRow = typeof schema.loreRedlines.$inferSelect

/**
 * Who made an edit:
 * - a person (`userId`; `sessionId` when the edit came from a session, as an Apply's does);
 * - a run (`run`: its session, the turn's message, the run id, and the routine's or
 *   pipeline's shown name as it reads now — never a model or a connection);
 * - an Apply made by itself (`sessionId` alone).
 */
export type RedlineAuthor =
	| { userId: number; sessionId?: number | null }
	| {
			run: {
				sessionId: number
				messageId: number | null
				runId: string | null
				shownAs: string | null
			}
	  }
	| { sessionId: number }

const T = schema.loreRedlines

/** A value as JSON keeps it — a `Date` as its ISO string. */
const plain = (v: unknown): unknown =>
	v === undefined ? undefined : JSON.parse(JSON.stringify(v))
const wrap = (v: unknown): RedlineValue =>
	v === undefined ? null : { v: plain(v) }

/** One spelling of a value, keys sorted; absent is its own answer. */
function canonical(v: unknown): string {
	if (v === undefined) return "\u0000absent"
	if (v instanceof Date) return JSON.stringify(v.toISOString())
	if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`
	if (v && typeof v === "object") {
		const o = v as Record<string, unknown>
		return `{${Object.keys(o)
			.filter((k) => o[k] !== undefined)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
			.join(",")}}`
	}
	return JSON.stringify(v)
}
const sameValue = (a: unknown, b: unknown): boolean =>
	canonical(a) === canonical(b)

/**
 * **Record one edit.** `before` and `after` are wire values (an entry's
 * `name`, `content`, `keys`, `secondaryKeys` and typed fields by key; a dated
 * change's `fields` by key), a key missing from the object is absent.
 * Only `keys` — the keys the write named — are compared, so a machine field
 * the write did not name (`graphed`, `isCompleted`) never counts. Returns
 * the row's id, or null when nothing changed.
 */
export async function recordRedline(
	db: Db,
	input: {
		before: Record<string, unknown>
		after: Record<string, unknown>
		keys: readonly string[]
		cause: RedlineCause
		by: RedlineAuthor
	} & (
		| {
				entryId: number
				/** The dated change edited; null or absent = the entry itself. */
				amendmentId?: number | null
				characterVersionId?: never
		  }
		| {
				characterVersionId: number
				entryId?: never
				amendmentId?: never
		  }
	)
): Promise<number | null> {
	const has = (o: Record<string, unknown>, k: string) =>
		Object.prototype.hasOwnProperty.call(o, k)
	const changes: RedlineChanges = {}
	for (const key of new Set(input.keys)) {
		const before = has(input.before, key) ? input.before[key] : undefined
		const after = has(input.after, key) ? input.after[key] : undefined
		if (sameValue(before, after)) continue
		changes[key] = { before: wrap(before), after: wrap(after) }
	}
	if (!Object.keys(changes).length) return null
	const by = input.by
	const author =
		"run" in by
			? {
					userId: null,
					sessionId: by.run.sessionId,
					messageId: by.run.messageId,
					runId: by.run.runId,
					shownAs: by.run.shownAs?.trim() || null
				}
			: "userId" in by
				? {
						userId: by.userId,
						sessionId: by.sessionId ?? null,
						messageId: null,
						runId: null,
						shownAs: null
					}
				: {
						userId: null,
						sessionId: by.sessionId,
						messageId: null,
						runId: null,
						shownAs: null
					}
	const [row] = await db
		.insert(T)
		.values({
			entryId: input.entryId ?? null,
			characterVersionId: input.characterVersionId ?? null,
			amendmentId: input.amendmentId ?? null,
			changes,
			cause: input.cause,
			...author
		})
		.returning({ id: T.id })
	await keepNewest(
		db,
		input.entryId != null
			? { entryId: input.entryId }
			: { characterVersionId: input.characterVersionId! }
	)
	return row?.id ?? null
}

/**
 * The limit: a subject keeps its `REDLINES_KEPT` newest rows, and the newest
 * row a person wrote however old it is.
 */
async function keepNewest(
	db: Db,
	subject: { entryId: number } | { characterVersionId: number }
): Promise<void> {
	const rows = await db
		.select({ id: T.id, userId: T.userId })
		.from(T)
		.where(
			"entryId" in subject
				? eq(T.entryId, subject.entryId)
				: eq(T.characterVersionId, subject.characterVersionId)
		)
		.orderBy(desc(T.id))
	if (rows.length <= REDLINES_KEPT) return
	const person = rows.find((r) => r.userId != null)?.id
	const evicted = rows
		.slice(REDLINES_KEPT)
		.map((r) => r.id)
		.filter((id) => id !== person)
	if (evicted.length) await db.delete(T).where(inArray(T.id, evicted))
}

/**
 * The wire keys an entry edit counts, of those a write names: the name (on a
 * type with a title), the content, the two key lists and the type's declared
 * typed fields, the decay rate, and a Beginning's `year`, `month` and `day` on
 * a type that takes one. Never a mark, a position, an anchor, `archived` or a machine
 * field.
 */
export async function redlineKeysOf(
	typeId: string,
	named: Iterable<string>
): Promise<string[]> {
	const { entryDeclaration, declaredFields } = await import(
		"$lib/server/entries/declarations"
	)
	const { takesBeginning } = await import("$lib/server/utils/lorebookEntries")
	const counted = new Set([
		"content",
		"keys",
		"secondaryKeys",
		"decayRate",
		...declaredFields(typeId)
	])
	if (takesBeginning(typeId))
		for (const part of ENTRY_DATE_PARTS) counted.add(part)
	if (entryDeclaration(typeId)?.roles.title) counted.add("name")
	return [...new Set(named)].filter((k) => counted.has(k))
}

/** The wire key of a per-turn record's field address (`title` → `name`, `fields.x` → `x`); null for one an edit does not count. */
export function redlineKeyOfAddress(address: string): string | null {
	if (address.startsWith("fields.")) return address.slice("fields.".length)
	if (address === "title") return "name"
	if (
		address === "content" ||
		address === "keys" ||
		address === "secondaryKeys"
	)
		return address
	return null
}

/** A stored entry row's wire values for `keys`: the title column as `name`, a typed field with its declared default standing in. */
export async function entryWireValues(
	row: Record<string, unknown>,
	keys: readonly string[]
): Promise<Record<string, unknown>> {
	const { entryDeclaration, fieldDefault } = await import(
		"$lib/server/entries/declarations"
	)
	const { takesBeginning } = await import("$lib/server/utils/lorebookEntries")
	const typeId = row.typeId as string
	const titleColumn = entryDeclaration(typeId)?.roles.title as
		| string
		| undefined
	const fields = (row.fields ?? {}) as Record<string, unknown>
	const out: Record<string, unknown> = {}
	for (const key of keys) {
		if (key === "name")
			out.name = titleColumn ? (row[titleColumn] ?? "") : null
		else if (key === "content") out.content = row.content ?? null
		else if (key === "keys" || key === "secondaryKeys")
			out[key] = [...((row[key] as string[] | null) ?? [])]
		else if (key === "decayRate") out.decayRate = row.decayRate ?? 0
		else if (
			takesBeginning(typeId) &&
			ENTRY_DATE_PARTS.includes(key as never)
		)
			out[key] = typeof fields[key] === "number" ? fields[key] : null
		else out[key] = fields[key] ?? fieldDefault(typeId, key)
	}
	return out
}

/**
 * **Record an edit of the entry itself** from its stored row read before the
 * write and the row after it. `named` is what the write named: wire keys
 * (`name`, `content`, a typed field's key) or per-turn field addresses
 * (`title`, `fields.x`), either.
 */
export async function recordEntryRedline(
	db: Db,
	input: {
		before: Record<string, unknown>
		after: Record<string, unknown>
		named: Iterable<string>
		cause: RedlineCause
		by: RedlineAuthor
	}
): Promise<number | null> {
	const typeId = input.after.typeId as string
	const wire = [...input.named].map((k) =>
		k === "title" || k.startsWith("fields.") ? redlineKeyOfAddress(k)! : k
	)
	const keys = await redlineKeysOf(typeId, wire)
	if (!keys.length) return null
	return recordRedline(db, {
		entryId: input.after.id as number,
		amendmentId: null,
		before: await entryWireValues(input.before, keys),
		after: await entryWireValues(input.after, keys),
		keys,
		cause: input.cause,
		by: input.by
	})
}

// ── A character version's edit ──────────────────────────────────────────────

/** The profile keys a version's edit counts. Never strokes, sprite set, extensions, the label, place or node columns. */
export const VERSION_REDLINE_KEYS = [
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
	"creatorNotes",
	"likeness",
	"timbre",
	"faceMediaId"
] as const

/** A version row's value per key; a key in `row.follows` reads `{ follow: true }`. */
export function versionWireValues(
	row: Record<string, unknown>,
	keys: readonly string[]
): Record<string, unknown> {
	const profile = profileOf(row) as unknown as Record<string, unknown>
	const follows = Array.isArray(row.follows) ? (row.follows as string[]) : []
	const out: Record<string, unknown> = {}
	for (const key of keys)
		out[key] = follows.includes(key) ? { follow: true } : profile[key]
	return out
}

/**
 * **Record an edit of a character version** from its row read before the write
 * and the row after it (the copy, for an edit that retired and copied).
 * `named` is what the write named; only its counted keys are compared.
 */
export async function recordVersionRedline(
	db: Db,
	input: {
		before: Record<string, unknown>
		after: Record<string, unknown>
		named: Iterable<string>
		cause: RedlineCause
		by: RedlineAuthor
	}
): Promise<number | null> {
	const counted = new Set<string>(VERSION_REDLINE_KEYS)
	const keys = [...new Set(input.named)].filter((k) => counted.has(k))
	if (!keys.length) return null
	return recordRedline(db, {
		characterVersionId: input.after.id as number,
		before: versionWireValues(input.before, keys),
		after: versionWireValues(input.after, keys),
		keys,
		cause: input.cause,
		by: input.by
	})
}

/** Re-key every row of one version to another (an edit that retired a version and copied it); returns how many. */
export async function moveVersionRedlines(
	db: Db,
	fromVersionId: number,
	toVersionId: number
): Promise<number> {
	const rows = await db
		.update(T)
		.set({ characterVersionId: toVersionId })
		.where(eq(T.characterVersionId, fromVersionId))
		.returning({ id: T.id })
	return rows.length
}

// ── A turn taken back, and put back ─────────────────────────────────────────

/** What `takeBackRedline` took, JSON-safe (it rides the forward stack): enough to put it back. */
export interface RedlineTaken {
	redlineId: number
	key: string
	change: { before: RedlineValue; after: RedlineValue }
	/** The whole row, when taking the key left it empty and it was deleted (`createdAt` as ISO). */
	row: (Omit<RedlineRow, "createdAt"> & { createdAt: string }) | null
}

/**
 * A run's write on an entry was reverted with its turn: the key goes from
 * that write's row (the newest row of the same entry, session, run and
 * message holding the key), and the row goes when no key is left. Null when
 * no row holds it. With `amendmentId` the row is the one on that dated
 * version, and `address` is the version's wire key itself.
 */
export async function takeBackRedline(
	db: Db,
	at: {
		entryId: number
		amendmentId?: number
		sessionId: number
		messageId: number | null
		runId: string | null
		address: string
	}
): Promise<RedlineTaken | null> {
	const key = at.amendmentId != null ? at.address : redlineKeyOfAddress(at.address)
	if (key == null) return null
	const [row] = (await db
		.select()
		.from(T)
		.where(
			and(
				eq(T.entryId, at.entryId),
				at.amendmentId != null ? eq(T.amendmentId, at.amendmentId) : isNull(T.amendmentId),
				eq(T.cause, "routine"),
				eq(T.sessionId, at.sessionId),
				at.runId == null ? isNull(T.runId) : eq(T.runId, at.runId),
				at.messageId == null
					? isNull(T.messageId)
					: eq(T.messageId, at.messageId),
				sql`jsonb_exists(${T.changes}, ${key})`
			)
		)
		.orderBy(desc(T.id))
		.limit(1)) as RedlineRow[]
	if (!row) return null
	const { [key]: change, ...rest } = row.changes
	if (Object.keys(rest).length) {
		await db.update(T).set({ changes: rest }).where(eq(T.id, row.id))
		return { redlineId: row.id, key, change: change!, row: null }
	}
	await db.delete(T).where(eq(T.id, row.id))
	return {
		redlineId: row.id,
		key,
		change: change!,
		row: {
			...row,
			createdAt: (row.createdAt instanceof Date
				? row.createdAt
				: new Date(row.createdAt)
			).toISOString()
		}
	}
}

/** Forward: the key goes back on its row, or the row comes back whole (its id kept) when it was deleted. */
export async function putBackRedline(
	db: Db,
	taken: RedlineTaken
): Promise<void> {
	if (taken.row) {
		if (taken.row.entryId == null) return
		const [entry] = await db
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, taken.row.entryId))
			.limit(1)
		if (!entry) return
		if (taken.row.amendmentId != null) {
			const [version] = await db
				.select({ id: schema.entryAmendments.id })
				.from(schema.entryAmendments)
				.where(eq(schema.entryAmendments.id, taken.row.amendmentId))
				.limit(1)
			if (!version) return
		}
		await db
			.insert(T)
			.values({ ...taken.row, createdAt: new Date(taken.row.createdAt) })
			.onConflictDoNothing()
		return
	}
	const [row] = (await db
		.select()
		.from(T)
		.where(eq(T.id, taken.redlineId))
		.limit(1)) as RedlineRow[]
	if (!row) return
	await db
		.update(T)
		.set({ changes: { ...row.changes, [taken.key]: taken.change } })
		.where(eq(T.id, row.id))
}

/** Every row on a dated version, oldest first, JSON-safe: what its deletion's cascade will take. */
export async function redlinesOfVersion(
	db: Db,
	amendmentId: number
): Promise<NonNullable<RedlineTaken["row"]>[]> {
	const rows = (await db
		.select()
		.from(T)
		.where(eq(T.amendmentId, amendmentId))
		.orderBy(T.id)) as RedlineRow[]
	return rows.map((row) => ({
		...row,
		createdAt: (row.createdAt instanceof Date
			? row.createdAt
			: new Date(row.createdAt)
		).toISOString()
	}))
}

/** Forward: a version's rows come back whole (ids kept), when the entry and the version exist. */
export async function putBackVersionRedlines(
	db: Db,
	rows: readonly NonNullable<RedlineTaken["row"]>[]
): Promise<void> {
	for (const row of rows) {
		if (row.entryId == null || row.amendmentId == null) continue
		const [entry] = await db
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, row.entryId))
			.limit(1)
		if (!entry) continue
		const [version] = await db
			.select({ id: schema.entryAmendments.id })
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, row.amendmentId))
			.limit(1)
		if (!version) continue
		await db
			.insert(T)
			.values({ ...row, createdAt: new Date(row.createdAt) })
			.onConflictDoNothing()
	}
}

// ── Clearing and counting ───────────────────────────────────────────────────

/** Which rows: one entry's, one cast or card version's, or every entry's and cast version's of a lorebook. */
export type RedlineScope =
	| { entryId: number }
	| { characterVersionId: number }
	| { lorebookId: number }

const scopeWhere = (scope: RedlineScope) =>
	"entryId" in scope
		? eq(T.entryId, scope.entryId)
		: "characterVersionId" in scope
			? eq(T.characterVersionId, scope.characterVersionId)
			: or(
					// Subqueries, so a book of any size is one statement each.
					inArray(
						T.entryId,
						sql`(select ${schema.lorebookEntries.id} from ${schema.lorebookEntries} where ${schema.lorebookEntries.lorebookId} = ${scope.lorebookId})`
					),
					inArray(
						T.characterVersionId,
						sql`(select ${schema.characterVersions.id} from ${schema.characterVersions} where ${schema.characterVersions.lorebookId} = ${scope.lorebookId})`
					)
				)

/** Delete an entry's or a lorebook's rows; returns how many. The caller checks who may. */
export async function clearRedlines(
	db: Db,
	scope: RedlineScope
): Promise<number> {
	const rows = await db
		.delete(T)
		.where(scopeWhere(scope))
		.returning({ id: T.id })
	return rows.length
}

/** How many rows an entry or a lorebook keeps. */
export async function countRedlines(
	db: Db,
	scope: RedlineScope
): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(T)
		.where(scopeWhere(scope))
	return Number(row?.n ?? 0)
}

/** Every row on the pub: how many, and the bytes they hold (Admin › Data). */
export async function redlineSummary(
	db: Db
): Promise<{ count: number; bytes: number }> {
	const [row] = await db
		.select({
			n: sql<number>`count(*)::int`,
			bytes: sql<number>`coalesce(sum(pg_column_size(${T}.*)), 0)::bigint`
		})
		.from(T)
	return { count: Number(row?.n ?? 0), bytes: Number(row?.bytes ?? 0) }
}

/** Delete every row on the pub (Admin › Data); returns how many. */
export async function clearAllRedlines(db: Db): Promise<number> {
	const rows = await db.delete(T).returning({ id: T.id })
	return rows.length
}
