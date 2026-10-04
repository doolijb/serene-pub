/**
 * The canvas drawn as a map (plan places-graph B4, `labels="always"`): every
 * edge on its own, labelled and clickable at any zoom; a both-ways edge has an
 * arrowhead at each end; a place is tinted by its category and named in full;
 * and a redraw keeps the nodes where they stand.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import GraphVisualization from "./GraphVisualization.svelte"
import {
	toGraphEdge,
	type GraphEdge,
	type GraphNode
} from "$lib/client/lorebooks/graphs/graphModel"

const tick = () => new Promise((r) => setTimeout(r, 0))

const place = (
	id: number,
	name: string,
	category: string | null = null
): GraphNode => ({
	key: `entry#${id}`,
	kind: "entry",
	id,
	name,
	state: "active",
	visibility: "normal",
	typeId: "core:entry/location",
	category
})

const edge = (
	id: number,
	from: number,
	to: number,
	over: Record<string, unknown> = {}
): GraphEdge =>
	toGraphEdge({
		id,
		from: { kind: "entry", entryId: from },
		to: { kind: "entry", entryId: to },
		relationshipType: "leads to",
		status: "active",
		historyEntryId: null,
		sceneId: null,
		...over
	})

describe("GraphVisualization — labels always (the Places lens)", () => {
	let app: ReturnType<typeof mount> | null = null

	afterEach(() => {
		if (app) unmount(app)
		app = null
		document.body.replaceChildren()
	})

	async function render(
		nodes: GraphNode[],
		edges: GraphEdge[],
		categoryOrder?: string[]
	) {
		const props = $state({
			nodes,
			edges,
			labels: "always" as const,
			onEdgeClick: vi.fn(),
			onNodeClick: vi.fn(),
			categoryOrder
		})
		const host = document.createElement("div")
		host.style.width = "800px"
		host.style.height = "600px"
		document.body.append(host)
		app = mount(GraphVisualization, { target: host, props })
		flushSync()
		await tick()
		flushSync()
		return props
	}

	const nodes = [
		place(1, "The Guardroom of the Old Keep", "Keep"),
		place(2, "The Drowned Hall", "Cellar"),
		place(3, "The Crypt")
	]
	const edges = [
		edge(10, 1, 2, {
			relationshipType: "leads north to",
			reverseRelationshipType: "leads south to",
			name: "the rusted iron door"
		}),
		edge(11, 2, 3)
	]

	test("labels every edge by name or type, and names each place in full", async () => {
		await render(nodes, edges)
		const text = document.querySelector(
			"svg[data-graph-canvas]"
		)?.textContent
		expect(text).toContain("the rusted iron door")
		expect(text).toContain("leads to")
		expect(text).toContain("The Guardroom of the Old Keep")
	})

	test("puts an arrowhead at both ends of a both-ways edge only", async () => {
		await render(nodes, edges)
		const both = document.querySelectorAll(
			"path[data-graph-edge-both-ways]"
		)
		expect(both).toHaveLength(1)
		expect(both[0].getAttribute("marker-start")).toMatch(/^url\(#/)
		const visible = [
			...document.querySelectorAll("path[marker-end]")
		] as SVGPathElement[]
		expect(
			visible.filter((p) => !p.hasAttribute("marker-start"))
		).toHaveLength(1)
	})

	test("hands a clicked edge to the lens", async () => {
		const props = await render(nodes, edges)
		;(
			document.querySelector(
				'path[data-graph-edge="11"]'
			) as SVGPathElement
		).dispatchEvent(new MouseEvent("click", { bubbles: true }))
		expect(props.onEdgeClick).toHaveBeenCalledWith(edges[1])
	})

	test("tints a place by its category, and lists the category in the legend", async () => {
		await render(nodes, edges)
		const fill = (key: string) =>
			document
				.querySelector(`[data-graph-node="${key}"] rect`)
				?.getAttribute("fill")
		expect(fill("entry#1")).not.toBe(fill("entry#2"))
		expect(fill("entry#3")).toBe("#0ea5e9")
		const legend = [
			...document.querySelectorAll("[data-legend-category]")
		].map((el) => el.textContent?.trim())
		expect(legend).toEqual(["Cellar", "Keep"])
	})

	test("keeps a category's tint when the canvas is narrowed to it", async () => {
		const order = ["Cellar", "Keep"]
		await render(nodes, edges, order)
		const fill = () =>
			document
				.querySelector('[data-graph-node="entry#1"] rect')
				?.getAttribute("fill")
		const whole = fill()
		unmount(app!)
		app = null
		document.body.replaceChildren()
		// The chip leaves only the Keep: without the book's order it would be
		// dealt the first hue, Cellar's.
		await render([nodes[0]], [], order)
		expect(fill()).toBe(whole)
	})

	test("puts every node in the Tab order as a named button", async () => {
		await render(nodes, edges)
		const node = document.querySelector(
			'[data-graph-node="entry#2"]'
		) as SVGGElement
		expect(node.getAttribute("role")).toBe("button")
		expect(node.getAttribute("tabindex")).toBe("0")
		expect(node.getAttribute("aria-label")).toBe("The Drowned Hall")
	})

	test("picks a node with Enter or Space, as a click does", async () => {
		const props = await render(nodes, edges)
		const node = document.querySelector(
			'[data-graph-node="entry#2"]'
		) as SVGGElement
		node.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
		)
		expect(props.onNodeClick).toHaveBeenLastCalledWith(nodes[1])
		node.dispatchEvent(
			new KeyboardEvent("keydown", { key: " ", bubbles: true })
		)
		expect(props.onNodeClick).toHaveBeenCalledTimes(2)
		node.dispatchEvent(
			new KeyboardEvent("keydown", { key: "a", bubbles: true })
		)
		expect(props.onNodeClick).toHaveBeenCalledTimes(2)
	})

	test("keeps the nodes where they stand when a link is drawn", async () => {
		const props = await render(nodes, [edges[1]])
		const at = (key: string) =>
			document
				.querySelector(`[data-graph-node="${key}"] rect`)
				?.getAttribute("x")
		const before = at("entry#1")
		props.edges = edges
		flushSync()
		expect(at("entry#1")).toBe(before)
		expect(document.querySelectorAll("path[data-graph-edge]")).toHaveLength(
			2
		)
	})

	// Plan B7: a drag is not a pick, a dropped node stays put, and a
	// rebuild that changes no node or join does not restart the layout.
	const press = (el: Element, type: string, x: number, y: number) =>
		el.dispatchEvent(
			new MouseEvent(type, {
				bubbles: true,
				clientX: x,
				clientY: y,
				button: 0
			})
		)

	test("a drag does not pick the node it moved; a click still does", async () => {
		const props = await render(nodes, edges)
		const node = document.querySelector('[data-graph-node="entry#2"]')!
		const svg = document.querySelector("svg[data-graph-canvas]")!
		press(node, "pointerdown", 100, 100)
		press(svg, "pointermove", 160, 140)
		press(svg, "pointerup", 160, 140)
		press(node, "click", 160, 140)
		flushSync()
		expect(props.onNodeClick).not.toHaveBeenCalled()

		press(node, "pointerdown", 160, 140)
		press(svg, "pointerup", 161, 140)
		press(node, "click", 161, 140)
		flushSync()
		expect(props.onNodeClick).toHaveBeenCalledTimes(1)
	})

	test("a rebuild with the same nodes and joins redraws in place", async () => {
		const props = await render(nodes, edges)
		const at = (key: string) =>
			document
				.querySelector(`[data-graph-node="${key}"] rect`)
				?.getAttribute("x")
		const before = at("entry#3")
		props.nodes = nodes.map((n) =>
			n.id === 3 ? { ...n, name: "The Sealed Crypt" } : { ...n }
		)
		props.edges = edges.map((e) => ({ ...e }))
		flushSync()
		expect(at("entry#3")).toBe(before)
		expect(
			document
				.querySelector('[data-graph-node="entry#3"]')!
				.getAttribute("aria-label")
		).toBe("The Sealed Crypt")
	})
})
