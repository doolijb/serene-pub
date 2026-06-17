<script lang="ts">
	import type { Snippet } from "svelte"
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	import * as Icons from "@lucide/svelte"

	// Visually distinct, readable scene colors (work in both light and dark)
	const SCENE_COLORS = [
		{ bar: "hsl(220,65%,62%)", text: "hsl(220,65%,65%)", bg: "hsl(220,65%,62%,0.10)" },  // blue
		{ bar: "hsl(150,52%,48%)", text: "hsl(150,52%,52%)", bg: "hsl(150,52%,48%,0.10)" },  // green
		{ bar: "hsl(35, 75%,55%)", text: "hsl(35, 75%,58%)", bg: "hsl(35, 75%,55%,0.10)" },  // amber
		{ bar: "hsl(280,55%,62%)", text: "hsl(280,55%,66%)", bg: "hsl(280,55%,62%,0.10)" },  // purple
		{ bar: "hsl(340,60%,58%)", text: "hsl(340,60%,62%)", bg: "hsl(340,60%,58%,0.10)" },  // rose
		{ bar: "hsl(190,60%,48%)", text: "hsl(190,60%,52%)", bg: "hsl(190,60%,48%,0.10)" },  // teal
		{ bar: "hsl(55, 70%,50%)", text: "hsl(55, 70%,54%)", bg: "hsl(55, 70%,50%,0.10)" },  // yellow
		{ bar: "hsl(15, 70%,55%)", text: "hsl(15, 70%,59%)", bg: "hsl(15, 70%,55%,0.10)" },  // orange
	]

	// Props for customizing the components used
	interface Props {
		chat: Sockets.Chats.Get.Response["chat"] | undefined
		pagination: Sockets.Chats.Get.Response["pagination"] | undefined
		loadingOlderMessages: boolean
		chatMessagesContainer: HTMLDivElement | null
		onScroll: (event: Event) => void

		/** Scenes for this chat — drives the scene bracket and history-entry divider UI */
		sceneList?: Sockets.Scenes.List.SceneWithEntry[]

		/** Called when user clicks a history-entry divider */
		onHistoryEntryClick?: (info: { historyEntryId: number; lorebookId: number }) => void
		/** Called when user clicks a scene chip */
		onSceneClick?: (info: { sceneId: number; historyEntryId: number; lorebookId: number }) => void
		/** Called when user clicks "Start New Entry" after a completed entry with no successor */
		onNewHistoryEntry?: (info: { lorebookId: number }) => void
		/** Called when user clicks the "attach lorebook" suggestion shown when no lorebook is set */
		onAttachLorebook?: () => void

		// Required props for MessageComponent
		getMessageCharacter: (
			msg: SelectChatMessage
		) => SelectCharacter | SelectPersona | undefined
		canControlMessage: (msg: SelectChatMessage) => boolean
		showSwipeControls: (
			msg: SelectChatMessage,
			isGreeting: boolean
		) => boolean
		canSwipeRight: (msg: SelectChatMessage, isGreeting: boolean) => boolean
		onSwipeLeft: (msg: SelectChatMessage) => void
		onSwipeRight: (msg: SelectChatMessage) => void
		onEditMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onDeleteMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onHideMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onRegenerateMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onContinueMessage?: (event: MouseEvent, msg: SelectChatMessage) => void
		onAbortMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onBranchMessage?: (event: Event, msg: SelectChatMessage) => void
		editChatMessage: SelectChatMessage | undefined
		canRegenerateLastMessage: boolean
		hasGeneratingMessage: boolean
		isGuest: boolean

		// Snippet children
		MessageComponent: Snippet<
			[
				{
					msg: SelectChatMessage
					index: number
					chat: Sockets.Chats.Get.Response["chat"] & {
						chatMessages: SelectChatMessage[]
					}
					isLastMessage: boolean
					messagesLength: number
					getMessageCharacter: (
						msg: SelectChatMessage
					) => SelectCharacter | SelectPersona | undefined
					canControlMessage: (msg: SelectChatMessage) => boolean
					showSwipeControls: (
						msg: SelectChatMessage,
						isGreeting: boolean
					) => boolean
					canSwipeRight: (
						msg: SelectChatMessage,
						isGreeting: boolean
					) => boolean
					onSwipeLeft: (msg: SelectChatMessage) => void
					onSwipeRight: (msg: SelectChatMessage) => void
					onEditMessage: (
						event: MouseEvent,
						msg: SelectChatMessage
					) => void
					onDeleteMessage: (
						event: MouseEvent,
						msg: SelectChatMessage
					) => void
					onHideMessage: (
						event: MouseEvent,
						msg: SelectChatMessage
					) => void
					onRegenerateMessage: (
						event: MouseEvent,
						msg: SelectChatMessage
					) => void
					onContinueMessage?: (
						event: MouseEvent,
						msg: SelectChatMessage
					) => void
					onAbortMessage: (
						event: MouseEvent,
						msg: SelectChatMessage
					) => void
					onBranchMessage?: (
						event: Event,
						msg: SelectChatMessage
					) => void
					editChatMessage: SelectChatMessage | undefined
					canRegenerateLastMessage: boolean
					hasGeneratingMessage: boolean
					isGuest: boolean
				}
			]
		>
		ComposerComponent: Snippet<[]>
		NextCharacterComponent?: Snippet<[]>
	}

	let {
		chat,
		pagination,
		loadingOlderMessages,
		chatMessagesContainer = $bindable(),
		onScroll,
		sceneList = [],
		onHistoryEntryClick,
		onSceneClick,
		onNewHistoryEntry,
		onAttachLorebook,
		getMessageCharacter,
		canControlMessage,
		showSwipeControls,
		canSwipeRight,
		onSwipeLeft,
		onSwipeRight,
		onEditMessage,
		onDeleteMessage,
		onHideMessage,
		onRegenerateMessage,
		onContinueMessage,
		onAbortMessage,
		onBranchMessage,
		editChatMessage,
		canRegenerateLastMessage,
		hasGeneratingMessage,
		isGuest,
		MessageComponent,
		ComposerComponent,
		NextCharacterComponent
	}: Props = $props()

	// ── Scene / history-entry annotation ──────────────────────────
	type MsgSceneInfo = {
		scene: Sockets.Scenes.List.SceneWithEntry
		isFirstInScene: boolean
		isLastInScene: boolean
		historyEntry: Sockets.Scenes.List.SceneWithEntry["historyEntry"]
		isFirstOfEntry: boolean
		isLastOfEntry: boolean
		colorIndex: number
	}

	let msgSceneMap = $derived.by((): Map<number, MsgSceneInfo> => {
		const map = new Map<number, MsgSceneInfo>()
		if (!sceneList.length || !chat?.chatMessages.length) return map

		// Build messageId → scene lookup
		const messageToScene = new Map<number, Sockets.Scenes.List.SceneWithEntry>()
		for (const scene of sceneList) {
			for (const msgId of scene.selectedMessageIds ?? []) {
				messageToScene.set(msgId, scene)
			}
		}

		// For each scene, find its first/last message IDs in chat display order
		const sceneBounds = new Map<number, { first: number; last: number }>()
		for (const scene of sceneList) {
			const ids = new Set(scene.selectedMessageIds ?? [])
			if (!ids.size) continue
			const ordered = chat.chatMessages.filter((m) => ids.has(m.id)).map((m) => m.id)
			if (ordered.length) sceneBounds.set(scene.id, { first: ordered[0], last: ordered[ordered.length - 1] })
		}

		// For each history entry, find the last message across all its scenes
		const entryLastMsgIndex = new Map<number, number>()
		for (const scene of sceneList) {
			if (!scene.historyEntryId) continue
			const bounds = sceneBounds.get(scene.id)
			if (!bounds) continue
			const idx = chat.chatMessages.findIndex((m) => m.id === bounds.last)
			const current = entryLastMsgIndex.get(scene.historyEntryId) ?? -1
			if (idx > current) entryLastMsgIndex.set(scene.historyEntryId, idx)
		}
		const entryLastMsgId = new Map<number, number>()
		for (const [entryId, idx] of entryLastMsgIndex) {
			entryLastMsgId.set(entryId, chat.chatMessages[idx].id)
		}

		// Assign colors in the order scenes first appear in the chat
		const sceneColorIndex = new Map<number, number>()
		let colorCounter = 0
		for (const msg of chat.chatMessages) {
			const scene = messageToScene.get(msg.id)
			if (scene && !sceneColorIndex.has(scene.id)) {
				sceneColorIndex.set(scene.id, colorCounter % SCENE_COLORS.length)
				colorCounter++
			}
		}

		// Walk messages in display order to build the full map
		const seenEntryIds = new Set<number>()
		for (const msg of chat.chatMessages) {
			const scene = messageToScene.get(msg.id)
			if (!scene) continue
			const bounds = sceneBounds.get(scene.id)
			if (!bounds) continue

			const isFirstInScene = bounds.first === msg.id
			const isLastInScene = bounds.last === msg.id
			const entryId = scene.historyEntryId
			const isFirstOfEntry = isFirstInScene && !!entryId && !seenEntryIds.has(entryId)
			if (isFirstOfEntry) seenEntryIds.add(entryId)
			const isLastOfEntry = !!entryId && entryLastMsgId.get(entryId) === msg.id

			map.set(msg.id, {
				scene,
				isFirstInScene,
				isLastInScene,
				historyEntry: scene.historyEntry,
				isFirstOfEntry,
				isLastOfEntry,
				colorIndex: sceneColorIndex.get(scene.id) ?? 0
			})
		}

		return map
	})

	function formatEntryDate(he: { year: number; month: number | null; day: number | null }): string {
		let s = `Year ${he.year}`
		if (he.month) s += `, Mo. ${he.month}`
		if (he.day) s += `, Day ${he.day}`
		return s
	}
