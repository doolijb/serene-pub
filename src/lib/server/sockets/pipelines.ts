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
 * than one thing on screen: setting a value at session scope changes that option's
 * provenance badge *and* may unshadow another, and clearing one reveals whatever
 * it was covering. Returning the resolved view is one round trip and removes a
 * whole category of "the panel says something different from the database".
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import {
	clearOption,
	listNamespaces,
	declarations,
	humanizeCamel,
	humanizeTypeId,
	i18nText,
	namespaceView,
	selectNamedConfig,
	writeOption,
	OptionNotFoundError,
	OptionNotWritableError,
	type Viewer
} from "$lib/server/pipelines/config/panel"
import { redactConnections } from "$lib/server/connections/visibility"
// Owner-OR-guest, in the one place that decides it. A local
// `eq(sessions.userId, userId)` here would be a fourth copy of a rule whose
// previous copies locked guests out of features they were entitled to — see
// `sessionAccess.ts`'s own note. Runs stay scoped to the asker's `user_id`
// on top of it, so access to the session never becomes access to somebody
// else's receipts.
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
// The two things a preview turn needs that this file has never needed before:
// who is due to speak, and which lane counts as the conversation. Imported
// rather than re-derived — `getNextCharacterTurn` is the rotation rule, and a
// second copy of it here would answer a different question from the one the
// send answers.
import { getNextCharacterTurn } from "$lib/server/utils/getNextCharacterTurn"
import {
	DEFAULT_CHANNEL,
	channelWhere
} from "$lib/server/messages/channels"
import { MAX_CHAT_MESSAGE_LENGTH } from "$lib/shared/constants/MessageLimits"
// The budget band a declared entry type's rows compete in — the declaration's
// own answer, not a fourth table of source names. It is what keys the entry
// index the retrieval explanation looks rows up in.
import {
	entryDeclaration,
	bandOfType
} from "$lib/server/entries/declarations"
// The one recipe for "what this entry says", shared with the annotation lane
// and with the run that recorded the receipt — see `entrySourceHash`.
import { entrySourceHash } from "$lib/server/annotations"
import type { EntryTypeId } from "$lib/shared/entries/types"

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
 * `sessionId` is only honoured for a session the asker owns. 05 §0a says configuring
 * from inside a session you own writes at session scope; the ownership half of that is
 * not decoration, because the parameter arrives from the client and a session id is
 * a small integer somebody can guess.
 */
async function viewerFor(socket: any, sessionId?: number): Promise<Viewer> {
	const userId = socket.user!.id
	if (sessionId == null) return { userId, isAdmin: !!socket.user!.isAdmin }
	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return {
		userId,
		isAdmin: !!socket.user!.isAdmin,
		sessionId: session?.userId === userId ? sessionId : undefined
	}
}

/** Re-read and emit; the single place a mutation's answer is produced. */
async function emitView(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	event: string,
	slug: string,
	sessionId?: number
) {
	const viewer = await viewerFor(socket, sessionId)
	const pipeline = await namespaceView(
		db,
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
			pipelinesList: (await listNamespaces(db)) as any,
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
			params.sessionId
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
				db,
				await instanceSecret(),
				params.slug,
				await viewerFor(socket, params.sessionId),
				params.optionId,
				params.value,
				params.configId
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
			params.sessionId
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
				db,
				await instanceSecret(),
				params.slug,
				await viewerFor(socket, params.sessionId),
				params.optionId,
				params.configId
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
			params.sessionId
		)) as Sockets.Pipelines.ClearOption.Response
	}
}

/**
 * The builder's Save all (22 §3): a whole draft in one request. Entries apply
 * in order through the same `writeOption`/`clearOption` every per-option event
 * uses — same scope resolution, same refusals — and the first refusal stops
 * the batch with a count of what landed, so a partial apply is named rather
 * than silent. One refreshed view answers on `pipelines:get`, not one per
 * entry.
 */
export const pipelinesSetOptions: Handler<
	Sockets.Pipelines.SetOptions.Params,
	Sockets.Pipelines.SetOptions.Response
> = {
	event: "pipelines:setOptions",
	handler: async (socket, params, emitToUser) => {
		const secret = await instanceSecret()
		const viewer = await viewerFor(socket, params.sessionId)
		let applied = 0
		try {
			for (const entry of params.set ?? []) {
				await writeOption(
					db,
					secret,
					params.slug,
					viewer,
					entry.optionId,
					entry.value,
					params.configId
				)
				applied++
			}
			for (const optionId of params.clear ?? []) {
				await clearOption(
					db,
					secret,
					params.slug,
					viewer,
					optionId,
					params.configId
				)
				applied++
			}
		} catch (err) {
			const res = { error: refusal(err), applied }
			emitToUser("pipelines:setOptions:error", res)
			// The view refreshes even on a partial apply — what landed is
			// real, and a stale panel over fresh rows is the worse outcome.
			await emitView(
				socket,
				emitToUser,
				"pipelines:get",
				params.slug,
				params.sessionId
			)
			return res
		}
		return (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.sessionId
		)) as Sockets.Pipelines.SetOptions.Response
	}
}

/* ------------------------------------------------------------------ *
 * Named-config CRUD — the builder's save/duplicate/rename/delete
 *
 * Admin-only, on the same terms as every other structural verb: a
 * configuration is the instance's, and 05 §0a puts anything that shapes what
 * the instance runs behind the management screen rather than the sidebar.
 * ------------------------------------------------------------------ */

/** The spec a config verb names, refused by name rather than by id. */
async function specForSlug(slug: string) {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
		.limit(1)
	if (!spec) throw new Error(`There is no pipeline called '${slug}'.`)
	return spec
}

/**
 * A config id the caller supplied must belong to the pipeline they are looking
 * at. Ids are small integers somebody can guess; without this, guessing one
 * renames or deletes another pipeline's configuration through this one's
 * screen — the same hole `promptForOption` closes for prompts.
 */
async function configInSpec(slug: string, configId: number) {
	const spec = await specForSlug(slug)
	const [row] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.id, configId))
		.limit(1)
	if (!row) throw new Error("That configuration no longer exists.")
	if (row.specId !== spec.id)
		throw new Error(
			`'${row.name}' belongs to a different pipeline. Configurations are ` +
				`namespaced to the pipeline they were written for.`
		)
	return row
}

/**
 * The caller's "own selection" outside a session, since the layer simplification
 * (2026-08-24): the instance-selected config's value rows pointing at a row
 * about to be deleted. Only a mutable config's — the shipped default is not
 * the admin's to release, and `delete*`'s reference check still refuses it.
 * Slot-filtered because values are arbitrary json: a params value that
 * happens to equal the row id must not be swept up as a reference.
 */
async function ownInstanceConfigValues(
	slug: string,
	rowId: number,
	slots: string[]
): Promise<any[]> {
	if (!slots.length) return []
	const spec = await specForSlug(slug)
	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const selected = await resolveSelectedConfig(db, spec.id, slug, {})
	if (!selected) return []
	const [cfg] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.id, selected.configId))
		.limit(1)
	if (!cfg || (cfg as any).isImmutable) return []
	const { inArray } = await import("drizzle-orm")
	const rows = await db
		.select()
		.from(schema.pipelineConfigValues)
		.where(
			and(
				eq(schema.pipelineConfigValues.configId, selected.configId),
				inArray(schema.pipelineConfigValues.slot, slots)
			)
		)
	return (rows as any[]).filter((v) => v.value === rowId)
}

const adminOnly = (
	socket: any,
	emitToUser: any,
	event: string
): { error: string } | null => {
	if (socket.user?.isAdmin) return null
	const res = {
		error: "Access denied. Only admin users can manage pipelines."
	}
	emitToUser(`${event}:error`, res)
	return res
}

/**
 * Config refusals reach the person, on the `promptRefusal` precedent.
 *
 * The generic `refusal` deliberately swallows anything it does not recognise,
 * so an unexpected failure cannot leak internals into a toast. These messages
 * are the opposite: written for the reader, and useless in a log — "this
 * pipeline already has a configuration called 'Nighttime'" is the entire
 * answer to why the button did nothing.
 *
 * The `/pipeline/` clause carries the scoping refusals thrown by
 * `specForSlug` / `configInSpec`, which are plain Errors rather than a typed
 * class: they are refusals about a *name the caller supplied*, not about the
 * entity's own rules, so there is nothing for an entity module to own.
 */
const configRefusal = async (err: unknown): Promise<string> => {
	const { ConfigNotFoundError, ConfigNotUsableError } = await import(
		"$lib/server/pipelines/config/named"
	)
	if (
		err instanceof ConfigNotFoundError ||
		err instanceof ConfigNotUsableError
	)
		return err.message
	if (err instanceof Error && /pipeline|configuration/.test(err.message))
		return err.message
	console.error("[pipelines] config mutation failed:", err)
	return "That change could not be saved. The server log has the details."
}

/**
 * Which actions a preset includes, and whether it may be chosen (19 §3).
 *
 * Admin-only, like every other write to a preset: a preset decides what sessions
 * using it can do, and which presets a non-admin sees at all. The entity layer
 * holds the refusals — immutable rows, actions the mode was never offered — so
 * the answer does not depend on which door the request came through.
 */
export const pipelinesSetPresetActions: Handler<
	Sockets.Pipelines.SetPresetActions.Params,
	Sockets.Pipelines.SetPresetActions.Response
> = {
	event: "pipelines:setPresetActions",
	handler: async (socket, params, emitToUser) => {
		const denied = adminOnly(
			socket,
			emitToUser,
			"pipelines:setPresetActions"
		)
		if (denied) return denied
		try {
			const config = await configInSpec(params.slug, params.configId)
			const { setPresetActions } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const r = await setPresetActions(db, config.id, {
				...(params.includedActions !== undefined
					? { includedActions: params.includedActions }
					: {}),
				...(params.enabled !== undefined
					? { enabled: params.enabled }
					: {})
			})
			if (!r.ok) {
				const res = { error: r.error }
				emitToUser("pipelines:setPresetActions:error", res)
				return res
			}
		} catch (err) {
			const res = { error: await configRefusal(err) }
			emitToUser("pipelines:setPresetActions:error", res)
			return res
		}
		return (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.sessionId
		)) as Sockets.Pipelines.SetPresetActions.Response
	}
}

export const pipelinesCreateConfig: Handler<
	Sockets.Pipelines.CreateConfig.Params,
	Sockets.Pipelines.CreateConfig.Response
> = {
	event: "pipelines:createConfig",
	handler: async (socket, params, emitToUser) => {
		const denied = adminOnly(socket, emitToUser, "pipelines:createConfig")
		if (denied) return denied
		let configId: number
		try {
			const { createConfig, duplicateConfig } = await import(
				"$lib/server/pipelines/config/named"
			)
			const spec = await specForSlug(params.slug)
			const made =
				params.fromConfigId != null
					? await duplicateConfig(
							db,
							(
								await configInSpec(
									params.slug,
									params.fromConfigId
								)
							).id,
							params.name
						)
					: await createConfig(db, spec.id, params.name)
			configId = made.id
		} catch (err) {
			const res = { error: await configRefusal(err) }
			emitToUser("pipelines:createConfig:error", res)
			return res
		}
		const view = (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.sessionId
		)) as Sockets.Pipelines.CreateConfig.Response
		// Emitted as well as returned: `register` discards a handler's return
		// value, so the id only reaches the client through an event. The
		// builder uses it to select what it just made — same shape as
		// `pipelines:clonePrompt`.
		const res = { ...view, configId }
		emitToUser("pipelines:createConfig", res)
		return res
	}
}

export const pipelinesRenameConfig: Handler<
	Sockets.Pipelines.RenameConfig.Params,
	Sockets.Pipelines.RenameConfig.Response
> = {
	event: "pipelines:renameConfig",
	handler: async (socket, params, emitToUser) => {
		const denied = adminOnly(socket, emitToUser, "pipelines:renameConfig")
		if (denied) return denied
		try {
			const { renameConfig } = await import(
				"$lib/server/pipelines/config/named"
			)
			const row = await configInSpec(params.slug, params.configId)
			await renameConfig(db, row.id, params.name)
		} catch (err) {
			const res = { error: await configRefusal(err) }
			emitToUser("pipelines:renameConfig:error", res)
			return res
		}
		return (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.sessionId
		)) as Sockets.Pipelines.RenameConfig.Response
	}
}

export const pipelinesDeleteConfig: Handler<
	Sockets.Pipelines.DeleteConfig.Params,
	Sockets.Pipelines.DeleteConfig.Response
> = {
	event: "pipelines:deleteConfig",
	handler: async (socket, params, emitToUser) => {
		const denied = adminOnly(socket, emitToUser, "pipelines:deleteConfig")
		if (denied) return denied
		try {
			const { deleteConfig } = await import(
				"$lib/server/pipelines/config/named"
			)
			const row = await configInSpec(params.slug, params.configId)
			await deleteConfig(db, row.id)
		} catch (err) {
			const res = { error: await configRefusal(err) }
			emitToUser("pipelines:deleteConfig:error", res)
			return res
		}
		return (await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.sessionId
		)) as Sockets.Pipelines.DeleteConfig.Response
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
				db,
				params.slug,
				await viewerFor(socket, params.sessionId),
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
			params.sessionId
		)) as Sockets.Pipelines.SelectConfig.Response
	}
}

/* ------------------------------------------------------------------ *
 * Version notices — what publishing did to a configuration
 *
 * The cull has always been recorded (`pipeline_config_notices`) and, until
 * now, read by nobody: a person who deliberately set a value at an address a
 * later version moved lost it with no indication anywhere. These two events are
 * the reader. Admin-only, on the same terms as the rest of the config verbs —
 * the notice is about the instance's configuration, and dismissing one is a
 * write to it.
 * ------------------------------------------------------------------ */

/** The pending notices for a config, in the shape the panel renders. */
async function noticesFor(
	configId: number
): Promise<Sockets.Pipelines.ConfigNotice[]> {
	const { pendingNotices } = await import(
		"$lib/server/pipelines/config/named"
	)
	return ((await pendingNotices(db, configId)) as any[]).map((n) => ({
		id: n.id,
		kind: n.kind,
		// A row written before the reconciler learned to label its culls has
		// none, and there is nothing left to recover it from — so it says what
		// it can rather than rendering as an empty line. Fresh notices always
		// carry a label.
		label:
			n.label ??
			(n.kind === "culled"
				? "A setting this version removed"
				: "A setting this version added"),
		// The address is not sent. `nodeKey` is topology (05 §0a) and the label
		// is the part a person needs; the id is what a dismissal names.
		...(n.previousValue != null ? { previousValue: n.previousValue } : {}),
		at: new Date(n.createdAt).toISOString()
	}))
}

export const pipelinesConfigNotices: Handler<
	Sockets.Pipelines.ConfigNotices.Params,
	Sockets.Pipelines.ConfigNotices.Response
> = {
	event: "pipelines:configNotices",
	handler: async (socket, params, emitToUser) => {
		const denied = adminOnly(socket, emitToUser, "pipelines:configNotices")
		if (denied) return denied
		try {
			const config = await configInSpec(params.slug, params.configId)
			const res = {
				configId: config.id,
				notices: await noticesFor(config.id)
			}
			emitToUser("pipelines:configNotices", res)
			return res
		} catch (err) {
			const res = { error: await configRefusal(err) }
			emitToUser("pipelines:configNotices:error", res)
			return res
		}
	}
}

export const pipelinesAcknowledgeConfigNotices: Handler<
	Sockets.Pipelines.AcknowledgeConfigNotices.Params,
	Sockets.Pipelines.AcknowledgeConfigNotices.Response
> = {
	event: "pipelines:acknowledgeConfigNotices",
	handler: async (socket, params, emitToUser) => {
		const denied = adminOnly(
			socket,
			emitToUser,
			"pipelines:acknowledgeConfigNotices"
		)
		if (denied) return denied
		try {
			// `configInSpec` first, and the acknowledgement is scoped to that
			// row's id: the notice id arrives from the client, so the pairing
			// is what stops one configuration's dismissal reaching another's.
			const config = await configInSpec(params.slug, params.configId)
			const { acknowledgeNotices } = await import(
				"$lib/server/pipelines/config/named"
			)
			await acknowledgeNotices(db, config.id, params.noticeId)
			const res = {
				configId: config.id,
				notices: await noticesFor(config.id)
			}
			// Answered on the read event, like every other mutation here
			// answers on `pipelines:get`: one listener, and no chance of the
			// banner disagreeing with the rows behind it.
			emitToUser("pipelines:configNotices", res)
			return res
		} catch (err) {
			const res = { error: await configRefusal(err) }
			emitToUser("pipelines:acknowledgeConfigNotices:error", res)
			return res
		}
	}
}

/* ------------------------------------------------------------------ *
 * Prompt CRUD — clone, edit, delete, from the panel
 * ------------------------------------------------------------------ */

/**
 * The gate every prompt mutation passes first — and it is the same shape as
 * `layoutForOption` and `contextTemplateForOption` now, which it was not.
 *
 * It replaces `promptInSpec`, which asked whether the prompt belonged to the
 * pipeline whose panel was open. That was the right question while a prompt was
 * namespaced to a spec and has no answer now: a prompt is pooled by the node
 * that consumes it, so an action reusing the reply pipeline's context node is
 * *meant* to reach the same rows, and an ownership check would refuse every one
 * of them while looking like a security check.
 *
 * The hole it closed is still closed. `promptId` arrives from the client as a
 * small integer somebody can guess, so what is checked instead is what the
 * other two gates check: the option handle resolves to a prompt setting this
 * pipeline declares, the viewer may write it, and the row being mutated belongs
 * to that setting's pool.
 */
