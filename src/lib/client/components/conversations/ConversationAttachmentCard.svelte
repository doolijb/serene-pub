<script lang="ts">
	/**
	 * One attachment on a conversation message (PLAN-private-messages §6.4):
	 * a 56px row at radius 10 on `surface-200-800` — a face or an icon tile,
	 * the title at 14px, the kind line at 12px muted. Pressing it opens the
	 * thing exactly as a Jump hit does (`openSubject`). An image file is an
	 * inline preview capped at 320px that opens full size in a new tab; any
	 * other file downloads.
	 *
	 * Unavailable (`available: false`: the gate refused this reader at read
	 * time, or the thing is gone) is the same row dimmed and inert, saying
	 * which (§5: membership changes never re-gate history; the card says so).
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type { ConversationAttachmentCard } from "$lib/shared/sockets/conversations"
	import Avatar from "../Avatar.svelte"
	import AvatarStack from "../AvatarStack.svelte"
	import { downloadHref, openSubject } from "./openSubject"

	interface Props {
		card: ConversationAttachmentCard
	}

	let { card }: Props = $props()

	const panelsCtx: PanelsCtx = getContext("panelsCtx")

	const KIND_WORD: Record<ConversationAttachmentCard["kind"], string> = {
		session: "Session",
		character: "Character",
		lorebook: "Lorebook",
		file: "File"
	}

	/** The 12px line: the kind, then what the server said about it. */
	const kindLine = $derived.by(() => {
		if (!card.available)
			return card.unavailableWhy === "gone"
				? "No longer available"
				: "Not shared with you"
		if (card.kind === "file") return card.subtitle ?? "File"
		if (card.kind === "character")
			return card.isPersona ? "Persona" : (card.subtitle ?? "Character")
		return card.subtitle
			? `${KIND_WORD[card.kind]} · ${card.subtitle}`
			: KIND_WORD[card.kind]
	})

	function openCard() {
		const c = card
		if (!c.available || c.kind === "file") return
		void openSubject(panelsCtx, c.kind, c.subjectId, c.title)
	}

	const ROW =
		"bg-surface-200-800 flex h-14 w-full max-w-[420px] items-center gap-3 rounded-base px-2 text-left"
	const TILE =
		"bg-surface-300-700 text-surface-700-300 grid size-10 shrink-0 place-items-center rounded-base"
</script>

{#snippet text(title: string)}
	<span class="min-w-0 flex-1">
		<span class="block truncate text-sm font-medium">{title}</span>
		<span class="text-surface-600-400 block truncate text-xs">{kindLine}</span>
	</span>
{/snippet}

{#if !card.available}
	<div class="{ROW} opacity-60" aria-disabled="true" data-attachment-card>
		<span class={TILE}>
			<Icons.Lock size={18} aria-hidden="true" />
		</span>
		{@render text(KIND_WORD[card.kind])}
	</div>
{:else if card.kind === "file" && card.isImage}
	<a
		href={card.src}
		target="_blank"
		rel="noopener noreferrer"
		class="block w-fit max-w-full rounded-base"
		title="Open {card.title} full size"
		data-attachment-card
	>
		<img
			src={card.thumbSrc ?? card.src}
			alt={card.title}
			loading="lazy"
			class="bg-surface-200-800 block max-h-[320px] max-w-[min(320px,100%)] rounded-base object-contain"
		/>
		<span class="sr-only">{kindLine}. Opens full size in a new tab.</span>
	</a>
{:else if card.kind === "file"}
	<a
		href={downloadHref(card.src)}
		download={card.title}
		class="{ROW} hover:bg-surface-300-700"
		aria-label="Download {card.title}, {kindLine}"
		data-attachment-card
	>
		<span class={TILE}>
			<Icons.FileText size={18} aria-hidden="true" />
		</span>
		{@render text(card.title)}
		<Icons.Download
			size={16}
			class="text-surface-500 mr-1 shrink-0"
			aria-hidden="true"
		/>
	</a>
{:else}
	<button
		type="button"
		class="{ROW} hover:bg-surface-300-700"
		aria-label="Open {card.title}, {kindLine}"
		onclick={openCard}
		data-attachment-card
	>
		{#if card.kind === "character"}
			<Avatar
				src={card.avatarSrc ?? undefined}
				name={card.title}
				kind={card.isPersona ? "persona" : "character"}
				size="md"
				decorative
			/>
		{:else if card.kind === "session"}
			<AvatarStack
				members={card.faces.map((f) => ({
					name: f.name,
					_avatar: f.src
				}))}
				fallback="initial"
				size="sm"
				ring="ring-surface-200-800"
			/>
		{:else}
			<span class={TILE}>
				<Icons.BookOpen size={18} aria-hidden="true" />
			</span>
		{/if}
		{@render text(card.title)}
	</button>
{/if}
