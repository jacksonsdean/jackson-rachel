# Guest photo drop box — setup

Guests upload photos and videos from `upload.html` without signing in to
anything. A Google Apps Script web app receives the request, and files land in
your Google Drive.

Roughly 15 minutes of clicking. Nothing here needs to be redeployed once it
works.

---

## 1. Make two Drive folders

In Google Drive, create:

| Folder | Sharing | Purpose |
| --- | --- | --- |
| **Wedding Uploads (Inbox)** | **Private** — do not share | Where guest uploads land. Nobody but you can see it. |
| **Wedding Guest Photos** | **Anyone with the link → Viewer** | What the website shows. You move the good stuff here. |

Two folders is the whole moderation story: an upload is never publicly visible
until you move it, so one bad file can't end up on the site.

Grab each folder's ID from its URL — the long string after `/folders/`:

```
https://drive.google.com/drive/folders/1qmCJA5mvrrd460VDr8Zt2z7eJ9CQMUVm
                                       └──────── this part ────────┘
```

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
6. At the top of `Code.gs`, set `INBOX_FOLDER_ID` to the **inbox** folder ID
   from step 1. Leave `ALLOWED_ORIGINS` alone unless the site moves domains.
7. Save.

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

If `configured` is `false`, you missed step 2.6.

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

Edit [`../config.js`](../config.js) in this repo:

```js
window.WEDDING_CONFIG = {
  uploadEndpoint: "https://script.google.com/macros/s/AKfycb.../exec",
  guestPhotosFolderId: "1AbC...",  // the PUBLIC folder from step 1
};
```

Commit and push. Until `uploadEndpoint` is filled in, the upload page shows a
polite "not ready yet" message instead of a broken form, and the guest gallery
section stays hidden — so it is safe to merge before you've done any of this.

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
(Drive's embedded folder view caches, and video thumbnails take a moment to
generate).

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

**Storage is yours.** Uploads count against your Google account's quota. A
hundred guests uploading videos will eat through a free 15 GB tier quickly —
worth checking your available space beforehand.

**Big files don't pass through the script.** For each file, the script asks
Drive for a resumable upload session and hands the URL to the browser, which
uploads directly to Google. This is what makes phone videos work; posting bytes
through Apps Script would cap out around 30–50 MB. Files under 25 MB have a
fallback path through the script if the direct route ever fails.

**Editing `Code.gs` later requires a redeploy.** Use **Deploy → Manage
deployments → edit (pencil) → Version: New version**. Creating a brand-new
deployment instead gives you a *different* URL, which you'd then have to paste
into `config.js`.
