import Handlebars from "handlebars"

// Recognizes known Handlebars idioms in a context config template's raw text (the source of truth)
// and exposes their exact source ranges so cards can be added/removed/reordered as surgical splices.

export type ContextCardZone = "systemMessage" | "chatMessages" | "postHistory"

export const CUSTOM_TEXT_OPEN_MARKER = "context-card:custom-text"
export const CUSTOM_TEXT_CLOSE_MARKER = "/context-card:custom-text"

export type ContextBlockRole = "system" | "user" | "assistant"

const BLOCK_HELPER_ROLES: Record<string, ContextBlockRole> = {
	systemBlock: "system",
	userBlock: "user",
	assistantBlock: "assistant"
}

export interface ContextCardTypeDef {
	id: string
	zone: ContextCardZone
	label: string
	description: string
	fixed?: boolean
	repeatable?: boolean
	field: string
	kinds: ("mustache" | "ifBlock" | "eachBlock")[]
	defaultSnippet: string
}

export interface ParsedContextCard {
	key: string
	typeId: string
	zone: ContextCardZone
	start: number
	end: number
	content?: string
	role?: ContextBlockRole
}

export interface ParsedContextTemplate {
	cards: ParsedContextCard[]
	systemMessageContainer: { start: number; end: number } | null
	parseError: string | null
}

