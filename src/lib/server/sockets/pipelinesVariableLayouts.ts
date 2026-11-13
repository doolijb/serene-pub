/**
 * The variable layouts' admin events, in the `pipelines:` family (PLAN
 * variable-layouts 2026-11-10, W1 W2 W3 W5).
 *
 * Thin on purpose: every read is `pipelines/config/variableLayoutsView.ts`, and
 * the one write — the pub's layout — goes through `entities/variableTemplates.ts`,
 * which owns the rows. Request and response, admin only, never scoped. A refusal
 * answers `<event>:error` with `{ error }` in words, as the library's do.
 *
 * Writing a layout (create, update, delete) stays on the library's own events in
 * `pipelines.ts`; the live preview of an unsaved layout is that file's
 * `pipelines:previewTemplate` with `kind: "variable"`, which already renders
 * against the variable's declared sample on the server.
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"

const NOT_ADMIN = "Access denied. Only admin users can manage pipelines."

/** A refusal in words: ours are said as written, anything else is logged, not shown. */
async function refusal(err: unknown): Promise<string> {
	const view = await import(
		"$lib/server/pipelines/config/variableLayoutsView"
	)
	const vars = await import(
		"$lib/server/pipelines/entities/variableTemplates"
	)
	if (
		err instanceof BadParams ||
		err instanceof view.UnknownVariableError ||
		err instanceof view.UnknownTemplateTargetError ||
		err instanceof vars.VariableTemplateNotFoundError ||
		err instanceof vars.VariableTemplateNotUsableError
	)
		return (err as Error).message
	console.error("[pipelines] variable layouts failed:", err)
	return "That could not be read or changed. The server log has the details."
}

/** Admin, then the work; both ends answer on the event or on `<event>:error`. */
async function answer<R>(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	event: string,
	work: () => Promise<R>,
	echo: Record<string, unknown> = {}
): Promise<R | { error: string }> {
	if (!socket.user?.isAdmin) {
		const res = { ...echo, error: NOT_ADMIN }
		emitToUser(`${event}:error`, res)
		return res
	}
	try {
		const res = { ...echo, ...(await work()) }
		emitToUser(event, res)
		return res
	} catch (err) {
		const res = { ...echo, error: await refusal(err) }
		emitToUser(`${event}:error`, res)
		return res
	}
}

/** The instance secret that keys step handles; read once, lazily (as `pipelines.ts` does). */
let cachedSecret: string | null = null
async function pubSecret(): Promise<string> {
	if (cachedSecret) return cachedSecret
	const { getCryptoSecretKey } = await import("$lib/server/db")
	cachedSecret = getCryptoSecretKey()
	return cachedSecret
}

const isVariableId = (v: unknown): v is string =>
	typeof v === "string" && v.length > 0

class BadParams extends Error {}

/** W1: every registered variable with the layout in use. */
export const pipelinesLibraryVariables: Handler<
	Sockets.Pipelines.VariableLayouts.List.Params,
	Sockets.Pipelines.VariableLayouts.List.Response
> = {
	event: "pipelines:libraryVariables",
	handler: (socket, _params, emitToUser) =>
		answer(socket, emitToUser, "pipelines:libraryVariables", async () => {
			const { variableLayoutsList } = await import(
				"$lib/server/pipelines/config/variableLayoutsView"
			)
			return { variables: await variableLayoutsList(db) }
		})
}

/** W2: one variable, its layouts previewed against its sample. */
export const pipelinesLibraryVariable: Handler<
	Sockets.Pipelines.VariableLayouts.One.Params,
	Sockets.Pipelines.VariableLayouts.One.Response
> = {
	event: "pipelines:libraryVariable",
	handler: (socket, params, emitToUser) =>
		answer(socket, emitToUser, "pipelines:libraryVariable", async () => {
			if (!isVariableId(params?.variableId))
				throw new BadParams("Say which variable to show.")
			const { variableLayoutView } = await import(
				"$lib/server/pipelines/config/variableLayoutsView"
			)
			return {
				variable: await variableLayoutView(
					db,
					params.variableId,
					await pubSecret()
				)
			}
		})
}

