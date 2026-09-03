import { describe, it, expect } from "vitest"
import {
	countEnabled,
	defaultOnEnable,
	groupSamplingFields,
	nextEnabled
} from "./samplingFields"
import {
	imageSamplingSchema,
	textSamplingSchema,
	ttsSamplingSchema,
	type SettingsSchema
} from "@serene-pub/sdk"

/**
 * The sampling screens split in two again this sprint: values on one, the
 * enable/disable switches on the other. Every failure mode of that split is
 * silent — a key that can never be reached, a group header over nothing, a
 * count that lies, an `enabled` array mutated in place so the other screen
 * never re-renders. None of them throw, and vitest runs in `node`, so the
 * markup itself is out of reach; these are the rules the markup consults.
 */

const toy: SettingsSchema = {
	a: { type: "number", group: "Core", default: 1 },
	b: { type: "boolean", group: "Core" },
	c: { type: "string", group: "Advanced" },
	d: { type: "integer" } // no group — falls into "Other"
}

describe("groupSamplingFields", () => {
	it("keeps declaration order inside a group and first-appearance order across groups", () => {
		const groups = groupSamplingFields(toy)
		expect(groups.map((g) => g.group)).toEqual([
			"Core",
			"Advanced",
			"Other"
		])
		expect(groups[0].fields.map((f) => f.key)).toEqual(["a", "b"])
	})

	it("files an ungrouped field under Other rather than dropping it", () => {
		const groups = groupSamplingFields(toy)
		expect(groups.find((g) => g.group === "Other")?.fields).toHaveLength(1)
	})

	it("DROPS a group left empty by the filter instead of rendering a bare header", () => {
		// The regression this exists for: the seeded "Disabled" text config
		// enables nothing, and a per-field `{#if}` would have drawn every group
		// heading over no fields at all.
		const groups = groupSamplingFields(toy, (k) => k === "c")
		expect(groups.map((g) => g.group)).toEqual(["Advanced"])
	})

	it("returns nothing at all when the filter keeps nothing", () => {
		expect(groupSamplingFields(toy, () => false)).toEqual([])
	})

	it("survives a shape with no declared vocabulary", () => {
		// samplingSchemaFor returns {} for an unknown shape by design — a row
		// written by an uninstalled plugin must read as "no parameters", not
		// crash whatever loaded it.
		expect(groupSamplingFields({} as SettingsSchema)).toEqual([])
	})

	it("reaches every key of every shipped vocabulary — NO type filter", () => {
		// The old enable/disable screen listed only number/boolean fields, which
		// left the image `sampler`/`scheduler` strings permanently unreachable.
		// That is the exact regression the inline toggles were built to fix and
		// the one this screen must not reintroduce.
		for (const schema of [
			textSamplingSchema,
			imageSamplingSchema,
			ttsSamplingSchema
		]) {
			const reachable = groupSamplingFields(schema).flatMap((g) =>
				g.fields.map((f) => f.key)
			)
			expect(reachable.sort()).toEqual(Object.keys(schema).sort())
		}
		const image = groupSamplingFields(imageSamplingSchema).flatMap((g) =>
			g.fields.map((f) => f.key)
		)
		expect(image).toContain("sampler")
		expect(image).toContain("scheduler")
	})
})

describe("countEnabled", () => {
	it("counts the enabled keys the shape actually declares", () => {
		expect(countEnabled(toy, ["a", "c"])).toEqual({ on: 2, total: 4 })
	})

	it("ignores an enabled key the vocabulary does not declare", () => {
		// A row written by a newer build round-trips its unknown keys intact;
		// counting them would print "3 of 4" for two visible switches.
		expect(countEnabled(toy, ["a", "fromTheFuture"])).toEqual({
			on: 1,
			total: 4
		})
	})

	it("reads an empty or missing enabled list as zero, not as an error", () => {
		expect(countEnabled(toy, [])).toEqual({ on: 0, total: 4 })
		expect(countEnabled(toy, null)).toEqual({ on: 0, total: 4 })
		expect(countEnabled(toy, undefined)).toEqual({ on: 0, total: 4 })
	})
})

describe("nextEnabled", () => {
	it("returns a NEW array rather than mutating the one it was given", () => {
		// `enabled` is a plain array on a `$state` object: an in-place edit does
		// not re-run the `$derived` the values screen filters with, so the
		// checkbox would tick and the field would never appear.
		const before = ["a"]
		const after = nextEnabled(before, "b", true)
		expect(before).toEqual(["a"])
		expect(after).not.toBe(before)
		expect(after).toEqual(["a", "b"])
	})

	it("removes without touching the original either", () => {
		const before = ["a", "b"]
		const after = nextEnabled(before, "a", false)
		expect(before).toEqual(["a", "b"])
		expect(after).toEqual(["b"])
	})

	it("never doubles a key that is already on", () => {
		expect(nextEnabled(["a", "b"], "a", true)).toEqual(["a", "b"])
	})

	it("turning off a key that was never on is a no-op", () => {
		expect(nextEnabled(["a"], "zzz", false)).toEqual(["a"])
	})

	it("preserves keys the vocabulary does not declare", () => {
		// Same round-trip rule as countEnabled: unknown keys are not drawable,
		// but editing a neighbouring switch must not silently delete them.
		expect(nextEnabled(["fromTheFuture"], "a", true)).toEqual([
			"fromTheFuture",
			"a"
		])
	})

	it("handles a missing enabled list", () => {
		expect(nextEnabled(null, "a", true)).toEqual(["a"])
		expect(nextEnabled(undefined, "a", false)).toEqual([])
	})
})

describe("defaultOnEnable", () => {
	it("materialises the schema default so the slider has something to show", () => {
		expect(defaultOnEnable(toy, {}, "a")).toBe(1)
	})

	it("never overwrites a value the user already tuned", () => {
		// Switching a sampler off and back on must not lose the number.
		expect(defaultOnEnable(toy, { a: 0.42 }, "a")).toBeUndefined()
	})

	it("keeps a falsy stored value — 0 and false are values, not absence", () => {
		expect(defaultOnEnable(toy, { a: 0 }, "a")).toBeUndefined()
		expect(defaultOnEnable(toy, { b: false }, "b")).toBeUndefined()
	})

	it("writes nothing for a key the vocabulary gives no default", () => {
		// `sampler` and `scheduler` are deliberately defaultless: the valid
		// names belong to the connection's checkpoint, not to the vocabulary,
		// so there is no backend-independent value to invent.
		expect(
			defaultOnEnable(imageSamplingSchema, {}, "sampler")
		).toBeUndefined()
		expect(
			defaultOnEnable(imageSamplingSchema, {}, "scheduler")
		).toBeUndefined()
		expect(defaultOnEnable(toy, {}, "c")).toBeUndefined()
	})

	it("writes nothing for a key that is not in the schema at all", () => {
		expect(defaultOnEnable(toy, {}, "fromTheFuture")).toBeUndefined()
	})
})