export const CONTEXT_CARD_TYPES: ContextCardTypeDef[] = [
	{
		id: "currentDate",
		zone: "systemMessage",
		label: "Current Date",
		description:
			"Shows the in-story current date, when the chat has one set. Only appears when a date is set.",
		field: "currentDate",
		kinds: ["ifBlock"],
		defaultSnippet: `{{#if currentDate}}\nThe current date in the story is {{{currentDate}}}.\n{{/if}}`
	},
	{
		id: "instructions",
		zone: "systemMessage",
		label: "Instructions",
		description:
			"The active chat prompt's system instructions (from the Prompts sidebar). Only appears when set.",
		field: "instructions",
		kinds: ["mustache", "ifBlock"],
		defaultSnippet: `{{#if instructions}}\nInstructions:\n"""\n{{{instructions}}}\n"""\n{{/if}}`
	},
	{
		id: "characters",
		zone: "systemMessage",
		label: "Assistant Characters",
		description:
			"The AI-controlled characters in this chat, serialized as JSON (name, description, personality, lore, etc). Only appears when there's at least one.",
		field: "characters",
		kinds: ["mustache", "ifBlock"],
		defaultSnippet: `{{#if characters}}\nAssistant Characters (AI-controlled):\n\`\`\`json\n{{{characters}}}\n\`\`\`\n{{/if}}`
	},
	{
		id: "personas",
		zone: "systemMessage",
		label: "User Personas",
		description:
			"The player-controlled personas in this chat, serialized as JSON. Only appears when there's at least one.",
		field: "personas",
		kinds: ["mustache", "ifBlock"],
		defaultSnippet: `{{#if personas}}\nUser Characters (player-controlled):\n\`\`\`json\n{{{personas}}}\n\`\`\`\n{{/if}}`
	},
	{
		id: "scenario",
		zone: "systemMessage",
		label: "Scenario",
		description:
			"The chat's scenario text, falling back to the current character's scenario when the chat doesn't set one. Only appears when set.",
		field: "scenario",
		kinds: ["mustache", "ifBlock"],
		defaultSnippet: `{{#if scenario}}\nScenario:\n"""\n{{{scenario}}}\n"""\n{{/if}}`
	},
	{
		id: "worldLore",
		zone: "systemMessage",
		label: "World Lore",
		description:
			"World lorebook entries selected for relevance, serialized as JSON. Only appears when at least one is included.",
		field: "worldLore",
		kinds: ["ifBlock"],
		defaultSnippet: `{{#if worldLore}}\nWorld lore: \n\`\`\`json\n{{{worldLore}}}\n\`\`\`\n{{/if}}`
	},
	{
		id: "history",
		zone: "systemMessage",
		label: "Story History",
		description:
			"History lorebook entries selected for relevance, serialized as JSON. Only appears when at least one is included.",
		field: "history",
		kinds: ["ifBlock"],
		defaultSnippet: `{{#if history}}\nStory history:\n\`\`\`json\n{{{history}}}\n\`\`\`\n{{/if}}`
	},
	{
		id: "narrativeGraph",
		zone: "systemMessage",
		label: "Story Relationships",
		description:
			"A relationship graph inferred from recent messages (who/what co-occurs with whom), serialized as JSON. Only appears when there's enough signal.",
		field: "narrativeGraph",
		kinds: ["ifBlock"],
		defaultSnippet: `{{#if narrativeGraph}}\nStory relationships:\n\`\`\`json\n{{{narrativeGraph}}}\n\`\`\`\n{{/if}}`
	},
	{
		id: "exampleDialogue",
		zone: "systemMessage",
		label: "Example Dialogue",
		description:
			"One randomly-selected example dialogue from the current character. Only appears when they have any defined.",
		field: "exampleDialogue",
		kinds: ["ifBlock"],
		defaultSnippet: `{{#if exampleDialogue}}\nExample dialogue:\n"""\n{{{exampleDialogue}}}\n"""\n{{/if}}`
	},
	{
		id: "customText",
		zone: "systemMessage",
		label: "Custom Text",
		description:
			"Freeform text you write yourself. Add as many as you like, anywhere in the system message. Can also contain simple {{placeholders}}.",
		repeatable: true,
		field: "",
		kinds: [],
		defaultSnippet: `{{!-- ${CUSTOM_TEXT_OPEN_MARKER} --}}\nWrite anything here.\n{{!-- ${CUSTOM_TEXT_CLOSE_MARKER} --}}`
	},
	{
		id: "block",
		zone: "systemMessage",
		label: "Block",
		description:
			"A generic wrapper, like the one that already wraps Instructions and Date into a system message. Pick a role and write anything inside it — useful for grouping content or adding a separate system/user/assistant-tagged section.",
		repeatable: true,
		field: "",
		kinds: [],
		defaultSnippet: `{{#systemBlock}}\nWrite anything here.\n{{/systemBlock}}`
	},
	{
		id: "chatMessages",
		zone: "chatMessages",
		label: "Chat Messages",
		description:
			"The conversation history itself. Always present and can't be removed — every context template needs somewhere for the actual chat to go.",
		fixed: true,
		field: "chatMessages",
		kinds: ["eachBlock"],
		defaultSnippet: `{{#each chatMessages}}\n{{#if (eq role "assistant")}}\n{{#assistantBlock}}\n{{{name}}}: {{{message}}}\n{{/assistantBlock}}\n{{/if}}\n{{#if (eq role "user")}}\n{{#userBlock}}\n{{{name}}}: {{{message}}}\n{{/userBlock}}\n{{/if}}\n{{/each}}`
	},
	{
		id: "postHistoryInstructions",
		zone: "postHistory",
		label: "Post-History Instructions",
		description:
			"Extra instructions injected after the chat history, from the current character's Post-History Instructions field. Only appears when the character sets any.",
		field: "postHistoryInstructions",
		kinds: ["ifBlock"],
		defaultSnippet: `{{#if postHistoryInstructions}}\n{{#systemBlock}}\n{{{postHistoryInstructions}}}\n{{/systemBlock}}\n{{/if}}`
	}
]

export function getContextCardType(typeId: string): ContextCardTypeDef | undefined {
	return CONTEXT_CARD_TYPES.find((c) => c.id === typeId)
}

/**
 * Deterministic (FNV-1a) string hash — not cryptographic, just needs to be
 * stable and cheap so a card's derived `key` doesn't change when its
 * position in the template does. Collisions only matter between two cards
 * of the same type with byte-identical content, which pushCard's dupCount
 * suffix already disambiguates.
 */