async function promptForOption(
	socket: any,
	params: {
		slug: string
		optionId: string
		promptId: number
		sessionId?: number
	}
) {
	const { promptOptionGate } = await import(
		"$lib/server/pipelines/config/panel"
	)
	const { assertSelectable } = await import(
		"$lib/server/pipelines/entities/prompts"
	)
	const viewer = await viewerFor(socket, params.sessionId)
	const { nodeTypeId, slot, nodeKey, specId, specVersionId } =
		await promptOptionGate(
			db,
			await instanceSecret(),
			params.slug,
			viewer,
			params.optionId
		)
	// Through `assertSelectable` rather than a bare pool comparison, so a
	// mutation and a selection refuse for the same reasons in the same words —
	// including the fields check, which catches a row that fits the pool but
	// not this version of the slot.
	const row = await assertSelectable(
		db,
		specVersionId,
		nodeKey,
		slot,
		params.promptId
	)
	return { viewer, nodeTypeId, slot, specId, row }
}

/**
 * "Roleplay (copy)", then "(copy 2)" — names are unique per **pool**.
 *
 * Per pool, not per pipeline, because that is what the unique index is on now.
 * Scoped to the spec, two pipelines sharing a pool would both propose
 * "Roleplay (copy)" — the second insert would hit
 * `pipeline_prompts_pool_name_idx` as a raw constraint error, surfacing to the
 * person who pressed Duplicate as the generic "the server log has the details".
 */
async function copyName(
	nodeTypeId: string,
	slot: string,
	base: string
): Promise<string> {
	const taken = await takenPromptNames(nodeTypeId, slot)
	let candidate = `${base} (copy)`
	for (let n = 2; taken.has(candidate); n++) candidate = `${base} (copy ${n})`
	return candidate
}

/** "New prompt", then "New prompt (2)" — the same pool, a different suffix. */
async function freePromptName(
	nodeTypeId: string,
	slot: string,
	base: string
): Promise<string> {
	const taken = await takenPromptNames(nodeTypeId, slot)
	let candidate = base
	for (let n = 2; taken.has(candidate); n++) candidate = `${base} (${n})`
	return candidate
}

async function takenPromptNames(
	nodeTypeId: string,
	slot: string
): Promise<Set<string>> {
	const rows = await db
		.select({ name: schema.pipelinePrompts.name })
		.from(schema.pipelinePrompts)
		.where(
			and(
				eq(schema.pipelinePrompts.nodeTypeId, nodeTypeId),
				eq(schema.pipelinePrompts.slot, slot)
			)
		)
	return new Set((rows as any[]).map((r) => r.name))
}

const promptRefusal = async (err: unknown): Promise<string> => {
	const { PromptNotFoundError, PromptNotUsableError } = await import(
		"$lib/server/pipelines/entities/prompts"
	)
	const { OptionNotFoundError, OptionNotWritableError } = await import(
		"$lib/server/pipelines/config/panel"
	)
	if (
		err instanceof PromptNotFoundError ||
		err instanceof PromptNotUsableError ||
		// The gate's refusals reach the person too, as they do for layouts and
		// templates: "open the session you want to change" is the whole answer
		// to why the button did nothing.
		err instanceof OptionNotFoundError ||
		err instanceof OptionNotWritableError
	)
		return err.message
	if (err instanceof Error && /pipeline/.test(err.message)) return err.message
	console.error("[pipelines] prompt mutation failed:", err)
	return "That change could not be saved. The server log has the details."
}

/**
 * Write a prompt from nothing.
 *
 * Exists for the reason `createContextTemplate` does, and pooling made it
 * necessary rather than merely tidy: a pool can be legitimately empty. Core
 * ships prose for its own nodes and none for a plugin's, so a plugin node's
 * picker offers nothing at all — and a picker with no rows and no way to add
 * one is a dead end rather than a default. The create names its pool by option
 * handle, so the pool comes from the declaration and never from the client.
 */
export const pipelinesCreatePrompt: Handler<
	Sockets.Pipelines.CreatePrompt.Params,
	Sockets.Pipelines.CreatePrompt.Response
> = {
	event: "pipelines:createPrompt",
	handler: async (socket, params, emitToUser) => {
		let promptId: number
		try {
			const { promptOptionGate } = await import(
				"$lib/server/pipelines/config/panel"
			)
			const viewer = await viewerFor(socket, params.sessionId)
			const { nodeTypeId, slot, specId } = await promptOptionGate(
				db,
				await instanceSecret(),
				params.slug,
				viewer,
				params.optionId
			)
			const { createPrompt } = await import(
				"$lib/server/pipelines/entities/prompts"
			)
			const made = await createPrompt(db, {
				nodeTypeId,
				slot,
				// Through the same uniquifier a clone uses: the pool's unique
				// name index is what a second "New prompt" would hit, and a raw
				// constraint error is not an answer anyone can act on.
				name: await freePromptName(
					nodeTypeId,
					slot,
					params.name?.trim() || "New prompt"
				),
				fields: params.fields ?? {},
				// Written here, so it sorts to the top of *this* pipeline's
				// picker next time. Grouping only — it stays selectable
				// everywhere the node is reused.
				createdForSpecId: specId
			})
			promptId = made.id
		} catch (err) {
			const res = { error: await promptRefusal(err) }
			emitToUser("pipelines:createPrompt:error", res)
			return res
		}
		const view = await emitView(
			socket,
			emitToUser,
			"pipelines:get",
			params.slug,
			params.sessionId
		)
		const res = {
			promptId,
			...view
		} as Sockets.Pipelines.CreatePrompt.Response
		emitToUser("pipelines:createPrompt", res)
		return res
	}
}

export const pipelinesClonePrompt: Handler<
	Sockets.Pipelines.ClonePrompt.Params,
	Sockets.Pipelines.ClonePrompt.Response
