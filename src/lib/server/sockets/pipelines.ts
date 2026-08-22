/**
 * The socket surface for the pipeline view and the management page.
 *
 * Thin on purpose. Everything that decides anything — which layer a value came
 * from, whether a scope may write a slot, what an opaque option id stands for —
 * lives in `pipelines/config.ts` and, under that, in the SDK. A handler that
 * re-derived any of it would be a second copy of a rule that has to stay true in
 * two places at once, and the write matrix is exactly the rule you do not want
 * two copies of.
 *
 * ## Every write answers with the whole view
 *
 * Rather than acknowledging the field that changed. A single write can move more
 * than one thing on screen: setting a value at chat scope changes that option's
 * provenance badge *and* may unshadow another, and clearing one reveals whatever
 * it was covering. Returning the resolved view is one round trip and removes a
 * whole category of "the panel says something different from the database".
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, desc, eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import {
	clearOption,
	listNamespaces,
	namespaceView,
	selectNamedConfig,
	writeOption,
	OptionNotFoundError,
	OptionNotWritableError,
	type Viewer
} from "$lib/server/pipelines/config"

/**
 * The instance secret that keys option handles.
 *
 * Read lazily and cached: it is a file read, it never changes while the process
 * is up, and importing `$lib/server/db` at module scope for it would be fine here
 * — this file already does — but the laziness keeps a socket module from touching
 * the filesystem merely by being imported.
 */
let cachedSecret: string | null = null
async function instanceSecret(): Promise<string> {
	if (cachedSecret) return cachedSecret
	const { getCryptoSecretKey } = await import("$lib/server/db")
	cachedSecret = getCryptoSecretKey()
	return cachedSecret
}

/**
 * Who is asking, and from where.
 *
 * `chatId` is only honoured for a chat the asker owns. 05 §0a says configuring
 * from inside a chat you own writes at chat scope; the ownership half of that is
 * not decoration, because the parameter arrives from the client and a chat id is
 * a small integer somebody can guess.
 */
async function viewerFor(socket: any, chatId?: number): Promise<Viewer> {
	const userId = socket.user!.id
	if (chatId == null) return { userId, isAdmin: !!socket.user!.isAdmin }
	const [chat] = await db
		.select({ userId: schema.chats.userId })
		.from(schema.chats)
		.where(eq(schema.chats.id, chatId))
		.limit(1)
	return {
		userId,
		isAdmin: !!socket.user!.isAdmin,
		chatId: chat?.userId === userId ? chatId : undefined
	}
}

/** Re-read and emit; the single place a mutation's answer is produced. */
async function emitView(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	event: string,
	slug: string,
	chatId?: number
) {
	const viewer = await viewerFor(socket, chatId)
	const pipeline = await namespaceView(
		db as any,
		await instanceSecret(),
		slug,
		viewer
	)
	const res = pipeline
		? { pipeline: pipeline as any }
		: { error: `There is no published pipeline called '${slug}'.` }
	emitToUser(event, res)
	return res
}

/**
 * Turn a refusal into something the panel can show.
 *
 * The two error classes carry sentences meant for a person (15 §1.3) — "only an
 * administrator sets a value for everyone", "connections stay with the
 * administrator" — so they are passed through rather than replaced with a status.
 * Anything else is a bug and is not shown verbatim.
 */
function refusal(err: unknown): string {
	if (err instanceof OptionNotWritableError) return err.message
	if (err instanceof OptionNotFoundError) return err.message
	console.error("[pipelines] socket handler failed:", err)
	return "That change could not be saved. The server log has the details."
}

export const pipelinesList: Handler<
	Sockets.Pipelines.List.Params,
	Sockets.Pipelines.List.Response
> = {
	event: "pipelines:list",
	handler: async (socket, _params, emitToUser) => {
		const [settings] = await db
			.select()
			.from(schema.systemSettings)
			.limit(1)
		const res: Sockets.Pipelines.List.Response = {
			pipelinesList: (await listNamespaces(db as any)) as any,
			// Whether the old Prompt Configs sidebar is offered at all — the one
			// toggle that survives the changeover. Configuration moves here, but
			// a year of somebody's tuning has to stay *readable* until the
			// legacy tables go in 0.8.0. Defaults on when the row is missing,
			// because hiding their work is by far the worse mistake.
			legacyPromptConfigsVisible:
				settings?.legacyPromptConfigsVisible ?? true
		}
		emitToUser("pipelines:list", res)
		return res
	}
}

export const pipelinesGet: Handler<
	Sockets.Pipelines.Get.Params,
	Sockets.Pipelines.Get.Response
> = {
	event: "pipelines:get",
	handler: async (socket, params, emitToUser) =>
		(await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)) as Sockets.Pipelines.Get.Response
}

export const pipelinesSetOption: Handler<
	Sockets.Pipelines.SetOption.Params,
	Sockets.Pipelines.SetOption.Response
> = {
	event: "pipelines:setOption",
	handler: async (socket, params, emitToUser) => {
		try {
			await writeOption(
				db as any,
				await instanceSecret(),
				params.slug,
				await viewerFor(socket, params.chatId),
				params.optionId,
				params.value,
				params.scope
			)
		} catch (err) {
			const res = { error: refusal(err) }
			emitToUser("pipelines:setOption:error", res)
			return res
		}
		return (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)) as Sockets.Pipelines.SetOption.Response
	}
}

export const pipelinesClearOption: Handler<
	Sockets.Pipelines.ClearOption.Params,
	Sockets.Pipelines.ClearOption.Response
> = {
	event: "pipelines:clearOption",
	handler: async (socket, params, emitToUser) => {
		try {
			await clearOption(
				db as any,
				await instanceSecret(),
				params.slug,
				await viewerFor(socket, params.chatId),
				params.optionId,
				params.scope
			)
		} catch (err) {
			const res = { error: refusal(err) }
			emitToUser("pipelines:clearOption:error", res)
			return res
		}
		return (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)) as Sockets.Pipelines.ClearOption.Response
	}
}

