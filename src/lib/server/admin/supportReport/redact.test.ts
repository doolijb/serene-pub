import { describe, expect, test } from "vitest"
import { redactForSupport, type RedactionContext } from "./redact"

const ctx: RedactionContext = {
	homeDir: "/home/jody",
	machineName: "jody-desktop",
	people: [
		{ id: 1, names: ["jody", "Jody Smith"] },
		{ id: 2, names: ["admin", null] },
		{ id: 3, names: ["Mira"] }
	]
}
const r = (s: string) => redactForSupport(s, ctx)

describe("redactForSupport — secrets", () => {
	test("values under secret-shaped keys go whole; numbers and booleans stay", () => {
		const out = redactForSupport(
			{
				apiKey: "abc",
				extraJson: { password: "hunter2", nested: { accessToken: "x" } },
				tokensSpent: 512,
				requireTwoFactor: true,
				recoveryKeyHash: "deadbeef",
				email: "a@b.co",
				name: "ok"
			},
			ctx
		)
		expect(out).toEqual({
			apiKey: "[redacted]",
			extraJson: { password: "[redacted]", nested: { accessToken: "[redacted]" } },
			tokensSpent: 512,
			requireTwoFactor: true,
			recoveryKeyHash: "[redacted]",
			email: "[redacted]",
			name: "ok"
		})
	})

	test("key=value secrets, bearer tokens, known prefixes, JWTs", () => {
		expect(r("request failed api_key=abc123 status 401")).toBe(
			"request failed api_key=[redacted] status 401"
		)
		expect(r(`{"password": "hunter2"}`)).toBe(`{"password": "[redacted]"}`)
		expect(r("Authorization: Bearer abcdef123456789")).not.toContain("abcdef123456789")
		expect(r("sent Bearer abcdef123456789")).toBe("sent Bearer [redacted]")
		expect(r("key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA used")).toBe("key [redacted] used")
		expect(r("hf_abcdefghijklmnopqrstuvwxyz")).toBe("[redacted]")
		expect(r("t=eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSM")).not.toContain("eyJ")
	})

	test("long opaque strings go; ordinary identifiers and prose stay", () => {
		expect(r("cookie a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3 set")).toBe(
			"cookie [redacted] set"
		)
		expect(r("maxTokens: 512, tokenCounter: estimate")).toBe(
			"maxTokens: 512, tokenCounter: estimate"
		)
		expect(r("src/lib/server/pipelines/runtime/receipts.ts:296")).toBe(
			"src/lib/server/pipelines/runtime/receipts.ts:296"
		)
	})
})

describe("redactForSupport — addresses", () => {
	test("emails", () => {
		expect(r("sent to someone@example.org today")).toBe("sent to [email] today")
	})

	test("IPs keep loopback and say private or public", () => {
		expect(r("listening on 127.0.0.1:5173 and 0.0.0.0")).toBe(
			"listening on 127.0.0.1:5173 and 0.0.0.0"
		)
		expect(r("peer 192.168.1.20 and 8.8.8.8")).toBe("peer [ip:private] and [ip:public]")
		expect(r("v6 fe80::1ff:fe23:4567:890a here, ::1 kept")).toBe("v6 [ip:v6] here, ::1 kept")
		expect(r("Chrome/147.0.0.0 Safari/537.36")).toBe("Chrome/147.0.0.0 Safari/537.36")
		expect(r("at 12:34:56 on 2026-09-27T10:00:00.000Z")).toBe(
			"at 12:34:56 on 2026-09-27T10:00:00.000Z"
		)
	})

	test("URLs: credentials and queries go, private hosts go, public and local stay", () => {
		expect(r("http://user:pw@localhost:5001/api?key=zzz")).toBe(
			"http://[redacted]@localhost:5001/api?[redacted]"
		)
		expect(r("see https://github.com/acme/plugin.")).toBe(
			"see https://github.com/acme/plugin."
		)
		expect(r("https://llm.mycorp.example.com:8443/v1/chat")).toBe("https://[host]:8443/…")
		expect(r("https://api.openai.com/v1")).toBe("https://api.openai.com/v1")
		expect(r("http://[::1]:11434")).toBe("http://[::1]:11434")
		expect(r("at file:///home/jody/app/x.js:3")).toBe("at file://~/app/x.js:3")
	})

	test("bare host names outside the allowlist", () => {
		expect(r("could not reach nas.local or box.tail1234.ts.net")).toBe(
			"could not reach [host] or [host]"
		)
		expect(r("github.com is fine; package.json and bundle.js are files")).toBe(
			"github.com is fine; package.json and bundle.js are files"
		)
		expect(r("socket.io 4.8.3")).toBe("socket.io 4.8.3")
	})
})

describe("redactForSupport — people and paths", () => {
	test("user names become user#N; generic names are left alone", () => {
		expect(r("login for jody failed")).toBe("login for user#1 failed")
		expect(r("Jody Smith and Mira joined")).toBe("user#1 and user#3 joined")
		expect(r("admin:overview answered")).toBe("admin:overview answered")
		expect(r("Jodyann is someone else")).toBe("Jodyann is someone else")
	})

	test("paths under the home directory become ~", () => {
		expect(r("ENOENT /home/jody/.local/share/SerenePub/data/meta.json")).toBe(
			"ENOENT ~/.local/share/SerenePub/data/meta.json"
		)
		expect(r("C:\\Users\\bob\\AppData\\x")).toBe("~\\AppData\\x")
		expect(r("/Users/alice/Library")).toBe("~/Library")
	})

	test("the machine's name", () => {
		expect(r("host jody-desktop started")).toBe("host [machine] started")
	})

	test("walks arrays and nested objects, and leaves the input untouched", () => {
		const input = { logs: [{ text: "jody at 10.0.0.2" }], when: new Date(0) }
		const out = redactForSupport(input, ctx)
		expect(out).toEqual({
			logs: [{ text: "user#1 at [ip:private]" }],
			when: "1970-01-01T00:00:00.000Z"
		})
		expect(input.logs[0].text).toBe("jody at 10.0.0.2")
	})
})