function fingerprint(text: string): string {
	let hash = 0x811c9dc5
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193)
	}
	return (hash >>> 0).toString(36)
}

function buildLineOffsets(text: string): number[] {
	const offsets = [0]
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") offsets.push(i + 1)
	}
	return offsets
}

function matchMustache(stmt: any): string | null {
	if (stmt.params?.length) return null
	if (stmt.path?.type !== "PathExpression") return null
	const field = stmt.path.original
	const def = CONTEXT_CARD_TYPES.find(
		(c) => c.kinds.includes("mustache") && c.field === field
	)
	return def?.id ?? null
}

function matchBlock(stmt: any): ContextCardTypeDef | null {
	const pathName = stmt.path?.original
	if (
		(pathName === "if" || pathName === "each") &&
		stmt.params?.length === 1 &&
		stmt.params[0]?.type === "PathExpression"
	) {
		const kind = pathName === "if" ? "ifBlock" : "eachBlock"
		const field = stmt.params[0].original
		return (
			CONTEXT_CARD_TYPES.find(
				(c) => c.kinds.includes(kind as any) && c.field === field
			) ?? null
		)
	}
	return null
}

export function parseContextTemplate(template: string): ParsedContextTemplate {
	const result: ParsedContextTemplate = {
		cards: [],
		systemMessageContainer: null,
		parseError: null
	}

	let ast: any
	try {
		ast = Handlebars.parse(template)
	} catch (err: any) {
		result.parseError = err?.message || "Failed to parse template"
		return result
	}

	const lineOffsets = buildLineOffsets(template)
	const offsetOf = (pos: { line: number; column: number }) =>
		lineOffsets[pos.line - 1] + pos.column

	const seenKeys = new Map<string, number>()
	const pushCard = (
		typeId: string,
		zone: ContextCardZone,
		start: number,
		end: number,
		content?: string,
		role?: ContextBlockRole
	) => {
		// Keys are derived from content, not scan-order occurrence, so a
		// card's identity survives being moved to a different position by a
		// reorder — reorderContextCards (below) and ContextSidebar's drag
		// mirror both depend on the SAME card keeping the SAME key across a
		// reorder + re-parse cycle. Occurrence-based keys broke that: after
		// swapping two same-typed cards, re-parsing renumbered by new scan
		// position, so eg. "customText:1" silently started referring to a
		// different card's content — which svelte-dnd-action (keyed on this
		// value) can't distinguish from that card being deleted and a new
		// one inserted, causing it to visually vanish mid-drop.
		const baseKey =
			content !== undefined ? `${typeId}:${fingerprint(content)}` : typeId
		// Falls back to the old occurrence-numbering only to disambiguate
		// two cards of the same type with byte-identical content (or no
		// content at all, eg. the fixed chatMessages card) — a rare,
		// harmless case since such cards are indistinguishable to the user
		// too.
		const dupCount = seenKeys.get(baseKey) ?? 0
		seenKeys.set(baseKey, dupCount + 1)
		const key = dupCount === 0 ? baseKey : `${baseKey}:${dupCount}`
		result.cards.push({
			key,
			typeId,
			zone,
			start,
			end,
			...(content !== undefined ? { content } : {}),
			...(role !== undefined ? { role } : {})
		})
	}

	// Bare mustache cards only cover the placeholder itself; expand to the surrounding
	// blank-line-delimited paragraph (clamped to the enclosing block) to capture label/fence text too.
	const expandToParagraph = (
		start: number,
		end: number,
		containerStart: number,
		containerEnd: number
	) => {
		const beforeIdx = template.lastIndexOf("\n\n", start)
		const pStart =
			beforeIdx !== -1 && beforeIdx + 2 >= containerStart
				? beforeIdx + 2
				: containerStart
		const afterIdx = template.indexOf("\n\n", end)
		const pEnd =
			afterIdx !== -1 && afterIdx <= containerEnd ? afterIdx : containerEnd
		return { start: pStart, end: pEnd }
	}

	const walk = (program: any, containerStart: number, containerEnd: number) => {
		const body = program.body
		for (let idx = 0; idx < body.length; idx++) {
			const stmt = body[idx]

			if (
				stmt.type === "CommentStatement" &&
				stmt.value?.trim() === CUSTOM_TEXT_OPEN_MARKER
			) {
				let closeIdx = -1
				for (let j = idx + 1; j < body.length; j++) {
					const s = body[j]
					if (
						s.type === "CommentStatement" &&
						s.value?.trim() === CUSTOM_TEXT_CLOSE_MARKER
					) {
						closeIdx = j
						break
					}
				}
				if (closeIdx !== -1) {
					const closeStmt = body[closeIdx]
					const openEnd = offsetOf(stmt.loc.end)
					const closeStart = offsetOf(closeStmt.loc.start)
					const content = template
						.slice(openEnd, closeStart)
						.replace(/^\n/, "")
						.replace(/\n$/, "")
					pushCard(
						"customText",
						"systemMessage",
						offsetOf(stmt.loc.start),
						offsetOf(closeStmt.loc.end),
						content
					)
					idx = closeIdx
					continue
				}
			}

			if (stmt.type === "MustacheStatement") {
				const typeId = matchMustache(stmt)
				if (typeId) {
					const { start, end } = expandToParagraph(
						offsetOf(stmt.loc.start),
						offsetOf(stmt.loc.end),
						containerStart,
						containerEnd
					)
					// No {{#if}} wrapper to hide here — the whole captured paragraph
					// (label text, fences, and the {{{field}}} placeholder itself) is
					// the editable content.
					const content = template
						.slice(start, end)
						.replace(/^\n/, "")
						.replace(/\n$/, "")
					pushCard(typeId, "systemMessage", start, end, content)
				}
				continue
			}
			if (stmt.type === "BlockStatement") {
				const def = matchBlock(stmt)
				if (def) {
					const start = offsetOf(stmt.loc.start)
					const end = offsetOf(stmt.loc.end)
					// "each" (chatMessages) stays opaque/fixed; "if" blocks expose their
					// inner text (label, fences, the {{{field}}} placeholder) as editable
					// content, same as Block cards do.
					const content =
						stmt.path?.original === "if"
							? template
									.slice(
										offsetOf(stmt.program.loc.start),
										offsetOf(stmt.program.loc.end)
									)
									.replace(/^\n/, "")
									.replace(/\n$/, "")
							: undefined
					pushCard(def.id, def.zone, start, end, content)
					// Recognized cards are opaque leaves — their contents aren't
					// decomposed into further sub-cards.
					continue
				}

				const blockRole = BLOCK_HELPER_ROLES[stmt.path?.original]
				if (blockRole) {
					// The first systemBlock found is the implicit "System Message" zone
					// container (not a card itself) — everything else is recursed into
					// flatly. Any OTHER block-helper usage (a second systemBlock, or a
					// userBlock/assistantBlock anywhere) is a generic, opaque "Block" card.
					if (
						stmt.path.original === "systemBlock" &&
						!result.systemMessageContainer
					) {
						result.systemMessageContainer = {
							start: offsetOf(stmt.program.loc.start),
							end: offsetOf(stmt.program.loc.end)
						}
						if (stmt.program) {
							walk(
								stmt.program,
								offsetOf(stmt.program.loc.start),
								offsetOf(stmt.program.loc.end)
							)
						}
						continue
					}
					const content = template
						.slice(
							offsetOf(stmt.program.loc.start),
							offsetOf(stmt.program.loc.end)
						)
						.replace(/^\n/, "")
						.replace(/\n$/, "")
					pushCard(
						"block",
						"systemMessage",
						offsetOf(stmt.loc.start),
						offsetOf(stmt.loc.end),
						content,
						blockRole
					)
					continue
				}

				if (stmt.program) {
					walk(
						stmt.program,
						offsetOf(stmt.program.loc.start),
						offsetOf(stmt.program.loc.end)
					)
				}
				if (stmt.inverse) {
					walk(
						stmt.inverse,
						offsetOf(stmt.inverse.loc.start),
						offsetOf(stmt.inverse.loc.end)
					)
				}
			}
		}
	}

	walk(ast, 0, template.length)
	result.cards.sort((a, b) => a.start - b.start)
	return result
}

