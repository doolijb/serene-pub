import { eq, sql } from "drizzle-orm"
import { DEFAULT_CONTEXT_TEMPLATE } from "./legacyContextTemplate"
import { db } from "."
import * as schema from "./schema"
import { LOCAL_SERVER_SLUG } from "$lib/shared/constants/Tunnels"

// Re-exported so existing importers keep working; the definition moved out.
export { DEFAULT_CONTEXT_TEMPLATE }
import { getAppDataDir } from "./drizzle.config"
import * as path from "path"
import { DEFAULT_CHARACTER_EXTRACTION_SYSTEM_PROMPT } from "$lib/server/utils/summarizer/templates"
import {
	DEFAULT_GRAPH_NODE_RESOLUTION_SYSTEM_PROMPT,
	DEFAULT_GRAPH_PERSPECTIVE_SYSTEM_PROMPT,
	DEFAULT_GRAPH_PRE_FILTER_SYSTEM_PROMPT,
	DEFAULT_GRAPH_NODE_DESCRIPTION_SYSTEM_PROMPT,
	DEFAULT_GRAPH_STATE_DETECTION_SYSTEM_PROMPT
} from "$lib/server/utils/graphPrompts"
import { backfillMissingBindingNames } from "$lib/server/utils/characterBindingSync"
import { backfillRelationshipHistoryEntries } from "$lib/server/utils/graphBackfill"

