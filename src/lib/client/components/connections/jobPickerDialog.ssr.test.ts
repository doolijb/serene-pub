/**
 * The job picker, rendered.
 *
 * `render` from `svelte/server`, like `indexRows.ssr.test.ts`: the repo has no
 * browser test environment, and what this dialog DOES is the assembly — a
 * state line, the pair in use, the pairs that could replace it, and the door
 * to the finder. `jobPicker.test.ts` pins every sentence and row it puts
 * together; this pins that they reach the screen, in both of the two states
 * that read completely differently (nothing configured, and something).
 *
 * Skeleton's `Portal` renders in place on the server, and the dialog is open
 * while it has a job, so the content is in the body.
 *
 * ⚠ Not a design assertion. It checks sentences and the classes that carry
 * meaning (the selected row, the gold chip, the primary Get button), never
 * layout.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))

import JobPickerDialog from "./JobPickerDialog.svelte"

function model(over: Record<string, unknown> = {}) {
	return {
		id: 1,
		connectionId: 1,
		model: "llama-3",
		name: "llama-3",
		enabled: true,
		missingSince: null,
		contextWindow: null,
		promptFormat: null,
		tokenCounter: null,
		sortOrder: 0,
		satisfiableCapabilities: ["text->text"],
		...over
	}
}

function connection(over: Record<string, unknown> = {}) {
	return {
		id: 1,
		name: "Local",
		type: "ollama",
		models: [model()],
		modelsSync: { at: null, error: null },
		...over
	}
}

const props = {
	job: "text->text",
	connections: [] as unknown[],
	onClose: () => {},
	onChoose: () => {},
	onGetModel: () => {}
}

describe("the job picker renders", () => {
	test("closed, it draws nothing", () => {
		const html = render(JobPickerDialog, {
			props: { ...props, job: null } as any
		}).body
		expect(html).not.toContain("Reply")
	})

	test("nothing configured: the cost, the empty list, a gold door out", () => {
		const html = render(JobPickerDialog, { props: props as any }).body
		// The sheet: the default loadout's name, then its three numbered sections.
		expect(html).toContain("Reply")
		expect(html).toContain("Which model answers")
		expect(html).toContain("How it writes")
		expect(html).toContain("Where this applies")
		expect(html).toContain(
			"Every session, unless a pipeline configuration names its own model or sampling."
		)
		expect(html).toContain('href="/admin/defaults"')
		expect(html).toContain(
			"Every session replies with this unless its pipeline says otherwise."
		)
		expect(html).toContain("Not set")
		expect(html).toContain("· sessions can't reply")
		expect(html).not.toContain("Not set · sessions can't reply")
		expect(html).toContain("Nothing here can chat yet.")
		expect(html).toContain("Get a model…")
		// Nothing anywhere can chat, so the way out is the primary (R7).
		expect(html).toContain("preset-filled-primary-500")
		expect(html).not.toContain('role="radiogroup"')
	})

	test("the pair in use first, an alternative, and what is switched off", () => {
		const html = render(JobPickerDialog, {
			props: {
				...props,
				connections: [
					connection({
						models: [
							model(),
							model({ id: 2, name: "mistral" }),
							model({
								id: 3,
								name: "old",
								enabled: false,
								satisfiableCapabilities: []
							})
						]
					})
				]
			} as any,
			context: new Map([
				[
					"systemSettingsCtx",
					{
						capabilityDefaults: {
							"text->text": {
								connectionId: 1,
								connectionModelId: 1
							}
						}
					}
				]
			])
		}).body

		expect(html).toContain("Ready")
		// The state line names the pair in use.
		expect(html).toContain("· llama-3 · Local · listed")
		// One radio per pair: the one in use first, checked, selected and
		// marked, with nothing to press; the alternative with Use.
		expect(html).toContain('role="radiogroup"')
		expect(html).toContain("Models that can chat · 2")
		const radios = [
			...html.matchAll(
				/<button\b([^>]*role="radio"[^>]*)>([\s\S]*?)<\/button>/g
			)
		]
		expect(radios).toHaveLength(2)
		expect(radios[0][1]).toContain('aria-checked="true"')
		expect(radios[0][1]).toContain("sidebar-row-active")
		expect(radios[0][2]).toContain("llama-3")
		expect(radios[0][2]).toContain("In use")
		expect(radios[0][2]).not.toContain(">Use<")
		expect(radios[1][1]).toContain('aria-checked="false"')
		expect(radios[1][1]).toContain('aria-label="Use mistral for Chat"')
		expect(radios[1][2]).toContain("mistral")
		expect(radios[1][2]).toContain("Use")
		expect(html).toContain("1 more is switched off or not listed")
		// Something already chats, so the door out is tonal.
		expect(html).toContain("Get a model…")
		expect(html).not.toContain("preset-filled-primary-500")
	})
})

/**
 * A local ONNX pair whose files never arrived, on a machine whose ONNX runtime
 * didn't load. Both ways to a download stay on screen — the fix's Download and
 * the "N more" door — disabled, with the reason in words beside them.
 */
