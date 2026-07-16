<script lang="ts">
	import { Tabs, Popover } from "@skeletonlabs/skeleton-svelte"
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
	let activeExtraTab = $derived(
		extraTabs?.find((t) => t.value === tabGroup)
	)
	let contextExceeded = $derived(
		!!compiledPrompt
			? compiledPrompt!.meta.tokenCounts.total >
					compiledPrompt!.meta.tokenCounts.limit
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
	{classes}
	onValueChange={(e) => (tabGroup = e.value)}
	role="region"
	aria-label="Message composer"
>
	{#snippet list()}
		<Tabs.Control value="compose" classes="min-h-[2.75em]">
			<span title="Compose" aria-label="Compose tab" class="flex items-center gap-1">
				<Icons.Pen size="0.75em" aria-hidden="true" />
				{#if tabGroup === "compose"}<span class="text-xs">Compose</span>{/if}
			</span>
		</Tabs.Control>
		<Tabs.Control value="preview" classes="min-h-[2.75em]">
			<span title="Preview" aria-label="Preview tab" class="flex items-center gap-1">
				<Icons.Eye size="0.75em" aria-hidden="true" />
				{#if tabGroup === "preview"}<span class="text-xs">Preview</span>{/if}
			</span>
		</Tabs.Control>
		{#if extraTabs}
			{#each extraTabs as tab}
				<Tabs.Control value={tab.value} classes="max-lg:hidden min-h-[2.75em]">
					<span title={tab.title} aria-label="{tab.title} tab" class="flex items-center gap-1">
						{@render tab.control?.()}
						{#if tabGroup === tab.value}<span class="text-xs">{tab.title}</span>{/if}
					</span>
				</Tabs.Control>
			{/each}
			{#if extraTabs.length > 0}
				<div class="lg:hidden">
					<Popover
						open={showMoreMenu}
						onOpenChange={(e) => (showMoreMenu = e.open)}
						positioning={{ placement: "top" }}
						triggerBase="btn btn-sm min-h-[2.75em] {activeExtraTab ? 'preset-tonal-primary' : ''}"
						contentBase="card bg-surface-100-900 p-2 space-y-1 shadow-xl w-[min(90vw,240px)]"
						arrow
						triggerAriaLabel="More composer tabs"
						zIndex="1000"
					>
						{#snippet trigger()}
							<span class="flex items-center gap-1">
								{#if activeExtraTab}
									{@render activeExtraTab.control?.()}
									<span class="text-xs">{activeExtraTab.title}</span>
								{:else}
									<Icons.Ellipsis size="0.75em" aria-hidden="true" />
								{/if}
							</span>
						{/snippet}
						{#snippet content()}
							{#each extraTabs as tab}
								<button
									type="button"
									class="btn btn-sm w-full justify-start {tabGroup === tab.value
										? 'preset-tonal-primary'
										: 'preset-filled-surface-400-600'}"
									onclick={() => {
										tabGroup = tab.value
										showMoreMenu = false
									}}
								>
									{@render tab.control?.()}
									{tab.title}
								</button>
							{/each}
						{/snippet}
					</Popover>
				</div>
			{/if}
		{/if}
		{#if compiledPrompt}
			<Tabs.Control
				value="tokenCount"
				classes="w-full text-right min-h-[2.75]"
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
			</Tabs.Control>
		{/if}
	{/snippet}
	{#snippet content()}
		<div class="flex gap-4">
			<div role="group" aria-label="Message controls">
				{#if tabGroup === "compose" || tabGroup === "preview"}
					{@render leftControls?.()}
				{/if}
			</div>
			<div class="w-full">
				<Tabs.Panel value="compose">
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
				</Tabs.Panel>
				<Tabs.Panel value="preview">
					<div
						class="card bg-surface-100-900 min-h-[4em] w-full rounded-lg p-2"
						role="region"
						aria-label="Message preview"
					>
						<div class="rendered-chat-message-content">
							{@html renderMarkdownWithQuotedText(markdown)}
						</div>
					</div>
				</Tabs.Panel>
				{#if extraTabs}
					{#each extraTabs as tab}
						<Tabs.Panel value={tab.value}>
							<div role="region" aria-label="{tab.title} content">
								{@render tab.content?.()}
							</div>
						</Tabs.Panel>
					{/each}
				{/if}
			</div>
			<div role="group" aria-label="Send controls">
				{#if tabGroup === "compose"}
					{@render rightControls?.()}
				{/if}
			</div>
		</div>
	{/snippet}
</Tabs>