> = {
	event: "pipelines:clonePrompt",
	handler: async (socket, params, emitToUser) => {
		let promptId: number
		try {
			const { nodeTypeId, slot, specId, row } = await promptForOption(
				socket,
				params
			)
			const { duplicatePrompt } = await import(
				"$lib/server/pipelines/entities/prompts"
			)
			const copy = await duplicatePrompt(
				db,
				row.id,
				params.name?.trim() ||
					(await copyName(nodeTypeId, slot, row.name)),
				// The copy remembers where it was made, so it leads this
				// pipeline's picker next time. The original keeps its own
				// origin — duplicating somebody's prompt does not move theirs.
				specId
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
			params.sessionId
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
			const { row } = await promptForOption(socket, params)
			const { updatePrompt } = await import(
				"$lib/server/pipelines/entities/prompts"
			)
			await updatePrompt(db, row.id, {
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
			params.sessionId
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
			const { viewer, slot, specId, row } = await promptForOption(
				socket,
				params
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
			// `value` is a json column, which Postgres cannot compare with `=`
			// — so the rows are read and matched in code, the same way the
			// reference check in `deletePrompt` does.
			//
			// "Your own selection" has two homes since the layer
			// simplification (2026-08-24): inside a session it is the session's
			// override row; outside one it is the value row of the instance's
			// selected config — released only when that config is the
			// admin's to edit, which `deletePrompt` still guards by refusing
			// every other reference.
			const mine: any[] = []
			const mineValues: any[] = []
			if (viewer.sessionId != null) {
				const own = await db
					.select()
					.from(schema.pipelineNodeOverrides)
					.where(
						and(
							eq(schema.pipelineNodeOverrides.specId, specId),
							eq(
								schema.pipelineNodeOverrides.scopeKind,
								"session"
							),
							eq(
								schema.pipelineNodeOverrides.scopeId,
								viewer.sessionId
							),
							// The declaration's own slot, not the literal
							// "prompts": the pool's second half is whatever the
							// node called it, and a plugin naming it anything
							// else would have its selection missed here — the
							// row would hold the prompt alive and refuse the
							// caller's own delete.
							eq(schema.pipelineNodeOverrides.slot, slot)
						)
					)
				mine.push(...(own as any[]).filter((o) => o.value === row.id))
			} else if (viewer.isAdmin) {
				const { resolveSelectedConfig } = await import(
					"$lib/server/pipelines/config/named"
				)
				const selected = await resolveSelectedConfig(
					db,
					specId,
					params.slug,
					{}
				)
				if (selected) {
					const [cfg] = await db
						.select()
						.from(schema.pipelineConfigs)
						.where(eq(schema.pipelineConfigs.id, selected.configId))
						.limit(1)
					if (cfg && !(cfg as any).isImmutable) {
						const own = await db
							.select()
							.from(schema.pipelineConfigValues)
							.where(
								and(
									eq(
										schema.pipelineConfigValues.configId,
										selected.configId
									),
									eq(schema.pipelineConfigValues.slot, slot)
								)
							)
						mineValues.push(
							...(own as any[]).filter((v) => v.value === row.id)
						)
					}
				}
			}
			const { deletePrompt } = await import(
				"$lib/server/pipelines/entities/prompts"
			)
			await deletePrompt(db, row.id, {
				ignoreOverrideIds: new Set(mine.map((o) => o.id)),
				ignoreConfigValueIds: new Set(mineValues.map((v) => v.id))
			})
			for (const row of mine)
				await db
					.delete(schema.pipelineNodeOverrides)
					.where(eq(schema.pipelineNodeOverrides.id, row.id))
			for (const row of mineValues)
				await db
					.delete(schema.pipelineConfigValues)
					.where(eq(schema.pipelineConfigValues.id, row.id))
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
			params.sessionId
		)) as Sockets.Pipelines.DeletePrompt.Response
	}
}

/* ------------------------------------------------------------------ *
 * Variable layout CRUD — clone, edit, delete, from the panel
 * ------------------------------------------------------------------ */

/**
 * The gate, and the shape all three of them take now.
 *
 * A layout is shared across pipelines *by design* — that is the feature — so
 * "does this row belong to this spec" has no true answer for one, and a gate
 * asking it would quietly remove cross-pipeline reuse while looking like a
 * security check.
 *
 * What is checked instead: the option handle resolves to a layout setting this
 * pipeline actually declares, the viewer may write it, and the row being
 * mutated renders the same variable that setting does. So the rule is "you may
 * edit a layout through a setting that uses it", which is the honest version of
 * the ownership question.
 *
 * Prompts used to be the exception here, gated on ownership because they were
 * namespaced to a spec. Pooling them by the node that consumes them made the
 * ownership question exactly as meaningless for a prompt as it always was for a
 * layout, so `promptForOption` is now this same shape.
 */
async function layoutForOption(
	socket: any,
	params: {
		slug: string
		optionId: string
		templateId: number
		sessionId?: number
	}
) {
	const { variableOptionGate } = await import(
		"$lib/server/pipelines/config/panel"
	)
	const { assertSelectable } = await import(
		"$lib/server/pipelines/entities/variableTemplates"
	)
	const viewer = await viewerFor(socket, params.sessionId)
	const { variableId } = await variableOptionGate(
		db,
		await instanceSecret(),
		params.slug,
		viewer,
		params.optionId
	)
	const row = await assertSelectable(db, variableId, params.templateId)
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
		await import("$lib/server/pipelines/entities/variableTemplates")
	const { OptionNotFoundError, OptionNotWritableError } = await import(
		"$lib/server/pipelines/config/panel"
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
				"$lib/server/pipelines/entities/variableTemplates"
			)
			const copy = await duplicateVariableTemplate(
				db,
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
			params.sessionId
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
				"$lib/server/pipelines/entities/variableTemplates"
			)
			await updateVariableTemplate(db, row.id, {
				...(params.name !== undefined ? { name: params.name } : {}),
				...(params.source !== undefined
					? { source: params.source }
					: {}),
				...(params.engine !== undefined
					? { engine: params.engine }
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
			params.sessionId
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
			const { deleteVariableTemplate, variableSlotNames } = await import(
				"$lib/server/pipelines/entities/variableTemplates"
			)
			const own = await ownInstanceConfigValues(
				params.slug,
				row.id,
				await variableSlotNames(db)
			)
			await deleteVariableTemplate(db, row.id, {
				ignoreConfigValueIds: new Set(own.map((v) => v.id))
			})
			for (const v of own)
				await db
					.delete(schema.pipelineConfigValues)
					.where(eq(schema.pipelineConfigValues.id, v.id))
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
			params.sessionId
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
		sessionId?: number
	}
) {
	const { contextTemplateOptionGate } = await import(
		"$lib/server/pipelines/config/panel"
	)
	const { assertSelectable } = await import(
		"$lib/server/pipelines/entities/contextTemplates"
	)
	const viewer = await viewerFor(socket, params.sessionId)
	const { nodeTypeId, engine, specId } = await contextTemplateOptionGate(
		db,
		await instanceSecret(),
		params.slug,
		viewer,
		params.optionId
	)
	const row = await assertSelectable(
		db,
		nodeTypeId,
		params.templateId,
		engine
	)
	return { viewer, nodeTypeId, engine, specId, row }
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
		await import("$lib/server/pipelines/entities/contextTemplates")
	const { OptionNotFoundError, OptionNotWritableError } = await import(
		"$lib/server/pipelines/config/panel"
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
				"$lib/server/pipelines/config/panel"
			)
			const viewer = await viewerFor(socket, params.sessionId)
			const { nodeTypeId, specId } = await contextTemplateOptionGate(
				db,
				await instanceSecret(),
				params.slug,
				viewer,
				params.optionId
			)
			const { createContextTemplate } = await import(
				"$lib/server/pipelines/entities/contextTemplates"
			)
			const created = await createContextTemplate(db, {
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
			params.sessionId
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
				"$lib/server/pipelines/entities/contextTemplates"
			)
			const copy = await duplicateContextTemplate(
				db,
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
			params.sessionId
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
				"$lib/server/pipelines/entities/contextTemplates"
			)
			await updateContextTemplate(db, row.id, {
				...(params.name !== undefined ? { name: params.name } : {}),
				...(params.source !== undefined
					? { source: params.source }
					: {}),
				...(params.engine !== undefined
					? { engine: params.engine }
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
			params.sessionId
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
			const { deleteContextTemplate, contextTemplateSlotNames } =
				await import("$lib/server/pipelines/entities/contextTemplates")
			const own = await ownInstanceConfigValues(
				params.slug,
				row.id,
				await contextTemplateSlotNames(db)
			)
			await deleteContextTemplate(db, row.id, {
				ignoreConfigValueIds: new Set(own.map((v) => v.id))
			})
			for (const v of own)
				await db
					.delete(schema.pipelineConfigValues)
					.where(eq(schema.pipelineConfigValues.id, v.id))
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
			params.sessionId
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
			await import("$lib/server/pipelines/prompt/preview")
		const {
			lintContextTemplate,
			lintVariableTemplate,
			parseContextTemplate
		} = await import("$lib/shared/utils/contextConfigCards")
		const { getVariable } = await import("@serene-pub/sdk")

		let res: Sockets.Pipelines.PreviewTemplate.Response
		if (params.kind === "variable") {
			const decl = getVariable(params.poolId)
			res = await previewVariableTemplate({
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
			res = await previewContextTemplate({
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
		const { libraryView } = await import(
			"$lib/server/pipelines/config/library"
		)
		const res = (await libraryView(
			db
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
	const ctx = await import("$lib/server/pipelines/entities/contextTemplates")
	const vars = await import(
		"$lib/server/pipelines/entities/variableTemplates"
	)
	const prompts = await import("$lib/server/pipelines/entities/prompts")
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
	const { libraryView } = await import("$lib/server/pipelines/config/library")
	const library = (await libraryView(
		db
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

/**
 * The same, for a prompt's `(node type, slot)` pool.
 *
 * Separate from `libraryCopyName` only because the pool is two columns here and
 * one there. Without it a clone whose name is already taken reached the unique
 * index and came back as a Postgres constraint string — and a clone is the most
 * likely way to collide, since its default name is derived from a row that is
 * by definition already in the pool.
 */
async function promptCopyName(
	nodeTypeId: string,
	slot: string,
	base: string
): Promise<string> {
	const rows = await db
		.select({ name: schema.pipelinePrompts.name })
		.from(schema.pipelinePrompts)
		.where(
			and(
				eq(schema.pipelinePrompts.nodeTypeId, nodeTypeId),
				eq(schema.pipelinePrompts.slot, slot)
			)
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
					"$lib/server/pipelines/entities/contextTemplates"
				)
				await createContextTemplate(db, {
					nodeTypeId: params.poolId,
					name,
					source: params.source ?? "",
					engine: params.engine ?? null
				})
			} else {
				const { createVariableTemplate } = await import(
					"$lib/server/pipelines/entities/variableTemplates"
				)
				await createVariableTemplate(db, {
					variableId: params.poolId,
					name,
					source: params.source ?? "",
					engine: params.engine ?? null
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
					"$lib/server/pipelines/entities/contextTemplates"
				)
				await duplicateContextTemplate(
					db,
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
					"$lib/server/pipelines/entities/variableTemplates"
				)
				await duplicateVariableTemplate(
					db,
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
					: {}),
				...(params.engine !== undefined
					? { engine: params.engine }
					: {})
			}
			if (params.kind === "context") {
				const { updateContextTemplate } = await import(
					"$lib/server/pipelines/entities/contextTemplates"
				)
				await updateContextTemplate(db, params.id, patch)
			} else {
				const { updateVariableTemplate } = await import(
					"$lib/server/pipelines/entities/variableTemplates"
				)
				await updateVariableTemplate(db, params.id, patch)
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
					"$lib/server/pipelines/entities/contextTemplates"
				)
				await deleteContextTemplate(db, params.id)
			} else {
				const { deleteVariableTemplate } = await import(
					"$lib/server/pipelines/entities/variableTemplates"
				)
				await deleteVariableTemplate(db, params.id)
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
				"$lib/server/pipelines/entities/prompts"
			)
			await duplicatePrompt(
				db,
				params.id,
				await promptCopyName(
					row.nodeTypeId,
					row.slot,
					params.name?.trim() || `${row.name} (copy)`
				)
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
				"$lib/server/pipelines/entities/prompts"
			)
			await updatePrompt(db, params.id, {
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
				"$lib/server/pipelines/entities/prompts"
			)
			await deletePrompt(db, params.id)
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
/* --- the scripts page (18 §4d) ------------------------------------- */

/**
 * Same gate, same answer-with-the-whole-view shape as the library: a mutation
 * here routinely changes another group on the page, and the page is one read.
 */
const scriptsRefusal = async (err: unknown): Promise<string> => {
	const scripts = await import("$lib/server/pipelines/entities/scripts")
	if (
		err instanceof scripts.ScriptNotFoundError ||
		err instanceof scripts.ScriptNotUsableError
	)
		return (err as Error).message
	console.error("[pipelines] script mutation failed:", err)
	return "That change could not be saved. The server log has the details."
}

async function scriptsAnswer(
	emitToUser: any,
	event: string
): Promise<{ scripts: Sockets.Pipelines.Scripts.Response }> {
	const { scriptsView } = await import(
		"$lib/server/pipelines/entities/scripts"
	)
	const scripts = (await scriptsView(
		db
	)) as Sockets.Pipelines.Scripts.Response
	const res = { scripts }
	emitToUser(event, res)
	return res
}

export const pipelinesScripts: Handler<
	Sockets.Pipelines.Scripts.Params,
	Sockets.Pipelines.Scripts.Response
> = {
	event: "pipelines:scripts",
	handler: async (socket, _params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:scripts:error", gate)
			return { error: gate.error }
		}
		const { scriptsView } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const res = (await scriptsView(
			db
		)) as Sockets.Pipelines.Scripts.Response
		emitToUser("pipelines:scripts", res)
		return res
	}
}

export const pipelinesCreateScript: Handler<
	Sockets.Pipelines.ScriptWrite.CreateParams,
	Sockets.Pipelines.ScriptWrite.Response
> = {
	event: "pipelines:createScript",
	handler: async (socket, params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:createScript:error", gate)
			return { error: gate.error }
		}
		try {
			const { createScript } = await import(
				"$lib/server/pipelines/entities/scripts"
			)
			await createScript(db, {
				typeId: params.typeId,
				...(params.name ? { name: params.name } : {})
			})
		} catch (err) {
			const res = { error: await scriptsRefusal(err) }
			emitToUser("pipelines:createScript:error", res)
			return res
		}
		return await scriptsAnswer(emitToUser, "pipelines:createScript")
	}
}

export const pipelinesCloneScript: Handler<
	Sockets.Pipelines.ScriptWrite.CloneParams,
	Sockets.Pipelines.ScriptWrite.Response
> = {
	event: "pipelines:cloneScript",
	handler: async (socket, params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:cloneScript:error", gate)
			return { error: gate.error }
		}
		try {
			const { duplicateScript } = await import(
				"$lib/server/pipelines/entities/scripts"
			)
			await duplicateScript(db, params.id, params.name)
		} catch (err) {
			const res = { error: await scriptsRefusal(err) }
			emitToUser("pipelines:cloneScript:error", res)
			return res
		}
		return await scriptsAnswer(emitToUser, "pipelines:cloneScript")
	}
}

export const pipelinesUpdateScript: Handler<
	Sockets.Pipelines.ScriptWrite.UpdateParams,
	Sockets.Pipelines.ScriptWrite.Response
> = {
	event: "pipelines:updateScript",
	handler: async (socket, params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:updateScript:error", gate)
			return { error: gate.error }
		}
		try {
			const { updateScript } = await import(
				"$lib/server/pipelines/entities/scripts"
			)
			await updateScript(db, params.id, {
				...(params.name !== undefined ? { name: params.name } : {}),
				...(params.source !== undefined
					? { source: params.source }
					: {}),
				...(params.enabled !== undefined
					? { enabled: params.enabled }
					: {}),
				...(params.varsIn !== undefined
					? { varsIn: params.varsIn }
					: {}),
				...(params.varsOut !== undefined
					? { varsOut: params.varsOut }
					: {})
			})
		} catch (err) {
			const res = { error: await scriptsRefusal(err) }
			emitToUser("pipelines:updateScript:error", res)
			return res
		}
		return await scriptsAnswer(emitToUser, "pipelines:updateScript")
	}
}

export const pipelinesDeleteScript: Handler<
	Sockets.Pipelines.ScriptWrite.DeleteParams,
	Sockets.Pipelines.ScriptWrite.Response
> = {
	event: "pipelines:deleteScript",
	handler: async (socket, params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:deleteScript:error", gate)
			return { error: gate.error }
		}
		try {
			const { deleteScript } = await import(
				"$lib/server/pipelines/entities/scripts"
			)
			await deleteScript(db, params.id)
		} catch (err) {
			const res = { error: await scriptsRefusal(err) }
			emitToUser("pipelines:deleteScript:error", res)
			return res
		}
		return await scriptsAnswer(emitToUser, "pipelines:deleteScript")
	}
}

export const pipelinesExportScripts: Handler<
	Sockets.Pipelines.ScriptShare.ExportParams,
	Sockets.Pipelines.ScriptShare.ExportResponse
> = {
	event: "pipelines:exportScripts",
	handler: async (socket, params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:exportScripts:error", gate)
			return { error: gate.error }
		}
		try {
			const { exportScriptArtifact } = await import(
				"$lib/server/pipelines/entities/scripts"
			)
			const artifact = await exportScriptArtifact(db, params.ids)
			// One script keeps its own name on the file; a pack is a pack.
			const base =
				artifact.scripts.length === 1
					? artifact.scripts[0]!.name.replace(
							/[^a-z0-9]/gi,
							"_"
						).toLowerCase()
					: `scripts-pack-${artifact.scripts.length}`
			const res = {
				blob: Buffer.from(JSON.stringify(artifact, null, "\t")),
				filename: `${base}.scripts.json`
			}
			emitToUser("pipelines:exportScripts", res)
			return res
		} catch (err) {
			const res = { error: await scriptsRefusal(err) }
			emitToUser("pipelines:exportScripts:error", res)
			return res
		}
	}
}

export const pipelinesImportScripts: Handler<
	Sockets.Pipelines.ScriptShare.ImportParams,
	Sockets.Pipelines.ScriptShare.ImportResponse
> = {
	event: "pipelines:importScripts",
	handler: async (socket, params, emitToUser) => {
		const gate = await libraryGate(socket)
		if (!gate.ok) {
			emitToUser("pipelines:importScripts:error", gate)
			return { error: gate.error }
		}
		try {
			const { parseScriptArtifact, importScriptArtifact, scriptsView } =
				await import("$lib/server/pipelines/entities/scripts")
			const artifact = parseScriptArtifact(params.artifact)
			const report = await importScriptArtifact(
				db,
				artifact,
				params.accept
			)
			const scripts = (await scriptsView(
				db
			)) as Sockets.Pipelines.Scripts.Response
			const res = { report, scripts }
			emitToUser("pipelines:importScripts", res)
			return res
		} catch (err) {
			const res = { error: await scriptsRefusal(err) }
			emitToUser("pipelines:importScripts:error", res)
			return res
		}
	}
}

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

		/**
		 * The active version's shape, for the map.
		 *
		 * Read here rather than derived on the client, because the wiring is
		 * rows: `pipeline_edges` says what feeds what, and the block columns on
		 * `pipeline_nodes` say which of them run together and how. A client
		 * that inferred concurrency from `position` would draw a straight line
		 * through four queries that actually fan out.
		 */
		if (spec.activeVersionId) {
			const nodes = await db
				.select()
				.from(schema.pipelineNodes)
				.where(
					eq(schema.pipelineNodes.specVersionId, spec.activeVersionId)
				)
				.orderBy(asc(schema.pipelineNodes.position))

			const byId = new Map(
				(nodes as any[]).map((n) => [n.id, n.nodeKey as string])
			)

			/**
			 * What each node type calls itself, from the registry row.
			 *
			 * ⚠ The label was `humanizeTypeId(n.typeId)` — `core:query/
			 * relationships-perspectives@1` becomes "Relationships
			 * perspectives" — which is a reasonable *fallback* and was being
			 * used as the answer. The registry row carries `i18n`, written
			 * from the declaration precisely so a name can be a name, and the
			 * builder was inventing one beside it: `core:query/
			 * graph-context@1` rendered as "Graph context" while its
			 * declaration said "Graph relationships", and nothing anywhere
			 * showed the second.
			 *
			 * Read from the row and not from the descriptor, because a
			 * `transport: 'process'` plugin type has no descriptor in this
			 * process — which is the whole reason the column exists (F6).
			 */
			const registryRows = await db
				.select({
					typeId: schema.pipelineTypeRegistry.typeId,
					version: schema.pipelineTypeRegistry.version,
					i18n: schema.pipelineTypeRegistry.i18n
				})
				.from(schema.pipelineTypeRegistry)
			// Keyed both ways. The registry splits `type_id` and `version` into
			// two columns while `pipeline_nodes.type_id` carries the pinned
			// form with `@N` on it, and a lookup that guessed one of the two
			// silently fell through to the humanized fallback — which looks
			// exactly like a type that declared no name.
			const typeNames = new Map<string, string>()
			for (const r of registryRows as any[]) {
				const name = i18nText(r.i18n?.name)
				if (!name) continue
				typeNames.set(`${r.typeId}@${r.version}`, name)
				if (!typeNames.has(r.typeId)) typeNames.set(r.typeId, name)
			}

			// Which node each `ConfigStep` belongs to, from the panel's own
			// declarations rather than a second copy of its indexing: steps are
			// `s${i}` over configurable nodes in position order, so re-deriving
			// that here would be a rule in two places waiting to disagree.
			const decls = await declarations(db, spec.activeVersionId)
			const configurable: string[] = []
			for (const d of decls)
				if (!configurable.includes(d.nodeKey))
					configurable.push(d.nodeKey)
			const stepKeyOf = new Map(
				configurable.map((nodeKey, i) => [nodeKey, `s${i}`])
			)

			const edges = await db
				.select()
				.from(schema.pipelineEdges)
				.where(
					eq(schema.pipelineEdges.specVersionId, spec.activeVersionId)
				)

			const blockRows = await db
				.select()
				.from(schema.pipelineBlocks)
				.where(
					eq(
						schema.pipelineBlocks.specVersionId,
						spec.activeVersionId
					)
				)

			res.spec!.graph = {
				blocks: (blockRows as any[]).map((b) => ({
					id: b.blockId,
					kind: b.kind,
					mode: b.mode ?? null,
					max: b.max ?? null,
					// `overRef` is a stored data reference — `{ __ref, node, port }`.
					// The port is the readable half and the only half a label
					// needs; naming the node would leak topology into a string
					// the sidebar could one day reuse.
					over:
						b.overRef && typeof b.overRef === "object"
							? ((b.overRef as any).port ?? null)
							: null,
					// Nesting and the renderable halves of loop/route
					// (22 §3): the port names label the constructs — "repeats
					// while hasToolCalls", "routes on call" — and the routes
					// table lets each branch show its predicate. Ports only,
					// like `over`: the node half of a reference stays server-
					// side (05 §0a discipline, kept even where this surface
					// may name topology).
					parentBlockId: b.parentBlockId ?? null,
					repeatWhile:
						b.repeatWhile && typeof b.repeatWhile === "object"
							? ((b.repeatWhile as any).port ?? null)
							: null,
					on:
						b.onRef && typeof b.onRef === "object"
							? ((b.onRef as any).port ?? null)
							: null,
					routes:
						b.routes && typeof b.routes === "object"
							? (b.routes as Record<string, any>)
							: null,
					// Blocks are addressed by their id in the same key space as
					// nodes, so the panel's own indexing already gave this one a
					// step — it just had nothing pointing at it.
					stepKey: stepKeyOf.get(b.blockId) ?? null
				})),
				nodes: (nodes as any[]).map((n) => ({
					key: n.nodeKey,
					label: typeNames.get(n.typeId) ?? humanizeTypeId(n.typeId),
					kind: n.kind,
					typeId: n.typeId,
					blockId: n.blockId ?? null,
					blockKind: n.blockKind ?? null,
					blockChain: n.blockChain ?? null,
					position: n.position,
					toggleable: !!n.toggleable,
					enabledDefault: !!n.enabledDefault,
					stepKey: stepKeyOf.get(n.nodeKey) ?? null
				})),
				// A node id that is not in this version resolves to nothing
				// rather than to some other version's key — the edge is simply
				// not drawable, which is the honest outcome.
				edges: (edges as any[])
					.map((e) => ({
						from: e.fromNodeId
							? (byId.get(e.fromNodeId) ?? null)
							: null,
						fromBlock: e.fromNodeId
							? null
							: (e.fromBlockId ?? null),
						fromPort: e.fromPort,
						to: byId.get(e.toNodeId) ?? null
					}))
					.filter((e) => e.to !== null) as Array<{
					from: string | null
					fromBlock: string | null
					fromPort: string
					to: string
				}>
			}
		}

		emitToUser("pipelines:detail", res)
		return res
	}
}

/**
 * What each of these runs left behind, keyed by run.
 *
 * Projected as `{kind, entityId, action}` and nothing more. `node_key` is a
 * pipeline-internal name and `seq` is already the array order, so neither
 * earns a place in a payload a session panel reads.
 */
async function artifactsByRun(
	runIds: number[]
): Promise<
	Map<number, Sockets.Pipelines.Runs.Response["runs"][number]["artifacts"]>
> {
	const byRun = new Map<
		number,
		Sockets.Pipelines.Runs.Response["runs"][number]["artifacts"]
	>()
	if (!runIds.length) return byRun

	const rows = await db
		.select()
		.from(schema.pipelineRunArtifacts)
		.where(inArray(schema.pipelineRunArtifacts.runId, runIds))
		.orderBy(
			asc(schema.pipelineRunArtifacts.runId),
			asc(schema.pipelineRunArtifacts.seq)
		)
	for (const row of rows as any[]) {
		const list = byRun.get(row.runId) ?? []
		list.push({
			kind: row.kind,
			entityId: row.entityId,
			action: row.action
		})
		byRun.set(row.runId, list)
	}
	return byRun
}

/**
 * Recent runs — the honest answer to "did that use the new path".
 *
 * Scoped to sessions the asker can reach — owner **or** guest, via
 * `checkSessionAccess` — and, on top of that and independently of it, to their
 * own runs. A run receipt records what a pipeline decided about somebody's
 * conversation; it is not instance trivia an admin browses by default.
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
		if (params.sessionId != null) {
			// Reaching the session is owner-OR-guest, decided in the one place
			// that decides it. The `user_id` clause below is the separate gate
			// and the one that keeps this honest: a guest passes the first and
			// still reads only their own receipts, never the owner's.
			const access = await checkSessionAccess(params.sessionId, userId)
			if (!access.hasAccess) {
				const res = { runs: [] }
				emitToUser("pipelines:runs", res)
				return res
			}
			where = and(
				eq(schema.pipelineRuns.sessionId, params.sessionId),
				eq(schema.pipelineRuns.userId, userId)
			)!
		}

		const rows = await db
			.select()
			.from(schema.pipelineRuns)
			.where(where)
			.orderBy(desc(schema.pipelineRuns.id))
			.limit(limit)

		// One query for the whole page rather than one per row: a run's output
		// is a handful of rows, and `limit` is capped at 100 above.
		const artifacts = await artifactsByRun(rows.map((r: any) => r.id))

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
				artifacts: artifacts.get(r.id) ?? [],
				sessionId: r.sessionId,
				startedAt: new Date(r.startedAt).toISOString()
			}))
		}
		emitToUser("pipelines:runs", res)
		return res
	}
}

/**
 * One run's full receipt (22 §3) — the node-by-node record the summary row
 * compresses: per-node outcomes, timings, tokens, script applications, halt
 * reasons. Gated the same way the list is: your runs, nobody else's. The
 * receipt names node keys, which the admin surface may (05 §0a binds the
 * sidebar, not this page).
 */
export const pipelinesRun: Handler<
	Sockets.Pipelines.Run.Params,
	Sockets.Pipelines.Run.Response
> = {
	event: "pipelines:run",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const [r] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(
				and(
					eq(schema.pipelineRuns.runId, params.runId),
					eq(schema.pipelineRuns.userId, userId)
				)
			)
			.limit(1)
		if (!r) {
			const res = { error: "No such run." }
			emitToUser("pipelines:run:error", res)
			return res
		}
		const res: Sockets.Pipelines.Run.Response = {
			run: {
				id: (r as any).id,
				runId: (r as any).runId,
				specSlug: (r as any).specSlug,
				outcome: (r as any).outcome,
				haltNodeKey: (r as any).haltNodeKey,
				haltReason: (r as any).haltReason,
				elapsedMs: (r as any).elapsedMs,
				tokensSpent: (r as any).tokensSpent,
				isPreview: (r as any).isPreview,
				artifacts:
					(await artifactsByRun([(r as any).id])).get(
						(r as any).id
					) ?? [],
				// So the panel reading this receipt can ask what has fired
				// across the whole session, not just this turn.
				sessionId: (r as any).sessionId ?? null,
				startedAt: new Date((r as any).startedAt).toISOString(),
				receipt: ((r as any).receipt ?? {}) as Record<string, unknown>
			}
		}
		emitToUser("pipelines:run", res)
		return res
	}
}

/* ------------------------------------------------------------------ *
 * Retrieval, explained — design §9, plan Part 6
 *
 * The "why" trail has been computed on every turn since the decomposition
 * landed and rendered nowhere: `keywordQuery.skipped[]` with a sentence per
 * declined entry, each mechanism's `diagnostics`, `merge`'s `foundBy`, and `select`'s
 * `Decision` across eleven reasons. All of it reaches the receipt — the
 * executor records every node's published output — and the receipt's only
 * reader was a `<pre>` of raw JSON.
 *
 * This projects it. Three rules from plan Part 6, and they are the reason this
 * is not simply the receipt with nicer fonts:
 *
 * 1. **Anchored to the result, not a panel of numbers.** One row per candidate,
 *    carrying a medal and a sentence; the numbers are the second level.
 * 2. **Content vocabulary first.** "matched 2 of its 3 keys (ashguard, gate)"
 *    rather than "keyword 0.667" — which is why the entry rows are read here
 *    and their keys travel with the row.
 * 3. **Every explanation carries an action.** `constant` is "always include"
 *    and `enabled` is "never include"; both are real columns with real editors,
 *    so `entry` carries their current values and the panel writes through
 *    `entries:update`. The plan's third action — *this is wrong* — has no
 *    backing field anywhere and is **not** invented here; it is recorded as an
 *    open question in design §12.
 *
 * Projected server-side rather than read out of the raw receipt by the panel,
 * for the reason stated at the top of this file: the receipt is an internal
 * record whose shape grows, and a client walking it would be a second copy of
 * what a decision means.
 * ------------------------------------------------------------------ */

/** The entry behind a row, as this projection needs it. */
interface RetrievalEntryFacts {
	id: number
	typeId: string
	title: string | null
	keys: string[]
	constant: boolean
	enabled: boolean
	/**
	 * What it says **now** — `entrySourceHash` over the live row, to compare
	 * against the one the run recorded. See `RetrievalRow.provenance`.
	 */
	fingerprint: string
}

/** The budget groups' front-door names (plan Part 6, rule 1). */
const RETRIEVAL_SOURCE_LABELS: Record<string, string> = {
	worldLore: "World lore",
	characterLore: "Character lore",
	history: "History",
	messages: "Messages",
	relationships: "Relationships"
}
const retrievalSourceLabel = (source: string) =>
	RETRIEVAL_SOURCE_LABELS[source] ?? source

/**
 * The index vocabulary's three spellings, folded onto the budget groups.
 *
 * ⚠ A **display-side** fold, and knowingly the third statement of a
 * reconciliation that already exists twice — `BUDGET_GROUP_ALIASES` at the
 * entry to `rank-hybrid` and `VECTOR_SOURCE_ALIASES` in the vector mechanism, which
 * answer two different questions and are documented not to merge. This one
 * answers a third: *which row on screen is this receipt line about*. The vector
 * mechanism's `skipped[]` records `historyEntry` while the ranker's decisions record
 * `history`, so without it one entry renders as two rows, one of them nameless.
 * It reconciles nothing else and must not grow to.
 */
const RETRIEVAL_SOURCE_ALIASES: Record<string, string> = {
	message: "messages",
	historyEntry: "history",
	narrativeRelationship: "relationships"
}
const retrievalGroupOf = (source: string) =>
	RETRIEVAL_SOURCE_ALIASES[source] ?? source

/**
 * Every gather branch's front-door name, keyed the way `nodeKey` spells it
 * (`gather.<branch>.read`) rather than the way the budget groups do.
 *
 * A separate table from `RETRIEVAL_SOURCE_LABELS` on purpose: `historyEntries`,
 * `entities`, `cast`, `relationshipsPerspectives` and `relationshipsKnown` are
 * index-side gather branches with no budget group of their own (respond.ts 1.9.0,
 * 1.10.0), so folding them into that map would either invent a budget group
 * that does not exist or collide with `RETRIEVAL_SOURCE_ALIASES`'s own fold.
 * This one answers a narrower question — *what does a person call this scan*
 * — for the one place that needs it: naming a mechanism-level note when the node's
 * own output has nothing for `nodeSource` to read.
 */
const GATHER_BRANCH_LABELS: Record<string, string> = {
	history: "History",
	worldLore: "World lore",
	characterLore: "Character lore",
	historyEntries: "History entries",
	entities: "Entities",
	cast: "Cast",
	relationshipsPerspectives: "Relationship perspectives",
	relationshipsKnown: "Known relationships"
}

/**
 * A gather node's own name, read from its key rather than from a candidate it
 * never produced.
 *
 * `nodeSource` names a mechanism from its own hits/main/skipped — the entry
 * vocabulary a reader already knows — but an empty scan offers it nothing to
 * read, and the note still has to say whose scan it is. `nodeKey` is topology
 * (05 §0a) and unfit to print as-is: `gather.characterLore.read` is an
 * address, not a sentence. This pulls the branch out of it and looks the branch
 * up above; a branch this does not know — a future one, or a plugin's — is
 * humanized rather than shown as a raw dotted path.
 */
function retrievalNodeLabel(nodeKey: string): string {
	const branch = /^gather\.([^.]+)\.read$/.exec(nodeKey)?.[1]
	if (branch) return GATHER_BRANCH_LABELS[branch] ?? humanizeCamel(branch)
	return humanizeCamel(nodeKey.split(".").pop() || nodeKey)
}

/**
 * The order criteria are read in — most directly answering "why is this here"
 * first.
 *
 * Fixed rather than sorted by contribution, and the type's `value` field says
 * why: the weights that would rank them are not on the receipt in a shape this
 * surface can read without duplicating `bindings.ts`'s private fold.
 *
 * ⚠ **This list is the filter, not a preference.** The loop below reads only
 * what is named here, so a signal the engine computes and `score()` weights and
 * this array omits is rendered *nowhere* — `retrievalCriterion`'s `default:`
 * branch cannot be reached to catch it. `proximity` and `semantic` were both in
 * that state: `keywordQuery` computes proximity on every scan, the vector
 * mechanism writes `signals.semantic` on every hit, `signalProximity` and
 * `signalSemantic` are declared, writable and read — and an entry that owed its
 * place to either got no line saying so. **A signal added to `SignalWeights`
 * belongs here in the same change.**
 */
const RETRIEVAL_CRITERION_ORDER = [
	"keyword",
	// Beside `keyword` because it qualifies that match rather than standing
	// beside it: proximity is 0 unless two of an entry's keys matched exactly,
	// so it never explains a placement on its own.
	"proximity",
	"entityCooccurrence",
	"nameMatch",
	"entityVector",
	"semantic",
	"tfidf",
	"lastRefRecency",
	// ⚠ `recency` and `sceneAffinity` were between these two and are gone with
	// the weights they explained — neither had a producer, so neither could
	// ever have rendered a line here. `density` stays and now can: the scan
	// writes it on every candidate.
	"density"
] as const

const num = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) ? v : undefined

/**
 * A dated heading, for the one declared type with no title role.
 *
 * History is *dated* rather than named — `entryInsert` stores `title: null` for
 * it because the declaration carries no `title` role — so a panel that fell
 * back to `#12` would name the one shape a reader most needs to recognise
 * worst. This is the heading `HistoryEntryManager` already writes, character
 * for character: the front door's name, not a second one invented here.
 */
function datedTitle(fields: unknown): string | null {
	const f = (fields ?? {}) as Record<string, unknown>
	const year = num(f.year)
	if (year === undefined) return null
	const month = num(f.month)
	const day = num(f.day)
	return (
		`Year ${year}` +
		(month ? `, Mo. ${month}` : "") +
		(day ? `, Day ${day}` : "")
	)
}

/** A short, single-line taste of what the block actually says. */
function retrievalExcerpt(content: unknown): string | undefined {
	if (typeof content !== "string") return undefined
	const flat = content.replace(/\s+/g, " ").trim()
	if (!flat) return undefined
	return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat
}

/** One signal, named and said in words. Returns null for a signal that did not fire. */
function retrievalCriterion(
	signal: string,
	value: number,
	source: string,
	entry: RetrievalEntryFacts | undefined,
	payload: Record<string, unknown>
): Sockets.Pipelines.RetrievalCriterion | null {
	if (!(value > 0)) return null
	const pct = `${Math.round(value * 100)}%`
	switch (signal) {
		case "keyword": {
			const keys = entry?.keys ?? []
			if (!keys.length)
				return {
					label: "Its keys",
					detail: `${pct} of its keys matched the scanned messages`,
					value
				}
			const total = keys.length
			const hit = Math.max(1, Math.min(total, Math.round(value * total)))
			const list =
				keys.length > 6
					? `${keys.slice(0, 6).join(", ")}, …`
					: keys.join(", ")
			return {
				label: "Its keys",
				detail:
					total === 1
						? `matched “${keys[0]}” in the scanned messages`
						: hit === total
							? `matched all ${total} of its keys (${list})`
							: `matched ${hit} of its ${total} keys (${list})`,
				value
			}
		}
		case "proximity":
			// `keywordMatch` measures the smallest gap between two exactly
			// matched keys, `exp(-gap / 120)` — so this is only ever true of an
			// entry whose keys fired more than once, and the sentence says the
			// thing that happened rather than naming the curve.
			return {
				label: "Its keywords, close together",
				detail:
					"two or more of its keywords matched near each other rather than scattered across the scanned messages",
				value
			}
		case "nameMatch":
			return {
				label: "Its title, in the conversation",
				detail: "the title appears in the scanned messages",
				value
			}
		case "entityCooccurrence":
			// Two different questions under one name, split by source exactly
			// as `signals.ts` splits them: world lore asks whether the ENTRY
			// names a cast member, character lore whether its own character
			// spoke. One label for both would describe one of them wrongly.
			return source === "characterLore"
				? {
						label: "Its character, in the scene",
						detail: "the character it belongs to spoke recently",
						value
					}
				: {
						label: "Names it shares with the scene",
						detail: "it names someone who is in this session",
						value
					}
		case "entityVector": {
			// The fourth mechanism's own line (`entityLink.ts`): a conversational
			// mention — "the captain" — linked to one of the entry's names —
			// "Captain Vell" — by meaning, not by text. `linkNote` already
			// wrote that sentence for the payload; repeating it here rather
			// than re-deriving it keeps the receipt and this row saying the
			// same thing about the same link.
			const links = Array.isArray(payload.entityLinks)
				? (payload.entityLinks as unknown[]).filter(
						(l): l is string => typeof l === "string"
					)
				: []
			return {
				label: "A name it's called by, in the scene",
				detail: links[0] ?? "a mention was linked to one of its names",
				value
			}
		}
		case "semantic":
			// The vector mechanism's cosine, which `bindings.ts` writes onto
			// `signals.semantic` rather than onto `presetScore` — so the
			// "Similarity to the conversation" line further down, which reads
			// `presetScore`, never fires for it. Two surfaces, one mechanism;
			// this is the one the shipped reply pipeline reaches.
			return {
				label: "Similar in meaning",
				detail:
					"it is about what the conversation is about, without needing a word in common",
				value
			}
		case "tfidf":
			return {
				label: "Uncommon words in common",
				detail: "wording the rest of the lorebook does not share",
				value
			}
		case "lastRefRecency":
			return {
				label: "Last referred to",
				detail: "came up recently in the conversation",
				value
			}
		case "density":
			return {
				label: "Longer than most entries",
				// Not "how much it says per token", which is what this said
				// while nothing produced it: the number is length against the
				// pool's mean, capped at 1, so a full mark means "at or above
				// average length" and not "dense".
				detail: `${value.toFixed(2)} of the average entry length`,
				value
			}
		default:
			return { label: signal, detail: value.toFixed(3), value }
	}
}

/** `["arm0#3","arm1#1"]` → the ranks each mechanism gave it. */
function fusionRanks(foundBy: unknown): number[] {
	if (!Array.isArray(foundBy)) return []
	return foundBy
		.map((f) =>
			typeof f === "string" ? Number(/#(\d+)$/.exec(f)?.[1]) : NaN
		)
		.filter((n) => Number.isFinite(n))
}

const ordinal = (n: number) => {
	const suffix =
		n % 100 >= 11 && n % 100 <= 13
			? "th"
			: n % 10 === 1
				? "st"
				: n % 10 === 2
					? "nd"
					: n % 10 === 3
						? "rd"
						: "th"
	return `${n}${suffix}`
}

/**
 * How a candidate got here — the medal, and the one thing read before anything
 * else on the row.
 */
function retrievalMarker(
	candidate: any,
	reason: string | undefined
): { marker: string; markerKind: Sockets.Pipelines.RetrievalRow["markerKind"] } {
	const foundBy = candidate?.payload?.foundBy
	if (candidate?.pinned || reason === "reserved" || reason?.startsWith("excluded_pinned"))
		return { marker: "Always include", markerKind: "pinned" }
	if (reason === "reserved_minimum")
		return { marker: "Kept by a floor", markerKind: "floor" }
	if (foundBy === "entity-search")
		return { marker: "Shared entity", markerKind: "entity" }
	if (fusionRanks(foundBy).length > 1)
		return { marker: "Both arms", markerKind: "semantic" }
	if (num(candidate?.signals?.keyword))
		return { marker: "Keyword", markerKind: "keyword" }
	// ⚠ `signals.semantic` as well as `presetScore`, and the second is the one
	// the shipped pipeline cannot produce. `core:query/vector-search@1` writes
	// its cosine to `signals.semantic` and deliberately stamps no `presetScore`
	// — a score there would make every signal weight inert — so a candidate
	// only the vector mechanism found reached the `No signal` fall-through and
	// this panel told a reader the opposite of what happened.
	if (
		num(candidate?.presetScore) !== undefined ||
		num(candidate?.signals?.semantic)
	)
		return { marker: "Similarity", markerKind: "semantic" }
	if (
		num(candidate?.signals?.nameMatch) ||
		num(candidate?.signals?.entityCooccurrence)
	)
		return { marker: "Named in the scene", markerKind: "keyword" }
	return { marker: "No signal", markerKind: "none" }
}

/**
 * The one sentence a reader gets before deciding whether to open the row.
 *
 * Written from `select`'s reason rather than from its `why`: the `why` carries
 * the arithmetic and belongs to level two, and eleven reasons is eleven
 * different controls to point at. `excluded_pinned_*` deliberately says both
 * halves — an entry marked always-include that is missing is the case somebody
 * arrives already hunting for a setting that overrode it, and neither half
 * alone explains it (`select.ts`'s own note).
 */
function retrievalVerdict(
	reason: string | undefined,
	source: string,
	label: string,
	cap: number | undefined,
	lead: string | undefined
): string {
	switch (reason) {
		case "reserved":
			return "Always included — it is marked constant, so retrieval is bypassed for it."
		case "reserved_minimum":
			return `Kept because ${label} had not met its minimum number of entries yet.`
		case "filled_scored":
			return lead ? `Included — ${lead}.` : "Included on score."
		case "filled_zero_score":
			return `Included — no signal matched it, and ${label} still had room.`
		case "excluded_budget":
			return cap
				? `Left out — ${label} was already holding its maximum of ${cap} entries.`
				: `Left out — ${label} was already at its maximum number of entries.`
		case "excluded_token_limit":
			return `Left out — the room for ${label} ran out before it.`
		case "excluded_share_cap":
			return `Left out — ${label} had already spent its whole share, and nothing was spare.`
		case "excluded_group_disabled":
			return `Left out — ${label} is switched off: its share is zero.`
		case "excluded_unknown_source":
			return `Left out — nothing budgets for “${source}”, so it had nothing to compete in.`
		// ⚠ Not a budget sentence, and the one exclusion here that no budget
		// control can undo — see `select.ts`'s note on the reason. The rule's
		// own words are in `why`, which is level two; this line has to say
		// enough that a reader does not go looking for the share that dropped
		// it, because there is not one.
		case "excluded_ineligible":
			return "Left out — a rule excluded it, so it never competed for space."
		case "excluded_pinned_token_limit":
			return "Marked always-include, and still left out: it does not fit the context window."
		case "excluded_pinned_group_disabled":
			return `Marked always-include, and still left out: ${label} has a share of zero.`
		default:
			return lead ? `Included — ${lead}.` : "Included."
	}
}

/** Which source a node was working on, when its own output says. */
function nodeSource(output: any): string | undefined {
	const first =
		(Array.isArray(output?.hits) && output.hits[0]) ||
		(Array.isArray(output?.main) && output.main[0]) ||
		(Array.isArray(output?.skipped) && output.skipped[0])
	const source = first?.source
	return typeof source === "string" ? retrievalGroupOf(source) : undefined
}

/**
 * Whether this type's heading is a column the fingerprint covers.
 *
 * ⚠ **The one thing `entrySourceHash` cannot see.** It hashes `title`, `keys`
 * and `content`, which is the annotation lane's definition of an entry's
 * content and is deliberately shared with it. History declares **no `title`
 * role** — it is not named, it is *dated* — so its heading comes out of
 * `fields`, its date feeds the recency signals, and an edited year is therefore
 * an edit that changed the outcome and moved no hash.
 *
 * Saying `unchanged` over that would be worse than saying nothing: it is this
 * surface newly *asserting* a pairing it did not verify, which is the whole
 * defect wearing the fix's clothes. So a type whose heading the hash does not
 * cover can be reported `changed` and `deleted` — both are positive findings
 * this can still make — and never `unchanged` on the hash alone.
 *
 * Read off the declaration rather than by testing for history, so a future type
 * that declares no title is unverifiable here the day it is declared instead of
 * the day somebody remembers this function exists.
 */
const headingIsHashed = (typeId: string): boolean =>
	!!entryDeclaration(typeId)?.roles.title

/**
 * What the run recorded about this candidate, against what the entry says now.
 *
 * The three states of `RetrievalRow.provenance`, and the fourth thing that is
 * not a state: silence. Absence of a recorded fingerprint is the ordinary case
 * for every receipt written before this existed and for any mechanism that does not
 * carry one, and the honest answer there is to say nothing — the panel then
 * renders exactly what it rendered before, which was never *wrong*, only
 * unverified.
 *
 * ⚠ `deleted` is claimed only when the lorebook was read. An unreadable run —
 * no session, a deleted one, a lorebook the asker no longer owns — produces the
 * same empty map as a lorebook that really has lost every entry, and guessing
 * would turn "I could not look" into "your lore is gone" on every row at once.
 */
function retrievalProvenance(
	recorded: string | undefined,
	entry: RetrievalEntryFacts | undefined,
	entriesRead: boolean,
	/**
	 * The row's heading as the run recorded it, and as it reads now — the
	 * second half of the comparison, for the part of an entry the hash does
	 * not reach. A skipped row has no recorded heading to offer.
	 */
	headings: { recorded: string; live: string } = { recorded: "", live: "" }
): Pick<Sockets.Pipelines.RetrievalRow, "provenance" | "provenanceNote"> {
	if (!recorded) return {}
	if (entry) {
		const changed = {
			provenance: "changed",
			provenanceNote:
				"This entry has been edited since the run — what it says " +
				"now is not what was scored below."
		} as const
		if (entry.fingerprint !== recorded) return changed
		// The hash matched. A heading that moved anyway is history's date —
		// scored by recency, carried in `fields`, and invisible to a hash over
		// the three text columns. Both values are already on this row, so
		// noticing costs a comparison rather than a second hash.
		if (
			headings.recorded &&
			headings.live &&
			headings.recorded !== headings.live
		)
			return changed
		// Verified when the hash covers the heading, or when the recorded
		// heading is here and agrees. Otherwise the text is verified and the
		// heading is not, and the honest report of that is silence.
		return headingIsHashed(entry.typeId) ||
			(headings.recorded && headings.recorded === headings.live)
			? { provenance: "unchanged" }
			: {}
	}
	if (!entriesRead) return {}
	return {
		provenance: "deleted",
		// "No longer in this session's lorebook" rather than "deleted",
		// because both a removed entry and a session pointed at a different
		// lorebook arrive here and only one of them was deleted. The sentence
		// is true of both; the stronger one would be a guess.
		provenanceNote:
			"This entry is no longer in this session's lorebook — the decision " +
			"below is all that remains of it."
	}
}

/* ------------------------------------------------------------------ *
 * What is eating the budget — T1
 *
 * The per-item token counts have been on every receipt since the ranker
 * published its decisions whole, and the bands have carried the ranker's own
 * per-group sums beside them. Nothing added either up into a *statement*: a
 * reader asking "what is taking all the room" got four numeric columns behind
 * a disclosure toggle and a division to do in their head.
 *
 * That is the same failure the rows above exist to fix, one level up. The
 * arithmetic was present; the finding was not. So this says the finding first
 * — "World lore is taking most of the retrieved context" — and lets the
 * figure follow it.
 *
 * ⚠ **A share of the RETRIEVED context, never of "the prompt".** The bands
 * budget what retrieval put in; the system prompt, the persona, the
 * instructions and the reply itself sit outside every one of them. "60% of
 * your prompt" would be a larger claim than the receipt can support and the
 * kind of number a person would then go and act on.
 * ------------------------------------------------------------------ */

/**
 * Fill in the bands' shares and say what they add up to.
 *
 * Mutates the bands it is given — `share` is the same arithmetic as the
 * headline over the same totals, and computing it twice is how the sentence
 * and the table start disagreeing about which source is the big one.
 *
 * `spent` is the sum of the per-item token counts, deduplicated by entry: two
 * gather branches can both include the same row, and it occupies the prompt
 * once. It is used to *fill* a band the ranker recorded no usage for, never to
 * overrule one it did — `select`'s own ledger is the authority on its own
 * arithmetic, and this is the reading of it that survives a receipt whose
 * ranker published decisions without groups.
 */
function retrievalBudget(
	bands: Sockets.Pipelines.RetrievalBand[],
	spent: Map<string, number>,
	entryCounts: Map<string, number>,
	/** Assemble's own ceiling, when the run reached assembly. */
	ceiling: { total?: number; remaining?: number }
): Sockets.Pipelines.RetrievalBudget | undefined {
	// A source that spent tokens and has no band is not a rounding error: it
	// would silently shrink the denominator every share is stated against, so
	// the sentence would name the wrong leader. Reported as a band with no
	// allocation, which is what it is.
	for (const [source, tokens] of spent)
		if (tokens > 0 && !bands.some((b) => b.source === source))
			bands.push({
				source,
				label: retrievalSourceLabel(source),
				allocated: 0,
				used: 0,
				entries: entryCounts.get(source) ?? 0,
				cap: 0,
				dropped: 0
			})
	for (const b of bands) if (!b.used) b.used = spent.get(b.source) ?? 0

	// No bands and nothing spent: the run recorded no budget at all. Silence,
	// for the reason `ranked` exists — an empty breakdown reads as "nothing
	// came in" when the truth is "nothing was written down".
	if (!bands.length) return undefined
	const used = bands.reduce((sum, b) => sum + b.used, 0)
	// Left undefined rather than set to 0 when nothing was spent: a share of
	// nothing is a division that did not happen, and a column of "0%" is this
	// surface asserting it did.
	if (used > 0) for (const b of bands) b.share = b.used / used

	const total = ceiling.total
	const detail =
		total !== undefined && total > 0
			? `The retrieved context filled ${used} of the ${total} tokens set ` +
				`aside for it, leaving ${ceiling.remaining ?? Math.max(0, total - used)} spare.`
			: undefined

	if (!used)
		return {
			headline:
				"Nothing retrieved reached this prompt, so no source is using any of its room.",
			used: 0,
			...(total !== undefined ? { total } : {}),
			...(total !== undefined
				? { remaining: ceiling.remaining ?? total }
				: {}),
			...(detail ? { detail } : {})
		}

	const spending = bands.filter((b) => b.used > 0).sort((a, b) => b.used - a.used)
	const lead = spending[0]
	const pct = Math.round((lead.used / used) * 100)
	const headline =
		spending.length === 1
			? `${lead.label} is the only thing retrieval put in this prompt — ${lead.used} tokens.`
			: `${lead.label} is taking ${pct >= 50 ? "most" : "the largest share"} of ` +
				`the retrieved context — ${pct}% of its ${used} tokens.`

	return {
		headline,
		...(detail ? { detail } : {}),
		used,
		...(total !== undefined ? { total } : {}),
		...(total !== undefined
			? { remaining: ceiling.remaining ?? Math.max(0, total - used) }
			: {})
	}
}

/** Options for the projection. */
interface ExplainRetrievalOptions {
	/** How many rows the panel is willing to hold. */
	limit?: number
	/**
	 * Whether the entry map is an answer or an absence — see
	 * `retrievalProvenance`. Defaults to *not read*, so a caller that says
	 * nothing claims nothing.
	 */
	entriesRead?: boolean
}

/**
 * Turn a stored receipt into the panel's model.
 *
 * Pure, and exported for its own test: everything it needs arrives as an
 * argument, so the projection can be asserted against a hand-written receipt
 * without a database, a run, or a pipeline.
 */
export function explainRetrieval(
	receipt: any,
	entries: Map<string, RetrievalEntryFacts>,
	opts: ExplainRetrievalOptions = {}
): NonNullable<Sockets.Pipelines.RunExplain.Response["explanation"]> {
	const limit = opts.limit ?? 250
	const entriesRead = opts.entriesRead ?? false
	const nodes: any[] = Array.isArray(receipt?.nodes) ? receipt.nodes : []
	// Read up front, and off the generate node rather than out of the retrieval
	// walk below: a stop sequence is a property of the SEND, and the loop that
	// follows is about what went into the prompt.
	const stops = stopsFromReceipt(nodes)
	const rows: Sockets.Pipelines.RetrievalRow[] = []
	const notes: string[] = []
	const warnings: string[] = []
	let bands: Sockets.Pipelines.RetrievalBand[] = []
	let ranked = false
	let omitted = 0
	/**
	 * The per-item token counts, added up by band, and the entries behind them
	 * — T1's half of this projection.
	 *
	 * Deduplicated by `source:id` because two gather branches can each decide
	 * the same row and it occupies the prompt once; counting it twice would
	 * make one band look like it was eating room it never took.
	 */
	const spent = new Map<string, number>()
	const spentEntries = new Map<string, number>()
	const counted = new Set<string>()
	/** Assemble's recorded ceiling, when the run got as far as assembly. */
	let ceiling: { total?: number; remaining?: number } = {}

	// ── Mechanism-level facts ──────────────────────────────────────────────
	// The half of the trail no row can carry: how deep the scan looked, whether
	// an embedding model was there at all, what the candidate fetch could not
	// read whole. "Why did my lore not come in" is answered here as often as it
	// is answered per entry.
	const seenNotes = new Set<string>()
	const note = (line: string) => {
		if (line && !seenNotes.has(line)) {
			seenNotes.add(line)
			notes.push(line)
		}
	}
	const warn = (line: string) => {
		if (line && !warnings.includes(line)) warnings.push(line)
	}
	/**
	 * The bands that had nothing in scope, folded into one sentence at the end.
	 *
	 * ⚠ **A mechanism that had nothing to scan is not news**, and it is the
	 * same rule the rest of this projection serves — content first — turned on
	 * the notes themselves. A session with one lorebook of two entries produced
	 * nine lines and six of them said nothing: an empty band's "0 of 0 entries
	 * matched, scanning the last 10 messages" is a sentence about the
	 * *mechanism's settings* on a turn where the mechanism had no subject, and
	 * two of them buried the one line that named what actually matched.
	 *
	 * Folded rather than dropped, because "character lore was looked at and had
	 * nothing in it" is still an answer to "why is my character lore not here"
	 * — it is just not worth a line each. The lines that say *why something did
	 * not happen* (`vectorSearch`, `entityLink`, `indexing`) are emitted below
	 * regardless of scope: those are the honesty that an unavailable mechanism
	 * subtracts a signal, and they are the reason this half of the panel exists.
	 */
	const barren = new Set<string>()
	/**
	 * The scene's entity list, named once.
	 *
	 * Every gather branch records the same extraction over the same window, so
	 * a per-band line said one fact three times under three headings. It is a
	 * fact about the *window*, not about whoever was scanning it, so it is
	 * stated without a band's name in front of it — and unioned rather than
	 * taken from the first band, so a branch that scoped its own extraction
	 * still contributes what it saw.
	 */
	const sceneEntities: string[] = []
	for (const n of nodes) {
		const list = n?.output?.diagnostics?.entities
		if (!Array.isArray(list)) continue
		for (const e of list) {
			const name = String(e)
			if (name && !sceneEntities.includes(name)) sceneEntities.push(name)
		}
	}
	const sceneLine = sceneEntities.length
		? `The scene named ${sceneEntities.slice(0, 8).join(", ")}` +
			`${sceneEntities.length > 8 ? ", …" : ""}.`
		: ""

	for (const n of nodes) {
		/**
		 * The room retrieval was given, as assemble recorded it.
		 *
		 * Read off the node rather than summed from the bands: `allocated` is
		 * what each band was *dealt*, and a run that halted before assembly
		 * dealt nothing — so a ceiling derived from the bands would report
		 * every such run as exactly 100% full. The last node to publish one
		 * wins, because assemble runs after the ranker and is the node that
		 * knows what the window left over.
		 */
		const declared = n?.output?.budget
		const declaredTotal = num(declared?.total)
		if (declaredTotal !== undefined && declaredTotal > 0)
			ceiling = {
				total: declaredTotal,
				remaining: num(declared?.remaining)
			}
		const d = n?.output?.diagnostics
		if (!d || typeof d !== "object") continue
		// The source when the node's own output says, and its key otherwise.
		// A node key is topology and this surface may name it (05 §0a) — but
		// "World lore: 3 of 24 matched" is a sentence and "lore-world-2: …" is
		// an address, so the address is the fallback rather than the default.
		const source = nodeSource(n.output)
		const who = source
			? retrievalSourceLabel(source)
			: retrievalNodeLabel(n.nodeKey)
		const considered = num(d.considered)
		const matched = num(d.matched)
		/**
		 * Nothing was in this band's scope, so none of the numbers below are
		 * about anything.
		 *
		 * `matched` is read as well as `considered` because a band that somehow
		 * matched something out of an empty pool is a receipt disagreeing with
		 * itself, and the fold is the wrong way to report that: it would hide
		 * the contradiction under a sentence saying there was nothing to see.
		 */
		const nothingInScope = considered === 0 && (matched ?? 0) === 0
		if (num(d.scanDepth) !== undefined) {
			if (nothingInScope) barren.add(who)
			else
				note(
					`${who}: ${matched ?? 0} of ${considered ?? 0} entries matched, ` +
						`scanning the last ${d.scanDepth} messages` +
						(num(d.recursionDepth)
							? `, ${d.recursionDepth} level(s) of triggered entries deep`
							: "") +
						"."
				)
		}
		if (num(d.admitThreshold) && !nothingInScope) {
			// The keyless-admission gate's own line. Nothing else says an entry
			// got in without a key, which is exactly the case somebody asks
			// about (design §12.4 holds whether it wants its own reason).
			note(
				`${who}: ${num(d.admittedByEvidence) ?? 0} admitted on relevance ` +
					`alone, at a threshold of ${Number(d.admitThreshold).toFixed(2)}.`
			)
		}
		// Said once, in the flow, at the first band that saw anything — the
		// union was gathered above, and `note` makes every later band's call a
		// no-op rather than a repetition.
		if (Array.isArray(d.entities) && d.entities.length) note(sceneLine)
		if (num(d.queries) !== undefined) {
			if (nothingInScope) barren.add(who)
			else
				note(
					`${who}: ${matched ?? 0} of ${considered ?? 0} indexed rows kept ` +
						`across ${d.queries} quer${d.queries === 1 ? "y" : "ies"}.`
				)
		}
		if (typeof d.vectorSearch === "string")
			note(`Vector search: ${d.vectorSearch}.`)
		/**
		 * The entity-vector mechanism's own line, and it exists for the reason
		 * `vectorSearch` does rather than for symmetry.
		 *
		 * ⚠ A mechanism that cannot run **must say so where a person reads it.** The
		 * governing rule lets an unavailable mechanism subtract a signal, and the
		 * whole difference between *degrading* and *disappearing* is whether the
		 * receipt names it: this mechanism has three ways to produce nothing that are
		 * not failures — switched off, no embedding model, nothing described in
		 * the window — and until now every one of them looked identical to a turn
		 * where it had simply found no link. The string is the binding's
		 * (`entity-link`'s `off()` and its success line), so there is one place
		 * that decides what a mechanism's state is called.
		 *
		 * Prefixed rather than named from `nodeSource` like the gather branches are:
		 * this node returns the *whole candidate pool* enriched, so its first
		 * `main` row is somebody else's gather branch and the note would be filed under
		 * "World lore" on a turn where it worked and under its node key on a turn
		 * where it did not.
		 */
		if (typeof d.entityLink === "string")
			note(`Entity links: ${d.entityLink}.`)
		/**
		 * Eager indexing — what a query node had to index before it could
		 * search, and whether it got through it.
		 *
		 * The same requirement the two lines above serve, one layer down. When a
		 * query scopes content whose index is missing, those rows are promoted
		 * to the front of the background queue and indexed before the search
		 * runs — which is the only reason some turns are visibly slower than
		 * others, and the only reason a search sometimes covers less than the
		 * scope it named. Both are facts about *this* turn, and neither is
		 * inferable from the results: a bound that bound and a scope that was
		 * fully covered produce the same shaped answer.
		 *
		 * The string is the host's (`describePromotion`), so one place decides
		 * what a partial pass is called. Absent when nothing needed indexing,
		 * because a note every turn saying "nothing to do" is what teaches
		 * people to stop reading the notes.
		 */
		if (typeof d.indexing === "string")
			note(`Indexing: ${d.indexing}.`)
		if (typeof d.entityIndexing === "string")
			note(`Indexing: ${d.entityIndexing}.`)
		if (Array.isArray(d.truncated) && d.truncated.length)
			// `{source, fetched, available}`, in the INDEX vocabulary — folded
			// like every other source name here, and reported with both numbers
			// because "it read some of them" is not something anyone can act
			// on and "the newest 2000 of 5400" is.
			warn(
				`The candidate fetch could not read ${d.truncated
					.map((t: any) => {
						const label = retrievalSourceLabel(
							retrievalGroupOf(String(t?.source ?? t))
						)
						const fetched = num(t?.fetched)
						const available = num(t?.available)
						return fetched !== undefined && available !== undefined
							? `${label} (the newest ${fetched} of ${available})`
							: label
					})
					.join(", ")} whole, so the best match may be outside what was ` +
					`scanned.`
			)
		if (d.disjoint && typeof d.warning === "string") warn(d.warning)
	}

	// Last, because it is the least news on the list: everything above either
	// found something or names a reason something could not be found, and this
	// only says where there was nothing to look at.
	if (barren.size) {
		const [first, ...rest] = [...barren]
		// Lowercased after the first, because this is one sentence about
		// several bands rather than several headings run together.
		const tail = rest.map((label) => label.toLowerCase())
		const who =
			tail.length === 0
				? first
				: tail.length === 1
					? `${first} and ${tail[0]}`
					: `${first}, ${tail.slice(0, -1).join(", ")} and ${tail.at(-1)}`
		note(`${who}: nothing to scan.`)
	}

	// ── The decisions ────────────────────────────────────────────────
	/**
	 * Every entry the ranker actually judged, keyed by budget group.
	 *
	 * Read by the skipped pass below rather than by anything here: the mechanisms are
	 * independent and both run on every turn, so an entry the keyword scan never
	 * matched is routinely one the vector mechanism then found and the ranker judged.
	 * Rendering the miss as well would put "never reached the ranker" beside the
	 * row saying what the ranker decided about it, which is not a nuance — it is
	 * the panel contradicting itself.
	 */
	const decided = new Set<string>()
	for (const n of nodes) {
		const decisions = n?.output?.decisions
		if (!Array.isArray(decisions)) continue
		ranked = true

		const groups = n?.output?.groups
		if (!bands.length && groups && typeof groups === "object") {
			bands = Object.entries(groups as Record<string, any>).map(
				([source, usage]) => ({
					source,
					label: retrievalSourceLabel(source),
					allocated: num(usage?.allocated) ?? 0,
					used: num(usage?.used) ?? 0,
					entries: num(usage?.entries) ?? 0,
					cap: num(usage?.cap) ?? 0,
					dropped: decisions.filter(
						(x: any) =>
							x?.included === false &&
							x?.candidate?.source === source
					).length
				})
			)
		}
		const capOf = (source: string) =>
			bands.find((b) => b.source === source)?.cap || undefined

		for (const d of decisions) {
			const candidate = d?.candidate ?? {}
			const source = retrievalGroupOf(String(candidate.source ?? ""))
			const id = candidate.id
			const entry =
				typeof id === "number" ? entries.get(`${source}:${id}`) : undefined
			const payload = (candidate.payload ?? {}) as Record<string, unknown>

			const criteria: Sockets.Pipelines.RetrievalCriterion[] = []
			for (const signal of RETRIEVAL_CRITERION_ORDER) {
				const value = num((candidate.signals ?? {})[signal])
				if (value === undefined) continue
				const c = retrievalCriterion(signal, value, source, entry, payload)
				if (c) criteria.push(c)
			}
			const priority = num(candidate.priority)
			if (priority !== undefined && priority > 1)
				criteria.push({
					label: "Author priority",
					detail: `its author set priority ${priority}`,
					value: priority
				})
			// A candidate carrying a `presetScore` was ordered by a number the
			// signals above did not produce — rank fusion, or the semantic
			// mechanism's nine stages written back at the seam. Saying which is the
			// difference between "it scored 0.83" and "both mechanisms found it".
			const preset = num(candidate.presetScore)
			if (preset !== undefined) {
				const ranks = fusionRanks(payload.foundBy)
				if (payload.foundBy === "entity-search") {
					const shared = Array.isArray(payload.sharedEntities)
						? (payload.sharedEntities as unknown[]).map(String)
						: []
					criteria.push({
						label: "Entities it shares with the scene",
						detail: shared.length
							? shared.slice(0, 6).join(", ")
							: "found by the entity arm",
						value: num(candidate?.signals?.entityCooccurrence)
					})
				} else if (ranks.length > 1)
					criteria.push({
						label: "Both retrieval arms found it",
						detail: `ranked ${ranks.map(ordinal).join(" and ")} by the arms that found it`
					})
				else if (ranks.length === 1)
					criteria.push({
						label: "One retrieval arm found it",
						detail: `ranked ${ordinal(ranks[0])} in its arm`
					})
				else
					criteria.push({
						label: "Similarity to the conversation",
						detail: `the semantic arm scored it ${preset.toFixed(3)}`
					})
			}

			const { marker, markerKind } = retrievalMarker(candidate, d?.reason)
			const label = retrievalSourceLabel(source)
			const liveTitle = entry?.title?.trim() || ""
			const recordedTitle =
				(typeof payload.name === "string" && payload.name.trim()) ||
				// The candidate payload IS the lore row, so a history hit
				// carries its date even when the entry read found nothing.
				datedTitle(payload) ||
				""
			const drift = retrievalProvenance(
				typeof payload.fingerprint === "string"
					? payload.fingerprint
					: undefined,
				entry,
				entriesRead,
				{ recorded: recordedTitle, live: liveTitle }
			)
			/**
			 * Live first, **except** once the record and the row are known to
			 * disagree.
			 *
			 * The order is the whole fix. A row headed with the live title over
			 * a decision made about different text is the composite that never
			 * existed — it reads as though the run scored what the reader is
			 * looking at. So when `provenance` says the entry moved, the
			 * recorded title heads the row and the live one is offered beside
			 * it as `currentTitle`, labelled for what it is. When nothing
			 * moved the two agree and the order cannot matter; when nothing is
			 * claimed this is exactly what it always was.
			 */
			const drifted =
				drift.provenance === "changed" ||
				drift.provenance === "deleted"
			const title =
				(drifted
					? recordedTitle || liveTitle
					: liveTitle || recordedTitle) || `#${id}`

			decided.add(`${source}:${id}`)
			// What it actually cost the prompt, banked once per entry.
			if (d?.included && !counted.has(`${source}:${id}`)) {
				counted.add(`${source}:${id}`)
				spent.set(
					source,
					(spent.get(source) ?? 0) + (num(candidate.tokens) ?? 0)
				)
				spentEntries.set(source, (spentEntries.get(source) ?? 0) + 1)
			}
			rows.push({
				key: `${n.nodeKey}:${source}:${id}`,
				id,
				source,
				sourceLabel: label,
				title,
				...drift,
				...(drifted && liveTitle && liveTitle !== title
					? { currentTitle: liveTitle }
					: {}),
				excerpt: retrievalExcerpt(payload.content),
				outcome: d?.included ? "included" : "excluded",
				verdict: retrievalVerdict(
					d?.reason,
					source,
					label,
					capOf(source),
					criteria[0]?.detail
				),
				marker,
				markerKind,
				criteria,
				score: num(d?.score),
				tokens: num(candidate.tokens),
				reason: typeof d?.reason === "string" ? d.reason : undefined,
				nodeKey: n.nodeKey,
				why: [
					typeof d?.why === "string" ? d.why : null,
					// Stated once. `filled_scored`'s own `why` already reads
					// "scored 0.300, 47 tokens" — appending "score 0.300" here
					// too repeated the same number a second time in the same
					// line. Every other reason's `why` never names the score in
					// words, so the score still needs to be said for those.
					num(d?.score) !== undefined &&
					!(typeof d?.why === "string" && /\bscored\b/i.test(d.why))
						? `score ${Number(d.score).toFixed(3)}`
						: null
				].filter(Boolean) as string[],
				...(entry
					? {
							entry: {
								id: entry.id,
								typeId: entry.typeId as EntryTypeId,
								constant: entry.constant,
								enabled: entry.enabled,
								keys: entry.keys
							}
						}
					: {})
			})
		}
	}

	// ── Never reached the ranker ─────────────────────────────────────
	//
	// A different question from "excluded", with a different control behind it:
	// an entry the mechanisms declined never competed for budget at all. Reported
	// after the decisions so the list reads in the order retrieval happened.
	const seenSkips = new Set<string>()
	for (const n of nodes) {
		const skipped = n?.output?.skipped
		if (!Array.isArray(skipped)) continue
		for (const s of skipped) {
			const source = retrievalGroupOf(String(s?.source ?? ""))
			const id = s?.id
			const key = `${source}:${id}`
			// Judged by the ranker after all, on some other mechanism — see `decided`.
			if (decided.has(key)) continue
			// One decline per entry, first mechanism wins. A second mechanism's reason for
			// the same row would be a second sentence about the same absence,
			// and the reader has one question, not two.
			if (seenSkips.has(key)) continue
			seenSkips.add(key)
			const entry = typeof id === "number" ? entries.get(key) : undefined
			const label = retrievalSourceLabel(source)
			const reason = typeof s?.reason === "string" ? s.reason : ""
			/**
			 * A skip carries no payload, so there is no recorded title to head
			 * the row with when the entry has moved — the mechanism declined it
			 * before anything about it was worth writing down. The row shows
			 * the live title either way and the sentence says which run it is
			 * about, which is the honest reading of the only two facts kept:
			 * an id and a reason.
			 */
			const drift = retrievalProvenance(
				typeof s?.fingerprint === "string" ? s.fingerprint : undefined,
				entry,
				entriesRead
			)
			rows.push({
				key: `skip:${key}`,
				id,
				source,
				sourceLabel: label,
				title: entry?.title?.trim() || `#${id}`,
				...drift,
				outcome: "skipped",
				verdict: reason
					? `Never reached the ranker — ${reason}.`
					: "Never reached the ranker.",
				marker: "Not considered",
				markerKind: "none",
				criteria: [],
				nodeKey: n.nodeKey,
				...(entry
					? {
							entry: {
								id: entry.id,
								typeId: entry.typeId as EntryTypeId,
								constant: entry.constant,
								enabled: entry.enabled,
								keys: entry.keys
							}
						}
					: {})
			})
		}
	}

	/**
	 * The three drops a per-row scan cannot find.
	 *
	 * `renderSelection` (`ranking/select.ts`) exists for exactly these and has
	 * never had a caller. It is not called here — it renders a per-group
	 * summary, which is the Elasticsearch-shaped panel plan Part 6 rules
	 * against — but its argument holds and is honoured: a dropped pin reads as
	 * one row among hundreds, and a zero-share group never appears in the band
	 * table at all because `allocated` and `used` are both zero.
	 */
	const pinnedDrops = rows.filter(
		(r) => r.reason === "excluded_pinned_token_limit"
	)
	if (pinnedDrops.length)
		warn(
			`${pinnedDrops.length} entr${pinnedDrops.length === 1 ? "y" : "ies"} ` +
				`marked always-include did not fit the context window ` +
				`(${[...new Set(pinnedDrops.map((r) => r.sourceLabel))].join(", ")}).`
		)
	const disabledPins = rows.filter(
		(r) => r.reason === "excluded_pinned_group_disabled"
	)
	if (disabledPins.length)
		warn(
			`${disabledPins.length} entr${disabledPins.length === 1 ? "y" : "ies"} ` +
				`marked always-include sit in a source whose share is zero ` +
				`(${[...new Set(disabledPins.map((r) => r.sourceLabel))].join(", ")}).`
		)
	const unknown = rows.filter((r) => r.reason === "excluded_unknown_source")
	if (unknown.length)
		warn(
			`${unknown.length} candidate(s) came from a source with no budget ` +
				`group (${[...new Set(unknown.map((r) => r.source))].join(", ")}), ` +
				`so nothing could weigh them.`
		)

	if (rows.length > limit) {
		omitted = rows.length - limit
		rows.length = limit
	}
	if (receipt?.compact)
		note(
			"This receipt was compacted: the run halted before anything effectful, " +
				"so the node trail it would have explained is not kept."
		)

	const budget = retrievalBudget(bands, spent, spentEntries, ceiling)

	return {
		rows,
		bands,
		notes,
		warnings,
		ranked,
		omitted,
		...(budget ? { budget } : {}),
		...(stops ? { stops } : {})
	}
}

/**
 * The stop sequences a run recorded, read off its generate node.
 *
 * ⚠ **Absent and empty are different answers, and this returns the first.** A
 * run from before stops were recorded, or one that halted upstream of the
 * provider, has not told the reader that nothing was sent — it has told them
 * nothing, and a Stops row reading "none" over that would be a fabrication.
 *
 * The blob is JSON a previous build wrote and could in principle be anything, so
 * every field is checked rather than cast: a shape the panel cannot render is
 * dropped here, where the answer is silence, rather than in a component, where
 * the answer is a broken report.
 *
 * Nothing here is connection identity — three kinds, some strings the user
 * themselves typed, and the wire mode — so `withoutConnectionIdentity` has
 * nothing to remove and a non-admin reading their own receipt sees the whole of
 * it, which is the point.
 */
function stopsFromReceipt(
	nodes: any[]
): Sockets.Pipelines.RetrievalStops | undefined {
	const node = nodes.find((n) =>
		String(n?.typeId ?? "").startsWith("core:provider/generate-text")
	)
	const raw = node?.output?.stops
	if (!raw || typeof raw !== "object") return undefined
	const list = (v: unknown): Sockets.Pipelines.StopSequence[] | null => {
		if (!Array.isArray(v)) return null
		const out: Sockets.Pipelines.StopSequence[] = []
		for (const s of v) {
			if (!s || typeof s.value !== "string") continue
			if (s.kind !== "format" && s.kind !== "speaker" && s.kind !== "explicit")
				continue
			out.push({ value: s.value, kind: s.kind })
		}
		return out
	}
	const sent = list(raw.sent)
	const dropped = list(raw.dropped)
	if (!sent || !dropped) return undefined
	if (raw.wire !== "chat" && raw.wire !== "completion") return undefined
	return {
		sent,
		dropped,
		wire: raw.wire,
		...(typeof raw.hit === "string" && raw.hit ? { hit: raw.hit } : {})
	}
}

/**
 * The entries behind a run's rows — titles, keys, and the two levers.
 *
 * Read rather than carried on the receipt, and only what a row needs: a title
 * so the panel can speak content vocabulary, `keys` so the keyword criterion
 * can name what matched, and `constant` / `enabled` **as they are now** so a
 * toggle says what it will do rather than what it would have done at run time.
 *
 * Scoped through the session the run belongs to and re-checked against the
 * asker, not taken from the run row: `sessionId` is a column somebody could
 * have written, and lore is session-scoped data. A run with no session, or one
 * that has since been deleted, simply gets no names — the rows still render,
 * with ids.
 *
 * ⚠ **`read` is not `!entries.size`**, and the difference is the whole
 * `deleted` state. "This lorebook holds none of the entries the run named" and
 * "this run's lore could not be looked at" produce the same empty map and mean
 * opposite things, and a projection that guessed would report every row of an
 * unreadable run as a deleted entry — the loudest possible way to be wrong
 * about somebody's audit trail. So the read says whether it read, and a
 * projection told `false` claims nothing.
 */
interface RetrievalEntryRead {
	entries: Map<string, RetrievalEntryFacts>
	/** Whether the lorebook was actually reachable and read. */
	read: boolean
}

export async function retrievalEntriesFor(
	sessionId: number | null,
	userId: number
): Promise<RetrievalEntryRead> {
	const entries = new Map<string, RetrievalEntryFacts>()
	if (sessionId == null) return { entries, read: false }
	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			lorebookId: schema.sessions.lorebookId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session || session.userId !== userId || !session.lorebookId)
		return { entries, read: false }

	const rows = await db
		.select({
			id: schema.lorebookEntries.id,
			typeId: schema.lorebookEntries.typeId,
			title: schema.lorebookEntries.title,
			keys: schema.lorebookEntries.keys,
			constant: schema.lorebookEntries.constant,
			enabled: schema.lorebookEntries.enabled,
			// Read for one thing: history's date, which is its heading.
			fields: schema.lorebookEntries.fields,
			/**
			 * Read for one thing as well: the fingerprint below. Nothing here
			 * renders it — the excerpt a row shows is the recorded one off the
			 * receipt — but "is this still the entry that was scored" is a
			 * question about the content, and `entrySourceHash` is over the
			 * content by definition.
			 */
			content: schema.lorebookEntries.content
		})
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, session.lorebookId))

	for (const r of rows as any[])
		entries.set(`${bandOfType(r.typeId)}:${r.id}`, {
			id: r.id,
			typeId: r.typeId,
			title: r.title?.trim() || datedTitle(r.fields),
			keys: Array.isArray(r.keys) ? r.keys : [],
			constant: !!r.constant,
			enabled: !!r.enabled,
			// ⚠ The stored columns, hashed by the same function the run used
			// on the same three columns. Two recipes over one row is how a
			// panel ends up calling every entry "edited" the moment one side
			// starts trimming whitespace.
			fingerprint: entrySourceHash(r)
		})
	return { entries, read: true }
}

/**
 * One run's retrieval, explained.
 *
 * Owner-scoped on exactly the terms `pipelines:run` is, and deliberately not
 * `adminOnly`: this explains a receipt the asker already owns and may already
 * read whole, so an admin gate here would refuse people their own evidence
 * while changing nothing about what is reachable. The config verbs are
 * admin-only because they *write instance configuration*; this reads one run.
 */
export const pipelinesRunExplain: Handler<
	Sockets.Pipelines.RunExplain.Params,
	Sockets.Pipelines.RunExplain.Response
> = {
	event: "pipelines:runExplain",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const [r] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(
				and(
					eq(schema.pipelineRuns.runId, params.runId),
					eq(schema.pipelineRuns.userId, userId)
				)
			)
			.limit(1)
		if (!r) {
			const res = { error: "No such run." }
			emitToUser("pipelines:runExplain:error", res)
			return res
		}
		const { entries, read } = await retrievalEntriesFor(
			(r as any).sessionId ?? null,
			userId
		)
		const res: Sockets.Pipelines.RunExplain.Response = {
			runId: (r as any).runId,
			explanation: explainRetrieval((r as any).receipt ?? {}, entries, {
				entriesRead: read
			})
		}
		emitToUser("pipelines:runExplain", res)
		return res
	}
}

/* ------------------------------------------------------------------ *
 * The answer where the question is asked — ruling 2026-09-08 (4.4)
 *
 * The two handlers below put the *same* projection on the two surfaces where
 * somebody actually asks about lore, neither of which is the admin workspace:
 * the composer, before sending ("what would fire if I sent this?"), and a
 * reply, after the fact ("why did it say that?"). Both answer with
 * `explainRetrieval`, the one definition of what a retrieval decision is —
 * a second projection shaped for the session page would be a second answer to
 * the same question, free to drift from the first.
 * ------------------------------------------------------------------ */

/**
 * The cast and the transcript a preview turn needs to pick a speaker.
 *
 * A lean re-read rather than an import: the recipe lives in `sessions.ts` as
 * `getPromptSessionFromDb`, which is module-private and loads a great deal
 * this never touches (bindings, removed participants, the lorebook's own row).
 * The three filters that ARE load-bearing are copied deliberately and for the
 * reasons stated there — hidden messages and side channels are not the
 * conversation, and a removed participant must never get a turn. `channelWhere`
 * for the same reason it is used there: a bare slug is the whole channel
 * (ruling 2026-09-09), and a preview that scoped `main` differently from the
 * turn it previews would be answering a question nobody asked.
 */
async function previewCastFor(sessionId: number) {
	return await db.query.sessions.findFirst({
		where: (s, { eq }) => eq(s.id, sessionId),
		with: {
			sessionMessages: {
				where: (cm, { eq, and }) =>
					and(
						eq(cm.isHidden, false),
						channelWhere(
							schema.sessionMessages.channel,
							DEFAULT_CHANNEL
						)
					),
				orderBy: (cm, { asc }) => asc(cm.id)
			},
			sessionCharacters: {
				where: (cc, { isNull }) => isNull(cc.removedAt),
				with: { character: true },
				orderBy: (cc, { asc }) => asc(cc.position)
			},
			sessionPersonas: {
				where: (cp, { isNull }) => isNull(cp.removedAt),
				with: { persona: true },
				orderBy: (cp, { asc }) => asc(cp.position)
			}
		}
	})
}

/**
 * What would fire if you sent this — asked from the composer's Lore tab.
 *
 * A real turn, compiled and stopped: `preview: true` halts at the pre-call
 * substrate with the payload the next send would actually use, and
 * `skipReceipt` keeps a question somebody asks repeatedly from burying the run
 * history — the same two flags, for the same two reasons, as
 * `sessions:promptTokenCount` and `entries:testRetrieval`.
 *
 * ⚠ **The draft is spliced in.** Without it the preview answers about the
 * conversation *without* the message being asked about, and — worse — nobody
 * is due to speak the moment the last real message is a reply, so the answer
 * degrades to "no character available" for exactly the person who is typing.
 * `sessions:promptTokenCount` learned this; the synthetic row below is its
 * recipe, id `-1` and all.
 *
 * Two gates, and the second is not decoration: the session must be reachable
 * (owner **or** guest, the one rule `checkSessionAccess` owns) and it must
 * have a lorebook, because retrieval reads the session's own book and a
 * session without one has nothing that could fire. The lore titles come
 * through `retrievalEntriesFor`, which is owner-scoped by its own rule — so a
 * guest gets rows without levers, which is what `pipelines:runExplain`
 * already gives them.
 */
export const pipelinesPreviewRetrieval: Handler<
	Sockets.Pipelines.PreviewRetrieval.Params,
	Sockets.Pipelines.PreviewRetrieval.Response
> = {
	event: "pipelines:previewRetrieval",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = Number(params.sessionId)
		const refuse = (error: string) => {
			const res: Sockets.Pipelines.PreviewRetrieval.Response = { error }
			emitToUser("pipelines:previewRetrieval:error", res)
			return res
		}

		// Fail on oversized content before any database work, exactly as the
		// draft-preview handler this borrows its recipe from does.
		if (params.content && params.content.length > MAX_CHAT_MESSAGE_LENGTH)
			return refuse(
				`Message too long (max ${MAX_CHAT_MESSAGE_LENGTH.toLocaleString()} characters).`
			)

		// One sentence for "no such session" and "not yours", because telling
		// the two apart is how a session id becomes worth guessing.
		if (!Number.isInteger(sessionId)) return refuse("No such conversation.")
		const access = await checkSessionAccess(sessionId, userId)
		if (!access.hasAccess) return refuse("No such conversation.")

		const session = await previewCastFor(sessionId)
		if (!session) return refuse("No such conversation.")
		// Answered here rather than by running the turn, for
		// `entries:testRetrieval`'s reason: retrieval reads the session's own
		// book, so this is not a "nothing fires" but a question that cannot be
		// asked — and spending a whole turn to report an absence with no
		// reason attached is the failure this surface exists to remove.
		if (!session.lorebookId)
			return refuse(
				"This conversation has no lorebook attached, so there is no lore to fire."
			)

		const activeCharacters = session.sessionCharacters.filter(
			(cc) => cc.character !== null && cc.isActive
		)
		if (!activeCharacters.length)
			return refuse(
				"This conversation has no active characters, so there is no reply to test lore against."
			)

		const draft = params.content?.trim() ? params.content : null
		const messagesWithDraft = draft
			? [
					...session.sessionMessages,
					{
						id: -1,
						sessionId,
						userId,
						characterId: null,
						personaId: params.personaId ?? null,
						role: "user",
						isNarratorResponse: false,
						content: draft,
						createdAt: new Date().toISOString(),
						updatedAt: new Date(),
						isEdited: false,
						metadata: {},
						isGenerating: false,
						generationStage: null,
						error: null,
						queueItemId: null,
						isHidden: false,
						debugMeta: null,
						embedding: null,
						embeddingModel: null,
						vectorizedAt: null
					} as unknown as SelectSessionMessage
				]
			: session.sessionMessages

		/**
		 * Whose turn it would be — and, when nobody is due, whoever the app
		 * would pick for a plain reply.
		 *
		 * The fallback is `entries:testRetrieval`'s and is stated there: a
		 * test has to pick somebody, and refusing because the rotation says
		 * "your turn to type" would withhold the answer from precisely the
		 * person standing in the composer asking for it. Only character lore
		 * is scoped by the speaker, and the row below is the same one a send
		 * from this position would reach.
		 */
		const currentCharacterId =
			getNextCharacterTurn(
				{
					sessionMessages:
						messagesWithDraft as SelectSessionMessage[],
					sessionCharacters: activeCharacters.sort(
						(a, b) => (a.position ?? 0) - (b.position ?? 0)
					),
					sessionPersonas: session.sessionPersonas.filter(
						(cp) => cp.persona !== null
					)
				},
				session.groupReplyStrategy
			) ?? activeCharacters[0].characterId

		const { runTurn } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		let receipt: any
		try {
			receipt = await runTurn({
				db,
				sessionId,
				userId,
				currentCharacterId,
				text: draft ?? "",
				...(draft
					? {
							draftMessage: {
								content: draft,
								personaId: params.personaId ?? null
							}
						}
					: {}),
				preview: true,
				skipReceipt: true
			})
		} catch (error) {
			console.error("Error in pipelinesPreviewRetrieval:", error)
			return refuse(
				`The turn could not be run: ${
					error instanceof Error ? error.message : String(error)
				}`
			)
		}

		// A preview *halts* by design, so the outcome cannot tell success from
		// failure; the payload can. The sentence is the one the token count
		// composes, naming the node that gave up rather than reporting a bare
		// failure.
		if (!receipt?.preview)
			return refuse(
				`The prompt could not be compiled: ${receipt?.outcome}` +
					(receipt?.haltNodeKey
						? ` at '${receipt.haltNodeKey}'`
						: "") +
					(receipt?.haltReason ? ` — ${receipt.haltReason}` : "")
			)

		const { entries, read } = await retrievalEntriesFor(sessionId, userId)
		const res: Sockets.Pipelines.PreviewRetrieval.Response = {
			sessionId,
			explanation: explainRetrieval(receipt, entries, {
				entriesRead: read
			})
		}
		emitToUser("pipelines:previewRetrieval", res)
		return res
	}
}

/**
 * Why *this reply* said what it said.
 *
 * `pipelines:runExplain` answers the same question addressed by run id, which
 * is the workspace's vocabulary and not the reader's: somebody looking at a
 * message has a message. This resolves the run from it, so the per-message
 * report needs no run id of its own — a `pipeline_run_artifacts` row of kind
 * `message` is the link, and that relation exists for exactly this lookup.
 *
 * ⚠ **Gated on the session, owner OR guest — deliberately wider than
 * `runExplain`.** That handler scopes to the asker's own runs because it is
 * reachable by run id from the admin workspace, where the only thing naming a
 * run is a person browsing their own receipts. This is reachable only from a
 * message in a conversation the asker is in, and a guest reading a reply
 * addressed to them is reading their own evidence: an owner-only gate here
 * would refuse a participant the account of a turn they took part in. The run
 * is not filtered by `user_id` for the same reason — in a shared session the
 * turn belongs to whoever triggered it, which is frequently not the reader.
 *
 * Ordered non-preview first: a message's run is whichever one recorded the
 * send, and a preview linked to the same row (a re-generation that was stopped
 * and looked at) is the weaker record of the two rather than the newer.
 */
export const pipelinesMessageExplain: Handler<
	Sockets.Pipelines.MessageExplain.Params,
	Sockets.Pipelines.MessageExplain.Response
> = {
	event: "pipelines:messageExplain",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const messageId = Number(params.messageId)
		const refuse = (error: string) => {
			const res: Sockets.Pipelines.MessageExplain.Response = {
				messageId: Number.isInteger(messageId) ? messageId : undefined,
				error
			}
			emitToUser("pipelines:messageExplain:error", res)
			return res
		}
		if (!Number.isInteger(messageId)) return refuse("No such message.")

		// The subject before the record: a reader who cannot reach the message
		// must not learn from this whether a run exists for it.
		const [message] = await db
			.select({ sessionId: schema.sessionMessages.sessionId })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, messageId))
			.limit(1)
		if (!message) return refuse("No such message.")
		const access = await checkSessionAccess(message.sessionId, userId)
		if (!access.hasAccess) return refuse("No such message.")

		// Through the artifact relation: a message can be the artifact of more
		// than one run (regenerated, continued), and the non-preview newest is
		// the one that actually sent something.
		//
		// ⚠ Through `runsForArtifact` rather than a join written out here.
		// That function is the relation's reader — it, this handler and
		// `pipelines:artifactRuns` were three spellings of one query, and the
		// index (`pipeline_run_artifacts_entity_idx`) exists for it by name.
		// The *choice* stays here because it is this handler's, not the
		// reader's: the list comes back newest-first and the first non-preview
		// in it is the run that sent something, which is the same row
		// `asc(isPreview), desc(id) LIMIT 1` used to return.
		const { runsForArtifact } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		const produced = await runsForArtifact(db, "message", messageId)
		const run =
			produced.find((r: any) => !r.isPreview) ?? produced[0] ?? null
		if (!run)
			return refuse(
				"This reply was generated before run tracking, so there is nothing recorded for it."
			)

		// Through the message's session rather than the run's `session_id`,
		// which is a column somebody could have written — the same reason
		// `runExplain` re-checks it. `retrievalEntriesFor` is owner-scoped on
		// top of that, so a guest reads the names their receipts recorded
		// rather than a live read of the owner's lorebook.
		const { entries, read } = await retrievalEntriesFor(
			message.sessionId,
			userId
		)
		const res: Sockets.Pipelines.MessageExplain.Response = {
			messageId,
			runId: (run as any).runId,
			explanation: explainRetrieval((run as any).receipt ?? {}, entries, {
				entriesRead: read
			})
		}
		emitToUser("pipelines:messageExplain", res)
		return res
	}
}

/**
 * Which runs produced this row.
 *
 * `pipeline_run_artifacts` has recorded what every run made since the relation
 * replaced the nullable column, and only one direction of it was ever readable
 * from a client: a *message* could ask for its own run. An image could not, so
 * a picture generated by a pipeline and a picture dragged in from the desktop
 * looked identical in the gallery — the run that made it was written down and
 * then unreachable from the one place a person looks at the thing it made.
 *
 * ⚠ **Gated on the artifact, never on the run.** The run row carries a
 * `user_id`, and scoping to it would be the easy check and the wrong one: it
 * would answer "did you make this run" when the question asked is "may you see
 * this row". So each kind is gated by whoever already owns that kind's access —
 * `getMedia` plus the owner comparison the `media:*` by-id handlers use, and
 * `checkSessionAccess` for a message, the same gate `messageExplain` applies.
 * A caller who cannot reach the artifact gets the sentence a missing one gets
 * and learns nothing about whether a run exists for it.
 *
 * Every run, not the newest: a regenerated image legitimately has more than
 * one, and which of them a reader wants is a question the caller is better
 * placed to answer than this is. `isPreview` rides along for the same reason —
 * a preview is a weaker record than a send, and hiding it here would be this
 * handler deciding that on the caller's behalf.
 */
export const pipelinesArtifactRuns: Handler<
	Sockets.Pipelines.ArtifactRuns.Params,
	Sockets.Pipelines.ArtifactRuns.Response
> = {
	event: "pipelines:artifactRuns",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const kind = params.kind
		const entityId = Number(params.entityId)
		const refuse = (error: string) => {
			const res: Sockets.Pipelines.ArtifactRuns.Response = {
				kind,
				entityId: Number.isInteger(entityId) ? entityId : undefined,
				runs: [],
				error
			}
			emitToUser("pipelines:artifactRuns:error", res)
			return res
		}
		if (!Number.isInteger(entityId)) return refuse("No such row.")

		// The subject before the record, kind by kind. Only the two kinds with
		// a reader are answerable: `variant` and `lore_entry` are written by
		// producers that have no surface asking this question yet, and a gate
		// invented for a caller that does not exist is a gate nothing tests.
		if (kind === "file") {
			const { getMedia } = await import("$lib/server/media")
			const file = await getMedia(db, entityId)
			// The `media:*` by-id handlers' own check, and deliberately not the
			// wider `canViewMedia`: this answers for the media manager, which
			// lists nothing but the caller's own blobs.
			if (!file || file.userId !== userId) return refuse("No such image.")
		} else if (kind === "message") {
			const [message] = await db
				.select({ sessionId: schema.sessionMessages.sessionId })
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, entityId))
				.limit(1)
			if (!message) return refuse("No such message.")
			const access = await checkSessionAccess(message.sessionId, userId)
			if (!access.hasAccess) return refuse("No such message.")
		} else return refuse("No such row.")

		const { runsForArtifact } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		const rows = await runsForArtifact(db, kind, entityId)
		const res: Sockets.Pipelines.ArtifactRuns.Response = {
			kind,
			entityId,
			// Newest first, as the reader hands them over. Four fields, because
			// naming a run and dating it is the whole job — a receipt is what
			// `pipelines:run` is for, and repeating it here would put a run's
			// full output behind a gate written for an image.
			runs: rows.map((r: any) => ({
				runId: r.runId,
				specSlug: r.specSlug,
				startedAt: r.startedAt,
				isPreview: !!r.isPreview
			}))
		}
		emitToUser("pipelines:artifactRuns", res)
		return res
	}
}

