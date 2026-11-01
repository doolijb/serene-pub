/**
 * 🚧 **Every published version of a ruleset, kept** (M2b, owner ruling a7, 2026-10-31): the `ruleset_versions`
 * table (`rulesetVersions`) holds one document per (ruleset, version), appended by every publish — a package's
 * install or upgrade (`publishPluginRulesets`) and an Admin › Rulesets publish (`publishPubRuleset`) — and
 * backfilled at boot from each `rulesets.published` (`keepCurrentRulesetVersions`). The `rulesets` row still means
 * "the version a new session starts on"; this table is what a session pinned to an OLDER version reads, so it keeps
 * playing that version until its owner converts it (`convertSessionRuleset`).
 *
 * · Reader: `keptRulesetDocument` (cached in-process by `${rulesetId}@${version}`; a document is immutable per key
 *   except a replace, which clears the entry). `vocabularyFor` asks it for a pinned session.
 * · Registry: `registerKeptRulesetSlots` registers every attribute slot a kept document declares that the registry
 *   does not hold, so a pinned session can read and write its old ids; `offerableSlot` still gates them to that
 *   ruleset's sessions (`rulesetOwned`). An id the current version ALSO declares keeps the current declaration — the
 *   registry is keyed by slot id, so a changed bound on an unchanged id applies to pinned sessions too. Registration
 *   is additive and never withdrawn; only a ruleset the registry holds is considered (an uninstalled package's is
 *   withdrawn with its slots, as before).
 * · Retention: nothing here deletes a version. The only removal is the FK cascade of `deletePubRuleset`, which
 *   already refuses a ruleset any session or lorebook plays.
 * · ★ Open (owner): a version re-published with DIFFERENT content — refuse or replace. Replace (with a warning) is
 *   the interim.
 */

