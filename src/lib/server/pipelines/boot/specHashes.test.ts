/**
 * A core spec's shape and its version move together.
 *
 * Seeding matches on `(slug, semver)` and **skips when it finds a match**, so a
 * changed pipeline published under an unchanged version never reaches an
 * install that already booted. The instance keeps running the old document
 * while the code says otherwise, and nothing anywhere reports it.
 *
 * Tests do not catch this on their own: a fresh database publishes whatever the
 * code currently says, so every integration test passes on the new shape while
 * real upgrades silently get the old one. This is the check that a fresh
 * database cannot perform — a recorded hash from the last time the pair was
 * known to agree.
 *
 * Found the hard way. A version bump written as a string replacement matched
 * nothing, because another session had already moved that spec to the version
 * being written; the replace was a silent no-op and the whole change sat behind
 * a version that seeding skipped.
 *
 * ## When this fails
 *
 * You changed a core spec. Bump its `*_VERSION` and record the new hash here,
 * in the same commit. Two lines, and they are the two that have to stay
 * together — this file exists to make forgetting the first one loud.
 */

import { describe, expect, it } from "vitest"
import { canonicalHash } from "@serene-pub/sdk"
import { CORE_SPECS } from "$lib/server/pipelines/specs"

/**
 * `slug@semver` → the document's canonical hash.
 *
 * The version is *in the key* on purpose: bumping it makes a new entry rather
 * than editing one, so the diff shows a version and a shape changing together
 * instead of a hash quietly moving underneath a version that did not.
 */
const PUBLISHED: Record<string, string> = {
	// 1.12.0: the session rename (0141) — session-scope/-history/-cast ids
	// and sessionId/sessionScope ports ripple into every pinned type.
	"core:spec/respond@1.12.0": "72df744027f6d",
	// 1.11.0: turn-taking becomes a node (19 §5, U-C4) — the `speaker` task
	// records the trigger's pick, and context + generation take their
	// speaker from its output instead of only from the run scope.
	"core:spec/respond@1.11.0": "8ae7ccbf18fae",
	// 1.6.0: the session rename, as above.
	"core:spec/narrate@1.6.0": "1e7f35cc2ddaaa",
	// 1.5.0: declares `contributes.triggers` — the narrate button on the
	// standard mode is now a fact in the document, not a branch in
	// generateResponse (19 §3–§4, U-C3).
	"core:spec/narrate@1.5.0": "1bfa0898d8db15",
	"core:spec/summarize-world@1.2.0": "11dc51df9014b",
	"core:spec/summarize-character@1.2.0": "460b20537ef94",
	"core:spec/summarize-scene@1.2.0": "42b49662a7449",
	"core:spec/summarize-history@1.2.0": "235d7d8abbef1",
	"core:spec/graph-build@1.1.0": "122aaab2d9ed79"
}

describe("published spec hashes", () => {
	const current = () => {
		const out: Record<string, string> = {}
		for (const entry of CORE_SPECS) {
			const doc = entry.build()
			out[`${doc.id}@${doc.version}`] = canonicalHash(doc)
		}
		return out
	}

	it("has not changed shape under an already-recorded version", () => {
		const now = current()
		const drifted = Object.entries(PUBLISHED)
			.filter(([pin, hash]) => now[pin] && now[pin] !== hash)
			.map(([pin, hash]) => `${pin}: recorded ${hash}, code ${now[pin]}`)

		expect(
			drifted,
			drifted.length
				? "A published version is frozen. Bump the spec's *_VERSION and " +
						"add the new pin below — seeding matches on (slug, semver) " +
						"and skips, so an unbumped change never reaches an install " +
						"that has already booted."
				: undefined
		).toEqual([])
	})

	it("records every spec this build publishes", () => {
		const missing = Object.keys(current()).filter((pin) => !PUBLISHED[pin])
		expect(
			missing,
			missing.length
				? `New or bumped spec version(s). Add the pin and hash below:\n` +
						missing
							.map((pin) => `\t"${pin}": "${current()[pin]}",`)
							.join("\n")
				: undefined
		).toEqual([])
	})
})