/* ------------------------------------------------------------------ *
 * Everything that has ever fired in this session — Q6
 *
 * Every run's receipt records what fired. Nothing ever added them up, so the
 * author's actual question — *which of my entries is this session using?* —
 * was answered by opening runs one at a time and holding the tally in your
 * head. This is that tally.
 *
 * ## The aggregation runs in the database
 *
 * A long session has hundreds of receipts and each receipt is large — the
 * decisions carry every candidate whole, payload included, because assemble
 * allocates from them. Loading all of that into this process to count ids
 * would be tens of megabytes of JSON parsed to produce a few hundred integers.
 * So the grouping is a query: the receipt column is walked by Postgres, and
 * what comes back is one row per entry.
 *
 * The read is bounded anyway — the newest `runLimit` runs — and the bound is
 * **stated**, in `runsRead`/`runsTotal` and in a sentence. A tally that
 * silently stopped counting at some depth is not a partial answer; it is a
 * wrong one, and an author acting on "this never fires" would be acting on an
 * artefact of the limit.
 *
 * ## Sorted by how often, not by how recently
 *
 * Both are on the row, and the client can reorder either way. Frequency is the
 * default because the question this answers is which entries are *shaping*
 * the session: an entry in forty of fifty turns is doing the work whether or
 * not it happened to fire in the last one, and a recency sort would put a
 * single stray hit from the most recent turn above it. Recency ties frequency,
 * so equally-used entries still read newest-first.
 * ------------------------------------------------------------------ */

