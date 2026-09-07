/**
 * Connections are the administrator's, and to everyone else they do not exist.
 *
 * > "Connections must be invisible, unmuteable and unchooseable to non-admins"
 *
 * Three words, and the first one is the load-bearing one. `sockets/connections.ts`
 * has guarded every WRITE since it was written, and `config/panel/scopes.ts`
 * refuses a non-admin's connection edit in a sentence — and a non-admin could
 * still redirect a run onto any connection on the instance, because a
 * *read*-shaped surface (the pipeline review card) handed them the connection
 * blob and folded their edit of it straight back into the node's input. The
 * write path was guarded. The leak was a read.
 *
 * ⚠ "The write path was guarded" is true of `sockets/connections.ts` and of
 * nowhere else. The 0.6 audit found two writes outside it that took a
 * `connectionId` from the client with no check at all: `sessions:create` and
 * `sessions:update` (and `sessions.connection_id` is the HIGHEST-precedence
 * tier in `resolveCapabilityTarget`), plus `images:generate`, which rendered on
 * whatever id it was handed. Guarding the table is not guarding the choice.
 *
 * So this module does not add a guard. It **removes the field**, everywhere, for
 * anyone who is not an administrator:
 *
 *   - a value never received cannot be edited back,
 *   - a name never shown cannot identify anyone's compute,
 *   - an id never learned cannot be guessed at — and where one is guessed
 *     anyway, `refuseConnectionChoice` answers the same sentence whether or not
 *     it names a real row.
 *
 * ## Why a projection rather than N guards
 *
 * Because the review card is what a guard-per-surface looks like after one new
 * surface. The rule is written once, here, and applied at the places payloads
 * LEAVE the server (`sockets/index.ts`'s `emitToUser`, the review gate's push).
 * A handler added next release inherits it without knowing it exists — the same
 * reasoning `sockets/index.ts` already applies to the setup gate and the legacy
 * archive: "a handler added later cannot forget a gate it never had to know
 * about".
 *
 * ## Free text, and why it is here after all
 *
 * `"KoboldCPP API error at http://…: model 'x' not loaded"` names a connection
 * as surely as a field does, and no key-shaped rule will ever see it — the name
 * is a substring there, not a key. The answer is deliberately NOT a second,
 * text-shaped rule beside this one: a redactor that went hunting for names in
 * prose would need every name on the instance, would still miss the base URL and
 * the model path, and would leave two rules to disagree with each other.
 *
 * The answer is to stop putting identity in the sentence. A refusal or a failure
 * says its piece without naming anybody, and the identity travels BESIDE it
 * under the key `connection` — the first entry in the list below, removed at
 * every egress since this module existed. One rule, one place; what changed is
 * the shape of the thing it is applied to. `ConnectionIdentity` and
 * `ComposedError` below are that shape.
 *
 * ## Deliberately not here
 *
 * `vectorization:checkRagStatus`'s `activeModelName`. The same field holds a
 * plain LOCAL model name when embeddings are local, so blanking it would hide
 * information that is nobody's connection. It needs the storage key split from
 * the display name, which is a change to how embeddings are addressed rather
 * than a change to this rule.
 */

import type { ConnectionIdentity } from "$lib/shared/connections/identity"

/**
 * The keys that ARE connection identity, wherever they appear.
 *
 * Names rather than paths, because the same fact is spelled at a dozen depths:
 * `connection` is a resolved slot inside a node's receipt input, an echoed test
 * payload, and a review form field; `connectionId` is a session column, a
 * capability default, and a progress event's subject. A path list would have to
 * be extended by whoever adds the thirteenth, which is the failure mode this
 * whole module exists to remove.
 *
 * ⚠ Every name here must mean an LLM/image connection in EVERY payload the
 * server sends. Adding a name that means something else somewhere would silently
 * delete that field for every non-admin. `connections` is on the list because
 * `connections:list` is the inventory itself; nothing else in the wire types
 * spells a websocket or a database pool this way.
 */
export const CONNECTION_IDENTITY_KEYS: ReadonlySet<string> = new Set([
	"connection",
	"connections",
	"connectionId",
	"connectionName",
	"connectionScripts",
	"activeConnection",
	// `system_settings.active_embedding_connection_id`, an FK to
	// `connections.id` that rides along on `systemSettings:get` — an event
	// with no role gate at all — because that handler sends the whole row.
	// Nothing client-side has ever read it.
	"activeEmbeddingConnectionId"
])

/**
 * Connection identity as a VALUE, for the failures that would otherwise spell it
 * into a sentence.
 *
 * The shape itself lives in `$lib/shared/connections/identity` because it
 * travels on the wire and a client renders it; re-exported here so the one place
 * that reads as "the connection rule" is still the one place to read. It is
 * carried under the key `connection`, so the projection above removes the whole
 * bag in one go and a field added to it inherits that without a second thought.
 */
export type { ConnectionIdentity }

