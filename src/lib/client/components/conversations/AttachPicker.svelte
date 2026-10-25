<script lang="ts">
	/**
	 * **Attach** — what a conversation message can carry
	 * (PLAN-private-messages §6.5): a portaled dialog with one tab per
	 * attachment kind, **Files · Sessions · Characters · Lorebooks**. Files
	 * uploads into the conversation's tray; the other three list what
	 * `conversations:attachable` says every member can already see (the
	 * attachment gate, §5), so a pick here will pass at Send unless access
	 * changes in between. Several may be ticked across tabs; **Attach** hands
	 * them back as chips for the composer.
	 */
	import { untrack } from "svelte"
	import { SvelteMap } from "svelte/reactivity"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import type {
		ConversationAttachmentCard,
		ConversationAttachmentKind
	} from "$lib/shared/sockets/conversations"
	import { useConversations } from "$lib/client/contexts/conversations.svelte"
	import PanelTabStrip, { type PanelTab } from "../panels/PanelTabStrip.svelte"
	import CharacterPickRow from "../sessionForms/CharacterPickRow.svelte"
	import AvatarStack from "../AvatarStack.svelte"
	import EmptyState from "../EmptyState.svelte"
	import LoadingState from "../LoadingState.svelte"

	type PickKind = Exclude<ConversationAttachmentKind, "file">
	type Candidate = Extract<ConversationAttachmentCard, { available: true }>

	interface Props {
		open: boolean
		conversationId: number
		/** Already chosen in the composer, so they show ticked. */
		chosen?: Candidate[]
		onclose: () => void
		/** The ticked candidates, every tab's together. */
		onPick: (cards: Candidate[]) => void
		/** Files chosen on the Files tab; the composer's tray uploads them. */
		onUpload: (files: File[]) => void
	}

	let {
		open = $bindable(),
		conversationId,
		chosen = [],
		onclose,
		onPick,
		onUpload
	}: Props = $props()

	const ctx = useConversations()

	const TABS: PanelTab[] = [
		{ value: "file", label: "Files", icon: Icons.Paperclip },
		{ value: "session", label: "Sessions", icon: Icons.MessagesSquare },
		{ value: "character", label: "Characters", icon: Icons.UsersRound },
		{ value: "lorebook", label: "Lorebooks", icon: Icons.BookOpen }
	]
	const NOUN: Record<PickKind, string> = {
		session: "sessions",
		character: "characters",
		lorebook: "lorebooks"
	}
	/** What the tray accepts (ATTACHMENT_CAPS' kinds): images, text, PDF. */
	const ACCEPT =
		"image/png,image/jpeg,image/webp,image/gif,text/plain,text/markdown,.txt,.md,application/pdf"

	let tab = $state("file")
	let search = $state("")
	let loading = $state(false)
	let refusal = $state<string | null>(null)
	let candidates = $state<Candidate[]>([])
	const picked = new SvelteMap<string, Candidate>()
	let fileInput: HTMLInputElement | undefined = $state()

	const keyOf = (c: { kind: string; subjectId: number }) =>
		`${c.kind}:${c.subjectId}`

	// Opening starts from what the composer already holds.
	$effect(() => {
		if (!open) return
		untrack(() => {
			picked.clear()
			for (const c of chosen) picked.set(keyOf(c), c)
			search = ""
			tab = "file"
		})
	})

	// Ask the gate for the tab's candidates; the search narrows on the server.
	let seq = 0
	$effect(() => {
		if (!open || tab === "file") return
		const kind = tab as PickKind
		const q = search.trim()
		const mine = ++seq
		loading = true
		refusal = null
		const timer = setTimeout(() => {
			ctx.attachable({ conversationId, kind, ...(q ? { q } : {}) })
				.then((reply) => {
					if (mine !== seq) return
					candidates = reply.candidates.filter(
						(c): c is Candidate => c.available
					)
				})
				.catch((err: unknown) => {
					if (mine !== seq) return
					candidates = []
					refusal =
						err instanceof Error
							? err.message
							: "Couldn't load what you can attach."
				})
				.finally(() => {
					if (mine === seq) loading = false
				})
		}, q ? 250 : 0)
		return () => clearTimeout(timer)
	})

	function toggle(c: Candidate) {
		const key = keyOf(c)
		if (picked.has(key)) picked.delete(key)
		else picked.set(key, c)
	}

	function confirm() {
		onPick([...picked.values()])
		onclose()
	}

	function chooseFiles(e: Event) {
		const input = e.currentTarget as HTMLInputElement
		const files = Array.from(input.files ?? [])
		input.value = ""
		if (!files.length) return
		onUpload(files)
		onclose()
	}
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!e.open) onclose()
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 flex h-[min(90vh,640px)] w-[min(95vw,560px)] flex-col gap-4 p-6 shadow-xl"
			>
				<header class="flex shrink-0 items-start gap-2">
					<div class="min-w-0 flex-1 space-y-1">
						<Dialog.Title
							class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold"
						>
							Attach
						</Dialog.Title>
						<Dialog.Description class="text-surface-600-400 text-sm">
							Everyone in this conversation can open what you
							attach.
						</Dialog.Description>
					</div>
					<Dialog.CloseTrigger
						class="btn-icon hover:preset-tonal size-11 shrink-0"
						aria-label="Close"
					>
						<Icons.X size={16} aria-hidden="true" />
					</Dialog.CloseTrigger>
				</header>

				<PanelTabStrip
					tabs={TABS}
					bind:value={tab}
					ariaLabel="What to attach"
					panelIdPrefix="attach"
					class="shrink-0"
				/>

				<div
					id="attach-{tab}"
					role="tabpanel"
					aria-labelledby="attach-{tab}-tab"
					class="flex min-h-0 flex-1 flex-col gap-3"
				>
					{#if tab === "file"}
						<div class="flex flex-col items-start gap-2">
							<button
								type="button"
								class="btn preset-filled-primary-500 min-h-11"
								onclick={() => fileInput?.click()}
							>
								<Icons.Upload size={16} aria-hidden="true" />
								Upload files
							</button>
							<p class="text-surface-600-400 text-sm">
								Images (PNG, JPEG, WebP, GIF), text files and
								PDFs. They upload while you write.
							</p>
							<input
								bind:this={fileInput}
								type="file"
								multiple
								accept={ACCEPT}
								class="hidden"
								onchange={chooseFiles}
							/>
						</div>
					{:else}
						{@const kind = tab as PickKind}
						<input
							class="input w-full shrink-0"
							type="search"
							placeholder="Search {NOUN[kind]}"
							aria-label="Search {NOUN[kind]}"
							bind:value={search}
						/>
						<!-- The one scroller: no padding on it (STYLE-GUIDE §5.2). -->
						<div class="min-h-0 flex-1 overflow-y-auto">
							<div class="mr-1">
								{#if loading && candidates.length === 0}
									<LoadingState message="Loading…" />
								{:else if refusal}
									<p class="text-error-600-400 text-sm" role="alert">
										{refusal}
									</p>
								{:else if candidates.length === 0}
									<EmptyState
										icon={kind === "session"
											? Icons.MessagesSquare
											: kind === "character"
												? Icons.UsersRound
												: Icons.BookOpen}
										message={search.trim()
											? `No ${NOUN[kind]} match "${search.trim()}".`
											: `No ${NOUN[kind]} everyone here can open.`}
									/>
								{:else}
									<ul class="flex flex-col gap-1" aria-label={NOUN[kind]}>
										{#each candidates as c (keyOf(c))}
											<li>
												{#if c.kind === "character"}
													<CharacterPickRow
														character={{
															id: c.subjectId,
															name: c.title,
															description: c.subtitle ?? undefined,
															isPersona: c.isPersona,
															_avatar: c.avatarSrc
														} as any}
														kind="checkbox"
														checked={picked.has(keyOf(c))}
														onchange={() => toggle(c)}
													/>
												{:else}
													{@render pickRow(c)}
												{/if}
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						</div>
					{/if}
				</div>

				{#if tab !== "file"}
					<footer class="flex shrink-0 justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal-surface min-h-11"
							onclick={onclose}
						>
							Cancel
						</button>
						<button
							type="button"
							class="btn preset-filled-primary-500 min-h-11"
							disabled={picked.size === 0}
							onclick={confirm}
						>
							{picked.size > 0 ? `Attach ${picked.size}` : "Attach"}
						</button>
					</footer>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<!-- A session or lorebook candidate, on CharacterPickRow's recipe: the
     native checkbox inside the row's label, the whole row the target. -->
{#snippet pickRow(c: Candidate)}
	{@const checked = picked.has(keyOf(c))}
	<label
		class="hover:bg-surface-200-800 flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-base px-2 py-1.5 {checked
			? 'sidebar-row-active'
			: ''}"
	>
		<input
			type="checkbox"
			class="checkbox shrink-0"
			{checked}
			onchange={() => toggle(c)}
		/>
		{#if c.kind === "session"}
			<AvatarStack
				members={c.faces.map((f) => ({ name: f.name, _avatar: f.src }))}
				fallback="initial"
				size="sm"
				ring="ring-surface-100-900"
			/>
		{:else}
			<span
				class="bg-surface-200-800 text-surface-700-300 grid size-10 shrink-0 place-items-center rounded-base"
			>
				<Icons.BookOpen size={18} aria-hidden="true" />
			</span>
		{/if}
		<span class="min-w-0 flex-1 text-left">
			<span class="block truncate text-lead font-medium">{c.title}</span>
			{#if c.subtitle}
				<span class="text-surface-600-400 block truncate text-xs">
					{c.subtitle}
				</span>
			{/if}
		</span>
	</label>
{/snippet}
