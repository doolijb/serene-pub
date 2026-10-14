/**
 * 🚧 `workflows:*` — the workflows entity over the socket
 * (DESIGN-image-generation §4.10, §4.12). Admin-only, every handler:
 * connections and prompt writes are admin-only (10-09), and members meet a
 * workflow only as the pair named on a Fill form.
 *
 * Shaped like the sampling-config sockets: one handler per verb, the refusal
 * on `<event>:error`, and `workflows:list` re-sent after every write.
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	createWorkflow,
	deleteWorkflow,
	duplicateWorkflow,
	exportWorkflow,
	getWorkflow,
	importWorkflow,
	listWorkflows,
	updateWorkflow,
	WorkflowError
} from "$lib/server/imageGen/comfy/workflows"
import { applyFit, fitComfyWorkflow, type FitProposal } from "$lib/server/imageGen/comfy/fit"
import { asComfyGraph } from "$lib/server/imageGen/comfy/graph"
import {
	asDocument,
	checkWorkflow,
	checkWorkflowOnConnection,
	comfyFactsOf,
	comfyObjectInfo
} from "$lib/server/imageGen/comfy/serverCheck"

const DENIED = "Access denied. Only admin users can manage workflows."

function requireAdmin(socket: any, emitToUser: (event: string, data: any) => void) {
	if (!socket.user?.isAdmin) {
		emitToUser("error", { error: DENIED })
		throw new Error(DENIED)
	}
}

/** Emit a refusal on the event's own channel, then throw it. */
function refuse(
	emitToUser: (event: string, data: any) => void,
	event: string,
	error: unknown
): never {
	const message =
		error instanceof WorkflowError || error instanceof Error ? error.message : String(error)
	emitToUser(`${event}:error`, { error: message })
	throw error instanceof Error ? error : new Error(message)
}

async function broadcastList(emitToUser: (event: string, data: any) => void) {
	const res: Sockets.Workflows.List.Response = { workflows: await listWorkflows(db) }
	emitToUser("workflows:list", res)
}

async function comfyConnection(id: number | undefined | null) {
	if (id == null) return null
	const row = await db.query.connections.findFirst({ where: (c, { eq }) => eq(c.id, id) })
	return row && row.type === CONNECTION_TYPE.COMFYUI ? row : null
}

export const workflowsList: Handler<Sockets.Workflows.List.Params, Sockets.Workflows.List.Response> = {
	event: "workflows:list",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const res = { workflows: await listWorkflows(db, params?.dialect) }
		emitToUser("workflows:list", res)
		return res
	}
}

export const workflowsGet: Handler<Sockets.Workflows.Get.Params, Sockets.Workflows.Get.Response> = {
	event: "workflows:get",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const res = { workflow: ((await getWorkflow(db, params.id)) ?? null) as any }
		emitToUser("workflows:get", res)
		return res
	}
}

export const workflowsCreate: Handler<Sockets.Workflows.Create.Params, Sockets.Workflows.Create.Response> = {
	event: "workflows:create",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		try {
			const res = { workflow: (await createWorkflow(db, params.workflow)) as any }
			emitToUser("workflows:create", res)
			await broadcastList(emitToUser)
			return res
		} catch (e) {
			refuse(emitToUser, "workflows:create", e)
		}
	}
}

export const workflowsUpdate: Handler<Sockets.Workflows.Update.Params, Sockets.Workflows.Update.Response> = {
	event: "workflows:update",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		try {
			const res = { workflow: (await updateWorkflow(db, params.id, params.workflow)) as any }
			emitToUser("workflows:update", res)
			await broadcastList(emitToUser)
			return res
		} catch (e) {
			refuse(emitToUser, "workflows:update", e)
		}
	}
}

export const workflowsDelete: Handler<Sockets.Workflows.Delete.Params, Sockets.Workflows.Delete.Response> = {
	event: "workflows:delete",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		try {
			await deleteWorkflow(db, params.id)
			const res = { ok: true as const, id: params.id }
			emitToUser("workflows:delete", res)
			await broadcastList(emitToUser)
			return res
		} catch (e) {
			refuse(emitToUser, "workflows:delete", e)
		}
	}
}

export const workflowsDuplicate: Handler<
	Sockets.Workflows.Duplicate.Params,
	Sockets.Workflows.Duplicate.Response
> = {
	event: "workflows:duplicate",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		try {
			const res = { workflow: (await duplicateWorkflow(db, params.id)) as any }
			emitToUser("workflows:duplicate", res)
			await broadcastList(emitToUser)
			return res
		} catch (e) {
			refuse(emitToUser, "workflows:duplicate", e)
		}
	}
}

export const workflowsExport: Handler<Sockets.Workflows.Export.Params, Sockets.Workflows.Export.Response> = {
	event: "workflows:export",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		try {
			const res = await exportWorkflow(db, params.id, { withDefaults: !!params.withDefaults })
			emitToUser("workflows:export", res)
			return res
		} catch (e) {
			refuse(emitToUser, "workflows:export", e)
		}
	}
}

export const workflowsImport: Handler<Sockets.Workflows.Import.Params, Sockets.Workflows.Import.Response> = {
	event: "workflows:import",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		try {
			const conn = await comfyConnection(params.connectionId)
			const { row, proposal } = await importWorkflow(db, params.content, {
				name: params.name,
				objectInfo: conn ? comfyFactsOf(conn).objectInfo : null
			})
			const res = { workflow: row as any, ...(proposal ? { proposal } : {}) }
			emitToUser("workflows:import", res)
			await broadcastList(emitToUser)
			return res
		} catch (e) {
			refuse(emitToUser, "workflows:import", e)
		}
	}
}

