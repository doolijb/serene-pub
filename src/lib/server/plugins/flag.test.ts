/** The plugin gate: on unless the variable says off. */
import { afterEach, describe, expect, it, vi } from "vitest"
import { pluginsEnabled, pluginsEnabledByEnv } from "./flag"

afterEach(() => vi.unstubAllEnvs())

const cases: [string | undefined, boolean, boolean][] = [
	[undefined, true, false],
	["", true, false],
	["0", false, true],
	["false", false, true],
	["OFF", false, true],
	[" no ", false, true],
	["1", true, true],
	["true", true, true],
	[" yes ", true, true],
	["On", true, true],
	["maybe", true, false]
]

describe("pluginsEnabled", () => {
	it.each(cases)("%j -> enabled %s, by env %s", (value, enabled, byEnv) => {
		if (value === undefined)
			vi.stubEnv("SP_PLUGINS_ENABLED", undefined as never)
		else vi.stubEnv("SP_PLUGINS_ENABLED", value)
		expect(pluginsEnabled()).toBe(enabled)
		expect(pluginsEnabledByEnv()).toBe(byEnv)
	})
})
