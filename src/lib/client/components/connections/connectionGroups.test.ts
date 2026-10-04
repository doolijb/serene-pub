import { describe, expect, test } from "vitest"
import {
	connectionGroupOf,
	defaultsForConnection,
	groupConnections
} from "./connectionGroups"

describe("connectionGroupOf", () => {
	test("a runtime this pub runs, or one you run yourself, is local", () => {
		expect(connectionGroupOf("koboldcpp_managed")).toBe("local")
		expect(connectionGroupOf("koboldcpp")).toBe("local")
		expect(connectionGroupOf("lmstudio")).toBe("local")
		expect(connectionGroupOf("llamacpp")).toBe("local")
		expect(connectionGroupOf("ollama")).toBe("local")
		expect(connectionGroupOf("local-onnx")).toBe("local")
		expect(connectionGroupOf("local-onnx-ner")).toBe("local")
	})

	test("a hosted API is a service", () => {
		expect(connectionGroupOf("openai")).toBe("service")
		expect(connectionGroupOf("anthropic")).toBe("service")
		expect(connectionGroupOf("openai-embeddings")).toBe("service")
	})
})

describe("groupConnections", () => {
	const rows = [
		{ id: 1, type: "openai" },
		{ id: 2, type: "ollama" },
		{ id: 3, type: "anthropic" },
		{ id: 4, type: "koboldcpp_managed" },
		{ id: 5, type: "koboldcpp" }
	]

	test("splits in two and keeps the groups' own order", () => {
		const groups = groupConnections(rows)
		expect(groups.map((g) => g.group.id)).toEqual(["local", "service"])
		expect(groups[0].rows.map((r) => r.id)).toEqual([2, 4, 5])
		expect(groups[1].rows.map((r) => r.id)).toEqual([1, 3])
	})

	test("names the trade once per header", () => {
		const groups = groupConnections(rows)
		expect(groups[0].group.trade).toBe("private · free")
		expect(groups[1].group.trade).toBe("billed per message")
	})

	test("drops an empty group rather than heading nothing", () => {
		const groups = groupConnections([{ id: 1, type: "openai" }])
		expect(groups).toHaveLength(1)
		expect(groups[0].group.id).toBe("service")
	})

	test("an empty list is no groups at all", () => {
		expect(groupConnections([])).toEqual([])
	})
})

describe("defaultsForConnection", () => {
	const label = (c: string) =>
		({
			"text->text": "Chat",
			"text->image": "Images",
			"text->embedding": "Embeddings",
			"text->entities": "Entities"
		})[c] ?? c

	test("names the capabilities this connection serves", () => {
		expect(
			defaultsForConnection(
				7,
				{
					"text->text": { connectionId: 7, connectionModelId: 1 },
					"text->image": { connectionId: 9, connectionModelId: 2 }
				},
				label
			)
		).toEqual(["Chat"])
	})

	test("sorts them, so two rows never disagree about order", () => {
		expect(
			defaultsForConnection(
				7,
				{
					"text->image": { connectionId: 7 },
					"text->text": { connectionId: 7 }
				},
				label,
				2
			)
		).toEqual(["Chat", "Images"])
	})

	test("caps at ONE by default, so the name always survives", () => {
		// An Anthropic row is the default for chat, vision and document reading
		// from the moment it is created; three chips pushed its title off a
		// 400px row entirely.
		expect(
			defaultsForConnection(
				7,
				{
					"text->text": { connectionId: 7 },
					"text->image": { connectionId: 7 },
					"text->embedding": { connectionId: 7 },
					"text->entities": { connectionId: 7 }
				},
				label
			)
		).toEqual(["Chat", "+3"])
	})

	test("is empty for a connection nothing points at, and for no defaults", () => {
		expect(defaultsForConnection(7, {}, label)).toEqual([])
		expect(defaultsForConnection(7, undefined, label)).toEqual([])
		expect(
			defaultsForConnection(
				7,
				{ "text->text": { connectionId: 8 } },
				label
			)
		).toEqual([])
	})

	test("a default naming only the endpoint still marks the row", () => {
		// The pair is incomplete and resolves as unconfigured elsewhere; the
		// question this mark answers is "is this one in use", and it is.
		expect(
			defaultsForConnection(
				7,
				{ "text->text": { connectionId: 7, connectionModelId: null } },
				label
			)
		).toEqual(["Chat"])
	})
})
