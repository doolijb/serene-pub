import { describe, expect, it } from "vitest"
import { declaredPermissions, type PluginManifest } from "./declaredPermissions"
import { FIXED_CANNOT, pluginPalisade } from "./palisade"

const palisade = (manifest: PluginManifest) =>
	pluginPalisade(declaredPermissions(manifest))

const INTERNET = "Can't reach the internet or your local network"
const UNLISTED = "Can't reach any site it doesn't list"
const LOCAL = "Can't reach this computer or your local network"
const WRITES = "Can't send messages or change a session's stats as you"
const NO_STATS = "Can't change a session's stats or states as you"
const NO_DRAFT = "Can't send or draft messages as you"
const EVENTS = "Can't hear what happens in sessions that don't use it"
const STORAGE = "Can't keep files of its own"

describe("pluginPalisade", () => {
	it("an empty manifest has the fixed limits and every unlifted one", () => {
		const p = palisade({})
		expect(p.can).toEqual([])
		expect(p.cannot).toEqual([
			...FIXED_CANNOT.map((f) => f.text),
			INTERNET,
			WRITES,
			EVENTS,
			STORAGE
		])
		expect(p.cannot).toHaveLength(8)
	})

	it("a compiled list names its hosts and storage", () => {
		const p = palisade({
			permissions: ["network:api.example.com", "storage"]
		})
		expect(p.can).toContain("Network access to api.example.com")
		expect(p.can.some((c) => c.startsWith("Private file storage"))).toBe(
			true
		)
		expect(p.cannot).not.toContain(INTERNET)
		expect(p.cannot).not.toContain(STORAGE)
		expect(p.cannot).toContain(UNLISTED)
		expect(p.cannot).toContain(LOCAL)
	})

	it("a wildcard host lifts the unlisted limit, not the local one", () => {
		const p = palisade({ permissions: ["network:*"] })
		expect(p.cannot).not.toContain(UNLISTED)
		expect(p.cannot).toContain(LOCAL)
	})

	it("a declared internal literal lifts the local limit", () => {
		expect(
			palisade({ permissions: ["network:192.168.1.5:8080"] }).cannot
		).not.toContain(LOCAL)
		expect(
			palisade({ permissions: ["network:localhost"] }).cannot
		).not.toContain(LOCAL)
		expect(
			palisade({ permissions: ["network:[::1]:8080"] }).cannot
		).not.toContain(LOCAL)
	})

	it("a bare network key reaches nothing", () => {
		expect(palisade({ permissions: ["network"] }).cannot).toContain(
			INTERNET
		)
	})

	it("an object-form event is heard in every session", () => {
		const p = palisade({
			permissions: { events: ["core:event/message-created@1"] }
		})
		expect(p.cannot).not.toContain(EVENTS)
		expect(p.can).toContain(
			"Hears core:event/message-created@1 in every session on this pub"
		)
	})

	it("a state write grant leaves only the message limit", () => {
		const p = palisade({ widgets: [{ scopes: ["session:state:write"] }] })
		expect(p.cannot).toContain(NO_DRAFT)
		expect(p.cannot).not.toContain(WRITES)
		expect(p.cannot).not.toContain(NO_STATS)
	})

	it("a channel write grant leaves only the stats limit", () => {
		const p = palisade({ widgets: [{ scopes: ["channel:dice:write"] }] })
		expect(p.cannot).toContain(NO_STATS)
		expect(p.cannot).not.toContain(WRITES)
		expect(p.cannot).not.toContain(NO_DRAFT)
	})

	it("both write grants leave neither write limit", () => {
		const p = palisade({
			widgets: [{ scopes: ["session:state:write", "channel:dice:write"] }]
		})
		for (const line of [WRITES, NO_STATS, NO_DRAFT])
			expect(p.cannot).not.toContain(line)
	})

	it("the fixed limits are always present", () => {
		const p = palisade({ permissions: ["storage", "network:*", "event:x"] })
		for (const f of FIXED_CANNOT) expect(p.cannot).toContain(f.text)
	})
})
