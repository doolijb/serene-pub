<script lang="ts">
	import { Editor } from "@tiptap/core"
	import StarterKit from "@tiptap/starter-kit"
	import { onMount } from "svelte"
	import LorebookBindingTag from "../../utils/tiptapLorebookBindingTag"
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import Placeholder from "@tiptap/extension-placeholder"
	import LegacyTag from "$lib/client/utils/tiptapLegacyTag"
	import HandlebarsLint from "$lib/client/utils/tiptapHandlebarsLint"
	import { INSERTABLE_MACRO_OPTIONS } from "$lib/shared/utils/handlebarsLint"
	import type { EditorView } from "prosemirror-view"
	import {
		castMemberLabel,
		castTagKind,
		castTagLabel,
		castTagTitle
	} from "$lib/client/utils/castTag"

	interface Props {
		content: string
		lorebookBindingList: Sockets.Lorebooks.BindingList.Response["lorebookBindingList"]
		/**
		 * The id of the visible element that names this field. The editor is
		 * a contenteditable `div`, which a `<label for>` cannot target, so
		 * the name is wired through `aria-labelledby` instead.
		 */
		labelledBy?: string
		/** The accessible name when there is no visible label to point at. */
		label?: string
	}

	let {
		content = $bindable(),
		lorebookBindingList = $bindable(),
		labelledBy,
		label = "Content"
	}: Props = $props()

	let editor: Editor
	let editorEl: HTMLDivElement
	let isBold = $state(false)
	let canUndo = $state(false)
	let canRedo = $state(false)
	let addBindingOpenState = $state(false)
	let addMacroOpenState = $state(false)

	function getLabel(tag: string) {
		return castTagLabel(lorebookBindingList ?? [], tag)
	}

	/**
	 * A tag names a cast member: one with a character card (a persona is a
	 * card the reader has flagged as their own), a **background** member with
	 * no card, or — only when no row matches — nobody.
	 */
	function getCharType(tag: string) {
		return castTagKind(lorebookBindingList ?? [], tag)
	}

	const CHIP_PRESET = {
		character: "preset-filled-primary-500",
		persona: "preset-filled-secondary-500",
		background: "preset-filled-surface-500",
		unknown: "preset-filled-warning-500"
	} as const

	/**
	 * The last text this editor wrote into `content`. A `content` that differs
	 * from it came from outside — another entry selected, an amendment
	 * resolved, the moment moved — and the editor must show it. Comparing
	 * against what the editor itself emitted is what keeps typing from
	 * resetting the document (and the cursor) on every keystroke.
	 */
	let lastEmitted: string | undefined

	function updateToolbarStates() {
		if (!editor) return
		isBold = editor.isActive("bold")
		canUndo = editor.can().undo()
		canRedo = editor.can().redo()
	}

	function getContentWithCharTags(editor: Editor): string {
		if (!editor) return ""
		const doc = editor.state.doc
		let result = ""
		doc.descendants((node) => {
			if (node.type.name === "LorebookBindingTag") {
				// Use the correct {{char:#}} syntax (double braces)
				result += `{{char:${node.attrs.id}}}`
			} else if (node.type.name === "legacyTag") {
				result += node.attrs.original
			} else if (node.isText) {
				result += node.text
			} else if (node.isBlock) {
				result += "\n"
			}
			return true
		})
		return result
	}

	// Helper: parse {{char:N}} and double-brace legacy tags in plain text to Tiptap doc JSON
	function parseCharTagsToTiptapDoc(text: string) {
		const parts = []
		let lastIndex = 0
		// Regex for {{char:N}} and double-brace legacy tags only ({{user}}, {{char}}, {{persona}}, {{character}})
		const regex =
			/\{\{char:(\d+)\}\}|\{\{(user|char|persona|character)\}\}/g
		let match
		while ((match = regex.exec(text)) !== null) {
			if (match.index > lastIndex) {
				parts.push({
					type: "text",
					text: text.slice(lastIndex, match.index)
				})
			}
			if (match[1]) {
				// {{char:N}} - numbered binding syntax
				parts.push({
					type: "LorebookBindingTag",
					attrs: { id: match[1] }
				})
			} else if (match[2]) {
				// {{user}}, {{char}}, etc. - double-brace legacy tag syntax
				parts.push({
					type: "legacyTag",
					attrs: {
						tag: `{{${match[2]}}}`,
						original: `{{${match[2]}}}`
					}
				})
			}
			lastIndex = match.index + match[0].length
		}
		if (lastIndex < text.length) {
			parts.push({ type: "text", text: text.slice(lastIndex) })
		}
		return {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: parts
				}
			]
		}
	}

	function forceRawContentCopy(view: EditorView, arg1: () => string) {
		const listener = (event: ClipboardEvent) => {
			const text = arg1()
			event.clipboardData?.setData("text/plain", text)
			event.preventDefault()
		}
		view.dom.addEventListener("copy", listener)

		// Clean up the event listener when the component is destroyed
		return () => {
			view.dom.removeEventListener("copy", listener)
		}
	}

	$effect(() => {
		const next = content ?? ""
		if (!editor || next === lastEmitted) return
		lastEmitted = next
		// `false`: no onUpdate — this is not an edit, and emitting would write
		// the parsed-and-reserialised text back over the parent's value.
		editor.commands.setContent(parseCharTagsToTiptapDoc(next), false)
		updateToolbarStates()
	})

	onMount(() => {
		lastEmitted = content ?? ""
		editor = new Editor({
			element: editorEl,
			content: parseCharTagsToTiptapDoc(content ?? ""),
			editorProps: {
				attributes: {
					role: "textbox",
					"aria-multiline": "true",
					...(labelledBy
						? { "aria-labelledby": labelledBy }
						: { "aria-label": label })
				}
			},
			extensions: [
				StarterKit,
				LorebookBindingTag.configure({ getLabel, getCharType }),
				LegacyTag.configure({}),
				HandlebarsLint
				// Placeholder.configure({
				//     placeholder: ({ node }) => "A subterranean metropolis carved into the bones of a long-dead titan..."
				// }),
			],
			onUpdate: ({ editor }) => {
				const next = getContentWithCharTags(editor)
				lastEmitted = next
				content = next
				updateToolbarStates()
			}
		})
		editor.on("selectionUpdate", updateToolbarStates)
		updateToolbarStates()

		// Ensure copying from tiptap always copies the raw textarea content
		const removeCopyListener = forceRawContentCopy(
			editor.view,
			() => content
		)

		return () => {
			removeCopyListener()
			editor.destroy()
		}
	})
