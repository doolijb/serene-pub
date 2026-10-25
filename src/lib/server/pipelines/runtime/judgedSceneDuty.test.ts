import { afterEach, describe, expect, it, vi } from "vitest"

const judgedSceneCheckOf = vi.fn()
vi.mock("$lib/server/scenes/boundaryWatcher", () => ({ judgedSceneCheckOf }))

import { forgetRoutineRun, noteRoutineRun } from "$lib/server/pipelines/routines/runs"
import { judgedSceneCheckFor, SCENE_MOVED_ON_MODE, withJudgedSceneCheck } from "./judgedSceneDuty"

const db = {} as never
const RUN = "judged-scene-duty-run"

afterEach(() => {
	forgetRoutineRun(RUN)
	judgedSceneCheckOf.mockReset()
})

describe("judgedSceneCheckFor", () => {
	it("is not due, and asks nothing, when the duty is off", async () => {
		noteRoutineRun(RUN, { sessionId: 3, registrationKey: "k", depth: 0 })
		expect(await judgedSceneCheckFor(db, { [SCENE_MOVED_ON_MODE]: "off" }, RUN)).toEqual({ due: false, why: "off: the duty is off" })
		expect(judgedSceneCheckOf).not.toHaveBeenCalled()
	})

	it("is not due for a run no routine made", async () => {
		expect(await judgedSceneCheckFor(db, { [SCENE_MOVED_ON_MODE]: "full" }, "nobody")).toEqual({
			due: false,
			why: "off: not a routine run"
		})
		expect(judgedSceneCheckOf).not.toHaveBeenCalled()
	})

	it("asks the host for a registered run and returns its answer", async () => {
		const answer = { due: true, channel: "main", lines: [1, 2] }
		judgedSceneCheckOf.mockResolvedValue(answer)
		noteRoutineRun(RUN, { sessionId: 3, registrationKey: "k", depth: 0 })
		expect(await judgedSceneCheckFor(db, { [SCENE_MOVED_ON_MODE]: "review" }, RUN)).toEqual(answer)
		expect(judgedSceneCheckOf).toHaveBeenCalledWith(db, 3, { runId: RUN })
	})
})

describe("withJudgedSceneCheck", () => {
	const make = (modes: Record<string, "full" | "review" | "off">) => ({
		modes,
		any: Object.values(modes).some((m) => m !== "off"),
		main: { modes, any: Object.values(modes).some((m) => m !== "off") }
	})
	const due = { due: true as const, channel: "main", lines: [1] }
	const notDue = { due: false as const, why: "x" }

	it("leaves the modes as they were when due, and attaches the check twice", () => {
		const out = make({ [SCENE_MOVED_ON_MODE]: "full", summary: "off" })
		const got = withJudgedSceneCheck(out, due)
		expect(got.modes).toEqual(out.modes)
		expect(got.main.modes).toEqual(out.modes)
		expect(got.any).toBe(true)
		expect(got.sceneCheck).toEqual(due)
		expect(got.main.sceneCheck).toEqual(due)
	})

	it("turns the duty off in both places when not due; any follows the other duties", () => {
		const only = withJudgedSceneCheck(make({ [SCENE_MOVED_ON_MODE]: "full", summary: "off" }), notDue)
		expect(only.modes[SCENE_MOVED_ON_MODE]).toBe("off")
		expect(only.main.modes[SCENE_MOVED_ON_MODE]).toBe("off")
		expect(only.any).toBe(false)
		expect(only.main.any).toBe(false)
		const other = withJudgedSceneCheck(make({ [SCENE_MOVED_ON_MODE]: "full", summary: "full" }), notDue)
		expect(other.any).toBe(true)
		expect(other.main.any).toBe(true)
		expect(other.sceneCheck).toEqual(notDue)
	})

	it("does not touch its input", () => {
		const out = make({ [SCENE_MOVED_ON_MODE]: "full" })
		const before = JSON.stringify(out)
		withJudgedSceneCheck(out, notDue)
		expect(JSON.stringify(out)).toBe(before)
	})
})
