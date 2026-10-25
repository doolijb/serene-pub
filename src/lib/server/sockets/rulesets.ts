/**
 * 🚧 Admin › Rulesets (PLAN-ruleset-editor §5): the sockets over
 * `rulesets/pubRulesets.ts`. Every event is an administrator's; a refusal
 * comes back as its sentence on `<event>:error`. After a write the caller's
 * list is refreshed, as the genre sockets do.
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import {
	createPubRuleset,
	deletePubRuleset,
	listRulesets,
	publishPubRuleset,
	PubRulesetRefusal,
	retirePubRuleset,
	rulesetDetail,
	rulesetTemplateCards,
	saveRulesetDraft,
	scriptSeedKeyFor,
	unretirePubRuleset
} from "$lib/server/rulesets/pubRulesets"
import { askModelAboutPlaytest, tryOutRuleset, TryOutRefusal } from "$lib/server/rulesets/tryOut"

const adminOnly = (socket: any) => {
	if (!socket.user?.isAdmin) throw new Error("Only an administrator can change rulesets.")
}

const message = (e: unknown): string =>
	e instanceof PubRulesetRefusal || e instanceof TryOutRefusal || e instanceof Error ? e.message : String(e)

export const rulesetsList: Handler<Sockets.Rulesets.List.Params, Sockets.Rulesets.List.Response> = {
	event: "rulesets:list",
	handler: async (socket, _params, emitToUser) => {
		adminOnly(socket)
		const res = { rulesets: await listRulesets(db as any), templates: rulesetTemplateCards() }
		emitToUser("rulesets:list", res)
		return res
	}
}

export const rulesetsDetail: Handler<Sockets.Rulesets.Detail.Params, Sockets.Rulesets.Detail.Response> = {
	event: "rulesets:detail",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		const ruleset = await rulesetDetail(db as any, String(params?.rulesetId ?? ""))
		const res = ruleset
			? { ruleset }
			: { rulesetId: String(params?.rulesetId ?? ""), error: `There is no ruleset called '${params?.rulesetId}'.` }
		emitToUser(ruleset ? "rulesets:detail" : "rulesets:detail:error", res)
		return res
	}
}

/** A write's shared tail: answer, refresh the list, and the detail when asked. */
async function afterWrite(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	rulesetId: string | undefined
) {
	await emitToUser("rulesets:list", { rulesets: await listRulesets(db as any), templates: rulesetTemplateCards() })
	if (rulesetId) {
		const ruleset = await rulesetDetail(db as any, rulesetId)
		if (ruleset) emitToUser("rulesets:detail", { ruleset })
	}
	void socket
}

export const rulesetsCreate: Handler<Sockets.Rulesets.Create.Params, Sockets.Rulesets.Create.Response> = {
	event: "rulesets:create",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user?.isAdmin) {
			const res = { error: "Only an administrator can make a ruleset." }
			emitToUser("rulesets:create:error", res)
			return res
		}
		try {
			const { rulesetId } = await createPubRuleset(db as any, {
				ownerSlug: params.ownerSlug,
				name: params.name,
				label: params.label,
				from: params.from ?? null,
				// 🚧 Paste a document (D8): a shared ruleset's JSON, taken under the new id.
				...(params.document !== undefined && params.document !== null ? { document: params.document } : {}),
				userId: socket.user.id
			})
			const res = { rulesetId }
			emitToUser("rulesets:create", res)
			await afterWrite(socket, emitToUser, undefined)
			return res
		} catch (e) {
			const res = { error: message(e) }
			emitToUser("rulesets:create:error", res)
			return res
		}
	}
}

export const rulesetsSaveDraft: Handler<Sockets.Rulesets.SaveDraft.Params, Sockets.Rulesets.SaveDraft.Response> = {
	event: "rulesets:saveDraft",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		try {
			const { findings } = await saveRulesetDraft(db as any, params.rulesetId, params.draft, {
				label: params.label
			})
			const res = { rulesetId: params.rulesetId, findings }
			emitToUser("rulesets:saveDraft", res)
			await afterWrite(socket, emitToUser, params.rulesetId)
			return res
		} catch (e) {
			// 🚧 A refusal names the ruleset it is about (RF fix 6): an editor takes its own, never another tab's.
			const res = { rulesetId: String(params?.rulesetId ?? ""), error: message(e) }
			emitToUser("rulesets:saveDraft:error", res)
			return res
		}
	}
}

export const rulesetsPublish: Handler<Sockets.Rulesets.Publish.Params, Sockets.Rulesets.Publish.Response> = {
	event: "rulesets:publish",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		try {
			const { version } = await publishPubRuleset(db as any, params.rulesetId, {
				userId: socket.user.id,
				version: params.version,
				acknowledgeUpgrade: !!params.acknowledgeUpgrade
			})
			const res = { rulesetId: params.rulesetId, version }
			emitToUser("rulesets:publish", res)
			await afterWrite(socket, emitToUser, params.rulesetId)
			return res
		} catch (e) {
			// 🚧 A refusal names the ruleset it is about (RF fix 6): an editor takes its own, never another tab's.
			const res = { rulesetId: String(params?.rulesetId ?? ""), error: message(e) }
			emitToUser("rulesets:publish:error", res)
			return res
		}
	}
}

