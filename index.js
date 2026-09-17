const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = {
  id: 'org.ryan.flomesbr.v8',
  version: '8.0.0',
  name: 'flomes BR',
  description: 'Addon blindado 100% BR usando Torrentio como ponte',
  resources: ['stream'],
  types: ['movie', 'series'],
  catalogs: [],
  idPrefixes: ['tt', 'tmdb']
};

const builder = new addonBuilder(manifest);

const httpConfig = {
  timeout: 10000
};

// Palavras-chave obrigatórias para ser considerado PT-BR
const PTBR_KEYWORDS = ['dublado', 'dual', 'pt-br', 'ptbr', 'portugues', 'pt_br', 'brazilian'];

// Palavras-chave para BLOQUEAR (Espanhol e Português de Portugal)
const EXCLUDE_KEYWORDS = ['espanol', 'español', 'castellano', 'latino', 'pt-pt', 'pt_pt', 'portugal', 'doblado'];

function isPtBr(title) {
  const t = title.toLowerCase();
  
  // 1. Se contiver termos em espanhol ou PT-PT e NÃO tiver "pt-br"/"ptbr" explícito, descarta
  const hasExclude = EXCLUDE_KEYWORDS.some(kw => t.includes(kw));
  const hasExplicitPtBr = t.includes('pt-br') || t.includes('ptbr') || t.includes('pt_br');

  if (hasExclude && !hasExplicitPtBr) {
    return false;
  }

  // 2. Precisa ter pelo menos uma palavra-chave de áudio BR
  return PTBR_KEYWORDS.some(kw => t.includes(kw));
}

function getAudioInfo(title) {
  const text = title.toLowerCase();
  if (text.includes('dual') || (text.includes('dublado') && text.includes('legendado'))) return '🇧🇷 DUAL ÁUDIO';
  if (text.includes('dublado') || text.includes('ptbr') || text.includes('pt-br') || text.includes('portugues')) return '🇧🇷 DUBLADO (PT-BR)';
  if (text.includes('legendado') || text.includes('subbed') || text.includes('leg')) return '🇺🇸 LEGENDADO (PT-BR)';
  return '🇧🇷 PT-BR';
}

function getQualityInfo(title) {
  const text = title.toLowerCase();
  if (text.includes('2160p') || text.includes('4k') || text.includes('uhd')) return '4K UHD';
  if (text.includes('1080p') || text.includes('fhd') || text.includes('fullhd')) return '1080p Full HD';
  if (text.includes('720p') || text.includes('hd')) return '720p HD';
  return 'HD';
}

function getSeeders(title) {
  const match = title.match(/👤\s*(\d+)/);
  return match ? match[1] : 'N/A';
}

async function getMediaInfo(type, id) {
  const rawId = id.split(':')[0];
  let title = null;
  let year = null;
  try {
    const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${rawId}.json`, httpConfig);
    title = res.data?.meta?.name;
    year = res.data?.meta?.year;
  } catch (e) {
    console.log(`⚠️ Erro Cinemeta: ${e.message}`);
  }
  return { title, year };
}

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`\n==================================================`);
  console.log(`🔎 Nova busca no flomes BR! ID: ${id}`);

  let streams = [];

  try {
    const media = await getMediaInfo(type, id);
    const officialYear = media.year ? String(media.year) : null;
    console.log(`🎬 Validando: "${media.title || 'Desconhecido'}" (${officialYear || '?'})`);

    const torrentioUrl = `https://torrentio.strem.fun/stream/${type}/${id}.json`;
    const response = await axios.get(torrentioUrl, httpConfig);
    const torrentioStreams = response.data.streams || [];

    torrentioStreams.forEach(tStream => {
      const fullText = (tStream.title || "").toLowerCase() + " " + (tStream.name || "").toLowerCase();

      // Filtro Anti-Espanhol / Anti-PT-PT e obrigatoriedade PT-BR
      if (!isPtBr(fullText)) return;

      // Validação rigorosa de ano
      if (officialYear && fullText.includes('20')) {
        const yearsInText = fullText.match(/20\d{2}/g);
        if (yearsInText && !yearsInText.includes(officialYear)) {
          return;
        }
      }

      const quality = getQualityInfo(fullText);
      const audio = getAudioInfo(fullText);
      const seeders = getSeeders(tStream.title || "");

      streams.push({
        name: `flomes BR\n[${quality}]`,
        title: `${media.title || 'Filme'} (${officialYear || 'N/A'})\n🔊 ${audio}\n👤 Seeders: ${seeders}`,
        infoHash: tStream.infoHash
      });
    });

    console.log(`✅ Aprovados ${streams.length} link(s) 100% PT-BR.`);

  } catch (e) {
    console.log(`❌ Erro na ponte: ${e.message}`);
  }

  console.log(`==================================================\n`);
  return { streams };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`🚀 Servidor flomes BR rodando firme na porta ${PORT}`);
