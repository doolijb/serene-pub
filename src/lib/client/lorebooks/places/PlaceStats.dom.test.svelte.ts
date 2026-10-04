/**
 * A place's Stats section (plan places-graph L4): what the lorebook holds
 * for a place before play — put the key in the crypt — read and written at
 * the line and moment the place editor reads.
 *
 * Every write goes to the server at once and the section draws the server's
 * reply, never its own guess. The api is a prop, so these tests stand in for
 * the socket with a fake that answers as the server does.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

import type { PoolItem } from "../poolFilter"
import PlaceStats from "./PlaceStats.svelte"
import type { PlaceStatsApi } from "./placeStatsApi"

const BOOK = 12
const CRYPT = 42
const HARBOR = 43
const KEY = 60
const LAMP = 61
const Y3 = 80
const Y7 = 81
const INVENTORY = "core:slot/inventory@1"
const LAMPS = "test:slot/lamps@1"
const LIT = "test:slot/lit@1"

type Read = Sockets.LorebookState.Get.Response
type Write = Sockets.LorebookState.Set.Params

const inventory: Sockets.State.SlotDescriptor = {
	slotId: INVENTORY,
	key: "inventory",
	qualifiedKey: INVENTORY,
	label: "Inventory",
	type: "list",
	field: { type: "list" } as any,
	appliesTo: ["cast", "world", "location"]
}
const lamps: Sockets.State.SlotDescriptor = {
	slotId: LAMPS,
	key: "lamps",
	qualifiedKey: LAMPS,
	label: "Lamps lit",
	type: "integer",
	appliesTo: ["location"]
}

const lit: Sockets.State.SlotDescriptor = {
	slotId: LIT,
	key: "lit",
	qualifiedKey: LIT,
	label: "Torches lit",
	type: "boolean",
	appliesTo: ["location"]
}

const poolItem = (id: number, kind: string, name: string): PoolItem => ({
	key: `entry#${id}`,
	id,
	kind,
	name,
	content: "",
	keys: [],
	pinned: false,
	off: false,
	archived: false,
	machineWritten: false,
	parentKey: null,
	order: 0,
	position: id,
	priority: 0,
	createdAt: 0,
	updatedAt: 0
})
const POOL = [
	poolItem(CRYPT, "core:entry/location", "The Crypt"),
	poolItem(HARBOR, "core:entry/location", "Harbor"),
	poolItem(KEY, "core:entry/item", "Rusty key"),
	poolItem(LAMP, "core:entry/item", "Brass lamp")
]

/**
 * A fake server: holds the book's values, answers a read with them, and a
 * write by storing the value (or refusing with `refuseNext`). `datedAt`
 * names the history entry dated a year, as the server finds it on the line;
 * `heldSince` the date a value holds from.
 */
function fakeApi(
	start: Record<string, unknown> = {},
	slots = [inventory, lamps],
	opts: { datedAt?: Record<number, number>; heldSince?: Read["heldSince"] } = {}
) {
	const values: Record<string, unknown> = { ...start }
	const reads: Sockets.LorebookState.Get.Params[] = []
	const writes: Write[] = []
	let refuseNext: string | null = null
	const answer = (params: Sockets.LorebookState.Get.Params): Read => {
		const dated = params.moment ? opts.datedAt?.[params.moment.year] : undefined
		return {
			lorebookId: params.lorebookId,
			owner: params.owner,
			branchId: params.branchId,
			moment: params.moment,
			slots,
			values: structuredClone(values) as Read["values"],
			configs: { [INVENTORY]: {}, [LAMPS]: { min: 0, max: 6 } },
			heldSince: structuredClone(opts.heldSince ?? {}),
			writeDatedBy: dated !== undefined && params.moment ? { historyEntryId: dated, date: params.moment } : null
		}
	}
	const api: PlaceStatsApi = {
		async read(params) {
			reads.push(params)
			return answer(params)
		},
		async write(params) {
			writes.push(params)
			if (refuseNext) {
				const why = refuseNext
				refuseNext = null
				throw new Error(why)
			}
			if (params.value === null) delete values[params.slotId]
			else values[params.slotId] = params.value
			return answer(params)
		}
	}
	return {
		api,
		reads,
		writes,
		values,
		refuse(why: string) {
			refuseNext = why
		}
	}
}

const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

function render(
	api: PlaceStatsApi,
	opts: {
		branchId?: number | null
		moment?: string | null
	} = {}
) {
	const host = document.createElement("div")
	document.body.append(host)
	const app = mount(PlaceStats, {
		target: host,
		props: {
			place: { id: CRYPT, name: "The Crypt" },
			lorebookId: BOOK,
			pool: POOL,
			reading: {
				branchId: opts.branchId ?? null,
				moment: opts.moment ?? null
			},
			api
		}
	})
	mounted.push(app)
	flushSync()
	return host
}

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const itemTexts = (host: HTMLElement) =>
	[...host.querySelectorAll("[data-place-stat-item-text]")].map((el) => el.textContent?.trim())
