<script lang="ts">
	/**
	 * Start a session: the first screen, a few answers down one column.
	 *
	 * A name, then the genre, then an admin-enabled preset of that genre, then
	 * who is in it, then — for a genre whose shape has the capability — a
	 * lorebook (ruled 2026-09-10; the name moved to the top 2026-09-27, where
	 * it is always on screen instead of waiting behind the cast). A step with one option answers itself and
	 * shows as its summary line; an answered step collapses to the same line
	 * with a Change action. Everything else a session has is edited afterwards
	 * in the edit form.
	 *
	 * The form owns its own reply: it declares a one-shot interest in
	 * `sessions:create` / `sessions:create:error` with the request, releases
	 * both when one arrives, and hands the new id to `onCreated`, which is
	 * where navigation lives.
	 */
	import { onDestroy } from "svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import * as Icons from "@lucide/svelte"
	import {
		declareInterest,
		requestWithInterest
	} from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { refusedSwapsSentence } from "./refusedSwaps"
	import CharacterPickRow from "./CharacterPickRow.svelte"
	import PanelFilterInput from "../panels/PanelFilterInput.svelte"
	import PanelNavHeader from "../panels/PanelNavHeader.svelte"
	import {
		autoSessionName,
		castCountHint,
		castOptions,
		defaultGenreId,
		filterPickRows,
		finalSessionName,
		genreFacts,
		playAsOptions,
		StartSessionFlow
	} from "./createSession.svelte"

	interface Props {
		/** What the caller already knows: a character to start with, a persona
		 *  to speak as, a genre or preset to open on. */
		prefill?: {
			characterId?: number
			personaId?: number
			genreId?: string
			presetId?: number
		}
		/** The new session's id, once the server has made it. */
		onCreated: (sessionId: number) => void
		onCancel: () => void
		/** The view's close gate reads this. Bindable. */
		hasChanges?: boolean
		/** Show the back chevron — a list is behind this screen. */
		showBack?: boolean
	}

	let {
		prefill,
		onCreated,
		onCancel,
		hasChanges = $bindable(false),
		showBack = false
	}: Props = $props()

	const flow = new StartSessionFlow()

	/** The card a section sits in — the shared `@utility panel-card` in app.css. */
	const CARD_CLASS = "panel-card"

	type Step = "genre" | "preset" | "cast" | "name"

	let characters: Sockets.Characters.List.Response["characterList"] = $state(
		[]
	)
	let lorebookList: Sockets.Lorebooks.List.Response["lorebookList"] = $state(
		[]
	)
	let creating = $state(false)
	/**
	 * Which step the person has asked to open, over the first unsettled one.
	 * Every collapsed step carries a Change action, so a person who wants the
	 * cast before the genre can say so.
	 */
	let openStep = $state<Step | null>(null)
	let characterFilter = $state("")
	let personaFilter = $state("")
	let touched = $state(false)
	/** The person has answered this step themselves, so it may collapse. */
	let genreConfirmed = $state(false)
	let presetConfirmed = $state(false)
	let castTouched = $state(false)

	/** Released when the create is answered, or when the form goes away. */
	let releaseCreateInterest: (() => void) | null = null

	const handleCharactersList = (msg: Sockets.Characters.List.Response) => {
		characters = msg.characterList || []
	}
	const handleLorebooksList = (msg: Sockets.Lorebooks.List.Response) => {
		lorebookList = msg.lorebookList || []
	}
	const handleGenres = (msg: Sockets.Sessions.Genres.Response) => {
		flow.rawGenres = msg.genres || []
	}
	const handlePresets = (msg: Sockets.SessionAdmin.Presets.Response) => {
		flow.rawPresets = msg.presets || []
		flow.presetsLoaded = true
	}

	/**
	 * The four lists this screen reads, each asked for and listened for in
	 * one. The cast and the "who you play as" rows come from the SAME list: a
	 * persona is a character carrying `isPersona`, so there is no second
	 * family to ask. The lorebook picker's list is the edit form's, on the
	 * same terms.
	 *
	 * All BARE: none has an entry in `SCOPED_EVENTS`, and each is the whole of
	 * a list rather than one session's rows. All standing while the form is
	 * mounted, because each is a cascade target — a character created in its
	 * own picker, or a lorebook created elsewhere, re-sends the list this
	 * screen renders.
	 */
	$effect(() =>
		requestWithInterest("characters:list", {}, handleCharactersList)
	)
	$effect(() =>
		requestWithInterest("lorebooks:list", {}, handleLorebooksList)
	)
	$effect(() => requestWithInterest("sessions:genres", {}, handleGenres))
	$effect(() => requestWithInterest("sessionPresets:list", {}, handlePresets))

	/**
	 * Step 1's opening answer: the caller's genre, the only registered one, or
	 * the genre whose default preset an administrator has starred.
	 *
	 * The starred pick waits for `sessionPresets:list`, because the star lives
	 * on a preset row — with several genres and no preset list yet there is
	 * nothing to read it from, and the step simply stays open.
	 */
	$effect(() => {
		if (flow.genreId !== null) return
		const genres = flow.genres
		if (!genres.length) return
		if (
			prefill?.genreId &&
			genres.some((g) => g.genreId === prefill.genreId)
		) {
			flow.chooseGenre(prefill.genreId)
			return
		}
		if (genres.length === 1) {
			flow.chooseGenre(genres[0].genreId)
			return
		}
		if (!flow.presetsLoaded) return
		const wanted = defaultGenreId(genres, flow.rawPresets)
		if (wanted) flow.chooseGenre(wanted)
	})

	/** Step 2's answer: one enabled preset is taken silently, several open the
	 *  chooser with the genre's default selected. */
	$effect(() => {
		// Read what the choice depends on, so the effect re-runs with it.
		void flow.presetsForGenre
		void flow.presetId
		const wanted = prefill?.presetId
		if (
			wanted != null &&
			flow.presetId !== wanted &&
			flow.presetsForGenre.some((p) => p.id === wanted)
		) {
			flow.choosePreset(wanted)
			return
		}
		flow.syncPresetChoice()
	})

	/** The prefilled character, once the list carrying it lands. */
	let prefilledCharacter = $state(false)
	$effect(() => {
		const id = prefill?.characterId
		if (prefilledCharacter || id == null) return
		if (!characterOptions.some((c) => c.id === id)) return
		prefilledCharacter = true
		if (!flow.characterIds.includes(id))
			flow.characterIds = [...flow.characterIds, id]
	})

	/** The persona the person speaks as: the prefilled one, else their default. */
	let prefilledPersona = false
	$effect(() => {
		if (prefilledPersona || !personaOptions.length) return
		const wanted =
			prefill?.personaId != null &&
			personaOptions.some((p) => p.id === prefill.personaId)
				? prefill.personaId
				: (personaOptions.find((p) => p.isDefaultPersona)?.id ?? null)
		prefilledPersona = true
		if (wanted != null) flow.personaIds = [wanted]
	})

	/**
	 * Unsaved edits are the person's own: the saved snapshot is the form as
	 * it stood just before their first touch (`touch()`), after the effects
	 * above filled in the genre, preset and prefilled cast for them. So
	 * nothing the form chose by itself is an edit, and a name typed and
	 * deleted, or a character picked and un-picked, is none either. The cast
	 * is compared as sets — un-picking and re-picking only reorders it.
	 */
	const edits = new UnsavedEdits(
		() => ({
			genreId: flow.genreId,
			presetId: flow.presetId,
			characterIds: flow.characterIds,
			personaIds: flow.personaIds,
			lorebookId: flow.fields.lorebookId,
			name: flow.fields.name.trim(),
			scenario: flow.fields.scenario
		}),
		{ unordered: ["characterIds", "personaIds"] }
	)
	/** Call BEFORE the person's change lands (hence `onbeforeinput` below). */
	function touch() {
		if (touched) return
		edits.markSaved()
		touched = true
	}
	$effect(() => {
		hasChanges = edits.dirty
	})

	const genreOptions = $derived(flow.genres)
	const presetOptions = $derived(flow.presetsForGenre)

	const genreAnswered = $derived(flow.genreId !== null)
	const presetAnswered = $derived(
		flow.presetId !== null || flow.noPresetsForGenre
	)
	const castAnswered = $derived(
		flow.characterIds.length >= flow.floors.characters &&
			flow.personaIds.length >= flow.floors.personas
	)

	/** A step with one option is answered for the person, never asked. */
	const genreIsAChoice = $derived(genreOptions.length > 1)
	const presetIsAChoice = $derived(
		presetOptions.length > 1 || flow.noPresetsForGenre
	)

	/**
	 * A step is *settled* when nothing is left to ask there: it had one option,
	 * or the person picked, or the caller answered it in the prefill. Settled
	 * steps show as their summary line and the one below them opens.
	 *
	 * The cast step is the exception that stays open after it is answered: the
	 * floors say the session *can* start, not that the room is full, so the
	 * list stays on screen and the Name card appears under it.
	 */
	/** A genre that takes neither a cast nor a persona is not asked who is in
	 *  it — there is nobody to put there. */
	const castStepApplies = $derived(
		(flow.shape?.characters?.max ?? 1) !== 0 ||
			(flow.shape?.personas?.max ?? 1) !== 0
	)

	const genreSettled = $derived(!genreIsAChoice || genreConfirmed)
	const presetSettled = $derived(!presetIsAChoice || presetConfirmed)
	const castSettled = $derived(
		!castStepApplies || (castAnswered && prefilledCharacter && !castTouched)
	)

	/** The step the screen is asking — the first unsettled, unless reopened. */
	const firstUnsettled = $derived.by((): Step => {
		if (!genreSettled) return "genre"
		if (!presetSettled) return "preset"
		if (!castSettled) return "cast"
		return "name"
	})
	const activeStep = $derived(openStep ?? firstUnsettled)

	/** A step is on screen once everything above it has an answer. */
	const showPreset = $derived(genreAnswered)
	const showCast = $derived(
		genreAnswered && presetAnswered && castStepApplies
	)
	/** The Scenario offer sits at the foot once the genre and preset are
	 *  answered; the Name card is always on screen, at the top. */
	const showScenarioCard = $derived(genreAnswered && presetAnswered)

	const expandedGenre = $derived(genreIsAChoice && activeStep === "genre")
	const expandedPreset = $derived(presetIsAChoice && activeStep === "preset")
	const expandedCast = $derived(activeStep === "cast")

	/** The rows a person can pick. A list row with no id has nothing to add to
	 *  the session, so it is not offered. */
	type CharacterOption = (typeof characters)[number] & { id: number }
	type PersonaOption = CharacterOption
	const characterOptions = $derived(
		characters.filter((c): c is CharacterOption => c.id != null)
	)
	/**
	 * Who the person can play as: every character they have, personas first
	 * (the default leading), then everyone else — see `playAsOptions`. A
	 * library with no personas yet can still start: the server flags the
	 * character it seats (`markCharacterAsPersona`).
	 */
	const personaOptions = $derived(
		playAsOptions(characterOptions, flow.characterIds)
	)
	const filteredPersonas = $derived(
		filterPickRows(personaOptions, personaFilter)
	)

	/**
	 * The lorebook step, asked only of a genre whose shape has the
	 * capability. Required or optional is the shape's word (`lorebook:
	 * "required" | "optional"`); a genre without it is never asked, and
	 * `reconcileToShape` has already detached whatever was held.
	 */
	type LorebookOption = (typeof lorebookList)[number] & { id: number }
	const lorebookOptions = $derived(
		lorebookList.filter((l): l is LorebookOption => l.id != null)
	)
	const lorebookRequired = $derived(flow.shape?.lorebook === "required")
	/** On screen once everything above it has an answer, like the Name card. */
	const showLorebook = $derived(
		genreAnswered &&
			presetAnswered &&
			castAnswered &&
			!!flow.shape?.lorebook
	)

	/** One lorebook and the genre requires it: answered for the person, like
	 *  any other step with one option. The list stays on screen. */
	$effect(() => {
		if (!lorebookRequired || flow.fields.lorebookId != null) return
		if (lorebookOptions.length !== 1) return
		flow.fields.lorebookId = lorebookOptions[0].id
	})

	const selectedCharacters = $derived(
		flow.characterIds
			.map((id) => characterOptions.find((c) => c.id === id))
			.filter((c): c is CharacterOption => !!c)
	)
	const selectedPersonas = $derived(
		flow.personaIds
			.map((id) => personaOptions.find((p) => p.id === id))
			.filter((p): p is PersonaOption => !!p)
	)

	const characterName = (c: CharacterOption) =>
		c.nickname || c.name || "Unnamed character"

	const placeholderName = $derived(
		autoSessionName(
			selectedCharacters.map(characterName),
			selectedPersonas.map((p) => p.name || "")
		)
	)

	const castSummary = $derived(
		[
			selectedCharacters.map(characterName).join(", "),
			selectedPersonas.map((p) => p.name).join(", ")
		]
			.filter(Boolean)
			.join(" · ") || "Nobody yet"
	)

	/**
	 * Who the cast picker offers: everyone but the one the person plays as —
	 * the mirror of `personaOptions` (note 33), so the two lists never share
	 * a row.
	 */
	const castPickOptions = $derived(
		castOptions(characterOptions, flow.personaIds)
	)
	const filteredCharacters = $derived(
		filterPickRows(castPickOptions, characterFilter)
	)

	/**
	 * The Scenario box, revealed rather than standing.
	 *
	 * Every genre's session row has a scenario column and every one of them
	 * takes it, so the question is not whether the field exists but whether
	 * this session wants one — and most do not. A textarea left empty on most
	 * starts reads as a step that has been skipped; a text action reads as an
	 * offer. Once opened it stays open, so clearing the text does not take the
	 * box away mid-edit, and a preset that filled one opens it because there is
	 * already something to see.
	 */
	let scenarioOpen = $state(false)
	const showScenario = $derived(scenarioOpen || !!flow.fields.scenario)

	const canStart = $derived(flow.canStart && !creating)

	function reopen(step: Step) {
		openStep = step
	}

	function chooseGenre(id: string) {
		touch()
		genreConfirmed = true
		// A preset belongs to one genre, so the answer below reopens with it.
		presetConfirmed = false
		openStep = null
		flow.chooseGenre(id)
	}

	function choosePreset(id: number) {
		touch()
		presetConfirmed = true
		openStep = null
		flow.choosePreset(id)
	}

	/** "exactly 1", "1–3", "at least 1" — the floor the form holds and the cap the genre sets. */
	const characterCountHint = $derived(
		castCountHint(
			flow.floors.characters,
			flow.shape?.characters?.max ?? undefined
		)
	)

	function toggleCharacter(id: number) {
		touch()
		castTouched = true
		flow.toggleCharacter(id)
	}

	function choosePersona(id: number) {
		touch()
		castTouched = true
		flow.playAs(id)
	}

	function chooseLorebook(id: number | null) {
		touch()
		flow.fields.lorebookId = id
	}

	const handleCreated = (res: Sockets.Sessions.Create.Response) => {
		releaseCreateInterest?.()
		releaseCreateInterest = null
		creating = false
		if (!res?.session?.id) return
		toaster.success({
			title: "Session started",
			description: res.session.name || placeholderName
		})
		const refused = refusedSwapsSentence(res)
		if (refused) toaster.warning({ title: "Some settings were not applied", description: refused })
		edits.forget()
		hasChanges = false
		onCreated(res.session.id)
	}

	const handleCreateError = (res: Sockets.ErrorResponse) => {
		releaseCreateInterest?.()
		releaseCreateInterest = null
		creating = false
		toaster.error({
			title: "Could not start the session",
			description: res?.error || "The server refused the request."
		})
	}

	function start() {
		if (!canStart) return
		creating = true
		const finalName = finalSessionName(flow.fields.name, placeholderName)
		// The error key is declared first so the one interest sync the request
		// flushes carries both halves of the reply this form is waiting for.
		const releaseError = declareInterest<"sessions:create:error">(
			"sessions:create:error",
			handleCreateError
		)
		const releaseOk = requestWithInterest(
			"sessions:create",
			flow.payload(finalName),
			handleCreated
		)
		releaseCreateInterest = () => {
			releaseOk()
			releaseError()
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key !== "Escape") return
		e.stopPropagation()
		onCancel()
	}

	onDestroy(() => {
		releaseCreateInterest?.()
		releaseCreateInterest = null
	})
