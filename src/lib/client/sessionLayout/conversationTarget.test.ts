import { describe, expect, test } from "vitest"
import {
	conversationKindOf,
	conversationTargetOf,
	type TargetPanel
} from "./conversationTarget"

const isMessages = (id: string) =>
	id === "messages" || id.startsWith("messages#")
const P = (key: string, tabs: string[], open = tabs[0]): TargetPanel => ({
	key,
	tabs,
	open
})
const run = (
	zones: Partial<Record<"left" | "middle" | "right", TargetPanel[]>>,
	instanceId: string,
	last?: string | null
) =>
	conversationTargetOf({
		zones: { left: [], middle: [], right: [], ...zones },
		instanceId,
		isMessages,
		last
	})

const story = (open: string) => [
	P("m", ["messages", "stats#characters"], open),
	P("t", ["turn-line"]),
	P("c", ["composer"])
]

describe("conversationTargetOf", () => {
	test("Story default: messages open", () => {
		expect(run({ middle: story("messages") }, "composer")).toEqual({
			target: "messages",
			writingTo: false
		})
		expect(run({ middle: story("messages") }, "turn-line")).toEqual({
			target: "messages",
			writingTo: false
		})
	})
	test("Story default: a non-Messages tab open keeps writing to", () => {
		expect(run({ middle: story("stats#characters") }, "composer")).toEqual({
			target: "messages",
			writingTo: true
		})
	})
	test("last is honoured", () => {
		const m = [
			P("m", ["messages", "messages#sanctum", "stats"], "stats"),
			P("c", ["composer"])
		]
		expect(run({ middle: m }, "composer", "messages#sanctum")).toEqual({
			target: "messages#sanctum",
			writingTo: true
		})
		expect(run({ middle: m }, "composer", "nope")).toEqual({
			target: "messages",
			writingTo: true
		})
	})
	test("nearest of two Messages panels above wins", () => {
		const m = [
			P("a", ["messages"]),
			P("b", ["messages#sanctum"]),
			P("c", ["composer"])
		]
		expect(run({ middle: m }, "composer")).toEqual({
			target: "messages#sanctum",
			writingTo: false
		})
	})
	test("composer above its Messages: nearest below", () => {
		const m = [P("c", ["composer"]), P("m", ["messages"])]
		expect(run({ middle: m }, "composer")).toEqual({
			target: "messages",
			writingTo: false
		})
	})
	test("ties go to the one above", () => {
		const m = [
			P("a", ["messages"], "stats"),
			P("c", ["composer"]),
			P("b", ["messages#x"], "other")
		]
		const z = [
			{ ...m[0], tabs: ["messages", "stats"], open: "stats" },
			m[1],
			{ ...m[2], tabs: ["messages#x", "other"], open: "other" }
		]
		expect(run({ middle: z }, "composer")).toEqual({
			target: "messages",
			writingTo: true
		})
	})
	test("composer in a side, Messages in the middle", () => {
		expect(
			run(
				{
					middle: [P("m", ["messages"])],
					right: [P("c", ["composer"])]
				},
				"composer"
			)
		).toEqual({
			target: "messages",
			writingTo: false
		})
	})
	test("no Messages gives null; unknown instance gives null", () => {
		expect(run({ middle: [P("c", ["composer"])] }, "composer")).toBeNull()
		expect(run({ middle: [P("m", ["messages"])] }, "composer")).toBeNull()
	})
	test("Lair messages#sanctum as a tab", () => {
		const m = [
			P("m", ["messages#sanctum", "stats"], "messages#sanctum"),
			P("c", ["composer"])
		]
		expect(run({ middle: m }, "composer")).toEqual({
			target: "messages#sanctum",
			writingTo: false
		})
	})
})

describe("conversationKindOf", () => {
	test("reads the widget of an instance id", () => {
		expect(conversationKindOf("messages")).toBe("messages")
		expect(conversationKindOf("messages#sanctum")).toBe("messages")
		expect(conversationKindOf("composer")).toBe("composer")
		expect(conversationKindOf("turn-line#2")).toBe("turn-line")
		expect(conversationKindOf("stats")).toBeNull()
	})
})
