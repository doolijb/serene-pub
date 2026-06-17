import { db } from "$lib/server/db"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { handlePersonaAvatarUpload } from "../utils"
import type { Handler } from "$lib/shared/events"
import { parseCharacterCardFromBase64 } from "../utils/characterCardParser"

// Helper function to process tags for persona creation/update
async function processPersonaTags(
	personaId: number,
	tagNames: string[],
	userId: number
) {
	// Get existing tags for this persona that belong to the user
	const existingPersonaTags = await db.query.personaTags.findMany({
		where: eq(schema.personaTags.personaId, personaId),
		with: {
			tag: true
		}
	})

	// Filter to only tags that belong to this user
	const userPersonaTags = existingPersonaTags.filter(
		(pt) => pt.tag.userId === userId
	)
	const existingTagNames = userPersonaTags.map((pt) => pt.tag.name)

	// Normalize tag names for comparison
	const normalizedNewTags = (tagNames || [])
		.map((t) => t.trim())
		.filter((t) => t.length > 0)

	// Find tags to remove (exist in DB but not in new list)
	const tagsToRemove = userPersonaTags.filter(
		(pt) => !normalizedNewTags.includes(pt.tag.name)
	)

	// Find tags to add (exist in new list but not in DB)
	const tagsToAdd = normalizedNewTags.filter(
		(tagName) => !existingTagNames.includes(tagName)
	)

	// Remove tags that are no longer in the list
	if (tagsToRemove.length > 0) {
		const tagIdsToRemove = tagsToRemove.map((pt) => pt.tagId)
		await db
			.delete(schema.personaTags)
			.where(
				and(
					eq(schema.personaTags.personaId, personaId),
					inArray(schema.personaTags.tagId, tagIdsToRemove)
				)
			)
	}

	// Add new tags
	for (const tagName of tagsToAdd) {
		// Check if tag exists for this user
		let existingTag = await db.query.tags.findFirst({
			where: (t, { and, eq }) =>
				and(eq(t.name, tagName), eq(t.userId, userId))
		})

		// Create tag if it doesn't exist
		if (!existingTag) {
			const [newTag] = await db
				.insert(schema.tags)
				.values({
					name: tagName,
					userId
				})
				.returning()
			existingTag = newTag
		}

		// Link tag to persona
		await db
			.insert(schema.personaTags)
			.values({
				personaId,
				tagId: existingTag.id
			})
			.onConflictDoNothing()
	}
}

export const personasList: Handler<
	Sockets.Personas.List.Params,
	Sockets.Personas.List.Response
> = {
	event: "personas:list",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const personaList = await db.query.personas.findMany({
			columns: {
				id: true,
				name: true,
				avatar: true,
				isDefault: true,
				description: true,
				position: true,
				embeddingModel: true
			},
			with: {
				personaTags: {
					with: {
						tag: true
					}
				}
			},
			where: (p, { eq }) => eq(p.userId, userId)
		})
		const res: Sockets.Personas.List.Response = { personaList }
		emitToUser("personas:list", res)
		return res
	}
}

export const personasGet: Handler<
	Sockets.Personas.Get.Params,
	Sockets.Personas.Get.Response
> = {
	event: "personas:get",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const persona = await db.query.personas.findFirst({
			where: (p, { and, eq }) =>
				and(eq(p.id, params.id), eq(p.userId, userId)),
			with: {
				personaTags: {
					with: {
						tag: true
					}
				}
			}
		})
		if (persona) {
			// Transform the persona data to include tags as string array
			const personaWithTags = {
				...persona,
				tags: persona.personaTags.map((pt) => pt.tag.name)
			}
			// @ts-ignore - Remove the junction table data
			delete personaWithTags.personaTags

			const res: Sockets.Personas.Get.Response = {
				persona: personaWithTags
			}
			emitToUser("personas:get", res)
			return res
		} else {
			const res: Sockets.Personas.Get.Response = { persona: null }
			emitToUser("personas:get", res)
			return res
		}
	}
}

export const personasCreate: Handler<
	Sockets.Personas.Create.Params,
	Sockets.Personas.Create.Response
> = {
	event: "personas:create",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const data = { ...params.persona }
			const tags = (data as any).tags || []

			// Remove fields that shouldn't be in the database insert
			delete (data as any).avatar // Remove avatar from persona data to avoid conflicts
			delete (data as any).tags // Remove tags - will be handled separately

			const [persona] = await db
				.insert(schema.personas)
				.values({ ...data, userId })
				.returning()

			// Process tags after persona creation
			if (tags.length > 0) {
				await processPersonaTags(persona.id, tags, userId)
			}

			if (params.avatarFile) {
				await handlePersonaAvatarUpload({
					persona,
					avatarFile: params.avatarFile
				})
			}

			await personasList.handler(socket, {}, emitToUser)
			const res: Sockets.Personas.Create.Response = { persona }
			emitToUser("personas:create", res)
			return res
		} catch (e: any) {
			console.error("Error creating persona:", e)
			emitToUser("personas:create:error", {
				error: e.message || String(e)
			})
			throw e
		}
	}
}

