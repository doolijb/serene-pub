<script lang="ts">
	/**
	 * 🚧 Session settings › The story › **Scenes** (live scenes §4–§5, lane
	 * D): where a new scene begins while the session is played, and when a
	 * scene's summary is written. The genre states the defaults
	 * (`SessionShape.scenes`); what the person sets here is the session's
	 * override, stored on its row with Save. Setting everything back to the
	 * genre's clears the override, so a later change to the genre reaches the
	 * session again.
	 *
	 * Nothing here asks a model: every trigger is read off what the story
	 * already holds — the lines' story-clock stamps, a time action, the
	 * place the genre's state names, who wrote a line, how long the scene is,
	 * how long the table paused.
	 *
	 * 🚧 *The place changes* shows only where the genre names a place
	 * (`shape.scenes.place`, live scenes §15 G2), and the genre's own
	 * **declared triggers** (★9, its summarize-scene spec's — the Lair's *the
	 * party reached a new floor*) follow core's as switches, on by default,
	 * stored under the override's `triggers[key]` only when turned off.
	 */
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
	declaredScenePlace,
	declaredTriggerStates,
	resolveSceneSettings,
	sceneSettingsDecl,
	type SceneSettings,
	type SceneSettingsDecl
} from "@serene-pub/sdk"
	import {
		SCENE_MODE_LABELS,
		SCENE_SUMMARY_LABELS,
		sameSceneSettings
	} from "$lib/shared/sessions/sceneSettings"

	interface Props {
		/** The session's genre's shape (its `scenes` is the default); null when unknown. */
		genreShape: unknown
		/** The session's override; null follows the genre. */
		override: SceneSettingsDecl | null
		/** 🚧 The genre's declared boundary triggers (★9), from its summarize-scene spec. */
		boundaryTriggers?: { key: string; label: string }[]
		disabled?: boolean
	}

	let {
		genreShape,
		override = $bindable(null),
		boundaryTriggers = [],
		disabled = false
	}: Props = $props()

	const uid = $props.id()
	const resolved = $derived(resolveSceneSettings(genreShape, override))
	const genreDefault = $derived(resolveSceneSettings(genreShape))
	const hasPlace = $derived(declaredScenePlace(genreShape) !== null)
	const declared = $derived(declaredTriggerStates(boundaryTriggers, override))
	const allDeclaredOn = (states: Record<string, boolean>) =>
		Object.values(states).every((on) => on)
	const followsGenre = $derived(
		sameSceneSettings(resolved, genreDefault) && allDeclaredOn(declared)
	)

	/**
	 * Store `next` (and the declared switches) — or nothing, when it is what
	 * the genre says. A declared trigger is stored only when it is off.
	 */
	function set(next: SceneSettings, nextDeclared: Record<string, boolean> = declared) {
		override =
			sameSceneSettings(next, genreDefault) && allDeclaredOn(nextDeclared)
				? null
				: sceneSettingsDecl(
						next,
						Object.fromEntries(
							Object.entries(nextDeclared).filter(([, on]) => !on)
						)
					)
	}
	const withTriggers = (patch: Partial<SceneSettings["triggers"]>) =>
		set({ ...resolved, triggers: { ...resolved.triggers, ...patch } })
	const withDeclared = (key: string, on: boolean) =>
		set(resolved, { ...declared, [key]: on })

	const MODE_HELP: Record<SceneSettings["mode"], string> = {
		manual: "You place every scene yourself, with Start scene here and End scene here on a message.",
		suggested:
			"A quiet New scene? appears at the line where a scene might begin. One tap starts it there, or Not here.",
		automatic:
			"A new scene begins by itself at the line. You can move or remove the boundary afterwards."
	}
	const SUMMARY_HELP: Record<SceneSettings["summary"], string> = {
		onClose: "Each scene's summary is written in the background as the scene closes.",
		onRequest: "Summarize a scene when you choose, from the Chronicle or the scene's divider.",
		never: "Scenes are never summarized from this session."
	}

	/** A chip's words as a switch's: *the party reached a new floor* → *The party…* */
	const sentenceCase = (text: string) =>
		text ? text.charAt(0).toUpperCase() + text.slice(1) : text

	const whole = (v: number, min = 1) =>
		Number.isFinite(v) && v >= min ? Math.floor(v) : null
</script>

