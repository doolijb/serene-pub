/**
 * The configuration panel's read model.
 *
 * `listNamespaces` is the index; `namespaceView` is one pipeline fully
 * resolved — every declaration, its value, and **where that value won**. The
 * scope chain is walked most-specific-first by `layers`, and the winning layer
 * becomes the option's `source`, which is what lets the UI say "inherited from
 * the pub default" rather than just showing a value.
 */

import { valueDeclOf } from "@serene-pub/sdk"
import { and, asc, eq } from "drizzle-orm"
import { resolveSampling } from "$lib/server/utils/resolveSampling"
import { contextBudgetFrom } from "$lib/server/pipelines/runtime/contextWindow"
import { slotModelId } from "$lib/shared/connections/slotRef"
import { i18nText } from "$lib/server/pipelines/config/panel/declarations"
import * as schema from "$lib/server/db/schema"
import { mayWrite } from "@serene-pub/sdk"
import {
	choiceSets,
	choicesFor
} from "$lib/server/pipelines/config/panel/choices"
import {
	type Published,
	declarations,
	published,
	subscription
} from "$lib/server/pipelines/config/panel/declarations"
import {
	settingsGroupsOf,
	type PlacedOption
} from "$lib/server/pipelines/config/panel/groups"
import { readingOf } from "$lib/server/pipelines/config/panel/provenance"
import { optionId, stepKeyFor } from "$lib/server/pipelines/config/panel/ids"
import { promptPoolKeyFor } from "$lib/server/pipelines/entities/promptPool"
import {
	acceptedEnginesOf,
	CORE_TEMPLATE_ENGINE
} from "$lib/shared/pipelines/templateEngines"
import {
	visibleTo,
	writeScopeFor
} from "$lib/server/pipelines/config/panel/scopes"
import {
	type ConfigOption,
	type Decl,
	type NamespaceSummary,
	type NamespaceView,
	type OptionSource,
	type Viewer,
	type WriteScope
} from "$lib/server/pipelines/config/panel/types"

/**
 * The address, as a map key.
 *
 * Joined on NUL rather than on a space, for the reason the SDK's resolver was
 * just fixed for: a space is a character a declared path may contain, so joining
 * on one lets two different addresses collide on the same key. No core path has
 * a space; nothing stops a plugin's from having one.
 */
const addr = (nodeKey: string, slot: string, path: string) =>
	`${nodeKey}\u0000${slot}\u0000${path}`

/**
 * The three layers, as lookups (12 §2 as simplified 2026-08-24).
 *
 * Author defaults come off the declarations; the selected config projects in
 * at `config` (`preset` until 2026-09-26); the session's overrides are the only scoped
 * rows left. The former instance and user maps are gone with their layers —
 * migration 0140 folded instance rows into configs and removed the rest.
 */
export async function layers(db: Db, at: Published, viewer: Viewer) {
	const overrides = await db
		.select()
		.from(schema.pipelineNodeOverrides)
		.where(eq(schema.pipelineNodeOverrides.specId, at.specId))

	const scoped = (kind: string, id: number) => {
		const m = new Map<string, unknown>()
		for (const o of overrides as any[])
			if (o.scopeKind === kind && o.scopeId === id)
				m.set(addr(o.nodeKey, o.slot, o.path ?? ""), o.value)
		return m
	}

	// The selected *named config*, resolved by the same function the runtime
	// uses (`world.ts applyPipelineLayer` → `resolveSelectedConfig`). One
	// mechanism on purpose: a panel that read a different table than the run
	// would agree with the user while the model did something else — the worst
	// class of bug in this area, because there is nothing to see.
	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const selectedConfig = await resolveSelectedConfig(db, at.specId, at.slug, {
		sessionId: viewer.sessionId ?? undefined
	})

	const preset = new Map<string, unknown>()
	if (selectedConfig) {
		const values = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(
				eq(
					schema.pipelineConfigValues.configId,
					selectedConfig.configId
				)
			)
		for (const v of values as any[])
			preset.set(addr(v.nodeKey, v.slot, v.path ?? ""), v.value)
	}

	return {
		session:
			viewer.sessionId != null
				? scoped("session", viewer.sessionId)
				: null,
		preset,
		selectedConfig
	}
}

