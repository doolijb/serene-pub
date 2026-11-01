/**
 * The turn line's pill (owner 2026-10-29): who else is typing, and whose
 * lines are being read aloud — *Mira is speaking…* — in one short sentence,
 * where *X is typing…* already showed. Compared by text, never by node.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import SessionBanners from "./SessionBanners.svelte"
import { bannerSentence, pendingSpeakRunOf, speakingNamesOf } from "./speakingLines"

let view: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (view) unmount(view)
	view = null
	document.body.innerHTML = ""
})

function pill(props: { typing?: string[]; showTyping?: boolean; speaking?: string[] }): string {
	const target = document.createElement("div")
	document.body.appendChild(target)
	view = mount(SessionBanners, {
		target,
		props: {
			typing: (props.typing ?? []).map((name) => ({ name })),
			showTyping: props.showTyping ?? true,
			speaking: props.speaking
		}
	})
	flushSync()
	return (target.textContent ?? "").replace(/\s+/g, " ").trim()
}

describe("the turn line's pill", () => {
	test("a spoken line reads *Mira is speaking…*", () => {
		expect(pill({ speaking: ["Mira"] })).toBe("Mira is speaking…")
	})

	test("typing and speaking share one short line", () => {
		expect(pill({ typing: ["Ann"], speaking: ["Mira"] })).toBe("Ann is typing… · Mira is speaking…")
		expect(pill({ typing: ["Ann", "Bo"], speaking: ["Mira", "Narrator"] })).toBe(
			"Ann and Bo are typing… · Mira and Narrator are speaking…"
		)
	})

	test("speaking shows where typing may not (no composer); typing alone keeps its old words", () => {
		expect(pill({ typing: ["Ann"], showTyping: false, speaking: ["Mira"] })).toBe("Mira is speaking…")
		expect(pill({ typing: ["Ann"], showTyping: false })).toBe("")
		expect(pill({ typing: ["Ann", "Bo", "Cy"] })).toBe("Ann, Bo and Cy are typing…")
	})

	test("nobody typing or speaking draws nothing", () => {
		pill({})
		expect(document.body.querySelector("span") === null).toBe(true)
	})
})

describe("whose lines are being spoken", () => {
	const line = (id: number, name: string, runId?: string) => ({
		id,
		name,
		metadata: runId ? { spoken: { pending: { runId, at: "2026-10-29T10:00:00Z" } } } : {}
	})
	const lines = [line(1, "Ann"), line(2, "Mira", "run-a"), line(3, "Mira", "run-b"), line(4, "Narrator", "run-c")]

	test("each line a live run speaks, by its speaker, once each, in line order", () => {
		expect(speakingNamesOf(lines, ["run-c", "run-a", "run-b"], (m) => m.name)).toEqual(["Mira", "Narrator"])
	})

	test("a run whose line is not loaded, or no live run, names nobody", () => {
		expect(speakingNamesOf(lines, ["run-z"], (m) => m.name)).toEqual([])
		expect(speakingNamesOf(lines, [], (m) => m.name)).toEqual([])
	})

	test("the marker reader takes only a non-empty run id", () => {
		expect(pendingSpeakRunOf({ spoken: { pending: { runId: "r1" } } })).toBe("r1")
		expect(pendingSpeakRunOf({ spoken: { pending: { runId: "" } } })).toBe(null)
		expect(pendingSpeakRunOf({ spoken: {} })).toBe(null)
		expect(pendingSpeakRunOf(null)).toBe(null)
	})

	test("the sentence builder alone", () => {
		expect(bannerSentence([], [])).toBe("")
		expect(bannerSentence(["Ann"], [])).toBe("Ann is typing…")
	})
})
