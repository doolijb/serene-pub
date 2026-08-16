/**
 * Round-5 (CharaVault image fix, post-implementation live testing): a
 * mid-transfer timeout on a card file was falling through to a misleading
 * 404 in the image-proxy route, and the underlying 20s deadline
 * (CHARAVAULT_FETCH_TIMEOUT_MS) was too tight for a multi-MB file transfer
 * to begin with — tight enough to matter for search/login (small JSON,
 * should fail fast) but not for card *file* fetches. fetchCharaVaultCardResponse
 * — used by the image proxy AND by getCardBytesAndParsed (detail view,
 * import) — now defaults to the longer CHARAVAULT_IMAGE_FETCH_TIMEOUT_MS
 * instead of requiring every call site to remember to pass it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({ db: {} }))

// Bypasses the real login/session/DB chain entirely — not what this test is
// about — while keeping every other export (the two timeout constants in
// particular) real, so the assertions below check against the actual
// exported values rather than a value this test made up itself.
vi.mock("./session", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./session")>()
	return {
		...actual,
		hasActiveSession: () => false,
		withCharaVaultSession: async (
			requestFn: (cookie: string | null) => Promise<Response>,
			parseResponse: (response: Response) => Promise<unknown>
		) => parseResponse(await requestFn(null))
	}
})

describe("fetchCharaVaultCardResponse — timeout default", () => {
	let timeoutSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		timeoutSpy = vi.spyOn(AbortSignal, "timeout")
		vi.spyOn(global, "fetch").mockResolvedValue(
			new Response(new Uint8Array([1, 2, 3]), {
				status: 200,
				headers: { "content-type": "image/png" }
			})
		)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("defaults to CHARAVAULT_IMAGE_FETCH_TIMEOUT_MS, not the shorter general-purpose default", async () => {
		const { fetchCharaVaultCardResponse } = await import(
			"./charaVaultSource"
		)
		const { CHARAVAULT_FETCH_TIMEOUT_MS, CHARAVAULT_IMAGE_FETCH_TIMEOUT_MS } =
			await import("./session")

		await fetchCharaVaultCardResponse({ folder: "f", file: "g.png" })

		expect(timeoutSpy).toHaveBeenCalledWith(CHARAVAULT_IMAGE_FETCH_TIMEOUT_MS)
		expect(CHARAVAULT_IMAGE_FETCH_TIMEOUT_MS).toBeGreaterThan(
			CHARAVAULT_FETCH_TIMEOUT_MS
		)
	})

	test("an explicit timeoutMs override is still honored", async () => {
		const { fetchCharaVaultCardResponse } = await import(
			"./charaVaultSource"
		)

		await fetchCharaVaultCardResponse(
			{ folder: "f", file: "g.png" },
			"interactive",
			undefined,
			12_345
		)

		expect(timeoutSpy).toHaveBeenCalledWith(12_345)
	})
})
