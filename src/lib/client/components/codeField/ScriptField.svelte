<script lang="ts">
	/**
	 * The scripts editor's source field (Admin › Scripts): a code field in
	 * JavaScript, with the declared reads and `ctx` offered as completions
	 * and the lint `scriptAssist` describes drawn under the text and listed
	 * beneath it — the list is the accessible surface, as in every code field
	 * (STYLE-GUIDE §6.12).
	 */
	import * as Icons from "@lucide/svelte"
	import { javascript, javascriptLanguage } from "@codemirror/lang-javascript"
	import { linter, type Diagnostic } from "@codemirror/lint"
	import type { Extension } from "@codemirror/state"
	import type { CompletionContext } from "@codemirror/autocomplete"
	import CodeField from "./CodeField.svelte"
	import { scriptCompletions, scriptDiagnostics, type ScriptAssist } from "./scriptAssist"

	interface Props {
		value: string
		oninput: (value: string) => void
		readonly?: boolean
		rows?: number
		label?: string
		id?: string
		/** The reads ticked under Declarations. */
		declared: readonly string[]
		/** Every read the hook offers. */
		offered: readonly string[]
	}

	let {
		value,
		oninput,
		readonly = false,
		rows = 16,
		label,
		id,
		declared,
		offered
	}: Props = $props()

	const uid = `script-${Math.random().toString(36).slice(2, 8)}`
	let field = $state<CodeField | null>(null)
	let issues = $state<Diagnostic[]>([])

	const extensions = $derived.by<Extension>(() => {
		const assist: ScriptAssist = { declared, offered }
		return [
			javascript(),
			javascriptLanguage.data.of({
				autocomplete: (ctx: CompletionContext) => scriptCompletions(ctx, assist)
			}),
			linter(
				(view) => {
					const found = readonly ? [] : scriptDiagnostics(view.state, assist)
					issues = found
					return found
				},
				{ delay: 250 }
			)
		]
	})

	const errorCount = $derived(issues.filter((d) => d.severity === "error").length)
	const lineOf = (from: number) => {
		let line = 1
		for (let i = 0; i < from && i < value.length; i++) if (value[i] === "\n") line++
		return line
	}
</script>

<div class="flex flex-col gap-1">
	<CodeField
		bind:this={field}
		{value}
		{readonly}
		{rows}
		{label}
		{id}
		{extensions}
		placeholder={readonly ? undefined : "return { … }"}
		describedBy={issues.length ? `${uid}-issues` : undefined}
		invalid={errorCount > 0}
		{oninput}
	/>
	{#if issues.length}
		<ul id="{uid}-issues" class="flex flex-col gap-0.5 text-xs">
			{#each issues as d (d.from + d.message)}
				<li
					class="flex flex-wrap items-baseline gap-x-2 {d.severity === 'error'
						? 'text-error-600-400'
						: 'text-warning-700-300'}"
				>
					{#if d.severity === "error"}
						<Icons.CircleX size={12} class="shrink-0 self-center" aria-hidden="true" />
					{:else}
						<Icons.TriangleAlert size={12} class="shrink-0 self-center" aria-hidden="true" />
					{/if}
					<button
						type="button"
						class="min-w-0 flex-1 text-left underline-offset-2 hover:underline"
						onclick={() => field?.focusAt(d.from)}
					>
						<span class="font-medium">
							{d.severity === "error" ? "Error" : "Warning"}, line {lineOf(d.from)}:
						</span>
						{d.message}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
