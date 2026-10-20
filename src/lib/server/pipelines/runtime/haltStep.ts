/**
 * 🚧 **The step a run halted at, as a person reads it** (2026-10-16 walk):
 * the progress card said "halted at route.classes.classwrite" — the spec's
 * internal node key. The terminal frame carries this heading beside the key
 * (`RunProgress.haltStep`): the node's step label (`expose.label`), else its
 * definition's name — the heading the pipeline panel shows for the step.
 * Null when the spec or the node cannot be read; the card then says only
 * "halted", and the key stays on the receipt for the run inspector.
 */
import { stepLabelOf } from "$lib/server/pipelines/scripts/runSeams"

export async function haltStepOf(
	db: Db,
	specId: string | undefined,
	nodeKey: string | undefined
): Promise<string | null> {
	if (!specId || !nodeKey) return null
	try {
		const { loadPublished } = await import("$lib/server/pipelines/boot/bootstrap")
		const doc = await loadPublished(db, specId)
		const node = doc?.nodes.find((n) => n.key === nodeKey)
		return node ? stepLabelOf(node as Parameters<typeof stepLabelOf>[0]) || null : null
	} catch {
		return null
	}
}
