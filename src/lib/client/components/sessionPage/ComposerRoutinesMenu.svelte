<script lang="ts">
	/**
	 * 🚧 **Routines** in the composer's Actions row (PLAN-layering R39; lane 7,
	 * 2026-10-21): the session's owner fires one of its enabled routines by
	 * hand — **Run now** — like an action. Each item is a routine that is not
	 * Off, with when it runs; one that already has a run waiting says so, and
	 * — Allow stacking off — cannot be queued twice (R18), so it is greyed
	 * with why. A press asks `sessions:runRoutine`; the answer (queued, or the
	 * server's sentence why not) is said beside the chip, never a toast.
	 *
	 * Drawn for the owner only, and only while the session has an enabled
	 * routine; the list is read again each time the menu opens, so what it
	 * says about waiting runs is fresh.
	 */
	import * as Icons from "@lucide/svelte"
	import RowMenu from "$lib/client/components/menus/RowMenu.svelte"
	import { declareInterest, requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { cadenceWords } from "$lib/shared/routines/cadenceWords"
	import { eventDisplayName } from "$lib/client/utils/eventName"

	type RoutineView = Sockets.Sessions.Routines.Routine

	interface Props {
		sessionId: number
		/** The session's owner: Run now is theirs alone (R39). */
		isOwner: boolean
		/** The Actions row's chip class, so the trigger reads as one of its chips. */
		chipClass?: string
	}

	let { sessionId, isOwner, chipClass = "" }: Props = $props()

	const socket = useTypedSocket()
	let routines = $state<RoutineView[]>([])
	/** What the last press came to, beside the chip — then gone. */
	let said = $state<{ text: string; refused: boolean } | null>(null)
	let saidTimer: ReturnType<typeof setTimeout> | null = null

	$effect(() => {
		if (!isOwner) return
		return requestWithInterest("sessions:routines", { sessionId }, (res) => {
			if (res?.sessionId !== sessionId) return
			routines = res.routines ?? []
		})
	})

	/** The ones a person may run now: not Off (the server's `runNow` is the owner's verdict). */
	const enabled = $derived(routines.filter((r) => r.mode !== "off" && r.runNow))

	/** Each routine's item: its name, and what stands in its way. */
	function itemOf(r: RoutineView) {
		const blocked = r.waiting > 0 && !r.allowStacking
		const state = blocked ? "already waiting" : r.running ? "running now" : r.waiting > 0 ? "one waiting" : null
		return {
			label: state ? `${r.name} — ${state}` : r.name,
			title: blocked
				? "One run is already waiting; it runs once the story settles."
				: `When it runs: ${cadenceWords(r.cadence, { eventName: eventDisplayName })}`,
			icon: Icons.Play,
			disabled: blocked,
			onSelect: () => run(r)
		}
	}

	let asked = 0
	function run(r: RoutineView) {
		const requestId = `run-routine:${++asked}:${Math.random().toString(36).slice(2, 8)}`
		const release = declareInterest<"sessions:runRoutine">("sessions:runRoutine", (res) => {
			if (res?.requestId !== requestId) return
			release()
			say(res.error ? res.error : `${r.name} will run once the story settles.`, !!res.error)
			socket.emit("sessions:routines", { sessionId })
		})
		socket.emit("sessions:runRoutine", { sessionId, registrationKey: r.registrationKey, requestId })
	}

	function say(text: string, refused: boolean) {
		said = { text, refused }
		if (saidTimer) clearTimeout(saidTimer)
		saidTimer = setTimeout(() => (said = null), 8_000)
	}
	$effect(() => () => {
		if (saidTimer) clearTimeout(saidTimer)
	})
</script>

{#if isOwner && enabled.length}
	<span class="inline-flex items-center gap-1.5" data-testid="composer-routines">
		<RowMenu
			label="Routines"
			triggerLabel="Routines: run one now"
			triggerClass={chipClass}
			placement="top-start"
			width={300}
			items={enabled.map(itemOf)}
			onOpenChange={(open) => {
				if (open) socket.emit("sessions:routines", { sessionId })
			}}
		>
			{#snippet trigger()}
				<Icons.Repeat size={14} aria-hidden="true" />
				Routines
			{/snippet}
		</RowMenu>
		{#if said}
			<span
				class="text-xs {said.refused ? 'text-warning-700-300' : 'text-surface-600-400'}"
				role="status"
				data-testid="composer-routines-said"
			>
				{said.text}
			</span>
		{/if}
	</span>
{/if}
