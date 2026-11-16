package tray

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
)

// trayPNG returns the icon with every pixel fully opaque or fully clear.
//
// fyne.io/systray turns the PNG into the StatusNotifierItem pixmap by keeping
// the low byte of each 16-bit alpha-premultiplied channel. That byte is the
// channel's value only where alpha is 0 or 255; anywhere else it is noise, so
// an icon whose artwork is "almost opaque" (alpha 250–254) shows in the wrong
// colours. Snapping alpha makes the conversion exact. An icon that cannot be
// decoded is returned as it is.
func trayPNG(src []byte) []byte {
	img, err := png.Decode(bytes.NewReader(src))
	if err != nil {
		return src
	}
	b := img.Bounds()
	out := image.NewNRGBA(b)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			c := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
			if c.A >= 128 {
				c.A = 255
			} else {
				c = color.NRGBA{}
			}
			out.SetNRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return src
	}
	return buf.Bytes()
}
