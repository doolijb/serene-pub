/**
 * The pipeline editor's server half (PLAN-pipeline-canvas-and-genre-authoring
 * §4.1–§4.2): an admin's unpublished draft of a spec, what publishing it would
 * do to the spec's configurations, the publish itself, the node catalogue the
 * editor draws from, and the fork that turns a shipped spec into one an admin
 * may edit.
 *
 * Every event is admin-only and answers a refusal on its `:error` twin with a
 * sentence. A draft is per (spec, admin) and may be invalid — that is why it
 * lives in `pipeline_drafts` and not as a `pipeline_spec_versions` row, which
 * `saveDocument` only writes once the document validates.
 */
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, asc, eq, inArray } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import {
	allDefinitions,
	canonicalHash,
	compile,
	getDefinition,
	snapshotRegistry,
	validate,
	type BuiltSpec,
	type Finding,
	type SpecDocument
} from "@serene-pub/sdk"
import { loadDocument, saveDocument } from "$lib/server/pipelines/boot/store"
import { reconcileConfigs } from "$lib/server/pipelines/config/named"
import { pipelinesDetail } from "./pipelines"
import { listComposites } from "./pipelineComposites"

type Emit = (event: string, data: any) => void

/** Plugin slug grammar — the owner segment of an in-app spec's id (§4 rulings). */
const OWNER_SLUG = /^[a-z0-9]+([.-][a-z0-9]+)*$/
const SPEC_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

const DENIED = "Access denied. Only admin users can manage pipelines."

/** Refuse on `<event>:error` and return the refusal. */
function refuse(emitToUser: Emit, event: string, error: string) {
	const res = { error }
	emitToUser(`${event}:error`, res)
	return res
}

async function specBySlug(slug: string) {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
		.limit(1)
	return spec
}

/** Core's or a plugin's — editing it must fork first. */
const isShipped = (spec: { slug: string; sourcePluginId: number | null }) =>
	spec.slug.startsWith("core:") || spec.sourcePluginId != null

async function draftRow(specId: number, userId: number) {
	const [row] = await db
		.select()
		.from(schema.pipelineDrafts)
		.where(
			and(
				eq(schema.pipelineDrafts.specId, specId),
				eq(schema.pipelineDrafts.userId, userId)
			)
		)
		.limit(1)
	return row
}

async function toDraft(
	row: typeof schema.pipelineDrafts.$inferSelect
): Promise<Sockets.Pipelines.Draft.Draft> {
	let basedOnSemver: string | null = null
	if (row.basedOnVersionId != null) {
		const [v] = await db
			.select({ semver: schema.pipelineSpecVersions.semver })
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.id, row.basedOnVersionId))
			.limit(1)
		basedOnSemver = v?.semver ?? null
	}
	return {
		document: row.document as unknown as SpecDocument,
		findings: (row.findings ?? []) as unknown as Finding[],
		basedOnVersionId: row.basedOnVersionId ?? null,
		basedOnSemver,
		updatedAt: new Date(row.updatedAt).toISOString()
	}
}

/**
 * Rebuild a client-sent document's derived half — edges and each node's
 * `resolvedRefs` — through the SDK's own compile, so a draft never stores an
 * edge the client drew by hand.
 */
function recompile(doc: SpecDocument): SpecDocument {
	const built = {
		id: doc.id,
		meta: {
			version: doc.version,
			genre: doc.genre,
			contributes: doc.contributes,
			taxonomy: doc.taxonomy
		},
		input: doc.input,
		nodes: (doc.nodes ?? []).map(({ resolvedRefs: _r, ...n }) => n),
		clauses: doc.clauses ?? [],
		includes: doc.includes ?? [],
		presets: doc.presets ?? []
	} as unknown as BuiltSpec
	// A round trip through JSON drops the `undefined` keys compile writes, so
	// what is stored is what the next read returns.
	return JSON.parse(JSON.stringify(compile(built)))
}

/**
 * `validate()` never refuses here: a draft may be invalid. A throw becomes a
 * finding. And `validate()` skips a node whose definition is not registered
 * (it looks every node up and says nothing when the lookup fails), so that
 * check is made here: a draft naming a definition this install does not have
 * cannot be published, which is what `checkInstall` would say at install.
 */
function findingsOf(doc: SpecDocument): Finding[] {
	const unknown: Finding[] = doc.nodes
		.filter((n) => !getDefinition(`${n.definitionId}@${n.definitionVersion}`))
		.map((n) => ({
			law: "registry",
			severity: "error" as const,
			nodeKey: n.key,
			message: `${n.key} uses ${n.definitionId}@${n.definitionVersion}, which this pub does not have.`,
			fix: "Pick a definition from the catalogue, or install the plugin that provides this one."
		}))
	try {
		return [...unknown, ...validate(doc)]
	} catch (e) {
		return [
			{
				law: "validate",
				severity: "error",
				message: e instanceof Error ? e.message : String(e),
				fix: "Correct the document so it can be checked."
			}
		]
	}
}