/**
 * The index vocabulary's fold, as SQL.
 *
 * ⚠ Generated from `RETRIEVAL_SOURCE_ALIASES` rather than restated beside it.
 * The fold has to happen *before* the grouping — an entry the vector mechanism
 * recorded as `historyEntry` and the ranker as `history` would otherwise come
 * back as two rows for one entry — and a second hand-written copy of that map
 * in a SQL string is exactly the drift the constant's own note warns about.
 */
const RETRIEVAL_SOURCE_ALIAS_JSON = JSON.stringify(RETRIEVAL_SOURCE_ALIASES)

/** "3 of the 12 turns" reads wrong for one; this is the only plural rule needed. */
const plural = (n: number, one: string, many = `${one}s`) =>
	n === 1 ? one : many

/**
 * Everything that has ever fired in this session.
 *
 * ⚠ **Two gates, and both are load-bearing.** The session must be one the
 * asker can reach — `checkSessionAccess`, owner **or** guest, because session
 * access has never been ownership and a local re-check here would be the
 * fourth copy of a rule that has already locked guests out once. And the runs
 * aggregated are the asker's own (`user_id`), exactly as `pipelines:runs` and
 * `pipelines:run` scope them — so reaching a shared session never becomes
 * reading somebody else's receipts. Neither gate implies the other: a guest
 * passes the first and is still confined by the second, and a person who owns
 * a run whose `session_id` names a session they cannot reach fails the first.
 *
 * The titles come through `retrievalEntriesFor`, which re-reads the session
 * and is owner-scoped by its own rule. A guest therefore gets the names their
 * own receipts recorded rather than a live read of the owner's lorebook, which
 * is the same answer `pipelines:runExplain` already gives them.
 */
