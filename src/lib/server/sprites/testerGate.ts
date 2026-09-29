/**
 * What the Sprites tab's test box should do when it wants to embed a line.
 *
 * The policy, on its own, because it is a **policy** and it was wrong: the box
 * asked `getLoadedModelId()` — is a model resident *right now* — and refused
 * when the answer was no, telling the person to "load one in Connections"
 * when they had already set one up.
 *
 * ⚠ **Enabled is not resident.** Nothing loads the embedding model at boot
 * (`loadSockets.server.ts` says so in as many words: the vectorization queue
 * "only loads it once it actually finds something to embed"), and the lane
 * unloads again on a TTL. So on a machine with an embedding model configured
 * and nothing pending to vectorize, *no model is resident* is the ordinary
 * state, not a fault — and pressing **Test** is the request to bring one up.
 *
 * ⚠ The one case that still refuses is a **cold local** model: a first load
 * fetches several hundred megabytes and the test box has no progress bar to
 * show for it, so it would sit there for minutes looking hung. That download
 * belongs on the screen that can show it moving.
 *
 * Pure: no database, no imports from the embedding lane. The handler gathers
 * the three facts and this decides between them.
 */

/** Only what the decision needs — not the whole `EmbeddingTarget`. */
export interface TesterTargetFacts {
	mode: "local" | "api"
	/** The repo, on a local target. */
	localModelName?: string
}

export type TesterGate =
	/** Something is resident. Embed with it. */
	| { kind: "ready" }
	/** Nothing resident but a target is configured and cheap to bring up. */
	| { kind: "load" }
	/** Say why, in words the person can act on. */
	| { kind: "refuse"; reason: string }

export function testerGate(facts: {
	/** `getLoadedModelId()` — resident identity, local or API. */
	loadedModelId: string | null
	/** `getConfiguredEmbeddingTarget()`, or null when nothing is set up. */
	target: TesterTargetFacts | null
	/**
	 * Whether a LOCAL target's weights are already on disk.
	 *
	 * `null` means the question does not apply (no target, an API target, or
	 * a resident model made it moot) — never "unknown", because a caller that
	 * cannot answer it must not be allowed to start a silent download.
	 */
	localCached: boolean | null
}): TesterGate {
	if (facts.loadedModelId) return { kind: "ready" }

	if (!facts.target)
		return {
			kind: "refuse",
			reason: "No embedding model is set up yet. Choose one under Connections and sprites can be picked by what a line says."
		}

	if (facts.target.mode === "local" && facts.target.localModelName) {
		// ⚠ `!== true`, so an unanswered `null` refuses rather than downloading.
		if (facts.localCached !== true)
			return {
				kind: "refuse",
				reason: `${facts.target.localModelName} has not been downloaded yet. Fetch it under Connections — it is a few hundred megabytes — then test again.`
			}
	}

	return { kind: "load" }
}

/** After a load that was asked for and still produced nothing resident. */
export const LOAD_FAILED_REASON =
	"The embedding model is set up but would not load. Connections will say why."
