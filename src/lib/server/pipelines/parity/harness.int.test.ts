/**
 * The parity corpus.
 *
 * Both prompt paths, same rows, byte-for-byte. This is the gate on deleting the
 * legacy path (08 §5), and `parityGate` fails an empty corpus on purpose:
 * "nothing was checked" and "nothing failed" look identical in a summary and
 * only one of them is safe.
 *
 * Ten fixtures, all green: the shipped template itself, one-to-one and group
 * sessions, macros inside character cards, the six-way post-history split, dated
 * history entries, the cards-versus-names filters, a session at
 * `characterDetail: speaker-only`, narrator mode, and twelve near-identical lore entries
 * competing for one budget.
 *
 * Since 0.6 the two sides render *different templates on purpose* — the
 * headings and fences moved out of the context template and into the variable
 * layouts, so the legacy side is given 0.5's template and the pipeline today's.
 * See `legacyTemplate` on `FixtureScope`. What is compared is still one prompt
 * against another, byte for byte; what changed is that the comparison is now
 * across releases rather than within one.
 *
 * RAG is compared in `parity.rag.int.test.ts` rather than here: the two mechanisms need
 * opposite worlds — this file asserts no embedding model is loaded, that one
 * asserts there is one — and mocking is per-file.
 *
 * ## Three more measured blind spots — retrieval plan phase 1, 2026-09-06
 *
 * Recorded here rather than banked as a green, per design §10.1: *a green suite
 * is evidence only if the thing under test can move it.* Each of the four
 * controls that lane declares was perturbed to a live value and the corpus
 * re-run; two of the results are evidence and three are not.
 *
 *   · **`lexicalScoring: 'balanced'` (BM25) — the corpus sees it.**
 *     `session/over-budget` diverges, which is the twelve near-identical
 *     Ashguard entries reordering under length normalisation. The green with
 *     the switch off is therefore real evidence about this control.
 *   · **`trigramFolding` — the corpus cannot see it, at any strength.** Green at
 *     0.5 and green at 1. Every key in every fixture is a single common word
 *     that is either present verbatim or absent from an unrelated topic, so
 *     there are no near-misses for folding to catch and nothing for it to add.
 *   · **`titleWeight: 3` — the corpus cannot see it, and the reason generalises
 *     beyond this control.** `normaliseTfidf` divides the whole pool by its own
 *     maximum, so *any* change that scales every candidate's tf-idf by the same
 *     factor is invisible downstream. Every entry in `session/over-budget` is
 *     titled `Ashguard fact N` and shares the term the window carries, so
 *     tripling the title's weight triples all twelve alike and normalisation
 *     divides it straight back out. This is worth remembering before reading any
 *     future green about a tf-idf change: only a change that is *non-uniform
 *     across the pool* survives that step.
 *   · **`signalProximity` — the corpus cannot see it, structurally.** Every lore
 *     entry in every fixture has **exactly one key** (`ashguard`, `gate`,
 *     `siege`), and proximity is the distance between two matched keys, so the
 *     signal is 0 on every candidate here whatever it is weighted. This is bug
 *     17's shape exactly — a signal that could never fire on the corpus that
 *     was passing for it — and closing it needs a fixture with a multi-key
 *     entry, which is a new fixture rather than an edit to one of these.
 *
 * ## ⚠ The largest blind spot, measured — retrieval plan phases 2/3, 2026-09-06
 *
 * **This corpus can no longer see lore *scoring* at all**, and the measurement
 * is blunt: with **every lore signal weight set to 0** — keyword, name match,
 * entity overlap, tf-idf, last-referred, the priority bonus, the lot — all
 * eleven gate fixtures stay byte-identical. So does setting the three mechanism
 * strengths to 0. Nothing about how a lore entry is *ranked* is under this gate.
 *
 * It is green because these fixtures do not contend: each one's lore fits its
 * band, so `select` keeps everything and ties fall through to authored position,
 * which is the order the goldens hold. `session/over-budget` is the one fixture
 * with real contention and its twelve entries are near-identical by
 * construction, so they tie under any weighting and the cut lands in the same
 * place.
 *
 * `session/entity-cooccurrence` was the exception — 1.17.0 promoted it into the
 * gate for exactly this reason, as *"the only fixture in the corpus whose lore
 * can be reordered by a signal"* — and it has since become a deliberate
 * departure (see `DEPARTED`). So the coverage it carried is **gone from this
 * file**, and pretending otherwise is what §10.1 forbids.
 *
 * What this gate still holds is everything up to and including selection's
 * *shape*: which gather branches produce candidates, what the visibility rules withhold,
 * what the budget cuts, and every byte of assembly and rendering. What it does
 * not hold is the ordering within a band. That moved to unit coverage —
 * `ranking/select.test.ts` for the weighted sum and the mechanism strengths,
 * `ranking/keywordQuery.test.ts` for the graded entity overlap, and
 * `runtime/nodeParams.test.ts` for each declared weight reaching the scorer —
 * where a fixture can be built to discriminate rather than found to.
 *
 * Closing it here needs a fixture whose lore genuinely competes on score, and
 * a golden for one is a `v0.5.1-beta` capture rather than anything this tree can
 * produce.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	runFixture,
	type ParityFixture,
	type RenderConfigs
} from "$lib/server/pipelines/parity/harness"
import { wrapFor } from "$lib/server/pipelines/entities/variableLayouts"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { renderParity, parityGate, splitCandidates } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import {
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	entryInsert
} from "$lib/server/utils/lorebookEntries"
import { score } from "$lib/server/pipelines/ranking/select"
import { DEFAULT_SIGNAL_WEIGHTS } from "$lib/server/pipelines/ranking/weights"

vi.mock("$lib/server/embedding", () => ({
	// The keyword mechanism alone. RAG has its own fixtures once this one is green;
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
 *
 * ## Two variants, one source
 *
 * 0.6 moved the headings and fences out of the context template and into the
 * variable layouts, so a single template can no longer stand for both sides:
 * the pipeline renders one that writes no wrappers and supplies values that
 * carry them, and 0.5's builder does the reverse. Handing both the same string
 * would report the release's whole point as a divergence.
 *
 * Built from `wrapFor` rather than typed out twice, so the legacy variant is
 * whatever the layouts actually ship — a wrapper edited in `variableLayouts.ts`
 * moves this side of the comparison with it, and cannot quietly move only one.
 *
 * The wrapped variables are read through a **triple** stash here where 0.5's
 * corpus used a double one for some of them. That is not a loosening: a wrapped
 * value carries the fence's own `"""`, which a double stash HTML-escapes into
 * `&quot;&quot;&quot;`. `characterNames` and `personaNames` keep their double
 * stashes, so the escaping path is still covered by something.
 */
