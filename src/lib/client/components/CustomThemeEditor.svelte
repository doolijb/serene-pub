<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy, getContext, untrack } from "svelte"
	import { v4 as uuid } from "uuid"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import { EditorState } from "@codemirror/state"
	import {
		EditorView,
		keymap,
		lineNumbers,
		highlightActiveLine,
		highlightActiveLineGutter
	} from "@codemirror/view"
	import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
	import { css } from "@codemirror/lang-css"
	import { oneDark } from "@codemirror/theme-one-dark"
	import {
		syntaxHighlighting,
		defaultHighlightStyle,
		bracketMatching,
		foldGutter,
		indentOnInput
	} from "@codemirror/language"
	import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
	import {
		closeBrackets,
		closeBracketsKeymap
	} from "@codemirror/autocomplete"

	interface Props {
		theme?: Sockets.CustomThemes.ThemeMeta | null
		onSaved?: (theme: Sockets.CustomThemes.ThemeMeta) => void
		onDeleted?: (id: number) => void
		onCancel?: () => void
	}

	let { theme = null, onSaved, onDeleted, onCancel }: Props = $props()

	const socket = useTypedSocket()
	const userCtx: { user: SelectUser } = getContext("userCtx")
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let isAccountsEnabled = $derived(
		systemSettingsCtx?.settings?.isAccountsEnabled ?? false
	)
	let isAdmin = $derived(userCtx?.user?.isAdmin ?? false)

	// Editor state
	let editorContainer: HTMLElement
	let editorView: EditorView | null = null
	let isFullscreen = $state(false)
	let isSaving = $state(false)
	let isDeleting = $state(false)
	let isLoadingCss = $state(false)
	let confirmDelete = $state(false)

	// Form fields
	let labelField = $state(untrack(() => theme?.label ?? ""))
	// For new themes, generate a stable random ID upfront so file import can use it immediately.
	// Uses uuid's v4() rather than crypto.randomUUID() — the latter only exists in secure
	// contexts (HTTPS or localhost), which breaks self-hosted setups reached over a plain
	// http://<lan-ip> URL, a common Docker/NAS deployment pattern.
	const themeName = untrack(() => theme?.name ?? uuid())
	let cssContent = $state("")

	// Stats
	let lineCount = $state(0)
	let charCount = $state(0)

	function updateStats(content: string) {
		lineCount = content.split("\n").length
		charCount = content.length
	}

	function initEditor(initialContent = "") {
		if (editorView) editorView.destroy()

		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				cssContent = update.state.doc.toString()
				updateStats(cssContent)
			}
		})

		const state = EditorState.create({
			doc: initialContent,
			extensions: [
				lineNumbers(),
				highlightActiveLineGutter(),
				history(),
				foldGutter(),
				indentOnInput(),
				bracketMatching(),
				closeBrackets(),
				highlightActiveLine(),
				highlightSelectionMatches(),
				css(),
				oneDark,
				keymap.of([
					...closeBracketsKeymap,
					...defaultKeymap,
					...historyKeymap,
					...searchKeymap
				]),
				updateListener,
				EditorView.theme({
					"&": { height: "100%", fontSize: "13px" },
					".cm-scroller": {
						overflow: "auto",
						fontFamily:
							"'Fira Mono', 'Cascadia Code', 'JetBrains Mono', monospace"
					},
					".cm-content": { padding: "8px 0" },
					".cm-gutters": { borderRight: "1px solid #2a2a3a" }
				})
			]
		})

		editorView = new EditorView({ state, parent: editorContainer })
		cssContent = initialContent
		updateStats(initialContent)
	}

	function handleFileImport(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return
		const reader = new FileReader()
		reader.onload = (ev) => {
			const content = (ev.target?.result as string) ?? ""
			// Strip any outer wrapper — server re-wraps with the rotating cssKey
			let stripped = content.replace(
				/^\s*\[data-theme=[^\]]*\]\s*\{([\s\S]*)\}\s*$/,
				(_, inner) => inner.trim()
			)
			if (stripped === content)
				stripped = content.replace(
					/^\s*\{([\s\S]*)\}\s*$/,
					(_, inner) => inner.trim()
				)
			editorView?.dispatch({
				changes: {
					from: 0,
					to: editorView.state.doc.length,
					insert: stripped
				}
			})
			if (!labelField) {
				labelField = file.name
					.replace(/\.(css|json)$/i, "")
					.replace(/[_-]/g, " ")
					.replace(/\b\w/g, (c) => c.toUpperCase())
			}
		}
		reader.readAsText(file)
		;(e.target as HTMLInputElement).value = ""
	}

	function save() {
		const content = editorView?.state.doc.toString() ?? ""
		if (!labelField.trim() || !content.trim()) {
			toaster.error({ title: "Label and CSS are required" })
			return
		}
		isSaving = true
		socket.emit("customThemes:save", {
			id: theme?.id,
			name: themeName,
			label: labelField,
			css: content
		})
	}

	function deleteTheme() {
		if (!theme?.id) return
		isDeleting = true
		socket.emit("customThemes:delete", { id: theme.id })
	}

	function toggleInstanceTheme(enabled: boolean) {
		if (!theme?.id) return
		socket.emit("customThemes:setInstanceTheme", { id: theme.id, enabled })
	}

	onMount(() => {
		initEditor()

		// Load existing CSS if editing
		if (theme) {
			isLoadingCss = true
			socket.emit("customThemes:getCss", { name: theme.name })
		}

		socket.on(
			"customThemes:getCss",
			(msg: Sockets.CustomThemes.GetCss.Response) => {
				if (msg.name !== (theme?.name ?? themeName)) return
				isLoadingCss = false
				editorView?.dispatch({
					changes: {
						from: 0,
						to: editorView.state.doc.length,
						insert: msg.css
					}
				})
			}
		)

		socket.on(
			"customThemes:save",
			(msg: Sockets.CustomThemes.Save.Response) => {
				isSaving = false
				toaster.success({ title: "Theme saved" })
				onSaved?.(msg.theme)
			}
		)
		socket.on("customThemes:save:error", (msg: Sockets.ErrorResponse) => {
			isSaving = false
			toaster.error({
				title: "Failed to save theme",
				description: msg?.error
			})
		})

		socket.on("customThemes:delete", () => {
			isDeleting = false
			toaster.success({ title: "Theme deleted" })
			if (theme?.id) onDeleted?.(theme.id)
		})
		socket.on("customThemes:delete:error", (msg: Sockets.ErrorResponse) => {
			isDeleting = false
			toaster.error({
				title: "Failed to delete theme",
				description: msg?.error
			})
		})

		socket.on("customThemes:setInstanceTheme", () => {
			toaster.success({ title: "Instance theme setting updated" })
		})
		socket.on(
			"customThemes:setInstanceTheme:error",
			(msg: Sockets.ErrorResponse) => {
				toaster.error({
					title: "Failed to update",
					description: msg?.error
				})
			}
		)
	})

	onDestroy(() => {
		editorView?.destroy()
		socket.off("customThemes:getCss")
		socket.off("customThemes:save")
		socket.off("customThemes:save:error")
		socket.off("customThemes:delete")
		socket.off("customThemes:delete:error")
		socket.off("customThemes:setInstanceTheme")
		socket.off("customThemes:setInstanceTheme:error")
	})
