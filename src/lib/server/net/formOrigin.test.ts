import { afterEach, describe, expect, it } from "vitest"
import { formOriginRefusal, isFormContentType } from "./formOrigin"

const FORM = "application/x-www-form-urlencoded"

function event(opts: {
	method?: string
	url?: string
	origin?: string | null
	host?: string
	contentType?: string | null
	accept?: string
}) {
	const headers = new Headers()
	if (opts.origin) headers.set("origin", opts.origin)
	if (opts.host) headers.set("host", opts.host)
	if (opts.contentType !== null) headers.set("content-type", opts.contentType ?? FORM)
	if (opts.accept) headers.set("accept", opts.accept)
	const url = new URL(opts.url ?? "https://pub.example/recovery/restore")
	return {
		request: new Request(url, { method: opts.method ?? "POST", headers, body: opts.method === "GET" ? undefined : "name=x" }),
		url,
		platform: undefined
	}
}

describe("formOriginRefusal — the form origin check", () => {
	afterEach(() => {
		delete process.env.ALLOWED_ORIGINS
		delete process.env.SOCKETS_ALLOWED_ORIGINS
	})

	it("lets a GET through untouched", () => {
		expect(formOriginRefusal(event({ method: "GET", contentType: null }))).toBeNull()
	})

	it("lets a JSON post through: only form content types are guarded", () => {
		expect(
			formOriginRefusal(event({ contentType: "application/json", origin: "https://evil.example" }))
		).toBeNull()
		expect(isFormContentType(new Request("https://x", { method: "POST", headers: { "content-type": "application/json" } }))).toBe(false)
	})

	it("allows a form posted from the configured origin", () => {
		expect(formOriginRefusal(event({ origin: "https://pub.example", host: "pub.example" }))).toBeNull()
	})

	it("allows a form posted from the address the request arrived on, even when ORIGIN names the public URL (the recovery case)", () => {
		// url.origin is the public URL (ORIGIN derived from PUBLIC_URL); the
		// person is on localhost, where recovery is allowed.
		const refusal = formOriginRefusal(
			event({ url: "https://pub.example/recovery/restore", origin: "http://localhost:3000", host: "localhost:3000" })
		)
		expect(refusal).toBeNull()
	})

	it("allows a LAN address the same way, port and scheme ignored, hostname compared", () => {
		expect(
			formOriginRefusal(event({ url: "https://pub.example/recovery/restore", origin: "http://192.168.1.20:3000", host: "192.168.1.20:3000" }))
		).toBeNull()
	})

	it("refuses a form posted from another site, with the framework's sentence", async () => {
		const refusal = formOriginRefusal(event({ origin: "https://evil.example", host: "pub.example" }))
		expect(refusal?.status).toBe(403)
		expect(await refusal!.text()).toBe("Cross-site POST form submissions are forbidden")
	})

	it("refuses a form post that carries no Origin at all", () => {
		expect(formOriginRefusal(event({ origin: null, host: "pub.example" }))?.status).toBe(403)
	})

	it("answers JSON when the client asked for it", async () => {
		const refusal = formOriginRefusal(event({ origin: "https://evil.example", host: "pub.example", accept: "application/json" }))
		expect(refusal?.headers.get("content-type")).toBe("application/json")
		expect(await refusal!.json()).toEqual({ message: "Cross-site POST form submissions are forbidden" })
	})

	it("honours an allowlisted host, as the live connections do", () => {
		process.env.ALLOWED_ORIGINS = "other.example"
		expect(formOriginRefusal(event({ origin: "https://other.example", host: "pub.example" }))).toBeNull()
	})

	it("guards PUT, PATCH and DELETE forms too", () => {
		for (const method of ["PUT", "PATCH", "DELETE"]) {
			expect(formOriginRefusal(event({ method, origin: "https://evil.example", host: "pub.example" }))?.status).toBe(403)
		}
	})
})
