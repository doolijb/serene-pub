/**
 * Helpers the host's cases share: the row mappers (`toMessage`,
 * `toLoreEntry`, `toCandidate`), the scope checks (`assertScoped`,
 * `lorebookInScope`), the turn-order pin, the step-type list, ref and JSON
 * readers, media parts, the embedding module (imported once, here) and the
 * vector arithmetic.
 *
 * A leaf beside `host.types.ts`: every `host.*.ts` imports these from here,
 * and this module imports from no host module but `host.types.ts`.
 */

import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { FoldedSectionV1, NodeRef } from "@serene-pub/sdk"
import {
	slotRef,
	isParticipantRef,
	parseParticipantRef,
	checkFoldedSections
} from "@serene-pub/sdk"
import { slotModelId } from "$lib/shared/connections/slotRef"
import { participantRowId } from "$lib/server/pipelines/runtime/portrayals"
import { hostSeatRefOf } from "$lib/server/pipelines/prompt/seatCards"
import { cardsNow } from "$lib/server/cast/seatedCast"
import { storedSeatRef } from "$lib/server/state/seatRefs"
import { memberFormOn } from "$lib/server/state/memberForm"
import { parseSeatRef, seatInPlay, seatOf } from "$lib/server/sessions/seats"
import { ownBookOf } from "$lib/server/lorebooks/ownBook"
import { DEFAULT_CHANNEL, parseChannel } from "$lib/server/messages/channels"
import {
	type HostScope,
	HostScopeError,
	type ChannelShaping
} from "./host.types"

/** One legacy message row — the model the reply path still writes. */
async function legacyMessage(db: Db, id: number) {
	const [row] = await db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, id))
		.limit(1)
	return row
}

/**
 * What follows a reply landing: the row is embedded for retrieval, and the
 * session's backlog is queued. Off the write, because that is where every
 * road converges now — a reply, a narration, a tool loop's answer.
 *
 * Both halves swallow: `autoEnqueueSession` is the fallback that catches a
 * message up through the background queue whether or not the inline embed
 * managed, and a reply that was written and then could not be embedded has
 * still been written.
 */
async function settledMessage(
	messageId: number,
	sessionId: number
): Promise<void> {
	const { autoEnqueueSession, ensureSessionMessageEmbedded } = await import(
		"$lib/server/embedding/vectorizationQueue"
	)
	try {
		await ensureSessionMessageEmbedded(messageId)
	} catch (err) {
		console.error(
			"[vectorization] Inline embed of new message failed:",
			err
		)
	}
	autoEnqueueSession(sessionId).catch(console.error)
}

/**
 * Whose annex a spec reads and writes by default (PLAN-turn-order §4.3):
 * its own **namespace** — the segment before the colon in its slug.
 * `core:spec/<genre>-turn-order` owns `core`; `acme.rp:spec/clock` owns `acme.rp`;
 * a user-authored spec owns `user:<slug>`. A host with no spec named (wired
 * by hand) owns `core`, which is the only owner such a host could mean.
 */
/**
 * Which definition produced the order being written (§4.2's `strategy`).
 *
 * Found by what the nodes are, never by a key (R26, M4): with the session's
 * `turnMode` at `model`, the spec's oracle produced it (the model path's
 * junction fires on exactly that); otherwise the task whose `main` publishes turn entries
 * — `strategy` on the plain line, `decide.rules.strategy` behind a model
 * path, whatever a plugin's spec calls it. Read off the running document,
 * where every rebind is already applied, so a receipt and the run cannot
 * disagree about what ran.
 *
 * Null for a spec with no such node, or a host with no document; nothing
 * else in core writes a turn order, so that is a hand-wired host.
 */
async function turnStrategyPin(
	db: Db,
	specId: string | undefined,
	sessionId: number,
	running?: HostScope["nodes"]
): Promise<string | null> {
	// The running document only: it carries every rebind, at every scope,
	// already applied — the same answer the run gave, by construction. A host
	// wired by hand with no document names no strategy; a second reading from
	// rows here would miss instance-scope rebinds and disagree (A7r review).
	if (!specId || !running?.length) return null
	return await strategyOfNodes(db, sessionId, running)
}

/** The strategy among a document's nodes: its oracle under `turnMode: model`, else the task publishing turn entries. */
async function strategyOfNodes(
	db: Db,
	sessionId: number,
	nodes: NonNullable<HostScope["nodes"]>
): Promise<string | null> {
	const oracle = nodes.find((n) => n.kind === "oracle")
	if (oracle) {
		const { resolveSessionSettings } = await import("$lib/server/sessions/settings")
		if ((await resolveSessionSettings(db, sessionId))?.fields?.turnMode === "model")
			return `${oracle.definitionId}@${oracle.definitionVersion}`
	}
	const registry = await db
		.select({
			definitionId: schema.pipelineDefinitionRegistry.definitionId,
			version: schema.pipelineDefinitionRegistry.version,
			ports: schema.pipelineDefinitionRegistry.ports
		})
		.from(schema.pipelineDefinitionRegistry)
	const publishesEntries = new Set(
		(registry as any[])
			.filter((r) => r.ports?.out?.main === "core:shape/turn-entries@1")
			.map((r) => `${r.definitionId}@${r.version}`)
	)
	const producer = nodes.find(
		(n) => n.kind === "task" && publishesEntries.has(`${n.definitionId}@${n.definitionVersion}`)
	)
	return producer ? `${producer.definitionId}@${producer.definitionVersion}` : null
}

/** Whether the run's acting person owns the session — `personMay` write on a session is the owner's alone (★B). */
async function scopeActorOwnsSession(
	db: Db,
	userId: number | null | undefined,
	sessionId: number
): Promise<boolean> {
	if (userId == null) return false
	const { actingPersonFor, personMay } = await import("$lib/server/auth/actingPerson")
	const person = await actingPersonFor(db, { via: "press", userId })
	return !!person && (await personMay(db, person, "write", { kind: "session", id: sessionId })).ok
}

