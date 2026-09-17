// Cloudflare Worker: serves the static Painel de Corretores app, and
// implements the small key/value storage API the frontend calls at
// "/.netlify/functions/storage?key=..." (originally a Netlify Function).
//
// Storage backend: a single Durable Object (PainelStorage) instead of
// Workers KV. KV is only *eventually* consistent (writes can take up to
// ~60s to reach every Cloudflare location), which is why edits made on
// one machine weren't showing up right away on another. A Durable Object
// is a single, strongly-consistent instance: every read/write for this
// panel goes through the same instance, so a saved change is visible to
// every device immediately.
//
// The old KV namespace (env.STORAGE, if still bound) is kept only as a
// one-time migration source: the first time a key is read and it's not
// yet in the Durable Object, we fall back to the old KV value and copy
// it over. After that, KV is no longer touched.

export class PainelStorage {
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

    let stored = await this.ctx.storage.get(key);

    // migração única: se ainda não existir no Durable Object, busca no
    // namespace KV antigo (dados de antes da migração) e copia pra cá
    if (stored === undefined && this.env.STORAGE) {
      const legacy = await this.env.STORAGE.get(key);
      if (legacy !== null) {
        stored = legacy;
        await this.ctx.storage.put(key, legacy);
      }
    }

    return new Response(stored === undefined ? "null" : stored, {
      status: stored === undefined ? 404 : 200,
      headers: { "content-type": "application/json" },
    });
  }
}

// Durable Object dedicado às Fichas de Credenciamento (Helbor).
// Cada envio do formulário vira uma chave "ficha:<timestamp>_<random>"
// guardando o JSON completo dos dados preenchidos. GET lista tudo,
// POST adiciona uma nova ficha.
export class FichasStorage {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.method === "POST") {
      let dados;
      try {
        dados = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: "JSON inválido" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      const key =
        "ficha:" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      dados.recebidoEm = new Date().toISOString();
      await this.ctx.storage.put(key, JSON.stringify(dados));
      return new Response(JSON.stringify({ ok: true, key }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (request.method === "GET") {
      const map = await this.ctx.storage.list({ prefix: "ficha:" });
      const fichas = [];
      for (const [key, value] of map) {
        try {
          fichas.push({ key, ...JSON.parse(value) });
        } catch (e) {
          // ignora registro corrompido
        }
      }
      fichas.sort(
        (a, b) => new Date(b.recebidoEm) - new Date(a.recebidoEm)
      );
      return new Response(JSON.stringify(fichas), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Method not allowed", { status: 405 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/.netlify/functions/storage") {
      // um único Durable Object global para todo o painel: todo mundo
      // lê/escreve na mesma instância, então não há atraso de propagação
      const id = env.PAINEL_STORAGE.idFromName("painel-desidera");
      const stub = env.PAINEL_STORAGE.get(id);
      return stub.fetch(request);
    }

    if (url.pathname === "/api/fichas") {
      const id = env.FICHAS_STORAGE.idFromName("fichas-helbor");
      const stub = env.FICHAS_STORAGE.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
