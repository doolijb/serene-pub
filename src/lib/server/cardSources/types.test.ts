/**
 * Round-5 (CharaVault image fix, post-implementation live testing) added
 * an optional `options` param to CardSourceUnavailableError so a
 * reclassified error (eg. a body-read timeout wrapped by the image-proxy
 * route) can carry its original cause forward — the only place that
 * identity survives once the round's temporary diagnostic logging is
 * removed. Covers that it actually round-trips, since a constructor
 * accepting an extra arg it silently drops would look identical at every
 * call site until someone went looking for `.cause` and found nothing.
 */
import { describe, expect, test } from "vitest"
import { CardSourceInvalidRefError, CardSourceUnavailableError } from "./types"

describe("CardSourceUnavailableError", () => {
	test("an explicit cause is preserved and retrievable via .cause", () => {
		const original = new Error("underlying failure")
		const wrapped = new CardSourceUnavailableError(
			"Card image transfer failed or timed out",
			{ cause: original }
		)

		expect(wrapped.cause).toBe(original)
		expect(wrapped.message).toBe("Card image transfer failed or timed out")
		expect(wrapped.name).toBe("CardSourceUnavailableError")
	})

	test("omitting options is still valid — no cause, no crash", () => {
		const err = new CardSourceUnavailableError("Card source is unreachable")
		expect(err.cause).toBeUndefined()
	})

	test("CardSourceInvalidRefError (a subclass) is unaffected by the added param", () => {
		const err = new CardSourceInvalidRefError("bad ref")
		expect(err.name).toBe("CardSourceInvalidRefError")
		expect(err.cause).toBeUndefined()
		expect(err).toBeInstanceOf(CardSourceUnavailableError)
	})
})
