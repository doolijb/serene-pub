/**
 * A choice list in a generated form reads as words (seen live 2026-09-28).
 *
 * `SchemaForm` built each option from `of` alone, label = value, so the
 * Messages widget offered "classic", "oldest-first" and "writer", and a genre
 * field declared only through `members` offered nothing at all. A declared
 * member label now shows; an option nobody labelled shows its value humanised;
 * and what is stored is still the value.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import SchemaForm from "./SchemaForm.svelte"

describe("SchemaForm choice labels", () => {
	let app: ReturnType<typeof mount> | null = null
	let host: HTMLElement
	const props = { values: {} as Record<string, unknown>, commits: 0 }

	beforeEach(() => {
		props.values = {}
		props.commits = 0
		host = document.createElement("div")
		document.body.append(host)
		app = mount(SchemaForm, {
			target: host,
			props: {
				schema: {
					composer: {
						type: "enum",
						label: "Composer",
						of: ["classic", "minimal", "writer"],
						members: [
							{ key: "classic", label: { en: "Card" } },
							{ key: "writer", label: "Tall editor" }
						],
						default: "classic"
					},
					order: {
						type: "enum",
						label: "Message order",
						of: ["oldest-first", "newest-first"],
						default: "oldest-first"
					},
					detail: {
						type: "enum",
						label: "Character detail",
						members: [
							{ key: "full", label: "Everything" },
							{ key: "speaker-only" }
						]
					}
				} as any,
				values: props.values,
				oncommit: () => props.commits++
			}
		})
		flushSync()
	})

	afterEach(() => {
		if (app) unmount(app)
		app = null
		document.body.innerHTML = ""
	})

	async function settle() {
		flushSync()
		await tick()
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
	}

	/** The rows of the one popup that is open — every Select keeps its own. */
	function openOptions(): HTMLElement[] {
		return [
			...document.querySelectorAll<HTMLElement>(
				'[role="listbox"][data-state="open"] [role="option"]'
			)
		]
	}

	async function optionTexts(label: string): Promise<string[]> {
		const trigger = host.querySelector<HTMLButtonElement>(
			`button[aria-label="Show ${label} options"]`
		)
		expect(trigger).not.toBeNull()
		trigger!.click()
		await settle()
		return openOptions().map((o) => o.textContent?.trim() ?? "")
	}

	test("a declared label shows, in the box and in the list", async () => {
		const box = host.querySelectorAll<HTMLInputElement>("input")[0]
		expect(box.value).toBe("Card")
		const texts = await optionTexts("Composer")
		expect(texts).toContain("Card")
		expect(texts).toContain("Tall editor")
		expect(texts).not.toContain("classic")
		expect(texts).not.toContain("writer")
	})

	test("an undeclared option shows its humanised value", async () => {
		const texts = await optionTexts("Message order")
		expect(texts).toEqual(["Oldest first", "Newest first"])
		expect(texts.join(" ")).not.toContain("oldest-first")
	})

	test("an enum declared only through members still lists its options", async () => {
		const texts = await optionTexts("Character detail")
		expect(texts).toEqual(["Everything", "Speaker only"])
	})

	test("the stored value is unchanged", async () => {
		await optionTexts("Message order")
		const option = openOptions().find((o) => o.textContent?.trim() === "Newest first")
		expect(option).toBeTruthy()
		option!.click()
		await settle()
		expect(props.values.order).toBe("newest-first")
		expect(props.commits).toBeGreaterThan(0)
	})
})
