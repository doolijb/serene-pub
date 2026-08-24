/**
 * The adapter payload contract.
 *
 * `CompiledPrompt` is what an adapter is handed to send: the rendered string or
 * the role-tagged messages, plus the metadata the debug panel reads. It lived in
 * `promptBuilder/types.ts` because the legacy builder produced it; it is used by
 * all seven adapters and by `dispatch.ts`, and it outlives that builder, so it
 * belongs here.
 *
 * ## Imported explicitly, never by dropping a specifier
 *
 * `app.d.ts` declares **two** unrelated ambient globals also called
 * `CompiledPrompt` — which is why `BaseConnectionAdapter` aliases its import.
 * Deleting an import specifier here does not produce an error; the bare name
 * resolves to a global with a *different shape that still typechecks*, and no
 * test would catch it. Every consumer imports this module by name.
 *
 * ## `meta.rag` is gone
 *
 * It carried `RagDiagnostics | NonRagDiagnostics`, the last thread tying this
 * type to the deleted infill engines. Those fields counted the engines' internal
 * phases — a guaranteed window, a RAG pass, a fill pass — which the pipeline does
 * not have. `meta.retrieval` replaces it with what the pipeline does record: a
 * decision per candidate block. See `pipelines/dispatch.ts`.
 */
export type CompiledPrompt = {
	prompt: string | undefined
	messages: any[] | undefined
	meta: {
		promptFormat: string
		templateName: string | null
		timestamp: string
		truncationReason: string | null
		currentTurnCharacterId: number | null
		tokenCounts: {
			total: number
			limit: number
		}
		sessionMessages: {
			included: number
			total: number
			includedIds: number[]
			excludedIds: number[]
		}
		sources: any
		/** What retrieval considered, and why each block is in or out. */
		retrieval?: {
			budget: { total: number; used: number; remaining: number } | null
			blocks: Array<{
				id: number | string
				source: string
				name: string | null
				tokens: number
				included: boolean
				why: string[]
			}>
		}
	}
}