<fieldset class="flex flex-col gap-3" data-session-scene-settings>
	<legend class="text-surface-600-400 mb-1.5 text-xs">Scenes</legend>
	<p class="text-surface-600-400 text-xs" id="{uid}-scenes-help">
		Where a new scene begins while you play, and when its summary is
		written. Nothing here asks the model.
		{#if followsGenre}This session follows its genre's settings.{/if}
	</p>
	<div class="flex flex-col gap-1">
		<Select
			label="How scenes begin"
			describedBy="{uid}-mode-help"
			{disabled}
			options={(["manual", "suggested", "automatic"] as const).map((m) => ({
				value: m,
				label: SCENE_MODE_LABELS[m]
			}))}
			value={resolved.mode}
			onValueChange={(v) => {
				if (v) set({ ...resolved, mode: v as SceneSettings["mode"] })
			}}
		/>
		<p class="text-surface-600-400 text-xs" id="{uid}-mode-help">
			{MODE_HELP[resolved.mode]}
		</p>
	</div>

	{#if resolved.mode !== "manual"}
		<fieldset class="flex flex-col gap-2" data-scene-triggers>
			<legend class="text-surface-600-400 mb-1 text-xs">
				{resolved.mode === "automatic" ? "Begin a new scene when" : "Suggest a new scene when"}
			</legend>
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox"
					{disabled}
					checked={resolved.triggers.dayCrossed}
					onchange={(e) => withTriggers({ dayCrossed: e.currentTarget.checked })}
				/>
				The story's day changes
			</label>
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox"
					{disabled}
					checked={resolved.triggers.timeAction}
					onchange={(e) => withTriggers({ timeAction: e.currentTarget.checked })}
				/>
				Time passes (Time passes…, or you move the clock)
			</label>
			{#if hasPlace}
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						class="checkbox"
						{disabled}
						checked={resolved.triggers.placeChanged}
						onchange={(e) => withTriggers({ placeChanged: e.currentTarget.checked })}
					/>
					The place changes
				</label>
			{/if}
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox"
					{disabled}
					checked={resolved.triggers.narration}
					onchange={(e) => withTriggers({ narration: e.currentTarget.checked })}
				/>
				A narrator line is posted
			</label>
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						class="checkbox"
						{disabled}
						checked={resolved.triggers.length !== null}
						onchange={(e) =>
							withTriggers({
								length: e.currentTarget.checked ? { lines: 40, tokens: null } : null
							})}
					/>
					The scene reaches
				</label>
				<input
					class="input w-20 rounded-base"
					type="number"
					min="1"
					step="1"
					aria-label="Lines per scene"
					disabled={disabled || resolved.triggers.length === null}
					value={resolved.triggers.length?.lines ?? 40}
					onchange={(e) => {
						const lines = whole(e.currentTarget.valueAsNumber)
						if (lines !== null)
							withTriggers({
								length: { lines, tokens: resolved.triggers.length?.tokens ?? null }
							})
					}}
				/>
				<span>lines</span>
			</div>
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						class="checkbox"
						{disabled}
						checked={resolved.triggers.pause !== null}
						onchange={(e) =>
							withTriggers({ pause: e.currentTarget.checked ? { hours: 8 } : null })}
					/>
					A pause in play of more than
				</label>
				<input
					class="input w-20 rounded-base"
					type="number"
					min="1"
					step="1"
					aria-label="Hours of real time"
					disabled={disabled || resolved.triggers.pause === null}
					value={resolved.triggers.pause?.hours ?? 8}
					onchange={(e) => {
						const hours = whole(e.currentTarget.valueAsNumber)
						if (hours !== null) withTriggers({ pause: { hours } })
					}}
				/>
				<span>hours</span>
			</div>
			{#each boundaryTriggers as trigger (trigger.key)}
				<label class="flex items-center gap-2 text-sm" data-scene-declared-trigger={trigger.key}>
					<input
						type="checkbox"
						class="checkbox"
						{disabled}
						checked={declared[trigger.key] !== false}
						onchange={(e) => withDeclared(trigger.key, e.currentTarget.checked)}
					/>
					{sentenceCase(trigger.label)}
				</label>
			{/each}
		</fieldset>
	{/if}

	<div class="flex flex-col gap-1">
		<Select
			label="Summaries"
			describedBy="{uid}-summary-help"
			{disabled}
			options={(["onClose", "onRequest", "never"] as const).map((m) => ({
				value: m,
				label: SCENE_SUMMARY_LABELS[m]
			}))}
			value={resolved.summary}
			onValueChange={(v) => {
				if (v) set({ ...resolved, summary: v as SceneSettings["summary"] })
			}}
		/>
		<p class="text-surface-600-400 text-xs" id="{uid}-summary-help">
			{SUMMARY_HELP[resolved.summary]}
		</p>
	</div>

	{#if !followsGenre && !disabled}
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface self-start"
			onclick={() => (override = null)}
		>
			Use the genre's settings
		</button>
	{/if}
</fieldset>