export const pipelinesSelectConfig: Handler<
	Sockets.Pipelines.SelectConfig.Params,
	Sockets.Pipelines.SelectConfig.Response
> = {
	event: "pipelines:selectConfig",
	handler: async (socket, params, emitToUser) => {
		try {
			await selectNamedConfig(
				db as any,
				params.slug,
				await viewerFor(socket, params.chatId),
				params.configId,
				params.scope
			)
		} catch (err) {
			const res = { error: refusal(err) }
			emitToUser("pipelines:selectConfig:error", res)
			return res
		}
		return (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)) as Sockets.Pipelines.SelectConfig.Response
	}
}

/* ------------------------------------------------------------------ *
 * Prompt CRUD — clone, edit, delete, from the panel
 * ------------------------------------------------------------------ */

/**
 * The scoping gate every prompt mutation passes first: the prompt must belong
 * to the pipeline the panel is showing. The id arrives from the client and is
 * a small integer somebody can guess; without this line, guessing one would
 * edit another pipeline's wording through this one's panel.
 */
async function promptInSpec(slug: string, promptId: number) {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
		.limit(1)
	if (!spec) throw new Error(`There is no pipeline called '${slug}'.`)
	const [prompt] = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.id, promptId))
		.limit(1)
	if (!prompt || prompt.specId !== spec.id)
		throw new Error("That prompt does not belong to this pipeline.")
	return { spec, prompt }
}

/** "Roleplay (copy)", then "(copy 2)" — names are unique per pipeline. */
async function copyName(specId: number, base: string): Promise<string> {
	const rows = await db
		.select({ name: schema.pipelinePrompts.name })
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.specId, specId))
	const taken = new Set((rows as any[]).map((r) => r.name))
	let candidate = `${base} (copy)`
	for (let n = 2; taken.has(candidate); n++) candidate = `${base} (copy ${n})`
	return candidate
}

const promptRefusal = async (err: unknown): Promise<string> => {
	const { PromptNotFoundError, PromptNotUsableError } = await import(
		"$lib/server/pipelines/prompts"
	)
	if (
		err instanceof PromptNotFoundError ||
		err instanceof PromptNotUsableError
	)
		return err.message
	if (err instanceof Error && /pipeline/.test(err.message)) return err.message
	console.error("[pipelines] prompt mutation failed:", err)
	return "That change could not be saved. The server log has the details."
}

export const pipelinesClonePrompt: Handler<
	Sockets.Pipelines.ClonePrompt.Params,
	Sockets.Pipelines.ClonePrompt.Response
> = {
	event: "pipelines:clonePrompt",
	handler: async (socket, params, emitToUser) => {
		let promptId: number
		try {
			const { spec, prompt } = await promptInSpec(
				params.slug,
				params.promptId
			)
			const { duplicatePrompt } = await import(
				"$lib/server/pipelines/prompts"
			)
			const copy = await duplicatePrompt(
				db as any,
				prompt.id,
				params.name?.trim() || (await copyName(spec.id, prompt.name))
			)
			promptId = copy.id
		} catch (err) {
			const res = { error: await promptRefusal(err) }
			emitToUser("pipelines:clonePrompt:error", res)
			return res
		}
		const view = await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)
		// The new id rides along so the panel can select the copy in the same
		// gesture — clone-and-edit, not clone-then-hunt-the-dropdown.
		const res = {
			promptId,
			...view
		} as Sockets.Pipelines.ClonePrompt.Response
		emitToUser("pipelines:clonePrompt", res)
		return res
	}
}

export const pipelinesUpdatePrompt: Handler<
	Sockets.Pipelines.UpdatePrompt.Params,
	Sockets.Pipelines.UpdatePrompt.Response
> = {
	event: "pipelines:updatePrompt",
	handler: async (socket, params, emitToUser) => {
		try {
			const { prompt } = await promptInSpec(params.slug, params.promptId)
			const { updatePrompt } = await import(
				"$lib/server/pipelines/prompts"
			)
			await updatePrompt(db as any, prompt.id, {
				...(params.name !== undefined ? { name: params.name } : {}),
				...(params.fields !== undefined
					? { fields: params.fields }
					: {})
			})
		} catch (err) {
			const res = { error: await promptRefusal(err) }
			emitToUser("pipelines:updatePrompt:error", res)
			return res
		}
		return (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)) as Sockets.Pipelines.UpdatePrompt.Response
	}
}

export const pipelinesDeletePrompt: Handler<
	Sockets.Pipelines.DeletePrompt.Params,
	Sockets.Pipelines.DeletePrompt.Response
> = {
	event: "pipelines:deletePrompt",
	handler: async (socket, params, emitToUser) => {
		try {
			const { spec, prompt } = await promptInSpec(
				params.slug,
				params.promptId
			)
			// The caller's *own selection* of this prompt does not hold it
			// alive — without this, Delete is unreachable from the panel: the
			// button sits next to the selected prompt, and selecting is itself
			// a reference. Deleting what you have selected resets your
			// selection to what it inherits, exactly as Reset would; every
			// *other* reference (a named config, another scope, another
			// person) still refuses below.
			//
			// Told to the delete rather than released before it. Releasing
			// first meant a **refused** delete cleared the selection anyway on
			// its way to failing: the prompt survived, the choice did not, and
			// the message said nothing about it. The rows only go once the
			// delete has actually succeeded.
			const viewer = await viewerFor(socket, params.chatId)
			// `value` is a json column, which Postgres cannot compare with `=`
			// — so the rows are read and matched in code, the same way the
			// reference check in `deletePrompt` does.
			const own = await db
				.select()
				.from(schema.pipelineNodeOverrides)
				.where(
					and(
						eq(schema.pipelineNodeOverrides.specId, spec.id),
						eq(
							schema.pipelineNodeOverrides.scopeKind,
							viewer.chatId != null ? "chat" : "user"
						),
						eq(
							schema.pipelineNodeOverrides.scopeId,
							viewer.chatId ?? viewer.userId
						),
						eq(schema.pipelineNodeOverrides.slot, "prompts")
					)
				)
			const mine = (own as any[]).filter((o) => o.value === prompt.id)
			const { deletePrompt } = await import(
				"$lib/server/pipelines/prompts"
			)
			await deletePrompt(db as any, prompt.id, {
				ignoreOverrideIds: new Set(mine.map((o) => o.id))
			})
			for (const row of mine)
				await db
					.delete(schema.pipelineNodeOverrides)
					.where(eq(schema.pipelineNodeOverrides.id, row.id))
		} catch (err) {
			const res = { error: await promptRefusal(err) }
			emitToUser("pipelines:deletePrompt:error", res)
			return res
		}
		return (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)) as Sockets.Pipelines.DeletePrompt.Response
	}
}

