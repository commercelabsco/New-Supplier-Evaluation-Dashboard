# Google Sheet sync

The dashboard (`index.html`) has no backend of its own, so it reads/writes
its data through a small Apps Script Web App bound to the target Google
Sheet.

## Deploy

1. Open the Sheet: https://docs.google.com/spreadsheets/d/1pufHgFBk51agWDT4CbEjyo0KTT9tPxS5sHChAgOZLkQ/edit
2. **Extensions -> Apps Script**.
3. Delete the placeholder `Code.gs` contents and paste in this folder's `Code.gs`.
4. **Deploy -> New deployment -> Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, authorize when prompted, then copy the **Web app URL**.
6. In `index.html`, find:
   ```js
   const SHEET_WEBAPP_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
   ```
   and replace the placeholder with the URL from step 5.

The script writes evaluations into a tab named `data` (created
automatically if missing) and comparisons into a `Comparisons` tab. Each
row has a `data` column holding the full JSON record (so no field is
lost) plus a few readable columns for browsing the Sheet directly.

If your `data` tab already has rows in it from something else, clear it
first (or rename it) so the script's header row and column layout don't
collide with existing content.

## Redeploying after editing Code.gs

Apps Script Web App URLs stay stable across **Manage deployments -> Edit ->
New version**, so re-editing the script doesn't require updating
`SHEET_WEBAPP_URL` again — just publish a new version of the same
deployment.
