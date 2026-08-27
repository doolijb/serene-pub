import { describe, it, expect } from "vitest"
import {
	declaredPermissions,
	effectivePermissions,
	storageGrant,
	networkGrant,
	permissionStates,
	MAX_ADMIN_STORAGE_QUOTA
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
	it("normalizes a manifest into keyed permissions (one per network host)", () => {
		const d = declaredPermissions(manifest)
		const keys = d.map((p) => p.key).sort()
		expect(keys).toEqual([
			"event:session:message",
			"network:api.example.com",
			"network:cdn.example.com",
			"resource:characters:read",
			"resource:lore:write",
			"storage"
		])
		expect(d.find((p) => p.key === "storage")?.config?.quotaBytes).toBe(2048)
		// each host is its own granular, deniable permission
		expect(d.find((p) => p.key === "network:api.example.com")?.config?.host).toBe(
			"api.example.com"
		)
		// resources/events are account-affecting; system caps are not
		expect(d.find((p) => p.key === "storage")?.accountAffecting).toBe(false)
		expect(d.find((p) => p.key === "network:api.example.com")?.accountAffecting).toBe(
			false
		)
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
		expect(keys).toContain("network:api.example.com")
	})

	it("grants derive from the effective set, so denial actually denies", () => {
		const d = declaredPermissions(manifest)
		expect(storageGrant(effectivePermissions(d, []))).toBe(2048)
		expect(storageGrant(effectivePermissions(d, ["storage"]))).toBeUndefined()
		expect(networkGrant(effectivePermissions(d, []))).toEqual([
			"api.example.com",
			"cdn.example.com"
		])
		// no network permission at all → undefined (deny)
		expect(networkGrant(effectivePermissions(declaredPermissions({}), []))).toBeUndefined()
	})

	it("denies a single host without killing the whole network grant", () => {
		const d = declaredPermissions(manifest)
		const eff = effectivePermissions(d, ["network:cdn.example.com"])
		// the denied host is gone; the other still reachable
		expect(networkGrant(eff)).toEqual(["api.example.com"])
		// denying every host removes the capability entirely (no host keys survive)
		expect(
			networkGrant(
				effectivePermissions(d, [
					"network:api.example.com",
					"network:cdn.example.com"
				])
			)
		).toBeUndefined()
	})

	it("carries wildcard hosts through verbatim as granular permissions", () => {
		const d = declaredPermissions({
			permissions: { network: { hosts: ["*.example.com", "*"] } }
		})
		expect(d.map((p) => p.key).sort()).toEqual(["network:*", "network:*.example.com"])
		expect(networkGrant(effectivePermissions(d, []))).toEqual(["*.example.com", "*"])
		// a wildcard host is deniable like any other
		expect(networkGrant(effectivePermissions(d, ["network:*"]))).toEqual([
			"*.example.com"
		])
	})

	it("permissionStates reflects the granted/denied flag per host", () => {
		const states = permissionStates(manifest, ["network:api.example.com"])
		expect(states.find((s) => s.key === "network:api.example.com")?.granted).toBe(false)
		expect(states.find((s) => s.key === "network:cdn.example.com")?.granted).toBe(true)
		expect(states.find((s) => s.key === "storage")?.granted).toBe(true)
	})

	describe("admin storage-quota override", () => {
		const d = declaredPermissions(manifest) // manifest declares 2048

		it("supersedes the manifest quota when set", () => {
			expect(storageGrant(effectivePermissions(d, []), 50_000)).toBe(50_000)
		})

		it("may exceed the author ceiling but is clamped to the admin band", () => {
			const AUTHOR_MAX = 256 * 1024 * 1024
			// above the author ceiling is allowed (a deliberate, trusted admin act)
			expect(storageGrant(effectivePermissions(d, []), AUTHOR_MAX * 4)).toBe(
				AUTHOR_MAX * 4
			)
			// but a runaway value is still clamped to the admin ceiling
			expect(
				storageGrant(effectivePermissions(d, []), MAX_ADMIN_STORAGE_QUOTA * 10)
			).toBe(MAX_ADMIN_STORAGE_QUOTA)
			// below the floor clamps up
			expect(storageGrant(effectivePermissions(d, []), 10)).toBe(1024)
		})

		it("ignores an invalid override and falls back to the manifest quota", () => {
			for (const bad of [0, -5, NaN, Infinity, null, undefined])
				expect(storageGrant(effectivePermissions(d, []), bad as any)).toBe(2048)
		})

		it("never revives storage an admin denied", () => {
			// storage denied outright → an override cannot bring it back
			expect(
				storageGrant(effectivePermissions(d, ["storage"]), 50_000)
			).toBeUndefined()
		})
	})

	// The SDK packager emits `permissions: string[]` (compiled from usage) rather
	// than the object form. The app reads either — see the divergence note.
	describe("the compiled flat form (SDK packager)", () => {
		const compiled = {
			permissions: [
				"storage:2048",
				"network:api.example.com",
				"network:cdn.example.com",
				"resource:characters:read",
				"resource:lore:write",
				"event:session:message"
			]
		}

		it("yields the same keyed permissions as the object form", () => {
			const d = declaredPermissions(compiled)
			expect(d.map((p) => p.key).sort()).toEqual([
				"event:session:message",
				"network:api.example.com",
				"network:cdn.example.com",
				"resource:characters:read",
				"resource:lore:write",
				"storage"
			])
			expect(d.find((p) => p.key === "storage")?.config?.quotaBytes).toBe(2048)
			// grants still derive correctly from the compiled shape
			expect(storageGrant(effectivePermissions(d, []))).toBe(2048)
			expect(networkGrant(effectivePermissions(d, []))).toEqual([
				"api.example.com",
				"cdn.example.com"
			])
		})

		it("clamps an over-large declared quota to the runtime ceiling (both forms)", () => {
			const MAX = 256 * 1024 * 1024
			// object form (the raw path an untrusted, un-recompiled manifest takes)
			expect(
				storageGrant(
					effectivePermissions(
						declaredPermissions({
							permissions: { storage: { quotaBytes: 1_000_000_000_000 } }
						}),
						[]
					)
				)
			).toBe(MAX)
			// compiled flat form
			expect(
				storageGrant(
					effectivePermissions(
						declaredPermissions({ permissions: ["storage:999999999999"] }),
						[]
					)
				)
			).toBe(MAX)
		})

		it("folds an invalid quota to the default identically in both forms (fails closed)", () => {
			const DEFAULT = 5 * 1024 * 1024
			const cases: { permissions: any }[] = [
				{ permissions: { storage: { quotaBytes: -5 } } }, // object form
				{ permissions: ["storage:-5"] }, // compiled form
				{ permissions: { storage: { quotaBytes: 0 } } },
				{ permissions: ["storage:abc"] }
			]
			for (const manifest of cases) {
				expect(
					storageGrant(effectivePermissions(declaredPermissions(manifest), []))
				).toBe(DEFAULT)
			}
			// below the floor clamps up to the minimum, not to a broken value
			expect(
				storageGrant(
					effectivePermissions(
						declaredPermissions({ permissions: { storage: { quotaBytes: 500 } } }),
						[]
					)
				)
			).toBe(1024)
		})

		it("bare storage/network use defaults, and unknown keys are surfaced not dropped", () => {
			const d = declaredPermissions({
				permissions: ["storage", "network", "telemetry:beacon"]
			})
			// bare storage → default quota
			expect(d.find((p) => p.key === "storage")?.config?.quotaBytes).toBe(
				5 * 1024 * 1024
			)
			// bare network (no host) → the inert `network` key, empty allowlist
			expect(d.find((p) => p.key === "network")?.config?.host).toBe(null)
			expect(networkGrant(effectivePermissions(d, []))).toEqual([])
			// an unrecognised key is shown (so an admin can deny it), never hidden
			const unknown = d.find((p) => p.key === "telemetry:beacon")
			expect(unknown).toBeDefined()
			expect(unknown?.kind).toBe("system")
			expect(
				permissionStates(
					{ permissions: ["telemetry:beacon"] },
					["telemetry:beacon"]
				).find((s) => s.key === "telemetry:beacon")?.granted
			).toBe(false)
		})
	})
})
