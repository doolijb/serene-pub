/**
 * `session-scenario` and `set-session-scenario`: core's Author's note widget
 * reads and edits the session's scenario. Core's widgets only (the askers
 * table, `./askers.ts`). The write is the existing `sessions:update`; the
 * server enforces owner-only there, and the page's session refreshes on its
 * broadcast.
 */

export interface SessionScenarioDeps {
	/** The page's session as it stands: its scenario (null/absent → "") and whether the viewer owns it; null with no session. */
	readScenario(): { scenario: string; canEdit: boolean } | null
	/** Save it — the EXISTING `sessions:update` with `{ session: { id, scenario } }` (no new socket event; the server enforces owner-only there). */
	writeScenario(sessionId: number, scenario: string): void
}

type ScenarioResult = { scenario: string; canEdit: boolean }

const MAX_SCENARIO = 20000

function readOf(deps: Partial<SessionScenarioDeps>): ScenarioResult {
	if (!deps.readScenario)
		throw new Error("this page can't read the session's scenario")
	const read = deps.readScenario()
	if (!read) throw new Error("this page has no session")
	return { scenario: read.scenario ?? "", canEdit: read.canEdit }
}

/** Answer one `session-scenario`. Throws, in words. */
export function answerSessionScenario(
	deps: Partial<SessionScenarioDeps>
): ScenarioResult {
	return readOf(deps)
}

/** Answer one `set-session-scenario`. Throws, in words, with a mistake or the owner-only refusal. */
export function answerSetSessionScenario(
	params: unknown,
	sessionId: number | null,
	deps: Partial<SessionScenarioDeps>
): ScenarioResult {
	const read = readOf(deps)
	if (sessionId == null) throw new Error("this page has no session")
	const scenario = ((params ?? {}) as { scenario?: unknown }).scenario
	if (typeof scenario !== "string")
		throw new Error("set-session-scenario takes the scenario as text")
	if (scenario.length > MAX_SCENARIO)
		throw new Error(`A scenario is at most ${MAX_SCENARIO} characters.`)
	if (!read.canEdit)
		throw new Error("Only the session's owner can change the scenario.")
	if (!deps.writeScenario)
		throw new Error("this page can't save the session's scenario")
	deps.writeScenario(sessionId, scenario)
	return { scenario, canEdit: true }
}
