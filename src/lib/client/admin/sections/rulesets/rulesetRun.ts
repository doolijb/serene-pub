/**
 * 🚧 One run of `rulesets:tryOut`, correlated by its own `runId` (lane M4,
 * 2026-10-22): a step's preview, a rule's dry run, a script line's run and a
 * playtest may all be in flight on one page, and each waits for its own
 * answer — and its own refusal.
 */
import { awaitReply } from "$lib/client/utils/awaitReply"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import type { TryOutParams, TryOutResult } from "./rulesetScene"

let seq = 0

export function runTryOut(socket: Pick<TypedSocket, "emit">, params: TryOutParams): Promise<TryOutResult> {
	const runId = `run-${++seq}-${Date.now().toString(36)}`
	return awaitReply({
		socket,
		event: "rulesets:tryOut",
		errorEvent: "rulesets:tryOut:error",
		params: { ...params, runId },
		match: (r) => r.runId === runId,
		// A refusal names its run; one with no run (the handler wrapper's) settles every run.
		matchError: (d) => {
			const id = (d as { runId?: unknown } | null)?.runId
			return id === undefined || id === runId
		},
		timeoutMs: 30_000
	}).then((r) => {
		if (!r.result) throw new Error(r.error ?? "The run came back empty.")
		return r.result
	})
}

/**
 * 🚧 The draft's findings as it stands (RF fix 6, 2026-10-23) — what a Save
 * would leave on its rows, judged without saving: one run at How strict's
 * first level. A draft refused for its findings answers them; one that runs
 * answers none; any other refusal (or no answer) answers `null`: nothing
 * could be judged, and what is shown stays.
 */
export async function draftFindings(socket: Pick<TypedSocket, "emit">, params: Omit<TryOutParams, "rigour">): Promise<string[] | null> {
	const runId = `check-${++seq}-${Date.now().toString(36)}`
	let refused: { findings?: unknown } | null = null
	try {
		await awaitReply({
			socket,
			event: "rulesets:tryOut",
			errorEvent: "rulesets:tryOut:error",
			params: { ...params, rigour: "prose", runId },
			match: (r) => r.runId === runId,
			matchError: (d) => {
				const id = (d as { runId?: unknown } | null)?.runId
				const mine = id === undefined || id === runId
				if (mine) refused = d as { findings?: unknown }
				return mine
			},
			timeoutMs: 30_000
		})
		return []
	} catch {
		const f = (refused as { findings?: unknown } | null)?.findings
		return Array.isArray(f) ? f.filter((x): x is string => typeof x === "string") : null
	}
}

/** A refusal's sentence and its findings: "The draft cannot be run yet:\n · a\n · b". */
export function refusalOf(e: unknown): { sentence: string; findings: string[] } {
	const message = e instanceof Error ? e.message : String(e)
	const [head, ...rest] = message.split(/\n\s*·\s*/)
	return { sentence: (head ?? "").trim(), findings: rest.map((f) => f.trim()).filter(Boolean) }
}

/** 🚧 A playtest scene, then the Reply loadout narrating it (`rulesets:askModel`): slower, so a longer wait. */
export function askModel(
	socket: Pick<TypedSocket, "emit">,
	params: TryOutParams & { situation?: string }
): Promise<{ result: TryOutResult; narration: string; loadout: string }> {
	const runId = `ask-${++seq}-${Date.now().toString(36)}`
	return awaitReply({
		socket,
		event: "rulesets:askModel",
		errorEvent: "rulesets:askModel:error",
		params: { ...params, runId },
		match: (r) => r.runId === runId,
		matchError: (d) => {
			const id = (d as { runId?: unknown } | null)?.runId
			return id === undefined || id === runId
		},
		timeoutMs: 180_000
	}).then((r) => {
		if (!r.result) throw new Error(r.error ?? "The model's answer came back empty.")
		return { result: r.result, narration: r.narration ?? "", loadout: r.loadout ?? "" }
	})
}