export async function sync() {
	console.log("Syncing database defaults...")

	// Fallback ids for wiring up user/system defaults further down, shared
	// across the try blocks below. Queried fresh (post-upsert) rather than
	// hardcoded to the seeded id (1) so that if the immutable id:1 row is
	// ever missing for some reason, this degrades to "whichever prompt
	// config exists first" instead of pointing every default at a row that
	// isn't there.
	let firstPromptConfig: SelectPromptConfig | undefined
	let firstNarratorPromptConfig: SelectNarratorPromptConfig | undefined

	try {
		// Sampling Configs

		const existingSamplingConfigs =
			await db.query.samplingConfigs.findMany()

		// ── How seeded rows are identified ────────────────────────────────────
		//
		// Every list in this file is matched on `seedKey`, never on `id`.
		//
		// It used to upsert on a hardcoded `id`, which collides with user rows:
		// seeded ids run 1..N and `resyncIdSequences()` at the bottom of this
		// file sets each sequence to MAX(id), so the first row a user creates
		// takes the very next id a newly added seeded row would claim — and the
		// UPDATE branch silently overwrites it. That is not hypothetical: a
		// "Precise (Extraction)" preset added at sampling_configs id 3
		// overwrote a user's own config on their next boot, and `isImmutable`
		// left the wreckage un-editable in the UI.
		//
		// `seedKey` is NULL for anything a user made, so a user row can never be
		// mistaken for a seed.
		//
		// ADDING A NEW DEFAULT: give it a `seedKey` and **no `id`** — let the
		// sequence assign one. The `id` fields below are retained only because
		// those rows already exist in the wild at those ids; migration 0092
		// backfills their seedKey by (id, name) so they keep matching.
		const defaultSamplingConfigs: Partial<SelectSamplingConfig>[] = [
			{
				id: 1, // Only include ID because this is a pre-seeded row before seedKey existed.
				seedKey: "sampling-default",
				name: "Default",
				isImmutable: true,
				// 8192, not the column default of 4096. This app front-loads the
				// system block — character cards as JSON, world lore, history,
				// the narrative graph, RAG hits — which is routinely 1.5–3k
				// tokens before a single message, so 4096 spends over half the
				// window before the roleplay starts and truncates within a few
				// exchanges.
				//
				// Not higher, because this value does not mean the same thing on
				// every backend (samplerMappings.ts). KoboldCPP treats it as a
				// per-request cap and clamps it further to the server's
				// true_max_context_length, but Ollama maps it to `num_ctx`, which
				// ALLOCATES KV cache with no clamp. The ceiling is therefore set
				// by the weakest machine that can run local RP at all: an 8GB
				// card holding an 8B at Q4 has ~2.5GB spare, and 8k of KV cache
				// on that model is ~1GB. 16k is the better experience and the
				// wrong default.
				contextTokens: 8192
			},
			{
				id: 2, // Only include ID because this is a pre-seeded row before seedKey existed.
				seedKey: "sampling-disabled",
				name: "Disabled",
				isImmutable: true,
				temperatureEnabled: false,
				contextTokensEnabled: false,
				responseTokensEnabled: false
			},
			{
				// NO `id` — the sequence assigns one. This is the first default
				// added since seedKey landed, and it is precisely the shape that
				// caused the incident described above: an extraction preset
				// appended at a hardcoded id 3, which was a real user's own
				// config.
				seedKey: "sampling-precise-extraction",
				name: "Precise (Extraction)",
				isImmutable: true,
				// For structured extraction — graph relationship passes, scene
				// cast, summarisation — not for roleplay. Measured against a
				// roleplay-finetuned 26B on the narrative graph build: with the
				// creative defaults the model answered in prose roughly 45% of
				// the time and 22 of 28 relationships were discarded; with these
				// values plus constrained decoding it was 28-30 kept and 0-1
				// discarded.
				//
				// Every sampler below is set AND enabled explicitly, because
				// almost every `*Enabled` column defaults to false (schema.ts) —
				// a value without its flag is inert.
				temperature: 0.2,
				temperatureEnabled: true,
				topP: 0.9,
				topPEnabled: true,
				topK: 20,
				topKEnabled: true,
				// The creative-writing samplers stay off. XTC deliberately drops
				// high-probability tokens and DRY penalises repeated strings —
				// both are actively harmful when the wanted output is a rigid,
				// repetitive JSON shape with a fixed key order.
				xtcProbabilityEnabled: false,
				dryMultiplierEnabled: false,
				mirostatEnabled: false,
				// Extraction reads a scene and emits a small object; it needs
				// room to read, not to write.
				contextTokens: 8192,
				contextTokensEnabled: true,
				responseTokens: 1024,
				responseTokensEnabled: true
			}
		]

		// This list mixes rows that carry an explicit legacy `id` with rows that
		// let the sequence assign one, and Postgres does NOT advance a sequence
		// when a row is inserted with an explicit id. On a brand-new database
		// the sequence therefore still sits at 1 after "Default" (id 1) and
		// "Disabled" (id 2) are inserted, so the first sequence-assigned row
		// asks for id 1 and dies on the primary key.
		//
		// That failure aborted this entire function, which meant context
		// configs were never seeded either, which meant the system_settings
		// insert further down failed its foreign key — leaving an install with
		// no settings row at all and a permanently blank page. Every fresh
		// install hit this.
		//
		// GREATEST(...) so this only ever raises the sequence: on an existing
		// install MAX(id) is already past the seeded ids and nothing moves.
		// resyncIdSequences() at the bottom of this file does the same job, but
		// it runs after seeding and so never got the chance.
		const maxSeededSamplingId = defaultSamplingConfigs.reduce(
			(max, c) => (typeof c.id === "number" && c.id > max ? c.id : max),
			0
		)
		if (maxSeededSamplingId > 0) {
			await db.execute(`
				SELECT setval(
					pg_get_serial_sequence('sampling_configs', 'id'),
					GREATEST(
						(SELECT COALESCE(MAX(id), 0) FROM sampling_configs),
						${maxSeededSamplingId}
					)
				);
			`)
		}

		const samplingConfigQueries: Promise<any>[] = []

		defaultSamplingConfigs.forEach((data) => {
			const found = existingSamplingConfigs.find(
				(c) => c.seedKey === data.seedKey
			)

			if (!found) {
				samplingConfigQueries.push(
					db
						.insert(schema.samplingConfigs)
						.values(data as InsertSamplingConfig)
				)
			} else {
				samplingConfigQueries.push(
					db
						.update(schema.samplingConfigs)
						.set({
							...data,
							// @ts-ignore
							id: undefined
						})
						.where(eq(schema.samplingConfigs.id, found.id))
				)
			}
		})

		await Promise.all(samplingConfigQueries)

		// Context Confings

		const existingContextConfigs = await db.query.contextConfigs.findMany()

		// NOTE on the template below: postHistoryInstructions renders inside
		// the {{#each sessionMessages}} loop, gated on @last, rather than after
		// {{/each}}. sessionMessages' last entry is always the seed/prefill
		// placeholder ("Name: ", the turn the model continues writing from);
		// it must stay the literal final block in the rendered output for
		// that continuation to work. Rendering postHistoryInstructions after
		// the loop instead pushes a system block after the seed, breaking it
		// into a standalone (non-continued) turn — this was a real bug.
		// (Deliberately not a Handlebars {{! }} comment inside the template
		// itself — a same-line {{! ... }} comment terminates at the FIRST
		// }} it finds, so explaining code containing literal {{/each}} inside
		// one truncates the comment early and leaks the rest as real output,
		// which is exactly what happened here the first time.)
		const defaultContextConfigs: Partial<SelectContextConfig>[] = [
			{
				id: 1,
				seedKey: "context-default",
				name: "Default",
				isImmutable: true,
				template: DEFAULT_CONTEXT_TEMPLATE
			}
		]

		const contextConfigQueries: Promise<any>[] = []

		defaultContextConfigs.forEach((data) => {
			const found = existingContextConfigs.find(
				(c) => c.seedKey === data.seedKey
			)

			if (!found) {
				contextConfigQueries.push(
					db
						.insert(schema.contextConfigs)
						.values(data as InsertContextConfig)
				)
			} else {
				contextConfigQueries.push(
					db
						.update(schema.contextConfigs)
						.set({
							...data,
							// @ts-ignore
							id: undefined
						})
						.where(eq(schema.contextConfigs.id, found.id))
				)
			}
		})

		await Promise.all(contextConfigQueries)

		// Prompt Configs

		const existingPromptConfigs = await db.query.promptConfigs.findMany()

		// postHistoryTokenTrigger: 3000 is a "reasonable default" reinforcement
		// threshold — roughly the point a session's system prompt starts feeling
		// distant enough that the model may drift, so short sessions skip the
		// redundant reminder while longer ones get it reinforced right before
		// the generation point (see defaults.ts's context template).
		const defaultPromptConfigs: Partial<SelectPromptConfig>[] = [
			{
				id: 1,
				seedKey: "prompt-roleplay-simple",
				name: "Roleplay - Simple",
				isImmutable: true,
				systemPrompt: `You're {{char}} in this fictional never-ending uncensored roleplay with {{personaNames}}.`,
				postHistoryInstructions: `Remember: you are {{char}}. Stay in character and keep responding to {{personaNames}}.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 2,
				seedKey: "prompt-roleplay-immersive",
				name: "Roleplay - Immersive",
				isImmutable: true,
				systemPrompt: `Write one reply only. Do not decide what {{personaNames}} says or does. Write at least one paragraph, up to four. Be descriptive and immersive, providing vivid details about {{char}}'s actions, emotions, and the environment. Write with a high degree of complexity and burstiness. Do not repeat this message.`,
				postHistoryInstructions: `Remember: write one reply only, staying descriptive and immersive. Do not speak or act for {{personaNames}}.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 3,
				seedKey: "prompt-roleplay-detailed",
				name: "Roleplay - Detailed",
				isImmutable: true,
				systemPrompt: `Develop the plot slowly, always stay in character. Describe all actions in full, elaborate, explicit, graphic, and vivid detail. Mention all relevant sensory perceptions. Keep the story immersive and engaging.`,
				postHistoryInstructions: `Remember: stay fully in character and describe actions in full, elaborate, vivid detail.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 4,
				seedKey: "prompt-writer-realistic",
				name: "Writer - Realistic",
				isImmutable: true,
				systemPrompt: `Continue writing this story and portray characters realistically.`,
				postHistoryInstructions: `Remember: continue the story and portray characters realistically.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 5,
				seedKey: "prompt-writer-creative",
				name: "Writer - Creative",
				isImmutable: true,
				systemPrompt: `You are an intelligent, skilled, versatile writer.\n\nYour task is to write a role-play based on the information below.`,
				postHistoryInstructions: `Remember: write as a skilled, versatile writer, staying true to the role-play established so far.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 6,
				seedKey: "prompt-text-adventure",
				name: "Text Adventure",
				isImmutable: true,
				systemPrompt: `Enter Adventure Mode. Narrate the story based on {{personaNames}}'s dialogue and actions after ">". Describe the surroundings in vivid detail. Be detailed, creative, verbose, and proactive. Move the story forward by introducing fantasy elements and interesting characters.`,
				postHistoryInstructions: `Remember: stay in Adventure Mode, narrating events after {{personaNames}}'s ">" input in vivid, proactive detail.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 7,
				seedKey: "prompt-neutral-session",
				name: "Neutral - Session",
				isImmutable: true,
				systemPrompt: `Write {{char}}'s next reply in a fictional session between {{char}} and {{personaNames}}.`,
				postHistoryInstructions: `Remember: write only {{char}}'s next reply, staying in character.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 8,
				seedKey: "prompt-lightning-1-1",
				name: "Lightning 1.1",
				isImmutable: true,
				systemPrompt: `Take the role of {{char}} in a play that leaves a lasting impression on {{personaNames}}. Write {{char}}'s next reply.\nNever skip or gloss over {{char}}’s actions. Progress the scene at a naturally slow pace.`,
				postHistoryInstructions: `Remember: stay in the role of {{char}}. Never skip or gloss over {{char}}'s actions.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 9,
				seedKey: "prompt-chain-of-thought",
				name: "Chain of Thought",
				isImmutable: true,
				systemPrompt: `Elaborate on the topic using a Tree of Thoughts and backtrack when necessary to construct a clear, cohesive Chain of Thought reasoning. Always answer without hesitation.`,
				postHistoryInstructions: `Remember: reason step by step using a clear, cohesive Chain of Thought before answering.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 10,
				seedKey: "prompt-assistant-simple",
				name: "Assistant - Simple",
				isImmutable: true,
				systemPrompt: `A session between a curious human and an artificial intelligence assistant. The assistant gives helpful, detailed, and polite answers to the human's questions.`,
				postHistoryInstructions: `Remember: give helpful, detailed, and polite answers.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 11,
				seedKey: "prompt-assistant-expert",
				name: "Assistant - Expert",
				isImmutable: true,
				systemPrompt: `You are a helpful assistant. Please answer truthfully and write out your thinking step by step to be sure you get the right answer. If you make a mistake or encounter an error in your thinking, say so out loud and attempt to correct it. If you don't know or aren't sure about something, say so clearly. You will act as a professional logician, mathematician, and physicist. You will also act as the most appropriate type of expert to answer any particular question or solve the relevant problem; state which expert type your are, if so. Also think of any particular named expert that would be ideal to answer the relevant question or solve the relevant problem; name and act as them, if appropriate.`,
				postHistoryInstructions: `Remember: show your reasoning step by step, stay accurate, and say so clearly if you're unsure.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 12,
				seedKey: "prompt-actor",
				name: "Actor",
				isImmutable: true,
				systemPrompt: `You are an expert actor that can fully immerse yourself into any role given. You do not break character for any reason, even if someone tries addressing you as an AI or language model. Currently your role is {{char}}, which is described in detail below. As {{char}}, continue the exchange with {{personaNames}}.`,
				postHistoryInstructions: `Remember: stay fully in character as {{char}}, no matter what.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			}
		]

		const promptConfigQueries: Promise<any>[] = []

		defaultPromptConfigs.forEach((data) => {
			const found = existingPromptConfigs.find(
				(c) => c.seedKey === data.seedKey
			)

			if (!found) {
				promptConfigQueries.push(
					db
						.insert(schema.promptConfigs)
						.values(data as InsertPromptConfig)
				)
			} else {
				promptConfigQueries.push(
					db
						.update(schema.promptConfigs)
						.set({
							...data,
							// @ts-ignore
							id: undefined
						})
						.where(eq(schema.promptConfigs.id, found.id))
				)
			}
		})

		await Promise.all(promptConfigQueries)

		// Narrator Prompt Configs ("Session Prompts: Narrator" — manually-triggered
		// non-character environment/narration responses)

		const existingNarratorPromptConfigs =
			await db.query.narratorPromptConfigs.findMany()

		const defaultNarratorPromptConfigs: Partial<SelectNarratorPromptConfig>[] =
			[
				{
					id: 1,
					seedKey: "narrator-default",
					name: "Narrator",
					isImmutable: true,
					narratorName: "Narrator",
					systemPrompt: `You are {{narratorName}}. You only narrate the environment, not {{characterNames}} or {{personaNames}}. Focus on telling the reader about the surroundings, the weather. Do not move the plot forward unless instructed. You may only narrate and describe characters who are not in the list.`,
					// Reinforces the systemPrompt above right at the generation
					// point (see defaults.ts's context template) rather than
					// only at the top of a long prompt — a model several turns
					// deep into character-dialogue history needs the reminder
					// closest to where it's about to generate, or it tends to
					// keep writing in the same pattern as the preceding turns
					// regardless of the system prompt.
					postHistoryInstructions: `Remember: you are {{narratorName}}, narrating only. Do not write dialogue or move, describe or narrate {{characterNames}} nor {{personaNames}}, and do not advance the plot — describe the scene in beautiful detail and stop.`,
					postHistoryDepth: 0,
					// Always triggered regardless of session history size — the
					// Narrator should never wait for drift to accumulate before
					// being reinforced, unlike character prompt configs.
					postHistoryTokenTrigger: 0
				}
			]

		const narratorPromptConfigQueries: Promise<any>[] = []

		defaultNarratorPromptConfigs.forEach((data) => {
			const found = existingNarratorPromptConfigs.find(
				(c) => c.seedKey === data.seedKey
			)

			if (!found) {
				narratorPromptConfigQueries.push(
					db
						.insert(schema.narratorPromptConfigs)
						.values(data as InsertNarratorPromptConfig)
				)
			} else {
				narratorPromptConfigQueries.push(
					db
						.update(schema.narratorPromptConfigs)
						.set({
							...data,
							// @ts-ignore
							id: undefined
						})
						.where(eq(schema.narratorPromptConfigs.id, found.id))
				)
			}
		})

		await Promise.all(narratorPromptConfigQueries)

		firstPromptConfig = await db.query.promptConfigs.findFirst({
			orderBy: (t, { asc }) => asc(t.id)
		})
		firstNarratorPromptConfig =
			await db.query.narratorPromptConfigs.findFirst({
				orderBy: (t, { asc }) => asc(t.id)
			})

		// World Summarize Configs

		const existingWorldSummarizeConfigs =
			await db.query.worldSummarizeConfigs.findMany()
		const defaultWorldSummarizeConfigs: Partial<SelectWorldSummarizeConfig>[] =
			[
				{
					id: 1,
					seedKey: "summarize-world-default",
					name: "Default World Summarization",
					isImmutable: true,
					batchSystemPrompt:
						"You are an archivist recording world-building facts from a roleplay exchange. Your records are concise bullet points that capture facts, changes, and discoveries about the setting. You write only what is directly shown — no invention, no embellishment.",
					synthSystemPrompt:
						"You are a master archivist. Given draft bullet points covering a roleplay exchange, you merge them into a single clean world lore entry. You write only what the drafts contain — no invention, no embellishment.",
					nameSystemPrompt:
						"You generate short titles for world lore entries. The title should describe the subject of the entry."
				}
			]
		const worldSummarizeConfigQueries: Promise<any>[] = []
		defaultWorldSummarizeConfigs.forEach((data) => {
			const found = existingWorldSummarizeConfigs.find(
				(c) => c.seedKey === data.seedKey
			)
			if (!found) {
				worldSummarizeConfigQueries.push(
					db
						.insert(schema.worldSummarizeConfigs)
						.values(data as InsertWorldSummarizeConfig)
				)
			} else {
				worldSummarizeConfigQueries.push(
					db
						.update(schema.worldSummarizeConfigs)
						.set({
							...data, // @ts-ignore
							id: undefined
						})
						.where(eq(schema.worldSummarizeConfigs.id, found.id))
				)
			}
		})
		await Promise.all(worldSummarizeConfigQueries)

		// Character Summarize Configs

		const existingCharacterSummarizeConfigs =
			await db.query.characterSummarizeConfigs.findMany()
		const defaultCharacterSummarizeConfigs: Partial<SelectCharacterSummarizeConfig>[] =
			[
				{
					id: 1,
					seedKey: "summarize-character-default",
					name: "Default Character Summarization",
					isImmutable: true,
					batchSystemPrompt:
						"You are a character archivist recording facts about a specific character from a roleplay exchange. Your records are concise bullet points that capture who the character is, what they did, and how they relate to others. You write only what is directly shown — no invention, no embellishment.",
					synthSystemPrompt:
						"You are a master character archivist. Given draft bullet points about a character from a roleplay exchange, you merge them into a single clean character lore entry. You write only what the drafts contain — no invention, no embellishment.",
					nameSystemPrompt:
						"You generate short titles for character lore entries. The title should describe the subject matter of the entry (e.g. an ability, relationship, or past event)."
				}
			]
		const characterSummarizeConfigQueries: Promise<any>[] = []
		defaultCharacterSummarizeConfigs.forEach((data) => {
			const found = existingCharacterSummarizeConfigs.find(
				(c) => c.seedKey === data.seedKey
			)
			if (!found) {
				characterSummarizeConfigQueries.push(
					db
						.insert(schema.characterSummarizeConfigs)
						.values(data as InsertCharacterSummarizeConfig)
				)
			} else {
				characterSummarizeConfigQueries.push(
					db
						.update(schema.characterSummarizeConfigs)
						.set({
							...data, // @ts-ignore
							id: undefined
						})
						.where(
							eq(schema.characterSummarizeConfigs.id, found.id)
						)
				)
			}
		})
		await Promise.all(characterSummarizeConfigQueries)

		// Scene Summarize Configs

		const existingSceneSummarizeConfigs =
			await db.query.sceneSummarizeConfigs.findMany()
		const defaultSceneSummarizeConfigs: Partial<SelectSceneSummarizeConfig>[] =
			[
				{
					id: 1,
					seedKey: "summarize-scene-default",
					name: "Default Scene Summarization",
					isImmutable: true,
					batchSystemPrompt:
						"You are a scene archivist capturing what happened in a discrete story moment from a roleplay exchange. You write a tight narrative summary — past tense, plain prose — that captures the key beats, actions, and emotional turning points. No invention, no embellishment.",
					synthSystemPrompt:
						"You are a master scene editor. Given draft scene summaries covering a roleplay exchange in chronological order, you merge them into a single coherent scene narrative. You write only what the drafts contain — no invention, no embellishment.",
					nameSystemPrompt:
						"You generate short titles for scene summaries. The title should capture the key moment or action of the scene.",
					characterExtractionSystemPrompt:
						DEFAULT_CHARACTER_EXTRACTION_SYSTEM_PROMPT
				}
			]
		const sceneSummarizeConfigQueries: Promise<any>[] = []
		defaultSceneSummarizeConfigs.forEach((data) => {
			const found = existingSceneSummarizeConfigs.find(
				(c) => c.seedKey === data.seedKey
			)
			if (!found) {
				sceneSummarizeConfigQueries.push(
					db
						.insert(schema.sceneSummarizeConfigs)
						.values(data as InsertSceneSummarizeConfig)
				)
			} else {
				sceneSummarizeConfigQueries.push(
					db
						.update(schema.sceneSummarizeConfigs)
						.set({
							...data, // @ts-ignore
							id: undefined
						})
						.where(eq(schema.sceneSummarizeConfigs.id, found.id))
				)
			}
		})
		await Promise.all(sceneSummarizeConfigQueries)

		// Graph Build Configs. The prompts come from utils/graphPrompts.ts, the
		// same module graphBuilder falls back to, so the seeded default and the
		// code default cannot drift — they previously had, this row holding
		// one-line stubs bearing no resemblance to what was actually sent.
		//
		// This row is immutable and re-synced on every boot by the update
		// branch below, so editing graphPrompts.ts is all it takes to ship a
		// new default prompt to existing installs.

		const existingGraphBuildConfigs =
			await db.query.graphBuildConfigs.findMany()
		const defaultGraphBuildConfigs: Partial<SelectGraphBuildConfig>[] = [
			{
				id: 1,
				seedKey: "graph-build-default",
				name: "Default Graph Build",
				isImmutable: true,
				nodeResolutionSystemPrompt:
					DEFAULT_GRAPH_NODE_RESOLUTION_SYSTEM_PROMPT,
				preFilterSystemPrompt: DEFAULT_GRAPH_PRE_FILTER_SYSTEM_PROMPT,
				perspectiveSystemPrompt:
					DEFAULT_GRAPH_PERSPECTIVE_SYSTEM_PROMPT,
				nodeDescriptionSystemPrompt:
					DEFAULT_GRAPH_NODE_DESCRIPTION_SYSTEM_PROMPT,
				stateDetectionSystemPrompt:
					DEFAULT_GRAPH_STATE_DETECTION_SYSTEM_PROMPT
				// Deliberately NO per-sub-task connection/sampling pointers here.
				//
				// The upsert below re-forces every field in this literal on every
				// boot, so a pointer set here would silently revert a user's own
				// choice each restart once this table gets a UI. Pointers are
				// theirs to set; the seed owns the prompts only.
			}
		]
		const graphBuildConfigQueries: Promise<any>[] = []
		defaultGraphBuildConfigs.forEach((data) => {
			const found = existingGraphBuildConfigs.find(
				(c) => c.seedKey === data.seedKey
			)
			if (!found) {
				graphBuildConfigQueries.push(
					db
						.insert(schema.graphBuildConfigs)
						.values(data as InsertGraphBuildConfig)
				)
			} else {
				graphBuildConfigQueries.push(
					db
						.update(schema.graphBuildConfigs)
						.set({
							...data, // @ts-ignore
							id: undefined
						})
						.where(eq(schema.graphBuildConfigs.id, found.id))
				)
			}
		})
		await Promise.all(graphBuildConfigQueries)

		// Users

		const existingUsers = await db.query.users.findMany()

		const defaultUsers: Partial<SelectUser>[] = [
			{
				id: 1,
				seedKey: "user-admin",
				username: "admin",
				isAdmin: true
			}
		]

		const userQueries: Promise<any>[] = []

		defaultUsers.forEach((data) => {
			const found = existingUsers.find((c) => c.seedKey === data.seedKey)

			if (!found) {
				userQueries.push(
					db.insert(schema.users).values(data as InsertUser)
				)
			} else {
				// userQueries.push(
				//     db.update(schema.users).set({
				//         ...data,
				//         // @ts-ignore
				//         id: undefined,
				//     }).where(eq(schema.users.id, found.id))
				// )
			}
		})

		await Promise.all(userQueries)

		// Ensure user 1 has a userSettings row with the seeded config defaults.
		// No connection is set — that's the wizard's job on first run.
		const existingUserSettings = await db.query.userSettings.findFirst({
			where: (us, { eq }) => eq(us.userId, 1)
		})
		if (!existingUserSettings) {
			await db
				.insert(schema.userSettings)
				.values({
					userId: 1,
					activeContextConfigId: 1,
					activePromptConfigId: firstPromptConfig?.id,
					activeNarratorPromptConfigId: firstNarratorPromptConfig?.id
				})
				.onConflictDoNothing()
		} else if (!existingUserSettings.activeNarratorPromptConfigId) {
			// Existing installs from before the Narrator feature existed never
			// got this column backfilled (only set on first-ever userSettings
			// insert above) — fall back to the first seeded prompt config so
			// the Narrator works without requiring a manual pick in Settings.
			await db
				.update(schema.userSettings)
				.set({
					activeNarratorPromptConfigId: firstNarratorPromptConfig?.id
				})
				.where(eq(schema.userSettings.userId, 1))
		}
	} catch (error) {
		console.error("Error syncing database defaults:", error)
	}

	// One-off backfill: bound lorebookBindings rows that never went through
	// characterBindingSync (e.g. lorebook import before that path called it —
	// see restoreBoundEntities) are left with a permanently NULL name,
	// falling through to the raw {{char:N}} token everywhere a binding's
	// name is displayed. Naturally idempotent and cheap after the first
	// run: once the import path syncs on insert, this matches nothing on
	// every subsequent boot.
	//
	// `db` is passed explicitly and MUST stay that way — it is not a
	// redundant argument. sync() runs at module scope of db/index.ts (its
	// `await sync()`), so this executes while that module is still
	// evaluating. Omitting the instance makes characterBindingSync fall back
	// to its `defaultDb()`, which does `await import("$lib/server/db")` —
	// re-entering the very module we are suspended inside. Unbundled ESM
	// tolerates that (it hands back the partial namespace, and `db` is
	// already assigned by then), but Rollup emits the chunk's namespace
	// object as a `const` AFTER the module body, so the same call throws
	// `ReferenceError: Cannot access 'index' before initialization` in a
	// packaged build — silently skipping this repair on every startup.
	// `db` is demonstrably live here: sync() has already queried through it
	// dozens of times above, and does so again immediately below.
	try {
		await backfillMissingBindingNames(db)
	} catch (error) {
		console.error("Error backfilling lorebook binding names:", error)
	}

	try {
		await backfillRelationshipHistoryEntries(db)
	} catch (error) {
		console.error("Error backfilling relationship history entries:", error)
	}

	try {
		const vecConfig = await db.query.vectorizationConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, 1)
		})
		if (!vecConfig) {
			await db
				.insert(schema.vectorizationConfigs)
				.values({ id: 1, embeddingModelTtlMinutes: 5 })
		}
	} catch (error) {
		console.error("Error syncing vectorization config:", error)
	}

	try {
		// Looked up by seedKey rather than assumed to be id 1. The graph build
		// config is the one every graph LLM step resolves its prompt, model and
		// sampling through, so a system default pointing at the wrong row (or at
		// no row) silently sends every step back to the session defaults — which is
		// the failure this whole config type exists to prevent. Nothing
		// guarantees the seeded row is at id 1 once defaults are added without
		// hardcoded ids, which is now the rule.
		const seededGraphBuildConfig =
			await db.query.graphBuildConfigs.findFirst({
				where: (c, { eq }) => eq(c.seedKey, "graph-build-default")
			})

		const res = await db.query.systemSettings.findFirst({
			where: (s, { eq }) => eq(s.id, 1)
		})
		if (!res) {
			await db.insert(schema.systemSettings).values({
				id: 1,
				defaultConnectionId: null,
				defaultSamplingConfigId: 1,
				defaultContextConfigId: 1,
				defaultPromptConfigId: firstPromptConfig?.id,
				defaultNarratorPromptConfigId: firstNarratorPromptConfig?.id,
				defaultGraphBuildConfigId: seededGraphBuildConfig?.id
			})
		} else {
			if (!res.defaultNarratorPromptConfigId) {
				// Same backfill as userSettings above, for the system-wide default.
				await db
					.update(schema.systemSettings)
					.set({
						defaultNarratorPromptConfigId:
							firstNarratorPromptConfig?.id
					})
					.where(eq(schema.systemSettings.id, 1))
			}
			// Backfilled on every boot while unset, so an install that predates
			// the graph config — or one whose selection was cleared by the
			// referencing row being deleted (onDelete: "set null") — picks the
			// seeded default back up rather than staying unconfigured.
			if (!res.defaultGraphBuildConfigId && seededGraphBuildConfig) {
				await db
					.update(schema.systemSettings)
					.set({
						defaultGraphBuildConfigId: seededGraphBuildConfig.id
					})
					.where(eq(schema.systemSettings.id, 1))
			}
		}
	} catch (error) {
		console.error("Error syncing system settings:", error)
	}

	try {
		const ollamaRes = await db.query.ollamaSettings.findFirst({
			where: (s, { eq }) => eq(s.id, 1)
		})
		if (!ollamaRes) {
			await db.insert(schema.ollamaSettings).values({ id: 1 })
		}
	} catch (error) {
		console.error("Error syncing ollama settings:", error)
	}

	try {
		// KOBOLDCPP_BINARY_DIR / KOBOLDCPP_BINARY_NAME let a Docker deployment (or
		// any deployment) point managed mode at a binary directory/file without
		// using the in-app downloader — documented in DOCKER.md, but previously
		// never actually read anywhere. Only seed when unset so an already-working
		// setup (downloaded via the manager, or configured before this existed)
		// is never silently overridden by a stray env var.
		const envBinaryDir = process.env.KOBOLDCPP_BINARY_DIR
		const envBinaryName = process.env.KOBOLDCPP_BINARY_NAME

		const kcppRes = await db.query.koboldCppSettings.findFirst({
			where: (s, { eq }) => eq(s.id, 1)
		})
		if (!kcppRes) {
			await db.insert(schema.koboldCppSettings).values({
				id: 1,
				koboldCppManagerModelsDir: path.join(
					getAppDataDir(),
					"models",
					"llm"
				),
				...(envBinaryDir
					? { koboldCppManagedBinaryDir: envBinaryDir }
					: {}),
				...(envBinaryDir && envBinaryName
					? { koboldCppManagedBinaryVariant: envBinaryName }
					: {})
			})
		} else {
			const patch: Partial<typeof kcppRes> = {}
			if (!kcppRes.koboldCppManagerModelsDir) {
				patch.koboldCppManagerModelsDir = path.join(
					getAppDataDir(),
					"models",
					"llm"
				)
			}
			if (!kcppRes.koboldCppManagedBinaryDir && envBinaryDir) {
				patch.koboldCppManagedBinaryDir = envBinaryDir
			}
			if (
				!kcppRes.koboldCppManagedBinaryVariant &&
				envBinaryDir &&
				envBinaryName
			) {
				patch.koboldCppManagedBinaryVariant = envBinaryName
			}
			if (Object.keys(patch).length > 0) {
				await db
					.update(schema.koboldCppSettings)
					.set(patch)
					.where(eq(schema.koboldCppSettings.id, 1))
			}
		}
	} catch (error) {
		console.error("Error syncing koboldcpp settings:", error)
	}

	try {
		// Servers (plan 26 §2)
		//
		// The instance's own network identity — a stable anchor for
		// instance-scoped, non-model-provider settings (tunnels). Exactly one
		// row, seeded here.
		//
		// Matched on `slug`, never on `id`, per the seedKey rule documented at
		// the top of this file: a hardcoded id collides with whatever the
		// sequence hands the first user-created row. `servers` has no
		// user-created rows today, but the rule holds regardless — it costs
		// nothing here and removes the trap if that ever changes.
		const existingLocalServer = await db.query.servers.findFirst({
			where: eq(schema.servers.slug, LOCAL_SERVER_SLUG)
		})
		if (!existingLocalServer) {
			await db.insert(schema.servers).values({
				slug: LOCAL_SERVER_SLUG,
				name: "This instance",
				isSeeded: true
			})
		} else if (!existingLocalServer.isSeeded) {
			// Repair, not overwrite: isSeeded is what stops the row being
			// deleted, so a row that lost the flag would become deletable and
			// take its tunnels with it (FK cascade). Name stays whatever the
			// admin set.
			await db
				.update(schema.servers)
				.set({ isSeeded: true })
				.where(eq(schema.servers.id, existingLocalServer.id))
		}
	} catch (error) {
		console.error("Error syncing servers:", error)
	}

	const tables = [
		"session_messages",
		"sessions",
		"characters",
		"connections",
		"context_configs",
		"history_entries",
		"lorebooks",
		"lorebook_bindings",
		"world_lore_entries",
		"character_lore_entries",
		"personas",
		"prompt_configs",
		"narrator_prompt_configs",
		"world_summarize_configs",
		"character_summarize_configs",
		"scene_summarize_configs",
		"graph_build_configs",
		"sampling_configs",
		"users"
	]

	const queries: Promise<any>[] = []
	tables.map((table) => {
		queries.push(
			db.execute(`
				SELECT setval(
					pg_get_serial_sequence('${table}', 'id'),
					(SELECT MAX(id) FROM ${table})
				);
			`)
		)
	})

	await Promise.all(queries)
}
