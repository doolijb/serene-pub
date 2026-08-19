/**
 * SP's existing configuration, projected into the pipeline config model.
 *
 * The rows a user has been tuning for two releases — `connections`,
 * `sampling_configs`, `context_configs`, `prompt_configs` — do not move. They
 * are read here and presented as the executor's five-layer scope chain, which
 * is what makes the two paths comparable: a pipeline run and a legacy run are
 * looking at the same values, so a difference in output is a difference in how
 * they were used and nothing else.
 *
 * The mapping is the interesting part, because SP's names and the pipeline's
 * slot names are not the same words for the same things:
 *
 * | SP row | pipeline slot | on which node |
 * |---|---|---|
 * | `context_configs.template` + `.engine` | `template` | the Assemble task |
 * | `prompt_configs.*` | `prompts` | the Assemble task |
 * | `sampling_configs` | `sampling` | the Provider |
 * | `connections` | `connection` | the Provider |
 *
 * That table is the whole migration of user configuration, stated once. When
 * 08 §5b's migration writes preset rows, it writes exactly these mappings.
 *
 * **Credentials never enter.** `ConnectionRecord.metadata` is readable by a
 * node; `material` is not, and is injected per call by the host. The API key
 * lives in `extraJson.apiKey`, encrypted, and is decrypted only inside the
 * dispatch path — never in anything a binding can see (F18).
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { ConfigWorld, OverrideRow } from "@serene-pub/sdk"
import { CORE_TEMPLATE_ENGINE } from "./renderers"

type Db = { select: any }

export interface WorldScope {
	chatId?: number
	userId?: number
	/** Which node keys carry the assemble/provider slots in the spec being run. */
	assembleNodeKey?: string
	providerNodeKey?: string
	/** The node that builds the template context, which needs the prompts too. */
	contextNodeKey?: string
}

/**
 * Build the config world for one run.
 *
 * **The scope chain is already there.** SP resolves configuration today as
 * system settings → user settings → the chat's own choice, per config type
 * (`getUserConfigurations`, and the `chats` row). That is the pipeline's scope
 * chain wearing different names, so this projects each existing layer onto its
 * equivalent rather than flattening everything to one:
 *
 * | today | scope layer |
 * |---|---|
 * | `system_settings.default*` | `instance` |
 * | `user_settings.active*` | `user` |
 * | `chats.connectionId` / `samplingConfigId` / `promptConfigId` | `chat` |
 *
 * Flattening would have "worked" and silently lost the thing that makes the
 * chain worth having: an admin changing the instance connection reaches every
 * user who has not chosen their own, and no further (12 §2).
 */
