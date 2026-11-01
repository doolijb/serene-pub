import { describe, expect, test } from "vitest"
import { vi } from "vitest"
import { enableManager, managerPlan, uniqueName } from "./managers"
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

describe("audio.cpp, run by Serene Pub", () => {
	test("plans a create with its defaults and the audio.cpp event", () => {
		const plan = managerPlan("audiocpp", [])
		expect(plan.label).toBe("audio.cpp")
		expect(plan.settingsEvent).toBe("audiocpp:updateSettings")
		expect(plan.create).toMatchObject({
			name: "audio.cpp",
			type: CONNECTION_TYPE.AUDIOCPP_MANAGED,
			enabled: true,
			baseUrl: "http://127.0.0.1:5002"
		})
	})

	test("returns the row that is already there", () => {
		const plan = managerPlan("audiocpp", [
			{ id: 9, name: "audio.cpp", type: CONNECTION_TYPE.AUDIOCPP_MANAGED }
		])
		expect(plan.existingConnectionId).toBe(9)
	})

	test("enabling emits audiocpp:updateSettings { enabled: true }", () => {
		const emit = vi.fn()
		const { connectionId } = enableManager("audiocpp", { emit } as any, [])
		expect(connectionId).toBeNull()
		expect(emit).toHaveBeenCalledWith("audiocpp:updateSettings", {
			enabled: true
		})
		expect(emit.mock.calls[1][0]).toBe("connections:create")
	})
})
