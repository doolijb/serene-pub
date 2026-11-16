package tray

import (
	"bytes"
	"image/color"
	"image/png"
	"testing"

	"github.com/doolijb/serene-pub/launcher/assets"
)

// The tray library keeps byte(v) of each 16-bit premultiplied channel. The
// icon handed to it must come out with the artwork's own colours.
func TestTrayPNGSurvivesTheLowByteConversion(t *testing.T) {
	src, err := png.Decode(bytes.NewReader(assets.IconPNG))
	if err != nil {
		t.Fatal(err)
	}
	got, err := png.Decode(bytes.NewReader(trayPNG(assets.IconPNG)))
	if err != nil {
		t.Fatal(err)
	}
	if got.Bounds() != src.Bounds() {
		t.Fatalf("bounds %v, want %v", got.Bounds(), src.Bounds())
	}
	opaque := 0
	b := src.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			want := color.NRGBAModel.Convert(src.At(x, y)).(color.NRGBA)
			r, g, bl, a := got.At(x, y).RGBA()
			pr, pg, pb, pa := byte(r), byte(g), byte(bl), byte(a)
			if want.A < 128 {
				if pa != 0 || pr != 0 || pg != 0 || pb != 0 {
					t.Fatalf("(%d,%d) should be clear, got %d %d %d %d", x, y, pa, pr, pg, pb)
				}
				continue
			}
			opaque++
			if pa != 255 || pr != want.R || pg != want.G || pb != want.B {
				t.Fatalf("(%d,%d) got a=%d rgb=%d,%d,%d, want rgb=%d,%d,%d", x, y, pa, pr, pg, pb, want.R, want.G, want.B)
			}
		}
	}
	if opaque == 0 {
		t.Fatal("the icon has no opaque pixel")
	}
}

func TestTrayPNGKeepsWhatItCannotDecode(t *testing.T) {
	junk := []byte("not a png")
	if !bytes.Equal(trayPNG(junk), junk) {
		t.Fatal("undecodable input must be returned unchanged")
	}
}