const corpusTemplate = (wrappers: "template" | "layouts") => {
	const v = (key: string) => {
		const expr = `{{{${key}}}}`
		const wrap = wrapFor(key)
		if (!wrap) return expr
		const body = wrappers === "template" ? wrap(expr) : expr
		// Guarded the way the shipped template guards, and the guard is what
		// makes the comparison mean anything. Unguarded, 0.5 wrote the heading
		// and an empty fence for a session with no history — `HISTORY:Story
		// history:` above three blank backticks — because nothing stopped it.
		// 0.6 renders nothing there, which is better and is still a difference.
		// Pairing an unguarded template with wrapping layouts is a combination
		// the product does not ship: core's template guards, and a template
		// somebody wrote is pinned to the bare layouts by
		// `migrateContextWrappers`. A corpus that tested it would be reporting
		// a state no install can reach.
		return `{{#if ${key}}}${body}{{/if}}`
	}
	return [
		`${v("instructions")}`,
		`CHARACTERS:${v("characters")}`,
		`PERSONAS:${v("personas")}`,
		"NAMES:{{characterNames}}|{{personaNames}}",
		"MACROS:{{char}}|{{character}}|{{user}}|{{persona}}",
		`SCENARIO:${v("scenario")}`,
		"EXAMPLES:{{{exampleDialogue}}}",
		"POSTHISTORY:{{{postHistoryInstructions}}}",
		`WORLDLORE:${v("worldLore")}`,
		`HISTORY:${v("history")}`,
		`DATE:${v("currentDate")}`,
		"RELATIONSHIPS:{{{speakerRelationships}}}",
		// The reminder block the default template renders inside the message loop,
		// gated the same way — this is where `postHistory.hasContent` and the
		// three texts inside it actually reach a prompt.
		"{{#if postHistory.hasContent}}REMINDER:{{{postHistory.instructions}}}|{{{postHistory.charInstructions}}}|{{{postHistory.exampleDialogue}}}{{/if}}",
		// `message` and `name`, not `content` — the real default template renders
		// `{{{name}}}: {{{message}}}` (defaults.ts:296). The first version of this
		// fixture guessed `content`, which made *both* sides render blank message
		// lines and agree for the wrong reason.
		"{{#each sessionMessages}}{{this.name}}: {{this.message}}",
		"{{/each}}"
	].join("\n")
}

/** What the pipeline renders: structure only, wrappers supplied by layouts. */
const TEMPLATE = corpusTemplate("layouts")
/** What 0.5 rendered: the same prompt, with the wrappers typed in. */
const LEGACY_TEMPLATE = corpusTemplate("template")

beforeAll(async () => {
	db = await createTestDb()

	// Publish core's specs the way the app boots (2026-09-27, characterDetail
	// genre field): a genre is declared on its create spec's version row, so
	// without `create-chat` published the Chat genre and its declared fields
	// do not exist, and `genreFieldsFor` drops a session's stored
	// `characterDetail` (`session/all-hidden` rendered at `full`).
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [contextConfig] = await db
		.insert(schema.contextConfigs)
		.values({ name: "Parity Context", template: LEGACY_TEMPLATE })
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
		// Empty is what "the context budget is switched off" resolves to now, and
		// both sides of the parity comparison get the same object either way.
		sampling: {},
		contextConfig,
		promptConfig
	}
}, 60_000)

