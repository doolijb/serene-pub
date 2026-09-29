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
 * | `prompt_configs.*` | `prompts` | the Assemble task |
 * | `sampling_configs` | `sampling` | the oracle |
 * | `connections` | `connection` | the oracle |
 *
 * That table is the whole migration of user configuration, stated once. When
 * 08 §5b's migration writes preset rows, it writes exactly these mappings.
 *
 * ⚠ It used to list `context_configs.template` + `.engine` → `template` as a
 * fourth row, and that line documented a path that never existed. The story
 * string is a `pipeline_context_templates` reference resolved through the
 * config layer (see the "template: nothing to project" note below), and the
 * `.engine` half in particular was fiction in both directions: the legacy
 * column was never read here, and the *new* engine was resolved and then
 * thrown away one line later in `derefTemplate` — which is the bug
 * `pushTemplate` exists to make unrepeatable. `migrateContextTemplates` reads
 * the legacy columns once, to carry each scope's selection across.
 *
 * **Credentials never enter.** `ConnectionRecord.metadata` is readable by a
 * node; `material` is not, and is injected per call by the host. The API key
 * lives in `extraJson.apiKey`, encrypted, and is decrypted only inside the
 * dispatch path — never in anything a binding can see (F18).
 */

import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	S,
	SLOT_VALUE,
	isTransformId,
	type ConfigWorld,
	type OverrideRow
} from "@serene-pub/sdk"
import {
	capabilityDefaults,
	capabilityForSamplingShape
} from "$lib/server/connections/capabilityDefaults"
// Imported rather than re-declared. It was a `const TEXT_CAPABILITY` at the
// bottom of this file and another in `capabilityTarget.ts`, which is the same
// two-spellings shape the dropped `system_settings` columns had — and the string
// keys the `connection_defaults` PRIMARY KEY (as its two sides since 0183), so a
// divergence would not be a mismatch, it would be a capability nothing can ever
// satisfy.
import { TEXT_CAPABILITY } from "$lib/server/connections/capabilityTarget"
import { completionTemplatesByKey } from "$lib/server/connections/completionTemplates"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { resolvePromptFields } from "$lib/server/pipelines/entities/prompts"
import { declarations, type Decl } from "$lib/server/pipelines/config/panel"
import {
	NARRATE_CHARACTER_SPEC_ID,
	NARRATE_SPEC_ID,
	RESPOND_SPEC_ID
} from "$lib/server/pipelines/specs"
import { storedCapabilities } from "$lib/server/pipelines/runtime/capabilityGuard"
import { resolveWireMode } from "$lib/server/connections/resolve"

