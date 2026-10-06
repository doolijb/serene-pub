/**
 * What Admin › Prompts says about prompts, pure so it is tested
 * (`promptsAdmin.test.ts`): which pipelines a prompt **fits** (one of their
 * steps declares the prompt's pool, so it is offered there), which genres
 * those pipelines serve, and what deleting prompts takes.
 *
 * A prompt belongs to a step's pool, never to a pipeline (the pool refactor):
 * "this pipeline's prompts" is every prompt one of its steps can pick, which
 * is what the Pipeline filter means — not only the ones picked today
 * (`usedBy`, its own filter).
 */
import { capList, deletionFor, type AdminDeletion } from "$lib/client/components/admin/changelist"

type Prompt = Pick<
	Sockets.Pipelines.Library.LibraryPrompt,
	"id" | "name" | "poolId" | "isImmutable" | "usedBy"
>
type Pipeline = Pick<
	Sockets.Pipelines.Library.LibraryPipeline,
	"slug" | "name" | "promptPools" | "genres"
>

/** The pipelines with a step whose prompts slot reads this prompt's pool. */
export function pipelinesFitting<P extends Pipeline>(prompt: Prompt, pipelines: readonly P[]): P[] {
	return pipelines.filter((p) => (p.promptPools ?? []).includes(prompt.poolId))
}

/** The genres (id → name) served by a pipeline the prompt fits. */
export function genresFitting(
	prompt: Prompt,
	pipelines: readonly Pipeline[]
): { id: string; name: string }[] {
	const out = new Map<string, string>()
	for (const p of pipelinesFitting(prompt, pipelines))
		for (const g of p.genres ?? []) out.set(g.id, g.name)
	return [...out].map(([id, name]) => ({ id, name }))
}

export const PROMPT_NOUN = { singular: "prompt", plural: "prompts" }

/**
 * Built-in prompts are kept (clone one to change it), and so is a prompt a
 * pipeline still picks — the server refuses that delete, so the page says so
 * first instead of promising a delete that will not happen.
 */
export function promptDeletion(rows: readonly Prompt[]): AdminDeletion {
	return deletionFor(rows, {
		noun: PROMPT_NOUN,
		label: (r) => r.name,
		protect: (r) =>
			r.isImmutable
				? "built-in prompts are read-only (duplicate one to change it)"
				: r.usedBy.length
					? `still picked by ${r.usedBy.join(", ")} — point ${r.usedBy.length === 1 ? "it" : "them"} at another prompt first`
					: null
	})
}

export { capList }
