/**
 * The publicity bound, as a table of the rule it implements.
 *
 * Plan §6 ruled three things and this file pins each of them separately,
 * because they fail independently:
 *
 *  1. an edge whose OBJECT was only mentioned is capped to `secret`,
 *  2. `public` is never inferred from a scene, at any presence,
 *  3. a `public` an author chose survives every subsequent scan.
 *
 * Each test names the mutation it kills. That is not decoration: a ceiling is
 * three one-line decisions, and every one of them still returns a plausible
 * visibility when it is wrong — a test that only checked "some valid value came
 * back" would pass against all three mutations.
 */

import { describe, expect, it } from "vitest"
import {
	inferredRelationshipVisibility,
	sanitizeRelationshipVisibility
} from "./relationshipVisibility"

describe("an inference may not out-scope what the scene supports", () => {
	it("caps an edge whose object was only mentioned to secret", () => {
		// Kills: `objectPresence === "absent" ? "secret" : "acknowledged"`
		// collapsed to a constant `"acknowledged"` — i.e. the bug, which is the
		// column's own default doing exactly this on every insert.
		expect(
			inferredRelationshipVisibility({
				claim: "acknowledged",
				objectPresence: "absent"
			})
		).toBe("secret")
	})

	it("lets acknowledged stand when the object was present", () => {
		// Kills the opposite mutation — a constant `"secret"` — which would be
		// safe and useless: every inferred edge would vanish from context.
		expect(
			inferredRelationshipVisibility({
				claim: "acknowledged",
				objectPresence: "present"
			})
		).toBe("acknowledged")
	})

	it("never infers public, however present the object was", () => {
		// Kills a ceiling of `"public"` for the present case, and kills
		// `OPENNESS[claim] <= OPENNESS[ceiling] ? claim : ceiling` degrading to
		// a bare `claim`.
		expect(
			inferredRelationshipVisibility({
				claim: "public",
				objectPresence: "present"
			})
		).toBe("acknowledged")
		expect(
			inferredRelationshipVisibility({
				claim: "public",
				objectPresence: "absent"
			})
		).toBe("secret")
		expect(
			inferredRelationshipVisibility({
				claim: "public",
				objectPresence: "unknown"
			})
		).toBe("acknowledged")
	})

	it("is a ceiling, so it never widens a narrower claim", () => {
		// Kills `return ceiling` — an assignment rather than a bound. An
		// inference that said "secret" must not be talked up to
		// "acknowledged" by a scene both parties were in.
		expect(
			inferredRelationshipVisibility({
				claim: "secret",
				objectPresence: "present"
			})
		).toBe("secret")
	})

	it("bounds an edge with no scene at the column's own default", () => {
		// `unknown` is a real third answer: a direct history entry has no cast
		// row to read, and inventing privacy from an absence of evidence would
		// hide edges nobody claimed were private. Kills mapping `unknown` onto
		// `absent`.
		expect(
			inferredRelationshipVisibility({
				claim: "acknowledged",
				objectPresence: "unknown"
			})
		).toBe("acknowledged")
	})

	it("sanitises before it bounds", () => {
		// An LLM's garbage string becomes the default and is then capped —
		// not passed through, and not treated as more open than the default.
		expect(
			inferredRelationshipVisibility({
				claim: "TOP_SECRET_NOT_REAL",
				objectPresence: "absent"
			})
		).toBe("secret")
		expect(
			inferredRelationshipVisibility({
				claim: null,
				objectPresence: "present"
			})
		).toBe("acknowledged")
		expect(sanitizeRelationshipVisibility("nonsense")).toBe("acknowledged")
	})
})

describe("an author's choice outranks the bound", () => {
	it("leaves a stored public alone — writes nothing at all", () => {
		// ⚠ The load-bearing one. Kills `if (input.stored === "public")`
		// being removed, and kills it being weakened to `min(claim, ceiling)`:
		// either mutation demotes an authored `public` to `acknowledged` (or
		// `secret`) on the very next build, silently, for ever.
		//
		// `undefined` and not `"public"` on purpose — the caller must leave the
		// column out of its SET list, so a concurrent edit is not clobbered by
		// a write-back of a value we only read to decide not to change it.
		expect(
			inferredRelationshipVisibility({
				claim: "acknowledged",
				objectPresence: "absent",
				stored: "public"
			})
		).toBeUndefined()
		expect(
			inferredRelationshipVisibility({
				claim: "secret",
				objectPresence: "present",
				stored: "public"
			})
		).toBeUndefined()
	})

	it("still bounds a stored value that an inference could have written", () => {
		// The invariant that makes the rule above sound: `public` is the ONLY
		// value no inference can produce, so it is the only one a stored value
		// proves was authored. `acknowledged` and `secret` prove nothing, and
		// re-scanning an edge is allowed to tighten them.
		expect(
			inferredRelationshipVisibility({
				claim: "acknowledged",
				objectPresence: "absent",
				stored: "acknowledged"
			})
		).toBe("secret")
		expect(
			inferredRelationshipVisibility({
				claim: "acknowledged",
				objectPresence: "present",
				stored: "secret"
			})
		).toBe("acknowledged")
	})
})
