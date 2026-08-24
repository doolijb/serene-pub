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
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { resolvePromptFields } from "$lib/server/pipelines/entities/prompts"
import { declarations } from "$lib/server/pipelines/config/panel"
import { NARRATE_SPEC_ID, RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

/**
 * Reads only.
 *
 * Building a world never writes — it is a projection of what is configured, and
 * a write here would mean resolving somebody's config had a side effect on it.
 * The helpers it calls out to want a wider type, which is what the casts at
 * those call sites are for.
 */
type Db = { select: any }

export interface WorldScope {
	sessionId?: number
	/** Which node keys carry the assemble/provider slots in the spec being run. */
	assembleNodeKey?: string
	providerNodeKey?: string
	/** The node that builds the template context, which needs the prompts too. */
	contextNodeKey?: string
	/** Which pipeline is running, so its own configuration can be read. */
	specId?: string
}

/**
 * Build the config world for one run.
 *
 * **The scope chain is already there.** SP resolves configuration today as
 * system settings → user settings → the session's own choice, per config type
 * (`getUserConfigurations`, and the `sessions` row). That is the pipeline's scope
 * chain wearing different names, so this projects each existing layer onto its
 * equivalent rather than flattening everything to one:
 *
 * | today | scope layer |
 * |---|---|
 * | `system_settings.default*` | `instance` |
 * | `sessions.connectionId` / `samplingConfigId` / `promptConfigId` | `session` |
 *
 * The legacy `user_settings.active*` columns are no longer projected (ruled
 * 2026-08-24): the user layer is gone from the model, so a person's levers are
 * the session's — its config selection and its overrides.
 */
/**
 * Which legacy prompt table backs which pipeline.
 *
 * The reply pipeline and the narrator pipeline share every node key —
 * `context`, `prompt`, `generate` — because structurally they *are* the same
 * pipeline; the narrator is a different configuration of it, which is the whole
 * reason it is its own namespace. That made this projection dangerous: it read
 * `prompt_configs` unconditionally and layered the reply's system prompt onto
 * `context` at **user** and **session** scope, and those outrank the `preset` layer
 * where the narrator's own selection lives. A narrator run resolved the reply's
 * "Write one reply only…" instead of "You are {{narratorName}}…", so the one
 * thing narrating exists not to do — sound like the character reply sharing its
 * session — is what it did. The only narrator field that survived was
 * `narratorName`, because `prompt_configs` has no column to overwrite it with.
 *
 * A spec absent from this map gets no legacy prompt projection. That is right
 * for the summarize and graph namespaces (their nodes are configured from their
 * own tables) and right for a plugin's spec, which core cannot have a legacy
 * table for.
 */
const LEGACY_PROMPT_SOURCES: Record<
	string,
	{
		table: any
		systemCol: string
		sessionCol: string
	}
> = {
	[RESPOND_SPEC_ID]: {
		table: schema.promptConfigs,
		systemCol: "defaultPromptConfigId",
		sessionCol: "promptConfigId"
	},
	[NARRATE_SPEC_ID]: {
		table: schema.narratorPromptConfigs,
		systemCol: "defaultNarratorPromptConfigId",
		sessionCol: "narratorPromptConfigId"
	}
}

export async function buildWorld(
	db: Db,
	scope: WorldScope = {}
): Promise<ConfigWorld> {
	const assemble = scope.assembleNodeKey ?? "prompt"
	const provider = scope.providerNodeKey ?? "generate"
	const context = scope.contextNodeKey ?? "context"

	const [system] = await db.select().from(schema.systemSettings).limit(1)

	const session = scope.sessionId
		? (
				await db
					.select()
					.from(schema.sessions)
					.where(eq(schema.sessions.id, scope.sessionId))
					.limit(1)
			)[0]
		: undefined

	const connectionRows = await db.select().from(schema.connections)
	const samplingRows = await db.select().from(schema.samplingConfigs)
	/**
	 * No `specId` means the caller is not running a published pipeline — the
	 * parity harness builds an ad-hoc spec standing in for 0.5's session path, and
	 * that path is the reply one. Defaulting to reply keeps it comparing what it
	 * means to compare.
	 */
	const legacyPrompts = LEGACY_PROMPT_SOURCES[scope.specId ?? RESPOND_SPEC_ID]
	const promptRows = legacyPrompts
		? await db.select().from(legacyPrompts.table)
		: []

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

	// ── template: nothing to project ─────────────────────────────────────
	//
	// The story string used to be read out of `context_configs` here and
	// layered in as a literal, selected by `system_settings.defaultContextConfigId`
	// and `user_settings.activeContextConfigId`. It is a
	// `pipeline_context_templates` reference now, resolved through the config
	// layer like every other slot, so the projection is gone rather than
	// disabled — two sources for one slot is how a panel ends up showing a
	// choice the run does not make.
	//
	// Those legacy columns still exist and still point at legacy rows. Nothing
	// in 0.6 renders from them; `migrateContextTemplates` reads them once, to
	// carry each scope's selection across.

	// ── prompts: the authored text fields ────────────────────────────────
	const promptsAt = (
		kind: OverrideRow["scopeKind"],
		id: string | number | undefined,
		configId?: number | null
	) => {
		const row = pick(promptRows, configId)
		if (!row) return
		for (const [path, value] of Object.entries(promptFields(row))) {
			// Written once, at the node that owns the slot. Assemble and the
			// provider read it **by reference** (`slot.prompts({node})`, spec
			// 1.1.0) — the executor resolves the shared slot to this node's
			// values, which is what retired the double-write that used to
			// live here and the three "System" boxes it produced in the panel
			// (13 §12 finding i).
			layer(kind, id, context, "prompts", path, value)
		}
	}
	// ── params: the prompt config's numeric fields ───────────────────────
	// Numbers rather than text, so they layer onto the `params` slot. The
	// trigger is a *suppression*: below it a short session gets no post-history
	// reminder. Missing entirely, the pipeline reminded on every turn — visible
	// only by comparing against a real session, since a fixture with no trigger
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

	if (legacyPrompts) {
		const selected = {
			defaults: (system as any)?.[legacyPrompts.systemCol],
			session: (session as any)?.[legacyPrompts.sessionCol]
		}
		promptsAt("defaults", undefined, selected.defaults)
		promptsAt("session", scope.sessionId, selected.session)
		paramsAt("defaults", undefined, selected.defaults)
		paramsAt("session", scope.sessionId, selected.session)
	}

	// ── connection and sampling ──────────────────────────────────────────
	// A user cannot write a connection slot (F20); these layers are instance
	// and session only, and the session's choice is an admin-permitted selection
	// rather than a user override.
	layer(
		"defaults",
		undefined,
		provider,
		"connection",
		"ref",
		idOrNull(system?.defaultConnectionId)
	)
	layer(
		"session",
		scope.sessionId,
		provider,
		"connection",
		"ref",
		idOrNull(session?.connectionId)
	)
	layer(
		"defaults",
		undefined,
		provider,
		"sampling",
		"ref",
		idOrNull(system?.defaultSamplingConfigId)
	)
	layer(
		"session",
		scope.sessionId,
		provider,
		"sampling",
		"ref",
		idOrNull(session?.samplingConfigId)
	)

	// ── the pipeline layer, which wins over everything above ─────────────
	//
	// Written last so it is *appended* after the legacy projection, and
	// `resolveConfigSources` walks candidates in SCOPE_ORDER and takes the first
	// match at each scope — so a value a person set in the pipeline panel is the
	// one that runs. Without this the panel would edit rows nothing reads, which
	// is worse than not having it: every screen would agree with the user and
	// the model would not.
	if (scope.specId) await applyPipelineLayer(db, overrides, scope)

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

/**
 * The configuration a person actually edited, layered over the legacy
 * projection.
 *
 * Three things arrive here, and they are different in kind:
 *
 *  - **`pipeline_node_overrides`** — a single value someone changed, at the
 *    scope they changed it. Written straight through at its own scope.
 *  - **the selected `pipeline_config`** — a whole named configuration, chosen
 *    per scope. Projected in at `preset`, because that is what a config *is* in
 *    12 §2's chain: a named bundle sitting under the individual overrides and
 *    over the instance defaults.
 *  - **prompt references** — a config stores the *id* of a `pipeline_prompts`
 *    row, and a node needs the words. Dereferenced here, which is the same move
 *    the dispatch path makes for a connection: the reference is what is stored,
 *    the value is what runs.
 */
async function applyPipelineLayer(
	db: Db,
	overrides: OverrideRow[],
	scope: WorldScope
): Promise<void> {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, scope.specId!))
		.limit(1)
	if (!spec) return

	const push = (
		scopeKind: OverrideRow["scopeKind"],
		scopeId: string | number | undefined,
		nodeKey: string,
		slot: string,
		path: string,
		value: unknown
	) => {
		if (value === undefined) return
		overrides.push({ nodeKey, slot, path, value, scopeKind, scopeId })
	}

	// Which of this spec's slots hold a *reference* rather than a value, read
	// from the declarations rather than assumed. The row stores the slot's
	// authored name and a plugin may call its variables slot anything, so a
	// hard-coded `'variables'` would leave a plugin's reference undereferenced —
	// and the node would receive a row id where it expected a template.
	const allDecls = spec.activeVersionId
		? await declarations(db as any, spec.activeVersionId)
		: []
	const varDecls = allDecls.filter(
		(d) => d.control === "variable-template-ref"
	)
	const variableSlots = new Set(varDecls.map((d) => d.slot))
	/**
	 * Which slots hold a *context template* reference — read from the
	 * declarations for the same reason the variable slots are: the row stores
	 * the slot's authored name, and a plugin may call its template slot
	 * anything. A hard-coded `'template'` would leave a plugin's reference
	 * undereferenced, and the node would receive a row id where it expected a
	 * story string.
	 */
	const templateSlots = new Set(
		allDecls
			.filter((d) => d.control === "context-template-ref")
			.map((d) => d.slot)
	)

	/**
	 * A layout reference becomes the template itself.
	 *
	 * Returns undefined for a dangling id, which `push` then drops — the render
	 * path falls through to its in-code default and still emits today's bytes.
	 * A customization is the right thing to lose here; a prompt is not.
	 */
	const derefLayout = async (value: unknown) => {
		if (typeof value !== "number") return undefined
		const { resolveVariableTemplate } = await import(
			"$lib/server/pipelines/entities/variableTemplates"
		)
		return (await resolveVariableTemplate(db as any, value)) ?? undefined
	}

	/**
	 * A template reference becomes the source itself.
	 *
	 * Returns undefined for a dangling id, which `push` then drops — the node
	 * falls through to its in-code default layout rather than rendering an id.
	 * Losing a customization is the right cost here; losing the prompt is not.
	 */
	const derefTemplate = async (value: unknown) => {
		if (typeof value !== "number") return undefined
		const { resolveContextTemplate } = await import(
			"$lib/server/pipelines/entities/contextTemplates"
		)
		const row = await resolveContextTemplate(db as any, value)
		return row ? row.source : undefined
	}

	// ── the selected config, as the preset layer ─────────────────────────
	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const selected = await resolveSelectedConfig(
		db as any,
		spec.id,
		spec.slug,
		{
			sessionId: scope.sessionId
		}
	)

	if (selected) {
		const values = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, selected.configId))

		for (const v of values as any[]) {
			if (v.slot === "prompts") {
				// A reference. The fields it names become individual paths, so
				// per-path resolution still works above it — someone overriding
				// one field does not pin the rest of the prompt.
				const fields = await resolvePromptFields(
					db as any,
					Number(v.value)
				)
				for (const [field, text] of Object.entries(fields))
					push("preset", undefined, v.nodeKey, "prompts", field, text)
				continue
			}
			if (templateSlots.has(v.slot)) {
				// Addressed at `source`, which is where the slot's value has
				// always lived — the reference is an implementation detail of
				// where the string came from, not a change to what the node
				// reads.
				push(
					"preset",
					undefined,
					v.nodeKey,
					v.slot,
					"source",
					await derefTemplate(v.value)
				)
				continue
			}
			if (variableSlots.has(v.slot)) {
				push(
					"preset",
					undefined,
					v.nodeKey,
					v.slot,
					v.path ?? "",
					await derefLayout(v.value)
				)
				continue
			}
			push("preset", undefined, v.nodeKey, v.slot, v.path ?? "", v.value)
		}
	}

	// ── individual overrides, at the scope each was written at ───────────
	const rows = await db
		.select()
		.from(schema.pipelineNodeOverrides)
		.where(eq(schema.pipelineNodeOverrides.specId, spec.id))

	// Session rows are the only override scope left (ruled 2026-08-24) — the
	// instance's tuning lives in the selected config, projected above.
	for (const o of rows as any[]) {
		if (o.scopeKind !== "session" || o.scopeId !== scope.sessionId) continue
		const scopeKind: OverrideRow["scopeKind"] = "session"
		const scopeId = scope.sessionId

		if (o.slot === "prompts" && !(o.path ?? "")) {
			// A prompts-ref override stores the *id* of a `pipeline_prompts`
			// row — the same shape a config value stores, dereferenced the
			// same way, because a node needs the words and not the number.
			// Pushed per field so per-path resolution above it still works.
			const fields = await resolvePromptFields(db as any, Number(o.value))
			for (const [field, text] of Object.entries(fields))
				push(scopeKind, scopeId, o.nodeKey, "prompts", field, text)
			continue
		}

		if (templateSlots.has(o.slot)) {
			push(
				scopeKind,
				scopeId,
				o.nodeKey,
				o.slot,
				"source",
				await derefTemplate(o.value)
			)
			continue
		}

		if (variableSlots.has(o.slot)) {
			// Addressed per key, so overriding the characters layout says
			// nothing about the personas one (F20) — which is why the path is
			// carried through rather than collapsed the way a prompts-ref is.
			push(
				scopeKind,
				scopeId,
				o.nodeKey,
				o.slot,
				o.path ?? "",
				await derefLayout(o.value)
			)
			continue
		}

		push(scopeKind, scopeId, o.nodeKey, o.slot, o.path ?? "", o.value)
	}

	// ── the floor: a prompts slot always resolves to words ───────────────
	//
	// Every layer above this is optional — a config may not carry a prompts
	// value, an instance may have no legacy config to project, and clearing
	// an override deletes a row rather than writing one. With nothing
	// underneath, the node ran with empty instructions, which does not read
	// as "no prompt is selected"; it reads as the model ignoring its
	// character sheet. So the namespace's own default is projected at
	// `defaults`, below everything anyone chose: the pipeline's shipped
	// prompt, or the first it ships with (`defaultPromptFor`).
	//
	// Pushed after the legacy projection, so on a migrated instance the
	// user's own carried-over wording still wins at this scope — this fills
	// the hole rather than papering over what somebody already had.
	if (!spec.activeVersionId) return
	const promptNodes = new Set<string>()
	for (const d of await declarations(db as any, spec.activeVersionId))
		if (d.control === "prompts-ref") promptNodes.add(d.nodeKey)

	if (promptNodes.size) {
		const { defaultPromptFor } = await import(
			"$lib/server/pipelines/boot/seedPrompts"
		)
		const fallbackId = await defaultPromptFor(db as any, spec.id)
		if (fallbackId != null) {
			const fields = await resolvePromptFields(db as any, fallbackId)
			for (const nodeKey of promptNodes)
				for (const [field, text] of Object.entries(fields))
					push("defaults", undefined, nodeKey, "prompts", field, text)
		}
	}

	// ── the same floor, for layouts ──────────────────────────────────────
	//
	// Weaker than the prompts floor by design. A variables slot that resolves
	// to nothing is not a broken run: every render site keeps its in-code
	// expression and uses it when no template arrives, so the prompt comes out
	// byte-identical to what it was before this feature existed. This projects
	// the shipped row anyway so the *panel* shows what is actually happening —
	// an empty picker above output that plainly has a layout is the kind of
	// discrepancy that costs an afternoon.
	if (varDecls.length) {
		const { defaultVariableTemplateFor } = await import(
			"$lib/server/pipelines/boot/seedVariableTemplates"
		)
		const shipped = new Map<string, unknown>()
		for (const d of varDecls) {
			if (!d.variableId) continue
			if (!shipped.has(d.variableId))
				shipped.set(
					d.variableId,
					await derefLayout(
						await defaultVariableTemplateFor(
							db as any,
							d.variableId
						)
					)
				)
			push(
				"defaults",
				undefined,
				d.nodeKey,
				d.slot,
				d.path,
				shipped.get(d.variableId)
			)
		}
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
