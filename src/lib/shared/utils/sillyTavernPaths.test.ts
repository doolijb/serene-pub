import { describe, expect, test } from "vitest"
import {
	resolveSillyTavernDataRoot,
	relativeToDataRoot,
	isRelevantImportPath,
	isSillyTavernChatHistoryPath,
	SILLYTAVERN_DIRS
} from "./sillyTavernPaths"

/**
 * A real SillyTavern tree, as SillyTavern itself lays one out under
 * `data/default-user/` — ITS folder names, not ours (NOMENCLATURE R5). A
 * rename sweep once turned `chats/` into `sessions/` in code, and no real
 * folder matched; this list is what a real install actually has on disk.
 */
const REAL_ST_TREE = [
	"SillyTavern/data/default-user/settings.json",
	"SillyTavern/data/default-user/characters/Aria.png",
	"SillyTavern/data/default-user/characters/Aria/joy.png",
	"SillyTavern/data/default-user/chats/Aria/Aria - 2024-01-01@12h00m00s.jsonl",
	"SillyTavern/data/default-user/chats/Aria/Branch #1 - 2024-01-02@09h30m00s.jsonl",
	"SillyTavern/data/default-user/groups/1700000000000.json",
	"SillyTavern/data/default-user/group chats/2024-01-03@18h00m00s.jsonl",
	"SillyTavern/data/default-user/worlds/Eldoria.json",
	"SillyTavern/data/default-user/User Avatars/user-default.png",
	"SillyTavern/data/default-user/backgrounds/forest.jpg",
	"SillyTavern/data/default-user/extensions/some-ext/index.js"
]

describe("a real SillyTavern tree", () => {
	test("its folder names are SillyTavern's own", () => {
		expect(SILLYTAVERN_DIRS.chats).toBe("chats")
		expect(SILLYTAVERN_DIRS.groupChats).toBe("group chats")
		expect(SILLYTAVERN_DIRS.userAvatars).toBe("User Avatars")
	})

	test("resolves the data root from chats/ alone", () => {
		expect(
			resolveSillyTavernDataRoot([
				"backup/default-user/chats/Aria/Aria - 2024-01-01@12h00m00s.jsonl"
			])
		).toBe("backup/default-user")
	})

	test("keeps every chat-history file and flags it as deferred", () => {
		const root = resolveSillyTavernDataRoot(REAL_ST_TREE)
		expect(root).toBe("SillyTavern/data/default-user")
		const relevant = REAL_ST_TREE.map((p) =>
			relativeToDataRoot(p, root!)
		).filter(isRelevantImportPath)
		expect(relevant.filter(isSillyTavernChatHistoryPath)).toEqual([
			"chats/Aria/Aria - 2024-01-01@12h00m00s.jsonl",
			"chats/Aria/Branch #1 - 2024-01-02@09h30m00s.jsonl",
			"group chats/2024-01-03@18h00m00s.jsonl"
		])
		expect(
			relevant.filter((p) => !isSillyTavernChatHistoryPath(p))
		).toEqual([
			"settings.json",
			"characters/Aria.png",
			"characters/Aria/joy.png",
			"groups/1700000000000.json",
			"worlds/Eldoria.json",
			"User Avatars/user-default.png"
		])
	})
})

describe("resolveSillyTavernDataRoot", () => {
	test("resolves when the picked folder is the data root itself", () => {
		const root = resolveSillyTavernDataRoot([
			"characters/Aria.png",
			"chats/Aria/2024-01-01.jsonl",
			"settings.json"
		])
		expect(root).toBe("")
	})

	test("resolves a plain SillyTavern root (data/default-user layout)", () => {
		const root = resolveSillyTavernDataRoot([
			"SillyTavern/data/default-user/characters/Aria.png",
			"SillyTavern/data/default-user/settings.json"
		])
		expect(root).toBe("SillyTavern/data/default-user")
	})

	test("resolves a SillyTavern-Launcher root (nested SillyTavern/ subfolder)", () => {
		const root = resolveSillyTavernDataRoot([
			"SillyTavern-Launcher/SillyTavern/data/default-user/characters/Aria.png",
			"SillyTavern-Launcher/other-stuff/readme.txt"
		])
		expect(root).toBe("SillyTavern-Launcher/SillyTavern/data/default-user")
	})

	test("resolves a bare 'public' layout (legacy single-user installs)", () => {
		const root = resolveSillyTavernDataRoot([
			"SillyTavern/public/characters/Aria.png"
		])
		expect(root).toBe("SillyTavern/public")
	})

	test("resolves when the user picked data/default-user directly", () => {
		const root = resolveSillyTavernDataRoot([
			"default-user/characters/Aria.png",
			"default-user/worlds/MyWorld.json"
		])
		expect(root).toBe("default-user")
	})

	test("falls back to settings.json alone for persona-only backups", () => {
		const root = resolveSillyTavernDataRoot([
			"SillyTavern/data/default-user/settings.json"
		])
		expect(root).toBe("SillyTavern/data/default-user")
	})

	test("returns null when nothing recognizable is present", () => {
		const root = resolveSillyTavernDataRoot([
			"random-backup/notes.txt",
			"random-backup/photo.png"
		])
		expect(root).toBeNull()
	})

	test("normalizes backslashes (Windows-style paths)", () => {
		const root = resolveSillyTavernDataRoot([
			"SillyTavern\\data\\default-user\\characters\\Aria.png"
		])
		expect(root).toBe("SillyTavern/data/default-user")
	})
})

describe("relativeToDataRoot", () => {
	test("strips the root prefix", () => {
		expect(
			relativeToDataRoot(
				"SillyTavern/data/default-user/characters/Aria.png",
				"SillyTavern/data/default-user"
			)
		).toBe("characters/Aria.png")
	})

	test("passes paths through unchanged when root is empty", () => {
		expect(relativeToDataRoot("characters/Aria.png", "")).toBe(
			"characters/Aria.png"
		)
	})

	test("normalizes backslashes even without a root prefix to strip", () => {
		expect(relativeToDataRoot("characters\\Aria.png", "")).toBe(
			"characters/Aria.png"
		)
	})
})

describe("isRelevantImportPath", () => {
	test.each([
		"settings.json",
		"characters/Aria.png",
		"chats/Aria/2024-01-01.jsonl",
		"groups/group1.json",
		"group chats/abc123.jsonl",
		"worlds/MyWorld.json",
		"User Avatars/MyPersona.png"
	])("accepts %s", (p) => {
		expect(isRelevantImportPath(p)).toBe(true)
	})

	test.each([
		"extensions/some-extension/cache.db",
		"backgrounds/forest.jpg",
		"assets/icon.png",
		"NovelAI Settings/preset.json",
		".git/config",
		// Serene Pub's word is not SillyTavern's folder (R5).
		"sessions/Aria/2024-01-01.jsonl",
		"group sessions/abc123.jsonl"
	])("rejects %s", (p) => {
		expect(isRelevantImportPath(p)).toBe(false)
	})
})
