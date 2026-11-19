<script lang="ts">
	/**
	 * The Bench button on a seated row (the armchair): moves the seat to the
	 * bench draft. The form owns the move.
	 */
	import * as Icons from "@lucide/svelte"
	import type { SeatKind } from "./editSessionForm"

	interface Props {
		kind: SeatKind
		id: number
		/** Who the button is for, said in its aria-label. */
		label: string
		moveSeat: (kind: SeatKind, id: number, toBench: boolean) => void
	}

	let { kind, id, label, moveSeat }: Props = $props()
</script>

<button
	type="button"
	class="btn-ghost text-surface-500 hover:text-foreground rounded p-1"
	data-seat-action="{kind}:{id}"
	onclick={() => moveSeat(kind, id, true)}
	title="Bench"
	aria-label="Bench {label}"
>
	<Icons.Armchair size={16} aria-hidden="true" />
</button>