/** Appends a new card at the end of its zone (or wraps a fresh system block if the zone is empty). */
export function insertContextCard(
	template: string,
	typeId: string
): { template: string; error?: string } {
	const cardType = getContextCardType(typeId)
	if (!cardType) return { template, error: "Unknown card type" }
	if (cardType.fixed)
		return { template, error: "This card can't be added manually" }

	const parsed = parseContextTemplate(template)
	if (parsed.parseError) return { template, error: parsed.parseError }

	const zoneCards = parsed.cards
		.filter((c) => c.zone === cardType.zone)
		.sort((a, b) => a.start - b.start)

	if (zoneCards.length > 0) {
		const insertAt = zoneCards[zoneCards.length - 1].end
		return {
			template:
				template.slice(0, insertAt) +
				"\n\n" +
				cardType.defaultSnippet +
				template.slice(insertAt)
		}
	}

	if (cardType.zone === "systemMessage" && parsed.systemMessageContainer) {
		const insertAt = parsed.systemMessageContainer.start
		return {
			template:
				template.slice(0, insertAt) +
				"\n" +
				cardType.defaultSnippet +
				"\n" +
				template.slice(insertAt)
		}
	}

	if (cardType.zone === "systemMessage") {
		// No system-message container exists yet — wrap our own so the added
		// content still gets proper prompt-format role wrapping.
		return {
			template: `{{#systemBlock}}\n${cardType.defaultSnippet}\n{{/systemBlock}}\n\n${template}`
		}
	}

	// postHistory zone with no existing card — append at document end.
	const trimmed = template.replace(/\s+$/, "")
	return { template: `${trimmed}\n\n${cardType.defaultSnippet}\n` }
}