/* ------------------------------------------------------------------ *
 * Variable layout CRUD — clone, edit, delete, from the panel
 * ------------------------------------------------------------------ */

/**
 * The gate, and it is a different shape from `promptInSpec` on purpose.
 *
 * A prompt is namespaced to a pipeline, so its mutations are gated on
 * ownership. A layout is shared across pipelines *by design* — that is the
 * feature — so the same question has no true answer for one, and copying the
 * check here would quietly remove cross-pipeline reuse while looking like
 * consistency.
 *
 * What is checked instead: the option handle resolves to a layout setting this
 * pipeline actually declares, the viewer may write it, and the row being
 * mutated renders the same variable that setting does. So the rule is "you may
 * edit a layout through a setting that uses it", which is the honest version of
 * the ownership question.
 */
async function layoutForOption(
	socket: any,
	params: {
		slug: string
		optionId: string
		templateId: number
		chatId?: number
	}
) {
	const { variableOptionGate } = await import("$lib/server/pipelines/config")
	const { assertSelectable } = await import(
		"$lib/server/pipelines/variableTemplates"
	)
	const viewer = await viewerFor(socket, params.chatId)
	const { variableId } = await variableOptionGate(
		db as any,
		await instanceSecret(),
		params.slug,
		viewer,
		params.optionId
	)
	const row = await assertSelectable(db as any, variableId, params.templateId)
	return { viewer, variableId, row }
}

/** "JSON (copy)", then "(copy 2)" — names are unique per variable. */
async function layoutCopyName(
	variableId: string,
	base: string
): Promise<string> {
	const rows = await db
		.select({ name: schema.pipelineVariableTemplates.name })
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.variableId, variableId))
	const taken = new Set((rows as any[]).map((r) => r.name))
	let candidate = `${base} (copy)`
	for (let n = 2; taken.has(candidate); n++) candidate = `${base} (copy ${n})`
	return candidate
}

const layoutRefusal = async (err: unknown): Promise<string> => {
	const { VariableTemplateNotFoundError, VariableTemplateNotUsableError } =
		await import("$lib/server/pipelines/variableTemplates")
	const { OptionNotFoundError, OptionNotWritableError } = await import(
		"$lib/server/pipelines/config"
	)
	if (
		err instanceof VariableTemplateNotFoundError ||
		err instanceof VariableTemplateNotUsableError ||
		err instanceof OptionNotFoundError ||
		err instanceof OptionNotWritableError
	)
		return err.message
	console.error("[pipelines] layout mutation failed:", err)
	return "That change could not be saved. The server log has the details."
}

export const pipelinesCloneVariableTemplate: Handler<
	Sockets.Pipelines.CloneVariableTemplate.Params,
	Sockets.Pipelines.CloneVariableTemplate.Response
> = {
	event: "pipelines:cloneVariableTemplate",
	handler: async (socket, params, emitToUser) => {
		let templateId: number
		try {
			const { variableId, row } = await layoutForOption(socket, params)
			const { duplicateVariableTemplate } = await import(
				"$lib/server/pipelines/variableTemplates"
			)
			const copy = await duplicateVariableTemplate(
				db as any,
				row.id,
				params.name?.trim() ||
					(await layoutCopyName(variableId, row.name))
			)
			templateId = copy.id
		} catch (err) {
			const res = { error: await layoutRefusal(err) }
			emitToUser("pipelines:cloneVariableTemplate:error", res)
			return res
		}
		const view = await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)
		// Rides along so the panel can select the copy in the same gesture —
		// clone-and-edit, not clone-then-hunt-the-dropdown.
		const res = {
			templateId,
			...view
		} as Sockets.Pipelines.CloneVariableTemplate.Response
		emitToUser("pipelines:cloneVariableTemplate", res)
		return res
	}
}

export const pipelinesUpdateVariableTemplate: Handler<
	Sockets.Pipelines.UpdateVariableTemplate.Params,
	Sockets.Pipelines.UpdateVariableTemplate.Response
> = {
	event: "pipelines:updateVariableTemplate",
	handler: async (socket, params, emitToUser) => {
		try {
			const { row } = await layoutForOption(socket, params)
			const { updateVariableTemplate } = await import(
				"$lib/server/pipelines/variableTemplates"
			)
			await updateVariableTemplate(db as any, row.id, {
				...(params.name !== undefined ? { name: params.name } : {}),
				...(params.source !== undefined
					? { source: params.source }
					: {})
			})
		} catch (err) {
			const res = { error: await layoutRefusal(err) }
			emitToUser("pipelines:updateVariableTemplate:error", res)
			return res
		}
		return (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)) as Sockets.Pipelines.UpdateVariableTemplate.Response
	}
}

export const pipelinesDeleteVariableTemplate: Handler<
	Sockets.Pipelines.DeleteVariableTemplate.Params,
	Sockets.Pipelines.DeleteVariableTemplate.Response
