// Cloudflare Worker: serve o app estático da Ficha de Cadastro e a API de
// armazenamento em "/.netlify/functions/storage?key=..." (mesmo formato
// usado no Painel de Corretores), agora já direto num Durable Object —
// sem KV, já que este é um projeto novo, sem dados antigos para migrar.

export class FichaCadastroStorage {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
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
      await this.ctx.storage.put(key, toStore);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    const stored = await this.ctx.storage.get(key);
    return new Response(stored === undefined ? "null" : stored, {
      status: stored === undefined ? 404 : 200,
      headers: { "content-type": "application/json" },
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/.netlify/functions/storage") {
      const id = env.FICHA_STORAGE.idFromName("ficha-cadastro");
      const stub = env.FICHA_STORAGE.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
