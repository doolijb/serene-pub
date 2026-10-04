/**
 * The Models table's levers on Admin → Connections' change form, held as
 * pending changes until the page's Save (owner ruling 2026-10-03: the
 * admin "levers wait for Save" pattern, STYLE-GUIDE §6.11 / §6.14).
 *
 * Two levers: a model's **Hide / Show** (`enabled`) and its **Use** (make it
 * a capability default). Like every switch on an admin change form, both
 * wait for Save. **Refresh**, **Add by name** and a local model's
 * **Download / Cancel** are one-shot acts with their own buttons and act
 * when pressed.
 *
 * Pure, so it is tested (`modelEdits.test.ts`). The page holds a
 * `ModelEdits` draft; everything it shows and sends is derived from that
 * draft against what is saved:
 *
 * - **Pending means different from saved, never "touched"** (§6.14). An
 *   edit that a push catches up with — another tab hid the same model —
 *   stops counting by itself (`liveModelEdits`), and pressing a lever back
 *   to where it was drops the edit rather than keeping a no-op.
 * - **Save sends visibility first, then defaults** (`modelEditPlan`). The
 *   server refuses to make a switched-off model a default, so a Use on a
 *   model this same Save switches on names that write in `after`, and is
 *   not sent if it was refused.
 */
import { modelDisplay } from "$lib/client/components/connections/modelDisplay"

export interface ModelEdits {
	/** Model id → the visibility asked for. */
	enabled: Record<number, boolean>
	/** Capability → the model (on THIS connection) asked to be its default. */
	defaults: Record<string, number>
}

export function noModelEdits(): ModelEdits {
	return { enabled: {}, defaults: {} }
}

export interface EditableModel {
	id: number
	name?: string | null
	model: string
	enabled?: boolean | null
}

export type SavedDefaults = Record<
	string,
	| { connectionId?: number | null; connectionModelId?: number | null }
	| undefined
>

/** Absent means on: only an explicit `false` hides a model. */
export function isShown(model: Pick<EditableModel, "enabled">): boolean {
	return model.enabled !== false
}

/**
 * What a step calls a model: the table's own display name (`modelDisplay`,
 * the identifier with packager, format and quantisation lifted out), so a
 * chip names the row the person pressed in the words that row shows.
 */
function nameOf(model: EditableModel | undefined, id: number): string {
	return model ? modelDisplay(model).name : `model ${id}`
}

function isSavedDefault(
	defaults: SavedDefaults,
	capability: string,
	connectionId: number,
	modelId: number
): boolean {
	const d = defaults?.[capability]
	return d?.connectionId === connectionId && d?.connectionModelId === modelId
}

/**
 * The edits that still differ from what is saved. A model the host no
 * longer lists (gone from `models`) drops its edits too: there is nothing
 * left to send them to.
 */
export function liveModelEdits(
	edits: ModelEdits,
	models: readonly EditableModel[],
	defaults: SavedDefaults,
	connectionId: number
): ModelEdits {
	const byId = new Map(models.map((m) => [m.id, m]))
	const enabled: Record<number, boolean> = {}
	for (const [key, want] of Object.entries(edits.enabled)) {
		const model = byId.get(Number(key))
		if (model && isShown(model) !== want) enabled[model.id] = want
	}
	const out: Record<string, number> = {}
	for (const [capability, modelId] of Object.entries(edits.defaults)) {
		if (!byId.has(modelId)) continue
		if (!isSavedDefault(defaults, capability, connectionId, modelId))
			out[capability] = modelId
	}
	return { enabled, defaults: out }
}

export function modelEditCount(edits: ModelEdits): number {
	return Object.keys(edits.enabled).length + Object.keys(edits.defaults).length
}

/** Ask for a model shown or hidden; asking for what is saved drops the edit. */
export function withEnabledEdit(
	edits: ModelEdits,
	model: EditableModel,
	enabled: boolean
): ModelEdits {
	const next = { ...edits.enabled }
	if (isShown(model) === enabled) delete next[model.id]
	else next[model.id] = enabled
	return { ...edits, enabled: next }
}

