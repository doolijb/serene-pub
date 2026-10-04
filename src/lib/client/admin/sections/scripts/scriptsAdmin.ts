/**
 * What Admin › Scripts says about scripts, pure so it is tested
 * (`scriptsAdmin.test.ts`): what deleting scripts takes. A built-in script is
 * kept (clone it to change it), and so is a script still in a pipeline's
 * chain — the server refuses that delete, so the page says so first.
 */
import { deletionFor, type AdminDeletion } from "$lib/client/components/admin/changelist"

type Script = Pick<Sockets.Pipelines.Scripts.Script, "id" | "name" | "isImmutable" | "usedBy">

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
