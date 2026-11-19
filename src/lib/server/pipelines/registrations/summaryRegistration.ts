/**
 * 🚧 **Which registration summarizes** (programme 3.8): the one reader every summary path asks — a world or
 * character summary, a scene's, the close-out — so the registration a summary kind runs is found by what a genre
 * *registers* on a summarize action, never by a spec id typed in core. It is not the entry provenance value
 * `summarizer`, nor the `utils/summarizer` module.
 */
import { closeOutAction } from "@serene-pub/core-catalog"
import { minAgeOf, parseActionIdentity, type EffectiveRegistration } from "@serene-pub/sdk"
import { effectiveRegistrations } from "$lib/server/pipelines/registrations/resolve"
import { RULES_ACTION_SPEC } from "$lib/server/rulesets/rulesActions"

/** What a summary registration summarizes: world lore, character lore, a scene, or a close-out. */
export type SummaryRegistrationKind = "world" | "character" | "scene" | "close-out"

export interface SummaryRegistration {
	registration: EffectiveRegistration
	/** The spec the registration runs. */
	spec: string
	/** The registration's key. */
	key: string
	/** The registration's summary depth (`minAgeOf`). */
	minAge: number
}

/** Core's own action identity per kind: the exact identity a registration on core's action carries. */
const CORE_IDENTITY: Record<SummaryRegistrationKind, string> = {
	world: "core:spec/summarize-world#summarize-world",
	character: "core:spec/summarize-character#summarize-character",
	scene: "core:spec/summarize-scene#summarize-scene",
	"close-out": `core:spec/summarize-scene#${closeOutAction.key}`
}

/**
 * **The pick rule.** Candidates are the `action` registrations whose action key is `summarize-<kind>` (or
 * `closeOutAction.key`), except those on the rules-action spec (a ruleset is not a genre); a close-out candidate
 * must also have a mode other than "off" (applied before the pick, so a switched-off one never shadows a live one),
 * while a summarize candidate is kept whatever its mode. Of the candidates, a registration on core's own action for
 * the kind wins wherever it sits; otherwise the first in effective order (a genre's registration on its own spec's
 * action). Null when none.
 */
export function summaryRegistrationIn(
	regs: readonly EffectiveRegistration[],
	kind: SummaryRegistrationKind
): SummaryRegistration | null {
	const key = kind === "close-out" ? closeOutAction.key : `summarize-${kind}`
	const candidates: { reg: EffectiveRegistration; identity: string }[] = []
	for (const r of regs) {
		if (r.trigger.family !== "action") continue
		const action = (r.trigger as { action?: unknown }).action
		const parsed = parseActionIdentity(action)
		if (!parsed || parsed.key !== key || parsed.specSlug === RULES_ACTION_SPEC) continue
		if (kind === "close-out" && r.mode === "off") continue
		candidates.push({ reg: r, identity: action as string })
	}
	const core = CORE_IDENTITY[kind]
	const found = (candidates.find((c) => c.identity === core) ?? candidates[0])?.reg
	return found ? { registration: found, spec: found.pipeline, key: found.key, minAge: minAgeOf(found) } : null
}

/** The session's summary registration of `kind` over its effective registrations; null when it has none. */
export async function summaryRegistrationOf(
	db: Db,
	sessionId: number,
	kind: SummaryRegistrationKind
): Promise<SummaryRegistration | null> {
	return summaryRegistrationIn((await effectiveRegistrations(db, sessionId))?.effective ?? [], kind)
}