// ─── draft:get ──────────────────────────────────────────────────────────────

export const pipelinesDraftGet: Handler<
	Sockets.Pipelines.DraftGet.Params,
	Sockets.Pipelines.DraftGet.Response
> = {
	event: "pipelines:draft:get",
	handler: async (socket, params, emitToUser) => {
		const event = "pipelines:draft:get"
		if (!socket.user?.isAdmin) return refuse(emitToUser, event, DENIED)
		const spec = await specBySlug(params.slug)
		if (!spec)
			return refuse(
				emitToUser,
				event,
				`There is no pipeline called '${params.slug}'.`
			)
		const row = await draftRow(spec.id, socket.user.id)
		const res: Sockets.Pipelines.DraftGet.Response = {
			slug: spec.slug,
			draft: row ? await toDraft(row) : null,
			shipped: isShipped(spec)
		}
		emitToUser(event, res)
		return res
	}
}

// ─── draft:put ──────────────────────────────────────────────────────────────

export const pipelinesDraftPut: Handler<
	Sockets.Pipelines.DraftPut.Params,
	Sockets.Pipelines.DraftPut.Response
> = {
	event: "pipelines:draft:put",
	handler: async (socket, params, emitToUser) => {
		const event = "pipelines:draft:put"
		if (!socket.user?.isAdmin) return refuse(emitToUser, event, DENIED)
		const spec = await specBySlug(params.slug)
		if (!spec)
			return refuse(
				emitToUser,
				event,
				`There is no pipeline called '${params.slug}'.`
			)
		if (isShipped(spec))
			return refuse(
				emitToUser,
				event,
				`'${spec.slug}' ships with ${spec.sourcePluginId != null ? "a plugin" : "Serene Pub"} — fork it to edit a copy of your own.`
			)
		const doc = params.document
		if (!doc || typeof doc !== "object" || (doc as any).schemaVersion !== 1)
			return refuse(
				emitToUser,
				event,
				"That is not a pipeline document this version can read (schema 1)."
			)
		if (doc.id !== spec.slug)
			return refuse(
				emitToUser,
				event,
				`The document is '${doc.id}', not '${spec.slug}' — a draft cannot rename its pipeline.`
			)

		let compiled: SpecDocument
		try {
			compiled = recompile(doc)
		} catch (e) {
			return refuse(
				emitToUser,
				event,
				e instanceof Error ? e.message : String(e)
			)
		}
		const findings = findingsOf(compiled)

		const existing = await draftRow(spec.id, socket.user.id)
		let row: typeof schema.pipelineDrafts.$inferSelect
		if (existing) {
			;[row] = await db
				.update(schema.pipelineDrafts)
				.set({
					document: compiled as any,
					findings: findings as any,
					updatedAt: new Date()
				})
				.where(eq(schema.pipelineDrafts.id, existing.id))
				.returning()
		} else {
			;[row] = await db
				.insert(schema.pipelineDrafts)
				.values({
					specId: spec.id,
					userId: socket.user.id,
					basedOnVersionId: spec.activeVersionId ?? null,
					document: compiled as any,
					findings: findings as any
				})
				.onConflictDoUpdate({
					target: [
						schema.pipelineDrafts.specId,
						schema.pipelineDrafts.userId
					],
					set: {
						document: compiled as any,
						findings: findings as any,
						updatedAt: new Date()
					}
				})
				.returning()
		}
		const res: Sockets.Pipelines.DraftPut.Response = {
			slug: spec.slug,
			draft: await toDraft(row)
		}
		emitToUser(event, res)
		return res
	}
}

// ─── draft:discard ──────────────────────────────────────────────────────────

export const pipelinesDraftDiscard: Handler<
	Sockets.Pipelines.DraftDiscard.Params,
	Sockets.Pipelines.DraftDiscard.Response
> = {
	event: "pipelines:draft:discard",
	handler: async (socket, params, emitToUser) => {
		const event = "pipelines:draft:discard"
		if (!socket.user?.isAdmin) return refuse(emitToUser, event, DENIED)
		const spec = await specBySlug(params.slug)
		if (!spec)
			return refuse(
				emitToUser,
				event,
				`There is no pipeline called '${params.slug}'.`
			)
		await db
			.delete(schema.pipelineDrafts)
			.where(
				and(
					eq(schema.pipelineDrafts.specId, spec.id),
					eq(schema.pipelineDrafts.userId, socket.user.id)
				)
			)
		const res = { slug: spec.slug, discarded: true as const }
		emitToUser(event, res)
		return res
	}
}

// ─── draft:preview ──────────────────────────────────────────────────────────