export interface WorldScope {
	sessionId?: number
	/** Which node keys carry the assemble/connection slots in the spec being run. */
	assembleNodeKey?: string
	oracleNodeKey?: string
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
 * | `connection_defaults` (per capability) | `defaults` |
 * | `system_settings.default*PromptConfigId` | `defaults` |
 * | `sessions.samplingConfigId` / `promptConfigId` | `session` |
 *
 * The connection/sampling half of that first row used to read
 * `system_settings.default_connection_id` / `default_sampling_id`. Those columns
 * are gone (0181) and `connection_defaults` is the only store; the prompt
 * columns beside them are 0.5 archives and stay.
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

/**
 * Which legacy config's sampling column backs which pipeline —
 * `LEGACY_PROMPT_SOURCES` plus the side-character turn, which resolves under
 * the narrator config's compute while rendering its own words. See the
 * projection block below for why this tier is in the world at all, and why
 * the connection column beside it is not.
 */
const LEGACY_CONNECTION_SOURCES: typeof LEGACY_PROMPT_SOURCES = {
	[RESPOND_SPEC_ID]: LEGACY_PROMPT_SOURCES[RESPOND_SPEC_ID]!,
	[NARRATE_SPEC_ID]: LEGACY_PROMPT_SOURCES[NARRATE_SPEC_ID]!,
	[NARRATE_CHARACTER_SPEC_ID]: LEGACY_PROMPT_SOURCES[NARRATE_SPEC_ID]!
}

/**
 * **Reads only.** Building a world never writes — it is a projection of what is
 * configured, and a write here would mean resolving somebody's config had a
 * side effect on it.
 *
 * That invariant used to be spelled as a `type Db = { select: any }` alias,
 * which bought it at a price that was not worth paying: `any` on `select` makes
 * every ROW read through it an `any` too, so a column this schema does not have
 * would have type-checked in all five of this file's readers. It is now a rule
 * this file keeps rather than one the parameter type enforces — and the rows
 * are checked.
 */
export async function buildWorld(
	db: Db,
	scope: WorldScope = {}
): Promise<ConfigWorld> {
	const assemble = scope.assembleNodeKey ?? "prompt"
	const oracle = scope.oracleNodeKey ?? "generate"
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
	/**
	 * The models, for the one fact a resolved PAIR carries beyond its
	 * endpoint: the model's own context window (0114). Published to the
	 * executor as `world.models`, so `resolveSlot` can hand a node the
	 * window the request is actually sent against — read by the ONE window
	 * computation (`runtime/contextWindow.ts`, R-8).
	 */
	const modelRows = await db.select().from(schema.connectionModels)
	const samplingRows = await db.select().from(schema.samplingConfigs)
	/**
	 * Every completion template, once, for the whole projection below.
	 *
	 * One query rather than one per connection, and no cache anywhere:
	 * `buildWorld` runs per run, so an admin's edit is on the wire for the next
	 * generation. See `connections/completionTemplates.ts` for why a cache here
	 * would pin every render on the instance to whatever the first one used.
	 */
	const completionTemplateRows = await completionTemplatesByKey(db)
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
	/**
	 * Which legacy config's SAMPLING column this spec resolves under — one
	 * more spec than the prompts: a side character's turn ran against the
	 * narrator config's compute through `resolveTaskConfig`, while its words
	 * come from its own context type. Same rows as `promptRows` where the two
	 * maps agree, read once.
	 */
	const legacyConnection =
		LEGACY_CONNECTION_SOURCES[scope.specId ?? RESPOND_SPEC_ID]
	const legacyConnectionRows = !legacyConnection
		? []
		: legacyConnection === legacyPrompts
			? promptRows
			: await db.select().from(legacyConnection.table)

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
			// oracle read it **by reference** (`slot.prompts({node})`, spec
			// 1.1.0) — the executor resolves the shared slot to this node's
			// values, which is what retired the double-write that used to
			// live here and the three "System" boxes it produced in the panel
			// (13 §12 finding i).
			layer(kind, id, context, "prompts", path, value)
		}
	}
	if (legacyPrompts) {
		promptsAt(
			"defaults",
			undefined,
			(system as any)?.[legacyPrompts.systemCol]
		)
		promptsAt(
			"session",
			scope.sessionId,
			(session as any)?.[legacyPrompts.sessionCol]
		)
	}

	// ── connection and sampling ──────────────────────────────────────────
	// A user cannot write a connection slot (F20); these layers are instance
	// and session only, and the session's choice is an admin-permitted selection
	// rather than a user override.
	//
	// The instance layer is keyed by CAPABILITY (`connection_defaults`), so the
	// oracle gets the default for the thing it actually needs to do rather
	// than the default for whatever family it was filed under. The session layer
	// is written further down — after the pipeline layer, deliberately; its
	// block says why — and is still text-only, because layering
	// `sessions.connection_id` onto an image oracle would hand a session's
	// chat connection to a backend that has never heard of a temperature.
	const defaultsByCapability = await capabilityDefaults(db)
	// The shape is the fallback and `??` is what keeps it one: a slot that named
	// a capability never reads its declarations a second time, and a slot
	// authored before capabilities existed still gets the answer it always got.
	const oracleCapability =
		requiredTransform(await connectionSlotRequires(db, scope, oracle)) ??
		capabilityForSamplingShape(await connectionSlotShape(db, scope, oracle))
	const oracleIsText = oracleCapability === TEXT_CAPABILITY
	// `undefined` means the slot's shape names no capability — an embeddings or
	// MCP connection slot. Those layer NO default: the instance's "default
	// connection" is a text connection, and handing it to a slot that wanted an
	// MCP server is the cross-modality leak this whole indirection exists to
	// prevent. It is also what they got before capabilities existed.
	const instanceDefault = oracleCapability
		? defaultsByCapability[oracleCapability]
		: undefined

	/**
	 * The legacy prompt config's own SAMPLING — the reply config's "Sampling"
	 * picker, and the narrator config's.
	 *
	 * ⚠ **A tier the run never saw until R-8.** `resolveTaskConfig` read this
	 * column at dispatch and layered it between the node's slot and the
	 * capability default — so the request could go out under samplers the
	 * budget had never heard of, since the executor resolved against this
	 * projection alone. One resolution per run means the tier lives HERE
	 * now, at the precedence it always had: above the capability default,
	 * below the pipeline panel's pick. Dispatch consumes what the run resolved
	 * and re-walks nothing.
	 *
	 * The config is the session's own where it chose one, else the instance
	 * default — the same two rows the prompts above are projected from. It
	 * lands at `defaults` scope AHEAD of the capability default, because
	 * `resolveConfigSources` takes the first candidate it finds at a scope.
	 *
	 * ⏳ **The CONNECTION column of the same row is deliberately NOT
	 * projected** (architect's decision on the U1 review, 2026-09-16). The
	 * old walk read it but a capability default — which every install that
	 * generates has — outranked it, so on those installs the column was dead
	 * and the reply went to the default. Projecting it here revived it at a
	 * precedence it never effectively had, and since the column names an
	 * endpoint with no model, a config still pointing at some other endpoint
	 * made every reply on that install refuse with "No model is chosen".
	 * This is NOT parity with the old walk; it is the half of the tier that
	 * was live, kept live. The prompt config's "AI Override" connection
	 * column is therefore read by nothing; whether it is retired or re-homed
	 * onto the pipeline panel's connection slot awaits a ruling — see
	 * plans/29 R-8.
	 */
	if (legacyConnection && oracleIsText) {
		const legacyRow =
			pick(
				legacyConnectionRows,
				(session as any)?.[legacyConnection.sessionCol]
			) ??
			pick(
				legacyConnectionRows,
				(system as any)?.[legacyConnection.systemCol]
			)
		layer(
			"defaults",
			undefined,
			oracle,
			"sampling",
			SLOT_VALUE,
			idOrNull(legacyRow?.samplingConfigId)
		)
	}

	// The table, and only the table (0181). This used to read
	// `?? (oracleIsText ? system.defaultConnectionId : undefined)`, because
	// 0175 seeded `connection_defaults` from that column ONCE and a later star
	// press landed only in the column — so the fallback existed to stop the
	// screen and the run disagreeing. Both writers now write here, so the
	// fallback has nothing left to rescue and would only be a second place for a
	// default to live.
	//
	// The PAIR, not the endpoint alone. `connection_defaults` stores both
	// halves, and the executor resolves a slot's pair against `world.connections`
	// and `world.models`; projecting only the id here left the model half to be
	// rescued at dispatch by a second walk of the same store — the walk R-8
	// retired.
	layer(
		"defaults",
		undefined,
		oracle,
		"connection",
		SLOT_VALUE,
		instanceDefault?.connectionId != null
			? {
					id: String(instanceDefault.connectionId),
					modelId: idOrNull(instanceDefault.connectionModelId) ?? null
				}
			: undefined
	)
	layer(
		"defaults",
		undefined,
		oracle,
		"sampling",
		SLOT_VALUE,
		idOrNull(instanceDefault?.samplingConfigId)
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

	// ── post-history: the prompt config's two numbers ────────────────────
	//
	// Numbers rather than text, so they layer onto the `params` slot. The
	// trigger is a *suppression*: below it a short session gets no post-history
	// reminder, because a reinforcement note two messages after the system
	// prompt is noise.
	//
	// **Onto every assemble node in the spec**, rather than onto one named key.
	// A genre that plans, narrates, gives each speaker a voice and then writes
	// the numbers down assembles four prompts in a turn, and a key names one of
	// them; the other three resolve the declaration's `0` and remind on every
	// turn while the panel shows the number somebody set. Nothing errors and
	// the prompt is well-formed, so the only evidence is a "Response reminder"
	// block in a two-message session.
	//
	// **Under the pipeline layer.** Written after it and skipped at any address
	// it already wrote, so a value set in the pipeline panel wins — the same
	// precedence the session block below canonises. An `author` row is the
	// declaration's own default rather than a choice, and does not count as set.
	//
	// **Read for a spec with no legacy table of its own.** These two describe
	// where a reminder goes and whether it goes at all, which is a property of
	// the instance rather than of any pipeline's words, and the reply config is
	// the one screen they are authored on. The TEXT projection above stays
	// keyed to the spec: words differ per agent, and handing a narrator the
	// reply's system prompt is what `LEGACY_PROMPT_SOURCES` exists to prevent.
	const postHistorySource =
		legacyPrompts ?? LEGACY_PROMPT_SOURCES[RESPOND_SPEC_ID]
	const postHistoryRows = legacyPrompts
		? promptRows
		: await db.select().from(postHistorySource.table)
	const postHistoryNodes = await assembleNodeKeys(db, scope, assemble)
	// Snapshotted before anything below is pushed: the check is "did the
	// pipeline layer decide this", and reading `overrides` live would let the
	// instance-scope row written here answer for the session-scope one, which
	// would pin every session to the instance default.
	const pipelineParams = new Set(
		overrides
			.filter((o) => o.slot === "params" && o.scopeKind !== "author")
			.map((o) => `${o.nodeKey}\u0000${o.path}`)
	)
	const postHistoryAt = (
		kind: OverrideRow["scopeKind"],
		id: string | number | undefined,
		configId?: number | null
	) => {
		const row = pick(postHistoryRows, configId) as any
		if (!row) return
		for (const key of ["postHistoryDepth", "postHistoryTokenTrigger"])
			for (const nodeKey of postHistoryNodes) {
				if (pipelineParams.has(`${nodeKey}\u0000${key}`)) continue
				layer(kind, id, nodeKey, "params", key, row[key])
			}
	}
	postHistoryAt(
		"defaults",
		undefined,
		(system as any)?.[postHistorySource.systemCol]
	)
	postHistoryAt(
		"session",
		scope.sessionId,
		(session as any)?.[postHistorySource.sessionCol]
	)

	// ── the session's own column, BELOW the panel's session-scope rows ───
	//
	// ⚠ The order of these two blocks is load-bearing. `resolveConfigSources`
	// takes the FIRST candidate it finds at each scope, and both
	// `sessions.sampling_config_id` and a session-scope `pipeline_node_overrides`
	// row live at `session` — so whichever is pushed first wins. There is no
	// comparison, no tie-break and no warning; swapping these two blocks is a
	// silent flip, which is why `world.sessionScopeOrder.int.test.ts` pins which
	// one comes back.
	//
	// Below, so among two session-scope values the one a person set in the panel
	// wins. The column is the older, blunter statement of the same wish and the
	// panel's row is the more specific one.
	//
	// ⚠ There is no `connection` twin here any more (0130). The session's
	// `connection_id` was the other half of this block and it outranked the
	// panel's pick for as long as this sat above `applyPipelineLayer`; overrides
	// are by model now, never by connection, so the only connection override
	// left is the pipeline configuration's connection slot — which is a
	// `pipeline_node_overrides` row like any other and arrives through
	// `applyPipelineLayer` above.
	//
	// Still text-only, and that is a fact about the column rather than a policy:
	// `sampling_config_id` predates there being anything but text and cannot say
	// which capability it means.
	if (oracleIsText) {
		layer(
			"session",
			scope.sessionId,
			oracle,
			"sampling",
			SLOT_VALUE,
			idOrNull(session?.samplingConfigId)
		)
	}

	/**
	 * The instance default a node falls back to when its connection slot names
	 * nothing — a plain read of the one store (0181).
	 */
	const defaultConnectionFor = (capability: string) =>
		idOrNull(defaultsByCapability[capability]?.connectionId)

	// Published under BOTH a capability key and a shape key, which is not
	// redundancy: the defaults are registered per CAPABILITY
	// (`connection_defaults`), while the executor still looks this up as
	// `world.activeConnection[kind]` with `kind` the node type's SHAPE. Only the
	// capability keys would silently empty the fallback for every spec running
	// today; only the shapes would put the new table out of the executor's
	// reach. Both, until the executor is keyed by capability too.
	//
	// ⚠ Seeded from what is REGISTERED, and nothing else. The loop used to start
	// from `new Set([TEXT_CAPABILITY, ...keys])`, so `text->text` was always
	// asked about — harmless only while the legacy column could answer it. With
	// the column gone that entry resolves to nothing, and adding a key with no
	// value is how "the instance has chat set up" becomes true on an instance
	// where nobody set it up.
	const activeConnection: Record<string, string | null> = {}
	for (const capability of Object.keys(defaultsByCapability)) {
		const id = defaultConnectionFor(capability)
		if (id) activeConnection[capability] = id
	}
	// Translated through `capabilityForSamplingShape` rather than a second table
	// mapping the other way — two spellings of one correspondence is how the
	// image shape ends up pointing at the text default on the day somebody adds
	// a capability to only one of them.
	for (const shape of [S.textGen, S.imageGen, S.tts]) {
		// All three map, but the mapper is honest about shapes it does not know
		// (embeddings, MCP) rather than calling them text, so the result is
		// checked here instead of asserted away.
		const capability = capabilityForSamplingShape(shape)
		const id = capability ? defaultConnectionFor(capability) : undefined
		if (id) activeConnection[shape] = id
	}

	/**
	 * The same store's other half — the sampling config a step falls back to
	 * when its own slot names nothing.
	 *
	 * ⚠ This was not published at all, and its absence was invisible because
	 * `resolveCapabilityTarget` applies the same fallback at *dispatch*: the
	 * call went out against this window while the executor resolved the slot to
	 * `{}`. A node that only forwards its sampling could not tell the
	 * difference; the summarize batch cutter, which has to fit a prompt into
	 * that window, clamped against nothing on every install that had not picked
	 * a sampling config per step.
	 *
	 * Keyed exactly like `activeConnection` — capability *and* shape, from the
	 * same rows, through the same translator — because the executor looks it up
	 * by the node type's shape and the store registers it by capability.
	 */
	const activeSampling: Record<string, string | null> = {}
	const defaultSamplingFor = (capability: string) =>
		idOrNull(defaultsByCapability[capability]?.samplingConfigId)
	for (const capability of Object.keys(defaultsByCapability)) {
		const id = defaultSamplingFor(capability)
		if (id) activeSampling[capability] = id
	}
	for (const shape of [S.textGen, S.imageGen, S.tts]) {
		const capability = capabilityForSamplingShape(shape)
		const id = capability ? defaultSamplingFor(capability) : undefined
		if (id) activeSampling[shape] = id
	}

	return {
		overrides,
		samplingConfigs: samplingRows.map((s: any) => ({
			id: String(s.id),
			name: s.name,
			// The shape doubles as the connection kind (F17): a sampling config
			// for text generation is only offerable on a text-generation
			// connection, and saying so once here is what makes that true in the
			// UI without a second rule. It is the row's own shape now — hardcoding
			// text-gen here would have handed an image config to a text oracle
			// the moment a second modality existed.
			shape: s.shape ?? "core:shape/text-gen@1",
			values: s.values ?? {},
			// Carried rather than applied: the executor's slot resolution runs the
			// filter, so that a node-level override in a spec can sit ABOVE the
			// switchboard instead of being erased by it.
			enabled: s.enabled ?? []
		})),
		connections: connectionRows.map((c: any) => ({
			id: String(c.id),
			name: c.name,
			kind: "core:shape/text-gen@1",
			metadata: {
				/**
				 * No default identifier rides here: connections have no
				 * default model, and the descriptor cannot know which model
				 * a slot will name. A reader debugging a prompt finds what
				 * actually went on the wire on the run's receipt, keyed by
				 * the resolved pair.
				 */
				tokenizer: c.tokenCounter ?? undefined,
				/**
				 * The KEY, which is the reference the row stores and the
				 * receipt reports. A reader debugging a prompt can look it up.
				 */
				promptFormat: c.promptFormat ?? undefined,
				/**
				 * The template ITSELF, dereferenced — the same move this file
				 * already makes for prompts ("a config stores the *id* of a
				 * `pipeline_prompts` row, and a node needs the words").
				 *
				 * ⚠ Without this the key was the only thing that travelled, and
				 * `completionTemplateOf` resolves a bare key **against the
				 * built-ins** — so a template an admin wrote resolved to no
				 * built-in and rendered as Vicuna. Delimiters authored, saved,
				 * shown back, and never reaching a single prompt.
				 *
				 * `undefined` for a connection whose format names nothing, which
				 * is the same absence `promptFormat` carries beside it; the
				 * renderer answers all three absent states through
				 * `completionTemplateOf` exactly as before.
				 */
				completionTemplate: c.promptFormat
					? completionTemplateRows.get(c.promptFormat)
					: undefined,
				/**
				 * Which METHOD this connection wants to be called by — and the
				 * reason the two fields above may have nothing to do.
				 *
				 * In `chat` wire mode the roles carry the structure: the render
				 * emits role-tagged messages and the delimiters never apply. The
				 * assemble node reads this to decide which of the two shapes to
				 * produce, and the SENDING adapter reads the same value off the
				 * row it is handed (`withWireMode`) to decide which request to
				 * build. One resolution, two readers — which is the whole of the
				 * fix: the shape a prompt is BUILT in and the shape it is SENT in
				 * used to be decided independently, by a spec that could not see
				 * an adapter's `extraJson` flag and an adapter that never saw the
				 * render.
				 *
				 * Resolved live from the row rather than read off the cached
				 * capability set beside it — see `resolveWireMode`: the cache on
				 * an existing row was written before these keys existed and names
				 * neither mode.
				 */
				wireMode: resolveWireMode(c)
			},
			// Empty by construction. Material is resolved inside the dispatch
			// path from the encrypted column and never travels with the world —
			// a credential in this object would be readable by every binding.
			material: {},
			// On `metadata`'s side of the line (01 §10): a binding asking whether
			// it may send an image is asking about the wire protocol, not about a
			// credential. The stored cache rather than a fresh resolution —
			// deriving it would mean importing the adapter module, which is the
			// one thing the manifest exists to avoid. `{}` is UNDETERMINED, the
			// shape of a connection nobody has tested, and never "can do
			// nothing": a reader that treats it as a denial hides working
			// connections.
			// Intersected against what the manifest still declares — same reader
			// the bind guard and the picker use, so all three agree about what a
			// connection can do.
			capabilities: storedCapabilities(c)
		})),
		models: modelRows.map((m) => ({
			id: String(m.id),
			connectionId: String(m.connectionId),
			contextWindow: m.contextWindow ?? null
		})),
		activeConnection,
		activeSampling
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
/**
 * The oracle node's connection declaration, as its spec authored it.
 *
 * Read from the spec's own declarations rather than guessed from the node key,
 * because the key is the author's ("generate", "render", "narrate") and says
 * nothing about what it talks to. `undefined` when there is no spec in scope —
 * the legacy path, which is text by construction — or when the node declares no
 * connection at all.
 */
async function oracleConnectionDecl(
	db: Db,
	scope: WorldScope,
	oracleKey: string
): Promise<Decl | undefined> {
	if (!scope.specId) return undefined
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, scope.specId))
		.limit(1)
	if (!spec?.activeVersionId) return undefined
	const decls = await declarations(db, spec.activeVersionId)
	return decls.find(
		(d) => d.nodeKey === oracleKey && d.control === "connection-ref"
	)
}

