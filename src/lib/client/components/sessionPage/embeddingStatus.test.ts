/**
 * A line's embedding mark (owner ruling DG6, 2026-11-17): a row from the server
 * carries `embeddingState` for a reader who is not an administrator, and the
 * mark uses it; a row with a model id and no state is compared in the browser.
 */
import { describe, expect, it } from "vitest"
import { embeddingStatusIn } from "./sessionPageProjections"

const ACTIVE = "api::http://embed.example::m"
const ctx = (starred = true, active: string | null = ACTIVE) =>
	({
		settings: { activeEmbeddingModel: active },
		capabilityDefaults: starred
			? { "text->embedding": { connectionId: 1 } }
			: {}
	}) as any

describe("embeddingStatusIn", () => {
	it("uses the server's state when the row carries one and no id", () => {
		expect(embeddingStatusIn(ctx(), null, "current")).toBe("current")
		expect(embeddingStatusIn(ctx(), null, "stale")).toBe("stale")
		expect(embeddingStatusIn(ctx(), null, "none")).toBe("none")
	})
	it("compares the id when the row carries no state: the same three states", () => {
		expect(embeddingStatusIn(ctx(), ACTIVE)).toBe("current")
		expect(embeddingStatusIn(ctx(), "other")).toBe("stale")
		expect(embeddingStatusIn(ctx(), null)).toBe("none")
	})
	it("a row with no state and no id reads none for a non-administrator", () => {
		expect(embeddingStatusIn(ctx(), undefined, undefined)).toBe("none")
	})
	it("is hidden when nothing is starred, whatever the state", () => {
		expect(embeddingStatusIn(ctx(false), null, "current")).toBe("hidden")
		expect(embeddingStatusIn(ctx(true, null), "x")).toBe("hidden")
	})
	it("a non-administrator has no model id and no connection id: the server's state and readiness decide", () => {
		const member = (ready: string[]) =>
			({ settings: {}, capabilityDefaults: {}, capabilitiesReady: ready }) as any
		expect(embeddingStatusIn(member(["text->embedding"]), null, "current")).toBe("current")
		expect(embeddingStatusIn(member(["text->embedding"]), null, "stale")).toBe("stale")
		expect(embeddingStatusIn(member([]), null, "current")).toBe("hidden")
	})
})
