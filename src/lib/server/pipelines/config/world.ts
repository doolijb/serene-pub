/**
 * SP's configuration, projected into the pipeline config model.
 *
 * The rows a person tunes outside the pipeline panel — `connections`,
 * `connection_defaults`, `sampling_configs`, a session's own sampling pick —
 * are read here and presented as the executor's five-layer scope chain, under
 * the configuration the pipeline panel writes:
 *
 * | SP row | pipeline slot | on which node |
 * |---|---|---|
 * | `sampling_configs` | `sampling` | the oracle |
 * | `connections` | `connection` | the oracle |
 *
 * Prompt text, the post-history numbers and the story string are pipeline
 * configuration only (prompt rows, `params`, `pipeline_context_templates`).
 * 0.5's `prompt_configs` / `context_configs` were carried into them by the
 * 0.5.3 upgrade and dropped (0097).
 *
 * **Credentials never enter.** `ConnectionRecord.metadata` is readable by a
 * node; `material` is not, and is injected per call by the host. The API key
 * lives in `extraJson.apiKey`, encrypted, and is decrypted only inside the
 * dispatch path — never in anything a binding can see (F18).
 */

import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	S,
	SLOT_VALUE,
	isTransformId,
	type ConfigWorld,
	type OverrideRow,
	type SlotDecl
} from "@serene-pub/sdk"
import {
	capabilityDefaults,
	capabilityForSamplingShape
} from "$lib/server/connections/capabilityDefaults"
// Imported rather than re-declared. The string keys the `connection_defaults`
// PRIMARY KEY (as its two sides), so a second spelling that diverged would not
// be a mismatch, it would be a capability nothing can ever satisfy.
import { TEXT_CAPABILITY } from "$lib/server/connections/capabilityTarget"
import { completionTemplatesByKey } from "$lib/server/connections/completionTemplates"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { resolvePromptFields } from "$lib/server/pipelines/entities/prompts"
import { declarations, type Decl } from "$lib/server/pipelines/config/panel"
import { storedCapabilities } from "$lib/server/pipelines/runtime/capabilityGuard"
import { resolveWireMode } from "$lib/server/connections/resolve"
import { midSystemFor } from "$lib/shared/connectionAdapters/midSystem"
import { EMBEDDING_CAPABILITY } from "$lib/shared/constants/embeddings"
import { unreadSlotsOf } from "$lib/server/pipelines/boot/unreadAllowList"
import { isHeldConnectionSlot } from "$lib/server/pipelines/config/heldSlots"

export interface WorldScope {
	sessionId?: number
	/** Which node key carries the connection slot in the spec being run. */
	oracleNodeKey?: string
	/** Which pipeline is running, so its own configuration can be read. */
	specId?: string
}

/**
 * Build the config world for one run.
 *
 * Each existing layer is projected onto its scope:
 *
 * | today | scope layer |
 * |---|---|
 * | `connection_defaults` (per capability) | `defaults` |
 * | `sessions.samplingConfigId` | `session` |
 * | the pipeline panel's rows | `preset` / `session` (`applyPipelineLayer`) |
 *
 * There is no user layer (ruled 2026-08-24): a person's levers are the
 * session's — its config selection and its overrides.
 *
 * **Reads only.** Building a world never writes — it is a projection of what is
 * configured, and a write here would mean resolving somebody's config had a
 * side effect on it.
 *
 * That invariant is a rule this file keeps, not one the parameter type
 * enforces. A read-only alias such as `{ select: any }` would make every ROW
 * read through it an `any` too, so a column this schema does not have would
 * type-check in all five of this file's readers; the full `Db` keeps the rows
 * checked.
 */
