import type { AtmosphereDefinition, Rgb } from "./types"
import { rgba } from "./palette"

/**
 * The atmospheres themselves — fourteen of them, in the order a picker would
 * list them.
 *
 * Each one is a closed piece of arithmetic over the frame it is given and the
 * theme it is handed. None reaches for the DOM at module scope (the one cache
 * below fills on first draw), so this file loads in a test runner as happily
 * as in a browser.
 */

/**
 * Pre-rendered radial gradients, keyed by the colour they were drawn in.
 *
 * A soft mote is a gradient fill, and filling sixty gradients a frame is the
 * expensive way to do it; drawing one image sixty times is not. The cache is
 * keyed on the colour so a theme change simply makes a new sprite and leaves
 * the old one for the next theme change back.
 */
const sprites = new Map<string, HTMLCanvasElement>()

function sprite(colour: Rgb, size = 48): HTMLCanvasElement {
	const key = `${rgba(colour)}|${size}`
	const cached = sprites.get(key)
	if (cached) return cached
	const canvas = document.createElement("canvas")
	canvas.width = canvas.height = size
	const ctx = canvas.getContext("2d")!
	const gradient = ctx.createRadialGradient(
		size / 2,
		size / 2,
		0,
		size / 2,
		size / 2,
		size / 2
	)
	gradient.addColorStop(0, rgba(colour, 0.95))
	gradient.addColorStop(0.35, rgba(colour, 0.35))
	gradient.addColorStop(1, rgba(colour, 0))
	ctx.fillStyle = gradient
	ctx.fillRect(0, 0, size, size)
	sprites.set(key, canvas)
	return canvas
}

