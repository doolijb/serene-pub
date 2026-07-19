<script lang="ts">
	import { Tabs, Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { onMount, type Snippet } from "svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"

	interface Props {
		markdown: string
		classes?: string
		compiledPrompt?: Sockets.Chats.PromptTokenCount.Response
		leftControls?: Snippet
		rightControls?: Snippet
		extraTabs?: {
			value: string
			title: string
			control: Snippet
			content: Snippet
			/** Stays as its own permanently visible tab on all screen sizes
			 * instead of collapsing into the mobile "More" popover. */
			alwaysVisible?: boolean
		}[]
		onSend: () => void
	}
	let {
		markdown = $bindable(),
		compiledPrompt = $bindable(),
		classes,
		leftControls,
		rightControls,
		extraTabs = $bindable(),
		onSend
	}: Props = $props()

	let tabGroup: string = $state("compose")
	// On mobile, extraTabs collapse into a single "More" popover instead of
	// competing inline with Compose/Preview for a 375px-wide row — mirrors
	// the same overflow-into-a-menu pattern already used for per-message
	// controls (see ChatMessage.svelte's mobile controls popover).
	let showMoreMenu = $state(false)
	let collapsibleExtraTabs = $derived(
		extraTabs?.filter((t) => !t.alwaysVisible) ?? []
	)
	let activeExtraTab = $derived(
		collapsibleExtraTabs.find((t) => t.value === tabGroup)
	)
	let contextExceeded = $derived(
		compiledPrompt?.meta
			? compiledPrompt.meta.tokenCounts.total >
					compiledPrompt.meta.tokenCounts.limit
			: false
	)
	let submitOnEnter = $state(true)

	function handleSend(e: KeyboardEvent | MouseEvent | undefined = undefined) {
		if (e) e.preventDefault()
		onSend()
	}

	onMount(() => {
		const mq = window.matchMedia("(min-width: 1024px)")
		const update = () => (submitOnEnter = mq.matches)
		update()
		mq.addEventListener("change", update)
		return () => mq.removeEventListener("change", update)
	})

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey && submitOnEnter) {
			e.preventDefault()
			handleSend(e)
		}
	}

	$effect(() => {
	})

	$effect(() => {
		const fixed = new Set(["compose", "preview"])
		const extra = new Set(extraTabs?.map((t) => t.value) ?? [])
		if (!fixed.has(tabGroup) && !extra.has(tabGroup)) {
			tabGroup = "compose"
		}
	})
</script>

<Tabs
	value={tabGroup}
	class={classes}
	onValueChange={(e) => (tabGroup = e.value)}
	role="region"
	aria-label="Message composer"
