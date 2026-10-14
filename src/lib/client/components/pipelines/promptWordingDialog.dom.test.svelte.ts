/**
 * The prompt dialog (2026-10-13): read every prompt a step offers, then use
 * one. The socket and the interest registry are faked; the server half is
 * `pipelines.promptWording.int.test.ts`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { emitted, socket, listeners, listen } = vi.hoisted(() => {
	const emitted: Array<[string, any]> = []
	const listeners = new Map<string, Set<(msg: any) => void>>()
	return {
		emitted,
		socket: {
			emit: (event: string, payload: unknown) =>
				emitted.push([event, payload]),
			on: () => {},
			off: () => {}
		},
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			let set = listeners.get(key)
			if (!set) listeners.set(key, (set = new Set()))
			set.add(handler)
			return () => set!.delete(handler)
		}
	}
})
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen
}))

import PromptWordingDialog from "./PromptWordingDialog.svelte"

let view: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (view) unmount(view)
	view = null
	document.body.innerHTML = ""
	emitted.length = 0
	listeners.clear()
})

const option = {
	id: "opt-prompt",
	label: "Prompt",
	control: "prompts-ref",
	step: { key: "s", heading: "Reply" },
	writable: true,
	value: 3,
	promptFields: ["systemPrompt", "postHistoryInstructions"],
	choices: [
		{ id: 3, label: "Roleplay - Living Scene", group: "shipped" },
		{ id: 1, label: "Roleplay - Plain", group: "shipped" },
		{ id: 2, label: "Writer", group: "shipped" },
		{ id: 9, label: "Our house style", group: "usedHere" }
	]
} as any

function render(over: Record<string, unknown> = {}) {
	const picks: number[] = []
	let closed = 0
	view = mount(PromptWordingDialog, {
		target: document.body,
		props: {
			slug: "core:spec/chat-respond",
			sessionId: 7,
			option,
			rowLabel: "Reply",
			fieldLabel: (f: string) =>
				f === "systemPrompt" ? "System prompt" : f,
			canPick: true,
			onPick: (id: number) => picks.push(id),
			onClose: () => closed++,
			...over
		}
	})
	flushSync()
	return { picks, closed: () => closed }
}

const answer = (promptId: number, rest: Record<string, unknown>) => {
	for (const h of listeners.get("pipelines:promptWording") ?? [])
		h({
			slug: "core:spec/chat-respond",
			optionId: "opt-prompt",
			promptId,
			...rest
		})
	flushSync()
}

const button = (name: RegExp) =>
	[...document.querySelectorAll("button")].find((b) =>
		name.test((b.textContent ?? "").trim())
	) as HTMLButtonElement | undefined

const asks = () =>
	emitted
		.filter(([e]) => e === "pipelines:promptWording")
		.map(([, p]) => p.promptId)

describe("the prompt dialog", () => {
	test("opens on the prompt in use and asks for its wording, at this session", async () => {
		render()
		await tick()
		expect(document.body.textContent).toContain("Prompts for Reply")
		expect(emitted[0]).toEqual([
			"pipelines:promptWording",
			{
				slug: "core:spec/chat-respond",
				optionId: "opt-prompt",
				promptId: 3,
				sessionId: 7
			}
		])
		expect(document.body.textContent).toContain("Loading the wording")
		answer(3, {
			name: "Roleplay - Living Scene",
			declared: ["systemPrompt", "postHistoryInstructions"],
			fields: {
				systemPrompt: "You are writing interactive fiction.",
				postHistoryInstructions: ""
			},
			shipped: true
		})
		// Exactly the text: the text is pre-wrap, so markup whitespace would show.
		expect(
			document.querySelector("p.whitespace-pre-wrap")?.textContent
		).toBe("You are writing interactive fiction.")
		expect(document.body.textContent).toContain("System prompt")
		expect(document.body.textContent).toContain("Ships with Serene Pub")
		// The one in use is marked, and offers no Use of itself.
		expect(document.body.textContent).toContain("In use")
		expect(button(/^Use Roleplay - Living Scene$/)).toBeUndefined()
	})

	test("groups the prompts the way the picker does", async () => {
		render()
		await tick()
		const text = document.body.textContent ?? ""
		expect(text.indexOf("Used in this pipeline")).toBeLessThan(
			text.indexOf("Serene Pub ships")
		)
	})

	test("reading another prompt asks once; Use picks it and closes", async () => {
		const { picks, closed } = render()
		await tick()
		button(/^Writer$/)!.click()
		flushSync()
		await tick()
		expect(asks()).toEqual([3, 2])
		answer(2, {
			name: "Writer",
			declared: ["systemPrompt"],
			fields: {
				systemPrompt: "You are the writer continuing this story."
			},
			shipped: true
		})
		expect(document.body.textContent).toContain(
			"You are the writer continuing this story."
		)
		button(/^Use Writer$/)!.click()
		expect(picks).toEqual([2])
		expect(closed()).toBe(1)
	})

	test("a row's own Use picks without reading it first", async () => {
		const { picks } = render()
		await tick()
		const use = document.querySelector(
			'button[aria-label="Use Roleplay - Plain"]'
		) as HTMLButtonElement
		use.click()
		expect(picks).toEqual([1])
	})

	test("read-only: every prompt opens, none can be used", async () => {
		render({ canPick: false })
		await tick()
		expect(
			document.querySelectorAll('button[aria-label^="Use "]').length
		).toBe(0)
		button(/^Writer$/)!.click()
		flushSync()
		await tick()
		expect(asks()).toContain(2)
		expect(document.body.textContent).toContain("not yours to do")
	})

	test("a refusal shows in the dialog, never as a toast", async () => {
		render()
		await tick()
		for (const h of listeners.get("pipelines:promptWording:error") ?? [])
			h({
				slug: "core:spec/chat-respond",
				optionId: "opt-prompt",
				promptId: 3,
				error: "That prompt no longer exists."
			})
		flushSync()
		expect(document.body.textContent).toContain(
			"That prompt no longer exists."
		)
		// And it can be asked again, rather than staying failed.
		const before = asks().length
		button(/^Try again$/)!.click()
		flushSync()
		expect(asks().length).toBe(before + 1)
		expect(asks().at(-1)).toBe(3)
		expect(document.body.textContent).toContain("Loading the wording")
	})

	test("only the status lines announce; the prompt text is not a live region", async () => {
		render()
		await tick()
		const pane = document.querySelector('section[aria-label^="Wording"]')!
		expect(pane.getAttribute("aria-live")).toBeNull()
		expect(
			document.querySelector('[role="status"]')?.textContent
		).toContain("Loading the wording")
	})

	test("an answer for another dialog's row is ignored", async () => {
		render()
		await tick()
		for (const h of listeners.get("pipelines:promptWording") ?? [])
			h({
				slug: "core:spec/chat-narrate",
				optionId: "opt-prompt",
				promptId: 3,
				name: "Narrator",
				declared: [],
				fields: {}
			})
		flushSync()
		expect(document.body.textContent).toContain("Loading the wording")
	})
})
