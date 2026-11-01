# Code signing policy

Serene Pub's Windows download is signed, so Windows can tell where it came from and that nobody changed it on the way. This page says what is signed, who can sign it, and how.

_Written for Serene Pub 0.6._

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

:::note Why Windows says "SignPath Foundation"
The certificate belongs to SignPath Foundation, which signs open-source projects for free. So when Windows asks about a signed Serene Pub file, it names **SignPath Foundation** as the publisher. The software is still Serene Pub, made by the Serene Pub project.
:::

Releases made before signing began aren't signed. For those, Windows shows the warning described in [Install Serene Pub](./install.md#windows).

## What is signed

Only the two programs built from Serene Pub's own source code, in the Windows download:

- `Serene Pub.exe`, the launcher: the program you double-click, which puts Serene Pub in the tray.
- `app\serene-pub-window.exe`, the program that shows Serene Pub in its own window.

Everything else in the download is open source, and none of it is signed by us:

- `app\node.exe` is Node.js, the runtime the app runs on. It's the official build from nodejs.org, signed by the Node.js project, and checked against nodejs.org's published checksums before it goes in the download.
- `app\build` is the app itself, written in JavaScript.
- `app\node_modules` holds the open-source libraries the app uses, as their makers publish them. A few contain compiled parts, such as the image library (sharp) and the runtime for local models (ONNX Runtime). Every library's licence is checked against a list of open-source licences while the download is built, and the build stops if one isn't on it. The Microsoft graphics libraries that the ONNX Runtime package carries (DirectML and the DirectX shader compiler), some of them closed source, are removed before anything is packed.

The macOS, Linux and Android downloads and the Docker image aren't signed with this certificate.

## How a signed release is made

1. The maintainer starts a release by tagging a version in the public repository, [github.com/doolijb/serene-pub](https://github.com/doolijb/serene-pub). Nobody else starts a release build.
2. GitHub Actions builds every download from that tag, on GitHub's own machines, with the `release.yml` workflow in the repository. Nothing that is signed is built on a personal computer.
3. The Windows build sends its two programs to SignPath. SignPath checks that they came from that workflow run, and the maintainer approves each request by hand before anything is signed.
4. The signed programs go back into the download. It is zipped, given a SHA-256 checksum, and attached to the release on GitHub.

So every signed file belongs to a tagged release, and you can read the code it was built from. Each one names Serene Pub as its product and carries that release's version number.

## Who does what

| Role | Who |
| --- | --- |
| Committers and reviewers | [doolijb](https://github.com/doolijb), the maintainer. Changes from anyone else arrive as pull requests, and the maintainer reviews each one before it's merged. |
| Approvers | [doolijb](https://github.com/doolijb). Approves every signing request. |

Everyone in these roles signs in to GitHub and SignPath with two-factor authentication.

## Privacy

Serene Pub sends nothing to other computers unless you, or the person who runs your pub, ask it to:

- **Replies.** Each time a model writes a reply, the story so far goes to the model's service. A model on your own computer keeps it there. See [Connect a model](./connect-a-model.md#choose-where-your-model-runs).
- **Downloads and browsing.** When you get a model, KoboldCPP or a voice, or browse for characters, Serene Pub asks the site they come from, such as Hugging Face or GitHub.
- **Recommended lists.** The lists of recommended models and voices come from the Serene Pub project's own repositories on GitHub.
- **Update check.** A release build asks GitHub at most once a day whether a newer version is out. Pre-release builds never do. See [Updating](./updating.md#how-you-hear-about-a-new-release).

There is no analytics, usage tracking or crash reporting. A service you connect has its own privacy policy; read theirs before you send it a story.

## Uninstalling

Quit Serene Pub and delete its folder. Your stories are kept in a separate data folder; [Where your data lives](./install.md#where-your-data-lives) says where, and when to delete it too.

## Checking a signature

On Windows, right-click `Serene Pub.exe`, choose **Properties**, and open the **Digital Signatures** tab. A signed release lists **SignPath Foundation**.

## Reporting a problem

If a file signed as Serene Pub looks wrong, or you think something was signed that shouldn't have been, [open an issue on GitHub](https://github.com/doolijb/serene-pub/issues) and say which download and file.
