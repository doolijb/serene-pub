/**
 * The parity corpus.
 *
 * Both prompt paths, same rows, byte-for-byte. This is the gate on deleting the
 * legacy path (08 §5), and `parityGate` fails an empty corpus on purpose:
 * "nothing was checked" and "nothing failed" look identical in a summary and
 * only one of them is safe.
 *
 * Eight fixtures, all green: one-to-one and group chats, macros inside character
 * cards, the six-way post-history split, dated history entries, the two
 * visibility filters, narrator mode, and twelve near-identical lore entries
 * competing for one budget.
 *
 * RAG is compared in `parity.rag.int.test.ts` rather than here: the two arms need
 * opposite worlds — this file asserts no embedding model is loaded, that one
 * asserts there is one — and mocking is per-file.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { runFixture, type ParityFixture, type RenderConfigs } from "./parity"
import { renderParity, parityGate } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"

vi.mock("$lib/server/embedding", () => ({
	// The keyword arm alone. RAG has its own fixtures once this one is green;
	// adding a second variable to a red comparison makes neither diagnosable.
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb
let configs: RenderConfigs

/**
 * The template both paths render.
 *
 * Deliberately exercises the blobs rather than a minimal string: `characters`
 * and `personas` are consumed as raw JSON by the real default templates, so a
 * whitespace difference is a prompt difference, and a corpus that renders only
 * `{{instructions}}` would never see it.
 */
const TEMPLATE = [
	"{{instructions}}",
	"CHARACTERS:{{{characters}}}",
	"PERSONAS:{{{personas}}}",
	"NAMES:{{characterNames}}|{{personaNames}}",
	"MACROS:{{char}}|{{character}}|{{user}}|{{persona}}",
	"SCENARIO:{{scenario}}",
	"EXAMPLES:{{{exampleDialogue}}}",
	"POSTHISTORY:{{{postHistoryInstructions}}}",
	"WORLDLORE:{{{worldLore}}}",
	"HISTORY:{{{history}}}",
	"DATE:{{currentDate}}",
	"RELATIONSHIPS:{{{speakerRelationships}}}",
	// The reminder block the default template renders inside the message loop,
	// gated the same way — this is where `postHistory.hasContent` and the
	// three texts inside it actually reach a prompt.
	"{{#if postHistory.hasContent}}REMINDER:{{{postHistory.instructions}}}|{{{postHistory.charInstructions}}}|{{{postHistory.exampleDialogue}}}{{/if}}",
	// `message` and `name`, not `content` — the real default template renders
	// `{{{name}}}: {{{message}}}` (defaults.ts:296). The first version of this
	// fixture guessed `content`, which made *both* sides render blank message
	// lines and agree for the wrong reason.
	"{{#each chatMessages}}{{this.name}}: {{this.message}}",
	"{{/each}}"
].join("\n")

beforeAll(async () => {
	db = await createTestDb()

	const [contextConfig] = await db
		.insert(schema.contextConfigs)
		.values({ name: "Parity Context", template: TEMPLATE })
		.returning()

	const [promptConfig] = await db
		.insert(schema.promptConfigs)
		.values({
			name: "Parity Prompt",
			systemPrompt: "You are {{char}}, speaking with {{user}}."
		})
		.returning()

	await db.insert(schema.systemSettings).values({
		id: 1,
		defaultContextConfigId: contextConfig.id,
		defaultPromptConfigId: promptConfig.id
	})

	configs = {
		connection: { id: 1, promptFormat: "vicuna", extraJson: {} },
		sampling: { contextTokensEnabled: false },
		contextConfig,
		promptConfig
	}
}, 60_000)

/**
 * The rows a fixture needs, written once.
 *
 * Each fixture seeds its own user and chat rather than sharing one, so a fixture
 * that leaves state behind cannot make the next one pass or fail for reasons
 * that are not in its own description.
 */
