// Função da Vercel: entrega ao navegador a URL do projeto Supabase e a
// chave pública (anon/publishable), lidas das variáveis de ambiente.
// Essa chave é pública por natureza; nunca exponha a service_role aqui.
//
// Também entrega os servidores ICE. Só STUN não basta para quem está
// atrás de NAT restrito (4G, rede de empresa): aí precisa de um TURN,
// que repassa o tráfego. Duas formas (variáveis na Vercel):
//   CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_KEY_TOKEN: credenciais
//     temporárias geradas aqui a cada carregamento (Cloudflare Realtime).
//   TURN_URLS (separadas por vírgula) + TURN_USERNAME + TURN_CREDENTIAL:
//     um TURN qualquer com usuário e senha fixos.
const STUN = { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };

async function turnServers(env) {

  if (env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_KEY_TOKEN) {
    try {
      const response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.CLOUDFLARE_TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${env.CLOUDFLARE_TURN_KEY_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ttl: 86400 })
        }
      );
      const body = await response.json();
      if (response.ok && Array.isArray(body.iceServers)) return body.iceServers;
      console.error("TURN da Cloudflare:", response.status, body);
    } catch (error) {
      console.error("TURN da Cloudflare:", error);
    }
  }

  if (env.TURN_URLS) {
    return [{
      urls: env.TURN_URLS.split(",").map(url => url.trim()).filter(Boolean),
      username: env.TURN_USERNAME || "",
      credential: env.TURN_CREDENTIAL || ""
    }];
  }

  return [];

}

module.exports = async (req, res) => {

  const env = process.env;

  const url =
    env.SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL;

  const anonKey =
    env.SUPABASE_ANON_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  res.setHeader("Cache-Control", "no-store");

  if (!url || !anonKey) {
    res.status(500).json({
      error: "variáveis SUPABASE_URL e SUPABASE_ANON_KEY não configuradas na Vercel"
    });
    return;
  }

  const turn = await turnServers(env);

  res.status(200).json({ url, anonKey, iceServers: [STUN, ...turn], turn: turn.length > 0 });

};
