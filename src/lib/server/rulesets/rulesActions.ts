/**
 * 🚧 **A ruleset's actions** (PLAN-rulesets-functions D6; owner's nine
 * additions (2), 2026-10-22) — the host's half.
 *
 * One generic pipeline runs every ruleset action: `core:spec/rules-action`,
 * entered through `core:inlet/rules-action@1` (`{ session, actor, function,
 * answer, aimedAt }`), its resolve step running the invokable function with
 * the answer (`resolve.ts` `invokeOf`), the shared resolve outlet applying
 * or proposing what it asked, writing the outcome block, queueing its events.
 *
 * Here: each **invokable** function of the session's ruleset becomes an
 * **action registration** of that pipeline — as summaries are the genre's —
 * one per function, its identity `<spec slug>#<function key>`, its label and
 * form the function header's (`jsonSchemaOf(fn, { part: 'invokable' })`).
 * A preset drops one, or sets its mode, by the registration's key like any
 * other. A fired action reads back to the inlet's payload
 * (`rulesActionPayload`).
 */

import { i18nText, jsonSchemaOf, registrationKeyOf, type I18n, type RegistrationDecl } from "@serene-pub/sdk"
import { functionUsesOf } from "./functionRun"

/** The generic pipeline every ruleset action runs (lane A2's spec). */
export const RULES_ACTION_SPEC = "core:spec/rules-action"
/** Its inlet. */
export const RULES_ACTION_INLET = "core:inlet/rules-action@1"

/** A function key as an action key: lowercase words joined by '-' (`skill.stealth` → `skill-stealth`). */
export const rulesActionKey = (fnKey: string): string =>
	fnKey
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "action"

/** One action a ruleset offers. */
export interface RulesAction {
	/** The action's identity: `<spec slug>#<key>`. */
	identity: string
	/** The function's key in the ruleset. */
	function: string
	label: I18n
	description?: I18n
	/** The form its answer is asked in, as JSON Schema (empty object: nothing to ask). */
	form: Record<string, unknown>
}

/** 🚧 The actions a ruleset offers — each invokable function it uses, in its order. */
export function rulesActionsOf(ruleset: { id: string } & object, spec: string = RULES_ACTION_SPEC): RulesAction[] {
	const out: RulesAction[] = []
	const seen = new Set<string>()
	for (const use of functionUsesOf(ruleset)) {
		const inv = use.decl?.invokable
		if (!inv) continue
		const key = rulesActionKey(use.key)
		if (seen.has(key)) continue
		seen.add(key)
		out.push({
			identity: `${spec}#${key}`,
			function: use.key,
			label: inv.label,
			...(inv.description !== undefined ? { description: inv.description } : {}),
			form: jsonSchemaOf(use.decl!, { part: "invokable" }) as Record<string, unknown>
		})
	}
	return out
}

/**
 * 🚧 Each action as a registration of the rules-action pipeline — the
 * layer a genre's defaults sit in, so a preset's or a session's change
 * (drop, mode) merges over it by key.
 */
export function rulesActionRegistrations(ruleset: { id: string } & object, spec: string = RULES_ACTION_SPEC): RegistrationDecl[] {
	return rulesActionsOf(ruleset, spec).map((a) => {
		const trigger = { family: "action" as const, action: a.identity }
		return Object.freeze({
			key: registrationKeyOf(trigger, spec),
			trigger: Object.freeze(trigger),
			pipeline: spec,
			label: a.label
		}) as RegistrationDecl
	})
}

/**
 * 🚧 A fired action as the inlet's payload: which function (by the action's
 * key, matched back to the ruleset's), the answer, who acts and at whom.
 * Null when the identity is no action of this ruleset.
 */
export function rulesActionPayload(
	ruleset: { id: string } & object,
	identity: string,
	fire: { sessionId: number; actor?: unknown; answer?: unknown; aimedAt?: unknown },
	spec: string = RULES_ACTION_SPEC
): { session: { sessionId: number }; actor: unknown; function: string; answer: unknown; aimedAt: unknown } | null {
	const action = rulesActionsOf(ruleset, spec).find((a) => a.identity === identity)
	if (!action) return null
	return { session: { sessionId: fire.sessionId }, actor: fire.actor ?? null, function: action.function, answer: fire.answer ?? null, aimedAt: fire.aimedAt ?? null }
}

/** The words an action is offered under. */
export const rulesActionLabel = (a: RulesAction): string => i18nText(a.label) ?? a.function

/** The modes a ruleset action runs at: Full applies what the function asks, Review files each change for the owner. */
export type RulesActionMode = "full" | "review"

/**
 * 🚧 The actions the session's ruleset offers (its primary ruleset, as a
 * turn reads it) — none for a session with no ruleset installed.
 */
export async function sessionRulesActions(db: any, sessionId: number): Promise<RulesAction[]> {
	const { eq } = await import("drizzle-orm")
	const schema = await import("$lib/server/db/schema")
	const { getRuleset } = await import("@serene-pub/sdk")
	const [row] = await db
		.select({ primaryRuleset: schema.sessions.primaryRuleset })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const decl = row?.primaryRuleset ? getRuleset(row.primaryRuleset) : undefined
	return decl ? rulesActionsOf(decl) : []
}

/**
 * 🚧 What a press of a ruleset action adds to its run's input — the
 * inlet's `main` (the payload `ruleset-resolve`'s `actions` port runs the
 * function with), the function, the answer, who acts and at whom, and the
 * mode. Null when the identity is no action of the session's ruleset.
 *
 * ★ The mode is Full: an action registration carries no mode (a routine's
 * field, R37), so Review for a ruleset action waits on a ruling.
 */
export async function rulesActionInput(
	db: any,
	sessionId: number,
	identity: string,
	press: { actor: unknown; payload?: unknown; mode?: RulesActionMode }
): Promise<{ main: unknown; function: string; answer: unknown; actor: unknown; aimedAt: unknown; mode: RulesActionMode } | null> {
	const { eq } = await import("drizzle-orm")
	const schema = await import("$lib/server/db/schema")
	const { getRuleset } = await import("@serene-pub/sdk")
	const [row] = await db
		.select({ primaryRuleset: schema.sessions.primaryRuleset })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const decl = row?.primaryRuleset ? getRuleset(row.primaryRuleset) : undefined
	if (!decl) return null
	const raw = press.payload && typeof press.payload === "object" && !Array.isArray(press.payload) ? (press.payload as Record<string, unknown>) : undefined
	const { aimedAt, ...answer } = raw ?? {}
	const payload = rulesActionPayload(decl, identity, {
		sessionId,
		actor: press.actor,
		answer: raw ? answer : null,
		aimedAt: aimedAt ?? null
	})
	if (!payload) return null
	return {
		main: payload,
		function: payload.function,
		answer: payload.answer,
		actor: payload.actor,
		aimedAt: payload.aimedAt,
		mode: press.mode === "review" ? "review" : "full"
	}
}