/** The (nodeKey → declared slot names) a document's nodes carry. */
function declaredSlots(doc: SpecDocument | null): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>()
	for (const n of doc?.nodes ?? []) {
		const def = getDefinition(`${n.definitionId}@${n.definitionVersion}`)
		out.set(n.key, new Set(Object.keys(def?.slots ?? {})))
	}
	return out
}

const declares = (
	slots: Map<string, Set<string>>,
	nodeKey: string,
	slot: string
) => slots.get(nodeKey)?.has(slot) ?? false

const addressOf = (r: { nodeKey: string; slot: string; path?: string | null }) =>
	`${r.nodeKey}.${r.slot}${r.path ? `.${r.path}` : ""}`

/**
 * What publishing would do to each configuration of the spec, nothing written.
 *
 * Mirrors `reconcileConfigs`' address rule at the (node, slot) grain: a value
 * row is culled when the draft has no node with its key, or that node's
 * definition declares no slot of that name. Judged as a CHANGE against the
 * active version — a row the active version already does not declare (an
 * envoy's synthetic node key, say) is not something this publish culls.
 * Back-filled is the other side: a (node, slot) the draft declares, the active
 * version does not, and the configuration holds no value for. Whether the
 * back-fill then writes a row depends on the shipped default deviating, which
 * only the publish can know.
 */
async function affectedConfigs(
	specId: number,
	activeVersionId: number | null,
	draft: SpecDocument
): Promise<Sockets.Pipelines.Draft.Affected[]> {
	// 🚧 R50 (lane F1, 0110): configurations are retired — nothing reads one,
	// so a publish culls or back-fills none. Values live on registrations and
	// a pipeline's instance values, which the publish's A11 re-check judges.
	void specId
	void activeVersionId
	void draft
	return []
}

export const pipelinesDraftPreview: Handler<
	Sockets.Pipelines.DraftPreview.Params,
	Sockets.Pipelines.DraftPreview.Response
> = {
	event: "pipelines:draft:preview",
	handler: async (socket, params, emitToUser) => {
		const event = "pipelines:draft:preview"
		if (!socket.user?.isAdmin) return refuse(emitToUser, event, DENIED)
		const spec = await specBySlug(params.slug)
		if (!spec)
			return refuse(
				emitToUser,
				event,
				`There is no pipeline called '${params.slug}'.`
			)
		const row = await draftRow(spec.id, socket.user.id)
		if (!row)
			return refuse(
				emitToUser,
				event,
				`You have no draft of '${spec.slug}' to preview.`
			)
		const doc = {
			...(row.document as unknown as SpecDocument),
			version: params.semver
		}
		const findings = findingsOf(doc)
		const hash = canonicalHash(doc)
		const sameSemver = await db
			.select({ hash: schema.pipelineSpecVersions.canonicalHash })
			.from(schema.pipelineSpecVersions)
			.where(
				and(
					eq(schema.pipelineSpecVersions.specId, spec.id),
					eq(schema.pipelineSpecVersions.semver, params.semver),
					inArray(schema.pipelineSpecVersions.status, [
						"published",
						"retired"
					])
				)
			)
		const res: Sockets.Pipelines.DraftPreview.Response = {
			slug: spec.slug,
			findings,
			semverTaken: sameSemver.some((v) => v.hash !== hash),
			affected: await affectedConfigs(spec.id, spec.activeVersionId, doc)
		}
		emitToUser(event, res)
		return res
	}
}

// ─── draft:publish ──────────────────────────────────────────────────────────

export const pipelinesDraftPublish: Handler<
	Sockets.Pipelines.DraftPublish.Params,
	Sockets.Pipelines.DraftPublish.Response
