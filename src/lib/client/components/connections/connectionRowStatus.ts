/**
 * What one connection's row says, in SLOTS rather than a sentence.
 *
 * ## Why this stopped being a sentence
 *
 * A single status sentence — facts joined with " · ": `9 models · api.anthropic.com · checked 2 minutes ago`,
 * `Couldn't list models · Missing credentials`, `Running · Nemo 12B loaded · 3
 * on disk`. In a 400px column every one of those truncated, and they truncated
 * from the right — which is exactly where the fact lives. The shipped panel read
 * `9 models · api.anthropic.com · checked 2 min…` and `Couldn't list models ·
 * Missing credentia…`, four rows deep, with nothing aligned to anything.
 *
 * A sentence is the wrong shape for a list. So the row now has four slots the
 * component places and never composes:
 *
 * - `label` — one or two words, beside the dot. The chip.
 * - `detail` — under the NAME: the host normally, the failure when there is one.
 * - `metric` — the right-hand column: `9 models`, `7.0 GB`, `idle 4 min`.
 * - `action` — at most one button, and only where there is exactly one obvious
 *   thing to do.
 *
 * Nothing truncates, because nothing is free-form; and the eye scans a column
 * of states instead of reading four sentences.
 *
 * ## Five states, and only ONE of them is red
 *
 * The old module had a `warning` dot doing two unrelated jobs, so a connection
 * created ten seconds ago with no API key yet rendered exactly like one whose
 * key had been rejected. On a fresh install that meant two red rows and two
 * **Fix** buttons out of four — the app reporting as broken the two things the
 * person simply had not got to. That is the single loudest piece of false alarm
 * in the panel and this split is what removes it.
 *
 * | state | colour | means |
 * |---|---|---|
 * | `ready` | success | it works right now |
 * | `idle` | quiet | set up, nothing wrong, not currently running |
 * | `unfinished` | primary | it is waiting on YOU — a key, a binary, a model, a refresh |
 * | `busy` | warning | something is in flight; ask again shortly |
 * | `broken` | error | it was finished and it still failed |
 *
 * ⚠ `unfinished` is gold, not red, and it is never an alarm. It covers both "you
 * have not typed the key yet" and "three models the host listed before are gone"
 * — different sentences, one colour, because in both the next move is the
 * person's and nothing is on fire.
 *
 * ⚠ **A silent fact is left out of the row, never guessed.** Every fact here
 * comes from an event the server may not answer: a manager switched off, a host
 * that is down, a build whose handler is not written yet. Where the answer has
 * not come the slot is empty and the state falls back to `idle`, which claims
 * nothing. A row that said "Stopped" because nothing had answered would be a row
 * offering to Start something already running.
 *
 * ⚠ Pure, and injected with its formatters. `timeAgo` and `now` come in as
 * arguments so "checked 3 minutes ago" can be asserted in a test rather than
 * described in a comment.
 */
import { needsCredential } from "$lib/shared/connections/credentials"
import {
	idleMinutes,
	type KcppStatus,
	type LaneStatus,
	type OllamaStatus
} from "./endpointStatus"
import type { KcppInstallState } from "./managedConnectionView"
import type { EndpointKind } from "./modelManagement"

/**
 * How a connection is doing. See the table above; the component maps these to
 * colour roles and nothing else in the app invents a sixth.
 */
export type ConnectionState =
	| "ready"
	| "idle"
	| "unfinished"
	| "busy"
	| "broken"

/** The one action a row may offer. The row itself is what opens the connection. */
export interface RowStatusAction {
	verb: "stop" | "start" | "start-offline" | "fix" | "refresh" | "setup"
	label: string
	/** A `@lucide/svelte` export name, resolved by the component. */
	icon: string
	emphasis: "ghost" | "tonal"
}

export interface RowStatus {
	state: ConnectionState
	/** One or two words, beside the dot. Never a sentence. */
	label: string
	/** Line two under the NAME — the host, or what went wrong. */
	detail: string | null
	/** The right-hand column — a count, a size, an idle time. */
	metric: string | null
	action: RowStatusAction | null
}

export interface RowModel {
	name: string
	model: string
	missingSince: string | null
	local?: {
		state?: "not_downloaded" | "downloading" | "on_disk" | "error"
		percent?: number
	}
}

export interface RowConnection {
	id: number
	name?: string | null
	type?: string | null
	preset?: string | null
	baseUrl?: string | null
	/** Whether a credential is stored. Absent means the server did not say. */
	hasCredential?: boolean
	models: readonly RowModel[]
	modelsSync: { at: string | null; error: string | null }
}

export interface RowStatusFacts {
	kind: EndpointKind
	/** The managed process, or null when it has not answered. */
	kcpp?: KcppStatus | null
	ollama?: OllamaStatus | null
	lane?: LaneStatus | null
	/**
	 * The managed KoboldCPP install, read by `kcppInstallState` — the SAME
	 * reading its view makes, so the row and the view it opens cannot
	 * disagree. Undefined for every other kind.
	 */
	kcppInstall?: KcppInstallState
	/** A forced listing is in flight for this connection. */
	syncing?: boolean
	/** "3 minutes ago". Injected so the row is testable. */
	timeAgo?: (iso: string) => string
	now?: number
}

