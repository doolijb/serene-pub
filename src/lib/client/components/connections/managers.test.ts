import { describe, expect, test } from "vitest"
import { managerPlan, uniqueName } from "./managers"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

describe("uniqueName", () => {
	test("takes the plain name when nothing has it", () => {
		expect(uniqueName("KoboldCPP", ["Ollama"])).toBe("KoboldCPP")
	})

	test("numbers from 2, ignoring case and surrounding space", () => {
		expect(uniqueName("KoboldCPP", [" koboldcpp "])).toBe("KoboldCPP 2")
		expect(uniqueName("KoboldCPP", ["KoboldCPP", "KoboldCPP 2"])).toBe(
			"KoboldCPP 3"
		)
	})
})

describe("managerPlan", () => {
	test("returns the row that is already this manager's", () => {
		const plan = managerPlan("koboldcpp", [
			{
				id: 3,
				name: "KoboldCPP",
				type: CONNECTION_TYPE.KOBOLDCPP_MANAGED
			}
		])
		expect(plan.existingConnectionId).toBe(3)
		expect(plan.create).toBeUndefined()
		expect(plan.settingsEvent).toBe(
			"systemSettings:updateKoboldCppManagerEnabled"
		)
	})

	test("the image row is not the manager's connection — the text row is", () => {
		const plan = managerPlan("koboldcpp", [
			{
				id: 4,
				name: "KoboldCPP images",
				type: CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
			}
		])
		expect(plan.existingConnectionId).toBeNull()
		expect(plan.create?.type).toBe(CONNECTION_TYPE.KOBOLDCPP_MANAGED)
	})

	test("a create carries the type's defaults and a name nothing has taken", () => {
		const plan = managerPlan("ollama", [
			{ id: 1, name: "Ollama", type: CONNECTION_TYPE.OPENAI }
		])
		expect(plan.settingsEvent).toBe(
			"systemSettings:updateOllamaManagerEnabled"
		)
		expect(plan.create).toMatchObject({
			name: "Ollama 2",
			type: CONNECTION_TYPE.OLLAMA,
			enabled: true,
			baseUrl: "http://localhost:11434/"
		})
	})
})
