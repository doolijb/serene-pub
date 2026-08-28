import { describe, it, expect } from "vitest"
import { pack } from "./pack"
import { normalizeLayout, type PanelInstance, type Tier } from "./types"

/** Terse instance builder for the packer tests. */
function inst(
	id: string,
	opts: Partial<PanelInstance> & {
		role?: "primary" | "secondary"
		span?: number
	} = {}
): PanelInstance {
	const role = opts.role ?? "secondary"
	return {
		id,
		title: id,
		role,
		surface: { kind: "native", component: id },
		channels: [],
		layout: normalizeLayout(
			opts.span ? { span: { ideal: opts.span } } : undefined,
			role
		),
		active: opts.active ?? true,
		collapsed: opts.collapsed ?? false,
		drawered: opts.drawered ?? false,
		order: opts.order ?? 0,
		...(opts.src ? { src: opts.src } : {})
	}
}

const P = (over: Partial<PanelInstance> = {}) =>
	inst("log", { role: "primary", ...over })

describe("pack — the anchor guarantee", () => {
	it("always places the primary panel, spanning full height", () => {
		for (const tier of ["compact", "cozy", "roomy", "wide"] as Tier[]) {
			const r = pack(tier, [P(), inst("a"), inst("b")])
			const p = r.placements.get("log")!
			expect(p.location).toBe("grid")
			expect(p.col).toBe(1)
			expect(p.rowStart).toBe(1)
			expect(p.rowSpan).toBe(r.rows) // spans every row
		}
	})

	it("never sends primary to the drawer even when crowded", () => {
		const many = Array.from({ length: 8 }, (_, i) => inst("s" + i))
		const r = pack("compact", [P(), ...many])
		expect(r.placements.get("log")!.location).toBe("grid")
	})

	it("fills the whole width when it is the only grid panel", () => {
		// wide (4 tracks), conversation alone → spans all 4, no empty tracks.
		const r = pack("wide", [P()])
		expect(r.placements.get("log")!.colSpan).toBe(4)
		// A drawered secondary doesn't count as a grid panel either.
		const r2 = pack("wide", [P(), inst("d", { drawered: true })])
		expect(r2.placements.get("log")!.colSpan).toBe(4)
	})
})

describe("pack — cascading by tier", () => {
	it("compact: everything but primary cascades to the drawer", () => {
		const r = pack("compact", [P(), inst("a"), inst("b")])
		expect(r.tracks).toBe(1)
		expect(r.drawerIds.sort()).toEqual(["a", "b"])
		expect(r.placements.get("a")!.location).toBe("drawer")
	})

	it("cozy: one secondary column beside primary", () => {
		const r = pack("cozy", [P(), inst("a"), inst("b")])
		expect(r.tracks).toBe(2)
		// primary col 1 span 1; secondaries stack in col 2
		expect(r.placements.get("log")!.colSpan).toBe(1)
		expect(r.placements.get("a")!.col).toBe(2)
		expect(r.placements.get("b")!.col).toBe(2)
		expect(r.placements.get("a")!.rowStart).toBe(1)
		expect(r.placements.get("b")!.rowStart).toBe(2) // stacked
		expect(r.rows).toBe(2)
	})

	it("wide: primary widens to 2 and secondaries share the remaining 2 cols", () => {
		const r = pack("wide", [P(), inst("a"), inst("b"), inst("c")])
		expect(r.tracks).toBe(4)
		expect(r.placements.get("log")!.colSpan).toBe(2)
		// a,b on row 1 (cols 3,4), c wraps to row 2
		expect(r.placements.get("a")!.col).toBe(3)
		expect(r.placements.get("b")!.col).toBe(4)
		expect(r.placements.get("c")!.rowStart).toBe(2)
	})
})

describe("pack — spanning", () => {
	it("grants an ideal span when the secondary region is wide enough", () => {
		const r = pack("wide", [P(), inst("wideOne", { span: 2 })])
		// primary span 2, secondary region width 2 → wideOne gets span 2
		expect(r.placements.get("wideOne")!.colSpan).toBe(2)
	})

	it("clamps a span that exceeds the secondary region", () => {
		const r = pack("cozy", [P(), inst("greedy", { span: 3 })])
		// cozy: secondary width is 1, so a span-3 panel is clamped to 1
		expect(r.placements.get("greedy")!.colSpan).toBe(1)
	})
})

describe("pack — user intent", () => {
	it("honors an explicit drawer pin regardless of room", () => {
		const r = pack("wide", [P(), inst("pinned", { drawered: true })])
		expect(r.placements.get("pinned")!.location).toBe("drawer")
	})

	it("orders secondaries by `order` then id", () => {
		const r = pack("compact", [
			P(),
			inst("b", { order: 1 }),
			inst("a", { order: 0 })
		])
		expect(r.drawerIds).toEqual(["a", "b"])
	})

	it("ignores inactive panels entirely", () => {
		const r = pack("cozy", [P(), inst("ghost", { active: false })])
		expect(r.placements.has("ghost")).toBe(false)
	})
})

describe("pack — determinism", () => {
	it("is a pure function of its inputs", () => {
		const panels = [P(), inst("a", { order: 2 }), inst("b", { order: 1 })]
		const a = pack("roomy", panels)
		const b = pack("roomy", panels)
		expect([...a.placements.entries()]).toEqual([...b.placements.entries()])
	})
})
