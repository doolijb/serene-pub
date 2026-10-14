import { describe, expect, it } from "vitest"
import { renderStrictMarkdown } from "./markdownToHTML"

describe("renderStrictMarkdown", () => {
	it("opens links in a new tab without an opener", () => {
		const html = renderStrictMarkdown("see [the docs](https://example.com/a)")
		const box = document.createElement("div")
		box.innerHTML = html
		const a = box.querySelector("a")!
		expect(a.getAttribute("href")).toBe("https://example.com/a")
		expect(a.getAttribute("target")).toBe("_blank")
		expect(a.getAttribute("rel")).toBe("noopener noreferrer")
	})

	it("strips forms, controls, styles, ids and scripts", () => {
		const html = renderStrictMarkdown(
			'<form action="/x"><input name="p"><button>Go</button></form>' +
				'<style>body{display:none}</style><p id="x" style="color:red">hi</p>' +
				"<script>alert(1)</script>"
		)
		expect(html).not.toMatch(/<form|<input|<button|<style|<script/i)
		expect(html).not.toMatch(/\sid=|\sstyle=|\sname=/i)
		expect(html).toContain("hi")
	})

	it("drops a javascript: href", () => {
		const html = renderStrictMarkdown("[x](javascript:alert(1))")
		expect(html).not.toMatch(/javascript:/i)
	})

	it("keeps a typed line break", () => {
		expect(renderStrictMarkdown("one\ntwo")).toMatch(/one<br\s*\/?>\s*two/)
	})
})
