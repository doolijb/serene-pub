<script lang="ts" module>
	import { SvelteMap } from "svelte/reactivity"
	import type { ConversationAttachmentCard } from "$lib/shared/sockets/conversations"

	type Candidate = Extract<ConversationAttachmentCard, { available: true }>

	/**
	 * Drafts and picks per conversation, for this tab's life (plan §6.3:
	 * drafts are kept, not persisted). Module scope so switching
	 * conversations, or closing and reopening the view, keeps a half-written
	 * message.
	 */
	const drafts = new SvelteMap<number, string>()
	const pickedFor = new SvelteMap<number, Candidate[]>()
</script>

<script lang="ts">
	/**
	 * The composer pinned under a conversation's log (PLAN-private-messages
	 * §6.3): a growing field (1–8 lines), **Attach**, **Send**. Enter sends
	 * on a keyboard-and-mouse device and Shift+Enter starts a new line; on a
	 * touch screen only the button sends, because the on-screen keyboard's
	 * Enter is how people write a second line there. Chips above the field are
	 * what will go with the message — picked sessions, characters and
	 * lorebooks, and uploads (with their progress or refusal). A refused send
	 * is said in a line under the field, never a toast (§5).
	 */
	import { onDestroy, onMount, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { CONVERSATION_BODY_MAX } from "$lib/shared/sockets/conversations"
	import { useConversations } from "$lib/client/contexts/conversations.svelte"
	import { typedSocketOrNull } from "$lib/client/sockets/typedSocket"
	import { declareInterest, onConnect } from "$lib/client/sockets/interest.svelte"
	import { createConversationTray } from "./conversationTray.svelte"
	import AttachPicker from "./AttachPicker.svelte"

	interface Props {
		conversationId: number
		/** After a send is stored — the log scrolls to it. */
		onSent?: () => void
	}

	let { conversationId, onSent }: Props = $props()

	const ctx = useConversations()

	const tray = createConversationTray(
		{
			emit: (event, data) =>
				typedSocketOrNull()?.emit(event as any, data as any),
			on: (event, handler) => declareInterest(event as any, handler)
		},
		{ conversationId: () => conversationId }
	)
	const releaseOnConnect = onConnect(() => tray.load())
	onDestroy(() => {
		releaseOnConnect()
		tray.destroy()
	})
	$effect(() => {
		void conversationId
		untrack(() => tray.load())
	})

	let field: HTMLTextAreaElement | undefined = $state()
	let sending = $state(false)
	let refusal = $state<string | null>(null)
	let pickerOpen = $state(false)
	let coarse = $state(false)

	onMount(() => {
		const mq = window.matchMedia("(pointer: coarse)")
		coarse = mq.matches
		const onChange = () => (coarse = mq.matches)
		mq.addEventListener("change", onChange)
		return () => mq.removeEventListener("change", onChange)
	})

	const draft = $derived(drafts.get(conversationId) ?? "")
	const picks = $derived(pickedFor.get(conversationId) ?? [])
	const tiles = $derived(tray.view)
	const uploading = $derived(tiles.some((t) => t.status === "uploading"))
	const readyIds = $derived(
		tiles.filter((t) => t.status === "ready").map((t) => t.id)
	)
	const tooLong = $derived(draft.length > CONVERSATION_BODY_MAX)
	const canSend = $derived(
		!sending &&
			!uploading &&
			!tooLong &&
			(draft.trim().length > 0 || picks.length > 0 || readyIds.length > 0)
	)

	// A new conversation's refusal is not this one's.
	$effect(() => {
		void conversationId
		refusal = null
	})

	/** Grow with the text, one line to eight, then scroll inside. */
	function fit() {
		if (!field) return
		const style = getComputedStyle(field)
		const line = parseFloat(style.lineHeight) || 20
		const pad =
			parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
		field.style.height = "auto"
		field.style.height = `${Math.min(field.scrollHeight, line * 8 + pad)}px`
	}
	$effect(() => {
		void draft
		queueMicrotask(fit)
	})

	function setDraft(value: string) {
		if (value) drafts.set(conversationId, value)
		else drafts.delete(conversationId)
		refusal = null
	}

	async function send() {
		if (!canSend) return
		const id = conversationId
		const body = draft.trim()
		const attachments = picks.map((p) => ({
			kind: p.kind,
			subjectId: p.subjectId
		}))
		sending = true
		refusal = null
		try {
			await ctx.send({
				conversationId: id,
				body,
				...(attachments.length ? { attachments } : {}),
				...(readyIds.length ? { trayItemIds: readyIds } : {})
			})
			drafts.delete(id)
			pickedFor.delete(id)
			// The server deleted the sent tray rows; ask for the list again so
			// the chips go (a session's composer gets this list pushed; ours asks).
			tray.load()
			onSent?.()
		} catch (err) {
			if (id === conversationId)
				refusal =
					err instanceof Error ? err.message : "That message wasn't sent."
		} finally {
			sending = false
			field?.focus()
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== "Enter" || e.shiftKey || e.isComposing || coarse) return
		e.preventDefault()
		void send()
	}

	function removePick(p: Candidate) {
		const next = picks.filter(
			(x) => !(x.kind === p.kind && x.subjectId === p.subjectId)
		)
		if (next.length) pickedFor.set(conversationId, next)
		else pickedFor.delete(conversationId)
	}

	const PICK_ICON = {
		session: Icons.MessagesSquare,
		character: Icons.UsersRound,
		lorebook: Icons.BookOpen,
		file: Icons.FileText
	} as const
</script>

<div class="flex shrink-0 flex-col gap-2" data-conversation-composer>
	{#if picks.length || tiles.length}
		<ul class="flex flex-wrap gap-1.5" aria-label="Going with this message">
			{#each picks as p (`${p.kind}:${p.subjectId}`)}
				{@const Icon = PICK_ICON[p.kind]}
				<li
					class="bg-surface-200-800 flex h-8 max-w-56 items-center gap-1.5 rounded-full pr-0.5 pl-2.5 text-xs"
				>
					<Icon size={14} class="text-surface-600-400 shrink-0" aria-hidden="true" />
					<span class="truncate">{p.title}</span>
					<button
						type="button"
						class="hover:bg-surface-300-700 grid size-7 shrink-0 place-items-center rounded-full pointer-coarse:size-11"
						aria-label="Remove {p.title}"
						onclick={() => removePick(p)}
					>
						<Icons.X size={14} aria-hidden="true" />
					</button>
				</li>
			{/each}
			{#each tiles as t (t.id)}
				<li
					class="flex h-8 max-w-64 items-center gap-1.5 rounded-full pr-0.5 pl-2.5 text-xs {t.status ===
					'refused'
						? 'bg-error-500/10 text-error-600-400'
						: 'bg-surface-200-800'}"
					title={t.refusal ?? t.filename}
				>
					{#if t.status === "uploading"}
						<Icons.LoaderCircle
							size={14}
							class="shrink-0 animate-spin"
							aria-hidden="true"
						/>
					{:else if t.status === "refused"}
						<Icons.CircleAlert size={14} class="shrink-0" aria-hidden="true" />
					{:else}
						<Icons.Paperclip
							size={14}
							class="text-surface-600-400 shrink-0"
							aria-hidden="true"
						/>
					{/if}
					<span class="truncate">{t.filename}</span>
					{#if t.status === "uploading"}
						<span class="text-surface-600-400 shrink-0">
							{Math.round(t.progress * 100)}%
						</span>
					{/if}
					{#if t.status === "refused" && t.refusal}
						<span class="sr-only">Refused: {t.refusal}</span>
					{/if}
					<button
						type="button"
						class="hover:bg-surface-300-700 grid size-7 shrink-0 place-items-center rounded-full pointer-coarse:size-11"
						aria-label="Remove {t.filename}"
						onclick={() => tray.remove(t.id)}
					>
						<Icons.X size={14} aria-hidden="true" />
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="flex items-end gap-2">
		<button
			type="button"
			class="btn-icon preset-tonal-surface size-11 shrink-0"
			title="Attach"
			aria-label="Attach"
			onclick={() => (pickerOpen = true)}
		>
			<Icons.Paperclip size={18} aria-hidden="true" />
		</button>
		<textarea
			bind:this={field}
			class="textarea min-h-11 flex-1 resize-none py-2.5 text-sm"
			rows="1"
			placeholder="Write a message"
			aria-label="Message"
			aria-describedby={refusal ? `composer-refusal-${conversationId}` : undefined}
			aria-invalid={tooLong || undefined}
			value={draft}
			oninput={(e) => setDraft(e.currentTarget.value)}
			onkeydown={onKeydown}
		></textarea>
		<button
			type="button"
			class="btn-icon preset-filled-primary-500 size-11 shrink-0"
			title={uploading ? "Waiting for uploads to finish" : "Send"}
			aria-label="Send"
			disabled={!canSend}
			aria-busy={sending}
			onclick={() => void send()}
		>
			<Icons.SendHorizontal size={18} aria-hidden="true" />
		</button>
	</div>

	{#if refusal}
		<p
			id="composer-refusal-{conversationId}"
			class="text-error-600-400 text-sm"
			role="alert"
			data-composer-refusal
		>
			{refusal}
		</p>
	{:else if tooLong}
		<p class="text-error-600-400 text-sm" role="alert">
			A message can be at most {CONVERSATION_BODY_MAX.toLocaleString()} characters.
		</p>
	{/if}
</div>

<AttachPicker
	open={pickerOpen}
	{conversationId}
	chosen={picks}
	onclose={() => (pickerOpen = false)}
	onPick={(cards) => {
		if (cards.length) pickedFor.set(conversationId, cards)
		else pickedFor.delete(conversationId)
	}}
	onUpload={(files) => tray.attach(files)}
/>