> = {
	event: "pipelines:draft:publish",
	handler: async (socket, params, emitToUser) => {
		const event = "pipelines:draft:publish"
		if (!socket.user?.isAdmin) return refuse(emitToUser, event, DENIED)
		const spec = await specBySlug(params.slug)
		if (!spec)
			return refuse(
				emitToUser,
				event,
				`There is no pipeline called '${params.slug}'.`
			)
		if (isShipped(spec))
			return refuse(
				emitToUser,
				event,
				`'${spec.slug}' ships with ${spec.sourcePluginId != null ? "a plugin" : "Serene Pub"} — fork it to publish a copy of your own.`
			)
		if (!params.semver || typeof params.semver !== "string")
			return refuse(emitToUser, event, "Give the version a semver.")
		const row = await draftRow(spec.id, socket.user.id)
		if (!row)
			return refuse(
				emitToUser,
				event,
				`You have no draft of '${spec.slug}' to publish.`
			)
		const doc = {
			...(row.document as unknown as SpecDocument),
			version: params.semver
		}

		let saved: Awaited<ReturnType<typeof saveDocument>>
		try {
			saved = await saveDocument(db as any, doc, { publish: true })
		} catch (e) {
			return refuse(
				emitToUser,
				event,
				e instanceof Error ? e.message : String(e)
			)
		}
		const reports = await reconcileConfigs(
			db as any,
			saved.specId,
			saved.specVersionId,
			spec.slug
		)
		// 🚧 A11: every registration that runs this pipeline goes back through
		// the door — one the new version does not fit is left out, and its
		// preset says so. Best-effort: the publish has landed.
		{
			const { refitAfterChange } = await import("$lib/server/pipelines/registrations/fit")
			await refitAfterChange(db as any, [spec.slug])
		}
		await db
			.delete(schema.pipelineDrafts)
			.where(eq(schema.pipelineDrafts.id, row.id))

		const res: Sockets.Pipelines.DraftPublish.Response = {
			slug: spec.slug,
			version: {
				id: saved.specVersionId,
				semver: params.semver,
				canonicalHash: saved.canonicalHash
			},
			reconcile: {
				culled: reports.reduce((n, r) => n + r.culled.length, 0),
				backfilled: reports.reduce((n, r) => n + r.backfilled.length, 0)
			}
		}
		emitToUser(event, res)
		// The workspace's own view of the spec moves with the publish.
		await pipelinesDetail.handler(socket, { slug: spec.slug }, emitToUser)
		return res
	}
}

// ─── catalogue ──────────────────────────────────────────────────────────────

export const pipelinesCatalogue: Handler<
	Sockets.Pipelines.Catalogue.Params,
	Sockets.Pipelines.Catalogue.Response
> = {
	event: "pipelines:catalogue",
	handler: async (socket, _params, emitToUser) => {
		const event = "pipelines:catalogue"
		if (!socket.user?.isAdmin) return refuse(emitToUser, event, DENIED)
		const res: Sockets.Pipelines.Catalogue.Response = {
			definitions: JSON.parse(
				JSON.stringify(snapshotRegistry(allDefinitions()))
			),
			composites: await listComposites()
		}
		emitToUser(event, res)
		return res
	}
}

// ─── fork ───────────────────────────────────────────────────────────────────

export const pipelinesFork: Handler<
	Sockets.Pipelines.Fork.Params,
	Sockets.Pipelines.Fork.Response
> = {
	event: "pipelines:fork",
	handler: async (socket, params, emitToUser) => {
		const event = "pipelines:fork"
		if (!socket.user?.isAdmin) return refuse(emitToUser, event, DENIED)
		const ownerSlug = String(params.ownerSlug ?? "")
		const name = String(params.name ?? "")
		const label = String(params.label ?? "").trim()
		if (!OWNER_SLUG.test(ownerSlug) || ownerSlug === "core")
			return refuse(
				emitToUser,
				event,
				ownerSlug === "core"
					? "'core' is Serene Pub's own name — choose an owner name of your own."
					: "The owner name takes lowercase letters and digits, joined by single dots or hyphens."
			)
		if (!SPEC_NAME.test(name))
			return refuse(
				emitToUser,
				event,
				"The pipeline name takes lowercase letters and digits, joined by single hyphens."
			)
		const source = await specBySlug(params.slug)
		if (!source)
			return refuse(
				emitToUser,
				event,
				`There is no pipeline called '${params.slug}'.`
			)
		if (!source.activeVersionId)
			return refuse(
				emitToUser,
				event,
				`'${source.slug}' has no published version to copy.`
			)
		const newSlug = `${ownerSlug}:spec/${name}`
		if (await specBySlug(newSlug))
			return refuse(
				emitToUser,
				event,
				`There is already a pipeline called '${newSlug}'.`
			)

		const doc: SpecDocument = {
			...(await loadDocument(db as any, source.activeVersionId)),
			id: newSlug
		}
		// Slash names are pub-wide: a copy that kept them would collide with
		// its source the moment it published.
		if (doc.contributes && typeof doc.contributes === "object") {
			const { actions: _a, ...rest } = doc.contributes as Record<
				string,
				unknown
			>
			if (Object.keys(rest).length) doc.contributes = rest
			else delete doc.contributes
		}

		let saved: Awaited<ReturnType<typeof saveDocument>>
		try {
			saved = await saveDocument(db as any, doc, {
				publish: true,
				name: label || newSlug
			})
		} catch (e) {
			return refuse(
				emitToUser,
				event,
				e instanceof Error ? e.message : String(e)
			)
		}
		await db
			.update(schema.pipelineSpecVersions)
			.set({ derivedFromSpecVersionId: source.activeVersionId })
			.where(eq(schema.pipelineSpecVersions.id, saved.specVersionId))
		// The boot would give the copy its shipped configuration on the next
		// start; the editor needs it now.
		await reconcileConfigs(db as any, saved.specId, saved.specVersionId, newSlug)

		const res = { slug: newSlug }
		emitToUser(event, res)
		return res
	}
}