export async function listNamespaces(db: Db): Promise<NamespaceSummary[]> {
	const specs = await db
		.select()
		.from(schema.pipelineSpecs)
		.orderBy(asc(schema.pipelineSpecs.id))

	// A disabled plugin's pipelines are not listed (R67).
	const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
	const off = await disabledPlugins(db)
	const out: NamespaceSummary[] = []
	for (const spec of specs as any[]) {
		if (!spec.activeVersionId) continue
		if (off.owns(spec.sourcePluginId)) continue
		const [version] = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.id, spec.activeVersionId))
			.limit(1)
		if (!version) continue
		const sub = await subscription(db, version.id)
		out.push({
			slug: spec.slug,
			name: spec.name,
			version: version.semver,
			event: sub.event,
			enabled: sub.enabled,
			// Catalogue claims (23 §4): straight off the version row. A null
			// row is "unclassified", which is honest.
			taxonomy: (version.taxonomy as any) ?? null
		})
	}
	return out
}

/**
 * The node keys the context-budget node's `sampling` and `connection` slots
 * refer to, off its stored config — `{ __ref: 'slot', slot, ofNode }` where the
 * spec wrote `slot.samplingOf(...)` / `slot.connectionOf(...)`. Undefined for
 * a slot the budget names as its own, or for a document with no budget node.
 */
async function budgetPairNodes(
	db: Db,
	specVersionId: number
): Promise<{ sampling?: string; connection?: string }> {
	const [budget] = await db
		.select({ config: schema.pipelineNodes.config })
		.from(schema.pipelineNodes)
		.where(
			and(
				eq(schema.pipelineNodes.specVersionId, specVersionId),
				eq(schema.pipelineNodes.definitionId, "core:task/context-budget")
			)
		)
		.limit(1)
	const config = (budget?.config ?? {}) as Record<string, unknown>
	const ofNode = (slot: string): string | undefined => {
		const ref = config[slot]
		return ref &&
			typeof ref === "object" &&
			(ref as { __ref?: unknown }).__ref === "slot" &&
			typeof (ref as { ofNode?: unknown }).ofNode === "string"
			? ((ref as { ofNode: string }).ofNode as string)
			: undefined
	}
	return { sampling: ofNode("sampling"), connection: ofNode("connection") }
}