> = {
	event: "pipelines:deleteVariableTemplate",
	handler: async (socket, params, emitToUser) => {
		try {
			const { row } = await layoutForOption(socket, params)
			// The caller's own selection does not hold a layout alive: Delete
			// sits beside the *selected* row, and selecting is itself a
			// reference, so without this the button is unreachable.
			//
			// Told to the delete rather than released before it, which is the
			// correction live use forced. Releasing first meant a *refused*
			// delete cleared the selection anyway — and for layouts refusal is
			// the common case, because another pipeline holding the row is
			// exactly the thing that refuses. The row survived, the choice did
			// not, and nothing said so. Now the rows only go once the delete
			// has actually succeeded.
			const [at] = await db
				.select()
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, params.slug))
				.limit(1)
			const own = at
				? (
						await db
							.select()
							.from(schema.pipelineNodeOverrides)
							.where(
								and(
									eq(
										schema.pipelineNodeOverrides.specId,
										at.id
									),
									eq(
										schema.pipelineNodeOverrides.scopeKind,
										"instance"
									)
								)
							)
					).filter((o: any) => o.value === row.id)
				: []

			const { deleteVariableTemplate } = await import(
				"$lib/server/pipelines/variableTemplates"
			)
			await deleteVariableTemplate(db as any, row.id, {
				ignoreOverrideIds: new Set((own as any[]).map((o) => o.id))
			})
			for (const o of own as any[])
				await db
					.delete(schema.pipelineNodeOverrides)
					.where(eq(schema.pipelineNodeOverrides.id, o.id))
		} catch (err) {
			const res = { error: await layoutRefusal(err) }
			emitToUser("pipelines:deleteVariableTemplate:error", res)
			return res
		}
		return (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)) as Sockets.Pipelines.DeleteVariableTemplate.Response
	}
}

/**
 * The same gate as `layoutForOption`, for the story string.
 *
 * A context template is shared across pipelines by design, so ownership has no
 * true answer here either. What is checked is that the option handle resolves
 * to a template setting this pipeline declares, the viewer may write it, and
 * the row being mutated renders for the same kind of step that setting does.
 */
async function contextTemplateForOption(
	socket: any,
	params: {
		slug: string
		optionId: string
		templateId: number
		chatId?: number
	}
) {
	const { contextTemplateOptionGate } = await import(
		"$lib/server/pipelines/config"
	)
	const { assertSelectable } = await import(
		"$lib/server/pipelines/contextTemplates"
	)
	const viewer = await viewerFor(socket, params.chatId)
	const { nodeTypeId, specId } = await contextTemplateOptionGate(
		db as any,
		await instanceSecret(),
		params.slug,
		viewer,
		params.optionId
	)
	const row = await assertSelectable(db as any, nodeTypeId, params.templateId)
	return { viewer, nodeTypeId, specId, row }
}

/** "Default (copy)", then "(copy 2)" — names are unique per node type. */
async function contextTemplateCopyName(
	nodeTypeId: string,
	base: string
): Promise<string> {
	const rows = await db
		.select({ name: schema.pipelineContextTemplates.name })
		.from(schema.pipelineContextTemplates)
		.where(eq(schema.pipelineContextTemplates.nodeTypeId, nodeTypeId))
	const taken = new Set((rows as any[]).map((r) => r.name))
	let candidate = `${base} (copy)`
	for (let n = 2; taken.has(candidate); n++) candidate = `${base} (copy ${n})`
	return candidate
}

const contextTemplateRefusal = async (err: unknown): Promise<string> => {
	const { ContextTemplateNotFoundError, ContextTemplateNotUsableError } =
		await import("$lib/server/pipelines/contextTemplates")
	const { OptionNotFoundError, OptionNotWritableError } = await import(
		"$lib/server/pipelines/config"
	)
	if (
		err instanceof ContextTemplateNotFoundError ||
		err instanceof ContextTemplateNotUsableError ||
		err instanceof OptionNotFoundError ||
		err instanceof OptionNotWritableError
	)
		return err.message
	console.error("[pipelines] context template mutation failed:", err)
	return "That change could not be saved. The server log has the details."
}

/**
 * Write a new template from nothing.
 *
 * Layouts have no equivalent because their pool is never empty — core ships a
 * row for every variable it declares. A template pool can be: core ships one
 * for the assemble step and none for any other node that declares a template
 * slot, so without this those pickers offer nothing and have no way to be
 * given anything.
 */
export const pipelinesCreateContextTemplate: Handler<
	Sockets.Pipelines.CreateContextTemplate.Params,
	Sockets.Pipelines.CreateContextTemplate.Response
> = {
	event: "pipelines:createContextTemplate",
	handler: async (socket, params, emitToUser) => {
		let templateId: number
		try {
			const { contextTemplateOptionGate } = await import(
				"$lib/server/pipelines/config"
			)
			const viewer = await viewerFor(socket, params.chatId)
			const { nodeTypeId, specId } = await contextTemplateOptionGate(
				db as any,
				await instanceSecret(),
				params.slug,
				viewer,
				params.optionId
			)
			const { createContextTemplate } = await import(
				"$lib/server/pipelines/contextTemplates"
			)
			const created = await createContextTemplate(db as any, {
				nodeTypeId,
				name: await contextTemplateCopyName(
					nodeTypeId,
					params.name?.trim() || "New template"
				),
				source: params.source ?? "",
				// Written here, so it sorts to the top of *this* pipeline's
				// picker next time. Grouping only — it stays selectable
				// everywhere the node type matches.
				createdForSpecId: specId
			})
			templateId = created.id
		} catch (err) {
			const res = { error: await contextTemplateRefusal(err) }
			emitToUser("pipelines:createContextTemplate:error", res)
			return res
		}
		const view = await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)
		const res = {
			templateId,
			...view
		} as Sockets.Pipelines.CreateContextTemplate.Response
		emitToUser("pipelines:createContextTemplate", res)
		return res
	}
}

export const pipelinesCloneContextTemplate: Handler<
	Sockets.Pipelines.CloneContextTemplate.Params,
	Sockets.Pipelines.CloneContextTemplate.Response
