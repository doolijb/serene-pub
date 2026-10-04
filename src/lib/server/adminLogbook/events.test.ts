/**
 * The logbook's event table stays true to the sockets it names: every event
 * is one some handler actually declares (a rename would otherwise silently
 * stop recording), every object type is a known one, and the wrapper's
 * admin/scope gate says what it should.
 */
import { describe, expect, test } from "vitest"
import fs from "fs"
import path from "path"
import { LOGBOOK_OBJECT_TYPES } from "$lib/shared/adminLogbook"
import { LOGBOOK_EVENTS, logbookSpecFor, resolveObjectType } from "./events"
import { logbookWants } from "./record"

const SOCKETS = path.resolve(__dirname, "../sockets")

function declaredEvents(): Set<string> {
	const out = new Set<string>()
	for (const f of fs.readdirSync(SOCKETS)) {
		if (!f.endsWith(".ts") || f.includes(".test.")) continue
		const src = fs.readFileSync(path.join(SOCKETS, f), "utf8")
		// `{ event: "…", handler }`, or `refusable("…", …)` — the wrapper
		// declares its handler's event as its first argument.
		for (const m of src.matchAll(/(?:event:\s*|refusable(?:<[^>]*>)?\(\s*)"([^"]+)"/g)) out.add(m[1])
	}
	return out
}

describe("LOGBOOK_EVENTS", () => {
	test("every recorded event is declared by a socket handler", () => {
		const declared = declaredEvents()
		const missing = Object.keys(LOGBOOK_EVENTS).filter((e) => !declared.has(e))
		expect(missing).toEqual([])
	})

	test("every object type is a known logbook object type", () => {
		for (const [event, spec] of Object.entries(LOGBOOK_EVENTS))
			expect(
				Object.hasOwn(LOGBOOK_OBJECT_TYPES, spec.objectType),
				event
			).toBe(true)
	})

	test("no read-shaped event is recorded", () => {
		const reads = Object.keys(LOGBOOK_EVENTS).filter((e) =>
			/:(get|list|detail|status|preview|export)\b/.test(e)
		)
		expect(reads).toEqual([])
	})

	test("an add names where its id comes from, or finds its row by name", () => {
		for (const [event, spec] of Object.entries(LOGBOOK_EVENTS)) {
			if (spec.action !== "add") continue
			expect(
				!!(spec.idFromResult || spec.id || spec.snapshot || spec.label),
				event
			).toBe(true)
		}
	})
})

describe("logbookWants", () => {
	const admin = { id: 1, isAdmin: true, username: "admin" }
	const user = { id: 2, isAdmin: false, username: "u" }

	test("admin + listed event only", () => {
		expect(logbookWants(admin, "systemSettings:updateDefaultLanguage", {})).toBe(true)
		expect(logbookWants(user, "systemSettings:updateDefaultLanguage", {})).toBe(false)
		expect(logbookWants(admin, "systemSettings:get", {})).toBe(false)
		expect(logbookWants(null, "connections:update", {})).toBe(false)
	})

	test("a pipeline change inside a session is its owner's, not the instance's", () => {
		expect(logbookWants(admin, "pipelines:setOption", { slug: "x" })).toBe(true)
		expect(
			logbookWants(admin, "pipelines:setOption", { slug: "x", sessionId: 4 })
		).toBe(false)
	})

	test("library template verbs follow `kind`", () => {
		const spec = logbookSpecFor("pipelines:libraryUpdateTemplate")!
		expect(resolveObjectType(spec, { kind: "variable" })).toBe("variable-template")
		expect(resolveObjectType(spec, { kind: "context" })).toBe("context-template")
	})
})
