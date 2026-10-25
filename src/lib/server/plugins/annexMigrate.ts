import { eq, gt, sql, and } from "drizzle-orm"
import fs from "node:fs"
import path from "node:path"
import { plugins, sessions } from "$lib/server/db/schema"
import type { SandboxManager } from "./SandboxManager"
import { fireMigrate } from "./lifecycle"

/**
 * 🚧 The `migrate(fromVersion)` lifecycle hook's host half (pr-6 G1 / R-n, ruled 2026-10-24):
 * an annex owner's documents, as an older version of it wrote them, carried forward by the
 * owner's own `migrate` callback. Phase 0 stubs (supervisor C, 2026-10-25) — lane C4 builds
 * `migrateAnnexOwner` and the bodies; `sessions/annexChanges.ts` (Forward) and
 * `runtime/host.ts` (the annex write) call these two now.
 */

const PAGE = 200

const isPlain = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/** `@serene-pub/core-catalog`'s package version, found as Node would find it; null when unreadable. */
/** Read once per process: `ownerVersionOf` runs on every annex write (supervisor C, 2026-10-25). */
let coreCatalogVersionRead: { v: string | null } | undefined
function coreCatalogVersion(): string | null {
	if (!coreCatalogVersionRead) coreCatalogVersionRead = { v: readCoreCatalogVersion() }
	return coreCatalogVersionRead.v
}
function readCoreCatalogVersion(): string | null {
	let dir = process.cwd()
	for (;;) {
		const manifest = path.join(dir, "node_modules", "@serene-pub", "core-catalog", "package.json")
		if (fs.existsSync(manifest)) {
			try {
				const v = JSON.parse(fs.readFileSync(manifest, "utf8")).version
				return typeof v === "string" ? v : null
			} catch {
				return null
			}
		}
		const up = path.dirname(dir)
		if (up === dir) return null
		dir = up
	}
}

/**
 * The version of `owner` now running — a plugin's installed version, or core's — recorded on
 * every annex change it writes (`annex_deltas.owner_version`). `core` is the
 * `@serene-pub/core-catalog` package version; null when the owner is unknown.
 */
export async function ownerVersionOf(db: Db, owner: string): Promise<string | null> {
	try {
		if (owner === "core") return coreCatalogVersion()
		const [row] = await db
			.select({ version: plugins.version })
			.from(plugins)
			.where(eq(plugins.pluginId, owner))
			.limit(1)
		return row?.version ?? null
	} catch {
		return null
	}
}

/** Store `document` as `owner`'s annex document, under the annex write's lock and `jsonb_set`. */
async function storeOwnerDocument(
	db: Db,
	owner: string,
	sessionId: number,
	document: Record<string, unknown>
): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext('annex'), ${sessionId})`)
		await tx.execute(sql`
			update ${sessions}
			set ${sql.identifier("annex")} = jsonb_set(
				coalesce(${sessions.annex}, '{}'::jsonb),
				ARRAY[${owner}]::text[],
				${JSON.stringify(document)}::jsonb,
				true
			)
			where ${sessions.id} = ${sessionId}
		`)
	})
}

/**
 * Run `migrate` over every session's document of `owner`, from to version; store what it
 * returns. Sessions in id order, pages of 200. Never throws.
 */
export async function migrateAnnexOwner(
	db: Db,
	mgr: SandboxManager,
	owner: string,
	versions: { fromVersion: string; version: string }
): Promise<{ migrated: number; left: number }> {
	let migrated = 0
	let left = 0
	let after = 0
	try {
		for (;;) {
			const page = await db
				.select({ id: sessions.id, annex: sessions.annex })
				.from(sessions)
				.where(and(gt(sessions.id, after), sql`${sessions.annex} ? ${owner}`))
				.orderBy(sessions.id)
				.limit(PAGE)
			if (!page.length) break
			for (const row of page) {
				after = row.id
				const held = (row.annex as Record<string, unknown> | null)?.[owner]
				if (!isPlain(held)) {
					left++
					continue
				}
				try {
					const { document } = await fireMigrate(mgr, owner, {
						sessionId: row.id,
						fromVersion: versions.fromVersion,
						version: versions.version,
						document: held
					})
					if (document) {
						await storeOwnerDocument(db, owner, row.id, document)
						migrated++
					} else left++
				} catch (e) {
					left++
					console.warn(`[plugins] '${owner}' migrate for session ${row.id} failed:`, e)
				}
			}
			if (page.length < PAGE) break
		}
	} catch (e) {
		console.warn(`[plugins] '${owner}' annex migration stopped:`, e)
	}
	return { migrated, left }
}

/**
 * One owner document, for Forward: the document `owner`'s `migrate` callback returns for it
 * as written under `fromVersion`, or the document unchanged when the callback is missing,
 * halts or fails. Never throws. Returns it; does not store it.
 */
export async function migrateOwnerDocument(
	db: Db,
	owner: string,
	sessionId: number,
	document: Record<string, unknown>,
	fromVersion: string
): Promise<Record<string, unknown>> {
	try {
		const { getManager } = await import("$lib/server/plugins")
		const version = (await ownerVersionOf(db, owner)) ?? fromVersion
		const out = await fireMigrate(getManager(), owner, {
			sessionId,
			fromVersion,
			version,
			document
		})
		return out.document ?? document
	} catch {
		return document
	}
}
