/**
 * Where the home wizard opens, read from the data — never from a stored
 * "wizard step" (out of scope by ruling: derive-from-data is enough once the
 * start is right).
 *
 * | Who                                          | Step          | Road      |
 * | -------------------------------------------- | ------------- | --------- |
 * | anyone but an admin                          | Get started   | —         |
 * | an admin whose pub can reply (chat default)  | What to do    | —         |
 * | an admin with a chat connection, no default  | Choose an AI  | `service` |
 * | an admin with no chat connection             | Get started   | —         |
 *
 * The third row is the resume. An admin who added a service, closed the tab
 * and came back is past Get started — the connection they made says so — so
 * they open on the service road with its checklist showing what is left,
 * rather than being asked their language and name again.
 */
import { textGenConnections } from "./serviceRoadChecklist"

export type WizardStartStep = "welcome" | "llm" | "purpose"

export interface WizardStartFacts {
	isAdmin: boolean
	/** A chat default is registered: the pub can reply. */
	hasChatDefault: boolean
	/** The admin's connections, as `connections:list` sends them. */
	connections: readonly { modality?: string | null }[]
}

export interface WizardStart {
	step: WizardStartStep
	/** The Choose an AI road to open on, or null for its doors. */
	road: "service" | null
}

export function wizardStart(facts: WizardStartFacts): WizardStart {
	if (!facts.isAdmin) return { step: "welcome", road: null }
	if (facts.hasChatDefault) return { step: "purpose", road: null }
	if (textGenConnections(facts.connections).length > 0)
		return { step: "llm", road: "service" }
	return { step: "welcome", road: null }
}