async function seedWorld(
	db: any,
	opts: {
		characters: Array<Record<string, unknown>>
		personas?: Array<Record<string, unknown>>
		lore?: Array<Record<string, unknown>>
		messages: Array<{ role: string; content: string; speaker?: number }>
		isGroup?: boolean
		chatScenario?: string
	}
) {
	const [user] = await db
		.insert(schema.users)
		.values({ username: `parity-${nextSuffix()}`, isAdmin: false })
		.returning()

	const characters: any[] = []
	for (const c of opts.characters)
		characters.push(
			(
				await db
					.insert(schema.characters)
					.values({ userId: user.id, ...c })
					.returning()
			)[0]
		)

	const personas: any[] = []
	for (const p of opts.personas ?? [
		{ name: "Bob", description: "A traveller." }
	])
		personas.push(
			(
				await db
					.insert(schema.personas)
					.values({ userId: user.id, isDefault: false, ...p })
					.returning()
			)[0]
		)

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Parity Lore", userId: user.id })
		.returning()

	if (opts.lore?.length)
		await db.insert(schema.worldLoreEntries).values(
			opts.lore.map((l) => ({
				lorebookId: lorebook.id,
				retrievalStrategy: "keyword",
				...l
			}))
		)

	const [chat] = await db
		.insert(schema.chats)
		.values({
			userId: user.id,
			isGroup: opts.isGroup ?? false,
			lorebookId: lorebook.id,
			...(opts.chatScenario ? { scenario: opts.chatScenario } : {})
		})
		.returning()

	for (const c of characters)
		await db.insert(schema.chatCharacters).values({
			chatId: chat.id,
			characterId: c.id,
			isActive: true,
			visibility: "visible"
		})
	for (const p of personas)
		await db
			.insert(schema.chatPersonas)
			.values({ chatId: chat.id, personaId: p.id })

	await db.insert(schema.chatMessages).values(
		opts.messages.map((m) => ({
			chatId: chat.id,
			role: m.role,
			content: m.content,
			// Who said it, so the naming rules have something to resolve. A
			// group chat where every assistant line is unattributed would not
			// exercise them at all.
			...(m.role === "assistant"
				? { characterId: characters[m.speaker ?? 0]!.id }
				: { personaId: personas[0]!.id })
		}))
	)

	return { user, characters, personas, chat, lorebook }
}

/** Usernames must be unique across fixtures in one database. */
let suffix = 0
const nextSuffix = () => `${++suffix}`

const ASHGUARD = {
	name: "The Ashguard",
	keys: "ashguard",
	content: "Riders who patrol the ash wastes."
}

/** One character, one persona, one lore entry, a short history. */
const oneOnOne: ParityFixture = {
	name: "chat/one-on-one",
	async seed(db: any) {
		const w = await seedWorld(db, {
			characters: [
				{
					name: "Alice",
					description: "A knight sworn to {{user}}.",
					personality: "Steady.",
					scenario: "In the keep at dusk."
				}
			],
			lore: [ASHGUARD],
			messages: [
				{ role: "user", content: "Well met." },
				{ role: "assistant", content: "And you." },
				{ role: "user", content: "Have you seen the ashguard?" }
			]
		})
		return {
			chatId: w.chat.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Have you seen the ashguard?"
		}
	}
}

/**
 * Two characters, both speaking.
 *
 * Exercises what a one-to-one chat cannot: `{{characterNames}}` as a joined
 * list, per-message name resolution across two speakers, and the group-chat
 * scenario rule — a group with no scenario of its own renders none rather than
 * one member's.
 */
const groupChat: ParityFixture = {
	name: "chat/group",
	async seed(db: any) {
		const w = await seedWorld(db, {
			isGroup: true,
			characters: [
				{
					name: "Alice",
					description: "A knight sworn to {{user}}.",
					personality: "Steady.",
					scenario: "In the keep at dusk."
				},
				{ name: "Cara", description: "A scout who knows the wastes." }
			],
			lore: [ASHGUARD],
			messages: [
				{ role: "user", content: "Who rides the wastes?" },
				{ role: "assistant", content: "The ashguard do.", speaker: 1 },
				{ role: "assistant", content: "So I have heard.", speaker: 0 },
				{ role: "user", content: "Tell me of the ashguard." }
			]
		})
		return {
			chatId: w.chat.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Tell me of the ashguard."
		}
	}
}

/**
 * A character whose card carries macros in every interpolated field.
 *
 * The blobs are consumed as raw JSON, so an interpolation difference inside a
 * card is a prompt difference that no amount of template testing would show.
 */
