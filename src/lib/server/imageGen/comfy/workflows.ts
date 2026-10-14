/**
 * The `workflows` entity (DESIGN-image-generation §4.10, §4.12): list, read,
 * write, duplicate, export and import — the database half the sockets wrap.
 *
 * A **workflow** is a provider document one dialect consumes. Today the only
 * dialect is `comfyui`. Seeded starters (`seed_key` set) are read-only and
 * refreshed on boot; a person duplicates one to change it.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { ImageWorkflowDocument, WorkflowVariable } from "$lib/shared/imageGen/types"
import { asComfyGraph } from "./graph"
import { applyFit, fitComfyWorkflow, type FitProposal } from "./fit"
import { defaultScope, mergeScope, renderWorkflow, sampleRender } from "./render"
import { asDocument, forgetWorkflow, recheckWorkflowEverywhere } from "./serverCheck"
import type { ObjectInfoSummary } from "./objectInfo"

export const WORKFLOW_DIALECTS = ["comfyui"] as const
export type WorkflowDialect = (typeof WORKFLOW_DIALECTS)[number]

/** The marker an exported file carries, so an import can tell ours from a raw graph. */
export const WORKFLOW_FILE_FORMAT = "serene-pub/workflow"

export const STARTER_READ_ONLY =
	"This starter is read-only. Duplicate it to change it."

export class WorkflowError extends Error {}

export type WorkflowRow = typeof schema.workflows.$inferSelect

export interface WorkflowSummary {
	id: number
	name: string
	description: string | null
	dialect: string
	/** A shipped starter: read-only, refreshed on boot. */
	isStarter: boolean
	seedKey: string | null
	outputNode: string | null
	variableCount: number
	updatedAt: string
}

export const summarise = (w: WorkflowRow): WorkflowSummary => ({
	id: w.id,
	name: w.name,
	description: w.description ?? null,
	dialect: w.dialect,
	isStarter: w.seedKey != null,
	seedKey: w.seedKey ?? null,
	outputNode: w.outputNode ?? null,
	variableCount: Array.isArray(w.variables) ? w.variables.length : 0,
	updatedAt: w.updatedAt.toISOString()
})

export interface WorkflowInput {
	name: string
	description?: string | null
	dialect?: string
	document: string
	variables?: WorkflowVariable[]
	outputNode?: string | null
}

/**
 * Refuse what cannot be saved: an unknown dialect, an empty name, or a
 * document that does not render (with its defaults) into an API graph.
 */
export async function assertSavable(input: WorkflowInput): Promise<void> {
	if (!input.name?.trim()) throw new WorkflowError("A workflow needs a name.")
	const dialect = input.dialect ?? "comfyui"
	if (!WORKFLOW_DIALECTS.includes(dialect as WorkflowDialect))
		throw new WorkflowError(`Unknown workflow dialect "${dialect}".`)
	if (typeof input.document !== "string" || !input.document.trim())
		throw new WorkflowError("The workflow is empty.")
	const { graph } = await sampleRender({
		document: input.document,
		variables: input.variables ?? []
	}).catch((e) => {
		throw new WorkflowError(e instanceof Error ? e.message : String(e))
	})
	if (input.outputNode && !graph[input.outputNode])
		throw new WorkflowError(
			`The output mark names node ${input.outputNode}, which this workflow does not have.`
		)
}

export async function listWorkflows(db: Db, dialect?: string): Promise<WorkflowSummary[]> {
	const rows = await db.query.workflows.findMany({
		...(dialect ? { where: (w, { eq }) => eq(w.dialect, dialect) } : {}),
		orderBy: (w, { asc }) => [asc(w.name), asc(w.id)]
	})
	return rows.map(summarise)
}

export async function getWorkflow(db: Db, id: number): Promise<WorkflowRow | undefined> {
	return db.query.workflows.findFirst({ where: (w, { eq }) => eq(w.id, id) })
}

export async function getWorkflowDocument(
	db: Db,
	id: number
): Promise<ImageWorkflowDocument | null> {
	const row = await getWorkflow(db, id)
	return row ? asDocument(row) : null
}

export async function createWorkflow(db: Db, input: WorkflowInput): Promise<WorkflowRow> {
	await assertSavable(input)
	const [row] = await db
		.insert(schema.workflows)
		.values({
			name: input.name.trim(),
			description: input.description ?? null,
			dialect: input.dialect ?? "comfyui",
			document: input.document,
			variables: input.variables ?? [],
			outputNode: input.outputNode ?? null
		})
		.returning()
	return row!
}

