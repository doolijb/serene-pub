/**
 * Composite steps — the server half (PLAN-pipeline-canvas-and-genre-authoring
 * §5): the pipeline library's saved runs of steps. The canvas lifts a run out
 * of a draft (`extractComposite`) and saves it here; `pipelines:catalogue`
 * lists every row so the canvas can insert one back (`insertComposite`).
 *
 * Every event is admin-only and answers a refusal on its `:error` twin with a
 * sentence, as `pipelineDrafts.ts` does.
 */
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { asc, eq, sql } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { getDefinition } from "@serene-pub/sdk"

type Emit = (event: string, data: any) => void

/** `<owner>:composite/<name>` — plugin slug grammar for the owner. */
const COMPOSITE_SLUG =
	/^[a-z0-9]+([.-][a-z0-9]+)*:composite\/[a-z0-9]+(-[a-z0-9]+)*$/

const DENIED = "Access denied. Only admin users can manage pipelines."

/** Refuse on `<event>:error` and return the refusal. */
function refuse(emitToUser: Emit, event: string, error: string) {
	const res = { error }
	emitToUser(`${event}:error`, res)
	return res
}

type Row = typeof schema.pipelineComposites.$inferSelect
type Doc = Sockets.Pipelines.Composite.Document

function toSummary(row: Row): Sockets.Pipelines.Composite.Summary {
	const doc = row.document as unknown as Doc
	return {
		slug: row.slug,
		label: row.label,
		nodeCount: row.nodeCount,
		reads: Array.isArray(doc?.reads) ? doc.reads : [],
		updatedAt: new Date(row.updatedAt).toISOString()
	}
}

/** Every composite step in the library, ordered by label — for the catalogue. */
export async function listComposites(): Promise<
	Sockets.Pipelines.Composite.Listed[]
> {
	const rows = await db
		.select()
		.from(schema.pipelineComposites)
		.orderBy(asc(schema.pipelineComposites.label))
	return rows.map((row) => ({
		...toSummary(row),
		document: row.document as unknown as Doc
	}))
}

/** The first thing wrong with a composite document, as a sentence; null when sound. */
function documentProblem(document: unknown): string | null {
	const doc = document as Partial<Doc> | null | undefined
	if (!doc || typeof doc !== "object")
		return "A composite step needs a document."
	if (!Array.isArray(doc.nodes) || doc.nodes.length === 0)
		return "A composite step needs at least one step."
	if (doc.clauses != null && !Array.isArray(doc.clauses))
		return "A composite step's clauses must be a list."
	if (doc.reads != null && !Array.isArray(doc.reads))
		return "A composite step's reads must be a list."
	const seen = new Set<string>()
	for (const n of doc.nodes as any[]) {
		if (
			!n ||
			typeof n !== "object" ||
			typeof n.key !== "string" ||
			!n.key ||
			typeof n.definitionId !== "string" ||
			!n.definitionId ||
			typeof n.definitionVersion !== "number" ||
			!Number.isFinite(n.definitionVersion) ||
			typeof n.kind !== "string" ||
			!n.kind
		)
			return "Every step in a composite needs a key, a definition, a definition version and a kind."
		if (!getDefinition(`${n.definitionId}@${n.definitionVersion}`))
			return `${n.key} uses ${n.definitionId}@${n.definitionVersion}, which this pub does not have.`
		if (seen.has(n.key))
			return `The key '${n.key}' is used twice in this composite step.`
		seen.add(n.key)
	}
	for (const c of (doc.clauses ?? []) as any[]) {
		const key = c?.id ?? c?.key
		if (typeof key !== "string" || !key)
			return "Every clause in a composite needs an id."
		if (seen.has(key))
			return `The key '${key}' is used twice in this composite step.`
		seen.add(key)
	}
	return null
}

// ─── composite:save ─────────────────────────────────────────────────────────

export const pipelinesCompositeSave: Handler<
	Sockets.Pipelines.CompositeSave.Params,
	Sockets.Pipelines.CompositeSave.Response
> = {
	event: "pipelines:composite:save",
	handler: async (socket, params, emitToUser) => {
		const event = "pipelines:composite:save"
		if (!socket.user?.isAdmin) return refuse(emitToUser, event, DENIED)
		const slug = String(params.slug ?? "")
		const label = String(params.label ?? "").trim()
		if (!COMPOSITE_SLUG.test(slug))
			return refuse(
				emitToUser,
				event,
				`'${slug}' is not a composite step id: use owner:composite/name, lower case, with dots or dashes between words.`
			)
		if (slug.split(":")[0] === "core")
			return refuse(
				emitToUser,
				event,
				"The 'core' owner belongs to Serene Pub; pick an owner of your own."
			)
		if (!label)
			return refuse(emitToUser, event, "Give the composite step a label.")
		const problem = documentProblem(params.document)
		if (problem) return refuse(emitToUser, event, problem)

		const doc = params.document
		// A round trip through JSON drops `undefined` keys, so what is stored
		// is what the next read returns.
		const document: Doc = JSON.parse(
			JSON.stringify({
				nodes: doc.nodes,
				clauses: doc.clauses ?? [],
				reads: doc.reads ?? []
			})
		)
		const values = {
			slug,
			label,
			userId: socket.user.id,
			document: document as unknown as Record<string, any>,
			nodeCount: document.nodes.length
		}
		const [row] = await db
			.insert(schema.pipelineComposites)
			.values(values)
			.onConflictDoUpdate({
				target: schema.pipelineComposites.slug,
				set: {
					label: values.label,
					userId: values.userId,
					document: values.document,
					nodeCount: values.nodeCount,
					updatedAt: sql`now()`
				}
			})
			.returning()

		const res = { slug: row.slug, composite: toSummary(row) }
		emitToUser(event, res)
		return res
	}
}

// ─── composite:delete ───────────────────────────────────────────────────────

export const pipelinesCompositeDelete: Handler<
	Sockets.Pipelines.CompositeDelete.Params,
	Sockets.Pipelines.CompositeDelete.Response
> = {
	event: "pipelines:composite:delete",
	handler: async (socket, params, emitToUser) => {
		const event = "pipelines:composite:delete"
		if (!socket.user?.isAdmin) return refuse(emitToUser, event, DENIED)
		const slug = String(params.slug ?? "")
		const gone = await db
			.delete(schema.pipelineComposites)
			.where(eq(schema.pipelineComposites.slug, slug))
			.returning({ id: schema.pipelineComposites.id })
		if (!gone.length)
			return refuse(
				emitToUser,
				event,
				`There is no composite step called '${slug}'.`
			)
		const res = { slug, deleted: true as const }
		emitToUser(event, res)
		return res
	}
}
