/**
 * The pipeline canvas draws a real document as the line, opens a clause in
 * place, fills the drawer for a selection, and colours the line by a receipt
 * (PLAN-pipeline-canvas-and-genre-authoring P1).
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, listen } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	return {
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => {
				if (listeners.get(key) === handler) listeners.delete(key)
			}
		}
	}
})
const emitted: Array<[string, any]> = []
const socket = { emit: (e: string, p: any) => { emitted.push([e, p]) }, on: () => {}, off: () => {} }
vi.mock("$lib/client/sockets/typedSocket", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	getInterestContext: () => ({
		useInterest: listen,
		declareInterest: listen,
		requestWithInterest: (key: string, _params: unknown, handler: any) =>
			listen(key, handler)
	})
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, info: () => {}, success: () => {}, warning: () => {} }
}))
// The Settings tab mounts the page's step editor; a stub keeps this test about the canvas.
vi.mock("$lib/client/components/pipelines/PipelineConfigOptions.svelte", async () => {
	const { default: Stub } = await import("./testStub.svelte")
	return { default: Stub }
})

import { STORY_RESPOND_SPEC_ID, CORE_SPECS } from "@serene-pub/core-catalog"
import CanvasPanel from "./CanvasPanel.svelte"

const doc = CORE_SPECS.find((s) => s.slug === STORY_RESPOND_SPEC_ID)!.build() as any
const version = { id: 7, semver: doc.version, status: "published", canonicalHash: "abc", isActive: true }
const previous = { id: 5, semver: "1.0.0", status: "retired", canonicalHash: "aaa", isActive: false, publishedAt: null, nodeCount: 1 }

const props = () => ({
	slug: STORY_RESPOND_SPEC_ID,
	versions: [{ ...version, publishedAt: null, nodeCount: doc.nodes.length }, previous],
	graph: {
		nodes: doc.nodes.map((n: any) => ({
			key: n.key,
			label: n.key,
			kind: n.kind,
			definitionId: n.definitionId,
			clauseId: n.clauseId ?? null,
			clauseKind: n.clauseKind ?? null,
			clauseChain: n.clauseChain ?? null,
			position: n.position,
			toggleable: false,
			enabledDefault: true,
			stepKey: n.key === "rank" ? "step-rank" : null
		})),
		clauses: [],
		edges: []
	},
	runs: [
		{
			id: 1,
			runId: "run-1234-abcd",
			specSlug: STORY_RESPOND_SPEC_ID,
			userId: 1,
			specVersion: doc.version,
			specHash: "abc",
			specHashIsCurrent: true,
			specHashRenamedAt: null,
			outcome: "halt",
			haltNodeKey: "scene",
			haltReason: "preview",
			elapsedMs: 1900,
			tokensSpent: 3412,
			isPreview: true,
			artifacts: []
		}
	],
	pending: {},
	pendingClears: [],
	onDraftSet: () => {},
	onDraftClear: () => {},
	onLoaded: () => {}
})

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
})

const deliverDocument = () => {
	listeners.get("pipelines:document")!({ document: doc, version })
	flushSync()
}

describe("CanvasPanel", () => {
	test("draws every spine node as a card and every clause as a container", () => {
		app = mount(CanvasPanel, { target: document.body, props: props() as any })
		flushSync()
		expect(document.body.textContent).toMatch(/Reading the pipeline/)
		deliverDocument()
		const cards = document.querySelectorAll('[role="list"] button[aria-label="input"]')
		expect(cards.length).toBe(1)
		expect(document.querySelector('button[aria-label="rank"]')).not.toBeNull()
		// Closed clauses show as a row with their members as dots, not as cards.
		expect(document.querySelector('button[aria-label="gather.history.read"]')).toBeNull()
		expect(document.querySelector('[aria-label="Open gather"]')).not.toBeNull()
		expect(document.body.textContent).toMatch(new RegExp(`${doc.nodes.length} nodes`))
	})

	test("opening a clause draws its chains, and selecting a member opens the way to it", () => {
		app = mount(CanvasPanel, { target: document.body, props: props() as any })
		flushSync()
		deliverDocument()
		;(document.querySelector('[aria-label="Open gather"]') as HTMLButtonElement).click()
		flushSync()
		expect(document.querySelector('button[aria-label="gather.history.read"]')).not.toBeNull()
		;(document.querySelector('[aria-label="Close gather"]') as HTMLButtonElement).click()
		flushSync()
		expect(document.querySelector('button[aria-label="gather.history.read"]')).toBeNull()
		// The minimap selects a member inside the closed clause: it opens.
		const dot = document.querySelector('svg [role="button"][aria-label="gather.history.read"]') as SVGGElement
		expect(dot).not.toBeNull()
		dot.dispatchEvent(new MouseEvent("click", { bubbles: true }))
		flushSync()
		expect(document.querySelector('button[aria-label="gather.history.read"]')).not.toBeNull()
		expect(document.querySelector('button[aria-label="gather.history.read"]')?.getAttribute("aria-current")).toBe("true")
	})

	test("the drawer carries the selection: the type on Node, the sources on In ports, the editor on Settings", () => {
		app = mount(CanvasPanel, { target: document.body, props: props() as any })
		flushSync()
		deliverDocument()
		;(document.querySelector('button[aria-label="rank"]') as HTMLButtonElement).click()
		flushSync()
		const drawer = document.querySelector('section[aria-label="Selected step"]')!
		expect(drawer.textContent).toMatch(/core:task\/rank-[a-z]+@\d/)
		;(drawer.querySelector('[role="tab"][id="canvas-drawer-in-tab"]') as HTMLButtonElement).click()
		flushSync()
		expect(drawer.textContent).toMatch(/contextBudget\./)
		;(drawer.querySelector('[role="tab"][id="canvas-drawer-settings-tab"]') as HTMLButtonElement).click()
		flushSync()
		expect(drawer.querySelector('[data-test="config-options-stub"]')).not.toBeNull()
		// A node that declares nothing says so instead of mounting an editor.
		;(document.querySelector('button[aria-label="input"]') as HTMLButtonElement).click()
		flushSync()
		expect(drawer.textContent).toMatch(/declares nothing to configure/)
	})

	test("the receipt overlay colours cards by result and the drawer's Last run reads the node's rows", () => {
		app = mount(CanvasPanel, { target: document.body, props: props() as any })
		flushSync()
		deliverDocument()
		;(document.querySelector('[aria-pressed][title^="Colour by the last run"]') as HTMLButtonElement).click()
		flushSync()
		expect(listeners.has("pipelines:run")).toBe(true)
		listeners.get("pipelines:run")!({
			run: {
				runId: "run-1234-abcd",
				receipt: {
					nodes: [
						{ seq: 1, nodeKey: "input", result: "ok", elapsedMs: 1 },
						{ seq: 2, nodeKey: "placeholder", result: "ok", dry: true, elapsedMs: 2 },
						{ seq: 3, nodeKey: "rank", result: "ok", elapsedMs: 3 },
						{ seq: 4, nodeKey: "scene", result: "halt", reason: "preview", elapsedMs: 0 }
					]
				}
			}
		})
		flushSync()
		expect(document.body.textContent).toMatch(/not reached/)
		;(document.querySelector('button[aria-label="scene"]') as HTMLButtonElement).click()
		flushSync()
		const drawer = document.querySelector('section[aria-label="Selected step"]')!
		;(drawer.querySelector('[role="tab"][id="canvas-drawer-run-tab"]') as HTMLButtonElement).click()
		flushSync()
		expect(drawer.textContent).toMatch(/halted/)
		expect(drawer.textContent).toMatch(/preview/)
	})

	test("the diff overlay asks for the version before and marks what moved", () => {
		app = mount(CanvasPanel, { target: document.body, props: props() as any })
		flushSync()
		deliverDocument()
		;(document.querySelector('[aria-pressed][title^="Changes since"]') as HTMLButtonElement).click()
		flushSync()
		const base = JSON.parse(JSON.stringify(doc))
		base.nodes = base.nodes.filter((n: any) => n.key !== "rank")
		listeners.get("pipelines:document")!({ document: base, version: { ...previous } })
		flushSync()
		expect(document.body.textContent).toMatch(/1 added/)
		expect(document.querySelector('button[aria-label="rank"]')?.textContent).toMatch(/\+/)
	})
})

/* ── the editor (P2) ─────────────────────────────────────────────── */