export async function updateWorkflow(
	db: Db,
	id: number,
	patch: Partial<WorkflowInput>
): Promise<WorkflowRow> {
	const current = await getWorkflow(db, id)
	if (!current) throw new WorkflowError("That workflow no longer exists.")
	if (current.seedKey) throw new WorkflowError(STARTER_READ_ONLY)
	const next: WorkflowInput = {
		name: patch.name ?? current.name,
		description: patch.description !== undefined ? patch.description : current.description,
		dialect: patch.dialect ?? current.dialect,
		document: patch.document ?? current.document,
		variables: patch.variables ?? (current.variables as WorkflowVariable[]),
		outputNode: patch.outputNode !== undefined ? patch.outputNode : current.outputNode
	}
	await assertSavable(next)
	const [row] = await db
		.update(schema.workflows)
		.set({
			name: next.name.trim(),
			description: next.description ?? null,
			dialect: next.dialect ?? "comfyui",
			document: next.document,
			variables: next.variables ?? [],
			outputNode: next.outputNode ?? null,
			updatedAt: new Date()
		})
		.where(eq(schema.workflows.id, id))
		.returning()
	// A saved edit is re-checked on every server that has checked it (§4.9).
	await recheckWorkflowEverywhere(db, asDocument(row!))
	return row!
}

export async function deleteWorkflow(db: Db, id: number): Promise<void> {
	const current = await getWorkflow(db, id)
	if (!current) return
	if (current.seedKey) throw new WorkflowError(STARTER_READ_ONLY)
	await db.delete(schema.workflows).where(eq(schema.workflows.id, id))
	await forgetWorkflow(db, id)
}

export async function duplicateWorkflow(db: Db, id: number): Promise<WorkflowRow> {
	const current = await getWorkflow(db, id)
	if (!current) throw new WorkflowError("That workflow no longer exists.")
	const [row] = await db
		.insert(schema.workflows)
		.values({
			name: `${current.name} (copy)`,
			description: current.description,
			dialect: current.dialect,
			document: current.document,
			variables: current.variables,
			outputNode: current.outputNode
		})
		.returning()
	return row!
}

/** The file an export writes (§4.12): the document with holes plus its meta. */
export interface WorkflowFile {
	format: typeof WORKFLOW_FILE_FORMAT
	version: 1
	name: string
	description?: string | null
	dialect: string
	document: string
	variables: WorkflowVariable[]
	outputNode: string | null
}

/**
 * Export one workflow. `withDefaults` writes a runnable plain-ComfyUI API
 * file instead — every hole filled with its declared default — which loads
 * in ComfyUI but round-trips here only through the fitting walk.
 */
export async function exportWorkflow(
	db: Db,
	id: number,
	opts: { withDefaults?: boolean } = {}
): Promise<{ filename: string; content: string }> {
	const row = await getWorkflow(db, id)
	if (!row) throw new WorkflowError("That workflow no longer exists.")
	const base = row.name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "workflow"
	if (opts.withDefaults) {
		const graph = await renderWorkflow(
			row.document,
			mergeScope(defaultScope(row.variables as WorkflowVariable[]), {
				runId: "export",
				key: "1",
				clientId: "export"
			})
		)
		return { filename: `${base}.api.json`, content: JSON.stringify(graph, null, 2) }
	}
	const file: WorkflowFile = {
		format: WORKFLOW_FILE_FORMAT,
		version: 1,
		name: row.name,
		description: row.description,
		dialect: row.dialect,
		document: row.document,
		variables: row.variables as WorkflowVariable[],
		outputNode: row.outputNode ?? null
	}
	return { filename: `${base}.workflow.json`, content: JSON.stringify(file, null, 2) }
}

/**
 * Import a file: our own export as-is, or a raw ComfyUI API graph through the
 * fitting walk with every suggested hole chosen (the confirm form is the
 * Workflows tab's; `workflows:fit` lets it run the walk first). The UI format
 * is refused by name.
 */
export async function importWorkflow(
	db: Db,
	content: string,
	opts: { name?: string; objectInfo?: ObjectInfoSummary | null } = {}
): Promise<{ row: WorkflowRow; proposal?: FitProposal }> {
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		throw new WorkflowError("That file is not JSON.")
	}
	const file = parsed as Partial<WorkflowFile>
	if (file && typeof file === "object" && file.format === WORKFLOW_FILE_FORMAT) {
		const row = await createWorkflow(db, {
			name: opts.name ?? file.name ?? "Imported workflow",
			description: file.description ?? null,
			dialect: file.dialect ?? "comfyui",
			document: String(file.document ?? ""),
			variables: Array.isArray(file.variables) ? file.variables : [],
			outputNode: file.outputNode ?? null
		})
		return { row }
	}
	const graph = asComfyGraph(parsed)
	if (!graph.ok) throw new WorkflowError(graph.error)
	const proposal = fitComfyWorkflow(graph.graph, opts.objectInfo)
	const applied = applyFit(graph.graph, proposal)
	const row = await createWorkflow(db, {
		name: opts.name ?? "Imported workflow",
		document: applied.document,
		variables: applied.variables,
		outputNode: applied.outputNode
	})
	return { row, proposal }
}