/**
 * The rows a fixture needs, written once.
 *
 * Each fixture seeds its own user and session rather than sharing one, so a fixture
 * that leaves state behind cannot make the next one pass or fail for reasons
 * that are not in its own description.
 */
async function seedWorld(
	db: Db,
	opts: {
		characters: Array<Omit<InsertCharacter, "userId">>
		personas?: Array<
			Omit<InsertCharacter, "userId" | "isPersona" | "isDefaultPersona"> & {
				isDefaultPersona?: boolean
			}
		>
		lore?: Array<Record<string, unknown>>
		messages: Array<{ role: string; content: string; speaker?: number }>
		isGroup?: boolean
		sessionScenario?: string
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
					.insert(schema.characters)
					.values({ userId: user.id, isPersona: true, ...p })
					.returning()
			)[0]
		)

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Parity Lore", userId: user.id })
		.returning()

	if (opts.lore?.length)
		await db.insert(schema.lorebookEntries).values(
			opts.lore.map((l, i) =>
				entryInsert({
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: lorebook.id,
					// `position` is unique per (lorebook, type) and has no
					// column default on the one table, so a fixture states it.
					position: i + 1,
					...l
				})
			)
		)

	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: opts.isGroup ?? false,
			lorebookId: lorebook.id,
			...(opts.sessionScenario ? { scenario: opts.sessionScenario } : {})
		})
		.returning()

	for (const c of characters)
		await db.insert(schema.sessionCharacters).values({
			sessionId: session.id,
			characterId: c.id,
			isActive: true,
		})
	for (const p of personas)
		await db
			.insert(schema.sessionPersonas)
			.values({ sessionId: session.id, personaId: p.id })

	await db.insert(schema.sessionMessages).values(
		opts.messages.map((m) => ({
			sessionId: session.id,
			role: m.role,
			content: m.content,
			// Who said it, so the naming rules have something to resolve. A
			// group session where every assistant line is unattributed would not
			// exercise them at all.
			...(m.role === "assistant"
				? { characterId: characters[m.speaker ?? 0]!.id }
				: { personaId: personas[0]!.id })
		}))
	)

	return { user, characters, personas, session, lorebook }
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
	name: "session/one-on-one",
	async seed(db) {
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
			sessionId: w.session.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Have you seen the ashguard?"
		}
	}
}

/**
 * Two characters, both speaking.
 *
 * Exercises what a one-to-one session cannot: `{{characterNames}}` as a joined
 * list, per-message name resolution across two speakers, and the group-session
 * scenario rule — a group with no scenario of its own renders none rather than
 * one member's.
 */
const groupSession: ParityFixture = {
	name: "session/group",
	async seed(db) {
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
			sessionId: w.session.id,
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
	name: "session/macros-in-cards",
	async seed(db) {
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
			sessionId: w.session.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Are you there?"
		}
	}
}

/**
 * A lore entry carrying the two things only the legacy engines used to handle.
 *
 * The corpus had **no** `@@` decorator and **no** `{{char:#}}` binding anywhere
 * in it, which is why it stayed green while the pipeline path did neither:
 * `populateLorebookEntryBindings` was reachable only from the two 0.5 retrieval
 * paths, so decorator lines reached models as literal text and binding
 * placeholders arrived unsubstituted. The legacy side of this very harness
 * strips and substitutes both, so this fixture diverges the moment the pipeline
 * stops — which is the whole job of a fixture here.
 *
 * `handlebarsLint.ts` tells users decorators are "stripped from the rendered
 * prompt". This is the test that makes that sentence true.
 */
