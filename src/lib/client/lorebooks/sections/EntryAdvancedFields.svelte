<script lang="ts">
	import type { Snippet } from "svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { Priorities } from "$lib/shared/constants/Priorities"
	import EntryConditionField from "$lib/client/components/lorebookForms/EntryConditionField.svelte"

	/**
	 * Level two of the editor's two levels of disclosure, shared by every
	 * entry door: one fold, named for what is in it.
	 *
	 * ⚠ **One fold, in the same place, whatever is set.** A disclosure that
	 * moves or disappears with its contents teaches the reader the controls
	 * come and go, so this is always drawn and always here — under the fields
	 * every entry has, above the account of what the run did.
	 *
	 * Recursion depth and the entry's condition sit outside the gate that
	 * hides Use Regex and Case Sensitive: both are properties of the keyword
	 * mechanism, and the keyword mechanism still runs with vectorization on —
	 * an entry set to `keyword` or `both`, and every `rag` entry on an instance
	 * whose model is not loaded, goes through it.
	 */
	interface Props {
		draft: Record<string, any>
		/** Distinguishes this instance's inputs from a sibling editor's. */
		idPrefix: string
		vectorizationEnabled: boolean
		/** Only the kinds that declare a priority role show one. */
		showPriority?: boolean
		/** Fields this door adds to level two, and nowhere else. */
		extra?: Snippet
	}

	let {
		draft = $bindable(),
		idPrefix,
		vectorizationEnabled,
		showPriority = true,
		extra
	}: Props = $props()

	const switchClass =
		"preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
</script>

<details>
	<summary class="cursor-pointer text-sm font-semibold">
		Regex, case, recursion, priority, conditions
	</summary>
	<div class="mt-2 flex flex-col gap-3 text-sm">
		{#if !vectorizationEnabled}
			<Switch
				name="{idPrefix}Regex"
				checked={draft.useRegex || false}
				onCheckedChange={(e) => (draft.useRegex = e.checked)}
				class="flex w-full items-center justify-between gap-2"
			>
				<Switch.Label>Use Regex</Switch.Label>
				<Switch.Control class={switchClass}>
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
			</Switch>
			<Switch
				name="{idPrefix}Case"
				checked={draft.caseSensitive || false}
				onCheckedChange={(e) => (draft.caseSensitive = e.checked)}
				class="flex w-full items-center justify-between gap-2"
			>
				<Switch.Label>Case Sensitive</Switch.Label>
				<Switch.Control class={switchClass}>
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
			</Switch>
		{/if}
		<div class="flex w-full items-center justify-between gap-2">
			<label for="{idPrefix}Recursion">Recursion depth</label>
			<select
				id="{idPrefix}Recursion"
				class="select preset-filled-surface-200-800 w-max max-w-xs rounded-lg text-sm"
				value={String(draft.recursionDepth ?? "")}
				onchange={(e) => {
					// "" is not 0. Empty means the entry has no opinion and the
					// pipeline's ceiling decides, which is a different answer
					// from "conversation only" and has to survive as null.
					const v = e.currentTarget.value
					draft.recursionDepth = v === "" ? null : Number(v)
				}}
			>
				<option value="">Use pipeline default</option>
				<option value="0">Conversation only</option>
				<option value="1">1 level deep</option>
				<option value="2">2 levels deep</option>
				<option value="3">3 levels deep</option>
			</select>
		</div>
		<EntryConditionField
			bind:selectiveLogic={draft.selectiveLogic}
			bind:secondaryKeys={draft.secondaryKeys}
			{idPrefix}
		/>
		<Switch
			name="{idPrefix}Pinned"
			checked={draft.constant || false}
			onCheckedChange={(e) => (draft.constant = e.checked)}
			class="flex w-full items-center justify-between gap-2"
		>
			<Switch.Label>Pinned</Switch.Label>
			<Switch.Control class={switchClass}>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.HiddenInput />
		</Switch>
		<!-- One word for one state, and it is the word the list's own chip
		     uses: off is a switch on a row kept in front of the author, and
		     archived is a row put out of the way. The editor's overflow menu
		     is where the second one is written. -->
		<Switch
			name="{idPrefix}Off"
			checked={draft.enabled === false}
			onCheckedChange={(e) => (draft.enabled = !e.checked)}
			class="flex w-full items-center justify-between gap-2"
		>
			<Switch.Label>Off</Switch.Label>
			<Switch.Control class={switchClass}>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.HiddenInput />
		</Switch>
		{#if showPriority && !vectorizationEnabled}
			<div class="flex w-full items-center justify-between gap-2">
				<label
					for="{idPrefix}Priority"
					class:opacity-50={draft.constant}
				>
					Priority
				</label>
				<select
					id="{idPrefix}Priority"
					class="select preset-filled-surface-200-800 w-max max-w-xs rounded-lg text-sm"
					bind:value={draft.priority}
					disabled={draft.constant || false}
				>
					{#each Priorities as priority (priority.value)}
						<option value={priority.value}>{priority.label}</option>
					{/each}
				</select>
			</div>
		{/if}
		{@render extra?.()}
	</div>
</details>