/**
 * What the connection in that slot must be able to *do*.
 *
 * The successor to `connectionSlotShape`, and read before it. A shape asserts a
 * modality — "this is an image connection" — where `requires` names a transform
 * the backend can actually be asked about, which is the same fact without the
 * assumption that a backend is only one thing. Absent for every slot authored
 * before capabilities existed, and the caller falls back to the shape.
 */
async function connectionSlotRequires(
	db: Db,
	scope: WorldScope,
	oracleKey: string
): Promise<readonly string[] | undefined> {
	return (await oracleConnectionDecl(db, scope, oracleKey))?.requires
}

/** Which modality that slot speaks. Superseded — see `connectionSlotRequires`. */
async function connectionSlotShape(
	db: Db,
	scope: WorldScope,
	oracleKey: string
): Promise<string | undefined> {
	return (await oracleConnectionDecl(db, scope, oracleKey))?.shape
}

/** The task that renders a prompt. Its `params` carry the post-history pair. */
const ASSEMBLE_TYPE_ID = "core:task/assemble"

/**
 * Every node in the spec that assembles a prompt.
 *
 * Read from the spec's own nodes rather than named by the caller: a key names
 * ONE node, and a pipeline may assemble a planner's prompt, a narrator's, one
 * per speaking voice and a state-keeper's in a single turn. Every version of
 * the type counts — the pair is the type's post-history contract, and a node
 * whose pin does not declare it simply resolves the address to nothing.
 *
 * The caller's single key is the answer when there is no spec in scope (the
 * parity harness's ad-hoc spec) and when the spec has no published version.
 */
