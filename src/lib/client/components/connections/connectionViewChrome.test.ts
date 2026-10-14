import { describe, expect, test } from "vitest"
import {
	modelsHeadline,
	statusLine,
	nextStep,
	chatDefaultFirst,
	modelMatchesQuery,
	showsModelsFilter,
	activeApiTab,
	apiConnectionTabs,
	showsTabStrip,
	type ChromeFacts,
	type NextStepFacts
} from "./connectionViewChrome"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const facts = (over: Partial<ChromeFacts> = {}): ChromeFacts => ({
	lastTest: null,
	testing: false,
	syncing: false,
	modelsSync: { at: null, error: null },
	modelCount: 0,
	missingCount: 0,
	timeAgo: () => "3 minutes ago",
	now: 1_000_000,
	...over
})

describe("statusLine — the whether, before the how", () => {
	test("nothing has asked: idle, not checked, and what to do", () => {
		expect(statusLine(facts())).toEqual({
			dot: "idle",
			word: "Not checked yet",
			sentence: "Test it, or ask for its models"
		})
	})
	test("the listing is the evidence when no test ran this visit", () => {
		expect(
			statusLine(facts({ modelsSync: { at: "2026-09-18", error: null } }))
		).toEqual({
			dot: "ready",
			word: "Listed",
			sentence: "Models checked 3 minutes ago"
		})
		expect(
			statusLine(
				facts({
					modelsSync: { at: "2026-09-18", error: "401 Unauthorized" }
				})
			)
		).toEqual({
			dot: "broken",
			word: "Couldn't list models",
			sentence: "401 Unauthorized"
		})
	})
	test("a test this visit outranks the listing, either way", () => {
		expect(
			statusLine(
				facts({
					modelsSync: { at: "x", error: "stale failure" },
					lastTest: { ok: true, error: null, at: 1_000_000 - 4000 }
				})
			)
		).toEqual({
			dot: "ready",
			word: "Reachable",
			sentence: "Answered just now"
		})
		expect(
			statusLine(
				facts({
					modelsSync: { at: "x", error: null },
					lastTest: {
						ok: false,
						error: "ECONNREFUSED",
						at: 1_000_000 - 90_000
					}
				})
			)
		).toEqual({
			dot: "broken",
			word: "Not reachable",
			sentence: "ECONNREFUSED"
		})
	})
	test("in flight is busy, and testing outranks a sync", () => {
		expect(statusLine(facts({ syncing: true }))).toMatchObject({
			dot: "busy",
			word: "Checking"
		})
		expect(
			statusLine(facts({ syncing: true, testing: true }))
		).toMatchObject({ dot: "busy", word: "Testing" })
	})
})

describe("nextStep — the one thing to do next, by the word on its control", () => {
	const step = (over: Partial<NextStepFacts> = {}) =>
		nextStep({
			...facts(),
			keyMissing: false,
			hasCredential: true,
			unsaved: false,
			servesChat: false,
			chat: null,
			...over
		})
	const LISTED = { modelsSync: { at: "2026-10-06", error: null }, modelCount: 503 }
	const FAILED = { modelsSync: { at: "2026-10-06", error: "401 Unauthorized" } }

	test("1 · a key is wanted: paste it, then Save — not Test, which clears nothing", () => {
		const s = step({ keyMissing: true, hasCredential: false, ...FAILED })
		expect(s).toMatchObject({
			state: "unfinished",
			action: "save",
			text: "Paste your API key below, then press Save."
		})
		expect(s!.parts).toContainEqual({ strong: "Save" })
	})

	test("2 · a dirty draft names the Save bar, whatever else is true", () => {
		for (const over of [
			{ keyMissing: true, hasCredential: false },
			{ ...FAILED },
			{ ...LISTED, servesChat: true },
			{ chat: { onThisConnection: true, modelName: "Nemo" } }
		])
			expect(step({ unsaved: true, ...over })).toMatchObject({
				state: "unfinished",
				action: "save",
				text: "Press Save to keep these changes."
			})
	})

	test("3 · a failure says what failed, then Test again; red only with a saved key", () => {
		expect(step({ ...FAILED, servesChat: true })).toMatchObject({
			state: "broken",
			action: "test",
			text: "401 Unauthorized. Check the key and press Test again."
		})
		expect(step({ ...FAILED, hasCredential: false })?.state).toBe("unfinished")
		// A failed test this visit is the newer failure, and keeps its own stop.
		expect(
			step({ lastTest: { ok: false, error: "ECONNREFUSED.", at: 1 } })?.text
		).toBe("ECONNREFUSED. Check the key and press Test again.")
	})

	test("3 · read off the status line: a passed test or a check in flight is no failure", () => {
		expect(
			step({ ...FAILED, lastTest: { ok: true, error: null, at: 999_000 } })
		).toBeNull()
		expect(step({ ...FAILED, syncing: true })).toBeNull()
		expect(step({ ...FAILED, testing: true })).toBeNull()
	})

	test("4 · it lists a chat model and chat is unset: Models, then Use in Reply", () => {
		const s = step({ ...LISTED, servesChat: true })
		expect(s).toMatchObject({
			state: "unfinished",
			action: "models",
			text: "Pick a model under Models and press Use in Reply."
		})
		expect(s!.parts).toEqual([
			"Pick a model under ",
			{ strong: "Models" },
			" and press ",
			{ strong: "Use in Reply" },
			"."
		])
	})

	test("5 · the chat default: which model replies, and Start a session", () => {
		expect(
			step({
				...LISTED,
				servesChat: true,
				chat: { onThisConnection: true, modelName: "Nemo" }
			})
		).toMatchObject({
			state: "ready",
			action: "session",
			text: "Replies come from Nemo."
		})
	})

	test("6 · otherwise nothing: chat set elsewhere, or nothing here chats", () => {
		expect(
			step({
				...LISTED,
				servesChat: true,
				chat: { onThisConnection: false, modelName: "Elsewhere" }
			})
		).toBeNull()
		expect(step({ ...LISTED })).toBeNull()
		expect(step()).toBeNull()
	})
})