/**
 * Everything about a connection row that must not reach a non-admin.
 *
 * Takes a row rather than the pieces: a caller assembling the bag by hand is a
 * caller who can forget the field that was added last release, and forgetting
 * here is silent.
 */
export const connectionIdentity = (
	connection: {
		id?: number | null
		name?: string | null
		model?: string | null
		type?: string | null
	},
	detail?: string
): ConnectionIdentity => ({
	id: connection.id ?? null,
	name: connection.name ?? null,
	model: connection.model ?? null,
	type: connection.type ?? null,
	...(detail ? { detail } : {})
})

/**
 * The one sentence, used at every refusal.
 *
 * One string rather than one per site, because the point of a refusal that does
 * not disclose is that it reads the SAME for an id that exists, an id that never
 * existed, and an id that exists but cannot do the job. A caller that reached
 * for a lookup first to say something more helpful would have written an
 * enumeration oracle.
 *
 * The first sentence is `config/panel/scopes.ts`'s, verbatim: a person who meets
 * this rule in two places should not be told it is two rules.
 */
export const CONNECTION_REFUSAL =
	"Connections stay with the administrator, so credentials and compute " +
	"stay under their control. Nothing was changed."

/**
 * An error whose sentence THIS CODEBASE wrote.
 *
 * The distinction matters at exactly one moment: when a failure is about to be
 * STORED on a message row and re-served on every reload thereafter. A sentence
 * we composed names no connection — that is a property of every string in
 * `capabilityGuard`, `capabilityTarget` and the three dispatchers, and the tests
 * beside them hold it. A sentence that came back from a service names the base
 * URL, the model file, and whatever else that endpoint felt like including.
 *
 * There is no way to tell those apart by looking at them, so they are told apart
 * by TYPE. `persistGenerationErrorRow` shows a `ComposedError`'s words to
 * everyone and replaces anything else's.
 *
 * ⚠ Unmarked is UNSAFE, and that is the point. A failure path added next release
 * that throws a plain `Error` degrades to the generic sentence with the detail
 * kept for administrators — a worse message, never a leak. Reversing the default
 * would make forgetting silent, which is the failure mode this whole module
 * exists to remove.
 *
 * `connection` is the identity the failure was about, for the administrator who
 * has to fix it. It is a field, so the projection strips it; the message is a
 * string, so nothing has to.
 */
export class ComposedError extends Error {
	readonly connection?: ConnectionIdentity

	// `message?` rather than `message`, to match `Error` exactly: one caller
	// forwards a `string | undefined` reason, and `friendlyErrorFromUnknown`
	// already answers an empty one with its own fallback sentence.
	constructor(message?: string, connection?: ConnectionIdentity) {
		super(message)
		// Deliberately not touching `name`: `friendlyErrorFromUnknown` falls back
		// to it for the code shown beside a failed message, so stamping the
		// subclass name here would change what every existing dispatch failure
		// displays for no gain.
		if (connection) this.connection = connection
	}
}

/** A non-admin tried to choose, name or change a connection. */
export class ConnectionChoiceRefused extends ComposedError {
	constructor(message: string = CONNECTION_REFUSAL) {
		super(message)
		this.name = "ConnectionChoiceRefused"
	}
}

/** The half of `socket.user` this module reads. */
export interface ConnectionSubject {
	isAdmin?: boolean | null
}

/**
 * May this subject see connections at all?
 *
 * Admin, and nothing else — deliberately not "owns the session" or "started the
 * run". A session owner is not an administrator in 0.6. `broadcastHelpers.ts`
 * used to hold a helper that said otherwise — it fed the session owner the raw
 * service error as being about "their own connection/credentials" — and it is
 * gone rather than unused, because that sentence stopped being true when
 * accounts arrived and a helper shaped around it is a trap.
 *
 * An absent/undefined `isAdmin` reads as false. The one posture where that would
 * be wrong — accounts disabled — cannot reach it: `sockets/auth.ts` attaches the
 * first ADMIN user as the fallback, so a single-user install is an admin
 * everywhere and sees exactly what it saw before.
 */
export const connectionsVisibleTo = (
	subject: ConnectionSubject | null | undefined
): boolean => !!subject?.isAdmin

/**
 * Strip connection identity out of an arbitrary payload.
 *
 * Structural sharing on purpose: a payload with nothing to remove comes back as
 * the SAME object, so the overwhelmingly common case — every socket emit that
 * has never heard of a connection — costs one walk and no allocation. Only the
 * path down to a removed key is rebuilt.
 *
 * Recurses into plain objects and arrays only. A `Date`, a `Buffer`, a class
 * instance is a value here, not a container: rebuilding one would strip its
 * prototype, and none of them carries a connection.
 */
export function withoutConnectionIdentity<T>(value: T): T {
	return walk(value, new WeakMap(), new Set()) as T
}

