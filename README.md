# Buildr2

Buildr2 is a lightweight website for tracking printed parts while building one or more droids.

## What it does

- Lets you continue without login or optionally sign in with Google
- Supports multiple droids and multiple droid types
- Uses JSON files for each droid type's layout, sections, options, and parts
- Tracks whether each part has been printed
- Filters parts by section options such as `large printer` vs `small printer`
- Saves guest progress in browser local storage
- Saves signed-in progress to a backend JSON database on disk

## Project structure

- `index.html`: app shell
- `styles.css`: UI styling
- `app.js`: frontend logic
- `server.js`: static file server and backend API
- `config.js`: optional Google client configuration
- `data/droid-types/*.json`: droid type definitions
- `assets/`: image assets used by droid definitions
- `data/storage/workspaces.json`: saved droid workspaces, created automatically at runtime

## Run locally

Start the app from the project folder:

```bash
node server.js
```

Or, if you prefer:

```bash
npm start
```

Then open:

```text
http://localhost:4173
```

## Saving behavior

If you use guest mode, workspace data is saved in your browser's local storage.

If you sign in with Google, workspace data is saved to:

```text
data/storage/workspaces.json
```

So:

- guest mode survives refreshes in the same browser profile
- guest mode data is lost if that browser storage is cleared
- Google mode survives refreshes and browser storage clears because it is stored on disk by the server

## Google login

Google login is optional. The app works without it.

To enable the Google sign-in button:

1. Create a Google OAuth Client ID for a web app.
2. Add your local or deployed origin to the authorized JavaScript origins.
3. Put the client ID in `config.js`:

```js
window.BUILDR_CONFIG = {
  googleClientId: "YOUR_GOOGLE_CLIENT_ID"
};
```

## Important auth note

The current backend stores data by profile id, but it does not yet cryptographically verify Google tokens on the server.

So this version is good for:

- your own machine
- a trusted home server
- early prototyping

Before public deployment, we should add:

- server-side Google token verification
- real user sessions
- a proper database such as Postgres or SQLite

## Adding a new droid type

1. Create a new JSON file in `data/droid-types/`.
2. Add an entry to `data/droid-types/index.json`.
3. Define:
   - `visual.image`
   - `visual.hotspots`
   - `sections`
   - `categories.main`
   - `categories.greebles`
   - optional `options`

Example image selector config:

```json
{
  "visual": {
    "image": {
      "src": "./assets/r2d2-reference.svg",
      "width": 720,
      "height": 1080,
      "alt": "R2-D2 build reference"
    },
    "hotspots": [
      {
        "sectionId": "head",
        "x": 160,
        "y": 70,
        "width": 400,
        "height": 190,
        "label": "HEAD"
      }
    ]
  }
}
```

Hotspot coordinates are measured against the source image size, so you can swap in a real PNG or JPG and tune the clickable areas visually.

Each part can include:

```json
{
  "id": "body-core-large",
  "name": "Body core shell",
  "files": ["body/large/body-core.stl"],
  "requirements": {
    "printer_size": ["large"]
  }
}
```

This lets one section expose different files based on selections such as printer size.