>
	<Tabs.List class="border-none flex flex-wrap items-center gap-1 pt-[0.2em] pb-[0]">
		<Tabs.Trigger value="compose" class="flex min-h-[2em] items-center justify-center">
			<span title="Compose" aria-label="Compose tab" class="flex items-center gap-1">
				<Icons.Pen size="0.75em" aria-hidden="true" />
				{#if tabGroup === "compose"}<span class="text-xs">Compose</span>{/if}
			</span>
		</Tabs.Trigger>
		<Tabs.Trigger value="preview" class="flex min-h-[2em] items-center justify-center">
			<span title="Preview" aria-label="Preview tab" class="flex items-center gap-1">
				<Icons.Eye size="0.75em" aria-hidden="true" />
				{#if tabGroup === "preview"}<span class="text-xs">Preview</span>{/if}
			</span>
		</Tabs.Trigger>
		{#if extraTabs}
			{#each extraTabs as tab}
				<Tabs.Trigger
					value={tab.value}
					class="flex min-h-[2em] items-center justify-center {tab.alwaysVisible ? '' : 'max-lg:hidden'}"
				>
					<span title={tab.title} aria-label="{tab.title} tab" class="flex items-center gap-1">
						{@render tab.control?.()}
						{#if tabGroup === tab.value}<span class="text-xs">{tab.title}</span>{/if}
					</span>
				</Tabs.Trigger>
			{/each}
			{#if collapsibleExtraTabs.length > 0}
				<div class="lg:hidden">
					<Popover
						open={showMoreMenu}
						onOpenChange={(e) => (showMoreMenu = e.open)}
						positioning={{ placement: "top" }}
					>
						<Popover.Trigger
							class="btn btn-sm min-h-[2em] pt-[0.7em] justify-center {activeExtraTab ? 'preset-tonal-primary' : ''}"
							aria-label="More composer tabs"
						>
							<span class="flex w-full items-center justify-center gap-1">
								{#if activeExtraTab}
									{@render activeExtraTab.control?.()}
									<span class="text-xs">{activeExtraTab.title}</span>
								{:else}
									<Icons.EllipsisVertical size="0.9em" class="block" aria-hidden="true" />
								{/if}
							</span>
						</Popover.Trigger>
						<Portal>
							<Popover.Positioner class="z-[1000]!">
								<Popover.Content class="card bg-primary-200-800 shadow-xl p-4 space-y-4 w-[min(90vw,240px)]">
									<header class="popover-menu-title">
										<Icons.EllipsisVertical size={18} aria-hidden="true" />
										<p>More</p>
									</header>
									<article class="flex flex-col gap-2">
										{#each collapsibleExtraTabs as tab}
											<button
												type="button"
												class="btn btn-sm popover-menu-btn {tabGroup === tab.value
													? 'preset-tonal-primary'
													: 'hover:preset-filled-primary-500'}"
												onclick={() => {
													tabGroup = tab.value
													showMoreMenu = false
												}}
											>
												{@render tab.control?.()}
												<span>{tab.title}</span>
											</button>
										{/each}
									</article>
									<Popover.Arrow>
										<Popover.ArrowTip class="!bg-primary-200 dark:!bg-primary-800" />
									</Popover.Arrow>
								</Popover.Content>
							</Popover.Positioner>
						</Portal>
					</Popover>
				</div>
			{/if}
		{/if}
		{#if compiledPrompt?.meta}
			<Tabs.Trigger
				value="tokenCount"
				class="flex min-h-[2em] w-full items-center justify-end text-right"
				disabled
			>
				<span
					title="Token Count"
					class="text-xs"
					class:text-error-500={contextExceeded}
					aria-label="Token count: {compiledPrompt.meta.tokenCounts
						.total} of {compiledPrompt.meta.tokenCounts.limit}"
					aria-live="polite"
				>
					{compiledPrompt.meta.tokenCounts.total} / {compiledPrompt
						.meta.tokenCounts.limit}
				</span>
			</Tabs.Trigger>
		{/if}
	</Tabs.List>
	<div class="flex items-center gap-4">
		<div role="group" aria-label="Message controls">
			{#if tabGroup === "compose" || tabGroup === "preview"}
				{@render leftControls?.()}
			{/if}
		</div>
		<div class="w-full">
			<Tabs.Content value="compose">
				<label class="sr-only" for="message-input">
					Type your message here
				</label>
				<textarea
					id="message-input"
					class="input field-sizing-content flex-1 rounded-xl lg:min-h-[3.75em]"
					placeholder="Type a message..."
					bind:value={markdown}
					autocomplete="off"
					spellcheck="true"
					onkeydown={handleKeyDown}
					aria-describedby={contextExceeded
						? "token-warning"
						: undefined}
					aria-invalid={contextExceeded}
				></textarea>
				{#if contextExceeded}
					<div
						id="token-warning"
						class="text-error-500 mt-1 text-xs"
						role="alert"
					>
						Token limit exceeded. Message may be truncated.
					</div>
				{/if}
			</Tabs.Content>
			<Tabs.Content value="preview">
				<div
					class="card bg-surface-100-900 min-h-[2em] lg:min-h-[4em] w-full rounded-xl p-2 mb-[1em]"
					role="region"
					aria-label="Message preview"
				>
					<div class="rendered-chat-message-content">
						{@html renderMarkdownWithQuotedText(markdown)}
					</div>
				</div>
			</Tabs.Content>
			{#if extraTabs}
				{#each extraTabs as tab}
					<Tabs.Content value={tab.value}>
						<div role="region" aria-label="{tab.title} content">
							{@render tab.content?.()}
						</div>
					</Tabs.Content>
				{/each}
			{/if}
		</div>
		<div role="group" aria-label="Send controls">
			{#if tabGroup === "compose"}
				{@render rightControls?.()}
			{/if}
		</div>
	</div>
</Tabs>
