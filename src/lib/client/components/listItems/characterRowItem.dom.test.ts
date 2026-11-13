import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import CharacterRowItem from "./CharacterRowItem.svelte"
import type { CharacterRow } from "$lib/shared/characters/characterRows"

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
	return {
		rowKey: "card:7",
		hasCard: true,
		cardId: 7,
		castMemberId: null,
		cardIsMine: true,
		shownName: "Brix",
		nickname: null,
		summary: "The station's crew support.",
		face: null,
		reach: {
			lorebookCount: 2,
			lorebook: null
		},
		hasOwnWords: false,
		isFavorite: false,
		isPersona: false,
		isDefaultPersona: false,
		embeddingModel: null,
		folderId: null,
		isSharedWithMe: false,
		ownerName: null,
		readableMember: null,
		tags: [],
		...over
	}
}

let apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps) unmount(app)
	apps = []
	document.body.innerHTML = ""
})

function render(props: Record<string, unknown>) {
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(
		mount(CharacterRowItem, {
			target: host,
			props: { layout: "list", ...props } as any
		})
	)
	flushSync()
	return host
}

const memberRow = () =>
	makeRow({
		rowKey: "member:9",
		hasCard: false,
		cardId: null,
		castMemberId: 9,
		cardIsMine: false,
		shownName: "Zed",
		summary: "",
		reach: {
			lorebookCount: 1,
			lorebook: {
				id: 4,
				name: "Vale",
				sessionId: null,
				sessionName: null
			}
		}
	})

async function openMenu(host: HTMLElement) {
	const trigger = host.querySelector(
		'button[aria-label="Character options"]'
	) as HTMLElement
	trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
	trigger.click()
	await new Promise((r) => setTimeout(r, 50))
	flushSync()
	return document.body.textContent ?? ""
}

describe("CharacterRowItem", () => {
	test("a card row shows the Card badge, the summary and the reach line", () => {
		const host = render({ row: makeRow() })
		expect(host.querySelector('[data-badge="surface"]')?.textContent).toBe(
			"Card"
		)
		expect(host.textContent).toContain("The station's crew support.")
		expect(host.textContent).toContain("In 2 lorebooks")
	})

	test("a member row has no badge, the initial and its book", () => {
		const host = render({ row: memberRow() })
		expect(host.querySelector("[data-badge]")).toBeNull()
		expect(host.textContent).toContain("In Vale")
		expect(host.textContent).toContain("Z")
	})

	test("a shared row leads with From owner", () => {
		const host = render({
			row: makeRow({
				cardIsMine: false,
				isSharedWithMe: true,
				ownerName: "Ana"
			})
		})
		expect(host.textContent).toContain("From Ana")
		expect(host.textContent).not.toContain("The station's crew support.")
	})

	test("the +N title lists the tag names", () => {
		const host = render({
			row: makeRow({
				tags: [
					{ name: "noir", colorPreset: null },
					{ name: "sci-fi", colorPreset: null }
				]
			})
		})
		const more = host.querySelector("[title='noir, sci-fi']")
		expect(more?.textContent?.trim()).toBe("+2")
	})

	test("the nickname is shown first in list and card modes; the name when none", () => {
		const list = render({ row: makeRow({ nickname: "Bee" }) })
		expect(
			list.querySelector("#character-name-card-7")?.textContent
		).toContain("Bee")
		expect(
			list.querySelector("#character-name-card-7")?.textContent
		).not.toContain("Brix")
		const cards = render({
			row: makeRow({ nickname: "Bee" }),
			layout: "cards",
			onclick: () => {}
		})
		expect(cards.textContent).toContain("Bee")
		expect(cards.textContent).not.toContain("Brix")
		expect(
			cards.querySelector("button")?.getAttribute("aria-label")
		).toContain("Bee")
		const plain = render({ row: makeRow() })
		expect(
			plain.querySelector("#character-name-card-7")?.textContent
		).toContain("Brix")
		const noCard = render({ row: { ...memberRow(), nickname: "Zee" } })
		expect(noCard.textContent).toContain("Zee")
	})

	test("both layouts render", () => {
		const list = render({ row: makeRow(), layout: "list" })
		expect(list.querySelector("#character-name-card-7")).not.toBeNull()
		const cards = render({
			row: makeRow(),
			layout: "cards",
			onclick: () => {}
		})
		expect(cards.textContent).toContain("Brix")
		expect(cards.textContent).toContain("Card")
		expect(cards.textContent).toContain("In 2 lorebooks")
	})

	test("the menu offers Copy to my characters only with onCopy", async () => {
		const without = render({ row: makeRow(), onclick: () => {} })
		expect(await openMenu(without)).not.toContain("Copy to my characters")
		for (const app of apps) unmount(app)
		apps = []
		document.body.innerHTML = ""
		const withCopy = render({
			row: makeRow({ cardIsMine: false }),
			onclick: () => {},
			onCopy: () => {}
		})
		expect(await openMenu(withCopy)).toContain("Copy to my characters")
	})
})
