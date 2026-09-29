import { describe, expect, test } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	doneSentence,
	findKcppTextConnection,
	firstModelToRegister,
	runtimeReady,
	setupChatStep,
	type SetupChatFacts
} from "./setupChatFlow"

const kcpp = {
	id: 3,
	type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
	models: [] as { id: number; name: string; missingSince?: string | null }[]
}
const facts = (over: Partial<SetupChatFacts> = {}): SetupChatFacts => ({
	connection: kcpp,
	managedMode: "managed",
	hasBinary: true,
	chatDefault: null,
	...over
})

describe("setupChatStep — derived, never stored", () => {
	test("no connection, no mode, or no binary is the Runtime step", () => {
		expect(setupChatStep(facts({ connection: null }))).toBe("runtime")
		expect(setupChatStep(facts({ managedMode: null }))).toBe("runtime")
		expect(setupChatStep(facts({ hasBinary: false }))).toBe("runtime")
	})
	test("external mode counts as a runtime once chosen", () => {
		expect(
			runtimeReady(facts({ managedMode: "external", hasBinary: false }))
		).toBe(true)
	})
	test("a runtime with nothing on disk is the Model step; a model is Done", () => {
		expect(setupChatStep(facts())).toBe("model")
		expect(
			setupChatStep(
				facts({
					connection: { ...kcpp, models: [{ id: 9, name: "Nemo" }] }
				})
			)
		).toBe("done")
	})
	test("a model that went missing does not count", () => {
		expect(
			setupChatStep(
				facts({
					connection: {
						...kcpp,
						models: [
							{ id: 9, name: "Nemo", missingSince: "2026-09-18" }
						]
					}
				})
			)
		).toBe("model")
	})
})

describe("firstModelToRegister — the flow's one side effect", () => {
	const withModel = {
		...kcpp,
		models: [
			{ id: 9, name: "Nemo" },
			{ id: 10, name: "Gemma" }
		]
	}
	test("names the first present model only while nothing is set", () => {
		expect(firstModelToRegister(facts({ connection: withModel }))).toEqual({
			connectionId: 3,
			model: { id: 9, name: "Nemo" }
		})
	})
	test("a pub that already answers with something is never re-pointed", () => {
		expect(
			firstModelToRegister(
				facts({
					connection: withModel,
					chatDefault: { connectionId: 1, connectionModelId: 2 }
				})
			)
		).toBeNull()
	})
	test("nothing to register before a model lands", () => {
		expect(firstModelToRegister(facts())).toBeNull()
	})
	test("skips a model that cannot chat, or is switched off", () => {
		const mixed = {
			...kcpp,
			models: [
				{
					id: 7,
					name: "sdxl",
					satisfiableCapabilities: ["text->image"]
				},
				{ id: 8, name: "Off", enabled: false },
				{ id: 9, name: "Nemo", satisfiableCapabilities: ["text->text"] }
			]
		}
		expect(firstModelToRegister(facts({ connection: mixed }))).toEqual({
			connectionId: 3,
			model: { id: 9, name: "Nemo" }
		})
		expect(
			firstModelToRegister(
				facts({ connection: { ...kcpp, models: [mixed.models[0]] } })
			)
		).toBeNull()
	})
})

test("findKcppTextConnection ignores the image twin and hosts", () => {
	const rows = [
		{ id: 1, type: CONNECTION_TYPE.OPENAI },
		{ id: 2, type: CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE },
		{ id: 3, type: CONNECTION_TYPE.KOBOLDCPP_MANAGED }
	]
	expect(findKcppTextConnection(rows)?.id).toBe(3)
	expect(findKcppTextConnection(rows.slice(0, 2))).toBeNull()
})

test("doneSentence names what was registered", () => {
	expect(doneSentence(facts(), "Nemo")).toBe("Sessions reply with Nemo.")
	expect(
		doneSentence(
			facts({
				connection: { ...kcpp, models: [{ id: 9, name: "Nemo" }] },
				chatDefault: { connectionId: 1 }
			}),
			null
		)
	).toBe("A chat model is set — sessions can reply.")
})