> = {
	event: "pipelines:cloneContextTemplate",
	handler: async (socket, params, emitToUser) => {
		let templateId: number
		try {
			const { nodeTypeId, specId, row } = await contextTemplateForOption(
				socket,
				params
			)
			const { duplicateContextTemplate } = await import(
				"$lib/server/pipelines/contextTemplates"
			)
			const copy = await duplicateContextTemplate(
				db as any,
				row.id,
				params.name?.trim() ||
					(await contextTemplateCopyName(nodeTypeId, row.name)),
				specId
			)
			templateId = copy.id
		} catch (err) {
			const res = { error: await contextTemplateRefusal(err) }
			emitToUser("pipelines:cloneContextTemplate:error", res)
			return res
		}
		const view = await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)
		// Rides along so the panel can select the copy in the same gesture —
		// clone-and-edit, not clone-then-hunt-the-dropdown.
		const res = {
			templateId,
			...view
		} as Sockets.Pipelines.CloneContextTemplate.Response
		emitToUser("pipelines:cloneContextTemplate", res)
		return res
	}
}

export const pipelinesUpdateContextTemplate: Handler<
	Sockets.Pipelines.UpdateContextTemplate.Params,
	Sockets.Pipelines.UpdateContextTemplate.Response
> = {
	event: "pipelines:updateContextTemplate",
	handler: async (socket, params, emitToUser) => {
		try {
			const { row } = await contextTemplateForOption(socket, params)
			const { updateContextTemplate } = await import(
				"$lib/server/pipelines/contextTemplates"
			)
			await updateContextTemplate(db as any, row.id, {
				...(params.name !== undefined ? { name: params.name } : {}),
				...(params.source !== undefined
					? { source: params.source }
					: {})
			})
		} catch (err) {
			const res = { error: await contextTemplateRefusal(err) }
			emitToUser("pipelines:updateContextTemplate:error", res)
			return res
		}
		return (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)) as Sockets.Pipelines.UpdateContextTemplate.Response
	}
}

export const pipelinesDeleteContextTemplate: Handler<
	Sockets.Pipelines.DeleteContextTemplate.Params,
	Sockets.Pipelines.DeleteContextTemplate.Response
> = {
	event: "pipelines:deleteContextTemplate",
	handler: async (socket, params, emitToUser) => {
		try {
			const { row } = await contextTemplateForOption(socket, params)
			// The caller's own selection does not hold a template alive —
			// same correction live use forced on layouts, and it matters more
			// here: templates are shared, so refusal is the common path and a
			// refused delete must not still clear the caller's choice.
			const [at] = await db
				.select()
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, params.slug))
				.limit(1)
			const own = at
				? (
						await db
							.select()
							.from(schema.pipelineNodeOverrides)
							.where(
								and(
									eq(
										schema.pipelineNodeOverrides.specId,
										at.id
									),
									eq(
										schema.pipelineNodeOverrides.scopeKind,
										"instance"
									)
								)
							)
					).filter((o: any) => o.value === row.id)
				: []

			const { deleteContextTemplate } = await import(
				"$lib/server/pipelines/contextTemplates"
			)
			await deleteContextTemplate(db as any, row.id, {
				ignoreOverrideIds: new Set((own as any[]).map((o) => o.id))
			})
			for (const o of own as any[])
				await db
					.delete(schema.pipelineNodeOverrides)
					.where(eq(schema.pipelineNodeOverrides.id, o.id))
		} catch (err) {
			const res = { error: await contextTemplateRefusal(err) }
			emitToUser("pipelines:deleteContextTemplate:error", res)
			return res
		}
		return (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.chatId
		)) as Sockets.Pipelines.DeleteContextTemplate.Response
	}
}

/**
 * The admin workspace's read.
 *
 * Admin-only for the same reason `pipelinesDetail` is: this is the structural
 * view, and it says how many nodes a version has. The pipeline *view* may not,
 * which is why the two live in different handlers rather than one with a flag.
 */
/**
 * Render a draft, without saving it.
 *
 * The editors need this because a template can be *syntactically fine and
 * render nothing*: a layout writing `{{#each character}}` over a scope keyed
 * `characters` produces an empty string with no error anywhere, and the first
 * sign of it is a reply with no cast in it. Lint findings travel with the
 * render for the same reason — a draft that renders can still be wrong.
 *
 * Admin-gated like the rest of the library, and a read: it renders against the
 * registry's declared samples and touches no row.
 */
export const pipelinesPreviewTemplate: Handler<
	Sockets.Pipelines.PreviewTemplate.Params,
	Sockets.Pipelines.PreviewTemplate.Response
> = {
	event: "pipelines:previewTemplate",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage pipelines."
			}
			emitToUser("pipelines:previewTemplate:error", res)
			return res
		}

		const { previewContextTemplate, previewVariableTemplate } =
			await import("$lib/server/pipelines/preview")
		const {
			lintContextTemplate,
			lintVariableTemplate,
			parseContextTemplate
		} = await import("$lib/shared/utils/contextConfigCards")
		const { getVariable } = await import("@serene-pub/sdk")

		let res: Sockets.Pipelines.PreviewTemplate.Response
		if (params.kind === "variable") {
			const decl = getVariable(params.poolId)
			res = previewVariableTemplate({
				source: params.source,
				engine: params.engine,
				variableId: params.poolId
			})
			if (decl)
				res.issues = lintVariableTemplate(
					params.source,
					decl.scope
				).map((i) => i.message)
		} else {
			res = previewContextTemplate({
				source: params.source,
				engine: params.engine
			})
			res.issues = lintContextTemplate(
				parseContextTemplate(params.source).cards
			).map((i) => i.message)
		}

		emitToUser("pipelines:previewTemplate", res)
		return res
	}
}

export const pipelinesLibrary: Handler<
	Sockets.Pipelines.Library.Params,
	Sockets.Pipelines.Library.Response
> = {
	event: "pipelines:library",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage pipelines."
			}
			emitToUser("pipelines:library:error", res)
			return res
		}
		const { libraryView } = await import("$lib/server/pipelines/library")
		const res = (await libraryView(
			db as any
		)) as Sockets.Pipelines.Library.Response
		emitToUser("pipelines:library", res)
		return res
	}
}

/* --- the workspace's writes ---------------------------------------- */