/** Inserts a new card at an arbitrary position within its zone's existing card list (0 = before the first). */
export function insertContextCardAt(
	template: string,
	typeId: string,
	{ zone, index }: { zone: ContextCardZone; index: number }
): { template: string; error?: string } {
	const cardType = getContextCardType(typeId)
	if (!cardType) return { template, error: "Unknown card type" }
	if (cardType.fixed)
		return { template, error: "This card can't be added manually" }

	const parsed = parseContextTemplate(template)
	if (parsed.parseError) return { template, error: parsed.parseError }

	const zoneCards = parsed.cards
		.filter((c) => c.zone === zone)
		.sort((a, b) => a.start - b.start)

	if (zoneCards.length === 0) return insertContextCard(template, typeId)

	const clampedIndex = Math.max(0, Math.min(index, zoneCards.length))

	if (clampedIndex >= zoneCards.length) {
		const insertAt = zoneCards[zoneCards.length - 1].end
		return {
			template:
				template.slice(0, insertAt) +
				"\n\n" +
				cardType.defaultSnippet +
				template.slice(insertAt)
		}
	}

	const insertAt = zoneCards[clampedIndex].start
	return {
		template:
			template.slice(0, insertAt) +
			cardType.defaultSnippet +
			"\n\n" +
			template.slice(insertAt)
	}
}

export function removeContextCard(
	template: string,
	card: Pick<ParsedContextCard, "start" | "end">
): string {
	let end = card.end
	if (template[end] === "\n") end += 1
	return template.slice(0, card.start) + template.slice(end)
}

export function updateCustomTextCard(
	template: string,
	card: Pick<ParsedContextCard, "start" | "end">,
	newContent: string
): string {
	const snippet = `{{!-- ${CUSTOM_TEXT_OPEN_MARKER} --}}\n${newContent}\n{{!-- ${CUSTOM_TEXT_CLOSE_MARKER} --}}`
	return template.slice(0, card.start) + snippet + template.slice(card.end)
}

