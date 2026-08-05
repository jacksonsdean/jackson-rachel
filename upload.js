/*
 * Guest photo/video uploader.
 *
 * Flow, per file:
 *   1. Ask the Apps Script web app to open a Google Drive resumable upload
 *      session for this file (POST, action: "start").
 *   2. PUT the bytes straight from the browser to the session URL Google
 *      hands back. Nothing large ever passes through Apps Script, so phone
 *      videos of any realistic size work and we get a real progress bar.
 *   3. If the resumable path fails outright and the file is small, fall back
 *      to posting it base64-encoded through the script itself.
 *
 * The uploader's name is attached to every file as the Drive description and
 * as custom file properties, and is prefixed onto the filename.
 */
(function () {
  "use strict";

  var CONFIG = window.WEDDING_CONFIG || {};
  var ENDPOINT = (CONFIG.uploadEndpoint || "").trim();

  var MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB, matches the Apps Script cap
  var MAX_FILES = 40; // per batch, keeps a stray folder-drop from flooding us
  var FALLBACK_MAX_BYTES = 25 * 1024 * 1024; // base64 fallback ceiling
  var MAX_ATTEMPTS = 3;
  var NAME_KEY = "wedding-uploader-name";

  /* Browsers hand back an empty type for some HEIC/MOV files, so we keep an
   * extension map as a second opinion. Kept in sync with the Apps Script. */
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

  var form = document.getElementById("upload-form");
  var unavailable = document.getElementById("upload-unavailable");
  var nameInput = document.getElementById("uploader-name");
  var nameError = document.getElementById("name-error");
  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var fileList = document.getElementById("file-list");
  var uploadButton = document.getElementById("upload-button");
  var statusLine = document.getElementById("upload-status");

  var items = [];
  var nextId = 0;
  var busy = false;

  /* ---------------------------------------------------------------- setup */

  function init() {
    if (!ENDPOINT) {
      unavailable.hidden = false;
      return;
    }
    form.hidden = false;

    try {
      var saved = window.localStorage.getItem(NAME_KEY);
      if (saved) nameInput.value = saved;
    } catch (err) {
      /* private browsing, nothing to restore */
    }

    nameInput.addEventListener("input", function () {
      nameError.hidden = true;
      syncButton();
    });

    dropzone.addEventListener("click", function () {
      fileInput.click();
    });
    dropzone.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener("change", function () {
      addFiles(fileInput.files);
      fileInput.value = "";
    });

    ["dragenter", "dragover"].forEach(function (type) {
      dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        dropzone.classList.add("is-dragging");
      });
    });
    ["dragleave", "drop"].forEach(function (type) {
      dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        dropzone.classList.remove("is-dragging");
      });
    });
    dropzone.addEventListener("drop", function (event) {
      if (event.dataTransfer && event.dataTransfer.files) {
        addFiles(event.dataTransfer.files);
      }
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      startUploads();
    });

    window.addEventListener("beforeunload", function (event) {
      if (!busy) return undefined;
      event.preventDefault();
      event.returnValue = "";
      return "";
    });
  }

  /* ------------------------------------------------------------ selection */

  function extensionOf(filename) {
    var match = /\.([A-Za-z0-9]+)$/.exec(filename || "");
    return match ? match[1].toLowerCase() : "";
  }

  function resolveType(file) {
    var type = (file.type || "").toLowerCase();
    if (type.indexOf("image/") === 0 || type.indexOf("video/") === 0) {
      return type;
    }
    return EXTENSION_TYPES[extensionOf(file.name)] || "";
  }

  function describeProblem(file) {
    if (file.size === 0) return "This file looks empty.";
    if (file.size > MAX_BYTES) return "Too big — the limit is 2 GB per file.";
    if (!resolveType(file)) return "Only photos and videos, please.";
    return "";
  }

  function addFiles(fileArray) {
    var added = 0;
    var rejected = 0;

    Array.prototype.forEach.call(fileArray, function (file) {
      if (items.length >= MAX_FILES) {
        rejected += 1;
        return;
      }
      var duplicate = items.some(function (item) {
        return (
          item.file.name === file.name &&
          item.file.size === file.size &&
          item.file.lastModified === file.lastModified
        );
      });
      if (duplicate) return;

      var problem = describeProblem(file);
      items.push({
        id: nextId++,
        file: file,
        mimeType: resolveType(file) || "application/octet-stream",
        state: problem ? "rejected" : "ready",
        message: problem,
        progress: 0,
      });
      if (problem) rejected += 1;
      else added += 1;
    });

    render();
    syncButton();

    if (items.length >= MAX_FILES) {
      setStatus(
        "That is the most we can take in one go (" +
          MAX_FILES +
          "). Upload these, then start another batch.",
        "warn"
      );
    } else if (rejected && !added) {
      setStatus("Nothing added — see the notes below.", "warn");
    } else {
      setStatus("");
    }
  }

  function removeItem(id) {
    items = items.filter(function (item) {
      return item.id !== id;
    });
    render();
    syncButton();
  }

  /* -------------------------------------------------------------- display */

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    var units = ["KB", "MB", "GB"];
    var value = bytes / 1024;
    var unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return (value >= 10 ? Math.round(value) : value.toFixed(1)) + " " + units[unit];
  }

  var STATE_LABELS = {
    ready: "Ready",
    uploading: "Uploading",
    done: "Uploaded",
    failed: "Failed",
    rejected: "Skipped",
  };

  function render() {
    fileList.innerHTML = "";

    items.forEach(function (item) {
      var row = document.createElement("li");
      row.className = "file-row is-" + item.state;

      var head = document.createElement("div");
      head.className = "file-head";

      var name = document.createElement("span");
      name.className = "file-name";
      name.textContent = item.file.name;

      var meta = document.createElement("span");
      meta.className = "file-meta";
      meta.textContent =
        formatSize(item.file.size) + " · " + STATE_LABELS[item.state];

      head.appendChild(name);
      head.appendChild(meta);
      row.appendChild(head);

      if (item.state === "uploading" || item.state === "done") {
        var track = document.createElement("div");
        track.className = "progress-track";
        var bar = document.createElement("div");
        bar.className = "progress-bar";
        bar.style.width = Math.round(item.progress * 100) + "%";
        track.appendChild(bar);
        row.appendChild(track);
      }

      if (item.message) {
        var note = document.createElement("p");
        note.className = "file-note";
        note.textContent = item.message;
        row.appendChild(note);
      }

      if (item.state !== "uploading" && item.state !== "done") {
        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "file-remove";
        remove.setAttribute("aria-label", "Remove " + item.file.name);
        remove.textContent = "×";
        remove.addEventListener("click", function () {
          removeItem(item.id);
        });
        row.appendChild(remove);
      }

      fileList.appendChild(row);
    });
  }

  function updateProgress(item, fraction) {
    item.progress = Math.max(0, Math.min(1, fraction));
    var row = fileList.children[items.indexOf(item)];
    if (!row) return;
    var bar = row.querySelector(".progress-bar");
    if (bar) bar.style.width = Math.round(item.progress * 100) + "%";
  }

  function setStatus(text, tone) {
    statusLine.textContent = text || "";
    statusLine.className = "upload-status" + (tone ? " is-" + tone : "");
  }

  function syncButton() {
    var pending = items.filter(function (item) {
      return item.state === "ready" || item.state === "failed";
    });
    uploadButton.disabled = busy || pending.length === 0;
    uploadButton.textContent =
      pending.length > 1 ? "Upload " + pending.length + " files" : "Upload";
  }

  /* ------------------------------------------------------------ transport */

  function callScript(payload) {
    /* text/plain keeps this a "simple" CORS request. Anything else triggers a
     * preflight, and Apps Script web apps cannot answer OPTIONS. */
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    })
      .then(function (response) {
        return response.text();
      })
      .then(function (text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (err) {
          throw new Error("Unexpected response from the upload service.");
        }
        if (!data.ok) throw new Error(data.error || "Upload was refused.");
        return data;
      });
  }

  function openSession(item, uploader) {
    return callScript({
      action: "start",
      uploader: uploader,
      filename: item.file.name,
      mimeType: item.mimeType,
      size: item.file.size,
      origin: window.location.origin,
    }).then(function (data) {
      return data.uploadUrl;
    });
  }

  /* Ask Google how much of the file it already has, so a dropped connection
   * resumes instead of starting over. Returns a byte offset. */
  function resumeOffset(uploadUrl, size) {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Range", "bytes */" + size);
      xhr.onload = function () {
        if (xhr.status === 200 || xhr.status === 201) {
          resolve(size);
          return;
        }
        var range = xhr.getResponseHeader("Range");
        var match = range && /bytes=0-(\d+)/.exec(range);
        resolve(match ? parseInt(match[1], 10) + 1 : 0);
      };
      xhr.onerror = function () {
        resolve(0);
      };
      xhr.send(null);
    });
  }

  function putBytes(uploadUrl, item, offset) {
    return new Promise(function (resolve, reject) {
      var file = item.file;
      var xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl, true);
      if (offset > 0) {
        xhr.setRequestHeader(
          "Content-Range",
          "bytes " + offset + "-" + (file.size - 1) + "/" + file.size
        );
      }
      xhr.upload.onprogress = function (event) {
        if (event.lengthComputable) {
          updateProgress(item, (offset + event.loaded) / file.size);
        }
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          updateProgress(item, 1);
          resolve();
        } else {
          reject(new Error("Google returned " + xhr.status + "."));
        }
      };
      xhr.onerror = function () {
        reject(new Error("The connection dropped."));
      };
      xhr.onabort = function () {
        reject(new Error("Upload was interrupted."));
      };
      xhr.send(offset > 0 ? file.slice(offset) : file);
    });
  }

  function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || "");
        var comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = function () {
        reject(new Error("Could not read the file."));
      };
      reader.readAsDataURL(file);
    });
  }

  /* Last resort for small files if the resumable path is blocked entirely. */
  function directUpload(item, uploader) {
    return readAsBase64(item.file).then(function (base64) {
      updateProgress(item, 0.5);
      return callScript({
        action: "direct",
        uploader: uploader,
        filename: item.file.name,
        mimeType: item.mimeType,
        size: item.file.size,
        dataBase64: base64,
        origin: window.location.origin,
      }).then(function () {
        updateProgress(item, 1);
      });
    });
  }

  function uploadOne(item, uploader) {
    var attempt = 0;
    var session = null;

    function tryOnce() {
      attempt += 1;
      var opening = session
        ? resumeOffset(session, item.file.size).then(function (offset) {
            return { url: session, offset: offset };
          })
        : openSession(item, uploader).then(function (url) {
            session = url;
            return { url: url, offset: 0 };
          });

      return opening.then(function (start) {
        if (start.offset >= item.file.size) return undefined;
        return putBytes(start.url, item, start.offset);
      });
    }

    function attemptLoop() {
      return tryOnce().catch(function (error) {
        if (attempt < MAX_ATTEMPTS) {
          item.message = "Hit a snag, retrying…";
          render();
          return new Promise(function (resolve) {
            window.setTimeout(resolve, 1200 * attempt);
          }).then(attemptLoop);
        }
        throw error;
      });
    }

    return attemptLoop().catch(function (error) {
      if (item.file.size <= FALLBACK_MAX_BYTES) {
        item.message = "Trying a slower route…";
        render();
        return directUpload(item, uploader);
      }
      throw error;
    });
  }

  /* ----------------------------------------------------------------- run */

  function startUploads() {
    var uploader = nameInput.value.trim().replace(/\s+/g, " ");
    if (!uploader) {
      nameError.hidden = false;
      nameInput.focus();
      return;
    }
    try {
      window.localStorage.setItem(NAME_KEY, uploader);
    } catch (err) {
      /* not important enough to interrupt an upload */
    }

    var queue = items.filter(function (item) {
      return item.state === "ready" || item.state === "failed";
    });
    if (!queue.length) return;

    busy = true;
    nameInput.disabled = true;
    syncButton();

    var succeeded = 0;
    var failed = 0;

    /* One at a time: phone uploads over lodge wifi are far more reliable
     * serially than in parallel. */
    var chain = Promise.resolve();
    queue.forEach(function (item, index) {
      chain = chain.then(function () {
        item.state = "uploading";
        item.message = "";
        item.progress = 0;
        render();
        setStatus("Uploading " + (index + 1) + " of " + queue.length + "…");

        return uploadOne(item, uploader).then(
          function () {
            item.state = "done";
            item.message = "";
            succeeded += 1;
            render();
          },
          function (error) {
            item.state = "failed";
            item.message = error.message || "Something went wrong.";
            failed += 1;
            render();
          }
        );
      });
    });

    chain.then(function () {
      busy = false;
      nameInput.disabled = false;
      syncButton();

      if (failed && succeeded) {
        setStatus(
          succeeded +
            " uploaded, " +
            failed +
            " did not make it. Tap Upload again to retry those.",
          "warn"
        );
      } else if (failed) {
        setStatus(
          "Those did not go through. Check your connection and tap Upload again.",
          "error"
        );
      } else {
        setStatus(
          "Thank you! " +
            succeeded +
            (succeeded === 1 ? " file is" : " files are") +
            " on the way to us.",
          "success"
        );
      }
    });
  }

  init();
})();
