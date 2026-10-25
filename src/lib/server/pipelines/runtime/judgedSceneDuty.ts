/**
 * 🚧 The sweep duty *Notice when the scene moves on* meets the host's judged scene check (pass 7, R-i, sprint 2):
 * the duties step asks `judgedSceneCheckOf` before any model is, and a check that is not due turns the duty Off
 * for this run. Pure but for the one call it is handed. ⚠ Never "floor" (NOMENCLATURE §9).
 */
import type { JudgedSceneCheck } from "@serene-pub/contracts"
import { routineRunOf } from "$lib/server/pipelines/routines/runs"

type Mode = "full" | "review" | "off"

/** 🚧 The duty's mode key, as `dutyModes` publishes the param `sceneMovedOn`. */
export const SCENE_MOVED_ON_MODE = "scene-moved-on"

/**
 * 🚧 The check for this run: not due with `'off: the duty is off'` when the duty's mode is `off`; not due with
 * `'off: not a routine run'` when `routineRunOf(runId)` holds no session; else `judgedSceneCheckOf(db, sessionId, { runId })`.
 */
export async function judgedSceneCheckFor(
	db: Db,
	modes: Readonly<Record<string, Mode>>,
	runId: string
): Promise<JudgedSceneCheck> {
	if (modes[SCENE_MOVED_ON_MODE] === "off") return { due: false, why: "off: the duty is off" }
	const sessionId = routineRunOf(runId)?.sessionId
	if (sessionId == null) return { due: false, why: "off: not a routine run" }
	const { judgedSceneCheckOf } = await import("$lib/server/scenes/boundaryWatcher")
	return await judgedSceneCheckOf(db, sessionId, { runId })
}

/**
 * 🚧 A sweep duties step's output with the check folded in: not due → `modes[SCENE_MOVED_ON_MODE]` and
 * `main.modes[SCENE_MOVED_ON_MODE]` read `off` and `any` / `main.any` are recomputed (some mode not `off`);
 * the check rides on `sceneCheck` and `main.sceneCheck`. Returns a new object; `out` is not touched.
 */
export function withJudgedSceneCheck<
	T extends { main: { modes: Record<string, Mode>; any: boolean }; modes: Record<string, Mode>; any: boolean }
>(out: T, check: JudgedSceneCheck): T & { sceneCheck: JudgedSceneCheck; main: T["main"] & { sceneCheck: JudgedSceneCheck } } {
	const settle = <M extends { modes: Record<string, Mode>; any: boolean }>(m: M): M => {
		if (check.due) return m
		const modes = { ...m.modes, [SCENE_MOVED_ON_MODE]: "off" as Mode }
		return { ...m, modes, any: Object.values(modes).some((x) => x !== "off") }
	}
	return {
		...settle(out),
		sceneCheck: check,
		main: { ...settle(out.main), sceneCheck: check }
	} as T & { sceneCheck: JudgedSceneCheck; main: T["main"] & { sceneCheck: JudgedSceneCheck } }
}
