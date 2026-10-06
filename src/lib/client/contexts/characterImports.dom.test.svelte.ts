/**
 * The characters-import context is the one subscriber to the import events and
 * the only place their toasts are shown: one toast per import however many
 * views are open, none for the Library's own reply (the card-import reply
 * already announced it), one per refusal, and every registered view hears the
 * reply until it releases.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const { listeners, toasts } = vi.hoisted(() => ({
	listeners: new Map<string, (msg: any) => void>(),
	toasts: [] as Array<{ kind: string; title: string }>
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	useInterest: (key: string, handler: (msg: any) => void) =>
		listeners.set(key, handler)
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: (t: any) => toasts.push({ kind: "success", ...t }),
		warning: (t: any) => toasts.push({ kind: "warning", ...t }),
		error: (t: any) => toasts.push({ kind: "error", ...t })
	}
}))

import { createCharacterImports } from "./characterImports.svelte"

const fire = (event: string, msg: unknown) => listeners.get(event)!(msg)
const created = {
	status: "created",
	character: { id: 7, name: "Aria", nickname: null },
	book: null
}

beforeEach(() => {
	listeners.clear()
	toasts.length = 0
})

describe("characters-import context", () => {
	test("one import is one toast, however many views listen", () => {
		let ctx!: ReturnType<typeof createCharacterImports>
		const cleanup = $effect.root(() => {
			ctx = createCharacterImports()
		})
		const heardBy: string[] = []
		ctx.addImportedListener(() => heardBy.push("sidebar"))
		ctx.addImportedListener(() => heardBy.push("home"))
		fire("characters:importCard", created)
		expect(toasts).toEqual([
			{
				kind: "success",
				title: "Character imported",
				description: "Character Aria imported successfully."
			}
		])
		expect(heardBy).toEqual(["sidebar", "home"])
		cleanup()
	})

	test("a Library import is announced once: its own reply adds no toast", () => {
		let ctx!: ReturnType<typeof createCharacterImports>
		const cleanup = $effect.root(() => {
			ctx = createCharacterImports()
		})
		const library: unknown[] = []
		ctx.addLibraryImportedListener((msg) => library.push(msg))
		fire("characters:importCard", created)
		fire("characters:importFromLibrary", { character: created.character })
		expect(toasts).toHaveLength(1)
		expect(library).toHaveLength(1)
		cleanup()
	})

	test("a conflict shows no toast; its resolution shows one", () => {
		const cleanup = $effect.root(() => {
			createCharacterImports()
		})
		fire("characters:importCard", { status: "conflict", character: null })
		expect(toasts).toHaveLength(0)
		fire("characters:importResolve", {
			character: { name: "Aria" },
			warnings: ["The avatar was too large."]
		})
		expect(toasts).toEqual([
			expect.objectContaining({
				kind: "warning",
				title: "Character imported with warnings"
			})
		])
		cleanup()
	})

	test("each refusal is one error toast", () => {
		const cleanup = $effect.root(() => {
			createCharacterImports()
		})
		fire("characters:importCard:error", { error: "Not a card" })
		fire("characters:importFromLibrary:error", { error: "Source down" })
		fire("characters:importResolve:error", {})
		expect(toasts.map((t) => [t.kind, t.title])).toEqual([
			["error", "Import failed"],
			["error", "Source down"],
			["error", "Failed to resolve character import"]
		])
		cleanup()
	})

	test("a released listener hears nothing more", () => {
		let ctx!: ReturnType<typeof createCharacterImports>
		const cleanup = $effect.root(() => {
			ctx = createCharacterImports()
		})
		let heard = 0
		const release = ctx.addImportedListener(() => heard++)
		fire("characters:importCard", created)
		release()
		fire("characters:importCard", created)
		expect(heard).toBe(1)
		cleanup()
	})
})
