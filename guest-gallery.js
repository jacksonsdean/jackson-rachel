/*
 * Reveals the guest photo gallery panel, but only once the public Drive
 * folder ID has been filled in in config.js. Until then the panel stays
 * hidden rather than rendering a broken iframe.
 */
(function () {
  "use strict";

  var folderId = ((window.WEDDING_CONFIG || {}).guestPhotosFolderId || "").trim();
  var panel = document.getElementById("guest-gallery-panel");
  if (!folderId || !panel) return;

  var frame = document.getElementById("guest-gallery-frame");
  var link = document.getElementById("guest-gallery-link");

  frame.src =
    "https://drive.google.com/embeddedfolderview?id=" +
    encodeURIComponent(folderId) +
    "#grid";
  link.href =
    "https://drive.google.com/drive/folders/" + encodeURIComponent(folderId);

  panel.hidden = false;
})();
