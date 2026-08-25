import { describe, it, expect } from "vitest"
import {
	declaredPermissions,
	effectivePermissions,
	storageGrant,
	networkGrant,
	permissionStates
} from "./permissions"

const manifest = {
	permissions: {
		storage: { quotaBytes: 2048 },
		network: { hosts: ["api.example.com", "cdn.example.com"] },
		resources: ["characters:read", "lore:write"],
		events: ["session:message"]
	}
}

describe("permissions", () => {
	it("normalizes a manifest into keyed permissions", () => {
		const d = declaredPermissions(manifest)
		const keys = d.map((p) => p.key).sort()
		expect(keys).toEqual([
			"event:session:message",
			"network",
			"resource:characters:read",
			"resource:lore:write",
			"storage"
		])
		expect(d.find((p) => p.key === "storage")?.config?.quotaBytes).toBe(2048)
		expect(d.find((p) => p.key === "network")?.config?.hosts).toEqual([
			"api.example.com",
			"cdn.example.com"
		])
		// resources/events are account-affecting; system caps are not
		expect(d.find((p) => p.key === "storage")?.accountAffecting).toBe(false)
		expect(d.find((p) => p.key === "resource:lore:write")?.accountAffecting).toBe(true)
		expect(d.find((p) => p.key === "event:session:message")?.kind).toBe("event")
	})

	it("empty/absent manifests yield no permissions", () => {
		expect(declaredPermissions(null)).toEqual([])
		expect(declaredPermissions({})).toEqual([])
		expect(declaredPermissions({ permissions: {} })).toEqual([])
	})

	it("admin denial removes a permission from the effective set", () => {
		const d = declaredPermissions(manifest)
		const eff = effectivePermissions(d, ["storage", "resource:lore:write"])
		const keys = eff.map((p) => p.key)
		expect(keys).not.toContain("storage")
		expect(keys).not.toContain("resource:lore:write")
		expect(keys).toContain("network")
	})

	it("grants derive from the effective set, so denial actually denies", () => {
		const d = declaredPermissions(manifest)
		expect(storageGrant(effectivePermissions(d, []))).toBe(2048)
		expect(storageGrant(effectivePermissions(d, ["storage"]))).toBeUndefined()
		expect(networkGrant(effectivePermissions(d, []))).toEqual([
			"api.example.com",
			"cdn.example.com"
		])
		expect(networkGrant(effectivePermissions(d, ["network"]))).toBeUndefined()
	})

	it("permissionStates reflects the granted/denied flag", () => {
		const states = permissionStates(manifest, ["network"])
		expect(states.find((s) => s.key === "network")?.granted).toBe(false)
		expect(states.find((s) => s.key === "storage")?.granted).toBe(true)
	})
})
