/**
 * Install-time requirement enforcement (24 §10, T7b).
 *
 * A package's declaration artifact records what it references but does not
 * ship — `requires: string[]` of genre/spec ids. The CLI never bundles them;
 * the instance is the authority on whether they exist, checked here at
 * install so a missing dependency is a refusal with names, not a runtime
 * surprise. Author-side types are advisory; this is the check that counts.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

type Db = any

/** Which of these ids this instance cannot satisfy right now. */
export async function missingRequirements(
	db: Db,
	requires: readonly string[]
): Promise<string[]> {
	if (!requires.length) return []

	const specRows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			versionId: schema.pipelineSpecVersions.id,
			status: schema.pipelineSpecVersions.status,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
	const active = (specRows as any[]).filter(
		(r) => r.activeVersionId === r.versionId && r.status === "published"
	)
	const publishedSlugs = new Set(active.map((r) => r.slug))
	const publishedGenres = new Set(
		active
			.filter((r) => r.inputEvent === "session-created" && r.inputGenre)
			.map((r) => r.inputGenre)
	)

	const missing: string[] = []
	for (const id of requires) {
		if (id.includes(":genre/")) {
			if (!publishedGenres.has(id)) missing.push(id)
		} else if (publishedSlugs.has(id)) {
			// A published spec satisfies a spec reference of any shape.
		} else {
			missing.push(id)
		}
	}
	return missing
}

/**
 * The requirement list a manifest carries, wherever the packager put it —
 * announcement-shaped manifests carry it top-level; absent means none.
 */
export function requirementsOf(manifest: unknown): string[] {
	const r = (manifest as any)?.requires
	return Array.isArray(r) ? r.filter((x) => typeof x === "string") : []
}
