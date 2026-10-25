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
 * ## The connection state: THE scale, five words, only ONE of them red
 *
 * `ConnectionState` is the one scale for "can it do the thing" across the
 * Connections view: the index row, the connection view's status line and next
 * step, the status strip, the job tiles and the readiness rows all speak it,
 * and wear its colour through `CONNECTION_STATE_TONE` (classes:
 * `CONNECTION_STATE_DOT`, `CONNECTION_STATE_TEXT`). Nothing invents a sixth
 * word, and no state gets a second colour.
 *
 * | state | colour role | means |
 * |---|---|---|
 * | `ready` | success | it works right now |
 * | `idle` | surface (quiet) | set up, nothing wrong, not currently running |
 * | `unfinished` | primary (gold) | it is waiting on YOU — a key, a binary, a model, a pick, a refresh |
 * | `busy` | warning | something is in flight; ask again shortly |
 * | `broken` | error | it was finished and it still failed |
 *
 * ⚠ `unfinished` is gold, not red, and it is never an alarm. A connection with
 * no API key yet is unfinished; one whose key the host rejected is broken. It
 * covers both "you have not typed the key yet" and "three models the host
 * listed before are gone" — different sentences, one colour, because in both
 * the next move is the person's and nothing is on fire.
 *
 * **Needs attention** is `broken` and `unfinished` together — red and gold,
 * exactly what the words say (`needsAttention`).
 *
 * ## A ROW wears its state quietly (★R2, PLAN-0-5-polish-parity L4.1, 2026-10-24)
 *
 * The walk's Connections index was eight rows of bold red "Not working" /
 * "Not reachable" with a gold Fix on each: nothing was quiet, so nothing was
 * loud. On the index (and the admin changelist) a state is a 6px dot and 13px
 * muted words (`rowStatusClasses`); the dot carries the colour above, and RED —
 * red words, a red dot, a 3px error bar — is kept for one case: a `broken`
 * connection that fills a default loadout (`RowStatus.blocked`), the same
 * reading as the admin Overview's **Needs you** (`loadoutsFilledBy`). A broken
 * connection nothing relies on gets the quiet dot; its words still say what
 * failed. **Fix** is tonal surface except on a blocked row, where it is the
 * row's one filled primary; **Start** is filled on the row that can start.
 * The scale itself is unchanged — `CONNECTION_STATE_DOT` / `_TEXT` still speak
 * it for the job tiles, the strip and the readiness rows, where every pair is
 * in use by definition.
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
import { loadoutsFilledBy } from "$lib/shared/loadouts/loadoutsFilledBy"
import {
	idleMinutes,
	type KcppStatus,
	type LaneStatus,
	type OllamaStatus
} from "./endpointStatus"
import type { KcppInstallState } from "./managedConnectionView"
import type { EndpointKind } from "./modelManagement"
import { servesChat } from "./readiness"

/** The five connection states, in the table's order. */
export const CONNECTION_STATES = [
	"ready",
	"idle",
	"unfinished",
	"busy",
	"broken"
] as const

/**
 * How a connection — or a job's pair, or the chat strip — is doing. See the
 * table above; nothing else in the app invents a sixth.
 */
export type ConnectionState = (typeof CONNECTION_STATES)[number]

/** The Skeleton colour role a connection state wears. */
export type ConnectionStateTone =
	| "success"
	| "surface"
	| "primary"
	| "warning"
	| "error"

/**
 * The colour role per state. One place, so the index row, the connection
 * view, the strip and the tiles cannot drift apart.
 *
 * ⚠ `idle` is `surface`, never `success`: a stopped managed runtime is not
 * unhealthy, and a green dot beside it would claim it is answering.
 * `unfinished` is `primary` — gold under the house theme (STYLE-GUIDE §2.2).
 */
export const CONNECTION_STATE_TONE: Record<
	ConnectionState,
	ConnectionStateTone
> = {
	ready: "success",
	idle: "surface",
	unfinished: "primary",
	busy: "warning",
	broken: "error"
}

/**
 * The state's own word, for where the scale itself is named — a dot's title,
 * a legend. A row says something more particular beside its dot ("Needs a
 * key", "Crashed"); this is the word for the colour.
 */
export const CONNECTION_STATE_LABEL: Record<ConnectionState, string> = {
	ready: "Ready",
	idle: "Idle",
	unfinished: "Unfinished",
	busy: "Busy",
	broken: "Broken"
}

/**
 * A state's dot, as classes. Whole literals, so Tailwind's scanner sees each
 * one; `busy` pulses because something is moving.
 */
