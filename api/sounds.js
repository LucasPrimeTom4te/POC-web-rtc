// Função da Vercel: busca sons no Freesound (freesound.org) para o card
// de sons. A chave fica aqui (variável FREESOUND_KEY na Vercel), não no
// navegador. Só sons curtos (até 30 s) e CC0 (não precisam de crédito);
// devolve a prévia em mp3, que toca direto num <audio>.
// Sem a chave: 503, e a página mostra o Freesound como indisponível.
const PAGE_SIZE = 30;

module.exports = async (req, res) => {

  const key = process.env.FREESOUND_KEY;

  res.setHeader("Cache-Control", "no-store");

  if (!key) {
    res.status(503).json({ error: "FREESOUND_KEY não configurada" });
    return;
  }

  const query = String(req.query.q || "").trim().slice(0, 100);
  const page = Math.max(1, Math.min(50, parseInt(req.query.page, 10) || 1));

  if (req.query.check) {
    res.status(200).json({ ok: true });
    return;
  }

  const params = new URLSearchParams({
    query,
    page: String(page),
    page_size: String(PAGE_SIZE),
    fields: "id,name,previews,username,duration",
    filter: 'duration:[0 TO 30] license:"Creative Commons 0"',
    sort: query ? "score" : "downloads_desc",
    token: key
  });

  try {

    const response = await fetch("https://freesound.org/apiv2/search/text/?" + params);
    const body = await response.json();

    if (!response.ok) {
      console.error("Freesound:", response.status, body);
      res.status(502).json({ error: "Freesound respondeu " + response.status });
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json({
      more: !!body.next,
      items: (body.results || [])
        .filter(item => item.previews?.["preview-hq-mp3"])
        .map(item => ({
          name: String(item.name || "").replace(/\.(wav|mp3|ogg|flac|aiff?|m4a)$/i, ""),
          url: item.previews["preview-hq-mp3"],
          author: item.username,
          duration: item.duration
        }))
    });

  } catch (error) {
    console.error("Freesound:", error);
    res.status(502).json({ error: "não foi possível falar com o Freesound" });
  }

};
