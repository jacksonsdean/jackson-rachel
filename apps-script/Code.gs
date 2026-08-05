/**
 * Guest photo/video drop box for the wedding site.
 *
 * Deployed as a web app that executes as YOU and is accessible to ANYONE
 * (including anonymous visitors). Guests never sign in — the script writes to
 * your Drive using your own permissions.
 *
 * The heavy lifting is deliberately NOT done here: for each file the script
 * opens a Drive resumable upload session and hands the session URL back to the
 * browser, which PUTs the bytes directly to Google. That sidesteps the Apps
 * Script payload limit, so multi-hundred-megabyte phone videos work.
 *
 * See README.md in this folder for setup.
 */

var CONFIG = {
  /* The PRIVATE folder guests upload into. Guests cannot read it — you move
   * approved files into the public folder yourself. */
  INBOX_FOLDER_ID: "1WikYF5aLxqL1ji4b_AKw1ir80um15Mm_",

  /* Folders the site may list, by key. A key can name more than one folder,
   * in which case they are merged into a single gallery, newest first. All
   * must be shared "anyone with the link", since the browser loads their
   * thumbnails directly. Anything not in here cannot be read through this
   * endpoint — note that the top-level Spruce Lodge folder is deliberately
   * absent, since it holds our own paperwork. */
  LISTABLE_FOLDERS: {
    guests: ["110gCPE3_3fWf0DM-CaNE_MGPTt7wPQgg"],
    spruce: [
      "1lsBOh2_uYkF3BpZnkwAUHViKFSLnZhRn",
      "1Pc-Qao0j1gbqM3Tcn3sX7bpfhsTH8lyl",
    ],
  },
  MAX_LIST: 300,

  /* Origins allowed to use this endpoint. Keeps the URL from being used as a
   * free upload relay by someone else's page. */
  ALLOWED_ORIGINS: [
    "https://jackson-rachel.com",
    "https://www.jackson-rachel.com",
    "https://jacksonsdean.github.io",
  ],

  /* Drive itself allows 5 TB per file, so this is our own sanity ceiling
   * rather than a platform limit — it just stops one enormous file eating the
   * account's storage quota. Raise or lower it freely; the real constraint is
   * how much Drive space the account has. */
  MAX_FILE_BYTES: 10 * 1024 * 1024 * 1024, // 10 GB per file
  MAX_DIRECT_BYTES: 25 * 1024 * 1024, // ceiling for the base64 fallback path
  MAX_FILES_PER_HOUR: 300, // circuit breaker against abuse
  MAX_NAME_LENGTH: 60,
  PREVIEW_CACHE_SECONDS: 300,
};

/* Extensions we accept, and the type we assume when the browser reports none.
 * Kept in sync with EXTENSION_TYPES in upload.js. */
var EXTENSION_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  dng: "image/x-adobe-dng",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  webm: "video/webm",
  "3gp": "video/3gpp",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  hevc: "video/mp4",
};

/* -------------------------------------------------------------- endpoints */

/**
 * ?action=list&folder=guests&limit=200 lists a public folder so the site can
 * build its own photo grid. ?action=preview is the same thing with a small
 * default, used by the home page strip. With no action, it is a health check:
 * open the /exec URL in a browser and you should see ok: true.
 */
function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.action === "list" || params.action === "preview") {
    return jsonOutput_(
      listFolder_(
        params.folder || "guests",
        Number(params.limit) || (params.action === "preview" ? 4 : 60)
      )
    );
  }
  return jsonOutput_({
    ok: true,
    service: "wedding-uploads",
    configured: CONFIG.INBOX_FOLDER_ID.indexOf("PASTE_") !== 0,
  });
}

/**
 * Newest photos/videos in an allowlisted folder, as {id, name, kind}.
 * Cached, since every visitor asks for this and the folders change rarely.
 */
