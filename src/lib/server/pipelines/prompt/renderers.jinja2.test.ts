import { afterEach, describe, expect, it } from "vitest"
import { CORE_JINJA2_ENGINE, isCoreTemplateEngine } from "$lib/shared/pipelines/templateEngines"
import {
	_resetRenderers,
	TemplateEngineError,
	knownEngines,
	registerRenderer,
	releaseRenderer,
	renderTemplate
} from "./renderers"

describe("core:template/jinja2@1", () => {
	afterEach(() => _resetRenderers())

	it("is a core template engine", () => {
		expect(CORE_JINJA2_ENGINE).toBe("core:template/jinja2@1")
		expect(isCoreTemplateEngine("core:template/jinja2@1")).toBe(true)
		expect(isCoreTemplateEngine("plugin:x/engine@1")).toBe(false)
	})
	it("is registered, owned by core, and renders through the SDK engine", async () => {
		expect(knownEngines()).toContainEqual({ id: CORE_JINJA2_ENGINE, owner: "core" })
		const out = await renderTemplate(CORE_JINJA2_ENGINE, {
			template: "{% for x in xs %}{{ x }},{% endfor %}",
			variables: { xs: ["a", "b"] }
		})
		expect(out).toBe("a,b,")
	})
	it("a plugin cannot claim it", () => {
		expect(() => registerRenderer(CORE_JINJA2_ENGINE, "plugin:evil", () => "x")).toThrow(TemplateEngineError)
	})
	it("a plugin release of it is a no-op: it still renders", async () => {
		releaseRenderer(CORE_JINJA2_ENGINE, "plugin:evil")
		releaseRenderer(CORE_JINJA2_ENGINE, "core")
		expect(knownEngines().some((e) => e.id === CORE_JINJA2_ENGINE)).toBe(true)
		expect(await renderTemplate(CORE_JINJA2_ENGINE, { template: "{{ a }}", variables: { a: "ok" } })).toBe("ok")
	})
})
