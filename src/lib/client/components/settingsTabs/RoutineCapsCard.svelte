<script lang="ts">
	import InlineError from "$lib/client/components/InlineError.svelte"
	/**
	 * 🚧 **Background routines** (PLAN-layering R11; lane 7, 2026-10-21): the
	 * two limits on routines that run on the real-time clock — how long a
	 * session may go without anyone playing before they stop, and how many
	 * runs they may have since someone last played.
	 *
	 * Layered system → person → session (R11): the pub's are the maximum
	 * (`scope="system"`, Admin › General); each person's own sit under them
	 * (`scope="user"`, Settings), empty following the pub's; a routine's own
	 * caps (an administrator's, in a session's settings) sit under the
	 * owner's. Each box applies when it changes; a refusal is said here.
	 */
	import { getContext } from "svelte"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { minutesInWords } from "$lib/shared/routines/cadenceWords"
	import SettingCard from "./SettingCard.svelte"

	interface Props {
		scope: "user" | "system"
	}

	let { scope }: Props = $props()

	const socket = useTypedSocket()
	const userSettingsCtx: UserSettingsCtx | undefined = getContext("userSettingsCtx")
	const systemSettingsCtx: SystemSettingsCtx | undefined = getContext("systemSettingsCtx")

	type Caps = { idleTimeoutMinutes: number | null; maxRunsInRow: number | null }

	/** The pub's limits — the ceiling a person's own sit under. */
	const system = $derived.by((): { idleTimeoutMinutes: number; maxRunsInRow: number } => {
		const own = (userSettingsCtx?.settings as { routineCaps?: Sockets.UserSettings.RoutineCapsView } | undefined)
			?.routineCaps?.system
		const row = systemSettingsCtx?.settings as { cronIdleTimeoutMinutes?: number; cronMaxRunsInRow?: number } | undefined
		return {
			idleTimeoutMinutes: row?.cronIdleTimeoutMinutes ?? own?.idleTimeoutMinutes ?? 4320,
			maxRunsInRow: row?.cronMaxRunsInRow ?? own?.maxRunsInRow ?? 12
		}
	})
	/** What this card edits as it stands. */
	const stored = $derived.by((): Caps => {
		if (scope === "system") return { ...system }
		const caps = (userSettingsCtx?.settings as { routineCaps?: Sockets.UserSettings.RoutineCapsView } | undefined)
			?.routineCaps
		return { idleTimeoutMinutes: caps?.idleTimeoutMinutes ?? null, maxRunsInRow: caps?.maxRunsInRow ?? null }
	})
	/** What a write answered with, until the context catches up. */
	let answered = $state<Caps | null>(null)
	const caps = $derived(answered ?? stored)
	$effect(() => {
		void stored
		answered = null
	})

	let refusal = $state<string | null>(null)
	let busy = $state(false)
	let asked = 0

	function write(next: Caps) {
		refusal = null
		busy = true
		const n = ++asked
		const event = scope === "system" ? "systemSettings:updateRoutineCaps" : "userSettings:updateRoutineCaps"
		const release = declareInterest<typeof event>(event, (res) => {
			if (n !== asked) return
			release()
			busy = false
			if (!res.success) {
				refusal = res.error ?? "That was not saved."
				return
			}
			answered = next
		})
		if (scope === "system")
			socket.emit("systemSettings:updateRoutineCaps", {
				idleTimeoutMinutes: next.idleTimeoutMinutes ?? system.idleTimeoutMinutes,
				maxRunsInRow: next.maxRunsInRow ?? system.maxRunsInRow
			})
		else socket.emit("userSettings:updateRoutineCaps", next)
	}

	function onBox(key: keyof Caps, input: HTMLInputElement) {
		const v = input.valueAsNumber
		// Emptied: the pub's again (a person's), or left as it was (the pub's own).
		if (Number.isNaN(v) && scope === "system") return
		write({ ...caps, [key]: Number.isNaN(v) ? null : Math.round(v) })
	}

	const idleId = $derived(`routine-caps-${scope}-idle`)
	const runsId = $derived(`routine-caps-${scope}-runs`)
</script>

<!-- A setting card (STYLE-GUIDE §6.4): its two boxes carry their own
     labels, which differ from the title. -->
<SettingCard
	title="Background routines"
	titleId="routine-caps-{scope}-heading"
	headingLevel={scope === "system" ? 2 : 3}
	testid="routine-caps-{scope}"
	layout="stack"
	help={scope === "system"
		? "The most anyone's real-time routines may run; each person may set lower limits for their own sessions, never higher."
		: "Stops real-time routines in a session nobody is playing; leave a box empty to use the pub's limit."}
>
	<div class="flex flex-wrap gap-4">
		<label class="flex flex-col gap-1 text-xs" for={idleId}>
			<span class="text-surface-600-400">Stop after nobody has played for (minutes)</span>
			<input
				id={idleId}
				class="input w-40 rounded-base"
				type="number"
				min="5"
				step="5"
				max={scope === "user" ? system.idleTimeoutMinutes : undefined}
				placeholder={scope === "user" ? String(system.idleTimeoutMinutes) : undefined}
				value={caps.idleTimeoutMinutes ?? ""}
				disabled={busy}
				aria-describedby="{idleId}-help"
				onchange={(e) => onBox("idleTimeoutMinutes", e.currentTarget)}
			/>
			<span id="{idleId}-help" class="text-surface-600-400">
				{#if caps.idleTimeoutMinutes != null}{minutesInWords(caps.idleTimeoutMinutes)}{/if}
				{#if scope === "user"}
					{caps.idleTimeoutMinutes != null ? " · " : ""}The pub's: {minutesInWords(system.idleTimeoutMinutes)}
				{/if}
			</span>
		</label>
		<label class="flex flex-col gap-1 text-xs" for={runsId}>
			<span class="text-surface-600-400">Most runs in a row</span>
			<input
				id={runsId}
				class="input w-32 rounded-base"
				type="number"
				min="1"
				step="1"
				max={scope === "user" ? system.maxRunsInRow : undefined}
				placeholder={scope === "user" ? String(system.maxRunsInRow) : undefined}
				value={caps.maxRunsInRow ?? ""}
				disabled={busy}
				aria-describedby="{runsId}-help"
				onchange={(e) => onBox("maxRunsInRow", e.currentTarget)}
			/>
			<span id="{runsId}-help" class="text-surface-600-400">
				{#if scope === "user"}The pub's: {system.maxRunsInRow}{:else}Since anyone last played{/if}
			</span>
		</label>
	</div>
	{#if refusal}
		<InlineError>{refusal}</InlineError>
	{/if}
</SettingCard>
