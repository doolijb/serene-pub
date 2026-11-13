<script lang="ts">
	/**
	 * 🚧 A seated cast member's read-only sheet, in the Sessions view's detail
	 * pane (owner ruling 2026-11-05: a name in the session opens the cast
	 * member). Shown instead of the member's page in its book when the viewer
	 * cannot open that book — a guest without a share, or anyone reaching into
	 * someone else's session notes. Name, face and the parts the member tells
	 * in its own words; nothing else, and nothing to edit.
	 *
	 * Asks `lorebooks:memberOfSeat` when it mounts and whenever its seat
	 * changes. A refusal or a silence is said in one muted line here — never a
	 * toast.
	 */
	import * as Icons from "@lucide/svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { getContext } from "svelte"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import { avatarSrc } from "$lib/client/utils/media"
	import {
		RETOLD_LABELS,
		type RetoldProseField
	} from "$lib/client/lorebooks/cast/retoldRows"

	let {
		sessionId,
		ref,
		onClose
	}: { sessionId: number; ref: string; onClose: () => void } = $props()

	const socket = useTypedSocket()
	type Sheet = NonNullable<
		NonNullable<Sockets.Lorebooks.MemberOfSeat.Response["member"]>["sheet"]
	>
	/**
	 * `undefined` while asking; `"nobody"` when no member holds the seat; `null`
	 * when the viewer can open the member's book after all (nothing to draw).
	 */
	let sheet = $state<Sheet | "nobody" | null | undefined>(undefined)
	let problem = $state<string | null>(null)
	/** The seated member, for **Copy to my characters**. */
	let castMemberId = $state<number | null>(null)

	const panelsCtx = getContext<PanelsCtx | undefined>("panelsCtx")
	let copyPending = $state(false)
	function copyToMyCharacters() {
		if (castMemberId == null || copyPending) return
		copyPending = true
		socket.emit("characters:duplicate", { castMemberId })
	}
	// Only the copy THIS sheet asked for opens; a refusal is said by Layout's
	// catch-all and only re-arms the button.
	$effect(() =>
		declareInterest<"characters:duplicate">(
			"characters:duplicate",
			(msg) => {
				if (!copyPending) return
				copyPending = false
				const id = msg.character?.id
				if (id && panelsCtx) {
					panelsCtx.digest.characterId = id
					panelsCtx.openPanel({ key: "characters", toggle: false })
				}
			}
		)
	)
	$effect(() =>
		declareInterest<"characters:duplicate:error">(
			"characters:duplicate:error",
			() => (copyPending = false)
		)
	)

	$effect(() => {
		const id = sessionId
		const seat = ref
		sheet = undefined
		problem = null
		castMemberId = null
		let current = true
		awaitReply({
			socket,
			event: "lorebooks:memberOfSeat",
			errorEvent: "lorebooks:memberOfSeat:error",
			params: { sessionId: id, ref: seat },
			match: (r) => r.sessionId === id && r.ref === seat,
			fallbackError: "This cast member could not be read."
		}).then(
			(res) => {
				if (!current) return
				sheet = res.member ? res.member.sheet : "nobody"
				castMemberId = res.member?.castMemberId ?? null
			},
			(e) => {
				if (current)
					problem =
						e instanceof Error && e.message
							? e.message
							: "This cast member could not be read."
			}
		)
		return () => {
			current = false
		}
	})

	const shown = $derived(typeof sheet === "object" ? sheet : null)
	const face = $derived(
		shown?.faceMediaId != null
			? avatarSrc({ avatarMediaId: shown.faceMediaId })
			: undefined
	)
</script>

<div
	class="flex h-full min-h-0 flex-col gap-3 overflow-hidden"
	data-seat-member-sheet
>
	<div class="flex items-center gap-2">
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface p-2"
			aria-label="Close"
			onclick={onClose}
		>
			<Icons.X class="size-4" />
		</button>
		<h3 class="truncate text-sm font-semibold">{shown?.shownName ?? ""}</h3>
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
		{#if problem}
			<p class="text-surface-600-400 text-xs" data-seat-member-problem>
				{problem}
			</p>
		{:else if sheet === "nobody"}
			<p class="text-surface-600-400 text-xs">
				Nobody holds this seat now.
			</p>
		{:else if shown}
			<div class="flex items-center gap-3">
				<Avatar
					src={face}
					name={shown.shownName}
					size="lg"
					shape="square"
					decorative
				/>
			</div>
			<button
				class="btn btn-sm preset-tonal-surface self-start"
				type="button"
				disabled={copyPending || castMemberId == null}
				onclick={copyToMyCharacters}
				data-seat-member-copy
			>
				<Icons.Copy size={14} aria-hidden="true" /> Copy to my characters
			</button>
			{#each shown.ownWords as part (part.field)}
				<section
					class="flex flex-col gap-1"
					data-seat-member-words={part.field}
				>
					<h4 class="text-surface-600-400 text-xs font-semibold">
						{RETOLD_LABELS[part.field as RetoldProseField]}
					</h4>
					{#each part.texts as text, i (i)}
						<p class="text-sm whitespace-pre-wrap">{text}</p>
					{/each}
				</section>
			{/each}
		{/if}
	</div>
</div>
