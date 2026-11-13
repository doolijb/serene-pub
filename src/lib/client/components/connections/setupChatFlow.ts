/**
 * Which step of the **Set up chat** flow a pub is on, decided from facts.
 *
 * The flow is Runtime → Model → Done (concept ruling, U5): install KoboldCPP,
 * fetch one chat model, and sessions can reply. ⚠ The step is DERIVED, never
 * stored — a person who closes the stepper mid-download and comes back lands
 * on the step the pub is actually at, and a runtime somebody installed
 * through the managed view counts exactly as one installed here.
 *
 * The flow has no side effect. The server fills the Reply loadout when a
 * downloaded model lands and Reply is empty (`fillReplyOnArrival.ts`), whether
 * or not this dialog is open; the dialog only reads that and says what
 * happened.
 */

import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { chosenSentence } from "./jobPicker"

const CHAT = "text->text"

export type SetupChatStep = "runtime" | "model" | "done"

export interface SetupChatConnection {
	id: number
	type?: string | null
	models: readonly {
		id: number
		name: string
		missingSince?: string | null
		enabled?: boolean
		/** The server's pair judgement, off the list row. */
		satisfiableCapabilities?: readonly string[] | null
	}[]
}

export interface SetupChatFacts {
	/** The managed KoboldCPP TEXT connection, when one exists. */
	connection: SetupChatConnection | null
	/** `koboldCppManagedMode` — null until chosen. */
	managedMode: "managed" | "external" | null
	/** A binary variant is recorded in settings. */
	hasBinary: boolean
	/** The chat capability default, when one is registered. */
	chatDefault: {
		connectionId: number
		connectionModelId?: number | null
	} | null
}

/**
 * The chat default AS REGISTERED, or null. `systemSettings:get` carries the
 * default loadout's slots for every capability, so on a fresh pub the chat
 * entry is a real object with `connectionId: null` — the Reply loadout is
 * designated, nothing is on it. Read raw, that object counted as "a model is
 * registered": the flow skipped registering the one it had just downloaded
 * and the Done step said Reply was filled while the composer said it was
 * empty (seen 2026-11-08 on a fresh managed KoboldCPP install).
 */
export function registeredChatDefault(
	raw:
		| {
				connectionId?: number | null
				connectionModelId?: number | null
		  }
		| null
		| undefined
): SetupChatFacts["chatDefault"] {
	if (raw?.connectionId == null) return null
	return {
		connectionId: raw.connectionId,
		connectionModelId: raw.connectionModelId ?? null
	}
}

/** The managed KoboldCPP text connection among the list's rows, or null. */
export function findKcppTextConnection<
	C extends { id: number; type?: string | null }
>(rows: readonly C[]): C | null {
	return (
		rows.find((c) => c.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED) ?? null
	)
}

/** Models the runtime can serve today: listed, and not gone missing. */
export function presentModels(
	connection: SetupChatConnection | null
): SetupChatConnection["models"] {
	return (connection?.models ?? []).filter((m) => !m.missingSince)
}

/**
 * Present models the server judges able to chat, switched on. A model the
 * list says nothing about (no judgement yet) is not ruled out.
 *
 * ⚠ The managed KoboldCPP lists its image and embedding models beside the
 * chat ones, and "the first present model" was sometimes one of those; the
 * server refused registering it for chat, which surfaced as a failure toast
 * on the step that had just succeeded.
 */
export function chatModels(
	connection: SetupChatConnection | null
): SetupChatConnection["models"] {
	return presentModels(connection).filter(
		(m) =>
			m.enabled !== false &&
			(m.satisfiableCapabilities == null ||
				m.satisfiableCapabilities.includes("text->text"))
	)
}

/**
 * The runtime is ready when it can be asked to load something: the flow
 * chooses managed mode itself, so external mode also counts once chosen — a
 * person who picked it in the managed view is past this step.
 */
export function runtimeReady(facts: SetupChatFacts): boolean {
	if (!facts.connection) return false
	if (facts.managedMode === "external") return true
	return facts.managedMode === "managed" && facts.hasBinary
}

export function setupChatStep(facts: SetupChatFacts): SetupChatStep {
	if (!runtimeReady(facts)) return "runtime"
	if (presentModels(facts.connection).length === 0) return "model"
	return "done"
}

/** The three step labels, in order, for the header's dots. */
export const SETUP_CHAT_STEPS: readonly {
	value: SetupChatStep
	label: string
}[] = [
	{ value: "runtime", label: "Runtime" },
	{ value: "model", label: "Model" },
	{ value: "done", label: "Done" }
]

/** Reply has a pair on it — the server put it there, or somebody chose it. */
export function replyFilled(facts: SetupChatFacts): boolean {
	return facts.chatDefault != null
}

/** The Done step's heading: "Chat is set up" only once Reply is filled. */
export function doneHeading(facts: SetupChatFacts): string {
	return replyFilled(facts) ? "Chat is set up" : "KoboldCPP is ready"
}

/**
 * What the Done step says, read from server state only: the model on the
 * Reply loadout, by name, in the same words as the toast after any other Use
 * (`chosenSentence`); or that Reply is empty and where to fill it.
 */
export function doneSentence(facts: SetupChatFacts): string {
	const pair = facts.chatDefault
	if (!pair) {
		return "The Reply loadout is still empty. Open KoboldCPP and press Use in Reply on a model."
	}
	const model =
		pair.connectionId === facts.connection?.id
			? facts.connection.models.find(
					(m) => m.id === pair.connectionModelId
				)
			: undefined
	if (model) return chosenSentence(model.name, [CHAT])
	return "The Reply loadout is filled — sessions can reply."
}
