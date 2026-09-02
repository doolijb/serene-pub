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
	// 1.0.0: the standard session type as a create spec (23 §7) — the F29
	// floor's shape moves from the input descriptor to this document.
	"core:spec/create-chat@2.2.0": "fa56525a69fb9",
	"core:spec/create-chat@2.1.0": "ea80f2679383c",
	"core:spec/create-chat@2.0.0": "a6281141b21ea",
	"core:spec/respond@1.15.0": "f8768da5723e3",
	"core:spec/narrate@1.9.0": "1f7a1f6da815d7",
	// Pre-24 (the genre rename): superseded, kept for the drift check.
	"core:spec/create-chat@1.0.0": "e176f2e63375",
	// 1.14.0 / 1.8.0: mode references re-keyed to the create spec (23 §7) —
	// taxonomy.mode and narrate's contributed trigger now name
	// core:spec/create-chat instead of the input type.
	"core:spec/respond@1.14.0": "4e7dcba7841ab",
	"core:spec/narrate@1.8.0": "124ccd9f3b3758",
	// 1.13.0 / 1.7.0 / 1.3.0 / 1.2.0: the catalogue claims (23 §2) —
	// `taxonomy` {zone, role, mode} rides every document.
	"core:spec/respond@1.13.0": "f7c71609c1181",
	"core:spec/narrate@1.7.0": "1e8300f1868ebe",
	"core:spec/summarize-world@1.3.0": "192c5827940c72",
	"core:spec/summarize-character@1.3.0": "10eebb63259167",
	"core:spec/summarize-scene@1.3.0": "146ddf1045ab62",
	"core:spec/summarize-history@1.3.0": "63e75e889b660",
	"core:spec/graph-build@1.2.0": "1d9e569016efb3",
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
	"core:spec/graph-build@1.1.0": "122aaab2d9ed79",
	// 1.0.0: the echo spec — the minimal action harness that proves the review
	// gate end to end (a button fires it, `create-message` parks, the modal's
	// form IS the entry). Template for the image provider spec.
	"core:spec/echo@1.0.0": "155ebfa1de7484",
	// 1.0.0: local image generation end to end — a composer button, the review
	// gate as the prompt entry, and the render posted as a message.
	"core:spec/generate-image@1.0.0": "7be8979159e48"
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
