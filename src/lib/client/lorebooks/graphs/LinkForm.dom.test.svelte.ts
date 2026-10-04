/**
 * The link form's far end (plan places-graph B4): a searchable picker over
 * every place on the line and the canvas, plus **New place…**, which makes the
 * place on the spot and points the link at it.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import LinkForm from "./LinkForm.svelte"
import { newLinkDraft, type LinkDraft } from "./linkDraft"
import type { GraphNode } from "./graphModel"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"

const tick = () => new Promise((r) => setTimeout(r, 0))

const place = (id: number, name: string): GraphNode => ({
	key: `entry#${id}`,
	kind: "entry",
	id,
	name,
	state: "active",
	visibility: "normal",
	typeId: LOCATION_TYPE_ID
})
const guardroom = place(1, "The Guardroom")
const hall = place(2, "The Drowned Hall")
const crypt = place(3, "The Crypt")
const verity: GraphNode = {
	key: "cast#7",
	kind: "cast",
	id: 7,
	name: "Verity",
	state: "active",
	visibility: "normal"
}

describe("LinkForm — the other end", () => {
	let app: ReturnType<typeof mount> | null = null

	afterEach(() => {
		if (app) unmount(app)
		app = null
		document.body.replaceChildren()
	})

	async function render(
		draft: LinkDraft,
		over: Partial<{
			onNewPlace: (name: string) => Promise<GraphNode>
			startWithNewPlace: boolean
			newPlaceName: string
		}> = {}
	) {
		const props = $state({
			draft,
			candidates: [guardroom, hall, crypt, verity],
			saving: false,
			onChange: (next: LinkDraft) => {
				props.draft = next
			},
			onSubmit: () => {},
			onCancel: () => {},
			...over
		})
		const host = document.createElement("div")
		document.body.append(host)
		app = mount(LinkForm, { target: host, props })
		flushSync()
		await tick()
		flushSync()
		return props
	}

	/** The options of the listbox that is open — the other end's. */
	const openOptions = () => [
		...document.querySelectorAll<HTMLElement>(
			'[data-part="content"][data-state="open"] [role=option]'
		)
	]
	const offered = () =>
		openOptions().map((o) =>
			(o.textContent ?? "").replace(/\s+/g, " ").trim()
		)

	async function openPicker() {
		;(
			document.querySelector(
				'button[aria-label="Show The other end options"]'
			) as HTMLButtonElement
		).click()
		flushSync()
		await tick()
		flushSync()
	}

	async function pick(label: string) {
		const option = openOptions().find(
			(o) => (o.textContent ?? "").trim() === label
		)
		expect(option, `option ${label}`).toBeTruthy()
		option!.click()
		flushSync()
		await tick()
		flushSync()
	}

	test("offers every candidate but its own end, and New place…", async () => {
		await render(newLinkDraft(guardroom, hall), {
			onNewPlace: async () => crypt
		})
		await openPicker()
		expect(offered()).toEqual([
			"The Drowned Hall",
			"The Crypt",
			"Verity",
			"New place…"
		])
	})

	test("offers no New place… when nothing can make one", async () => {
		await render(newLinkDraft(guardroom, hall))
		await openPicker()
		expect(offered()).not.toContain("New place…")
	})

	test("picking a far end of another pairing offers that pairing's words", async () => {
		const props = await render(newLinkDraft(guardroom, hall))
		expect(props.draft.relationshipType).toBe("connects to")
		await openPicker()
		await pick("Verity")
		expect(props.draft.to.key).toBe("cast#7")
		expect(props.draft.relationshipType).toBe("keeps")
		expect(props.draft.reverseRelationshipType).toBeNull()
		// The words read from the member, so the draft reads from her too.
		expect(props.draft.reversed).toBe(true)
	})

	test("New place… makes the place and points the link at it", async () => {
		const made = place(9, "The Old Well")
		const onNewPlace = vi.fn(async (_name: string) => made)
		const props = await render(newLinkDraft(guardroom, hall), {
			onNewPlace
		})
		await openPicker()
		await pick("New place…")
		const field = document.querySelector<HTMLInputElement>(
			"[data-new-place] input"
		)!
		expect(field).toBeTruthy()
		field.value = "The Old Well"
		field.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		;(
			document.querySelector(
				"[data-new-place] button[type=submit]"
			) as HTMLButtonElement
		).click()
		await tick()
		flushSync()
		expect(onNewPlace).toHaveBeenCalledWith("The Old Well")
		expect(props.draft.to.key).toBe("entry#9")
		expect(document.querySelector("[data-new-place]")).toBeNull()
	})

	test("New place… stays offered while typing, and starts from what was typed", async () => {
		await render(newLinkDraft(guardroom, hall), {
			onNewPlace: async () => crypt
		})
		const input = document.querySelector<HTMLInputElement>(
			"[data-graph-link-form] input[role=combobox]"
		)!
		input.focus()
		input.value = "Old Well"
		input.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "l",
				inputType: "insertText"
			})
		)
		flushSync()
		await tick()
		flushSync()
		// Nothing typed matches; the pick in force keeps its row (Select's rule).
		expect(offered()).toEqual(["New place…", "The Drowned Hall"])
		await pick("New place…")
		expect(
			document.querySelector<HTMLInputElement>("[data-new-place] input")
				?.value
		).toBe("Old Well")
	})

	test("text typed and abandoned with Escape is not what New place… starts from", async () => {
		await render(newLinkDraft(guardroom, hall), {
			onNewPlace: async () => crypt
		})
		const input = document.querySelector<HTMLInputElement>(
			"[data-graph-link-form] input[role=combobox]"
		)!
		input.focus()
		input.value = "Old Well"
		input.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "l",
				inputType: "insertText"
			})
		)
		flushSync()
		await tick()
		flushSync()
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
		)
		flushSync()
		await tick()
		flushSync()
		expect(openOptions()).toHaveLength(0)
		await openPicker()
		await pick("New place…")
		expect(
			document.querySelector<HTMLInputElement>("[data-new-place] input")
				?.value
		).toBe("")
	})

	test("opened for New place…, it asks for the place before Name it", async () => {
		await render(newLinkDraft(guardroom, guardroom), {
			onNewPlace: async () => crypt,
			startWithNewPlace: true,
			newPlaceName: "The Old Well"
		})
		const field = document.querySelector<HTMLInputElement>(
			"[data-new-place] input"
		)
		expect(field?.value).toBe("The Old Well")
		const nameIt = [...document.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Name it")
		)!
		expect(nameIt.disabled).toBe(true)
		expect(nameIt.title).toBe("Pick the other end.")
		expect(document.body.textContent).toContain("The Guardroom → …")
	})

	test("a refused place keeps the name and says why", async () => {
		const props = await render(newLinkDraft(guardroom, guardroom), {
			onNewPlace: async () => {
				throw new Error("Name is required")
			},
			startWithNewPlace: true,
			newPlaceName: "The Old Well"
		})
		;(
			document.querySelector(
				"[data-new-place] button[type=submit]"
			) as HTMLButtonElement
		).click()
		await tick()
		flushSync()
		expect(
			document.querySelector("[data-new-place] [role=alert]")?.textContent
		).toContain("Name is required")
		expect(
			document.querySelector<HTMLInputElement>("[data-new-place] input")
				?.value
		).toBe("The Old Well")
		expect(props.draft.to.key).toBe("entry#1")
	})
})
