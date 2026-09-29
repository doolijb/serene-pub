import { describe, expect, test } from "vitest"
import { testerGate } from "./testerGate"

const local = { mode: "local" as const, localModelName: "Xenova/all-MiniLM-L6-v2" }
const api = { mode: "api" as const }

describe("what the sprite tester does about the embedding model", () => {
	test("a resident model is simply used", () => {
		expect(
			testerGate({ loadedModelId: "Xenova/x", target: local, localCached: true })
		).toEqual({ kind: "ready" })
	})

	test("resident wins even when nothing else is known", () => {
		// The target read is skippable once something is already up.
		expect(
			testerGate({ loadedModelId: "api::host::m", target: null, localCached: null })
		).toEqual({ kind: "ready" })
	})

	test("REGRESSION: a configured-but-unloaded model is LOADED, not refused", () => {
		// The bug. Nothing loads the lane at boot and it unloads on a TTL, so
		// this is the ordinary state on a machine with an embedding model set
		// up and nothing pending to vectorize. It used to answer "no embedding
		// model is loaded, load one in Connections" — to someone who had.
		expect(
			testerGate({ loadedModelId: null, target: local, localCached: true })
		).toEqual({ kind: "load" })
	})

	test("an API target needs no download, so it loads on demand", () => {
		expect(
			testerGate({ loadedModelId: null, target: api, localCached: null })
		).toEqual({ kind: "load" })
	})

	test("nothing set up says so, and points at Connections", () => {
		const gate = testerGate({
			loadedModelId: null,
			target: null,
			localCached: null
		})
		expect(gate.kind).toBe("refuse")
		expect(gate.kind === "refuse" && gate.reason).toMatch(/no embedding model is set up/i)
	})

	test("a cold local model refuses rather than stalling the box for minutes", () => {
		const gate = testerGate({
			loadedModelId: null,
			target: local,
			localCached: false
		})
		expect(gate.kind).toBe("refuse")
		expect(gate.kind === "refuse" && gate.reason).toContain("all-MiniLM-L6-v2")
		expect(gate.kind === "refuse" && gate.reason).toMatch(/megabytes/)
	})

	test("an unanswered cache question refuses — it never starts a silent download", () => {
		// `null` is "not asked", and a caller that could not answer must not
		// be taken as a yes.
		expect(
			testerGate({ loadedModelId: null, target: local, localCached: null }).kind
		).toBe("refuse")
	})

	test("a local target with no repo name falls through to a load", () => {
		// Nothing to check the cache for, so nothing to refuse on.
		expect(
			testerGate({
				loadedModelId: null,
				target: { mode: "local" },
				localCached: null
			})
		).toEqual({ kind: "load" })
	})
})
