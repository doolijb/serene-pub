/**
 * Which step of the **Set up chat** flow a pub is on, decided from facts.
 *
 * The flow is Runtime → Model → Done (concept ruling, U5): install KoboldCPP,
 * fetch one chat model, and sessions can reply. ⚠ The step is DERIVED, never
 * stored — a person who closes the sidebar mid-download and comes back lands
 * on the step the pub is actually at, and a runtime somebody installed
 * through the managed view counts exactly as one installed here.
 *
 * "First model becomes the chat default when none is set" is the flow's one
 * side effect, and `firstModelToRegister` is the whole of that decision: it
 * names a pair only while the chat default is unset, so a pub that already
 * answers with something is never silently re-pointed.
 */

import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

export type SetupChatStep = "runtime" | "model" | "done"

export interface SetupChatConnection {
	id: number
	type?: string | null
	models: readonly {
		id: number
		name: string
		missingSince?: string | null
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

/**
 * The pair to register as the chat default, or null: the connection's first
 * present model, only while nothing is registered at all.
 */
export function firstModelToRegister(
	facts: SetupChatFacts
): { connectionId: number; model: { id: number; name: string } } | null {
	if (facts.chatDefault) return null
	if (!facts.connection) return null
	const [first] = presentModels(facts.connection)
	if (!first) return null
	return {
		connectionId: facts.connection.id,
		model: { id: first.id, name: first.name }
	}
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

/** What the Done card says, given what is now registered. */
export function doneSentence(
	facts: SetupChatFacts,
	registeredName: string | null
): string {
	if (registeredName) return `Sessions reply with ${registeredName}.`
	const [first] = presentModels(facts.connection)
	if (facts.chatDefault && first)
		return "A chat model is set — sessions can reply."
	return "Sessions can reply."
}
