import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import {
	_resetTemplateVariableLayoutsForTests,
	requestTemplateVariableLayouts,
	templateVariableLayoutsOf
} from "./templateVariableLayouts.svelte"

type Listener = (payload: any) => void
function makeClientSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		id: "tab-a",
		emits: [] as Array<{ event: string; payload: any }>,
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event) ?? []
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
		},
		emit(event: string, payload: any) {
			this.emits.push({ event, payload })
		},
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		}
	}
}

const A = { specSlug: "adventure", stepKey: "694ff0a079d37191" }
const key = (k: string) => ({
	key: k,
	variableId: `core:var/${k}@1`,
	variableLabel: k,
	inUse: null,
	offers: []
})

let client: ReturnType<typeof makeClientSocket>
beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: true })
})
afterEach(() => {
	_resetTemplateVariableLayoutsForTests()
	_resetInterestForTests()
	setSocket(null)
})

const T = { nodeType: "context" }
const echoA = { specSlug: "adventure", stepKey: "694ff0a079d37191" }
const echoT = { nodeType: "context" }

describe("template variable layouts store", () => {
	test("two targets in flight at once, answers in reverse order: each gets its own keys; a repeat asks nothing", () => {
		requestTemplateVariableLayouts(T)
		requestTemplateVariableLayouts(A)
		requestTemplateVariableLayouts(A) // deduped: already in flight
		requestTemplateVariableLayouts(T) // deduped: already in flight
		const asked = client.emits
			.filter((e) => e.event === "pipelines:templateVariableLayouts")
			.map((e) => e.payload)
		expect(asked).toEqual([T, A])

		client.dispatch("pipelines:templateVariableLayouts", {
			...echoA,
			keys: [key("history")]
		})
		client.dispatch("pipelines:templateVariableLayouts", {
			...echoT,
			keys: [key("characters")]
		})

		expect(templateVariableLayoutsOf(A)?.keys?.map((k) => k.key)).toEqual([
			"history"
		])
		expect(templateVariableLayoutsOf(T)?.keys?.map((k) => k.key)).toEqual([
			"characters"
		])
	})

	test("an :error lands only on the target it echoes", () => {
		requestTemplateVariableLayouts(A)
		requestTemplateVariableLayouts(T)
		client.dispatch("pipelines:templateVariableLayouts:error", {
			...echoA,
			error: "No such step."
		})
		expect(templateVariableLayoutsOf(A)).toEqual({ error: "No such step." })
		expect(templateVariableLayoutsOf(T)).toBeUndefined()
	})

	test("a stray answer, or one echoing nothing of ours, is ignored", () => {
		client.dispatch("pipelines:templateVariableLayouts", {
			...echoA,
			keys: [key("history")]
		})
		expect(templateVariableLayoutsOf(A)).toBeUndefined()
		requestTemplateVariableLayouts(A)
		client.dispatch("pipelines:templateVariableLayouts", {
			keys: [key("no-echo")]
		})
		client.dispatch("pipelines:templateVariableLayouts", {
			specSlug: "adventure",
			stepKey: "b3c1e5d27a90f4ee",
			keys: [key("other")]
		})
		expect(templateVariableLayoutsOf(A)).toBeUndefined()
		client.dispatch("pipelines:templateVariableLayouts", {
			...echoA,
			keys: [key("history")]
		})
		client.dispatch("pipelines:templateVariableLayouts", {
			...echoA,
			keys: [key("stray")]
		})
		expect(templateVariableLayoutsOf(A)?.keys?.map((k) => k.key)).toEqual([
			"history"
		])
	})
})
