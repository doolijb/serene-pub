<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import {
		CARD_UPDATE_FALLBACK,
		cardUpdateButton,
		cardUpdateLine,
		type OfferedCardVersion
	} from "./cardUpdateWords"

	/**
	 * **Update ‹member› to card ‹label›** — a member on an older version of its
	 * card, offered the card's current one (lane cv-member2, B1). Shown by the
	 * member page and the cast line; the caller decides when (the row is
	 * `behindCard` and the viewer can edit the book).
	 *
	 * Says nothing on success: the re-sent cast list drops the offer. A
	 * refusal is said inline under the button — the lorebooks family has no
	 * domain context to toast it.
	 */
	interface Props {
		castId: number
		lorebookId: number
		/** The member's shown name. */
		memberName: string
		/** The card version the member reads from now. */
		cardVersion: OfferedCardVersion
		/** The card's current version. */
		cardCurrentVersion: OfferedCardVersion
		/** Called with the server's reply once the member has moved. */
		onUpdated?: (
			reply: Sockets.Lorebooks.UpdateMemberToCardVersion.Response
		) => void
	}

	let {
		castId,
		lorebookId,
		memberName,
		cardVersion,
		cardCurrentVersion,
		onUpdated
	}: Props = $props()

	const socket = useTypedSocket()

	let waiting = $state(false)
	let problem = $state<string | null>(null)

	async function update() {
		if (waiting) return
		waiting = true
		problem = null
		try {
			const reply = await awaitReply({
				socket,
				event: "lorebooks:updateMemberToCardVersion",
				params: { castId },
				replyKey: interestKey(
					"lorebooks:updateMemberToCardVersion",
					lorebookId
				),
				errorEvent: "lorebooks:updateMemberToCardVersion:error",
				fallbackError: CARD_UPDATE_FALLBACK,
				match: (data) => data.castId === castId
			})
			onUpdated?.(reply)
		} catch (err) {
			problem = err instanceof Error ? err.message : CARD_UPDATE_FALLBACK
		} finally {
			waiting = false
		}
	}
</script>

<div class="flex flex-col items-start gap-1.5" data-card-update-offer>
	<p class="text-surface-600-400 text-xs">
		{cardUpdateLine(cardVersion, cardCurrentVersion)}
	</p>
	<button
		class="btn btn-sm preset-tonal-primary pointer-coarse:min-h-11"
		type="button"
		disabled={waiting}
		onclick={update}
	>
		{cardUpdateButton(memberName, cardCurrentVersion)}
	</button>
	{#if problem}
		<p
			class="text-error-700-300 text-xs"
			role="alert"
			data-card-update-problem
		>
			{problem}
		</p>
	{/if}
</div>
