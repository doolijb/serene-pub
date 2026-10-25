<script lang="ts">
	/**
	 * 🚧 The **Document** field of Admin › Rulesets (PLAN-ruleset-editor P1):
	 * the whole draft of a ruleset made on this pub, as JSON, in a code field
	 * (STYLE-GUIDE §6.12; never a bare textarea). Since P2 every part has a
	 * form; this stays as the escape hatch — the door to what no form covers
	 * (selectors, what it plays, maps) and to pasting a whole document.
	 *
	 * The text is the page's: an edit is reported with `oninput`, and the
	 * page's Save sends it (the merge rule in `rulesetForm.ts`: when the
	 * forms changed too, this text wins, and `conflict` says so here).
	 * **Check** asks the page to save the draft and lists what the server
	 * found (`findings`, each `[reason] sentence`). Text that is not JSON is
	 * named under the field, with the parser's words, once the field is left.
	 */
	import * as Icons from "@lucide/svelte"
	import CodeField from "$lib/client/components/codeField/CodeField.svelte"
	import RulesetFindingsList from "./RulesetFindingsList.svelte"
	import { parseDocumentText } from "./rulesetDocument"

	interface Props {
		value: string
		oninput?: (value: string) => void
		readonly?: boolean
		/** The text differs from the saved draft. */
		changed?: boolean
		/** The forms changed too: Save keeps this text. */
		conflict?: boolean
		/** The saved draft's findings. */
		findings?: readonly string[]
		/** Check was pressed this visit: show the findings under the field. */
		checked?: boolean
		checking?: boolean
		onCheck?: () => void
		/** Put the saved draft's text back. */
		onRevert?: () => void
	}
	let {
		value,
		oninput,
		readonly = false,
		changed = false,
		conflict = false,
		findings = [],
		checked = false,
		checking = false,
		onCheck,
		onRevert
	}: Props = $props()

	const id = "ruleset-document"
	let focused = $state(false)
	const parsed = $derived(parseDocumentText(value))
	/** A parse error is held back while the field has focus (§6.12). */
	const parseError = $derived(!readonly && !focused && !parsed.ok ? parsed.error : null)
</script>

<div class="flex min-w-0 flex-col gap-2">
	<CodeField
		{id}
		{value}
		{oninput}
		{readonly}
		rows={16}
		label="Ruleset document (JSON)"
		describedBy={parseError ? `${id}-issues` : undefined}
		invalid={!!parseError}
		onfocuschange={(f) => (focused = f)}
	/>
	{#if parseError}
		<p id="{id}-issues" class="text-error-600-400 flex items-start gap-1.5 text-xs">
			<Icons.CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" />
			<span><span class="font-medium">Error:</span> this is not valid JSON ({parseError}).</span>
		</p>
	{/if}
	{#if conflict}
		<p class="text-warning-700-300 flex items-start gap-1.5 text-xs" role="status" data-document-wins>
			<Icons.TriangleAlert size={14} class="mt-px shrink-0" aria-hidden="true" />
			<span>
				You changed this text and the forms above. Save keeps this text; the changes in the
				forms are dropped.
			</span>
		</p>
	{/if}
	{#if !readonly}
		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				class="btn btn-sm preset-tonal-primary"
				disabled={checking}
				onclick={() => onCheck?.()}
			>
				{#if checking}
					<Icons.LoaderCircle size={14} class="animate-spin" aria-hidden="true" />
					Checking…
				{:else}
					<Icons.ListChecks size={14} aria-hidden="true" />
					Check
				{/if}
			</button>
			{#if changed}
				<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => onRevert?.()}>
					<Icons.Undo2 size={14} aria-hidden="true" />
					Put back the saved text
				</button>
			{/if}
			<span class="text-surface-600-400 text-xs">Check saves the draft and lists what stops it publishing.</span>
		</div>
		{#if checked && !checking}
			<div aria-live="polite">
				<RulesetFindingsList {findings} emptyText="Checked: no problems found." />
			</div>
		{/if}
	{/if}
</div>
