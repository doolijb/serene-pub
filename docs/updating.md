# Updating Serene Pub

Serene Pub can update itself: an administrator presses two buttons, and the new version is downloaded, checked and started in place of the old one. If the new version doesn't start, the old one comes back by itself.

_Written for Serene Pub 0.6._

:::note In short
- **Admin › Updates** shows which version you run and whether a newer one is out.
- **Download update** fetches it and checks it. Nothing changes yet.
- **Restart to update** restarts Serene Pub on the new version, usually within a minute or two.
- Your characters, sessions, settings and backups are never part of an update.
:::

## How you hear about a new release

Serene Pub asks GitHub at most once a day whether a newer release is out. When one is, every administrator gets a notification in [Activity](./getting-around.md#activity), *Serene Pub v0.7.0 is available*, and the Admin Overview shows an **Update to v0.7.0** button. Both lead to **Admin › Updates**. People who aren't administrators are never told, because only an administrator can update.

## Updating from the app

1. Open **Admin › Updates**. It names the version you run and the newer one.
2. Press **Download update**. Serene Pub downloads the release for your system and checks it against the checksum published beside it on GitHub. A download that doesn't match is deleted and never used. Then it's unpacked next to your current version. You can keep using Serene Pub while this happens, and **Cancel** stops it.
3. When it says the update is downloaded and verified, press **Restart to update** at a moment when nobody is in the middle of a reply. Everyone using your pub is disconnected while Serene Pub restarts.
4. The page reloads by itself when Serene Pub is back, now on the new version.

Changed your mind after downloading? **Discard** removes the downloaded update; you can download it again later.

### What happens during the restart

Serene Pub stops, and its launcher (the program behind the tray icon) does the rest:

1. It moves the current version aside, keeping it whole.
2. It puts the new version in its place and starts it.
3. It waits until the new version says it is ready, and only then deletes the old one.
4. It opens Serene Pub again, unless **Open on start** is off in the tray menu, or a browser tab you already had open reconnects by itself.

The first start of a new version can take a few minutes when it has to upgrade your data. A backup is always taken before that upgrade begins. Meanwhile the tray icon says **Finishing update…** and offers **Roll back now** if you'd rather not wait.

### If the new version doesn't start

A new version that starts but can't finish setting itself up (it can't run replies, for example) counts as not starting. The launcher puts the old version back and starts it again, and the tray icon tells you the update failed and was rolled back. Nothing you made is lost: your data folder was never moved, and the backup taken before the new version changed anything is listed in **Admin › Data and backups** (see [Data and backups](./system-settings.md#data-and-backups)). The version that failed is kept in the update folder's `failed` folder in case someone asks for it in a bug report.

## What stays where

| What | Where | What an update does to it |
| --- | --- | --- |
| The application | the `app` folder inside your `serene-pub` folder (on macOS, **Serene Pub.app**) | Replaced as a whole. |
| The launcher | `Serene Pub.exe` (Windows) or `serene-pub` (Linux) at the top of the `serene-pub` folder; inside **Serene Pub.app** on macOS | Replaced by the new version's launcher, without stopping the app. |
| Your data: database, backups, media, `.env`, logs | your [data folder](./install.md#where-your-data-lives) | Never touched. |
| The update in progress | `staging` inside the `serene-pub` folder (on macOS, a hidden `.serene-pub-staging` folder next to **Serene Pub.app**) | Created for the update and emptied once the new version is running. Leave it alone: during an update it holds the only copy of the version being replaced. |

Because the update is unpacked inside the `serene-pub` folder, that folder has to be somewhere you can write to, with room for a second copy of the app while the update runs.

## When the app can't update itself

**Admin › Updates** shows Download update only when the launcher can apply it. Otherwise it says why in one line and links to the GitHub releases page instead:

- **Started without its launcher.** You ran `app/run.sh`, `app/run.cmd` or `node build/index.js` yourself. Start Serene Pub from its launcher to update from the app, or update by hand (below).
- **Docker.** Pull the new image and recreate the container; see [DOCKER.md](https://github.com/doolijb/serene-pub/blob/main/DOCKER.md).
- **Android.** The Android app is updated as an app.
- **Installed by another tool.** A copy managed by a package manager is updated by that tool.

The update check still runs in all of these, so administrators still hear about new releases.

## Pre-release builds never update

A build whose version has a pre-release suffix (`0.6.0-rc-1`, `-pr-1`, `-dev`, …) never contacts GitHub about versions, shows no update notice, has no **Admin › Updates** section and never updates itself. To move on from one, download the next build yourself. A `-beta` build is a normal release and updates like any other.

## Updating by hand

Quit Serene Pub from the tray icon, download the new release for your system from the [releases page](https://github.com/doolijb/serene-pub/releases), and extract it over your existing `serene-pub` folder, replacing files when asked (on macOS, replace **Serene Pub** in your Applications folder). Your data folder is untouched, and Serene Pub backs up your data by itself before a new version changes it.

## If something goes wrong

- **"… did not match its published checksum, so it was deleted."** The download was damaged or interrupted. Press **Download update** to try again.
- **"The release has no checksum …"** That release can't be verified, so Serene Pub won't install it. Wait for the release to be fixed, or update by hand.
- **"The launcher has not finished the last update."** A previous update was interrupted. Quit Serene Pub and start it again from its launcher; it finishes or undoes that update first.
- **The tray says "Update couldn't be applied — something has Serene Pub's folder open"** (Windows). Another program, often a terminal or file window open inside the `serene-pub` folder, blocked the swap. Nothing was changed. Close it and choose **Restart to update** again.
- **The tray says "Update discarded".** The downloaded update didn't match this install, so the launcher threw it away and started your current version. Download it again from **Admin › Updates**.
- **The page never comes back.** Choose **View Logs** from the tray icon's menu; `server.log` and `launcher.log` say what happened. Ask for help with those in [Discord](https://discord.gg/3kUx3MDcSa) or [an issue](https://github.com/doolijb/serene-pub/issues).
