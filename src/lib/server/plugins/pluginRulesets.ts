/**
 * 🚧 **Rulesets a package ships** (M0, SHAPES L4 Declaration; lane P5):
 * `manifest.rulesets` — ruleset documents — published at install and upgrade
 * as `rulesets` rows owned by the plugin's slug (`owner_slug`), and retired
 * (never deleted) at uninstall, so a session pinned to one keeps reading it.
 *
 * A row a package published has `created_by` NULL: that is what tells it from
 * a ruleset a person made on the pub under the same owner name. Origin is
 * never stored — `rulesetOriginOf` (`$lib/server/rulesets/origin`) derives it.
 * Registering a plugin-owned row in the SDK registry is the rulesets reader's
 * (lane T4), not this module's.
 */

import { and, eq, isNull } from "drizzle-orm"
import { i18nText, parseRulesetId, rulesetDocumentFindings } from "@serene-pub/sdk"
import { rulesets } from "$lib/server/db/schema"
import { keepRulesetVersion, republishRefusal } from "$lib/server/rulesets/versions"

export interface PluginRulesetsReport {
	/** Ruleset ids written (inserted or upgraded), in manifest order. */
	published: string[]
	/** Ruleset ids this install retired because the new version does not ship them. */
	retired: string[]
	/** One sentence per document refused; never fatal — the rest still lands. */
	refused: string[]
}

/** Publish every `manifest.rulesets` document as a row owned by `pluginId`. */
export async function publishPluginRulesets(
	db: Db,
	pluginId: string,
	manifest: unknown
): Promise<PluginRulesetsReport> {
	const report: PluginRulesetsReport = { published: [], retired: [], refused: [] }
	const raw = (manifest as { rulesets?: unknown } | null | undefined)?.rulesets
	const docs = Array.isArray(raw) ? raw : []
	await db.transaction(async (tx) => {
		const shipped = new Set<string>()
		for (const doc of docs) {
			if (!doc || typeof doc !== "object" || typeof (doc as { id?: unknown }).id !== "string") continue
			const d = doc as Record<string, unknown> & { id: string }
			const id = d.id
			const owner = parseRulesetId(id)?.owner
			if (owner !== pluginId) {
				report.refused.push(`ruleset '${id}' sits under '${owner}', not '${pluginId}'.`)
				continue
			}
			const findings = rulesetDocumentFindings(d)
			if (findings.length) {
				report.refused.push(`ruleset '${id}': ${findings.join("; ")}`)
				continue
			}
			const [existing] = await tx
				.select({ createdBy: rulesets.createdBy })
				.from(rulesets)
				.where(eq(rulesets.rulesetId, id))
			if (existing && existing.createdBy !== null) {
				report.refused.push(`'${id}' is a ruleset made on this pub; the package's copy was not installed over it.`)
				continue
			}
			// the same version with different content: replaced while nothing plays it, refused once something does
			const playing = await republishRefusal(tx as unknown as Db, id, d.version as string, d)
			if (playing) {
				report.refused.push(playing)
				// a refused republish leaves the stored version standing, and that version is still one the package ships: never retired for this
				shipped.add(id)
				continue
			}
			const values = {
				ownerSlug: pluginId,
				label: i18nText(d.name as never) || id,
				basedOn: null,
				draft: d,
				draftFindings: [] as string[],
				published: d,
				publishedVersion: d.version as string,
				retiredAt: null,
				createdBy: null
			}
			if (existing) await tx.update(rulesets).set(values).where(eq(rulesets.rulesetId, id))
			else await tx.insert(rulesets).values({ rulesetId: id, ...values })
			// every published version is kept (M2b a7): a session pinned to this one keeps playing it after the upgrade
			await keepRulesetVersion(tx as unknown as Db, { rulesetId: id, version: d.version as string, document: d, publishedBy: null })
			shipped.add(id)
			report.published.push(id)
		}
		const live = await tx
			.select({ rulesetId: rulesets.rulesetId })
			.from(rulesets)
			.where(and(eq(rulesets.ownerSlug, pluginId), isNull(rulesets.createdBy), isNull(rulesets.retiredAt)))
		for (const row of live) {
			if (shipped.has(row.rulesetId)) continue
			await tx.update(rulesets).set({ retiredAt: new Date() }).where(eq(rulesets.rulesetId, row.rulesetId))
			report.retired.push(row.rulesetId)
		}
	})
	return report
}

/** Retire every row `pluginId` published (uninstall). Returns the ruleset ids retired. */
export async function retirePluginRulesets(db: Db, pluginId: string): Promise<string[]> {
	const rows = await db
		.update(rulesets)
		.set({ retiredAt: new Date() })
		.where(and(eq(rulesets.ownerSlug, pluginId), isNull(rulesets.createdBy), isNull(rulesets.retiredAt)))
		.returning({ rulesetId: rulesets.rulesetId })
	return rows.map((r) => r.rulesetId)
}