/**
 * Every reference that may hold a turn in this session now: seated
 * characters and personas (a persona is a character row, 0132), and seated
 * envoys that speak in turn. Seats out of play (removed or benched) and on-action envoys are never
 * in it — the pool's floors, restated where the write happens.
 */
async function liveCastRefs(db: Db, sessionId: number): Promise<Set<string>> {
	const [characters, personas, envoys] = await Promise.all([
		db
			.select({
				id: schema.sessionCharacters.id,
				castMemberId: schema.sessionCharacters.castMemberId,
				characterId: schema.sessionCharacters.characterId
			})
			.from(schema.sessionCharacters)
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, sessionId),
					seatInPlay(schema.sessionCharacters)
				)
			),
		db
			.select({
				id: schema.sessionPersonas.id,
				castMemberId: schema.sessionPersonas.castMemberId,
				personaId: schema.sessionPersonas.personaId
			})
			.from(schema.sessionPersonas)
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, sessionId),
					seatInPlay(schema.sessionPersonas)
				)
			),
		import("$lib/server/pipelines/entities/envoys").then(({ seatedEnvoys }) =>
			seatedEnvoys(db, sessionId)
		)
	])
	const out = new Set<string>()
	if (memberFormOn()) {
		// ⏳ (S4) Switch on: each seat as a turn entry carries it — its
		// `hostSeatRefOf` (`seated-member:<id>`, ⏳ its card while it stores no
		// member; every player seat `player-seat:<id>`).
		for (const r of characters) {
			const ref = hostSeatRefOf({
				kind: "character",
				seatId: r.id,
				castMemberId: r.castMemberId,
				cardId: r.characterId
			})
			if (ref) out.add(ref)
		}
		for (const r of personas)
			out.add(
				hostSeatRefOf({
					kind: "player",
					seatId: r.id,
					castMemberId: r.castMemberId,
					cardId: r.personaId
				})!
			)
	} else {
		for (const r of characters) if (r.characterId != null) out.add(`character:${r.characterId}`)
		// A persona seat is its card; 🚧 a card-less player seat is `player-seat:<id>`
		// (2026-10-14) — the pool admits it as it admits a persona.
		for (const r of personas)
			out.add(r.personaId != null ? `character:${r.personaId}` : `player-seat:${r.id}`)
	}
	for (const e of envoys as Array<{ slug: string; speaks?: string; removedAt?: unknown }>)
		if (e.removedAt == null && e.speaks !== "on-action") out.add(`envoy:${e.slug}`)
	return out
}

function annexOwnerOf(specId: string | undefined): string {
	if (!specId) return "core"
	const at = specId.indexOf(":")
	return at > 0 ? specId.slice(0, at) : specId
}

