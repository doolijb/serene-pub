/**
 * 🚧 (M2b) The **user annex** store: one person's own JSON documents under an
 * owner (a plugin id, or `core`), in `user_annexes`. Every function takes `db`;
 * every transaction below uses only `tx`.
 *
 * - The person is whoever the caller resolved (the socket's user, the actor) —
 *   there is no function that lists people or reads across them.
 * - A write is checked in words: the key, the document, the declared field
 *   that covers the key (an undeclared key is refused by name), the field's
 *   shape. Then, in ONE transaction under an advisory lock on the person, the
 *   stored `version` is compared with `base` (a stale write is refused with the
 *   fresh document), the per-owner caps are counted over the projection, and
 *   the row is written with `version + 1` (a first write is 1).
 * - Accounts are soft-deleted, so the FK cascade does not fire: the
 *   user-deletion handler calls {@link removeUserAnnexesOfUser}. An uninstall
 *   that chooses "delete" calls {@link removeOwnerUserAnnexes}.
 * - The whole table rides in the pub's backups (a backup is the whole database).
 */
import { and, asc, eq, like, sql } from "drizzle-orm"
import {
	USER_ANNEX_LIMITS,
	annexFieldValueRefusal,
	userAnnexDocBytes,
	userAnnexDocRefusal,
	userAnnexFieldFor,
	userAnnexKeyRefusal,
	type AnnexFieldDecl,
	type UserAnnexEntryV1,
	type UserAnnexListRowV1,
	type UserAnnexWriteResult
} from "@serene-pub/sdk"
import { CORE_ANNEX_FIELDS } from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { normaliseAnnexField } from "$lib/server/sessions/annexFields"

type Row = typeof schema.userAnnexes.$inferSelect

const entryOf = (r: Row): UserAnnexEntryV1 => ({
	key: r.key,
	doc: r.doc,
	version: r.version,
	updatedAt: r.updatedAt.toISOString()
})

/** An owner's user-scoped annex fields: core's own, or a plugin's stored manifest's. No genre. */
export async function userAnnexFieldsOfOwner(
	db: Db,
	owner: string
): Promise<AnnexFieldDecl[]> {
	if (owner === "core")
		return CORE_ANNEX_FIELDS.filter((f) => f.scope === "user")
	const [p] = await db
		.select({ manifest: schema.plugins.manifest })
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, owner))
		.limit(1)
	const raw = (p?.manifest as { annexFields?: unknown } | null)?.annexFields
	if (!Array.isArray(raw)) return []
	const out: AnnexFieldDecl[] = []
	for (const r of raw) {
		const decl = normaliseAnnexField(r, `${owner}.annexFields`)
		if (decl && decl.scope === "user") out.push(decl)
	}
	return out
}

/** Why this key/doc cannot be stored under the owner's declaration, as a sentence; null when it can. */
function writeRefusal(
	fields: readonly AnnexFieldDecl[],
	owner: string,
	key: string,
	doc: unknown
): string | null {
	const keyWhy = userAnnexKeyRefusal(key)
	if (keyWhy) return keyWhy
	const docWhy = userAnnexDocRefusal(doc)
	if (docWhy) return docWhy
	const field = userAnnexFieldFor(fields, key)
	if (!field)
		return `'${key}' is not a user annex key '${owner}' declares — declare it with annexField({ key: '${key}', shape, scope: 'user' }).`
	const shapeWhy = annexFieldValueRefusal(
		{ key, shape: field.shape },
		{ value: doc }
	)
	return shapeWhy
}

