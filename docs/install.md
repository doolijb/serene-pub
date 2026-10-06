# Install Serene Pub

Download Serene Pub, double-click it, and it opens. There's nothing else to install first.

_Written for Serene Pub 0.6. This is step 2 of Start here._

:::note By the end of this page
Serene Pub is running on your computer (or phone) and its welcome screen is open in front of you.
:::

:::note You'll need
- A Windows, macOS or Linux computer, or a 64-bit Android phone running Android 8 or newer.
- Some free disk space. The app itself is modest; models you download later are bigger, often several GB each.
- An internet connection for the download.
:::

Pick your system below and follow only that section. Each one ends with the same check.

## Windows

1. Go to the [Serene Pub downloads page](https://github.com/doolijb/serene-pub/releases) and download the **Windows** `.zip` file from the newest release.
2. Find the file in your **Downloads** folder, right-click it and choose **Extract All…**. Pick somewhere easy to find, such as your **Documents** folder. Don't skip this: opened straight from the `.zip`, Windows shows only part of the folder and the app can't start.
3. Open the extracted `serene-pub` folder and double-click **Serene Pub** (`Serene Pub.exe`).
4. Windows may show **Windows protected your PC**. Click **More info**, then **Run anyway**. Serene Pub isn't signed with a paid certificate, so Windows doesn't recognise it yet; you only see this the first time.
5. A Serene Pub icon appears in the system tray, at the bottom right of the taskbar (click the **^** arrow if it's hidden there), and after a few seconds Serene Pub opens in its own window.

<!-- SHOT: the Windows tray icon with its menu open, and the Serene Pub window beside it -->

Skip ahead to [Check that it worked](#check-that-it-worked).

## macOS

1. Go to the [Serene Pub downloads page](https://github.com/doolijb/serene-pub/releases) and download the **macOS** `.zip` from the newest release. Choose the one ending `macos-arm64` if your Mac has an Apple chip (M1, M2, M3 or newer), and `macos-x64` if it has an Intel chip (Apple menu → **About This Mac** tells you which).
2. Double-click the `.zip` in your **Downloads** folder to unpack it. Open the `serene-pub` folder it makes and drag **Serene Pub** into your **Applications** folder (or keep the whole folder somewhere permanent, such as **Documents**).
3. Double-click **Serene Pub**. The first time, macOS refuses: it says Apple can't check the app for malicious software, because Serene Pub isn't registered with Apple. Click **Done** (not **Move to Trash**).
4. Open **System Settings** → **Privacy & Security**, scroll down to the message about Serene Pub, and click **Open Anyway**. Confirm with your password and click **Open Anyway** once more.
5. A Serene Pub icon appears in the menu bar at the top right of the screen, and after a few seconds Serene Pub opens in its own window.

You only unblock it once. Updates installed from inside Serene Pub aren't blocked again, because macOS only checks files that arrive through a browser download.

:::tip Prefer Terminal?
Instead of steps 3 and 4, run this once, with the path to wherever you put the app, then double-click it:

```bash
xattr -dr com.apple.quarantine "/Applications/Serene Pub.app"
```
:::

:::note Intel Macs
Everything works on Intel Macs, including the built-in *local* models for memory (embeddings) and for spotting names (named entities). On an Intel Mac they run on an older version of the engine behind them, because newer versions no longer support that chip. You won't notice a difference.
:::

Skip ahead to [Check that it worked](#check-that-it-worked).

## Linux

1. Go to the [Serene Pub downloads page](https://github.com/doolijb/serene-pub/releases) and download the **Linux** `.zip` from the newest release.
2. Extract it somewhere permanent, such as your home folder.
3. Open the extracted `serene-pub` folder and double-click **serene-pub**. If your file manager opens it as a file instead of running it, right-click it and choose **Run as a Program** (the wording varies between desktops), or run `./serene-pub` in a terminal in that folder.
4. A Serene Pub icon appears in your panel's tray area, and after a few seconds Serene Pub opens in its own window.

Want Serene Pub in your applications menu? Run `install-desktop-shortcut.sh` from the same folder once (again if you move the folder).

:::note No tray icon, or a browser tab instead of a window?
- **No tray icon.** Some desktops, plain GNOME among them, show tray icons only with the *AppIndicator* extension (Ubuntu has it on already). Serene Pub still starts and opens without it; install the extension to get the icon and its **Quit** item.
- **A browser tab instead of a window.** The window needs WebKitGTK (`libwebkit2gtk-4.1`), which most desktops already have. Without it Serene Pub opens in your browser instead, which works just the same.
:::

Skip ahead to [Check that it worked](#check-that-it-worked).

## Android

1. On your phone, open the [Serene Pub downloads page](https://github.com/doolijb/serene-pub/releases) and download the `.apk` file from the newest release.
2. Tap the downloaded file. Android asks whether your browser may install apps; tap **Settings**, turn on **Allow from this source**, and go back.
3. Tap **Install**. On the newest Android versions you may see a notice about the app being built for an older version of Android. That's expected: install anyway.
4. Open **Serene Pub** from your app drawer. The first launch takes a little longer while it unpacks.

:::note On a phone, the model runs elsewhere
The Android app is a complete Serene Pub, but a phone can't run an AI model itself. In step 3 you'll connect to an online service, or to a model running on a computer on your home network. See [Android app](./android.md) for the full list of differences.
:::

## Check that it worked

:::tip You should see
A page headed **Welcome to Serene Pub**, with a **Get started** button. This is the setup wizard, which walks you through the next steps.
:::

<!-- SHOT: the welcome step of the setup wizard -->

Stop here for now, or carry straight on: the wizard's next step is choosing a model, which is exactly what the [next page](./connect-a-model.md) explains.

:::warning If this didn't work
- **The tray icon appeared but nothing opened.** The first start can take a little while. Click the tray icon to open Serene Pub; if it still doesn't open, choose **Open Browser** from the icon's menu, or open your browser at `http://localhost:3000`.
- **The tray icon says Serene Pub stopped.** Choose **View Logs** from its menu. `server.log` holds what the app printed before it stopped; it's the most useful thing to include when you ask for help. Choose **Start** to try again.
- **No tray icon on Windows.** When Windows can't show the icon, Serene Pub starts anyway after about five seconds. With no **Quit** to choose, closing the Serene Pub window stops it, and `launcher.log` in the `logs` folder of your [data folder](./troubleshooting.md#where-your-data-is) says `tray unavailable`.
- **Nothing happened at all.** Start it from a terminal so you can read why: see [Running without the launcher](#running-without-the-launcher-servers-troubleshooting).
- **"Address already in use" or "port 3000".** Another program is already using that address. Close it, or change the port as described in [Environment variables](./environment-variables.md).
- **A page says the database won't open.** Serene Pub started but couldn't read your saved data. That page can put a backup back; see [Database won't open](./troubleshooting.md#database-wont-open).
- Still stuck? Ask in [Discord](https://discord.gg/3kUx3MDcSa) or [open an issue](https://github.com/doolijb/serene-pub/issues), and include the last lines of `server.log`.
:::

## Everyday use

- **Starting it again.** Double-click **Serene Pub**, as in step 3 of your platform. Your characters and sessions are all still there. Starting it while it's already running just opens it again.
- **Window or browser.** Click the tray icon to open Serene Pub the usual way. Its menu also has **Open Window** and **Open Browser**, and **Default: Window / Browser** chooses which one a click and each start use. **Open on start** turns off opening anything when Serene Pub starts.
- **Stopping it.** Choose **Quit** from the tray icon's menu. Closing the window or browser tab doesn't stop Serene Pub: it keeps running in the tray so phones and other devices can still reach it. On Android, close the app from the recent-apps screen.
- **Using it from your phone.** While Serene Pub runs on your computer, any phone or tablet on the same Wi-Fi can open it too, at `http://` followed by your computer's local address and `:3000` (for example `http://192.168.1.42:3000`). To find that address: on Windows run `ipconfig` in a Command Prompt and look for **IPv4 Address**; on macOS run `ipconfig getifaddr en0` in Terminal; on Linux run `hostname -I`. Anyone on that Wi-Fi can do the same, so if you share the network with people you don't want in your pub, turn on [user accounts](./users-and-accounts.md) first. [Hosting](./hosting.md) covers reaching it from further away.

## Going further

### Updating to a new version

When a new release is out, an administrator sees it in **Admin › Updates**, which downloads it and restarts Serene Pub on the new version. If the new version doesn't start, Serene Pub puts the old one back by itself. [Updating](./updating.md) explains the details.

You can also update by hand: download the new release and extract it over your existing `serene-pub` folder, replacing files when asked (on macOS, replace **Serene Pub** in your Applications folder). Quit Serene Pub first. Your characters, sessions and settings are not inside that folder, so an update never touches them, and Serene Pub backs up your data by itself before a new version changes it.

Updating from Serene Pub 0.5? Read [Upgrading from 0.5](./upgrading-from-0.5.md) first: a few things carry over differently.

### Where your data lives

Everything you make is saved in a **data folder** that's separate from the app:

| System | Data folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\SerenePub\Data` |
| macOS | `~/Library/Application Support/SerenePub` |
| Linux | `~/.local/share/SerenePub` |

Back that folder up and you've backed up your whole pub (Serene Pub also makes its own backups there; see [Data and backups](./system-settings.md#data-and-backups)). Its `logs` folder holds what **View Logs** opens. To uninstall, quit Serene Pub and delete the `serene-pub` folder (on macOS, the app); delete the data folder too only if you want your stories gone as well.

### Running without the launcher (servers, troubleshooting)

The **Serene Pub** you double-click is a small launcher: it starts the app, puts the icon in the tray, opens the window and installs updates. To run the app on its own instead, start it in a terminal from the app's own folder. That's the way to run it on a headless server, from a service or `systemd` unit, over SSH, or to watch its output while you track down a problem:

| System | Command |
| --- | --- |
| Windows | `app\run.cmd` (in the `serene-pub` folder) |
| macOS | `bash run.sh` in the `serene-pub` folder, or `"Serene Pub.app/Contents/Resources/app/run.sh"` from wherever the app is |
| Linux | `app/run.sh` (in the `serene-pub` folder) |

It prints everything to the terminal and stops with **Ctrl+C**. There's no tray icon, nothing opens by itself, and in-app updates aren't offered; update by hand as above. Double-clicking **Serene Pub** while it runs this way opens the running app instead of starting a second one.

### Docker, and running from source

For a home server or NAS, Serene Pub publishes a Docker image. With Docker installed, download `docker-compose.dist.yml` from the release and run:

```bash
docker compose -f docker-compose.dist.yml up -d
```

It then answers at `http://localhost:3000`. Ports, volumes and reverse proxies are covered in `DOCKER.md` in the repository, and putting it on a network in [Hosting](./hosting.md). Developers can also run it from source; the [project README](https://github.com/doolijb/serene-pub#readme) has the steps.

### Changing settings like the port

Serene Pub needs no configuration to run. If you do want to change something, such as the port or where data is kept, see [Environment variables](./environment-variables.md).
