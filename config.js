/*
 * Site configuration for guest photo uploads.
 *
 * Fill these two values in after following the steps in apps-script/README.md.
 * Until they are filled in, the upload page and the guest gallery show a
 * friendly "not ready yet" message instead of a broken form or iframe.
 */
window.WEDDING_CONFIG = {
  /*
   * The /exec URL of the deployed Apps Script web app.
   * Looks like: https://script.google.com/macros/s/AKfycb.../exec
   */
  uploadEndpoint:
    "https://script.google.com/macros/s/AKfycbwrEYmJIF9B2l8fJRt8WGJfC2_PpoqTZlwnOIcv9XEZocK1BRUqFwSn8zl62Q1bZ0u56Q/exec",

  /*
   * Drive folder ID of the PUBLIC guest photo folder (the one shared
   * "Anyone with the link -> Viewer"). This is the folder you move approved
   * uploads into. It is NOT the private inbox folder.
   */
  guestPhotosFolderId: "110gCPE3_3fWf0DM-CaNE_MGPTt7wPQgg",
};
