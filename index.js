const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = {
  id: 'org.ryan.flomesbr.v012',
  version: '0.1.2',
  name: 'flomes BR',
  icon: 'https://i.imgur.com/v3R3N0N.png',
  description: 'Filtro de Elite 100% PT-BR com bloqueio de áudio estrangeiro',
  resources: ['stream'],
  types: ['movie', 'series'],
  catalogs: [],
  idPrefixes: ['tt', 'tmdb']
};

const builder = new addonBuilder(manifest);

const httpConfig = {
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
};

// Expressão regular para BLOQUEIO SEVERO de idiomas estrangeiros
const FOREIGN_LANG_REGEX = /\b(espanol|español|castellano|latino|doblado|lat|pt-pt|pt_pt|portugal|turkish|turco|turkce|russian|russo|hindi|french|francais|frances|german|aleman|italian|italiano|korean|japanese|chinese)\b/i;

// Expressão regular para OBRIGATORIEDADE de marcação PT-BR
const PTBR_MATCH_REGEX = /\b(pt-br|ptbr|pt_br|dublado|dual|brazilian|audio br|audio pt)\b/i;

function isStrictPtBr(text, isNationalContent = false) {
  const lower = text.toLowerCase();

  // Se o filme/série for nativo do Brasil, não exige tag "dublado"
  if (isNationalContent) {
    return true;
  }

  // Se tiver palavra estrangeira e NÃO tiver "PT-BR" explícito, REJEITA imediato
  const hasForeignTag = FOREIGN_LANG_REGEX.test(lower);
  const hasExplicitPtBr = /\b(pt-br|ptbr|pt_br)\b/i.test(lower);

  if (hasForeignTag && !hasExplicitPtBr) {
    return false;
  }

  // Exige obrigatoriamente uma tag válida de dublagem brasileira
  return PTBR_MATCH_REGEX.test(lower);
}

function getAudioInfo(title) {
  const text = title.toLowerCase();
  if (text.includes('dual') || (text.includes('dublado') && text.includes('legendado'))) return '🇧🇷 DUAL ÁUDIO';
  if (text.includes('dublado') || text.includes('ptbr') || text.includes('pt-br') || text.includes('portugues')) return '🇧🇷 DUBLADO (PT-BR)';
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

// Busca Metadados detalhados para obter Ano e Idioma Original
async function getMediaInfo(type, id) {
  const rawId = id.split(':')[0];
  let title = null;
  let year = null;
  let isNational = false;

  // Tenta TMDB primeiro para checar se é conteúdo original do Brasil
  if (rawId.startsWith('tmdb:')) {
    const tmdbNum = rawId.replace('tmdb:', '');
    const tmdbType = (type === 'series' || type === 'tv') ? 'tv' : 'movie';
    try {
      const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbNum}?api_key=1f5428d06f4f40d7020c1073180b63d9&language=pt-BR`;
      const res = await axios.get(url, httpConfig);
      title = res.data?.title || res.data?.name;
      const dateStr = res.data?.release_date || res.data?.first_air_date;
      if (dateStr) year = dateStr.split('-')[0];
      if (res.data?.original_language === 'pt' || res.data?.origin_country?.includes('BR')) {
        isNational = true;
      }
    } catch (e) {
      console.log(`⚠️ Erro TMDB: ${e.message}`);
    }
  }

  // Fallback para Cinemeta
  if (!title) {
    try {
      const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${rawId}.json`, httpConfig);
      title = res.data?.meta?.name;
      year = res.data?.meta?.year;
    } catch (e) {
      console.log(`⚠️ Erro Cinemeta: ${e.message}`);
    }
  }

  return { title, year, isNational };
}

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`\n==================================================`);
  console.log(`🔎 Filtragem iniciada | ID: ${id}`);

  let streams = [];

  try {
    const media = await getMediaInfo(type, id);
    const officialYear = media.year ? String(media.year) : null;
    console.log(`🎬 Título: "${media.title || 'Desconhecido'}" (${officialYear || '?'}) | Nacional: ${media.isNational}`);

    const torrentioUrl = `https://torrentio.strem.fun/stream/${type}/${id}.json`;
    const response = await axios.get(torrentioUrl, httpConfig);
    const torrentioStreams = response.data.streams || [];

    torrentioStreams.forEach(tStream => {
      const fullText = (tStream.title || "").toLowerCase() + " " + (tStream.name || "").toLowerCase();

      // 1. Filtro Rígido de Áudio/Idioma (Regex)
      if (!isStrictPtBr(fullText, media.isNational)) return;

      // 2. Validação Rígida de Ano de Lançamento
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

    // Remove eventuais hashes duplicados
    streams = streams.filter((v, i, a) => a.findIndex(t => t.infoHash === v.infoHash) === i);

    console.log(`✅ Aprovados ${streams.length} link(s) estritamente PT-BR.`);

  } catch (e) {
    console.log(`❌ Erro no processamento: ${e.message}`);
  }

  console.log(`==================================================\n`);
  return { streams };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`🚀 Servidor flomes BR v0.1.2 ativo na porta ${PORT}`);