export const personasUpdate: Handler<
	Sockets.Personas.Update.Params,
	Sockets.Personas.Update.Response
> = {
	event: "personas:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const data = { ...params.persona }
			const id = data.id
			const userId = socket.user!.id
			const tags = (data as any).tags || []

			// Remove fields that shouldn't be in the database update
			if ("userId" in data) (data as any).userId = undefined
			if ("id" in data) (data as any).id = undefined
			delete (data as any).avatar // Remove avatar from persona data to avoid conflicts
			delete (data as any).tags // Remove tags - will be handled separately

			const [updated] = await db
				.update(schema.personas)
				.set(data)
				.where(
					and(
						eq(schema.personas.id, id),
						eq(schema.personas.userId, userId)
					)
				)
				.returning()

			// Process tags after persona update
			await processPersonaTags(id, tags, userId)

			if (params.avatarFile) {
				await handlePersonaAvatarUpload({
					persona: updated,
					avatarFile: params.avatarFile
				})
			}

			await personasGet.handler(socket, { id }, emitToUser)
			await personasList.handler(socket, {}, emitToUser)
			const res: Sockets.Personas.Update.Response = { persona: updated }
			emitToUser("personas:update", res)
			return res
		} catch (e: any) {
			console.error("Error updating persona:", e)
			emitToUser("personas:update:error", {
				error: e.message || "Failed to update persona."
			})
			throw e
		}
	}
}

export const personasDelete: Handler<
	Sockets.Personas.Delete.Params,
	Sockets.Personas.Delete.Response
> = {
	event: "personas:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Soft delete the persona by setting isDeleted = true
		await db
			.update(schema.personas)
			.set({ isDeleted: true })
			.where(
				and(
					eq(schema.personas.id, params.id),
					eq(schema.personas.userId, userId)
				)
			)
		await personasList.handler(socket, {}, emitToUser)
		const res: Sockets.Personas.Delete.Response = {
			success: "Persona deleted successfully"
		}
		emitToUser("personas:delete", res)
		return res
	}
}

export const personasSearchLibrary: Handler<Sockets.Personas.SearchLibrary.Params, Sockets.Personas.SearchLibrary.Response> = {
	event: "personas:searchLibrary",
	handler: async (socket, params, emitToUser) => {
		try {
			// Fetch personas YAML from GitHub
			const response = await fetch(
				"https://raw.githubusercontent.com/doolijb/serene-pub-chara-list/main/personas.yaml"
			)

			if (!response.ok) {
				throw new Error(`GitHub API error: ${response.status}`)
			}

			const yamlText = await response.text()

			// Parse YAML - simple parsing for flat persona list
			const personas: Array<{
				name: string
				description: string
				tags: string[]
				author: string
				version: string
				spec: string
				file: string
				category: string
			}> = []

			const lines = yamlText.split("\n")
			let currentCard: any = null
			let inDescriptionBlock = false
			let descriptionBuffer = ""

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]
				const trimmed = line.trim()

				// Card start (top level array item)
				if (trimmed.startsWith("- name:") && line.match(/^  - name:/)) {
					// Save previous card if exists
					if (currentCard) {
						if (inDescriptionBlock) {
							currentCard.description = descriptionBuffer.trim()
							inDescriptionBlock = false
							descriptionBuffer = ""
						}
						personas.push(currentCard)
					}
					currentCard = {
						name: trimmed.replace("- name:", "").trim(),
						description: "",
						tags: [],
						author: "",
						version: "",
						spec: "V3",
						file: "",
						category: "Uncategorized"
					}
				} else if (currentCard) {
					// Check for multiline description
					if (trimmed.startsWith("description:")) {
						const afterColon = trimmed.replace("description:", "").trim()
						if (afterColon === "|-" || afterColon === "|") {
							inDescriptionBlock = true
							descriptionBuffer = ""
						} else {
							currentCard.description = afterColon
						}
					} else if (inDescriptionBlock) {
						// Continue reading description block
						if (line.match(/^    [^ ]/) && !line.match(/^      /)) {
							// End of description block (next field at same level)
							currentCard.description = descriptionBuffer.trim()
							inDescriptionBlock = false
							descriptionBuffer = ""
							// Process this line as a new field
							i-- // Re-process this line
							continue
						} else if (line.match(/^      /)) {
							// Part of description
							descriptionBuffer += line.substring(6) + "\n"
						}
					} else if (trimmed.startsWith("tags:") && line.match(/^    tags:/)) {
						// Tags array follows
						let j = i + 1
						while (j < lines.length && lines[j].match(/^      - /)) {
							const tag = lines[j].trim().replace("- ", "")
							if (tag) currentCard.tags.push(tag)
							j++
						}
					} else if (trimmed.startsWith("author:") && line.match(/^    author:/)) {
						currentCard.author = trimmed.replace("author:", "").trim()
					} else if (trimmed.startsWith("version:") && line.match(/^    version:/)) {
						currentCard.version = trimmed.replace("version:", "").trim()
					} else if (trimmed.startsWith("file:") && line.match(/^    file:/)) {
						currentCard.file = trimmed.replace("file:", "").trim()
					} else if (trimmed.startsWith("category:") && line.match(/^    category:/)) {
						const cat = trimmed.replace("category:", "").trim()
						if (cat && cat !== "null") {
							currentCard.category = cat
						}
					}
				}
			}

			// Add last card
			if (currentCard) {
				if (inDescriptionBlock) {
					currentCard.description = descriptionBuffer.trim()
				}
				personas.push(currentCard)
			}

			// Filter by search term if provided
			let filteredPersonas = personas
			if (params.searchTerm) {
				const searchLower = params.searchTerm.toLowerCase()
				filteredPersonas = personas.filter(
					(p) =>
						p.name.toLowerCase().includes(searchLower) ||
						p.description.toLowerCase().includes(searchLower) ||
						p.category.toLowerCase().includes(searchLower) ||
						p.tags.some((t) => t.toLowerCase().includes(searchLower))
				)
			}

			const res: Sockets.Personas.SearchLibrary.Response = {
				personas: filteredPersonas
			}
			emitToUser("personas:searchLibrary", res)
			return res
		} catch (error: any) {
			console.error("Persona library search error:", error)
			emitToUser("personas:searchLibrary:error", {
				error: "Failed to search persona library"
			})
			throw error
		}
	}
}

