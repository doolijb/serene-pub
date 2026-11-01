/**
 * 🚧 (M2c fix) A package's OWN entry types, in force before anything of the
 * package names them: the ruleset rows it shipped (`manifest.rulesets`,
 * published at install by `pluginRulesets.ts`) registered in this process
 * (`registerPluginRulesets`, which derives their entry types), and each derived
 * type's `pipeline_definition_registry` row written — the row
 * `lorebook_entries_type_fk` points at. Without the row an entry of the type
 * fails its insert and rolls back the whole provided book; without the
 * in-process type the importer reads the marker as world lore.
 *
 * Owned by the plugin (`owner_plugin_id`), so core's boot-time reverse-diff
 * never marks the rows removed, and a reinstall's own reverse-diff that does is
 * undone by the next call here. Idempotent: same declarations, no writes.
 */
import { and, eq, isNull } from "drizzle-orm"
import { allEntryTypes, getRuleset } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"

/** Register a package's rulesets and write its entry types' rows. Returns one line per problem. */
export async function ensurePackageEntryTypes(db: Db, pluginId: string): Promise<string[]> {
	const problems: string[] = []
	const rows = await db
		.select({ rulesetId: schema.rulesets.rulesetId, published: schema.rulesets.published })
		.from(schema.rulesets)
		.where(
			and(
				isNull(schema.rulesets.createdBy),
				eq(schema.rulesets.ownerSlug, pluginId),
				isNull(schema.rulesets.retiredAt)
			)
		)
	const shipped = rows.filter((r) => r.published)
	if (!shipped.length) return problems
	// In this process first: a boot reaches here before `registerPubRulesets`,
	// and an install registers only on its own path.
	if (shipped.some((r) => !getRuleset(r.rulesetId as never))) {
		const { registerPluginRulesets } = await import("$lib/server/rulesets/pubRulesets")
		problems.push(...(await registerPluginRulesets(db, pluginId)))
	}
	const derived = allEntryTypes().filter((d) => d.id.startsWith(`${pluginId}:entry/`))
	if (!derived.length) return problems
	const [plugin] = await db
		.select({ id: schema.plugins.id, version: schema.plugins.version })
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, pluginId))
		.limit(1)
	if (!plugin) return problems
	const { syncDefinitionRegistry } = await import("$lib/server/pipelines/boot/registrySync")
	await syncDefinitionRegistry(db, derived, {
		release: plugin.version || "dev",
		ownerPluginId: plugin.id
	})
	return problems
}
