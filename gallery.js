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

    if (item.kind === "video") {
      var frame = document.createElement("iframe");
      frame.className = "lightbox-media is-video";
      frame.setAttribute("allow", "autoplay; fullscreen");
      frame.setAttribute("allowfullscreen", "");
      frame.title = displayName(item.name);
      frame.src = previewUrl(item.id);
      state.stage.appendChild(frame);
    } else {
      var image = document.createElement("img");
      image.className = "lightbox-media";
      image.alt = displayName(item.name);
      image.src = thumbUrl(item.id, 1600);
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

  function fillPanel(panel, files) {
    var wall = panel.querySelector(".photo-wall");
    var fallback = panel.querySelector(".gallery-fallback");
    if (!wall) return;

    files.forEach(function (file, index) {
      var tile = document.createElement("button");
      tile.type = "button";
      tile.className = "photo-tile" + (file.kind === "video" ? " is-video" : "");
      tile.setAttribute("aria-label", "Open " + displayName(file.name));

      var image = document.createElement("img");
      image.loading = index < 8 ? "eager" : "lazy";
      image.alt = "";
      image.addEventListener("load", function () {
        tile.classList.add("is-loaded");
      });
      image.addEventListener("error", function () {
        tile.remove();
      });
      image.src = thumbUrl(file.id, 600);

      tile.appendChild(image);
      tile.addEventListener("click", function () {
        open(files, index);
      });
      wall.appendChild(tile);
    });

    wall.hidden = false;
    if (fallback) fallback.hidden = true;
  }

  function load(panel) {
    var folder = panel.getAttribute("data-gallery-folder");
    var limit = panel.getAttribute("data-gallery-limit") || 120;

    fetch(
      ENDPOINT +
        "?action=list&folder=" +
        encodeURIComponent(folder) +
        "&limit=" +
        encodeURIComponent(limit)
    )
      .then(function (response) {
        return response.json();
      })
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
        fillPanel(panel, data.files);
      })
      .catch(function () {
        /* Same as a failed listing — keep the fallback. */
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
