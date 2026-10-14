/**
 * What a step — or a settings group — receives and carries out, in words
 * (owner ruling 2026-10-12: the *Receives* and *Carries out* cards on the
 * admin pipeline page's selected step or agent).
 *
 * Read from the stored graph (its nodes and wired edges) and the registry
 * rows (each definition's declared `ports` and `effects`), never from an
 * in-process descriptor — the rule `declarations.ts` states for the whole
 * panel (F6).
 *
 * The lines, for a set of steps (one step, a clause's members, or a group's):
 *
 *  · **receives** — every wired edge INTO the set from outside it: the
 *    receiving in-port (a path into it, `items.0.text`, reads as its port),
 *    its shape, a plain label, and `from` the feeding step's heading. An
 *    inlet is the session or the event, not a step: a line it feeds has no
 *    `from`, and an inlet is inside a set only as the one step asked about;
 *  · **carries out** — every out-port wired to something outside the set.
 *    A port that flows between the set's own steps, or to nothing, is not
 *    carried out of it. Then one line per outlet in the set for the write it
 *    makes (`OUTLET_WRITES`).
 *
 * A set's lines are the union of its steps' with the flows between them left
 * out — the group's cards. Deduplicated by label (and, on a received line,
 * by feeding step), first one wins. A share of the context reads as words,
 * never as a number. Pure, so the rule is testable without a database;
 * `groups.ts` places the lines.
 */

import { humanizeCamel, humanizeTypeId } from "$lib/server/pipelines/config/panel/declarations"
import type { PortLine } from "$lib/server/pipelines/config/panel/types"

/** The slice of a registry row the lines read. */
export interface FlowDefinition {
	kind?: string | null
	ports?: { in?: Record<string, unknown>; out?: Record<string, unknown> } | null
	effects?: string | null
	/** The definition's display name (`i18n.name`), already resolved. */
	name?: string
}

/** The slice of a stored document node the lines read. */
export interface FlowNode {
	key: string
	kind?: string
	definitionId?: string
	clauseId?: string | null
}

/** A stored edge; `from` may be a clause id (a clause publishes its members' work). */
export interface FlowEdge {
	from: string
	to: string
	fromPort?: string
	toPort?: string
	shape?: string
}

export interface FlowGraph {
	nodes: readonly FlowNode[]
	edges: readonly FlowEdge[]
	/** A node's definition row, or undefined when the row is gone. */
	definitionOf: (node: FlowNode) => FlowDefinition | undefined
	/** A step's heading — a node key or a clause id — as the panel names it. */
	headingOf: (address: string) => string
}

export type Effect = "none" | "external" | "write" | "emit"
const EFFECTS = new Set<string>(["none", "external", "write", "emit"])

/**
 * Shapes, in plain words. Keyed on the shape id with its version stripped.
 * A shape absent here — or one that says nothing about what flows (`text`,
 * `json`) — reads as its port's name instead.
 */
const SHAPE_WORDS: Record<string, string> = {
	"core:shape/session-scope": "the session",
	"core:shape/messages": "the conversation",
	"core:shape/context-candidates": "a share of the context",
	"core:shape/rendered-blocks": "the prompt's blocks",
	"core:shape/assembled-context": "the assembled prompt",
	"core:shape/allocated-context": "the prompt, cut to fit",
	"core:shape/session-cast": "the cast",
	"core:shape/mcp": "tools",
	"core:shape/template-context": "the template's values",
	"core:shape/vector": "an embedding",
	"core:shape/context-budget": "the context budget",
	"core:shape/row-ids": "saved rows",
	"core:shape/branch-results": "each branch's results",
	"core:shape/write-result": "what was saved",
	"core:shape/summarize-request": "what to summarize",
	"core:shape/drafts": "drafts",
	"core:shape/graph-scenes": "scenes",
	"core:shape/graph-proposal": "a proposed state change",
	"core:shape/speaker-selection": "who speaks",
	"core:shape/participant-ref": "a participant",
	"core:shape/participant-refs": "participants",
	"core:shape/session-change": "a change to the session",
	"core:shape/form-addressed": "a form's answer",
	"core:shape/cast-change": "a change to the cast",
	"core:shape/annex-change": "a state change",
	"core:shape/recorded-event": "a recorded event",
	"core:shape/turn-order-changed": "the new turn order",
	"core:shape/turn-order": "the turn order",
	"core:shape/turn-candidates": "who may speak",
	"core:shape/turn-entries": "the turn's entries",
	"core:shape/sprite-choices": "the sprites to choose from",
	"core:shape/sprite-pick": "the chosen sprite",
	"core:shape/session-settings": "the session's settings",
	"core:shape/media-ref": "media",
	"core:shape/media-refs": "media",
	"core:shape/media-by-message": "media, by message",
	"core:shape/folded-sections": "folded sections",
	"core:shape/audio": "audio",
	"core:shape/image": "an image",
	"core:shape/decisions": "decisions",
	"core:shape/text-gen": "a text model",
	"core:shape/embeddings": "an embedding model",
	"core:shape/ner": "a name-finding model",
	"core:shape/tts": "a voice model",
	"core:shape/image-gen": "an image model"
}