</script>

<div class="relative flex h-full flex-col">
	<div
		id="chat-history"
		class="flex flex-1 flex-col gap-3 overflow-auto"
		bind:this={chatMessagesContainer}
		onscroll={onScroll}
		role="log"
		aria-label="Chat messages"
		aria-live="polite"
		aria-atomic="false"
	>
		<div class="p-2">
			{#if !chat || chat.chatMessages.length === 0}
				<div class="text-muted mt-8 text-center">No messages yet.</div>
			{:else}
				<!-- Loading indicator for older messages -->
				{#if loadingOlderMessages}
					<div class="text-muted py-2 text-center">
						<div class="inline-flex items-center gap-2">
							<div class="h-4 w-4 animate-spin rounded-full border-b-2 border-current"></div>
							Loading older messages...
						</div>
					</div>
				{/if}

				<ul
					class="flex flex-1 flex-col gap-3"
					role="group"
					aria-label="Chat conversation with {chat.chatMessages.length} messages"
				>
					{#each chat.chatMessages as msg, index (msg.id)}
						{@const isLastMessage = index === chat.chatMessages.length - 1}
						{@const si = msgSceneMap.get(msg.id)}
						{@const color = si ? SCENE_COLORS[si.colorIndex] : null}

						<!-- History-entry divider: shown once before the first scene message of each entry -->
						{#if si?.isFirstOfEntry && si.historyEntry}
							<li class="w-full" role="separator">
								<div class="my-1 flex items-center gap-2">
									<div class="bg-surface-300-700 h-px flex-1"></div>
									{#if onHistoryEntryClick}
										<button
											class="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-widest transition-all duration-100 select-none"
											style="color: hsl(var(--color-surface-400)); background: transparent;"
											onmouseenter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "hsl(var(--color-surface-400))"; el.style.color = "white" }}
											onmouseleave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = "hsl(var(--color-surface-400))" }}
											onclick={() => onHistoryEntryClick!({
												historyEntryId: si.scene.historyEntryId,
												lorebookId: si.scene.lorebookId
											})}
											title="Open history entry in lorebook"
										>
											<Icons.Calendar size={11} />
											{formatEntryDate(si.historyEntry)}
										</button>
									{:else}
										<span class="text-surface-400 flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold uppercase tracking-widest whitespace-nowrap">
											<Icons.Calendar size={11} />
											{formatEntryDate(si.historyEntry)}
										</span>
									{/if}
									<div class="bg-surface-300-700 h-px flex-1"></div>
								</div>
							</li>
						{/if}

						<!-- Scene name chip: shown at the top of each scene group -->
						{#if si?.isFirstInScene && color}
							<li class="w-full" role="presentation">
								<div class="mb-0.5 pl-3">
									{#if onSceneClick}
										<button
											class="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium transition-all duration-100 select-none"
											style="color: {color.text}; background: transparent;"
											onmouseenter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = color.bar; el.style.color = "white" }}
											onmouseleave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = color.text }}
											onclick={() => onSceneClick!({
												sceneId: si.scene.id,
												historyEntryId: si.scene.historyEntryId,
												lorebookId: si.scene.lorebookId
											})}
											title="Open scene in lorebook"
										>
											<Icons.Film size={11} />
											{si.scene.name ?? "Scene"}
										</button>
									{:else}
										<span
											class="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium"
											style="color: {color.text};"
										>
											<Icons.Film size={11} />
											{si.scene.name ?? "Scene"}
										</span>
									{/if}
								</div>
							</li>
						{/if}

						<!-- Message row: optional scene bar on the left -->
						<li class="flex w-full items-stretch gap-2">
							<!-- Scene left bar (inline-style color for cycle support) -->
							{#if si && color}
								<div
									class="w-0.5 shrink-0 transition-opacity duration-150"
									class:rounded-t-full={si.isFirstInScene}
									class:rounded-b-full={si.isLastInScene}
									style="background: {color.bar}; opacity: 0.5;"
								></div>
							{:else}
								<div class="w-0.5 shrink-0"></div>
							{/if}

							<div class="min-w-0 flex-1">
								{@render MessageComponent({
									msg,
									index,
									chat,
									isLastMessage,
									messagesLength: chat.chatMessages.length,
									getMessageCharacter,
									canControlMessage,
									showSwipeControls,
									canSwipeRight,
									onSwipeLeft,
									onSwipeRight,
									onEditMessage,
									onDeleteMessage,
									onHideMessage,
									onRegenerateMessage,
									onContinueMessage,
									onAbortMessage,
									onBranchMessage,
									editChatMessage,
									canRegenerateLastMessage,
									hasGeneratingMessage,
									isGuest
								})}
								{#if isLastMessage && NextCharacterComponent}
									{@render NextCharacterComponent()}
								{/if}
							</div>
						</li>

						<!-- Completed-entry marker: shown after the last message of a completed history entry -->
						{#if si?.isLastOfEntry && si.historyEntry?.isCompleted}
							<li class="w-full" role="separator">
								<div class="my-1 flex items-center gap-2">
									<div class="bg-surface-300-700 h-px flex-1"></div>
									{#if si.historyEntry.nextEntry}
										{@const next = si.historyEntry.nextEntry}
										{#if onHistoryEntryClick}
											<button
												class="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-widest transition-all duration-100 select-none"
												style="color: hsl(var(--color-surface-400)); background: transparent;"
												onmouseenter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "hsl(var(--color-surface-400))"; el.style.color = "white" }}
												onmouseleave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = "hsl(var(--color-surface-400))" }}
												onclick={() => onHistoryEntryClick!({ historyEntryId: next.id, lorebookId: si.scene.lorebookId })}
												title="Open next history entry in lorebook"
											>
												<Icons.Calendar size={11} />
												Next: {formatEntryDate(next)}
											</button>
										{:else}
											<span class="text-surface-400 flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold uppercase tracking-widest whitespace-nowrap">
												<Icons.Calendar size={11} />
												Next: {formatEntryDate(next)}
											</span>
										{/if}
									{:else}
										<button
											class="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-widest transition-all duration-100 select-none"
											style="color: hsl(var(--color-primary-500)); background: transparent;"
											onmouseenter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "hsl(var(--color-primary-500))"; el.style.color = "white" }}
											onmouseleave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = "hsl(var(--color-primary-500))" }}
											onclick={() => onNewHistoryEntry?.({ lorebookId: si.scene.lorebookId })}
											title="Start a new history entry"
										>
											<Icons.CalendarPlus size={11} />
											Start New Entry
										</button>
									{/if}
									<div class="bg-surface-300-700 h-px flex-1"></div>
								</div>
							</li>
						{/if}
					{/each}
				</ul>
			{/if}

			<!-- No-lorebook suggestion: shown after the first message when no lorebook is attached -->
			{#if chat && chat.chatMessages.length > 0 && !chat.lorebookId}
				<div class="my-2 flex items-center gap-2">
					<div class="bg-surface-300-700 h-px flex-1"></div>
					<button
						class="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-widest transition-all duration-100 select-none"
						style="color: hsl(var(--color-primary-500)); background: transparent;"
						onmouseenter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "hsl(var(--color-primary-500))"; el.style.color = "white" }}
						onmouseleave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = "hsl(var(--color-primary-500))" }}
						onclick={() => onAttachLorebook?.()}
						title="Attach a lorebook to track history entries and scenes"
					>
						<Icons.BookPlus size={11} />
						Attach a Lorebook
					</button>
					<div class="bg-surface-300-700 h-px flex-1"></div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Composer area -->
	{@render ComposerComponent()}
</div>
