// Função da Vercel: playlist do Spotify tocando pela fila do ▶️ YouTube.
//   ?spotify=<link>  -> { name, tracks: [{ title, artist, duration }] }
//     Lê a página de embed do Spotify (open.spotify.com/embed/...), que é
//     pública e traz as faixas (até 100) no __NEXT_DATA__. Sem chave; não
//     é API oficial, então pode mudar. Playlist, álbum ou uma faixa.
//   ?q=<artista - música>&d=<segundos>  -> { video, title }
//     Procura no YouTube ("... audio", na página de resultados, sem chave)
//     e escolhe o que mais parece a faixa: com o nome da música, duração
//     perto da do Spotify, canal do artista ou "- Topic", sem ao vivo,
//     cover ou remix (se a faixa não for).
// O áudio não passa por aqui: cada um toca o vídeo no próprio player.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const SPOTIFY_LINK = /(?:open\.spotify\.com\/(?:intl-[\w-]+\/)?(?:embed\/)?|spotify:)(playlist|album|track)[/:]([A-Za-z0-9]{22})/;
const AVOID = /\b(live|ao vivo|en vivo|cover|remix|karaoke|instrumental|8d|slowed|sped up|reverb|nightcore|tutorial|reaction|lyrics? video)\b/i;

const clean = value => String(value ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

async function spotify(link, res) {

  const match = SPOTIFY_LINK.exec(link);

  if (!match) {
    res.status(400).json({ error: "link do Spotify inválido" });
    return;
  }

  const [, type, id] = match;
  const response = await fetch(`https://open.spotify.com/embed/${type}/${id}`, { headers: { "User-Agent": UA } });
  const html = await response.text();
  const json = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  const entity = json && JSON.parse(json)?.props?.pageProps?.state?.data?.entity;

  if (!response.ok || !entity) {
    console.error("Spotify:", response.status);
    res.status(response.status === 404 ? 404 : 502).json({ error: "o Spotify não mostrou essa playlist" });
    return;
  }

  const list = Array.isArray(entity.trackList) ? entity.trackList
    : type === "track" ? [{ title: entity.title || entity.name, subtitle: (entity.artists || []).map(artist => artist.name).join(", "), duration: entity.duration }]
    : [];

  const tracks = list
    .filter(track => track && track.isPlayable !== false && clean(track.title))
    .map(track => ({
      title: clean(track.title).slice(0, 150),
      artist: clean(track.subtitle).slice(0, 150),
      duration: Number.isFinite(track.duration) ? Math.round(track.duration / 1000) : null
    }));

  res.setHeader("Cache-Control", "public, max-age=600");
  res.status(200).json({ name: clean(entity.name || entity.title).slice(0, 150), tracks });

}

const seconds = text => String(text || "").split(":").reduce((total, part) => total * 60 + (parseInt(part, 10) || 0), 0);

// Os vídeos da página de resultados (ytInitialData), na ordem.
function videosOf(data) {
  const found = [];
  const walk = node => {
    if (!node || typeof node !== "object" || found.length >= 15) return;
    if (Array.isArray(node)) return node.forEach(walk);
    const video = node.videoRenderer;
    if (video?.videoId) {
      found.push({
        video: video.videoId,
        title: clean(video.title?.runs?.map(run => run.text).join("") || video.title?.simpleText),
        channel: clean(video.ownerText?.runs?.[0]?.text),
        artist: JSON.stringify(video.ownerBadges || []).includes("VERIFIED_ARTIST"),
        length: video.lengthText?.simpleText ? seconds(video.lengthText.simpleText) : null
      });
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(data);
  return found;
}

function score(item, query, duration, index) {
  const title = item.title.toLowerCase();
  const channel = item.channel.toLowerCase();
  let points = -index;
  if (duration && item.length) {
    const off = Math.abs(item.length - duration);
    points += off <= 3 ? 14 : off <= 8 ? 10 : off <= 20 ? 5 : off <= 40 ? 1 : -10;
  }
  if (channel.endsWith(" - topic") || item.artist) points += 6;
  if (query.artist && channel.includes(query.artist.split(",")[0].trim().toLowerCase())) points += 5;
  // Sem o nome da música ("Hesitations - Acoustic" -> "hesitations"): outra.
  const core = query.title.split(/ - | \(/)[0].trim().toLowerCase();
  points += title.includes(query.title.toLowerCase()) ? 4 : title.includes(core) ? 2 : -12;
  if (/official audio|áudio oficial/i.test(title)) points += 3;
  const avoid = AVOID.exec(title)?.[0];
  if (avoid && !query.full.toLowerCase().includes(avoid.toLowerCase())) points -= 15;
  return points;
}

async function youtube(req, res) {

  const full = clean(req.query.q).slice(0, 200);
  const duration = parseInt(req.query.d, 10) || null;

  if (!full) {
    res.status(400).json({ error: "faltou o que procurar" });
    return;
  }

  // "artista - música" (o que a página manda): separa para comparar.
  const [artist, ...rest] = full.split(" - ");
  const query = { full, artist: rest.length ? artist : "", title: rest.length ? rest.join(" - ") : full };

  const params = new URLSearchParams({ search_query: full + " audio", sp: "EgIQAQ==" });
  const response = await fetch("https://www.youtube.com/results?" + params, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1; SOCS=CAI" }
  });
  const html = await response.text();
  const json = /var ytInitialData = (\{[\s\S]*?\});<\/script>/.exec(html)?.[1];
  const videos = json ? videosOf(JSON.parse(json)) : [];

  if (!response.ok || !videos.length) {
    console.error("YouTube:", response.status, videos.length);
    res.status(502).json({ error: "o YouTube não respondeu à busca" });
    return;
  }

  const best = videos
    .map((item, index) => ({ item, points: score(item, query, duration, index) }))
    .sort((a, b) => b.points - a.points)[0].item;

  res.setHeader("Cache-Control", "public, max-age=86400");
  res.status(200).json({ video: best.video, title: best.title });

}

module.exports = async (req, res) => {

  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.query.spotify) await spotify(String(req.query.spotify), res);
    else await youtube(req, res);
  } catch (error) {
    console.error("Música:", error);
    res.status(502).json({ error: "não foi possível buscar agora" });
  }

};
