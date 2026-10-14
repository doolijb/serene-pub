/**
 * The home wizard's service road as a checklist: **Connection added** ·
 * **Key saved** · **Model chosen**, and which of the three is next.
 *
 * ## Why a checklist and not a spinner
 *
 * The road hands the person to the Connections view and waits for a chat
 * default. A wait that only says it is waiting tells nobody what is left: on
 * an online service the steps are paste a key → Save → pick a model → **Use
 * for chat**, and the wizard holds every one of those facts already. The
 * lines are those facts read back — the same `hasCredential`, model listing
 * and `capabilityDefaults["text->text"]` the index row, the status card and
 * the Models tab read — so the wizard can never claim a step the connection
 * view says is undone.
 *
 * Only the NEXT line carries an action. A checked line has nothing left to
 * do, and a later unchecked one cannot be done before the one above it.
 *
 * Pure: the page passes its lists in and renders what comes back.
 */
import {
	credentialPolicy,
	needsCredential
} from "$lib/shared/connections/credentials"

/** The chat capability — the one default the wizard waits for. */
const CHAT_CAPABILITY = "text->text"

/** The model facts a line reads, as the connections list carries them. */
export interface RoadModel {
	enabled: boolean
	missingSince: string | null
	/** The transforms the server judged this pair can be the default for. */
	satisfiableCapabilities?: readonly string[] | null
}

/** One row of `connections:list`, narrowed to what the lines read. */
export interface RoadConnection {
	id?: number
	name?: string | null
	type?: string | null
	preset?: string | null
	baseUrl?: string | null
	modality?: string | null
	hasCredential?: boolean
	models: readonly RoadModel[]
	modelsSync: { at: string | null; error: string | null }
}

export type ServiceRoadLineId = "connection" | "key" | "model"

/** What the next line's button does. The page maps each kind to a panel. */
export type ServiceRoadAction =
	/** Reopen the New connection picker the road came in by. */
	| { kind: "add"; label: string }
	/** Open this connection in the Connections view. */
	| { kind: "open"; connectionId: number; label: string }
	/** Open the job picker for Chat replies, where every usable model has **Use**. */
	| { kind: "choose"; label: string }

export interface ServiceRoadLine {
	id: ServiceRoadLineId
	/** Fixed English, so the page can pass it through `t()`. */
	label: string
	done: boolean
	/** The line's own fact in a few words — a name, a count — or null. */
	detail: string | null
	/** Only on the next line; null on every other. */
	action: ServiceRoadAction | null
}

export interface ServiceRoadChecklist {
	lines: [ServiceRoadLine, ServiceRoadLine, ServiceRoadLine]
	/** The first line still to do, or null once a model is chosen. */
	next: ServiceRoadLineId | null
	/** The connection the lines are about, or null before there is one. */
	subjectId: number | null
}

export interface ServiceRoadFacts {
	connections: readonly RoadConnection[]
	/** The chat default's connection, or null while none is registered. */
	chatConnectionId: number | null
	/** The connection created while this road was open, if one was. */
	focusId?: number | null
}

export const SERVICE_ROAD_LABELS = {
	connection: "Connection added",
	key: "Key saved",
	model: "Model chosen"
} as const satisfies Record<ServiceRoadLineId, string>

export const ADD_CONNECTION_LABEL = "Add a connection"
export const CHOOSE_MODEL_LABEL = "Choose which model replies"

/**
 * The connections that could ever answer a chat: text generation, by the
 * endpoint's own modality. An embeddings or entities connection is not on
 * this road, so it neither ticks **Connection added** nor resumes the wizard
 * on the Choose an AI step.
 */
export function textGenConnections<C extends { modality?: string | null }>(
	connections: readonly C[]
): C[] {
	return connections.filter((c) => (c.modality ?? "text-gen") === "text-gen")
}

/**
 * How many models on this connection could be the chat default right now:
 * switched on, still listed, and judged able to chat by the server
 * (`satisfiableCapabilities`). Never re-derived here.
 */