/**
 * Redact unless the subject is an administrator.
 *
 * The whole point of the boundary: callers pass the subject, never a decision.
 * `redactConnections(data, socket.user)` is the entire contract.
 */
export function redactConnections<T>(
	value: T,
	subject: ConnectionSubject | null | undefined
): T {
	return connectionsVisibleTo(subject)
		? value
		: withoutConnectionIdentity(value)
}

/**
 * Refuse a connection choice a non-admin made.
 *
 * Throws for callers that unwind (the review gate); callers that answer in an
 * ack read `CONNECTION_REFUSAL` directly. Never consults the database — see the
 * constant's note on why looking first is the bug.
 */
export function refuseConnectionChoice(): never {
	throw new ConnectionChoiceRefused()
}

/**
 * Did a non-admin supply a connection at all?
 *
 * `null`/`undefined` is not a choice, and this distinction is load bearing: a
 * non-admin's client now receives its own session with `connectionId` already
 * stripped, so an ordinary "rename my session" round-trips that field back as
 * null. Refusing THAT would break editing a session for everyone who is not an
 * administrator; applying it would clear the connection an administrator set.
 * Ignoring it is the only reading that is both honest and non-destructive —
 * they changed nothing, because they were shown nothing.
 */
export const isConnectionChoice = (value: unknown): boolean =>
	value !== undefined && value !== null

/**
 * Does this bag of submitted values name a connection at all?
 *
 * For form-shaped submissions (the review card), where PRESENCE is the attempt:
 * a non-admin's form is generated from a schema this module already emptied of
 * connection identity, so the key cannot arrive by accident. Contrast
 * `isConnectionChoice`, which is for a fixed-shape payload whose field is always
 * present and usually null.
 */
export const namesAConnection = (values: unknown): boolean =>
	isPlainObject(values) &&
	Object.keys(values).some((key) => CONNECTION_IDENTITY_KEYS.has(key))

/**
 * Drop a subject's connection columns from a row they are about to write.
 *
 * SHALLOW, unlike `withoutConnectionIdentity`, and the asymmetry is deliberate.
 * Outbound, depth is the whole point — the connection blob that started this
 * sits at `receipt.nodes[].input.connection`, three levels down. Inbound, a
 * session's `metadata` and `drafts` are free-form JSON that belongs to the
 * person writing it, and deleting a key of theirs that happens to be spelled
 * `connection` would be silent data loss to protect a column two levels up.
 * Columns are what resolve to a connection; a user's own JSON is not.
 */
export function withoutConnectionColumns<T extends object>(
	row: T,
	subject: ConnectionSubject | null | undefined
): T {
	if (connectionsVisibleTo(subject)) return row
	const out = { ...row } as Record<string, unknown>
	for (const key of CONNECTION_IDENTITY_KEYS) delete out[key]
	return out as T
}

/**
 * Is this write a connection choice the subject may not make?
 *
 * Shallow, and paired with `isConnectionChoice` rather than mere presence: the
 * writes this guards (`sessions:create`, `sessions:update`) carry a fixed row
 * shape whose `connectionId` is present-and-null on every ordinary edit made by
 * someone whose copy of the row was redacted. Only a real id is an attempt.
 */
export function refusesConnectionWrite(
	patch: unknown,
	subject: ConnectionSubject | null | undefined
): boolean {
	if (connectionsVisibleTo(subject)) return false
	if (!isPlainObject(patch)) return false
	for (const key of CONNECTION_IDENTITY_KEYS)
		if (key in patch && isConnectionChoice(patch[key])) return true
	return false
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
	if (typeof v !== "object" || v === null) return false
	const proto = Object.getPrototypeOf(v)
	return proto === Object.prototype || proto === null
}

function walk(
	value: unknown,
	/** Shared sub-objects are projected once, not once per reference. */
	memo: WeakMap<object, unknown>,
	/**
	 * The current descent. A payload that reaches itself is left alone rather
	 * than recursed forever — socket.io could not serialize it either, so the
	 * honest failure is the one it was already going to have.
	 */
	active: Set<object>
): unknown {
	const isArray = Array.isArray(value)
	if (!isArray && !isPlainObject(value)) return value

	const node = value as object
	if (memo.has(node)) return memo.get(node)
	if (active.has(node)) return value
	active.add(node)

	let changed = false
	let result: unknown

	if (isArray) {
		const out = (value as unknown[]).map((item) => {
			const next = walk(item, memo, active)
			if (next !== item) changed = true
			return next
		})
		result = changed ? out : value
	} else {
		const out: Record<string, unknown> = {}
		for (const [key, item] of Object.entries(
			value as Record<string, unknown>
		)) {
			if (CONNECTION_IDENTITY_KEYS.has(key)) {
				changed = true
				continue
			}
			const next = walk(item, memo, active)
			if (next !== item) changed = true
			out[key] = next
		}
		result = changed ? out : value
	}

	active.delete(node)
	memo.set(node, result)
	return result
}