/** Just the host — a URL's scheme and trailing slash are noise in a row. */
export function hostOf(baseUrl: string | null | undefined): string {
	const raw = baseUrl?.trim()
	if (!raw) return ""
	try {
		const u = new URL(raw)
		return (
			u.host + (u.pathname !== "/" ? u.pathname.replace(/\/$/, "") : "")
		)
	} catch {
		return raw
	}
}

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`

const STOP: RowStatusAction = {
	verb: "stop",
	label: "Stop",
	icon: "Square",
	emphasis: "ghost"
}
const START: RowStatusAction = {
	verb: "start",
	label: "Start",
	icon: "Play",
	emphasis: "tonal"
}
/**
 * Start for an install that is switched off: the press turns the manager back
 * on AND starts it, in one server call (`koboldcpp:startSubprocess` with
 * `enable`). Its own verb so the row's handler can say which.
 */
const START_OFFLINE: RowStatusAction = {
	verb: "start-offline",
	label: "Start",
	icon: "Play",
	emphasis: "tonal"
}
const FIX: RowStatusAction = {
	verb: "fix",
	label: "Fix",
	icon: "TriangleAlert",
	emphasis: "tonal"
}
const REFRESH: RowStatusAction = {
	verb: "refresh",
	label: "Refresh",
	icon: "RefreshCw",
	emphasis: "ghost"
}
const SET_UP: RowStatusAction = {
	verb: "setup",
	label: "Set up",
	icon: "ArrowRight",
	emphasis: "tonal"
}

export function connectionRowStatus(
	connection: RowConnection,
	facts: RowStatusFacts
): RowStatus {
	const missing = connection.models.filter(
		(m) => m.missingSince != null
	).length

	if (facts.syncing)
		return {
			state: "busy",
			label: "Checking",
			detail: hostOf(connection.baseUrl) || null,
			metric: null,
			action: null
		}

	switch (facts.kind) {
		case "koboldcpp-managed":
			return managedStatus(connection, facts, missing)
		case "ollama":
			return ollamaStatus(connection, facts, missing)
		case "onnx-embeddings":
		case "onnx-entities":
			return onnxStatus(connection, facts)
		default:
			return apiStatus(connection, facts, missing)
	}
}

/**
 * The managed KoboldCPP: a process this pub started, and the files it has.
 *
 * "Stopped" is `idle`, not a fault and not an alarm — the manager starts the
 * process on the first request, which is the whole point of it being managed. A
 * CRASHED process is the fault, and it is the one that is red.
 */
function managedStatus(
	connection: RowConnection,
	facts: RowStatusFacts,
	missing: number
): RowStatus {
	const onDisk = plural(connection.models.length, "on disk", "on disk")
	switch (facts.kcppInstall) {
		case "loading":
			// Settings have not arrived. "Not installed" here was a guess, and
			// it was the guess the row showed on every page load.
			return {
				state: "busy",
				label: "Checking",
				detail: null,
				metric: null,
				action: null
			}
		case "not-installed":
			return {
				state: "unfinished",
				label: "Not installed",
				detail: null,
				metric: null,
				action: SET_UP
			}
		case "offline":
			// Switched off with the install kept — the files are still here, so
			// the count is still true, and Start is the one press that helps.
			return {
				state: "idle",
				label: "Offline",
				detail: "Switched off",
				metric: onDisk,
				action: START_OFFLINE
			}
		case "no-mode":
		case "no-binary":
			// The view is on a setup stage and the process status, whatever it
			// says, is about nothing yet.
			return {
				state: "unfinished",
				label: "Not set up",
				detail: "Choose how to run it",
				metric: null,
				action: SET_UP
			}
	}
	const run = facts.kcpp?.run ?? null
	const loaded = facts.kcpp?.loadedFiles?.[0] ?? null
	switch (run) {
		case "running":
			return {
				state: "ready",
				label: "Running",
				// The loaded file is the most useful thing a running process can
				// say, and it goes where the host would: under the name.
				detail: loaded ?? "On this machine",
				metric: onDisk,
				action: STOP
			}
		case "starting":
			return {
				state: "busy",
				label: "Starting",
				detail: "On this machine",
				metric: onDisk,
				action: null
			}
		case "stopping":
			return {
				state: "busy",
				label: "Stopping",
				detail: "On this machine",
				metric: onDisk,
				action: null
			}
		case "crashed":
			return {
				state: "broken",
				label: "Crashed",
				detail: "It stopped on its own",
				metric: onDisk,
				action: START
			}
		case "stopped":
			return {
				state: "idle",
				label: "Stopped",
				detail: "Starts on first use",
				metric: onDisk,
				action: START
			}
		default:
			// Nothing has answered. Say only what the list row knows.
			return {
				state: missing ? "unfinished" : "idle",
				label: missing
					? plural(missing, "file") + " gone"
					: "Installed",
				detail: "On this machine",
				metric: onDisk,
				action: missing ? REFRESH : null
			}
	}
}

function ollamaStatus(
	connection: RowConnection,
	facts: RowStatusFacts,
	missing: number
): RowStatus {
	const host = hostOf(connection.baseUrl) || null
	const models = plural(connection.models.length, "model")
	// Configured and not answering. Red is right: nothing routed here will run,
	// and unlike a missing key there is nothing half-done about it.
	if (facts.ollama?.reachable === false)
		return {
			state: "broken",
			label: "Not reachable",
			detail: host,
			metric: null,
			action: FIX
		}
	if (facts.ollama?.reachable)
		return {
			state: "ready",
			label: "Running",
			detail: host,
			metric: models,
			action: missing ? REFRESH : null
		}
	return {
		state: missing ? "unfinished" : "idle",
		label: missing ? plural(missing, "model") + " gone" : "Not checked",
		detail: host,
		metric: models,
		action: missing ? REFRESH : null
	}
}

/**
 * A local ONNX endpoint: one model active app-wide, and files on this disk.
 *
 * The downloading clause comes off the ROW rather than the lane, because a file
 * can be arriving for a model that is not the active one.
 */
function onnxStatus(
	connection: RowConnection,
	facts: RowStatusFacts
): RowStatus {
	const downloading = connection.models.find(
		(m) => m.local?.state === "downloading"
	)
	if (downloading) {
		const percent = downloading.local?.percent
		return {
			state: "busy",
			label: "Downloading",
			detail: downloading.name,
			metric: percent == null ? null : `${Math.round(percent)}%`,
			action: null
		}
	}
	const onDisk = connection.models.filter(
		(m) => m.local?.state === "on_disk"
	).length
	const lane = facts.lane
	if (!lane?.modelId)
		return {
			state: "unfinished",
			label: "Nothing active",
			detail: onDisk
				? plural(onDisk, "model") + " on disk"
				: "On this machine",
			metric: null,
			action: SET_UP
		}
	const active =
		connection.models.find((m) => m.model === lane.modelId)?.name ??
		lane.modelId
	if (lane.loaded) {
		const minutes = idleMinutes(lane.lastUsedAt, facts.now)
		return {
			state: "ready",
			label: "Active",
			detail: active,
			metric: minutes == null ? "loaded" : `idle ${minutes} min`,
			action: null
		}
	}
	const row = connection.models.find((m) => m.model === lane.modelId)
	if (row?.local?.state === "on_disk")
		return {
			state: "ready",
			label: "Active",
			detail: active,
			metric: "on disk",
			action: null
		}
	return {
		state: "unfinished",
		label: "Not downloaded",
		detail: active,
		metric: null,
		action: FIX
	}
}

/**
 * Everything this pub merely talks to: a cloud API, a llama.cpp of your own, an
 * OpenAI-compatible host.
 *
 * ⚠ The credential check comes FIRST, before the listing error, and that
 * ordering is the point. A connection with no key has a listing error too — of
 * course it does, nobody can list anything without one — and reporting that
 * error is reporting a symptom of a thing the person has not done yet. Ask
 * whether it is finished before asking whether it works.
 */
function apiStatus(
	connection: RowConnection,
	facts: RowStatusFacts,
	missing: number
): RowStatus {
	const host = hostOf(connection.baseUrl) || null

	if (needsCredential(connection))
		return {
			state: "unfinished",
			label: "Needs a key",
			detail: host,
			metric: null,
			action: SET_UP
		}

	if (connection.modelsSync.error)
		return {
			state: "broken",
			label: "Not working",
			// The host's own words, not a rewrite of them: the raw line is what
			// somebody searches for when they are stuck.
			detail: connection.modelsSync.error,
			metric: null,
			action: FIX
		}

	if (missing)
		return {
			state: "unfinished",
			label: `${missing} no longer listed`,
			detail: host,
			metric: plural(connection.models.length, "model"),
			action: REFRESH
		}

	if (!connection.modelsSync.at)
		return {
			state: "idle",
			label: "Not tested",
			detail: host,
			metric: connection.models.length
				? plural(connection.models.length, "model")
				: null,
			action: null
		}

	if (!connection.models.length)
		return {
			state: "unfinished",
			label: "No models",
			detail: host,
			metric: null,
			action: REFRESH
		}

	return {
		state: "ready",
		label: "Ready",
		detail: host,
		metric: plural(connection.models.length, "model"),
		action: null
	}
}

/**
 * The colour role a state wears. One place, so the index row, the connection
 * view and the overview cannot drift apart.
 *
 * ⚠ `idle` is `quiet`, never `success`. A stopped managed runtime is not
 * unhealthy and a green dot beside it would be a claim that it is answering.
 */
export function stateTone(
	state: ConnectionState
): "ok" | "quiet" | "primary" | "warning" | "error" {
	switch (state) {
		case "ready":
			return "ok"
		case "idle":
			return "quiet"
		case "unfinished":
			return "primary"
		case "busy":
			return "warning"
		case "broken":
			return "error"
	}
}