export const rulesetsRetire: Handler<Sockets.Rulesets.Retire.Params, Sockets.Rulesets.Retire.Response> = {
	event: "rulesets:retire",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		try {
			if (params.retired === false) await unretirePubRuleset(db as any, params.rulesetId)
			else await retirePubRuleset(db as any, params.rulesetId)
			const res = { rulesetId: params.rulesetId, retired: params.retired !== false }
			emitToUser("rulesets:retire", res)
			await afterWrite(socket, emitToUser, params.rulesetId)
			return res
		} catch (e) {
			// 🚧 A refusal names the ruleset it is about (RF fix 6): an editor takes its own, never another tab's.
			const res = { rulesetId: String(params?.rulesetId ?? ""), error: message(e) }
			emitToUser("rulesets:retire:error", res)
			return res
		}
	}
}

export const rulesetsDelete: Handler<Sockets.Rulesets.Delete.Params, Sockets.Rulesets.Delete.Response> = {
	event: "rulesets:delete",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		try {
			await deletePubRuleset(db as any, params.rulesetId)
			const res = { rulesetId: params.rulesetId }
			emitToUser("rulesets:delete", res)
			await afterWrite(socket, emitToUser, undefined)
			return res
		} catch (e) {
			// 🚧 A refusal names the ruleset it is about (RF fix 6): an editor takes its own, never another tab's.
			const res = { rulesetId: String(params?.rulesetId ?? ""), error: message(e) }
			emitToUser("rulesets:delete:error", res)
			return res
		}
	}
}

/**
 * Try it out (§6.6): run the draft on a sample sheet; nothing is written.
 * 🚧 Also every run of the editor (D8): the preview, Try this function
 * (`fn`), Playtest a scene and Run it N times (`repeat`).
 */
export const rulesetsTryOut: Handler<Sockets.Rulesets.TryOut.Params, Sockets.Rulesets.TryOut.Response> = {
	event: "rulesets:tryOut",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		try {
			const result = await tryOutRuleset(db as any, params.rulesetId, {
				rigour: params.rigour,
				sample: params.sample,
				party: params.party,
				deltas: params.deltas as any,
				settings: params.settings,
				seed: params.seed,
				document: params.document,
				scripts: !!params.scripts,
				// 🚧 Try this function and Run it N times (D8, lane A4, 2026-10-23).
				...(typeof params.fn === "string" && params.fn ? { fn: params.fn } : {}),
				...(typeof params.repeat === "number" && params.repeat > 1 ? { repeat: params.repeat } : {})
			})
			const res = { rulesetId: params.rulesetId, ...(params.runId ? { runId: params.runId } : {}), result }
			emitToUser("rulesets:tryOut", res)
			return res
		} catch (e) {
			// 🚧 A draft refused for its findings says them as a list too (RF fix 6): the editor maps them onto its rows.
			const findings = e instanceof TryOutRefusal && e.findings ? { findings: e.findings } : {}
			const res = { ...(params?.runId ? { runId: params.runId } : {}), error: message(e), ...findings }
			emitToUser("rulesets:tryOut:error", res)
			return res
		}
	}
}

/**
 * 🚧 Playtest a scene, then ask the pub's Reply loadout to narrate it
 * (PLAN-rulesets-authoring D4, lane M4, 2026-10-22). Admin only; no session
 * row is written. Its answer and refusal echo `runId`.
 */
export const rulesetsAskModel: Handler<Sockets.Rulesets.AskModel.Params, Sockets.Rulesets.AskModel.Response> = {
	event: "rulesets:askModel",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		const runId = params?.runId ? { runId: params.runId } : {}
		try {
			const out = await askModelAboutPlaytest(db as any, params.rulesetId, {
				rigour: params.rigour,
				party: params.party,
				deltas: params.deltas as any,
				settings: params.settings,
				seed: params.seed,
				document: params.document,
				scripts: true,
				situation: params.situation
			})
			const res = { rulesetId: params.rulesetId, ...runId, ...out }
			emitToUser("rulesets:askModel", res)
			return res
		} catch (e) {
			const res = { ...runId, error: message(e) }
			emitToUser("rulesets:askModel:error", res)
			return res
		}
	}
}

/** The seed key for an Admin › Scripts row, stamped on first use (ruling 7). */
export const rulesetsScriptKey: Handler<Sockets.Rulesets.ScriptKey.Params, Sockets.Rulesets.ScriptKey.Response> = {
	event: "rulesets:scriptKey",
	handler: async (socket, params, emitToUser) => {
		adminOnly(socket)
		try {
			const seedKey = await scriptSeedKeyFor(db as any, params.rulesetId, Number(params.scriptId))
			const res = { rulesetId: params.rulesetId, scriptId: Number(params.scriptId), seedKey }
			emitToUser("rulesets:scriptKey", res)
			// The detail's `scriptChoices` now carry the key: re-send it (P2 wish 4).
			const ruleset = await rulesetDetail(db as any, params.rulesetId)
			if (ruleset) emitToUser("rulesets:detail", { ruleset })
			return res
		} catch (e) {
			const res = { error: message(e) }
			emitToUser("rulesets:scriptKey:error", res)
			return res
		}
	}
}

export function registerRulesetHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: (event: string, data: any) => void) => void
) {
	for (const h of [
		rulesetsList,
		rulesetsDetail,
		rulesetsCreate,
		rulesetsSaveDraft,
		rulesetsPublish,
		rulesetsRetire,
		rulesetsDelete,
		rulesetsTryOut,
		rulesetsAskModel,
		rulesetsScriptKey
	])
		register(socket, h, emitToUser)
}
