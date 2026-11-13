import { describe, expect, test } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	doneHeading,
	doneSentence,
	findKcppTextConnection,
	registeredChatDefault,
	replyFilled,
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

test("findKcppTextConnection ignores the image twin and hosts", () => {
	const rows = [
		{ id: 1, type: CONNECTION_TYPE.OPENAI },
		{ id: 2, type: CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE },
		{ id: 3, type: CONNECTION_TYPE.KOBOLDCPP_MANAGED }
	]
	expect(findKcppTextConnection(rows)?.id).toBe(3)
	expect(findKcppTextConnection(rows.slice(0, 2))).toBeNull()
})

describe("doneSentence and doneHeading — read from server state only", () => {
	const withNemo = { ...kcpp, models: [{ id: 9, name: "Nemo" }] }
	test("Reply on a listed model names it", () => {
		const f = facts({
			connection: withNemo,
			chatDefault: { connectionId: 3, connectionModelId: 9 }
		})
		expect(doneSentence(f)).toBe("Nemo is now in the Reply loadout.")
		expect(replyFilled(f)).toBe(true)
		expect(doneHeading(f)).toBe("Chat is set up")
	})
	test("Reply set to something not in this list is filled, unnamed", () => {
		const f = facts({
			connection: withNemo,
			chatDefault: { connectionId: 1, connectionModelId: 2 }
		})
		expect(doneSentence(f)).toBe(
			"The Reply loadout is filled — sessions can reply."
		)
		expect(doneHeading(f)).toBe("Chat is set up")
	})
	test("no Reply pair says so and points at Use in Reply", () => {
		const f = facts({ connection: withNemo })
		expect(doneSentence(f)).toBe(
			"The Reply loadout is still empty. Open KoboldCPP and press Use in Reply on a model."
		)
		expect(replyFilled(f)).toBe(false)
		expect(doneHeading(f)).toBe("KoboldCPP is ready")
	})
})

describe("registeredChatDefault — a designated loadout is not a registered model", () => {
	test("a fresh pub's empty Reply slots count as nothing registered", () => {
		expect(
			registeredChatDefault({ connectionId: null, connectionModelId: null })
		).toBeNull()
		expect(registeredChatDefault(undefined)).toBeNull()
		expect(registeredChatDefault(null)).toBeNull()
	})
	test("a filled slot is the pair", () => {
		expect(
			registeredChatDefault({ connectionId: 1, connectionModelId: 2 })
		).toEqual({ connectionId: 1, connectionModelId: 2 })
	})
})
