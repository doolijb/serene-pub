/**
 * 🚧 What a pipeline needs, in a person's words, and a preset's
 * recommendations (R56; lane F1, 2026-10-21) — the pure half of
 * `unserved.ts`, over core's own documents.
 */
import { describe, expect, it } from "vitest"
import type { EffectiveRegistration } from "@serene-pub/sdk"
import {
	recommendationsOf,
	requiredTransformsOf,
	transformNoun,
	transformVerb,
	unservedSentence
} from "./unserved"

describe("what a pipeline's model calls need", () => {
	it("Story's reply needs a text model — never the hearing model its transcribe step would use", async () => {
		const { storyRespondSpec } = await import("@serene-pub/core-catalog")
		const need = requiredTransformsOf(storyRespondSpec() as never)
		expect(need).toContain("text->text")
		expect(need.some((t) => t.includes("audio"))).toBe(false)
	})

	it("Picture each new scene needs a model that draws", async () => {
		const { illustrateNewSceneSpec } = await import("@serene-pub/core-catalog")
		expect(requiredTransformsOf(illustrateNewSceneSpec() as never)).toContain("text->image")
	})
})

describe("in a person's words", () => {
	it("says what the model must do, and names it as a start card does", () => {
		expect(transformVerb("text->image")).toBe("draw pictures")
		expect(transformVerb("text->text")).toBe("write replies")
		expect(transformVerb("text+audio->text")).toBe("write replies and hear")
		expect(transformNoun("text->text")).toBe("a text model")
		expect(transformNoun("text->image")).toBe("an image model")
		expect(transformNoun("text+audio->text")).toBe("a hearing model")
		expect(unservedSentence(["text->image"])).toBe("Unavailable: needs a model that can draw pictures.")
		expect(unservedSentence(["text->text", "text->image"])).toBe(
			"Unavailable: needs a model that can write replies and draw pictures."
		)
	})
})

describe("a preset's recommendations", () => {
	const doc = (id: string, definitionId: string) =>
		({ id, nodes: [{ key: "n", kind: "oracle", definitionId, definitionVersion: 1 }] }) as never
	const reg = (family: string, pipeline: string, mode?: string) =>
		({
			key: `${family}→${pipeline}`,
			trigger:
				family === "event"
					? { family, event: "core:event/message-respond@1" }
					: family === "routine"
						? { family, cadence: { id: "core:cadence/after-each-round@1", options: {} } }
						: { family, action: `${pipeline}#a` },
			pipeline,
			origin: "genre",
			...(mode ? { mode } : {})
		}) as unknown as EffectiveRegistration

	it("needs what it runs (events, routines on); better with what it offers (actions, Off routines)", async () => {
		const docs = new Map([
			["reply", doc("reply", "core:oracle/generate-text")],
			["picture", doc("picture", "core:oracle/generate-image")],
			["memory", doc("memory", "core:oracle/generate-text")]
		])
		const r = recommendationsOf(
			[reg("event", "reply"), reg("action", "picture"), reg("routine", "memory", "off")],
			docs,
			new Set(["text->text"])
		)
		expect(r.needs).toEqual(["text->text"])
		expect(r.betterWith.some((t) => t.endsWith("->image"))).toBe(true)
		expect(r.unserved.every((t) => t.endsWith("->image"))).toBe(true)
		expect(r.words).toBe("Needs: a text model · Better with: an image model")
	})
})
