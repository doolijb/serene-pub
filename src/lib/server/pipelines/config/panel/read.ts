/**
 * The configuration panel's read model.
 *
 * `listNamespaces` is the index; `namespaceView` is one pipeline fully
 * resolved — every declaration, its value, and **where that value won**. The
 * scope chain is walked most-specific-first by `layers`, and the winning layer
 * becomes the option's `source`, which is what lets the UI say "inherited from
 * the instance default" rather than just showing a value.
 */

import { valueDeclOf } from "@serene-pub/sdk"
import { and, asc, eq } from "drizzle-orm"
import { getFacet } from "@serene-pub/sdk"
import { resolveSampling } from "$lib/server/utils/resolveSampling"
import { contextBudgetFrom } from "$lib/server/pipelines/runtime/contextWindow"
import { slotModelId } from "$lib/shared/connections/slotRef"
import { i18nText } from "$lib/server/pipelines/config/panel/declarations"
import * as schema from "$lib/server/db/schema"
import { mayWrite, type ScopeKind } from "@serene-pub/sdk"
import {
	choiceSets,
	choicesFor
} from "$lib/server/pipelines/config/panel/choices"
import {
	type Published,
	declarations,
	published,
	stepLabels,
	subscription
} from "$lib/server/pipelines/config/panel/declarations"
import { optionId } from "$lib/server/pipelines/config/panel/ids"
import { promptPoolKeyFor } from "$lib/server/pipelines/entities/promptPool"
import { acceptedEngines } from "$lib/shared/pipelines/templateEngines"
import {
	visibleTo,
	writeScopeFor
} from "$lib/server/pipelines/config/panel/scopes"
import {
	type ConfigOption,
	type ConfigStep,
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
 * at `preset` (its historical key); the session's overrides are the only scoped
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
 * A facet nobody declared, made readable.
 *
 * `retrieval` becomes `Retrieval`. Not a guess at what the author meant — a
 * heading is better than no heading, and no heading is what an undeclared facet
 * used to get: its options matched no group in the client's fixed list and
 * rendered nowhere.
 */
/**
 * One facet, as the panel needs it.
 *
 * Exported so the undeclared case can be tested at all — it is the branch that
 * matters and the one that used to lose settings, and it cannot be reached
 * through `namespaceView` without a plugin installed.
 *
 * An undeclared facet is not an error and not a drop: it gets a humanised
 * heading and sorts after everything core declares, because a heading somebody
 * did not choose is still better than a setting nobody can find.
 */
/**
 * The facets a view contains, resolved and ordered.
 *
 * **Every distinct facet in, every one out.** Stated as its own function so
 * that property can be tested with a facet nothing declares — which is the case
 * that used to lose settings and the one a shipped pipeline cannot reach, since
 * core declares all of its own. A filter here would be invisible until somebody
 * installed a plugin.
 */
export function facetsFor(used: Iterable<string>) {
	return [...new Set(used)]
		.map(resolveFacet)
		.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
}

export function resolveFacet(id: string): {
	id: string
	label: string
	order: number
	simple: boolean
} {
	const d = getFacet(id)
	return {
		id,
		label: i18nText(d?.i18n) ?? humanizeFacet(id),
		order: d?.order ?? 900,
		simple: d?.simple ?? false
	}
}

const humanizeFacet = (id: string): string =>
	id
		.replace(/[_-]+/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/^./, (c) => c.toUpperCase())

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

	// Group by node, in declaration order — which is node position, because
	// that is how `declarations` walks. `advanced` splits the tuning
	// parameters out so a step leads with its prompt and references.
	const byNode = new Map<
		string,
		{ options: ConfigOption[]; advanced: ConfigOption[] }
	>()
	/**
	 * The budget node's margin as this viewer resolves it, for the window
	 * figure below. Captured in the walk rather than looked up afterwards,
	 * because an option carries no address — the payload never names a node.
	 */
	let safetyMargin: unknown
	for (const d of decls) {
		if (!visibleTo(d.matrixSlot, viewer)) continue

		const key = addr(d.nodeKey, d.slot, d.path)
		// The same order the runtime resolves in: the session's override beats
		// the selected config beats the author default — the whole chain,
		// since the simplification. The two walks must agree or the panel
		// shows a value the run does not use.
		let value: unknown = d.authorDefault
		let source: OptionSource = "author"
		if (chain.session?.has(key)) {
			value = chain.session.get(key)
			source = "session"
		} else if (chain.preset.has(key)) {
			value = chain.preset.get(key)
			source = "preset"
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

		const option: ConfigOption = {
			id: optionId(secret, d.nodeKey, d.slot, d.path),
			label: d.label,
			facet: d.facet,
			...(d.quick ? { quick: true } : {}),
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
			...((c) => (c ? { choices: c } : {}))(choicesFor(d, sets)),
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
				? { templateEngines: acceptedEngines(d) }
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
			// prompts line; config writes are the admin's, on the preset column
			// (a config's values are what the whole instance resolves — R-10
			// folded `instance` into `preset`, the selected config).
			writable:
				effScope === "session"
					? mayWrite(d.matrixSlot, "session" as ScopeKind) &&
						(viewer.isAdmin || d.matrixSlot === "prompts")
					: viewer.isAdmin &&
						mayWrite(d.matrixSlot, "preset" as ScopeKind),
			overriddenHere:
				effScope === "session"
					? !!chain.session?.has(key)
					: chain.preset.has(key),
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

		let group = byNode.get(d.nodeKey)
		if (!group) {
			group = { options: [], advanced: [] }
			byNode.set(d.nodeKey, group)
		}
		// "Advanced" is the tuning surface — weights, budgets, thresholds —
		// plus the raw templates. A template is the *rendering* of a step
		// rather than a decision about it, it is empty until someone
		// deliberately replaces the built-in wording, and an empty box
		// labelled "Template" above the prompt is the panel's most confusing
		// square inch. The step then leads with what people came for: its
		// prompt, its connection, its review gate.
		//
		// Variable layouts go here too, on the same argument one level down: how
		// characters are laid out is the *rendering* of a step rather than a
		// decision about it. The other reason is arithmetic — the context step
		// declares eight of them, and eight pickers above the prompt would bury
		// the one thing most people opened the panel to change.
		if (
			d.matrixSlot === "params" ||
			d.matrixSlot === "template" ||
			d.matrixSlot === "variables"
		)
			group.advanced.push(option)
		else group.options.push(option)
	}

	// `declarations()` already sorts these to the spine order: a node at its
	// own position, a clause tied with (and just before) its first member,
	// and an envoy pushed past the end — which is what lets the split below
	// be a filter rather than a second sort.
	const allNodeKeys = [...byNode.keys()]
	const typeLabelOf = new Map<string, string>()
	for (const d of decls)
		if (!typeLabelOf.has(d.nodeKey)) typeLabelOf.set(d.nodeKey, d.typeLabel)
	const labels = stepLabels(allNodeKeys, typeLabelOf)

	// `key` is the step's ordinal, not the node key — the id scheme for
	// writes stays the HMAC per option, and the payload still never names a
	// node (see `ConfigStep`).
	const kindOf = new Map<string, string>()
	for (const d of decls)
		if (!kindOf.has(d.nodeKey)) kindOf.set(d.nodeKey, d.nodeKind)

	/**
	 * An envoy is not a step in the run's spine — nothing executes it, and
	 * counting it among "step N of M" would tell a reader a pipeline has one
	 * more thing happening than it does. Its settings still need a home, so
	 * they render after the steps in their own unnumbered group (U5g review
	 * follow-up; `namespaceView` below, `alsoConfigured`).
	 */
	const nodeKeys = allNodeKeys.filter((k) => kindOf.get(k) !== "envoy")
	const envoyKeys = allNodeKeys.filter((k) => kindOf.get(k) === "envoy")

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
	const all = [...byNode.values()].flatMap((n) => [
		...n.options,
		...n.advanced
	])
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
		nodeKey && byNode.has(nodeKey)
			? [...byNode.get(nodeKey)!.options, ...byNode.get(nodeKey)!.advanced]
			: all
	const samplingId = refsOn(budgetRefs.sampling).find(
		(o) => o.control === "sampling-ref" && typeof o.value === "number"
	)?.value as number | undefined
	/**
	 * Which options carry the window: a `share` control, and — since the
	 * shares moved onto the sources (R-7 P5) — each source's own `share`
	 * number in the weights facet. The number beside a relative share is the
	 * window it is a share OF, which is the one fact that makes a ratio
	 * readable.
	 */
	const windowCarriers = new Set(
		decls
			.filter(
				(d) =>
					d.control === "share" ||
					(d.path === "share" &&
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

	const steps: ConfigStep[] = nodeKeys.map((nodeKey, i) => ({
		key: `s${i}`,
		label: labels.get(nodeKey) ?? nodeKey,
		kind: kindOf.get(nodeKey) ?? "",
		options: byNode.get(nodeKey)!.options,
		advanced: byNode.get(nodeKey)!.advanced
	}))
	// Trailing and unnumbered on purpose — see the filter above.
	const alsoConfigured: ConfigStep[] = envoyKeys.map((nodeKey, i) => ({
		key: `e${i}`,
		label: labels.get(nodeKey) ?? nodeKey,
		kind: kindOf.get(nodeKey) ?? "",
		options: byNode.get(nodeKey)!.options,
		advanced: byNode.get(nodeKey)!.advanced
	}))

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

	/**
	 * The facets this view actually contains, resolved for display.
	 *
	 * Only the ones in use, so the panel never renders an empty heading — and
	 * an *undeclared* facet still appears, humanised, rather than being dropped.
	 * A setting that exists and is writable must be reachable; the client used
	 * to filter options into a fixed list, so anything it had not heard of
	 * rendered nowhere.
	 */
	const facets = facetsFor(all.map((o) => o.facet))

	return {
		facets,
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
			const { genreOfSpec, listGenreTriggers } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const genreId = await genreOfSpec(db, at.slug)
			if (!genreId) return []
			// A disabled plugin's actions are not offered to include (R67).
			const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
			const off = await disabledPlugins(db)
			return (await listGenreTriggers(db, genreId))
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
		 * may make it; made from anywhere else it is the *instance's*, which is
		 * the administrator's alone — so for a non-admin outside a session
		 * there is nothing to choose, and the picker was a live control whose
		 * every use ended in a refusal toast.
		 *
		 * The same condition `selectNamedConfig` refuses on, which is the
		 * point: this is what the server will accept, not a second opinion
		 * about it.
		 */
		canSelectConfig: scope === "session" || viewer.isAdmin === true,
		steps,
		alsoConfigured,
		writeScope: scope
	}
}
