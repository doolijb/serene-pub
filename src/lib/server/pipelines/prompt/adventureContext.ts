/**
 * What the Adventure genre's four agents are told before they write anything:
 * where the scene is, who is in it, what the numbers are, and which values the
 * state-keeper is allowed to name.
 *
 * ## Why these are STRINGS
 *
 * A template context carries `state` and `plan` as structure, unrendered, and
 * a template that writes `{{{state}}}` over an object renders the literal
 * `[object Object]` — which is what the shipped narrator template did on every
 * turn until this module existed. Everything here is text on purpose, because
 * the surface these reach is an authored prompt row: a person editing the
 * narrator writes `{{location}}` beside `{{tone}}` and gets a sentence.
 *
 * ## Read off the declarations, not off a list
 *
 * `slotGuide` walks the slot registry and keeps the declarations this session
 * actually resolved a value for, so a genre that adds a slot gets it in the
 * keeper's vocabulary with nothing here to update. The bounds it prints are the
 * DECLARATION's, resolved through `resolveSlotConfig`, which is the same floor
 * an owner's own deviations are laid over — so a card that raised a cap is not
 * reflected in the prose. That is deliberate and it is why the prose is not the
 * enforcement: `core:query/resolve-state-changes@1` checks every change against
 * the config resolved for the owner it names, and refuses what does not fit.
 */

import {
	attributeSlots,
	getAttributeSlot,
	resolveSlotConfig,
	type AttributeSlotDecl,
	type SlotConfig
} from "@serene-pub/sdk"
import { castKey, qualifiedSlotKey, slotKey } from "$lib/server/state/resolve"

/** The shape `core:query/session-state@1` publishes, read defensively. */
export interface StateLike {
	world?: Record<string, unknown>
	cast?: Record<string, Record<string, unknown>>
	possessions?: Record<
		string,
		Array<{ name?: unknown; quantity?: unknown }> | undefined
	>
	/** The genre's vocabulary, values or no values (`TrackedSlot` in state/resolve). */
	slots?: Array<{ id?: unknown }>
}

/** The planner's document, read defensively — it is a model's answer. */
export interface PlanLike {
	beats?: unknown
	worldHints?: {
		location?: unknown
		timeOfDay?: unknown
		weather?: unknown
	}
}

const bag = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: {}

const text = (v: unknown): string =>
	typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""

/**
 * One slot's value out of a bag, under either of the two keys a state carries
 * it under — the bare name a template reads and the qualified one that makes a
 * contested name reachable.
 */
function valueOf(from: Record<string, unknown>, decl: AttributeSlotDecl) {
	const bare = from[slotKey(decl.id)]
	return bare === undefined ? from[qualifiedSlotKey(decl.id)] : bare
}

/**
 * The declarations this session tracks for one facet, in a stable order.
 *
 * The state's own `slots` when it carries them, because a slot with no default
 * has no VALUE until somebody sets it and a vocabulary missing `location` is a
 * keeper that can never name the place. A state built without them falls back
 * to the keys that do have values, which is the most an old shape can say.
 */
function present(
	state: StateLike | undefined,
	facet: "world" | "cast"
): AttributeSlotDecl[] {
	const declared = (Array.isArray(state?.slots) ? state.slots : [])
		.map((row) => (typeof row?.id === "string" ? row.id : ""))
		.map((id) => (id ? getAttributeSlot(id) : undefined))
		.filter((d): d is AttributeSlotDecl => !!d)
	const bags =
		facet === "world"
			? [bag(state?.world)]
			: Object.values(bag(state?.cast)).map(bag)
	const pool = declared.length ? declared : [...attributeSlots()]
	const forFacet = [...pool]
		.sort((a, b) => a.id.localeCompare(b.id))
		.filter((d) => d.appliesTo.includes(facet))
	return declared.length
		? forFacet
		: forFacet.filter((d) => bags.some((b) => valueOf(b, d) !== undefined))
}

/** `0 to 20` · `one of calm, wary` · `text` — what a slot will accept. */
function accepts(decl: AttributeSlotDecl, config: SlotConfig): string {
	if (decl.type === "integer") {
		const low = typeof config.min === "number" ? config.min : null
		const high = typeof config.max === "number" ? config.max : null
		if (low !== null && high !== null)
			return `a whole number from ${low} to ${high}`
		if (high !== null) return `a whole number, at most ${high}`
		if (low !== null) return `a whole number, at least ${low}`
		return "a whole number"
	}
	if (decl.type === "enum")
		return `one of ${(config.of ?? []).join(", ") || "nothing declared"}`
	if (decl.type === "boolean") return "true or false"
	if (decl.type === "derived") return "computed, and never set here"
	return typeof config.maxLength === "number"
		? `a short line of text, at most ${config.maxLength} characters`
		: "a short line of text"
}