const macroHeavy: ParityFixture = {
	name: "chat/macros-in-cards",
	async seed(db: any) {
		const w = await seedWorld(db, {
			characters: [
				{
					name: "Alice",
					nickname: "The Knight of {{user}}",
					description:
						"{{char}} serves {{user}}. {{user}} calls {{char}} by name.",
					personality: "Loyal to {{user}} above all.",
					scenario: "{{char}} waits for {{user}} at the gate."
				}
			],
			personas: [
				{ name: "Bob", description: "A traveller who seeks {{char}}." }
			],
			messages: [{ role: "user", content: "Are you there?" }]
		})
		return {
			chatId: w.chat.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Are you there?"
		}
	}
}

/**
 * A prompt config with reinforcement text, and a character carrying its own.
 *
 * The six-text split lives or dies here: the config's `postHistoryInstructions`
 * renders in one place, the character's in another, and they are different
 * fields that carry the same kind of string.
 */
const postHistory: ParityFixture = {
	name: "chat/post-history",
	async seed(db: any) {
		const [config] = await db
			.insert(schema.promptConfigs)
			.values({
				name: `Reinforced ${nextSuffix()}`,
				systemPrompt: "You are {{char}}.",
				postHistoryInstructions: "Stay in character, {{char}}."
			})
			.returning()

		const w = await seedWorld(db, {
			characters: [
				{
					name: "Alice",
					description: "A knight.",
					postHistoryInstructions: "Alice never lies to {{user}}.",
					// Exactly one. With two, the legacy path rolls
					// `Math.random()` mid-compile and the pipeline uses the
					// run-seeded RNG, so the field is **unmeasurable by
					// construction** — the two paths would disagree at random
					// and the corpus would report a defect that is not one.
					// That unmeasurability is the argument for the ruling in
					// §7, not a gap in it; the pipeline's own determinism is
					// pinned in `templateContextBinding.int.test.ts`.
					exampleDialogues: ["Alice: Well met."]
				}
			],
			messages: [{ role: "user", content: "Speak." }]
		})
		return {
			chatId: w.chat.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Speak.",
			promptConfigId: config.id
		}
	}
}

/**
 * Dated history entries.
 *
 * `{{history}}` is keyed by a formatted date and sorted newest first, and
 * `{{currentDate}}` comes from the newest one. Partial dates matter: a lorebook
 * that records only a year must not render as though it recorded a day.
 */
const datedHistory: ParityFixture = {
	name: "chat/history-entries",
	async seed(db: any) {
		const w = await seedWorld(db, {
			characters: [{ name: "Alice", description: "A knight." }],
			messages: [{ role: "user", content: "What happened at the siege?" }]
		})
		await db.insert(schema.historyEntries).values([
			{
				lorebookId: w.lorebook.id,
				name: "The siege",
				keys: "siege",
				content: "The wall fell.",
				year: 1204,
				month: 3,
				day: 7
			},
			{
				lorebookId: w.lorebook.id,
				name: "The founding",
				keys: "siege",
				content: "The keep was raised.",
				year: 1180
			}
		])
		return {
			chatId: w.chat.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "What happened at the siege?"
		}
	}
}

/**
 * A hidden character and an inactive one.
 *
 * The two visibility filters are not the same filter — the cards include an
 * inactive character and exclude a hidden one unless they are the speaker,
 * while the joined names exclude both. This is the fixture that holds that
 * apart; collapsing them is the obvious cleanup and it changes prompts.
 */
const mixedVisibility: ParityFixture = {
	name: "chat/visibility",
	async seed(db: any) {
		const w = await seedWorld(db, {
			characters: [
				{ name: "Alice", description: "A knight." },
				{ name: "Cara", description: "A scout." },
				{ name: "Dala", description: "A spy." }
			],
			messages: [{ role: "user", content: "Who is here?" }]
		})
		const { eq, and } = await import("drizzle-orm")
		await db
			.update(schema.chatCharacters)
			.set({ isActive: false })
			.where(
				and(
					eq(schema.chatCharacters.chatId, w.chat.id),
					eq(schema.chatCharacters.characterId, w.characters[1]!.id)
				)
			)
		await db
			.update(schema.chatCharacters)
			.set({ visibility: "hidden" })
			.where(
				and(
					eq(schema.chatCharacters.chatId, w.chat.id),
					eq(schema.chatCharacters.characterId, w.characters[2]!.id)
				)
			)
		return {
			chatId: w.chat.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Who is here?"
		}
	}
}

