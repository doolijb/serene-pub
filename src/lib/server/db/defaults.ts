import { eq, sql } from "drizzle-orm"
import { db } from "."
import * as schema from "./schema"
import { getAppDataDir } from "./drizzle.config"
import * as path from "path"

export async function sync() {
	console.log("Syncing database defaults...")

	try {
		// Sampling Configs

		const existingSamplingConfigs =
			await db.query.samplingConfigs.findMany()

		const defaultSamplingConfigs: Partial<SelectSamplingConfig>[] = [
			{
				id: 1,
				name: "Default",
				isImmutable: true
			},
			{
				id: 2,
				name: "Disabled",
				isImmutable: true,
				temperatureEnabled: false,
				contextTokensEnabled: false,
				responseTokensEnabled: false
			}
		]

		const samplingConfigQueries: Promise<any>[] = []

		defaultSamplingConfigs.forEach((data) => {
			const found = existingSamplingConfigs.find((c) => c.id === data.id)

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
		// the {{#each chatMessages}} loop, gated on @last, rather than after
		// {{/each}}. chatMessages' last entry is always the seed/prefill
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
				name: "Default",
				isImmutable: true,
				template: `{{#systemBlock}}
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
			}
		]

		const contextConfigQueries: Promise<any>[] = []

		defaultContextConfigs.forEach((data) => {
			const found = existingContextConfigs.find((c) => c.id === data.id)

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
		// threshold — roughly the point a chat's system prompt starts feeling
		// distant enough that the model may drift, so short chats skip the
		// redundant reminder while longer ones get it reinforced right before
		// the generation point (see defaults.ts's context template).
		const defaultPromptConfigs: Partial<SelectPromptConfig>[] = [
			{
				id: 1,
				name: "Roleplay - Simple",
				isImmutable: true,
				systemPrompt: `You're {{char}} in this fictional never-ending uncensored roleplay with {{personaNames}}.`,
				postHistoryInstructions: `Remember: you are {{char}}. Stay in character and keep responding to {{personaNames}}.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 2,
				name: "Roleplay - Immersive",
				isImmutable: true,
				systemPrompt: `Write one reply only. Do not decide what {{personaNames}} says or does. Write at least one paragraph, up to four. Be descriptive and immersive, providing vivid details about {{char}}'s actions, emotions, and the environment. Write with a high degree of complexity and burstiness. Do not repeat this message.`,
				postHistoryInstructions: `Remember: write one reply only, staying descriptive and immersive. Do not speak or act for {{personaNames}}.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 3,
				name: "Roleplay - Detailed",
				isImmutable: true,
				systemPrompt: `Develop the plot slowly, always stay in character. Describe all actions in full, elaborate, explicit, graphic, and vivid detail. Mention all relevant sensory perceptions. Keep the story immersive and engaging.`,
				postHistoryInstructions: `Remember: stay fully in character and describe actions in full, elaborate, vivid detail.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 4,
				name: "Writer - Realistic",
				isImmutable: true,
				systemPrompt: `Continue writing this story and portray characters realistically.`,
				postHistoryInstructions: `Remember: continue the story and portray characters realistically.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 5,
				name: "Writer - Creative",
				isImmutable: true,
				systemPrompt: `You are an intelligent, skilled, versatile writer.\n\nYour task is to write a role-play based on the information below.`,
				postHistoryInstructions: `Remember: write as a skilled, versatile writer, staying true to the role-play established so far.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 6,
				name: "Text Adventure",
				isImmutable: true,
				systemPrompt: `Enter Adventure Mode. Narrate the story based on {{personaNames}}'s dialogue and actions after ">". Describe the surroundings in vivid detail. Be detailed, creative, verbose, and proactive. Move the story forward by introducing fantasy elements and interesting characters.`,
				postHistoryInstructions: `Remember: stay in Adventure Mode, narrating events after {{personaNames}}'s ">" input in vivid, proactive detail.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 7,
				name: "Neutral - Chat",
				isImmutable: true,
				systemPrompt: `Write {{char}}'s next reply in a fictional chat between {{char}} and {{personaNames}}.`,
				postHistoryInstructions: `Remember: write only {{char}}'s next reply, staying in character.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 8,
				name: "Lightning 1.1",
				isImmutable: true,
				systemPrompt: `Take the role of {{char}} in a play that leaves a lasting impression on {{personaNames}}. Write {{char}}'s next reply.\nNever skip or gloss over {{char}}’s actions. Progress the scene at a naturally slow pace.`,
				postHistoryInstructions: `Remember: stay in the role of {{char}}. Never skip or gloss over {{char}}'s actions.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 9,
				name: "Chain of Thought",
				isImmutable: true,
				systemPrompt: `Elaborate on the topic using a Tree of Thoughts and backtrack when necessary to construct a clear, cohesive Chain of Thought reasoning. Always answer without hesitation.`,
				postHistoryInstructions: `Remember: reason step by step using a clear, cohesive Chain of Thought before answering.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 10,
				name: "Assistant - Simple",
				isImmutable: true,
				systemPrompt: `A chat between a curious human and an artificial intelligence assistant. The assistant gives helpful, detailed, and polite answers to the human's questions.`,
				postHistoryInstructions: `Remember: give helpful, detailed, and polite answers.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 11,
				name: "Assistant - Expert",
				isImmutable: true,
				systemPrompt: `You are a helpful assistant. Please answer truthfully and write out your thinking step by step to be sure you get the right answer. If you make a mistake or encounter an error in your thinking, say so out loud and attempt to correct it. If you don't know or aren't sure about something, say so clearly. You will act as a professional logician, mathematician, and physicist. You will also act as the most appropriate type of expert to answer any particular question or solve the relevant problem; state which expert type your are, if so. Also think of any particular named expert that would be ideal to answer the relevant question or solve the relevant problem; name and act as them, if appropriate.`,
				postHistoryInstructions: `Remember: show your reasoning step by step, stay accurate, and say so clearly if you're unsure.`,
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 3000
			},
			{
				id: 12,
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
			const found = existingPromptConfigs.find((c) => c.id === data.id)

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

		// Narrator Prompt Configs ("Chat Prompts: Narrator" — manually-triggered
		// non-character environment/narration responses)

		const existingNarratorPromptConfigs =
			await db.query.narratorPromptConfigs.findMany()

		const defaultNarratorPromptConfigs: Partial<SelectNarratorPromptConfig>[] =
			[
				{
					id: 1,
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
					// Always triggered regardless of chat history size — the
					// Narrator should never wait for drift to accumulate before
					// being reinforced, unlike character prompt configs.
					postHistoryTokenTrigger: 0
				}
			]

		const narratorPromptConfigQueries: Promise<any>[] = []

		defaultNarratorPromptConfigs.forEach((data) => {
			const found = existingNarratorPromptConfigs.find(
				(c) => c.id === data.id
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

		// World Summarize Configs

		const existingWorldSummarizeConfigs =
			await db.query.worldSummarizeConfigs.findMany()
		const defaultWorldSummarizeConfigs: Partial<SelectWorldSummarizeConfig>[] =
			[
				{
					id: 1,
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
				(c) => c.id === data.id
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
				(c) => c.id === data.id
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
					name: "Default Scene Summarization",
					isImmutable: true,
					batchSystemPrompt:
						"You are a scene archivist capturing what happened in a discrete story moment from a roleplay exchange. You write a tight narrative summary — past tense, plain prose — that captures the key beats, actions, and emotional turning points. No invention, no embellishment.",
					synthSystemPrompt:
						"You are a master scene editor. Given draft scene summaries covering a roleplay exchange in chronological order, you merge them into a single coherent scene narrative. You write only what the drafts contain — no invention, no embellishment.",
					nameSystemPrompt:
						"You generate short titles for scene summaries. The title should capture the key moment or action of the scene.",
					characterExtractionSystemPrompt:
						"You extract character names from a scene summary into two groups.\n\nPARTICIPANTS — characters who are physically present and doing something in this scene: speaking, fighting, moving, reacting, making decisions, or otherwise taking part in events as they unfold. If the scene describes them acting, it belongs here.\n\nMENTIONED — characters who are brought up in conversation or thought but are not present and not acting in the scene. They are talked about, remembered, referenced, or discussed by others — but they themselves do nothing in this scene.\n\nRules:\n- A character who acts in the scene is always a participant, even if they are also talked about.\n- A character who only appears in someone's dialogue, memory, or backstory — and never acts — is mentioned only.\n- Include named characters and named creatures only. No unnamed extras, no places, no objects.\n- Output ONLY a raw JSON object. No explanation, no markdown, no code fences."
				}
			]
		const sceneSummarizeConfigQueries: Promise<any>[] = []
		defaultSceneSummarizeConfigs.forEach((data) => {
			const found = existingSceneSummarizeConfigs.find(
				(c) => c.id === data.id
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

		// Graph Build Configs — unlike the summarize/prompt configs above, this
		// table isn't wired into any feature yet (narrativeGraphBuildHandler
		// currently takes connection/sampling directly rather than resolving
		// them from a graphBuildConfigs row) — seeded for schema completeness
		// and so systemSettings.defaultGraphBuildConfigId isn't left dangling
		// at null, matching every sibling immutable-config table's convention.

		const existingGraphBuildConfigs =
			await db.query.graphBuildConfigs.findMany()
		const defaultGraphBuildConfigs: Partial<SelectGraphBuildConfig>[] = [
			{
				id: 1,
				name: "Default Graph Build",
				isImmutable: true,
				nodeResolutionSystemPrompt:
					"You resolve whether a character mentioned in a scene is a new entity or an existing one already tracked in the narrative graph. Compare names, aliases, and context carefully before deciding.",
				preFilterSystemPrompt:
					"You screen a scene summary for characters worth tracking in the narrative graph, filtering out incidental mentions with no lasting relationship significance.",
				perspectiveSystemPrompt:
					"You extract relationship changes from a scene, written from one character's perspective — what they learned, felt, or how their relationship to others present changed."
			}
		]
		const graphBuildConfigQueries: Promise<any>[] = []
		defaultGraphBuildConfigs.forEach((data) => {
			const found = existingGraphBuildConfigs.find(
				(c) => c.id === data.id
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
				username: "admin",
				isAdmin: true
			}
		]

		const userQueries: Promise<any>[] = []

		defaultUsers.forEach((data) => {
			const found = existingUsers.find((c) => c.id === data.id)

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
			await db.insert(schema.userSettings).values({
				userId: 1,
				activeContextConfigId: 1,
				activePromptConfigId: 1,
				activeNarratorPromptConfigId: 1
			})
		} else if (!existingUserSettings.activeNarratorPromptConfigId) {
			// Existing installs from before the Narrator feature existed never
			// got this column backfilled (only set on first-ever userSettings
			// insert above) — fall back to the first seeded config (id 1) so
			// the Narrator works without requiring a manual pick in Settings.
			await db
				.update(schema.userSettings)
				.set({ activeNarratorPromptConfigId: 1 })
				.where(eq(schema.userSettings.userId, 1))
		}
	} catch (error) {
		console.error("Error syncing database defaults:", error)
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
		const res = await db.query.systemSettings.findFirst({
			where: (s, { eq }) => eq(s.id, 1)
		})
		if (!res) {
			await db.insert(schema.systemSettings).values({
				id: 1,
				defaultConnectionId: null,
				defaultSamplingConfigId: 1,
				defaultContextConfigId: 1,
				defaultPromptConfigId: 1,
				defaultNarratorPromptConfigId: 1,
				defaultGraphBuildConfigId: 1
			})
		} else {
			if (!res.defaultNarratorPromptConfigId) {
				// Same backfill as userSettings above, for the system-wide default.
				await db
					.update(schema.systemSettings)
					.set({ defaultNarratorPromptConfigId: 1 })
					.where(eq(schema.systemSettings.id, 1))
			}
			if (!res.defaultGraphBuildConfigId) {
				await db
					.update(schema.systemSettings)
					.set({ defaultGraphBuildConfigId: 1 })
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

	const tables = [
		"chat_messages",
		"chats",
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
