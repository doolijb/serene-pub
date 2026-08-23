/**
 * Pipeline documents ↔ rows.
 *
 * **Rows are the system of record; the document is a deterministic projection of
 * them (F3).** That direction matters more than it looks. It is what lets the
 * in-app editor and an imported plugin pipeline be the same thing — both write
 * rows, and export reads rows — rather than the editor being a second
 * implementation that has to be kept in step with a file format.
 *
 * The acceptance criterion is one line: **`import(export(rows))` is the
 * identity, and the canonical hash is stable across the trip.** It is
 * conformance requirement C1, and it is checked here against real rows rather
 * than fixtures, because the interesting failures are all in the column mapping
 * — a dropped `blockChain`, a preset value that round-trips as a string instead
 * of a number — and no fixture catches those.
 *
 * Nothing in the running app reads these tables yet. The pipeline path is built
 * beside the existing prompt/context config path and only replaces it once the
 * parity corpus is byte-identical (08 §5b, docs-dev/INTEGRATING.md).
 */

import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	canonicalHash,
	importDocument,
	type SpecDocument
} from "@serene-pub/sdk"

type Db = {
	insert: any
	select: any
	update: any
	delete: any
	transaction: any
}

/** What `saveDocument` reports back — the ids core needs to reference the version. */
export interface SavedSpec {
	specId: number
	specVersionId: number
	canonicalHash: string
}

/**
 * Write a document as rows.
 *
 * A version is written whole or not at all. The transaction is not decoration:
 * a half-written spec version is a pipeline that validates (its nodes exist)
 * and then fails mid-run on a missing edge, which is the least debuggable
 * outcome available.
 */
