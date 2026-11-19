/**
 * 🚧 Who knows which entry, as the open book holds it — ONE copy.
 *
 * This store is the one listener for `entryKnowledge:*`: it owns the book's
 * not-common-knowledge marks, the rows of the entry the inspector is open on
 * (the Known by tab), the rows of the cast member the cast page is open on (the
 * Knows tab), and the two writes. The entry workspace and the cast workspace
 * each create it and provide it by context; they are never mounted together,
 * so there is one listener either way. The pool's bulk bar and the two tabs
 * find it there.
 *
 * ⚠ It never toasts and holds no copy but the fallback sentences below: a
 * refusal rejects the write with the server's sentence, and the surface that
 * asked says it in place.
 * ⚠ Every listener comes off through its registry release, never a bare
 * `socket.off(event)`.
 */

import { getContext, setContext, untrack } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import { declareInterest } from "$lib/client/sockets/interest.svelte"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { interestKey } from "$lib/shared/sockets/interest"
import { refusalFor } from "../places/placeStatsApi"

export type KnowledgeRow = Sockets.EntryKnowledge.Row

/** The line and moment the rows are judged at (the route's). */
export interface KnowledgeReading {
	branchId: number | null
	moment: Sockets.EntryKnowledge.Moment | null
}

export interface KnowledgeApi {
	list(
		p: Omit<Sockets.EntryKnowledge.List.Params, "requestId">
	): Promise<Sockets.EntryKnowledge.List.Response>
	setCommonKnowledge(
		p: Omit<Sockets.EntryKnowledge.SetCommonKnowledge.Params, "requestId">
	): Promise<Sockets.EntryKnowledge.SetCommonKnowledge.Response>
	setTie(
		p: Omit<Sockets.EntryKnowledge.SetTie.Params, "requestId">
	): Promise<Sockets.EntryKnowledge.SetTie.Response>
}

let sent = 0
/** This tab's own id for one call: a reply reaches every tab of the user, and each settles its own. */
const nextRequestId = () =>
	`entry-knowledge-${Date.now().toString(36)}-${++sent}`

export function socketKnowledgeApi(
	socket: Pick<TypedSocket, "emit">
): KnowledgeApi {
	return {
		list(params) {
			const requestId = nextRequestId()
			return awaitReply({
				socket,
				event: "entryKnowledge:list",
				params: { ...params, requestId },
				replyKey: interestKey("entryKnowledge:list", params.lorebookId),
				errorEvent: "entryKnowledge:list:error",
				match: (res) => res.requestId === requestId,
				matchError: refusalFor(requestId),
				fallbackError: "Who knows this entry could not be read."
			})
		},
		setCommonKnowledge(params) {
			const requestId = nextRequestId()
			return awaitReply({
				socket,
				event: "entryKnowledge:setCommonKnowledge",
				params: { ...params, requestId },
				replyKey: interestKey(
					"entryKnowledge:setCommonKnowledge",
					params.lorebookId
				),
				errorEvent: "entryKnowledge:setCommonKnowledge:error",
				match: (res) => res.requestId === requestId,
				matchError: refusalFor(requestId),
				fallbackError: "The entries could not be marked."
			})
		},
		setTie(params) {
			const requestId = nextRequestId()
			return awaitReply({
				socket,
				event: "entryKnowledge:setTie",
				params: { ...params, requestId },
				replyKey: interestKey(
					"entryKnowledge:setTie",
					params.lorebookId
				),
				errorEvent: "entryKnowledge:setTie:error",
				match: (res) => res.requestId === requestId,
				matchError: refusalFor(requestId),
				fallbackError: "Who knows this entry could not be saved."
			})
		}
	}
}

type Moment = Sockets.EntryKnowledge.Moment | null

const sameMoment = (a: Moment, b: Moment): boolean =>
	a === b ||
	(!!a &&
		!!b &&
		a.year === b.year &&
		(a.month ?? null) === (b.month ?? null) &&
		(a.day ?? null) === (b.day ?? null))

const sameReading = (a: KnowledgeReading, b: KnowledgeReading): boolean =>
	a.branchId === b.branchId && sameMoment(a.moment, b.moment)

export class BookKnowledge {
	#lorebookId = $state<number | null>(null)
	#loaded = $state(false)
	#entryId = $state<number | null>(null)
	#rows = $state.raw<KnowledgeRow[]>([])
	#rowsLoaded = $state(false)
	#rowsError = $state<string | null>(null)
	#memberId = $state<number | null>(null)
	#memberRows = $state.raw<KnowledgeRow[]>([])
	#memberRowsLoaded = $state(false)
	#memberRowsError = $state<string | null>(null)
	#marked = new SvelteSet<number>()

	#api: KnowledgeApi
	#reading: KnowledgeReading = { branchId: null, moment: null }
	/** Each read takes the next number; an answer for an earlier one is dropped. */
	#rowsSeq = 0
	#marksSeq = 0
	#memberSeq = 0

