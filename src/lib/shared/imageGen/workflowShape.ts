/**
 * A ComfyUI workflow's **dials** — the variables it reads that a person may
 * set, each with its default (DESIGN-image-generation §7.1, as reversed
 * 2026-10-12). The dials are edited in the workflow editor; a loadout bound to
 * a ComfyUI pair may override their values inline. Sampling configs are never
 * made for a workflow: a ComfyUI pair takes the image configs like any image
 * pair, and the knobs its workflow does not read are ignored and reported.
 *
 *  - **standard** variables (`steps`, `cfg`, `seed`, `width`, `height`,
 *    `sampler`, `scheduler`, `denoise`, `clipSkip`, `count`) reuse
 *    `imageSamplingSchema`'s field definitions (same label, range, default) —
 *    shared vocabulary, not a shared schema. `count` is the image schema's
 *    `batch`;
 *  - **promoted** variables (a LoRA's strength, a second pass's denoise)
 *    become fields typed from their declaration, the literal as default; a
 *    string on an enum input offers the server's list (`enums`, read from a
 *    ComfyUI connection's cached `/object_info`);
 *  - the rest of the standard names (`prompt`, `negative`, `model`, the
 *    uploaded pictures, the run's ids) are fed by the step and the pair, and
 *    are not dials.
 *
 * Shared, pure.
 */
import { imageSamplingSchema, type SettingsSchema } from "@serene-pub/sdk"
import type { WorkflowVariable } from "./types"

/**
 * ⏳ The retired **workflow shape** id (`core:shape/workflow-<id>@1`) —
 * ruling 13, reversed 2026-10-12. No sampling config speaks it any more; kept
 * only for the loadout sheet's picker wiring until lane E2 removes it. Never
 * use it for anything new.
 */
export function workflowShapeId(workflowId: number): string {
	return `core:shape/workflow-${workflowId}@1`
}

/**
 * The seed-key prefix of the per-workflow *Default* sampling configs ruling
 * 13 seeded (`workflow:<id>:default`). Only the boot cleanup that removes
 * them reads it.
 */
export const RETIRED_WORKFLOW_SEED_KEY_PREFIX = "workflow:"

/** Workflow variable name → the image schema's key, for the standard dials. */
export const STANDARD_DIALS: Readonly<Record<string, string>> = {
	steps: "steps",
	cfg: "cfg",
	seed: "seed",
	width: "width",
	height: "height",
	sampler: "sampler",
	scheduler: "scheduler",
	denoise: "denoise",
	clipSkip: "clipSkip",
	count: "batch"
}

/**
 * Standard names the step and the pair feed — never a sampling dial. A
 * variable whose path starts with one of these (`references.[0].filename`) is
 * left out too.
 */
const FED_BY_STEP: ReadonlySet<string> = new Set([
	"prompt",
	"negative",
	"model",
	"transparent",
	"clientId",
	"runId",
	"key",
	"references",
	"init",
	"mask"
])

const rootOf = (name: string) => name.split(".")[0]!.replace(/\[.*$/, "")

/** Is this variable a dial, and under which key. */
export function dialKeyOf(v: Pick<WorkflowVariable, "name">): string | null {
	if (STANDARD_DIALS[v.name]) return STANDARD_DIALS[v.name]!
	if (FED_BY_STEP.has(rootOf(v.name))) return null
	// A dotted path that is not ours is not a scalar dial.
	if (v.name.includes(".") || v.name.includes("[")) return null
	return v.name
}

/** `lora_strength` → "Lora strength". */
function humanize(name: string): string {
	const s = name.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim()
	return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

/** The options an `objectInfo:<class>.<input>` source names, when known. */
function enumOptionsOf(
	source: string | undefined,
	enums: Readonly<Record<string, readonly string[]>> | null | undefined
): string[] | null {
	if (!source || !enums) return null
	const id = source.replace(/^objectInfo:/, "")
	const list = enums[id]
	return list && list.length ? [...list] : null
}

/**
 * The dials' schema — what a form for them draws. `enums` is a ComfyUI server's summarised
 * `/object_info` enums (`"<class>.<input>"` → names); absent, an enum
 * variable reads as free text — the value is kept, never checked against a
 * list nobody has read.
 */
export function workflowDialsSchema(
	variables: readonly WorkflowVariable[],
	enums?: Readonly<Record<string, readonly string[]>> | null
): SettingsSchema {
	const out: SettingsSchema = {}
	for (const v of variables) {
		const key = dialKeyOf(v)
		if (!key || out[key]) continue
		const std = STANDARD_DIALS[v.name] ? imageSamplingSchema[key] : undefined
		if (std) {
			const options = enumOptionsOf(v.enumSource, enums)
			out[key] = options
				? { ...std, type: "enum", of: withValue(options, v.default) }
				: { ...std }
			continue
		}
		const base = {
			label: v.label ?? humanize(v.name),
			group: v.group ?? "Workflow",
			quick: true,
			...(v.default !== undefined ? { default: v.default } : {})
		}
		switch (v.type) {
			case "number":
			case "integer":
				out[key] = {
					...base,
					type: v.type,
					...(v.min !== undefined ? { min: v.min } : {}),
					...(v.max !== undefined ? { max: v.max } : {}),
					...(v.step !== undefined ? { step: v.step } : {})
				} as SettingsSchema[string]
				break
			case "boolean":
				out[key] = { ...base, type: "boolean" }
				break
			case "enum": {
				const options = enumOptionsOf(v.enumSource, enums)
				out[key] = options
					? { ...base, type: "enum", of: withValue(options, v.default) }
					: { ...base, type: "string" }
				break
			}
			default:
				out[key] = { ...base, type: "string" }
		}
	}
	return out
}

/** A baked literal absent from the server's list stays choosable, so nothing is lost silently. */
function withValue(options: string[], value: unknown): string[] {
	return typeof value === "string" && value && !options.includes(value)
		? [value, ...options]
		: options
}

/** ⏳ The pre-2026-10-12 name of `workflowDialsSchema`. */
export const workflowSamplingSchema = workflowDialsSchema

/**
 * Every dial's default, by the variable's own name — the base
 * `ImageGenRequest.workflowValues`, so a workflow runs at its own values when
 * nothing (no loadout override) sets them. A standard dial is included too:
 * the request's own field, when set, wins over it in the adapter.
 */
export function workflowDialDefaults(
	variables: readonly WorkflowVariable[] | null | undefined
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const v of variables ?? [])
		if (dialKeyOf(v) && v.default !== undefined && !(v.name in out)) out[v.name] = v.default
	return out
}