/** Run the fitting walk on a pasted export and return the proposal — nothing is saved. */
export const workflowsFit: Handler<Sockets.Workflows.Fit.Params, Sockets.Workflows.Fit.Response> = {
	event: "workflows:fit",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		try {
			let parsed: unknown
			try {
				parsed = JSON.parse(params.content)
			} catch {
				throw new WorkflowError("That is not JSON.")
			}
			const conn = await comfyConnection(params.connectionId)
			const info = conn ? comfyFactsOf(conn).objectInfo : null
			const proposal = fitComfyWorkflow(parsed, info)
			const enums: Record<string, string[]> = {}
			for (const h of proposal.holes) {
				const id = h.enumSource?.replace(/^objectInfo:/, "")
				if (id && info?.enums[id]) enums[id] = info.enums[id]
			}
			const graph = asComfyGraph(parsed)
			// The form's edited proposal, when it sent one — its holes still
			// have to address inputs the graph has (`applyFit` skips the rest).
			const edited = (params.proposal as FitProposal | undefined) ?? proposal
			const res: Sockets.Workflows.Fit.Response = {
				proposal,
				...(Object.keys(enums).length ? { enums } : {}),
				...(graph.ok ? { applied: applyFit(graph.graph, edited, params.chosen) } : {})
			}
			emitToUser("workflows:fit", res)
			return res
		} catch (e) {
			refuse(emitToUser, "workflows:fit", e)
		}
	}
}

/**
 * Check a workflow against one ComfyUI (§4.9). A saved one's answer is
 * recorded on the connection, so its row goes `unfinished` on a miss; a
 * draft is checked and not recorded. Reads `/object_info` live.
 */
export const workflowsValidate: Handler<
	Sockets.Workflows.Validate.Params,
	Sockets.Workflows.Validate.Response
> = {
	event: "workflows:validate",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		try {
			const conn = await comfyConnection(params.connectionId)
			if (!conn) throw new WorkflowError("That is not a ComfyUI connection.")
			let result
			if (params.workflowId != null) {
				const row = await getWorkflow(db, params.workflowId)
				if (!row) throw new WorkflowError("That workflow no longer exists.")
				result = await checkWorkflowOnConnection(db, conn, asDocument(row), { refresh: true })
			} else {
				const info = await comfyObjectInfo(db, conn, { refresh: true })
				result = await checkWorkflow(
					{ document: params.document ?? "", variables: params.variables ?? [] },
					info
				)
			}
			const res: Sockets.Workflows.Validate.Response = {
				ok: !result.problem,
				problem: result.problem,
				missingNodes: result.check.missingNodes,
				missingNames: result.check.missingNames
			}
			emitToUser("workflows:validate", res)
			// The row's state may have moved.
			if (params.workflowId != null) {
				const { buildConnectionsList } = await import("./connections")
				await emitToUser("connections:list", () => buildConnectionsList())
			}
			return res
		} catch (e) {
			refuse(emitToUser, "workflows:validate", e)
		}
	}
}

/**
 * 🚧 The Workflows tab's chips: every workflow checked against this
 * server's CACHED `/object_info` — pure, recorded nowhere, so a starter
 * nobody uses never turns the row unfinished. *Validate against this server*
 * (`workflows:validate`) is the live, recorded check.
 */
export const workflowsOnServer: Handler<
	Sockets.Workflows.OnServer.Params,
	Sockets.Workflows.OnServer.Response
> = {
	event: "workflows:onServer",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		try {
			const conn = await comfyConnection(params.connectionId)
			if (!conn) throw new WorkflowError("That is not a ComfyUI connection.")
			const facts = comfyFactsOf(conn)
			const results: Sockets.Workflows.OnServer.Response["results"] = []
			if (facts.objectInfo) {
				const rows = await db.query.workflows.findMany({
					where: (w, { eq }) => eq(w.dialect, "comfyui")
				})
				for (const row of rows) {
					const r = await checkWorkflow(asDocument(row), facts.objectInfo).catch(
						(e) => ({
							problem: e instanceof Error ? e.message : String(e),
							check: { missingNodes: [], missingNames: [] }
						})
					)
					results.push({
						workflowId: row.id,
						problem: r.problem,
						missingNodes: r.check.missingNodes,
						missingNames: [...new Set(r.check.missingNames.map((m) => m.value))]
					})
				}
			}
			const res: Sockets.Workflows.OnServer.Response = {
				connectionId: conn.id,
				checked: !!facts.objectInfo,
				checkedAt: facts.checkedAt ?? null,
				results
			}
			emitToUser("workflows:onServer", res)
			return res
		} catch (e) {
			refuse(emitToUser, "workflows:onServer", e)
		}
	}
}

export function registerWorkflowHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, workflowsList, emitToUser)
	register(socket, workflowsGet, emitToUser)
	register(socket, workflowsCreate, emitToUser)
	register(socket, workflowsUpdate, emitToUser)
	register(socket, workflowsDelete, emitToUser)
	register(socket, workflowsDuplicate, emitToUser)
	register(socket, workflowsExport, emitToUser)
	register(socket, workflowsImport, emitToUser)
	register(socket, workflowsFit, emitToUser)
	register(socket, workflowsValidate, emitToUser)
	register(socket, workflowsOnServer, emitToUser)
}
