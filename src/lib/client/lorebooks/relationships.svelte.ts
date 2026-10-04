/**
 * The open book's relationships — ONE copy, read by every surface (plan
 * places-graph §10.1, B3).
 *
 * This store owns `narrativeGraph:list` and the three relationship pushes; the
 * graph lens and the workspace (whose rows feed the References panel) both
 * derive from it, so a write on either surface shows on the other through the
 * server's push. A surface never reads the list for itself.
 *
 * Created once by `LorebooksWorkspace` and provided by context; `open(id)`
 * turns it to one book and returns the release. Writes go through it
 * (`create` / `update` / `remove`), and an update or a remove always names
 * the line being read — the server refuses another line's row (plan B0).
 *
 * ⚠ It also holds the list's cast rows (`nodes`): they arrive in the same
 * reply, and a relationship with a cast end is said by their names.
 * ⚠ Every listener comes off through its registry release, which takes that
 * handler and no other — never a bare `socket.off(event)`, which would strip
 * every view's listener app-wide.
 */

import { getContext, setContext, untrack } from "svelte"
import { SvelteMap } from "svelte/reactivity"
import { declareInterest } from "$lib/client/sockets/interest.svelte"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { interestKey } from "$lib/shared/sockets/interest"
import {
	bumpLinkCounts,
	linkCountsOf,
	type LinkCounts
} from "./graphs/graphModel"
import { isReplyFor } from "./graphs/linkDraft"

type NarrativeRelationship = Sockets.NarrativeGraph.NarrativeRelationship
type NarrativeNode = Sockets.NarrativeGraph.NarrativeNode

/**
 * What a surface does when the rows move, beyond reading them. Each runs after
 * the store's own rows have moved, so a hook reads the new state.
 */
export interface RelationshipHooks {
	/** A list for the open book arrived. */
	listed?(msg: Sockets.NarrativeGraph.List.Response): void
	/** A relationship was created in the open book. */
	created?(rel: NarrativeRelationship): void
	/** A relationship the store held was deleted. */
	deleted?(rel: NarrativeRelationship): void
}

/**
 * The failure nobody reports: silence. An `:error` covers a handler that
 * threw; a socket that went away mid-flight produces no reply at all.
 */
const LOAD_TIMEOUT_MS = 20_000

const NO_COUNTS: LinkCounts = { castToCast: 0 }

export class BookRelationships {
	/** The book it is open on, or null. */
	lorebookId = $state<number | null>(null)
	/** The list's cast rows, which a cast end is named by. */
	nodes = $state.raw<NarrativeNode[]>([])
	/** What a Rebuild would delete — kept true by the pushes. */
	counts = $state<LinkCounts>({ ...NO_COUNTS })
	/** A list for the open book has arrived. */
	loaded = $state(false)
	/** Why the last read failed, or null. */
	error = $state<string | null>(null)

	#rows = new SvelteMap<number, NarrativeRelationship>()
	#all = $derived([...this.#rows.values()])
	#socket: Pick<TypedSocket, "emit">
	#hooks = new Set<RelationshipHooks>()
	/** A read is out and unanswered: an error or silence is ours to report. */
	#pending = false
	#timer: ReturnType<typeof setTimeout> | null = null

	constructor(socket: Pick<TypedSocket, "emit">) {
		this.#socket = socket
	}

	/** Every relationship in the book, on every line, in the order they came. */
	get all(): NarrativeRelationship[] {
		return this.#all
	}

	get(id: number): NarrativeRelationship | undefined {
		return this.#rows.get(id)
	}

