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
 */

import { listsAvailableModels } from "./modelManagement"

export type ChromeDot = "ok" | "pending" | "warning" | "error" | "quiet"

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
	modelsSync: { at: string | null; error: string | null }
	modelCount: number
	missingCount: number
	/** "3 minutes ago". Injected so the sentence is testable. */
	timeAgo: (iso: string) => string
	/** For "just now" on a test that ran this visit. Injected for the same reason. */
	now?: number
}

export interface StatusLine {
	dot: ChromeDot
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
		return { dot: "pending", word: "Testing", sentence: "Asking the host…" }
	if (facts.lastTest) {
		if (facts.lastTest.ok)
			return {
				dot: "ok",
				word: "Reachable",
				sentence: `Answered ${agoMs(facts.lastTest.at, facts.now)}`
			}
		return {
			dot: "error",
			word: "Not reachable",
			sentence: facts.lastTest.error ?? "The host did not answer"
		}
	}
	if (facts.syncing)
		return {
			dot: "pending",
			word: "Checking",
			sentence: "Asking the host for its models…"
		}
	if (facts.modelsSync.error)
		return {
			dot: "warning",
			word: "Couldn't list models",
			sentence: facts.modelsSync.error
		}
	if (facts.modelsSync.at)
		return {
			dot: "ok",
			word: "Listed",
			sentence: `Models checked ${facts.timeAgo(facts.modelsSync.at)}`
		}
	return {
		dot: "quiet",
		word: "Not checked yet",
		sentence: "Test it, or ask for its models"
	}
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
	value: "models" | "settings"
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
