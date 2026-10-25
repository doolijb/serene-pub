/**
 * Install-time requirement enforcement (24 §10, T7b).
 *
 * A package's declaration artifact records what it references but does not
 * ship — `requires: string[]` of genre, spec and event ids. The CLI never bundles them;
 * the instance is the authority on whether they exist, checked here at
 * install so a missing dependency is a refusal with names, not a runtime
 * surprise. Author-side types are advisory; this is the check that counts.
 */
import { eventById, sessionEvents } from "@serene-pub/sdk"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { isRegisteredPackageEvent } from "./pluginEvents"
import { resolveRenamedCoreId } from "./renamedCoreIds"

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
			.filter(
				(r) => r.inputEvent === sessionEvents.sessionCreated && r.inputGenre
			)
			.map((r) => r.inputGenre)
	)
	// 🚧 A genre whose defaults register a create pipeline (PLAN-layering D3):
	// no lock says so any more, the genre list does.
	const { listSessionGenres } = await import("$lib/server/pipelines/entities/sessionGenres")
	for (const g of await listSessionGenres(db)) publishedGenres.add(g.genreId)

	const missing: string[] = []
	// 🚧 A16: an entry may carry a version range (`acme.dice@^1.2`,
	// `acme.dice:spec/roll@^1.2`) — the package must be installed, enabled
	// and in range; the id (when it names one) must exist as before.
	const { parseRequirement } = await import("@serene-pub/sdk")
	const { presetRequirementFindings } = await import("$lib/server/pipelines/registrations/door")
	for (const raw of requires) {
		const req = parseRequirement(raw)
		if (req && req.package !== "core" && (req.range || !req.id)) {
			const unmet = await presetRequirementFindings(db, [raw])
			if (unmet.length) {
				missing.push(raw)
				continue
			}
			if (!req.id) continue
		}
		const id = req?.id ?? raw
		if (id.includes(":genre/")) {
			if (!publishedGenres.has(id)) missing.push(id)
		} else if (isCoreEventId(id)) {
			// Core's own event: this build declares it, or it is from a newer
			// Serene Pub — the SDK's registry is the authority, not a package.
			if (!eventById(id)) missing.push(id)
		} else if (id.includes(":event/")) {
			// Another package's event: declared by one installed here.
			if (!isRegisteredPackageEvent(id)) missing.push(id)
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
 * announcement-shaped manifests carry it top-level; absent means none. A
 * core id core has since renamed reads as the id it ships now
 * (`renamedCoreIds.ts`).
 */
export function requirementsOf(manifest: unknown): string[] {
	const r = (manifest as any)?.requires
	return Array.isArray(r)
		? r.filter((x): x is string => typeof x === "string").map(resolveRenamedCoreId)
		: []
}

/** Whether a required id is one of core's events (`core:event/<slug>@<n>`). */
export const isCoreEventId = (id: string): boolean => id.startsWith("core:event/")

/**
 * The refusal for a non-empty `missingRequirements` answer, in one place so
 * both install doors say the same thing. A core event this build lacks is not
 * something the admin can install first — it means the package was made on a
 * newer Serene Pub — so it gets its own sentence; everything else keeps the
 * install-what-it-builds-on-first wording. `subject` opens the latter
 * (`'acme.lab'`, or `This package`).
 */
export function missingRequirementsMessage(
	subject: string,
	missing: readonly string[]
): string {
	const core = missing.filter(isCoreEventId)
	const rest = missing.filter((id) => !isCoreEventId(id))
	const sentences = core.map(
		(id) =>
			`'${id}' is an event this version of Serene Pub does not have; the ` +
			`package needs a newer Serene Pub.`
	)
	if (rest.length)
		sentences.push(
			`${subject} requires ${rest.join(", ")} — not installed on this pub. ` +
				`Install what it builds on first.`
		)
	return sentences.join(" ")
}