export const pipelinesSessionEntryUsage: Handler<
	Sockets.Pipelines.SessionEntryUsage.Params,
	Sockets.Pipelines.SessionEntryUsage.Response
> = {
	event: "pipelines:sessionEntryUsage",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = Number(params.sessionId)
		const refuse = (error: string) => {
			const res = { error }
			emitToUser("pipelines:sessionEntryUsage:error", res)
			return res
		}
		// One sentence for "no such session" and "not yours", because telling
		// the two apart is how a session id becomes something worth guessing.
		if (!Number.isInteger(sessionId)) return refuse("No such session.")
		const access = await checkSessionAccess(sessionId, userId)
		if (!access.hasAccess) return refuse("No such session.")

		const limit = Math.min(Math.max(params.limit ?? 100, 1), 500)
		const runLimit = Math.min(Math.max(params.runLimit ?? 200, 1), 1000)

		const mine = and(
			eq(schema.pipelineRuns.sessionId, sessionId),
			eq(schema.pipelineRuns.userId, userId)
		)!
		// Both counts in one pass: how many turns there are to read, and
		// whether any previews were left out of them.
		const [tally] = await db
			.select({
				turns: sql<number>`count(*) FILTER (WHERE ${schema.pipelineRuns.isPreview} = false)`,
				previews: sql<number>`count(*) FILTER (WHERE ${schema.pipelineRuns.isPreview})`
			})
			.from(schema.pipelineRuns)
			.where(mine)
		const runsTotal = Number(tally?.turns ?? 0)
		const previews = Number(tally?.previews ?? 0)
		const runsRead = Math.min(runsTotal, runLimit)

		/**
		 * One row per entry, grouped by Postgres.
		 *
		 * `CASE WHEN jsonb_typeof(…) = 'array'` guards both unnests: a
		 * compacted receipt has no `nodes` at all and a node's output may be a
		 * scalar, and `jsonb_array_elements` of a non-array raises rather than
		 * returning nothing. A `CASE` with no `ELSE` yields NULL, and a
		 * set-returning function given NULL contributes no rows — so a
		 * malformed or compacted receipt drops out of the tally instead of
		 * failing the whole read.
		 *
		 * `count(DISTINCT run_pk)` rather than `count(*)`: "how many times"
		 * means how many turns, and two gather branches deciding the same row
		 * in one turn is one appearance in one prompt.
		 *
		 * `count(*) OVER ()` carries the number of entries *before* the LIMIT,
		 * so the tail can be reported rather than silently dropped.
		 */
		const result: any = await db.execute(sql`
			WITH considered AS (
				SELECT
					r.id AS run_pk,
					r.run_id AS run_id,
					r.started_at AS started_at,
					r.receipt::jsonb AS receipt
				FROM ${schema.pipelineRuns} r
				WHERE r.session_id = ${sessionId}
					AND r.user_id = ${userId}
					AND r.is_preview = false
				ORDER BY r.id DESC
				LIMIT ${runLimit}
			),
			judged AS (
				SELECT
					c.run_pk,
					c.run_id,
					c.started_at,
					COALESCE(
						${RETRIEVAL_SOURCE_ALIAS_JSON}::jsonb ->> (d->'candidate'->>'source'),
						d->'candidate'->>'source'
					) AS source,
					d->'candidate'->>'id' AS entry_id,
					-- Compared as jsonb rather than cast from text. A node
					-- outside core can publish a decision with anything at
					-- all under \`included\`, and \`'1'::boolean\` raises — which
					-- would fail this whole read on one malformed row rather
					-- than dropping it. Equality against \`true\` never raises.
					(d->'included') = 'true'::jsonb AS included,
					CASE
						WHEN jsonb_typeof(d->'candidate'->'tokens') = 'number'
						-- \`numeric\`, not \`int\`: a JSON number is not
						-- necessarily a whole one, and \`'1.5'::int\` raises.
						THEN (d->'candidate'->>'tokens')::numeric
					END AS tokens,
					jsonb_strip_nulls(jsonb_build_object(
						'name', d->'candidate'->'payload'->'name',
						'year', d->'candidate'->'payload'->'year',
						'month', d->'candidate'->'payload'->'month',
						'day', d->'candidate'->'payload'->'day'
					)) AS heading
				FROM considered c
				CROSS JOIN LATERAL jsonb_array_elements(
					CASE WHEN jsonb_typeof(c.receipt->'nodes') = 'array'
						THEN c.receipt->'nodes' END
				) AS n
				CROSS JOIN LATERAL jsonb_array_elements(
					CASE WHEN jsonb_typeof(n->'output'->'decisions') = 'array'
						THEN n->'output'->'decisions' END
				) AS d
			),
			grouped AS (
				SELECT
					source,
					entry_id,
					count(DISTINCT run_pk) FILTER (WHERE included) AS used_runs,
					count(DISTINCT run_pk) AS judged_runs,
					-- ⚠ Formatted as UTC here rather than handed back as a
					-- driver-parsed Date. \`started_at\` is a timestamp WITHOUT
					-- time zone holding a UTC wall clock (drizzle writes
					-- \`toISOString()\` and reads it back as UTC), and a raw
					-- query bypasses that column mapping — so on any server not
					-- running in UTC the same instant would come back here
					-- offset from the \`startedAt\` the run list shows for the
					-- very same run.
					to_char(
						max(started_at) FILTER (WHERE included),
						'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
					) AS last_used_at,
					(array_agg(run_id ORDER BY run_pk DESC)
						FILTER (WHERE included))[1] AS last_run_id,
					(array_agg(tokens ORDER BY run_pk DESC)
						FILTER (WHERE included AND tokens IS NOT NULL))[1] AS tokens,
					(array_agg(heading ORDER BY run_pk DESC)
						FILTER (WHERE heading <> '{}'::jsonb))[1] AS heading
				FROM judged
				WHERE entry_id IS NOT NULL AND source IS NOT NULL
				GROUP BY source, entry_id
				HAVING count(*) FILTER (WHERE included) > 0
			)
			SELECT g.*, count(*) OVER () AS group_total
			FROM grouped g
			-- Frequency first, recency to break its ties; \`last_used_at\` is a
			-- fixed-width UTC ISO string, which orders lexicographically
			-- exactly as it orders chronologically. The id is the last tiebreak
			-- so the same session always answers in the same order.
			ORDER BY g.used_runs DESC, g.last_used_at DESC NULLS LAST, g.entry_id
			LIMIT ${limit}
		`)
		const raw: any[] = result?.rows ?? result ?? []

		// The live rows, for names and for the two levers — the same read the
		// single-run explanation does, and owner-scoped by the same rule.
		const { entries } = await retrievalEntriesFor(sessionId, userId)

		const rows: Sockets.Pipelines.SessionEntryUsageRow[] = raw.map((r) => {
			const source = String(r.source)
			const rawId = String(r.entry_id)
			const asNumber = Number(rawId)
			const key = `${source}:${rawId}`
			const entry = entries.get(key)
			// The heading the last run recorded, for an entry the lorebook no
			// longer has: a name where the type carries one, and history's date
			// where it does not — the same two rules the run's own rows use.
			const heading = (r.heading ?? {}) as Record<string, unknown>
			const recorded =
				(typeof heading.name === "string" && heading.name.trim()) ||
				datedTitle(heading) ||
				""
			return {
				key,
				id:
					Number.isInteger(asNumber) && String(asNumber) === rawId
						? asNumber
						: rawId,
				source,
				sourceLabel: retrievalSourceLabel(source),
				title: entry?.title?.trim() || recorded || `#${rawId}`,
				usedInRuns: Number(r.used_runs) || 0,
				judgedInRuns: Number(r.judged_runs) || 0,
				lastUsedAt: new Date(r.last_used_at).toISOString(),
				lastRunId: String(r.last_run_id),
				...(r.tokens != null ? { tokens: Number(r.tokens) } : {}),
				...(entry
					? {
							entry: {
								id: entry.id,
								typeId: entry.typeId as EntryTypeId,
								constant: entry.constant,
								enabled: entry.enabled,
								keys: entry.keys
							}
						}
					: {})
			}
		})

		const found = raw.length ? Number(raw[0].group_total) || rows.length : 0
		const omitted = Math.max(0, found - rows.length)

		const notes: string[] = []
		if (runsTotal > runsRead)
			notes.push(
				`Counted across the newest ${runsRead} of this session's ` +
					`${runsTotal} turns — an entry that only fired before those ` +
					`is not in this list.`
			)
		if (previews)
			notes.push(
				`${previews} ${plural(previews, "preview")} ${plural(previews, "is", "are")} ` +
					`not counted: a preview assembles a prompt and never sends it.`
			)
		if (omitted)
			notes.push(
				`${omitted} further ${plural(omitted, "entry", "entries")} fired ` +
					`less often and ${plural(omitted, "is", "are")} not listed.`
			)

		const top = rows[0]
		const summary = !runsTotal
			? "This session has no recorded turns yet, so nothing has fired in it."
			: !top
				? `Nothing has reached a prompt across the ${runsRead} ` +
					`${plural(runsRead, "turn")} counted here.`
				: found === 1
					? `“${top.title}” is the only entry this session has put in a ` +
						`prompt — in ${top.usedInRuns} of the ${runsRead} ` +
						`${plural(runsRead, "turn")} counted here.`
					: `“${top.title}” is what this session reaches for most — it has ` +
						`gone into ${top.usedInRuns} of the ${runsRead} ` +
						`${plural(runsRead, "turn")} counted here, alongside ` +
						`${found - 1} other ${plural(found - 1, "entry", "entries")}.`

		const res: Sockets.Pipelines.SessionEntryUsage.Response = {
			sessionId,
			summary,
			notes,
			entries: rows,
			runsRead,
			runsTotal,
			omitted
		}
		emitToUser("pipelines:sessionEntryUsage", res)
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
			"$lib/server/pipelines/runtime/reviewGate"
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
		const { resolveReview, ReviewNotFoundError, pendingReviewsFor } =
			await import("$lib/server/pipelines/runtime/reviewGate")
		try {
			resolveReview(
				params.id,
				socket.user!.id,
				params.action,
				params.values,
				// Read now, not when the run parked: a review can sit for as
				// long as the person takes, and what they may change is what
				// they may change today.
				socket.user!
			)
		} catch (err) {
			// A refused edit — an unparseable JSON field, a number that is not
			// one — leaves the entry parked and still decidable. Send the card
			// back so the person can correct the field instead of being left
			// with a toast and nothing to retry in. Idempotent by id, so a
			// client that never dropped it sees no second card.
			const stillParked = pendingReviewsFor(socket.user!.id).find(
				(r) => r.id === params.id
			)
			if (stillParked)
				emitToUser("pipelines:reviewRequested", stillParked)
			const res = {
				error:
					err instanceof ReviewNotFoundError || err instanceof Error
						? err.message
						: "That decision could not be recorded.",
				id: params.id
			}
			emitToUser("pipelines:resolveReview:error", res)
			return res
		}
		// Closed for every one of this person's tabs, not just the one that
		// decided — the same event a cancelled run sends, because from a
		// client's side the two are the same fact: this card is finished.
		emitToUser("pipelines:reviewClosed", { id: params.id })
		const res = { ok: true }
		emitToUser("pipelines:resolveReview", res)
		return res
	}
}