const statOf = (host: HTMLElement, slotId: string) =>
	host.querySelector<HTMLElement>(`[data-place-stat="${slotId}"]`)!
const type = (input: HTMLInputElement, value: string) => {
	input.value = value
	input.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}
const press = (el: HTMLElement, key: string) => {
	el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
	flushSync()
}

describe("PlaceStats — what the book holds for a place", () => {
	test("reads the place at the line and moment being read, then lists its inventory", async () => {
		const server = fakeApi({ [INVENTORY]: [{ entryId: KEY, name: "Rusty key" }] })
		const host = render(server.api, { branchId: 5, moment: "Y7" })
		expect(host.textContent).toContain("Reading this place's stats")
		await settle()
		expect(server.reads).toEqual([
			{ lorebookId: BOOK, owner: { kind: "location", id: CRYPT }, branchId: 5, moment: { year: 7, month: null, day: null } }
		])
		expect(host.querySelector("h4")?.textContent?.trim()).toBe("Stats")
		expect(itemTexts(host)).toEqual(["Rusty key"])
		// A stat the book never set is empty, never zero.
		expect(statOf(host, LAMPS).querySelector<HTMLInputElement>("input")!.value).toBe("")
	})

	test("says why when the server refuses the read", async () => {
		const api: PlaceStatsApi = {
			read: async () => {
				throw new Error("That is not a place of this lorebook on this line, or it is archived at this moment.")
			},
			write: async () => {
				throw new Error("unused")
			}
		}
		const host = render(api)
		await settle()
		expect(host.querySelector('[role="alert"]')?.textContent).toContain("archived at this moment")
	})
})

