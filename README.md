# FRC Inserter for Onshape

In an Onshape assembly, select two parallel hole edges or faces and press **Alt+I** (Option+I on a Mac), then pick a part. FRC Inserter inserts the part from your library with its length set to the gap between the two selections, then positions and mates it.

Parts set up so far: **#10 Spacer** and **Hex Shaft**.

## How it works

| Folder | What it is | What it does |
| --- | --- | --- |
| `extension/` | Chrome extension | Handles the hotkey, the part picker, the gap measurement, and all Onshape API calls (insert, position, mate) |
| `docs/` | Onshape right-panel page, hosted on GitHub Pages | Passes your selection to the extension (Onshape only sends selections to app panels) |

There's no server, no OAuth and no API key. Onshape limits API calls from private apps and API keys (2,500 a year on Free, Standard and EDU student plans; see [API limits](https://onshape-public.github.io/docs/auth/limits/)). It doesn't count calls made with your signed-in browser session, which is how Onshape's own API Explorer works. The extension makes its calls the same way, from your Onshape tab.

The panel talks to the extension over a private `MessageChannel`. Onshape stops sending selections to a panel that posts it messages it doesn't recognize, so the panel only ever posts real Onshape messages to the Onshape page.

## Setup

### 1. Prepare the library document

- Put each part in its own Part Studio, with one part per Part Studio. If a Part Studio has more than one part, set `partName` in `config.js` to choose which one.
- Give each Part Studio a **length configuration input** that drives the part's length. The extension looks for an input named `Length` by default. The part must be straight; it can point in any direction.
- **Create a version.** Onshape only lets you insert another document's parts from a version. The extension always uses the newest version, so make a new one whenever you change the library.

### 2. Host the panel on GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages → Deploy from a branch** and choose `main`, folder `/docs`. GitHub Pages needs a public repo unless your plan allows Pages on private ones.
3. Your panel URL is `https://<your-github-username>.github.io/Onshape-Inserter/`.

### 3. Register the panel with Onshape

In the [Onshape Developer Portal](https://dev-portal.onshape.com):

1. **OAuth applications → Create new.** Fill in the required fields and use your panel URL as the redirect URL. The app never calls the API through OAuth, so pick the fewest permissions it allows.
2. **Extensions → Add extension:**
   - Name: `FRC Inserter`. This must match `panelName` in `config.js`.
   - Location: `Element right panel`
   - Context: `Assembly`
   - Action URL: `https://<your-github-username>.github.io/Onshape-Inserter/?documentId={$documentId}&workspaceId={$workspaceOrVersionId}&elementId={$elementId}`
   - Icon: `docs/icon.svg`, or any icon you like.
3. Make the app show up for you. Either create a store entry (it stays private unless you submit it for review) and subscribe to it, or, if you're a company, classroom or enterprise admin, assign it to yourself in your developer settings. Onshape's [app development workflow](https://onshape-public.github.io/docs/app-dev/extensions/) covers both.

### 4. Configure and load the extension

1. Edit `extension/config.js`:
   - Set `panelUrl` to your GitHub Pages URL.
   - Set each part's `partStudioUrl` to the URL of its Part Studio tab in the library document.
2. Go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension/` folder.
3. After any later edit, click the reload button on the extension and refresh your Onshape tab.

## Using it

1. Open an assembly in a workspace. Versions are read-only.
2. Select two parallel things:
   - **two hole edges** (best: these give both the gap and the hole axis)
   - **a hole edge and a flat face**
   - **two flat faces**. This only gives the gap, so the part goes at the center of the first face and isn't mated.
3. Press **Alt+I**. The picker shows the gap. Press **1** or **2**, or use the arrow keys and Enter.
4. The part is inserted at that length, starts at the hole, points toward the other selection, and is mated.

### Good to know

- **The panel opens and closes for you.** If the panel is closed, the hotkey opens it and closes it again afterwards. If Onshape doesn't pass your existing selection to a panel that just opened, you'll be asked to select the two items after picking the part. To avoid that, leave the panel open, or set `closePanelAfterInsert: false`.
- **Mates:**
  - `FASTENED` (the spacer default) and `REVOLUTE` (the shaft default) hold the part's start face on the first hole. Any `extraLength` sticks out past the second selection.
  - `CYLINDRICAL` and `NONE` split any extra length evenly between both ends.
  - If a mate can't be made to land correctly, it's removed and the part is left placed but unmated. A warning tells you when that happens.
- **Undo:** each insert is several Onshape edits, so undoing one may take more than one Ctrl+Z.

### Checks for your first real run

Some Onshape behavior isn't documented, so these parts have only been tested against a fake Onshape page (see Development below):

1. **Selection format.** The panel's **Messages from Onshape** section shows the raw `SELECTION` messages. The extension expects each selected item to have a `selectionId` and an `occurrencePath`. If yours look different, adjust `normalize()` in `docs/panel.js`.
2. **Opening the panel.** If the hotkey says it couldn't open the panel, find the panel's button with DevTools and put a CSS selector for it in `panelButtonSelector`.
3. **Mates.** If every insert ends with "placed but unmated", set `debug: true` and look in the Onshape tab's console for the API error.
4. **API access.** If inserts fail with a 403 error, Onshape has changed how it protects session API calls. The console will show the details.

## Development

```bash
npm test
```

Runs the geometry unit tests.

```bash
npm run check
```

Syntax-checks every script.

```bash
node test/harness/server.js
```

Starts a fake Onshape (the panel protocol plus a mocked API). Open http://localhost:8181/documents/aaaaaaaaaaaaaaaaaaaaaaaa/w/bbbbbbbbbbbbbbbbbbbbbbbb/e/cccccccccccccccccccccccc to click through the real extension code. The fake page can simulate:

- Onshape not passing the existing selection to a newly opened panel
- a mate that flips the part, followed by the fix
- a forced API failure (set `window.MOCK_FAIL` to an API method name)
