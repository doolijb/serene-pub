/**
 * The six components the 2026-09-23 rebuild added, rendered.
 *
 * Their logic is pure and tested elsewhere (`connectionRowStatus`,
 * `connectionGroups`, `jobTile`, `modelDisplay`, `modelFacts`); what these
 * assert is the part a pure test cannot reach — that the component mounts at
 * all, and that the few decisions made IN the markup hold. Every one of them
 * is a decision that was got wrong at least once during the build.
 */
import { describe, expect, test } from "vitest"
import { render } from "svelte/server"
import StatusStrip from "./StatusStrip.svelte"
import JobsGrid from "./JobsGrid.svelte"
import ConnectionCard from "./ConnectionCard.svelte"
import ModelRow from "./ModelRow.svelte"
import ModelTable from "./ModelTable.svelte"

const noop = () => {}

describe("StatusStrip", () => {
	test("names the pair when a session can reply", () => {
		const html = render(StatusStrip, {
			props: {
				modelName: "Claude Sonnet 4.5",
				connectionName: "Anthropic",
				onChange: noop,
				onSetUp: noop
			}
		}).body
		expect(html).toContain("Sessions can reply")
		expect(html).toContain("Claude Sonnet 4.5")
		expect(html).toContain("Change")
	})

	test("unset offers Set up chat, and it is the one gold button", () => {
		const html = render(StatusStrip, {
			props: { onChange: noop, onSetUp: noop }
		}).body
		expect(html).toContain("Sessions can't reply yet")
		expect(html).toContain("Set up chat")
		expect(html).toContain("preset-filled-primary-500")
	})

	test("set-but-broken says Fix, not Set up", () => {
		const html = render(StatusStrip, {
			props: {
				modelName: "Nemo 12B",
				problem: "Not downloaded",
				onChange: noop,
				onSetUp: noop
			}
		}).body
		expect(html).toContain("Fix")
		expect(html).toContain("Not downloaded")
	})
})

describe("JobsGrid", () => {
	const tiles = Array.from({ length: 9 }, (_, i) => ({
		capability: `cap-${i}`,
		label: `Job ${i}`,
		tagline: `Does thing ${i}`
	}))

	test("folds past the limit rather than pushing the list off screen", () => {
		// Nine tiles two-across is five rows, which put the CONNECTIONS below
		// the fold in the dock.
		const html = render(JobsGrid, { props: { tiles, onOpen: noop } }).body
		expect(html).toContain("Job 0")
		expect(html).toContain("5 more")
		expect(html).not.toContain("Job 8")
	})

	test("pulls a SET tile forward, so the count matches what is shown", () => {
		const withSet = tiles.map((t, i) =>
			i === 7 ? { ...t, modelName: "Claude Sonnet 4.5" } : t
		)
		const html = render(JobsGrid, {
			props: { tiles: withSet, onOpen: noop }
		}).body
		expect(html).toContain("Job 7")
		expect(html).toContain("1 set up")
		// …and the fold names only what it hides, never the tile pulled out
		// of it (it listed `slice(limit)`, so "job 7" twice).
		expect(html.match(/job 7/gi)?.length).toBe(1)
		expect(html).toContain("job 3")
	})

	test("never scores the set out of ten", () => {
		const html = render(JobsGrid, { props: { tiles, onOpen: noop } }).body
		expect(html).not.toMatch(/of\s+(9|10)\s+ready/i)
		expect(html).toContain("all optional")
	})

	test("columns is a prop, never a container query", () => {
		// `@min-[900px]/view` measures the whole view, so it fired inside the
		// 340px list column at full page and squashed four tiles into it.
		const two = render(JobsGrid, { props: { tiles, onOpen: noop } }).body
		const four = render(JobsGrid, {
			props: { tiles, onOpen: noop, columns: 4, limit: Infinity }
		}).body
		expect(two).toContain("grid-cols-2")
		expect(four).toContain("grid-cols-4")
		expect(four).not.toContain("@min-[900px]/view:grid-cols-4")
	})

	test('"fit" asks the LIST pane, never the whole view (notes 42)', () => {
		// The index carries the grid at every width now; the box it sits in
		// is the list pane (`@container/list`), so that is what it asks.
		const fit = render(JobsGrid, {
			props: { tiles, onOpen: noop, columns: "fit", limit: 3 }
		}).body
		expect(fit).toContain("@min-[36rem]/list:grid-cols-4")
		expect(fit).not.toContain("/view:")
		// Three modality tiles, then the fold.
		expect(fit).toContain("6 more")
	})
})

