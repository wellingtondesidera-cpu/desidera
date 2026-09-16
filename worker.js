// Cloudflare Worker: serves the static Painel de Corretores app, and
// implements the small key/value storage API the frontend calls at
// "/.netlify/functions/storage?key=..." (originally a Netlify Function),
// backed by Workers KV so data syncs across devices/browsers.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/.netlify/functions/storage") {
      const key = url.searchParams.get("key");
      if (!key) {
        return new Response(JSON.stringify({ error: "missing key" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }

      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      const bodyText = hasBody ? await request.text() : "";
      const valueParam = url.searchParams.get("value");
      const isWrite = bodyText.length > 0 || valueParam !== null;

      if (isWrite) {
        const toStore = bodyText.length > 0 ? bodyText : valueParam;
        await env.STORAGE.put(key, toStore);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      }

      const stored = await env.STORAGE.get(key);
      return new Response(stored === null ? "null" : stored, {
        headers: { "content-type": "application/json" },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
