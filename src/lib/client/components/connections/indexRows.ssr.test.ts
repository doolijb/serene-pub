/**
 * The index's new rows, rendered.
 *
 * `render` from `svelte/server`, like `CharacterCreatorModal.ssr.test.ts`: the
 * repo has no browser test environment, and what these three components do IS
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

import ConnectionRow from "./ConnectionRow.svelte"
import DownloadsTray from "./DownloadsTray.svelte"
import AddMenu from "./AddMenu.svelte"
import ModelFinderView from "./ModelFinderView.svelte"
import DownloadsView from "./DownloadsView.svelte"
import ConnectionIndexView from "./ConnectionIndexView.svelte"
import { connectionsTestContext } from "$lib/client/contexts/testProvideConnections"

describe("the index's rows render", () => {
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
			props: { count: 2, percent: 41 }
		}).body
		expect(html).toContain("2 downloads")
		expect(html).toContain("width: 41%")
		// Closed, the list is not drawn; View expands it in place.
		expect(html).toContain("View")
		expect(html).not.toContain("Clear finished")
		const open = render(DownloadsTray, {
			props: { count: 2, percent: 41, open: true }
		}).body
		expect(open).toContain("Hide")
		expect(open).toContain("Clear finished")
		expect(open).toContain("Nothing is downloading.")
	})
	test("add menu", () => {
		const html = render(AddMenu, {
			props: {
				onAddConnection: () => {},
				onAddKoboldCpp: () => {},
				onAddOllama: () => {}
			}
		}).body
		expect(html).toContain("Add")
		// Connections only since the split (plan 2026-10-11): models are
		// got in the Models view.
		expect(html).toContain('title="Add a connection"')
	})
	// The job picker has its own render test (`jobPickerDialog.ssr.test.ts`).
	test("placeholders", () => {
		expect(
			render(ModelFinderView, {
				props: { onBack: () => {} },
				context: new Map([connectionsTestContext()])
			}).body
		).toContain("Get a model")
		expect(
			render(DownloadsView, {
				props: { onBack: () => {} },
				context: new Map([connectionsTestContext()])
			}).body
		).toContain("Downloads")
	})
})

/**
 * Plan §A, the walk of 2026-10-06: an OpenRouter that listed 503 models read
 * green **Ready** while chat was unset. The whole index, rendered: the row
 * says Pick a model. The status strip that sat above it (and its Choose a
 * model) moved to the Models view on 2026-10-11 and is not drawn here.
 */
describe("a Ready OpenRouter while chat is unset", () => {
	const noop = () => {}
	const openRouter = {
		id: 4,
		name: "OpenRouter",
		type: "openai",
		preset: "openrouter",
		baseUrl: "https://openrouter.ai/api/v1",
		hasCredential: true,
		modality: "text",
		models: Array.from({ length: 503 }, (_, i) => ({
			id: 100 + i,
			name: `Model ${i}`,
			model: `vendor/model-${i}`,
			enabled: true,
			missingSince: null,
			satisfiableCapabilities: ["text->text"]
		})),
		modelsSync: { at: "2026-10-06T10:00:00Z", error: null }
	}

	function renderIndex(
		capabilityDefaults: Record<string, unknown> = {}
	): string {
		return render(ConnectionIndexView, {
			props: {
				connectionsList: [openRouter] as any,
				capabilityDefaults: capabilityDefaults as any,
				isLoading: false,
				syncingIds: new Set<number>(),
				syncingAll: false,
				onAddNew: noop,
				onEnableManager: noop,
				onOpenConnection: noop,
				onRefresh: noop
			},
			context: new Map<string, unknown>([
				["systemSettingsCtx", { settings: {} }],
				["userCtx", { user: { id: 1, isAdmin: true } }]
			])
		}).body
	}

	test("no readiness on Connections: no strip, no jobs, no Get a model", () => {
		const html = renderIndex()
		expect(html).not.toContain("Sessions can't reply yet")
		expect(html).not.toContain("Choose a model")
		expect(html).not.toContain("Set up chat")
		expect(html).not.toContain("Get a model")
		expect(html).not.toContain("Add a model by name")
		expect(html).not.toContain("Defaults ledger")
	})

	test("row says gold Pick a model with Choose, never green Ready", () => {
		const html = renderIndex()
		expect(html).toContain("Pick a model")
		expect(html).toContain("Choose — OpenRouter")
		expect(html).not.toContain(">Ready<")
	})

	test("once chat is set on it, the row is Ready", () => {
		const html = renderIndex({
			"text->text": { connectionId: 4, connectionModelId: 100 }
		})
		expect(html).not.toContain("Pick a model")
		expect(html).toContain(">Ready<")
	})
})