/**
 * No-perspective (Narrator) mode.
 *
 * `currentCharacterId` is null, and almost every rule branches on that:
 * `{{char}}` becomes the joined cast list rather than one name, the config's own
 * `postHistoryInstructions` becomes the top-level text instead of a character's,
 * and no character scenario can win because there is no current character to
 * take one from.
 */
const narrator: ParityFixture = {
	name: "chat/narrator",
	async seed(db: any) {
		const [config] = await db
			.insert(schema.promptConfigs)
			.values({
				name: `Narrator ${nextSuffix()}`,
				systemPrompt: "Narrate the scene for {{user}}.",
				postHistoryInstructions: "Describe, do not speak as {{char}}."
			})
			.returning()

		const w = await seedWorld(db, {
			characters: [
				{
					name: "Alice",
					description: "A knight.",
					scenario: "Never used: there is no current character."
				},
				{ name: "Cara", description: "A scout." }
			],
			lore: [ASHGUARD],
			messages: [
				{ role: "user", content: "What do I see?" },
				{ role: "assistant", content: "Ash, and riders.", speaker: 0 },
				{ role: "user", content: "Tell me of the ashguard." }
			]
		})
		return {
			chatId: w.chat.id,
			userId: w.user.id,
			// The mode itself.
			currentCharacterId: null,
			text: "Tell me of the ashguard.",
			promptConfigId: config.id
		}
	}
}

/**
 * More lore than fits.
 *
 * The one fixture where the two paths are not doing the same thing by
 * construction: legacy renders everything and then **trims from the back** until
 * the token count fits, while the pipeline **allocates by score up front** and
 * never renders what it excluded. Those agree only when the score order and the
 * trim order agree.
 *
 * It is in the corpus precisely because it is the hard case, and it is the
 * fixture that found the tf-idf defect: the pipeline scored twelve
 * near-identical entries *apart* where legacy tied them, because its `tf` came
 * from the entry's own text rather than from the recent conversation. Ordering
 * is user-visible — it is the order lore reaches the model.
 */
const overBudget: ParityFixture = {
	name: "chat/over-budget",
	async seed(db: any) {
		// Distinct `position` values, deliberately. With every entry at the
		// default 0 the tie-break falls through to whatever order the database
		// happened to return, on **both** paths — neither issues an ORDER BY —
		// so the resulting lore order is arbitrary and parity is unmeasurable
		// rather than failing. See §16; that arbitrariness is itself a finding.
		const lore = Array.from({ length: 12 }, (_, i) => ({
			name: `Entry ${i}`,
			keys: "ashguard",
			position: i,
			content: `Ashguard fact ${i}: ${"detail ".repeat(20)}`.trim()
		}))
		const w = await seedWorld(db, {
			characters: [{ name: "Alice", description: "A knight." }],
			lore,
			messages: [{ role: "user", content: "Tell me of the ashguard." }]
		})
		return {
			chatId: w.chat.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Tell me of the ashguard."
		}
	}
}

/** Fixtures the two paths agree on, byte for byte. The gate runs on these. */
/**
 * The chat above, rendered by the **template Serene Pub actually ships**.
 *
 * Every other fixture uses a template written for this corpus, which turns out
 * to be a real gap: the shipped one renders the post-history reminder *inside*
 * the message loop, gated on the message index, and a corpus template that
 * renders `postHistory.*` outside the loop cannot express a position at all.
 * Eight green fixtures missed a reminder landing at the top of the conversation
 * instead of next to the generation point, and comparing one real chat found it
 * immediately.
 *
 * Read from the seeded row rather than pasted here, so it cannot drift from what
 * users get.
 */
