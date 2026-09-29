import { describe, it, expect } from "vitest"
import {
	declaredPermissions,
	effectivePermissions,
	isRefusedPermissionKey,
	isReviewMark,
	needsReview,
	pendingPermissions,
	reviewMarks,
	storageGrant,
	networkGrant,
	permissionStates,
	declaredWidgetScopes,
	panelGrants,
	grantedWidgetScopes,
	reviewMark,
	type Permission,
	MAX_ADMIN_STORAGE_QUOTA,
	WIDGET_SCOPE_LABELS
} from "./permissions"
import { WIDGET_SCOPED_SECTIONS } from "@serene-pub/sdk"

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

describe("widget scopes (C5): a widget's data request is a reviewed permission", () => {
	const withPanels = {
		// The compiled echo is absent on purpose: the panels are the source.
		permissions: ["event:core:event/message-respond@1"],
		genres: [
			{ shape: { panels: [{ id: "clone", scopes: ["session:full", "made-up"] }, { id: "tally" }] } }
		]
	}

	it("is read off the panels themselves, never trusted to the compiled list", () => {
		expect(declaredWidgetScopes(withPanels)).toEqual(["session:full"])
		const keys = declaredPermissions(withPanels).map((p) => p.key)
		expect(keys).toContain("widget:session:full")
		expect(keys).not.toContain("widget:made-up")
	})

	it("is refused until an admin reviews it, and deniable after", () => {
		expect(grantedWidgetScopes(withPanels, [])).toEqual([])
		const reviewed = reviewMarks(declaredPermissions(withPanels))
		expect(grantedWidgetScopes(withPanels, reviewed)).toEqual(["session:full"])
		expect(grantedWidgetScopes(withPanels, [...reviewed, "widget:session:full"])).toEqual([])
		// Reviewed AS a scope: the mark says so (see the carry-over test below).
		expect(reviewed).toContain("__reviewed:widget:session:full#scope")
	})

	it("grants only a scope this build knows — an unknown 'widget:x' reviewed as a declared permission grants nothing", () => {
		const unknown = { permissions: ["widget:made-up"], genres: [{ shape: { panels: [{ id: "a", scopes: ["made-up"] }] } }] }
		const declared = declaredPermissions(unknown)
		// Still shown, so an admin sees (and can deny) everything declared…
		expect(declared.map((p) => p.key)).toContain("widget:made-up")
		const reviewed = reviewMarks(declared)
		// …but approving it hands out no scope.
		expect(grantedWidgetScopes(unknown, reviewed)).toEqual([])
		expect(panelGrants(["made-up"], unknown, reviewed)).toEqual([])
	})

	it("a review given while a scope was unknown is not consent once the build learns it — the admin is asked again", () => {
		// What an admin reviewed before this build knew 'session:state': the
		// compiled key, shown as "Declared permission: widget:session:state"
		// (no data behind it), and the bare mark that review stored.
		const reviewedWhileUnknown = [reviewMark("widget:session:state")]
		const statsy = {
			permissions: ["widget:session:state"],
			genres: [{ shape: { panels: [{ id: "hud", scopes: ["session:state"] }] } }]
		}
		const now = declaredPermissions(statsy).find((p) => p.key === "widget:session:state")!
		expect(now.kind).toBe("resource")
		expect(pendingPermissions(declaredPermissions(statsy), reviewedWhileUnknown).map((p) => p.key)).toEqual([
			"widget:session:state"
		])
		expect(grantedWidgetScopes(statsy, reviewedWhileUnknown)).toEqual([])
		expect(panelGrants(["session:state"], statsy, reviewedWhileUnknown)).toEqual([])
		// Reviewed under its own sentence, it is granted.
		expect(grantedWidgetScopes(statsy, reviewMarks(declaredPermissions(statsy)))).toEqual(["session:state"])
	})

	it("is not doubled by the CLI's compiled echo of the same request", () => {
		const echoed = { ...withPanels, permissions: [...withPanels.permissions, "widget:session:full"] }
		expect(declaredPermissions(echoed).filter((p) => p.key === "widget:session:full")).toHaveLength(1)
		expect(declaredPermissions(echoed).some((p) => p.key.startsWith("Declared"))).toBe(false)
	})

	it("gives a panel what it asked for AND its plugin was granted — narrowing, never widening", () => {
		const two = {
			genres: [{ shape: { panels: [{ id: "a", scopes: ["session:full", "lore"] }] } }]
		}
		const reviewed = reviewMarks(declaredPermissions(two))
		expect(panelGrants(["session:full"], two, reviewed)).toEqual(["session:full"])
		// Unreviewed: nothing.
		expect(panelGrants(["session:full"], two, [])).toEqual([])
		// Denied: gone; the other scope stands.
		expect(panelGrants(["session:full", "lore"], two, [...reviewed, "widget:session:full"])).toEqual(["lore"])
		// A scope no panel of the plugin declared was never granted.
		expect(panelGrants(["characters"], two, reviewed)).toEqual([])
		expect(panelGrants(undefined, two, reviewed)).toEqual([])
	})
})

