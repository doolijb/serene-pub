# Install Serene Pub

Download Serene Pub, start it, and open it in your web browser. There's nothing else to install first.

_Written for Serene Pub 0.6. This is step 2 of Start here._

:::note By the end of this page
Serene Pub is running on your computer (or phone) and its welcome screen is open in front of you.
:::

:::note You'll need
- A Windows, macOS or Linux computer, or an Android phone running Android 8 or newer.
- Some free disk space. The app itself is modest; models you download later are bigger, often several GB each.
- An internet connection for the download.
:::

Pick your system below and follow only that section. Each one ends with the same check.

## Windows

1. Go to the [Serene Pub downloads page](https://github.com/doolijb/serene-pub/releases) and download the **Windows** `.zip` file from the newest release.
2. Find the file in your **Downloads** folder, right-click it and choose **Extract All…**. Pick somewhere easy to find, such as your **Documents** folder. Don't skip this: opened straight from the `.zip`, Windows shows only part of the folder and the app can't start.
3. Open the extracted `serene-pub` folder and double-click **Serene Pub.bat**.
4. A black command window opens and shows some text while Serene Pub starts. **Leave that window open**: it *is* Serene Pub. Closing it stops the app.
5. After a few seconds your browser opens on Serene Pub by itself. If it doesn't, open your browser and go to `http://localhost:3000`.

<!-- SHOT: the Windows command window after a successful start, with the browser opening beside it -->

Skip ahead to [Check that it worked](#check-that-it-worked).

## macOS

1. Go to the [Serene Pub downloads page](https://github.com/doolijb/serene-pub/releases) and download the **macOS** `.zip` from the newest release. Choose **Apple Silicon** if your Mac has an M1, M2, M3 or newer chip, and **Intel** otherwise (Apple menu → **About This Mac** tells you which).
2. Double-click the `.zip` in your **Downloads** folder to unpack it. Move the `serene-pub` folder somewhere permanent, such as your **Applications** or **Documents** folder.
3. Open the folder and **right-click** (or Control-click) **Serene Pub.app**, then choose **Open**.
4. macOS warns that it can't check the app for malicious software, because Serene Pub isn't registered with Apple. Click **Open** to confirm. You only need to do this the first time; after that a normal double-click works.
5. Your browser opens on Serene Pub. If it doesn't, open your browser and go to `http://localhost:3000`.

:::note Intel Macs
Everything works on Intel Macs except the built-in *local* memory model (embeddings), which that chip can't run. You can use an online one instead. This won't matter for your first sessions.
:::

Skip ahead to [Check that it worked](#check-that-it-worked).

## Linux

1. Go to the [Serene Pub downloads page](https://github.com/doolijb/serene-pub/releases) and download the **Linux** `.zip` from the newest release.
2. Extract it somewhere permanent, such as your home folder.
3. In your file manager, open the extracted `serene-pub` folder, right-click **run.sh** (the one at the top of the folder, not the one inside `app`), choose **Properties**, and turn on **Allow executing file as program** (the wording varies between desktops).
4. Right-click **run.sh** again and choose **Run as program** (or **Run**). A terminal window opens and Serene Pub starts. **Leave that window open**: closing it stops the app.
5. Open your browser and go to `http://localhost:3000` if it didn't open by itself.

Prefer a terminal? `cd` into the folder and run `bash run.sh`. Want Serene Pub in your applications menu? Run `install-desktop-shortcut.sh` once.

Skip ahead to [Check that it worked](#check-that-it-worked).

## Android

1. On your phone, open the [Serene Pub downloads page](https://github.com/doolijb/serene-pub/releases) and download the `.apk` file from the newest release.
2. Tap the downloaded file. Android asks whether your browser may install apps; tap **Settings**, turn on **Allow from this source**, and go back.
3. Tap **Install**. On the newest Android versions you may see a notice about the app being built for an older version of Android. That's expected: install anyway.
4. Open **Serene Pub** from your app drawer. The first launch takes a little longer while it unpacks.

:::note On a phone, the model runs elsewhere
The Android app is a complete Serene Pub, but a phone can't run an AI model itself. In step 3 you'll connect to an online service, or to a model running on a computer on your home network. See [Android App](./android.md) for the full list of differences.
:::

## Check that it worked

:::tip You should see
A page headed **Welcome to Serene Pub**, with a **Get started** button. This is the setup wizard, which walks you through the next steps.
:::

<!-- SHOT: the welcome step of the setup wizard -->

Stop here for now, or carry straight on: the wizard's next step is choosing a model, which is exactly what the [next page](./connect-a-model.md) explains.

:::warning If this didn't work
- **Nothing opened, or the page says it can't connect.** Serene Pub may still be starting; wait ten seconds and reload `http://localhost:3000`. Check that the command or terminal window is still open.
- **The window flashed open and closed at once.** Something stopped the app from starting. On Windows, open a Command Prompt in the folder and run `run.cmd`; on macOS or Linux, run `bash run.sh` from a terminal. The last lines it prints say what went wrong.
- **Windows shows "Windows protected your PC".** Click **More info**, then **Run anyway**. Serene Pub isn't signed with a paid certificate, so Windows doesn't recognise it yet.
- **"Address already in use" or "port 3000".** Another program is already using that address; often it's a second copy of Serene Pub you started earlier. Close the other copy, or change the port as described in [Environment Variables](./environment-variables.md).
- **It says the database won't open.** See [Database won't open](./troubleshooting.md#database-wont-open).
- Still stuck? Ask in [Discord](https://discord.gg/3kUx3MDcSa) or [open an issue](https://github.com/doolijb/serene-pub/issues). The window's last few lines are the most useful thing to include.
:::

## Everyday use

- **Starting it again.** Do the same as step 3 of your platform: double-click the launcher. Your characters and sessions are all still there.
- **Stopping it.** Close the command or terminal window, or click in it and press **Ctrl+C**. On Android, close the app from the recent-apps screen.
- **Using it from your phone.** While Serene Pub runs on your computer, any phone or tablet on the same Wi-Fi can open it too, at `http://` followed by your computer's local address and `:3000` (for example `http://192.168.1.42:3000`). To find that address: on Windows run `ipconfig` in a Command Prompt and look for **IPv4 Address**; on macOS run `ipconfig getifaddr en0` in Terminal; on Linux run `hostname -I`. [Hosting](./hosting.md) explains how to let other people in safely.

## Going further

### Updating to a new version

Download the new release and extract it over your existing `serene-pub` folder, replacing files when asked. Your characters, sessions and settings are not inside that folder, so an update never touches them.

### Where your data lives

Everything you make is saved in a **data folder** that's separate from the app:

| System | Data folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\SerenePub\Data` |
| macOS | `~/Library/Application Support/SerenePub` |
| Linux | `~/.local/share/SerenePub` |

Back that folder up and you've backed up your whole pub. To uninstall, delete the `serene-pub` folder; delete the data folder too only if you want your stories gone as well.

### Docker, and running from source

For a home server or NAS, Serene Pub publishes a Docker image. With Docker installed, download `docker-compose.dist.yml` from the release and run:

```bash
docker compose -f docker-compose.dist.yml up -d
```

It then answers at `http://localhost:3000`. Ports, volumes and reverse proxies are covered in `DOCKER.md` in the repository, and putting it on a network in [Hosting](./hosting.md). Developers can also run it from source; the [project README](https://github.com/doolijb/serene-pub#readme) has the steps.

### Changing settings like the port

Serene Pub needs no configuration to run. If you do want to change something, such as the port or where data is kept, see [Environment Variables](./environment-variables.md).

## Next

← [What is Serene Pub?](./what-is-serene-pub.md) · [Connect a model](./connect-a-model.md) →
