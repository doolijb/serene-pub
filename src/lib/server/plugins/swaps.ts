/**
 * Swap contributions at install (PLAN-turn-order §4.14, R29).
 *
 * A plugin's manifest may offer its own definitions on another package's
 * swappable nodes (`swaps: [{ spec, node, definition }]`). The packager
 * checked the shape; what only this instance can check is the target: the
 * spec is published, the node declares `expose.swaps`, and the definition
 * fits the pin — same kind, same ports, same slots, not provisional — with
 * the SDK's own sentence (`swapFitFinding`). A contribution that fails any
 * of these would be offered to nobody, or offered and mis-wired, so the
 * install refuses with the sentence instead (R26). Both install doors call
 * this before anything is written.
 */
import { pluginRuleRef } from "@serene-pub/sdk"
import { and, eq } from "drizzle-orm"
import { swapFitFinding, type Descriptor } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { storedSwapsOf } from "$lib/shared/swaps"

type ManifestLike = {
	slug?: string
	swaps?: unknown
	nodeDefinitions?: Array<{ id?: string; version?: number; declaration?: unknown }>
}

/** Every reason this manifest's swap contributions cannot install; empty when they can. */
export async function swapContributionProblems(
	db: Db,
	manifest: ManifestLike | null | undefined
): Promise<string[]> {
	const swaps = storedSwapsOf(manifest?.swaps)
	if (!swaps.length) return []
	const own = new Map<string, Descriptor>()
	for (const d of manifest?.nodeDefinitions ?? []) {
		const decl = d?.declaration as Descriptor | undefined
		if (decl?.id) own.set(decl.id, decl)
	}
	const out: string[] = []
	for (const { spec, node, definition } of swaps) {
		const at = `swap '${definition}' onto '${spec}#${node}'`
		const swap = own.get(definition)
		if (!swap) {
			out.push(`${at}: '${definition}' is not a definition this plugin ships`)
			continue
		}
		const [row] = await db
			.select({ activeVersionId: schema.pipelineSpecs.activeVersionId })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, spec))
			.limit(1)
		if (!row?.activeVersionId) {
			out.push(`${at}: '${spec}' is not a pipeline this pub publishes`)
			continue
		}
		const [target] = await db
			.select({
				definitionId: schema.pipelineNodes.definitionId,
				definitionVersion: schema.pipelineNodes.definitionVersion,
				expose: schema.pipelineNodes.expose
			})
			.from(schema.pipelineNodes)
			.where(
				and(
					eq(schema.pipelineNodes.specVersionId, row.activeVersionId),
					eq(schema.pipelineNodes.nodeKey, node)
				)
			)
			.limit(1)
		if (!target) {
			out.push(`${at}: '${spec}' has no node '${node}'`)
			continue
		}
		if (!target.expose?.session) {
			out.push(`${at}: '${spec}#${node}' is not in session settings (expose), so nothing can be offered there`)
			continue
		}
		const [pinned] = await db
			.select({
				kind: schema.pipelineDefinitionRegistry.kind,
				ports: schema.pipelineDefinitionRegistry.ports,
				slots: schema.pipelineDefinitionRegistry.slots
			})
			.from(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(schema.pipelineDefinitionRegistry.definitionId, target.definitionId),
					eq(schema.pipelineDefinitionRegistry.version, target.definitionVersion)
				)
			)
			.limit(1)
		if (!pinned) continue // the pin's own row is the registry's to heal; nothing to compare
		const misfit = swapFitFinding(
			node,
			{
				id: `${target.definitionId}@${target.definitionVersion}`,
				kind: pinned.kind as Descriptor["kind"],
				ports: (pinned.ports ?? {}) as Descriptor["ports"],
				slots: (pinned.slots ?? {}) as Descriptor["slots"]
			},
			swap
		)
		if (misfit) {
			out.push(misfit)
			continue
		}
		// After the fit, whose refusals (R53 among them) no visibility fixes:
		// a swap runs the node in another package's pipeline, so it must be
		// public (R62) — refused here, not offered and then refused every turn.
		if (!isPublicInManifest(manifest, definition, swap))
			out.push(
				`${at}: '${definition}' is private — a swap runs it in another package's pipeline, so its ` +
					`handler must be public: handler(definition, fn, { visibility: 'public' })` +
					pluginRuleRef("private-nodes")
			)
	}
	return out
}

/**
 * Whether a manifest makes a node public (R62): its declaration says so —
 * projected from the handler since K1a — or, for a package built before
 * that, its handler entry does. Either way the handler decided.
 */
export function isPublicInManifest(
	manifest: unknown,
	definitionId: string,
	declaration?: { public?: boolean }
): boolean {
	if (declaration?.public) return true
	const handlers = (manifest as { hooks?: { handlers?: unknown } } | null)?.hooks?.handlers
	return (
		Array.isArray(handlers) &&
		handlers.some(
			(h) =>
				(h as { definitionId?: unknown })?.definitionId === definitionId &&
				(h as { visibility?: unknown })?.visibility === "public"
		)
	)
}