export async function saveDocument(
	db: Db,
	doc: SpecDocument,
	opts: { name?: string; sourcePluginId?: number; publish?: boolean } = {}
): Promise<SavedSpec> {
	const hash = canonicalHash(doc)

	return await db.transaction(async (tx: Db) => {
		const existing = await tx
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, doc.id))
			.limit(1)

		const spec =
			existing[0] ??
			(
				await tx
					.insert(schema.pipelineSpecs)
					.values({
						slug: doc.id,
						name: opts.name ?? doc.id,
						sourcePluginId: opts.sourcePluginId ?? null
					})
					.returning()
			)[0]

		// Re-saving the same semver replaces that version's rows. Publishing is a
		// separate act — a pointer move on the spec (02 §3) — so a draft being
		// edited never disturbs the version a run in flight is using.
		const prior = await tx
			.select()
			.from(schema.pipelineSpecVersions)
			.where(
				and(
					eq(schema.pipelineSpecVersions.specId, spec.id),
					eq(schema.pipelineSpecVersions.semver, doc.version)
				)
			)
			.limit(1)
		if (prior[0])
			await tx
				.delete(schema.pipelineSpecVersions)
				.where(eq(schema.pipelineSpecVersions.id, prior[0].id))

		const version = (
			await tx
				.insert(schema.pipelineSpecVersions)
				.values({
					specId: spec.id,
					semver: doc.version,
					schemaVersion: doc.schemaVersion,
					canonicalHash: hash,
					status: opts.publish ? "published" : "draft",
					publishedAt: opts.publish ? new Date() : null,
					mode: (doc.mode as Record<string, any>) ?? null
				})
				.returning()
		)[0]

		if (doc.blocks.length)
			await tx.insert(schema.pipelineBlocks).values(
				doc.blocks.map((b) => ({
					specVersionId: version.id,
					blockId: b.id,
					kind: b.kind,
					parentBlockId: b.blockId ?? null,
					mode: b.mode ?? null,
					max: b.max ?? null,
					overRef: (b.over as Record<string, any>) ?? null,
					repeatWhile: (b.repeatWhile as Record<string, any>) ?? null,
					position: b.position
				}))
			)

		const nodeRows = await tx
			.insert(schema.pipelineNodes)
			.values(
				doc.nodes.map((n) => ({
					specVersionId: version.id,
					nodeKey: n.key,
					kind: n.kind,
					typeId: n.typeId,
					typeVersion: n.typeVersion,
					config: n.config,
					resolvedRefs: n.resolvedRefs ?? null,
					blockId: n.blockId ?? null,
					blockKind: n.blockKind ?? null,
					blockChain: n.blockChain ?? null,
					position: n.position
				}))
			)
			.returning()

		// Edges FK to node rows, so the id lookup happens here rather than being
		// deferred to a validator that runs later and finds a dangling reference.
		const idOf = new Map<string, number>(
			nodeRows.map((r: { nodeKey: string; id: number }) => [
				r.nodeKey,
				r.id
			])
		)
		// A block's aggregate output is a legal edge source: `map` and `async`
		// publish `branch-results@1`, and a spec consuming it names the block.
		// Resolved here so the error below still fires for a genuine typo.
		const blockIds = new Set((doc.blocks ?? []).map((b: any) => b.id))

		// So is a map or loop iteration's item — `block.$item`, the per-iteration
		// value the executor scopes in. Block-shaped rather than node-shaped: it
		// has no node row to FK, and the load side hands the key back verbatim.
		const itemSourceOf = (from: string): string | null => {
			const m = /^(.+)\.\$item$/.exec(from)
			return m && blockIds.has(m[1]!) ? from : null
		}

		if (doc.edges.length)
			await tx.insert(schema.pipelineEdges).values(
				doc.edges.map((e) => {
					const from = idOf.get(e.from)
					const fromBlock = blockIds.has(e.from)
						? e.from
						: itemSourceOf(e.from)
					const to = idOf.get(e.to)
					if ((from === undefined && !fromBlock) || to === undefined)
						throw new Error(
							`edge ${e.from}.${e.fromPort} → ${e.to}.${e.toPort} references a node this version does not contain`
						)
					return {
						specVersionId: version.id,
						fromNodeId: fromBlock ? null : from,
						fromBlockId: fromBlock,
						fromPort: e.fromPort,
						toNodeId: to,
						toPort: e.toPort,
						edgeShape: e.shape ?? null,
						streaming: e.streaming ?? null,
						implicit: e.implicit ?? null
					}
				})
			)

		if (doc.includes.length)
			await tx.insert(schema.pipelineIncludes).values(
				doc.includes.map((i) => ({
					specVersionId: version.id,
					key: i.key,
					fragmentId: i.fragmentId
				}))
			)

		for (const p of doc.presets ?? []) {
			const preset = (
				await tx
					.insert(schema.pipelinePresets)
					.values({
						specVersionId: version.id,
						slug: p.slug,
						label: p.label,
						description: p.description ?? null,
						ownerSlug: p.owner ?? null,
						isDefault: p.default ?? false
					})
					.returning()
			)[0]
			if (p.values.length)
				await tx.insert(schema.pipelinePresetValues).values(
					p.values.map((v) => ({
						presetId: preset.id,
						nodeKey: v.nodeKey,
						slot: v.slot,
						value: v.value as any
					}))
				)
		}

		if (doc.subscribes.length)
			await tx.insert(schema.pipelineEventSubscriptions).values(
				doc.subscribes.map((ref) => ({
					eventRef: ref,
					eventSlug: stripVersion(ref),
					eventVersion: versionOf(ref),
					specVersionId: version.id
				}))
			)

		await tx
			.update(schema.pipelineSpecs)
			.set(
				opts.publish
					? { activeVersionId: version.id }
					: { activeVersionId: spec.activeVersionId ?? null }
			)
			.where(eq(schema.pipelineSpecs.id, spec.id))

		return {
			specId: spec.id,
			specVersionId: version.id,
			canonicalHash: hash
		}
	})
}

/**
 * Read a version back as a document.
 *
 * Ordering is explicit everywhere it matters. `position` is what makes the
 * projection deterministic — without it the hash would depend on whatever order
 * Postgres felt like returning rows in, and C1 would fail intermittently, which
 * is worse than failing.
 */
