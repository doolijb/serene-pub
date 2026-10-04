/**
 * A place's panel on the Places lens (plan places-graph B4): each way is said
 * from the place in one sentence, and **Link to…** picks the far end from
 * every place on the line, or makes one.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import NodePanel from "./NodePanel.svelte"
import { graphEdges, nodeNames, panelEdges, type GraphNode } from "./graphModel"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"

const tick = () => new Promise((r) => setTimeout(r, 0))

const node = (key: string, name: string, typeId?: string): GraphNode => ({
	key,
	kind: key.startsWith("cast") ? "cast" : "entry",
	id: Number(key.split("#")[1]),
	name,
	state: "active",
	visibility: "normal",
	...(typeId ? { typeId } : {})
})
const guardroom = node("entry#1", "the Guardroom", LOCATION_TYPE_ID)
const hall = node("entry#2", "the Drowned Hall", LOCATION_TYPE_ID)
const well = node("entry#3", "the Old Well", LOCATION_TYPE_ID)
const verity = node("cast#7", "Verity")
const marrow = node("cast#8", "Marrow")

const rel = (
	id: number,
	from: GraphNode,
	to: GraphNode,
	over: Record<string, unknown> = {}
) => ({
	id,
	from:
		from.kind === "cast"
			? ({ kind: "cast", bindingId: from.id } as const)
			: ({
					kind: "entry",
					entryId: from.id,
					typeId: LOCATION_TYPE_ID
				} as const),
	to:
		to.kind === "cast"
			? ({ kind: "cast", bindingId: to.id } as const)
			: ({
					kind: "entry",
					entryId: to.id,
					typeId: LOCATION_TYPE_ID
				} as const),
	relationshipType: "leads to",
	status: "active",
	historyEntryId: null,
	sceneId: null,
	...over
})

describe("NodePanel — a place's links", () => {
	let app: ReturnType<typeof mount> | null = null

	afterEach(() => {
		if (app) unmount(app)
		app = null
		document.body.replaceChildren()
	})

	async function render(
		open: GraphNode,
		extra: Record<string, unknown> = {}
	) {
		const nodes = [guardroom, hall, well, verity, marrow]
		const edges = graphEdges(
			[
				rel(10, guardroom, hall, {
					relationshipType: "leads north to",
					reverseRelationshipType: "leads south to",
					name: "the rusted iron door"
				}),
				rel(11, verity, hall, { relationshipType: "lives in" }),
				rel(12, verity, marrow, { relationshipType: "ally" })
			],
			new Set(nodes.map((n) => n.key))
		)
		const props = {
			node: open,
			edges: panelEdges(open.key, edges, nodeNames(nodes)),
			notDrawn: [],
			ceiling: null,
			isNew: () => false,
			candidates: nodes,
			canCreatePlace: true,
			onOpen: () => {},
			onLinkTo: vi.fn(),
			onNewPlace: vi.fn(),
			onKeep: () => {},
			onEdgeClick: vi.fn(),
			onDeleteEdge: () => {},
			onOpenScene: () => {},
			onRaiseCeiling: () => {},
			onClose: () => {},
			...extra
		}
		const host = document.createElement("div")
		document.body.append(host)
		app = mount(NodePanel, { target: host, props })
		flushSync()
		await tick()
		flushSync()
		return props
	}

	const sentences = () =>
		[...document.querySelectorAll("[data-node-edge-sentence]")].map((el) =>
			el.textContent?.trim()
		)

	test("says each way from the open place", async () => {
		await render(hall)
		expect(sentences()).toEqual([
			"The rusted iron door leads south to the Guardroom.",
			"Verity lives in the Drowned Hall."
		])
	})

	test("keeps a tie between two members to its type and arrow", async () => {
		await render(verity)
		const rows = [...document.querySelectorAll("[data-node-edge]")].map(
			(el) => el.textContent?.replace(/\s+/g, " ")
		)
		expect(rows[1]).toContain("ally → Marrow")
	})

	test("Link to… offers every place and node but this one, and New place…", async () => {
		const props = await render(hall)
		;(
			document.querySelector(
				'button[aria-label="Show Link to options"]'
			) as HTMLButtonElement
		).click()
		flushSync()
		await tick()
		flushSync()
		const options = [
			...document.querySelectorAll<HTMLElement>(
				'[data-part="content"][data-state="open"] [role=option]'
			)
		]
		expect(options.map((o) => o.textContent?.trim())).toEqual([
			"the Guardroom",
			"the Old Well",
			"Verity",
			"Marrow",
			"New place…"
		])
		options[1].click()
		flushSync()
		await tick()
		flushSync()
		expect(props.onLinkTo).toHaveBeenCalledWith(well)
	})
})
