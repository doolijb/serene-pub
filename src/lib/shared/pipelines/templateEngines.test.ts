/**
 * A slot's accepted engines are a SET; the single-engine spelling is the
 * one-element case of it.
 *
 * Both spellings stay legal forever: `engine` is what every shipped
 * declaration and every plugin authored before the set existed says, and a
 * reader that understood only `engines` would silently widen those slots to
 * core's default. The first accepted engine is the slot's default — what a new
 * template is written in when nothing asks for another — so order is meaning,
 * not presentation.
 */

import { describe, it, expect } from "vitest"
import {
	CORE_LIQUID_ENGINE,
	CORE_TEMPLATE_ENGINE,
	acceptedEngines,
	defaultEngineOf
} from "$lib/shared/pipelines/templateEngines"

const PLUGIN_ENGINE = "chariot.mustache:template/mustache@1"

describe("acceptedEngines", () => {
	it("reads the single-engine spelling as a one-element set", () => {
		expect(acceptedEngines({ engine: PLUGIN_ENGINE })).toEqual([
			PLUGIN_ENGINE
		])
	})

	it("reads a declared set in declaration order", () => {
		expect(
			acceptedEngines({
				engines: [CORE_LIQUID_ENGINE, CORE_TEMPLATE_ENGINE]
			})
		).toEqual([CORE_LIQUID_ENGINE, CORE_TEMPLATE_ENGINE])
	})

	it("falls back to core's engine when a slot declares neither", () => {
		expect(acceptedEngines({})).toEqual([CORE_TEMPLATE_ENGINE])
	})

	it("lets a set supersede a single engine declared beside it", () => {
		expect(
			acceptedEngines({
				engine: CORE_TEMPLATE_ENGINE,
				engines: [CORE_LIQUID_ENGINE, CORE_TEMPLATE_ENGINE]
			})
		).toEqual([CORE_LIQUID_ENGINE, CORE_TEMPLATE_ENGINE])
	})

	it("ignores an empty set rather than accepting nothing", () => {
		expect(acceptedEngines({ engine: PLUGIN_ENGINE, engines: [] })).toEqual(
			[PLUGIN_ENGINE]
		)
	})
})

describe("defaultEngineOf", () => {
	it("is the first engine declared, not core's", () => {
		expect(
			defaultEngineOf({
				engines: [CORE_LIQUID_ENGINE, CORE_TEMPLATE_ENGINE]
			})
		).toBe(CORE_LIQUID_ENGINE)
	})

	it("is core's engine for a slot that declares nothing", () => {
		expect(defaultEngineOf({})).toBe(CORE_TEMPLATE_ENGINE)
	})
})
