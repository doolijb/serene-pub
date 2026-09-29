import { describe, expect, it } from "vitest"
import {
	connectionDeletion,
	defaultsHeldBy,
	managerFlagsReleased,
	modalityWord
} from "./connectionsAdmin"

const kcpp = {
	id: 1,
	name: "KoboldCPP",
	type: "koboldcpp_managed",
	models: [
		{ id: 10, name: "Mistral", model: "mistral.gguf" },
		{ id: 11, name: null, model: "sdxl.safetensors" }
	]
}
const claude = { id: 2, name: "Claude", type: "anthropic", models: [] }
const ollamaA = { id: 3, name: "Ollama", type: "ollama", models: [] }
const ollamaB = { id: 4, name: "Ollama 2", type: "ollama", models: [] }

const defaults = {
	"text->text": { connectionId: 1, connectionModelId: 10 },
	"text->image": { connectionId: 1, connectionModelId: 11 },
	"text->embedding": { connectionId: 9, connectionModelId: 1 }
}

describe("defaultsHeldBy", () => {
	it("names each default this connection holds, with its model", () => {
		const held = defaultsHeldBy(kcpp, defaults)
		expect(held.map((h) => h.capability).sort()).toEqual(["text->image", "text->text"])
		expect(held.find((h) => h.capability === "text->text")?.modelName).toBe("Mistral")
		expect(held.find((h) => h.capability === "text->image")?.modelName).toBe(
			"sdxl.safetensors"
		)
	})
	it("is empty for a connection that holds none", () => {
		expect(defaultsHeldBy(claude, defaults)).toEqual([])
	})
})

describe("connectionDeletion", () => {
	it("lists the models and released defaults under each connection", () => {
		const d = connectionDeletion([kcpp, claude], defaults)
		expect(d.title).toBe("Delete 2 connections?")
		expect(d.confirmLabel).toBe("Delete 2 connections")
		expect(d.summary).toMatch(/2 defaults go unset/)
		expect(d.objects[0].related?.map((r) => r.label)).toEqual([
			"2 models",
			"Default released for"
		])
		expect(d.objects[1].related).toEqual([])
	})
	it("names a single connection", () => {
		const d = connectionDeletion([claude], defaults)
		expect(d.title).toBe("Delete Claude?")
		expect(d.summary).toBe("This cannot be undone.")
	})
})

describe("managerFlagsReleased", () => {
	const rows = [kcpp, claude, ollamaA, ollamaB]
	it("turns KoboldCPP off with its managed row", () => {
		expect(managerFlagsReleased([1], rows)).toEqual([
			"systemSettings:updateKoboldCppManagerEnabled"
		])
	})
	it("turns Ollama off only with the last Ollama connection", () => {
		expect(managerFlagsReleased([3], rows)).toEqual([])
		expect(managerFlagsReleased([3, 4], rows)).toEqual([
			"systemSettings:updateOllamaManagerEnabled"
		])
	})
	it("leaves both alone for an ordinary connection", () => {
		expect(managerFlagsReleased([2], rows)).toEqual([])
	})
})

describe("modalityWord", () => {
	it("uses the short word, falling back to the id", () => {
		expect(modalityWord("text-gen")).toBe("Text")
		expect(modalityWord("audio")).toBe("audio")
		expect(modalityWord(null)).toBe("—")
	})
})
