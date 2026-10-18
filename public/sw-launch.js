// Explicitly launching from start.cmd is a request to load the current build.
// Ordinary in-app updates still prompt, so editing tabs aren't forcibly reloaded.
self.addEventListener("fetch", (event) => {
  if (
    event.request.mode !== "navigate" ||
    !new URL(event.request.url).searchParams.has("__huiqi_launch")
  )
    return;
  event.waitUntil(
    (async () => {
      await self.registration.update();
      self.registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    })().catch(() => {}),
  );
});
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (
        clients.some((client) =>
          new URL(client.url).searchParams.has("__huiqi_launch"),
        )
      )
        await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const launching = clients.filter((client) =>
        new URL(client.url).searchParams.has("__huiqi_launch"),
      );
      if (!launching.length) return;
      await self.clients.claim();
      // Do not await navigation inside activation: its fetch waits for activation.
      launching.forEach((client) => {
        const url = new URL(client.url);
        url.searchParams.delete("__huiqi_launch");
        void client.navigate(url.href).catch(() => {});
      });
    })(),
  );
});
