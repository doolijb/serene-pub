/**
 * Does a workflow fit THIS ComfyUI? (DESIGN-image-generation §4.9, validation.)
 *
 * At save, at bind and on connection test: every `class_type` must be one the
 * server has, and every literal landing on an enum input (a baked checkpoint,
 * LoRA, VAE, sampler) one it lists. A miss puts the connection row
 * `unfinished` and names it — *Missing nodes: IPAdapterApply* · *This workflow
 * names sdxl_base.safetensors; your ComfyUI doesn't have it.* We say; the
 * person fixes it in ComfyUI.
 *
 * ## Where the facts live
 *
 * `connections.extra_json.comfy` — server-owned (the update handler keeps it
 * from the stored row, never from a client's copy):
 *
 *  - `objectInfo` — the summarised `/object_info` (classes + enums), cached
 *    for the validator and the variables panel's selects;
 *  - `checks` — `{ [workflowId]: problem | null }`, every workflow checked
 *    against this server (bound, validated or drawn with). A connection test
 *    re-checks them all, which is the drift rule;
 *  - `problem` — the sentence the row shows, joined from `checks`.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { ImageWorkflowDocument } from "$lib/shared/imageGen/types"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"
import { checkGraphAgainst, workflowProblem, type ObjectInfoSummary, type WorkflowCheck } from "./objectInfo"
import { sampleRender } from "./render"

export interface ComfyFacts {
	objectInfo?: ObjectInfoSummary
	checkedAt?: string
	checks?: Record<string, string | null>
	problem?: string | null
}

/** The server-owned key under `extra_json`. */
export const COMFY_FACTS_KEY = "comfy"

export function comfyFactsOf(connection: { extraJson?: unknown } | null | undefined): ComfyFacts {
	const v = (connection?.extraJson as Record<string, unknown> | undefined)?.[COMFY_FACTS_KEY]
	return v && typeof v === "object" ? (v as ComfyFacts) : {}
}

/** The row's sentence, from every recorded check. */
function joinProblems(checks: Record<string, string | null>): string | null {
	const parts = [...new Set(Object.values(checks).filter((p): p is string => !!p))]
	return parts.length ? parts.join(" · ") : null
}

async function writeFacts(
	db: Db,
	connectionId: number,
	mutate: (facts: ComfyFacts) => ComfyFacts
): Promise<ComfyFacts> {
	const row = await db.query.connections.findFirst({
		where: (c, { eq }) => eq(c.id, connectionId)
	})
	if (!row) return {}
	const next = mutate({ ...comfyFactsOf(row) })
	next.problem = joinProblems(next.checks ?? {})
	await db
		.update(schema.connections)
		.set({ extraJson: { ...(row.extraJson ?? {}), [COMFY_FACTS_KEY]: next } })
		.where(eq(schema.connections.id, connectionId))
	return next
}

/** Check one workflow against a server's summary. Pure apart from the render. */
export async function checkWorkflow(
	workflow: Pick<ImageWorkflowDocument, "document" | "variables">,
	info: ObjectInfoSummary
): Promise<{ check: WorkflowCheck; problem: string | null }> {
	const { graph, holes } = await sampleRender(workflow)
	const check = checkGraphAgainst(graph, info, holes)
	return { check, problem: workflowProblem(check) }
}

/** A connection with its key decrypted, for a read the adapter makes. */
function readable(connection: SelectConnection): SelectConnection {
	const key = (connection.extraJson as any)?.apiKey
	return typeof key === "string" && key
		? {
				...connection,
				extraJson: { ...connection.extraJson, apiKey: decryptApiKeyField(key) ?? "" }
			}
		: connection
}

/** The cached summary, or a live `/object_info` read that refreshes the cache. */
export async function comfyObjectInfo(
	db: Db,
	connection: SelectConnection,
	opts: { refresh?: boolean } = {}
): Promise<ObjectInfoSummary> {
	const cached = comfyFactsOf(connection).objectInfo
	if (cached && !opts.refresh) return cached
	const { getImageAdapter } = await import("$lib/server/utils/getImageAdapter")
	const { fetchObjectInfo } = await getImageAdapter(connection.type)
	if (!fetchObjectInfo)
		throw new Error(`A ${connection.type} connection has no node catalogue to read.`)
	const info = await fetchObjectInfo(readable(connection))
	await writeFacts(db, connection.id, (f) => ({
		...f,
		objectInfo: info,
		checkedAt: new Date().toISOString()
	}))
	return info
}

