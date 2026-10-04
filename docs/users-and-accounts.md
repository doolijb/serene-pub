# Users and accounts

User accounts let several people share one pub, each signing in to their own characters, personas, sessions and settings.

:::tip What it's for
- Letting friends or family use your pub from their own browser or phone, without seeing each other's stories.
- Putting a sign-in screen in front of a pub that other people can reach, such as over a [tunnel](./system-settings.md#network).
:::

## The basics

A new pub has **accounts off**. There's no sign-in screen: everyone who opens it is you, the administrator, with full access to everything. That's the simplest way to run Serene Pub for yourself on your own computer, and fine on a home network you trust.

Turn accounts on when anyone else will reach your pub. From then on, everyone signs in with a username and passphrase, and each account has its own characters, personas, sessions, lorebooks and tags.

:::warning Accounts can't be turned off again
Once accounts are on, they stay on. There's no switch to go back.
:::

## Enabling user accounts

:::note Admins only
Only an administrator can turn accounts on.
:::

1. Open **Admin › General** and find the **User accounts** card. Its status line reads *Off — anyone who can reach this pub uses it as you*.
2. Turn on the **User accounts** switch. A **Turn on user accounts?** dialog says the change can't be reversed.
3. If your own account has no passphrase yet, the dialog asks for one: type it in **Passphrase** and **Confirm passphrase**. It needs at least 10 characters, with an uppercase letter, a lowercase letter and a special character.
4. Press **Set passphrase and turn on** (or **Turn on accounts** if you already had a passphrase).

:::tip You should see
A *User accounts turned on* message, and the card's status line reads *On — sign-in is required*. A **Users** icon appears on the rail.
:::

Accounts can't be turned on in the Android app, which is single-user.

## Signing in

With accounts on, anyone who isn't signed in sees a sign-in screen: **Username**, **Passphrase** (with a button to show it), **Sign in**, and a link to **Document View**. There's no "forgot passphrase" link and no email reset; see [Resetting a passphrase](#resetting-a-passphrase) for how to get back in.

## Inviting people

:::note Admins only
Only administrators can invite people or create accounts.
:::

The easiest way to add someone is an **invite link**: they pick their own username and passphrase.

1. Open **Users** on the rail and press **Invite links**, the button beside **New** (or open **Admin › People › Users** and press **Invites**).
2. Under the registration text, press **New registration link**.
3. The link is shown once, with a QR code. If your pub can be reached at more than one address (for example your home network and a running tunnel), pick the right one under **Address to share**. Press **Copy** and send it.

:::tip You should see
When your friend opens the link, they see **Create your account**. After they choose a username and passphrase, they're signed in and land on the setup wizard.
:::

An invite link works once and stops working after two hours. It never creates an administrator. Links not yet used are listed under **Outstanding** until they expire.

## The Users view

:::note Admins only
The **Users** icon appears on the rail for administrators, once accounts are on.
:::

**Users** on the rail lists every account. Search by username or display name. Each row shows the display name, the `@username` and an **Admin** badge for administrators. Click a row to see the account, with **Edit** to change it. **New** creates an account yourself, **Invite links** shows the invite options, and each row except your own has **Edit** and **Delete**.

**Admin › People › Users** is the same roster in the admin area, as a table: filter it by role or by whether the person has ever signed in, tick rows to delete several at once (your own account is always kept), and click a row to open the account's form. **Add user** and **Invites** are at the top. Deleting an account signs it out everywhere and stops it signing in; what the person made stays on the pub.

### Creating a user yourself

Press **New** and fill in:

- **Username** (required, unique on this pub).
- **Display name** (optional): shown instead of the username where it's set.
- **Passphrase** and **Confirm passphrase**. **Generate random** makes one for you (three words, a number and a symbol, such as `Ocean-Phoenix-Quartz482!`) and **Copy** puts it on your clipboard, so you can pass it on.

Press **Create**. Every passphrase follows the same rule: at least 10 characters, with an uppercase letter, a lowercase letter and a special character.

### Editing and deleting

**Edit** opens the same form. Leave the passphrase fields blank to keep the current one, then press **Update**. Deleting an account hides it from the list and from sign-in; you can't delete your own.

### Making someone an administrator

Tick **Administrator** on their form. In the Users view a **Grant administrator privileges?** dialog lists what that allows; in **Admin › People › Users** the same warning shows under the box, and nothing changes until you save. A new account can't be an administrator: the box only becomes available once that person has signed in at least once.

## Administrators and members

There are two kinds of account and nothing in between.

**Administrators** can see and change everything on the pub: every account, the [admin area](./getting-around.md#the-admin-area), connections and sampling, and every other person's characters and sessions. Grant it only to people you'd trust with the whole pub.

**Members** have their own characters, personas, sessions, lorebooks and tags, and their own settings. They don't see the Users, Connections, Sampling or Admin icons. Their setup wizard skips **Choose an LLM**, because connecting a model is the administrator's job. The **Data** tab in their Settings only says that an administrator manages backups.

To play in the same story as someone else, add them to a session as a guest: see [Guests](./sessions.md#guests).

## Your own account

Everyone's own settings are in **Settings** on the rail, on the **User** tab: language, how sessions may change your lorebooks, character form preferences, Document View and your **Display name** (see [Themes and settings](./themes-and-settings.md#your-preferences-the-user-tab)). The display name is there with accounts on or off. With accounts on, the passphrase, logout and two-factor controls appear there too.

### Changing your own passphrase

In **Settings › User**, the **User profile** card has your **Display name** (up to 50 characters; press **Update** to save it, or empty it to go by your username), **Change passphrase** and **Logout**.

**Change passphrase** asks for your **Current passphrase**, a **New passphrase** and its confirmation. The new one must follow the passphrase rule above.

### Two-factor authentication

Two-factor adds a code from an authenticator app (such as Google Authenticator, Aegis or 1Password) to your sign-in. Turn it on from the **Two-factor authentication** card in **Settings › User**: add Serene Pub to your authenticator app, then type a code to confirm. Nothing changes until a code has worked, so a setup that goes wrong can't lock you out.

When it's on you get ten **recovery codes**. Each works once, in place of a code from your app. They're shown only this once, so copy or download them and keep them somewhere outside Serene Pub. The card shows how many are left and warns when two remain; generating a new set cancels all the old ones.

If you ever sign in with a recovery code, your authenticator is probably gone: set two-factor up again rather than working through the remaining codes.

## Resetting a passphrase

There's no email reset. How you get back in depends on who is locked out.

### A member forgot their passphrase

An administrator can do either of these from the Users view:

- **Edit** the account, type a **New passphrase** and **Update**, then tell them the new one.
- Or, under **Invite**, choose the account under **Account** and press **Recovery link**. The person opens the link and sets a new passphrase themselves. This also removes their two-factor and signs out their other sessions.

### Lost your authenticator and your recovery codes

Another administrator can open **Admin › People › Users**, pick your account and press **Clear two-factor for this user**. Your passphrase still works, and all your sessions are signed out.

### If the admin account itself is locked out

If another administrator can still sign in, they reset your passphrase as above. If nobody with admin rights can sign in, recover through the server's settings:

1. Set `SERENE_PUB_RECOVERY_KEY` to any new string you choose, and `SERENE_PUB_RECOVERY_PASSWORD` to the new passphrase (it must follow the passphrase rule). See [Environment variables](./environment-variables.md#account-recovery) for where these go.
2. Restart Serene Pub.

On that start, the first administrator's passphrase is reset, their two-factor is cleared, and all their sessions are signed out. The key is then used up, so leaving the variables in place does nothing on later restarts; to reset again, choose a new key.

Setting those variables needs access to the computer or container Serene Pub runs on, and that access is what allows the reset. Creating a second administrator account once accounts are on is the easier safety net.