/** Ask for a model as a capability's default; asking for what is saved drops it. */
export function withDefaultEdit(
	edits: ModelEdits,
	capability: string,
	modelId: number,
	defaults: SavedDefaults,
	connectionId: number
): ModelEdits {
	const next = { ...edits.defaults }
	if (isSavedDefault(defaults, capability, connectionId, modelId))
		delete next[capability]
	else next[capability] = modelId
	return { ...edits, defaults: next }
}

/** The models as the table draws them: visibility from the draft. */
export function modelsWithEdits<M extends EditableModel>(
	models: readonly M[],
	edits: ModelEdits
): M[] {
	return models.map((m) =>
		m.id in edits.enabled ? { ...m, enabled: edits.enabled[m.id] } : m
	)
}

/**
 * The default marks per model id: what is saved for THIS connection, with
 * every capability the draft moves taken from the draft instead — so a Use
 * on this page moves the mark off the model that had it.
 */
export function defaultMarksWithEdits(
	defaults: SavedDefaults,
	edits: ModelEdits,
	connectionId: number,
	word: (capability: string) => string
): Record<number, string[]> {
	const out: Record<number, string[]> = {}
	for (const [capability, d] of Object.entries(defaults ?? {})) {
		if (capability in edits.defaults) continue
		if (d?.connectionId !== connectionId || d.connectionModelId == null)
			continue
		;(out[d.connectionModelId] ??= []).push(word(capability))
	}
	for (const [capability, modelId] of Object.entries(edits.defaults))
		(out[modelId] ??= []).push(word(capability))
	return out
}

export type ModelEditStep =
	| {
			kind: "enabled"
			/** `enabled:<id>` — what dropping it from the draft is keyed by. */
			key: string
			label: string
			modelId: number
			enabled: boolean
	  }
	| {
			kind: "default"
			/** `default:<capability>`. */
			key: string
			label: string
			capability: string
			modelId: number
			/** Labels of the writes this one needs to have landed first. */
			after?: string[]
	  }

/**
 * What Save sends, in order — and, read as a list, what the "Waiting for
 * Save" line names. Visibility first, defaults after; a default whose model
 * this Save switches on waits for that write.
 */
export function modelEditPlan(
	edits: ModelEdits,
	models: readonly EditableModel[],
	word: (capability: string) => string
): ModelEditStep[] {
	const byId = new Map(models.map((m) => [m.id, m]))
	const steps: ModelEditStep[] = []
	const showLabel = new Map<number, string>()
	for (const [key, enabled] of Object.entries(edits.enabled)) {
		const modelId = Number(key)
		const label = `${enabled ? "Show" : "Hide"} ${nameOf(byId.get(modelId), modelId)}`
		if (enabled) showLabel.set(modelId, label)
		steps.push({ kind: "enabled", key: `enabled:${modelId}`, label, modelId, enabled })
	}
	for (const [capability, modelId] of Object.entries(edits.defaults)) {
		const needs = showLabel.get(modelId)
		steps.push({
			kind: "default",
			key: `default:${capability}`,
			label: `Use ${nameOf(byId.get(modelId), modelId)} for ${word(capability).toLowerCase()}`,
			capability,
			modelId,
			...(needs ? { after: [needs] } : {})
		})
	}
	return steps
}

/** The draft without the steps whose labels landed (or that were dropped by hand). */
export function withoutSteps(
	edits: ModelEdits,
	steps: readonly ModelEditStep[],
	labels: readonly string[]
): ModelEdits {
	const gone = new Set(labels)
	const enabled = { ...edits.enabled }
	const defaults = { ...edits.defaults }
	for (const step of steps) {
		if (!gone.has(step.label)) continue
		if (step.kind === "enabled") delete enabled[step.modelId]
		else delete defaults[step.capability]
	}
	return { enabled, defaults }
}
