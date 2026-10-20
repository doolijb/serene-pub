import { describe, expect, it } from "vitest"
import { fetchUrl, htmlToText, webSearch, WEB_TOOL_NAMES } from "./webTools"
import { ToolError } from "./index"

const ctx = { read: async () => null } as any

describe("web tools", () => {
	it("are the two names the assistant genres may call", () => {
		expect([...WEB_TOOL_NAMES].sort()).toEqual(["fetch_url", "web_search"])
		expect(fetchUrl.name).toBe("fetch_url")
		expect(webSearch.name).toBe("web_search")
	})

	it("reduce a page to its title and readable text, dropping scripts, styles and chrome", () => {
		const { title, text } = htmlToText(
			`<html><head><title>  A &amp; B </title><style>p{}</style><script>x()</script></head>
			<body><nav>menu</nav><h1>Heading</h1><p>First &lt;para&gt;.</p><div>Second<br>line</div><footer>foot</footer></body></html>`
		)
		expect(title).toBe("A & B")
		expect(text.split("\n")).toEqual(["Heading", "First <para>.", "Second", "line"])
	})

	it("refuse a private, local or non-http address before any request is made", async () => {
		for (const url of ["http://127.0.0.1/secret", "http://10.0.0.5/", "http://192.168.1.1/", "http://localhost:5173/", "file:///etc/passwd", "ftp://example.com/"])
			await expect(fetchUrl.run({ url }, ctx)).rejects.toBeInstanceOf(ToolError)
	})

	it("refuse an argument that is not an address", async () => {
		await expect(fetchUrl.run({ url: "not an address" }, ctx)).rejects.toThrow(/not an address/)
		await expect(fetchUrl.run({}, ctx)).rejects.toThrow(/needs a url/)
		await expect(webSearch.run({}, ctx)).rejects.toThrow(/needs a query/)
	})
})
