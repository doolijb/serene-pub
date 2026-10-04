/**
 * The session page's half of live reload (C6, P5, `authoredReload.ts`): which
 * `components:changed` keys it declares, what a push may retarget, and that
 * the server's interest gate sends a push only to a socket that declared it.
 */
import { describe, expect, test } from "vitest"
import { authoredOwnersOf, authoredReloadKeys, retargetAuthoredSrc, type RetargetablePanel } from "./authoredReload"
import { componentRuntimeError } from "$lib/client/components/host/runtimeError"
import { scopeOfPayload } from "$lib/shared/sockets/interest"
import { socketWants } from "$lib/server/sockets/interest"

const A = "authored.aaaaaaaaaa"
const B = "authored.bbbbbbbbbb"
const art = (owner: string, h: string) => `/authored-ui/${owner}/${h.padStart(16, "0")}.js`

const panels = (): RetargetablePanel[] => [
	{ surface: { kind: "remote", owner: "core" }, src: "/core-ui/stats" },
	{ surface: { kind: "remote", owner: "acme" }, src: "/plugin-ui/acme/w.js" },
	{ surface: { kind: "remote", owner: A }, src: art(A, "1") },
	{ surface: { kind: "remote", owner: A }, src: art(A, "1") },
	{ surface: { kind: "remote", owner: B }, src: art(B, "1") }
]

describe("which keys a page declares", () => {
	test("one scoped key per authored owner it draws — never core's, a plugin's, or the bare key", () => {
		const owners = authoredOwnersOf([...panels(), null, undefined])
		expect(owners).toEqual([A, B])
		expect(authoredReloadKeys(owners)).toEqual([`components:changed#${A}`, `components:changed#${B}`])
		expect(authoredReloadKeys(["core", "acme", "authored.nope"])).toEqual([])
	})
})

describe("what a push retargets", () => {
	test("that owner's widgets, to its own new artifact", () => {
		const p = panels()
		expect(retargetAuthoredSrc(p, { ownerId: A, src: art(A, "2") })).toBe(2)
		expect(p.map((x) => x.src)).toEqual([
			"/core-ui/stats",
			"/plugin-ui/acme/w.js",
			art(A, "2"),
			art(A, "2"),
			art(B, "1")
		])
		// The same again changes nothing.
		expect(retargetAuthoredSrc(p, { ownerId: A, src: art(A, "2") })).toBe(0)
	})

	test("null: drawn missing", () => {
		const p = panels()
		expect(retargetAuthoredSrc(p, { ownerId: B, src: null })).toBe(1)
		expect(p[4]!.src).toBeUndefined()
	})

	test("never core, a plugin, another owner's module, or anything off /authored-ui/", () => {
		for (const change of [
			{ ownerId: "core", src: art(A, "2") },
			{ ownerId: "core", src: null },
			{ ownerId: "acme", src: "/plugin-ui/acme/evil.js" },
			{ ownerId: A, src: art(B, "2") },
			{ ownerId: A, src: "/core-ui/messages" },
			{ ownerId: A, src: `https://evil.example/authored-ui/${A}/${"2".padStart(16, "0")}.js` },
			{ ownerId: A, src: `/authored-ui/${A}/../../core-ui/messages.js` }
		]) {
			const p = panels()
			expect(retargetAuthoredSrc(p, change)).toBe(0)
			expect(p).toEqual(panels())
		}
	})
})

describe("the server's interest gate on components:changed", () => {
	const push = { id: "aaaaaaaaaa", ownerId: A, src: art(A, "2") }
	const scope = scopeOfPayload("components:changed", push)
	const socket = (keys: string[]) => ({ id: "s", interest: new Set(keys) }) as never

	test("is scoped by the owner id", () => {
		expect(scope).toBe(A)
	})

	test("a page drawing the owner hears it; one drawing another owner, or nothing, does not", () => {
		expect(socketWants(socket(authoredReloadKeys([A])), "components:changed", scope)).toBe(true)
		expect(socketWants(socket(authoredReloadKeys([B])), "components:changed", scope)).toBe(false)
		expect(socketWants(socket([]), "components:changed", scope)).toBe(false)
		expect(socketWants(socket(["sessions:view"]), "components:changed", scope)).toBe(false)
	})
})

describe("componentRuntimeError", () => {
	test("V8 frames, SpiderMonkey frames, a multi-line message, no stack", () => {
		expect(componentRuntimeError("boom\n    at f (http://h/a.js:1:2)")).toEqual({ message: "boom", stack: "    at f (http://h/a.js:1:2)" })
		expect(componentRuntimeError("boom\nmount@http://h/a.js:1:2\n@http://h/b.js:3:4")).toEqual({
			message: "boom",
			stack: "mount@http://h/a.js:1:2\n@http://h/b.js:3:4"
		})
		expect(componentRuntimeError("line one\nline two")).toEqual({ message: "line one\nline two" })
		expect(componentRuntimeError("just this")).toEqual({ message: "just this" })
		expect(componentRuntimeError(undefined)).toEqual({ message: "" })
	})
})
