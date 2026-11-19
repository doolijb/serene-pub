/**
 * 🚧 The Known by list: one three-way switch per cast member, the words under
 * it, a refusal in place. ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import axe from "axe-core"
import KnownByList from "./KnownByList.svelte"

type Row = Sockets.EntryKnowledge.Row

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

function row(over: Partial<Row> = {}): Row {
	return {
		castMemberId: 1,
		name: "Mara",
		entryId: 9,
		known: true,
		winner: null,
		hand: null,
		overruled: null,
		placeEntry: false,
		...over
	}
}
const knows = (over = {}) => ({
	tieId: 1,
	kind: "knows" as const,
	relationshipType: "knows",
	hand: true,
	date: null,
	...over
})

async function view(
	rows: Row[],
	over: {
		marked?: boolean
		loaded?: boolean
		error?: string | null
		onSet?: (id: number, hand: any) => Promise<unknown>
	} = {}
) {
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(KnownByList, {
		target,
		props: {
			marked: over.marked ?? true,
			rows,
			loaded: over.loaded ?? true,
			error: over.error ?? null,
			formatDate: (m: any) => `Year ${m.year}`,
			onSet: over.onSet ?? (async () => {})
		}
	})
	flushSync()
	await tick()
	return target
}

const norm = (s: string | null | undefined) =>
	s?.replace(/\s+/g, " ").trim() ?? ""
const option = (name: string, hand: string) =>
	document.body.querySelector<HTMLButtonElement>(
		`[data-known-by-row="${name}"] [data-known-by-option="${hand}"]`
	)!
const pressedOf = (id: number) =>
	[
		...document.body.querySelectorAll(
			`[data-known-by-row="${id}"] [data-known-by-option]`
		)
	]
		.filter((b) => b.getAttribute("aria-pressed") === "true")
		.map((b) => b.getAttribute("data-known-by-option"))

describe("the switch", () => {
	test("the pressed button follows the row's hand", async () => {
		await view([
			row({ castMemberId: 1 }),
			row({
				castMemberId: 2,
				name: "Joss",
				hand: "knows",
				winner: knows()
			}),
			row({
				castMemberId: 3,
				name: "Ren",
				known: false,
				hand: "kept_from",
				winner: knows({ kind: "kept_from" })
			})
		])
		expect(pressedOf(1)).toEqual(["default"])
		expect(pressedOf(2)).toEqual(["knows"])
		expect(pressedOf(3)).toEqual(["kept_from"])
	})

	test("pressing Kept from and Default calls onSet", async () => {
		const onSet = vi.fn(async () => {})
		await view([row()], { onSet })
		option("1", "kept_from").click()
		await tick()
		expect(onSet).toHaveBeenLastCalledWith(1, "kept_from")
		option("1", "knows").click()
		await tick()
		expect(onSet).toHaveBeenLastCalledWith(1, "knows")
		option("1", "default").click()
		await tick()
		expect(onSet).toHaveBeenLastCalledWith(1, null)
	})

	test("a row's buttons are disabled while its request is out", async () => {
		let release!: () => void
		const onSet = vi.fn(() => new Promise<void>((r) => (release = r)))
		await view([row()], { onSet })
		option("1", "knows").click()
		flushSync()
		expect(option("1", "default").disabled).toBe(true)
		release()
		await tick()
		await tick()
		expect(option("1", "default").disabled).toBe(false)
	})
})

describe("the words", () => {
	test("Default reads both ways", async () => {
		await view([row()], { marked: true })
		expect(norm(document.body.textContent)).toContain(
			"Only the cast members who know this entry read it when they speak."
		)
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		await view([row()], { marked: false })
		expect(norm(document.body.textContent)).toContain(
			"This entry is common knowledge: every cast member reads it unless it is kept from them."
		)
		expect(norm(document.body.textContent)).toContain(
			"Knows it: common knowledge"
		)
	})

	test("a play row shows its reason and still offers the switch", async () => {
		await view([row({ winner: knows({ kind: "was_told", hand: false }) })])
		expect(norm(document.body.textContent)).toContain("Knows it: was told")
		expect(
			document.body.querySelectorAll("[data-known-by-option]")
		).toHaveLength(3)
	})

	test("a hand tie says what it stands over", async () => {
		await view([
			row({
				hand: "kept_from",
				known: false,
				winner: knows({ kind: "kept_from" }),
				overruled: knows({ kind: "was_told", hand: false })
			})
		])
		expect(norm(document.body.textContent)).toContain(
			"Kept from stands over “was told”; set it back to Default and that tie wins again."
		)
	})

	test("not loaded, empty and an error", async () => {
		await view([], { loaded: false })
		expect(norm(document.body.textContent)).toContain(
			"Reading who knows this entry…"
		)
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		await view([], { loaded: true })
		expect(norm(document.body.textContent)).toContain(
			"This lorebook has no cast members yet."
		)
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		await view([], { error: "Nope." })
		expect(
			norm(document.body.querySelector('[role="alert"]')?.textContent)
		).toBe("Nope.")
	})
})

describe("a refusal", () => {
	test("shows under its row and clears on the next press", async () => {
		let fail = true
		const onSet = vi.fn(async () => {
			if (fail) throw new Error("Only the owner may say who knows.")
		})
		await view([row(), row({ castMemberId: 2, name: "Joss" })], { onSet })
		option("1", "knows").click()
		await tick()
		await tick()
		const alerts = document.body.querySelectorAll('[role="alert"]')
		expect(alerts).toHaveLength(1)
		expect(norm(alerts[0].textContent)).toBe(
			"Only the owner may say who knows."
		)
		expect(
			document.body.querySelector(
				'[data-known-by-row="1"] [role="alert"]'
			)?.textContent
		).toBeTruthy()
		fail = false
		option("1", "default").click()
		await tick()
		await tick()
		expect(document.body.querySelectorAll('[role="alert"]')).toHaveLength(0)
	})
})

describe("axe", () => {
	test("finds no violations", async () => {
		const target = await view([
			row(),
			row({
				castMemberId: 2,
				name: "Joss",
				hand: "knows",
				winner: knows()
			}),
			row({
				castMemberId: 3,
				name: "Ren",
				winner: knows({ kind: "was_told", hand: false })
			})
		])
		const result = await axe.run(target, {
			rules: { "color-contrast": { enabled: false } }
		})
		expect(result.violations.map((v) => v.id)).toEqual([])
	})
})