/** Admin, and a fresh view to answer with. Refuses in the caller's words. */
async function libraryGate(
	socket: any
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!socket.user!.isAdmin)
		return {
			ok: false,
			error: "Access denied. Only admin users can manage pipelines."
		}
	return { ok: true }
}

const libraryRefusal = async (err: unknown): Promise<string> => {
	const ctx = await import("$lib/server/pipelines/contextTemplates")
	const vars = await import("$lib/server/pipelines/variableTemplates")
	const prompts = await import("$lib/server/pipelines/prompts")
	if (
		err instanceof ctx.ContextTemplateNotFoundError ||
		err instanceof ctx.ContextTemplateNotUsableError ||
		err instanceof vars.VariableTemplateNotFoundError ||
		err instanceof vars.VariableTemplateNotUsableError ||
		err instanceof prompts.PromptNotFoundError ||
		err instanceof prompts.PromptNotUsableError
	)
		return (err as Error).message
	console.error("[pipelines] library mutation failed:", err)
	return "That change could not be saved. The server log has the details."
}

/** The whole view, which is what every write on this page answers with. */
async function libraryAnswer(
	emitToUser: any,
	event: string
): Promise<{ library: Sockets.Pipelines.Library.Response }> {
	const { libraryView } = await import("$lib/server/pipelines/library")
	const library = (await libraryView(
		db as any
	)) as Sockets.Pipelines.Library.Response
	const res = { library }
	emitToUser(event, res)
	return res
}

/** "Default (copy)", then "(copy 2)" — unique within the row's own pool. */
async function libraryCopyName(
	kind: "context" | "variable",
	poolId: string,
	base: string
): Promise<string> {
	const rows =
		kind === "context"
			? await db
					.select({ name: schema.pipelineContextTemplates.name })
					.from(schema.pipelineContextTemplates)
					.where(
						eq(schema.pipelineContextTemplates.nodeTypeId, poolId)
					)
			: await db
					.select({ name: schema.pipelineVariableTemplates.name })
					.from(schema.pipelineVariableTemplates)
					.where(
						eq(schema.pipelineVariableTemplates.variableId, poolId)
					)
	const taken = new Set((rows as any[]).map((r) => r.name))
	let candidate = base
	for (let n = 2; taken.has(candidate); n++) candidate = `${base} (${n})`
	return candidate
}

export const pipelinesLibraryCreateTemplate: Handler<
	Sockets.Pipelines.LibraryTemplateWrite.CreateParams,
	Sockets.Pipelines.LibraryTemplateWrite.Response
> = {
	event: "pipelines:libraryCreateTemplate",
	handler: async (socket, params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:libraryCreateTemplate:error", gate)
			return { error: gate.error }
		}
		try {
			const name = await libraryCopyName(
				params.kind,
				params.poolId,
				params.name?.trim() || "New"
			)
			if (params.kind === "context") {
				const { createContextTemplate } = await import(
					"$lib/server/pipelines/contextTemplates"
				)
				await createContextTemplate(db as any, {
					nodeTypeId: params.poolId,
					name,
					source: params.source ?? ""
				})
			} else {
				const { createVariableTemplate } = await import(
					"$lib/server/pipelines/variableTemplates"
				)
				await createVariableTemplate(db as any, {
					variableId: params.poolId,
					name,
					source: params.source ?? ""
				})
			}
		} catch (err) {
			const res = { error: await libraryRefusal(err) }
			emitToUser("pipelines:libraryCreateTemplate:error", res)
			return res
		}
		return await libraryAnswer(
			emitToUser,
			"pipelines:libraryCreateTemplate"
		)
	}
}

export const pipelinesLibraryCloneTemplate: Handler<
	Sockets.Pipelines.LibraryTemplateWrite.CloneParams,
	Sockets.Pipelines.LibraryTemplateWrite.Response
> = {
	event: "pipelines:libraryCloneTemplate",
	handler: async (socket, params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:libraryCloneTemplate:error", gate)
			return { error: gate.error }
		}
		try {
			if (params.kind === "context") {
				const [row] = await db
					.select()
					.from(schema.pipelineContextTemplates)
					.where(eq(schema.pipelineContextTemplates.id, params.id))
					.limit(1)
				if (!row) throw new Error("gone")
				const { duplicateContextTemplate } = await import(
					"$lib/server/pipelines/contextTemplates"
				)
				await duplicateContextTemplate(
					db as any,
					params.id,
					await libraryCopyName(
						"context",
						row.nodeTypeId,
						params.name?.trim() || `${row.name} (copy)`
					),
					// No pipeline: a copy made in the library was not made
					// while configuring anything, and claiming otherwise would
					// float it to the top of a panel it has nothing to do with.
					null
				)
			} else {
				const [row] = await db
					.select()
					.from(schema.pipelineVariableTemplates)
					.where(eq(schema.pipelineVariableTemplates.id, params.id))
					.limit(1)
				if (!row) throw new Error("gone")
				const { duplicateVariableTemplate } = await import(
					"$lib/server/pipelines/variableTemplates"
				)
				await duplicateVariableTemplate(
					db as any,
					params.id,
					await libraryCopyName(
						"variable",
						row.variableId,
						params.name?.trim() || `${row.name} (copy)`
					)
				)
			}
		} catch (err) {
			const res = { error: await libraryRefusal(err) }
			emitToUser("pipelines:libraryCloneTemplate:error", res)
			return res
		}
		return await libraryAnswer(emitToUser, "pipelines:libraryCloneTemplate")
	}
}

export const pipelinesLibraryUpdateTemplate: Handler<
	Sockets.Pipelines.LibraryTemplateWrite.UpdateParams,
	Sockets.Pipelines.LibraryTemplateWrite.Response