const deliverNoDraft = () => {
	listeners.get("pipelines:draft:get")!({ slug: STORY_RESPOND_SPEC_ID, draft: null, shipped: false })
	flushSync()
}
const lastEmitted = (event: string) => emitted.filter(([e]) => e === event).at(-1)?.[1]
/** awaitReply resolves on a microtask and the editing effects follow it: let both run. */
const settle = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
const echoDraft = async (findings: any[] = []) => {
	// The server recompiles and validates; the test echoes the document the client sent.
	const sent = lastEmitted("pipelines:draft:put")
	expect(sent?.document).toBeTruthy()
	listeners.get("pipelines:draft:put")!({
		slug: STORY_RESPOND_SPEC_ID,
		draft: { document: sent.document, findings, basedOnVersionId: 7, basedOnSemver: doc.version, updatedAt: "now" }
	})
	await settle()
}

describe("CanvasPanel editor", async () => {
	test("Edit starts a draft from the published document; the bar and the actions row say so", async () => {
		app = mount(CanvasPanel, { target: document.body, props: props() as any })
		flushSync()
		deliverDocument()
		deliverNoDraft()
		const edit = document.querySelector('button[title="Start a draft of this version"]') as HTMLButtonElement
		expect(edit).not.toBeNull()
		edit.click()
		flushSync()
		expect(lastEmitted("pipelines:draft:put")?.document?.id).toBe(STORY_RESPOND_SPEC_ID)
		await echoDraft()
		expect(document.body.textContent).toMatch(/draft/)
		expect(document.body.textContent).toMatch(/valid/)
		expect(document.querySelector('[aria-label="Edit the selection"]')).not.toBeNull()
		// The catalogue was asked for.
		expect(emitted.some(([e]) => e === "pipelines:catalogue")).toBe(true)
	})

	test("a shipped pipeline opens the copy dialog instead of a draft", async () => {
		app = mount(CanvasPanel, { target: document.body, props: props() as any })
		flushSync()
		deliverDocument()
		listeners.get("pipelines:draft:get")!({ slug: STORY_RESPOND_SPEC_ID, draft: null, shipped: true })
		flushSync()
		;(document.querySelector('button[title^="A shipped pipeline"]') as HTMLButtonElement).click()
		flushSync()
		expect(document.body.textContent).toMatch(/This pipeline is shipped/)
		expect(lastEmitted("pipelines:draft:put")).toBeUndefined()
	})

	test("adding a step from the catalogue inserts after the selection and selects it", async () => {
		app = mount(CanvasPanel, { target: document.body, props: props() as any })
		flushSync()
		deliverDocument()
		deliverNoDraft()
		;(document.querySelector('button[title="Start a draft of this version"]') as HTMLButtonElement).click()
		flushSync()
		await echoDraft()
		listeners.get("pipelines:catalogue")!({
			definitions: [
				{ id: "core:task/rerank", version: 1, kind: "task", ports: { in: { candidates: "core:shape/candidates@1" }, out: { main: "core:shape/candidates@1" } }, i18n: { name: "Rerank" } },
				{ id: "core:query/session-history", version: 1, kind: "query", ports: { in: {}, out: { messages: "x" } } }
			]
		})
		await settle()
		;(document.querySelector('[role="list"] button[aria-label="rank"]') as HTMLButtonElement).click()
		flushSync()
		;(Array.from(document.querySelectorAll('[aria-label="Edit the selection"] button')).find((b) => /Add after/.test(b.textContent ?? "")) as HTMLButtonElement).click()
		flushSync()
		expect(document.body.textContent).toMatch(/Add a step after rank/)
		;(Array.from(document.querySelectorAll("button")).find((b) => /Rerank/.test(b.textContent ?? "")) as HTMLButtonElement).click()
		await settle()
		const sent = lastEmitted("pipelines:draft:put")
		const added = sent.document.nodes.find((n: any) => n.key === "rerank")
		expect(added).toBeTruthy()
		expect(added.position).toBe(sent.document.nodes.find((n: any) => n.key === "rank").position + 1)
		await echoDraft()
		expect(document.querySelector('[role="list"] button[aria-label="rerank"]')?.getAttribute("aria-current")).toBe("true")
		// The In ports editor lists the declared port with its picker: nothing chosen yet,
		// and only steps that run before it on offer.
		const picker = document.querySelector('select[aria-label="Source for candidates"]') as HTMLSelectElement
		expect(picker).not.toBeNull()
		expect(picker.value).toBe("")
		const offered = Array.from(picker.options).map((o) => o.value)
		expect(offered).toContain("rank.main")
		// Steps that run after it (Story's reply: the context, the reply).
		expect(offered.some((v) => v.startsWith("generate."))).toBe(false)
		expect(offered.some((v) => v.startsWith("context."))).toBe(false)
	})

	test("removing a step asks first and names what loses a source; Notices lists findings", async () => {
		app = mount(CanvasPanel, { target: document.body, props: props() as any })
		flushSync()
		deliverDocument()
		deliverNoDraft()
		;(document.querySelector('button[title="Start a draft of this version"]') as HTMLButtonElement).click()
		flushSync()
		await echoDraft()
		;(document.querySelector('[role="list"] button[aria-label="rank"]') as HTMLButtonElement).click()
		flushSync()
		;(Array.from(document.querySelectorAll('[aria-label="Edit the selection"] button')).find((b) => /Remove/.test(b.textContent ?? "")) as HTMLButtonElement).click()
		flushSync()
		expect(document.body.textContent).toMatch(/Remove rank\?/)
		expect(document.body.textContent).toMatch(/loses? a source/)
		;(Array.from(document.querySelectorAll('[aria-label="Edit the selection"] button')).find((b) => b.textContent?.trim() === "Remove") as HTMLButtonElement).click()
		await settle()
		expect(lastEmitted("pipelines:draft:put").document.nodes.some((n: any) => n.key === "rank")).toBe(false)
		await echoDraft([{ law: "01 §2", severity: "error", nodeKey: "context", message: "reads a node that is gone", fix: "wire another source" }])
		expect(document.body.textContent).toMatch(/1 notice · publish blocked/)
		;(document.querySelector('[role="list"] button[aria-label="context"]') as HTMLButtonElement).click()
		flushSync()
		;(document.querySelector('#canvas-drawer-notices-tab') as HTMLButtonElement).click()
		flushSync()
		expect(document.body.textContent).toMatch(/wire another source/)
	})

	test("Publish opens with a patch bump and the preview's affected configurations", async () => {
		app = mount(CanvasPanel, { target: document.body, props: props() as any })
		flushSync()
		deliverDocument()
		deliverNoDraft()
		;(document.querySelector('button[title="Start a draft of this version"]') as HTMLButtonElement).click()
		flushSync()
		await echoDraft()
		;(Array.from(document.querySelectorAll("button")).find((b) => /Publish…/.test(b.textContent ?? "")) as HTMLButtonElement).click()
		await settle()
		const asked = lastEmitted("pipelines:draft:preview")
		expect(asked.semver).toBe(doc.version.replace(/\.(\d+)$/, (_: string, p: string) => `.${Number(p) + 1}`))
		listeners.get("pipelines:draft:preview")!({ slug: STORY_RESPOND_SPEC_ID, findings: [], semverTaken: false, affected: [{ configId: 1, configName: "Living", culled: ["place.params"], backfilled: [] }] })
		await settle()
		expect(document.body.textContent).toMatch(/Living/)
		expect(document.body.textContent).toMatch(/place\.params/)
		;(Array.from(document.querySelectorAll("button")).find((b) => /^\s*Publish \d/.test(b.textContent ?? "")) as HTMLButtonElement).click()
		await settle()
		expect(lastEmitted("pipelines:draft:publish")?.semver).toBe(asked.semver)
		listeners.get("pipelines:draft:publish")!({ slug: STORY_RESPOND_SPEC_ID, version: { id: 9, semver: asked.semver, canonicalHash: "zzz" }, reconcile: { culled: 1, backfilled: 0 } })
		await settle()
		expect(document.body.textContent).toMatch(new RegExp(`Published ${asked.semver.replace(/\\./g, "\\\\.")}`))
		expect(document.body.textContent).toMatch(/1 value culled/)
	})
})