export const personasImportCard: Handler<Sockets.Personas.ImportCard.Params, Sockets.Personas.ImportCard.Response> = {
	event: "personas:importCard",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Parse persona card using shared utility
			const { card, avatarBuffer } = await parseCharacterCardFromBase64(params.file)

			// Convert card to V3 spec to access data
			const specData = card.toSpecV3()
			const data = specData.data

			// Create persona from spec data
			const personaData: InsertPersona = {
				userId,
				name: data.name || "Unnamed Persona",
				description: data.description || "",
				isDefault: false
			}

			// Create the persona
			const [persona] = await db
				.insert(schema.personas)
				.values(personaData)
				.returning()

			// Handle avatar upload if present
			if (avatarBuffer) {
			await handlePersonaAvatarUpload({
				persona,
				avatarFile: avatarBuffer
			})
			
			// Refetch persona to get updated avatar path
			const updatedPersona = await db.query.personas.findFirst({
				where: eq(schema.personas.id, persona.id)
			})
			if (updatedPersona) {
				Object.assign(persona, updatedPersona)
			}
		}

		await personasList.handler(socket, {}, emitToUser)
		const res: Sockets.Personas.ImportCard.Response = { persona }
		emitToUser("personas:importCard", res)
		return res
		} catch (error: any) {
			console.error("Error importing persona card:", error)
			emitToUser("personas:importCard:error", {
				error: error.message || "Failed to import persona card."
			})
			throw error
		}
	}
}

export const personasImportFromLibrary: Handler<Sockets.Personas.ImportFromLibrary.Params, Sockets.Personas.ImportFromLibrary.Response> = {
	event: "personas:importFromLibrary",
	handler: async (socket, params, emitToUser) => {
		try {
			// Fetch the persona card file from GitHub
			const fileUrl = `https://raw.githubusercontent.com/doolijb/serene-pub-chara-list/main/${params.fileUrl}`
			const response = await fetch(fileUrl)

			if (!response.ok) {
				throw new Error(`Failed to fetch persona file: ${response.status}`)
			}

			// Get the file as a buffer
			const arrayBuffer = await response.arrayBuffer()
			const buffer = Buffer.from(arrayBuffer)

			// Convert to base64 for the import handler
			const base64 = buffer.toString("base64")

			// Use the existing import handler
			const importResult = await personasImportCard.handler(
				socket,
				{ file: base64 },
				emitToUser
			)

			const res: Sockets.Personas.ImportFromLibrary.Response = {
				persona: importResult.persona
			}
			emitToUser("personas:importFromLibrary", res)
			return res
		} catch (error: any) {
			console.error("Persona import from library error:", error)
			emitToUser("personas:importFromLibrary:error", {
				error: "Failed to import persona from library"
			})
			throw error
		}
	}
}

// Registration function for all persona handlers
export function registerPersonaHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, personasList, emitToUser)
	register(socket, personasGet, emitToUser)
	register(socket, personasCreate, emitToUser)
	register(socket, personasUpdate, emitToUser)
	register(socket, personasDelete, emitToUser)
	register(socket, personasImportCard, emitToUser)
	register(socket, personasSearchLibrary, emitToUser)
	register(socket, personasImportFromLibrary, emitToUser)
}