const BLOCK_ROLE_HELPER: Record<ContextBlockRole, string> = {
	system: "systemBlock",
	user: "userBlock",
	assistant: "assistantBlock"
}

export function updateBlockCard(
	template: string,
	card: Pick<ParsedContextCard, "start" | "end">,
	{ role, content }: { role: ContextBlockRole; content: string }
): string {
	const helper = BLOCK_ROLE_HELPER[role]
	const snippet = `{{#${helper}}}\n${content}\n{{/${helper}}}`
	return template.slice(0, card.start) + snippet + template.slice(card.end)
}

/**
 * Edits a field-backed card's wrapper text (labels, ``` fences, and the
 * {{{field}}} placeholder itself) — the same freeform text captured on
 * `card.content` for currentDate/instructions/characters/personas/scenario/
 * worldLore/history/narrativeGraph/exampleDialogue/postHistoryInstructions.
 * Always re-serializes as an `{{#if field}}...{{/if}}` block, so editing a
 * legacy bare-mustache card upgrades it to the guarded form in the process.
 */
export function updateFieldCardContent(
	template: string,
	card: Pick<ParsedContextCard, "start" | "end" | "typeId">,
	newContent: string
): string {
	const cardType = getContextCardType(card.typeId)
	if (!cardType?.field) return template
	const snippet = `{{#if ${cardType.field}}}\n${newContent}\n{{/if}}`
	return template.slice(0, card.start) + snippet + template.slice(card.end)
}

/**
 * Rebuilds one zone's cards in a new order. `orderedKeys` must contain
 * exactly the same set of card `key`s currently present in that zone
 * (keys, not type ids, so repeatable card types like Custom Text reorder correctly).
 */
export function reorderContextCards(
	template: string,
	zone: ContextCardZone,
	orderedKeys: string[]
): string {
	const parsed = parseContextTemplate(template)
	const zoneCards = parsed.cards
		.filter((c) => c.zone === zone)
		.sort((a, b) => a.start - b.start)

	if (zoneCards.length !== orderedKeys.length || zoneCards.length === 0)
		return template

	const textByKey = new Map(
		zoneCards.map((c) => [c.key, template.slice(c.start, c.end)])
	)
	if (orderedKeys.some((key) => !textByKey.has(key))) return template

	// Each gap (whitespace, or hand-written prose the parser doesn't
	// recognize as its own card) "belongs" to the card immediately before
	// it — kept attached to that card, not to a position, so reordering
	// can't relocate text written between two specific cards to sit between
	// a different, unrelated pair just because they end up adjacent.
	const gapAfterKey = new Map<string, string>()
	for (let i = 0; i < zoneCards.length - 1; i++) {
		gapAfterKey.set(
			zoneCards[i].key,
			template.slice(zoneCards[i].end, zoneCards[i + 1].start)
		)
	}

	let rebuilt = textByKey.get(orderedKeys[0])!
	const usedGapKeys = new Set<string>()
	for (let i = 1; i < orderedKeys.length; i++) {
		const prevKey = orderedKeys[i - 1]
		// A card that used to be last (no recorded gap) may now have a
		// successor for the first time — fall back to the same "\n\n"
		// separator insertContextCard/insertContextCardAt use elsewhere.
		const gap = gapAfterKey.get(prevKey) ?? "\n\n"
		usedGapKeys.add(prevKey)
		rebuilt += gap + textByKey.get(orderedKeys[i])!
	}
	// A gap whose card no longer has anything after it (eg. that card moved
	// to the last position) would otherwise vanish entirely — append it
	// after the rebuilt content instead of dropping it. It can no longer
	// sit "between these two specific cards" (there's no longer a second
	// card for it to precede), but the text itself is never lost.
	for (const [key, gap] of gapAfterKey) {
		if (!usedGapKeys.has(key)) rebuilt += gap
	}

	return (
		template.slice(0, zoneCards[0].start) +
		rebuilt +
		template.slice(zoneCards[zoneCards.length - 1].end)
	)
}
