<script lang="ts">
	/**
	 * 🚧 A session's **step settings** (PROPOSAL-live-scenes §15 G11): the
	 * story settings of the steps its pipelines put in session settings
	 * (`expose.session`) — the reply tick's *Each reply advances the clock by
	 * …*, the sprite picker's choices — for the session's owner. Never a
	 * model's plumbing: the server sends no connection, model, sampling,
	 * loadout or prompt field, and no field of a step that runs on a model
	 * (`server/sessions/stepSettings.ts`).
	 *
	 * Two places, one reader: `place="story-clock"` draws the clock steps
	 * (`core:task/clock-step`) under *The story › Story clock*; `place="other"`
	 * draws every other step as one card. Each field applies at once
	 * (`sessions:setStepSetting`), unlike the form around it, which waits for
	 * Save; **Reset** clears the session's own value back to what it
	 * inherits. A refusal is said under its field, never a toast.
	 */
	import { declareInterest, requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { SvelteMap } from "svelte/reactivity"

	type Step = Sockets.Sessions.Bindings.StepSettings.Step
	type Field = Sockets.Sessions.Bindings.StepSettings.Field

	interface Props {
		sessionId: number
		/** Which steps: the story clock's, or every other. */
		place: "story-clock" | "other"
		/** The card class, for `place="other"` (the form's own). */
		cardClass?: string
		disabled?: boolean
	}

	let { sessionId, place, cardClass = "", disabled = false }: Props = $props()

	const socket = useTypedSocket()
	let steps = $state<Step[]>([])
	/** Per field: a refusal said under it. */
	const refusals = new SvelteMap<string, string>()
	/** Per field: a write in flight. */
	const busy = new SvelteMap<string, boolean>()

	const isClockStep = (s: Step) => s.definitionId.startsWith("core:task/clock-step@")
	const shown = $derived(steps.filter((s) => (place === "story-clock") === isClockStep(s)))
	/** More than one pipeline offers steps here: each heading names its pipeline. */
	const manySpecs = $derived(new Set(shown.map((s) => s.spec)).size > 1)

	$effect(() =>
		requestWithInterest("sessions:stepSettings", { sessionId }, (res) => {
			if (res?.sessionId !== sessionId) return
			steps = res.steps ?? []
		})
	)

	const keyOf = (s: Step, f: Field) => `${s.spec}#${s.nodeKey}#${f.path}`
	let asked = 0

	async function write(s: Step, f: Field, value: unknown) {
		const key = keyOf(s, f)
		const requestId = `step-setting:${++asked}:${Math.random().toString(36).slice(2, 8)}`
		refusals.delete(key)
		busy.set(key, true)
		try {
			const reply = await ask({
				sessionId,
				spec: s.spec,
				nodeKey: s.nodeKey,
				path: f.path,
				value,
				requestId
			})
			if (reply.error) refusals.set(key, reply.error)
			else if (reply.steps) steps = reply.steps
		} catch (e) {
			refusals.set(key, e instanceof Error ? e.message : String(e))
		} finally {
			busy.delete(key)
		}
	}

	/**
	 * One write, settled on ITS reply (the request id the server echoes). The
	 * refusal rides the reply's `error`, so there is no `:error` event to hear.
	 */
	function ask(
		params: Sockets.Sessions.Bindings.SetStepSetting.Params
	): Promise<Sockets.Sessions.Bindings.SetStepSetting.Response> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				release()
				reject(new Error("The setting was not saved: the server did not answer."))
			}, 15_000)
			const release = declareInterest<"sessions:setStepSetting">(
				"sessions:setStepSetting",
				(res) => {
					if (res?.requestId !== params.requestId) return
					clearTimeout(timer)
					release()
					resolve(res)
				}
			)
			socket.emit("sessions:setStepSetting", params)
		})
	}

	function onNumber(s: Step, f: Field, input: HTMLInputElement) {
		const n = input.valueAsNumber
		// Emptied: back to what it inherits.
		void write(s, f, Number.isNaN(n) ? null : n)
	}

	const fieldId = (s: Step, f: Field) =>
		`step-setting-${keyOf(s, f).replace(/[^a-z0-9]+/gi, "-")}`
	const headingOf = (s: Step) => (manySpecs ? `${s.specName} · ${s.heading}` : s.heading)
	const inheritedText = (f: Field) =>
		f.control === "boolean"
			? f.inherited
				? "On"
				: "Off"
			: f.control === "enum"
				? (f.members?.find((m) => m.key === f.inherited)?.label ?? String(f.inherited ?? ""))
				: String(f.inherited ?? "")
