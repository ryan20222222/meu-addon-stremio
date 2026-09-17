const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = {
  id: 'org.pessoal.meubuscador.ptbr.v6', 
  version: '6.0.1',
  name: 'Meu Buscador PT-BR',
  description: 'Buscador de Torrents Dublados/Dual Áudio com filtro de ano e qualidade',
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
  timeout: 8000 
};

// Palavras para identificar se o torrent serve para você
const PTBR_KEYWORDS = ['dublado', 'dual', 'pt-br', 'ptbr', 'portugues', 'pt_br'];

function isPtBr(title) {
  const t = title.toLowerCase();
  return PTBR_KEYWORDS.some(kw => t.includes(kw));
}

// Organiza as bandeirinhas de áudio para ficar bonito no Stremio
function getAudioInfo(title) {
  const text = title.toLowerCase();
  if (text.includes('dual') || (text.includes('dublado') && text.includes('legendado'))) {
    return '🇧🇷 DUAL ÁUDIO';
  } else if (text.includes('dublado') || text.includes('ptbr') || text.includes('pt-br') || text.includes('portugues')) {
    return '🇧🇷 DUBLADO';
  } else if (text.includes('legendado') || text.includes('subbed') || text.includes('leg')) {
    return '🇺🇸 LEGENDADO (PT-BR)';
  }
  return '🇧🇷 PT-BR';
}

// Define a qualidade baseada no nome do arquivo
function getQualityInfo(title) {
  const text = title.toLowerCase();
  if (text.includes('2160p') || text.includes('4k') || text.includes('uhd')) return '4K UHD';
  if (text.includes('1080p') || text.includes('fhd') || text.includes('fullhd')) return '1080p Full HD';
  if (text.includes('720p') || text.includes('hd')) return '720p HD';
  return 'HD';
}

// Pega o nome oficial em Português e o Ano do filme (TMDB ou Cinemeta)
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
    } catch (e) {
      console.log(`⚠️ Erro TMDB: ${e.message}`);
    }
  }

  if (!title) {
    try {
      // LINK CORRIGIDO AQUI PARA strem.io
      const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${rawId}.json`, httpConfig);
      title = res.data?.meta?.name;
      year = res.data?.meta?.year;
    } catch (e) {
      console.log(`⚠️ Erro Cinemeta: ${e.message}`);
    }
  }

  return { title, year };
}

// O coração do Addon: o que acontece quando você clica no filme
builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`\n==================================================`);
  console.log(`🔎 Requisição recebida! Tipo: ${type} | ID: ${id}`);

  let streams = [];

  try {
    const media = await getMediaInfo(type, id);
    if (!media.title) {
      console.log('❌ Título não encontrado nas bases de dados.');
      return { streams: [] };
    }

    const title = media.title;
    const year = media.year ? String(media.year) : null;
    
    console.log(`🎬 Título oficial: "${title}" (${year || 'Ano Desconhecido'})`);

    // Busca apenas pelo nome para garantir que venham resultados!
    console.log(`🌐 Pesquisando no PirateBay por: "${title}"...`);
    const url = `https://apibay.org/q.php?q=${encodeURIComponent(title)}`;
    const res = await axios.get(url, httpConfig);
    const torrents = res.data;

    if (Array.isArray(torrents) && torrents[0]?.info_hash !== '0000000000000000000000000000000000000000') {
      torrents.forEach(t => {
        const tName = t.name;
        const tLower = tName.toLowerCase();

        // 1º FILTRO: Descarta imediatamente se não tiver PT-BR/Dublado no nome
        if (!isPtBr(tName)) return;

        // 2º FILTRO: Se tiver um ano no nome do torrent e não bater com o oficial, descarta
        if (year && tLower.includes('20')) {
          const yearsInTorrent = tLower.match(/20\d{2}/g);
          if (yearsInTorrent && !yearsInTorrent.includes(year)) {
            return;
          }
        }

        // Puxa as informações formatadas
        const quality = getQualityInfo(tName);
        const audio = getAudioInfo(tName);

        // Adiciona à lista que vai pro Stremio
        streams.push({
          name: `[${quality}]`,
          title: `${title} (${year || 'N/A'})\n🔊 ${audio}\n👤 Seeders: ${t.seeders}`,
          infoHash: t.info_hash.toLowerCase()
        });
      });
    }

    // Remove resultados duplicados
    streams = streams.filter((v, i, a) => a.findIndex(t => t.infoHash === v.infoHash) === i);

    console.log(`✅ Encontrados ${streams.length} torrent(s) válidos PT-BR.`);

  } catch (e) {
    console.log(`❌ Erro geral: ${e.message}`);
  }

  console.log(`==================================================\n`);
  return { streams };
});

// Inicialização do servidor pronto pro Render.com
const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`🚀 Servidor PT-BR ativo na porta ${PORT}`);
