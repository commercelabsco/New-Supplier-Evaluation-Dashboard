# Google Sheet sync setup

This dashboard is a static HTML file with no server of its own. To let
**multiple people, from different computers/locations, read and write the
same evaluations**, `Code.gs` in this folder turns a Google Sheet into a
tiny JSON API that `index.html` talks to over `fetch()`.

## 1. Create/open the Sheet

Use an existing Sheet or create a new one. The script will auto-create the
tabs it needs (`data` for evaluations, `Comparisons` for saved comparisons)
the first time it runs, with headers.

## 2. Add the script

1. In the Sheet: **Extensions → Apps Script**.
2. Delete whatever is in the default `Code.gs` and paste in this folder's
   `Code.gs`.
3. Save (Ctrl/Cmd+S).

## 3. Deploy as a Web App

1. **Deploy → New deployment**.
2. Type: **Web app**.
3. **Execute as:** Me (your account — this is what lets the script write
   to the Sheet on behalf of every visitor).
4. **Who has access:** **Anyone**. This is not optional.

   ⚠️ This is the step that broke the first two attempts. If your Google
   account is part of a company/Workspace domain, the dialog can quietly
   default to *"Anyone within [yourcompany.com]"* instead of *"Anyone"*.

   It's tempting to pick the domain-restricted option thinking "everyone
   here has a company account anyway" — but that doesn't just narrow who
   can use it, **it breaks the dashboard for everyone, including people
   signed into the right account**. The dashboard talks to this URL with
   `fetch()`, and a domain-restricted deployment routes that request
   through an access-check redirect that doesn't send CORS headers back.
   The browser then refuses to let the page's JavaScript read the
   response at all — not "shows a login page", but an outright
   `Access to fetch ... has been blocked by CORS policy` error in the
   console, no matter who's signed in or how. The dashboard just falls
   back to session-only memory mode with a vague toast ("Google Sheet
   sync isn't available").

   The plain **Anyone** deployment doesn't have this problem: it
   executes directly and its response carries the CORS headers `fetch()`
   needs, so it works from any browser, account, or device — signed in
   or not.

5. Click **Deploy**, authorize the requested permissions, and copy the
   Web App URL it gives you. It should look like:

   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

   (Not `https://script.google.com/a/macros/yourcompany.com/s/.../exec`
   — if you see `/a/macros/<domain>/` in the URL, the deployment is
   domain-restricted; go to **Manage deployments → edit (pencil) →
   Who has access → Anyone → Deploy** and use the new URL instead.)

## 4. Point the dashboard at it

In `index.html`, find:

```js
const SHEET_WEBAPP_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
```

and replace the placeholder with the URL from step 3.

## 5. Verify it actually works for someone else

Open the dashboard in a private/incognito window (or ask a coworker to
open it) and add a test evaluation. If it shows up in the Sheet's `data`
tab, and the same evaluation is visible from a *different* browser/device,
sync is working. If the "Google Sheet sync isn't available right now"
banner shows up instead, open the browser console — the error message
now explicitly says if the deployment returned a login page (domain
restriction) versus some other failure.

## How it behaves when the Sheet is unreachable

If `SHEET_WEBAPP_URL` is left as the placeholder, or the Sheet can't be
reached, the dashboard falls back to an in-memory store for that browser
tab only — nothing is shared between users, and nothing survives a
refresh. Use **Export All** / **Import** in that case to move data
between sessions manually.

## Concurrency

Two people saving at the same moment (from different locations) are
serialized with `LockService` in `Code.gs`, so writes can't race each
other into a corrupted row or a duplicate/skipped ref number.