function listFolder_(folderKey, limit) {
  var entry = CONFIG.LISTABLE_FOLDERS[folderKey];
  if (!entry) return { ok: false, error: "Unknown folder." };

  var folderIds = [].concat(entry);
  limit = Math.max(1, Math.min(CONFIG.MAX_LIST, limit));

  /* The folder IDs are part of the key, so pointing a key at different
   * folders can never serve the previous folders' cached listing. */
  var cache = CacheService.getScriptCache();
  var key = "list-" + folderKey + "-" + folderIds.join("+") + "-" + limit;
  var cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  try {
    var found = [];
    var sources = [];
    var seen = {};

    folderIds.forEach(function (folderId) {
      var folder = DriveApp.getFolderById(folderId);
      sources.push({ id: folderId, name: folder.getName() });

      var files = folder.getFiles();
      while (files.hasNext()) {
        var file = files.next();
        var id = file.getId();
        if (seen[id]) continue; /* a file can live in both folders */
        seen[id] = true;

        var mimeType = String(file.getMimeType() || "");
        var isImage = mimeType.indexOf("image/") === 0;
        if (!isImage && mimeType.indexOf("video/") !== 0) continue;

        found.push({
          id: id,
          name: file.getName(),
          kind: isImage ? "image" : "video",
          created: file.getDateCreated().getTime(),
        });
      }
    });

    found.sort(function (a, b) {
      return b.created - a.created;
    });

    var payload = {
      ok: true,
      sources: sources,
      files: found.slice(0, limit).map(function (file) {
        return { id: file.id, name: file.name, kind: file.kind };
      }),
    };
    cache.put(key, JSON.stringify(payload), CONFIG.PREVIEW_CACHE_SECONDS);
    return payload;
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Could not read that folder." };
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput_({ ok: false, error: "Empty request." });
    }

    var request = JSON.parse(e.postData.contents);
    var origin = checkOrigin_(request.origin);

    if (CONFIG.INBOX_FOLDER_ID.indexOf("PASTE_") === 0) {
      return jsonOutput_({ ok: false, error: "Uploads are not set up yet." });
    }
    if (!underRateLimit_()) {
      return jsonOutput_({
        ok: false,
        error: "We are getting a lot of uploads right now. Please try again later.",
      });
    }

    var file = validate_(request);

    if (request.action === "start") {
      return jsonOutput_({ ok: true, uploadUrl: openSession_(file, origin) });
    }
    if (request.action === "direct") {
      return jsonOutput_({ ok: true, fileId: writeDirect_(file, request.dataBase64) });
    }
    return jsonOutput_({ ok: false, error: "Unknown action." });
  } catch (error) {
    console.error(error);
    return jsonOutput_({ ok: false, error: String(error.message || error) });
  }
}

/* ------------------------------------------------------------- validation */

function checkOrigin_(origin) {
  var candidate = String(origin || "").replace(/\/$/, "");
  if (!candidate) return CONFIG.ALLOWED_ORIGINS[0];
  if (CONFIG.ALLOWED_ORIGINS.indexOf(candidate) === -1) {
    throw new Error("This upload page is not authorized.");
  }
  return candidate;
}

/**
 * Validates the claimed metadata and returns the Drive metadata to create.
 * The browser controls everything here, so this is a first line of defence
 * only — sweepInbox() re-checks the type Drive actually detected.
 */
function validate_(request) {
  var uploader = cleanName_(request.uploader);
  if (!uploader) throw new Error("Please add your name.");

  var original = cleanFileName_(request.filename);
  if (!original) throw new Error("That file needs a name.");

  var size = Number(request.size);
  if (!isFinite(size) || size <= 0) throw new Error("That file looks empty.");
  if (size > CONFIG.MAX_FILE_BYTES) {
    throw new Error(
      "That file is over the " +
        Math.round(CONFIG.MAX_FILE_BYTES / (1024 * 1024 * 1024)) +
        " GB limit."
    );
  }

  var extension = extensionOf_(original);
  var claimed = String(request.mimeType || "").toLowerCase();
  var mimeType =
    claimed.indexOf("image/") === 0 || claimed.indexOf("video/") === 0
      ? claimed
      : EXTENSION_TYPES[extension] || "";

  if (!mimeType) throw new Error("Only photos and videos, please.");
  if (extension && !EXTENSION_TYPES[extension]) {
    throw new Error("That file type is not supported.");
  }

  var now = new Date();
  var stamp = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm"
  );

  return {
    uploader: uploader,
    size: size,
    mimeType: mimeType,
    metadata: {
      name: uploader + " - " + original,
      parents: [CONFIG.INBOX_FOLDER_ID],
      mimeType: mimeType,
      description: "Uploaded by " + uploader + " on " + stamp,
      properties: {
        uploadedBy: uploader,
        uploadedAt: now.toISOString(),
        originalName: original.slice(0, 100),
        source: "wedding-site",
      },
    },
  };
}

