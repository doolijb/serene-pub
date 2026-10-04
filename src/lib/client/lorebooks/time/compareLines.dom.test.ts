/**
 * Compare draws a row the line has not reached at the moment the way the
 * pool does: listed, dimmed, and marked later (`LineDifference.later`).
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

import CompareLines from "./CompareLines.svelte"

let app: ReturnType<typeof mount> | null = null

afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const only = (id: number, name: string, later: boolean) => ({
	id,
	key: `entry#${id}`,
	kind: "only" as const,
	fields: [],
	main: null,
	line: { id, name },
	later
})

describe("CompareLines at a moment", () => {
	test("a row dated after the moment is listed dimmed and marked later; one already reached is not", () => {
		const target = document.createElement("div")
		document.body.append(target)
		app = mount(CompareLines, {
			target,
			props: {
				lineName: "Exile",
				differences: [only(1, "The flight", false), only(2, "The return", true)],
				titleOf: (row: any) => row.name,
				labelOf: (field: string) => field,
				valueOf: () => null,
				onClose: () => {}
			}
		})
		flushSync()
		const rows = [...document.querySelectorAll("[data-lore-compare] li")]
		const row = (name: string) => rows.find((li) => li.textContent?.includes(name))!
		expect(row("The return").querySelector("button")!.className).toContain("opacity-50")
		expect(row("The return").textContent).toContain("later")
		expect(row("The flight").querySelector("button")!.className).not.toContain("opacity-50")
		expect(row("The flight").textContent).not.toContain("later")
	})
})
