# Images

Serene Pub can draw pictures for your stories: a picture in the middle of a session, a portrait of a character, a full set of a character's sprites, or a backdrop that sets the scene. This page is the one to read to get pictures working.

:::tip What it's for
- Showing what is happening in a session, with one press.
- Giving a character a portrait or a whole set of faces, drawn to look like them every time.
- Keeping the session's scene behind the conversation as a backdrop.
:::

Drawing needs an image model, and an image model is set up by an administrator. If it's your own pub, that's you. If someone else runs it and pictures don't work, see [When it says no model is set](#when-it-says-no-model-is-set).

## Pick where pictures come from

Pictures come from the **Images** loadout. A [loadout](./connections.md#loadouts) is what a kind of work runs on: a model on a connection, and the settings it is driven with. Fill the Images loadout once and every picture button in the pub works. Open **Loadouts** on the rail, tap **Images**, and pick a connection and a model; or press **Use in…** beside an image model in the **Models** view.

Serene Pub also ships the **Portrait**, **Sprites** and **Scene** loadouts. They start unfilled and draw with whatever Images uses, so you only fill one when you want that kind of picture on a different model.

You need a connection that can draw first. There are three kinds of place a picture can come from:

- **The KoboldCPP Serene Pub runs for you.** It draws as well as writes, so if you already chat with it, get an image model in the Models view (**Get a model**, set to **Images**) and press **Use in Images**. KoboldCPP holds one model at a time, so a picture unloads the model that writes replies for a moment. See [Images from the same connection](./connections.md#images-from-the-same-connection).
- **ComfyUI or a Stable Diffusion program you run yourself.** Add the connection and point it at the program's address. ComfyUI draws with a workflow, and Serene Pub ships six to start from. See [ComfyUI](./connections.md#comfyui) and [Stable Diffusion](./connections.md#stable-diffusion-a1111-compatible).
- **An online service.** OpenAI, Google Gemini, Black Forest Labs (FLUX) and NovelAI need an account and a key, and charge per picture. AI Horde is free and needs no key, but your pictures wait in a queue. See [Image services online](./connections.md#image-services-online) and [Images from OpenAI](./connections.md#images-from-openai).

How a picture is drawn (its size, steps and so on) comes from the loadout's sampling config. Serene Pub ships one for each common model family; pick the one that matches your model (see [Immutable presets](./connections.md#immutable-presets)).

## Give a character a likeness

A character's **likeness** tells the image model how to draw them, so every picture of them looks like the same person. Open the character, press **Edit** and switch to the **Likeness** tab.

- **Likeness image** is the picture the model is shown. It starts as the character's avatar, and you can pick another from their gallery or their sprites.
- **Likeness prompt** is a short line of what can be seen, separated by commas, such as *adult woman, red braid, green cloak, freckles*.
- **Avoid** lists what should never show up, such as *glasses*. It's optional.

The likeness prompt does most of the work. A good line of looks matters more than a good picture, and it is all a model that can't be shown a picture has to go on. Personas have a likeness too, so pictures of you look like you. More in [Characters → Likeness](./characters.md#likeness).

## Press Image or Scene in a session

In a Story session, open **Actions** above the composer; **Scene** is there too.

- **Image** asks *What should the image show?*. Describe it and the picture is drawn and posted in the session.
- **Scene** asks nothing. It reads the last few messages and how everyone in the session looks, writes a description of the moment, and draws a wide picture of it. By default the picture is posted and also becomes the session's backdrop.

Both take a little while; a progress line shows the picture being drawn, and **Stop** ends it. See [Sessions → Scene](./sessions.md#scene).

## Generate a portrait

Open a character, switch to the **Gallery** tab and press **Generate portrait**. Pick how many pictures (one to four) and a **Style**: **Tags** for most local models, **Prose** for online services. Before anything is drawn you see the prompt, and can change it or stop. The new pictures land in the gallery marked **New**; open one's menu to make it the avatar or the likeness image. See [Characters → Generate a portrait](./characters.md#generate-a-portrait).

## Fill a character's sprites

Sprites are the faces a character shows beside what they say. Open the character's **Sprites** tab and press **Fill empty sprites**. Every label in the set with no picture yet is ticked, and the line under them says how many pictures that is and how many requests it takes. Press **Generate** and the pictures fill a sheet as they arrive, each with **Keep** and **Redo**.

Every picture in one fill shares a seed and is shown the likeness image, so the set looks like one person. A model that can't take a reference picture still draws, from the likeness prompt alone, and the form says so before you start; the set will match less closely.

Sprites need a clear background so they sit cleanly over a session. Some models draw one themselves. For the rest, Serene Pub cuts the background out afterwards with a small background remover that downloads once, the first time it's needed (a couple of hundred megabytes); the form mentions it and the progress line shows it. See [Characters → Fill empty sprites](./characters.md#fill-empty-sprites) and [The background remover](./connections.md#the-background-remover).

## Where pictures go

- **Under a message.** A picture from **Image** or **Scene** is posted as a message, with the picture in the strip under it. The **Album** widget gathers every picture in the session in one place.
- **In the character's gallery.** Portraits go to the **Gallery** tab, and nothing changes until you choose one.
- **Behind the session.** A backdrop is one picture for the whole session, shown by the **Backdrop** widget. Everyone in the session sees the same one; its owner can change or clear it. See [Session layout](./session-layout.md#the-widgets).
- **In the sprite set.** Filled sprites go straight into the set you picked, as new pictures beside anything already there.
- **When a scene opens**, in Story, if the routine **Picture each new scene** is on (it starts Off; see [Story › What runs between turns](./genre-story.md#what-runs-between-turns)): a picture of the new scene is posted like **Scene**'s.

Every picture you make is kept in your media, like an upload.

## When it says no model is set

If a picture button ends with *No model is set for Images, and one is never picked automatically*, the Images loadout is empty: nothing has been chosen to draw with yet. Serene Pub never picks a model for you. An administrator fixes it by filling the **Images** loadout, as in [Pick where pictures come from](#pick-where-pictures-come-from); the sentence names **Admin › Models › Loadouts**, which does the same thing. If you aren't the administrator, ask them.

If pictures stop after working before, the model may have gone from its service, or the program may be switched off. Open the connection in the Connections view and press **Test**: it says what is wrong. See [Connections](./connections.md).

## Related

- [Characters](./characters.md): likeness, portraits and sprites
- [Sessions](./sessions.md): the Image and Scene actions, and backdrops
- [Connections](./connections.md): every image service, loadouts and sampling
- [Pipelines](./pipelines.md#the-image-step): how a picture is asked for, for administrators
- [Connections › Sound from OpenAI](./connections.md#sound-from-openai): voice notes and spoken replies, the other media a session carries