function cleanName_(value) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CONFIG.MAX_NAME_LENGTH);
}

function cleanFileName_(value) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\\/]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function extensionOf_(filename) {
  var match = /\.([A-Za-z0-9]+)$/.exec(filename || "");
  return match ? match[1].toLowerCase() : "";
}

/** Rolling hourly cap across all guests. */
function underRateLimit_() {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (error) {
    return true; // never block a real guest because of lock contention
  }
  try {
    var hour = Math.floor(new Date().getTime() / 3600000);
    var state = { hour: hour, count: 0 };
    var raw = props.getProperty("rateLimit");
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed.hour === hour) state = parsed;
    }
    if (state.count >= CONFIG.MAX_FILES_PER_HOUR) return false;
    state.count += 1;
    props.setProperty("rateLimit", JSON.stringify(state));
    return true;
  } finally {
    lock.releaseLock();
  }
}

/* ----------------------------------------------------------------- upload */

/**
 * Opens a Drive resumable upload session and returns its URL. The browser
 * uploads the bytes to that URL directly; they never touch this script.
 */
function openSession_(file, origin) {
  var response = UrlFetchApp.fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
    {
      method: "post",
      contentType: "application/json; charset=UTF-8",
      headers: {
        Authorization: "Bearer " + ScriptApp.getOAuthToken(),
        "X-Upload-Content-Type": file.mimeType,
        "X-Upload-Content-Length": String(file.size),
        /* Passing the guest's origin through makes Google issue a
         * CORS-enabled session URL the browser is allowed to PUT to. */
        Origin: origin,
      },
      payload: JSON.stringify(file.metadata),
      muteHttpExceptions: true,
    }
  );

  if (response.getResponseCode() !== 200) {
    console.error("Session start failed: " + response.getContentText());
    throw new Error("Could not start the upload. Please try again.");
  }

  var headers = response.getAllHeaders();
  var location = headers.Location || headers.location;
  if (Array.isArray(location)) location = location[0];
  if (!location) throw new Error("Could not start the upload. Please try again.");
  return location;
}

/** Fallback path for small files: the bytes come through the script. */
function writeDirect_(file, dataBase64) {
  if (file.size > CONFIG.MAX_DIRECT_BYTES) {
    throw new Error("That file is too big for this route.");
  }
  var bytes = Utilities.base64Decode(String(dataBase64 || ""));
  var blob = Utilities.newBlob(bytes, file.mimeType, file.metadata.name);
  var created = DriveApp.getFolderById(CONFIG.INBOX_FOLDER_ID).createFile(blob);
  created.setDescription(file.metadata.description);
  return created.getId();
}

/* ------------------------------------------------------------ maintenance */

/**
 * Re-checks what Drive actually detected each uploaded file to be, and moves
 * anything that is not a real image or video into a _quarantine subfolder.
 * A guest can lie about a MIME type in the request; they cannot lie to Drive.
 *
 * Set this to run hourly: Triggers -> Add Trigger -> sweepInbox, time-driven.
 */
function sweepInbox() {
  var inbox = DriveApp.getFolderById(CONFIG.INBOX_FOLDER_ID);
  var quarantine = childFolder_(inbox, "_quarantine");
  var files = inbox.getFiles();
  var moved = 0;

  while (files.hasNext()) {
    var file = files.next();
    var mimeType = String(file.getMimeType() || "");
    var isMedia =
      mimeType.indexOf("image/") === 0 || mimeType.indexOf("video/") === 0;
    if (!isMedia || file.getSize() === 0) {
      file.moveTo(quarantine);
      moved += 1;
    }
  }
  console.log("Swept inbox, quarantined " + moved + " file(s).");
}

function childFolder_(parent, name) {
  var existing = parent.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : parent.createFolder(name);
}

/* ---------------------------------------------------------------- helpers */

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
