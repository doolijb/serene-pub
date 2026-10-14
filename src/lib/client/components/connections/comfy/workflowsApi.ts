/**
 * 🚧 One request, one answer, for the Workflows tab and its dialogs: each
 * `workflows:*` call wrapped in `awaitReply`, so a Save never claims success
 * before the row exists and a refusal comes back as the server's sentence.
 *
 * Every handler is admin-only; the tab is only ever drawn for an admin.
 */
import { awaitReply } from "$lib/client/utils/awaitReply"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"

type Sock = Pick<TypedSocket, "emit">

const any = () => true

export const workflowsApi = (socket: Sock) => ({
	list: () =>
		awaitReply({
			socket,
			event: "workflows:list",
			params: { dialect: "comfyui" },
			errorEvent: "workflows:fit:error",
			match: any
		}).then((r) => r.workflows),
	get: (id: number) =>
		awaitReply({
			socket,
			event: "workflows:get",
			params: { id },
			errorEvent: "workflows:fit:error",
			match: (r) => r.workflow?.id === id
		}).then((r) => r.workflow),
	fit: (params: Sockets.Workflows.Fit.Params) =>
		awaitReply({
			socket,
			event: "workflows:fit",
			params,
			errorEvent: "workflows:fit:error",
			match: any
		}),
	create: (workflow: Sockets.Workflows.Input) =>
		awaitReply({
			socket,
			event: "workflows:create",
			params: { workflow },
			errorEvent: "workflows:create:error",
			match: any
		}).then((r) => r.workflow),
	update: (id: number, workflow: Partial<Sockets.Workflows.Input>) =>
		awaitReply({
			socket,
			event: "workflows:update",
			params: { id, workflow },
			errorEvent: "workflows:update:error",
			match: (r) => r.workflow?.id === id
		}).then((r) => r.workflow),
	duplicate: (id: number) =>
		awaitReply({
			socket,
			event: "workflows:duplicate",
			params: { id },
			errorEvent: "workflows:duplicate:error",
			match: any
		}).then((r) => r.workflow),
	remove: (id: number) =>
		awaitReply({
			socket,
			event: "workflows:delete",
			params: { id },
			errorEvent: "workflows:delete:error",
			match: (r) => r.id === id
		}),
	exportFile: (id: number, withDefaults: boolean) =>
		awaitReply({
			socket,
			event: "workflows:export",
			params: { id, withDefaults },
			errorEvent: "workflows:export:error",
			match: any
		}),
	validate: (params: Sockets.Workflows.Validate.Params) =>
		awaitReply({
			socket,
			event: "workflows:validate",
			params,
			errorEvent: "workflows:validate:error",
			match: any,
			// A live `/object_info` read on a slow server.
			timeoutMs: 60000
		}),
	/** The workflow's drawing sheet (`deriveComfySheet`), on this connection. */
	sheet: (workflowId: number, connectionId: number | null) =>
		awaitReply({
			socket,
			event: "images:drawingSheet",
			params: { workflowId, connectionId },
			errorEvent: "images:drawingSheet:error",
			match: (r) => r.workflowId === workflowId
		}).then((r) => r.sheet ?? null),
	onServer: (connectionId: number) =>
		awaitReply({
			socket,
			event: "workflows:onServer",
			params: { connectionId },
			errorEvent: "workflows:onServer:error",
			match: (r) => r.connectionId === connectionId
		})
})

/** Hand the browser a file to save. */
export function saveTextFile(filename: string, content: string) {
	const blob = new Blob([content], { type: "application/json" })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = filename
	document.body.appendChild(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(url), 0)
}