/**
 * The vocabulary the keeper is answering in: every tracked value, its type, its
 * bounds and the exact words an enum accepts.
 *
 * Written out because a 12B model that has not been shown the options invents
 * them: a live Rest proposed stamina 90 on a slot that stops at 10 and weather
 * "Overcast with Storm Clouds", and every one of them landed in front of a
 * player as a pending change to accept or reject.
 */
export function slotGuide(state: StateLike | undefined): string {
	const lines: string[] = []
	for (const decl of present(state, "cast"))
		lines.push(
			`- ${slotKey(decl.id)}: ${accepts(decl, resolveSlotConfig(decl))}, on a character, named as the conversation names them`
		)
	for (const decl of present(state, "world"))
		lines.push(
			`- ${slotKey(decl.id)}: ${accepts(decl, resolveSlotConfig(decl))}, on the world, whose owner is written as world`
		)
	return lines.join("\n") || "- nothing: this session tracks no values."
}

/**
 * The numbers as they stand, as the one paragraph an agent reads before it
 * writes: the world's own values, then each cast member's, then what anybody is
 * carrying.
 *
 * Names come from the cast bundle when there is one, because the state's own
 * keys are lowercased and punctuation-stripped for templates to address, and a
 * prompt that says `verity` is teaching the model to write the key instead of
 * the name.
 */
export function stateSummary(
	state: StateLike | undefined,
	names: readonly string[] = []
): string {
	const nameOf = new Map(names.map((n) => [castKey(n), n]))
	const lines: string[] = []

	const world = bag(state?.world)
	const worldValues = present(state, "world")
		.map(
			(d) => `${slotKey(d.id)} is ${text(valueOf(world, d)) || "not set"}`
		)
		.join(", ")
	if (worldValues) lines.push(`The world: ${worldValues}.`)

	const castDecls = present(state, "cast")
	for (const [key, values] of Object.entries(bag(state?.cast))) {
		const owned = bag(values)
		const written = castDecls
			.map((d) => [slotKey(d.id), text(valueOf(owned, d))] as const)
			.filter(([, v]) => v !== "")
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")
		if (written) lines.push(`${nameOf.get(key) ?? key}: ${written}.`)
	}

	for (const [key, held] of Object.entries(bag(state?.possessions))) {
		const carried = (Array.isArray(held) ? held : [])
			.map((line) => {
				const quantity = Number(
					(line as { quantity?: unknown })?.quantity
				)
				const item = text((line as { name?: unknown })?.name)
				return item
					? Number.isFinite(quantity) && quantity > 1
						? `${item} x${Math.trunc(quantity)}`
						: item
					: ""
			})
			.filter(Boolean)
			.join(", ")
		if (carried)
			lines.push(
				`${key === "world" ? "Lying about" : (nameOf.get(key) ?? key) + " carries"}: ${carried}.`
			)
	}

	return lines.join("\n") || "Nothing is tracked in this session yet."
}

/** Where the scene is, when it is, what the sky is doing, and what happens. */
export interface SceneAnchor {
	location: string
	timeOfDay: string
	weather: string
	beats: string
}

/**
 * The four facts a narrator has to be given rather than left to infer.
 *
 * The world state answers first and the planner's hint second, which is the
 * order that makes a FIRST turn work: nothing has written a location down yet,
 * the planner has just decided one, and a narrator told "not set" opens the
 * scene wherever it likes. A live turn did exactly that, on a dock, with a
 * character nobody had written.
 */
export function sceneAnchor(
	state: StateLike | undefined,
	plan: PlanLike | undefined
): SceneAnchor {
	const world = bag(state?.world)
	const hints = bag(plan?.worldHints)
	const at = (key: string, hint: string, missing: string) => {
		const decl = [...attributeSlots()].find((d) => slotKey(d.id) === key)
		const held = decl ? text(valueOf(world, decl)) : text(world[key])
		return held || text(hints[hint]) || missing
	}
	const beats = (Array.isArray(plan?.beats) ? plan.beats : [])
		.map((b) => text(b))
		.filter(Boolean)
	return {
		location: at(
			"location",
			"location",
			"somewhere this session has not named yet"
		),
		timeOfDay: at("time-of-day", "timeOfDay", "an unstated hour"),
		weather: at("weather", "weather", "unstated"),
		beats: beats.length
			? beats.map((b) => `- ${b}`).join("\n")
			: "Nothing was planned for this turn, so carry on from what just happened."
	}
}