	/**
	 * Turn to one book: forget the last one's rows and hear this one's. The
	 * release takes every handler off by its own reference.
	 *
	 * Turning to the book it already holds keeps its rows and stays loaded:
	 * an effect that re-runs on the same book (a route change inside it) is
	 * not a new book, and an emptied store swaps the graph lens's canvas for
	 * its spinner and rebuilds it, layout, pan and zoom lost (#123). The
	 * workspace's `load()` refreshes them.
	 *
	 * ⚠ Untracked: called from an effect, and a read here would make that
	 * effect re-run on the very state this writes.
	 */
	open(lorebookId: number): () => void {
		return untrack(() => {
			this.#clearTimer()
			this.#pending = false
			if (lorebookId !== this.lorebookId) {
				this.lorebookId = lorebookId
				this.#rows.clear()
				this.nodes = []
				this.counts = { ...NO_COUNTS }
				this.loaded = false
			}
			this.error = null
			const releases = [
				declareInterest<"narrativeGraph:list">(
					interestKey("narrativeGraph:list", lorebookId),
					this.#onList
				),
				// ⚠ BARE: the failure names no book, and the server sends it
				// to the asking tab outside the gate, so nothing swallows it.
				declareInterest<"narrativeGraph:list:error">(
					"narrativeGraph:list:error",
					this.#onListError
				),
				// The writes are BARE too (none is in `SCOPED_EVENTS`), so
				// each handler filters on the book its reply names.
				declareInterest<"narrativeGraph:createRelationship">(
					"narrativeGraph:createRelationship",
					this.#onCreate
				),
				declareInterest<"narrativeGraph:updateRelationship">(
					"narrativeGraph:updateRelationship",
					this.#onUpdate
				),
				declareInterest<"narrativeGraph:deleteRelationship">(
					"narrativeGraph:deleteRelationship",
					this.#onDelete
				)
			]
			return () => {
				for (const release of releases) release()
				this.#clearTimer()
				this.#pending = false
			}
		})
	}