describe("PlaceStats — put the key in the crypt", () => {
	test("Add from the lorebook puts an item in; the server's date for the moment is said", async () => {
		const server = fakeApi({}, [inventory, lamps], { datedAt: { 3: Y3, 7: Y7 } })
		const host = render(server.api, { moment: "Y7" })
		await settle()
		expect(host.querySelector("[data-place-stats-dating]")?.textContent).toContain("dated Year 7")
		const stat = statOf(host, INVENTORY)
		stat.querySelector<HTMLButtonElement>('button[aria-label="Show Add from the lorebook options"]')!.click()
		await settle()
		const options = [...document.querySelectorAll<HTMLElement>('[role="listbox"][data-state="open"] [role="option"]')]
		// The book's items first, then its other lore; never a place.
		expect(options.map((o) => o.textContent?.trim())).toEqual(["Rusty key", "Brass lamp"])
		options[0]!.click()
		await settle()
		stat.querySelector<HTMLButtonElement>("[data-place-stat-pick-add]")!.click()
		await settle()
		expect(server.writes).toEqual([
			{
				lorebookId: BOOK,
				owner: { kind: "location", id: CRYPT },
				branchId: null,
				moment: { year: 7, month: null, day: null },
				slotId: INVENTORY,
				value: [{ entryId: KEY }],
				// Made from nothing: the book held no inventory here.
				readValue: null
			}
		])
		// Drawn from the server's reply, by the pool's name.
		expect(itemTexts(host)).toEqual(["Rusty key"])
	})

	test("steps a held item up and down; one fewer than one takes it out", async () => {
		const server = fakeApi({ [INVENTORY]: [{ entryId: KEY, name: "Rusty key" }, "lantern"] })
		const host = render(server.api)
		await settle()
		const stat = statOf(host, INVENTORY)
		stat.querySelector<HTMLButtonElement>('button[aria-label="One more Rusty key"]')!.click()
		await settle()
		expect(server.writes.at(-1)!.value).toEqual([{ entryId: KEY, count: 2 }, "lantern"])
		expect(itemTexts(host)).toEqual(["Rusty key ×2", "lantern"])
		// Names the list it was made from; the server dates it, not the section.
		expect(server.writes.at(-1)!.readValue).toEqual([{ entryId: KEY, name: "Rusty key" }, "lantern"])
		expect(server.writes.at(-1)).not.toHaveProperty("historyEntryId")

		statOf(host, INVENTORY).querySelector<HTMLButtonElement>('button[aria-label="One fewer Rusty key"]')!.click()
		await settle()
		statOf(host, INVENTORY).querySelector<HTMLButtonElement>('button[aria-label="One fewer Rusty key"]')!.click()
		await settle()
		expect(server.writes.at(-1)!.value).toEqual(["lantern"])
		expect(itemTexts(host)).toEqual(["lantern"])
	})

	test("a typed item is added on Enter, and a word is removed by its button", async () => {
		const server = fakeApi({ [INVENTORY]: ["lantern"] })
		const host = render(server.api)
		await settle()
		const input = statOf(host, INVENTORY).querySelector<HTMLInputElement>("[data-place-stat-add-words]")!
		type(input, "a coil of rope")
		press(input, "Enter")
		await settle()
		expect(server.writes.at(-1)!.value).toEqual(["lantern", "a coil of rope"])
		expect(itemTexts(host)).toEqual(["lantern", "a coil of rope"])

		statOf(host, INVENTORY).querySelector<HTMLButtonElement>('button[aria-label="Remove lantern"]')!.click()
		await settle()
		expect(server.writes.at(-1)!.value).toEqual(["a coil of rope"])
	})

	test("a number commits on Enter; Escape puts the book's value back", async () => {
		const server = fakeApi({ [LAMPS]: 2 })
		const host = render(server.api)
		await settle()
		const input = statOf(host, LAMPS).querySelector<HTMLInputElement>("input")!
		expect(input.value).toBe("2")
		type(input, "5")
		press(input, "Escape")
		await settle()
		expect(server.writes).toEqual([])
		expect(input.value).toBe("2")
		type(input, "4")
		press(input, "Enter")
		await settle()
		expect(server.writes.at(-1)).toMatchObject({ slotId: LAMPS, value: 4 })
	})

	test("a refusal is said in the stat it came from, and nothing changes", async () => {
		const server = fakeApi({ [INVENTORY]: ["lantern"] })
		const host = render(server.api)
		await settle()
		server.refuse("That is not your lorebook.")
		const input = statOf(host, INVENTORY).querySelector<HTMLInputElement>("[data-place-stat-add-words]")!
		type(input, "gold")
		press(input, "Enter")
		await settle()
		expect(statOf(host, INVENTORY).querySelector('[role="alert"]')?.textContent).toContain("not your lorebook")
		expect(statOf(host, LAMPS).querySelector('[role="alert"]')).toBeNull()
		expect(itemTexts(host)).toEqual(["lantern"])
	})

	test("a refused write reads again, so the stale list is replaced by what the book holds now", async () => {
		const server = fakeApi({ [INVENTORY]: ["lantern"] })
		const host = render(server.api)
		await settle()
		// Another tab (or a session's scene) changes the book behind this one…
		server.values[INVENTORY] = ["lantern", "a brass lamp"]
		server.refuse("Inventory changed since this was read, so nothing was saved.")
		const input = statOf(host, INVENTORY).querySelector<HTMLInputElement>("[data-place-stat-add-words]")!
		type(input, "gold")
		press(input, "Enter")
		await settle()
		await settle()
		expect(statOf(host, INVENTORY).querySelector('[role="alert"]')?.textContent).toContain("changed since this was read")
		// …and the section now draws the book's list, with the typing kept to redo.
		expect(itemTexts(host)).toEqual(["lantern", "a brass lamp"])
		expect(input.value).toBe("gold")
		expect(server.reads).toHaveLength(2)
	})

	test("a dated value says the date it holds from", async () => {
		const server = fakeApi({ [INVENTORY]: ["a brass lamp"] }, [inventory, lamps], {
			heldSince: { [INVENTORY]: { year: 7, month: null, day: null } }
		})
		const host = render(server.api)
		await settle()
		expect(statOf(host, INVENTORY).querySelector("[data-place-stat-since]")?.textContent?.trim()).toBe(
			"since Year 7"
		)
		expect(statOf(host, LAMPS).querySelector("[data-place-stat-since]")).toBeNull()
		expect(host.querySelector("[data-place-stats-dating]")?.textContent).toContain(
			"keeps the date of the value it changes"
		)
	})

	test("a yes/no stat, once set, can go back to not set", async () => {
		const server = fakeApi({ [LIT]: true }, [inventory, lit])
		const host = render(server.api)
		await settle()
		statOf(host, LIT).querySelector<HTMLButtonElement>("[data-place-stat-clear]")!.click()
		await settle()
		expect(server.writes.at(-1)).toMatchObject({ slotId: LIT, value: null, readValue: true })
		expect(statOf(host, LIT).textContent).toContain("Not set")
		expect(statOf(host, LIT).querySelector("[data-place-stat-clear]")).toBeNull()
	})

	test("a retired stat is shown, greyed, with nothing to edit", async () => {
		const retired = { ...lamps, retired: true as const }
		const server = fakeApi({ [LAMPS]: 3 }, [inventory, retired])
		const host = render(server.api)
		await settle()
		const stat = statOf(host, LAMPS)
		expect(stat.dataset.retired).toBe("")
		expect(stat.querySelector("input")).toBeNull()
		expect(stat.textContent).toContain("3")
	})
})
