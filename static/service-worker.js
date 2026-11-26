// Chromium install support. Requests and job progress stay on the network;
// there is no Cache Storage and private API requests are never intercepted.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || request.mode !== "navigate" ||
      url.origin !== self.location.origin || !["/", "/index.html"].includes(url.pathname)) return;
  event.respondWith(fetch(request).catch(() => new Response(
    "FabGUI could not reach its local server. Start the fabgui user service and reload this window. Fab downloads require the local server and an internet connection.",
    { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } },
  )));
});
