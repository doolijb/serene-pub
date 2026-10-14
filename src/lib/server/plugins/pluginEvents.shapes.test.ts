/**
 * A plugin's own shapes, registered from its stored manifest before its
 * events (SDK 1.0 surface audit): an event whose payload is the package's own
 * shape becomes declarable, re-registration is idempotent, and uninstall
 * withdraws the shape with the event.
 */
import { describe, expect, it } from "vitest"
import {
	_withdrawShape,
	defineShape,
	getShape,
	packageEventById
} from "@serene-pub/sdk"
import {
	registerPluginEvents,
	registerPluginShapes,
	withdrawPluginEvents
} from "./pluginEvents"

const PLUGIN = "acme.shape-test"
const SHAPE = `${PLUGIN}:shape/tally@1`
const EVENT = `${PLUGIN}:event/counted@1`

const manifest = (shape: Record<string, unknown> = { id: SHAPE, assignableTo: ["core:shape/json@1"] }) => ({
	shapes: [shape],
	events: [
		{
			event: EVENT,
			payload: SHAPE,
			name: { en: "Counted" },
			description: "A tally landed.",
			domain: "session",
			genre: "core:genre/chat",
			recordedBy: "any"
		}
	]
})

describe("a plugin's own shapes from its manifest", () => {
	it("registers the shape before the event, so the event on it is declared", () => {
		expect(getShape(SHAPE)).toBeUndefined()
		expect(registerPluginEvents(manifest(), PLUGIN)).toEqual([])
		expect(getShape(SHAPE)?.assignableTo).toEqual(["core:shape/json@1"])
		expect(packageEventById(EVENT)?.payload).toBe(SHAPE)
	})

	it("is idempotent — a second boot pass (SSR reload, sync) registers the same again", () => {
		expect(registerPluginEvents(manifest(), PLUGIN)).toEqual([])
		expect(registerPluginEvents(manifest(), PLUGIN)).toEqual([])
		expect(packageEventById(EVENT)?.payload).toBe(SHAPE)
	})

	it("refuses another package's shape, and an event on a shape nobody registered", () => {
		const refused = registerPluginEvents(
			{ ...manifest({ id: "other.pkg:shape/thing@1" }) },
			PLUGIN
		)
		expect(refused.some((r) => /not under 'acme\.shape-test:shape\/'/.test(r))).toBe(true)
		expect(refused.some((r) => /not a registered shape/.test(r))).toBe(true)
		expect(getShape("other.pkg:shape/thing@1")).toBeUndefined()
	})

	it("refuses a shape this process holds differently, and leaves it alone", () => {
		withdrawPluginEvents(PLUGIN)
		defineShape({ id: SHAPE, streaming: true })
		const refused = registerPluginShapes(manifest(), PLUGIN)
		expect(refused.join()).toMatch(/declared twice, differently/)
		// Not this plugin's to withdraw: it did not register it.
		withdrawPluginEvents(PLUGIN)
		expect(getShape(SHAPE)?.streaming).toBe(true)
		_withdrawShape(SHAPE)
	})

	it("uninstall withdraws the event and the shape, and a reinstall may change it", () => {
		registerPluginEvents(manifest(), PLUGIN)
		withdrawPluginEvents(PLUGIN)
		expect(packageEventById(EVENT)).toBeUndefined()
		expect(getShape(SHAPE)).toBeUndefined()
		expect(registerPluginEvents(manifest({ id: SHAPE, streaming: true }), PLUGIN)).toEqual([])
		expect(getShape(SHAPE)?.streaming).toBe(true)
		withdrawPluginEvents(PLUGIN)
	})
})
