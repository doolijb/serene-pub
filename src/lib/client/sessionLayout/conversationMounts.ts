/**
 * The conversation family's modules (PLAN D7): Messages, Composer and Turn
 * line are three core widgets, each mounted remote from core's own component
 * module with the same grant. Built from core's ONE declaration, the way
 * `components/sessionPage/coreWidgets` builds the Messages mount: the module
 * served at `/core-ui/<component>`, and the base sections its declaration
 * reads (R75, K12).
 */
import { widgetReads, type WidgetBaseSection } from "@serene-pub/sdk"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import type { ConversationKind } from "./conversationTarget"

function mountOf(id: ConversationKind): {
	src: string
	reads: readonly WidgetBaseSection[]
} {
	const decl = CORE_WIDGETS.find((w) => w.id === id)
	if (!decl) throw new Error(`core declares no widget '${id}'`)
	return Object.freeze({
		src: `/core-ui/${decl.component ?? id}`,
		reads: Object.freeze([...widgetReads(decl)])
	})
}

export const CONVERSATION_MOUNTS: Readonly<
	Record<
		ConversationKind,
		{ src: string; reads: readonly WidgetBaseSection[] }
	>
> = Object.freeze({
	messages: mountOf("messages"),
	composer: mountOf("composer"),
	"turn-line": mountOf("turn-line")
})
