const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = {
  id: 'org.pessoal.meubuscador.ptbr.preciso',
  version: '5.0.0',
  name: 'Meu Buscador PT-BR Preciso',
  description: 'Addon pessoal com filtro de ano, qualidade e áudio PT-BR',
  resources: ['stream'],
  types: ['movie', 'series'],
  catalogs: [],
  idPrefixes: ['tt', 'tmdb']
};

const builder = new addonBuilder(manifest);

const httpConfig = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  },
  timeout: 6000
};

const PTBR_KEYWORDS = ['dublado', 'dual', 'pt-br', 'ptbr', 'portugues', 'pt_br'];

function isPtBr(title) {
  const t = title.toLowerCase();
  return PTBR_KEYWORDS.some(kw => t.includes(kw));
}

function getAudioInfo(title) {
  const text = title.toLowerCase();
  if (text.includes('dual') || (text.includes('dublado') && text.includes('legendado'))) {
    return '🇧🇷 DUAL ÁUDIO';
  } else if (text.includes('dublado') || text.includes('ptbr') || text.includes('pt-br') || text.includes('portugues')) {
    return '🇧🇷 DUBLADO';
  } else if (text.includes('legendado') || text.includes('subbed')) {
    return '🇺🇸 LEGENDADO';
  }
  return '🇧🇷 PT-BR';
}

function getQualityInfo(title) {
  const text = title.toLowerCase();
  if (text.includes('2160p') || text.includes('4k') || text.includes('uhd')) return '4K UHD';
  if (text.includes('1080p') || text.includes('fhd') || text.includes('fullhd')) return '1080p Full HD';
  if (text.includes('720p') || text.includes('hd')) return '720p HD';
  return 'HD';
}

async function getMediaInfo(type, id) {
  const rawId = id.split(':')[0];
  let title = null;
  let year = null;

  if (rawId.startsWith('tmdb:')) {
    const tmdbNum = rawId.replace('tmdb:', '');
    const tmdbType = (type === 'series' || type === 'tv') ? 'tv' : 'movie';
    try {
      const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbNum}?api_key=1f5428d06f4f40d7020c1073180b63d9&language=pt-BR`;
      const res = await axios.get(url, httpConfig);
      title = res.data?.title || res.data?.name || res.data?.original_title;
      const dateStr = res.data?.release_date || res.data?.first_air_date;
      if (dateStr) year = dateStr.split('-')[0];
    } catch (e) {}
  }

  if (!title) {
    try {
      const res = await axios.get(`https://v3-cinemeta.stremio.com/meta/${type}/${rawId}.json`, httpConfig);
      title = res.data?.meta?.name;
      year = res.data?.meta?.year;
    } catch (e) {}
  }

  return { title, year };
}

builder.defineStreamHandler(async ({ type, id }) => {
  let streams = [];

  try {
    const media = await getMediaInfo(type, id);
    if (!media.title) return { streams: [] };

    const title = media.title;
    const year = media.year ? String(media.year) : null;
    const searchQueries = [`${title} dublado`, `${title} dual`];

    for (const query of searchQueries) {
      const url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}`;
      const res = await axios.get(url, httpConfig);
      const torrents = res.data;

      if (Array.isArray(torrents) && torrents[0]?.info_hash !== '0000000000000000000000000000000000000000') {
        torrents.forEach(t => {
          const tName = t.name;
          const tLower = tName.toLowerCase();

          // Valida se tem termos em PT-BR
          if (!isPtBr(tName)) return;

          // Valida o ano: se o nome do torrent especificar um ano e ele for diferente do oficial, descarta para não misturar filmes homônimos
          if (year && tLower.includes('20')) {
            const yearsInTorrent = tLower.match(/20\d{2}/g);
            if (yearsInTorrent && !yearsInTorrent.includes(year)) {
              return;
            }
          }

          const quality = getQualityInfo(tName);
          const audio = getAudioInfo(tName);

          streams.push({
            name: `[${quality}]`,
            title: `${title} (${year || 'N/A'})\n🔊 ${audio}\n👤 Seeders: ${t.seeders}`,
            infoHash: t.info_hash.toLowerCase()
          });
        });
      }
    }

    // Remove duplicados
    streams = streams.filter((v, i, a) => a.findIndex(t => t.infoHash === v.infoHash) === i);

  } catch (e) {
    console.log('Erro:', e.message);
  }

  return { streams };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Servidor ativo na porta ${PORT}`);