const shippedTemplate: ParityFixture = {
	name: "chat/shipped-template",
	async seed(db: any) {
		const { DEFAULT_CONTEXT_TEMPLATE } = await import(
			"$lib/server/db/defaults"
		)
		const [shipped] = await db
			.insert(schema.contextConfigs)
			.values({
				name: `Shipped ${nextSuffix()}`,
				template: DEFAULT_CONTEXT_TEMPLATE
			})
			.returning()

		const [config] = await db
			.insert(schema.promptConfigs)
			.values({
				name: `Shipped ${nextSuffix()}`,
				systemPrompt: "You are {{char}}.",
				postHistoryInstructions:
					"Remember: you are {{char}}, speaking with {{user}}.",
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 0
			})
			.returning()

		const w = await seedWorld(db, {
			characters: [
				{ name: "Alice", description: "A knight sworn to {{user}}." }
			],
			lore: [ASHGUARD],
			messages: [
				{ role: "user", content: "Well met." },
				{ role: "assistant", content: "And you." },
				{ role: "user", content: "Have you seen the ashguard?" }
			]
		})

		return {
			chatId: w.chat.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Have you seen the ashguard?",
			promptConfigId: config.id,
			// Declared rather than written directly to system settings: the
			// harness sets every instance default on every fixture, so a
			// fixture that wrote its own would leak into the next one.
			contextConfigId: shipped.id
		}
	}
}

const CORPUS = [
	shippedTemplate,
	oneOnOne,
	groupChat,
	macroHeavy,
	postHistory,
	datedHistory,
	mixedVisibility,
	narrator,
	overBudget
]

/**
 * Known divergences, each with a reason — reported, never silently skipped.
 *
 * The list exists so a real difference can be *held* while it is investigated,
 * instead of the choice being "delete the fixture" or "leave the suite red".
 * Two rules keep it from becoming a drawer:
 *
 * - every entry names the divergence, not just the fixture;
 * - a fixture here that starts passing **fails the test**, so it gets promoted
 *   rather than sitting in the open list forever looking like a known problem.
 *
 * It is empty. `chat/over-budget` was its first and only entry, and the second
 * rule is what emptied it: fixing the tf-idf signal made the fixture pass, and
 * the suite went red until it was moved into the gate above. That is the
 * mechanism working, not a formality — a passing fixture in this list is a test
 * nobody is running.
 */
const OPEN: Array<{ fixture: ParityFixture; because: string }> = []

describe("the parity corpus", () => {
	it("has fixtures at all", () => {
		// The gate's own precondition, asserted separately so a corpus that
		// silently emptied itself fails here rather than passing everything.
		expect(CORPUS.length).toBeGreaterThan(0)
	})

	it("holds each known divergence with a reason, and promotes it when fixed", async () => {
		// An open fixture that starts passing is not good news to be ignored —
		// it is a fixture that belongs in the gate. Failing here is what makes
		// the open list shrink.
		for (const { fixture, because } of OPEN) {
			const r = await runFixture(db as any, fixture, configs)
			console.log(renderParity(r))
			expect(because.length).toBeGreaterThan(40)
			expect({ fixture: fixture.name, identical: r.identical }).toEqual({
				fixture: fixture.name,
				identical: false
			})
		}
	})

	it("reports where the paths diverge", async () => {
		const results = []
		for (const fixture of CORPUS)
			results.push(await runFixture(db as any, fixture, configs))

		const gate = parityGate(results, CORPUS.length)
		for (const r of results) console.log(renderParity(r))
		// `PARITY_FULL=1` prints both prompts in full. The excerpt around the
		// first difference is the right default — two multi-kilobyte prompts
		// side by side are unreadable — but when the divergence is structural
		// rather than local, seeing both whole is what actually finds it.
		if (process.env.PARITY_FULL) {
			const { legacyRender, pipelinePreview } = await import("./parity")
			const scope = await CORPUS[0]!.seed(db as any)
			const pv: any = await pipelinePreview(db as any, scope)
			console.log(
				"--- LEGACY ---\n" +
					(await legacyRender(db as any, scope, configs)) +
					"\n--- PIPELINE ---\n" +
					pv.preview?.context?.rendered?.rendered
			)
		}

		// Green, and asserted as green. This is the gate on deleting the legacy
		// path (08 §5) — it going red is the whole point of the file, so it
		// fails loudly with the divergence printed above rather than reporting
		// a boolean nobody reads.
		expect(gate.reason ?? "green").toBe("green")
		expect(gate.pass).toBe(true)
	})
})
