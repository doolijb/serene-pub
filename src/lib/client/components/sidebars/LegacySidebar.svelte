<script lang="ts">
	/**
	 * The legacy panel — the 0.5 config tables, kept readable.
	 *
	 * Context Configs and Prompt Configs are superseded: `context_configs` by
	 * `pipeline_context_templates`, `prompt_configs` by `pipeline_prompts`, and
	 * nothing in 0.6 builds a prompt from either. The rows are kept anyway,
	 * because a year of somebody's tuning is not something an upgrade may throw
	 * away, and they are removed with the tables in a later release.
	 *
	 * They are behind **one** panel rather than two, and that is the point of
	 * this file. Two entries in the navigation implied two live features; one
	 * entry called Legacy says what these are. Configuration happens in the
	 * Pipelines panel now, and this is where you go to check the migration
	 * landed or to consult a wording you have not re-created yet.
	 *
	 * ## Why plain buttons and not PanelTabList
	 *
	 * Both children mount their own `Tabs.Root` — ContextSidebar has Template /
	 * Cards / Raw, PromptsSidebar its own set. Wrapping a second Skeleton tab
	 * context around them buys nothing and risks the two disagreeing about
	 * which one owns keyboard navigation. Two buttons and an `{#if}` is the
	 * whole requirement.
	 *
	 * ## `onclose` is forwarded, not intercepted
	 *
	 * Each child publishes a guard when it has unsaved edits, and the panel
	 * framework calls it before closing. Binding it here and passing it up
	 * keeps that contract intact — swallowing it would silently discard
	 * somebody's half-finished edit, which is the one thing a read-only-ish
	 * archive panel must not do.
	 */
	import * as Icons from "@lucide/svelte"
	import ContextSidebar from "./ContextSidebar.svelte"
	import PromptsSidebar from "./PromptsSidebar.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	type Tab = "contexts" | "prompts"
	let tab = $state<Tab>("contexts")

	const TABS: Array<{ key: Tab; label: string; icon: any }> = [
		{ key: "contexts", label: "Contexts", icon: Icons.FileCode2 },
		{ key: "prompts", label: "Prompts", icon: Icons.MessageSquareText }
	]

	/**
	 * The child's close guard, re-published as ours.
	 *
	 * Only the mounted child has one, so switching tabs has to drop the other's
	 * — a stale guard from a tab nobody is looking at would block a close for a
	 * reason the user cannot see.
	 */
	let childClose = $state<(() => Promise<boolean> | undefined) | undefined>()
	$effect(() => {
		onclose = childClose
	})
</script>

<div class="flex h-full flex-col">
	<div
		class="border-surface-200-800 flex shrink-0 items-center gap-1 border-b px-4 pt-4 pb-2"
	>
		{#each TABS as t (t.key)}
			{@const Icon = t.icon}
			<!-- The site's underlined tab style (see PanelTab): no pill, a
			     bottom border that colours in on selection. -->
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-none border-b-2 bg-transparent px-2 py-1.5 text-sm {tab ===
				t.key
					? 'border-primary-500 text-primary-500'
					: 'text-surface-700-300 hover:text-primary-500 border-transparent'}"
				aria-current={tab === t.key ? "page" : undefined}
				onclick={() => {
					// Dropped rather than carried across: see `childClose`.
					childClose = undefined
					tab = t.key
				}}
			>
				<Icon size={14} />
				{t.label}
			</button>
		{/each}
	</div>

	<p class="text-muted shrink-0 px-4 pt-2 text-xs">
		<Icons.Archive size={11} class="inline" />
		Superseded by the Pipelines panel. Kept so nothing you wrote is lost.
	</p>

	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if tab === "contexts"}
			<ContextSidebar bind:onclose={childClose} />
		{:else}
			<PromptsSidebar bind:onclose={childClose} />
		{/if}
	</div>
</div>