describe("widget scopes (R71): a package widget's scopes are declared, reviewed and granted like a panel's", () => {
	// No genres, no compiled echo: only a top-level widget asks.
	const widgetOnly = {
		permissions: ["event:core:event/message-respond@1"],
		widgets: [
			{ id: "question-log", component: "question-log", scopes: ["session:full", "session:state", "made-up"] },
			{ id: "tally", component: "tally" }
		]
	}

	it("is read off the widgets themselves and pending review", () => {
		expect(declaredWidgetScopes(widgetOnly)).toEqual(["session:full", "session:state"])
		const declared = declaredPermissions(widgetOnly)
		expect(declared.map((p) => p.key)).not.toContain("widget:made-up")
		expect(pendingPermissions(declared, []).map((p) => p.key)).toEqual(
			expect.arrayContaining(["widget:session:full", "widget:session:state"])
		)
		expect(needsReview(widgetOnly, [])).toBe(true)
		const states = permissionStates(widgetOnly, [])
		const full = states.find((s) => s.key === "widget:session:full")!
		expect(full.label).toBe(WIDGET_SCOPE_LABELS["session:full"])
		expect(full.granted).toBe(false)
	})

	it("is granted once reviewed, carries the same scope mark, and a denied scope stays out", () => {
		const reviewed = reviewMarks(declaredPermissions(widgetOnly))
		expect(reviewed).toContain("__reviewed:widget:session:state#scope")
		expect(grantedWidgetScopes(widgetOnly, reviewed)).toEqual(["session:full", "session:state"])
		expect(panelGrants(["session:full", "session:state"], widgetOnly, reviewed)).toEqual([
			"session:full",
			"session:state"
		])
		const denied = [...reviewed, "widget:session:full"]
		expect(grantedWidgetScopes(widgetOnly, denied)).toEqual(["session:state"])
		expect(panelGrants(["session:full", "session:state"], widgetOnly, denied)).toEqual(["session:state"])
	})

	it("a widget cannot get a scope its plugin was not granted", () => {
		const reviewed = reviewMarks(declaredPermissions(widgetOnly))
		expect(panelGrants(["session:full"], widgetOnly, [])).toEqual([])
		expect(panelGrants(["characters", "lore"], widgetOnly, reviewed)).toEqual([])
	})

	it("is not doubled by the CLI's compiled echo of the same request", () => {
		const echoed = { ...widgetOnly, permissions: [...widgetOnly.permissions, "widget:session:full"] }
		expect(declaredPermissions(echoed).filter((p) => p.key === "widget:session:full")).toHaveLength(1)
	})
})