/** The glyph rain's alphabet: half-width katakana, digits, operators. */
const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789<>/*+="

export const ATMOSPHERES: readonly AtmosphereDefinition[] = [
	{
		id: "core:atmosphere/rain",
		label: "Rain",
		kind: "canvas",
		still: "frame",
		particles: 200,
		blurb: "Slanted streaks at two depths; the near layer is heavier and faster.",
		init: ({ w, h, k, rnd }) => ({
			d: Array.from({ length: Math.round(40 + 160 * k) }, () => {
				const z = rnd()
				return {
					x: rnd() * (w + 120) - 60,
					y: rnd() * h,
					z,
					l: 9 + z * 18,
					v: 320 + z * 560,
					b: Math.min(2, Math.floor(z * 3))
				}
			})
		}),
		frame: (c, s, { w, h, dt, pal }) => {
			const ink = pal.dark ? pal.ink : pal.muted
			c.lineCap = "round"
			for (let b = 0; b < 3; b++) {
				c.strokeStyle = rgba(ink, 0.1 + 0.13 * b)
				c.lineWidth = 0.6 + 0.45 * b
				c.beginPath()
				for (const d of s.d) {
					if (d.b !== b) continue
					d.y += d.v * dt
					d.x -= d.v * dt * 0.14
					if (d.y > h + 20) {
						d.y = -30
						d.x = Math.random() * (w + 120) - 40
					}
					c.moveTo(d.x, d.y)
					c.lineTo(d.x + d.l * 0.14, d.y - d.l)
				}
				c.stroke()
			}
		}
	},
	{
		id: "core:atmosphere/snow",
		label: "Snow",
		kind: "canvas",
		still: "frame",
		particles: 150,
		blurb: "Flakes that sway as they fall; larger ones are nearer and brighter.",
		init: ({ w, h, k, rnd }) => ({
			f: Array.from({ length: Math.round(30 + 120 * k) }, () => {
				const r = 0.8 + rnd() * 2.2
				return {
					x: rnd() * w,
					y: rnd() * h,
					r,
					v: 14 + r * 13,
					ph: rnd() * 6.28,
					sw: 8 + rnd() * 18
				}
			})
		}),
		frame: (c, s, { w, h, dt, t, pal }) => {
			const ink = pal.dark ? pal.ink : pal.muted
			for (const f of s.f) {
				f.y += f.v * dt
				f.x += Math.sin(t * 0.6 + f.ph) * f.sw * dt
				if (f.y > h + 4) {
					f.y = -4
					f.x = Math.random() * w
				}
				if (f.x < -4) f.x = w + 4
				if (f.x > w + 4) f.x = -4
				c.fillStyle = rgba(ink, 0.3 + 0.55 * (f.r / 3))
				c.beginPath()
				c.arc(f.x, f.y, f.r, 0, 6.283)
				c.fill()
			}
		}
	},
	{
		id: "core:atmosphere/motes",
		label: "Lamplight",
		kind: "canvas",
		still: "frame",
		particles: 60,
		blurb: "Soft motes of lamp gold rising and breathing. The house atmosphere.",
		init: ({ w, h, k, rnd }) => ({
			m: Array.from({ length: Math.round(12 + 48 * k) }, () => ({
				x: rnd() * w,
				y: rnd() * h,
				r: 8 + rnd() * 26,
				v: 5 + rnd() * 13,
				ph: rnd() * 6.28,
				a: 0.35 + rnd() * 0.65
			}))
		}),
		frame: (c, s, { w, h, dt, t, pal }) => {
			const sp = sprite(pal.primary)
			for (const m of s.m) {
				m.y -= m.v * dt
				m.x += Math.sin(t * 0.35 + m.ph) * 7 * dt
				if (m.y < -m.r) {
					m.y = h + m.r
					m.x = Math.random() * w
				}
				c.globalAlpha =
					m.a *
					(0.55 + 0.45 * Math.sin(t * 1.1 + m.ph)) *
					(pal.dark ? 1 : 0.8)
				c.drawImage(sp, m.x - m.r / 2, m.y - m.r / 2, m.r, m.r)
			}
			c.globalAlpha = 1
		}
	},
	{
		id: "core:atmosphere/mist",
		label: "Mist",
		kind: "css",
		cls: "sp-atmo-mist",
		still: "frame",
		blurb: "Three blurred banks drifting over a minute. Pure CSS.",
		html: "<div></div><div></div><div></div>"
	},
	{
		id: "core:atmosphere/aurora",
		label: "Aurora",
		kind: "css",
		cls: "sp-atmo-aurora",
		still: "frame",
		blurb: "Blurred bands of secondary and tertiary, screened over the ground, swaying.",
		html: "<div></div><div></div><div></div>"
	},
	{
		id: "core:atmosphere/drift",
		label: "Hue drift",
		kind: "css",
		cls: "sp-atmo-drift",
		still: "frame",
		blurb: "The ground itself walks around the hue wheel once every seventy seconds. Colour shifting, kept in the theme’s lightness.",
		html: "<div></div>"
	},
	{
		id: "core:atmosphere/glyphs",
		label: "Glyph rain",
		kind: "canvas",
		still: "frame",
		warm: 90,
		clear: false,
		particles: 120,
		blurb: "Falling columns of glyphs in tertiary teal with a bright head. Trails fade toward transparent, so it layers over an image.",
		init: ({ w, h, k, rnd }) => {
			const cw = 14
			const n = Math.floor(w / cw)
			return {
				cw,
				cols: Array.from({ length: n }, (_, i) => ({
					x: i * cw + 2,
					y: -rnd() * h * 2,
					v: 70 + rnd() * 170,
					on: rnd() < 0.25 + 0.75 * k,
					row: -1
				}))
			}
		},
		frame: (c, s, { w, h, dt, pal }) => {
			// Fading with destination-out rather than a translucent fill keeps
			// the layer transparent, so whatever is behind it still shows.
			c.globalCompositeOperation = "destination-out"
			c.fillStyle = "rgba(0,0,0,.09)"
			c.fillRect(0, 0, w, h)
			c.globalCompositeOperation = "source-over"
			c.font = '13px "Fira Mono", monospace'
			for (const col of s.cols) {
				if (!col.on) continue
				col.y += col.v * dt
				const row = Math.floor(col.y / 16)
				if (row !== col.row) {
					col.row = row
					const y = row * 16
					if (y > 0 && y < h + 16) {
						c.fillStyle = rgba(
							pal.dark ? pal.ink : pal.tertiary,
							0.9
						)
						c.fillText(
							GLYPHS[(Math.random() * GLYPHS.length) | 0],
							col.x,
							y
						)
						c.fillStyle = rgba(pal.tertiary, 0.8)
						c.fillText(
							GLYPHS[(Math.random() * GLYPHS.length) | 0],
							col.x,
							y - 16
						)
					}
				}
				if (col.y > h + 200) {
					col.y = -Math.random() * h
					col.row = -1
					col.on = Math.random() < 0.8
				}
			}
		}
	},
	{
		id: "core:atmosphere/crt",
		label: "Scanlines",
		kind: "css",
		cls: "sp-atmo-crt",
		still: "frame",
		blurb: "A CRT: scanlines, a slow sweep, a stepped flicker and a vignette in the deep stop.",
		html: '<div class="lines"></div><div class="sweep"></div><div class="vig"></div>'
	},
	{
		id: "core:atmosphere/horizon",
		label: "Horizon",
		kind: "css",
		cls: "sp-atmo-horizon",
		still: "frame",
		blurb: "A perspective grid in primary scrolling toward a secondary glow. Pure CSS, one transform.",
		html: '<div class="glow"></div><div class="line"></div><div class="gridp"></div>'
	},
	{
		id: "core:atmosphere/stars",
		label: "Starfield",
		kind: "canvas",
		still: "frame",
		particles: 260,
		blurb: "Points that twinkle on their own phase and drift a few pixels a second. One in seven is gold.",
		init: ({ w, h, k, rnd }) => ({
			s: Array.from({ length: Math.round(60 + 200 * k) }, () => ({
				x: rnd() * w,
				y: rnd() * h,
				r: 0.4 + rnd() * 1.3,
				ph: rnd() * 6.28,
				sp: 0.4 + rnd() * 1.6,
				g: rnd() < 0.14
			}))
		}),
		frame: (c, s, { w, dt, t, pal }) => {
			const ink = pal.dark ? pal.ink : pal.quiet
			for (const st of s.s) {
				st.x -= 2.5 * dt * st.r
				if (st.x < -2) st.x = w + 2
				const a =
					0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * st.sp + st.ph))
				c.fillStyle = rgba(st.g ? pal.primary : ink, a)
				c.beginPath()
				c.arc(st.x, st.y, st.r, 0, 6.283)
				c.fill()
			}
		}
	},
	{
		id: "core:atmosphere/web",
		label: "Constellation",
		kind: "canvas",
		still: "frame",
		particles: 60,
		blurb: "Wandering nodes that link when near. A nod to the knowledge graph.",
		init: ({ w, h, k, rnd }) => ({
			n: Array.from({ length: Math.round(12 + 48 * k) }, () => ({
				x: rnd() * w,
				y: rnd() * h,
				vx: (rnd() - 0.5) * 22,
				vy: (rnd() - 0.5) * 22
			}))
		}),
		frame: (c, s, { w, h, dt, pal }) => {
			const R = 130
			const line = pal.dark ? pal.quiet : pal.muted
			for (const n of s.n) {
				n.x += n.vx * dt
				n.y += n.vy * dt
				if (n.x < 0 || n.x > w) n.vx *= -1
				if (n.y < 0 || n.y > h) n.vy *= -1
			}
			c.lineWidth = 1
			// Every pair, which is why the node count is capped at sixty.
			for (let i = 0; i < s.n.length; i++) {
				for (let j = i + 1; j < s.n.length; j++) {
					const a = s.n[i]
					const b = s.n[j]
					const dx = a.x - b.x
					const dy = a.y - b.y
					const d = Math.hypot(dx, dy)
					if (d < R) {
						c.strokeStyle = rgba(line, (1 - d / R) * 0.45)
						c.beginPath()
						c.moveTo(a.x, a.y)
						c.lineTo(b.x, b.y)
						c.stroke()
					}
				}
			}
			c.fillStyle = rgba(pal.primary, 0.9)
			for (const n of s.n) {
				c.beginPath()
				c.arc(n.x, n.y, 1.7, 0, 6.283)
				c.fill()
			}
		}
	},
	{
		id: "core:atmosphere/paper",
		label: "Paper",
		kind: "css",
		cls: "sp-atmo-paper",
		still: "static",
		blurb: "Fractal-noise grain overlaid on the ground with a warm wash. Nearly static: the novel’s page.",
		html: '<div class="grain"></div><div class="warm"></div>'
	},
	{
		id: "core:atmosphere/candle",
		label: "Candlelight",
		kind: "css",
		cls: "sp-atmo-candle",
		still: "frame",
		blurb: "One warm light low on the left, flickering on an uneven beat, with a slow breath over the room.",
		html: '<div class="flame"></div><div class="breath"></div>'
	},
	{
		id: "core:atmosphere/tide",
		label: "Tide",
		kind: "canvas",
		still: "frame",
		particles: 3,
		blurb: "Three translucent sine bands in tertiary, secondary and primary, out of phase. Three fills a frame.",
		init: () => ({}),
		frame: (c, _s, { w, h, t, k, pal }) => {
			const cols = [pal.tertiary, pal.secondary, pal.primary]
			for (let i = 0; i < 3; i++) {
				const y0 = h * (0.66 + i * 0.1)
				const amp = (9 + 6 * i) * (0.5 + k)
				const wl = 170 + 70 * i
				const sp = 0.55 + 0.2 * i
				c.fillStyle = rgba(cols[i], 0.09 + 0.03 * k)
				c.beginPath()
				c.moveTo(0, h)
				for (let x = 0; x <= w + 8; x += 8) {
					c.lineTo(
						x,
						y0 +
							Math.sin((x / wl) * 6.283 + t * sp + i) * amp +
							Math.sin(x / (wl * 0.37) + t * sp * 1.7) * amp * 0.3
					)
				}
				c.lineTo(w, h)
				c.closePath()
				c.fill()
			}
		}
	}
]

/** One atmosphere, chosen uniformly. `rnd` is injectable so tests can aim it. */
export function pickRandom(
	rnd: () => number = Math.random
): AtmosphereDefinition {
	const i = Math.min(
		ATMOSPHERES.length - 1,
		Math.max(0, Math.floor(rnd() * ATMOSPHERES.length))
	)
	return ATMOSPHERES[i]
}
