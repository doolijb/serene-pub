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
import { and, asc, eq, inArray } from "drizzle-orm"
import { resolveSampling } from "$lib/server/utils/resolveSampling"
import { contextBudgetFrom } from "$lib/server/pipelines/runtime/contextWindow"
import {
	slotConnectionId,
	slotModelId
} from "$lib/shared/connections/slotRef"
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
	subscription,
	unplacedChainDecls
} from "$lib/server/pipelines/config/panel/declarations"
import { chainNodesFor } from "$lib/server/pipelines/config/chainAddresses"
import {
	settingsGroupsOf,
	type PlacedOption
} from "$lib/server/pipelines/config/panel/groups"
import { readingOf } from "$lib/server/pipelines/config/panel/provenance"
import {
	bestWithWords,
	loadoutPanel,
	needsWords,
	slotLoadoutOf,
	stepNeedsOf,
	transformOfNode,
	type NodeLoadout
} from "$lib/server/pipelines/config/panel/loadouts"
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

	/**
	 * 🚧 What sits above the declaration (R38, PLAN-layering D5), read by the
	 * same functions the runtime uses (`world.ts applyPipelineLayer`): the
	 * pipeline's declared defaults, the genre's defaults' registration values
	 * over them, the session's preset's over those, and a session's own
	 * registration values on top (the upgrade's home for a configuration a
	 * session had selected), with the pipeline's instance values (R50) under
	 * the genre layer. One map, highest last — the panel's `config` source.
	 * No configuration is read (retired, 0110).
	 */
	const { shippedConfigValues, shippedConfigValuesOf } = await import(
		"$lib/server/pipelines/config/named"
	)
	const { registrationValueLayers, addressedValues } = await import(
		"$lib/server/pipelines/registrations/values"
	)
	const decls = await declarations(db, at.specVersionId)
	// The declared defaults where they depart from the declaration (a
	// reference, a preset value) — what the shipped Default stored; a value
	// equal to its declaration reads as the declaration's (`author`).
	const { isDeviation } = await import("$lib/server/pipelines/config/deviations")
	const declByKey = new Map(decls.map((d) => [addr(d.nodeKey, d.slot, d.path), d]))
	const preset = new Map<string, unknown>(
		[...(await shippedConfigValuesOf(db, at.specId, at.slug, at.specVersionId, decls))].filter(([key, value]) => {
			const d = declByKey.get(key)
			return !d || isDeviation(d as never, value)
		})
	)
	const layersOf = await registrationValueLayers(db, {
		specSlug: at.slug,
		specId: at.specId,
		sessionId: viewer.sessionId ?? null
	})
	// 🚧 Which registration layer each value came from — the provenance
	// label's words until lane 7 names the layers in the client.
	const layerOf = new Map<string, "instance" | "genre" | "preset" | "session">()
	for (const [name, layer] of [
		["instance", layersOf.instance],
		["genre", layersOf.genre],
		["preset", layersOf.preset],
		["session", layersOf.session]
	] as const) {
		const stated = addressedValues(layer, decls)
		if (!stated.size) continue
		const resolved = await shippedConfigValues(db, at.specId, at.slug, decls, stated)
		for (const key of stated.keys()) {
			preset.set(key, resolved.has(key) ? resolved.get(key) : stated.get(key))
			layerOf.set(key, name)
		}
	}
	return {
		session:
			viewer.sessionId != null
				? scoped("session", viewer.sessionId)
				: null,
		preset,
		layerOf
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
	// 🚧 A pipeline registrations mount states no genre (no lock): its
	// claim is the one genre whose defaults register it (PLAN-layering D3).
	const { soleRegisteringGenres } = await import("$lib/server/pipelines/registrations/resolve")
	const registered = await soleRegisteringGenres(db)
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
			taxonomy: (() => {
				const t = (version.taxonomy as any) ?? null
				const genre = registered.get(spec.slug)
				if (!genre || t?.genre) return t
				return { ...(t ?? {}), genre }
			})()
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

/**
 * `decls` plus one synthetic `scripts-chain` option per stored address that
 * is an unplaced chain (D4), each spliced in after its step's last declared
 * option — the Advanced fold lists a step's options in push order.
 */
export async function withUnplacedChains(
	db: Db,
	specVersionId: number,
	decls: Decl[],
	storedKeys: Iterable<string>
): Promise<Decl[]> {
	const declaredKeys = new Set(decls.map((d) => addr(d.nodeKey, d.slot, d.path)))
	const candidates: Array<{ nodeKey: string; slot: string; path: string }> = []
	for (const key of storedKeys) {
		if (declaredKeys.has(key)) continue
		const [nodeKey, slot, path] = key.split("\u0000") as [string, string, string]
		candidates.push({ nodeKey, slot, path: path ?? "" })
	}
	if (!candidates.length) return decls
	const extra = unplacedChainDecls(
		await chainNodesFor(db, specVersionId),
		candidates
	)
	if (!extra.length) return decls
	const out = [...decls]
	for (const u of extra) {
		let at = -1
		for (let i = 0; i < out.length; i++)
			if (out[i]!.nodeKey === u.nodeKey) at = i
		if (at === -1) out.push(u)
		else out.splice(at + 1, 0, u)
	}
	return out
}

export async function namespaceView(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer
): Promise<NamespaceView | null> {
	const at = await published(db, slug)
	if (!at) return null

	const declared = await declarations(db, at.specVersionId)
	const chain = await layers(db, at, viewer)
	const sets = await choiceSets(db, at.specId)
	// 🚧 What the shipped Default holds, for the Changed mark (Q3-6, #50).
	const { shippedConfigValuesOf } = await import("$lib/server/pipelines/config/named")
	const { sameConfiguredValue } = await import("$lib/server/pipelines/config/deviations")
	const shipped = await shippedConfigValuesOf(db, at.specId, at.slug, at.specVersionId, declared)
	// A stored chain whose seam is gone stays visible (D4, *unplaced*): one
	// synthetic option per such address, placed after its step's declared
	// options, so the row can be seen and cleared rather than run silently
	// skipped. Only addresses that hold a value can be unplaced.
	const decls = await withUnplacedChains(db, at.specVersionId, declared, [
		...chain.preset.keys(),
		...(chain.session?.keys() ?? [])
	])
	// The connection's stop guards, for the effective-chain view (18 §4c):
	// resolved by the same rule the runtime uses, so what the step card shows
	// beside the chain is what the run actually evaluates. Read-only here —
	// they are managed on the connection, and the badge says so.
	const { connectionStopsFor } = await import(
		"$lib/server/pipelines/scripts/chains"
	)
	// Per step, through the step's configured connection (tier 2) — the one
	// dispatch runs that step on — and the instance default where the
	// configuration names none. A guard listed beside a chain from a
	// connection the step does not use would be the wrong answer to "why did
	// my reply cut off".
	const stopsMemo = new Map<
		string,
		ReturnType<typeof connectionStopsFor>
	>()
	// A step with no model of its own (an outlet's `in:text` seam — where
	// core's stop seams sit) is guarded by the connection of the run's text
	// provider: the node the budget pairs its connection with, else the first
	// step that has a Model row.
	const provider =
		(await budgetPairNodes(db, at.specVersionId)).connection ??
		decls.find((x) => x.matrixSlot === "connection")?.nodeKey
	const connStopsFor = (nodeKey: string) => {
		const own =
			decls.find(
				(x) => x.nodeKey === nodeKey && x.matrixSlot === "connection"
			) ??
			decls.find(
				(x) => x.nodeKey === provider && x.matrixSlot === "connection"
			)
		const stored = own
			? (chain.preset.get(addr(own.nodeKey, own.slot, own.path)) ??
				own.authorDefault)
			: undefined
		const candidate =
			stored == null
				? null
				: {
						connectionId: slotConnectionId(stored),
						connectionModelId: slotModelId(stored)
					}
		const key = JSON.stringify(candidate)
		if (!stopsMemo.has(key))
			stopsMemo.set(key, connectionStopsFor(db, candidate))
		return stopsMemo.get(key)!
	}
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
	// The settings, grouped by model call — derived from the stored graph
	// (`groups.ts`).
	const { loadDocument } = await import("$lib/server/pipelines/boot/store")
	const doc = await loadDocument(db, at.specVersionId)
	// What each step and agent receives and carries out (`flows.ts`): read
	// off the registry rows of the definitions this document places. The
	// admin's view only — a member's payload carries no wiring (05 §0a).
	let definitionOf: ((n: { definitionId?: string; definitionVersion?: number }) => any) | undefined
	if (viewer.isAdmin) {
		const ids = [...new Set(doc.nodes.map((n) => n.definitionId))]
		const rows = ids.length
			? await db
					.select({
						definitionId: schema.pipelineDefinitionRegistry.definitionId,
						version: schema.pipelineDefinitionRegistry.version,
						kind: schema.pipelineDefinitionRegistry.kind,
						ports: schema.pipelineDefinitionRegistry.ports,
						effects: schema.pipelineDefinitionRegistry.effects,
						i18n: schema.pipelineDefinitionRegistry.i18n,
						policy: schema.pipelineDefinitionRegistry.policy
					})
					.from(schema.pipelineDefinitionRegistry)
					.where(inArray(schema.pipelineDefinitionRegistry.definitionId, ids))
			: []
		const byPin = new Map(
			rows.map((r) => [
				`${r.definitionId}@${r.version}`,
				{
					kind: r.kind,
					ports: r.ports,
					effects: r.effects,
					policy: r.policy,
					name: i18nText(r.i18n?.name)
				}
			])
		)
		definitionOf = (n) => byPin.get(`${n.definitionId}@${n.definitionVersion}`)
	}

	// The Loadout row (I12, §14 item 4) — the admin's own view only: each
	// model call's loadout, resolved as the run resolves it, so the chain
	// and the slots' provenance say what will run. A session never picks a
	// loadout (`WRITE_MATRIX.loadout = ['config']`), so a session's view
	// carries no Loadout row at all — not even read-only.
	const lp = viewer.isAdmin ? await loadoutPanel(db) : null
	const nodeLoadouts = new Map<string, NodeLoadout | null>()
	if (lp)
		for (const d of decls)
			if (d.control === "loadout-ref") {
				const key = addr(d.nodeKey, d.slot, d.path)
				nodeLoadouts.set(
					d.nodeKey,
					await lp.nodeLoadout(chain.preset.has(key) ? chain.preset.get(key) : d.authorDefault)
				)
			}
	const docNode = new Map(doc.nodes.map((n) => [n.key, n]))
	for (const d of decls) {
		if (!visibleTo(d.matrixSlot, viewer)) continue
		if (d.control === "loadout-ref" && (scope === "session" || !lp)) continue

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
				((c) =>
					// 🚧 R54: a member chooses among the prompts an administrator
					// has not hidden — the one in force stays listed.
					c && d.control === "prompts-ref" && !viewer.isAdmin
						? c.filter((x) => !x.hidden || x.id === value)
						: c)(choicesFor(d, sets, [value, d.authorDefault]))
			),
			...(chainEntries ? { scripts: chainEntries } : {}),
			// Where the chain runs and what can go there (D3): the seam
			// address, what flows through it, and the accepted kinds by
			// NAME — the ids stay server-side (`Decl.accepts`).
			...(d.control === "scripts-chain"
				? {
						...(d.at ? { at: d.at } : {}),
						...(d.seamKind ? { seamKind: d.seamKind } : {}),
						...(d.flows ? { flows: d.flows } : {}),
						acceptsLabels: (d.accepts ?? []).map(
							(k) => sets.scriptTypeMeta.get(k)?.name ?? k
						),
						...(d.unplaced ? { unplaced: true } : {})
					}
				: {}),
			...((connStops) =>
				connStops
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
					: {})(
				d.control === "scripts-chain" &&
					(d.accepts ?? []).includes("core:script:text/stop@1")
					? await connStopsFor(d.nodeKey)
					: undefined
			),
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
			 *
			 * 🚧 …and a row the shipped Default holds too, at the same value, is
			 * no departure (PLAN-dc-after-walk2 Q3-6, the walk's #50): a
			 * reference's row is always written (`deviations.ts`), so an
			 * untouched config marked every prompt and sampling row Changed.
			 */
			changed:
				chain.preset.has(key) &&
				!(shipped.has(key) && sameConfiguredValue(chain.preset.get(key), shipped.get(key)))
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
				layer: chain.layerOf.get(key),
				defaults: pubByCapability,
				sets,
				// 🚧 O7: a loadout carries the TEXT sampling only; a speech
				// sampling slot is never "the loadout's".
				...((d.control === "connection-ref" || d.control === "sampling-ref") &&
				(d as { slot?: string }).slot !== "speechSampling" &&
				nodeLoadouts.has(d.nodeKey)
					? {
							loadout: slotLoadoutOf(
								nodeLoadouts.get(d.nodeKey) ?? null,
								d.control === "connection-ref" ? "connection" : "sampling"
							)
						}
					: {})
			})
		)
		// *Use loadout's* — a value set here over a named loadout.
		if (
			(d.control === "connection-ref" || d.control === "sampling-ref") &&
			(d as { slot?: string }).slot !== "speechSampling" &&
			source === "config" &&
			scope === "config" &&
			nodeLoadouts.get(d.nodeKey)
		)
			option.useLoadout = nodeLoadouts.get(d.nodeKey)!.row.name
		if (d.control === "loadout-ref" && lp) {
			const nl = nodeLoadouts.get(d.nodeKey) ?? null
			const node = docNode.get(d.nodeKey)
			const def = node ? definitionOf?.(node) : undefined
			const needs = node ? stepNeedsOf(node, doc.edges, def) : {}
			const transform = transformOfNode(decls, d.nodeKey)
			option.choices = await lp.choices(transform, needs, (cid) =>
				(sets.connections.find((c) => c.id === cid) as any)?.capabilities
			)
			const needsLine = needsWords(transform, needs)
			const bestWith = bestWithWords(
				((node as any)?.prefers ?? (def?.policy as any)?.prefers) as
					| { sampling?: string; tier?: string }
					| undefined,
				lp.samplingNameBySeed
			)
			option.loadout = {
				...(nl ? { selected: { id: nl.row.id, name: nl.row.name, chain: nl.chain } } : {}),
				...(needsLine.length ? { needs: needsLine } : {}),
				...(bestWith.length ? { bestWith } : {})
			}
			if (nl) option.valueLabel = nl.row.name
			else if (value != null) option.valueLabel = "(no longer exists)"
		}
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

	const groups = settingsGroupsOf({
		placed,
		decls,
		nodes: doc.nodes,
		edges: doc.edges,
		// 🚧 How a nested clause sits in a junction's branch (alternative branches, lane T3).
		clauses: (doc.clauses ?? []).map((c) => ({ id: c.id, kind: c.kind, ...(c.clauseId ? { clauseId: c.clauseId } : {}), ...(c.clauseChain ? { clauseChain: c.clauseChain } : {}) })),
		definitionOf
	})

	const sub = await subscription(db, at.specVersionId)

	return {
		slug: at.slug,
		name: at.name,
		version: at.semver,
		event: sub.event,
		enabled: sub.enabled,
		// 🚧 The registering genre where no lock claims one (PLAN-layering D3).
		taxonomy: await (async () => {
			const t = (at.taxonomy as any) ?? null
			if (t?.genre) return t
			const { soleRegisteringGenres } = await import("$lib/server/pipelines/registrations/resolve")
			const genre = (await soleRegisteringGenres(db)).get(at.slug)
			return genre ? { ...(t ?? {}), genre } : t
		})(),
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
