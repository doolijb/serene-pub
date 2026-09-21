import type { AtmosphereDefinition, AtmospherePalette } from "./types"
import { resolvePalette, rgba } from "./palette"

/**
 * The host that mounts an atmosphere into an element, and the one animation
 * loop every canvas atmosphere on the page shares.
 *
 * One loop, not one per layer: several hosts on a screen (a picker's tiles,
 * say) would otherwise each hold their own `requestAnimationFrame`, and a
 * browser hands those out in the order they were asked for rather than as one
 * frame's work. The loop starts when the first host registers and is cancelled
 * when the last one leaves, so a page with no atmosphere costs nothing.
 */

const hosts = new Set<AtmosphereHost>()
let frameHandle = 0
let last = 0

function loop(now: number) {
	// Clamped, so coming back to a backgrounded tab does not hand every
	// effect a multi-second step and teleport its particles.
	const dt = Math.min(0.05, (now - last) / 1000)
	last = now
	if (!document.hidden) {
		const t = now / 1000
		for (const host of hosts) host.tick(dt, t)
	}
	frameHandle = requestAnimationFrame(loop)
}

function startLoop() {
	if (frameHandle) return
	last = performance.now()
	frameHandle = requestAnimationFrame(loop)
}

function stopLoop() {
	if (!frameHandle) return
	cancelAnimationFrame(frameHandle)
	frameHandle = 0
}

export interface AtmosphereHostOptions {
	/** Ceiling on the device pixel ratio the canvas is drawn at. */
	dpr?: number
}

export class AtmosphereHost {
	private readonly host: HTMLElement
	private readonly dprMax: number
	private readonly resizeObserver: ResizeObserver
	private definition: AtmosphereDefinition | null = null
	private canvas: HTMLCanvasElement | null = null
	private ctx: CanvasRenderingContext2D | null = null
	private dom: HTMLDivElement | null = null
	private state: unknown = null
	private pal: AtmospherePalette
	private k = 0.55
	private still = false
	/** A frame is owed — after a resize, a theme change or a fresh mount. */
	private need = true
	private w = 1
	private h = 1

	constructor(host: HTMLElement, { dpr = 1.5 }: AtmosphereHostOptions = {}) {
		this.host = host
		this.dprMax = dpr
		this.pal = resolvePalette()
		this.applyPalette()
		this.setIntensity(this.k)
		this.resizeObserver = new ResizeObserver(() => this.resize())
		this.resizeObserver.observe(host)
		hosts.add(this)
		startLoop()
	}

	/** Mount an atmosphere, replacing whatever was there. */
	set(definition: AtmosphereDefinition | null) {
		this.canvas?.remove()
		this.dom?.remove()
		this.canvas = null
		this.ctx = null
		this.dom = null
		this.state = null
		this.definition = definition
		if (!definition) return
		if (definition.kind === "canvas") {
			const canvas = document.createElement("canvas")
			canvas.className = "fx-canvas"
			this.host.appendChild(canvas)
			this.canvas = canvas
			this.ctx = canvas.getContext("2d")
			this.resize()
		} else {
			const dom = document.createElement("div")
			dom.className = `fx-dom ${definition.cls}`
			// Static markup from `definitions.ts` — a handful of empty divs,
			// never anything a user or a plugin wrote.
			dom.innerHTML = definition.html
			this.host.appendChild(dom)
			this.dom = dom
		}
		this.need = true
	}

	/** How much of the effect there is: density, opacity, count. 0.12–1.4. */
	setIntensity(k: number) {
		this.k = Math.min(1.4, Math.max(0.12, k))
		this.host.style.setProperty("--sp-k", String(this.k))
		// The count is baked into the state at init, so it has to be rebuilt.
		this.state = null
		this.need = true
	}

	/**
	 * Freeze on one frame (reduced motion). CSS atmospheres are frozen by the
	 * global `prefers-reduced-motion` rule in `app.css` instead.
	 */
	setStill(still: boolean) {
		this.still = still
		this.need = true
	}

	/** Re-read the theme's stops — call it when `data-theme`/`data-mode` move. */
	refreshPalette() {
		this.pal = resolvePalette()
		this.applyPalette()
		this.need = true
	}

	/** Unmount: the element is left as it was found. */
	destroy() {
		hosts.delete(this)
		if (!hosts.size) stopLoop()
		this.resizeObserver.disconnect()
		this.canvas?.remove()
		this.dom?.remove()
		this.canvas = null
		this.ctx = null
		this.dom = null
		this.definition = null
		this.state = null
	}

	/** Called by the shared loop; not part of the public surface. */
	tick(dt: number, t: number) {
		const definition = this.definition
		const ctx = this.ctx
		if (!definition || definition.kind !== "canvas" || !ctx) return
		if (!this.need && this.still) return
		if (!this.state) {
			this.state = definition.init({
				w: this.w,
				h: this.h,
				k: this.k,
				rnd: Math.random
			})
		}
		const env = {
			w: this.w,
			h: this.h,
			k: this.k,
			t,
			dt,
			pal: this.pal
		}
		// An effect that builds up a trail (glyph rain) has nothing to show on
		// its first frame, so a still layer renders its warm-up in one go and
		// then stops on the result.
		const runs = this.need && this.still ? (definition.warm ?? 1) : 1
		for (let i = 0; i < runs; i++) {
			if (definition.clear !== false) ctx.clearRect(0, 0, this.w, this.h)
			env.dt = 1 / 60
			env.t = t + i / 60
			if (i === runs - 1 && !this.still) env.dt = dt
			definition.frame(ctx, this.state, env)
		}
		this.need = false
	}

	private resize() {
		const rect = this.host.getBoundingClientRect()
		this.w = Math.max(1, Math.round(rect.width))
		this.h = Math.max(1, Math.round(rect.height))
		if (!this.canvas || !this.ctx) return
		// Capped: a 3x phone screen costs nine times the fill rate for an
		// effect that is blurred, translucent or both.
		const dpr = Math.min(window.devicePixelRatio || 1, this.dprMax)
		this.canvas.width = Math.round(this.w * dpr)
		this.canvas.height = Math.round(this.h * dpr)
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		this.state = null
		this.need = true
	}

	/**
	 * The theme, in the shape a CSS atmosphere can read. Canvas effects get
	 * the same stops through `env.pal` instead.
	 */
	private applyPalette() {
		const style = this.host.style
		const pal = this.pal
		style.setProperty("--sp-fx1", rgba(pal.primary))
		style.setProperty("--sp-fx2", rgba(pal.secondary))
		style.setProperty("--sp-fx3", rgba(pal.tertiary))
		style.setProperty("--sp-fxink", rgba(pal.dark ? pal.ink : pal.muted))
		style.setProperty("--sp-ground", rgba(pal.page))
		style.setProperty("--sp-deep", rgba(pal.deep))
		// Screening light over a dark ground brightens; over a light one it
		// does nothing, so a light theme multiplies instead.
		style.setProperty("--sp-blend", pal.dark ? "screen" : "multiply")
		style.setProperty("--sp-blend2", pal.dark ? "overlay" : "multiply")
	}
}