</script>

<div
	class="flex flex-col overflow-hidden rounded-xl border transition-all {isFullscreen
		? 'fixed inset-0 z-[9999] rounded-none'
		: 'h-full'}"
	style="border-color: #2a2a3a; background: #13131f;"
>
	<!-- Editor toolbar -->
	<div
		class="flex items-center gap-2 border-b px-4 py-2"
		style="border-color: #2a2a3a; background: #1a1a2e;"
	>
		<div class="flex flex-1 items-center gap-3">
			<!-- Dot accent -->
			<span
				class="h-2.5 w-2.5 rounded-full"
				style="background: linear-gradient(135deg, #7c6af7, #a855f7);"
			></span>
			<span
				class="text-xs font-semibold tracking-wider uppercase"
				style="color: #8b8ba7;"
			>
				Custom Theme
			</span>
		</div>
		<div class="flex items-center gap-1">
			<!-- Import file -->
			<label
				class="btn btn-sm cursor-pointer text-xs"
				style="color: #8b8ba7; background: transparent;"
				title="Import CSS/JSON file"
			>
				<Icons.Upload size={13} />
				<span>Import</span>
				<input
					type="file"
					accept=".css,.json"
					class="hidden"
					onchange={handleFileImport}
				/>
			</label>
			<!-- Fullscreen toggle -->
			<button
				class="btn btn-sm text-xs"
				style="color: #8b8ba7; background: transparent;"
				onclick={() => (isFullscreen = !isFullscreen)}
				title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
			>
				{#if isFullscreen}
					<Icons.Minimize2 size={13} />
				{:else}
					<Icons.Maximize2 size={13} />
				{/if}
			</button>
		</div>
	</div>

	<!-- Fields row -->
	<div
		class="border-b px-4 py-3"
		style="border-color: #2a2a3a; background: #16162a;"
	>
		<label
			for="theme-label-input"
			class="mb-1 block text-xs font-medium"
			style="color: #6b6b8a;"
		>
			Display name
		</label>
		<input
			id="theme-label-input"
			type="text"
			class="w-full rounded border px-2 py-1.5 text-sm transition outline-none focus:ring-1"
			style="background: #1e1e32; border-color: #2a2a3a; color: #c8c8e8; --tw-ring-color: #7c6af7;"
			bind:value={labelField}
			placeholder="My Night Theme"
		/>
	</div>

	<!-- Loading overlay for CSS -->
	{#if isLoadingCss}
		<div
			class="flex flex-1 items-center justify-center"
			style="background: #13131f;"
		>
			<Icons.Loader2
				size={24}
				class="animate-spin"
				style="color: #7c6af7;"
			/>
		</div>
	{/if}

	<!-- CodeMirror editor -->
	<div
		bind:this={editorContainer}
		class="flex-1 overflow-hidden"
		class:hidden={isLoadingCss}
	></div>

	<!-- Status bar -->
	<div
		class="flex items-center justify-between border-t px-4 py-1.5"
		style="border-color: #2a2a3a; background: #1a1a2e;"
	>
		<div class="flex items-center gap-4 text-xs" style="color: #4a4a6a;">
			<span>{lineCount} lines</span>
			<span>{charCount.toLocaleString()} chars</span>
			<span style="color: #2a2a3a;">•</span>
			<span style="color: #5a5a7a;">CSS</span>
		</div>
		<div class="flex items-center gap-2">
			<!-- Admin: instance theme toggle -->
			{#if isAdmin && theme && isAccountsEnabled}
				<button
					class="btn btn-sm text-xs"
					style="color: {theme.isInstanceTheme
						? '#a855f7'
						: '#4a4a6a'}; background: transparent; border: 1px solid {theme.isInstanceTheme
						? '#7c6af7'
						: '#2a2a3a'};"
					onclick={() => toggleInstanceTheme(!theme!.isInstanceTheme)}
					title={theme.isInstanceTheme
						? "Disable for all users"
						: "Enable for all users"}
				>
					<Icons.Globe size={11} />
					{theme.isInstanceTheme
						? "Instance theme"
						: "Make instance theme"}
				</button>
			{/if}

			<!-- Admin: uploader info -->
			{#if isAdmin && theme?.uploaderName && isAccountsEnabled}
				<span class="text-xs" style="color: #3a3a5a;">
					by {theme.uploaderName}
				</span>
			{/if}

			<!-- Delete -->
			{#if theme?.id}
				{#if confirmDelete}
					<button
						class="btn btn-sm text-xs"
						style="background: #7f1d1d; color: #fca5a5; border: 1px solid #991b1b;"
						onclick={deleteTheme}
						disabled={isDeleting}
					>
						{#if isDeleting}<Icons.Loader2
								size={11}
								class="animate-spin"
							/>{:else}<Icons.Trash2 size={11} />{/if}
						Confirm delete
					</button>
					<button
						class="btn btn-sm text-xs"
						style="color: #4a4a6a; background: transparent;"
						onclick={() => (confirmDelete = false)}
					>
						Cancel
					</button>
				{:else}
					<button
						class="btn btn-sm text-xs"
						style="color: #4a4a6a; background: transparent;"
						onclick={() => (confirmDelete = true)}
					>
						<Icons.Trash2 size={11} />
					</button>
				{/if}
			{/if}

			{#if onCancel}
				<button
					class="btn btn-sm text-xs"
					style="color: #4a4a6a; background: transparent;"
					onclick={onCancel}
				>
					Cancel
				</button>
			{/if}

			<button
				class="btn btn-sm text-xs font-semibold"
				style="background: linear-gradient(135deg, #7c6af7, #a855f7); color: white; padding: 0.25rem 0.875rem;"
				onclick={save}
				disabled={isSaving}
			>
				{#if isSaving}
					<Icons.Loader2 size={11} class="animate-spin" />
				{:else}
					<Icons.Save size={11} />
				{/if}
				{theme ? "Update" : "Create"}
			</button>
		</div>
	</div>
</div>
