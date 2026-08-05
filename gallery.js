/*
 * Builds the photo grids on the gallery page and gives them a lightbox.
 *
 * Any element with [data-gallery-folder] gets filled with tiles listed from
 * that Drive folder via the Apps Script endpoint. Clicking a tile opens a
 * larger view with left/right navigation, the file's name, and a position
 * counter. Keyboard arrows, Escape, and horizontal swipes all work.
 *
 * If the listing is unavailable for any reason the panel is left exactly as
 * the HTML has it — an embedded Drive folder view — so the gallery degrades
 * to something that still works rather than to an empty box.
 */
(function () {
  "use strict";

  var CONFIG = window.WEDDING_CONFIG || {};
  var ENDPOINT = (CONFIG.uploadEndpoint || "").trim();

  var panels = Array.prototype.slice.call(
    document.querySelectorAll("[data-gallery-folder]")
  );
  if (!ENDPOINT || !panels.length) return;

  function thumbUrl(id, width) {
    return (
      "https://drive.google.com/thumbnail?id=" +
      encodeURIComponent(id) +
      "&sz=w" +
      width
    );
  }

  function previewUrl(id) {
    return "https://drive.google.com/file/d/" + encodeURIComponent(id) + "/preview";
  }

  /* "Kristy Matthes - IMG_0042.jpg" reads better as "Kristy Matthes - IMG_0042" */
  function displayName(name) {
    return String(name || "").replace(/\.[A-Za-z0-9]+$/, "");
  }

  /* ---------------------------------------------------------------- lightbox */

  var lightbox = null;

  function buildLightbox() {
    var root = document.createElement("div");
    root.className = "lightbox";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Photo viewer");
    root.hidden = true;
    root.innerHTML =
      '<button class="lightbox-button lightbox-close" type="button" aria-label="Close">&times;</button>' +
      '<button class="lightbox-button lightbox-nav is-prev" type="button" aria-label="Previous">&lsaquo;</button>' +
      '<button class="lightbox-button lightbox-nav is-next" type="button" aria-label="Next">&rsaquo;</button>' +
      '<figure class="lightbox-figure">' +
      '<div class="lightbox-stage"></div>' +
      '<figcaption class="lightbox-caption">' +
      '<span class="lightbox-name"></span>' +
      '<span class="lightbox-count"></span>' +
      "</figcaption>" +
      "</figure>";
    document.body.appendChild(root);

    var state = {
      root: root,
      stage: root.querySelector(".lightbox-stage"),
      name: root.querySelector(".lightbox-name"),
      count: root.querySelector(".lightbox-count"),
      prev: root.querySelector(".is-prev"),
      next: root.querySelector(".is-next"),
      close: root.querySelector(".lightbox-close"),
      items: [],
      index: 0,
      lastFocus: null,
    };

    state.prev.addEventListener("click", function () {
      step(state, -1);
    });
    state.next.addEventListener("click", function () {
      step(state, 1);
    });
    state.close.addEventListener("click", function () {
      close(state);
    });
    root.addEventListener("click", function (event) {
      /* Clicking the backdrop closes; clicking the photo itself does not. */
      if (event.target === root || event.target === state.stage) close(state);
    });

    document.addEventListener("keydown", function (event) {
      if (root.hidden) return;
      if (event.key === "Escape") close(state);
      else if (event.key === "ArrowLeft") step(state, -1);
      else if (event.key === "ArrowRight") step(state, 1);
    });

    var touchX = null;
    root.addEventListener(
      "touchstart",
      function (event) {
        touchX = event.changedTouches[0].clientX;
      },
      { passive: true }
    );
    root.addEventListener(
      "touchend",
      function (event) {
        if (touchX === null) return;
        var dx = event.changedTouches[0].clientX - touchX;
        touchX = null;
        if (Math.abs(dx) > 50) step(state, dx < 0 ? 1 : -1);
      },
      { passive: true }
    );

    return state;
  }

  function render(state) {
    var item = state.items[state.index];
    state.stage.innerHTML = "";
    state.stage.classList.add("is-loading");

    if (item.kind === "video") {
      var frame = document.createElement("iframe");
      frame.className = "lightbox-media is-video";
      frame.setAttribute("allow", "autoplay; fullscreen");
      frame.setAttribute("allowfullscreen", "");
      frame.title = displayName(item.name);
      frame.addEventListener("load", function () {
        state.stage.classList.remove("is-loading");
      });
      frame.src = previewUrl(item.id);
      state.stage.appendChild(frame);
    } else {
      var image = document.createElement("img");
      image.className = "lightbox-media";
      image.alt = displayName(item.name);

      /* Show the grid's thumbnail first — it is already in cache, so it
       * appears instantly — then swap in the full-size one behind the
       * spinner. */
      image.src = thumbUrl(item.id, 600);

      var full = new Image();
      full.addEventListener("load", function () {
        if (state.items[state.index] !== item) return; /* moved on already */
        image.src = full.src;
        state.stage.classList.remove("is-loading");
      });
      full.addEventListener("error", function () {
        state.stage.classList.remove("is-loading");
      });
      full.src = thumbUrl(item.id, 1600);

      state.stage.appendChild(image);
    }

    state.name.textContent = displayName(item.name);
    state.count.textContent = state.index + 1 + " / " + state.items.length;

    var single = state.items.length < 2;
    state.prev.hidden = single;
    state.next.hidden = single;

    /* Warm the neighbours so arrowing through does not flash. */
    [state.index - 1, state.index + 1].forEach(function (i) {
      var neighbour = state.items[(i + state.items.length) % state.items.length];
      if (neighbour && neighbour.kind !== "video") {
        new Image().src = thumbUrl(neighbour.id, 1600);
      }
    });
  }

  function step(state, delta) {
    if (state.items.length < 2) return;
    state.index =
      (state.index + delta + state.items.length) % state.items.length;
    render(state);
  }

  function open(items, index) {
    if (!lightbox) lightbox = buildLightbox();
    lightbox.items = items;
    lightbox.index = index;
    lightbox.lastFocus = document.activeElement;
    lightbox.root.hidden = false;
    document.body.classList.add("has-lightbox");
    render(lightbox);
    lightbox.close.focus();
  }

  function close(state) {
    state.root.hidden = true;
    state.stage.innerHTML = ""; /* stops any playing video */
    document.body.classList.remove("has-lightbox");
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  /* ------------------------------------------------------------------ grids */

  /*
   * Drive is slow to hand over thumbnails and gets slower the more you ask for
   * at once, so tiles go up immediately as shimmering placeholders and their
   * images are fetched a few at a time. A thumbnail that fails is retried
   * before it is given up on — a single dropped request should never cost us
   * a photo, and it certainly should not cost us the gallery.
   */
  var MAX_CONCURRENT_IMAGES = 6;
  var MAX_IMAGE_ATTEMPTS = 3;
  var MAX_LIST_ATTEMPTS = 3;

  function loadImage(file, tile, image, done) {
    var attempt = 0;

    function attemptLoad() {
      attempt += 1;
      image.src = thumbUrl(file.id, 600);
    }

    image.addEventListener("load", function () {
      tile.classList.add("is-loaded");
      done(true);
    });

    image.addEventListener("error", function () {
      if (attempt < MAX_IMAGE_ATTEMPTS) {
        window.setTimeout(attemptLoad, 800 * attempt * attempt);
        return;
      }
      tile.classList.add("is-failed");
      done(false);
    });

    attemptLoad();
  }

  /** Runs jobs a few at a time; calls back with how many failed. */
  function runQueue(jobs, limit, whenDone) {
    var started = 0;
    var finished = 0;
    var failed = 0;
    var active = 0;

    function pump() {
      while (active < limit && started < jobs.length) {
        active += 1;
        jobs[started++](function (ok) {
          active -= 1;
          finished += 1;
          if (!ok) failed += 1;
          if (finished === jobs.length) whenDone(failed);
          else pump();
        });
      }
    }

    if (!jobs.length) whenDone(0);
    else pump();
  }

  /* A gallery built from several Drive folders cannot have one "open in
   * Drive" button, so give it one per folder, named after the folder. */
  function fillActions(panel, sources) {
    if (!sources || sources.length < 2) return;
    var actions = panel.querySelector(".gallery-actions");
    if (!actions) return;

    actions.innerHTML = "";
    sources.forEach(function (source) {
      var link = document.createElement("a");
      link.className = "button";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.href =
        "https://drive.google.com/drive/folders/" + encodeURIComponent(source.id);
      link.textContent = source.name;
      actions.appendChild(link);
    });
  }

  function fillPanel(panel, files) {
    var wall = panel.querySelector(".photo-wall");
    var fallback = panel.querySelector(".gallery-fallback");
    if (!wall) return;

    var tiles = [];
    var jobs = files.map(function (file, index) {
      var tile = document.createElement("button");
      tile.type = "button";
      tile.className = "photo-tile" + (file.kind === "video" ? " is-video" : "");
      tile.setAttribute("aria-label", "Open " + displayName(file.name));

      var image = document.createElement("img");
      image.alt = "";

      tile.appendChild(image);
      tile.addEventListener("click", function () {
        open(files, index);
      });
      wall.appendChild(tile);
      tiles.push(tile);

      return function (done) {
        loadImage(file, tile, image, done);
      };
    });

    /* Placeholders are up, so the Drive view has nothing left to do. */
    wall.hidden = false;
    if (fallback) fallback.hidden = true;

    runQueue(jobs, MAX_CONCURRENT_IMAGES, function (failed) {
      if (failed === jobs.length) {
        /* Every single thumbnail failed — Drive is genuinely unreachable, so
         * put the embedded folder view back rather than show an empty wall. */
        wall.hidden = true;
        wall.innerHTML = "";
        if (fallback) fallback.hidden = false;
        return;
      }
      tiles.forEach(function (tile) {
        if (tile.classList.contains("is-failed")) tile.remove();
      });
    });
  }

  function fetchListing(url, attempts) {
    return fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .catch(function (error) {
        if (attempts <= 1) throw error;
        return new Promise(function (resolve) {
          window.setTimeout(resolve, 1000 * (MAX_LIST_ATTEMPTS - attempts + 1));
        }).then(function () {
          return fetchListing(url, attempts - 1);
        });
      });
  }

  function load(panel) {
    var folder = panel.getAttribute("data-gallery-folder");
    var limit = panel.getAttribute("data-gallery-limit") || 120;

    fetchListing(
      ENDPOINT +
        "?action=list&folder=" +
        encodeURIComponent(folder) +
        "&limit=" +
        encodeURIComponent(limit),
      MAX_LIST_ATTEMPTS
    )
      .then(function (data) {
        /* Listing failed: leave the embedded Drive folder view in place. */
        if (!data.ok || !data.files) return;

        /* Listing worked and the folder is empty: hide the panel outright.
         * An empty Drive iframe is worse than no section at all. */
        if (!data.files.length) {
          panel.hidden = true;
          return;
        }

        panel.hidden = false;
        fillActions(panel, data.sources);
        fillPanel(panel, data.files);
      })
      .catch(function () {
        /* Out of retries — keep the fallback. */
      });
  }

  panels.forEach(function (panel) {
    var details = panel.querySelector("details");

    /* A collapsed section loads nothing until it is opened. Beyond saving the
     * work, it keeps a page with several galleries from asking Drive for
     * every thumbnail at once. */
    if (details && !details.open) {
      details.addEventListener("toggle", function onOpen() {
        if (!details.open) return;
        details.removeEventListener("toggle", onOpen);
        load(panel);
      });
      return;
    }

    load(panel);
  });
})();