async function assembleNodeKeys(
	db: Db,
	scope: WorldScope,
	fallback: string
): Promise<string[]> {
	if (!scope.specId) return [fallback]
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, scope.specId))
		.limit(1)
	if (!spec?.activeVersionId) return [fallback]
	const nodes = await db
		.select()
		.from(schema.pipelineNodes)
		.where(
			and(
				eq(schema.pipelineNodes.specVersionId, spec.activeVersionId),
				eq(schema.pipelineNodes.definitionId, ASSEMBLE_TYPE_ID)
			)
		)
	const keys = nodes.map((n) => n.nodeKey)
	return keys.length ? keys : [fallback]
}

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
		? await declarations(db, spec.activeVersionId)
		: []
	/**
	 * Keyed by **address** — `(nodeKey, slot)` — not by slot name alone
	 * (U5g). An envoy's instructions live at `envoy:<key>` in a slot also
	 * named `prompts`, as plain text with the genre's words as the author
	 * default; keyed by name, that row would have been read as a prompt
	 * *reference* and dereferenced to nothing. The name a slot wears is a
	 * plugin's to choose (see the three notes below); what a stored value
	 * IS is the declaration's, at the address the row carries.
	 */
	const addressOf = (nodeKey: string, slot: string) => `${nodeKey}\u0000${slot}`
	const varDecls = allDecls.filter(
		(d) => d.control === "variable-template-ref"
	)
	const variableSlots = new Set(varDecls.map((d) => addressOf(d.nodeKey, d.slot)))
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
			.map((d) => addressOf(d.nodeKey, d.slot))
	)
	/**
	 * Which slots hold a *prompt* reference — same argument as the two sets
	 * above, and it stopped being hypothetical when prompts became pooled by
	 * (node type, slot). The literal `"prompts"` used to work only because every
	 * shipped node happens to name its slot that; a plugin naming its slot
	 * anything else had its reference left underefenced, and the pool key that
	 * FINDS the prompt is built from the real slot name two lines from where the
	 * result was pushed at the literal — so the two could disagree about which
	 * slot a prompt belonged to.
	 */
	const promptSlots = new Set(
		allDecls
			.filter((d) => d.control === "prompts-ref")
			.map((d) => addressOf(d.nodeKey, d.slot))
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
		return (await resolveVariableTemplate(db, value)) ?? undefined
	}

	/**
	 * A template reference becomes the template itself — source **and** engine.
	 *
	 * ⚠ This returned `row.source` alone, and that single line was the reason
	 * every context template on every install rendered as Handlebars whatever
	 * it declared. `resolveContextTemplate` hands back `{engine, source}`; the
	 * engine was dropped here, so `input.template` reached the assemble binding
	 * as a bare string, `input.template.engine` was `undefined` on every run
	 * ever made, and `renderTemplate` answered the absence with core's engine.
	 * Nothing failed, nothing logged, and a Jinja template would have shipped
	 * its `{% %}` to the model as prose.
	 *
	 * `derefLayout` next door had it right the whole time — it returns the
	 * resolved object — which is why the same defect never reached layouts.
	 *
	 * Returns undefined for a dangling id, which `pushTemplate` then drops
	 * whole. Losing a customization is the right cost here; losing the prompt
	 * is not.
	 *
	 * ⚠ **A value that IS the template is taken as written.** An author preset
	 * may ship a template inline — `p.template('scenePrompt', { source, engine })`
	 * — and `ensureDefaultConfig` prefers a preset value over the reference it
	 * would otherwise resolve, so an inline template DISPLACES that reference.
	 * Accepting only a number here therefore drops the pair whole and leaves the
	 * node with no template at all, which assemble answers with a halt.
	 */
	const derefTemplate = async (value: unknown) => {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			const inline = value as { source?: unknown; engine?: unknown }
			if (typeof inline.source !== "string") return undefined
			const { CORE_TEMPLATE_ENGINE } = await import(
				"$lib/server/pipelines/prompt/renderers"
			)
			return {
				source: inline.source,
				engine:
					typeof inline.engine === "string"
						? inline.engine
						: CORE_TEMPLATE_ENGINE
			}
		}
		if (typeof value !== "number") return undefined
		const { resolveContextTemplate } = await import(
			"$lib/server/pipelines/entities/contextTemplates"
		)
		return (await resolveContextTemplate(db, value)) ?? undefined
	}

	/**
	 * A template slot, written as the two paths a renderer needs: **both, or
	 * neither.**
	 *
	 * The slot has always been addressed at `source` — that is where the value
	 * lives, and the reference is an implementation detail of where the string
	 * came from. `engine` sits beside it because a template is a piece of
	 * writing *in a language*, and the two are one fact: a source without its
	 * engine is a string somebody has to guess about, which is exactly what
	 * used to happen.
	 *
	 * Emitting them together in one helper, rather than as two `push` calls at
	 * each of the two call sites, is the point. Two calls is four places to get
	 * a pair right, and the failure mode of getting it wrong — a source at one
	 * scope with an engine from another, or a source with no engine at all — is
	 * a prompt that renders in the wrong language with nothing to show for it.
	 */
	const pushTemplate = async (
		scopeKind: OverrideRow["scopeKind"],
		scopeId: string | number | undefined,
		nodeKey: string,
		slot: string,
		value: unknown
	) => {
		const template = await derefTemplate(value)
		// A dangling reference drops the pair rather than half of it. Half a
		// pair is worse than none: the node would get an engine naming a
		// language for a source that never arrived, and fall back to its
		// in-code default while claiming to be rendering something else.
		if (!template) return
		push(scopeKind, scopeId, nodeKey, slot, "source", template.source)
		push(scopeKind, scopeId, nodeKey, slot, "engine", template.engine)
	}

	// ── the selected config, as the preset layer ─────────────────────────
	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const selected = await resolveSelectedConfig(db, spec.id, spec.slug, {
		sessionId: scope.sessionId
	})

	if (selected) {
		const values = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, selected.configId))

		for (const v of values as any[]) {
			if (promptSlots.has(addressOf(v.nodeKey, v.slot))) {
				// A reference. The fields it names become individual paths, so
				// per-path resolution still works above it — someone overriding
				// one field does not pin the rest of the prompt.
				const fields = await resolvePromptFields(db, Number(v.value))
				for (const [field, text] of Object.entries(fields))
					push("config", undefined, v.nodeKey, v.slot, field, text)
				continue
			}
			if (templateSlots.has(addressOf(v.nodeKey, v.slot))) {
				await pushTemplate(
					"config",
					undefined,
					v.nodeKey,
					v.slot,
					v.value
				)
				continue
			}
			if (variableSlots.has(addressOf(v.nodeKey, v.slot))) {
				push(
					"config",
					undefined,
					v.nodeKey,
					v.slot,
					v.path ?? "",
					await derefLayout(v.value)
				)
				continue
			}
			push("config", undefined, v.nodeKey, v.slot, v.path ?? "", v.value)
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

		if (promptSlots.has(addressOf(o.nodeKey, o.slot)) && !(o.path ?? "")) {
			// A prompts-ref override stores the *id* of a `pipeline_prompts`
			// row — the same shape a config value stores, dereferenced the
			// same way, because a node needs the words and not the number.
			// Pushed per field so per-path resolution above it still works.
			const fields = await resolvePromptFields(db, Number(o.value))
			for (const [field, text] of Object.entries(fields))
				push(scopeKind, scopeId, o.nodeKey, o.slot, field, text)
			continue
		}

		if (templateSlots.has(addressOf(o.nodeKey, o.slot))) {
			await pushTemplate(scopeKind, scopeId, o.nodeKey, o.slot, o.value)
			continue
		}

		if (variableSlots.has(addressOf(o.nodeKey, o.slot))) {
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

	// ── the floor under all of it: what the declaration declares ─────────
	//
	// A config stores **deviations** (ruled 2026-09-10): it carries a row only
	// where somebody departed from the declared default, so at every other
	// address the answer has to come from the declaration itself. This is where
	// it comes from, at `author` — the bottom of `SCOPE_ORDER`, under the two
	// `defaults` floors below and under everything anybody chose.
	//
	// ⚠ **One projection, not one per reader.** The SDK's resolver has always
	// had an `author` layer and `ConfigWorld.authorDefaults` to fill it; the app
	// populated neither, and the shipped config's materialized copy stood in for
	// it. Doing this here rather than at each call site is what keeps the panel
	// and the run agreeing: `executor.ts` (`resolveConfig`), `stepConfig.ts`
	// (`resolveConfigSources`) and the graph builder all read the world, so all
	// three inherit the same number from the same place. `panel/read.ts` reads
	// `d.authorDefault` off the same `declarations()` walk.
	//
	// Only what a declaration can actually supply lands here: `declsForSlot`
	// emits `authorDefault` for a `parameters` field, a `wire` slot's format and
	// the substrate's `settings` fields (R-9 — `enabled`, `review`, a gather
	// clause's `mode`, declared on the row since 2026-09-16 rather than
	// synthesised by the panel), and for no `*-ref` at all — so `push`'s
	// `undefined` guard drops every reference, which keeps its own row
	// precisely because there is nothing here to inherit.
	//
	// The executor's `params` branch merges the type's schema defaults on its
	// own, so a params address would resolve either way; `settings.review`,
	// `settings.enabled` and a clause's `settings.mode` have no such branch —
	// they are read straight off `config[key]['settings']` — and those are the
	// ones that would have gone `undefined` the moment their materialized rows
	// were swept.
	for (const d of allDecls)
		push("author", undefined, d.nodeKey, d.slot, d.path, d.authorDefault)

	// ── the floor: a prompts slot always resolves to words ───────────────
	//
	// Every layer above this is optional — a config may not carry a prompts
	// value, an instance may have no legacy config to project, and clearing
	// an override deletes a row rather than writing one. With nothing
	// underneath, the node ran with empty instructions, which does not read
	// as "no prompt is selected"; it reads as the model ignoring its
	// character sheet. So the shipped default is projected at `defaults`,
	// below everything anyone chose.
	//
	// It is also the safety net for a boot that never reconciled — one that
	// failed part-way through `bootstrapPipelines` (bootstrap.ts) without
	// writing config values. On that boot this is the only thing standing
	// between a run and empty instructions, so it has to be right before
	// anything is allowed to depend on it. Until the content-addressing ruling
	// (2026-09-10) the common way to reach that state was a type-registry
	// conflict, which returned early by design; that particular route is gone
	// and the net stays, because "boot did not finish" has other causes.
	//
	// ⚠ **Resolved per pool, not once per pipeline.** This used to resolve ONE
	// `defaultPromptFor(db, spec.id)` and push its fields onto EVERY prompts
	// node in the spec. Pool-blind, that is actively wrong now: a summarize run
	// has four different prompts nodes, and one row's fields on all of them
	// means the world summarizer's drafting instructions land on the
	// name-entry step. That text renders. It reads as plausible English. The
	// only way to notice is to compare the prompt against the step it came
	// from, which nobody does when the output merely looks a bit off.
	//
	// Pushed after the legacy projection, so on a migrated instance the
	// user's own carried-over wording still wins at this scope — this fills
	// the hole rather than papering over what somebody already had.
	if (!spec.activeVersionId) return
	const promptDecls = allDecls.filter((d) => d.control === "prompts-ref")

	if (promptDecls.length) {
		const { defaultPromptFor } = await import(
			"$lib/server/pipelines/boot/seedPrompts"
		)
		const { promptPoolKeyFor } = await import(
			"$lib/server/pipelines/entities/promptPool"
		)
		// One resolution per pool rather than per declaration: two nodes of the
		// same type with the same slot are the same pool and must land on the
		// same row, and a spec with several such nodes should not pay for the
		// lookup twice. Keyed in memory only — the table indexes two columns
		// (see `promptPool.ts`).
		const byPool = new Map<string, Record<string, string> | null>()
		for (const d of promptDecls) {
			// The pool is a property of the node's TYPE, so a declaration that
			// cannot say which type it came from cannot be given a floor. Its
			// slot resolves to nothing rather than to somebody else's wording,
			// which is the same trade the layouts floor makes below.
			if (!d.nodeDefinitionId) continue
			const poolKey = promptPoolKeyFor(d.nodeDefinitionId, d.slot)
			if (!byPool.has(poolKey)) {
				// `defaultPromptFor(db, nodeDefinitionId, slot, spec)` — the pool,
				// then the pipeline asking. BOTH halves of the spec are needed
				// and neither substitutes for the other: `default_for_specs`
				// holds slugs (one row is the shipped default for two
				// summarizers at once, so a single owning id cannot say it)
				// while `created_for_spec_id` holds an id. The resolution order
				// is: a row in this pool defaulted to this slug → the immutable
				// row in this pool written here → the oldest immutable row in
				// the pool → null.
				const id = await defaultPromptFor(db, d.nodeDefinitionId, d.slot, {
					id: spec.id,
					slug: spec.slug
				})
				byPool.set(
					poolKey,
					id == null ? null : await resolvePromptFields(db, id)
				)
			}
			const fields = byPool.get(poolKey)
			if (!fields) continue
			for (const [field, text] of Object.entries(fields))
				push("defaults", undefined, d.nodeKey, d.slot, field, text)
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
						await defaultVariableTemplateFor(db, d.variableId)
					)
				)
			push(
				"defaults",
				undefined,
				d.nodeKey,
				d.slot,
				d.path,
				shipped.get(d.variableId) ??
					// A band declared upstream (typed templates P2) resolves even
					// with no layout anywhere: the resolved keys are how Assemble
					// learns which bands to render at the top level. No `source`,
					// so it renders through the in-code floor.
					(d.band ? { engine: CORE_TEMPLATE_ENGINE } : undefined)
			)
		}
	}
}

/**
 * The transform a slot is shopping for, out of everything it requires.
 *
 * Features are passed over rather than considered: `strict_schema` qualifies a
 * request, it is not a thing a node goes looking for a connection to provide,
 * and `connection_defaults` registers transforms only. So a slot requiring
 * `text->text` and `strict_schema` layers the text default rather than falling
 * off the end of the table.
 */
const requiredTransform = (requires?: readonly string[]): string | undefined =>
	requires?.find(isTransformId)

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

// `samplingValues(row)` used to live here: it took `Object.entries` of the whole
// row and kept everything outside a six-name skip list, which was how sampler
// values were separated from bookkeeping when they were columns side by side.
//
// They are not columns any more (0171) — the row carries a `values` object — so
// the projection above reads that field directly. Left as a note because the old
// function would have gone on "working": it would have produced
// `{shape, values, enabled}` as if those were three samplers, and handed that to
// the adapter, where every key would have missed the key map and every real
// sampler would have silently vanished.
