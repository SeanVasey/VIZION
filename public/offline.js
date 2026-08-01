// Self-recover when connectivity returns. reload() retries the URL the
// user actually navigated to (the SW served the offline document at that
// URL), so their intended destination is preserved rather than discarded to
// "/". A once-guard stops a flapping connection from bouncing through
// repeated navigations.
//
// This lives outside offline.html because the document is not always served
// under the static 'unsafe-inline'-free CSP it was designed with: Vercel's
// cleanUrls serves it at /offline, and the SW precache replays whatever
// headers the install-time fetch received. `script-src 'self'` holds in
// every one of those variants; an inline script does not.
var recovered = false;
window.addEventListener("online", function () {
  if (recovered) return;
  recovered = true;
  window.location.reload();
});
