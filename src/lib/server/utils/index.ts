import path from "path"
import envPaths from "env-paths"
import { db } from "$lib/server/db"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { writeFile, mkdir } from "fs/promises"
import { v4 as uuid } from "uuid"

/**
 * Gets the application data directory with optional override from environment
 * Checks SERENE_PUB_DATA_DIR environment variable first, falls back to envPaths
 */
export function getAppDataDir() {
	const envDataDir = process.env.SERENE_PUB_DATA_DIR
	if (envDataDir) {
		return envDataDir
	}

	const paths = envPaths("SerenePub", { suffix: "" })
	return paths.data
}

/**
 * Gets the database data directory (app data dir + /data)
 * Includes CI environment check for compatibility with existing logic
 */
export function getDbDataDir() {
	const isCI = process.env.CI === "true"
	if (isCI) {
		return "~/SerenePubData"
	}

	const appDataDir = getAppDataDir()
	return path.join(appDataDir, "data")
}

export function getCharacterDataDir({
	characterId,
	userId
}: {
	characterId: number
	userId: number
}) {
	const appData = getAppDataDir()
	return path.join(
		appData,
		"data",
		"users",
		String(userId),
		"characters",
		String(characterId)
	)
}

export function getPersonaDataDir({
	personaId,
	userId
}: {
	personaId: number
	userId: number
}) {
	const appData = getAppDataDir()
	return path.join(
		appData,
		"data",
		"users",
		String(userId),
		"personas",
		String(personaId)
	)
}

export async function handleCharacterAvatarUpload({
	character,
	avatarFile
}: {
	character: any
	avatarFile: Buffer
}) {
	const ext = character.avatarType?.split("/")[1] || "png"
	const filename = `avatar-${uuid().substring(0, 4)}.${ext}`
	const avatarDir = getCharacterDataDir({
		characterId: character.id,
		userId: character.userId
	})
	const oldAvatar = character.avatar
	// Ensure the directory exists
	await mkdir(avatarDir, { recursive: true })
	// Save the new avatar file
	const filePath = path.join(avatarDir, filename)
	await writeFile(filePath, avatarFile, { flag: "w" }) // Write the file to disk
	const avatar = `/images/data/users/${character.userId}/characters/${character.id}/${filename}` // Construct URL for the avatar
	await db
		.update(schema.characters)
		.set({ avatar })
		.where(eq(schema.characters.id, character.id))
	// Delete old avatar file if it exists and is not the same as the new one
	if (oldAvatar && oldAvatar !== avatar) {
		try {
			const oldAvatarPath = path.join(avatarDir, path.basename(oldAvatar))
			await import("fs/promises").then((fs) => fs.unlink(oldAvatarPath))
		} catch (e) {
			// Ignore error if file does not exist
		}
	}
}

export function getUserBackgroundsDir({ userId }: { userId: number }) {
	const appData = getAppDataDir()
	return path.join(appData, "data", "users", String(userId), "backgrounds")
}

export async function handleUserBackgroundUpload({
	userId,
	backgroundFile,
	mimeType
}: {
	userId: number
	backgroundFile: Buffer | Uint8Array
	mimeType: string
}) {
	const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg"
	const filename = `bg-${uuid().substring(0, 8)}.${ext}`
	const bgDir = getUserBackgroundsDir({ userId })
	await mkdir(bgDir, { recursive: true })
	const filePath = path.join(bgDir, filename)
	await writeFile(filePath, backgroundFile, { flag: "w" })
	return `/images/data/users/${userId}/backgrounds/${filename}`
}

export async function listUserBackgrounds({ userId }: { userId: number }) {
	const bgDir = getUserBackgroundsDir({ userId })
	try {
		const { readdir } = await import("fs/promises")
		const files = await readdir(bgDir)
		return files
			.filter((f) => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(f))
			.map((f) => `/images/data/users/${userId}/backgrounds/${f}`)
	} catch {
		return []
	}
}

export async function deleteUserBackground({
	userId,
	path: bgPath
}: {
	userId: number
	path: string
}) {
	// Safety: only allow deleting files within this user's backgrounds dir
	const bgDir = getUserBackgroundsDir({ userId })
	const filename = path.basename(bgPath)
	const fullPath = path.join(bgDir, filename)
	// Ensure the resolved path is inside the expected directory
	if (!fullPath.startsWith(bgDir)) return
	try {
		const { unlink } = await import("fs/promises")
		await unlink(fullPath)
	} catch {
		// File already gone — ignore
	}
}

export async function handlePersonaAvatarUpload({
	persona,
	avatarFile
}: {
	persona: any
	avatarFile: Buffer
}) {
	const ext = persona.avatarType?.split("/")[1] || "png"
	const filename = `avatar-${uuid().substring(0, 4)}.${ext}` // Use UUID to ensure unique filename
	const avatarDir = getPersonaDataDir({
		personaId: persona.id,
		userId: persona.userId
	})
	const oldAvatar = persona.avatar
	// Ensure the directory exists
	await mkdir(avatarDir, { recursive: true })
	// Save the new avatar file
	const filePath = path.join(avatarDir, filename)
	await writeFile(filePath, avatarFile, { flag: "w" }) // Write the file to disk
	const avatar = `/images/data/users/${persona.userId}/personas/${persona.id}/${filename}` // Construct URL for the avatar
	await db
		.update(schema.personas)
		.set({ avatar })
		.where(eq(schema.personas.id, persona.id))
	// Delete old avatar file if it exists and is not the same as the new one
	if (oldAvatar && oldAvatar !== avatar) {
		try {
			const oldAvatarPath = path.join(avatarDir, path.basename(oldAvatar))
			await import("fs/promises").then((fs) => fs.unlink(oldAvatarPath))
		} catch (e) {
			// Ignore error if file does not exist
		}
	}
}