/**
 * Shapes that say less than their port's name: `text` and `json` say nothing
 * about what flows, and `speaker` or `characterId` reads better than *a
 * participant* or *saved rows*.
 */
const WEAK_SHAPES = new Set([
	"core:shape/text",
	"core:shape/text-stream",
	"core:shape/part-stream",
	"core:shape/json",
	"core:shape/row-ids",
	"core:shape/participant-ref",
	"core:shape/participant-refs"
])

/** Port names that say nothing either: the producing step's heading says it. */
const GENERIC_PORTS = new Set(["main", "in", "out", "value", "payload", "result", "text", "json"])

/**
 * What an outlet's write does, in plain words — keyed on the definition id
 * with its version stripped. An outlet absent here reads as its definition's
 * name.
 */
export const OUTLET_WRITES: Record<string, string> = {
	"core:outlet/create-message": "writes the reply",
	"core:outlet/update-message": "saves the finished reply",
	"core:outlet/seed-greetings": "writes the greetings",
	"core:outlet/delete-message": "deletes a message",
	"core:outlet/hide-message": "hides a message",
	"core:outlet/edit-message": "edits a message",
	"core:outlet/swipe-message": "adds another reply to choose from",
	"core:outlet/branch-session": "branches the session",
	"core:outlet/set-turn-order": "sets the turn order",
	"core:outlet/set-session-annex": "changes the session's state",
	"core:outlet/set-annex-field": "changes a state field",
	"core:outlet/record-event": "records an event",
	"core:outlet/show-sprite": "shows a sprite",
	"core:outlet/advance-story-clock": "advances the story clock",
	"core:outlet/answer-form": "answers a form",
	"core:outlet/attach-audio": "attaches audio",
	"core:outlet/attach-image": "attaches an image",
	"core:outlet/create-lore-entry": "adds a lore entry",
	"core:outlet/link-lore-entries": "links lore entries",
	"core:outlet/graph-proposal": "proposes a state change"
}

const bare = (id: string) => id.replace(/@\d+$/, "")

/** `World lore` → `world lore`; an acronym (`NPC moves`) keeps its case. */
const lowerFirst = (s: string) =>
	/^[A-Z][A-Z]/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1)

/** `the narrator` → `narrator's`; `voices` → `voices'`. */
const possessive = (s: string) => (/s$/i.test(s) ? `${s}'` : `${s}'s`)

/** A port address's port: an edge may name a path into it (`items.0.text`). */
const basePort = (port: string) => port.split(".")[0] || port

/** The port's name as words: `recentMessages` → `recent messages`. */
const portWords = (port: string) => lowerFirst(humanizeCamel(port).toLowerCase())

/**
 * A port's label. `band` is the heading of the source that publishes a share
 * of the context — the band in plain words — when one is known.
 */
export function portLabel(args: {
	port: string
	shape: string
	/** The step whose output this is — the line's own step for an out-port, the feeding step for an in-port. */
	producer?: { heading: string; isSource: boolean }
	/** For an in-port: the shape the feeding out-port declares, read when the in-port's own says little. */
	producerShape?: string
}): string {
	const { port, shape, producer, producerShape } = args
	const strong = (id: string | undefined) => {
		const s = id ? bare(id) : ""
		return WEAK_SHAPES.has(s) ? undefined : SHAPE_WORDS[s]
	}
	const s = bare(shape)
	const candidates = (id: string | undefined) => !!id && bare(id) === "core:shape/context-candidates"
	if ((candidates(shape) || candidates(producerShape)) && producer?.isSource)
		return `${lowerFirst(producer.heading)}, a share of the context`
	const words = strong(shape) ?? strong(producerShape)
	if (words) return words
	if (!GENERIC_PORTS.has(port)) return portWords(port)
	const json = s === "core:shape/json" || (producerShape && bare(producerShape) === "core:shape/json")
	if (producer) return `${possessive(lowerFirst(producer.heading))} ${json ? "result" : "text"}`
	return json ? "a value" : "text"
}