/** W2: choose the pub's layout for a variable, or go back to the package default. */
export const pipelinesLibrarySetPubLayout: Handler<
	Sockets.Pipelines.VariableLayouts.SetPub.Params,
	Sockets.Pipelines.VariableLayouts.SetPub.Response
> = {
	event: "pipelines:librarySetPubLayout",
	handler: (socket, params, emitToUser) =>
		answer(
			socket,
			emitToUser,
			"pipelines:librarySetPubLayout",
			async () => {
				if (!isVariableId(params?.variableId))
					throw new BadParams("Say which variable to change.")
				const templateId = params.templateId
				if (templateId !== null && !Number.isInteger(templateId))
					throw new BadParams(
						"Say which variable layout to use, or none to go back to the default."
					)
				const view = await import(
					"$lib/server/pipelines/config/variableLayoutsView"
				)
				const { setPubLayout } = await import(
					"$lib/server/pipelines/entities/variableTemplates"
				)
				// Refuses an unknown variable before any row is touched.
				await view.variableLayoutView(
					db,
					params.variableId,
					await pubSecret()
				)
				await setPubLayout(db, params.variableId, templateId)
				const warnings = await view.presetsKeepingTheirOwn(
					db,
					params.variableId
				)
				return {
					variable: await view.variableLayoutView(
						db,
						params.variableId,
						await pubSecret()
					),
					...(warnings.length ? { warnings } : {})
				}
			}
		)
}

/** W3: how many pipelines and templates *Use it everywhere* would change. */
export const pipelinesLibraryUseEverywhereCounts: Handler<
	Sockets.Pipelines.VariableLayouts.UseEverywhereCounts.Params,
	Sockets.Pipelines.VariableLayouts.UseEverywhereCounts.Response
> = {
	event: "pipelines:libraryUseEverywhereCounts",
	handler: (socket, params, emitToUser) =>
		answer(
			socket,
			emitToUser,
			"pipelines:libraryUseEverywhereCounts",
			async () => {
				if (!isVariableId(params?.variableId))
					throw new BadParams("Say which variable to count for.")
				const { useEverywhereCounts } = await import(
					"$lib/server/pipelines/config/variableLayoutsView"
				)
				return await useEverywhereCounts(db, params.variableId)
			}
		)
}

/** W5: each laid-out key a context template can read, with its layout and offers. */
export const pipelinesTemplateVariableLayouts: Handler<
	Sockets.Pipelines.VariableLayouts.ForTemplate.Params,
	Sockets.Pipelines.VariableLayouts.ForTemplate.Response
> = {
	event: "pipelines:templateVariableLayouts",
	handler: (socket, params, emitToUser) => {
		const p = params as any
		// Echo what was sent, so a late answer is matched to its ask.
		const echo: Record<string, string> =
			typeof p?.nodeType === "string" && p.nodeType
				? { nodeType: p.nodeType }
				: {
						...(typeof p?.specSlug === "string"
							? { specSlug: p.specSlug }
							: {}),
						...(typeof p?.stepKey === "string"
							? { stepKey: p.stepKey }
							: {})
					}
		return answer(
			socket,
			emitToUser,
			"pipelines:templateVariableLayouts",
			async () => {
				const target =
					typeof p?.nodeType === "string" && p.nodeType
						? { nodeType: p.nodeType as string }
						: typeof p?.specSlug === "string" &&
							  p.specSlug &&
							  typeof p?.stepKey === "string" &&
							  p.stepKey
							? {
									specSlug: p.specSlug as string,
									stepKey: p.stepKey as string
								}
							: null
				if (!target)
					throw new BadParams(
						"Say which step type, or which pipeline and step, to read."
					)
				const { templateVariableLayouts } = await import(
					"$lib/server/pipelines/config/variableLayoutsView"
				)
				return await templateVariableLayouts(
					db,
					target,
					await pubSecret()
				)
			},
			echo
		)
	}
}

export function registerPipelinesVariableLayoutsHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, pipelinesLibraryVariables, emitToUser)
	register(socket, pipelinesLibraryVariable, emitToUser)
	register(socket, pipelinesLibrarySetPubLayout, emitToUser)
	register(socket, pipelinesLibraryUseEverywhereCounts, emitToUser)
	register(socket, pipelinesTemplateVariableLayouts, emitToUser)
}