export const CONNECTION_STATE_DOT: Record<ConnectionState, string> = {
	ready: "bg-success-500",
	idle: "bg-surface-400-600",
	unfinished: "bg-primary-500",
	busy: "bg-warning-500 animate-pulse",
	broken: "bg-error-500"
}

/** A state's word, as text classes that reach 4.5:1 on a panel (§2.5). */
export const CONNECTION_STATE_TEXT: Record<ConnectionState, string> = {
	ready: "text-success-800 dark:text-success-300",
	idle: "text-surface-600-400",
	unfinished: "text-primary-900 dark:text-primary-300",
	busy: "text-warning-800 dark:text-warning-300",
	broken: "text-error-600-400"
}

/**
 * Whether a state is one a person has something to do about: `broken` (red)
 * or `unfinished` (gold). The index's **Needs attention** filter and its
 * count are this, over each row's state.
 */
export function needsAttention(state: ConnectionState): boolean {
	return state === "broken" || state === "unfinished"
}

/** The one action a row may offer. The row itself is what opens the connection. */
export interface RowStatusAction {
	verb:
		| "stop"
		| "start"
		| "start-offline"
		| "fix"
		| "refresh"
		| "setup"
		| "choose"
	label: string
	/** A `@lucide/svelte` export name, resolved by the component. */
	icon: string
	/**
	 * `filled` is the row's one filled primary (Start on the row that can
	 * start; Fix on a blocked row); `tonal` is tonal SURFACE, never gold
	 * (★R2); `ghost` is quiet text.
	 */
	emphasis: "ghost" | "tonal" | "filled"
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
	/**
	 * `broken` AND this connection fills a default loadout — the Admin
	 * **Needs you** case, and the only row drawn red. Present only when true.
	 */
	blocked?: true
}

export interface RowModel {
	name: string
	model: string
	missingSince: string | null
	enabled?: boolean
	/** The transforms the server judges this model able to serve. */
	satisfiableCapabilities?: readonly string[]
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
	/** `problem`: something to fix on the server, in its own words (a ComfyUI's missing nodes). */
	modelsSync: { at: string | null; error: string | null; problem?: string | null }
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
	/**
	 * What the pub's defaults say about this connection, read by
	 * `rowDefaults` from the summary the status strip reads too, so the row
	 * and the strip cannot disagree. Absent means not answered: the row then
	 * says only what its own listing says.
	 */
	defaults?: RowDefaults
	/** A forced listing is in flight for this connection. */
	syncing?: boolean
	/** "3 minutes ago". Injected so the row is testable. */
	timeAgo?: (iso: string) => string
	now?: number
}

/** See `RowStatusFacts.defaults`. */
export interface RowDefaults {
	/** Chat's default resolves to a model, on any connection. */
	chatSet: boolean
	/**
	 * The pub's capability defaults as registered, read by
	 * `loadoutsFilledBy` to tell whether a broken row is `blocked`. Absent
	 * means not answered, and no row is drawn red.
	 */
	capabilityDefaults?: Readonly<
		Record<string, { connectionId?: number | null } | null | undefined>
	>
}

/**
 * `RowDefaults`, from the defaults summary's entries (and, for the red
 * case, the registered defaults themselves).
 *
 * Chat reads resolved pairs only (`set`), the same reading the strip makes: a
 * registration naming just the endpoint (§10) is not a default, so it does
 * not answer chat. Whether a connection FILLS a loadout reads the endpoint
 * half, as Needs you does (`loadoutsFilledBy`).
 */