describe("ModelRow", () => {
	const model = {
		id: 1,
		model: "hf.co/bartowski/MN-12B-Lyra-v4-GGUF:Q4_K_M",
		name: "hf.co/bartowski/MN-12B-Lyra-v4-GGUF:Q4_K_M",
		facts: {
			parameters: "12.2B",
			quantization: "Q4_K_M",
			sizeBytes: 7_500_000_000,
			source: "host" as const
		}
	}

	test("reads the identifier as a name and the numbers as one line", () => {
		const html = render(ModelRow, { props: { model } }).body
		expect(html).toContain("MN Lyra v4")
		expect(html).toContain("12.2B · Q4_K_M · 7.5 GB")
	})

	test("keeps the whole identifier reachable", () => {
		const html = render(ModelRow, { props: { model } }).body
		expect(html).toContain("hf.co/bartowski/MN-12B-Lyra-v4-GGUF:Q4_K_M")
	})

	test("the admin's context override beats the host's claim", () => {
		const html = render(ModelRow, {
			props: {
				model: {
					...model,
					contextWindow: 8192,
					facts: { ...model.facts, contextWindow: 200000 }
				}
			}
		}).body
		expect(html).toContain("8k context")
		expect(html).not.toContain("200k context")
	})

	test("the default wears a mark; the others get a quiet Use", () => {
		const marked = render(ModelRow, {
			props: { model, defaultFor: ["Chat"] }
		}).body
		expect(marked).toContain("Chat")
		const offered = render(ModelRow, {
			props: {
				model,
				canUse: true,
				useLabel: "Use for chat",
				onUse: noop
			}
		}).body
		expect(offered).toContain("Use")
		// `preset-filled-*` is a button, not a badge (§2.4). The old cards put
		// a filled green one on every row.
		expect(offered).not.toContain("preset-filled-success")
		expect(offered).not.toContain("preset-filled-error")
	})

	test("a Use that can't be pressed stays, disabled, and says why", () => {
		const reason =
			"Not available on this machine: the ONNX runtime didn't load"
		const html = render(ModelRow, {
			props: {
				model,
				canUse: true,
				useLabel: "Make active",
				useDisabledReason: reason,
				onUse: noop
			}
		}).body
		const use = html.match(
			/<button\b[^>]*aria-label="Make active[^"]*"[^>]*>/
		)
		expect(use?.[0]).toMatch(/\sdisabled(?=[\s=>]|$)/)
		expect(use?.[0]).toContain(`aria-label="Make active — ${reason}"`)
		expect(use?.[0]).toContain(`title="${reason}"`)
		const enabled = render(ModelRow, {
			props: { model, canUse: true, useLabel: "Make active", onUse: noop }
		}).body
		expect(
			enabled.match(/<button\b[^>]*aria-label="Make active"[^>]*>/)?.[0]
		).not.toMatch(/\sdisabled(?=[\s=>]|$)/)
	})

	test("delete is in the menu, never a red button on the row", () => {
		const html = render(ModelRow, {
			props: {
				model,
				actions: [
					{
						id: "delete",
						label: "Delete from disk",
						destructive: true
					}
				],
				onAction: noop
			}
		}).body
		expect(html).not.toContain("preset-filled-error-500")
	})
})