describe("the Models tab's list", () => {
	test("the filter box appears past twelve models", () => {
		expect(showsModelsFilter(12)).toBe(false)
		expect(showsModelsFilter(13)).toBe(true)
	})

	test("the filter matches the identifier or the name", () => {
		const m = { model: "anthropic/claude-sonnet", name: "Claude Sonnet" }
		expect(modelMatchesQuery(m, "")).toBe(true)
		expect(modelMatchesQuery(m, "ANTHROPIC/")).toBe(true)
		expect(modelMatchesQuery(m, " sonnet ")).toBe(true)
		expect(modelMatchesQuery(m, "gpt")).toBe(false)
		expect(modelMatchesQuery({ model: "x", name: null }, "x")).toBe(true)
	})

	test("the chat default goes first; the rest keep the host's order", () => {
		const list = [{ id: 1 }, { id: 2 }, { id: 3 }]
		expect(chatDefaultFirst(list, 3).map((m) => m.id)).toEqual([3, 1, 2])
		expect(chatDefaultFirst(list, 1).map((m) => m.id)).toEqual([1, 2, 3])
		expect(chatDefaultFirst(list, null).map((m) => m.id)).toEqual([1, 2, 3])
		expect(chatDefaultFirst(list, 9).map((m) => m.id)).toEqual([1, 2, 3])
	})
})

test("modelsHeadline counts and names the missing", () => {
	expect(modelsHeadline({ modelCount: 1, missingCount: 0 })).toBe("1 model")
	expect(modelsHeadline({ modelCount: 12, missingCount: 2 })).toBe(
		"12 models · 2 no longer listed"
	)
})

describe("an API connection's tabs", () => {
	test("a listing API gets Models then Settings", () => {
		expect(apiConnectionTabs(CONNECTION_TYPE.ANTHROPIC).map((t) => t.value)).toEqual([
			"models",
			"settings"
		])
	})

	test("an API that names only its loaded model gets Settings alone", () => {
		expect(apiConnectionTabs(CONNECTION_TYPE.LLAMACPP).map((t) => t.value)).toEqual([
			"settings"
		])
	})

	test("one tab draws no strip; two do", () => {
		expect(showsTabStrip(apiConnectionTabs(CONNECTION_TYPE.LLAMACPP))).toBe(false)
		expect(showsTabStrip(apiConnectionTabs(CONNECTION_TYPE.OPENAI))).toBe(true)
	})

	test("a picked tab is kept while it exists", () => {
		const tabs = apiConnectionTabs(CONNECTION_TYPE.OPENAI)
		expect(activeApiTab(tabs, "settings", false)).toBe("settings")
	})

	test("an unfinished connection opens on Settings, where the key goes", () => {
		const tabs = apiConnectionTabs(CONNECTION_TYPE.OPENAI)
		expect(activeApiTab(tabs, null, true)).toBe("settings")
		// A finished one opens on its models.
		expect(activeApiTab(tabs, null, false)).toBe("models")
	})

	test("a remembered tab that no longer exists falls back, never to nothing", () => {
		const tabs = apiConnectionTabs(CONNECTION_TYPE.LLAMACPP)
		expect(activeApiTab(tabs, "models", false)).toBe("settings")
	})
})
