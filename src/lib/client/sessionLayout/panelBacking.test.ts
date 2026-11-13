import { describe, expect, test } from "vitest"
import {
	WIDGET_BOX_VARS,
	backingShown,
	declaredWidgetBox,
	hostWidgetBox,
	widgetBoxStyle
} from "./panelBacking"

describe("hostWidgetBox", () => {
	test("card", () => {
		expect(hostWidgetBox({ backing: "card", opacity: 80 })).toEqual({
			"--sp-widget-margin": "0",
			"--sp-widget-background":
				"color-mix(in oklab, var(--color-surface-100-900) 80%, transparent)",
			"--sp-widget-radius": "var(--radius-container)",
			"--sp-widget-border": "none"
		})
	})
	test("glass", () => {
		const b = hostWidgetBox({ backing: "glass", opacity: 40 })
		expect(b["--sp-widget-background"]).toBe(
			"color-mix(in oklab, var(--sp-glass-bg) 40%, transparent)"
		)
		expect(b["--sp-widget-border"]).toBe("none")
		expect(b["--sp-widget-radius"]).toBe("var(--radius-container)")
	})
	test("none", () => {
		expect(hostWidgetBox({ backing: "none", opacity: 50 })).toEqual({
			"--sp-widget-margin": "0",
			"--sp-widget-background": "transparent",
			"--sp-widget-radius": "0",
			"--sp-widget-border": "none"
		})
	})
	test("opacity clamps; a non-number is 100", () => {
		const bg = (o: unknown) =>
			hostWidgetBox({ backing: "card", opacity: o as number })[
				"--sp-widget-background"
			]
		expect(bg(150)).toContain(" 100%")
		expect(bg(-5)).toContain(" 0%")
		expect(bg("x")).toContain(" 100%")
		expect(bg(NaN)).toContain(" 100%")
	})
})

describe("declaredWidgetBox", () => {
	test("nothing declared", () => {
		expect(declaredWidgetBox(null)).toEqual({})
		expect(declaredWidgetBox({ css: ".a { color: red }" })).toEqual({})
	})
	test("vars beat CSS, with or without the leading dashes", () => {
		const skin = {
			css: ".a { --sp-widget-radius: 2px }",
			vars: { "sp-widget-radius": "9px", "--sp-widget-margin": "4px" }
		}
		expect(declaredWidgetBox(skin)).toEqual({
			"--sp-widget-radius": "9px",
			"--sp-widget-margin": "4px"
		})
	})
	test("the last CSS declaration wins", () => {
		const css =
			".a { --sp-widget-border: 1px solid red; } .b { --sp-widget-border: none }"
		expect(declaredWidgetBox({ css })["--sp-widget-border"]).toBe("none")
	})
	test("comments are ignored", () => {
		const css =
			"/* --sp-widget-radius: 1px */ .a { --sp-widget-radius: 3px }"
		expect(declaredWidgetBox({ css })["--sp-widget-radius"]).toBe("3px")
		expect(
			declaredWidgetBox({ css: "/* --sp-widget-radius: 1px */" })
		).toEqual({})
	})
	test("injection values are dropped", () => {
		expect(
			declaredWidgetBox({
				vars: { "--sp-widget-background": "red; x: y" }
			})
		).toEqual({})
		expect(
			declaredWidgetBox({
				vars: { "--sp-widget-background": "url(http://x)" }
			})
		).toEqual({})
		expect(
			declaredWidgetBox({ vars: { "--sp-widget-background": "<b>" } })
		).toEqual({})
		expect(
			declaredWidgetBox({ vars: { "--sp-widget-radius": "}" } })
		).toEqual({})
		expect(
			declaredWidgetBox({ css: ".a { --sp-widget-background: url(x) }" })
		).toEqual({})
	})
})

describe("widgetBoxStyle", () => {
	test("host then declared, in WIDGET_BOX_VARS order", () => {
		const s = widgetBoxStyle(
			{ backing: "none", opacity: 100 },
			{ vars: { "--sp-widget-radius": "5px" } }
		)
		expect(s).toBe(
			"--sp-widget-margin: 0; --sp-widget-background: transparent; --sp-widget-radius: 5px; --sp-widget-border: none"
		)
		expect(s.split("; ").map((d) => d.split(":")[0])).toEqual([
			...WIDGET_BOX_VARS
		])
	})
})

describe("backingShown", () => {
	test("is true unless none", () => {
		expect(backingShown({ backing: "card" })).toBe(true)
		expect(backingShown({ backing: "glass" })).toBe(true)
		expect(backingShown({ backing: "none" })).toBe(false)
	})
})

describe("declaredWidgetBox: values the style filter would change are dropped", () => {
	const bg = (v: string) =>
		declaredWidgetBox({ vars: { "--sp-widget-background": v } })
	test("image-set, escaped url and url are dropped", () => {
		expect(bg('image-set("https://host/x.png" 1x)')).toEqual({})
		expect(bg("u\\72 l(https://host/x.png)")).toEqual({})
		expect(bg("url(x.png)")).toEqual({})
		expect(
			declaredWidgetBox({
				css: '.a { --sp-widget-border: image-set("https://h/x.png" 1x) }'
			})
		).toEqual({})
	})
	test("plain values are kept", () => {
		for (const v of ["red", "transparent", "none", "0", "var(--x)"])
			expect(bg(v)).toEqual({ "--sp-widget-background": v })
	})
})
