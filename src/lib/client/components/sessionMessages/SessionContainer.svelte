<script lang="ts">
	import type { Snippet } from "svelte"
	import { untrack } from "svelte"
	import { softFade } from "$lib/client/utils/motion"
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	import * as Icons from "@lucide/svelte"

	// Visually distinct, readable scene colors (work in both light and dark)
	const SCENE_COLORS = [
		{
			bar: "hsl(220,65%,62%)",
			text: "hsl(220,65%,65%)",
			bg: "hsl(220,65%,62%,0.10)"
		}, // blue
		{
			bar: "hsl(150,52%,48%)",
			text: "hsl(150,52%,52%)",
			bg: "hsl(150,52%,48%,0.10)"
		}, // green
		{
			bar: "hsl(35, 75%,55%)",
			text: "hsl(35, 75%,58%)",
			bg: "hsl(35, 75%,55%,0.10)"
		}, // amber
		{
			bar: "hsl(280,55%,62%)",
			text: "hsl(280,55%,66%)",
			bg: "hsl(280,55%,62%,0.10)"
		}, // purple
		{
			bar: "hsl(340,60%,58%)",
			text: "hsl(340,60%,62%)",
			bg: "hsl(340,60%,58%,0.10)"
		}, // rose
		{
			bar: "hsl(190,60%,48%)",
			text: "hsl(190,60%,52%)",
			bg: "hsl(190,60%,48%,0.10)"
		}, // teal
		{
			bar: "hsl(55, 70%,50%)",
			text: "hsl(55, 70%,54%)",
			bg: "hsl(55, 70%,50%,0.10)"
		}, // yellow
		{
			bar: "hsl(15, 70%,55%)",
			text: "hsl(15, 70%,59%)",
			bg: "hsl(15, 70%,55%,0.10)"
		} // orange
	]

	// Props for customizing the components used
	interface Props {
		session: Sockets.Sessions.Get.Response["session"] | undefined
		pagination: Sockets.Sessions.Get.Response["pagination"] | undefined
		loadingOlderMessages: boolean
		sessionMessagesContainer: HTMLDivElement | null
		onScroll: (event: Event) => void

		/** Scenes for this session — drives the scene bracket and history-entry divider UI */
		sceneList?: Sockets.Scenes.List.SceneWithEntry[]

		/** Called when user clicks a history-entry divider */
		onHistoryEntryClick?: (info: {
			historyEntryId: number
			lorebookId: number
		}) => void
		/** Called when user clicks a scene chip */
		onSceneClick?: (info: {
			sceneId: number
			historyEntryId: number
			lorebookId: number
		}) => void
		/** Called when user clicks "Start New Entry" after a completed entry with no successor */
		onNewHistoryEntry?: (info: { lorebookId: number }) => void
		/** Called when user clicks the "attach lorebook" suggestion shown when no lorebook is set */
		onAttachLorebook?: () => void

		// Required props for MessageComponent
		getMessageCharacter: (
			msg: SelectSessionMessage
		) => SelectCharacter | SelectPersona | undefined
		canControlMessage: (msg: SelectSessionMessage) => boolean
		showSwipeControls: (
			msg: SelectSessionMessage,
			isGreeting: boolean
		) => boolean
		canSwipeRight: (
			msg: SelectSessionMessage,
			isGreeting: boolean
		) => boolean
		onSwipeLeft: (msg: SelectSessionMessage) => void
		onSwipeRight: (msg: SelectSessionMessage) => void
		onEditMessage: (event: Event, msg: SelectSessionMessage) => void
		onDeleteMessage: (event: Event, msg: SelectSessionMessage) => void
		onHideMessage: (event: Event, msg: SelectSessionMessage) => void
		onRegenerateMessage: (event: Event, msg: SelectSessionMessage) => void
		onContinueMessage?: (event: Event, msg: SelectSessionMessage) => void
		onAbortMessage: (event: Event, msg: SelectSessionMessage) => void
		onBranchMessage?: (event: Event, msg: SelectSessionMessage) => void
		editSessionMessage: SelectSessionMessage | undefined
		canRegenerateLastMessage: boolean
		hasGeneratingMessage: boolean
		isGuest: boolean

		// Snippet children
		MessageComponent: Snippet<
			[
				{
					msg: SelectSessionMessage
					index: number
					session: Sockets.Sessions.Get.Response["session"] & {
						sessionMessages: SelectSessionMessage[]
					}
					isLastMessage: boolean
					messagesLength: number
					getMessageCharacter: (
						msg: SelectSessionMessage
					) => SelectCharacter | SelectPersona | undefined
					canControlMessage: (msg: SelectSessionMessage) => boolean
					showSwipeControls: (
						msg: SelectSessionMessage,
						isGreeting: boolean
					) => boolean
					canSwipeRight: (
						msg: SelectSessionMessage,
						isGreeting: boolean
					) => boolean
					onSwipeLeft: (msg: SelectSessionMessage) => void
					onSwipeRight: (msg: SelectSessionMessage) => void
					onEditMessage: (
						event: Event,
						msg: SelectSessionMessage
					) => void
					onDeleteMessage: (
						event: Event,
						msg: SelectSessionMessage
					) => void
					onHideMessage: (
						event: Event,
						msg: SelectSessionMessage
					) => void
					onRegenerateMessage: (
						event: Event,
						msg: SelectSessionMessage
					) => void
					onContinueMessage?: (
						event: Event,
						msg: SelectSessionMessage
					) => void
					onAbortMessage: (
						event: Event,
						msg: SelectSessionMessage
					) => void
					onBranchMessage?: (
						event: Event,
						msg: SelectSessionMessage
					) => void
					editSessionMessage: SelectSessionMessage | undefined
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
		session,
		pagination,
		loadingOlderMessages,
		sessionMessagesContainer = $bindable(),
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
		editSessionMessage,
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

	// Lightweight signal capturing only the message *set and order* (ids), not
	// their content. The parent replaces the whole `session.sessionMessages` array
	// reference on every streamed chunk even when only one message's content
	// changed, which would otherwise force the expensive O(scenes × messages)
	// derivation below to fully recompute on every token.
	let msgOrderKey = $derived(
		session?.sessionMessages.map((m) => m.id).join(",") ?? ""
	)

	let msgSceneMap = $derived.by((): Map<number, MsgSceneInfo> => {
		// Track sceneList and msgOrderKey as the real dependencies here. The
		// heavy work below (which reads session.sessionMessages directly) is wrapped
		// in untrack() so a session.sessionMessages reference change alone doesn't
		// dirty this derived — only a change in msgOrderKey's *value* (i.e. the
		// message ids/order actually changing) or sceneList does.
		void sceneList.length
		void msgOrderKey

		return untrack(buildMsgSceneMap)
	})

	function buildMsgSceneMap(): Map<number, MsgSceneInfo> {
		const map = new Map<number, MsgSceneInfo>()
		if (!sceneList.length || !session?.sessionMessages.length) return map

		// Build messageId → scene lookup
		const messageToScene = new Map<
			number,
			Sockets.Scenes.List.SceneWithEntry
		>()
		for (const scene of sceneList) {
			for (const msgId of scene.selectedMessageIds ?? []) {
				messageToScene.set(msgId, scene)
			}
		}

		// For each scene, find its first/last message IDs in session display order
		const sceneBounds = new Map<number, { first: number; last: number }>()
		for (const scene of sceneList) {
			const ids = new Set(scene.selectedMessageIds ?? [])
			if (!ids.size) continue
			const ordered = session.sessionMessages
				.filter((m) => ids.has(m.id))
				.map((m) => m.id)
			if (ordered.length)
				sceneBounds.set(scene.id, {
					first: ordered[0],
					last: ordered[ordered.length - 1]
				})
		}

		// For each history entry, find the last message across all its scenes
		const entryLastMsgIndex = new Map<number, number>()
		for (const scene of sceneList) {
			if (!scene.historyEntryId) continue
			const bounds = sceneBounds.get(scene.id)
			if (!bounds) continue
			const idx = session.sessionMessages.findIndex(
				(m) => m.id === bounds.last
			)
			const current = entryLastMsgIndex.get(scene.historyEntryId) ?? -1
			if (idx > current) entryLastMsgIndex.set(scene.historyEntryId, idx)
		}
		const entryLastMsgId = new Map<number, number>()
		for (const [entryId, idx] of entryLastMsgIndex) {
			entryLastMsgId.set(entryId, session.sessionMessages[idx].id)
		}

		// Assign colors in the order scenes first appear in the session
		const sceneColorIndex = new Map<number, number>()
		let colorCounter = 0
		for (const msg of session.sessionMessages) {
			const scene = messageToScene.get(msg.id)
			if (scene && !sceneColorIndex.has(scene.id)) {
				sceneColorIndex.set(
					scene.id,
					colorCounter % SCENE_COLORS.length
				)
				colorCounter++
			}
		}

		// Walk messages in display order to build the full map
		const seenEntryIds = new Set<number>()
		for (const msg of session.sessionMessages) {
			const scene = messageToScene.get(msg.id)
			if (!scene) continue
			const bounds = sceneBounds.get(scene.id)
			if (!bounds) continue

			const isFirstInScene = bounds.first === msg.id
			const isLastInScene = bounds.last === msg.id
			const entryId = scene.historyEntryId
			const isFirstOfEntry =
				isFirstInScene && !!entryId && !seenEntryIds.has(entryId)
			if (isFirstOfEntry) seenEntryIds.add(entryId)
			const isLastOfEntry =
				!!entryId && entryLastMsgId.get(entryId) === msg.id

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
	}

	function formatEntryDate(he: {
		year: number
		month: number | null
		day: number | null
	}): string {
		let s = `Year ${he.year}`
		if (he.month) s += `, Mo. ${he.month}`
		if (he.day) s += `, Day ${he.day}`
		return s
	}
</script>

<div class="relative flex h-full flex-col">
	<div
		id="session-history"
		class="flex flex-1 flex-col gap-3 overflow-auto"
		bind:this={sessionMessagesContainer}
		onscroll={onScroll}
		role="log"
		aria-label="Session messages"
		aria-live="polite"
		aria-atomic="false"
	>
		<div class="p-2">
			{#if !session}
				<!-- Still loading the session itself — distinct from a genuinely
				     empty session below, otherwise "No messages yet." flashes on
				     every session open even when it has hundreds of messages. -->
				<div class="flex flex-col items-center gap-2 py-16">
					<Icons.Loader2
						size={28}
						class="text-surface-400 animate-spin"
					/>
					<span class="text-muted text-sm">Loading session…</span>
				</div>
			{:else if session.sessionMessages.length === 0}
				<div class="flex flex-col items-center gap-2 py-16 text-center">
					<Icons.MessageSquareText
						size={28}
						class="text-surface-400"
					/>
					<span class="text-muted text-sm">
						Send a message to begin the roleplay
					</span>
				</div>
			{:else}
				<!-- Loading indicator for older messages -->
				{#if loadingOlderMessages}
					<div class="text-muted py-2 text-center">
						<div class="inline-flex items-center gap-2">
							<Icons.Loader2 size={16} class="animate-spin" />
							Loading older messages...
						</div>
					</div>
				{/if}

				<ul
					class="flex flex-1 flex-col gap-3"
					role="group"
					aria-label="Session conversation with {session
						.sessionMessages.length} messages"
				>
					{#each session.sessionMessages as msg, index (msg.id)}
						{@const isLastMessage =
							index === session.sessionMessages.length - 1}
						{@const si = msgSceneMap.get(msg.id)}
						{@const color = si ? SCENE_COLORS[si.colorIndex] : null}

						<!-- History-entry divider: shown once before the first scene message of each entry -->
						{#if si?.isFirstOfEntry && si.historyEntry}
							<li class="w-full" role="separator">
								<div class="my-1 flex items-center gap-2">
									<div
										class="bg-surface-300-700 h-px flex-1"
									></div>
									{#if onHistoryEntryClick}
										<button
											class="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold tracking-widest uppercase transition-all duration-100 select-none"
											style="color: hsl(var(--color-surface-400)); background: transparent;"
											onmouseenter={(e) => {
												const el =
													e.currentTarget as HTMLElement
												el.style.background =
													"hsl(var(--color-surface-400))"
												el.style.color = "white"
											}}
											onmouseleave={(e) => {
												const el =
													e.currentTarget as HTMLElement
												el.style.background =
													"transparent"
												el.style.color =
													"hsl(var(--color-surface-400))"
											}}
											onclick={() =>
												onHistoryEntryClick!({
													historyEntryId:
														si.scene.historyEntryId,
													lorebookId:
														si.scene.lorebookId
												})}
											title="Open history entry in lorebook"
										>
											<Icons.Calendar size={11} />
											{formatEntryDate(si.historyEntry)}
										</button>
									{:else}
										<span
											class="text-surface-400 flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold tracking-widest whitespace-nowrap uppercase"
										>
											<Icons.Calendar size={11} />
											{formatEntryDate(si.historyEntry)}
										</span>
									{/if}
									<div
										class="bg-surface-300-700 h-px flex-1"
									></div>
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
											onmouseenter={(e) => {
												const el =
													e.currentTarget as HTMLElement
												el.style.background = color.bar
												el.style.color = "white"
											}}
											onmouseleave={(e) => {
												const el =
													e.currentTarget as HTMLElement
												el.style.background =
													"transparent"
												el.style.color = color.text
											}}
											onclick={() =>
												onSceneClick!({
													sceneId: si.scene.id,
													historyEntryId:
														si.scene.historyEntryId,
													lorebookId:
														si.scene.lorebookId
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

						<!-- Message row: optional scene bar on the left.
						     Opacity-only fade, no height/transform — autoscroll
						     reads scrollHeight synchronously on insert, so an
						     entering message has to contribute its full height
						     to layout immediately.
						     Enter is suppressed for bulk inserts: while older
						     messages are being prepended, and for anything that
						     isn't the last message (so switching sessions doesn't
						     fade the whole backlog in). First render needs no
						     guard — Svelte transitions are local by default, so
						     they don't play when an ancestor block is created.
						     Exit is fade-only: the <ul> is `gap-3`, and a
						     collapsing <li> would leave that gap behind to snap
						     shut at the end — a worse artifact than the fix. -->
						<li
							class="flex w-full items-stretch gap-2"
							in:softFade={{
								suppressed:
									loadingOlderMessages || !isLastMessage
							}}
							out:softFade
						>
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
									session,
									isLastMessage,
									messagesLength:
										session.sessionMessages.length,
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
									editSessionMessage,
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
									<div
										class="bg-surface-300-700 h-px flex-1"
									></div>
									{#if si.historyEntry.nextEntry}
										{@const next =
											si.historyEntry.nextEntry}
										{#if onHistoryEntryClick}
											<button
												class="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold tracking-widest uppercase transition-all duration-100 select-none"
												style="color: hsl(var(--color-surface-400)); background: transparent;"
												onmouseenter={(e) => {
													const el =
														e.currentTarget as HTMLElement
													el.style.background =
														"hsl(var(--color-surface-400))"
													el.style.color = "white"
												}}
												onmouseleave={(e) => {
													const el =
														e.currentTarget as HTMLElement
													el.style.background =
														"transparent"
													el.style.color =
														"hsl(var(--color-surface-400))"
												}}
												onclick={() =>
													onHistoryEntryClick!({
														historyEntryId: next.id,
														lorebookId:
															si.scene.lorebookId
													})}
												title="Open next history entry in lorebook"
											>
												<Icons.Calendar size={11} />
												Next: {formatEntryDate(next)}
											</button>
										{:else}
											<span
												class="text-surface-400 flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold tracking-widest whitespace-nowrap uppercase"
											>
												<Icons.Calendar size={11} />
												Next: {formatEntryDate(next)}
											</span>
										{/if}
									{:else}
										<button
											class="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold tracking-widest uppercase transition-all duration-100 select-none"
											style="color: hsl(var(--color-primary-500)); background: transparent;"
											onmouseenter={(e) => {
												const el =
													e.currentTarget as HTMLElement
												el.style.background =
													"hsl(var(--color-primary-500))"
												el.style.color = "white"
											}}
											onmouseleave={(e) => {
												const el =
													e.currentTarget as HTMLElement
												el.style.background =
													"transparent"
												el.style.color =
													"hsl(var(--color-primary-500))"
											}}
											onclick={() =>
												onNewHistoryEntry?.({
													lorebookId:
														si.scene.lorebookId
												})}
											title="Start a new history entry"
										>
											<Icons.CalendarPlus size={11} />
											Start New Entry
										</button>
									{/if}
									<div
										class="bg-surface-300-700 h-px flex-1"
									></div>
								</div>
							</li>
						{/if}
					{/each}
				</ul>
			{/if}

			<!-- No-lorebook suggestion: shown after the first message when no lorebook is attached -->
			{#if session && session.sessionMessages.length > 0 && !session.lorebookId}
				<div class="my-2 flex items-center gap-2">
					<div class="bg-surface-300-700 h-px flex-1"></div>
					<button
						class="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold tracking-widest uppercase transition-all duration-100 select-none"
						style="color: hsl(var(--color-primary-500)); background: transparent;"
						onmouseenter={(e) => {
							const el = e.currentTarget as HTMLElement
							el.style.background =
								"hsl(var(--color-primary-500))"
							el.style.color = "white"
						}}
						onmouseleave={(e) => {
							const el = e.currentTarget as HTMLElement
							el.style.background = "transparent"
							el.style.color = "hsl(var(--color-primary-500))"
						}}
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