/** Deep equality for plain JSON values, key order ignored — what jsonb compares. */
function sameJson(a: unknown, b: unknown): boolean {
	const norm = (v: unknown): unknown =>
		Array.isArray(v)
			? v.map(norm)
			: v && typeof v === "object"
				? Object.fromEntries(
						Object.keys(v as object)
							.sort()
							.map((k) => [k, norm((v as Record<string, unknown>)[k])])
					)
				: v
	return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

/**
 * The narrator's display name for a session, snapshotted onto a narration row
 * at the write so a later rename does not relabel messages already made.
 *
 * The `narratorName` field of the narrator pipeline's `context` prompts, as
 * that session resolves it — its own selection or override, else the
 * instance's configuration, else the shipped prompt. Read through the run's
 * `db` rather than the global one, for the reason every host read is: a run
 * against another database must not quietly read this from the
 * application's. Null when nothing resolves a name (no narrator pipeline
 * published), and callers fall back to "Narrator".
 */
export async function narratorNameFor(
	db: Db,
	sessionId: number,
	_userId: number | undefined
): Promise<string | null> {
	const [{ buildWorld }, { resolveConfigSources }, { STORY_NARRATE_SPEC_ID }] =
		await Promise.all([
			import("$lib/server/pipelines/config/world"),
			import("@serene-pub/sdk"),
			import("$lib/server/pipelines/specs")
		])
	const world = await buildWorld(db, { specId: STORY_NARRATE_SPEC_ID, sessionId })
	const sourced = resolveConfigSources(world as any, ["context"]) as any
	const name = sourced?.context?.prompts?.narratorName?.value
	return typeof name === "string" && name.trim() ? name : null
}

/**
 * The Providers that are "one prompt, one call, one string".
 *
 * A set rather than a switch: they take the same path, so enumerating them as
 * cases would be eleven copies of one line and eleven chances to omit the
 * twelfth.
 */
const STEP_TYPE_LIST = [
	"core:oracle/summarize-batch",
	"core:oracle/summarize-synth",
	"core:oracle/name-entry",
	"core:oracle/extract-cast",
	// The turn-order model path (PLAN-turn-order R41, M4).
	"core:oracle/turn-advise",
	"core:oracle/graph-pre-filter",
	"core:oracle/graph-node-resolution",
	"core:oracle/graph-perspective",
	"core:oracle/graph-node-description",
	"core:oracle/graph-state-detection"
]

const STEP_TYPES = new Set(STEP_TYPE_LIST)

/** Exported under a test-only name so a suite can check the set is complete. */
export const STEP_TYPES_FOR_TEST = STEP_TYPE_LIST

/**
 * How long an extension's tool hook may take.
 *
 * Shorter than a plugin *node*'s thirty seconds, and deliberately: a node runs
 * once on the spine, while a tool runs once per iteration of a loop bounded at
 * eight or more — so the same number would be a turn a person waits four
 * minutes for. The node's own `timeoutMs` (`core:oracle/run-tool@1`) bounds
 * the whole invocation on top of this; this is the inner deadline the sandbox
 * enforces.
 */
const TOOL_HOOK_TIMEOUT_MS = 15_000

/**
 * A slot reference's row id.
 *
 * A resolved `connection` or `sampling` slot is the id of a row in its own
 * table — never the row. Accepts the object form too, because a preset written
 * before configs existed may carry `{ ref: 3 }`.
 *
 * ⚠ The two slots do not resolve to the same KIND of thing, and this function
 * is where that stopped being an implementation detail. A `connection` resolves
 * to a reference (`{ id, kind, metadata }`); a `sampling` resolves to the
 * config's VALUES, id deliberately stripped, because the nodes that read a
 * sampling slot need the numbers — `core:task/context-budget@1` derives the
 * token budget from `contextTokens` and the batch cutter fits a transcript into
 * that same window. So this read `null` for every sampling slot ever resolved,
 * a per-node pick reached no dispatcher, and `resolveCapabilityTarget` — which
 * treats `null` as "this tier said nothing" — fell through to the capability
 * default. The budget moved with the pick and the request did not.
 *
 * `slotRef` is the executor's own answer to "which row did these values come
 * from", carried on the values object under a symbol so no value reader sees it.
 * Asked FIRST, because on a sampling slot the values may legitimately contain
 * neither `ref` nor `id` and the fallthrough below would go back to `null`.
 */
/**
 * The dials a `workflow` slot carries beside its id (`{ id, values }`, or the
 * panel's stored `{ "": { id, values } }`) — a loadout's, projected by
 * `applyLoadoutLayer`. Null when it carries none.
 */
const workflowSlotValues = (v: unknown): Record<string, unknown> | null => {
	const slot =
		v && typeof v === "object" && "" in (v as object)
			? (v as Record<string, unknown>)[""]
			: v
	const values =
		slot && typeof slot === "object" ? (slot as { values?: unknown }).values : null
	return values && typeof values === "object" && !Array.isArray(values)
		? (values as Record<string, unknown>)
		: null
}

const refId = (v: unknown): number | null => {
	if (typeof v === "number") return v
	if (typeof v === "string" && /^\d+$/.test(v)) return Number(v)
	if (v && typeof v === "object") {
		const carried = slotRef(v)
		if (carried !== null) return refId(carried)
		// Recurses rather than restating a narrower rule: the executor hands
		// back `{id}` where the id is a STRING, and the branch above already
		// accepts a numeric string. Demanding a number here would make every
		// resolved slot null.
		return refId((v as any).ref ?? (v as any).id)
	}
	return null
}

/**
 * A message row id, as a spec hands one over: a bare id, or the
 * `{ status, ids }` write result an outlet publishes — `$.save.messageId` IS
 * that result, and `refId` alone reads its `id`, which it has none of.
 */
const messageRefId = (v: unknown): number | null =>
	refId(
		v && typeof v === "object" && "ids" in v
			? (v as { ids?: { id?: unknown } }).ids?.id
			: v
	)

/**
 * The MODEL half of a RESOLVED connection slot (0114).
 *
 * `refId` above reduces a resolved slot to the endpoint's row id; this is the
 * other half of the same pick, and the two are read separately because they
 * arrive by different routes. The executor resolves the slot's stored pair
 * against `world.connections` and hands back `{id, kind, metadata, modelId}` —
 * so the model half is on the DESCRIPTOR, under the same key name the stored
 * value uses.
 *
 * ⚠ It was read here with `slotModelId(p.connection)`, the reader for a STORED
 * value, against a descriptor that carried no `modelId` at all. That is not a
 * mismatch that fails: it returns null, every time, and null means "no model
 * named" — so a model chosen in the panel reached no request, and the run went
 * out against the endpoint alone looking entirely normal.
 *
 * Delegates to `slotModelId` rather than re-reading the key, because the two
 * shapes spell it identically **on purpose**: the descriptor carries the pick's
 * model half under the name the pick itself used, so one reader covers a
 * descriptor from an SDK that carries it and one from an SDK that does not
 * (null, the same answer as "no model named"). A second branch here would be a
 * copy of that reader that only ever returned what it already returns. What
 * this function adds is the NAME — a call site that says it is reading a
 * resolved slot, so the next person does not have to know that the coincidence
 * is deliberate.
 */
/**
 * A character-lore visibility subject no lorebook binding can carry — what a
 * WIRED `speaker` that names nobody in the cast reads as (W1, 2026-09-17).
 *
 * `isCharacterLoreEntryVisible` takes `number | null` and reads `null` as the
 * omniscient narrator, so "this voice is nobody" cannot be spelled `null`
 * without meaning "this voice knows everything" — which is the leak the
 * `speaker` port closes. Character ids are serials, `participantRowId` returns
 * only positive integers, and a binding's `characterId` is a foreign key to
 * one, so a negative subject matches no binding and is equal to no persona:
 * every branch of the rule then answers exactly what it answers for a speaker
 * nobody wrote private lore about.
 */
const NO_SUCH_CHARACTER = -1

/**
 * Whose private lore a `lorebook_entries` read is for.
 *
 * The run's scope, unless the query wired `speaker` — the per-speaker port
 * (W1) the two lore queries declare. See the long note at the read for why a
 * wired-but-unresolvable reference is `NO_SUCH_CHARACTER` rather than `null`.
 */
/**
 * Whether the query wired `speaker` to something. Absent, null, or an empty
 * string: the port is unwired (or wired to a node that published nothing this
 * turn).
 */
const speakerIsWired = (q: Record<string, any>): boolean =>
	q.speaker !== undefined && q.speaker !== null && q.speaker !== ""

const loreVisibilitySubject = (
	q: Record<string, any>,
	/** A wired `seated-member:` ref the caller found to be a card-less seat's: its member id. */
	cardlessMemberId: number | null = null
): { card: number | null; member: number | null } => {
	const ref = q.speaker
	// Unwired: the scope decides as it always did.
	if (!speakerIsWired(q))
		return {
			card: q.currentCharacterId ?? null,
			member: q.currentCastMemberId ?? null
		}
	// 🚧 A card-less seat's speaker: no card, its member (never a card id).
	if (cardlessMemberId !== null) return { card: null, member: cardlessMemberId }
	const none = { card: NO_SUCH_CHARACTER, member: null }
	if (!isParticipantRef(ref)) return none
	const parsed = parseParticipantRef(ref)
	// 🚧 A `seated-member:` ref reaching here was not translated by the
	// caller (`storedSeatRef` — seat-cast S3): it names no character.
	if (parsed.kind !== "character") return none
	return { card: participantRowId(parsed.id) ?? NO_SUCH_CHARACTER, member: null }
}

/**
 * 🚧 A list of participant refs (an audience, a speaker list) as it is
 * stored: each ref through the door (`storedSeatRef`, seat-cast S3): a
 * `seated-member:<memberId>` into its seat's card form, any other ref
 * unchanged; ⏳ (S4) with the member-form switch on, a `character:<cardId>`
 * into its seat's member form. A member
 * who sits in no seat of this session is dropped — the card form of nobody
 * is not a ref to store, and the raw `seated-member:` string is never
 * stored. Call it before a transaction opens, never inside one.
 */
const storedRefsOf = async (
	db: Db,
	sessionId: number,
	refs: readonly string[] | undefined
): Promise<string[]> => {
	const out: string[] = []
	for (const ref of refs ?? []) {
		const stored = await storedSeatRef(db, sessionId, ref)
		if (stored !== null) out.push(stored)
	}
	return out
}

/**
 * ⏳ (S4) A ref the door (`storedSeatRef`) answered, read as the card form the
 * callers below parse a card id from. Off: unchanged. On the door answers
 * member form (`seated-member:` / `player-seat:`): read through `seatOf` as
 * `character:<cardId>` (a seat with a card — a carded player seat is its card)
 * or a card-less player seat's own `player-seat:<seatId>`; null when no seat
 * answers or the seat has neither. A `character:` ref is already card form.
 */
const cardFormOfStored = async (
	db: Db,
	sessionId: number,
	ref: string | null
): Promise<string | null> => {
	if (ref === null || !memberFormOn()) return ref
	const form = parseSeatRef(ref)?.form
	if (form !== "seated-member" && form !== "player-seat") return ref
	const seat = await seatOf(db, sessionId, ref)
	if (!seat) return null
	if (seat.cardId != null) return `character:${seat.cardId}`
	return seat.kind === "player" ? `player-seat:${seat.seatId}` : null
}

const connectionDescriptorModelId = (v: unknown): number | null =>
	slotModelId(v)

/**
 * The user half of a step's prompt.
 *
 * Built by the binding, not here. The summarize steps call
 * `summarizer/templates.ts` — the same builders the legacy path uses — so the
 * rules, the `<content>` contract and the per-lore-type wording live in exactly
 * one place and cannot drift from the path they are migrating off. This is the
 * fallback for the graph steps, which hand their scenes over as JSON.
 */
function stepUserPrompt(p: Record<string, any>): string {
	if (typeof p.userPrompt === "string") return p.userPrompt
	if (Array.isArray(p.scenes)) return JSON.stringify(p.scenes, null, 1)
	if (typeof p.content === "string") return p.content
	return ""
}

/** Salvage JSON a model wrapped in prose. Null when there is none to find. */
function tryJson(text: string): unknown {
	if (!text) return null
	try {
		return JSON.parse(text)
	} catch {
		const match = /[[{][\s\S]*[\]}]/.exec(text)
		if (!match) return null
		try {
			return JSON.parse(match[0])
		} catch {
			return null
		}
	}
}

/**
 * A read a spec is not entitled to make is an **error, not an empty result**.
 *
 * Returning `[]` would let a mis-scoped pipeline look like a working one with a
 * quiet session, and the symptom — "the bot forgot everything" — points at
 * retrieval rather than at permissions, which is where the week goes.
 */
function assertScoped(
	node: NodeRef,
	wanted: number | undefined,
	allowed: number | undefined
) {
	if (wanted === undefined) return
	if (allowed === undefined || wanted !== allowed)
		throw new HostScopeError(
			`${node.key} (${node.definitionId}) asked for session ${wanted}, but this run is scoped to ` +
				`${allowed ?? "no session"}. A pipeline may only read the session it was started in.`
		)
}

/**
 * 🚧 Which lorebook a stat read may open (2026-09-27): the scope session's own,
 * or the one the run's scope grants (`HostScope.lorebookId`) — and no other.
 * A named lorebook outside those is **refused**, never filtered to nothing,
 * on `assertScoped`'s terms; lore queries cannot name a book at all, and this
 * is the same door with the one grant a sessionless read needs.
 *
 * 🚧 Where on the book (rulings 15 and 16, 2026-09-27; `state/reading.ts`):
 * the session's own line and moment when the book is the session's own;
 * otherwise the book's most recently used line at the head of its timeline.
 * Either way the fork cut is on. A pipeline may override all three —
 * `branch: 'main' | 'mostRecent' | 'session' | <id>`, `at: 'head' | <date>`,
 * `forkCut: false` — still inside the book it may read; a branch of another
 * book is refused like the book itself.
 */
async function lorebookInScope(
	db: Db,
	node: NodeRef,
	scope: HostScope,
	q: Record<string, any>
): Promise<{
	lorebookId: number | null
	sessionId?: number
	branchId: number | null
	reading?: import("$lib/server/state/reading").LineReading
}> {
	assertScoped(node, q.sessionId, scope.sessionId)
	const sessionId: number | undefined = q.sessionId ?? scope.sessionId
	let own: number | null = null
	let branchId: number | null = null
	if (sessionId !== undefined) {
		const [session] = await db
			.select({
				lorebookId: schema.sessions.lorebookId,
				branchId: schema.sessions.lorebookBranchId
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		own = session ? (session.lorebookId ?? (await ownBookOf(db, sessionId))?.id ?? null) : null
		branchId = session?.branchId ?? null
	}
	const granted = scope.lorebookId ?? null
	const wanted = typeof q.lorebookId === "number" ? q.lorebookId : undefined
	if (wanted !== undefined && wanted !== own && wanted !== granted)
		throw new HostScopeError(
			`${node.key} (${node.definitionId}) asked for lorebook ${wanted}, but this run may read only ` +
				`${[own, granted].filter((id) => id !== null).map((id) => `lorebook ${id}`).join(" or ") || "no lorebook"}. ` +
				`A pipeline may only read its own session's lorebook, or one its scope grants.`
		)
	const lorebookId = wanted ?? own ?? granted
	if (lorebookId === null) return { lorebookId, sessionId, branchId: null }
	const { readingOf, sessionReadingOf, storyDateFrom, BranchRefusal } = await import(
		"$lib/server/state/reading"
	)
	const refuse = (why: string) => new HostScopeError(`${node.key} (${node.definitionId}): ${why}`)
	const isOwn = lorebookId === own && sessionId !== undefined
	const sessionReading = isOwn ? await sessionReadingOf(db, sessionId!) : null

	// The line: named, else the session's, else the most recently used.
	let branch: "main" | "mostRecent" | number
	const b = q.branch
	if (b === undefined || b === null)
		branch = sessionReading ? (sessionReading.branchId ?? "main") : "mostRecent"
	else if (b === "main" || b === "mostRecent") branch = b
	else if (b === "session") {
		if (!isOwn) throw refuse(`branch "session" needs the scope session's own lorebook.`)
		branch = branchId ?? "main"
	} else if (typeof b === "number" && Number.isInteger(b)) branch = b
	else throw refuse(`branch must be "main", "mostRecent", "session" or a branch id of this lorebook.`)

	// The moment: named, else the session's (only on its own line), else the head.
	let moment: import("$lib/shared/lorebooks/storyDate").StoryDate | null
	const at = q.at
	if (at === undefined || at === null)
		moment =
			sessionReading && (b === undefined || b === null || b === "session")
				? sessionReading.moment
				: null
	else if (at === "head") moment = null
	else {
		moment = storyDateFrom(at)
		if (!moment) throw refuse(`at must be "head" or a story date { year, month?, day? }.`)
	}
	if (q.forkCut !== undefined && q.forkCut !== null && typeof q.forkCut !== "boolean")
		throw refuse(`forkCut must be true or false.`)

	try {
		const reading = await readingOf(db, lorebookId, {
			branch,
			moment,
			forkCut: q.forkCut !== false,
			// The session's own book: its switch is already read, so a run
			// with the timeline off sees `timelineOff` even with no moment
			// (D56). A granted book's (a lorebook-scoped run, or another book a
			// session may read) is asked here, once: the one statement a
			// granted read spends; `readingOf` then does not ask again.
			timelineEnabled: sessionReading
				? sessionReading.timelineOff !== true
				: await (await import("$lib/server/lorebooks/timeline")).timelineOfBook(db, lorebookId)
		})
		return { lorebookId, sessionId, branchId: reading.branchId, reading }
	} catch (e) {
		if (e instanceof BranchRefusal) throw refuse(e.message)
		throw e
	}
}

/**
 * One eager-indexing pass, in words, for the receipt.
 *
 * The rule this serves is the one a mechanism that cannot run keeps breaking: *an
 * unavailable mechanism subtracts a signal, and the receipt has to say so where
 * a person reads it.* A promotion that indexed nothing because the model was not
 * resident, and a promotion that indexed nothing because there was nothing to
 * do, produce identical search results and are completely different facts. So
 * both get a sentence, and a bound that bound says it bound — a slow turn and a
 * partially-covered one are the two things a person needs to be able to explain.
 *
 * Intentionally not emitted at all when there was nothing to index: a note per
 * turn saying "nothing to do" is noise that would train people to stop reading
 * the notes.
 */
function describePromotion(
	what: string,
	report: {
		requested: number
		processed: number
		remaining: number
		boundHit: boolean
		reason: string
	}
): string | undefined {
	if (report.requested === 0) return undefined
	if (report.processed === 0)
		return `${report.requested} ${what} were missing and none were indexed — ${report.reason}`
	if (report.boundHit || report.remaining > 0)
		return (
			`indexed ${report.processed} of ${report.requested} missing ${what} before searching — ` +
			`${report.reason}; the rest stay queued`
		)
	return `indexed ${report.processed} missing ${what} before searching`
}

/**
 * 🚧 Re-speaking a line (`attach-audio` with `replace`): remove the line's
 * EARLIER spoken `core:audio` parts on the step and revision the new one lands
 * on, and the spoken files behind them that nothing else shows.
 *
 * A part counts as spoken when its file is spoken media (`meta.spoken`) OR its
 * file is gone — the retention sweep and "clear spoken audio" delete files only
 * (lane C, L5), so a part naming a missing file is a dead earlier reading and
 * is swept away with the rest. A person's own voice note (a file that exists
 * and is not spoken) is never touched. The new file is never deleted, even when
 * identical bytes made it the same row as the old one.
 */
async function replaceSpokenAudio(
	db: Db,
	target: { id: number; parts: Array<{ id: number; type: string; step: number; revision: number; data: unknown }>; activeRevisions?: unknown },
	newAssetId: number | null
): Promise<number> {
	const { and, eq, inArray, sql } = await import("drizzle-orm")
	const schema = await import("$lib/server/db/schema")
	const steps = [...new Set(target.parts.map((x) => x.step))]
	if (!steps.length) return 0
	const step = Math.max(...steps)
	const active = (target.activeRevisions ?? {}) as Record<string, number>
	const revision = active[String(step)] ?? 0
	const earlier = target.parts.filter(
		(x) => x.type === "core:audio" && x.step === step && x.revision === revision
	)
	if (!earlier.length) return 0
	const assetOf = (x: { data: unknown }) => {
		const a = Number((x.data as { assetId?: unknown } | null)?.assetId)
		return Number.isInteger(a) ? a : null
	}
	const assetIds = [...new Set(earlier.map(assetOf).filter((a): a is number => a !== null))]
	const files = assetIds.length
		? await db
				.select({ id: schema.files.id, meta: schema.files.meta })
				.from(schema.files)
				.where(inArray(schema.files.id, assetIds))
		: []
	const { isSpokenMedia, deleteSpokenFiles } = await import("$lib/server/media/spoken")
	const present = new Set(files.map((f) => f.id))
	const spoken = new Set(files.filter((f) => isSpokenMedia(f.meta)).map((f) => f.id))
	const doomed = earlier.filter((x) => {
		const a = assetOf(x)
		return a === null || !present.has(a) || spoken.has(a)
	})
	if (!doomed.length) return 0
	await db.delete(schema.messageParts).where(
		inArray(
			schema.messageParts.id,
			doomed.map((x) => x.id)
		)
	)
	// Their files, unless another part still shows them (a deduped file can
	// belong to two lines) or the new reading is the same row.
	for (const a of new Set(doomed.map(assetOf).filter((x): x is number => x !== null))) {
		if (a === newAssetId || !spoken.has(a)) continue
		const [still] = await db
			.select({ id: schema.messageParts.id })
			.from(schema.messageParts)
			.where(
				and(
					eq(schema.messageParts.type, "core:audio"),
					sql`(${schema.messageParts.data}->>'assetId') = ${String(a)}`
				)
			)
			.limit(1)
		if (!still) await deleteSpokenFiles(db, [a])
	}
	return doomed.length
}

/**
 * Media references → the message parts that show them.
 *
 * A reference is a uuid, so the row has to be looked up — and looking it up is
 * also what makes the reference *checkable*. Every row is required to belong
 * either to this run's session or to the user the run is acting as; a uuid is
 * unguessable, but "unguessable" is not an access rule, and a spec that could
 * name any uuid could post any user's private image into a session.
 *
 * A reference that does not resolve is skipped rather than fatal. The image was
 * rendered and stored; failing the write over one missing row would throw away
 * the message and the other images with it.
 */
async function mediaParts(
	db: Db,
	refs: unknown[],
	sessionId: number,
	scope: HostScope,
	node: NodeRef
): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
	const { eq } = await import("drizzle-orm")
	const schema = await import("$lib/server/db/schema")
	const parts: Array<{ type: string; data: Record<string, unknown> }> = []

	for (const ref of refs) {
		const uuid =
			typeof ref === "string"
				? ref
				: ((ref as Record<string, any>)?.uuid as string | undefined)
		if (!uuid) continue

		// The FILE row, and only the file row (0182). Provenance for the
		// ownership check and the display variant's mime for the part both live
		// here, so one query answers both — putting a `variants` lookup on this
		// path is the one thing the split exists to prevent.
		const [row] = await db
			.select()
			.from(schema.files)
			.where(eq(schema.files.uuid, uuid))
			.limit(1)
		if (!row) continue

		// …or already shown in this session by an attachment part (§6.3 of
		// PLAN-composer-attachments) — the same three-way rule dispatch keeps.
		const ownedHere =
			(row.sessionId != null && row.sessionId === sessionId) ||
			(scope.userId != null && row.userId === scope.userId) ||
			(await (
				await import("$lib/server/attachments/references")
			).isFileReferencedInSession(db, row.id, sessionId))
		if (!ownedHere)
			throw new HostScopeError(
				`${node.key} (${node.definitionId}) tried to post media ${uuid}, which belongs ` +
					`to neither this session nor the user this run is acting as.`
			)

		const alt = (ref as Record<string, any>)?.text
		// One writer for the part (`attachments/partData`): the image's
		// width, height and name, a file's mime, name and size — so a
		// generated image and a person's attachment are the same part.
		const { mediaPartFor } = await import("$lib/server/attachments/partData")
		parts.push(mediaPartFor(row, { alt: alt ? String(alt) : null }))
	}

	return parts
}

/**
 * The embedding module, imported once.
 *
 * It was `await import(...)` inside each call. Two Provider nodes running in
 * parallel — which is exactly what a retrieval block does — then raced on the
 * same dynamic import, and one of them observed a module that reported no model
 * loaded while its sibling embedded happily. The symptom was a provider error on
 * a healthy session, on one of two identical calls, depending on timing.
 *
 * One promise, created on first use and reused: there is no second import to
 * race with, and the module is still not loaded for an instance that never
 * embeds.
 */
let embeddingModule: Promise<typeof import("$lib/server/embedding")> | null =
	null

const embeddingApi = () => (embeddingModule ??= import("$lib/server/embedding"))

/**
 * A message outlet's `sections` in-port, checked (B4; D5, 2026-09-27):
 * `undefined` when none were given, the normalized list otherwise, and a
 * malformed list refused by the node's key and the section's position — the
 * SDK's one `checkFoldedSections`, so the host and a spec's own tests agree.
 */
function foldedSectionsIn(
	node: NodeRef,
	raw: unknown
): FoldedSectionV1[] | undefined {
	const { sections, refusal } = checkFoldedSections(raw)
	if (refusal) throw new HostScopeError(`${node.key}: ${refusal}.`)
	return sections
}

/**
 * The row shape a Query publishes.
 *
 * Deliberately narrow: a binding gets what a prompt needs, not the whole row.
 * `queueItemId`, `embedding` and `debugMeta` have no business reaching a plugin
 * that asked for session history, and the cheapest way to guarantee that is to
 * never put them in the value (F30).
 */
/** What leaves the host for one hit: an id, a score and the text. */
function toCandidate(item: any) {
	return {
		id: item.id,
		source: item.source,
		score: item.score,
		name: item.name ?? null,
		content: textOf(item),
		lorebookId: item.lorebookId ?? null,
		priority: item.priority ?? 1
	}
}

/**
 * The hit's text, whichever column its source keeps it in.
 *
 * `content` is not universal across `ScopedRagItem`: a graph node keeps its
 * text in `summary`, a relationship in `description`, and so do a character and
 * a persona. Reading `content` alone published all four with an empty string —
 * which the vector mechanism then costed at zero tokens, so they took result slots
 * and carried nothing into the prompt.
 *
 * A coalesce and not a wider projection: the row's other exclusive fields
 * (`year`, `fromNodeId`, `status`, `reason`) still do not cross the edge,
 * because nothing downstream reads them off a vector hit.
 */
function textOf(item: any): string {
	return item.content ?? item.summary ?? item.description ?? ""
}

/** Cosine similarity, host-side, so no embedding reaches a data edge. */
function cosine(a?: number[], b?: number[]): number {
	if (!a || !b) return 0
	let dot = 0
	let na = 0
	let nb = 0
	for (let i = 0; i < a.length; i++) {
		const x = a[i] ?? 0
		const y = b[i] ?? 0
		dot += x * y
		na += x * x
		nb += y * y
	}
	if (na === 0 || nb === 0) return 0
	return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** 🚧 A dice row read with its result in words (`metadata.diceWords`), Show dice off (D3). */
function withoutDiceNumbers(r: any): any {
	const words = r?.metadata?.diceWords
	return typeof words === "string" && words ? { ...r, content: words } : r
}

function toMessage(r: any, shaping?: ChannelShaping | null) {
	const channel = r.channel ?? DEFAULT_CHANNEL
	/**
	 * How this row's channel enters a prompt (R-C, 2026-09-17), when its genre
	 * says anything about it.
	 *
	 * ⚠ **Absent unless the genre shapes channels**, and that is deliberate:
	 * `channelShapingOf` answers `null` for every genre that lists only bare
	 * slugs, so a row read for a pre-R-C session is byte-identical to the row
	 * that was read before this existed — no key, not a key holding the
	 * default. The assembled prompt cannot drift for a genre that declared
	 * nothing, because there is nothing new on the row to read.
	 */
	const shape = shaping?.get(parseChannel(channel).slug)
	return {
		id: r.id,
		role: r.role,
		content: r.content,
		characterId: r.characterId ?? null,
		personaId: r.personaId ?? null,
		// 🚧 The speaker's cast member (seat-cast S3, ★S3-3): what the
		// turn-order readers' `refOfMember` lookup names a row by. Only when
		// stamped, so an unstamped row reads exactly as it did.
		...(r.castMemberId != null ? { castMemberId: r.castMemberId } : {}),
		isNarratorResponse: r.isNarratorResponse,
		// Who voiced it, when a row says so by reference (`envoy:<slug>`) —
		// the turn rules read it (an envoy's reply has no character id). Only
		// when present, so every other row reads exactly as it did.
		...(typeof r.metadata?.speaker === "string" ? { speaker: r.metadata.speaker } : {}),
		// Which lane it came from, carried rather than dropped (20 §7). A read
		// is scoped to one channel, but a whole-channel read spans that
		// channel's lanes (ruling 2026-09-09), so this is what tells the five
		// private conversations under one slug apart without a second read.
		channel,
		...(shape ? { channelRole: shape.role } : {}),
		...(shape?.voice ? { channelVoice: shape.voice } : {}),
		// Whose line a person's own row is, when no persona says so — the
		// prompt names it after the member (lair pass B11). Only then, so a
		// persona's row reads exactly as it did.
		...(r.role === "user" && !r.personaId && r.userId != null
			? { userId: r.userId }
			: {}),
		// 🚧 The turns a planner's row plans (Lair character turns): what the
		// narrator strategy and `turn-plan@1` read. Only on such a row.
		...(r.metadata?.turnPlan && typeof r.metadata.turnPlan === "object"
			? { turnPlan: r.metadata.turnPlan }
			: {}),
		// A stopped row ends a standing turn plan (R34). Only when stopped.
		...(r.generationOutcome === "stopped" ? { stopped: true } : {}),
		// 🚧 The form this row answers (U5f) — what holds a plan's turns
		// while its roll forms are open (Lair rewrite D3). Only on an answer.
		...(r.metadata?.answersForm && typeof r.metadata.answersForm === "object"
			? { answersForm: r.metadata.answersForm }
			: {}),
		// 🚧 The table's own line (a roll line), said so a script can tell
		// it from speech. Only on such a row.
		...(r.metadata?.tableLine === true ? { tableLine: true } : {}),
		// 🚧 A row's kind (a journal line's `did`, a pressed answer's
		// `answer` — Dungeon Crawler's talk reads a person's answers as
		// their lines, the 100-turn walk's P3-5). Only on such a row.
		...(typeof r.metadata?.kind === "string" ? { kind: r.metadata.kind } : {}),
		createdAt: r.createdAt
	}
}

/**
 * A lore entry, narrowed to what retrieval and scoring need.
 *
 * `embedding` is deliberately absent: it is a large float array, it would
 * travel through every data edge and land in every receipt, and nothing
 * downstream of the vector search has any use for it. Vector similarity is
 * computed during retrieval and arrives as a score.
 */
/**
 * Bindings with the card each one names.
 *
 * `populateLorebookEntryBindings` reads `binding.character` to resolve
 * `{{char:1}}` into a name, and the binding rows carry only ids — so without
 * this the substitution silently does nothing, which is the failure it is being
 * wired in to fix. Two queries rather than a join per binding: a lorebook has a
 * handful of bindings and this runs once per read.
 *
 * A deleted card is nobody in a lorebook (plan A25): its member reads as their
 * own name, as a member with no card does (`character` null).
 */
async function hydrateBindings(db: Db, bindings: any[]): Promise<any[]> {
	const characterIds = [
		...new Set(bindings.map((b) => b.characterId).filter(Boolean))
	]

	// The cards as their current version has them; a deleted card is nobody.
	const byCharacter = new Map(
		[...(await cardsNow(db, characterIds)).entries()].filter(
			([, c]) => !c.isDeleted
		)
	)

	return bindings.map((b) => ({
		...b,
		character: b.characterId
			? (byCharacter.get(b.characterId) ?? null)
			: null
	}))
}

function toLoreEntry(
	row: any,
	source: "worldLore" | "characterLore" | "history",
	/**
	 * The character this entry's binding names, already resolved.
	 *
	 * Read by character lore's co-occurrence signal, which asks whether that
	 * character spoke recently — see `speakerCooccurrenceSignal`. Null for
	 * every entry that is not a character's.
	 */
	bindingCharacterId: number | null = null,
	/**
	 * The name of the cast member an anchored entry is bound to, as the
	 * session's reading has them — what Assemble's `characterLore` prints
	 * beside the entry. Null for an entry of an unanchored type, or bound to
	 * nobody.
	 */
	castMember: string | null = null,
	/**
	 * What this entry said when the run read it — `entrySourceHash` over the
	 * **stored** title, keys and content (16 §7c).
	 *
	 * Sixteen characters, computed once at the one read every mechanism shares, and
	 * carried from here into each candidate's `payload` and so into the
	 * receipt. That is the whole mechanism: a receipt records *what it decided*
	 * and never the text it decided about, so the explanation panel reads the
	 * live rows for titles and keys — and a rename after the run renders the
	 * new title against the old decision, silently. The fingerprint is what
	 * lets the panel tell those apart without storing a second copy of
	 * anybody's lore.
	 *
	 * Passed in rather than computed here because this function is handed the
	 * *hydrated* entry — bindings substituted, decorators stripped — and the
	 * fingerprint is over the stored row, which is the only shape the panel
	 * can recompute later. See `entrySourceHash`.
	 */
	fingerprint?: string
) {
	return {
		id: row.id,
		source,
		fingerprint,
		name: row.name ?? null,
		content: row.content ?? "",
		keys: row.keys ?? [],
		caseSensitive: row.caseSensitive ?? false,
		useRegex: row.useRegex ?? false,
		matchMode: row.matchMode ?? null,
		// `?? null` for the mode and `?? []` for the keys, because the two
		// absences mean the same thing and the matcher tests both: no mode is
		// no condition, and no condition keys is no condition either. A list,
		// never joined (finding #146).
		secondaryKeys: row.secondaryKeys ?? [],
		selectiveLogic: row.selectiveLogic ?? null,
		// `?? null` and not `?? 0`, because null is a value here: it means the
		// entry has no opinion and the node's ceiling decides. Coalescing to
		// zero would pin every untouched entry to "conversation only" and make
		// turning recursion on do nothing.
		recursionDepth: row.recursionDepth ?? null,
		priority: row.priority ?? 1,
		constant: row.constant ?? false,
		enabled: row.enabled ?? true,
		// Carried so a mechanism can exclude it (L1): this mapper is a column
		// whitelist, and a scoping column it drops fails OPEN — the archived
		// entry reached ranking as though it were live.
		archived: row.archived ?? false,
		position: row.position ?? 0,
		lorebookBindingId: row.lorebookBindingId ?? null,
		bindingCharacterId,
		castMember,
		/**
		 * The row's stored date: a history entry's own date, or another
		 * entry's Beginning (*began*). Left as stored here; with the timeline
		 * off `readLorebookEntries` (this mapper's one caller) maps all three
		 * through `timelessNull`.
		 */
		year: row.year ?? null,
		month: row.month ?? null,
		day: row.day ?? null
	}
}

export {
	legacyMessage,
	settledMessage,
	turnStrategyPin,
	scopeActorOwnsSession,
	liveCastRefs,
	annexOwnerOf,
	sameJson,
	STEP_TYPES,
	TOOL_HOOK_TIMEOUT_MS,
	workflowSlotValues,
	refId,
	messageRefId,
	NO_SUCH_CHARACTER,
	speakerIsWired,
	loreVisibilitySubject,
	storedRefsOf,
	cardFormOfStored,
	connectionDescriptorModelId,
	stepUserPrompt,
	tryJson,
	assertScoped,
	lorebookInScope,
	describePromotion,
	replaceSpokenAudio,
	mediaParts,
	embeddingApi,
	foldedSectionsIn,
	toCandidate,
	cosine,
	withoutDiceNumbers,
	toMessage,
	hydrateBindings,
	toLoreEntry
}
