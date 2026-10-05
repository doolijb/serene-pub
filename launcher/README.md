# Serene Pub launcher

The desktop launcher (`serene-pub` / `Serene Pub.exe` / `Serene Pub.app/Contents/MacOS/serene-pub`)
and the window helper (`serene-pub-window`). Contributor notes only — user docs live in
`docs/install.md` and `docs/updating.md`. The behaviour is fixed by the CONTRACT (§C1–C13) of the
desktop-distribution plan; read it before changing anything here.

What it does: takes `<dataDir>/launcher.lock`, attaches to a running server (via
`<dataDir>/runtime.json` + `GET /api/launcher/health`) or starts one (`app/node app/build/index.js`,
detached, output in `<dataDir>/logs/server.log`), shows the tray, opens the client (window helper
or browser), and applies a staged update when Node exits with `APPLY` + `READY.json` in the update
staging dir. Quit = `POST /api/launcher/shutdown`; it never SIGKILLs Node.

## Layout

| Path | What |
|---|---|
| `cmd/serene-pub/` | launcher `main` (flags `--attach`, `--after-update=<tag>`, `--no-open`, `--version`), `versioninfo.json` |
| `cmd/serene-pub-window/` | window helper; the real webview only with `-tags window` (stub exits 3 otherwise) |
| `internal/paths` | install root, swap unit, update staging, data dir (= env-paths + `planEnvLoad` precedence) |
| `internal/envfile` | dotenv parse + the only allowed write (`AUTO_OPEN_CLIENT`, `DEFAULT_CLIENT` in `<dataDir>/.env`) |
| `internal/runtimefile`, `internal/control` | runtime file reader; control-route client |
| `internal/proc` | detached spawn, pid liveness, SIGTERM, `launcher.lock` |
| `internal/update` | marker validation, the swap state machine, health gate, rollback, self-replace, AppImage stub |
| `internal/supervisor` | attach-or-start, exit codes 0/75/76, open client, Quit |
| `internal/tray`, `internal/window`, `internal/opener` | tray menu (fyne.io/systray), helper management, OS open |
| `internal/logx`, `internal/launcherstate`, `internal/register` | `launcher.log` rotation, `launcher.json`, phase-2 stub |
| `assets/` | `icon.ico` + `icon.png`, generated from `../static/icon-x*.png` by `go generate ./assets` |
| `pkgconfig/webkit2gtk-4.0.pc` | alias: `webview_go` hard-codes webkit2gtk-4.0; Ubuntu ships 4.1 |

## Build

```sh
node launcher/build.mjs --target linux-x64 --version 0.6.1 --channel portable --commit <sha> --out dist/launcher/linux-x64
```

Targets `linux-x64`, `windows-x64`, `macos-x64`, `macos-arm64`; outputs are fixed (§C7). The
launcher is `CGO_ENABLED=0` on Linux/Windows (static; cross-builds from any host) and cgo on macOS.
The window helper always needs cgo **on its own OS**: Linux `libgtk-3-dev libwebkit2gtk-4.1-dev`,
Windows a MinGW-w64 gcc, macOS Xcode CLT. On a box without them pass `--no-window` (release CI
must not). Windows resources (icon, version) come from `go tool goversioninfo` (pinned in
`go.mod`) for both binaries; the `.syso` is generated and deleted per build. The helper's icon
is also its `IDI_APPLICATION`, which webview loads for the window and taskbar.

On Linux the helper names itself `serene-pub` (WM_CLASS, matching the desktop entry), gives the
window `build/client/icon-x256.png`, and points WebKit at a fontconfig file without WOFF fonts
(`~/.cache/serene-pub/webkit-fontconfig.conf`): WebKitGTK 2.52 hangs on system WOFF fonts, such
as Zorin OS's OpenDyslexic, and the window stays empty. See `cmd/serene-pub-window/fontconfig_linux.go`.

## Test

```sh
cd launcher && go vet ./... && go test ./...
```

Tests run on temp dirs with fakes — no network, no GUI, no real Node. The state-machine tests
(`internal/update/machine_test.go`) cover fresh / staged / mid-extract / every `SWAP.json` phase /
rollback / migrating / self-replace / macOS re-sign / AppImage / pre-release. `internal/tray` and
the helper's `-tags window` file are compile-only here; on macOS the tray needs cgo.

To run the launcher by hand, put the binary in a scratch install root (`<root>/serene-pub` +
`<root>/app/…`) and set `SERENE_PUB_DATA_DIR` **in your shell** to a scratch dir — never point it
at a real data dir. The launcher itself never sets `SERENE_PUB_DATA_DIR`.
