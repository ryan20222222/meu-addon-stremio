const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = {
  id: 'org.ryan.vejaaebr.v017',
  version: '0.1.7',
  name: 'VEJA AE BR',
  icon: 'https://cdn.jsdelivr.net/gh/ryan20222222/meu-addon-stremio@main/vejaaestremio.png',
  description: 'Fonte focadas em achar filmes e Series com dublagem 100% PT-BR (Bloqueio total de áudio inglês e estrangeiro)',
  resources: ['stream'],
  types: ['movie', 'series'],
  catalogs: [],
  idPrefixes: ['tt', 'tmdb']
};

const builder = new addonBuilder(manifest);

const httpConfig = {
  timeout: 8000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
};

// Idiomas estrangeiros e variações de Portugal terminantemente bloqueados
const FOREIGN_LANG_REGEX = /\b(english|eng|espanol|español|castellano|latino|doblado|lat|pt-pt|pt_pt|portugal|pt-eu|turkish|turco|turkce|russian|russo|hindi|french|francais|frances|german|aleman|italian|italiano|korean|japanese|chinese)\b/i;

// Tags OBRIGATÓRIAS de validação do Brasil
const PTBR_MATCH_REGEX = /\b(pt-br|ptbr|pt_br|dublado|dual|brazilian|audio br|audio pt-br|audio pt)\b/i;

function isStrictPtBr(text, isNationalContent = false) {
  const lower = text.toLowerCase();

  // Produções originais do Brasil passam direto
  if (isNationalContent) return true;

  // 1. REJEIÇÃO IMEDIATA: Se não contiver tag explícita de PT-BR/Dublado, descarta
  const hasPtBr = PTBR_MATCH_REGEX.test(lower);
  if (!hasPtBr) {
    return false;
  }

  // 2. BLOQUEIO DE PORTUGUÊS DE PORTUGAL
  if (/\b(pt-pt|pt_pt|portugal|pt-eu)\b/i.test(lower)) {
    return false;
  }

  // 3. Se houver termo de outro idioma sem "pt-br" ou "dublado" junto, bloqueia
  const hasForeign = FOREIGN_LANG_REGEX.test(lower);
  const hasExplicitPtBrTag = /\b(pt-br|ptbr|pt_br|dublado)\b/i.test(lower);

  if (hasForeign && !hasExplicitPtBrTag) {
    return false;
  }

  return true;
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

async function getMediaInfo(type, id) {
  const rawId = id.split(':')[0];
  let title = null;
  let year = null;
  let isNational = false;

  if (rawId.startsWith('tmdb:')) {
    const tmdbNum = rawId.replace('tmdb:', '');
    const tmdbType = (type === 'series' || type === 'tv') ? 'tv' : 'movie';
    try {
      const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbNum}?api_key=1f5428d06f4f40d7020c1073180b63d9&language=pt-BR`;
      const res = await axios.get(url, httpConfig);
      title = res.data?.title || res.data?.name;
      const dateStr = res.data?.release_date || res.data?.first_air_date;
      if (dateStr) year = dateStr.split('-')[0];
      if (res.data?.original_language === 'pt' || res.data?.origin_country?.includes('BR')) isNational = true;
    } catch (e) {}
  }

  if (!title) {
    try {
      const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${rawId}.json`, httpConfig);
      title = res.data?.meta?.name;
      year = res.data?.meta?.year;
    } catch (e) {}
  }

  return { title, year, isNational };
}

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`\n==================================================`);
  console.log(`🔎 VEJA AE BR v0.1.7 | ID: ${id}`);

  let allRawStreams = [];

  try {
    const media = await getMediaInfo(type, id);
    const officialYear = media.year ? String(media.year) : null;

    const endpoints = [
      `https://torrentio.strem.fun/stream/${type}/${id}.json`,
      `https://knightcrawler.elfhosted.com/stream/${type}/${id}.json`
    ];

    const requests = endpoints.map(url => axios.get(url, httpConfig));
    const results = await Promise.allSettled(requests);

    results.forEach(res => {
      if (res.status === 'fulfilled' && res.value.data?.streams) {
        allRawStreams.push(...res.value.data.streams);
      }
    });

    const uniqueStreams = allRawStreams.filter((v, i, a) => a.findIndex(t => t.infoHash === v.infoHash) === i);

    let streams = [];

    uniqueStreams.forEach(tStream => {
      const fullText = (tStream.title || "").toLowerCase() + " " + (tStream.name || "").toLowerCase();

      // 1. Filtro de idioma ultra-restritivo
      if (!isStrictPtBr(fullText, media.isNational)) return;

      // 2. Validação de ano
      if (officialYear && fullText.includes('20')) {
        const yearsInText = fullText.match(/20\d{2}/g);
        if (yearsInText && !yearsInText.includes(officialYear)) return;
      }

      const quality = getQualityInfo(fullText);
      const audio = getAudioInfo(fullText);
      const seeders = getSeeders(tStream.title || "");

      streams.push({
        name: `VEJA AE BR\n[${quality}]`,
        title: `${media.title || 'Filme'} (${officialYear || 'N/A'})\n🔊 ${audio}\n👤 Seeders: ${seeders}`,
        infoHash: tStream.infoHash
      });
    });

    console.log(`✅ Aprovados ${streams.length} link(s) 100% PT-BR de ${uniqueStreams.length} capturados.`);
    return { streams };

  } catch (e) {
    console.log(`❌ Erro no processamento: ${e.message}`);
    return { streams: [] };
  }
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`🚀 Servidor VEJA AE BR v0.1.7 ativo na porta ${PORT}`);
