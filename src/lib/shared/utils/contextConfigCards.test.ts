import { describe, expect, test } from "vitest"
import {
	parseContextTemplate,
	reorderContextCards,
	CUSTOM_TEXT_OPEN_MARKER,
	CUSTOM_TEXT_CLOSE_MARKER
} from "./contextConfigCards"

function customText(body: string): string {
	return `{{!-- ${CUSTOM_TEXT_OPEN_MARKER} --}}\n${body}\n{{!-- ${CUSTOM_TEXT_CLOSE_MARKER} --}}`
}

// The actual seeded "Default" context config template
// (src/lib/server/db/defaults.ts) — nine system-message cards separated by
// blank lines, mirroring what a real drag-and-drop session reorders.
const DEFAULT_TEMPLATE = `{{#systemBlock}}
{{#if currentDate}}
The current date in the story is {{{currentDate}}}.
{{/if}}

{{#if instructions}}
Instructions:
"""
{{{instructions}}}
"""
{{/if}}

{{#if characters}}
Assistant Characters (AI-controlled):
\`\`\`json
{{{characters}}}
\`\`\`
{{/if}}

{{#if personas}}
User Characters (player-controlled):
\`\`\`json
{{{personas}}}
\`\`\`
{{/if}}

{{#if scenario}}
Scenario:
"""
{{{scenario}}}
"""
{{/if}}

{{#if worldLore}}
World lore:
\`\`\`json
{{{worldLore}}}
\`\`\`
{{/if}}

{{#if history}}
Story history:
\`\`\`json
{{{history}}}
\`\`\`
{{/if}}

{{#if narrativeGraph}}
Story relationships:
\`\`\`json
{{{narrativeGraph}}}
\`\`\`
{{/if}}

{{#if exampleDialogue}}
Example dialogue:
"""
{{{exampleDialogue}}}
"""
{{/if}}
{{/systemBlock}}

{{#each chatMessages}}
{{#if (eq role "assistant")}}
{{#assistantBlock}}
{{{name}}}: {{{message}}}
{{/assistantBlock}}
{{/if}}
{{#if (eq role "user")}}
{{#userBlock}}
{{{name}}}: {{{message}}}
{{/userBlock}}
{{/if}}
{{/each}}

{{#if postHistoryInstructions}}
{{#systemBlock}}
{{{postHistoryInstructions}}}
{{/systemBlock}}
{{/if}}`

/** Simulates one drag: move the card at fromIdx to toIdx, then splice + re-parse, as ContextSidebar does. */
function simulateDrag(template: string, fromIdx: number, toIdx: number) {
	const zoneCardsBefore = parseContextTemplate(template)
		.cards.filter((c) => c.zone === "systemMessage")
		.sort((a, b) => a.start - b.start)
	const keysBefore = zoneCardsBefore.map((c) => c.key)

	const newOrder = [...keysBefore]
	const [moved] = newOrder.splice(fromIdx, 1)
	newOrder.splice(toIdx, 0, moved)

	const newTemplate = reorderContextCards(template, "systemMessage", newOrder)
	const parsedAfter = parseContextTemplate(newTemplate)
	const zoneCardsAfter = parsedAfter.cards
		.filter((c) => c.zone === "systemMessage")
		.sort((a, b) => a.start - b.start)

	return {
		keysBefore,
		keysAfter: zoneCardsAfter.map((c) => c.key),
		newTemplate,
		parseError: parsedAfter.parseError
	}
}

describe("realistic default-template drag simulation", () => {
	test("every adjacent swap across the whole default template preserves the exact key set", () => {
		const cardCount = parseContextTemplate(DEFAULT_TEMPLATE).cards.filter(
			(c) => c.zone === "systemMessage"
		).length
		for (let i = 0; i < cardCount - 1; i++) {
			const { keysBefore, keysAfter, parseError } = simulateDrag(
				DEFAULT_TEMPLATE,
				i,
				i + 1
			)
			expect(
				parseError,
				`parse error after swap ${i}<->${i + 1}`
			).toBeNull()
			expect(
				new Set(keysAfter),
				`key set changed after swap ${i}<->${i + 1}`
			).toEqual(new Set(keysBefore))
			expect(keysAfter).toHaveLength(keysBefore.length)
		}
	})

	test("moving the first card to the very end preserves every key", () => {
		const { keysBefore, keysAfter, parseError } = simulateDrag(
			DEFAULT_TEMPLATE,
			0,
			8
		)
		expect(parseError).toBeNull()
		expect(new Set(keysAfter)).toEqual(new Set(keysBefore))
	})

	test("moving the last card to the very front preserves every key", () => {
		const { keysBefore, keysAfter, parseError } = simulateDrag(
			DEFAULT_TEMPLATE,
			8,
			0
		)
		expect(parseError).toBeNull()
		expect(new Set(keysAfter)).toEqual(new Set(keysBefore))
	})

	test("a second drag, applied via keys freshly re-parsed from the first drag's result, still works", () => {
		const first = simulateDrag(DEFAULT_TEMPLATE, 0, 1)
		expect(first.parseError).toBeNull()
		const second = simulateDrag(first.newTemplate, 2, 5)
		expect(second.parseError).toBeNull()
		expect(new Set(second.keysAfter)).toEqual(new Set(second.keysBefore))
	})
})

