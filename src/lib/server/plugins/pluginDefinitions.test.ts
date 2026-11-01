import { describe, expect, it } from "vitest"
import { describeTaskDefinition, getDefinition } from "@serene-pub/sdk"
import {
	pluginDefinitionPins,
	registerPluginDefinitions
} from "./pluginDefinitions"

const TEXT = "core:shape/text@1"
const JSON_SHAPE = "core:shape/json@1"

/** A minimal task declaration; `out` is the contract that varies. */
const task = (id: string, out: string = TEXT, name = "Roll") =>
	({
		kind: "task",
		id,
		i18n: { name: { en: name } },
		ports: { out: { text: out } }
	}) as any

const DIFFERENT =
	"This process already holds a different declaration under that pin"

describe("registerPluginDefinitions: a reinstall replaces the plugin's own declarations", () => {
	it("replaces a changed declaration from the same plugin", () => {
		const id = "c36-a:task/roll@1"
		const first = registerPluginDefinitions([task(id)], "c36-a")
		const changed = task(id, JSON_SHAPE)
		const second = registerPluginDefinitions([changed], "c36-a")
		expect(first).toEqual({ registered: [id], refused: [] })
		expect(second).toEqual({ registered: [id], refused: [] })
		expect(getDefinition(id)?.ports?.out?.text).toBe(JSON_SHAPE)
	})

	it("accepts an identical redeclare from the same plugin", () => {
		const id = "c36-a:task/same@1"
		registerPluginDefinitions([task(id)], "c36-a")
		expect(registerPluginDefinitions([task(id)], "c36-a")).toEqual({
			registered: [id],
			refused: []
		})
	})

	it("refuses a changed declaration from a different plugin and keeps the holder's", () => {
		const id = "c36-a:task/held@1"
		registerPluginDefinitions([task(id)], "c36-a")
		const out = registerPluginDefinitions([task(id, JSON_SHAPE)], "c36-b")
		expect(out.registered).toEqual([])
		expect(out.refused).toHaveLength(1)
		expect(out.refused[0]).toContain(`node definition '${id}': `)
		expect(out.refused[0]).toContain(DIFFERENT)
		expect(getDefinition(id)?.ports?.out?.text).toBe(TEXT)
	})

	it("refuses a plugin's changed declaration under a pin the build holds", () => {
		const id = "c36-build:task/own@1"
		describeTaskDefinition({ id, ports: { out: { text: TEXT } } })
		const out = registerPluginDefinitions([task(id, JSON_SHAPE)], "c36-a")
		expect(out.registered).toEqual([])
		expect(out.refused[0]).toContain(DIFFERENT)
		expect(getDefinition(id)?.ports?.out?.text).toBe(TEXT)
		expect(pluginDefinitionPins().has(id)).toBe(false)
	})

	it("puts the previous declaration back when the replacement fails a check", () => {
		const id = "c36-a:task/check@1"
		registerPluginDefinitions([task(id)], "c36-a")
		const before = getDefinition(id)
		const bad = task(id, JSON_SHAPE, "")
		const out = registerPluginDefinitions([bad], "c36-a")
		expect(out.registered).toEqual([])
		expect(out.refused).toHaveLength(1)
		expect(out.refused[0]).toContain(
			"The declaration this process held before stays in place."
		)
		expect(out.refused[0]).not.toContain(DIFFERENT)
		expect(getDefinition(id)?.ports?.out?.text).toBe(TEXT)
		expect(getDefinition(id)?.id).toBe(before?.id)
	})

	it("lists the registered pins", () => {
		const id = "c36-a:task/pins@1"
		registerPluginDefinitions([task(id)], "c36-a")
		expect(pluginDefinitionPins().has(id)).toBe(true)
	})
})