	/** Ask for the open book's list again. */
	load(): void {
		const lorebookId = untrack(() => this.lorebookId)
		if (lorebookId === null) return
		this.error = null
		this.#pending = true
		this.#clearTimer()
		this.#timer = setTimeout(() => {
			this.#timer = null
			if (!this.#pending) return
			this.#pending = false
			this.error = "The graph did not come back."
		}, LOAD_TIMEOUT_MS)
		this.#socket.emit("narrativeGraph:list", {
			lorebookId
		} satisfies Sockets.NarrativeGraph.List.Params)
	}

	/** Hear the rows move. Returns the unsubscribe. */
	listen(hooks: RelationshipHooks): () => void {
		this.#hooks.add(hooks)
		return () => {
			this.#hooks.delete(hooks)
		}
	}

	/**
	 * Draw a relationship. Resolves with the row once the server has it;
	 * rejects with the server's sentence or on silence.
	 */
	async create(
		params: Sockets.NarrativeGraph.CreateRelationship.Params
	): Promise<NarrativeRelationship> {
		const res = await awaitReply({
			socket: this.#socket,
			event: "narrativeGraph:createRelationship",
			params,
			errorEvent: "narrativeGraph:createRelationship:error",
			match: (msg) => isReplyFor(params, msg.relationship),
			fallbackError: "The link could not be saved."
		})
		return res.relationship
	}

	/**
	 * Change a relationship, from the line being read (null is main). The
	 * line is a required argument, not an option: the server judges the row
	 * against it, and a caller that forgot it would be read as main.
	 */
	async update(
		relationship: Sockets.NarrativeGraph.UpdateRelationship.Params["relationship"],
		branchId: number | null
	): Promise<NarrativeRelationship> {
		const id = relationship.id
		const res = await awaitReply({
			socket: this.#socket,
			event: "narrativeGraph:updateRelationship",
			params: {
				relationship,
				branchId
			} satisfies Sockets.NarrativeGraph.UpdateRelationship.Params,
			errorEvent: "narrativeGraph:updateRelationship:error",
			match: (msg) => msg.relationship.id === id,
			fallbackError: "The relationship could not be saved."
		})
		return res.relationship
	}

	/**
	 * Delete a relationship, from the line being read (null is main).
	 * Resolves once the server has deleted it (the push has dropped the row
	 * by then or is about to); rejects with the server's sentence — another
	 * line's row — or on silence, so a caller can say why where it asked.
	 */
	async remove(id: number, branchId: number | null): Promise<void> {
		await awaitReply({
			socket: this.#socket,
			event: "narrativeGraph:deleteRelationship",
			params: {
				id,
				branchId
			} satisfies Sockets.NarrativeGraph.DeleteRelationship.Params,
			errorEvent: "narrativeGraph:deleteRelationship:error",
			match: (msg) => msg.id === id,
			fallbackError: "The link could not be deleted."
		})
	}

	/**
	 * The vectorization queue wrote a row's `embeddingModel` straight to the
	 * table; without this the badge only refreshes on the next explicit write.
	 */
	embedded(msg: Sockets.Vectorization.ItemUpdated.Response): void {
		if (msg.lorebookId !== untrack(() => this.lorebookId)) return
		if (msg.type === "narrativeNode")
			this.nodes = this.nodes.map((n) =>
				n.id === msg.id ? { ...n, embeddingModel: msg.embeddingModel } : n
			)
		else if (msg.type === "narrativeRelationship") {
			const row = this.#rows.get(msg.id)
			if (row)
				this.#rows.set(msg.id, {
					...row,
					embeddingModel: msg.embeddingModel
				})
		}
	}

	// Arrow fields, so each release names the very function it declared.

	#onList = (msg: Sockets.NarrativeGraph.List.Response) => {
		// The scope the gate reads; checked here too, so a stale book's reply
		// arriving after a switch cannot paint this one.
		if (msg.lorebookId !== this.lorebookId) return
		this.#rows.clear()
		for (const rel of msg.relationships) this.#rows.set(rel.id, rel)
		this.nodes = msg.nodes
		this.counts =
			msg.relationshipCounts ?? linkCountsOf(msg.relationships)
		this.#pending = false
		this.#clearTimer()
		this.error = null
		this.loaded = true
		for (const hooks of [...this.#hooks]) hooks.listed?.(msg)
	}

	#onListError = (msg: Sockets.ErrorResponse) => {
		if (!this.#pending) return
		this.#pending = false
		this.#clearTimer()
		this.error = msg?.error || "The graph could not be read."
	}

	#onCreate = (msg: Sockets.NarrativeGraph.CreateRelationship.Response) => {
		const rel = msg.relationship
		if (rel.lorebookId !== this.lorebookId || this.#rows.has(rel.id)) return
		this.#rows.set(rel.id, rel)
		this.counts = bumpLinkCounts(this.counts, rel, 1)
		for (const hooks of [...this.#hooks]) hooks.created?.(rel)
	}

	#onUpdate = (msg: Sockets.NarrativeGraph.UpdateRelationship.Response) => {
		const rel = msg.relationship
		if (rel.lorebookId !== this.lorebookId) return
		// An update can move an end (a cast member's link turned onto a
		// place), which moves it in or out of what a Rebuild deletes.
		const was = this.#rows.get(rel.id)
		this.#rows.set(rel.id, rel)
		this.counts = bumpLinkCounts(
			was ? bumpLinkCounts(this.counts, was, -1) : this.counts,
			rel,
			1
		)
	}

	#onDelete = (msg: Sockets.NarrativeGraph.DeleteRelationship.Response) => {
		if (msg.lorebookId !== this.lorebookId) return
		const gone = this.#rows.get(msg.id)
		if (!gone) return
		this.#rows.delete(msg.id)
		this.counts = bumpLinkCounts(this.counts, gone, -1)
		for (const hooks of [...this.#hooks]) hooks.deleted?.(gone)
	}

	#clearTimer() {
		if (this.#timer !== null) {
			clearTimeout(this.#timer)
			this.#timer = null
		}
	}
}

const KEY = Symbol("bookRelationships")

/** Provide the workspace's store to everything under it. Call during init. */
export function setBookRelationships(store: BookRelationships): void {
	setContext(KEY, store)
}

/**
 * The workspace's store. Call during init, from under `LorebooksWorkspace` —
 * the one place that creates it.
 */
export function getBookRelationships(): BookRelationships {
	const store = getContext<BookRelationships | undefined>(KEY)
	if (!store)
		throw new Error(
			"No relationship store: this surface is mounted outside LorebooksWorkspace."
		)
	return store
}
