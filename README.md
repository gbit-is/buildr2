# Buildr2

Buildr2 is a lightweight static website for tracking printed parts while building one or more droids.

## What it does

- Lets you continue without login or optionally sign in with Google
- Supports multiple droids and multiple droid types
- Uses JSON files for each droid type's layout, sections, options, and parts
- Tracks whether each part has been printed
- Filters parts by section options such as `large printer` vs `small printer`

## Project structure

- `index.html`: app shell
- `styles.css`: UI styling
- `app.js`: app logic and local persistence
- `config.js`: optional Google client configuration
- `data/droid-types/*.json`: droid type definitions

## Run locally

Because the app fetches JSON files, serve it with a local web server instead of opening `index.html` directly.

Examples:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

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

The current implementation is frontend-only. It uses Google Identity Services to identify the user and stores each user's droid data in browser local storage.

## Adding a new droid type

1. Create a new JSON file in `data/droid-types/`.
2. Add an entry to `data/droid-types/index.json`.
3. Define:
   - `visual.viewBox`
   - `visual.regions`
   - `sections`
   - `categories.main`
   - `categories.greebles`
   - optional `options`

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
