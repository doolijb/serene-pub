/**
 * What an API connection's view SAYS above its form, decided away from the
 * markup (concept ruling, U6).
 *
 * The view for a host this pub merely talks to — OpenRouter, Anthropic, a
 * self-hosted llama.cpp — never opens on the form. The form is the *how*,
 * and the first thing a person wants is the *whether*: does it answer, do its
 * models still list, when was that last true. The status card says that in
 * one dot, one word and one sentence; the models card says how many and
 * offers the two actions it needs (Refresh, Add by name).
 *
 * ⚠ A silent fact is left out, never guessed — the rule every row in this
 * folder keeps. A test that has not run this visit is not a failure; a listing
 * nobody has asked for is "Not checked yet", not "unreachable".
 *
 * The dot and the next step's colour are a `ConnectionState`, the one scale
 * the index row speaks (`connectionRowStatus.ts`): a line that has said
 * nothing yet is `idle`, a check in flight `busy`, any failure `broken`.
 */

import type { ConnectionState } from "./connectionRowStatus"
import { listsAvailableModels } from "./modelManagement"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

export interface LastTest {
	ok: boolean
	error: string | null
	/** Epoch ms, when the reply landed. */
	at: number
}

export interface ChromeFacts {
	/** The most recent `connections:test` reply for THIS connection this visit. */
	lastTest: LastTest | null
	/** A test is in flight. */
	testing: boolean
	/** A forced listing is in flight. */
	syncing: boolean
	/**
	 * `problem`: something to fix ON the server, in its own words — a
	 * ComfyUI whose workflow names nodes or a checkpoint it lacks (§4.9).
	 */
	modelsSync: { at: string | null; error: string | null; problem?: string | null }
	modelCount: number
	missingCount: number
	/** "3 minutes ago". Injected so the sentence is testable. */
	timeAgo: (iso: string) => string
	/** For "just now" on a test that ran this visit. Injected for the same reason. */
	now?: number
}

export interface StatusLine {
	/** The dot's colour, on the one scale (`CONNECTION_STATE_DOT`). */
	dot: ConnectionState
	word: string
	sentence: string
}

/**
 * The status card's line. A test this visit outranks the listing — it is the
 * newer fact and the person just pressed for it; otherwise the listing is the
 * only reachability evidence there is, and it says so honestly.
 */
export function statusLine(facts: ChromeFacts): StatusLine {
	if (facts.testing)
		return { dot: "busy", word: "Testing", sentence: "Asking the host…" }
	// 🚧 It answers, but a workflow names what it lacks (§4.9): the next move
	// is the person's, in ComfyUI — unfinished, never red. A failed test is
	// the newer, worse fact and outranks it.
	if (facts.modelsSync.problem && !(facts.lastTest && !facts.lastTest.ok))
		return {
			dot: "unfinished",
			word: "Missing on server",
			sentence: facts.modelsSync.problem
		}
	if (facts.lastTest) {
		if (facts.lastTest.ok)
			return {
				dot: "ready",
				word: "Reachable",
				sentence: `Answered ${agoMs(facts.lastTest.at, facts.now)}`
			}
		return {
			dot: "broken",
			word: "Not reachable",
			sentence: facts.lastTest.error ?? "The host did not answer"
		}
	}
	if (facts.syncing)
		return {
			dot: "busy",
			word: "Checking",
			sentence: "Asking the host for its models…"
		}
	// A failed listing is `broken`, the row's own reading of the same fact
	// ("Not working"). The card shows "Needs an API key" in its place while
	// a key is still missing, so this never reports that symptom.
	if (facts.modelsSync.error)
		return {
			dot: "broken",
			word: "Couldn't list models",
			sentence: facts.modelsSync.error
		}
	if (facts.modelsSync.at)
		return {
			dot: "ready",
			word: "Listed",
			sentence: `Models checked ${facts.timeAgo(facts.modelsSync.at)}`
		}
	return {
		dot: "idle",
		word: "Not checked yet",
		sentence: "Test it, or ask for its models"
	}
}

// ── Next step ────────────────────────────────────────────────────────────────

