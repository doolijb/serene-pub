import { describe, expect, it } from "vitest"
import {
	annexEditsAsText,
	annexFieldActionOf,
	annexAudienceWords,
	annexSettersWords,
	annexShapeWords,
	annexShapeHoldsSecret,
	annexValuePreview
} from "./annexInspect"

describe("annexAudienceWords — who can see a value, in plain words", () => {
	it("an empty audience is pipelines only", () => {
		expect(annexAudienceWords([])).toBe("Pipelines only")
	})
	it("each role alone", () => {
		expect(annexAudienceWords(["participant"])).toBe("Everyone in the session, and the AI")
		expect(annexAudienceWords(["person"])).toBe("Every person in the session")
		expect(annexAudienceWords(["ai"])).toBe("Only the AI")
		expect(annexAudienceWords(["owner"])).toBe("The session owner")
		expect(annexAudienceWords(["admin"])).toBe("Administrators")
	})
	it("an id-shaped reference", () => {
		expect(annexAudienceWords(["user:12"])).toBe("User 12")
		expect(annexAudienceWords(["character:7"])).toBe("Whoever plays character 7")
		expect(annexAudienceWords(["envoy:mascot"])).toBe("Whoever plays the mascot envoy")
	})
	it("several references join into one sentence-case phrase", () => {
		expect(annexAudienceWords(["owner", "ai"])).toBe("The session owner and the AI")
		expect(annexAudienceWords(["owner", "person", "ai"])).toBe(
			"The session owner, every person in the session and the AI"
		)
	})
	it("a duplicate or an unreadable reference does not garble the phrase", () => {
		expect(annexAudienceWords(["owner", "owner"])).toBe("The session owner")
		expect(annexAudienceWords([" ai "])).toBe("Only the AI")
		expect(annexAudienceWords(["???"])).toBe("???")
	})
})

describe("annexSettersWords — who can change a value", () => {
	it("no act list is pipelines only", () => {
		expect(annexSettersWords(undefined)).toBe("Pipelines only")
		expect(annexSettersWords(null)).toBe("Pipelines only")
		expect(annexSettersWords([])).toBe("Pipelines only")
	})
	it("`participant` in an act list is every member — the AI cannot press", () => {
		expect(annexSettersWords(["participant"])).toBe("Everyone in the session")
		expect(annexSettersWords(["owner"])).toBe("The session owner")
		expect(annexSettersWords(["owner", "user:3"])).toBe("The session owner and user 3")
	})
})

describe("annexShapeWords — a declared shape, briefly", () => {
	it("names the type and its bounds", () => {
		expect(annexShapeWords({ type: "integer", min: 1, max: 20 })).toBe("Whole number, 1 to 20")
		expect(annexShapeWords({ type: "boolean" })).toBe("Yes or no")
		expect(annexShapeWords({ type: "string" })).toBe("Text")
		expect(annexShapeWords({ type: "list", item: { type: "integer" } })).toBe("List of whole number")
		expect(annexShapeWords({ type: "object", fields: { a: { type: "string" } } })).toBe("Object (a)")
		expect(annexShapeWords({ type: "enum", of: ["a", "b"] })).toBe("One of: a, b")
		expect(annexShapeWords(undefined)).toBe("Any JSON")
	})
})

describe("annexShapeHoldsSecret", () => {
	it("finds a secret at any depth", () => {
		expect(annexShapeHoldsSecret({ type: "secret" })).toBe(true)
		expect(annexShapeHoldsSecret({ type: "list", item: { type: "secret" } })).toBe(true)
		expect(annexShapeHoldsSecret({ type: "object", fields: { k: { type: "secret" } } })).toBe(true)
		expect(annexShapeHoldsSecret({ type: "integer" })).toBe(false)
		expect(annexShapeHoldsSecret(undefined)).toBe(false)
	})
})

describe("annexValuePreview — pretty JSON, truncated", () => {
	it("pretty-prints and says when it cut", () => {
		expect(annexValuePreview(17)).toEqual({ text: "17", truncated: false })
		const long = annexValuePreview({ a: "x".repeat(400) }, 50)
		expect(long.truncated).toBe(true)
		expect(long.text.length).toBeLessThanOrEqual(51)
		expect(annexValuePreview({ a: 1 }).text).toBe('{\n  "a": 1\n}')
	})
})

describe("annexEditsAsText — which values Session data edits in place (lair re-plan R13)", () => {
	it("a settable text field is editable: the Castellan's scratchpad", () => {
		expect(
			annexEditsAsText({ act: ["owner"], shape: { type: "text", default: "" } as never })
		).toBe(true)
		expect(annexEditsAsText({ act: ["participant"], shape: { type: "string" } as never })).toBe(
			true
		)
	})
	it("pipelines-only, non-text or withheld is not", () => {
		expect(annexEditsAsText({ act: null, shape: { type: "text" } as never })).toBe(false)
		expect(annexEditsAsText({ act: [], shape: { type: "text" } as never })).toBe(false)
		expect(annexEditsAsText({ act: ["owner"], shape: { type: "boolean" } as never })).toBe(false)
		expect(
			annexEditsAsText({ act: ["owner"], shape: { type: "text" } as never, withheld: true })
		).toBe(false)
	})
	it("the press names the field's ready-made action", () => {
		expect(annexFieldActionOf("core", "castellan-scratchpad")).toBe(
			"core:annex#castellan-scratchpad"
		)
	})
})
