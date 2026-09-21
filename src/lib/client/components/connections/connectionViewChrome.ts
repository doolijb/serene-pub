/**
 * What an API connection's view SAYS above its form, decided away from the
 * markup (concept ruling, U6).
 *
 * The view for a host this pub merely talks to — OpenRouter, Anthropic, a
 * self-hosted llama.cpp — used to open on the form. The form is the *how*,
 * and the first thing a person wants is the *whether*: does it answer, do its
 * models still list, when was that last true. The status card says that in
 * one dot, one word and one sentence; the models card says how many and
 * offers the two things the index used to hold for it (Refresh, Add by name).
 *
 * ⚠ A silent fact is left out, never guessed — the rule every row in this
 * folder keeps. A test that has not run this visit is not a failure; a listing
 * nobody has asked for is "Not checked yet", not "unreachable".
 */

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

/** "3 models · 1 no longer listed" — the models card's headline. */
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
