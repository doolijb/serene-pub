import { describe, expect, test } from "vitest"
import {
	parseContextTemplate,
	reorderCards,
	removeCard,
	updateTextCard,
	updateVariableCard,
	updateBlockTag,
	addElseBranch,
	removeElseBranch,
	insertCard,
	findOrphanedBlockParamNames,
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

{{#each chatMessages as |chatMessage msgIndex|}}
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
	if (card.kind !== "block") throw new Error(`expected block, got ${card.kind}`)
	return card
}

describe("parseContextTemplate — real Default template", () => {
	test("parses without error", () => {
		const parsed = parseContextTemplate(DEFAULT_TEMPLATE)
		expect(parsed.parseError).toBeNull()
	})

	test("root level has the outer systemBlock and the chatMessages each-loop as block cards", () => {
		const parsed = parseContextTemplate(DEFAULT_TEMPLATE)
		const rootBlocks = parsed.cards.filter((c) => c.kind === "block") as BlockCard[]
		expect(rootBlocks.map((c) => c.helperName)).toEqual(["systemBlock", "each"])
		expect(rootBlocks[1].tagSource).toBe(
			"chatMessages as |chatMessage msgIndex|"
		)
		expect(rootBlocks[1].isRoleWrapper).toBe(false)
		expect(rootBlocks[0].isRoleWrapper).toBe(true)
	})

	test("the systemBlock's children include every {{#if field}} as its own block card with the field exposed as tagSource", () => {
		const parsed = parseContextTemplate(DEFAULT_TEMPLATE)
		const systemBlock = block(
			parsed.cards.find((c) => c.kind === "block" && c.helperName === "systemBlock")!
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
			parsed.cards.find((c) => c.kind === "block" && c.helperName === "each")!
		)
		const withCard = block(
			eachCard.children.find((c) => c.kind === "block" && c.helperName === "with")!
		)
		expect(withCard.tagSource).toBe("../postHistory")

		const ifCard = block(
			withCard.children.find((c) => c.kind === "block" && c.helperName === "if")!
		)
		expect(ifCard.tagSource).toBe(
			"(and (eq msgIndex targetIndex) hasContent)"
		)

		const nestedSystemBlock = block(
			ifCard.children.find((c) => c.kind === "block" && c.helperName === "systemBlock")!
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
			parsed.cards.find((c) => c.kind === "block" && c.helperName === "each")!
		)
		const assistantIf = block(
			eachCard.children.find(
				(c) => c.kind === "block" && c.helperName === "if" && c.tagSource.includes("assistant")
			)!
		)
		const assistantBlockCard = block(
			assistantIf.children.find((c) => c.kind === "block" && c.helperName === "assistantBlock")!
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
			parsed.cards.find((c) => c.kind === "block" && c.helperName === "systemBlock")!
		)
		const worldLoreIf = block(
			systemBlock.children.find(
				(c) => c.kind === "block" && c.helperName === "if" && c.tagSource === "worldLore"
			)!
		)
		const kinds = worldLoreIf.children.map((c) => c.kind)
		expect(kinds).toEqual(["text", "variable", "text"])
		expect((worldLoreIf.children[1] as any).expressionSource).toBe("worldLore")
		expect((worldLoreIf.children[1] as any).escaped).toBe(false)
	})

	test("round-trip: re-slicing every card's own [start,end) reconstructs the exact original template", () => {
		const parsed = parseContextTemplate(DEFAULT_TEMPLATE)
		function collectAll(cards: Card[]): Card[] {
			return cards.flatMap((c) =>
				c.kind === "block"
					? [c, ...collectAll(c.children), ...(c.elseChildren ? collectAll(c.elseChildren) : [])]
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
		const parsed = parseContextTemplate(`{{#if x}}\n{{{a}}}: {{{b}}}\n{{/if}}`)
		const ifCard = block(parsed.cards[0])
		expect(ifCard.children.map((c) => c.kind)).toEqual(["text"])
		expect((ifCard.children[0] as any).content).toBe("{{{a}}}: {{{b}}}")
	})

	test("a mustache with trailing prose on the same line is inline, not standalone", () => {
		const parsed = parseContextTemplate(`{{#if x}}\n{{{a}}} trailing text\n{{/if}}`)
		const ifCard = block(parsed.cards[0])
		expect(ifCard.children.map((c) => c.kind)).toEqual(["text"])
	})

	test("consecutive standalone mustaches on separate lines each get their own variable card", () => {
		const parsed = parseContextTemplate(`{{#if x}}\n{{{a}}}\n{{{b}}}\n{{/if}}`)
		const ifCard = block(parsed.cards[0])
		expect(ifCard.children.map((c) => c.kind)).toEqual(["variable", "variable"])
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
		const parsed = parseContextTemplate(`{{#if x}}\nLine one\nLine two\n{{/if}}`)
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

describe("mutation functions", () => {
	test("updateTextCard replaces content in place", () => {
		const template = `{{#if x}}\nOld text\n{{/if}}`
		const parsed = parseContextTemplate(template)
		const textCard = block(parsed.cards[0]).children[0]
		const result = updateTextCard(template, textCard, "New text")
		expect(parseContextTemplate(result).parseError).toBeNull()
		expect(result).toContain("New text")
		expect(result).not.toContain("Old text")
	})

	test("updateTextCard preserves the original surrounding newlines instead of collapsing the block onto one line", () => {
		const template = `{{#if x}}\nLine one\nLine two\n{{/if}}`
		const parsed = parseContextTemplate(template)
		const textCard = block(parsed.cards[0]).children[0]
		expect((textCard as any).content).toBe("Line one\nLine two")
		const result = updateTextCard(template, textCard, "Replaced\ncontent")
		expect(result).toBe(`{{#if x}}\nReplaced\ncontent\n{{/if}}`)
	})

	test("updateVariableCard changes the expression and re-validates", () => {
		const template = `{{#if x}}\n{{{oldVar}}}\n{{/if}}`
		const parsed = parseContextTemplate(template)
		const varCard = block(parsed.cards[0]).children[0]
		const { template: result, error } = updateVariableCard(
			template,
			varCard,
			"newVar",
			false
		)
		expect(error).toBeUndefined()
		expect(result).toContain("{{{newVar}}}")
	})

	test("updateVariableCard toggles escaped vs unescaped form", () => {
		const template = `{{#if x}}\n{{{v}}}\n{{/if}}`
		const parsed = parseContextTemplate(template)
		const varCard = block(parsed.cards[0]).children[0]
		const { template: result } = updateVariableCard(template, varCard, "v", true)
		expect(result).toContain("{{v}}")
		expect(result).not.toContain("{{{v}}}")
	})

	test("updateBlockTag changes helper name and condition, preserving the body untouched", () => {
		const template = `{{#if x}}\nBody text\n{{/if}}`
		const parsed = parseContextTemplate(template)
		const ifCard = block(parsed.cards[0])
		const { template: result, error } = updateBlockTag(
			template,
			ifCard,
			"unless",
			"y"
		)
		expect(error).toBeUndefined()
		expect(result).toBe(`{{#unless y}}\nBody text\n{{/unless}}`)
		expect(parseContextTemplate(result).parseError).toBeNull()
	})

	test("updateBlockTag rejects invalid syntax without touching the template", () => {
		const template = `{{#if x}}\nBody\n{{/if}}`
		const parsed = parseContextTemplate(template)
		const ifCard = block(parsed.cards[0])
		const { template: result, error } = updateBlockTag(
			template,
			ifCard,
			"if",
			"(unclosed"
		)
		expect(error).toBeDefined()
		expect(result).toBe(template)
	})

	test("updateBlockTag preserves block-params syntax when unrelated to the edit", () => {
		const template = `{{#each items as |item i|}}\n{{{item}}}\n{{/each}}`
		const parsed = parseContextTemplate(template)
		const eachCard = block(parsed.cards[0])
		const { template: result, error } = updateBlockTag(
			template,
			eachCard,
			"each",
			"otherItems as |item i|"
		)
		expect(error).toBeUndefined()
		expect(result).toContain("as |item i|")
		expect(parseContextTemplate(result).parseError).toBeNull()
	})

	test("updateBlockTag preserves an {{else}} branch untouched", () => {
		const template = `{{#if x}}\nYes\n{{else}}\nNo\n{{/if}}`
		const parsed = parseContextTemplate(template)
		const ifCard = block(parsed.cards[0])
		expect(ifCard.hasElse).toBe(true)
		const { template: result } = updateBlockTag(template, ifCard, "if", "y")
		expect(result).toBe(`{{#if y}}\nYes\n{{else}}\nNo\n{{/if}}`)
	})

	test("removeCard slices a card (and one trailing newline) out entirely", () => {
		const template = `{{#if x}}\nA\n{{/if}}\n{{#if y}}\nB\n{{/if}}`
		const parsed = parseContextTemplate(template)
		const [first] = parsed.cards
		const result = removeCard(template, first)
		expect(result).not.toContain("{{#if x}}")
		expect(result).toContain("{{#if y}}")
		expect(parseContextTemplate(result).parseError).toBeNull()
	})

	test("addElseBranch inserts an empty else before the close tag", () => {
		const template = `{{#if x}}\nYes\n{{/if}}`
		const parsed = parseContextTemplate(template)
		const ifCard = block(parsed.cards[0])
		const result = addElseBranch(template, ifCard)
		const reparsed = block(parseContextTemplate(result).cards[0])
		expect(reparsed.hasElse).toBe(true)
	})

	test("removeElseBranch removes only the else, leaving the main body", () => {
		const template = `{{#if x}}\nYes\n{{else}}\nNo\n{{/if}}`
		const parsed = parseContextTemplate(template)
		const ifCard = block(parsed.cards[0])
		const result = removeElseBranch(template, ifCard)
		const reparsed = block(parseContextTemplate(result).cards[0])
		expect(reparsed.hasElse).toBe(false)
		expect(result).toContain("Yes")
	})
})

describe("insertCard", () => {
	test("inserts into an empty parent's body using its bodyStart", () => {
		const template = `{{#if x}}\n{{/if}}`
		const parsed = parseContextTemplate(template)
		const ifCard = block(parsed.cards[0])
		const { template: result, error } = insertCard(
			template,
			{
				parentBodyStart: ifCard.bodyStart,
				parentBodyEnd: ifCard.bodyEnd,
				siblings: ifCard.children
			},
			0,
			{ kind: "text", content: "New content" }
		)
		expect(error).toBeUndefined()
		expect(result).toContain("New content")
		expect(parseContextTemplate(result).parseError).toBeNull()
	})

	test("inserts a new sibling before an existing one at a given index", () => {
		const template = `{{#systemBlock}}\n{{#if a}}\nA\n{{/if}}\n\n{{#if b}}\nB\n{{/if}}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const sysBlock = block(parsed.cards[0])
		const { template: result, error } = insertCard(
			template,
			{
				parentBodyStart: sysBlock.bodyStart,
				parentBodyEnd: sysBlock.bodyEnd,
				siblings: sysBlock.children
			},
			1,
			{ kind: "block", helperName: "if", tagSource: "c" }
		)
		expect(error).toBeUndefined()
		expect(parseContextTemplate(result).parseError).toBeNull()
		const reparsed = block(parseContextTemplate(result).cards[0])
		const ifCards = reparsed.children.filter(
			(c): c is BlockCard => c.kind === "block"
		)
		expect(ifCards.map((c) => c.tagSource)).toEqual(["a", "c", "b"])
	})

	test("appends at the end when atIndex is beyond the sibling count", () => {
		const template = `{{#systemBlock}}\n{{#if a}}\nA\n{{/if}}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const sysBlock = block(parsed.cards[0])
		const { template: result } = insertCard(
			template,
			{
				parentBodyStart: sysBlock.bodyStart,
				parentBodyEnd: sysBlock.bodyEnd,
				siblings: sysBlock.children
			},
			99,
			{ kind: "variable", expressionSource: "z", escaped: false }
		)
		const reparsed = block(parseContextTemplate(result).cards[0])
		expect(reparsed.children[reparsed.children.length - 1].kind).toBe(
			"variable"
		)
	})

	test("rejects an invalid helper-name/tag combination without touching the template", () => {
		const template = `{{#systemBlock}}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const sysBlock = block(parsed.cards[0])
		const { template: result, error } = insertCard(
			template,
			{
				parentBodyStart: sysBlock.bodyStart,
				parentBodyEnd: sysBlock.bodyEnd,
				siblings: sysBlock.children
			},
			0,
			{ kind: "block", helperName: "if", tagSource: "(unclosed" }
		)
		expect(error).toBeDefined()
		expect(result).toBe(template)
	})

	test("returns the newly inserted card's id, resolvable in the reparsed tree", () => {
		const template = `{{#if x}}\n{{/if}}`
		const parsed = parseContextTemplate(template)
		const ifCard = block(parsed.cards[0])
		const { template: result, insertedId } = insertCard(
			template,
			{
				parentBodyStart: ifCard.bodyStart,
				parentBodyEnd: ifCard.bodyEnd,
				siblings: ifCard.children
			},
			0,
			{ kind: "text", content: "New content" }
		)
		expect(insertedId).toBeDefined()
		const reparsed = block(parseContextTemplate(result).cards[0])
		expect(reparsed.children.map((c) => c.id)).toContain(insertedId)
		const insertedCard = reparsed.children.find((c) => c.id === insertedId)
		expect(insertedCard?.kind).toBe("text")
	})

	test("insertedId identifies the correct sibling when inserted between two others", () => {
		const template = `{{#systemBlock}}\n{{#if a}}\nA\n{{/if}}\n\n{{#if b}}\nB\n{{/if}}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const sysBlock = block(parsed.cards[0])
		const { template: result, insertedId } = insertCard(
			template,
			{
				parentBodyStart: sysBlock.bodyStart,
				parentBodyEnd: sysBlock.bodyEnd,
				siblings: sysBlock.children
			},
			1,
			{ kind: "block", helperName: "if", tagSource: "c" }
		)
		const reparsed = block(parseContextTemplate(result).cards[0])
		const insertedCard = reparsed.children.find((c) => c.id === insertedId)
		expect(insertedCard?.kind).toBe("block")
		expect((insertedCard as BlockCard).tagSource).toBe("c")
	})

	test("does not return an insertedId when the insert is rejected", () => {
		const template = `{{#systemBlock}}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const sysBlock = block(parsed.cards[0])
		const { insertedId } = insertCard(
			template,
			{
				parentBodyStart: sysBlock.bodyStart,
				parentBodyEnd: sysBlock.bodyEnd,
				siblings: sysBlock.children
			},
			0,
			{ kind: "block", helperName: "if", tagSource: "(unclosed" }
		)
		expect(insertedId).toBeUndefined()
	})
})

describe("reorderCards", () => {
	test("swapping two cards' order preserves each card's own content", () => {
		const template = `{{#systemBlock}}\n{{#if a}}\nAlpha\n{{/if}}\n\n{{#if b}}\nBeta\n{{/if}}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const sysBlock = block(parsed.cards[0])
		const [alpha, beta] = sysBlock.children

		const reordered = reorderCards(template, sysBlock.children, [
			beta.id,
			alpha.id
		])
		const reparsed = block(parseContextTemplate(reordered).cards[0])
		const tagSources = (reparsed.children as BlockCard[]).map(
			(c) => c.tagSource
		)
		expect(tagSources).toEqual(["b", "a"])
	})

	test("reordering keeps the same stable ids after a re-parse", () => {
		const template = `{{#systemBlock}}\n{{#if a}}\nAlpha\n{{/if}}\n\n{{#if b}}\nBeta\n{{/if}}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const sysBlock = block(parsed.cards[0])
		const [alpha, beta] = sysBlock.children

		const reordered = reorderCards(template, sysBlock.children, [
			beta.id,
			alpha.id
		])
		const reparsed = block(parseContextTemplate(reordered).cards[0])
		expect(new Set(reparsed.children.map((c) => c.id))).toEqual(
			new Set([alpha.id, beta.id])
		)
	})

	test("a gap of hand-written text stays attached to the card it followed", () => {
		const template =
			`{{#systemBlock}}\n{{#if a}}\nAlpha\n{{/if}}` +
			`\n\n<!-- a note about alpha -->\n\n` +
			`{{#if b}}\nBeta\n{{/if}}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const sysBlock = block(parsed.cards[0])
		const [alpha, beta] = sysBlock.children

		const reordered = reorderCards(template, sysBlock.children, [
			beta.id,
			alpha.id
		])
		const alphaText = template.slice(alpha.start, alpha.end)
		const idx = reordered.indexOf(alphaText)
		expect(idx).toBeGreaterThan(-1)
		expect(reordered.slice(idx, idx + alphaText.length + 40)).toContain(
			"a note about alpha"
		)
	})

	test("returns the template unchanged when the id set doesn't match", () => {
		const template = `{{#systemBlock}}\n{{#if a}}\nAlpha\n{{/if}}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const sysBlock = block(parsed.cards[0])
		const result = reorderCards(template, sysBlock.children, [
			"doesnotexist"
		])
		expect(result).toBe(template)
	})

	test("no-op reorder (same order) returns byte-identical template", () => {
		const template = `{{#systemBlock}}\n{{#if a}}\nAlpha\n{{/if}}\n\n{{#if b}}\nBeta\n{{/if}}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const sysBlock = block(parsed.cards[0])
		const result = reorderCards(
			template,
			sysBlock.children,
			sysBlock.children.map((c) => c.id)
		)
		expect(result).toBe(template)
	})

	test("identical-content siblings get distinct, stable ids that survive a reorder of an unrelated third sibling elsewhere", () => {
		// Regression test: the id scheme must not let inserting/removing an
		// identical-content card under a DIFFERENT parent perturb these two
		// same-parent identical siblings' own disambiguation.
		const template = `{{#systemBlock}}\n{{#if a}}\nSame\n{{/if}}\n\n{{#if b}}\nSame\n{{/if}}\n{{/systemBlock}}`
		const parsed = parseContextTemplate(template)
		const sysBlock = block(parsed.cards[0])
		const ids = sysBlock.children.map((c) => c.id)
		expect(new Set(ids).size).toBe(2)
	})
})

describe("findOrphanedBlockParamNames", () => {
	test("flags a block-param name still referenced by a descendant after a rename", () => {
		const template = `{{#each items as |item idx|}}\n{{{idx}}}\n{{/each}}`
		const parsed = parseContextTemplate(template)
		const eachCard = block(parsed.cards[0])
		const warnings = findOrphanedBlockParamNames(
			eachCard.tagSource,
			"items as |item i|",
			eachCard.children
		)
		expect(warnings).toEqual(["idx"])
	})

	test("returns nothing when the renamed param isn't referenced anywhere", () => {
		const template = `{{#each items as |item idx|}}\nplain text\n{{/each}}`
		const parsed = parseContextTemplate(template)
		const eachCard = block(parsed.cards[0])
		const warnings = findOrphanedBlockParamNames(
			eachCard.tagSource,
			"items as |item i|",
			eachCard.children
		)
		expect(warnings).toEqual([])
	})

	test("returns nothing when no block-param name was actually removed", () => {
		const template = `{{#each items as |item idx|}}\n{{{idx}}}\n{{/each}}`
		const parsed = parseContextTemplate(template)
		const eachCard = block(parsed.cards[0])
		const warnings = findOrphanedBlockParamNames(
			eachCard.tagSource,
			"otherItems as |item idx|",
			eachCard.children
		)
		expect(warnings).toEqual([])
	})
})

describe("lintContextTemplate", () => {
	test("the real Default template has zero lint issues", () => {
		const parsed = parseContextTemplate(DEFAULT_TEMPLATE)
		expect(lintContextTemplate(parsed.cards)).toEqual([])
	})

	test("flags an unrecognized helper name at the top level", () => {
		const parsed = parseContextTemplate(`{{#esch chatMessages}}\n{{/esch}}`)
		const issues = lintContextTemplate(parsed.cards)
		expect(issues).toHaveLength(1)
		expect(issues[0].message).toContain("esch")
	})

	test("flags an unrecognized helper name nested inside an each/with (helper checks aren't scope-limited)", () => {
		const template = `{{#each chatMessages as |m i|}}\n{{#bogusHelper}}\n{{/bogusHelper}}\n{{/each}}`
		const parsed = parseContextTemplate(template)
		const issues = lintContextTemplate(parsed.cards)
		expect(issues.some((i) => i.message.includes("bogusHelper"))).toBe(true)
	})

	test("flags an unrecognized top-level field in an if condition", () => {
		const parsed = parseContextTemplate(
			`{{#systemBlock}}\n{{#if wordLore}}\nx\n{{/if}}\n{{/systemBlock}}`
		)
		const issues = lintContextTemplate(parsed.cards)
		expect(issues).toHaveLength(1)
		expect(issues[0].message).toContain("wordLore")
	})

	test("flags an unrecognized top-level standalone variable", () => {
		const parsed = parseContextTemplate(
			`{{#if worldLore}}\n{{{wordLore}}}\n{{/if}}`
		)
		const issues = lintContextTemplate(parsed.cards)
		expect(issues.some((i) => i.message.includes('"wordLore"'))).toBe(true)
	})

	test("does not flag field references inside an each block's own scope (block params)", () => {
		const template = `{{#each chatMessages as |chatMessage msgIndex|}}\n{{#if (eq role "assistant")}}\nx\n{{/if}}\n{{/each}}`
		const parsed = parseContextTemplate(template)
		expect(lintContextTemplate(parsed.cards)).toEqual([])
	})

	test("does not flag field references inside a with block's own scope", () => {
		const template = `{{#with ../postHistory}}\n{{#if instructions}}\nx\n{{/if}}\n{{/with}}`
		const parsed = parseContextTemplate(template)
		expect(lintContextTemplate(parsed.cards)).toEqual([])
	})

	test("does not flag ../relative or @special paths", () => {
		const template = `{{#with ../postHistory}}\n{{{../postHistory}}}\n{{/with}}`
		const parsed = parseContextTemplate(template)
		expect(lintContextTemplate(parsed.cards)).toEqual([])
	})

	test("does not flag a subexpression condition like (and (eq a b) c)", () => {
		const parsed = parseContextTemplate(
			`{{#if (and (eq role "assistant") characters)}}\nx\n{{/if}}`
		)
		expect(lintContextTemplate(parsed.cards)).toEqual([])
	})
})