	constructor(api: KnowledgeApi) {
		this.#api = api
	}

	get lorebookId(): number | null {
		return this.#lorebookId
	}
	/** The book's marks have been read. */
	get loaded(): boolean {
		return this.#loaded
	}
	get entryId(): number | null {
		return this.#entryId
	}
	get rows(): KnowledgeRow[] {
		return this.#rows
	}
	get rowsLoaded(): boolean {
		return this.#rowsLoaded
	}
	get rowsError(): string | null {
		return this.#rowsError
	}
	get memberId(): number | null {
		return this.#memberId
	}
	/** The shown member's rows: every marked entry and every entry it is tied to. */
	get memberRows(): KnowledgeRow[] {
		return this.#memberRows
	}
	get memberRowsLoaded(): boolean {
		return this.#memberRowsLoaded
	}
	get memberRowsError(): string | null {
		return this.#memberRowsError
	}

	isMarked(entryId: number): boolean {
		return this.#marked.has(entryId)
	}

	/**
	 * Turn to one book: read its marks, hear the two write replies (another
	 * tab's writes). Returns the release.
	 *
	 * ⚠ Untracked: called from an effect, and a read here would make that
	 * effect re-run on the very state this writes.
	 */
	open(lorebookId: number): () => void {
		return untrack(() => {
			if (lorebookId !== this.#lorebookId) {
				this.#lorebookId = lorebookId
				this.#marked.clear()
				this.#loaded = false
				this.#marksSeq++
				this.#rowsSeq++
				this.#rows = []
				this.#rowsLoaded = false
				this.#rowsError = null
				this.#lastAsked = null
				this.#memberSeq++
				this.#memberRows = []
				this.#memberRowsLoaded = false
				this.#memberRowsError = null
				this.#memberLastAsked = null
			}
			void this.#readMarks(lorebookId)
			if (this.#entryId !== null) void this.#readRows()
			if (this.#memberId !== null) void this.#readMemberRows()
			const releases = [
				declareInterest<"entryKnowledge:setCommonKnowledge">(
					interestKey(
						"entryKnowledge:setCommonKnowledge",
						lorebookId
					),
					this.#onMarks
				),
				declareInterest<"entryKnowledge:setTie">(
					interestKey("entryKnowledge:setTie", lorebookId),
					this.#onTie
				)
			]
			return () => {
				for (const release of releases) release()
			}
		})
	}

	/** The reading the last rows read was asked at, so the same ask is not repeated. */
	#lastAsked: { entryId: number; reading: KnowledgeReading } | null = null

	/**
	 * Read the rows of one entry at a reading; null clears. A later call wins
	 * over an earlier answer. Untracked.
	 */
	showEntry(entryId: number | null, reading: KnowledgeReading): void {
		untrack(() => {
			if (
				entryId !== null &&
				entryId === this.#entryId &&
				this.#rowsError === null &&
				this.#lastAsked &&
				sameReading(this.#lastAsked.reading, reading)
			)
				return
			this.#rowsSeq++
			this.#entryId = entryId
			this.#reading = reading
			this.#rows = []
			this.#rowsLoaded = false
			this.#rowsError = null
			this.#lastAsked = null
			if (entryId !== null) void this.#readRows()
		})
	}

	/** The member and reading the last member read was asked at. */
	#memberLastAsked: {
		memberId: number
		reading: KnowledgeReading
	} | null = null

	/**
	 * Read the rows of one cast member at a reading; null clears. A later call
	 * wins over an earlier answer. Untracked.
	 */
	showMember(castMemberId: number | null, reading: KnowledgeReading): void {
		untrack(() => {
			if (
				castMemberId !== null &&
				castMemberId === this.#memberId &&
				this.#memberRowsError === null &&
				this.#memberLastAsked &&
				sameReading(this.#memberLastAsked.reading, reading)
			)
				return
			this.#memberSeq++
			this.#memberId = castMemberId
			this.#reading = reading
			this.#memberRows = []
			this.#memberRowsLoaded = false
			this.#memberRowsError = null
			this.#memberLastAsked = null
			if (castMemberId !== null) void this.#readMemberRows()
		})
	}

	async #readMemberRows(): Promise<void> {
		const lorebookId = this.#lorebookId
		const memberId = this.#memberId
		if (lorebookId === null || memberId === null) return
		const reading = this.#reading
		const seq = ++this.#memberSeq
		this.#memberLastAsked = { memberId, reading }
		this.#memberRowsError = null
		try {
			const res = await this.#api.list({
				lorebookId,
				castMemberId: memberId,
				branchId: reading.branchId,
				moment: reading.moment
			})
			if (seq !== this.#memberSeq) return
			this.#memberRows = res.rows
			this.#memberRowsLoaded = true
			this.#setMarks(res.markedEntryIds)
			this.#loaded = true
		} catch (err) {
			if (seq !== this.#memberSeq) return
			this.#memberRowsError =
				err instanceof Error && err.message
					? err.message
					: "What this member knows could not be read."
		}
	}

	async #readMarks(lorebookId: number): Promise<void> {
		const seq = ++this.#marksSeq
		try {
			const res = await this.#api.list({
				lorebookId,
				branchId: null,
				moment: null
			})
			if (seq !== this.#marksSeq || lorebookId !== this.#lorebookId)
				return
			this.#setMarks(res.markedEntryIds)
			this.#loaded = true
		} catch {
			// The marks stay unread; a write's reply carries them whole.
		}
	}

