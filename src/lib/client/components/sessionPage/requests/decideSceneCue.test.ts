/** 🚧 `decide-scene-cue` — a scene cue's Yes or Not here (live scenes §4), core's widgets only. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerDecideSceneCue } from "./decideSceneCue"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

describe("answerDecideSceneCue", () => {
	test("decides the cue as asked and resolves with the scene it opened, or null", async () => {
		const decided: Array<[number, boolean]> = []
		const deps = {
			decideSceneCue: async (cueId: number, accept: boolean) => {
				decided.push([cueId, accept])
				return accept ? 31 : null
			}
		}
		expect(await answerDecideSceneCue({ cueId: 7, accept: true }, deps)).toEqual({ sceneId: 31 })
		expect(await answerDecideSceneCue({ cueId: 8, accept: false }, deps)).toEqual({ sceneId: null })
		expect(decided).toEqual([
			[7, true],
			[8, false]
		])
	})

	test("refuses, in words, a cue that is not a whole number or an answer that is not a yes or a no", async () => {
		const deps = { decideSceneCue: async () => null }
		await expect(answerDecideSceneCue({ cueId: "7", accept: true }, deps)).rejects.toThrow(
			"decide-scene-cue takes the cue's id, a whole number"
		)
		await expect(answerDecideSceneCue({ cueId: 7 }, deps)).rejects.toThrow(
			"decide-scene-cue takes accept: true (Yes) or false (Not here)"
		)
	})

	test("the server's refusal is the asking widget's, as it said it", async () => {
		const deps = {
			decideSceneCue: async () => {
				throw new Error("That suggestion was already set aside.")
			}
		}
		await expect(answerDecideSceneCue({ cueId: 1, accept: true }, deps)).rejects.toThrow(
			"That suggestion was already set aside."
		)
	})

	test("core only: a plugin's widget is refused in words and nothing is decided", async () => {
		expect(WIDGET_REQUEST_ASKERS["decide-scene-cue"]).toBe("core")
		const decided: number[] = []
		const ask = guardWidgetRequests((async (_k: string, p: unknown) =>
			answerDecideSceneCue(p, {
				decideSceneCue: async (id) => {
					decided.push(id)
					return null
				}
			})) as WidgetRequestHandler)
		await expect(
			ask("decide-scene-cue", { cueId: 1, accept: true }, { widgetId: "acme:x", owner: "acme" })
		).rejects.toThrow("only core's own widgets ask 'decide-scene-cue'")
		expect(decided).toEqual([])
		await ask("decide-scene-cue", { cueId: 1, accept: false }, { widgetId: "messages", owner: "core" })
		expect(decided).toEqual([1])
	})
})