describe("local ONNX downloads where the runtime didn't load", () => {
	const REASON =
		"Not available on this machine: the Android app can't run the ONNX runtime"
	const onnx = (id: number, name: string) =>
		model({
			id,
			name,
			model: name,
			satisfiableCapabilities: ["text->embedding"],
			local: { state: "not_downloaded" }
		})

	function renderEmbeddings(localOnnxAvailability: {
		available: boolean
		reason: string | null
	}) {
		const connections = [
			connection({
				name: "Local embeddings",
				type: "local-onnx",
				models: [onnx(1, "MiniLM"), onnx(2, "BGE")]
			})
		]
		return render(JobPickerDialog, {
			props: { ...props, job: "text->embedding", connections } as any,
			context: new Map([
				[
					"systemSettingsCtx",
					{
						settings: { localOnnxAvailability },
						capabilityDefaults: {
							"text->embedding": {
								connectionId: 1,
								connectionModelId: 1
							}
						}
					}
				]
			])
		}).body
	}
	/** Each `<button>` opening tag whose body says this. */
	const buttonsSaying = (html: string, words: string) =>
		[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
			.filter(([, , body]) => body.includes(words))
			.map(([, attrs]) => attrs)
	/** The boolean attribute, not the `disabled:` class variants. */
	const isDisabled = (attrs: string) => /\sdisabled(?=[\s=>]|$)/.test(attrs)
	const count = (html: string, words: string) => html.split(words).length - 1

	test("unavailable: Download and the door are disabled and say why", () => {
		const html = renderEmbeddings({
			available: false,
			reason: "the Android app can't run the ONNX runtime"
		})
		const download = buttonsSaying(html, "Download")
		expect(download).toHaveLength(1)
		expect(isDisabled(download[0])).toBe(true)
		const door = buttonsSaying(html, "1 more is available to download")
		expect(door).toHaveLength(1)
		expect(isDisabled(door[0])).toBe(true)
		// In each one's tooltip, and in words beside each: nothing hover-only.
		expect(count(html, `title="${REASON}"`)).toBe(2)
		expect(count(html, REASON)).toBe(4)
	})

	test("available: both enabled, and no reason", () => {
		const html = renderEmbeddings({ available: true, reason: null })
		expect(isDisabled(buttonsSaying(html, "Download")[0])).toBe(false)
		expect(
			isDisabled(
				buttonsSaying(html, "1 more is available to download")[0]
			)
		).toBe(false)
		expect(html).not.toContain("Not available on this machine")
	})
})

/**
 * Where the runtime didn't load, a local ONNX model can't be made active even
 * with its files on disk — the server refuses the star with the machine's
 * reason — and named entities have no other provider, so the finder door
 * would lead to a finder whose one destination is disabled.
 */
describe("making local ONNX models active where the runtime didn't load", () => {
	const CLAUSE = "the Android app can't run the ONNX runtime"
	const REASON = `Not available on this machine: ${CLAUSE}`
	const buttonsSaying = (html: string, words: string) =>
		[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
			.filter(([, , body]) => body.includes(words))
			.map(([, attrs]) => attrs)
	const isDisabled = (attrs: string) => /\sdisabled(?=[\s=>]|$)/.test(attrs)
	const count = (html: string, words: string) => html.split(words).length - 1

	function renderView(
		capability: string,
		connectionsList: unknown[],
		localOnnxAvailability: { available: boolean; reason: string | null }
	) {
		return render(JobPickerDialog, {
			props: {
				...props,
				job: capability,
				connections: connectionsList
			} as any,
			context: new Map([
				[
					"systemSettingsCtx",
					{
						settings: { localOnnxAvailability },
						capabilityDefaults: {}
					}
				]
			])
		}).body
	}
	const onDisk = (id: number, name: string, capability: string) =>
		model({
			id,
			name,
			model: name,
			satisfiableCapabilities: [capability],
			local: { state: "on_disk" }
		})
	const localEmbeddings = connection({
		name: "Local embeddings",
		type: "local-onnx",
		models: [
			onDisk(1, "MiniLM", "text->embedding"),
			onDisk(2, "BGE", "text->embedding")
		]
	})

	test("unavailable: each downloaded model's Use is disabled, and the reason is said once", () => {
		const html = renderView("text->embedding", [localEmbeddings], {
			available: false,
			reason: CLAUSE
		})
		const uses = buttonsSaying(html, "Use")
		expect(uses).toHaveLength(2)
		for (const attrs of uses) {
			expect(isDisabled(attrs)).toBe(true)
			expect(attrs).toContain(`title="${REASON}"`)
		}
		// Twice as a tooltip, once in words under the rows.
		expect(count(html, REASON)).toBe(5)
	})

	test("available: Use is offered and nothing is said", () => {
		const html = renderView("text->embedding", [localEmbeddings], {
			available: true,
			reason: null
		})
		const uses = buttonsSaying(html, "Use")
		expect(uses).toHaveLength(2)
		for (const attrs of uses) expect(isDisabled(attrs)).toBe(false)
		expect(html).not.toContain("Not available on this machine")
	})

	test("named entities: the finder door is disabled, its note the reason", () => {
		const html = renderView("text->entities", [], {
			available: false,
			reason: CLAUSE
		})
		const door = buttonsSaying(html, "Get a model…")
		expect(door).toHaveLength(1)
		expect(isDisabled(door[0])).toBe(true)
		expect(count(html, REASON)).toBe(2)
	})

	test("embeddings: the finder door stays, a service can still embed", () => {
		const html = renderView("text->embedding", [], {
			available: false,
			reason: CLAUSE
		})
		const door = buttonsSaying(html, "Get a model…")
		expect(door).toHaveLength(1)
		expect(isDisabled(door[0])).toBe(false)
	})
})
