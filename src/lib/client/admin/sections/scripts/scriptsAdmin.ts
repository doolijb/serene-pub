/**
 * What Admin › Scripts says about scripts, pure so it is tested
 * (`scriptsAdmin.test.ts`): where a script is attached (the Use facet and the
 * *Where used* links), where it could go (the fits facets), and what deleting
 * scripts takes. A built-in script is kept (duplicate it to change it), and so
 * is a script still in a pipeline's chain or on a connection — the server
 * refuses that delete, so the page says so first.
 *
 * A script **fits** a seam when its kind is in the seam's `accepts`; a step,
 * pipeline or genre when one of its seams does (PLAN-script-placement D5).
 * The server works that out per script (`fits`), the way Admin › Prompts'
 * `pipelinesFitting` works it out per prompt from the library.
 */
import { deletionFor, type AdminDeletion } from "$lib/client/components/admin/changelist"

type Script = Pick<Sockets.Pipelines.Scripts.Script, "id" | "name" | "isImmutable" | "usedBy">
type UseRow = Sockets.Pipelines.Scripts.UseRow

export const SCRIPT_NOUN = { singular: "script", plural: "scripts" }

export function scriptDeletion(rows: readonly Script[]): AdminDeletion {
	return deletionFor(rows, {
		noun: SCRIPT_NOUN,
		label: (r) => r.name,
		protect: (r) =>
			r.isImmutable
				? "built-in scripts are read-only (duplicate one to change it)"
				: r.usedBy.length
					? `still in the chain of ${r.usedBy.join(", ")} — take it out there first`
					: null
	})
}

/** The Use facet's values, in the order the filter lists them. */
export const USE_ORDER = ["pipeline", "connection", "unplaced", "unused"] as const
export type UseFacet = (typeof USE_ORDER)[number]

export const USE_LABEL: Record<UseFacet, string> = {
	pipeline: "In a pipeline",
	connection: "On a connection",
	unplaced: "Unplaced",
	unused: "Unused"
}

/**
 * Every Use value a script holds — several at once: a stop guard can sit in
 * a chain and on a connection. An unplaced chain still counts as in a
 * pipeline (it is kept, and it holds the script); *Unplaced* narrows to the
 * scripts with a chain whose seam is gone.
 */
export function useFacets(use: readonly UseRow[]): UseFacet[] {
	if (!use.length) return ["unused"]
	const out = new Set<UseFacet>()
	for (const u of use) {
		if (u.kind === "connection") out.add("connection")
		else {
			out.add("pipeline")
			if (u.unplaced) out.add("unplaced")
		}
	}
	return USE_ORDER.filter((v) => out.has(v))
}

/**
 * Where a *Where used* row opens: a chain → its step in the pipeline
 * workspace, scrolled to the chain (`?step=` + `?option=`); a connection →
 * its change form, landed on the stop scripts.
 */
export function useHref(u: UseRow): string {
	if (u.kind === "connection") return `/admin/connections/${u.connectionId}#stop-scripts`
	const q = new URLSearchParams({ tab: "configure" })
	if (u.stepKey) q.set("step", u.stepKey)
	if (u.optionId) q.set("option", u.optionId)
	return `/admin/pipelines/${encodeURIComponent(u.pipelineSlug)}?${q}`
}

/** The steps a script's pipeline chains sit on, for the Use cell's tooltip. */
export function useSteps(use: readonly UseRow[]): string {
	return use
		.map((u) =>
			u.kind === "connection"
				? `Connection: ${u.connectionName}`
				: `${u.pipelineLabel} › ${u.stepLabel} · ${u.at}${u.unplaced ? " (no longer here)" : ""}`
		)
		.join("\n")
}