const decoratedLore: ParityFixture = {
	name: "session/decorated-lore",
	async seed(db) {
		const w = await seedWorld(db, {
			characters: [
				{ name: "Alice", description: "A knight of the gate." }
			],
			personas: [{ name: "Bob", description: "A traveller." }],
			lore: [
				{
					name: "The Gate",
					keys: "gate",
					content:
						"@@depth 4\n@@role system\n" +
						"{{char:1}} has held the gate since the winter. " +
						"Travellers say {{char:1}} never sleeps."
				}
			],
			messages: [{ role: "user", content: "Tell me about the gate." }]
		})

		// The binding that gives `{{char:1}}` a name. Without a row here the
		// substitution has nothing to resolve and the placeholder would survive
		// on *both* paths, which would make the fixture agree for the wrong
		// reason.
		await db.insert(schema.lorebookBindings).values({
			lorebookId: w.lorebook.id,
			characterId: w.characters[0]!.id,
			binding: "{{char:1}}"
		})

		return {
			sessionId: w.session.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Tell me about the gate."
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
	name: "session/post-history",
	async seed(db) {
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
			sessionId: w.session.id,
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
	name: "session/history-entries",
	async seed(db) {
		const w = await seedWorld(db, {
			characters: [{ name: "Alice", description: "A knight." }],
			messages: [{ role: "user", content: "What happened at the siege?" }]
		})
		await db.insert(schema.lorebookEntries).values([
			entryInsert({
				typeId: HISTORY_TYPE_ID,
				lorebookId: w.lorebook.id,
				position: 1,
				keys: "siege",
				content: "The wall fell.",
				year: 1204,
				month: 3,
				day: 7
			}),
			entryInsert({
				typeId: HISTORY_TYPE_ID,
				lorebookId: w.lorebook.id,
				position: 2,
				keys: "siege",
				content: "The keep was raised.",
				year: 1180
			})
		])
		return {
			sessionId: w.session.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "What happened at the siege?"
		}
	}
}

/**
 * A switched-off character beside the speaker.
 *
 * The two filters are not the same filter — the cards include a switched-off
 * character while the joined names exclude them. This is the fixture that
 * holds that apart; collapsing them is the obvious cleanup and it changes
 * prompts.
 *
 * ⚠ **Dala is gone from the seed (2026-09-27), and the golden did not move.**
 * She was the per-character *hidden* half of this fixture, and that setting
 * is retired: the session-wide `characterDetail` genre field replaced it, and
 * no level of it hides one non-speaker while showing another. A hidden
 * non-speaker contributed **no byte** to 0.5's prompt — no card, no name — so
 * the frozen capture is exactly what this world renders without her, and it
 * stays a capture rather than becoming a derivation. The hidden rule itself
 * is held by `session/all-hidden`, now through `characterDetail:
 * speaker-only`.
 */
const mixedVisibility: ParityFixture = {
	name: "session/visibility",
	async seed(db) {
		const w = await seedWorld(db, {
			characters: [
				{ name: "Alice", description: "A knight." },
				{ name: "Cara", description: "A scout." }
			],
			messages: [{ role: "user", content: "Who is here?" }]
		})
		const { eq, and } = await import("drizzle-orm")
		await db
			.update(schema.sessionCharacters)
			.set({ isActive: false })
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, w.session.id),
					eq(
						schema.sessionCharacters.characterId,
						w.characters[1]!.id
					)
				)
			)
		return {
			sessionId: w.session.id,
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
	name: "session/narrator",
	async seed(db) {
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
			sessionId: w.session.id,
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
	name: "session/over-budget",
	async seed(db) {
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
			sessionId: w.session.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Tell me of the ashguard."
		}
	}
}

/**
 * A cast name inside a lore entry's own name — the co-occurrence signal.
 *
 * The corpus was **blind** to `entityCooccurrence` until this fixture. Its cast
 * (Alice, Bob, Cara, Dala) was chosen independently of its lore vocabulary
 * (Ashguard, Silverwood, Gate, siege), so the signal scored 0 on every one of
 * the frozen fixtures while carrying a weight of 0.2 — the second-heaviest of
 * the six. Any change to entity scoring passed parity for free.
 *
 * Two entries share one key, so `keyword` and `lastRefRecency` are equal and
 * the order is decided by the two signals that differ. Measured through the
 * `worldLore` query node, not assumed:
 *
 *   The Ashguard Riders  cooccurrence 0 · tfidf 0.405465 → 0.489551
 *   Alice Keeps Vigil    cooccurrence 1 · tfidf 0.135155 → 0.662520
 *
 * so 0.5 renders `Alice Keeps Vigil` **first**, against its authored position.
 * Zero the co-occurrence weight and the second entry scores 0.462520, below the
 * first, and the authored order comes back. The signal is not merely non-zero
 * here — it is what decides the order, which is the only shape of fixture that
 * can catch a regression in it.
 *
 * ⚠ **This fixture was open, and for a reason that was not co-occurrence.**
 * 0.6 did not order these two by score at all: the shipped `respond` spec ran
 * its three disjoint lore gather branches through `core:task/merge-candidates@1`, whose
 * `presetScore` overrides the weighted sum, so the order was retrieval order.
 * Spec 1.17.0 concatenates instead and the fixture is in the gate; the record
 * of what it held is in the note above `OPEN`.
 *
 * The world is `session/one-on-one`'s, character for character: same cast, same
 * messages, same scenario, only the lore differs. That is about the *golden*
 * rather than the scoring. The legacy builder is deleted, so a 0.5 render of a
 * brand-new world cannot be captured; this one's golden is
 * `session__one-on-one.txt` — a real capture — with a single line replaced, and
 * `derives the co-occurrence golden from one-on-one's, changing one line`
 * asserts that the two files still differ on that line alone.
 */
const entityCooccurrence: ParityFixture = {
	name: "session/entity-cooccurrence",
	async seed(db) {
		const w = await seedWorld(db, {
			characters: [
				{
					name: "Alice",
					description: "A knight sworn to {{user}}.",
					personality: "Steady.",
					scenario: "In the keep at dusk."
				}
			],
			lore: [
				// Position 1. Named for the key it matches, which is what gives
				// it the higher tf-idf of the two — and, without the
				// co-occurrence signal, the higher total.
				{
					name: "The Ashguard Riders",
					keys: "ashguard",
					content: "Riders who patrol the ash wastes."
				},
				// Position 2, and it wins. `Alice` is a cast name, so the entry
				// co-occurs with a character the session is about even though
				// the conversation never says so.
				{
					name: "Alice Keeps Vigil",
					keys: "ashguard",
					content: "Alice keeps the gate against the ash."
				}
			],
			messages: [
				{ role: "user", content: "Well met." },
				{ role: "assistant", content: "And you." },
				{ role: "user", content: "Have you seen the ashguard?" }
			]
		})
		return {
			sessionId: w.session.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Have you seen the ashguard?"
		}
	}
}

/** Fixtures the two paths agree on, byte for byte. The gate runs on these. */
/**
 * The session above, rendered by the **template Serene Pub actually ships**.
 *
 * Every other fixture uses a template written for this corpus, which turns out
 * to be a real gap: the shipped one renders the post-history reminder *inside*
 * the message loop, gated on the message index, and a corpus template that
 * renders `postHistory.*` outside the loop cannot express a position at all.
 * Eight green fixtures missed a reminder landing at the top of the conversation
 * instead of next to the generation point, and comparing one real session found it
 * immediately.
 *
 * Read from the seeded row rather than pasted here, so it cannot drift from what
 * users get.
 */
const shippedTemplate: ParityFixture = {
	name: "session/shipped-template",
	async seed(db) {
		const { DEFAULT_CONTEXT_TEMPLATE } = await import(
			"$lib/server/db/legacyContextTemplate"
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
			sessionId: w.session.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Have you seen the ashguard?",
			promptConfigId: config.id,
			// Declared rather than written directly to system settings: the
			// harness sets every instance default on every fixture, so a
			// fixture that wrote its own would leak into the next one.
			contextConfigId: shipped.id,
			// The two real ones: `context_configs` still holds what 0.5
			// shipped, and this is what 0.6 seeds into
			// `pipeline_context_templates`. Every other fixture compares two
			// corpus templates; this one compares the two the product actually
			// has, which is where "0.6 reproduces 0.5" stops being a claim
			// about a fixture.
			pipelineTemplate: SHIPPED_CONTEXT_TEMPLATE
		}
	}
}

/**
 * Every assistant character hidden, so the *names* list is empty — at
 * `characterDetail: speaker-only` since 2026-09-27, which is the old
 * per-character *hidden* applied to the whole cast.
 *
 * Added while looking for the empty-cast case and kept for what it actually
 * found. `characterNames` and `characters` are filtered differently — the
 * level removes everyone from the names list and leaves the speaker's card in
 * place — so this renders `NAMES:|Bob`, an empty passthrough variable, beside
 * a cast that is not empty.
 *
 * It is deliberately **not** named for an empty cast, which is what was wanted
 * and is not reachable here: the speaker's card is never trimmed, so a session
 * that can take a turn always has at least one. `JSON.stringify([])` being a
 * truthy `"[]"` — the case where "empty" means something different for the cast
 * than it does for world lore — is asserted directly in
 * `variableTemplates.parity.test.ts` instead.
 */
const allHidden: ParityFixture = {
	name: "session/all-hidden",
	async seed(db) {
		const w = await seedWorld(db, {
			characters: [{ name: "Alice", description: "A knight." }],
			messages: [{ role: "user", content: "Anyone there?" }]
		})
		// The session-wide level that replaced the per-character *hidden*
		// (2026-09-27): at `speaker-only` the names list is empty with no
		// exception for the speaker, and the speaker's own card stays — the
		// two facts the 0.5 capture holds for one hidden speaker.
		const { eq } = await import("drizzle-orm")
		await db
			.update(schema.sessions)
			.set({ genreFields: { characterDetail: "speaker-only" } })
			.where(eq(schema.sessions.id, w.session.id))
		return {
			sessionId: w.session.id,
			userId: w.user.id,
			currentCharacterId: w.characters[0]!.id,
			text: "Anyone there?"
		}
	}
}

/**
 * The 0.6 counterpart of whatever template a fixture's legacy row holds.
 *
 * Applied here rather than repeated in ten `seed` functions, and spread so a
 * fixture that names its own still wins — `shippedTemplate` does, because its
 * pair is the shipped one rather than the corpus's.
 */
const withPipelineTemplate = (f: ParityFixture): ParityFixture => ({
	name: f.name,
	async seed(db) {
		return { pipelineTemplate: TEMPLATE, ...(await f.seed(db)) }
	}
})

const CORPUS = [
	shippedTemplate,
	oneOnOne,
	groupSession,
	macroHeavy,
	decoratedLore,
	postHistory,
	datedHistory,
	mixedVisibility,
	allHidden,
	narrator,
	overBudget
	// ⚠ `entityCooccurrence` is **not** here. It was promoted into the gate when
	// spec 1.17.0 stopped routing the three disjoint lore gather branches through
	// `core:task/merge-candidates@1`, and it left again when the signal it is
	// named for changed measurement. See `DEPARTED`, which is where it is now
	// held — with more assertions on it than it had in the gate, not fewer.
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
 * It is empty, for the second time, and the second rule emptied it twice.
 * `session/over-budget` was the first: fixing the tf-idf signal made it pass and
 * the suite went red until it was moved into the gate.
 * `session/entity-cooccurrence` was the second, and its entry is worth keeping
 * in the record because of what it was holding —
 *
 * > 0.5 orders lore by the weighted signal sum, so `Alice Keeps Vigil`
 * > (entityCooccurrence 1, total 0.662520) renders above `The Ashguard Riders`
 * > (0, total 0.489551) despite the later authored position. 0.6 rendered them
 * > the other way round, and **not because the signal changed** — the query
 * > node computed both totals correctly. `core:task/merge-candidates@1` stamps
 * > a reciprocal-rank `presetScore` on every candidate it passes through, and
 * > `select`'s `scoreOf` prefers `presetScore` over the weighted sum, so after
 * > the merge the order was the *retrieval* order (id ascending) and every lore
 * > signal weight was inert.
 *
 * — which was correct when two mechanisms have to be fused and wrong when disjoint
 * lists are being passed along, which is what the shipped `respond` spec did
 * until 1.17.0. It is fixed by `core:task/concat-candidates@1`: concatenation
 * is not fusion, so the node that concatenates stamps no score and the ranker
 * has something to rank. That is a live fix on the shipped path, not a harness
 * change — the golden is untouched.
 *
 * A passing fixture in this list is a test nobody is running.
 */
const OPEN: Array<{ fixture: ParityFixture; because: string }> = []

/**
 * Divergences 0.6 chose, kept apart from the ones it is still explaining.
 *
 * `OPEN` above holds a difference nobody has accounted for yet, and its second
 * rule — a fixture that starts passing fails the test — is what stops it
 * becoming a drawer. That rule cannot apply here: a **deliberate** departure
 * from 0.5 will never start passing, because 0.5's arithmetic is frozen in the
 * golden and the builder that produced it is deleted. Filing one in `OPEN`
 * would put a permanent resident in a list whose whole discipline is that
 * nothing stays.
 *
 * So the discipline here is a different one, borrowed from
 * `contextTemplateWrappers.test.ts` — which pins the *other* deliberate
 * departure, spec 1.9.0's split of the relationships block. **Say precisely
 * what differs, and assert that nothing else does.** A departure nobody has
 * bounded is indistinguishable from a regression that happens to land in the
 * same file.
 */
const DEPARTED: Array<{ fixture: ParityFixture; because: string }> = [
	{
		fixture: entityCooccurrence,
		because:
			"World lore's entity signal is the graded, rarity-weighted, " +
			"word-boundary, two-sided overlap now (retrieval plan phase 3) " +
			"rather than a binary substring test against a list of cast names. " +
			"This fixture's two entries are both keyed `ashguard` and its " +
			"window names nothing else, so any two-sided measure scores them " +
			"identically and the tf-idf tie-break decides. 0.5 separates them " +
			"only by firing on Alice — a cast member the conversation never " +
			"says — which is the one-sidedness design §13.6 removes, so the " +
			"predecessor wins here by being wrong and no correct measure can " +
			"match it (§13.11 predicted exactly this). The golden is a record " +
			"of 0.5's arithmetic and cannot be re-derived."
	}
]

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
			// `withPipelineTemplate`, exactly as the gate below applies it. An
			// open fixture rendered without its 0.6 template pair diverges on
			// the template rather than on the thing it is holding, so it would
			// stay open through the fix and never be promoted.
			const r = await runFixture(
				db,
				withPipelineTemplate(fixture),
				configs
			)
			console.log(renderParity(r))
			expect(because.length).toBeGreaterThan(40)
			expect({ fixture: fixture.name, identical: r.identical }).toEqual({
				fixture: fixture.name,
				identical: false
			})
		}
	})

	it("empties the names list in the all-hidden fixture", async () => {
		/**
		 * The fixture asserting it is the shape it claims to be.
		 *
		 * A parity fixture only earns its runtime if it renders the case it was
		 * added for — and this one does not announce itself, since two prompts
		 * that both fail to be interesting still match. The first version of
		 * this fixture was named for an empty cast and was quietly rendering a
		 * full one; this assertion is what said so.
		 */
		// Read from the frozen golden rather than re-rendered: the builder that
		// produced it is deleted, and the golden *is* what 0.5 emitted for this
		// fixture, which is exactly what this assertion wants to inspect.
		const { readFileSync } = await import("node:fs")
		const { goldenPathFor } = await import(
			"$lib/server/pipelines/parity/harness"
		)
		const rendered = readFileSync(goldenPathFor(allHidden.name), "utf8")

		// Empty on the left of the pipe: no visible assistant character to name.
		expect(rendered).toContain("NAMES:|Bob")
	})

	it("fires the co-occurrence signal, which nothing else in the corpus does", async () => {
		/**
		 * The fixture asserting it is the shape it claims to be, the way
		 * `session/all-hidden` does above.
		 *
		 * **The signal fires**, read off the query node of a real run rather
		 * than recomputed here — every other fixture in the corpus scores 0 on
		 * every entry, which is what made a weighted signal invisible to a
		 * passing gate (bug 17, design §10.1).
		 *
		 * ## ⚠ What it can no longer prove, and why that is the correct outcome
		 *
		 * Until phase 3 it also proved the signal **decided**: the second entry
		 * outscored the first because of it, and zeroing the weight put them
		 * back in authored order. That is gone, and not because the signal got
		 * worse.
		 *
		 * 0.5's measure asked what the *entry* names: `Alice Keeps Vigil` scored
		 * 1 for containing a cast name and `The Ashguard Riders` scored 0, and
		 * the conversation — *"Well met. And you. Have you seen the ashguard?"*
		 * — never says Alice at all. That one-sidedness is design §13.6's third
		 * named defect and it is what the graded overlap removes. Both entries
		 * are keyed `ashguard`, the window names nothing else, so a two-sided
		 * measure scores them **identically** and the tf-idf tie-break decides.
		 *
		 * So this fixture is now blind to the entity weight, and stating that is
		 * more useful than quietly keeping a test whose subject moved out from
		 * under it. Arbitrating a graded entity ordering wants a fixture whose
		 * *conversation* names a cast member, which this corpus does not have
		 * and cannot capture — the goldens are 0.5's output and its builder is
		 * deleted. The graded measure's ordering is covered instead by
		 * `ranking/keywordQuery.test.ts` ("is graded, not binary"), where a
		 * fixture can be built to discriminate it.
		 */
		const { pipelinePreview } = await import(
			"$lib/server/pipelines/parity/harness"
		)
		await db
			.update(schema.systemSettings)
			.set({
				defaultPromptConfigId: configs.promptConfig.id,
				defaultContextConfigId: configs.contextConfig.id
			})
			.where(eq(schema.systemSettings.id, 1))

		const scope = await withPipelineTemplate(entityCooccurrence).seed(db)
		const run: any = await pipelinePreview(db, scope)
		const worldLore = (run.nodes as any[]).find(
			(n) => n.nodeKey === "worldLore"
		)
		// The items, past the lane's band intent at the head of the list (R-7 P5).
		const scored = splitCandidates<any>(worldLore?.output?.main ?? []).items.map((c: any) => ({
			name: c.payload?.name as string,
			entityCooccurrence: c.signals?.entityCooccurrence as number,
			total: score(c.signals, DEFAULT_SIGNAL_WEIGHTS.worldLore, 1),
			without: score(
				c.signals,
				{ ...DEFAULT_SIGNAL_WEIGHTS.worldLore, entityCooccurrence: 0 },
				1
			)
		}))
		expect(scored).toHaveLength(2)

		// It fires — the whole reason this fixture exists.
		for (const c of scored) expect(c.entityCooccurrence).toBeGreaterThan(0)

		// And it fires *equally*, because both entries name the one thing the
		// window names. This is the assertion that would fail if the signal
		// silently went back to reading only the entry's own side.
		expect(scored[0]!.entityCooccurrence).toBeCloseTo(
			scored[1]!.entityCooccurrence,
			10
		)

		// Which is why zeroing the weight changes nothing here: the corpus
		// cannot see this weight any more, and says so rather than implying it
		// can.
		const order = (key: "total" | "without") =>
			[...scored].sort((a, b) => b[key] - a[key]).map((c) => c.name)
		expect(order("total")).toEqual(order("without"))

		// 0.5's reading, transcribed rather than imported — the function is
		// deleted, and a parity test's job is to say what the old engine did.
		// It separates the two entries, on Alice, whom the conversation never
		// names. That separation is the whole of the departure recorded in
		// `DEPARTED`, seen from the signal side instead of the byte side.
		const legacyCooccurrence = (entryName: string) =>
			`${entryName} ashguard`.toLowerCase().includes("alice") ? 1 : 0
		expect(
			scored.map((c: { name: string }) => legacyCooccurrence(c.name))
		).toEqual([0, 1])
	})

	it("derives the co-occurrence golden from one-on-one's, changing one line", async () => {
		/**
		 * What licenses a golden for a fixture 0.5 never rendered.
		 *
		 * Every other golden here is a capture: 0.5's builder ran and its
		 * output was frozen. That builder is deleted, so a new world cannot be
		 * captured — and a golden produced by running 0.6 would be the pipeline
		 * grading its own homework, which `harness.ts` says in so many words is
		 * worse than having no golden at all.
		 *
		 * So this fixture seeds `session/one-on-one`'s world exactly and its
		 * golden **is** `session__one-on-one.txt` with the one line the lore
		 * changes, written in the order 0.5's scorer puts the two entries in
		 * (the arithmetic is in the fixture's comment, and the test above
		 * measures the signals it rests on). This assertion is what keeps that
		 * claim true: if the two files ever differ anywhere else, the
		 * derivation has stopped holding and the golden is no longer evidence.
		 */
		const { readFileSync } = await import("node:fs")
		const { goldenPathFor } = await import(
			"$lib/server/pipelines/parity/harness"
		)
		const base = readFileSync(goldenPathFor(oneOnOne.name), "utf8").split(
			"\n"
		)
		const derived = readFileSync(
			goldenPathFor(entityCooccurrence.name),
			"utf8"
		).split("\n")

		expect(derived.length).toBe(base.length)
		const differing = base
			.map((line, i) => (line === derived[i] ? -1 : i))
			.filter((i) => i >= 0)
		expect(differing.length).toBe(1)

		// And the one line that differs is the lore block, in 0.5's score
		// order — the later-authored entry first, because it co-occurs.
		expect(derived[differing[0]!]).toBe(
			'{"Alice Keeps Vigil":"Alice keeps the gate against the ash.",' +
				'"The Ashguard Riders":"Riders who patrol the ash wastes."}'
		)
	})

	it("reports where the paths diverge", async () => {
		const results = []
		for (const fixture of CORPUS)
			results.push(
				await runFixture(db, withPipelineTemplate(fixture), configs)
			)

		const gate = parityGate(results, CORPUS.length)
		for (const r of results) console.log(renderParity(r))
		// `PARITY_FULL=1` prints both prompts in full. The excerpt around the
		// first difference is the right default — two multi-kilobyte prompts
		// side by side are unreadable — but when the divergence is structural
		// rather than local, seeing both whole is what actually finds it.
		if (process.env.PARITY_FULL) {
			const { readFileSync } = await import("node:fs")
			const { goldenPathFor, pipelinePreview } = await import(
				"$lib/server/pipelines/parity/harness"
			)
			const scope = await CORPUS[0]!.seed(db)
			const pv: any = await pipelinePreview(db, scope)
			console.log(
				"--- 0.5 (frozen golden) ---\n" +
					readFileSync(goldenPathFor(CORPUS[0]!.name), "utf8") +
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

	it("bounds each deliberate departure to exactly what it changed", async () => {
		/**
		 * The rule `OPEN` cannot enforce, in the shape
		 * `contextTemplateWrappers.test.ts` uses for 1.9.0's departure.
		 *
		 * A fixture in `DEPARTED` is expected to differ *and* expected to differ
		 * in one stated way. Asserting only the first would make this list a
		 * place where a real regression could hide, since anything landing in
		 * the same prompt would keep it red for the same reason.
		 *
		 * For `session/entity-cooccurrence` the stated way is: **the same two
		 * world-lore entries, in the other order.** Both prompts are normalised
		 * by sorting the keys of the `World lore` JSON object — nothing else is
		 * touched — and they must then be byte-identical. A dropped entry, a
		 * changed body, a different block anywhere else in the prompt all fail.
		 */
		const { readFileSync } = await import("node:fs")
		const { goldenPathFor, pipelinePreview } = await import(
			"$lib/server/pipelines/parity/harness"
		)

		for (const { fixture, because } of DEPARTED) {
			expect(because.length).toBeGreaterThan(120)

			const r = await runFixture(
				db,
				withPipelineTemplate(fixture),
				configs
			)
			console.log(renderParity(r))
			// It still has to actually differ. A departure that quietly stopped
			// happening is a fixture that belongs back in the gate.
			expect({ fixture: fixture.name, identical: r.identical }).toEqual({
				fixture: fixture.name,
				identical: false
			})

			const scope = await withPipelineTemplate(fixture).seed(db)
			const preview: any = await pipelinePreview(db, scope)
			const pipeline: string =
				preview.preview?.context?.rendered?.rendered ?? ""
			const legacy = readFileSync(goldenPathFor(fixture.name), "utf8")

			/** Sort the keys of any minified JSON object on its own line. */
			const sortObjects = (text: string) =>
				text
					.split("\n")
					.map((line) => {
						if (!line.startsWith("{") || !line.endsWith("}"))
							return line
						try {
							const parsed = JSON.parse(line) as Record<
								string,
								unknown
							>
							return JSON.stringify(
								Object.fromEntries(
									Object.entries(parsed).sort(([a], [b]) =>
										a.localeCompare(b)
									)
								)
							)
						} catch {
							return line
						}
					})
					.join("\n")

			expect(sortObjects(pipeline)).toBe(sortObjects(legacy))
		}
	})
})