> = {
	event: "pipelines:libraryUpdateTemplate",
	handler: async (socket, params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:libraryUpdateTemplate:error", gate)
			return { error: gate.error }
		}
		try {
			const patch = {
				...(params.name !== undefined ? { name: params.name } : {}),
				...(params.source !== undefined
					? { source: params.source }
					: {})
			}
			if (params.kind === "context") {
				const { updateContextTemplate } = await import(
					"$lib/server/pipelines/contextTemplates"
				)
				await updateContextTemplate(db as any, params.id, patch)
			} else {
				const { updateVariableTemplate } = await import(
					"$lib/server/pipelines/variableTemplates"
				)
				await updateVariableTemplate(db as any, params.id, patch)
			}
		} catch (err) {
			const res = { error: await libraryRefusal(err) }
			emitToUser("pipelines:libraryUpdateTemplate:error", res)
			return res
		}
		return await libraryAnswer(
			emitToUser,
			"pipelines:libraryUpdateTemplate"
		)
	}
}

export const pipelinesLibraryDeleteTemplate: Handler<
	Sockets.Pipelines.LibraryTemplateWrite.DeleteParams,
	Sockets.Pipelines.LibraryTemplateWrite.Response
> = {
	event: "pipelines:libraryDeleteTemplate",
	handler: async (socket, params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:libraryDeleteTemplate:error", gate)
			return { error: gate.error }
		}
		try {
			// No `ignoreOverrideIds` here, and the difference from the panel is
			// deliberate. There the Delete button sits beside the *selected*
			// row, so the caller's own selection would refuse its own delete.
			// Here nothing is selected — the page lists rows — so a reference
			// is somebody's choice without exception, and the refusal stands.
			if (params.kind === "context") {
				const { deleteContextTemplate } = await import(
					"$lib/server/pipelines/contextTemplates"
				)
				await deleteContextTemplate(db as any, params.id)
			} else {
				const { deleteVariableTemplate } = await import(
					"$lib/server/pipelines/variableTemplates"
				)
				await deleteVariableTemplate(db as any, params.id)
			}
		} catch (err) {
			const res = { error: await libraryRefusal(err) }
			emitToUser("pipelines:libraryDeleteTemplate:error", res)
			return res
		}
		return await libraryAnswer(
			emitToUser,
			"pipelines:libraryDeleteTemplate"
		)
	}
}

export const pipelinesLibraryClonePrompt: Handler<
	Sockets.Pipelines.LibraryPromptWrite.CloneParams,
	Sockets.Pipelines.LibraryPromptWrite.Response
> = {
	event: "pipelines:libraryClonePrompt",
	handler: async (socket, params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:libraryClonePrompt:error", gate)
			return { error: gate.error }
		}
		try {
			const [row] = await db
				.select()
				.from(schema.pipelinePrompts)
				.where(eq(schema.pipelinePrompts.id, params.id))
				.limit(1)
			if (!row) throw new Error("gone")
			const { duplicatePrompt } = await import(
				"$lib/server/pipelines/prompts"
			)
			await duplicatePrompt(
				db as any,
				params.id,
				params.name?.trim() || `${row.name} (copy)`
			)
		} catch (err) {
			const res = { error: await libraryRefusal(err) }
			emitToUser("pipelines:libraryClonePrompt:error", res)
			return res
		}
		return await libraryAnswer(emitToUser, "pipelines:libraryClonePrompt")
	}
}

export const pipelinesLibraryUpdatePrompt: Handler<
	Sockets.Pipelines.LibraryPromptWrite.UpdateParams,
	Sockets.Pipelines.LibraryPromptWrite.Response
> = {
	event: "pipelines:libraryUpdatePrompt",
	handler: async (socket, params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:libraryUpdatePrompt:error", gate)
			return { error: gate.error }
		}
		try {
			const { updatePrompt } = await import(
				"$lib/server/pipelines/prompts"
			)
			await updatePrompt(db as any, params.id, {
				...(params.name !== undefined ? { name: params.name } : {}),
				...(params.fields !== undefined
					? { fields: params.fields }
					: {})
			})
		} catch (err) {
			const res = { error: await libraryRefusal(err) }
			emitToUser("pipelines:libraryUpdatePrompt:error", res)
			return res
		}
		return await libraryAnswer(emitToUser, "pipelines:libraryUpdatePrompt")
	}
}

export const pipelinesLibraryDeletePrompt: Handler<
	Sockets.Pipelines.LibraryPromptWrite.DeleteParams,
	Sockets.Pipelines.LibraryPromptWrite.Response
> = {
	event: "pipelines:libraryDeletePrompt",
	handler: async (socket, params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:libraryDeletePrompt:error", gate)
			return { error: gate.error }
		}
		try {
			const { deletePrompt } = await import(
				"$lib/server/pipelines/prompts"
			)
			await deletePrompt(db as any, params.id)
		} catch (err) {
			const res = { error: await libraryRefusal(err) }
			emitToUser("pipelines:libraryDeletePrompt:error", res)
			return res
		}
		return await libraryAnswer(emitToUser, "pipelines:libraryDeletePrompt")
	}
}

/**
 * The management page's read — versions and publish state.
 *
 * Admin-only, and that is the line the topology rule draws: this *is* the
 * structural view, so it may say how many nodes a version has. The pipeline view
 * may not, which is why the two live in different handlers rather than one
 * handler with a flag.
 */
export const pipelinesDetail: Handler<
	Sockets.Pipelines.Detail.Params,
	Sockets.Pipelines.Detail.Response
> = {
	event: "pipelines:detail",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage pipelines."
			}
			emitToUser("pipelines:detail:error", res)
			return res
		}

		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, params.slug))
			.limit(1)
		if (!spec) {
			const res = {
				error: `There is no pipeline called '${params.slug}'.`
			}
			emitToUser("pipelines:detail:error", res)
			return res
		}

		const versions = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.specId, spec.id))
			.orderBy(desc(schema.pipelineSpecVersions.id))

		const counts = await db
			.select({
				specVersionId: schema.pipelineNodes.specVersionId,
				nodeKey: schema.pipelineNodes.nodeKey
			})
			.from(schema.pipelineNodes)

		const res: Sockets.Pipelines.Detail.Response = {
			spec: {
				slug: spec.slug,
				name: spec.name,
				versions: versions.map((v: any) => ({
					id: v.id,
					semver: v.semver,
					status: v.status,
					canonicalHash: v.canonicalHash,
					isActive: spec.activeVersionId === v.id,
					publishedAt: v.publishedAt
						? new Date(v.publishedAt).toISOString()
						: null,
					nodeCount: counts.filter(
						(c: any) => c.specVersionId === v.id
					).length
				}))
			}
		}
		emitToUser("pipelines:detail", res)
		return res
	}
}

