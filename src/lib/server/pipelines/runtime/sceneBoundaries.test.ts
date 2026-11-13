/**
 * 🚧 `core:query/scene-boundaries@1`'s binding: it reads the session off the
 * scope port, `depth` off its param and `every` off the routine's cadence,
 * hands them to the walk (mocked here) and publishes its boundaries on
 * `main`. No database: the walk is mocked.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const sceneBoundariesOf = vi.fn()

vi.mock("$lib/server/db", () => ({ db: { fake: true } }))
vi.mock("$lib/server/scenes/boundaryWatcher", () => ({
	sceneBoundariesOf: (...args: unknown[]) => sceneBoundariesOf(...args)
}))

const BOUNDARY = { at: 7, trigger: "dayCrossed", reason: "the day changed" }

async function hook() {
	const { sceneBoundariesBindings } = await import("./sceneBoundaries")
	return sceneBoundariesBindings()["core:query/scene-boundaries@1"] as any
}

beforeEach(() => {
	sceneBoundariesOf.mockReset()
	sceneBoundariesOf.mockResolvedValue({ boundaries: [BOUNDARY] })
})

describe("core:query/scene-boundaries@1", () => {
	test("passes the session, the depth and the routine's n, and publishes the boundaries on main", async () => {
		const out = await (
			await hook()
		)(
			{
				scope: { sessionId: 12 },
				params: { depth: 3 },
				routine: { cadence: { options: { n: 4 } } }
			},
			{}
		)
		expect(sceneBoundariesOf).toHaveBeenCalledWith({ fake: true }, 12, {
			depth: 3,
			every: 4
		})
		expect(out).toMatchObject({ kind: "ok", value: { main: [BOUNDARY] } })
	})

	test("depth defaults to 2 and every to 2 (the cadence's own default) when they are missing or not whole numbers", async () => {
		const h = await hook()
		await h({ scope: { sessionId: 1 }, params: {} }, {})
		expect(sceneBoundariesOf).toHaveBeenLastCalledWith({ fake: true }, 1, {
			depth: 2,
			every: 2
		})
		await h(
			{
				scope: { sessionId: 1 },
				params: { depth: 0 },
				routine: { cadence: { options: { n: 1.5 } } }
			},
			{}
		)
		expect(sceneBoundariesOf).toHaveBeenLastCalledWith({ fake: true }, 1, {
			depth: 2,
			every: 2
		})
	})

	test("halts, and does not walk, when the run has no session", async () => {
		const out = await (await hook())({ scope: {}, params: {} }, {})
		expect(sceneBoundariesOf).not.toHaveBeenCalled()
		expect(JSON.stringify(out)).toContain("no session")
	})
})
