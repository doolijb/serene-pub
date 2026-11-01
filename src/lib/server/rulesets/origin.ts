/**
 * The one derivation of a ruleset's origin (ruled 2026-10-28: no column). The
 * rulesets reader (lane T4) calls this; nothing else derives it.
 */
import type { RulesetOrigin } from "./pubRulesets"

export function rulesetOriginOf(
	rulesetId: string,
	row: { ownerSlug: string; createdBy: number | null; retiredAt: Date | null } | undefined,
	installedPluginIds: ReadonlySet<string>
): RulesetOrigin {
	if (rulesetId.startsWith("core:")) return "core"
	// A registered declaration with no row is a package's code.
	if (!row) return "plugin"
	if (installedPluginIds.has(row.ownerSlug)) return "plugin"
	// A package's ruleset its uninstall left retired — never the pub's to edit.
	// (A pub row whose author was deleted AND that was retired reads the same.)
	if (row.createdBy === null && row.retiredAt !== null) return "plugin"
	return "pub"
}
