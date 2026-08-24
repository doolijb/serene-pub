import { describe, expect, test } from "vitest"
import {
	resolveSillyTavernDataRoot,
	relativeToDataRoot,
	isRelevantImportPath
} from "./sillyTavernPaths"

describe("resolveSillyTavernDataRoot", () => {
	test("resolves when the picked folder is the data root itself", () => {
		const root = resolveSillyTavernDataRoot([
			"characters/Aria.png",
			"sessions/Aria/2024-01-01.jsonl",
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
		"sessions/Aria/2024-01-01.jsonl",
		"groups/group1.json",
		"group sessions/abc123.jsonl",
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
		".git/config"
	])("rejects %s", (p) => {
		expect(isRelevantImportPath(p)).toBe(false)
	})
})