export async function buildWorld(
	db: Db,
	scope: WorldScope = {}
): Promise<ConfigWorld> {
	const oracle = scope.oracleNodeKey ?? "generate"

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

	// ── template and prompts: nothing to project ─────────────────────────
	//
	// The story string is a `pipeline_context_templates` reference and prompt
	// text a prompt-row reference, both resolved through the config layer like
	// every other slot — two sources for one slot is how a panel ends up
	// showing a choice the run does not make.

	// ── connection and sampling ──────────────────────────────────────────
	// Nobody writes a connection slot at session scope (F20, ruled
	// 2026-09-30): the pair is the pipeline configuration's, else the
	// instance default layered here.
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
	const pubDefault = oracleCapability
		? defaultsByCapability[oracleCapability]
		: undefined

	// The table, and only the table (0181). Every star writer writes
	// `connection_defaults`, so no fallback reads a default from anywhere else:
	// a second place for a default to live is how the screen and the run come
	// to disagree.
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
		pubDefault?.connectionId != null
			? {
					id: String(pubDefault.connectionId),
					modelId: idOrNull(pubDefault.connectionModelId) ?? null
				}
			: undefined
	)
	layer(
		"defaults",
		undefined,
		oracle,
		"sampling",
		SLOT_VALUE,
		idOrNull(pubDefault?.samplingConfigId)
	)

	// ── the pipeline layer, which wins over everything above ─────────────
	//
	// Written last so it is *appended* after the projection above, and
	// `resolveConfigSources` walks candidates in SCOPE_ORDER and takes the first
	// match at each scope — so a value a person set in the pipeline panel is the
	// one that runs. Without this the panel would edit rows nothing reads, which
	// is worse than not having it: every screen would agree with the user and
	// the model would not.
	if (scope.specId) await applyPipelineLayer(db, overrides, scope)

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
	// ⚠ Seeded from what is REGISTERED, and nothing else — never from a fixed
	// `text->text`. A capability nobody starred resolves to nothing, and adding
	// a key with no value is how "the instance has chat set up" becomes true on
	// an instance where nobody set it up.
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
	 * The embeddings shape, named here rather than through the mapper above —
	 * which is right to answer `undefined` for it: that mapper is also asked
	 * which SAMPLING vocabulary a shape speaks, and embeddings have none.
	 * The connection half is not in doubt. `text->embedding` is the one
	 * capability the embed step can need, and its default is the singleton
	 * `ConfigWorld.activeConnection` was declared for ("singleton kinds, e.g.
	 * embeddings", 01 §10): the star the embedding lane loads its model from
	 * (`resolveEmbeddingTarget`).
	 *
	 * ⚠ Published. `core:task/query-windows@1` reads it, through its own
	 * embedding connection slot (`slot.connection()`; the embed step declares
	 * none), to decide whether *Automatic* searches by meaning: whenever an
	 * embedding model is set up, wherever it runs (owner, 2026-09-30). No
	 * pick ever stands on that slot (`isHeldConnectionSlot`,
	 * `applyPipelineLayer`), so what it resolves to IS this star — the
	 * connection the host embeds through.
	 */
	const embeddingsId = defaultConnectionFor(EMBEDDING_CAPABILITY)
	if (embeddingsId) activeConnection[S.embeddings] = embeddingsId

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

	/**
	 * 🚧 **What each pair reads** (PLAN-composer-attachments §5.2) — the
	 * connection descriptor's `metadata.reads` (and, per model, `readsByModel`),
	 * which `core:task/place-attachments@1` reads to decide whether a file is
	 * sent or named. Computed by `pairReads`, the ONE predicate the composer's
	 * readers line also uses (one verdict per law), on the pair a run would be
	 * sent to: the endpoint with each of its models merged in. The endpoint's
	 * own entry is judged on the text capability default's model when this is
	 * its endpoint — the pair dispatch resolves a model-less slot to.
	 */
	const readsByConnection = await connectionReads(
		connectionRows,
		modelRows,
		defaultsByCapability[TEXT_CAPABILITY]
	)

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
				 * build. One resolution, two readers: the shape a prompt is BUILT
				 * in and the shape it is SENT in are one decision, never one made
				 * by a spec that cannot see an adapter's `extraJson` flag and
				 * another by an adapter that never sees the render.
				 *
				 * Resolved live from the row rather than read off the cached
				 * capability set beside it — see `resolveWireMode`: the cache on
				 * an existing row was written before these keys existed and names
				 * neither mode.
				 */
				wireMode: resolveWireMode(c),
				/**
				 * What this type's chat wire does with depth-placed system
				 * text (AN3, `midSystemFor`) — read by the assemble node
				 * beside `wireMode`, so the message builder folds it where the
				 * backend would hoist or reject it. Static per type; `keep`
				 * off the chat wire.
				 */
				midSystem: midSystemFor(c.type, resolveWireMode(c)),
				reads: readsByConnection.get(c.id)?.reads,
				readsByModel: readsByConnection.get(c.id)?.byModel
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
 * The configuration a person actually edited, layered over the instance
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
 * an ad-hoc spec, which is text by construction — or when the node declares no
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

	/**
	 * The addresses that take no pick, at every node of this spec that
	 * carries one: a **held connection slot** (`isHeldConnectionSlot` —
	 * today `query-windows`' embedding connection, which the host holds at
	 * the active embedding connection by policy), and a slot no handler reads
	 * (`isUnreadSlot` — none today).
	 *
	 * ⚠ Dropped here, at the one door every stored value comes through — the
	 * selected config and the session's own rows alike — so the executor sees
	 * no pick and resolves the slot to the instance default: the connection
	 * the host embeds through. A pick left standing made *Automatic* decide
	 * about a connection the embed never used (review 2026-09-29), and a
	 * stale one naming a deleted row resolved to nothing and said "no
	 * embedding model is set up" beside an active one.
	 */
	const nodes = spec.activeVersionId
		? await db
				.select({
					nodeKey: schema.pipelineNodes.nodeKey,
					definitionId: schema.pipelineNodes.definitionId,
					definitionVersion: schema.pipelineNodes.definitionVersion
				})
				.from(schema.pipelineNodes)
				.where(eq(schema.pipelineNodes.specVersionId, spec.activeVersionId))
		: []
	const pins = [...new Set(nodes.map((n) => n.definitionId))]
	const slotsByPin = new Map<string, Record<string, SlotDecl>>(
		pins.length
			? (
					await db
						.select({
							definitionId: schema.pipelineDefinitionRegistry.definitionId,
							version: schema.pipelineDefinitionRegistry.version,
							slots: schema.pipelineDefinitionRegistry.slots
						})
						.from(schema.pipelineDefinitionRegistry)
						.where(
							inArray(schema.pipelineDefinitionRegistry.definitionId, pins)
						)
				).map((r) => [`${r.definitionId}@${r.version}`, r.slots ?? {}])
			: []
	)
	const noPick = new Set<string>(
		nodes.flatMap((n) => {
			const pin = `${n.definitionId}@${n.definitionVersion}`
			const held = Object.entries(slotsByPin.get(pin) ?? {})
				.filter(([, decl]) => isHeldConnectionSlot(decl))
				.map(([slot]) => slot)
			return [...held, ...unreadSlotsOf(pin)].map(
				(slot) => `${n.nodeKey}\u0000${slot}`
			)
		})
	)

	const push = (
		scopeKind: OverrideRow["scopeKind"],
		scopeId: string | number | undefined,
		nodeKey: string,
		slot: string,
		path: string,
		value: unknown
	) => {
		if (value === undefined) return
		if (noPick.has(`${nodeKey}\u0000${slot}`)) return
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
	 * above, and it binds because prompts are pooled by (node type, slot).
	 * Never the literal `"prompts"`: every shipped node happens to name its slot
	 * that, but a plugin may not, and the pool key that FINDS the prompt is built
	 * from the real slot name — a literal here would leave a plugin's reference
	 * unresolved and let the two disagree about which slot a prompt belongs to.
	 */
	const promptSlots = new Set(
		allDecls
			.filter((d) => d.control === "prompts-ref")
			.map((d) => addressOf(d.nodeKey, d.slot))
	)
	/**
	 * Which slots hold a connection — the ones a session row never answers
	 * (ruled 2026-09-30). The pair is the configuration's or the instance
	 * default's; a session-scope row here is one `reconcileConfigs` culls at
	 * the next boot, and until it does it must not be what runs.
	 */
	const connectionSlots = new Set(
		allDecls
			.filter((d) => d.matrixSlot === "connection")
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
	 * engine is a string somebody has to guess about.
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
		if (connectionSlots.has(addressOf(o.nodeKey, o.slot))) continue
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
	// value, and clearing
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
	// ⚠ **Resolved per pool, not once per pipeline.** Never one
	// `defaultPromptFor(db, spec.id)` pushed onto EVERY prompts node in the
	// spec: a summarize run has four different prompts nodes, and one row's
	// fields on all of them puts the world summarizer's drafting instructions
	// on the name-entry step. That text renders. It reads as plausible English.
	// The only way to notice is to compare the prompt against the step it came
	// from, which nobody does when the output merely looks a bit off.
	//
	// Pushed last, so anything already at this scope wins — this fills the
	// hole rather than papering over what somebody already had.
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

// Sampler values are the row's `values` object (0171), read directly by the
// projection above — never `Object.entries` of the whole row minus a skip
// list. That form would produce `{shape, values, enabled}` as if those were
// three samplers and hand them to the adapter, where every key misses the key
// map and every real sampler silently vanishes.

/**
 * Every connection's reading verdicts, for the world's descriptors (see the
 * call site). Enabled models only: a switched-off model is refused at
 * resolution before anything is sent.
 */
async function connectionReads(
	connections: readonly (typeof schema.connections.$inferSelect)[],
	models: readonly (typeof schema.connectionModels.$inferSelect)[],
	textDefault: { connectionId: number | null; connectionModelId: number | null } | undefined
): Promise<
	Map<
		number,
		{
			reads: import("@serene-pub/sdk").ConnectionReadsV1
			byModel: Record<string, import("@serene-pub/sdk").ConnectionReadsV1>
		}
	>
> {
	const out = new Map<
		number,
		{
			reads: import("@serene-pub/sdk").ConnectionReadsV1
			byModel: Record<string, import("@serene-pub/sdk").ConnectionReadsV1>
		}
	>()
	if (!connections.length) return out
	const { pairReads } = await import("$lib/server/attachments/readers")
	const { mergeEndpointModel } = await import(
		"$lib/server/connections/models"
	)
	const { withWireMode } = await import("$lib/server/connections/resolve")
	const { adapterIo } = await import("$lib/shared/connectionAdapters/manifest")
	const judge = async (
		endpoint: typeof schema.connections.$inferSelect,
		model: typeof schema.connectionModels.$inferSelect | null
	): Promise<import("@serene-pub/sdk").ConnectionReadsV1> => {
		const verdict = await pairReads(
			withWireMode(mergeEndpointModel(endpoint, model)) as any
		)
		const why: { image?: string; pdf?: string } = {}
		if (verdict.image) why.image = verdict.image
		if (verdict.pdf) why.pdf = verdict.pdf
		const tokensPerImage = adapterIo(endpoint.type)?.tokensPerImage
		return {
			image: verdict.image == null,
			pdf: verdict.pdf == null,
			...(why.image || why.pdf ? { why } : {}),
			...(tokensPerImage ? { tokensPerImage } : {})
		}
	}
	for (const c of connections) {
		const own = models.filter((m) => m.connectionId === c.id && m.enabled)
		const byModel: Record<string, import("@serene-pub/sdk").ConnectionReadsV1> = {}
		for (const m of own) byModel[String(m.id)] = await judge(c, m)
		const defaultModelId =
			textDefault?.connectionId === c.id ? textDefault.connectionModelId : null
		const reads =
			(defaultModelId != null ? byModel[String(defaultModelId)] : undefined) ??
			(await judge(c, null))
		out.set(c.id, { reads, byModel })
	}
	return out
}
