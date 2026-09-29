import { describe, expect, test } from "vitest"
import { readinessRow, readinessRows } from "./readiness"
import { defaultsSummary } from "./defaultsSummary"
import type { DefaultsSummaryEntry } from "./defaultsSummary"

const entry = (
	over: Partial<DefaultsSummaryEntry> = {}
): DefaultsSummaryEntry => ({
	capability: "text->text",
	label: "Chat",
	outputKind: "text",
	connection: { id: 1, name: "OpenRouter", models: [] },
	model: {
		id: 11,
		name: "gpt-4o",
		enabled: true,
		missingSince: null
	},
	set: true,
	state: "ok",
	stateWord: "ready",
	...over
})

describe("readinessRow — the four states", () => {
	test("ok names the model, the connection and where it is", () => {
		const row = readinessRow(entry())
		expect(row.state).toBe("ok")
		// "ready" is the machine shrugging; a host LISTS a model.
		expect(row.sentence).toBe("gpt-4o · OpenRouter · listed")
		expect(row.action).toBeNull()
	})

	test("unset chat is the only gold button", () => {
		const row = readinessRow(
			entry({ set: false, state: "unset", stateWord: "not set" })
		)
		expect(row.sentence).toBe("Not set · sessions can't reply")
		expect(row.action).toEqual({
			verb: "setup",
			label: "Set up",
			emphasis: "primary"
		})
	})

	test("an unset non-chat capability's Set up is tonal, not gold", () => {
		const row = readinessRow(
			entry({
				capability: "text->image",
				label: "Images",
				set: false,
				state: "unset",
				stateWord: "not set"
			})
		)
		expect(row.action).toEqual({
			verb: "setup",
			label: "Set up",
			emphasis: "tonal"
		})
	})

	test("an unset transform with no hand-written consequence falls back to the SDK tagline", () => {
		const row = readinessRow(
			entry({
				capability: "text+image->text",
				label: "Vision",
				set: false,
				state: "unset",
				stateWord: "not set"
			})
		)
		expect(row.sentence).toBe("Not set · Can look at pictures you send it")
	})

	test("pending counts bytes and offers no button", () => {
		const row = readinessRow(
			entry({ state: "pending", stateWord: "downloading" }),
			{
				localState: "downloading",
				downloadedBytes: 400_000_000,
				totalBytes: 1_200_000_000
			}
		)
		expect(row.state).toBe("pending")
		expect(row.sentence).toBe("Downloading gpt-4o · 400 of 1200 MB")
		expect(row.action).toBeNull()
	})

	test("a warning repeats the summary's word and picks one fix", () => {
		const row = readinessRow(
			entry({ state: "warning", stateWord: "not listed" }),
			{ syncError: "401 Unauthorized" }
		)
		expect(row.sentence).toBe("gpt-4o · OpenRouter · not listed")
		expect(row.action?.verb).toBe("refresh")
	})
})

describe("readinessRow — the fix is the most direct undo", () => {
	test("files that never arrived get Download", () => {
		const row = readinessRow(
			entry({ state: "warning", stateWord: "not downloaded" }),
			{ localState: "not_downloaded" }
		)
		expect(row.action).toEqual({
			verb: "download",
			label: "Download",
			emphasis: "tonal"
		})
	})

	test("a crashed managed process is a warning of its own, with Start", () => {
		const row = readinessRow(entry(), { kcppRun: "crashed" })
		expect(row.state).toBe("warning")
		expect(row.sentence).toBe(
			"OpenRouter stopped unexpectedly · gpt-4o can't run"
		)
		expect(row.action?.verb).toBe("start")
	})

	test("a manager switched off outranks the row reading as healthy", () => {
		const row = readinessRow(entry(), {
			managerEnabled: false,
			managerLabel: "KoboldCPP"
		})
		expect(row.state).toBe("warning")
		expect(row.sentence).toBe(
			"KoboldCPP is switched off · gpt-4o can't run"
		)
		expect(row.action?.verb).toBe("change")
	})

	test("anything else is Change", () => {
		const row = readinessRow(
			entry({ state: "warning", stateWord: "switched off" })
		)
		expect(row.action?.verb).toBe("change")
	})

	test("an unanswered fact never invents a fault", () => {
		expect(readinessRow(entry(), {}).state).toBe("ok")
		expect(readinessRow(entry(), { kcppRun: null }).state).toBe("ok")
		expect(readinessRow(entry(), { managerEnabled: true }).state).toBe("ok")
	})
})

describe("the rows as a whole", () => {
	const summary = defaultsSummary([], {})
	const rows = readinessRows(summary.entries)

	test("every SDK transform gets a row, and none is ready on a bare install", () => {
		expect(rows).toHaveLength(10)
		expect(rows.every((r) => r.state === "unset")).toBe(true)
	})
})
