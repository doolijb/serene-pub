/**
 * How one hook-invocation log row reads in the admin's "Recent hook calls".
 *
 * Core calls every lifecycle moment it fires (`startup` at boot, `enable`,
 * `disable`, `update`, `uninstall`, `shutdown`) on every extension, declared
 * or not, and the sandbox answers an undeclared one with `missing` / "no such
 * hook". For a lifecycle moment that is the normal case, not a failure — an
 * extension with no `startup` callback simply has nothing to do at boot — so it
 * reads as a quiet sentence instead of a red error. A `missing` hook outside a
 * lifecycle moment is a real fault (something asked for a hook the bundle does
 * not export) and stays red.
 */
export type HookOutcomeTone = "success" | "quiet" | "error"

export interface HookOutcomeRow {
	hookName: string
	mode: string
	ok: boolean
	outcome: string
	reason: string | null
}

export function hookOutcome(row: HookOutcomeRow): {
	tone: HookOutcomeTone
	text: string
} {
	const text = `${row.outcome}${row.reason ? `: ${row.reason}` : ""}`
	if (row.ok) return { tone: "success", text }
	if (row.mode === "lifecycle" && row.outcome === "missing")
		return {
			tone: "quiet",
			text: `Not declared. This extension has no ${row.hookName} callback, so nothing ran.`
		}
	return { tone: "error", text }
}

export const HOOK_OUTCOME_CLASS: Record<HookOutcomeTone, string> = {
	success: "text-success-600-400",
	quiet: "text-surface-600-400",
	error: "text-error-600-400"
}