/** Take the person's lock: all of one person's user-annex writes are serialised. */
async function lockPerson(tx: Db, userId: number): Promise<void> {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtext('user-annex'), ${userId})`
	)
}

/** The owner's rows for one person, under the lock's protection. */
async function rowsOf(tx: Db, userId: number, owner: string): Promise<Row[]> {
	return tx
		.select()
		.from(schema.userAnnexes)
		.where(
			and(
				eq(schema.userAnnexes.userId, userId),
				eq(schema.userAnnexes.owner, owner)
			)
		)
}

/** The caps, counted over what the owner's documents WOULD be: a sentence, or null. */
function capRefusal(projected: Map<string, unknown>): string | null {
	if (projected.size > USER_ANNEX_LIMITS.docsPerOwner)
		return `This extension may keep at most ${USER_ANNEX_LIMITS.docsPerOwner} documents for one person.`
	let bytes = 0
	for (const doc of projected.values()) bytes += userAnnexDocBytes(doc) ?? 0
	if (bytes > USER_ANNEX_LIMITS.bytesPerOwner)
		return `This extension may keep at most ${USER_ANNEX_LIMITS.bytesPerOwner} bytes of documents for one person; this would make ${bytes}.`
	return null
}

export async function getUserAnnex(
	db: Db,
	userId: number,
	owner: string,
	key: string
): Promise<UserAnnexEntryV1 | null> {
	const [r] = await db
		.select()
		.from(schema.userAnnexes)
		.where(
			and(
				eq(schema.userAnnexes.userId, userId),
				eq(schema.userAnnexes.owner, owner),
				eq(schema.userAnnexes.key, key)
			)
		)
		.limit(1)
	return r ? entryOf(r) : null
}

/** Escape LIKE wildcards in a prefix. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, "\\$&")

export async function listUserAnnex(
	db: Db,
	userId: number,
	owner: string,
	prefix?: string
): Promise<UserAnnexListRowV1[]> {
	const rows = await db
		.select({
			key: schema.userAnnexes.key,
			version: schema.userAnnexes.version,
			updatedAt: schema.userAnnexes.updatedAt
		})
		.from(schema.userAnnexes)
		.where(
			and(
				eq(schema.userAnnexes.userId, userId),
				eq(schema.userAnnexes.owner, owner),
				prefix
					? like(schema.userAnnexes.key, `${likeEscape(prefix)}%`)
					: undefined
			)
		)
		.orderBy(asc(schema.userAnnexes.key))
	return rows.map((r) => ({
		key: r.key,
		version: r.version,
		updatedAt: r.updatedAt.toISOString()
	}))
}

export async function setUserAnnex(
	db: Db,
	userId: number,
	owner: string,
	key: string,
	doc: unknown,
	opts: { base?: number } = {}
): Promise<UserAnnexWriteResult> {
	const fields = await userAnnexFieldsOfOwner(db, owner)
	const refused = writeRefusal(fields, owner, key, doc)
	if (refused) return { ok: false, refused }
	return db.transaction(async (tx) => {
		await lockPerson(tx as unknown as Db, userId)
		const rows = await rowsOf(tx as unknown as Db, userId, owner)
		const current = rows.find((r) => r.key === key)
		if (opts.base !== undefined && opts.base !== (current?.version ?? 0))
			return {
				ok: false,
				stale: true,
				fresh: current ? entryOf(current) : null
			} as const
		const projected = new Map(rows.map((r) => [r.key, r.doc] as const))
		projected.set(key, doc)
		const capped = capRefusal(projected)
		if (capped) return { ok: false, refused: capped } as const
		const version = (current?.version ?? 0) + 1
		if (current)
			await tx
				.update(schema.userAnnexes)
				.set({ doc, version, updatedAt: new Date() })
				.where(eq(schema.userAnnexes.id, current.id))
		else
			await tx
				.insert(schema.userAnnexes)
				.values({ userId, owner, key, doc, version })
		return { ok: true, version } as const
	})
}

export async function removeUserAnnex(
	db: Db,
	userId: number,
	owner: string,
	key: string,
	opts: { base?: number } = {}
): Promise<UserAnnexWriteResult> {
	const keyWhy = userAnnexKeyRefusal(key)
	if (keyWhy) return { ok: false, refused: keyWhy }
	return db.transaction(async (tx) => {
		await lockPerson(tx as unknown as Db, userId)
		const [current] = await tx
			.select()
			.from(schema.userAnnexes)
			.where(
				and(
					eq(schema.userAnnexes.userId, userId),
					eq(schema.userAnnexes.owner, owner),
					eq(schema.userAnnexes.key, key)
				)
			)
			.limit(1)
		if (opts.base !== undefined && opts.base !== (current?.version ?? 0))
			return {
				ok: false,
				stale: true,
				fresh: current ? entryOf(current) : null
			} as const
		if (!current) return { ok: true, version: 0 } as const
		await tx
			.delete(schema.userAnnexes)
			.where(eq(schema.userAnnexes.id, current.id))
		return { ok: true, version: current.version } as const
	})
}

/** Uninstall's "delete": every person's documents under one owner. Returns the rows removed. */
export async function removeOwnerUserAnnexes(
	db: Db,
	owner: string
): Promise<number> {
	const gone = await db
		.delete(schema.userAnnexes)
		.where(eq(schema.userAnnexes.owner, owner))
		.returning({ id: schema.userAnnexes.id })
	return gone.length
}

/**
 * The account's end: every document of one person, under every owner. Accounts
 * are soft-deleted (the FK cascade never fires), so the user-deletion handler
 * calls this. Returns the rows removed.
 */
export async function removeUserAnnexesOfUser(
	db: Db,
	userId: number
): Promise<number> {
	const gone = await db
		.delete(schema.userAnnexes)
		.where(eq(schema.userAnnexes.userId, userId))
		.returning({ id: schema.userAnnexes.id })
	return gone.length
}

/** Phase B: the person's documents under one owner, key → document, for a run to read. */
export async function loadUserAnnexSnapshot(
	db: Db,
	userId: number,
	owner: string
): Promise<Record<string, { doc: unknown; version: number; updatedAt: string }>> {
	const out: Record<string, { doc: unknown; version: number; updatedAt: string }> = {}
	for (const r of await rowsOf(db, userId, owner))
		out[r.key] = { doc: r.doc, version: r.version, updatedAt: r.updatedAt.toISOString() }
	return out
}

/**
 * Phase B: commit a run's writes all-or-nothing. Each write compares its
 * `base` (the snapshot's version; 0 absent) with the stored one; `doc: null`
 * removes the key (so JSON `null` is storable through `setUserAnnex` only).
 * Any stale key refuses the whole batch (`stale` lists them); a key the
 * declaration does not cover, a bad document or a cap refuses it with a sentence.
 */
export async function commitUserAnnexWrites(
	db: Db,
	userId: number,
	owner: string,
	writes: { key: string; doc: unknown | null; base: number }[]
): Promise<{ ok: true } | { ok: false; stale: string[] } | { ok: false; refused: string }> {
	const fields = await userAnnexFieldsOfOwner(db, owner)
	for (const w of writes) {
		const why = w.doc === null
			? userAnnexKeyRefusal(w.key)
			: writeRefusal(fields, owner, w.key, w.doc)
		if (why) return { ok: false, refused: why }
	}
	return db.transaction(async (tx) => {
		await lockPerson(tx as unknown as Db, userId)
		const rows = await rowsOf(tx as unknown as Db, userId, owner)
		const byKey = new Map(rows.map((r) => [r.key, r] as const))
		const stale = writes
			.filter((w) => w.base !== (byKey.get(w.key)?.version ?? 0))
			.map((w) => w.key)
		if (stale.length) return { ok: false, stale } as const
		const projected = new Map(rows.map((r) => [r.key, r.doc] as const))
		for (const w of writes)
			if (w.doc === null) projected.delete(w.key)
			else projected.set(w.key, w.doc)
		const capped = capRefusal(projected)
		if (capped) return { ok: false, refused: capped } as const
		for (const w of writes) {
			const current = byKey.get(w.key)
			if (w.doc === null) {
				if (current)
					await tx
						.delete(schema.userAnnexes)
						.where(eq(schema.userAnnexes.id, current.id))
			} else if (current)
				await tx
					.update(schema.userAnnexes)
					.set({ doc: w.doc, version: current.version + 1, updatedAt: new Date() })
					.where(eq(schema.userAnnexes.id, current.id))
			else
				await tx
					.insert(schema.userAnnexes)
					.values({ userId, owner, key: w.key, doc: w.doc, version: 1 })
		}
		return { ok: true } as const
	})
}
