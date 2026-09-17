/**
 * What the attached session's newest run did, held once for the whole editor.
 *
 * The marks on the rows say *which* of three states an entry is in; the Read in
 * line says the arithmetic behind one of them — its rank, what matched, what it
 * cost. Both are about the same run, so the run is read once here rather than
 * once per open entry: `entries:recentDecisions` names the run that last ranked
 * anything, and `pipelines:runExplain` is that run's own account of it.
 *
 * ⚠ **Asked once per book-and-session pair.** An editor opening is not a new
 * question about the same turn, and a read per selected row would put two round
 * trips behind every click in the list.
 */

import { declareInterest } from "$lib/client/sockets/interest.svelte"
import { interestKey } from "$lib/shared/sockets/interest"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import { readInFacts, type RunFacts } from "./readIn"

type Explanation = NonNullable<
	Sockets.Pipelines.RunExplain.Response["explanation"]
>

const NO_FACTS: RunFacts = {}

class RetrievalReadout {
	#socket: TypedSocket | null = null
	/** How many editors are mounted on it; the last one out detaches. */
	#users = 0
	/** The pair the state below is about. */
	#lorebookId: number | null = null
	#sessionId: number | null = null
	#runId: string | null = null
	#explanation = $state<Explanation | null>(null)
	/**
	 * The interest releases held while any editor is mounted — one per declared
	 * key, dropped together by the last `close`.
	 *
	 * A plain array, not `$state`: nothing renders from it.
	 */
	#releases: Array<() => void> = []
	/**
	 * The `entries:recentDecisions` release, held apart from the others
	 * because its key MOVES: the key names the book being read, and a reader
	 * opening another one has to release the old key as it takes the new.
	 */
	#decisionsRelease: (() => void) | null = null

	#onDecisions = (msg: Sockets.Entries.RecentDecisions.Response) => {
		if (
			msg.lorebookId !== this.#lorebookId ||
			msg.sessionId !== this.#sessionId
		)
			return
		if (!msg.runId) {
			this.#runId = null
			this.#explanation = null
			return
		}
		if (msg.runId === this.#runId) return
		this.#runId = msg.runId
		this.#explanation = null
		this.#socket?.emit("pipelines:runExplain", { runId: msg.runId })
	}

	#onExplain = (msg: Sockets.Pipelines.RunExplain.Response) => {
		if (!msg.runId || msg.runId !== this.#runId) return
		this.#explanation = msg.explanation ?? null
	}

	/** A refusal stops the wait; the line then says what the decision says. */
	#onExplainError = () => {
		this.#explanation = null
	}

	/**
	 * Declares (or re-declares) interest in the decisions of the book named by
	 * `#lorebookId`, releasing whatever key was held before.
	 *
	 * SCOPED, because `entries:recentDecisions` carries `lorebookId` and two
	 * workspaces can be open on two books; `#onDecisions` still checks the
	 * pair itself, since the session half of it is not part of the key.
	 * Nothing is held while no editor is mounted, or before a book is named.
	 */
	#declareDecisions(): void {
		this.#decisionsRelease?.()
		this.#decisionsRelease = null
		if (this.#users === 0 || this.#lorebookId === null) return
		this.#decisionsRelease = declareInterest<"entries:recentDecisions">(
			interestKey("entries:recentDecisions", this.#lorebookId),
			this.#onDecisions
		)
	}

	/**
	 * Call from `onMount`, with the socket the workspace already holds.
	 *
	 * The run's account is declared on the interest registry — BARE, since
	 * `pipelines:runExplain` has no entry in `SCOPED_EVENTS` and `#onExplain`
	 * filters on the run id it asked about. The refcount is what decides the
	 * declare: one editor's worth of interest, however many are mounted on it.
	 */
	open(socket: TypedSocket): void {
		this.#socket = socket
		if (this.#users++ > 0) return
		this.#declareDecisions()
		this.#releases = [
			declareInterest<"pipelines:runExplain">(
				"pipelines:runExplain",
				this.#onExplain
			),
			// Never gated (plan ruling 2 — an error is not an output to skip),
			// but the registry is the only listener path.
			declareInterest<"pipelines:runExplain:error">(
				"pipelines:runExplain:error",
				this.#onExplainError
			)
		]
	}

	/** Call from `onDestroy`. */
	close(_socket: TypedSocket): void {
		if (--this.#users > 0) return
		this.#users = 0
		this.#decisionsRelease?.()
		this.#decisionsRelease = null
		for (const release of this.#releases) release()
		this.#releases = []
		this.#socket = null
		this.#lorebookId = null
		this.#sessionId = null
		this.#runId = null
		this.#explanation = null
	}

	/** Name the pair being read. A pair already asked about is not re-asked. */
	ask(lorebookId: number | null, sessionId: number | null): void {
		if (lorebookId === this.#lorebookId && sessionId === this.#sessionId)
			return
		this.#lorebookId = lorebookId
		this.#sessionId = sessionId
		this.#runId = null
		this.#explanation = null
		// Before the emit, never after: the request flushes the interest sync
		// that declares the key its own reply needs.
		this.#declareDecisions()
		if (lorebookId === null || sessionId === null) return
		this.#socket?.emit("entries:recentDecisions", {
			lorebookId,
			sessionId
		} satisfies Sockets.Entries.RecentDecisions.Params)
	}

	/**
	 * One entry's figures out of that run, or none.
	 *
	 * The pair is named again by the caller rather than assumed: two workspaces
	 * can be open on two books, and figures from the other one's run would be
	 * the line asserting something about a turn this book was not in.
	 */
	factsFor(
		lorebookId: number | null,
		sessionId: number | null,
		entryId: number
	): RunFacts {
		if (
			!this.#explanation ||
			lorebookId !== this.#lorebookId ||
			sessionId !== this.#sessionId
		)
			return NO_FACTS
		return readInFacts(entryId, this.#explanation)
	}
}

export const retrievalReadout = new RetrievalReadout()