describe("ModelTable", () => {
	const models = [
		{
			id: 1,
			connectionId: 1,
			model: "claude-sonnet-4-5",
			name: "Claude Sonnet 4.5",
			enabled: true,
			missingSince: null,
			contextWindow: null,
			promptFormat: null,
			tokenCounter: null,
			sortOrder: 0,
			facts: {
				contextWindow: 200000,
				pricing: { inPerMTok: 3, outPerMTok: 15, currency: "USD" },
				inputModalities: ["text", "image"],
				source: "list" as const
			}
		},
		{
			id: 2,
			connectionId: 1,
			model: "mystery",
			name: "Mystery",
			enabled: true,
			missingSince: null,
			contextWindow: null,
			promptFormat: null,
			tokenCounter: null,
			sortOrder: 1
		}
	] as any

	const props = {
		models,
		defaultsByModel: { 1: ["Chat"] },
		onOpen: noop,
		onUse: noop,
		onToggleEnabled: noop
	}

	test("puts the facts an expert compares on in columns", () => {
		const html = render(ModelTable, { props }).body
		expect(html).toContain("Context")
		expect(html).toContain("In / 1M")
		expect(html).toContain("200k")
		expect(html).toContain("$3.00")
		expect(html).toContain("$15.00")
		expect(html).toContain("Vision")
	})

	test("a cell the host said nothing about is a dash, never a zero", () => {
		const html = render(ModelTable, { props }).body
		expect(html).toContain("—")
		expect(html).not.toContain("$0.00")
	})

	test("a free model reads Free, which is a different answer from unknown", () => {
		const free = [
			{
				...models[0],
				id: 3,
				facts: {
					pricing: { inPerMTok: 0, currency: "USD" },
					source: "host" as const
				}
			}
		]
		const html = render(ModelTable, {
			props: { ...props, models: free as any, defaultsByModel: {} }
		}).body
		expect(html).toContain("Free")
	})

	test("a local connection swaps price for quant and size", () => {
		const html = render(ModelTable, {
			props: { ...props, local: true }
		}).body
		expect(html).toContain("Quant")
		expect(html).toContain("Size")
		expect(html).not.toContain("In / 1M")
	})

	test("hiding is offered as hiding, and nothing says delete", () => {
		const html = render(ModelTable, { props }).body
		expect(html).toContain("Hide from pickers")
		expect(html).not.toMatch(/\bDelete\b/)
	})
})


describe("ConnectionCard", () => {
	const status = {
		state: "unfinished" as const,
		label: "Needs a key",
		detail: "openrouter.ai",
		metric: null,
		action: { verb: "setup" as const, label: "Set up", icon: "ArrowRight", emphasis: "tonal" as const }
	}

	test("says what it is, its state and its model count at once", () => {
		// A row lets its action take the metric's column; a card has a
		// footer for the action, so the count always shows (notes 42).
		const html = render(ConnectionCard, {
			props: {
				title: "Work",
				serviceLabel: "OpenRouter",
				kind: "api",
				managed: false,
				status,
				modelCount: 3,
				onOpen: noop,
				onAction: noop
			}
		}).body
		expect(html).toContain("Work")
		expect(html).toContain("OpenRouter")
		expect(html).toContain("Needs a key")
		expect(html).toContain("3 models")
		expect(html).toContain("openrouter.ai")
		expect(html).toContain("Set up")
	})

	test("a default-named connection does not repeat itself in a chip", () => {
		const html = render(ConnectionCard, {
			props: {
				title: "Ollama",
				serviceLabel: "Ollama",
				kind: "ollama",
				managed: true,
				status: { ...status, state: "ready" as const, label: "Ready", action: null },
				modelCount: 1,
				onOpen: noop,
				onAction: noop
			}
		}).body
		expect(html.match(/Ollama/g)?.length).toBe(1)
		expect(html).toContain("1 model")
		expect(html).not.toContain("1 models")
	})

	test("the metric rides the detail line only when it is not the count", () => {
		const html = render(ConnectionCard, {
			props: {
				title: "KoboldCPP",
				serviceLabel: "KoboldCPP",
				kind: "koboldcpp-managed",
				managed: true,
				status: { ...status, state: "idle" as const, label: "Stopped", metric: "2 models", action: null },
				modelCount: 2,
				onOpen: noop,
				onAction: noop
			}
		}).body
		expect(html.match(/2 models/g)?.length).toBe(1)
	})
})
