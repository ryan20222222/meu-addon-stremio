const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = {
  id: 'org.pessoal.meubuscador.ptbr.tmdb',
  version: '4.0.0',
  name: 'Meu Buscador PT-BR',
  description: 'Addon pessoal com suporte a TMDB e Cinemeta (PT-BR)',
  resources: ['stream'],
  types: ['movie', 'series'],
  catalogs: [],
  idPrefixes: ['tt', 'tmdb'] // Aceita IDs do IMDb e do TMDB
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

// Função para descobrir o título do filme/série em PT-BR
async function getTitle(type, id) {
  const rawId = id.split(':')[0];

  // 1. Se o ID for do TMDB (ex: tmdb:550)
  if (rawId.startsWith('tmdb:')) {
    const tmdbNum = rawId.replace('tmdb:', '');
    const tmdbType = (type === 'series' || type === 'tv') ? 'tv' : 'movie';
    try {
      console.log(`🌐 Buscando titulo em PT-BR no TMDB para ID ${tmdbNum}...`);
      const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbNum}?api_key=1f5428d06f4f40d7020c1073180b63d9&language=pt-BR`;
      const res = await axios.get(url, httpConfig);
      const title = res.data?.title || res.data?.name || res.data?.original_title;
      if (title) return title;
    } catch (e) {
      console.log(`⚠️ Erro TMDB: ${e.message}`);
    }
  }

  // 2. Se for ID do IMDb (ex: tt0111161) ou fallback do Cinemeta
  try {
    console.log(`🌐 Buscando titulo no Cinemeta para ID ${rawId}...`);
    const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${rawId}.json`, httpConfig);
    return res.data?.meta?.name;
  } catch (e) {
    console.log(`⚠️ Erro Cinemeta: ${e.message}`);
  }

  return null;
}

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`\n==================================================`);
  console.log(`🔎 Requisição recebida! Type: ${type} | ID: ${id}`);

  let streams = [];

  try {
    const title = await getTitle(type, id);

    if (!title) {
      console.log('❌ Nao foi possivel identificar o titulo.');
      return { streams: [] };
    }

    console.log(`🎬 Titulo identificado: "${title}"`);

    // Busca no PirateBay usando o nome em Português
    const searchQueries = [`${title} dublado`, `${title} dual`];

    for (const query of searchQueries) {
      console.log(`🌐 Pesquisando no PirateBay por: "${query}"...`);
      const url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}`;
      const res = await axios.get(url, httpConfig);
      const torrents = res.data;

      if (Array.isArray(torrents) && torrents[0]?.info_hash !== '0000000000000000000000000000000000000000') {
        torrents.forEach(t => {
          if (isPtBr(t.name)) {
            streams.push({
              title: `🟢 [PT-BR] ${t.name}\n👤 Seeders: ${t.seeders}`,
              infoHash: t.info_hash.toLowerCase()
            });
          }
        });
      }
    }

    // Remove resultados duplicados
    streams = streams.filter((v, i, a) => a.findIndex(t => t.infoHash === v.infoHash) === i);

    console.log(`✅ Encontrados ${streams.length} torrent(s) PT-BR.`);

  } catch (e) {
    console.log(`❌ Erro durante a busca: ${e.message}`);
  }

  console.log(`==================================================\n`);
  return { streams };
});

serveHTTP(builder.getInterface(), { port: 7000 });
console.log('Servidor PT-BR + TMDB ativo em: http://127.0.0.1:7000/manifest.json');
