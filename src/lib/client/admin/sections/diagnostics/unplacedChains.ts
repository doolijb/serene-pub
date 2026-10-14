/**
 * Diagnostics' unplaced line (PLAN-script-placement D4, *Surfacing*): how many
 * script chains are stored at a seam their step does not declare. Pure, so it is
 * tested (`unplacedChains.test.ts`).
 *
 * Counted from Admin › Scripts' own read (`pipelines:scripts`, each script's
 * `use` rows), so this line and the Scripts *Unplaced* filter it links to are
 * one derivation and cannot disagree. A use row names a chain by its option
 * handle; several scripts in one chain are one chain.
 */

type Script = Pick<Sockets.Pipelines.Scripts.Script, "use">

/** Distinct unplaced chains across every script's use rows. */
export function unplacedChainCount(scripts: readonly Script[]): number {
	const chains = new Set<string>()
	for (const s of scripts)
		for (const u of s.use ?? [])
			if (u.kind === "pipeline" && u.unplaced)
				chains.add(`${u.pipelineSlug}\u0000${u.nodeKey}\u0000${u.optionId || u.at}`)
	return chains.size
}

/** "1 script chain has no place to run" / "3 script chains have …", or null at 0. */
export function unplacedChainsLine(n: number): string | null {
	if (n <= 0) return null
	return n === 1
		? "1 script chain has no place to run"
		: `${n} script chains have no place to run`
}

/** Where the line opens: Admin › Scripts, filtered to Use · Unplaced. */
export const UNPLACED_SCRIPTS_HREF = "/admin/scripts?use=unplaced"
