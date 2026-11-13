/**
 * WHICH MESSAGES A COMPOSER / TURN LINE FOLLOWS (PLAN D7) — pure. The nearest
 * panel above in the same zone whose open tab is a Messages copy; else the
 * nearest Messages panel in its zone; else the layout's first Messages. A
 * panel showing a non-Messages tab keeps the last channel ("Writing to").
 */
import { isInstanceOf } from "@serene-pub/sdk"

export interface TargetPanel {
	key: string
	/** Instance ids. */
	tabs: readonly string[]
	/** The shown tab. */
	open: string
}
export interface TargetZones {
	left: readonly TargetPanel[]
	middle: readonly TargetPanel[]
	right: readonly TargetPanel[]
}
export interface ConversationTargetPick {
	target: string
	writingTo: boolean
}
export type ConversationKind = "messages" | "composer" | "turn-line"

export function conversationKindOf(id: string): ConversationKind | null {
	for (const k of ["messages", "composer", "turn-line"] as const)
		if (isInstanceOf(id, k)) return k
	return null
}

export function conversationTargetOf(o: {
	zones: TargetZones
	instanceId: string
	isMessages(id: string): boolean
	last?: string | null
}): ConversationTargetPick | null {
	const { zones, isMessages } = o
	const order = ["middle", "left", "right"] as const
	const holds = (p: TargetPanel) => p.tabs.some(isMessages)

	let home: (typeof order)[number] | null = null
	let at = -1
	for (const z of order) {
		const i = zones[z].findIndex((p) => p.tabs.includes(o.instanceId))
		if (i >= 0) {
			home = z
			at = i
			break
		}
	}
	if (home === null) return null
	const column = zones[home]

	for (let i = at - 1; i >= 0; i--)
		if (isMessages(column[i].open))
			return { target: column[i].open, writingTo: false }

	let panel: TargetPanel | null = null
	for (let d = 1; d < column.length && panel === null; d++) {
		for (const i of [at - d, at + d])
			if (i >= 0 && i < column.length && holds(column[i])) {
				panel = column[i]
				break
			}
	}
	if (panel === null)
		for (const z of order) {
			panel = zones[z].find(holds) ?? null
			if (panel) break
		}
	if (panel === null) return null

	if (isMessages(panel.open)) return { target: panel.open, writingTo: false }
	const kept =
		o.last && panel.tabs.includes(o.last)
			? o.last
			: panel.tabs.find(isMessages)!
	return { target: kept, writingTo: true }
}