describe("widget scope labels follow the SDK's one table of scoped sections", () => {
	it("every scope in the table has a sentence, so every one can be reviewed and granted", () => {
		expect(Object.keys(WIDGET_SCOPE_LABELS).sort()).toEqual(Object.keys(WIDGET_SCOPED_SECTIONS).sort())
	})

	it("'session:state' (R72) is a reviewed permission of its own, granted only once an admin has looked", () => {
		const statsy = { genres: [{ shape: { panels: [{ id: "bars", scopes: ["session:state"] }] } }] }
		expect(declaredWidgetScopes(statsy)).toEqual(["session:state"])
		const declared = declaredPermissions(statsy).find((p) => p.key === "widget:session:state")
		expect(declared?.label).toBe("Its widgets see the session's stats and states")
		expect(panelGrants(["session:state"], statsy, [])).toEqual([])
		expect(panelGrants(["session:state"], statsy, reviewMarks(declaredPermissions(statsy)))).toEqual(["session:state"])
	})
})

/**
 * `#` separates a key from what it was reviewed as, so a declared key that
 * carries one can spell another permission's mark. Deciding the decoy — even
 * DENYING it, since the socket write adds the mark either way — must not
 * review, and so grant, the permission it imitates.
 */
describe("a declared key containing '#' is refused, so it can never spell another permission's mark", () => {
	const decoyed = {
		permissions: ["widget:lore", "widget:lore#scope"],
		genres: [{ shape: { panels: [{ id: "a", scopes: ["lore"] }] } }]
	}
	// What the socket write does for one decided key: the denial (or not),
	// plus the key's review mark.
	const decide = (key: string, granted: boolean): string[] => {
		const p = declaredPermissions(decoyed).find((d) => d.key === key)
		if (!p) return []
		return granted ? [reviewMark(p)] : [key, reviewMark(p)]
	}

	it("is never listed, reviewed, pending or granted", () => {
		const keys = declaredPermissions(decoyed).map((p) => p.key)
		expect(keys).toEqual(["widget:lore"])
		expect(permissionStates(decoyed, []).map((s) => s.key)).toEqual(["widget:lore"])
		expect(reviewMarks(declaredPermissions(decoyed))).toEqual(["__reviewed:widget:lore#scope"])
		expect(isRefusedPermissionKey("widget:lore#scope")).toBe(true)
		expect(isRefusedPermissionKey("widget:lore")).toBe(false)
	})

	it("denying or granting the decoy does not grant the real scope — 'lore' stays pending", () => {
		for (const granted of [false, true]) {
			const stored = decide("widget:lore#scope", granted)
			expect(grantedWidgetScopes(decoyed, stored)).toEqual([])
			expect(panelGrants(["lore"], decoyed, stored)).toEqual([])
			expect(permissionStates(decoyed, stored).find((s) => s.key === "widget:lore")).toMatchObject({
				pending: true,
				granted: false
			})
		}
		// The real scope reviewed under its own sentence is still grantable.
		expect(grantedWidgetScopes(decoyed, decide("widget:lore", true))).toEqual(["lore"])
	})

	it("closes the same collision for a payload mark — a decoy shaped like storage's reviewed quota", () => {
		const realMark = reviewMarks(declaredPermissions({ permissions: ["storage"] }))[0]
		expect(realMark).toBe('__reviewed:storage#{"quotaBytes":5242880}')
		const storagey = { permissions: ["storage", realMark.slice("__reviewed:".length)] }
		const declared = declaredPermissions(storagey)
		expect(declared.map((p) => p.key)).toEqual(["storage"])
		// The only mark a full review could write is the real one's; nothing
		// declared can put it there on a denial.
		expect(pendingPermissions(declared, []).map((p) => p.key)).toEqual(["storage"])
		expect(storageGrant(effectivePermissions(declared, []))).toBeUndefined()
	})

	it("is refused in the object form too — resources, events and hosts name keys freely", () => {
		const keys = declaredPermissions({
			permissions: {
				network: { hosts: ["a.com", "b.com#x"] },
				resources: ["lore:read", "lore#scope"],
				events: ["e#1", "e"]
			}
		}).map((p) => p.key)
		expect(keys).toEqual(["network:a.com", "resource:lore:read", "event:e"])
	})
})
