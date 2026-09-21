/**
 * The finder and the downloads view, rendered.
 *
 * `render` from `svelte/server`, the same pattern `indexRows.ssr.test.ts`
 * uses: the repo has no browser test environment, and what these two views DO
 * is the markup — the four questions at the top of the finder, and the three
 * sections of the downloads list. The arithmetic behind both has its own tests
 * next door (`finder.test.ts`, `memoryTier.test.ts`); this pins that the
 * assembly happens at all, and that the two props contracts the sidebar calls
 * them through still hold.
 *
 * ⚠ Effects do not run under SSR, so nothing here has a socket, a context or a
 * memory tier read from storage. That is deliberate: what is asserted is what
 * a person sees BEFORE any of those answer — which is the state a slow
 * connection leaves them looking at, and the one nobody tests by hand.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))

import ModelFinderView from "./ModelFinderView.svelte"
import DownloadsView from "./DownloadsView.svelte"
import QuantPicker from "./QuantPicker.svelte"
import { downloads } from "./downloads.svelte"

const finder = (props: Record<string, unknown> = {}) =>
	render(ModelFinderView, { props: { onBack: () => {}, ...props } }).body

describe("the model finder", () => {
	test("asks its four questions in order", () => {
		const html = finder()
		expect(html).toContain("Get a model")
		expect(html).toContain("Search recommended and Hugging Face")
		expect(html).toContain(">For<")
		expect(html).toContain("Download to")
		// The four scopes, always all four — the pills are how a person who
		// arrived from the wrong door corrects it.
		for (const label of ["Chat", "Images", "Embeddings", "Entities"])
			expect(html).toContain(label)
	})

	test("with no connections, it says so rather than listing nothing", () => {
		const html = finder()
		expect(html).toContain("Nothing here can hold a chat model yet.")
		expect(html).toContain("Add KoboldCPP, run by Serene Pub")
	})

	test("a local modality names the door instead of offering a manager", () => {
		const html = finder({ capability: "text->embedding" })
		expect(html).toContain("Nothing here can hold an embeddings model yet.")
		expect(html).not.toContain("Add KoboldCPP, run by Serene Pub")
		expect(html).toContain("Add → A connection")
	})

	test("the memory tier is named and changeable even with no destination", () => {
		const html = finder()
		expect(html).toContain("Not sure tier")
		expect(html).toContain("Change")
	})

	test("an unknown capability falls back to chat rather than nothing", () => {
		expect(finder({ capability: "text->speech" })).toContain(
			"Nothing here can hold a chat model yet."
		)
	})
})

describe("the downloads view", () => {
	afterEach(() => downloads.setOnnx([]))

	test("empty is one sentence, no icon and no button", () => {
		const html = render(DownloadsView, { props: { onBack: () => {} } }).body
		expect(html).toContain("Downloads")
		expect(html).toContain("Nothing is downloading.")
		expect(html).not.toContain("In flight")
	})

	test("an arriving file is a row with its destination and a bar", () => {
		// The ONNX feed is the one a test can seed: it is handed IN rather
		// than subscribed to, so it needs no socket.
		downloads.setOnnx([
			{
				id: 3,
				name: "Embeddings",
				models: [
					{
						id: 9,
						name: "bge-small-en-v1.5",
						local: {
							state: "downloading",
							percent: 40,
							downloadedBytes: 12_000_000,
							totalBytes: 33_000_000
						}
					}
				]
			}
		])
		const html = render(DownloadsView, { props: { onBack: () => {} } }).body
		expect(html).toContain("In flight · 1")
		expect(html).toContain("bge-small-en-v1.5")
		expect(html).toContain("Embeddings")
		expect(html).toContain("12 of 33 MB")
		expect(html).toContain("width: 40%")
		expect(html).toContain("Cancel")
		// Bytes, never a time estimate (R7).
		expect(html).not.toMatch(/minutes? (left|remaining)/)
		expect(html).toContain("One list for every destination.")
		expect(html).toContain("nothing is deleted for you.")
	})

	test("a failed file carries the host's own sentence", () => {
		downloads.setOnnx([
			{
				id: 3,
				name: "Embeddings",
				models: [
					{
						id: 9,
						name: "bge-small-en-v1.5",
						local: {
							state: "error",
							error: "The Hub returned 404 for that export."
						}
					}
				]
			}
		])
		const html = render(DownloadsView, { props: { onBack: () => {} } }).body
		expect(html).toContain("Failed · 1")
		expect(html).toContain("The Hub returned 404 for that export.")
	})
})

describe("the quant picker", () => {
	test("renders its rows, the recommended chip and the fit", () => {
		const html = render(QuantPicker, {
			props: {
				open: true,
				repo: "TheBloke/Mistral-7B-GGUF",
				quants: [
					{
						name: "Q4_K_M",
						bytes: 4_000_000_000,
						url: "https://hf/q4",
						filename: "q4.gguf",
						recommended: true
					},
					{
						name: "Q8_0",
						bytes: 12_000_000_000,
						url: "https://hf/q8",
						filename: "q8.gguf",
						recommended: false
					}
				],
				tier: "8gb" as const,
				onCancel: () => {},
				onDownload: () => {}
			}
		}).body
		expect(html).toContain("Pick a size")
		expect(html).toContain("TheBloke/Mistral-7B-GGUF · 8 GB tier")
		expect(html).toContain("Q4_K_M")
		expect(html).toContain("Recommended")
		expect(html).toContain("Fits in 8 GB")
		expect(html).toContain("Too big for 8 GB")
		// The footer commits to a size, not to a quantization name.
		expect(html).toContain("Download 4.0 GB")
	})

	test("Not sure suppresses every fit hint", () => {
		const html = render(QuantPicker, {
			props: {
				open: true,
				repo: "TheBloke/Mistral-7B-GGUF",
				quants: [
					{ name: "Q4_K_M", bytes: 4_000_000_000, recommended: true }
				],
				tier: "unsure" as const,
				onCancel: () => {},
				onDownload: () => {}
			}
		}).body
		expect(html).not.toContain("Fits in")
		expect(html).not.toContain("Too big for")
	})
})