export function chatModelCount(connection: RoadConnection): number {
	return connection.models.filter(
		(m) =>
			m.enabled &&
			!m.missingSince &&
			!!m.satisfiableCapabilities?.includes(CHAT_CAPABILITY)
	).length
}

/**
 * The connection the lines describe: the one created on this road, else the
 * chat default's, else the one furthest along (lists chat models, then has
 * what it needs for a key), newest first among equals.
 */
function subjectOf(facts: ServiceRoadFacts): RoadConnection | null {
	const candidates = textGenConnections(facts.connections).filter(
		(c) => c.id != null
	)
	for (const id of [facts.focusId, facts.chatConnectionId]) {
		if (id == null) continue
		const hit = candidates.find((c) => c.id === id)
		if (hit) return hit
	}
	let best: RoadConnection | null = null
	let bestRank = -1
	for (const c of candidates) {
		const rank = chatModelCount(c) > 0 ? 2 : needsCredential(c) ? 0 : 1
		if (rank > bestRank || (rank === bestRank && c.id! > best!.id!)) {
			best = c
			bestRank = rank
		}
	}
	return best
}

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? "" : "s"}`
}

/** The three lines, and the one that is next. */
export function serviceRoadChecklist(
	facts: ServiceRoadFacts
): ServiceRoadChecklist {
	const subject = subjectOf(facts)
	const name = subject?.name?.trim() || "the connection"
	const open: ServiceRoadAction | null =
		subject?.id != null
			? { kind: "open", connectionId: subject.id, label: `Open ${name}` }
			: null

	// Whatever lists a chat model can be chosen from, this connection or not:
	// the job picker for Chat replies offers every one of them.
	const listing =
		subject && chatModelCount(subject) > 0
			? subject
			: (textGenConnections(facts.connections).find(
					(c) => chatModelCount(c) > 0
				) ?? null)

	const connectionDone = subject != null
	const keyMissing = subject != null && needsCredential(subject)
	const keyDone = subject != null && !keyMissing
	const modelDone = facts.chatConnectionId != null

	let keyDetail: string | null = null
	if (keyMissing) keyDetail = "Paste your API key, then press Save."
	else if (
		subject &&
		!subject.hasCredential &&
		credentialPolicy(subject) !== "required"
	)
		keyDetail = "No key needed"

	let modelDetail: string | null = null
	if (modelDone) {
		modelDetail =
			facts.connections
				.find((c) => c.id === facts.chatConnectionId)
				?.name?.trim() || null
	} else if (listing) {
		modelDetail = `${listing.name?.trim() || "The connection"} lists ${plural(
			chatModelCount(listing),
			"model"
		)}`
	} else if (subject && keyDone) {
		if (subject.modelsSync.error)
			modelDetail = `${name} couldn't list its models`
		else if (subject.modelsSync.at)
			modelDetail = `${name} lists no chat models`
		else modelDetail = `Waiting for ${name} to list its models`
	}

	// A chosen model is the whole point: nothing above it is left to do once
	// it lands, whichever connection it is on.
	const next: ServiceRoadLineId | null = modelDone
		? null
		: !connectionDone
			? "connection"
			: !keyDone
				? "key"
				: "model"

	const actionFor = (id: ServiceRoadLineId): ServiceRoadAction | null => {
		if (id !== next) return null
		if (id === "connection")
			return { kind: "add", label: ADD_CONNECTION_LABEL }
		if (id === "key") return open
		return listing ? { kind: "choose", label: CHOOSE_MODEL_LABEL } : open
	}

	return {
		lines: [
			{
				id: "connection",
				label: SERVICE_ROAD_LABELS.connection,
				done: connectionDone,
				detail: subject ? name : null,
				action: actionFor("connection")
			},
			{
				id: "key",
				label: SERVICE_ROAD_LABELS.key,
				done: keyDone,
				detail: keyDetail,
				action: actionFor("key")
			},
			{
				id: "model",
				label: SERVICE_ROAD_LABELS.model,
				done: modelDone,
				detail: modelDetail,
				action: actionFor("model")
			}
		],
		next,
		subjectId: subject?.id ?? null
	}
}