export function rowDefaults(
	entries: readonly { capability: string; set: boolean }[],
	capabilityDefaults?: RowDefaults["capabilityDefaults"]
): RowDefaults {
	return {
		chatSet: entries.some((e) => e.capability === "text->text" && e.set),
		...(capabilityDefaults ? { capabilityDefaults } : {})
	}
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
	emphasis: "filled"
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
	emphasis: "filled"
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
/**
 * A listed connection waiting on the person's pick. Opens the connection,
 * like Set up: its Models tab is where a model is chosen (**Use in Reply**).
 */
const CHOOSE: RowStatusAction = {
	verb: "choose",
	label: "Choose",
	icon: "ArrowRight",
	emphasis: "tonal"
}

export function connectionRowStatus(
	connection: RowConnection,
	facts: RowStatusFacts
): RowStatus {
	const status = baseRowStatus(connection, facts)
	if (
		status.state !== "broken" ||
		!loadoutsFilledBy(facts.defaults?.capabilityDefaults, connection.id)
			.length
	)
		return status
	// Broken, and a loadout runs on it: the one red row, and its Fix the
	// row's one filled primary.
	return {
		...status,
		blocked: true,
		action:
			status.action?.verb === "fix"
				? { ...status.action, emphasis: "filled" }
				: status.action
	}
}

/**
 * The classes a ROW draws its state with — the index row, the index card and
 * the admin changelist (see the header's "A ROW wears its state quietly").
 *
 * `text` is the words beside the dot; `edge` the 3px error bar a blocked row
 * carries on its leading edge (empty otherwise). Whole literals, so
 * Tailwind's scanner sees each one.
 */
export function rowStatusClasses(status: RowStatus): {
	dot: string
	text: string
	edge: string
} {
	if (status.blocked)
		return {
			dot: "bg-error-500",
			text: "text-error-600-400",
			edge: "shadow-[inset_3px_0_0_var(--color-error-500)]"
		}
	return {
		dot:
			status.state === "broken"
				? CONNECTION_STATE_DOT.idle
				: CONNECTION_STATE_DOT[status.state],
		text: "text-surface-600-400",
		edge: ""
	}
}

/** The button classes for a row's action, by its emphasis (★R2). */
export function rowActionClass(
	emphasis: RowStatusAction["emphasis"]
): string {
	switch (emphasis) {
		case "filled":
			return "preset-filled-primary-500"
		case "tonal":
			return "preset-tonal-surface"
		case "ghost":
			return "hover:preset-tonal-surface text-surface-600-400"
	}
}

function baseRowStatus(
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
	// The listing's own failure, as an API row reads it: the host answered
	// its version but couldn't list (or the last listing failed), and a
	// green "Running" over a model list that didn't arrive is the row lying.
	if (connection.modelsSync.error)
		return {
			state: "broken",
			label: "Not working",
			detail: connection.modelsSync.error,
			metric: null,
			action: FIX
		}
	// Up and listed, and chat has no model anywhere — the same "Pick a
	// model" an API row says (see `apiStatus`), so an Ollama is never the one
	// row claiming readiness on an install that cannot reply.
	if (
		!missing &&
		facts.defaults &&
		!facts.defaults.chatSet &&
		servesChat(connection)
	)
		return {
			state: "unfinished",
			label: "Pick a model",
			detail: host,
			metric: models,
			action: CHOOSE
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
	// ⚠ One lane per family, app-wide: its model belongs to whichever
	// connection the star resolved to. Another connection's star says
	// nothing about this row — it is neither Active nor missing a file, just
	// not the one in use. A lane that did not say whose it is (connectionId
	// absent) is read the old way, by model identity.
	if (
		lane?.modelId &&
		lane.connectionId != null &&
		lane.connectionId !== connection.id
	)
		return {
			state: "idle",
			label: "Not in use",
			detail: onDisk
				? plural(onDisk, "model") + " on disk"
				: "On this machine",
			metric: null,
			action: null
		}
	if (!lane?.modelId)
		return {
			state: "unfinished",
			label: "Loadout unfilled",
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
			label: "In use",
			detail: active,
			metric: minutes == null ? "loaded" : `idle ${minutes} min`,
			action: null
		}
	}
	const row = connection.models.find((m) => m.model === lane.modelId)
	if (row?.local?.state === "on_disk")
		return {
			state: "ready",
			label: "In use",
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

	// A ComfyUI whose workflow names nodes or a checkpoint it lacks (§4.9):
	// the next move is the person's, in ComfyUI — unfinished, never red.
	if (connection.modelsSync.problem && !connection.modelsSync.error)
		return {
			state: "unfinished",
			label: "Missing on server",
			detail: connection.modelsSync.problem,
			metric: null,
			action: FIX
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

	// Listed, able to chat, and chat has no model anywhere: the one step left
	// is the person's pick. A green Ready here sat beside the strip's
	// "Sessions can't reply yet" (walk 2026-10-06) — a row claiming readiness
	// on an install that cannot reply. Whatever else it serves, every row
	// that could answer chat says so until chat is answered somewhere.
	if (facts.defaults && !facts.defaults.chatSet && servesChat(connection))
		return {
			state: "unfinished",
			label: "Pick a model",
			detail: host,
			metric: plural(connection.models.length, "model"),
			action: CHOOSE
		}

	return {
		state: "ready",
		label: "Ready",
		detail: host,
		metric: plural(connection.models.length, "model"),
		action: null
	}
}
