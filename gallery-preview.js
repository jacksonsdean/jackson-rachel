/*
 * Fills the home page preview strip with the newest few photos from the
 * public guest gallery folder.
 *
 * The Apps Script endpoint does the folder listing (a static page has no way
 * to enumerate a Drive folder), and the thumbnails come straight from Drive.
 * If any of that is unavailable the strip simply stays hidden and the card
 * keeps its heading and link.
 */
(function () {
  "use strict";

  var CONFIG = window.WEDDING_CONFIG || {};
  var ENDPOINT = (CONFIG.uploadEndpoint || "").trim();
  var TILE_COUNT = 4;
  var MAX_ATTEMPTS = 3;
  /* Matches the guest gallery's limit, so both pages share one cache entry
   * in the script rather than each warming their own. */
  var PREVIEW_POOL = 300;

  var strip = document.getElementById("gallery-preview");
  if (!strip || !ENDPOINT) return;

  function thumbnailUrl(id) {
    return (
      "https://drive.google.com/thumbnail?id=" + encodeURIComponent(id) + "&sz=w640"
    );
  }

  function hideStrip() {
    strip.innerHTML = "";
    strip.hidden = true;
  }

  /* Put shimmering stand-ins up before the request goes out. They hold the
   * card's final height, so the page does not lurch when the photos land. */
  for (var i = 0; i < TILE_COUNT; i += 1) {
    var placeholder = document.createElement("div");
    placeholder.className = "preview-tile";
    strip.appendChild(placeholder);
  }
  strip.hidden = false;

  /*
   * We want the first four photos anyone sent us, not the latest four.
   * The endpoint only returns newest-first, so ask for the whole folder and
   * take the tail: those are the earliest uploads, and because the list is
   * newest-first they arrive in the order we want to show them — the very
   * first upload last, at the right on a wide screen and the bottom on a
   * narrow one.
   */
  fetch(ENDPOINT + "?action=list&folder=guests&limit=" + PREVIEW_POOL)
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      if (!data.ok || !data.files || !data.files.length) {
        hideStrip();
        return;
      }

      strip.innerHTML = ""; /* clear the skeletons */

      data.files.slice(-TILE_COUNT).forEach(function (file) {
        var tile = document.createElement("div");
        tile.className = "preview-tile";

        var image = document.createElement("img");
        image.alt = "";

        /* Drive can be slow, and occasionally drops a request outright. The
         * tile shimmers until its image lands and retries before giving up,
         * rather than vanishing at the first failure. */
        var attempt = 0;
        function attemptLoad() {
          attempt += 1;
          image.src = thumbnailUrl(file.id);
        }
        image.addEventListener("load", function () {
          tile.classList.add("is-loaded");
        });
        image.addEventListener("error", function () {
          if (attempt < MAX_ATTEMPTS) {
            window.setTimeout(attemptLoad, 800 * attempt * attempt);
            return;
          }
          tile.remove();
        });
        attemptLoad();

        tile.appendChild(image);
        strip.appendChild(tile);
      });
    })
    .catch(function () {
      /* Preview is decorative — the card still works without it. */
      hideStrip();
    });
})();
