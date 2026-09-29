import { describe, expect, test } from "vitest"
import {
	parseContextTemplate,
	lintContextTemplate,
	type Card,
	type BlockCard
} from "./contextConfigCards"

// The actual seeded "Default" context config template
// (src/lib/server/db/defaults.ts) — including the nested
// each(as |a b|) > with(../postHistory) > if(and(eq,hasContent)) chain that
// the OLD fixed-catalog parser couldn't represent at all.
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

{{/systemBlock}}

{{#each sessionMessages as |sessionMessage msgIndex|}}
{{#with ../postHistory}}
{{#if (and (eq msgIndex targetIndex) hasContent)}}
{{#systemBlock}}
{{#if instructions}}
Response reminder:
\`\`\`text
{{{instructions}}}
\`\`\`
{{/if}}
{{#if charInstructions}}
Character reminder:
\`\`\`text
{{{charInstructions}}}
\`\`\`
{{/if}}
{{#if exampleDialogue}}
Example dialogue:
\`\`\`text
{{{exampleDialogue}}}
\`\`\`
{{/if}}
{{/systemBlock}}
{{/if}}
{{/with}}
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
{{/each}}`

function block(card: Card): BlockCard {
	if (card.kind !== "block")
		throw new Error(`expected block, got ${card.kind}`)
	return card
}

describe("parseContextTemplate — real Default template", () => {
	test("parses without error", () => {
		const parsed = parseContextTemplate(DEFAULT_TEMPLATE)
		expect(parsed.parseError).toBeNull()
	})

	test("root level has the outer systemBlock and the sessionMessages each-loop as block cards", () => {
		const parsed = parseContextTemplate(DEFAULT_TEMPLATE)
		const rootBlocks = parsed.cards.filter(
			(c) => c.kind === "block"
		) as BlockCard[]
		expect(rootBlocks.map((c) => c.helperName)).toEqual([
			"systemBlock",
			"each"
		])
		expect(rootBlocks[1].tagSource).toBe(
			"sessionMessages as |sessionMessage msgIndex|"
		)
		expect(rootBlocks[1].isRoleWrapper).toBe(false)
		expect(rootBlocks[0].isRoleWrapper).toBe(true)
	})

	test("the systemBlock's children include every {{#if field}} as its own block card with the field exposed as tagSource", () => {
		const parsed = parseContextTemplate(DEFAULT_TEMPLATE)
		const systemBlock = block(
			parsed.cards.find(
				(c) => c.kind === "block" && c.helperName === "systemBlock"
			)!
		)
		const ifCards = systemBlock.children.filter(
			(c): c is BlockCard => c.kind === "block" && c.helperName === "if"
		)
		expect(ifCards.map((c) => c.tagSource)).toEqual([
			"currentDate",
			"instructions",
			"characters",
			"personas",
			"scenario",
			"worldLore",
			"history",
			"narrativeGraph"
		])
	})

	test("the previously-invisible each > with > if(and(eq,hasContent)) chain is now fully represented", () => {
		const parsed = parseContextTemplate(DEFAULT_TEMPLATE)
		const eachCard = block(
			parsed.cards.find(
				(c) => c.kind === "block" && c.helperName === "each"
			)!
		)
		const withCard = block(
			eachCard.children.find(
				(c) => c.kind === "block" && c.helperName === "with"
			)!
		)
		expect(withCard.tagSource).toBe("../postHistory")

		const ifCard = block(
			withCard.children.find(
				(c) => c.kind === "block" && c.helperName === "if"
			)!
		)
		expect(ifCard.tagSource).toBe(
			"(and (eq msgIndex targetIndex) hasContent)"
		)

		const nestedSystemBlock = block(
			ifCard.children.find(
				(c) => c.kind === "block" && c.helperName === "systemBlock"
			)!
		)
		const nestedIfs = nestedSystemBlock.children.filter(
			(c): c is BlockCard => c.kind === "block" && c.helperName === "if"
		)
		expect(nestedIfs.map((c) => c.tagSource)).toEqual([
			"instructions",
			"charInstructions",
			"exampleDialogue"
		])
	})

	test("{{{name}}}: {{{message}}} stays one text card, not fragmented into separate variable cards", () => {
		const parsed = parseContextTemplate(DEFAULT_TEMPLATE)
		const eachCard = block(
			parsed.cards.find(
				(c) => c.kind === "block" && c.helperName === "each"
			)!
		)
		const assistantIf = block(
			eachCard.children.find(
				(c) =>
					c.kind === "block" &&
					c.helperName === "if" &&
					c.tagSource.includes("assistant")
			)!
		)
		const assistantBlockCard = block(
			assistantIf.children.find(
				(c) => c.kind === "block" && c.helperName === "assistantBlock"
			)!
		)
		expect(assistantBlockCard.children).toHaveLength(1)
		expect(assistantBlockCard.children[0].kind).toBe("text")
		expect((assistantBlockCard.children[0] as any).content).toContain(
			"{{{name}}}: {{{message}}}"
		)
	})

	test("a standalone {{{worldLore}}} is its own variable card, separate from the surrounding label/fence text", () => {
		const parsed = parseContextTemplate(DEFAULT_TEMPLATE)
		const systemBlock = block(
			parsed.cards.find(
				(c) => c.kind === "block" && c.helperName === "systemBlock"
			)!
		)
		const worldLoreIf = block(
			systemBlock.children.find(
				(c) =>
					c.kind === "block" &&
					c.helperName === "if" &&
					c.tagSource === "worldLore"
			)!
		)
		const kinds = worldLoreIf.children.map((c) => c.kind)
		expect(kinds).toEqual(["text", "variable", "text"])
		expect((worldLoreIf.children[1] as any).expressionSource).toBe(
			"worldLore"
		)
		expect((worldLoreIf.children[1] as any).escaped).toBe(false)
	})

	test("round-trip: re-slicing every card's own [start,end) reconstructs the exact original template", () => {
		const parsed = parseContextTemplate(DEFAULT_TEMPLATE)
		function collectAll(cards: Card[]): Card[] {
			return cards.flatMap((c) =>
				c.kind === "block"
					? [
							c,
							...collectAll(c.children),
							...(c.elseChildren
								? collectAll(c.elseChildren)
								: [])
						]
					: [c]
			)
		}
		// Every top-level root card's slice, concatenated with the gaps
		// between them, must reconstruct the original byte-for-byte -- i.e.
		// no source text is silently dropped or duplicated by the parse.
		const sorted = [...parsed.cards].sort((a, b) => a.start - b.start)
		expect(sorted[0].start).toBe(0)
		expect(sorted[sorted.length - 1].end).toBe(DEFAULT_TEMPLATE.length)
		for (let i = 0; i < sorted.length - 1; i++) {
			expect(sorted[i].end).toBeLessThanOrEqual(sorted[i + 1].start)
		}
	})
})

describe("standalone vs inline mustache classification", () => {
	test("a mustache alone on its own line becomes a variable card", () => {
		const parsed = parseContextTemplate(`{{#if x}}\n{{{x}}}\n{{/if}}`)
		const ifCard = block(parsed.cards[0])
		expect(ifCard.children.map((c) => c.kind)).toEqual(["variable"])
	})

	test("two mustaches sharing one line merge into a single text card", () => {
		const parsed = parseContextTemplate(
			`{{#if x}}\n{{{a}}}: {{{b}}}\n{{/if}}`
		)
		const ifCard = block(parsed.cards[0])
		expect(ifCard.children.map((c) => c.kind)).toEqual(["text"])
		expect((ifCard.children[0] as any).content).toBe("{{{a}}}: {{{b}}}")
	})

	test("a mustache with trailing prose on the same line is inline, not standalone", () => {
		const parsed = parseContextTemplate(
			`{{#if x}}\n{{{a}}} trailing text\n{{/if}}`
		)
		const ifCard = block(parsed.cards[0])
		expect(ifCard.children.map((c) => c.kind)).toEqual(["text"])
	})

	test("consecutive standalone mustaches on separate lines each get their own variable card", () => {
		const parsed = parseContextTemplate(
			`{{#if x}}\n{{{a}}}\n{{{b}}}\n{{/if}}`
		)
		const ifCard = block(parsed.cards[0])
		expect(ifCard.children.map((c) => c.kind)).toEqual([
			"variable",
			"variable"
		])
	})

	test("escaped {{x}} vs unescaped {{{x}}} is preserved", () => {
		const parsed = parseContextTemplate(`{{#if x}}\n{{x}}\n{{/if}}`)
		const ifCard = block(parsed.cards[0])
		expect((ifCard.children[0] as any).escaped).toBe(true)
		expect((ifCard.children[0] as any).expressionSource).toBe("x")
	})
})

describe("text card paragraph splitting", () => {
	test("consecutive non-blank lines merge into one text card", () => {
		const parsed = parseContextTemplate(
			`{{#if x}}\nLine one\nLine two\n{{/if}}`
		)
		const ifCard = block(parsed.cards[0])
		expect(ifCard.children).toHaveLength(1)
		expect((ifCard.children[0] as any).content).toBe("Line one\nLine two")
	})

	test("a blank line splits prose into two separate text cards", () => {
		const parsed = parseContextTemplate(
			`{{#if x}}\nFirst paragraph.\n\nSecond paragraph.\n{{/if}}`
		)
		const ifCard = block(parsed.cards[0])
		expect(ifCard.children.map((c) => (c as any).content)).toEqual([
			"First paragraph.",
			"Second paragraph."
		])
	})
})

describe("lintContextTemplate", () => {
	test("the real Default template has zero lint issues", () => {
		expect(lintContextTemplate(DEFAULT_TEMPLATE)).toEqual([])
	})

	test("flags an unrecognized helper name at the top level", () => {
		const issues = lintContextTemplate(
			`{{#esch sessionMessages}}\n{{/esch}}`
		)
		expect(issues).toHaveLength(1)
		expect(issues[0].message).toContain("esch")
	})

	test("flags an unrecognized helper name nested inside an each/with (helper checks aren't scope-limited)", () => {
		const template = `{{#each sessionMessages as |m i|}}\n{{#bogusHelper}}\n{{/bogusHelper}}\n{{/each}}`
		const issues = lintContextTemplate(template)
		expect(issues.some((i) => i.message.includes("bogusHelper"))).toBe(true)
	})

	test("flags an unrecognized top-level field in an if condition", () => {
		const issues = lintContextTemplate(
			`{{#systemBlock}}\n{{#if wordLore}}\nx\n{{/if}}\n{{/systemBlock}}`
		)
		expect(issues).toHaveLength(1)
		expect(issues[0].message).toContain("wordLore")
	})

	test("flags an unrecognized top-level standalone variable", () => {
		const issues = lintContextTemplate(
			`{{#if worldLore}}\n{{{wordLore}}}\n{{/if}}`
		)
		expect(issues.some((i) => i.message.includes('"wordLore"'))).toBe(true)
	})

	test("does not flag field references inside an each block's own scope (block params)", () => {
		const template = `{{#each sessionMessages as |sessionMessage msgIndex|}}\n{{#if (eq role "assistant")}}\nx\n{{/if}}\n{{/each}}`
		expect(lintContextTemplate(template)).toEqual([])
	})

	test("does not flag field references inside a with block's own scope", () => {
		const template = `{{#with ../postHistory}}\n{{#if instructions}}\nx\n{{/if}}\n{{/with}}`
		expect(lintContextTemplate(template)).toEqual([])
	})

	test("does not flag ../relative or @special paths", () => {
		const template = `{{#with ../postHistory}}\n{{{../postHistory}}}\n{{/with}}`
		expect(lintContextTemplate(template)).toEqual([])
	})

	// Typed templates P4: the lint reads subexpressions with the real parser
	// (the SDK's checker) instead of skipping them, so a name inside `(and …)`
	// is checked like any other. At the root, `role` is not a context field —
	// the condition was always false — and that is now said.
	test("checks the names inside a subexpression condition like (and (eq a b) c)", () => {
		const issues = lintContextTemplate(
			`{{#if (and (eq role "assistant") characters)}}\nx\n{{/if}}`
		)
		expect(issues.map((i) => i.message)).toEqual([
			expect.stringContaining('"role" isn\'t a recognized field')
		])
	})
})
