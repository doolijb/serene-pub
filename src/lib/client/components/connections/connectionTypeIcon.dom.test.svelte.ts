/**
 * Ollama and KoboldCPP connections wear their own marks; every other type
 * keeps the generic glyph its call site drew before (owner, 2026-10-03).
 */
import { afterEach, describe, expect, test } from "vitest"
import { mount, unmount } from "svelte"
import * as Icons from "@lucide/svelte"
import { connectionBrandOf, connectionTypeIcon } from "./connectionTypeIcon"

let target: HTMLElement | null = null
let app: Record<string, any> | null = null

afterEach(() => {
	if (app) unmount(app)
	app = null
	target?.remove()
	target = null
})

/** Draw the icon for `type` at Lucide's call shape; return its `<svg>`. */
function draw(type: string | null, fallback?: any): SVGSVGElement {
	target = document.createElement("div")
	document.body.appendChild(target)
	const Icon = connectionTypeIcon(type, fallback)
	app = mount(Icon, {
		target,
		props: { size: 16, class: "probe", "aria-hidden": "true" }
	})
	const svg = target.querySelector("svg")
	expect(svg).not.toBeNull()
	return svg as SVGSVGElement
}

describe("connectionBrandOf", () => {
	test("both Ollama types are Ollama", () => {
		expect(connectionBrandOf("ollama")).toBe("ollama")
		expect(connectionBrandOf("ollama-embeddings")).toBe("ollama")
	})
	test("every KoboldCPP type is KoboldCPP, managed or not", () => {
		expect(connectionBrandOf("koboldcpp")).toBe("koboldcpp")
		expect(connectionBrandOf("koboldcpp_managed")).toBe("koboldcpp")
	})
	test("anything else has no brand", () => {
		expect(connectionBrandOf("openai")).toBeNull()
		expect(connectionBrandOf(null)).toBeNull()
		expect(connectionBrandOf(undefined)).toBeNull()
	})
})

describe("connectionTypeIcon", () => {
	test("ollama draws the Ollama mark, on currentColor, in Lucide's box", () => {
		const svg = draw("ollama")
		expect(svg.getAttribute("data-connection-brand")).toBe("ollama")
		expect(svg.getAttribute("width")).toBe("16")
		expect(svg.getAttribute("height")).toBe("16")
		expect(svg.getAttribute("class")).toContain("fill-current")
		expect(svg.getAttribute("class")).toContain("probe")
		// A size replaces the class-based default box rather than fighting it.
		expect(svg.getAttribute("class")).not.toContain("h-4")
		expect(svg.getAttribute("aria-hidden")).toBe("true")
	})

	test("koboldcpp_managed draws the KoboldCPP mark", () => {
		const svg = draw("koboldcpp_managed", Icons.Cpu)
		expect(svg.getAttribute("data-connection-brand")).toBe("koboldcpp")
		expect(svg.getAttribute("width")).toBe("16")
		expect(svg.getAttribute("class")).toContain("fill-current")
		expect(svg.getAttribute("aria-hidden")).toBe("true")
	})

	test("an unmanaged koboldcpp connection draws it too", () => {
		const svg = draw("koboldcpp")
		expect(svg.getAttribute("data-connection-brand")).toBe("koboldcpp")
	})

	test("any other type keeps the generic glyph", () => {
		const svg = draw("openai")
		expect(svg.hasAttribute("data-connection-brand")).toBe(false)
		expect(svg.getAttribute("class")).toContain("lucide-cloud")
	})

	test("the call site's fallback wins over the kind glyph", () => {
		const svg = draw("openai", Icons.Plug)
		expect(svg.hasAttribute("data-connection-brand")).toBe(false)
		expect(svg.getAttribute("class")).toContain("lucide-plug")
	})
})
