/**
 * The action identity (U5c review, W1/W3/S3): `<spec slug>#<key>`, the one
 * string every keying reads — the seen set, the enablement row, the fire,
 * and a list's `{#each}` key.
 */
import { describe, expect, it } from "vitest"
import {
	ACTION_IDENTITY_MAX_LENGTH,
	actionIdentity,
	isCoreActionIdentity,
	parseActionIdentity
} from "./identity"

describe("actionIdentity", () => {
	it("keys two actions on one function apart — the {#each} key the chips and the Menu share (W3)", () => {
		// The composer used to key chips by `specSlug + function`, so a plugin
		// declaring a second action on `summarize` beside core's rendered a
		// duplicate-key error. Two actions on one function are two keys.
		const core = { specSlug: "core:spec/summarize", key: "summarize" }
		const plugin = { specSlug: "acme:spec/sum", key: "summarize" }
		const twoInOneSpec = { specSlug: "acme:spec/sum", key: "summarize-short" }
		const keys = [core, plugin, twoInOneSpec].map(actionIdentity)
		expect(new Set(keys).size).toBe(3)
		expect(keys).toEqual([
			"core:spec/summarize#summarize",
			"acme:spec/sum#summarize",
			"acme:spec/sum#summarize-short"
		])
	})

	it("names core's verbs under `core`", () => {
		expect(actionIdentity({ specSlug: "core", key: "edit" })).toBe("core#edit")
		expect(isCoreActionIdentity("core#edit")).toBe(true)
		expect(isCoreActionIdentity("core:spec/chat-narrate#narrate")).toBe(false)
	})
})

describe("parseActionIdentity", () => {
	it("takes a well-formed identity apart at its last '#'", () => {
		expect(parseActionIdentity("core:spec/chat-narrate#narrate")).toEqual({
			specSlug: "core:spec/chat-narrate",
			key: "narrate"
		})
		expect(parseActionIdentity("acme:spec/roll#roll-again")).toEqual({
			specSlug: "acme:spec/roll",
			key: "roll-again"
		})
		expect(parseActionIdentity("core#edit")).toEqual({ specSlug: "core", key: "edit" })
	})

	it("refuses anything that is not one — the shape sessions:actionsSeen stores (S3)", () => {
		for (const bad of [
			"",
			"narrate",
			"#narrate",
			"core:spec/chat-narrate#",
			"Core:spec/narrate#narrate",
			"core:spec/chat-narrate#Narrate",
			"core:spec/chat-narrate#nar rate",
			"core:spec/chat-narrate#nar#rate",
			"<script>#x",
			`${"a".repeat(ACTION_IDENTITY_MAX_LENGTH)}#k`,
			42,
			null,
			undefined
		])
			expect(parseActionIdentity(bad), String(bad)).toBeNull()
	})
})