/**
 * Check a workflow on a connection and RECORD the answer, so the row's state
 * follows. Returns the problem sentence, or null when it fits.
 */
export async function checkWorkflowOnConnection(
	db: Db,
	connection: SelectConnection,
	workflow: ImageWorkflowDocument,
	opts: { refresh?: boolean } = {}
): Promise<{ problem: string | null; check: WorkflowCheck }> {
	const info = await comfyObjectInfo(db, connection, opts)
	const result = await checkWorkflow(workflow, info)
	await writeFacts(db, connection.id, (f) => ({
		...f,
		checks: { ...(f.checks ?? {}), [String(workflow.id)]: result.problem }
	}))
	return result
}

/**
 * After a passing connection test: cache the `/object_info` it read, re-check
 * every workflow recorded against this server (drift), and take the summary
 * off the reply — it is the row's, not the browser's.
 */
export async function recordComfyTest(
	db: Db,
	connectionId: number | null | undefined,
	extra: Record<string, unknown> | undefined
): Promise<void> {
	const comfy = extra?.comfy as { objectInfo?: ObjectInfoSummary } | undefined
	if (!comfy?.objectInfo) return
	const info = comfy.objectInfo
	delete comfy.objectInfo
	if (connectionId == null) return
	const row = await db.query.connections.findFirst({
		where: (c, { eq }) => eq(c.id, connectionId)
	})
	const ids = Object.keys(comfyFactsOf(row).checks ?? {})
	const rows = ids.length
		? await db.query.workflows.findMany({
				where: (w, { inArray }) => inArray(w.id, ids.map(Number))
			})
		: []
	const checks: Record<string, string | null> = {}
	for (const w of rows)
		checks[String(w.id)] = (await checkWorkflow(asDocument(w), info).catch(() => ({ problem: null }))).problem
	await writeFacts(db, connectionId, (f) => ({
		...f,
		objectInfo: info,
		checkedAt: new Date().toISOString(),
		checks
	}))
}

/** A workflow changed: re-check it on every server that has checked it before. */
export async function recheckWorkflowEverywhere(db: Db, workflow: ImageWorkflowDocument): Promise<void> {
	const rows = await db.query.connections.findMany({
		where: (c, { eq }) => eq(c.type, CONNECTION_TYPE.COMFYUI)
	})
	for (const c of rows) {
		const facts = comfyFactsOf(c)
		if (!facts.objectInfo || !(String(workflow.id) in (facts.checks ?? {}))) continue
		const { problem } = await checkWorkflow(workflow, facts.objectInfo).catch(() => ({ problem: null }))
		await writeFacts(db, c.id, (f) => ({
			...f,
			checks: { ...(f.checks ?? {}), [String(workflow.id)]: problem }
		}))
	}
}

/** A workflow is gone: nothing about it should keep a row unfinished. */
export async function forgetWorkflow(db: Db, workflowId: number): Promise<void> {
	const rows = await db.query.connections.findMany({
		where: (c, { eq }) => eq(c.type, CONNECTION_TYPE.COMFYUI)
	})
	for (const c of rows) {
		if (!(String(workflowId) in (comfyFactsOf(c).checks ?? {}))) continue
		await writeFacts(db, c.id, (f) => {
			const checks = { ...(f.checks ?? {}) }
			delete checks[String(workflowId)]
			return { ...f, checks }
		})
	}
}

/** A `workflows` row as the adapter and the checks read it. */
export function asDocument(row: typeof schema.workflows.$inferSelect): ImageWorkflowDocument {
	return {
		id: row.id,
		name: row.name,
		dialect: row.dialect,
		document: row.document,
		variables: Array.isArray(row.variables) ? row.variables : [],
		outputNode: row.outputNode ?? null
	}
}
