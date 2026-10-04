//go:build ignore

// Command gen writes the launcher's icon assets from the app's source PNGs in
// ../static, in pure Go (no ImageMagick):
//
//   - icon.ico  — Windows icon (16, 32, 48, 256 px PNG-compressed entries),
//     used by the tray on Windows and embedded in Serene Pub.exe by goversioninfo.
//   - icon.png  — the 32 px PNG the tray uses on Linux and macOS.
//
// Run with `go generate ./assets` from launcher/. The outputs are committed so
// a plain `go build` never needs the generator.
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image/png"
	"os"
	"path/filepath"
)

func main() {
	src := filepath.Join("..", "..", "static")
	sizes := []int{16, 32, 48, 256}
	var images [][]byte
	for _, size := range sizes {
		data, err := os.ReadFile(filepath.Join(src, fmt.Sprintf("icon-x%d.png", size)))
		must(err)
		cfg, err := png.DecodeConfig(bytes.NewReader(data))
		must(err)
		if cfg.Width != size || cfg.Height != size {
			must(fmt.Errorf("icon-x%d.png is %dx%d", size, cfg.Width, cfg.Height))
		}
		images = append(images, data)
	}

	var ico bytes.Buffer
	// ICONDIR: reserved, type 1 (icon), count.
	must(binary.Write(&ico, binary.LittleEndian, [3]uint16{0, 1, uint16(len(images))}))
	offset := 6 + 16*len(images)
	for i, data := range images {
		dim := byte(sizes[i])
		if sizes[i] >= 256 {
			dim = 0 // 0 means 256 in an ICONDIRENTRY
		}
		entry := struct {
			W, H, Colors, Reserved byte
			Planes, BitCount       uint16
			Size, Offset           uint32
		}{dim, dim, 0, 0, 1, 32, uint32(len(data)), uint32(offset)}
		must(binary.Write(&ico, binary.LittleEndian, entry))
		offset += len(data)
	}
	for _, data := range images {
		ico.Write(data)
	}
	must(os.WriteFile("icon.ico", ico.Bytes(), 0o644))
	must(os.WriteFile("icon.png", images[1], 0o644))
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "gen:", err)
		os.Exit(1)
	}
}