/**
 * The configurations inventory (admin IA 2026-08-28): every named config
 * across every spec, with its dependents — the reverse edges no workspace can
 * show. An index, deliberately not an editor: editing stays in the owning
 * workspace, one surface per fact.
 */
export const pipelinesConfigsIndex: Handler<
	Sockets.Pipelines.ConfigsIndex.Params,
	Sockets.Pipelines.ConfigsIndex.Response
> = {
	event: "pipelines:configsIndex",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user?.isAdmin) throw new Error("Unauthorized")
		const configs = await db
			.select()
			.from(schema.pipelineConfigs)
			.orderBy(asc(schema.pipelineConfigs.id))
		const specs = await db.select().from(schema.pipelineSpecs)
		const specById = new Map(
			(specs as any[]).map((s) => [s.id, { slug: s.slug, name: s.name }])
		)

		// Dependents: presets whose bindings reference the config…
		const presets = await db.select().from(schema.sessionPresets)
		const presetCount = new Map<number, number>()
		for (const p of presets as any[])
			for (const b of Object.values(
				(p.bindings ?? {}) as Record<string, { config?: number }>
			))
				if (b?.config != null)
					presetCount.set(
						b.config,
						(presetCount.get(b.config) ?? 0) + 1
					)

		// …and sessions whose scope selection points at it.
		const selections = await db
			.select()
			.from(schema.pipelineConfigSelections)
		const sessionCount = new Map<number, number>()
		for (const sel of selections as any[])
			if (sel.scopeKind === "session" && sel.configId != null)
				sessionCount.set(
					sel.configId,
					(sessionCount.get(sel.configId) ?? 0) + 1
				)

		const res: Sockets.Pipelines.ConfigsIndex.Response = {
			configs: (configs as any[]).map((c) => ({
				id: c.id,
				name: c.name,
				specSlug: specById.get(c.specId)?.slug ?? String(c.specId),
				specName:
					specById.get(c.specId)?.name ??
					specById.get(c.specId)?.slug ??
					String(c.specId),
				isDefault: !!c.isDefault,
				isImmutable: !!c.isImmutable,
				usedByPresets: presetCount.get(c.id) ?? 0,
				usedBySessions: sessionCount.get(c.id) ?? 0,
				updatedAt: c.updatedAt
					? new Date(c.updatedAt).toISOString()
					: null
			}))
		}
		emitToUser("pipelines:configsIndex", res)
		return res
	}
}