</script>

<!-- Escape closes the screen from anywhere inside it, and stops there rather
     than reaching the shell, so a person with focus in the cast list leaves
     this form and not the view behind it. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex min-h-full w-full max-w-[760px] flex-col gap-4"
	onkeydown={handleKeydown}
>
	<PanelNavHeader
		title="Start a session"
		onBack={showBack ? onCancel : undefined}
		backLabel="Back"
	>
		{#snippet primaryAction()}
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500 shrink-0"
				disabled={!canStart}
				onclick={start}
			>
				{#if creating}
					<Icons.Loader2
						size={16}
						class="animate-spin"
						aria-hidden="true"
					/>
				{:else}
					<Icons.Play size={16} aria-hidden="true" />
				{/if}
				Start
			</button>
		{/snippet}
	</PanelNavHeader>

	<div class="flex flex-col gap-3">
		<!-- ── 0. Name ──────────────────────────────────────────────────── -->
		<section class="{CARD_CLASS} flex flex-col">
			<label
				class="text-sm font-medium"
				for="start-session-name"
			>
				Name
			</label>
			<input
				id="start-session-name"
				type="text"
				class="input mt-2 rounded-[10px]"
				placeholder={placeholderName}
				bind:value={flow.fields.name}
				onbeforeinput={touch}
			/>
			<p class="text-surface-600-400 mt-1 text-xs">
				Optional. Leave it empty and the session is called “{placeholderName}”.
			</p>
		</section>

		<!-- ── 1. Genre ─────────────────────────────────────────────────── -->
		<section class={CARD_CLASS} aria-labelledby="start-genre-heading">
			<div class="flex min-w-0 items-baseline gap-2">
				<h3 id="start-genre-heading" class="flex-1 text-sm font-medium">
					Genre
				</h3>
				{#if genreIsAChoice && !expandedGenre}
					<button
						type="button"
						class="text-surface-600 hover:text-foreground dark:text-surface-400 dark:hover:text-surface-200 shrink-0 text-[13px] underline-offset-2 hover:underline"
						onclick={() => reopen("genre")}
					>
						Change
					</button>
				{/if}
			</div>
			{#if expandedGenre}
				<p class="text-surface-600 dark:text-surface-400 mt-1 text-xs">
					What kind of session this is. The genre decides which
					systems exist — characters, personas, lorebooks, the
					composer — and stays with the session for its life.
				</p>
				<div
					class="mt-3 grid grid-cols-1 gap-2 @lg/view:grid-cols-2"
					role="radiogroup"
					aria-labelledby="start-genre-heading"
				>
					{#each genreOptions as g (g.genreId)}
						{@const selected = g.genreId === flow.genreId}
						<button
							type="button"
							role="radio"
							aria-checked={selected}
							class="border-surface-300 dark:border-surface-800 hover:bg-surface-200-800 flex flex-col items-start gap-1 rounded-[10px] border p-3 text-left {selected
								? 'sidebar-row-active'
								: ''}"
							onclick={() => chooseGenre(g.genreId)}
						>
							<span class="text-[15px] font-medium">
								{g.name}
							</span>
							{#if g.description}
								<span
									class="text-surface-600 dark:text-surface-400 line-clamp-2 text-xs"
								>
									{g.description}
								</span>
							{/if}
							{#if genreFacts(g.shape)}
								<span class="text-surface-600-400 text-[11px]">
									{genreFacts(g.shape)}
								</span>
							{/if}
						</button>
					{/each}
				</div>
			{:else}
				<p class="mt-1 text-[13px]">
					{flow.genre?.name ?? "Loading…"}
				</p>
			{/if}
		</section>

		<!-- ── 2. Preset ────────────────────────────────────────────────── -->
		{#if showPreset}
			<section class={CARD_CLASS} aria-labelledby="start-preset-heading">
				<div class="flex min-w-0 items-baseline gap-2">
					<h3
						id="start-preset-heading"
						class="flex-1 text-sm font-medium"
					>
						Preset
					</h3>
					{#if presetIsAChoice && !expandedPreset}
						<button
							type="button"
							class="text-surface-600 hover:text-foreground dark:text-surface-400 dark:hover:text-surface-200 shrink-0 text-[13px] underline-offset-2 hover:underline"
							onclick={() => reopen("preset")}
						>
							Change
						</button>
					{/if}
				</div>
				{#if flow.noPresetsForGenre}
					<p
						class="preset-tonal-warning mt-2 rounded-[10px] p-3 text-[13px]"
						role="status"
					>
						No preset is available for this genre. An administrator
						decides which presets a session may start from.
					</p>
				{:else if expandedPreset}
					<p
						class="text-surface-600 dark:text-surface-400 mt-1 text-xs"
					>
						What answers this session's events, and what it starts
						filled in with.
					</p>
					<div
						class="mt-3 grid grid-cols-1 gap-2 @lg/view:grid-cols-2"
						role="radiogroup"
						aria-labelledby="start-preset-heading"
					>
						{#each presetOptions as p (p.id)}
							{@const selected = p.id === flow.presetId}
							<button
								type="button"
								role="radio"
								aria-checked={selected}
								class="border-surface-300 dark:border-surface-800 hover:bg-surface-200-800 flex flex-col items-start gap-1 rounded-[10px] border p-3 text-left {selected
									? 'sidebar-row-active'
									: ''}"
								onclick={() => choosePreset(p.id)}
							>
								<span class="text-[15px] font-medium">
									{p.name}
								</span>
								{#if p.description}
									<span
										class="text-surface-600 dark:text-surface-400 line-clamp-2 text-xs"
									>
										{p.description}
									</span>
								{/if}
								{#if p.isDefault}
									<span class="text-surface-600-400 text-[11px]">
										Default for this genre
									</span>
								{/if}
							</button>
						{/each}
					</div>
				{:else}
					<p class="mt-1 text-[13px]">
						{flow.preset?.name ?? "Loading…"}
					</p>
				{/if}
			</section>
		{/if}

		<!-- ── 3. Who is in it ──────────────────────────────────────────── -->
		{#if showCast}
			<section class={CARD_CLASS} aria-labelledby="start-cast-heading">
				<div class="flex min-w-0 items-baseline gap-2">
					<h3
						id="start-cast-heading"
						class="flex-1 text-sm font-medium"
					>
						Who is in it
					</h3>
					{#if !expandedCast}
						<button
							type="button"
							class="text-surface-600 hover:text-foreground dark:text-surface-400 dark:hover:text-surface-200 shrink-0 text-[13px] underline-offset-2 hover:underline"
							onclick={() => reopen("cast")}
						>
							Change
						</button>
					{/if}
				</div>
				{#if expandedCast}
					{#if flow.floors.characters > 0 || (flow.shape?.characters?.max ?? 1) !== 0}
						<div class="mt-3 flex flex-col gap-2">
							<p class="text-surface-600-400 text-xs">
								Characters{characterCountHint
									? ` — ${characterCountHint}`
									: ""}
							</p>
							{#if castPickOptions.length > 8}
								<PanelFilterInput
									bind:value={characterFilter}
									placeholder="characters"
									count={castPickOptions.length}
								/>
							{/if}
							{#if characterOptions.length === 0}
								<p class="text-surface-600-400 text-[13px]">
									You have no characters yet. Write one in the
									Characters view, then come back.
								</p>
							{:else if castPickOptions.length === 0}
								<p class="text-surface-600-400 text-[13px]">
									The only character you have is the one you
									play as. Pick someone else to play as, or
									write another character.
								</p>
							{:else}
								<ul
									class="flex flex-col gap-1"
									aria-label="Characters"
								>
									{#each filteredCharacters as c (c.id)}
										<li>
											<CharacterPickRow
												character={c}
												kind="checkbox"
												checked={flow.characterIds.includes(
													c.id
												)}
												onchange={() =>
													toggleCharacter(c.id)}
											/>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}

					{#if (flow.shape?.personas?.max ?? 1) !== 0}
						<div class="mt-4 flex flex-col gap-2">
							<p class="text-surface-600-400 text-xs">
								Who you play as{flow.floors.personas > 0
									? " — pick one"
									: ""}
							</p>
							{#if personaOptions.length > 8}
								<PanelFilterInput
									bind:value={personaFilter}
									placeholder="characters to play as"
									count={personaOptions.length}
								/>
							{/if}
							{#if characterOptions.length === 0}
								<p class="text-surface-600-400 text-[13px]">
									You have no characters yet. Write one in the
									Characters view, then come back.
								</p>
							{:else if personaOptions.length === 0}
								<p class="text-surface-600-400 text-[13px]">
									Everyone you have is in the cast. Take one
									out to play as them, or write another
									character.
								</p>
							{:else}
								<ul
									class="flex flex-col gap-1"
									role="radiogroup"
									aria-label="Who you play as"
								>
									{#each filteredPersonas as p (p.id)}
										<li>
											<CharacterPickRow
												character={p}
												kind="radio"
												group="start-play-as"
												checked={flow.personaIds.includes(
													p.id
												)}
												onchange={() =>
													choosePersona(p.id)}
											/>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}
				{:else}
					<p class="mt-1 truncate text-[13px]">{castSummary}</p>
				{/if}
			</section>
		{/if}

		<!-- ── 4. Lorebook ──────────────────────────────────────────────── -->
		{#if showLorebook}
			<section
				class={CARD_CLASS}
				aria-labelledby="start-lorebook-heading"
			>
				<h3 id="start-lorebook-heading" class="text-sm font-medium">
					Lorebook{lorebookRequired ? "*" : ""}
				</h3>
				<p class="text-surface-600 dark:text-surface-400 mt-1 text-xs">
					The session will use world lore, character lore and history
					entries from this lorebook.
				</p>
				{#if lorebookOptions.length === 0}
					<p
						class="mt-3 text-[13px] {lorebookRequired
							? 'preset-tonal-warning rounded-[10px] p-3'
							: 'text-surface-600-400'}"
						role="status"
					>
						{#if lorebookRequired}
							This genre needs a lorebook — create one in
							Lorebooks first.
						{:else}
							You have no lorebooks yet — this genre can start
							without one.
						{/if}
					</p>
				{:else}
					<ul
						class="mt-3 flex flex-col gap-1"
						role="radiogroup"
						aria-labelledby="start-lorebook-heading"
					>
						{#if !lorebookRequired}
							{@const selected = flow.fields.lorebookId == null}
							<li>
								<button
									type="button"
									role="radio"
									aria-checked={selected}
									class="hover:bg-surface-200-800 flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left {selected
										? 'sidebar-row-active'
										: ''}"
									onclick={() => chooseLorebook(null)}
								>
									<Icons.BookDashed
										size={20}
										class="text-surface-500 shrink-0"
										aria-hidden="true"
									/>
									<span
										class="min-w-0 flex-1 truncate text-[15px]"
									>
										None
									</span>
									{#if selected}
										<Icons.Check
											size={16}
											class="text-primary-500 shrink-0"
											aria-hidden="true"
										/>
									{/if}
								</button>
							</li>
						{/if}
						{#each lorebookOptions as l (l.id)}
							{@const selected = flow.fields.lorebookId === l.id}
							<li>
								<button
									type="button"
									role="radio"
									aria-checked={selected}
									class="hover:bg-surface-200-800 flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left {selected
										? 'sidebar-row-active'
										: ''}"
									onclick={() => chooseLorebook(l.id)}
								>
									<Icons.BookMarked
										size={20}
										class="text-surface-500 shrink-0"
										aria-hidden="true"
									/>
									<span
										class="min-w-0 flex-1 truncate text-[15px] font-medium"
									>
										{l.name || "Untitled lorebook"}
									</span>
									{#if selected}
										<Icons.Check
											size={16}
											class="text-primary-500 shrink-0"
											aria-hidden="true"
										/>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		<!-- ── 5. Scenario ─────────────────────────────────────────────── -->
		{#if showScenarioCard}
			{#if showScenario}
				<section class="{CARD_CLASS} flex flex-col">
					<label
						class="text-sm font-medium"
						for="start-session-scenario"
					>
						Scenario
					</label>
					<textarea
						id="start-session-scenario"
						rows="4"
						class="input mt-3 rounded-[10px]"
						bind:value={flow.fields.scenario}
						onbeforeinput={touch}
					></textarea>
					<p class="text-surface-600-400 mt-1 text-xs">
						Scene-setting text every prompt will see
					</p>
				</section>
			{:else}
				<button
					type="button"
					class="text-surface-600-400 hover:text-surface-700-300 flex items-center gap-1.5 self-start px-1 text-sm"
					onclick={() => (scenarioOpen = true)}
				>
					<Icons.Plus size={14} aria-hidden="true" />
					Add a scenario
				</button>
			{/if}
		{/if}
	</div>
</div>
