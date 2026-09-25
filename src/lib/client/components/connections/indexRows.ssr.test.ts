/**
 * The index's new rows, rendered.
 *
 * `render` from `svelte/server`, like `CharacterCreatorModal.ssr.test.ts`: the
 * repo has no browser test environment, and what these four components do IS
 * the markup — a dot, a sentence and at most one button, assembled from what
 * the pure modules next door decided. This pins that the assembly happens at
 * all, and the two U4 placeholders still standing with it, so a lane replacing
 * one of them has something that fails when the props contract moves.
 *
 * ⚠ Not a design assertion. It checks sentences and the one class that
 * carries meaning (the teal managed chip), never layout utilities.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))

import ReadinessCard from "./ReadinessCard.svelte"
import ConnectionRow from "./ConnectionRow.svelte"
import DownloadsTray from "./DownloadsTray.svelte"
import AddMenu from "./AddMenu.svelte"
import ModelFinderView from "./ModelFinderView.svelte"
import DownloadsView from "./DownloadsView.svelte"
import { defaultsSummary } from "./defaultsSummary"
import { readinessRows } from "./readiness"

describe("the index's rows render", () => {
	test("readiness card", () => {
		const rows = readinessRows(defaultsSummary([], {}).entries)
		const html = render(ReadinessCard, {
			props: {
				rows,
				sectionOrder: [
					"text->text",
					"text->image",
					"text->embedding",
					"text->entities"
				],
				onOpen: () => {},
				onFix: () => {}
			}
		}).body
		expect(html).toContain("What this pub can do")
		expect(html).toContain("0 of 10 ready")
		expect(html).toContain("Not set · sessions can't reply")
		expect(html).toContain("6 more")
	})
	test("connection row fills its four slots", () => {
		const html = render(ConnectionRow, {
			props: {
				title: "OpenRouter",
				serviceLabel: "OpenRouter",
				kind: "api",
				managed: false,
				status: {
					state: "ready",
					label: "Ready",
					detail: "openrouter.ai",
					metric: "4 models",
					action: null
				},
				onOpen: () => {},
				onAction: () => {}
			}
		}).body
		expect(html).toContain("OpenRouter")
		expect(html).toContain("Ready")
		expect(html).toContain("openrouter.ai")
		expect(html).toContain("4 models")
	})
	test("a default-named connection does not repeat itself in a chip", () => {
		// The shipped index read "Anthropic (Claude)" beside a chip saying
		// "Anthropic (Claude)". Amended 2026-09-23.
		const html = render(ConnectionRow, {
			props: {
				title: "Ollama",
				serviceLabel: "Ollama",
				kind: "ollama",
				managed: true,
				status: {
					state: "ready",
					label: "Running",
					detail: "localhost:11434",
					metric: "4 models",
					action: null
				},
				onOpen: () => {},
				onAction: () => {}
			}
		}).body
		expect(html).not.toContain("preset-tonal-tertiary")
	})
	test("a renamed connection still says what it is", () => {
		const html = render(ConnectionRow, {
			props: {
				title: "Downstairs box",
				serviceLabel: "Ollama",
				kind: "ollama",
				managed: true,
				status: {
					state: "ready",
					label: "Running",
					detail: "localhost:11434",
					metric: "4 models",
					action: null
				},
				onOpen: () => {},
				onAction: () => {}
			}
		}).body
		expect(html).toContain("preset-tonal-tertiary")
		expect(html).toContain("Ollama")
	})
	test("connection row with an action, and the chat mark", () => {
		const html = render(ConnectionRow, {
			props: {
				title: "KoboldCPP",
				serviceLabel: "KoboldCPP",
				kind: "koboldcpp-managed",
				managed: true,
				defaultFor: ["Chat"],
				status: {
					state: "idle",
					label: "Stopped",
					detail: "Starts on first use",
					metric: "2 on disk",
					action: {
						verb: "start",
						label: "Start",
						icon: "Play",
						emphasis: "tonal"
					}
				},
				onOpen: () => {},
				onAction: () => {}
			}
		}).body
		expect(html).toContain("Start")
		expect(html).toContain("Chat")
		expect(html).toContain("2 on disk")
	})
	test("tray", () => {
		const html = render(DownloadsTray, {
			props: { count: 2, percent: 41, onView: () => {} }
		}).body
		expect(html).toContain("2 downloads")
		expect(html).toContain("width: 41%")
	})
	test("add menu", () => {
		const html = render(AddMenu, {
			props: {
				onAddConnection: () => {},
				onAddKoboldCpp: () => {},
				onAddOllama: () => {},
				onGetModel: () => {},
				onAddByName: () => {}
			}
		}).body
		expect(html).toContain("Add")
	})
	// The capability view is no longer among them — U2 replaced it, and it has
	// its own render test (`capabilityView.ssr.test.ts`).
	test("placeholders", () => {
		expect(
			render(ModelFinderView, { props: { onBack: () => {} } }).body
		).toContain("Get a model")
		expect(
			render(DownloadsView, { props: { onBack: () => {} } }).body
		).toContain("Downloads")
	})
})
