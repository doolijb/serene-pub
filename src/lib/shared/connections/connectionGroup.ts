/**
 * The **connection group** (NOMENCLATURE §10) — which half of the world a
 * connection lives in: **On this machine** (_private · free_) or **Services**
 * (_billed per message_).
 *
 * The connections index files a row under a header by it, and the New
 * connection picker reads the same `category`. ⚠ **It is a label, never a
 * gate on what a connection is used for.** For one day (2026-09-29) the reply
 * pipeline's Search by meaning read it too, and *Automatic* skipped an
 * embedding service; the owner, 2026-09-30: *"I never said to skip paid
 * services for retrieval, that's what they are there for. Don't do that."* No
 * pipeline reads it now, and none should: a person who set up a service set
 * it up to be used.
 *
 * Client-safe: no Node imports, no Svelte.
 */
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { isKoboldCppManagedType } from "$lib/shared/utils/connectionServiceItems"

/**
 * What KIND of endpoint a row belongs to, for the one branch the index really
 * has: a row's shape, and what it can be asked to do. ⚠ Not its group — that
 * is the type's `category` (`connectionGroupOf`, below); `api` is every type
 * with no row shape of its own, local or not.
 *
 * Five values and no sixth: they are the four cases with their own status
 * line, header badge and row action, plus everything else. ⚠ Not a modality —
 * a modality says what a model is FOR (§10), and two of these share one
 * (`local-onnx` and `ollama-embeddings` are both `embeddings`) while one
 * endpoint of kind `koboldcpp-managed` serves three.
 */
export type EndpointKind =
	| "koboldcpp-managed"
	| "ollama"
	| "onnx-embeddings"
	| "onnx-entities"
	| "api"

export function endpointKind(type: string | null | undefined): EndpointKind {
	if (isKoboldCppManagedType(type ?? "")) return "koboldcpp-managed"
	if (
		type === CONNECTION_TYPE.OLLAMA ||
		type === CONNECTION_TYPE.OLLAMA_EMBEDDINGS
	)
		return "ollama"
	if (type === CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS) return "onnx-embeddings"
	if (type === CONNECTION_TYPE.LOCAL_ONNX_NER) return "onnx-entities"
	return "api"
}

/** Which half of the list a row falls in. */
export type ConnectionGroupId = "local" | "service"

/**
 * The connection group of a connection TYPE: **the type's own `category`**
 * (`CONNECTION_TYPE.options`) — `local` for anything that talks to a process
 * on this machine or this network, `cloud` for a hosted API.
 *
 * ⚠ **One classification, not two — and never the endpoint kind above.** Its
 * five values exist for the index's row shapes, not for where a row runs:
 * every type without a row shape of its own is `api`, so grouping by kind
 * files a KoboldCPP, LM Studio or llama.cpp you run yourself under
 * **Services** (_billed per message_) while the New connection picker, reading
 * `category`, calls the same type **Local** (review 2026-09-29).
 *
 * ⚠ The TYPE is the claim, not the hostname: an Ollama on the box downstairs is
 * still `local`, and an OpenAI-compatible connection is a service even when it
 * points at your own LM Studio — its type is the one OpenAI itself uses, and
 * nothing about the row says otherwise. A type nobody declared (none at all, or
 * an out-of-tree one) is a service: being local is a claim, never a default.
 */
export function connectionGroupOf(
	type: string | null | undefined
): ConnectionGroupId {
	const category = CONNECTION_TYPE.options.find(
		(o) => o.value === type
	)?.category
	return category === "local" ? "local" : "service"
}