/**
 * Recent runs — the honest answer to "did that use the new path".
 *
 * Scoped to chats the asker owns, and to their own runs otherwise. A run receipt
 * records what a pipeline decided about somebody's conversation; it is not
 * instance trivia an admin browses by default.
 */
export const pipelinesRuns: Handler<
	Sockets.Pipelines.Runs.Params,
	Sockets.Pipelines.Runs.Response
> = {
	event: "pipelines:runs",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const limit = Math.min(Math.max(params.limit ?? 25, 1), 100)

		let where = eq(schema.pipelineRuns.userId, userId)
		if (params.chatId != null) {
			const [chat] = await db
				.select({ userId: schema.chats.userId })
				.from(schema.chats)
				.where(eq(schema.chats.id, params.chatId))
				.limit(1)
			if (chat?.userId !== userId) {
				const res = { runs: [] }
				emitToUser("pipelines:runs", res)
				return res
			}
			where = and(
				eq(schema.pipelineRuns.chatId, params.chatId),
				eq(schema.pipelineRuns.userId, userId)
			)!
		}

		const rows = await db
			.select()
			.from(schema.pipelineRuns)
			.where(where)
			.orderBy(desc(schema.pipelineRuns.id))
			.limit(limit)

		const res: Sockets.Pipelines.Runs.Response = {
			runs: rows.map((r: any) => ({
				id: r.id,
				runId: r.runId,
				specSlug: r.specSlug,
				outcome: r.outcome,
				haltNodeKey: r.haltNodeKey,
				haltReason: r.haltReason,
				elapsedMs: r.elapsedMs,
				tokensSpent: r.tokensSpent,
				isPreview: r.isPreview,
				messageId: r.messageId,
				startedAt: new Date(r.startedAt).toISOString()
			}))
		}
		emitToUser("pipelines:runs", res)
		return res
	}
}

/**
 * Everything parked and waiting on this person. Sent on request so a client
 * that reconnects catches up — the push (`pipelines:reviewRequested`) is for
 * the moment it happens, this is for everything it missed.
 */
export const pipelinesReviews: Handler<
	Sockets.Pipelines.Reviews.Params,
	Sockets.Pipelines.Reviews.Response
> = {
	event: "pipelines:reviews",
	handler: async (socket, _params, emitToUser) => {
		const { pendingReviewsFor } = await import(
			"$lib/server/pipelines/reviewGate"
		)
		const res = { reviews: pendingReviewsFor(socket.user!.id) as any }
		emitToUser("pipelines:reviews", res)
		return res
	}
}

export const pipelinesResolveReview: Handler<
	Sockets.Pipelines.ResolveReview.Params,
	Sockets.Pipelines.ResolveReview.Response
> = {
	event: "pipelines:resolveReview",
	handler: async (socket, params, emitToUser) => {
		const { resolveReview, ReviewNotFoundError } = await import(
			"$lib/server/pipelines/reviewGate"
		)
		try {
			resolveReview(
				params.id,
				socket.user!.id,
				params.action,
				params.values
			)
		} catch (err) {
			const res = {
				error:
					err instanceof ReviewNotFoundError || err instanceof Error
						? err.message
						: "That decision could not be recorded."
			}
			emitToUser("pipelines:resolveReview:error", res)
			return res
		}
		const res = { ok: true }
		emitToUser("pipelines:resolveReview", res)
		return res
	}
}

export function registerPipelineHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	// The gate's push transport, bound once per process to socket.io's rooms.
	// A review can park from any trigger, so it pushes by user rather than
	// through whichever handler happened to start the run.
	import("$lib/server/pipelines/reviewGate").then(({ setReviewTransport }) =>
		setReviewTransport((userId, event, data) =>
			socket.io.to(`user_${userId}`).emit(event, data)
		)
	)

	register(socket, pipelinesList, emitToUser)
	register(socket, pipelinesGet, emitToUser)
	register(socket, pipelinesSetOption, emitToUser)
	register(socket, pipelinesClearOption, emitToUser)
	register(socket, pipelinesSelectConfig, emitToUser)
	register(socket, pipelinesClonePrompt, emitToUser)
	register(socket, pipelinesUpdatePrompt, emitToUser)
	register(socket, pipelinesDeletePrompt, emitToUser)
	register(socket, pipelinesLibrary, emitToUser)
	register(socket, pipelinesPreviewTemplate, emitToUser)
	register(socket, pipelinesLibraryCreateTemplate, emitToUser)
	register(socket, pipelinesLibraryCloneTemplate, emitToUser)
	register(socket, pipelinesLibraryUpdateTemplate, emitToUser)
	register(socket, pipelinesLibraryDeleteTemplate, emitToUser)
	register(socket, pipelinesLibraryClonePrompt, emitToUser)
	register(socket, pipelinesLibraryUpdatePrompt, emitToUser)
	register(socket, pipelinesLibraryDeletePrompt, emitToUser)
	register(socket, pipelinesCreateContextTemplate, emitToUser)
	register(socket, pipelinesCloneContextTemplate, emitToUser)
	register(socket, pipelinesUpdateContextTemplate, emitToUser)
	register(socket, pipelinesDeleteContextTemplate, emitToUser)
	register(socket, pipelinesCloneVariableTemplate, emitToUser)
	register(socket, pipelinesUpdateVariableTemplate, emitToUser)
	register(socket, pipelinesDeleteVariableTemplate, emitToUser)
	register(socket, pipelinesDetail, emitToUser)
	register(socket, pipelinesRuns, emitToUser)
	register(socket, pipelinesReviews, emitToUser)
	register(socket, pipelinesResolveReview, emitToUser)
}
