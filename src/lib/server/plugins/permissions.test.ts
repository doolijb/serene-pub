import { describe, it, expect } from "vitest"
import {
	declaredPermissions,
	effectivePermissions,
	isReviewMark,
	needsReview,
	pendingPermissions,
	reviewMarks,
	storageGrant,
	networkGrant,
	permissionStates,
	type Permission,
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

/**
 * The stored decision list for a plugin an admin has **reviewed**, denying the
 * keys named. Every grant-derivation case below goes through this, because a
 * declaration on its own grants nothing: an unreviewed plugin is refused
 * everything, which the consent block at the bottom asserts directly.
 */
const reviewed = (declared: Permission[], ...denied: string[]): string[] => [
	...reviewMarks(declared),
	...denied
]

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
		expect(d.find((p) => p.key === "storage")?.config?.quotaBytes).toBe(
			2048
		)
		// each host is its own granular, deniable permission
		expect(
			d.find((p) => p.key === "network:api.example.com")?.config?.host
		).toBe("api.example.com")
		// resources/events are account-affecting; system caps are not
		expect(d.find((p) => p.key === "storage")?.accountAffecting).toBe(false)
		expect(
			d.find((p) => p.key === "network:api.example.com")?.accountAffecting
		).toBe(false)
		expect(
			d.find((p) => p.key === "resource:lore:write")?.accountAffecting
		).toBe(true)
		expect(d.find((p) => p.key === "event:session:message")?.kind).toBe(
			"event"
		)
	})

	it("empty/absent manifests yield no permissions", () => {
		expect(declaredPermissions(null)).toEqual([])
		expect(declaredPermissions({})).toEqual([])
		expect(declaredPermissions({ permissions: {} })).toEqual([])
	})

	it("admin denial removes a permission from the effective set", () => {
		const d = declaredPermissions(manifest)
		const eff = effectivePermissions(
			d,
			reviewed(d, "storage", "resource:lore:write")
		)
		const keys = eff.map((p) => p.key)
		expect(keys).not.toContain("storage")
		expect(keys).not.toContain("resource:lore:write")
		expect(keys).toContain("network:api.example.com")
	})

	it("grants derive from the effective set, so denial actually denies", () => {
		const d = declaredPermissions(manifest)
		expect(storageGrant(effectivePermissions(d, reviewed(d)))).toBe(2048)
		expect(
			storageGrant(effectivePermissions(d, reviewed(d, "storage")))
		).toBeUndefined()
		expect(networkGrant(effectivePermissions(d, reviewed(d)))).toEqual([
			"api.example.com",
			"cdn.example.com"
		])
		// no network permission at all → undefined (deny)
		expect(
			networkGrant(effectivePermissions(declaredPermissions({}), []))
		).toBeUndefined()
	})

	it("denies a single host without killing the whole network grant", () => {
		const d = declaredPermissions(manifest)
		const eff = effectivePermissions(
			d,
			reviewed(d, "network:cdn.example.com")
		)
		// the denied host is gone; the other still reachable
		expect(networkGrant(eff)).toEqual(["api.example.com"])
		// denying every host removes the permission entirely (no host keys survive)
		expect(
			networkGrant(
				effectivePermissions(
					d,
					reviewed(
						d,
						"network:api.example.com",
						"network:cdn.example.com"
					)
				)
			)
		).toBeUndefined()
	})

	it("carries wildcard hosts through verbatim as granular permissions", () => {
		const d = declaredPermissions({
			permissions: { network: { hosts: ["*.example.com", "*"] } }
		})
		expect(d.map((p) => p.key).sort()).toEqual([
			"network:*",
			"network:*.example.com"
		])
		expect(networkGrant(effectivePermissions(d, reviewed(d)))).toEqual([
			"*.example.com",
			"*"
		])
		// a wildcard host is deniable like any other
		expect(
			networkGrant(effectivePermissions(d, reviewed(d, "network:*")))
		).toEqual(["*.example.com"])
	})

	it("permissionStates reflects the granted/denied flag per host", () => {
		const all = declaredPermissions(manifest)
		const states = permissionStates(
			manifest,
			reviewed(all, "network:api.example.com")
		)
		expect(
			states.find((s) => s.key === "network:api.example.com")?.granted
		).toBe(false)
		expect(
			states.find((s) => s.key === "network:cdn.example.com")?.granted
		).toBe(true)
		expect(states.find((s) => s.key === "storage")?.granted).toBe(true)
	})

	describe("admin storage-quota override", () => {
		const d = declaredPermissions(manifest) // manifest declares 2048

		it("supersedes the manifest quota when set", () => {
			expect(
				storageGrant(effectivePermissions(d, reviewed(d)), 50_000)
			).toBe(50_000)
		})

		it("may exceed the author ceiling but is clamped to the admin band", () => {
			const AUTHOR_MAX = 256 * 1024 * 1024
			// above the author ceiling is allowed (a deliberate, trusted admin act)
			expect(
				storageGrant(
					effectivePermissions(d, reviewed(d)),
					AUTHOR_MAX * 4
				)
			).toBe(AUTHOR_MAX * 4)
			// but a runaway value is still clamped to the admin ceiling
			expect(
				storageGrant(
					effectivePermissions(d, reviewed(d)),
					MAX_ADMIN_STORAGE_QUOTA * 10
				)
			).toBe(MAX_ADMIN_STORAGE_QUOTA)
			// below the floor clamps up
			expect(storageGrant(effectivePermissions(d, reviewed(d)), 10)).toBe(
				1024
			)
		})

		it("ignores an invalid override and falls back to the manifest quota", () => {
			for (const bad of [0, -5, NaN, Infinity, null, undefined])
				expect(
					storageGrant(
						effectivePermissions(d, reviewed(d)),
						bad as any
					)
				).toBe(2048)
		})

		it("never revives storage an admin denied", () => {
			// storage denied outright → an override cannot bring it back
			expect(
				storageGrant(
					effectivePermissions(d, reviewed(d, "storage")),
					50_000
				)
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
			expect(d.find((p) => p.key === "storage")?.config?.quotaBytes).toBe(
				2048
			)
			// grants still derive correctly from the compiled shape
			expect(storageGrant(effectivePermissions(d, reviewed(d)))).toBe(
				2048
			)
			expect(networkGrant(effectivePermissions(d, reviewed(d)))).toEqual([
				"api.example.com",
				"cdn.example.com"
			])
		})

		it("clamps an over-large declared quota to the sandbox ceiling (both forms)", () => {
			const MAX = 256 * 1024 * 1024
			// object form (the raw path an untrusted, un-recompiled manifest takes)
			const huge = declaredPermissions({
				permissions: { storage: { quotaBytes: 1_000_000_000_000 } }
			})
			expect(
				storageGrant(effectivePermissions(huge, reviewed(huge)))
			).toBe(MAX)
			// compiled flat form
			const hugeCompiled = declaredPermissions({
				permissions: ["storage:999999999999"]
			})
			expect(
				storageGrant(
					effectivePermissions(hugeCompiled, reviewed(hugeCompiled))
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
				const c = declaredPermissions(manifest)
				expect(storageGrant(effectivePermissions(c, reviewed(c)))).toBe(
					DEFAULT
				)
			}
			// below the floor clamps up to the minimum, not to a broken value
			const small = declaredPermissions({
				permissions: { storage: { quotaBytes: 500 } }
			})
			expect(
				storageGrant(effectivePermissions(small, reviewed(small)))
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
			expect(networkGrant(effectivePermissions(d, reviewed(d)))).toEqual(
				[]
			)
			// an unrecognised key is shown (so an admin can deny it), never hidden
			const unknown = d.find((p) => p.key === "telemetry:beacon")
			expect(unknown).toBeDefined()
			expect(unknown?.kind).toBe("system")
			expect(
				permissionStates({ permissions: ["telemetry:beacon"] }, [
					...reviewMarks(
						declaredPermissions({
							permissions: ["telemetry:beacon"]
						})
					),
					"telemetry:beacon"
				]).find((s) => s.key === "telemetry:beacon")?.granted
			).toBe(false)
		})
	})

	/**
	 * The install-time consent gate. A manifest *asks*; nothing is granted until
	 * an admin has decided. These are the cases the gate exists for.
	 */
	describe("consent — the install-time review gate", () => {
		it("grants nothing at all until an admin has reviewed", () => {
			const d = declaredPermissions(manifest)
			// Nothing denied — and still nothing granted, because nothing is reviewed.
			expect(effectivePermissions(d, [])).toEqual([])
			expect(storageGrant(effectivePermissions(d, []))).toBeUndefined()
			expect(networkGrant(effectivePermissions(d, []))).toBeUndefined()
			expect(needsReview(manifest, [])).toBe(true)
			expect(
				pendingPermissions(d, [])
					.map((p) => p.key)
					.sort()
			).toEqual(d.map((p) => p.key).sort())
		})

		it("grants what the review left standing, and only that", () => {
			const d = declaredPermissions(manifest)
			const decided = reviewed(d, "network:cdn.example.com")
			expect(needsReview(manifest, decided)).toBe(false)
			expect(pendingPermissions(d, decided)).toEqual([])
			expect(storageGrant(effectivePermissions(d, decided))).toBe(2048)
			expect(networkGrant(effectivePermissions(d, decided))).toEqual([
				"api.example.com"
			])
		})

		// The re-review rule: per key, so an update asking for something new needs
		// consent for *that* and nothing else.
		it("re-prompts only for a permission the plugin did not ask for before", () => {
			const before = declaredPermissions(manifest)
			const decided = reviewed(before)
			// A new version, same requests: every marker still applies.
			const sameAsk = { permissions: { ...manifest.permissions } }
			expect(needsReview(sameAsk, decided)).toBe(false)

			// A new version that wants one more host: that one alone is pending, and
			// refused, while everything already consented to keeps working.
			const widened = {
				permissions: {
					...manifest.permissions,
					network: {
						hosts: [
							"api.example.com",
							"cdn.example.com",
							"new.example.com"
						]
					}
				}
			}
			expect(needsReview(widened, decided)).toBe(true)
			const after = declaredPermissions(widened)
			expect(
				pendingPermissions(after, decided).map((p) => p.key)
			).toEqual(["network:new.example.com"])
			expect(networkGrant(effectivePermissions(after, decided))).toEqual([
				"api.example.com",
				"cdn.example.com"
			])
		})

		// The payload is part of the request, not decoration: a plugin that
		// consented at one quota and comes back asking for a bigger one is
		// asking for something new, and gets asked again.
		it("re-prompts when a declared storage quota grows under an old consent", () => {
			const asked = { permissions: { storage: { quotaBytes: 2048 } } }
			const decided = reviewMarks(declaredPermissions(asked))
			expect(needsReview(asked, decided)).toBe(false)
			expect(
				storageGrant(
					effectivePermissions(declaredPermissions(asked), decided)
				)
			).toBe(2048)

			const bigger = {
				permissions: { storage: { quotaBytes: 64 * 1024 * 1024 } }
			}
			expect(needsReview(bigger, decided)).toBe(true)
			expect(
				storageGrant(
					effectivePermissions(declaredPermissions(bigger), decided)
				)
			).toBeUndefined()
		})

		it("has nothing to consent to when a manifest declares nothing", () => {
			expect(needsReview({}, [])).toBe(false)
			expect(needsReview(null, null)).toBe(false)
		})

		// A manifest can name anything in the compiled array form, including a key
		// that looks like a marker. Marking it must not read as a review of the
		// permission behind it.
		it("cannot be forged by a manifest that declares a marker-shaped key", () => {
			const sneaky = declaredPermissions({
				permissions: ["network:a.com", "__reviewed:network:a.com"]
			})
			// Approving the odd key marks *it*, never the permission it names —
			// the prefix is applied unconditionally, and the real permission's
			// mark carries the payload it was declared with besides.
			expect(reviewMarks(sneaky)).toEqual([
				'__reviewed:network:a.com#{"host":"a.com"}',
				"__reviewed:__reviewed:network:a.com"
			])
			// And it is recognisable as reserved, which is what lets the write
			// path refuse to let a denial of it be spent forging a review.
			expect(isReviewMark("__reviewed:network:a.com")).toBe(true)
			expect(isReviewMark("network:a.com")).toBe(false)
			// Declaring it grants nothing on its own.
			expect(
				networkGrant(effectivePermissions(sneaky, []))
			).toBeUndefined()
		})

		it("permissionStates marks an unreviewed permission pending, not granted", () => {
			const states = permissionStates(manifest, [])
			expect(states.every((s) => s.pending)).toBe(true)
			expect(states.every((s) => !s.granted)).toBe(true)
			const after = permissionStates(
				manifest,
				reviewed(declaredPermissions(manifest), "storage")
			)
			expect(after.every((s) => !s.pending)).toBe(true)
			expect(after.find((s) => s.key === "storage")?.granted).toBe(false)
			expect(
				after.find((s) => s.key === "network:api.example.com")?.granted
			).toBe(true)
		})
	})
})