export interface NextStepFacts extends ChromeFacts {
	/** The type wants a key and none is saved (`needsCredential`). */
	keyMissing: boolean
	/** A key is saved — a failure with one is broken, without one unfinished. */
	hasCredential: boolean
	/** The draft differs from what is saved. */
	unsaved: boolean
	/** An enabled, still-listed model on THIS connection can serve chat. */
	servesChat: boolean
	/** The chat default, resolved (both halves); null while chat is unset. */
	chat: { onThisConnection: boolean; modelName: string } | null
}

/** A run of the sentence: plain words, or the name of a thing to find on screen. */
export type NextStepPart = string | { strong: string }

export interface NextStep {
	/**
	 * Its colour, on the one scale. `nextStep` says `unfinished` (gold),
	 * `broken` (red) or `ready` (green); it has no step for `idle` or `busy`.
	 */
	state: ConnectionState
	parts: readonly NextStepPart[]
	/** The same sentence, flat. */
	text: string
	/**
	 * The control the sentence names. `save` is the bar at the foot and `test`
	 * the card's own button, so neither draws a second one; `models` and
	 * `session` are buttons on the card's line.
	 */
	action?: "save" | "test" | "models" | "session"
}

function step(
	state: NextStep["state"],
	action: NextStep["action"],
	...parts: NextStepPart[]
): NextStep {
	const text = parts
		.map((p) => (typeof p === "string" ? p : p.strong))
		.join("")
	return { state, parts, text, action }
}

/**
 * The status card's second line: the ONE thing to do next here, naming the
 * control by the word on it (plan 2026-10-06 §B).
 *
 * In order — the first that holds wins:
 *
 * 1. a key is wanted and the draft is clean → paste it, press **Save**;
 * 2. the draft differs from what is saved → press **Save**;
 * 3. the status line reports a failure → its words, then **Test again**
 *    (red with a saved key, gold without — the row's rule);
 * 4. it lists a chat model and chat is unset → **Models**, **Use in Reply**;
 * 5. it is the chat default → which model replies, and **Start a session**;
 * 6. otherwise nothing: the status line has said it all.
 *
 * ⚠ Save, not Test, is what clears "Needs an API key". Test sends the draft,
 * so it can pass while the card still says a key is missing — the shipped
 * "then press Test" told a person to do the one thing that changes nothing.
 *
 * ⚠ The failure is read off `statusLine`, not off `modelsSync` alone, so the
 * two lines never disagree: a test that passed this visit outranks a stale
 * listing error there, and therefore here; a check in flight is not a failure.
 */
export function nextStep(facts: NextStepFacts): NextStep | null {
	if (facts.keyMissing && !facts.unsaved)
		return step(
			"unfinished",
			"save",
			"Paste your API key below, then press ",
			{ strong: "Save" },
			"."
		)
	if (facts.unsaved)
		return step(
			"unfinished",
			"save",
			"Press ",
			{ strong: "Save" },
			" to keep these changes."
		)
	const line = statusLine(facts)
	if (line.dot === "broken")
		return step(
			facts.hasCredential ? "broken" : "unfinished",
			"test",
			`${withStop(line.sentence)} Check the key and press `,
			{ strong: "Test again" },
			"."
		)
	if (!facts.chat && facts.servesChat)
		return step(
			"unfinished",
			"models",
			"Pick a model under ",
			{ strong: "Models" },
			" and press ",
			{ strong: "Use in Reply" },
			"."
		)
	if (facts.chat?.onThisConnection)
		return step(
			"ready",
			"session",
			"Replies come from ",
			{ strong: facts.chat.modelName },
			"."
		)
	return null
}

function withStop(sentence: string): string {
	const s = sentence.trim()
	return /[.!?…]$/.test(s) ? s : `${s}.`
}

// ── The Models tab's list ────────────────────────────────────────────────────

/**
 * Whether the Models tab draws a filter box: past twelve models. OpenRouter
 * lists 500, and a list that long with no way to narrow it is the guessing
 * problem in its purest form; a filter over three models is a control for
 * nothing.
 */
export function showsModelsFilter(modelCount: number): boolean {
	return modelCount > 12
}

