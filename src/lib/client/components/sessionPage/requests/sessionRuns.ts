/**
 * 🚧 `session-runs` and `session-run-steps` (lay-R, owner 2026-11-06): core's
 * Runs widget asks what pipelines ran in the session, and one run's steps.
 * Core's widgets only (the askers table). Runs are an administrator's (R55):
 * a non-admin is refused here before any read — so no socket event, no
 * `:error` reply and no toast — and the server refuses them again.
 *
 * A refusal or a failed read is the asking widget's own error (R77), never
 * a toast.
 */
import type {
	SessionRunsV1,
	SessionRunStepsV1,
	SessionRunStepV1,
	SessionRunV1,
	WidgetRequests
} from "@serene-pub/sdk"
import { nodeRows } from "$lib/client/components/pipelines/inspector/receiptView"

const RUNS_FIRST = 25
const RUNS_MOST = 100

/** The page's read: one `pipelines:runs` for this session, settled on the reply that names it. */
export type SessionRunsRead = (
	ask: Sockets.Pipelines.Runs.Params & { sessionId: number; limit: number }
) => Promise<Sockets.Pipelines.Runs.Response>

/** The page's read of one run's receipt: `pipelines:run`. */
export type RunReceiptRead = (
	runId: string
) => Promise<Sockets.Pipelines.Run.Response>

/** One list row as the widget's run. `promptMessageId` is decided by the caller. */
export function sessionRunOf(
	row: Sockets.Pipelines.Runs.Response["runs"][number],
	promptMessageId: number | null
): SessionRunV1 {
	return {
		runId: row.runId,
		pipeline: row.specSlug,
		outcome: row.outcome as SessionRunV1["outcome"],
		triggerFamily: row.triggerFamily ?? null,
		registrationKey: row.registrationKey ?? null,
		triggerSource: row.triggerSource,
		userId: row.userId ?? null,
		username: row.username ?? null,
		startedAt: new Date(row.startedAt).getTime(),
		endedAt: new Date(row.endedAt).getTime(),
		elapsedMs: row.elapsedMs,
		tokens: row.tokensSpent,
		haltNodeKey: row.haltNodeKey ?? null,
		haltReason: row.haltReason ?? null,
		isPreview: row.isPreview,
		parentRunId: row.parentRunId ?? null,
		depth: row.depth ?? 0,
		promptMessageId
	}
}

/** A receipt's nodes as the widget's steps, in the order they ran. */
export function sessionRunStepsOf(receipt: unknown): SessionRunStepV1[] {
	return nodeRows(receipt).map((row) => ({
		seq: row.seq,
		key: row.label,
		kind: row.kind,
		result: row.result,
		reason: row.reason ?? null,
		elapsedMs: row.elapsedMs,
		tokens: row.tokens
	}))
}

/** What `answerSessionRuns` needs of the page. */
export interface SessionRunsDeps {
	isAdmin: boolean
	sessionId: number | null
	contextDebugging: boolean
	findMessage(id: number): { id: number; debugMeta?: unknown } | undefined
	read: SessionRunsRead
}

/** Answer one `session-runs`. Rejects, in words, on a refusal or a bad ask. */
export async function answerSessionRuns(
	params: WidgetRequests["session-runs"]["params"],
	deps: SessionRunsDeps
): Promise<SessionRunsV1> {
	if (!deps.isAdmin) throw new Error("runs are for admins")
	const p = (params ?? {}) as { limit?: unknown }
	let limit = RUNS_FIRST
	if (p.limit !== undefined) {
		if (
			typeof p.limit !== "number" ||
			!Number.isInteger(p.limit) ||
			p.limit < 1
		)
			throw new Error(
				"session-runs' limit is a whole number of runs, at least 1"
			)
		limit = Math.min(RUNS_MOST, p.limit)
	}
	if (deps.sessionId == null) throw new Error("this page has no session open")
	const res = await deps.read({ sessionId: deps.sessionId, limit })
	const error = (res as { error?: string }).error
	if (error) throw new Error(error)
	return {
		runs: (res.runs ?? []).map((row) => {
			let promptMessageId: number | null = null
			if (deps.contextDebugging) {
				for (const a of row.artifacts ?? []) {
					if (a.kind !== "message") continue
					if (deps.findMessage(a.entityId)?.debugMeta) {
						promptMessageId = a.entityId
						break
					}
				}
			}
			return sessionRunOf(row, promptMessageId)
		})
	}
}

/** What `answerSessionRunSteps` needs of the page. */
export interface SessionRunStepsDeps {
	isAdmin: boolean
	read: RunReceiptRead
}

/** Answer one `session-run-steps`. Rejects, in words, on a refusal or a bad ask. */
export async function answerSessionRunSteps(
	params: WidgetRequests["session-run-steps"]["params"],
	deps: SessionRunStepsDeps
): Promise<SessionRunStepsV1> {
	if (!deps.isAdmin) throw new Error("runs are for admins")
	const runId = (params as { runId?: unknown } | undefined)?.runId
	if (typeof runId !== "string" || !runId)
		throw new Error("session-run-steps names a runId")
	const res = await deps.read(runId)
	if (res.error || !res.run) throw new Error(res.error ?? "no such run")
	return { steps: sessionRunStepsOf(res.run.receipt) }
}
