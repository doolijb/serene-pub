<script lang="ts">
	import Select from "$lib/client/components/inputs/Select.svelte"
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
	 * ⚠ **Nothing here hides when vectorization is on** — not Use regex, Case
	 * sensitive or Priority. The keyword mechanism still runs with
	 * vectorization on — an entry set to `keyword` or `both`, and every `rag`
	 * entry on an instance whose model is not loaded, goes through it — and the
	 * ranker adds the priority bonus either way. A hidden control that still
	 * changes matching is a setting nobody can see or undo.
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
		{#if vectorizationEnabled}
			<p class="text-surface-600-400 text-xs">
				Use regex and Case sensitive apply to keyword matching, which
				still runs with embeddings on for entries that match by keyword.
			</p>
		{/if}
		<Switch
			name="{idPrefix}Regex"
			checked={draft.useRegex || false}
			onCheckedChange={(e) => (draft.useRegex = e.checked)}
			class="flex w-full items-center justify-between gap-2"
		>
			<Switch.Label>Use regex</Switch.Label>
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
			<Switch.Label>Case sensitive</Switch.Label>
			<Switch.Control class={switchClass}>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.HiddenInput />
		</Switch>
		<div class="flex w-full items-center justify-between gap-2">
			<!-- The visible text is the row's caption; Select carries the real
			     (sr-only) label so the row keeps its side-by-side layout. -->
			<span aria-hidden="true">Recursion depth</span>
			<Select
				label="Recursion depth"
				labelHidden
				class="w-48 max-w-xs text-sm"
				options={[
					{ value: "", label: "Use pipeline default" },
					{ value: "0", label: "Session only" },
					{ value: "1", label: "1 level deep" },
					{ value: "2", label: "2 levels deep" },
					{ value: "3", label: "3 levels deep" }
				]}
				value={String(draft.recursionDepth ?? "")}
				onValueChange={(v) => {
					// "" is not 0. Empty means the entry has no opinion and the
					// pipeline's ceiling decides, which is a different answer
					// from "session only" and has to survive as null.
					draft.recursionDepth = v === "" ? null : Number(v)
				}}
			/>
		</div>
		<EntryConditionField
			bind:selectiveLogic={draft.selectiveLogic}
			bind:secondaryKeys={draft.secondaryKeys}
			regex={!!draft.useRegex || draft.matchMode === "regex"}
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
		{#if showPriority}
			<div class="flex w-full items-center justify-between gap-2">
				<span aria-hidden="true" class:opacity-50={draft.constant}>
					Priority
				</span>
				<Select
					label="Priority"
					labelHidden
					class="w-48 max-w-xs text-sm"
					options={Priorities.map((p) => ({
						value: String(p.value),
						label: p.label
					}))}
					value={draft.priority == null ? "" : String(draft.priority)}
					disabled={draft.constant || false}
					onValueChange={(v) => {
						// Priorities are numbers; a clear leaves the stored one.
						if (v) draft.priority = Number(v)
					}}
				/>
			</div>
		{/if}
		{@render extra?.()}
	</div>
</details>
