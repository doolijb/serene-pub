/**
 * 🚧 A session's **step settings** (PROPOSAL-live-scenes §15 G11): the
 * parameters of the steps a session's pipelines put in session settings
 * (`expose.session`, SDK `NodeOpts.expose`) that are STORY settings — Chat's
 * reply tick (*Each reply advances the clock by …*, `core:task/clock-step`),
 * the sprite picker's *Choose sprites*, stickiness and floor — drawn in the
 * session's own settings for its owner, member or admin alike.
 *
 * `expose.session` marks a step as the session's to shape, and a step so
 * marked may carry plumbing beside its story settings: the turn order's
 * `advise` oracle carries a connection, a sampling config and prompts. Those
 * are never a member's (owner ruling 2026-10-12: no member surface for
 * connections, models, sampling or loadouts, ever), so a step setting is
 * held to three rules, and a field failing any is simply not one:
 *
 *  1. **Its step runs on no model.** A step whose declarations name a
 *     connection, a sampling config or a loadout is a model call; none of
 *     its fields is offered, its parameters included — a model call's
 *     parameters tune the call.
 *  2. **It is a parameter** (a `parameters` slot, matrix slot `params`) —
 *     never a prompt, template, variable layout, script chain or review gate.
 *  3. **Its control is a plain value**: a whole number, a number, a switch, a
 *     choice or a line of text — never a secret, a list or a share bar (🚧 a
 *     field declared `list: true` is a list whatever its element's control).
 *
 * 🚧 Whose: the pipelines the session lists (`sessionPipelines` — its reply,
 * its enabled actions, its create spec while creating) and the specs bound
 * to its own events (§15 G19 — the turn order), every one held to the
 * same three rules.
 *
 * ⏳ **Folded into the derived settings form** (PLAN-layering lane 5b,
 * 2026-10-20): an exposed step's parameter IS a pipeline setting with
 * `reach: 'owner'` (`settingsForm.ts`), stored on the session's own
 * registration row under the registration's key (A9) and resolved through
 * the one cascade (declared defaults < the genre's defaults < the preset <
 * the session; any layer may lock). This module is now that form's
 * projection for the step-settings sockets the client still asks
 * (`sessions:stepSettings` / `sessions:setStepSetting`) until lane 7 draws
 * the form itself: the same three rules are the form's, a write is the
 * form's `updateSetting`, and a value equal to what it inherits stores
 * nothing (reset-is-delete). A value the step settings' old home holds
 * (`pipeline_node_overrides`, scope `session`) is read beneath and cleared
 * by the first write.
 */
import { formFields, settingsFormBuild, stepOfField, SettingRefusal, updateSetting } from "$lib/server/sessions/settingsForm"

type Field = Sockets.Sessions.Bindings.StepSettings.Field
type Step = Sockets.Sessions.Bindings.StepSettings.Step
type FormField = Sockets.Sessions.SettingsForm.Field

/** A refusal in a sentence a person can act on. */
export class StepSettingRefusal extends Error {}

/** Rule 1: a declaration in any of these makes its step a model call. */
const MODEL_SLOTS = new Set(["connection", "sampling", "loadout"])
/** Rule 3: the controls a step setting may be. */
const PLAIN_CONTROLS = new Set<Field["control"]>(["integer", "number", "boolean", "enum", "string"])

const sourceOf = (s: FormField["source"]): Field["source"] =>
	s === "session" ? "session" : s === "genre" || s === "preset" ? "config" : "author"

/** The step settings of the derived form: its exposed steps' plain fields, by step, as its pipelines list them. */
async function located(db: Db, sessionId: number, userId: number) {
	const { form } = await settingsFormBuild(db, sessionId, { userId, isAdmin: false })
	const out: Array<{ step: Step; field: Field; formField: FormField }> = []
	const steps = new Map<string, Step>()
	for (const f of formFields(form)) {
		if (f.address.kind !== "pipeline") continue
		const at = stepOfField(f)
		if (!at?.exposed || !PLAIN_CONTROLS.has(f.control as Field["control"])) continue
		const key = `${at.spec}\u0000${at.nodeKey}`
		let step = steps.get(key)
		if (!step) {
			step = { spec: at.spec, specName: at.specName, nodeKey: at.nodeKey, definitionId: at.definitionId, heading: at.heading, fields: [] }
			steps.set(key, step)
		}
		const field: Field = {
			path: f.address.path,
			label: f.label,
			...(f.description ? { description: f.description } : {}),
			control: f.control as Field["control"],
			...(f.min != null ? { min: f.min } : {}),
			...(f.max != null ? { max: f.max } : {}),
			...(f.members ? { members: f.members } : {}),
			value: f.value,
			inherited: f.inherited,
			source: sourceOf(f.source)
		}
		step.fields.push(field)
		out.push({ step, field, formField: f })
	}
	return out
}

/** The session's step settings, by step, in the order its pipelines list them. */
export async function readStepSettings(
	db: Db,
	sessionId: number,
	userId: number
): Promise<Step[]> {
	const seen = new Set<Step>()
	const steps: Step[] = []
	for (const l of await located(db, sessionId, userId))
		if (!seen.has(l.step)) {
			seen.add(l.step)
			steps.push(l.step)
		}
	return steps
}

/**
 * Set one step setting for the session — or, with `value: null` or the value
 * it would inherit, clear the session's own (reset-is-delete). The caller has
 * checked the asker owns the session. Refuses an address the session's
 * pipelines do not offer as a step setting, and a value its control does not
 * take, in a sentence (`StepSettingRefusal`).
 */
export async function writeStepSetting(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		spec: string
		nodeKey: string
		path: string
		value: unknown
	}
): Promise<void> {
	const found = (await located(db, opts.sessionId, opts.userId)).find(
		(l) => l.step.spec === opts.spec && l.step.nodeKey === opts.nodeKey && l.field.path === opts.path
	)
	if (!found || !found.formField.editable)
		throw new StepSettingRefusal(
			"That is not a setting this session's pipelines offer here. Nothing was saved."
		)
	try {
		await updateSetting(db, opts.sessionId, { userId: opts.userId, isAdmin: false }, found.formField.address, opts.value ?? null)
	} catch (err) {
		if (err instanceof SettingRefusal) throw new StepSettingRefusal(err.message)
		throw err
	}
}

/** @internal Test seam: the rules a field is held to, by name. */
export const STEP_SETTING_RULES = { MODEL_SLOTS, PLAIN_CONTROLS } as const