/**
 * Stop a run.
 *
 * Nothing could, before this: `runSpec` has accepted a signal since it existed,
 * but every trigger path passed none — so a run, once started, went to completion
 * whatever happened. Survivable while every triggered function was a summarize
 * step; not for an image render, which is a minute of GPU somebody may want back
 * the moment they see the prompt was wrong.
 *
 * A run that has already finished answers `found: false`. That is not an error:
 * it is a cancel that arrived late, which is what pressing Cancel just as the
 * result lands looks like from here.
 */
export const pipelinesCancelRun: Handler<
	{ runId: string },
	{ ok: boolean; found: boolean; error?: string }
> = {
	event: "pipelines:cancelRun",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user?.id
		if (!userId) {
			const res = { ok: false, found: false, error: "Not authenticated." }
			emitToUser("pipelines:cancelRun", res)
			return res
		}

		const { cancel } = await import(
			"$lib/server/pipelines/runtime/runRegistry"
		)
		const { found, allowed } = cancel(params.runId, userId)
		const res = allowed
			? { ok: true, found }
			: { ok: false, found: true, error: "Not your run." }
		emitToUser("pipelines:cancelRun", res)
		return res
	}
}

/**
 * Serializes review pushes across every socket, so the order the gate asked for
 * is the order the browser sees. Module scope rather than per-connection: the
 * transport is a process-wide seam and is reinstalled on each connect.
 */
let reviewPushes: Promise<unknown> = Promise.resolve()

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
	//
	// It also does not go through `emitToUser`, which is where connections are
	// redacted for everyone else — so the redaction is repeated here, against
	// the RECIPIENT rather than against whoever's socket last installed the
	// transport. The row read is affordable because a review is human-paced:
	// one push per gated node, per person, per run.
	import("$lib/server/pipelines/runtime/reviewGate").then(
		({ setReviewTransport }) =>
			setReviewTransport((userId, event, data) => {
				// Queued, not awaited by the caller: the gate pushes
				// `reviewRequested` and — if the run is cancelled — a
				// `reviewClosed` for the same card, and a client that received
				// them out of order would keep a card nothing can decide. The
				// chain makes delivery order the CALL order rather than
				// whichever row read finished first.
				reviewPushes = reviewPushes
					.then(async () => {
						const [row] = await db
							.select({ isAdmin: schema.users.isAdmin })
							.from(schema.users)
							.where(eq(schema.users.id, userId))
							.limit(1)
						socket.io
							.to(`user_${userId}`)
							.emit(event, redactConnections(data, row))
					})
					.catch((err) => {
						console.warn(
							"[pipelines] could not deliver a review push:",
							err
						)
					})
			})
	)

	register(socket, pipelinesList, emitToUser)
	register(socket, pipelinesConfigsIndex, emitToUser)
	register(socket, pipelinesGet, emitToUser)
	register(socket, pipelinesSetOption, emitToUser)
	register(socket, pipelinesClearOption, emitToUser)
	register(socket, pipelinesSetOptions, emitToUser)
	register(socket, pipelinesRun, emitToUser)
	register(socket, pipelinesRunExplain, emitToUser)
	register(socket, pipelinesPreviewRetrieval, emitToUser)
	register(socket, pipelinesMessageExplain, emitToUser)
	register(socket, pipelinesArtifactRuns, emitToUser)
	register(socket, pipelinesSessionEntryUsage, emitToUser)
	register(socket, pipelinesCancelRun, emitToUser)
	register(socket, pipelinesSelectConfig, emitToUser)
	register(socket, pipelinesCreateConfig, emitToUser)
	register(socket, pipelinesSetPresetActions, emitToUser)
	register(socket, pipelinesRenameConfig, emitToUser)
	register(socket, pipelinesDeleteConfig, emitToUser)
	register(socket, pipelinesConfigNotices, emitToUser)
	register(socket, pipelinesAcknowledgeConfigNotices, emitToUser)
	register(socket, pipelinesCreatePrompt, emitToUser)
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
	register(socket, pipelinesScripts, emitToUser)
	register(socket, pipelinesCreateScript, emitToUser)
	register(socket, pipelinesCloneScript, emitToUser)
	register(socket, pipelinesUpdateScript, emitToUser)
	register(socket, pipelinesDeleteScript, emitToUser)
	register(socket, pipelinesExportScripts, emitToUser)
	register(socket, pipelinesImportScripts, emitToUser)
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
