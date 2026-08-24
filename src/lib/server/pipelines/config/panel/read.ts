/**
 * The configuration panel's read model.
 *
 * `listNamespaces` is the index; `namespaceView` is one pipeline fully
 * resolved — every declaration, its value, and **where that value won**. The
 * scope chain is walked most-specific-first by `layers`, and the winning layer
 * becomes the option's `source`, which is what lets the UI say "inherited from
 * the instance default" rather than just showing a value.
 */

import { asc, eq } from "drizzle-orm"
import { getFacet } from "@serene-pub/sdk"
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
import {
	visibleTo,
	writeScopeFor
} from "$lib/server/pipelines/config/panel/scopes"
import {
	type ConfigOption,
	type ConfigStep,
	type Db,
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

	const out: NamespaceSummary[] = []
	for (const spec of specs as any[]) {
		if (!spec.activeVersionId) continue
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
			enabled: sub.enabled
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
			...(d.min != null ? { min: d.min } : {}),
			...(d.max != null ? { max: d.max } : {}),
			...(d.of ? { of: d.of } : {}),
			...(d.members ? { members: d.members } : {}),
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
										contextTemplateRow.nodeTypeId
									) as any[] | undefined
								)?.find((c) => c.id === contextTemplateRow.id)
							)
						}
					}
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
							declared: d.promptFields ?? []
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
			// prompts line; config writes are the admin's, on the instance
			// column (a config's values are what the whole instance resolves).
			writable:
				effScope === "session"
					? mayWrite(d.matrixSlot, "session" as ScopeKind) &&
						(viewer.isAdmin || d.matrixSlot === "prompts")
					: viewer.isAdmin &&
						mayWrite(d.matrixSlot, "instance" as ScopeKind),
			overriddenHere:
				effScope === "session"
					? !!chain.session?.has(key)
					: chain.preset.has(key)
		}

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

	const nodeKeys = [...byNode.keys()]
	const typeLabelOf = new Map<string, string>()
	for (const d of decls)
		if (!typeLabelOf.has(d.nodeKey)) typeLabelOf.set(d.nodeKey, d.typeLabel)
	const labels = stepLabels(nodeKeys, typeLabelOf)

	// `key` is the step's ordinal, not the node key — the id scheme for
	// writes stays the HMAC per option, and the payload still never names a
	// node (see `ConfigStep`).
	const kindOf = new Map<string, string>()
	for (const d of decls)
		if (!kindOf.has(d.nodeKey)) kindOf.set(d.nodeKey, d.nodeKind)

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
	const samplingId = all.find(
		(o) => o.control === "sampling-ref" && typeof o.value === "number"
	)?.value as number | undefined
	if (samplingId != null && all.some((o) => o.control === "share")) {
		const [row] = await db
			.select({
				contextTokens: schema.samplingConfigs.contextTokens,
				responseTokens: schema.samplingConfigs.responseTokens
			})
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, samplingId))
			.limit(1)
		// The same arithmetic `core:task/context-budget@1` performs, because
		// the number on screen has to be the number the ranker divides.
		const window = (row?.contextTokens ?? 0) - (row?.responseTokens ?? 0)
		if (window > 0)
			for (const o of all)
				if (o.control === "share")
					(o as { windowTokens?: number }).windowTokens = Math.floor(
						window * 0.95
					)
	}

	const steps: ConfigStep[] = nodeKeys.map((nodeKey, i) => ({
		key: `s${i}`,
		label: labels.get(nodeKey) ?? nodeKey,
		kind: kindOf.get(nodeKey) ?? "",
		options: byNode.get(nodeKey)!.options,
		advanced: byNode.get(nodeKey)!.advanced
	}))

	const configRows = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.specId, at.specId))
		.orderBy(asc(schema.pipelineConfigs.id))

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
		configs: (configRows as any[]).map((c) => ({
			id: c.id,
			name: c.name,
			isDefault: !!c.isDefault,
			// The shipped default is immutable (one per pipeline, always
			// present) — copies a person made are theirs to edit.
			readOnly: !!c.isImmutable,
			enabled: c.enabled !== false,
			includedActions: Array.isArray(c.includedActions)
				? (c.includedActions as string[])
				: null
		})),
		modeActions: await (async () => {
			const { modeOfSpec, listModeTriggers } = await import(
				"$lib/server/pipelines/entities/sessionModes"
			)
			const modeId = await modeOfSpec(db as any, at.slug)
			if (!modeId) return []
			return (await listModeTriggers(db as any, modeId)).map((t) => ({
				function: t.function,
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
		steps,
		writeScope: scope
	}
}
