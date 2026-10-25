<script lang="ts">
	/**
	 * 🚧 **The session's settings, derived** (PLAN-layering §5, A9, A10, R1,
	 * R36, R37; lane 7, 2026-10-21) — `sessions:settingsForm` drawn as it
	 * arrives, never declared twice:
	 *
	 *  1. **the genre's settings** (and the rules the session plays, read-only
	 *     once fixed at start);
	 *  2. **one card per pipeline** the session's preset registers that offers
	 *     anything, headed by the pipeline's name — the reply first;
	 *  3. **Routines**: each with what it does, when it runs in words, what it
	 *     is doing now, and its mode (Off · Review · Full) for anyone with the
	 *     settings; an administrator also changes when it runs (R36).
	 *
	 * Who sees what is the server's: an owner gets the settings that reach
	 * them and nothing a layer above locked; an administrator, in their own
	 * session, everything — locked values read-only with the layer's reason.
	 * A guest is answered with no groups (R1) and this draws nothing.
	 *
	 * Every control applies at once (`sessions:updateSetting`), settled on its
	 * own reply by request id; a refusal is said under the field, never a
	 * toast. The answer carries the form as it stands after, and the server
	 * re-sends it, so what is drawn is always the server's.
	 */
	import { SvelteMap } from "svelte/reactivity"
	import { declareInterest, requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import SessionSettingField from "./SessionSettingField.svelte"
	import SessionRoutineRow from "./SessionRoutineRow.svelte"
	import { splitAdvanced } from "./sessionSettingsForm"

	type Form = Sockets.Sessions.SettingsForm.Response
	type Group = Sockets.Sessions.SettingsForm.Group
	type Field = Sockets.Sessions.SettingsForm.Field

	interface Props {
		sessionId: number
		/** The form's card class (the edit form's own). */
		cardClass?: string
		/** The genre's field declarations, for a control only they describe (an object field). */
		genreFieldDecls?: Record<string, unknown>
		/** What a value reads as, when the caller can say it better (the ruleset's name). */
		valueLabelOf?: (field: Field) => string | null | undefined
		/** The choices to offer, when the caller narrows them (How strict, by the rules played). */
		membersOf?: (field: Field) => Field["members"] | undefined
		/** Called after a setting landed (the edit form re-reads what it shows elsewhere). */
		onchanged?: (field: Field) => void
	}

	let { sessionId, cardClass = "", genreFieldDecls = {}, valueLabelOf, membersOf, onchanged }: Props = $props()

	const socket = useTypedSocket()
	let form = $state<Form | null>(null)
	let statuses = $state<Sockets.Sessions.Routines.Routine[]>([])
	/** Per field id: a refusal said under it. */
	const refusals = new SvelteMap<string, string>()
	/** Per field id: a write in flight. */
	const busyIds = new SvelteMap<string, boolean>()

	$effect(() =>
		requestWithInterest("sessions:settingsForm", { sessionId }, (res) => {
			if (res?.sessionId !== sessionId) return
			form = res
		})
	)
	$effect(() =>
		requestWithInterest("sessions:routines", { sessionId }, (res) => {
			if (res?.sessionId !== sessionId) return
			statuses = res.routines ?? []
		})
	)

	const viewer = $derived(form?.viewer ?? "owner")
	const groups = $derived(form?.groups ?? [])
	const statusOf = (key: string) => statuses.find((s) => s.registrationKey === key)

	let asked = 0
	/**
	 * One write, settled on ITS reply (the request id the server echoes). The
	 * refusal rides the reply's `error`, so there is no `:error` event to hear.
	 */
	function ask(params: Sockets.Sessions.UpdateSetting.Params): Promise<Sockets.Sessions.UpdateSetting.Response> {
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
		const requestId = `setting:${++asked}:${Math.random().toString(36).slice(2, 8)}`
		refusals.delete(field.id)
		busyIds.set(field.id, true)
		try {
			const reply = await ask({ sessionId, address: field.address, value, requestId })
			if (reply.error) refusals.set(field.id, reply.error)
			else {
				if (reply.form) form = reply.form
				onchanged?.(field)
				// A routine's mode or caps move what the routines say they are doing.
				// The standing interest above hears the answer.
				if (field.address.kind === "routine") socket.emit("sessions:routines", { sessionId })
			}
		} catch (e) {
			refusals.set(field.id, e instanceof Error ? e.message : String(e))
		} finally {
			busyIds.delete(field.id)
		}
	}

	const busy = (f: Field) => !!busyIds.get(f.id)
	const refusal = (f: Field) => refusals.get(f.id) ?? null
	const headingOf = (g: Group) => (g.kind === "genre" ? `${g.heading} settings` : g.heading)
	const declOf = (f: Field) =>
		f.address.kind === "genre" ? ((genreFieldDecls[f.address.key] as Record<string, unknown> | undefined) ?? null) : null
</script>

{#snippet fieldList(fields: Field[])}
	{@const parts = splitAdvanced(fields)}
	<div class="flex flex-col gap-4">
		{#each parts.front as f (f.id)}
			<SessionSettingField
				field={f}
				{viewer}
				busy={busy(f)}
				refusal={refusal(f)}
				decl={declOf(f)}
				valueLabel={valueLabelOf?.(f) ?? null}
				members={membersOf?.(f)}
				onwrite={(v) => write(f, v)}
			/>
		{/each}
		{#if parts.advanced.length}
			<details>
				<summary class="text-surface-600-400 min-h-11 cursor-pointer text-xs pointer-fine:min-h-0">
					Advanced · {parts.advanced.length === 1 ? "1 setting" : `${parts.advanced.length} settings`}
				</summary>
				<div class="mt-3 flex flex-col gap-4">
					{#each parts.advanced as f (f.id)}
						<SessionSettingField
							field={f}
							{viewer}
							busy={busy(f)}
							refusal={refusal(f)}
							decl={declOf(f)}
							valueLabel={valueLabelOf?.(f) ?? null}
							members={membersOf?.(f)}
							onwrite={(v) => write(f, v)}
						/>
					{/each}
				</div>
			</details>
		{/if}
	</div>
{/snippet}

{#if groups.length}
	<div class="flex flex-col gap-3" data-testid="session-settings-form" data-viewer={viewer}>
		{#each groups as g (g.kind + ":" + g.id)}
			{@const headingId = `session-settings-${g.kind}-${g.id.replace(/[^a-z0-9]+/gi, "-")}`}
			<section class={cardClass} aria-labelledby={headingId} data-settings-group={g.kind}>
				<h3 id={headingId} class="mb-1 text-sm font-medium">{headingOf(g)}</h3>
				{#if g.kind === "routines"}
					<p class="text-surface-600-400 mb-3 text-xs">
						What runs on its own between turns. <strong class="font-medium">Off</strong> stops it,
						<strong class="font-medium">Review</strong> holds what it would change for you to accept,
						<strong class="font-medium">Full</strong> applies it. Applies at once.
					</p>
					<div class="flex flex-col gap-2">
						{#each g.routines ?? [] as r (r.registrationKey)}
							<SessionRoutineRow
								routine={r}
								{viewer}
								status={statusOf(r.registrationKey)}
								{busy}
								{refusal}
								onwrite={write}
							/>
						{/each}
					</div>
				{:else}
					<p class="text-surface-600-400 mb-3 text-xs">
						{#if g.description}{g.description}{/if}
						Applies at once.
					</p>
					{@render fieldList(g.fields)}
				{/if}
			</section>
		{/each}
	</div>
{/if}
