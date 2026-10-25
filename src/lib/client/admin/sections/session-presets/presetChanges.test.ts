/**
 * 🚧 A preset's changes, edited (PLAN-layering §4, R2, A5, A8; lane 7): each
 * edit is a new changes object — a genre default's fields a `change`, its
 * cadence options a re-registration under the same key, drop and restore,
 * a registration added under its derived key, and a `when` built only from
 * a derived property.
 */
import { describe, expect, test } from "vitest"
import { everyNTurns, registrationKeyOf, coreEvents, eventIdOf } from "@serene-pub/sdk"
import {
	addRegistration,
	conditionOf,
	conditionWords,
	dropKey,
	effectiveOf,
	forSave,
	pickedOf,
	restoreKey,
	setCadenceOptions,
	setField,
	type Reg
} from "./presetChanges"

const SWEEP_TRIGGER = { family: "routine", cadence: everyNTurns({ n: 5 }) }
const SWEEP_KEY = registrationKeyOf(SWEEP_TRIGGER as never, "core:spec/story-sweep")
const REPLY_TRIGGER = { family: "event", event: eventIdOf(coreEvents.messageRespond) }

const DEFAULTS: Reg[] = [
	{
		key: SWEEP_KEY,
		trigger: SWEEP_TRIGGER as never,
		pipeline: "core:spec/story-sweep",
		pipelineName: "Look back over the story",
		mode: "full",
		origin: "genre"
	},
	{
		key: "message-respond→story-respond",
		trigger: { family: "event", event: "core:event/message-respond@1" },
		pipeline: "core:spec/story-respond",
		pipelineName: "Reply",
		origin: "genre"
	}
]

describe("a preset's changes", () => {
	test("a genre default's mode is a change; clearing it leaves nothing", () => {
		const c = setField({}, SWEEP_KEY, "mode", "review")
		expect(c).toEqual({ change: [{ key: SWEEP_KEY, mode: "review" }] })
		const eff = effectiveOf(DEFAULTS, c)
		expect(eff.find((r) => r.key === SWEEP_KEY)).toMatchObject({ mode: "review", standing: "changed" })
		expect(setField(c, SWEEP_KEY, "mode", undefined)).toEqual({})
	})

	test("a default's cadence options re-register it under the same key, its change folded in", () => {
		const changed = setField({}, SWEEP_KEY, "mode", "review")
		const c = setCadenceOptions(changed, DEFAULTS, SWEEP_KEY, { n: 10 })
		expect(c.change).toBeUndefined()
		expect(c.register).toHaveLength(1)
		expect(c.register![0]).toMatchObject({
			key: SWEEP_KEY,
			mode: "review",
			trigger: { family: "routine", cadence: { id: SWEEP_TRIGGER.cadence.id, options: { n: 10 } } }
		})
		const eff = effectiveOf(DEFAULTS, c)
		expect(eff.filter((r) => r.key === SWEEP_KEY)).toHaveLength(1)
		expect(eff.find((r) => r.key === SWEEP_KEY)?.standing).toBe("changed")
	})

	test("drop and restore a default; remove one the preset added", () => {
		const dropped = dropKey({}, DEFAULTS, SWEEP_KEY)
		expect(dropped).toEqual({ drop: [SWEEP_KEY] })
		expect(effectiveOf(DEFAULTS, dropped).some((r) => r.key === SWEEP_KEY)).toBe(false)
		expect(restoreKey(dropped, SWEEP_KEY)).toEqual({})
		const { changes, key } = addRegistration({}, REPLY_TRIGGER, "acme:spec/combat-reply", { pipelineName: "Combat reply" })
		expect(key).toBe(registrationKeyOf(REPLY_TRIGGER as never, "acme:spec/combat-reply"))
		expect(effectiveOf(DEFAULTS, changes).find((r) => r.key === key)?.pipelineName).toBe("Combat reply")
		expect(dropKey(changes, DEFAULTS, key)).toEqual({})
	})

	test("what is saved carries no editor-only names", () => {
		const { changes } = addRegistration({}, REPLY_TRIGGER, "acme:spec/combat-reply", { pipelineName: "Combat reply" })
		expect(JSON.stringify(forSave(changes))).not.toContain("pipelineName")
	})
})

describe("a when, built from derived properties (A5)", () => {
	const props = [
		{ name: "world.inCombat", path: "state.world.inCombat", type: "boolean" as const },
		{ name: "world.weather", path: "state.world.weather", type: "enum" as const, members: ["clear", "storm"] },
		{ name: "cast.any.hp", path: "state.cast.byId.*.hp", type: "number" as const }
	]

	test("each comparison stores the property's path", () => {
		expect(conditionOf({ prop: props[0]!, comparison: "on" })).toEqual({ on: "state.world.inCombat", truthy: true })
		expect(conditionOf({ prop: props[0]!, comparison: "off" })).toEqual({ not: { on: "state.world.inCombat", truthy: true } })
		expect(conditionOf({ prop: props[1]!, comparison: "is", value: "storm" })).toEqual({
			on: "state.world.weather",
			equals: "storm"
		})
		expect(conditionOf({ prop: props[2]!, comparison: "gt", value: 0 })).toEqual({ on: "state.cast.byId.*.hp", gt: 0 })
	})

	test("a stored when reads back, and in words", () => {
		const w = conditionOf({ prop: props[1]!, comparison: "isNot", value: "storm" })
		expect(pickedOf(w, props)).toMatchObject({ comparison: "isNot", value: "storm" })
		expect(conditionWords(w, props)).toBe("the world · weather is not storm")
		expect(conditionWords(undefined, props)).toBe("Always")
		expect(conditionWords({ all: [w, w] }, props)).toBe("A condition this editor cannot show")
	})
})