</script>

<div class="">
	<div class="tiptap-toolbar mb-1">
		<Popover
			open={addBindingOpenState}
			onOpenChange={(e) => (addBindingOpenState = e.open)}
			positioning={{ placement: "bottom" }}
		>
			<!-- Named for what it puts in rather than for the syntax it puts
			     in: a reader is inserting a cast member, and `{{char:N}}` is
			     how that is spelled. -->
			<Popover.Trigger
				class="btn btn-sm preset-filled-surface-500 gap-1"
				title="Insert a cast member"
				aria-label="Insert a cast member"
			>
				<Icons.UserPlus size={16} aria-hidden="true" />
				<span>Cast</span>
			</Popover.Trigger>
			<Portal>
				<Popover.Positioner class="z-[1000]!">
					<Popover.Content
						class="card preset-filled-surface-100-900 p-4 shadow-xl"
					>
						<div class="flex flex-col gap-2">
							<div class="mb-2 text-sm font-semibold">
								Insert a cast member
							</div>
							{#each lorebookBindingList as binding (binding.id)}
								{@const kind = castTagKind(
									lorebookBindingList,
									binding.binding
								)}
								{@const memberLabel = castMemberLabel(
									binding,
									binding.binding
								)}
								<button
									class="btn {CHIP_PRESET[kind]}"
									onclick={() => {
										editor.commands.insertLorebookBindingTag(
											binding.binding
										)
										addBindingOpenState = false
									}}
									title={castTagTitle(kind, memberLabel)}
								>
									{memberLabel}
								</button>
							{/each}
						</div>
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover>
		<Popover
			open={addMacroOpenState}
			onOpenChange={(e) => (addMacroOpenState = e.open)}
			positioning={{ placement: "bottom" }}
		>
			<Popover.Trigger
				class="btn btn-sm preset-filled-surface-500 gap-1"
				title="Insert a macro"
				aria-label="Insert a macro"
			>
				<Icons.Braces size={16} aria-hidden="true" />
				<span>Macro</span>
			</Popover.Trigger>
			<Portal>
				<Popover.Positioner class="z-[1000]!">
					<Popover.Content
						class="card preset-filled-surface-100-900 p-4 shadow-xl"
					>
						<div class="flex flex-col gap-2">
							<div class="mb-2 text-sm font-semibold">
								Insert a macro
							</div>
							{#each INSERTABLE_MACRO_OPTIONS as macro}
								<button
									class="btn preset-filled-surface-500"
									onclick={() => {
										editor.commands.insertContent(
											macro.snippet
										)
										addMacroOpenState = false
									}}
									title={macro.description}
								>
									{macro.label}
								</button>
							{/each}
						</div>
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover>
		<button
			aria-label="Undo"
			class="btn btn-sm preset-filled-surface-500"
			title="Undo"
			onclick={() => editor && editor.chain().focus().undo().run()}
			disabled={!canUndo}
		>
			<Icons.Undo size={16} />
		</button>
		<button
			aria-label="Redo"
			class="btn btn-sm preset-filled-surface-500"
			title="Redo"
			onclick={() => editor && editor.chain().focus().redo().run()}
			disabled={!canRedo}
		>
			<Icons.Repeat size={16} />
		</button>
	</div>

	<!-- <textarea
		bind:value={content}
		class="textarea textarea-lg w-full"
        placeholder="A subterranean metropolis carved into the bones of a long-dead titan..."
	></textarea> -->

	<div
		bind:this={editorEl}
		class="tiptap-content preset-filled-surface-200-800 rounded-lg"
		placeholder="A subterranean metropolis carved into the bones of a long-dead titan..."
	></div>
</div>

<style lang="postcss">
	@reference "tailwindcss";

	:global {
		.handlebars-lint-issue {
			text-decoration: underline wavy var(--color-error-500);
			text-underline-offset: 3px;
			cursor: help;
		}
	}
</style>