describe("CanvasPanel composite steps", () => {
	test("Save as step lifts a range to the library under the spec's owner, and the library inserts it back", async () => {
		const ownProps = { ...props(), slug: "acme.lab:spec/reply" }
		const own = JSON.parse(JSON.stringify(doc))
		own.id = "acme.lab:spec/reply"
		app = mount(CanvasPanel, { target: document.body, props: ownProps as any })
		flushSync()
		listeners.get("pipelines:document")!({ document: own, version })
		flushSync()
		listeners.get("pipelines:draft:get")!({ slug: "acme.lab:spec/reply", draft: null, shipped: false })
		flushSync()
		;(document.querySelector('button[title="Start a draft of this version"]') as HTMLButtonElement).click()
		flushSync()
		const sentPut = emitted.filter(([e]) => e === "pipelines:draft:put").at(-1)![1]
		listeners.get("pipelines:draft:put")!({ slug: "acme.lab:spec/reply", draft: { document: sentPut.document, findings: [], basedOnVersionId: 7, basedOnSemver: doc.version, updatedAt: "now" } })
		await settle()
		listeners.get("pipelines:catalogue")!({ definitions: [], composites: [] })
		await settle()
		// Select lore, save lore…rank as a step.
		;(document.querySelector('[role="list"] button[aria-label="lore"]') as HTMLButtonElement).click()
		flushSync()
		;(Array.from(document.querySelectorAll('[aria-label="Edit the selection"] button')).find((b) => /Save as step/.test(b.textContent ?? "")) as HTMLButtonElement).click()
		flushSync()
		const to = document.querySelector('select[aria-label="Last step of the composite"]') as HTMLSelectElement
		expect(Array.from(to.options).map((o) => o.value)).toContain("rank")
		to.selectedIndex = Array.from(to.options).findIndex((o) => o.value === "rank")
		to.dispatchEvent(new Event("input", { bubbles: true }))
		to.dispatchEvent(new Event("change", { bubbles: true }))
		flushSync()
		expect(to.value).toBe("rank")
		const name = document.querySelector('input[aria-label="Composite name"]') as HTMLInputElement
		// Not "retrieval": Story's reply has a junction under that key (2026-10-19).
		name.value = "recall"
		name.dispatchEvent(new Event("input", { bubbles: true }))
		const label = document.querySelector('input[aria-label="Composite label"]') as HTMLInputElement
		label.value = "Recall"
		label.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		expect(document.body.textContent).toMatch(/acme\.lab:composite\/recall/)
		;(Array.from(document.querySelectorAll('[aria-label="Save as a composite step"] button')).find((b) => b.textContent?.trim() === "Save") as HTMLButtonElement).click()
		await settle()
		const saved = emitted.filter(([e]) => e === "pipelines:composite:save").at(-1)![1]
		expect(saved.slug).toBe("acme.lab:composite/recall")
		expect(saved.label).toBe("Recall")
		expect(saved.document.nodes.map((n: any) => n.key)).toContain("names.arm.link")
		listeners.get("pipelines:composite:save")!({ slug: saved.slug, composite: { slug: saved.slug, label: "Recall", nodeCount: saved.document.nodes.length, reads: saved.document.reads, updatedAt: "now" } })
		await settle()
		// The catalogue is re-read and now lists it; insert it after input.
		listeners.get("pipelines:catalogue")!({ definitions: [], composites: [{ slug: saved.slug, label: "Recall", nodeCount: saved.document.nodes.length, reads: saved.document.reads, updatedAt: "now", document: saved.document }] })
		await settle()
		;(document.querySelector('[role="list"] button[aria-label="input"]') as HTMLButtonElement).click()
		flushSync()
		;(Array.from(document.querySelectorAll('[aria-label="Edit the selection"] button')).find((b) => /Add after/.test(b.textContent ?? "")) as HTMLButtonElement).click()
		flushSync()
		;(Array.from(document.querySelectorAll('[role="group"][aria-label="Kind"] button')).find((b) => b.textContent?.trim() === "composite") as HTMLButtonElement).click()
		flushSync()
		;(Array.from(document.querySelectorAll("button")).find((b) => /Recall/.test(b.textContent ?? "") && /composite\//.test(b.textContent ?? "")) as HTMLButtonElement).click()
		await settle()
		const inserted = emitted.filter(([e]) => e === "pipelines:draft:put").at(-1)![1].document
		expect(inserted.nodes.some((n: any) => n.key === "recall.lore")).toBe(true)
		expect(inserted.nodes.some((n: any) => n.key === "recall.names.arm.link")).toBe(true)
		expect(inserted.includes.at(-1)).toEqual({ key: "recall", fragmentId: saved.slug })
		// The selection lands on the composite's first member, a real card.
		listeners.get("pipelines:draft:put")!({ slug: "acme.lab:spec/reply", draft: { document: inserted, findings: [], basedOnVersionId: 7, basedOnSemver: doc.version, updatedAt: "now" } })
		await settle()
		expect(document.querySelector('[role="list"] button[aria-label="recall.lore"]')?.getAttribute("aria-current")).toBe("true")
	})
})
