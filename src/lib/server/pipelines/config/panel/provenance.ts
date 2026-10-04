/**
 * How a Model or Sampling value reads (owner rulings 2026-09-30): what an
 * unset slot resolves to from where the viewer stands, where the value in
 * force came from, and its NAME — never an id.
 *
 * Built from rows `namespaceView` already loaded (`choiceSets`) plus the
 * pub's capability defaults, read once per view; nothing here queries per
 * option.
 */

import { isTransformId } from "@serene-pub/sdk"
import { capabilityForSamplingShape } from "$lib/shared/capabilities/samplingShape"
import {
	slotConnectionId,
	slotModelId
} from "$lib/shared/connections/slotRef"
import type { CapabilityDefault } from "$lib/server/connections/capabilityDefaults"
import type {
	Decl,
	OptionInherits,
	OptionProvenance,
	OptionSource,
	WriteScope
} from "$lib/server/pipelines/config/panel/types"

/** The slice of `choiceSets` this reads. */
export interface NameSets {
	connections: Array<{ id: number; label: string; models?: Array<{ id: number; name: string }> }>
	sampling: Array<{ id: number; label: string }>
	promptRows: Map<number, { name?: string }>
	contextTemplateRows: Map<number, { name?: string }>
	variableTemplateRows: Map<number, { name?: string }>
}

const rowId = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v)
		? v
		: typeof v === "string" && /^\d+$/.test(v)
			? Number(v)
			: null

/** `Endpoint · Model` — the spelling `connections/pairName.ts` gives a pair. */
function pairName(sets: NameSets, value: unknown): string | undefined {
	const connectionId = slotConnectionId(value)
	if (connectionId == null) return undefined
	const c = sets.connections.find((x) => x.id === connectionId)
	if (!c) return undefined
	const modelId = slotModelId(value)
	const m = modelId != null ? c.models?.find((x) => x.id === modelId) : undefined
	return m ? `${c.label} · ${m.name}` : c.label
}

/** The name of a `*-ref` value, or undefined when it names nothing this pub has. */
export function valueNameOf(
	d: Pick<Decl, "control">,
	value: unknown,
	sets: NameSets
): string | undefined {
	if (value == null) return undefined
	const id = rowId(value)
	switch (d.control) {
		case "connection-ref":
			return pairName(sets, value)
		case "sampling-ref":
			return id != null ? sets.sampling.find((s) => s.id === id)?.label : undefined
		case "prompts-ref":
			return id != null ? sets.promptRows.get(id)?.name : undefined
		case "context-template-ref":
			return id != null ? sets.contextTemplateRows.get(id)?.name : undefined
		case "variable-template-ref":
			return id != null ? sets.variableTemplateRows.get(id)?.name : undefined
		default:
			return undefined
	}
}

/** The capability an unset model or sampling slot falls back through (`world.ts` keys the default the same way). */
export function capabilityOfSlot(d: Pick<Decl, "requires" | "shape">): string | undefined {
	return d.requires?.find(isTransformId) ?? capabilityForSamplingShape(d.shape)
}

/** What the pub default names for this slot, by name. */
function pubDefaultNameOf(
	d: Pick<Decl, "control" | "requires" | "shape">,
	defaults: Record<string, CapabilityDefault>,
	sets: NameSets
): string | undefined {
	const capability = capabilityOfSlot(d)
	const row = capability ? defaults[capability] : undefined
	if (!row) return undefined
	if (d.control === "connection-ref")
		return row.connectionId != null
			? pairName(sets, { ref: row.connectionId, modelId: row.connectionModelId })
			: undefined
	return row.samplingConfigId != null
		? sets.sampling.find((s) => s.id === row.samplingConfigId)?.label
		: undefined
}

const MISSING = "(no longer exists)"

/**
 * `inherits`, `provenance` and `valueLabel` for one option. Only a
 * `connection-ref` or `sampling-ref` gets the first two; every `*-ref` gets
 * `valueLabel` when its value names a row.
 */
export function readingOf(args: {
	d: Pick<Decl, "control" | "requires" | "shape" | "authorDefault">
	value: unknown
	source: OptionSource
	/** The selected configuration's value at this address, when it holds one. */
	configured: { has: boolean; value?: unknown }
	scope: WriteScope
	configName: string | undefined
	defaults: Record<string, CapabilityDefault>
	sets: NameSets
}): { inherits?: OptionInherits; provenance?: OptionProvenance; valueLabel?: string } {
	const { d, value, source, configured, scope, configName, defaults, sets } = args
	const named = valueNameOf(d, value, sets)
	if (d.control !== "connection-ref" && d.control !== "sampling-ref")
		return named ? { valueLabel: named } : {}

	const nothing = d.control === "connection-ref" ? "No model set" : "No sampling config set"
	const pubDefault = pubDefaultNameOf(d, defaults, sets)
	const nameOr = (v: unknown) => valueNameOf(d, v, sets) ?? MISSING

	// What removing this scope's row would leave in force.
	const inherits: OptionInherits =
		scope === "session" && configured.has && configured.value != null
			? { from: "config", label: `As configured — ${nameOr(configured.value)}` }
			: d.authorDefault != null
				? { from: "pipeline", label: `Pipeline default — ${nameOr(d.authorDefault)}` }
				: pubDefault
					? { from: "pub", label: `Pub default — ${pubDefault}` }
					: { from: "none", label: nothing }

	// Where the value in force came from.
	const provenance: OptionProvenance =
		value == null
			? pubDefault
				? { source: "pub", label: "Pub default" }
				: { source: "none", label: nothing }
			: source === "session"
				? { source: "session", label: "Set for this session" }
				: source === "config"
					? scope === "config"
						? { source: "config", label: "Set in this configuration" }
						: {
								source: "config",
								label: configName
									? `From the “${configName}” configuration`
									: "From the selected configuration"
							}
					: { source: "author", label: "Pipeline default" }

	const valueLabel = value == null ? pubDefault : (named ?? MISSING)
	return { inherits, provenance, ...(valueLabel ? { valueLabel } : {}) }
}
