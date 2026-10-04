<script lang="ts">
	/**
	 * "Ask before regenerating a turn" — the undo for the confirm's "Don't
	 * ask again for this session" (lair pass R2, owner 2026-09-28).
	 *
	 * Shown only where the genre offers Regenerate the last turn
	 * (`turnControls.retake`, never on by default). The value is core's annex
	 * field `retake-quietly`, read from this viewer's annex view
	 * (`sessions:annex`) and set through its ready-made action
	 * (`core:annex#retake-quietly`), the same press the dialog's checkbox makes.
	 */
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import {
		RETAKE_QUIETLY,
		retakeQuietly
	} from "$lib/client/components/sessionPage/retake"

	let {
		sessionId,
		shape,
		cardClass
	}: { sessionId: number; shape: unknown; cardClass: string } = $props()

	const socket = useTypedSocket()
	/** Offered only when declared (`turnControlDefault` is false for retake). */
	const offered = $derived(
		!!(shape as { turnControls?: { retake?: unknown } } | null)?.turnControls
			?.retake
	)
	let quiet = $state(false)

	$effect(() => {
		if (!offered) return
		const id = sessionId
		const release = declareInterest<"sessions:annex">(
			interestKey("sessions:annex", id),
			(res) => {
				if (res.sessionId !== id) return
				quiet = retakeQuietly(res.annex)
			}
		)
		socket.emit("sessions:annex", { sessionId: id })
		return release
	})

	function setAsk(ask: boolean) {
		quiet = !ask
		socket.emit("sessions:fireAction", {
			sessionId,
			action: RETAKE_QUIETLY,
			payload: { value: !ask },
			runId: crypto.randomUUID()
		})
	}
</script>

{#if offered}
	<section class={cardClass}>
		<div class="flex items-center justify-between gap-3">
			<div class="flex flex-col gap-0.5">
				<span class="text-sm font-medium">Ask before regenerating a turn</span>
				<span class="text-surface-600-400 text-xs">
					Regenerate deletes the last turn's messages and writes them again.
					Applies at once.
				</span>
			</div>
			<Switch
				name="retake-ask"
				checked={!quiet}
				onCheckedChange={(e) => setAsk(e.checked)}
				aria-label="Ask before regenerating a turn"
			>
				<Switch.Control
					class="preset-filled-surface-500 data-[state=checked]:preset-filled-primary-500 w-9"
				>
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
			</Switch>
		</div>
	</section>
{/if}