/** Whether a model passes the Models tab's filter: its identifier or its name. */
export function modelMatchesQuery(
	model: { model: string; name?: string | null },
	query: string
): boolean {
	const q = query.trim().toLowerCase()
	if (!q) return true
	return (
		model.model.toLowerCase().includes(q) ||
		(model.name ?? "").toLowerCase().includes(q)
	)
}

/**
 * The chat default first, then the host's own order.
 *
 * Its star chip said WHICH model replies; on a list of 500 it said so on row
 * 212. Only chat is pulled forward — it alone blocks play, and a list
 * re-sorted under every star would move under a person's pointer.
 */
export function chatDefaultFirst<T extends { id: number }>(
	models: readonly T[],
	chatModelId: number | null | undefined
): T[] {
	const i =
		chatModelId == null ? -1 : models.findIndex((m) => m.id === chatModelId)
	if (i <= 0) return [...models]
	return [models[i], ...models.slice(0, i), ...models.slice(i + 1)]
}

/** The models card's headline: the count, then how many its host stopped listing. */
export function modelsHeadline(
	facts: Pick<ChromeFacts, "modelCount" | "missingCount">
): string {
	const n = facts.modelCount
	const head = `${n} ${n === 1 ? "model" : "models"}`
	return facts.missingCount > 0
		? `${head} · ${facts.missingCount} no longer listed`
		: head
}

function agoMs(at: number, now = Date.now()): string {
	const s = Math.max(0, Math.round((now - at) / 1000))
	if (s < 10) return "just now"
	if (s < 60) return `${s}s ago`
	const m = Math.round(s / 60)
	if (m < 60) return `${m} min ago`
	return `${Math.round(m / 60)} h ago`
}

// ── Tabs ─────────────────────────────────────────────────────────────────────


/** One tab of an API connection's view. `icon` is a @lucide/svelte name. */
export interface ApiConnectionTab {
	value: "models" | "settings" | "workflows"
	label: string
	icon: string
}

/**
 * The tabs an API connection's view has.
 *
 * Owner ruling 2026-09-25: **every** connection has a Settings tab, and a
 * Models tab appears only where the API lists models a person can select
 * (`listsAvailableModels`). The managed runtimes and the local ONNX endpoints
 * add Get and Arriving on top; they build their own lists.
 *
 * Models first when present, because on a finished connection the models are
 * what a person came for — the form is how they got here.
 */
export function apiConnectionTabs(
	type: string | null | undefined
): ApiConnectionTab[] {
	const tabs: ApiConnectionTab[] = []
	if (listsAvailableModels(type))
		tabs.push({ value: "models", label: "Models", icon: "Package" })
	// 🚧 A ComfyUI draws with workflows (§4.12): their one home.
	if (type === CONNECTION_TYPE.COMFYUI)
		tabs.push({ value: "workflows", label: "Workflows", icon: "Workflow" })
	tabs.push({ value: "settings", label: "Settings", icon: "Settings" })
	return tabs
}

/**
 * Whether to draw the strip at all.
 *
 * ⚠ One tab is not a choice. A strip holding a single "Settings" tab is a
 * heading dressed as a control — it underlines itself and does nothing when
 * pressed — so a connection with only Settings shows its settings plainly.
 */
export function showsTabStrip(tabs: readonly { value: string }[]): boolean {
	return tabs.length > 1
}

/**
 * Which tab is on show.
 *
 * The one a person picked, while it still exists; otherwise **Settings when
 * the connection is unfinished** — a missing key is fixed on the form, and
 * landing on an empty Models tab to be told to go somewhere else is a wasted
 * press; otherwise the first.
 *
 * "While it still exists" matters: a type change can take the Models tab
 * away, and a remembered `"models"` must not leave the view showing nothing.
 */
export function activeApiTab(
	tabs: readonly { value: string }[],
	chosen: string | null | undefined,
	unfinished: boolean
): string {
	if (chosen && tabs.some((t) => t.value === chosen)) return chosen
	if (unfinished && tabs.some((t) => t.value === "settings")) return "settings"
	return tabs[0]?.value ?? "settings"
}
