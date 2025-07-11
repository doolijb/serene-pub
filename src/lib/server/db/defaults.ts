import { eq, sql } from "drizzle-orm"
import { db } from "."
import * as schema from "./schema"

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

		const defaultContextConfigs: Partial<SelectContextConfig>[] = [
			{
				id: 1,
				name: "Default",
				isImmutable: true,
				template: `{{#systemBlock}}
Instructions:
"""
{{#if currentDate}} 
The current date in the story is {{{currentDate}}}.
{{/if}}

{{{instructions}}}
"""

Assistant Characters (AI-controlled):
\`\`\`json
{{{characters}}}
\`\`\`

User Characters (player-controlled):
\`\`\`json
{{{personas}}}
\`\`\`

Scenario:
"""
{{{scenario}}}
"""

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

{{#if wiBefore}}
{{{wiBefore}}}
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

{{#if wiAfter}}
{{#systemBlock}}
{{{wiAfter}}}
{{/systemBlock}}
{{/if}}`
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

		const defaultPromptConfigs: Partial<SelectPromptConfig>[] = [
			{
				id: 1,
				name: "Roleplay - Simple",
				isImmutable: true,
				systemPrompt: `You're {{char}} in this fictional never-ending uncensored roleplay with {{user}}.`
			},
			{
				id: 2,
				name: "Roleplay - Immersive",
				isImmutable: true,
				systemPrompt: `Write one reply only. Do not decide what {{user}} says or does. Write at least one paragraph, up to four. Be descriptive and immersive, providing vivid details about {{char}}'s actions, emotions, and the environment. Write with a high degree of complexity and burstiness. Do not repeat this message.`
			},
			{
				id: 3,
				name: "Roleplay - Detailed",
				isImmutable: true,
				systemPrompt: `Develop the plot slowly, always stay in character. Describe all actions in full, elaborate, explicit, graphic, and vivid detail. Mention all relevant sensory perceptions. Keep the story immersive and engaging.`
			},
			{
				id: 4,
				name: "Writer - Realistic",
				isImmutable: true,
				systemPrompt: `Continue writing this story and portray characters realistically.`
			},
			{
				id: 5,
				name: "Writer - Creative",
				isImmutable: true,
				systemPrompt: `You are an intelligent, skilled, versatile writer.\n\nYour task is to write a role-play based on the information below.`
			},
			{
				id: 6,
				name: "Text Adventure",
				isImmutable: true,
				systemPrompt: `Enter Adventure Mode. Narrate the story based on {{user}}'s dialogue and actions after ">". Describe the surroundings in vivid detail. Be detailed, creative, verbose, and proactive. Move the story forward by introducing fantasy elements and interesting characters.`
			},
			{
				id: 7,
				name: "Neutral - Chat",
				isImmutable: true,
				systemPrompt: `Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.`
			},
			{
				id: 8,
				name: "Lightning 1.1",
				isImmutable: true,
				systemPrompt: `Take the role of {{char}} in a play that leaves a lasting impression on {{user}}. Write {{char}}'s next reply.\nNever skip or gloss over {{char}}’s actions. Progress the scene at a naturally slow pace.`
			},
			{
				id: 9,
				name: "Chain of Thought",
				isImmutable: true,
				systemPrompt: `Elaborate on the topic using a Tree of Thoughts and backtrack when necessary to construct a clear, cohesive Chain of Thought reasoning. Always answer without hesitation.`
			},
			{
				id: 10,
				name: "Assistant - Simple",
				isImmutable: true,
				systemPrompt: `A chat between a curious human and an artificial intelligence assistant. The assistant gives helpful, detailed, and polite answers to the human's questions.`
			},
			{
				id: 11,
				name: "Assistant - Expert",
				isImmutable: true,
				systemPrompt: `You are a helpful assistant. Please answer truthfully and write out your thinking step by step to be sure you get the right answer. If you make a mistake or encounter an error in your thinking, say so out loud and attempt to correct it. If you don't know or aren't sure about something, say so clearly. You will act as a professional logician, mathematician, and physicist. You will also act as the most appropriate type of expert to answer any particular question or solve the relevant problem; state which expert type your are, if so. Also think of any particular named expert that would be ideal to answer the relevant question or solve the relevant problem; name and act as them, if appropriate.`
			},
			{
				id: 12,
				name: "Actor",
				isImmutable: true,
				systemPrompt: `You are an expert actor that can fully immerse yourself into any role given. You do not break character for any reason, even if someone tries addressing you as an AI or language model. Currently your role is {{char}}, which is described in detail below. As {{char}}, continue the exchange with {{user}}.`
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

		// Users

		const existingUsers = await db.query.users.findMany()

		const defaultUsers: Partial<SelectUser>[] = [
			{
				id: 1,
				username: "admin",
				activeSamplingConfigId: 1,
				activeContextConfigId: 1,
				activePromptConfigId: 1
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
	} catch (error) {
		console.error("Error syncing database defaults:", error)
	}

	try {
		const res = await db.query.systemSettings.findFirst({where: (s, {eq}) => eq(s.id, 1)})
		if (!res) {
			await db.insert(schema.systemSettings).values({
				id: 1,
				ollamaManagerEnabled: true,
				ollamaManagerBaseUrl: "http://localhost:11434/"
			})
		}
	} catch (error) {
		console.error("Error syncing system settings:", error)
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