describe("parseContextTemplate key stability", () => {
	test("two same-typed cards keep distinct keys derived from their own content", () => {
		const template = `{{#systemBlock}}\n${customText("first")}\n\n${customText("second")}\n{{/systemBlock}}`
		const cards = parseContextTemplate(template).cards.filter(
			(c) => c.typeId === "customText"
		)
		expect(cards).toHaveLength(2)
		expect(cards[0].key).not.toBe(cards[1].key)
	})

	test("a card's key is unchanged by re-parsing the same content at a different position", () => {
		const before = `{{#systemBlock}}\n${customText("alpha")}\n\n${customText("beta")}\n{{/systemBlock}}`
		const after = `{{#systemBlock}}\n${customText("beta")}\n\n${customText("alpha")}\n{{/systemBlock}}`

		const beforeCards = parseContextTemplate(before).cards.filter(
			(c) => c.typeId === "customText"
		)
		const afterCards = parseContextTemplate(after).cards.filter(
			(c) => c.typeId === "customText"
		)

		const alphaKeyBefore = beforeCards.find(
			(c) => c.content === "alpha"
		)!.key
		const betaKeyBefore = beforeCards.find((c) => c.content === "beta")!.key
		const alphaKeyAfter = afterCards.find((c) => c.content === "alpha")!.key
		const betaKeyAfter = afterCards.find((c) => c.content === "beta")!.key

		// This is the exact bug: occurrence-based keys used to renumber by
		// scan position, so "the card with content X" got a different key
		// once something else moved in front of it.
		expect(alphaKeyAfter).toBe(alphaKeyBefore)
		expect(betaKeyAfter).toBe(betaKeyBefore)
	})

	test("cards with byte-identical content still get distinct, non-colliding keys", () => {
		const template = `{{#systemBlock}}\n${customText("same")}\n\n${customText("same")}\n{{/systemBlock}}`
		const cards = parseContextTemplate(template).cards.filter(
			(c) => c.typeId === "customText"
		)
		expect(cards).toHaveLength(2)
		expect(cards[0].key).not.toBe(cards[1].key)
		expect(new Set(cards.map((c) => c.key)).size).toBe(2)
	})
})

describe("reorderContextCards", () => {
	test("swapping two cards' order preserves each card's own content", () => {
		const template = `{{#systemBlock}}\n${customText("alpha")}\n\n${customText("beta")}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const zoneCards = parsed.cards
			.filter((c) => c.zone === "systemMessage")
			.sort((a, b) => a.start - b.start)
		const [alpha, beta] = zoneCards

		const reordered = reorderContextCards(template, "systemMessage", [
			beta.key,
			alpha.key
		])

		const reparsed = parseContextTemplate(reordered).cards.filter(
			(c) => c.zone === "systemMessage"
		)
		expect(reparsed.map((c) => c.content)).toEqual(["beta", "alpha"])
	})

	test("reordering keeps the same stable keys after a re-parse (round-trip identity)", () => {
		const template = `{{#systemBlock}}\n${customText("alpha")}\n\n${customText("beta")}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const zoneCards = parsed.cards
			.filter((c) => c.zone === "systemMessage")
			.sort((a, b) => a.start - b.start)
		const [alpha, beta] = zoneCards

		const reordered = reorderContextCards(template, "systemMessage", [
			beta.key,
			alpha.key
		])
		const reparsed = parseContextTemplate(reordered).cards.filter(
			(c) => c.zone === "systemMessage"
		)

		// Same logical cards, just swapped — a dndzone-style keyed list
		// must see the same two ids it started with, not two new ones.
		expect(new Set(reparsed.map((c) => c.key))).toEqual(
			new Set([alpha.key, beta.key])
		)
	})

	test("a gap of hand-written text stays attached to the card it followed, not to a position", () => {
		const template =
			`{{#systemBlock}}\n${customText("alpha")}` +
			`\n\n<!-- a note about alpha -->\n\n` +
			`${customText("beta")}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const zoneCards = parsed.cards
			.filter((c) => c.zone === "systemMessage")
			.sort((a, b) => a.start - b.start)
		const [alpha, beta] = zoneCards

		const reordered = reorderContextCards(template, "systemMessage", [
			beta.key,
			alpha.key
		])

		// The note was written after alpha — it must still immediately
		// follow alpha's text, now that alpha is second, not sit between
		// beta and alpha's new (first/second) positions arbitrarily.
		const alphaText = template.slice(alpha.start, alpha.end)
		const idx = reordered.indexOf(alphaText)
		expect(idx).toBeGreaterThan(-1)
		expect(reordered.slice(idx, idx + alphaText.length + 40)).toContain(
			"a note about alpha"
		)
	})

	test("returns the template unchanged when the key set doesn't match (stale/mismatched reorder request)", () => {
		const template = `{{#systemBlock}}\n${customText("alpha")}\n{{/systemBlock}}`
		const result = reorderContextCards(template, "systemMessage", [
			"customText:doesnotexist"
		])
		expect(result).toBe(template)
	})

	test("no-op reorder (same order) returns byte-identical template", () => {
		const template = `{{#systemBlock}}\n${customText("alpha")}\n\n${customText("beta")}\n{{/systemBlock}}`
		const zoneCards = parseContextTemplate(template)
			.cards.filter((c) => c.zone === "systemMessage")
			.sort((a, b) => a.start - b.start)

		const result = reorderContextCards(
			template,
			"systemMessage",
			zoneCards.map((c) => c.key)
		)
		expect(result).toBe(template)
	})
})