</script>

{#snippet fieldControl(s: Step, f: Field)}
	{@const id = fieldId(s, f)}
	{@const key = keyOf(s, f)}
	<div class="flex flex-col gap-1">
		{#if f.control === "boolean"}
			<label class="flex items-center gap-2 text-xs" for={id}>
				<input
					{id}
					type="checkbox"
					role="switch"
					class="checkbox"
					checked={f.value === true}
					disabled={disabled || busy.get(key)}
					aria-describedby="{id}-help"
					onchange={(e) => void write(s, f, e.currentTarget.checked)}
				/>
				<span>{f.label}</span>
				<span class="text-surface-600-400">{f.value === true ? "On" : "Off"}</span>
			</label>
		{:else if f.control === "enum"}
			<Select
				label={f.label}
				options={(f.members ?? []).map((m) => ({ value: m.key, label: m.label }))}
				value={typeof f.value === "string" ? f.value : ""}
				disabled={disabled || busy.get(key)}
				onValueChange={(v) => {
					if (v && v !== f.value) void write(s, f, v)
				}}
			/>
		{:else}
			<label class="flex flex-col gap-1 text-xs" for={id}>
				<span class="text-surface-600-400">{f.label}</span>
				<input
					{id}
					class="input w-28 rounded-[10px]"
					type={f.control === "string" ? "text" : "number"}
					step={f.control === "integer" ? "1" : "any"}
					min={f.min}
					max={f.max}
					value={f.value ?? ""}
					disabled={disabled || busy.get(key)}
					aria-describedby="{id}-help"
					onchange={(e) =>
						f.control === "string"
							? void write(s, f, e.currentTarget.value)
							: onNumber(s, f, e.currentTarget)}
				/>
			</label>
		{/if}
		<p id="{id}-help" class="text-surface-600-400 text-xs">
			{#if f.description}{f.description}{/if}
			{#if f.source === "session"}
				Set for this session.
				<button
					type="button"
					class="underline"
					disabled={disabled || busy.get(key)}
					onclick={() => void write(s, f, null)}
				>
					Reset
				</button>
				to {inheritedText(f)}.
			{/if}
		</p>
		{#if refusals.get(key)}
			<p class="text-error-700-300 text-xs" role="alert">{refusals.get(key)}</p>
		{/if}
	</div>
{/snippet}

{#if shown.length}
	{#if place === "story-clock"}
		<!-- Under The story › Story clock: one fieldset per clock step, its
		     fields side by side (By · Unit). -->
		{#each shown as s (s.spec + "#" + s.nodeKey)}
			<fieldset class="flex flex-col gap-1.5" {disabled} data-testid="session-step-settings-clock">
				<legend class="text-surface-600-400 mb-1.5 text-xs">
					{headingOf(s)} · Applies at once
				</legend>
				<div class="flex flex-wrap items-start gap-3">
					{#each s.fields as f (f.path)}
						{@render fieldControl(s, f)}
					{/each}
				</div>
			</fieldset>
		{/each}
	{:else}
		<section class={cardClass} aria-labelledby="session-step-settings-heading" data-testid="session-step-settings">
			<h3 id="session-step-settings-heading" class="mb-1 text-sm font-medium">Step settings</h3>
			<p class="text-surface-600-400 mb-3 text-xs">
				What this session's pipelines let you set for it. Applies at once.
			</p>
			<div class="flex flex-col gap-4">
				{#each shown as s (s.spec + "#" + s.nodeKey)}
					<fieldset class="flex flex-col gap-2" {disabled}>
						<legend class="mb-1 text-xs font-medium">{headingOf(s)}</legend>
						{#each s.fields as f (f.path)}
							{@render fieldControl(s, f)}
						{/each}
					</fieldset>
				{/each}
			</div>
		</section>
	{/if}
{/if}