	async #readRows(): Promise<void> {
		const lorebookId = this.#lorebookId
		const entryId = this.#entryId
		if (lorebookId === null || entryId === null) return
		const reading = this.#reading
		const seq = ++this.#rowsSeq
		this.#lastAsked = { entryId, reading }
		this.#rowsError = null
		try {
			const res = await this.#api.list({
				lorebookId,
				entryId,
				branchId: reading.branchId,
				moment: reading.moment
			})
			if (seq !== this.#rowsSeq) return
			this.#rows = res.rows
			this.#rowsLoaded = true
			this.#setMarks(res.markedEntryIds)
			this.#loaded = true
		} catch (err) {
			if (seq !== this.#rowsSeq) return
			this.#rowsError =
				err instanceof Error && err.message
					? err.message
					: "Who knows this entry could not be read."
		}
	}

	#setMarks(ids: number[]): void {
		const next = new Set(ids)
		for (const id of [...this.#marked])
			if (!next.has(id)) this.#marked.delete(id)
		for (const id of next) this.#marked.add(id)
	}

	#onMarks = (res: Sockets.EntryKnowledge.SetCommonKnowledge.Response) => {
		if (res.lorebookId !== this.#lorebookId) return
		this.#applyMarks(res)
	}

	#applyMarks(res: Sockets.EntryKnowledge.SetCommonKnowledge.Response): void {
		this.#setMarks(res.markedEntryIds)
		this.#loaded = true
		if (this.#entryId !== null && res.entryIds.includes(this.#entryId))
			void this.#readRows()
		if (this.#memberId !== null) void this.#readMemberRows()
	}

	#onTie = (res: Sockets.EntryKnowledge.SetTie.Response) => {
		if (res.lorebookId !== this.#lorebookId) return
		this.#applyTie(res)
	}

	#applyTie(res: Sockets.EntryKnowledge.SetTie.Response): void {
		const same = sameReading(res, this.#reading)
		if (res.entryId === this.#entryId) {
			if (!same) void this.#readRows()
			else {
				const at = this.#rows.findIndex(
					(r) => r.castMemberId === res.castMemberId
				)
				this.#rows =
					at === -1
						? [...this.#rows, res.row]
						: this.#rows.map((r, i) => (i === at ? res.row : r))
			}
		}
		if (res.castMemberId === this.#memberId) {
			if (!same) void this.#readMemberRows()
			else {
				const at = this.#memberRows.findIndex(
					(r) => r.entryId === res.entryId
				)
				this.#memberRows =
					at === -1
						? [...this.#memberRows, res.row]
						: this.#memberRows.map((r, i) =>
								i === at ? res.row : r
							)
			}
		}
	}

	/**
	 * One request for many entries; the marks follow the reply. Rejects with
	 * the server's sentence.
	 */
	async setMark(
		entryIds: number[],
		notCommonKnowledge: boolean
	): Promise<Sockets.EntryKnowledge.SetCommonKnowledge.Response> {
		const lorebookId = this.#lorebookId
		if (lorebookId === null)
			throw new Error("The entries could not be marked.")
		const res = await this.#api.setCommonKnowledge({
			lorebookId,
			entryIds,
			notCommonKnowledge
		})
		if (res.lorebookId === this.#lorebookId) this.#applyMarks(res)
		return res
	}

	/**
	 * Sets the hand switch; the open entry's row and the shown member's row
	 * follow the reply. Rejects
	 * with the server's sentence.
	 */
	async setTie(
		castMemberId: number,
		entryId: number,
		hand: Sockets.EntryKnowledge.Hand | null
	): Promise<Sockets.EntryKnowledge.SetTie.Response> {
		const lorebookId = this.#lorebookId
		if (lorebookId === null)
			throw new Error("Who knows this entry could not be saved.")
		const reading = untrack(() => this.#reading)
		const res = await this.#api.setTie({
			lorebookId,
			castMemberId,
			entryId,
			hand,
			branchId: reading.branchId,
			moment: reading.moment
		})
		if (res.lorebookId === this.#lorebookId) this.#applyTie(res)
		return res
	}
}

const KEY = Symbol("bookKnowledge")

export function setBookKnowledge(k: BookKnowledge): void {
	setContext(KEY, k)
}

/** Undefined when not provided (tests, other mounts). */
export function getBookKnowledge(): BookKnowledge | undefined {
	return getContext<BookKnowledge | undefined>(KEY)
}
