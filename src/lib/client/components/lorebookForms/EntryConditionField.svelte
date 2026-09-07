<script lang="ts">
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
		/** Comma-separated, exactly as the primary keywords are authored. */
		secondaryKeys: string
		/** Distinguishes this instance's inputs from the sibling tab's. */
		idPrefix: string
	}

	let {
		selectiveLogic = $bindable(),
		secondaryKeys = $bindable(),
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

	const modeId = $derived(`${idPrefix}Condition`)
	const keysId = $derived(`${idPrefix}ConditionKeys`)
</script>

<div class="flex flex-col gap-2">
	<div class="flex w-full items-center justify-between gap-2">
		<label for={modeId}>Extra condition</label>
		<select
			id={modeId}
			class="select preset-filled-surface-200-800 w-max max-w-xs rounded-lg text-sm"
			value={selectiveLogic ?? ""}
			onchange={(e) => {
				// "" is the absence of a condition and has to survive as null —
				// the same distinction `recursionDepth` makes just above this
				// in every one of these editors. A stored "" would be a fifth
				// mode nothing implements.
				const v = e.currentTarget.value
				selectiveLogic = v === "" ? null : v
			}}
		>
			<option value="">None</option>
			{#each MODES as mode (mode.value)}
				<option value={mode.value}>{mode.label}</option>
			{/each}
		</select>
	</div>
	{#if selectiveLogic}
		<div class="flex flex-col gap-1">
			<label class="text-surface-700-300 text-xs" for={keysId}>
				Condition keywords
				<span class="font-normal">(comma separated)</span>
			</label>
			<input
				id={keysId}
				class="input preset-filled-surface-200-800 w-full rounded-lg"
				type="text"
				bind:value={secondaryKeys}
				placeholder="statue, mural"
			/>
			<p class="text-surface-700-300 text-xs">
				Checked only after this entry's own keywords have matched. Leave
				empty and the condition is ignored.
			</p>
		</div>
	{/if}
</div>
