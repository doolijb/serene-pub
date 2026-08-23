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
	"core:spec/respond@1.10.0": "1e087d629a6b3c",
	"core:spec/narrate@1.4.0": "10f782334fb959",
	"core:spec/summarize-world@1.1.0": "12ae76f187a917",
	"core:spec/summarize-character@1.1.0": "80f380b6089cf",
	"core:spec/summarize-scene@1.1.0": "8f3cd054e63cc",
	"core:spec/summarize-history@1.1.0": "46f05f35469a3",
	"core:spec/graph-build@1.0.1": "199a066924d0ce"
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
