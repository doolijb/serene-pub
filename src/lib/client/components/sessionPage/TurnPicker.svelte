<script lang="ts">
	/**
	 * "Someone else" (PLAN-turn-order §4.9): the session's turn candidates —
	 * `turnOrder.candidates`, the cast as the strategy saw it — and the
	 * narrator (the pipeline's own voice, by its name: R5), one of which
	 * takes the turn instead of the prepared head.
	 *
	 * A pick is a fire with an entry (`sessions:fireTurn`, `via: 'pick'`); the
	 * server decides whether this person may make it (§4.7: the owner may
	 * name anyone, a guest only a prepared turn that is theirs), so the list
	 * never guesses. A person's persona is not offered: a person's turn is
	 * theirs to take by writing, not something a click fires for them.
	 */

	import { getContext } from "svelte"
	import { declareInterest, requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import SessionSettingField from "$lib/client/components/sessionForms/SessionSettingField.svelte"
	import { narratorCadenceField } from "./narratorCadence"

	type Form = Sockets.Sessions.SettingsForm.Response
	type Field = Sockets.Sessions.SettingsForm.Field

	type Candidate = {
		ref: string
		kind: string
		name: string
		nickname?: string
	}

	interface Props {
		open: boolean
		candidates: Candidate[]
		/** The order's head, marked in the list: null is the narrator, undefined no order. */
		headRef?: string | null
		/** A face for a candidate, when the session has one loaded. */
		avatarFor?: (ref: string) => unknown
		/** Whether the genre has a narrator to hand the turn to. */
		offerNarrator?: boolean
		/**
		 * What that row is called: the pipeline's own voice, as the page
		 * resolved it (`ownVoiceName`, lair re-plan R5) — the Lair's
		 * "Castellan", else the narrator's name.
		 */
		ownVoiceName?: string
		onPick: (entry: { ref: string | null }) => void
		onClose: () => void
	}

	let {
		open,
		candidates,
		headRef,
		avatarFor,
		offerNarrator = false,
		ownVoiceName = "The narrator",
		onPick,
		onClose
	}: Props = $props()

	const speakable = $derived(candidates.filter((c) => c.kind !== "persona"))
	const label = (c: Candidate) => c.nickname || c.name

	// The narrator's cadence is the session's own setting, drawn from the
	// server's derived settings form: one source, written the way the edit
	// form writes it.
	const socket = useTypedSocket()
	const openSession = getContext<OpenSessionCtx | undefined>("openSessionCtx")
	// Read through the context each time: the page is reused across sessions.
	const sessionId = $derived(openSession?.sessionId ?? null)
	let form = $state<Form | null>(null)
	let busy = $state(false)
	let refusal = $state<string | null>(null)
	const cadence = $derived(form?.sessionId === sessionId ? narratorCadenceField(form) : null)

	$effect(() => {
		if (!(open && offerNarrator && sessionId != null)) return
		return requestWithInterest("sessions:settingsForm", { sessionId }, (res) => {
			if (res?.sessionId !== sessionId) return
			form = res
		})
	})

	let asked = 0
	function ask(
		params: Sockets.Sessions.UpdateSetting.Params
	): Promise<Sockets.Sessions.UpdateSetting.Response> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				release()
				reject(new Error("The setting was not saved: the server did not answer."))
			}, 15_000)
			const release = declareInterest<"sessions:updateSetting">("sessions:updateSetting", (res) => {
				if (res?.requestId !== params.requestId) return
				clearTimeout(timer)
				release()
				resolve(res)
			})
			socket.emit("sessions:updateSetting", params)
		})
	}

	async function write(field: Field, value: unknown | null) {
		if (sessionId == null) return
		const requestId = `setting:${++asked}:${Math.random().toString(36).slice(2, 8)}`
		refusal = null
		busy = true
		try {
			const reply = await ask({ sessionId, address: field.address, value, requestId })
			if (reply.error) refusal = reply.error
			else if (reply.form) form = reply.form
		} catch (e) {
			refusal = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}
</script>

<!-- `sp-dialog` (§3.5): the host's modal — focus-trapped, Escape and the
     backdrop close it; core's base skin draws it (hostElements.css). -->
<sp-dialog
	{open}
	label="Who speaks next?"
	onopen-change={(e: CustomEvent<{ open: boolean }>) => {
		if (!e.detail.open) onClose()
	}}
>
	<span slot="title">Who speaks next?</span>
	<ul class="flex flex-col gap-1">
		{#each speakable as c (c.ref)}
			<li>
				<button
					type="button"
					class="hover:bg-surface-200-800 flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left"
					onclick={() => onPick({ ref: c.ref })}
				>
					{#if avatarFor?.(c.ref)}
						<sp-avatar ref={c.ref} size="md"></sp-avatar>
					{:else}
						<span
							class="bg-surface-300-700 grid size-8 place-items-center rounded-full"
							aria-hidden="true"
						>
							<sp-icon name="user" size="16"></sp-icon>
						</span>
					{/if}
					<span class="min-w-0 flex-1 truncate text-sm">{label(c)}</span>
					{#if c.ref === headRef}
						<span class="text-surface-600-400 text-xs">next</span>
					{/if}
				</button>
			</li>
		{/each}
		{#if offerNarrator}
			<li>
				<button
					type="button"
					class="hover:bg-surface-200-800 flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left"
					onclick={() => onPick({ ref: null })}
				>
					<span
						class="bg-surface-300-700 grid size-8 place-items-center rounded-full"
						aria-hidden="true"
					>
						<sp-icon name="book-open-text" size="16"></sp-icon>
					</span>
					<span class="min-w-0 flex-1 truncate text-sm">{ownVoiceName}</span>
					{#if headRef === null}
						<span class="text-surface-600-400 text-xs">next</span>
					{/if}
				</button>
			</li>
			{#if cadence}
				<li>
					<SessionSettingField
						field={cadence}
						viewer={form?.viewer ?? "owner"}
						{busy}
						{refusal}
						onwrite={(value) => write(cadence, value)}
					/>
				</li>
			{/if}
		{/if}
	</ul>
	{#if !speakable.length && !offerNarrator}
		<p class="text-surface-600-400 text-sm">
			Nobody else can take this turn.
		</p>
	{/if}
</sp-dialog>