export async function loadDocument(
	db: Db,
	specVersionId: number
): Promise<SpecDocument> {
	const [version] = await db
		.select()
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.id, specVersionId))
		.limit(1)
	if (!version) throw new Error(`no pipeline spec version ${specVersionId}`)

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.id, version.specId))
		.limit(1)

	const nodeRows = await db
		.select()
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, specVersionId))
		.orderBy(
			asc(schema.pipelineNodes.position),
			asc(schema.pipelineNodes.id)
		)

	const keyOf = new Map<number, string>(
		nodeRows.map((r: { id: number; nodeKey: string }) => [r.id, r.nodeKey])
	)

	const edgeRows = await db
		.select()
		.from(schema.pipelineEdges)
		.where(eq(schema.pipelineEdges.specVersionId, specVersionId))
		.orderBy(asc(schema.pipelineEdges.id))

	const blockRows = await db
		.select()
		.from(schema.pipelineBlocks)
		.where(eq(schema.pipelineBlocks.specVersionId, specVersionId))
		.orderBy(
			asc(schema.pipelineBlocks.position),
			asc(schema.pipelineBlocks.id)
		)

	const includeRows = await db
		.select()
		.from(schema.pipelineIncludes)
		.where(eq(schema.pipelineIncludes.specVersionId, specVersionId))
		.orderBy(asc(schema.pipelineIncludes.id))

	const presetRows = await db
		.select()
		.from(schema.pipelinePresets)
		.where(eq(schema.pipelinePresets.specVersionId, specVersionId))
		.orderBy(asc(schema.pipelinePresets.id))

	const subscriptionRows = await db
		.select()
		.from(schema.pipelineEventSubscriptions)
		.where(
			eq(schema.pipelineEventSubscriptions.specVersionId, specVersionId)
		)
		.orderBy(asc(schema.pipelineEventSubscriptions.id))

	const presets = []
	for (const p of presetRows) {
		const values = await db
			.select()
			.from(schema.pipelinePresetValues)
			.where(eq(schema.pipelinePresetValues.presetId, p.id))
			.orderBy(asc(schema.pipelinePresetValues.id))
		presets.push({
			slug: p.slug,
			label: p.label,
			...(p.description ? { description: p.description } : {}),
			...(p.isDefault ? { default: true } : {}),
			...(p.ownerSlug ? { owner: p.ownerSlug } : {}),
			values: values.map((v: any) => ({
				nodeKey: v.nodeKey,
				slot: v.slot,
				value: v.value
			}))
		})
	}

	const doc: SpecDocument = {
		schemaVersion: version.schemaVersion as 1,
		id: spec.slug,
		version: version.semver,
		...(version.mode ? { mode: version.mode } : {}),
		subscribes: subscriptionRows.map((s: any) => s.eventRef),
		includes: includeRows.map((i: any) => ({
			key: i.key,
			fragmentId: i.fragmentId
		})),
		presets: presets as SpecDocument["presets"],
		nodes: nodeRows.map((n: any) => ({
			key: n.nodeKey,
			kind: n.kind,
			typeId: n.typeId,
			typeVersion: n.typeVersion,
			config: n.config,
			...(n.resolvedRefs ? { resolvedRefs: n.resolvedRefs } : {}),
			...(n.blockId ? { blockId: n.blockId } : {}),
			...(n.blockKind ? { blockKind: n.blockKind } : {}),
			...(n.blockChain ? { blockChain: n.blockChain } : {}),
			position: n.position
		})),
		edges: edgeRows.map((e: any) => ({
			from: e.fromBlockId ?? keyOf.get(e.fromNodeId)!,
			fromPort: e.fromPort,
			to: keyOf.get(e.toNodeId)!,
			toPort: e.toPort,
			...(e.edgeShape ? { shape: e.edgeShape } : {}),
			...(e.streaming === null ? {} : { streaming: e.streaming }),
			...(e.implicit === null ? {} : { implicit: e.implicit })
		})),
		blocks: blockRows.map((b: any) => ({
			id: b.blockId,
			kind: b.kind,
			mode: b.mode,
			...(b.overRef ? { over: b.overRef } : {}),
			...(b.max !== null ? { max: b.max } : {}),
			...(b.repeatWhile ? { repeatWhile: b.repeatWhile } : {}),
			chains: chainsOf(nodeRows, b.blockId),
			...(b.parentBlockId ? { blockId: b.parentBlockId } : {}),
			position: b.position
		})) as SpecDocument["blocks"]
	}

	// Through the SDK's importer rather than returned raw: import is where a
	// document is checked, and a document core assembled from its own rows
	// deserves the same scrutiny as one that arrived in a zip file.
	return importDocument(doc)
}

/**
 * A block's chains are derivable from its member nodes, so they are not stored.
 * Storing them would create a second place for the same fact to be wrong.
 */
function chainsOf(nodeRows: any[], blockId: string): string[] {
	const seen: string[] = []
	for (const n of nodeRows)
		if (
			n.blockId === blockId &&
			n.blockChain &&
			!seen.includes(n.blockChain)
		)
			seen.push(n.blockChain)
	return seen
}

const stripVersion = (slug: string) => slug.replace(/@\d+$/, "")
const versionOf = (slug: string) => Number(/@(\d+)$/.exec(slug)?.[1] ?? 1)
