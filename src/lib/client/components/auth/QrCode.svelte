<script lang="ts">
	/**
	 * A QR code, rendered locally as inline SVG.
	 *
	 * Generated in-process on purpose. The obvious shortcut — a hosted QR
	 * service like `chart.googleapis.com/chart?cht=qr&chl=<data>` — would put
	 * the encoded value, which here is either a TOTP secret or an invite token,
	 * into a third party's URL logs. Both are bearer credentials.
	 *
	 * Inline SVG rather than an <img src>, for the same reason: an image URL
	 * lands in browser history, referrer headers and access logs.
	 */
	import qrcode from "qrcode-generator"

	let {
		value,
		size = 200,
		label
	}: { value: string; size?: number; label: string } = $props()

	const svg = $derived.by(() => {
		// Type 0 = auto-select the smallest version that fits; "M" tolerates
		// ~15% damage, which is the usual choice for a screen-displayed code.
		const qr = qrcode(0, "M")
		qr.addData(value)
		qr.make()
		const count = qr.getModuleCount()
		const parts: string[] = []
		for (let r = 0; r < count; r++) {
			for (let c = 0; c < count; c++) {
				if (qr.isDark(r, c)) parts.push(`M${c},${r}h1v1h-1z`)
			}
		}
		return { count, path: parts.join("") }
	})
</script>

<svg
	viewBox="0 0 {svg.count} {svg.count}"
	width={size}
	height={size}
	role="img"
	aria-label={label}
	class="rounded bg-white p-2"
	shape-rendering="crispEdges"
>
	<path d={svg.path} fill="#000" />
</svg>