export async function buildWorld(
	db: Db,
	scope: WorldScope = {}
): Promise<ConfigWorld> {
	const assemble = scope.assembleNodeKey ?? "prompt"
	const provider = scope.providerNodeKey ?? "generate"
	const context = scope.contextNodeKey ?? "context"

	const [system] = await db.select().from(schema.systemSettings).limit(1)

	const userSettings = scope.userId
		? (
				await db
					.select()
					.from(schema.userSettings)
					.where(eq(schema.userSettings.userId, scope.userId))
					.limit(1)
			)[0]
		: undefined

	const chat = scope.chatId
		? (
				await db
					.select()
					.from(schema.chats)
					.where(eq(schema.chats.id, scope.chatId))
					.limit(1)
			)[0]
		: undefined

	const connectionRows = await db.select().from(schema.connections)
	const samplingRows = await db.select().from(schema.samplingConfigs)
	const contextRows = await db.select().from(schema.contextConfigs)
	const promptRows = await db.select().from(schema.promptConfigs)

	const overrides: OverrideRow[] = []

	/** One config choice, written at whichever layers actually made it. */
	const layer = (
		scopeKind: OverrideRow["scopeKind"],
		scopeId: string | number | undefined,
		nodeKey: string,
		slot: string,
		path: string,
		value: unknown
	) => {
		if (value === undefined || value === null) return
		overrides.push({ nodeKey, slot, path, value, scopeKind, scopeId })
	}

	// ── template: the context config's story string ──────────────────────
	const templateAt = (
		kind: OverrideRow["scopeKind"],
		id: string | number | undefined,
		configId?: number | null
	) => {
		const row = pick(contextRows, configId)
		if (row)
			layer(kind, id, assemble, "template", "source", row.template ?? "")
	}
	templateAt("instance", undefined, system?.defaultContextConfigId)
	templateAt("user", scope.userId, userSettings?.activeContextConfigId)

	// ── prompts: the authored text fields ────────────────────────────────
	const promptsAt = (
		kind: OverrideRow["scopeKind"],
		id: string | number | undefined,
		configId?: number | null
	) => {
		const row = pick(promptRows, configId)
		if (!row) return
		for (const [path, value] of Object.entries(promptFields(row))) {
			layer(kind, id, assemble, "prompts", path, value)
			// The same authored text, also on the node that builds the template
			// context. Both need it and neither can derive it from the other:
			// Assemble renders `{{systemPrompt}}` where a template asks for it,
			// while the context builder is what resolves *which* post-history
			// text wins between the config's and the speaking character's. A
			// single slot on one node would leave the other rendering blanks —
			// which is what the first parity run actually showed.
			layer(kind, id, context, "prompts", path, value)
		}
	}
	// ── params: the prompt config's numeric fields ───────────────────────
	// Numbers rather than text, so they layer onto the `params` slot. The
	// trigger is a *suppression*: below it a short chat gets no post-history
	// reminder. Missing entirely, the pipeline reminded on every turn — visible
	// only by comparing against a real chat, since a fixture with no trigger
	// configured behaves identically either way.
	const paramsAt = (
		kind: OverrideRow["scopeKind"],
		id: string | number | undefined,
		configId?: number | null
	) => {
		const row = pick(promptRows, configId) as any
		if (!row) return
		for (const key of ["postHistoryDepth", "postHistoryTokenTrigger"])
			layer(kind, id, assemble, "params", key, row[key])
	}

	promptsAt("instance", undefined, system?.defaultPromptConfigId)
	promptsAt("user", scope.userId, userSettings?.activePromptConfigId)
	promptsAt("chat", scope.chatId, chat?.promptConfigId)
	paramsAt("instance", undefined, system?.defaultPromptConfigId)
	paramsAt("user", scope.userId, userSettings?.activePromptConfigId)
	paramsAt("chat", scope.chatId, chat?.promptConfigId)

	// ── connection and sampling ──────────────────────────────────────────
	// A user cannot write a connection slot (F20); these layers are instance
	// and chat only, and the chat's choice is an admin-permitted selection
	// rather than a user override.
	layer(
		"instance",
		undefined,
		provider,
		"connection",
		"ref",
		idOrNull(system?.defaultConnectionId)
	)
	layer(
		"chat",
		scope.chatId,
		provider,
		"connection",
		"ref",
		idOrNull(chat?.connectionId)
	)
	layer(
		"instance",
		undefined,
		provider,
		"sampling",
		"ref",
		idOrNull(system?.defaultSamplingConfigId)
	)
	layer(
		"chat",
		scope.chatId,
		provider,
		"sampling",
		"ref",
		idOrNull(chat?.samplingConfigId)
	)

	return {
		overrides,
		samplingConfigs: samplingRows.map((s: any) => ({
			id: String(s.id),
			name: s.name,
			// The shape doubles as the connection kind (F17): a sampling config
			// for text generation is only offerable on a text-generation
			// connection, and saying so once here is what makes that true in the
			// UI without a second rule.
			shape: "core:shape/text-gen@1",
			values: samplingValues(s)
		})),
		connections: connectionRows.map((c: any) => ({
			id: String(c.id),
			name: c.name,
			kind: "core:shape/text-gen@1",
			metadata: {
				model: c.model ?? undefined,
				tokenizer: c.tokenCounter ?? undefined,
				promptFormat: c.promptFormat ?? undefined
			},
			// Empty by construction. Material is resolved inside the dispatch
			// path from the encrypted column and never travels with the world —
			// a credential in this object would be readable by every binding.
			material: {}
		})),
		activeConnection: {}
	}
}

const idOrNull = (v: number | null | undefined) =>
	v == null ? undefined : String(v)

const pick = (rows: any[], id?: number | null): any | undefined =>
	id == null ? undefined : rows.find((r) => r.id === id)

/**
 * The authored text fields of a prompt config, as `prompts` slot paths.
 *
 * Enumerated rather than spread, because a prompt config row also carries ids,
 * names and flags that are not prompts — and a slot that quietly accepts
 * everything is a slot nobody can render a form for (12 §2).
 */
function promptFields(p: any): Record<string, unknown> {
	const fields: Record<string, unknown> = {}
	for (const key of [
		"systemPrompt",
		"postHistoryInstructions",
		"instructions",
		"exampleDialogue",
		// Narrator-only, and load-bearing: it is the name on the seed line in
		// no-perspective mode, and `{{narratorName}}` in the config's own text.
		// Absent from this list, a renamed narrator ("The GM") seeded as
		// "Narrator" and read as one thing in the prompt and another in the UI.
		"narratorName"
	])
		if (p[key] != null) fields[key] = p[key]
	return fields
}

/**
 * Sampler values, minus the bookkeeping columns.
 *
 * Handed to the adapter uninterpreted (12 §2, 17 §1a) — core does not know what
 * `mirostatTau` means and should not pretend to. What core *does* do is record
 * which fields the adapter honoured and which it dropped, which is the only way
 * "why does mirostat do nothing" is ever answerable.
 */
function samplingValues(s: any): Record<string, unknown> {
	const skip = new Set([
		"id",
		"name",
		"seedKey",
		"isImmutable",
		"createdAt",
		"updatedAt"
	])
	return Object.fromEntries(
		Object.entries(s).filter(([k, v]) => !skip.has(k) && v !== null)
	)
}
