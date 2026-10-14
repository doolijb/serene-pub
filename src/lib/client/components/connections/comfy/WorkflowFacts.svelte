<script lang="ts">
	/**
	 * 🚧 What a saved workflow is, in words: its **sheet sentence**
	 * (`sheetSentence(deriveComfySheet(…))`, §4.8 step 4) and **Validate
	 * against this server** (`workflows:validate` — a live `/object_info`
	 * read, recorded on the connection so its row follows, §4.9).
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import type { DrawingSheet } from "$lib/shared/imageGen/types"
	import { sheetSentence } from "$lib/shared/imageGen/sheetSentence"
	import { workflowsApi } from "./workflowsApi"

	interface Props {
		workflowId: number
		connectionId?: number | null
		/** Bumped by the parent after a save, so the sentence is re-read. */
		revision?: number
		onValidated?: () => void
	}

	let { workflowId, connectionId = null, revision = 0, onValidated }: Props = $props()

	const api = workflowsApi(useTypedSocket())

	let sheet = $state<DrawingSheet | null>(null)
	let validating = $state(false)
	let verdict = $state<{ ok: boolean; text: string } | null>(null)

	$effect(() => {
		const id = workflowId
		void revision
		sheet = null
		api.sheet(id, connectionId)
			.then((s) => (sheet = s))
			.catch(() => {})
	})

	async function validate() {
		if (connectionId == null) return
		validating = true
		verdict = null
		try {
			const r = await api.validate({ connectionId, workflowId })
			verdict = r.ok
				? { ok: true, text: "Fits this ComfyUI: every node and every name it uses is there." }
				: { ok: false, text: r.problem ?? "It does not fit this ComfyUI." }
			onValidated?.()
		} catch (e) {
			verdict = { ok: false, text: e instanceof Error ? e.message : String(e) }
		} finally {
			validating = false
		}
	}
</script>

<div class="flex flex-col gap-2" data-workflow-facts>
	{#if sheet}
		<p class="text-sm" data-sheet-sentence>{sheetSentence(sheet)}</p>
	{/if}
	{#if connectionId != null}
		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				disabled={validating}
				onclick={validate}
			>
				<Icons.ShieldCheck size={14} aria-hidden="true" />
				{validating ? "Checking…" : "Validate against this server"}
			</button>
			{#if verdict}
				<p
					class="text-xs {verdict.ok ? 'text-success-700-300' : 'text-warning-700-300'}"
					role="status"
				>
					{verdict.text}
				</p>
			{/if}
		</div>
	{/if}
</div>
