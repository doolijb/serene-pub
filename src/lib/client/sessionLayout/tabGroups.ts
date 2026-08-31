/**
 * Collapsing grouped widgets into live-view "render units" (PLAN 25). Pure — no
 * DOM, no Svelte — so it's unit-testable. Widgets sharing a `group` become ONE
 * unit occupying their bounding box (rendered as a tab set); a widget with no
 * group is a one-member unit at its own cell.
 *
 * Overlap guard: a group whose members are scattered (non-adjacent cells) has a
 * bounding box that can span across OTHER widgets' cells, which would overlap
 * them in the proportional grid. When that happens the group collapses instead
 * to its top-left member's own cell — always a real, non-overlapping slot — at
 * the cost of not reclaiming the members' scattered space. Adjacent groups (the
 * common case) keep their tight bounding box.
 */
import type { GsPos } from "./GridStackZone.svelte"

export type RenderUnit = {
	key: string
	box: { x: number; y: number; w: number; h: number }
	members: GsPos[]
}

type Box = { x: number; y: number; w: number; h: number }

function boxesOverlap(a: Box, b: Box): boolean {
	return (
		a.x < b.x + b.w &&
		a.x + a.w > b.x &&
		a.y < b.y + b.h &&
		a.y + a.h > b.y
	)
}

export function unitsOf(items: GsPos[]): RenderUnit[] {
	const groups = new Map<string, GsPos[]>()
	const units: RenderUnit[] = []
	for (const it of items) {
		if (it.group) {
			const arr = groups.get(it.group) ?? []
			arr.push(it)
			groups.set(it.group, arr)
		} else {
			units.push({
				key: it.id,
				box: { x: it.x, y: it.y, w: it.w, h: it.h },
				members: [it]
			})
		}
	}
	for (const [gid, members] of groups) {
		// Top-left first, so `members[0]` is a deterministic fallback cell and the
		// tab order reads top-to-bottom / left-to-right.
		members.sort((a, b) => a.y - b.y || a.x - b.x)
		const x = Math.min(...members.map((m) => m.x))
		const y = Math.min(...members.map((m) => m.y))
		const x2 = Math.max(...members.map((m) => m.x + m.w))
		const y2 = Math.max(...members.map((m) => m.y + m.h))
		units.push({ key: gid, box: { x, y, w: x2 - x, h: y2 - y }, members })
	}

	// Overlap guard: flag (against the ORIGINAL boxes) any multi-member unit whose
	// bounding box collides with another unit, then shrink each flagged group to
	// its top-left member's cell — guaranteed non-overlapping since it's a real
	// placed slot. A single-member unit is never a group, so it is never shrunk.
	const flagged = new Set<RenderUnit>()
	for (const u of units) {
		if (u.members.length < 2) continue
		if (units.some((o) => o !== u && boxesOverlap(u.box, o.box)))
			flagged.add(u)
	}
	for (const u of flagged) {
		const m = u.members[0]
		u.box = { x: m.x, y: m.y, w: m.w, h: m.h }
	}
	return units
}