import { and, count, desc, eq, sql } from "drizzle-orm"
import {
	_defineRulesetAttributeSlot,
	getAttributeSlot,
	getRuleset,
	rulesetAttributeSlotDecls,
	rulesetSections
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"

export type KeepOutcome = "kept" | "same" | "replaced" | "refused"

const cache = new Map<string, Record<string, unknown> | null>()
const keyOf = (rulesetId: string, version: string) => `${rulesetId}@${version}`

/** JSON with object keys sorted, so two documents compare by content, not key order. */
function stable(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`
	if (v && typeof v === "object")
		return `{${Object.keys(v as object)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
			.join(",")}}`
	return JSON.stringify(v) ?? "null"
}

/**
 * How many sessions and lorebooks play `rulesetId` pinned at `version` (`ruleset_version` on each).
 */
export async function versionPlayedBy(db: Db, rulesetId: string, version: string): Promise<{ sessions: number; lorebooks: number }> {
	const [[s], [l]] = await Promise.all([
		db
			.select({ n: count() })
			.from(schema.sessions)
			.where(and(eq(schema.sessions.primaryRuleset, rulesetId), eq(schema.sessions.rulesetVersion, version))),
		db
			.select({ n: count() })
			.from(schema.lorebooks)
			.where(and(eq(schema.lorebooks.primaryRuleset, rulesetId), eq(schema.lorebooks.rulesetVersion, version)))
	])
	return { sessions: Number(s?.n ?? 0), lorebooks: Number(l?.n ?? 0) }
}

/**
 * 🚧 Why publishing `document` as `rulesetId`'s `version` is refused, or null (owner ruling, 2026-10-31): a version
 * already kept with DIFFERENT content may be replaced only while nothing plays it — a plugin author re-ships 0.1.0 all
 * day while developing — and is refused once a session or lorebook is pinned to it: what it plays must not change
 * under it. A new version is always fine. Callers ask before they write anything.
 */
export async function republishRefusal(db: Db, rulesetId: string, version: string, document: Record<string, unknown>): Promise<string | null> {
	const held = await keptRulesetDocumentFresh(db, rulesetId, version)
	if (!held || stable(held) === stable(document)) return null
	const { sessions, lorebooks } = await versionPlayedBy(db, rulesetId, version)
	if (!sessions && !lorebooks) return null
	const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
	const who = [sessions ? plural(sessions, "session") : "", lorebooks ? plural(lorebooks, "lorebook") : ""].filter(Boolean).join(" and ")
	return `Version ${version} of '${rulesetId}' is played by ${who}; publish it as a new version.`
}

/** The kept document straight from the table (no cache): what a publish compares against. */
async function keptRulesetDocumentFresh(db: Db, rulesetId: string, version: string): Promise<Record<string, unknown> | null> {
	const [row] = await db
		.select({ document: schema.rulesetVersions.document })
		.from(schema.rulesetVersions)
		.where(and(eq(schema.rulesetVersions.rulesetId, rulesetId), eq(schema.rulesetVersions.version, version)))
		.limit(1)
	return row?.document ?? null
}

/**
 * Keep `document` as `rulesetId`'s version `version`. Inserts; on a (ruleset, version) conflict the same content is
 * left alone (`'same'`); different content replaces the kept document with one `console.warn` (`'replaced'`) while
 * nothing plays that version, and is left alone (`'refused'`) when something does — callers say why first
 * (`republishRefusal`). Pass the transaction's `tx` from inside a transaction.
 */
export async function keepRulesetVersion(
	db: Db,
	args: { rulesetId: string; version: string; document: Record<string, unknown>; publishedBy: number | null }
): Promise<KeepOutcome> {
	const { rulesetId, version, document, publishedBy } = args
	cache.delete(keyOf(rulesetId, version))
	const inserted = await db
		.insert(schema.rulesetVersions)
		.values({ rulesetId, version, document, publishedBy })
		.onConflictDoNothing()
		.returning({ id: schema.rulesetVersions.id })
	if (inserted.length) return "kept"
	const [held] = await db
		.select({ document: schema.rulesetVersions.document })
		.from(schema.rulesetVersions)
		.where(and(eq(schema.rulesetVersions.rulesetId, rulesetId), eq(schema.rulesetVersions.version, version)))
		.limit(1)
	if (held && stable(held.document) === stable(document)) return "same"
	if (await republishRefusal(db, rulesetId, version, document)) return "refused"
	await db
		.update(schema.rulesetVersions)
		.set({ document, publishedBy })
		.where(and(eq(schema.rulesetVersions.rulesetId, rulesetId), eq(schema.rulesetVersions.version, version)))
	console.warn(`[rulesets] '${rulesetId}' version ${version} was published again with different content; the kept copy was replaced.`)
	return "replaced"
}

/** Boot backfill: keep each ruleset's current published document under its published version. Idempotent. */
export async function keepCurrentRulesetVersions(db: Db): Promise<void> {
	await db.execute(sql`
		insert into ${schema.rulesetVersions} (ruleset_id, version, document)
		select ${schema.rulesets.rulesetId}, ${schema.rulesets.publishedVersion}, ${schema.rulesets.published}
		from ${schema.rulesets}
		where ${schema.rulesets.published} is not null and ${schema.rulesets.publishedVersion} is not null
		on conflict do nothing
	`)
}

/** The kept document of `rulesetId` at `version`, or null when nobody kept it. */
export async function keptRulesetDocument(db: Db, rulesetId: string, version: string): Promise<Record<string, unknown> | null> {
	const key = keyOf(rulesetId, version)
	const hit = cache.get(key)
	if (hit) return hit
	const [row] = await db
		.select({ document: schema.rulesetVersions.document })
		.from(schema.rulesetVersions)
		.where(and(eq(schema.rulesetVersions.rulesetId, rulesetId), eq(schema.rulesetVersions.version, version)))
		.limit(1)
	const doc = row?.document ?? null
	if (doc) cache.set(key, doc)
	return doc
}

/**
 * Register the attribute slots kept versions declare that the registry lacks (newest kept version first), for one
 * ruleset or every ruleset the registry holds. A refusal for one slot is logged and skipped.
 */
export async function registerKeptRulesetSlots(db: Db, rulesetId?: string): Promise<void> {
	const rows = await db
		.select({
			rulesetId: schema.rulesetVersions.rulesetId,
			version: schema.rulesetVersions.version,
			document: schema.rulesetVersions.document
		})
		.from(schema.rulesetVersions)
		.where(rulesetId ? eq(schema.rulesetVersions.rulesetId, rulesetId) : undefined)
		.orderBy(desc(schema.rulesetVersions.publishedAt), desc(schema.rulesetVersions.id))
	for (const row of rows) {
		if (!getRuleset(row.rulesetId)) continue
		let decls: ReturnType<typeof rulesetAttributeSlotDecls>
		try {
			decls = rulesetAttributeSlotDecls({ id: row.rulesetId, attributes: rulesetSections(row.document).attributes })
		} catch (e) {
			console.warn(`[rulesets] '${row.rulesetId}' version ${row.version}: its kept document could not be read for slots:`, e)
			continue
		}
		for (const { id, props } of decls) {
			if (getAttributeSlot(id)) continue
			try {
				_defineRulesetAttributeSlot(id, { ...props, rulesetOwned: row.rulesetId })
			} catch (e) {
				console.warn(`[rulesets] '${row.rulesetId}' version ${row.version}: slot '${id}' was not registered:`, e)
			}
		}
	}
}

/** Tests only: forget the in-process cache. */
export function _clearKeptRulesetCache(): void {
	cache.clear()
}
