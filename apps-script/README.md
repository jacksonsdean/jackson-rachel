# Guest photo drop box — setup

Guests upload photos and videos from `upload.html` without signing in to
anything. A Google Apps Script web app receives the request, and files land in
your Google Drive.

Roughly 15 minutes of clicking. Nothing here needs to be redeployed once it
works.

---

## 1. Drive folders

Two folders, already created and already filled in throughout this repo:

| Folder | ID | Sharing | Purpose |
| --- | --- | --- | --- |
| Uploads (inbox) | `1WikYF5aLxqL1ji4b_AKw1ir80um15Mm_` | **Private** — do not share | Where guest uploads land. Nobody but you can see it. |
| Guest photos (public) | `110gCPE3_3fWf0DM-CaNE_MGPTt7wPQgg` | **Anyone with the link → Viewer** | What the website shows. You move the good stuff here. |

Two folders is the whole moderation story: an upload is never publicly visible
until you move it, so one bad file can't end up on the site.

**Check the sharing on both** before going live — the inbox must be private,
and the public folder must be set to *Anyone with the link → Viewer* or the
gallery and the home page preview will come up empty for signed-out guests.

## 2. Create the Apps Script project

1. Go to <https://script.google.com> and click **New project**.
2. Rename it something like `Wedding Uploads`.
3. Delete the sample code in `Code.gs` and paste in the contents of
   [`Code.gs`](Code.gs) from this folder.
4. Click the gear (**Project Settings**) and tick
   **Show "appsscript.json" manifest file in editor**.
5. Back in the editor, open `appsscript.json` and replace it with the contents
   of [`appsscript.json`](appsscript.json) from this folder. (This is what
   grants the Drive scope — without it the upload calls fail with a
   permissions error.)
6. Save. The folder IDs and allowed origins at the top of `Code.gs` are
   already filled in — nothing to edit.

## 3. Deploy it

1. **Deploy → New deployment**.
2. Gear icon → **Web app**.
3. Set:
   - **Execute as:** `Me (your@email)` ← this is what lets guests skip signing in
   - **Who has access:** `Anyone`  ← the anonymous option, *not* "Anyone with a Google account"
4. **Deploy**. Google will ask you to authorize the Drive scope. It will warn
   that the app "isn't verified" — that's expected for your own script. Click
   **Advanced → Go to Wedding Uploads (unsafe)** and allow it.
5. Copy the **Web app URL**. It ends in `/exec`.

Paste that URL into a browser tab. You should see:

```json
{"ok":true,"service":"wedding-uploads","configured":true}
```

If `configured` is `false`, the folder IDs did not make it into `Code.gs`.

## 4. Turn on the hourly sweep

The script checks the file type a guest *claims* to be uploading, but a
determined person can lie about that. Drive detects the real type once the
bytes land, so a scheduled job re-checks and quarantines anything that isn't
actually a photo or video.

1. In the Apps Script editor, click the **clock icon** (Triggers) in the left rail.
2. **Add Trigger**:
   - Function: `sweepInbox`
   - Event source: `Time-driven`
   - Type: `Hour timer` → `Every hour`
3. Save.

Quarantined files go to a `_quarantine` subfolder inside the inbox rather than
being deleted, so a false positive is recoverable.

## 5. Wire up the website

One line to change in [`../config.js`](../config.js) — paste the `/exec` URL
from step 3:

```js
window.WEDDING_CONFIG = {
  uploadEndpoint: "https://script.google.com/macros/s/AKfycb.../exec",
  guestPhotosFolderId: "110gCPE3_3fWf0DM-CaNE_MGPTt7wPQgg",  // already set
};
```

Commit and push. Until `uploadEndpoint` is filled in, the upload page shows a
polite "not ready yet" message instead of a broken form and the home page
preview strip stays hidden — so it is safe to merge before you've done any of
this.

## 6. Test it

Open `https://jackson-rachel.com/upload.html`, ideally **in a private window
while signed out of Google**, and upload one photo and one longish video from a
phone. Check that:

- both appear in the inbox folder
- the filename is prefixed with the name you typed
- right-click → **File information → Details** shows
  `Uploaded by <name> on <date>` in the description

---

## Day-to-day

**Publishing photos:** open the inbox folder, select the ones you want, drag
them into the public folder. They show up on the site within a few minutes
(Drive's embedded folder view caches, the script caches the home page preview
for five minutes, and video thumbnails take a moment to generate).

**The home page preview** shows the four newest files in the public folder. It
is decorative — if the script is unreachable the strip just stays hidden and
the card keeps its heading and link.

**The gallery grids** are built the same way, from `?action=list&folder=...`.
Only the folders named in `LISTABLE_FOLDERS` can be read through the endpoint,
and each one has to be shared "anyone with the link" — the browser loads the
thumbnails straight from Drive, so a private folder shows nothing to a
signed-out guest. Note that the top-level Spruce Lodge folder is deliberately
not listed: it holds our own paperwork, so `spruce` names the two photo
subfolders instead.

A key can name **several folders**, as `spruce` does. They are merged into one
gallery, newest first, and the panel gets one "open in Drive" button per
folder, labelled with the folder's name. To add another source, add its ID to
the array and redeploy.

If a listing fails, the panel falls back to the embedded Drive folder view in
the HTML. Thumbnails load a few at a time and retry before giving up, so the
fallback only returns if every thumbnail in a panel fails.

**Seeing who sent what:** the uploader's name is prefixed onto the filename,
so sorting the folder by name groups uploads by person. It's also in each
file's description, and stored as machine-readable custom properties
(`uploadedBy`, `uploadedAt`, `originalName`).

---

## Things worth knowing

**The endpoint is public by design.** The `/exec` URL is visible in the page
source. `ALLOWED_ORIGINS` stops it being embedded on someone else's page, but
it isn't a real access control — anyone determined can POST to it directly.
Backstops: the 2 GB per-file cap, the image/video-only check, the hourly
`sweepInbox` re-check, and the 300-uploads-per-hour circuit breaker in
`MAX_FILES_PER_HOUR`. For a wedding site that's proportionate. If you ever need
to shut it off, either **Deploy → Manage deployments → Archive**, or blank out
`uploadEndpoint` in `config.js`.

**File size.** Drive's own limits are 5 TB per file and 750 GB uploaded per
day, neither of which a wedding will get near. The 10 GB cap in
`MAX_FILE_BYTES` is ours, not Google's — it only stops one enormous file
eating the account's storage. Change the number and redeploy to move it (and
match `MAX_BYTES` in `../upload.js` plus the hint text in `../upload.html`).
The real constraint is storage, below.

**Storage is yours.** Uploads count against your Google account's quota. A
hundred guests uploading videos will eat through a free 15 GB tier quickly —
worth checking your available space beforehand. The upload page points guests
at photos@jackson-rachel.com if a file refuses to go through.

**Big files don't pass through the script.** For each file, the script asks
Drive for a resumable upload session and hands the URL to the browser, which
uploads directly to Google. This is what makes phone videos work; posting bytes
through Apps Script would cap out around 30–50 MB. Files under 25 MB have a
fallback path through the script if the direct route ever fails.

**Editing `Code.gs` later requires a redeploy.** Use **Deploy → Manage
deployments → edit (pencil) → Version: New version**. Creating a brand-new
deployment instead gives you a *different* URL, which you'd then have to paste
into `config.js`.
