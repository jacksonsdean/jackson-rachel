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

  var strip = document.getElementById("gallery-preview");
  if (!strip || !ENDPOINT) return;

  function thumbnailUrl(id) {
    return (
      "https://drive.google.com/thumbnail?id=" + encodeURIComponent(id) + "&sz=w640"
    );
  }

  fetch(ENDPOINT + "?action=preview&limit=" + TILE_COUNT)
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      if (!data.ok || !data.files || !data.files.length) return;

      data.files.forEach(function (file) {
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

      /* Revealed up front, not on first load: the tiles have a placeholder
       * gradient to fade from, and images inside a hidden element never
       * start loading in the first place. */
      strip.hidden = false;
    })
    .catch(function () {
      /* Preview is decorative — the card still works without it. */
    });
})();
