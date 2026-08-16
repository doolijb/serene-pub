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
		/** Escape handler. Only bound when provided, so the chat composer —
		 * where Escape means nothing — is unaffected. */
		onCancel?: () => void
		placeholder?: string
		/** `"send"` (default) is the chat bar's behaviour: Enter submits on
		 * desktop. `"newline"` is for editing existing prose, where a stray
		 * Enter mid-paragraph committing the edit is a trap — there Enter
		 * always inserts a newline and Ctrl/Cmd+Enter submits. */
		enterBehavior?: "send" | "newline"
		/** Replaces the default textarea classes outright rather than
		 * appending, so a caller can drop the border/min-height instead of
		 * fighting them with overrides. */
		textareaClasses?: string
		/** Focus the field and put the caret at the end on mount. */
		autofocus?: boolean
	}
	let {
		markdown = $bindable(),
		compiledPrompt = $bindable(),
		classes,
		leftControls,
		rightControls,
		extraTabs = $bindable(),
		onSend,
		onCancel,
		placeholder = "Type a message...",
		enterBehavior = "send",
		textareaClasses,
		autofocus = false
	}: Props = $props()

	// Unique per instance. These were hardcoded strings, which meant an edit
	// composer mounted while the chat bar was on screen produced two elements
	// sharing `id="message-input"` (and two `#token-warning`s) — so the chat
	// bar's <label for> and aria-describedby both resolved to whichever came
	// first in the DOM.
	const uid = $props.id()
	const inputId = `message-input-${uid}`
	const warningId = `token-warning-${uid}`

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
	// Enter submits on desktop only; on touch it inserts a newline like any
	// other textarea. There is deliberately no on-screen hint for this — it was
	// permanent noise under every chat, and gating it on "only while typing"
	// just traded that for a layout jump on the first keystroke.
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
		if (e.key === "Escape" && onCancel) {
			e.preventDefault()
			e.stopPropagation()
			onCancel()
			return
		}
		if (e.key !== "Enter") return
		if (enterBehavior === "newline") {
			// Ctrl/Cmd+Enter regardless of viewport: unlike plain Enter, it
			// isn't something a touch keyboard can emit by accident, so
			// there's nothing to gate on pointer type.
			if (e.metaKey || e.ctrlKey) {
				e.preventDefault()
				handleSend(e)
			}
			return
		}
		if (!e.shiftKey && submitOnEnter) {
			e.preventDefault()
			handleSend(e)
		}
	}

	/** Caret to the end rather than selecting all: this is an edit of existing
	 * text, so a select-all means the first keystroke destroys the message. */
	function focusAtEnd(node: HTMLTextAreaElement) {
		if (!autofocus) return
		node.focus({ preventScroll: true })
		node.setSelectionRange(node.value.length, node.value.length)
	}

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
	<Tabs.List
		class="flex flex-wrap items-center gap-1 border-none pt-[0.2em] pb-[0]"
	>
		<Tabs.Trigger
			value="compose"
			class="flex min-h-[2em] items-center justify-center"
		>
			<span
				title="Compose"
				aria-label="Compose tab"
				class="flex items-center gap-1"
			>
				<Icons.Pen size="0.75em" aria-hidden="true" />
				{#if tabGroup === "compose"}<span class="text-xs">
						Compose
					</span>{/if}
			</span>
		</Tabs.Trigger>
		<Tabs.Trigger
			value="preview"
			class="flex min-h-[2em] items-center justify-center"
		>
			<span
				title="Preview"
				aria-label="Preview tab"
				class="flex items-center gap-1"
			>
				<Icons.Eye size="0.75em" aria-hidden="true" />
				{#if tabGroup === "preview"}<span class="text-xs">
						Preview
					</span>{/if}
			</span>
		</Tabs.Trigger>
		{#if extraTabs}
			{#each extraTabs as tab}
				<Tabs.Trigger
					value={tab.value}
					class="flex min-h-[2em] items-center justify-center {tab.alwaysVisible
						? ''
						: 'max-lg:hidden'}"
				>
					<span
						title={tab.title}
						aria-label="{tab.title} tab"
						class="flex items-center gap-1"
					>
						{@render tab.control?.()}
						{#if tabGroup === tab.value}<span class="text-xs">
								{tab.title}
							</span>{/if}
					</span>
				</Tabs.Trigger>
			{/each}
			{#if collapsibleExtraTabs.length > 0}
				<!-- `self-stretch` rather than any stated height: it makes this
				     match whatever the real tab triggers work out to, at any
				     font scale, with no number to keep in sync. Skeleton sizes
				     those triggers itself (17.07px font, so their `2em` is
				     34.14px) and that isn't inherited here, so every attempt to
				     restate the height in em/rem lands a couple of pixels off.
				     What was here before: the button carried `min-h-[2em]` while
				     `btn-sm` shrank its font to 14.9px, so the same `2em` came
				     out 29.9px against the tabs' 34.1px — and `pt-[0.7em]` was a
				     hand-tuned patch for the difference that still left the icon
				     2px below centre. -->
				<div class="flex self-stretch lg:hidden">
					<Popover
						open={showMoreMenu}
						onOpenChange={(e) => (showMoreMenu = e.open)}
						positioning={{ placement: "top" }}
					>
						<Popover.Trigger
							class="btn flex items-center justify-center px-2 {activeExtraTab
								? 'preset-tonal-primary'
								: ''}"
							aria-label="More composer tabs"
						>
							<span
								class="flex w-full items-center justify-center gap-1"
							>
								{#if activeExtraTab}
									{@render activeExtraTab.control?.()}
									<span class="text-xs">
										{activeExtraTab.title}
									</span>
								{:else}
									<Icons.EllipsisVertical
										size="0.9em"
										class="block"
										aria-hidden="true"
									/>
								{/if}
							</span>
						</Popover.Trigger>
						<Portal>
							<Popover.Positioner class="z-[1000]!">
								<Popover.Content
									class="card bg-primary-200-800 w-[min(90vw,240px)] space-y-4 p-4 shadow-xl"
								>
									<header class="popover-menu-title">
										<Icons.EllipsisVertical
											size={18}
											aria-hidden="true"
										/>
										<p>More</p>
									</header>
									<article class="flex flex-col gap-2">
										{#each collapsibleExtraTabs as tab}
											<button
												type="button"
												class="btn btn-sm popover-menu-btn {tabGroup ===
												tab.value
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
										<Popover.ArrowTip
											class="!bg-primary-200 dark:!bg-primary-800"
										/>
									</Popover.Arrow>
								</Popover.Content>
							</Popover.Positioner>
						</Portal>
					</Popover>
				</div>
			{/if}
		{/if}
	</Tabs.List>
	<!-- Spacing lives on the side groups as padding rather than as a `gap` on
	     this row, and each group only renders when it actually has something in
	     it. With a gap, the wrapper was always a flex item even when its
	     contents were hidden — the avatar is `max-lg:hidden`, so on mobile a
	     zero-width group still bought a full 16px of dead space at the left
	     edge, and the edit composer (which passes neither snippet) paid it
	     twice. This way an absent group costs nothing. -->
	<div class="flex items-center">
		<!-- A column only exists when it has something to show. Reserving the
		     slots on tabs that render neither avatar nor send button left an
		     empty 48px band down the side of every extra tab; the panes below
		     are full-width content and should use the whole row. -->
		{#if leftControls && (tabGroup === "compose" || tabGroup === "preview")}
			<div role="group" aria-label="Message controls" class="lg:pr-4">
				{@render leftControls()}
			</div>
		{/if}
		<div class="w-full">
			<Tabs.Content value="compose">
				<label class="sr-only" for={inputId}>
					Type your message here
				</label>
				<textarea
					id={inputId}
					class={textareaClasses ??
						"input field-sizing-content rounded-xl lg:min-h-[3.75em]"}
					rows="1"
					{placeholder}
					bind:value={markdown}
					autocomplete="off"
					spellcheck="true"
					onkeydown={handleKeyDown}
					use:focusAtEnd
					aria-describedby={contextExceeded ? warningId : undefined}
					aria-invalid={contextExceeded}
				></textarea>
			</Tabs.Content>
			<Tabs.Content value="preview">
				<!-- Sized to land on the same row height as the compose tab so
				     switching between them doesn't resize the bar. On mobile the
				     compose row is set by the 48px send button (taller than the
				     now single-line textarea), so the preview matches at 3rem; on
				     lg it's set by the 4em avatar, so the preview matches that.
				     `mb-[1em]` used to hang off the bottom here, which is what
				     made preview 4px taller than compose. -->
				<div
					class="card bg-surface-100-900 min-h-12 w-full rounded-xl p-2 lg:min-h-[4em]"
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
		{#if rightControls && tabGroup === "compose"}
			<div
				role="group"
				aria-label="Send controls"
				class="flex justify-end pl-2 lg:pl-4"
			>
				{@render rightControls()}
			</div>
		{/if}
	</div>

	<!-- Deliberately OUTSIDE the flex row above. This used to sit inside the
	     middle column, which meant the row's `items-center` centred the avatar
	     and the send button against "textarea + warning" rather than against the
	     textarea itself — they sat ~11px low. Out here it can come and go
	     without disturbing them.
	     The indent lines it up under the textarea on desktop; it's in `em`
	     (matching Avatar's own 4em) plus the row's 1rem gap, so it tracks the
	     accessibility font-scaling instead of hardcoding 80px. Below lg: the
	     avatar isn't rendered, so no indent is wanted.
	     This one is an alert and stays in flow deliberately — it's rare, and the
	     nudge when it appears is a useful signal that something is wrong. -->
	{#if tabGroup === "compose" && contextExceeded}
		<div class="mt-1 lg:pl-[calc(4em+1rem)]">
			<div id={warningId} class="text-error-500 text-xs" role="alert">
				Token limit exceeded. Message may be truncated.
			</div>
		</div>
	{/if}
</Tabs>
