<script lang="ts">
	import Select from "$lib/client/components/inputs/Select.svelte"
	import KeywordChips from "$lib/client/lorebooks/editor/KeywordChips.svelte"
	/**
	 * The condition an entry fires under — "not when *statue* is present".
	 *
	 * One component across the three managers, on `LoreContentField`'s
	 * precedent and not against the presentation ruling: what is shared here is
	 * a **curated control**, not a generic editor. The three tabs keep their own
	 * markup, their own state and their own idea of what a row looks like; this
	 * is one field they would otherwise have written three times, with three
	 * chances for the wording of a mode to drift.
	 *
	 * ## Where it sits, and why it is one control and not two
	 *
	 * Under **Advanced Settings**, which is the disclosure the entry editor
	 * already has — never on the primary surface, which is four fields and stays
	 * four. Two levels, never three (plan Part 6).
	 *
	 * The stored shape is a mode plus a list of keywords, and either alone means
	 * nothing: a mode with no keywords is a rule about nothing, and keywords
	 * with no mode are a list nothing reads. So they are one control with one
	 * label, and the keywords appear only once a mode makes them mean something
	 * — which is the same conditional the sibling fields in these editors
	 * already use, not a third level of disclosure.
	 *
	 * The modes are written as **sentences about this entry**, not as the names
	 * of a boolean algebra. `AND ANY` / `NOT ALL` is what the stored value is
	 * called; "Only when one of these is also mentioned" is what the author is
	 * deciding.
	 */
	interface Props {
		/** `andAny` / `andAll` / `notAny` / `notAll`, or null for no condition. */
		selectiveLogic: string | null
		/**
		 * One element per key, exactly as the primary keywords are authored —
		 * a list, so a regex key's comma is never read as a separator (#146).
		 */
		secondaryKeys: string[]
		/** Whether the entry matches its keys as regular expressions. */
		regex?: boolean
		/** Distinguishes this instance's inputs from the sibling tab's. */
		idPrefix: string
	}

	let {
		selectiveLogic = $bindable(),
		secondaryKeys = $bindable(),
		regex = false,
		idPrefix
	}: Props = $props()

	const MODES = [
		{
			value: "andAny",
			label: "Only when one of these is also mentioned"
		},
		{
			value: "andAll",
			label: "Only when all of these are also mentioned"
		},
		{ value: "notAny", label: "Never when one of these is mentioned" },
		{ value: "notAll", label: "Never when all of these are mentioned" }
	]
</script>

<div class="flex flex-col gap-2">
	<div class="flex w-full items-center justify-between gap-2">
		<!-- Visual only: the Select names itself with the same words. -->
		<span aria-hidden="true">Extra condition</span>
		<Select
			label="Extra condition"
			labelHidden
			class="w-full max-w-xs text-sm"
			options={[{ value: "", label: "None" }, ...MODES]}
			bind:value={
				() => selectiveLogic ?? "",
				(v) => {
					// "" is the absence of a condition and has to survive as
					// null — the same distinction `recursionDepth` makes just
					// above this in every one of these editors. A stored ""
					// would be a fifth mode nothing implements.
					selectiveLogic = v === "" ? null : v
				}
			}
		/>
	</div>
	{#if selectiveLogic}
		<div class="flex flex-col gap-1">
			<KeywordChips
				bind:keys={secondaryKeys}
				{idPrefix}
				idSuffix="ConditionKeys"
				label="Condition keywords"
				placeholder="statue"
				{regex}
			/>
			<p class="text-surface-700-300 text-xs">
				Checked only after this entry's own keywords have matched. Leave
				empty and the condition is ignored.
			</p>
		</div>
	{/if}
</div>
