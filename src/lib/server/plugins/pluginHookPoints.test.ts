/**
 * A plugin's declared hook points (R54), registered from its manifest's
 * `declaredHooks` — never its `hooks` block, which is the wire form of the
 * code it runs.
 */
import { describe, expect, it } from "vitest"
import {
	declaredHookPoint,
	declaredHookPoints,
	registerPluginHookPoints,
	withdrawPluginHookPoints
} from "./pluginHookPoints"

const PLUGIN = "acme.hook-test"
const HOOK = `${PLUGIN}:hook/before-shout`

describe("a plugin's declared hook points", () => {
	it("registers its own points from the manifest and lists them beside core's", () => {
		const refused = registerPluginHookPoints(
			{
				hooks: { handlers: [], lifecycleCallbacks: [], eventListeners: [], nodeHandlers: {} },
				declaredHooks: {
					[HOOK]: { event: "core:event/message-created@1", after: [] }
				}
			},
			PLUGIN
		)
		expect(refused).toEqual([])
		expect(declaredHookPoint(HOOK)).toMatchObject({
			id: HOOK,
			pluginId: PLUGIN,
			event: "core:event/message-created@1"
		})
		expect(declaredHookPoints().some((p) => p.id === HOOK)).toBe(true)
	})

	it("refuses another package's point and a malformed one, keeping the rest", () => {
		const refused = registerPluginHookPoints(
			{
				declaredHooks: {
					"other.pkg:hook/x": { event: "core:event/message-created@1" },
					[`${PLUGIN}:hook/nameless`]: {},
					[HOOK]: { event: "core:event/message-created@1" }
				}
			},
			PLUGIN
		)
		expect(refused).toHaveLength(2)
		expect(declaredHookPoint("other.pkg:hook/x")).toBeUndefined()
		expect(declaredHookPoint(HOOK)).toBeDefined()
	})

	it("uninstall withdraws them; a manifest without points registers none", () => {
		withdrawPluginHookPoints(PLUGIN)
		expect(declaredHookPoint(HOOK)).toBeUndefined()
		expect(registerPluginHookPoints({}, PLUGIN)).toEqual([])
	})
})