/** The plain line for an outlet's write. */
export function outletWriteLine(definitionId: string, name?: string): PortLine {
	const id = bare(definitionId)
	return {
		port: "session",
		shape: id,
		label: OUTLET_WRITES[id] ?? lowerFirst(name ?? humanizeTypeId(id))
	}
}

/** A definition's declared effect, when it is one of the four. */
export function effectOf(def: FlowDefinition | undefined): Effect | undefined {
	return def?.effects && EFFECTS.has(def.effects) ? (def.effects as Effect) : undefined
}

const shapeOf = (v: unknown): string => (typeof v === "string" ? v : "")

/** One line per label — per label and feeding step, on a received line, so two feeds of one port both show. */
function dedupe(lines: PortLine[]): PortLine[] {
	const seen = new Set<string>()
	return lines.filter((l) => {
		const key = `${l.label}\u0000${l.from ?? ""}`
		return seen.has(key) ? false : (seen.add(key), true)
	})
}

/**
 * The lines for a set of addresses — node keys, and a clause id when its
 * clause is in the set. `single` is the one-step case, where an inlet may be
 * the step asked about.
 */
export function flowLinesOf(
	graph: FlowGraph,
	members: ReadonlySet<string>,
	single = false
): { receives: PortLine[]; carriesOut: PortLine[] } {
	const byKey = new Map(graph.nodes.map((n) => [n.key, n]))
	const isInlet = (address: string) => byKey.get(address)?.kind === "inlet"
	// An inlet is the session or the event, never inside a set — except as
	// the one step asked about, which carries out what the run starts with.
	const inSet = (address: string) => members.has(address) && (single || !isInlet(address))
	const isSource = (address: string) => byKey.get(address)?.kind === "query"
	const defOf = (address: string) => {
		const n = byKey.get(address)
		return n ? graph.definitionOf(n) : undefined
	}

	const receives: PortLine[] = []
	for (const e of graph.edges) {
		if (!inSet(e.to) || inSet(e.from)) continue
		const port = basePort(e.toPort ?? "in")
		const producerShape = shapeOf(defOf(e.from)?.ports?.out?.[basePort(e.fromPort ?? "main")]) || e.shape
		const shape = shapeOf(defOf(e.to)?.ports?.in?.[port]) || producerShape || ""
		// The session or the event — an inlet, or an address that is no step.
		const feeder = !isInlet(e.from) && (byKey.has(e.from) || graph.nodes.some((n) => n.clauseId === e.from))
		const heading = feeder ? graph.headingOf(e.from) : undefined
		receives.push({
			port,
			shape,
			label: portLabel({
				port,
				shape,
				producer: heading ? { heading, isSource: isSource(e.from) } : undefined,
				...(producerShape ? { producerShape } : {})
			}),
			...(heading ? { from: heading } : {})
		})
	}

	const carriesOut: PortLine[] = []
	const outLine = (address: string, port: string, shape: string): PortLine => ({
		port,
		shape,
		label: portLabel({
			port,
			shape,
			producer: { heading: graph.headingOf(address), isSource: isSource(address) }
		})
	})
	for (const address of members) {
		if (!inSet(address)) continue
		const def = defOf(address)
		for (const e of graph.edges) {
			if (e.from !== address || inSet(e.to)) continue
			const port = basePort(e.fromPort ?? "main")
			const declaredShape = shapeOf(def?.ports?.out?.[port])
			const consumerShape = shapeOf(defOf(e.to)?.ports?.in?.[basePort(e.toPort ?? "")])
			carriesOut.push(outLine(address, port, declaredShape || e.shape || consumerShape))
		}
	}
	for (const address of members) {
		if (!inSet(address)) continue
		const n = byKey.get(address)
		if (n?.kind === "outlet" && n.definitionId)
			carriesOut.push(outletWriteLine(n.definitionId, graph.definitionOf(n)?.name))
	}
	return { receives: dedupe(receives), carriesOut: dedupe(carriesOut) }
}

/** A step's lines and effect: a node, or a clause (its members and itself). */
export function stepFlowsOf(
	graph: FlowGraph,
	address: string
): { receives: PortLine[]; carriesOut: PortLine[]; effect?: Effect } {
	const node = graph.nodes.find((n) => n.key === address)
	if (node) {
		const effect = effectOf(graph.definitionOf(node))
		return { ...flowLinesOf(graph, new Set([address]), true), ...(effect ? { effect } : {}) }
	}
	const members = graph.nodes.filter((n) => n.clauseId === address).map((n) => n.key)
	return flowLinesOf(graph, new Set([address, ...members]))
}