export async function namespaceView(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer
): Promise<NamespaceView | null> {
	const at = await published(db, slug)
	if (!at) return null

	const decls = await declarations(db, at.specVersionId)
	const chain = await layers(db, at, viewer)
	const sets = await choiceSets(db, at.specId)
	// The connection's stop guards, for the effective-chain view (18 §4c):
	// resolved by the same rule the runtime uses, so what the step card shows
	// beside the chain is what the run actually evaluates. Read-only here —
	// they are managed on the connection, and the badge says so.
	const { connectionStopsFor } = await import(
		"$lib/server/pipelines/scripts/chains"
	)
	const connStops = await connectionStopsFor(db)
	const scope = writeScopeFor(viewer)

	// Each node's options, for the budget's window figure below; the
	// settings groups are shaped from `placed`.
	const byNode = new Map<string, ConfigOption[]>()
	/**
	 * The budget node's margin as this viewer resolves it, for the window
	 * figure below. Captured in the walk rather than looked up afterwards,
	 * because an option carries no address — the payload never names a node.
	 */
	let safetyMargin: unknown
	/** Every option drawn, beside its declaration — the settings groups are shaped from these. */
	const placed: PlacedOption[] = []
	/** The pub's defaults per capability, for what an unset Model or Sampling reads as. */
	const { capabilityDefaults: loadCapabilityDefaults } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	const pubByCapability = await loadCapabilityDefaults(db)
	for (const d of decls) {
		if (!visibleTo(d.matrixSlot, viewer)) continue

		const key = addr(d.nodeKey, d.slot, d.path)
		// The same order the runtime resolves in: the session's override beats
		// the selected config beats the author default — the whole chain,
		// since the simplification. The two walks must agree or the panel
		// shows a value the run does not use.
		let value: unknown = d.authorDefault
		let source: OptionSource = "author"
		// A session names no connection (ruled 2026-09-30): a session row at a
		// connection address is not read, here or by the run (`world.ts`).
		const sessionHas =
			!!chain.session?.has(key) && d.matrixSlot !== "connection"
		if (sessionHas) {
			value = chain.session!.get(key)
			source = "session"
		} else if (chain.preset.has(key)) {
			value = chain.preset.get(key)
			source = "config"
		}

		// The selected prompt row rides along on a prompts-ref, so the
		// panel can show and edit the text inline. The resolved value is
		// the row id; a value that names no row (deleted since) simply
		// carries no `prompt`, and the dropdown shows the dangle.
		const promptRow =
			d.control === "prompts-ref" && typeof value === "number"
				? sets.promptRows.get(value)
				: undefined

		// The same ride-along, for the same reason: a name in a dropdown does
		// not answer "what does this produce", and the source is the thing
		// being chosen.
		const variableTemplateRow =
			d.control === "variable-template-ref" && typeof value === "number"
				? sets.variableTemplateRows.get(value)
				: undefined

		const contextTemplateRow =
			d.control === "context-template-ref" && typeof value === "number"
				? sets.contextTemplateRows.get(value)
				: undefined

		// The chain, hydrated in order. The value is the id list; this is what
		// the ids are. A deleted row still yields an entry, marked missing —
		// a dangle the panel hides is a chain that quietly shrank.
		const chainEntries =
			d.control === "scripts-chain" && Array.isArray(value)
				? (value as unknown[])
						.filter((v): v is number => typeof v === "number")
						.map((scriptId) => {
							const row = sets.scriptRows.get(scriptId)
							if (!row)
								return {
									id: scriptId,
									name: `#${scriptId}`,
									enabled: false,
									typeLabel: "",
									blastRadius: "",
									operation: "",
									missing: true
								}
							const meta = sets.scriptTypeMeta.get(row.typeId)
							return {
								id: row.id,
								name: row.name,
								enabled: !!row.enabled,
								typeLabel: meta?.name ?? row.typeId,
								blastRadius: meta?.blastRadius ?? "",
								operation: meta?.operation ?? ""
							}
						})
				: undefined

		// Where this option's edits land (ruled 2026-08-24): inside a session,
		// the session's override; everywhere else, the selected configuration
		// itself — which is why the global panel is an admin's surface, and a
		// non-admin's levers are the session's.
		const effScope: WriteScope = scope
		const writable =
			effScope === "session"
				? !viewer.readOnlyBecause &&
					mayWrite(d.matrixSlot, "session") &&
					(viewer.isAdmin || d.matrixSlot === "prompts")
				: viewer.isAdmin && mayWrite(d.matrixSlot, "config")
		// A connection row that is not writable here — an administrator's,
		// inside a session; nobody else is sent one (`visibleTo`) — is shown
		// by NAME (`valueLabel`, below), without the list to choose from.
		const namesOnly = d.control === "connection-ref" && !writable

		const option: ConfigOption = {
			id: optionId(secret, d.nodeKey, d.slot, d.path),
			label: d.label,
			step: {
				key: stepKeyFor(secret, d.nodeKey),
				heading: d.stepHeading ?? d.typeLabel
			},
			...(d.description ? { description: d.description } : {}),
			control: d.control,
			// The value declaration (24 T6c): the settings-schema entry
			// bridged to the single-key vocabulary, so value-decl controls
			// can render this option. Derived, never stored — absent for the
			// controls the bridge does not cover (refs, scripts, templates).
			...((dv) => (dv ? { decl: dv } : {}))(
				valueDeclOf({
					type:
						d.control === "per-member"
							? "perMember"
							: d.control,
					default: d.authorDefault,
					min: d.min,
					max: d.max,
					of: d.of,
					members: d.members
				})
			),
			...(d.min != null ? { min: d.min } : {}),
			...(d.max != null ? { max: d.max } : {}),
			...(d.of ? { of: d.of } : {}),
			...(d.members ? { members: d.members } : {}),
			// The element declaration for a `list`, already labelled — the list
			// editor renders rows from it rather than knowing what any given
			// list holds.
			...(d.item ? { item: d.item } : {}),
			...((c) => (c && !namesOnly ? { choices: c } : {}))(
				choicesFor(d, sets, [value, d.authorDefault])
			),
			...(chainEntries ? { scripts: chainEntries } : {}),
			...(d.control === "scripts-chain" &&
			connStops &&
			(d.accepts ?? []).includes("core:script:text/stop@1")
				? {
						connectionScripts: {
							connectionName: connStops.connectionName,
							entries: connStops.rows.map((r) => ({
								id: r.id,
								name: r.name,
								enabled: r.enabled
							}))
						}
					}
				: {}),
			...(variableTemplateRow
				? {
						variableTemplate: {
							id: variableTemplateRow.id,
							name: variableTemplateRow.name,
							source: (variableTemplateRow.source ??
								"") as string,
							readOnly: !!variableTemplateRow.isImmutable
						}
					}
				: {}),
			...(contextTemplateRow
				? {
						contextTemplate: {
							id: contextTemplateRow.id,
							name: contextTemplateRow.name,
							source: (contextTemplateRow.source ?? "") as string,
							readOnly: !!contextTemplateRow.isImmutable,
							// The language it is written in, so the editor
							// completes and lints the right one (P7).
							engine: (contextTemplateRow.engine ??
								CORE_TEMPLATE_ENGINE) as string,
							// Read back off the choice the picker already
							// computed rather than re-deriving it here — two
							// places deciding "which group is this in" is two
							// places to disagree, and the editor's caption and
							// the list would be the ones disagreeing.
							...((c) =>
								c
									? {
											group: c.group,
											...(c.description
												? { origin: c.description }
												: {})
										}
									: {})(
								(
									sets.contextTemplatesBy.get(
										contextTemplateRow.nodeDefinitionId
									) as any[] | undefined
								)?.find((c) => c.id === contextTemplateRow.id)
							)
						}
					}
				: {}),
			// On the option itself, not inside `prompt` — the create button needs
			// it precisely when no row is selected.
			...(d.control === "prompts-ref"
				? { promptFields: d.promptFields ?? [] }
				: {}),
			// Same rule, same reason: the languages a new template here may be
			// written in are a fact about the slot, and the button that asks
			// for one is shown when nothing is selected.
			...(d.control === "context-template-ref"
				? { acceptedEngines: acceptedEnginesOf(d) }
				: {}),
			// Typed templates P3: what the template can reference here.
			...(d.control === "context-template-ref" && d.templateScope
				? { scope: d.templateScope }
				: {}),
			// P7: who supplies each name, as labels, and the untyped feeds.
			...(d.control === "context-template-ref" && d.templateDeclarers
				? { scopeDeclarers: d.templateDeclarers }
				: {}),
			...(d.control === "context-template-ref" && d.templateUntyped?.length
				? { scopeUntyped: d.templateUntyped.map((label) => ({ label })) }
				: {}),
			...(promptRow
				? {
						prompt: {
							id: promptRow.id,
							name: promptRow.name,
							fields: (promptRow.fields ?? {}) as Record<
								string,
								string
							>,
							readOnly: !!promptRow.isImmutable,
							declared: d.promptFields ?? [],
							// Text for fields the slot stopped declaring, off
							// the row's archive. Shown apart and read-only —
							// left in `fields` it would be invisible, because
							// the editor renders one box per DECLARED field, so
							// a prompt somebody spent an afternoon on becomes
							// unfindable rather than merely unused. Omitted
							// when empty, which is every row on a healthy
							// install.
							...(Object.keys(promptRow.archivedFields ?? {})
								.length
								? {
										archived:
											promptRow.archivedFields as Record<
												string,
												string
											>
									}
								: {}),
							// Read back off the choice the picker already
							// computed rather than re-deriving it here — two
							// places deciding "which group is this in" is two
							// places to disagree, and the editor's caption and
							// the list would be the ones disagreeing. Same
							// ride-along the context template makes, and now
							// for the same reason: a pooled prompt may well
							// have been written in another pipeline.
							...((c) =>
								c
									? {
											group: c.group,
											...(c.description
												? { origin: c.description }
												: {})
										}
									: {})(
								(
									sets.promptsBy.get(
										promptPoolKeyFor(
											promptRow.nodeDefinitionId,
											promptRow.slot
										)
									) as any[] | undefined
								)?.find((c) => c.id === promptRow.id)
							)
						}
					}
				: {}),
			...(d.authorDefault !== undefined && d.control !== "secret"
				? { authorDefault: d.authorDefault }
				: {}),
			// A secret is write-only in the UI and redacted by type (13 §6) —
			// enforceable precisely because the declaration says it is one.
			value: d.control === "secret" ? null : value,
			source,
			// The same decision resolveWriteScope enforces, asked without
			// throwing: session writes need the session column and the non-admin
			// prompts line; config writes are the admin's, on the config column
			// (a config's values are what the whole instance resolves — R-10
			// folded `instance` into `config`, the selected config; spelled
			// `preset` until 2026-09-26).
			writable,
			overriddenHere:
				effScope === "session" ? sessionHas : chain.preset.has(key),
			/**
			 * Did somebody depart from the default here (ruled 2026-09-10)?
			 *
			 * The row's existence, and nothing else — which is the whole of
			 * what provenance means now that a config stores deviations. There
			 * is no provenance column and there is nothing left for one to say:
			 * seeding writes no row for a declared value, `writeOption` deletes
			 * one that lands back on it, and `clearOption` has always deleted.
			 *
			 * Distinct from `overriddenHere`, which answers "does the scope I
			 * am WRITING at hold this" and so flips to the session's own row
			 * inside a session. This one is about the configuration, from
			 * whichever surface is looking at it — a person in a session can
			 * see that a field was tuned for everyone without that being the
			 * thing their own reset would remove.
			 */
			changed: chain.preset.has(key)
		}

		if (d.matrixSlot === "params" && d.path === "safetyMargin")
			safetyMargin = value

		// How a Model or Sampling value reads, and every reference's name.
		Object.assign(
			option,
			readingOf({
				d,
				value: d.control === "secret" ? null : value,
				source,
				configured: {
					has: chain.preset.has(key),
					value: chain.preset.get(key)
				},
				scope,
				configName: chain.selectedConfig?.name,
				defaults: pubByCapability,
				sets
			})
		)
		placed.push({ d, option })

		byNode.set(d.nodeKey, [...(byNode.get(d.nodeKey) ?? []), option])
	}

	/**
	 * The tokens a share divides, read from the sampling config that is
	 * actually selected.
	 *
	 * Filled in afterwards, off the built options, rather than resolved again
	 * here. The precedence walk above is the one the runtime performs; a second
	 * copy of it would agree until somebody edited one, and the whole point of
	 * showing the number is that it is the *real* one.
	 *
	 * Only the normalised control gets it. A ceiling is a count of entries, and
	 * a token figure beside it would answer a question it does not ask.
	 */
	const all = [...byNode.values()].flat()
	/**
	 * Which node's pair the budget sizes to — the node the budget's
	 * `samplingOf` / `connectionOf` refs name (`generate` on the shipped
	 * specs). Read off the budget node's stored config rather than taken as
	 * "the first ref in the panel": a multi-agent spec has a connection-ref
	 * per provider, and the first in position order is the planner's, not
	 * the narrator's the budget is sized for. Falls back to the whole panel
	 * for a document with no budget node, which is what it always did.
	 */
	const budgetRefs = await budgetPairNodes(db, at.specVersionId)
	const refsOn = (nodeKey: string | undefined) =>
		nodeKey && byNode.has(nodeKey) ? byNode.get(nodeKey)! : all
	const samplingId = refsOn(budgetRefs.sampling).find(
		(o) => o.control === "sampling-ref" && typeof o.value === "number"
	)?.value as number | undefined
	/**
	 * Which options carry the window: a `share` control, and — since the
	 * shares moved onto the sources (R-7 P5) — each source's own `share`
	 * number in the weights facet — bare, or band-namespaced on a source
	 * publishing more than one band (`recalledLinesShare`, NOMENCLATURE §7).
	 * The number beside a relative share is the window it is a share OF,
	 * which is the one fact that makes a ratio readable.
	 */
	const windowCarriers = new Set(
		decls
			.filter(
				(d) =>
					d.control === "share" ||
					((d.path === "share" || /^[a-z][A-Za-z0-9]*Share$/.test(d.path)) &&
						d.facet === "weights" &&
						d.control === "number")
			)
			.map((d) => optionId(secret, d.nodeKey, d.slot, d.path))
	)
	const carriesWindow = (o: { id: string }) => windowCarriers.has(o.id)
	if (samplingId != null && all.some(carriesWindow)) {
		const [row] = await db
			.select({
				shape: schema.samplingConfigs.shape,
				values: schema.samplingConfigs.values,
				enabled: schema.samplingConfigs.enabled
			})
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, samplingId))
			.limit(1)
		// Through resolveSampling rather than off the row (0171): both budgets
		// are parameters now, so a config with either switched off carries no
		// key here at all — where the NOT NULL columns this replaces always
		// held a number. A sampling-ref naming a row that no longer exists
		// still yields nothing, as it did before.
		const sampling = row ? resolveSampling(row) : null
		if (sampling) {
			// The model's own window, off the pair the connection picker
			// selected (0114) — the same cap the budget and the dispatch
			// apply, read from the node the budget's `connectionOf` names.
			const pair = refsOn(budgetRefs.connection).find(
				(o) => o.control === "connection-ref" && o.value != null
			)?.value
			const modelId = slotModelId(pair)
			const [model] =
				modelId != null
					? await db
							.select({
								contextWindow:
									schema.connectionModels.contextWindow
							})
							.from(schema.connectionModels)
							.where(
								eq(schema.connectionModels.id, Number(modelId))
							)
							.limit(1)
					: []
			// THE arithmetic `core:task/context-budget@1` performs (R-8,
			// `runtime/contextWindow.ts`), because the number on screen has to
			// be the number the ranker divides. It was spelled here a fourth
			// time, with the margin hard-coded, and agreed with the run only
			// while nobody touched either.
			const { available } = contextBudgetFrom({
				sampling,
				connection: model ?? null,
				safetyMargin
			})
			if (available > 0)
				for (const o of all)
					if (carriesWindow(o))
						(o as { windowTokens?: number }).windowTokens =
							available
		}
	}

	// The settings, grouped by model call — derived from the stored graph
	// (`groups.ts`).
	const { loadDocument } = await import("$lib/server/pipelines/boot/store")
	const doc = await loadDocument(db, at.specVersionId)
	const groups = settingsGroupsOf({
		placed,
		decls,
		nodes: doc.nodes,
		edges: doc.edges
	})

	/**
	 * The configurations on offer, minus the ones an administrator withdrew.
	 *
	 * R8: an administrator defines which configurations exist and a person
	 * chooses among them, so `enabled` is the whole of what "the curated set"
	 * means and this is where it is applied. Admins keep seeing the withdrawn
	 * ones, marked, because one an admin has just switched off vanishing
	 * entirely reads as deleted.
	 *
	 * The same rule `listSessionPresets` applies to the session picker, said
	 * once per surface rather than in a shared helper only because the two read
	 * different rows for different questions — but they must agree, and the
	 * write path (`selectNamedConfig`) refuses what this hides.
	 */
	const configRows = (
		await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.specId, at.specId))
			.orderBy(asc(schema.pipelineConfigs.id))
	).filter((c: any) => viewer.isAdmin === true || c.enabled !== false)

	const sub = await subscription(db, at.specVersionId)

	return {
		slug: at.slug,
		name: at.name,
		version: at.semver,
		event: sub.event,
		enabled: sub.enabled,
		taxonomy: at.taxonomy,
		configs: (configRows as any[]).map((c) => ({
			id: c.id,
			name: c.name,
			isDefault: !!c.isDefault,
			// The shipped default is immutable (one per pipeline, always
			// present); the rest are the administrator's to edit. Nobody else
			// owns a configuration (R8) — a person's choice is a selection.
			readOnly: !!c.isImmutable,
			enabled: c.enabled !== false,
			includedActions: Array.isArray(c.includedActions)
				? (c.includedActions as string[])
				: null
		})),
		modeActions: await (async () => {
			const { genreOfSpec, listGenreActions } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const genreId = await genreOfSpec(db, at.slug)
			if (!genreId) return []
			// A disabled plugin's actions are not offered to include (R67).
			const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
			const off = await disabledPlugins(db)
			return (await listGenreActions(db, genreId))
				.filter((t) => !off.ownsId(t.specSlug))
				.map((t) => ({
				key: t.key,
				name: t.name,
				specSlug: t.specSlug,
				origin: t.origin
			}))
		})(),
		selectedConfig: chain.selectedConfig
			? {
					id: chain.selectedConfig.configId,
					name: chain.selectedConfig.name,
					source: chain.selectedConfig.source
				}
			: null,
		/**
		 * May this viewer change the selection, here?
		 *
		 * Sent because the client cannot work it out. A selection made from
		 * inside a session is the session's and anyone who owns that session
		 * may make it; made from anywhere else it is the *pub's*, which is
		 * the administrator's alone — so for a non-admin outside a session
		 * there is nothing to choose, and the picker was a live control whose
		 * every use ended in a refusal toast.
		 *
		 * The same condition `selectNamedConfig` refuses on, which is the
		 * point: this is what the server will accept, not a second opinion
		 * about it.
		 */
		canSelectConfig:
			scope === "session" ? !viewer.readOnlyBecause : viewer.isAdmin === true,
		groups,
		scope:
			scope === "session" && viewer.sessionId != null
				? {
						kind: "session",
						sessionId: viewer.sessionId,
						...(viewer.readOnlyBecause
							? { readOnlyBecause: viewer.readOnlyBecause }
							: {})
					}
				: { kind: "config" }
	}
}
