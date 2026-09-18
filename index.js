const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = {
  id: 'org.ryan.vejaaebr.v019',
  version: '0.1.9',
  name: 'VEJA AE BR ELITE',
  icon: 'https://cdn.jsdelivr.net/gh/ryan20222222/meu-addon-stremio@main/vejaaestremio.png',
  description: 'A Elite da Filtragem PT-BR: Dublagem Autêntica e Nacional Puro. Rejeição severa de Dual e Estrangeiro.',
  resources: ['stream'],
  types: ['movie', 'series'],
  catalogs: [],
  idPrefixes: ['tt', 'tmdb']
};

const builder = new addonBuilder(manifest);

// Configuração otimizada para Render Gratuito: tempo limite justo para as melhores fontes
const httpConfig = {
  timeout: 9000, 
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
};

// =========================================================================================
// NÚCLEO DE INTELIGÊNCIA DE FILTRAGEM (REGEX DE ALTA PRECISÃO)
// =========================================================================================

// 1. BLACKLIST TOTAL DE IDIOMAS (Qualquer menção a estes idiomas, descarta)
// Inclui Hindi (hin, hindi, indian), Espanhol (esp, lat, espanol), PT-PT, e muitos outros.
const BLACK_LIST_REGEX = /\b(hindi|hin|indian|bollywood|espanol|español|castellano|latino|lat|pt-pt|pt_pt|portugal|pt-eu|turkish|turco|turkce|russian|russo|french|francais|frances|german|aleman|italian|italiano|korean|japanese|chinese)\b/i;

// 2. REJEIÇÃO SEVERA DE DUAL E MULTI (A pedido do usuário, para focar em PT-BR PURO)
// Bloqueia termos como dual-audio, dual, multiaudio, milti, m-audio
const REJECT_DUAL_REGEX = /\b(dual|multi|milti|m-audio|multi-audio|dual-audio)\b/i;

// 3. WHITELIST OBRIGATÓRIA BR (Todo torrent *precisa* ter uma destas tags explicitamente)
// Exige "dublado", "ptbr", "audio-br", etc. com fronteiras de palavra corretas (\b)
const WHITE_LIST_REGEX = /\b(dublado|dub|ptbr|pt-br|pt_br|brazilian|audio br|audio pt-br|audio pt)\b/i;

function isStrictlyFunctionalPtBr(text, isNationalContent = false) {
  const lower = text.toLowerCase();

  // Produções originais do Brasil (TMDB confirma ser PT) passam direto, não precisam de tag "dublado"
  if (isNationalContent) return true;

  // VERIFICAÇÃO DE ELITE (Filtro Eliminatório)

  // 1. REJEIÇÃO POR FONTE FALSA (Bloqueia sites indianos conhecidos que usam tags falsas)
  if (/\b(digitalmaza|movies\.digitalmaza\.org)\b/i.test(lower)) return false;

  // 2. REJEIÇÃO POR DUAL (Se o usuário quer 100%, removemos o Dual que confunde)
  if (REJECT_DUAL_REGEX.test(lower)) return false;

  // 3. REJEIÇÃO POR IDIOMA ESTRANGEIRO (Se mencionar qualquer idioma da blacklist, tchau)
  if (BLACK_LIST_REGEX.test(lower)) return false;

  // 4. WHITELIST OBRIGATÓRIA (Se passamos por tudo e não tem NENHUMA tag BR, descartamos o padrão inglês)
  if (!WHITE_LIST_REGEX.test(lower)) return false;

  return true;
}

// =========================================================================================
// AUXILIARES DE FORMATAÇÃO E METADADOS
// =========================================================================================

function getAudioInfo(title) {
  // Como removemos Dual, os labels mudam. Agora é Dublagem ou Nacional.
  const text = title.toLowerCase();
  // Se contiver tag BR explicita, é Dublado Autêntico
  if (WHITE_LIST_REGEX.test(text)) return '🇧🇷 DUBLAGEM PT-BR';
  return '🇧🇷 PT-BR';
}

function getQualityInfo(title) {
  const text = title.toLowerCase();
  if (text.includes('2160p') || text.includes('4k')) return '4K UHD';
  if (text.includes('1080p') || text.includes('fullhd')) return '1080p FHD';
  if (text.includes('720p')) return '720p HD';
  return 'HD';
}

function getSeeders(title) {
  const match = title.match(/👤\s*(\d+)/);
  return match ? parseInt(match[1]) : 0; // Retorna número para ordenação
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
      // Verifica se o idioma original é português OU o país de origem é Brasil
      if (res.data?.original_language === 'pt' || res.data?.origin_country?.includes('BR')) isNational = true;
    } catch (e) {}
  }
  // Fallback Cinemeta removido para garantir que só buscamos TMDB para nacionalidade precisa.
  return { title, year, isNational };
}

// =========================================================================================
// PROCESSADOR DE STREAMS AGREGADO
// =========================================================================================

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`\n==================================================`);
  console.log(`🔎 VEJA AE BR ELITE v0.1.9 | ID: ${id}`);

  let streams = [];
  let allRawStreams = [];

  try {
    const media = await getMediaInfo(type, id);
    if (!media.title) {
       console.log(`⚠️ ID não mapeado no TMDB. Abortando busca para evitar falsos positivos.`);
       return { streams: [] };
    }
    const officialYear = media.year ? String(media.year) : null;

    // Agregador Multi-Fonte (Torrentio + Knightcrawler)
    const endpoints = [
      `https://torrentio.strem.fun/stream/${type}/${id}.json`,
      `https://knightcrawler.elfhosted.com/stream/${type}/${id}.json`
    ];

    const requests = endpoints.map(url => axios.get(url, httpConfig).catch(() => null)); // Garante que um falha não quebre a Promise.all
    const results = await Promise.all(requests);

    results.forEach(res => {
      if (res && res.data?.streams) {
        allRawStreams.push(...res.data.streams);
      }
    });

    // Deduplicação Inteligente (Remove hashes duplicados primeiro)
    const uniqueRawStreams = allRawStreams.filter((v, i, a) => a.findIndex(t => t.infoHash === v.infoHash) === i);

    uniqueRawStreams.forEach(tStream => {
      const fullText = (tStream.title || "").toLowerCase() + " " + (tStream.name || "").toLowerCase();

      // 1. NÚCLEO DE ELITE: Filtragem Severa
      if (!isStrictlyFunctionalPtBr(fullText, media.isNational)) return;

      // 2. Validação Rigorosa de Ano (Regex para evitar falso positivo do 19xx)
      if (officialYear && fullText.includes('20')) {
        const yearsInText = fullText.match(/20\d{2}/g);
        if (yearsInText && !yearsInText.includes(officialYear)) return;
      }

      const quality = getQualityInfo(fullText);
      const audioLabel = getAudioInfo(fullText);
      const seeders = getSeeders(tStream.title || "");

      streams.push({
        name: `VEJA AE BR ELITE\n[${quality}]`,
        title: `${media.title} (${officialYear || 'N/A'})\n🔊 ${audioLabel}\n👤 Seeders: ${seeders}`,
        infoHash: tStream.infoHash,
        seeders: seeders // Guardamos para ordenação
      });
    });

    // ORDENAÇÃO DE ELITE: Ordenar por Seeders (Mais estável primeiro)
    streams.sort((a, b) => b.seeders - a.seeders);

    console.log(`✅ Aprovados ${streams.length} link(s) Autênticos PT-BR de ${uniqueRawStreams.length} capturados.`);
    return { streams };

  } catch (e) {
    console.log(`❌ Erro crítico no processamento de Elite: ${e.message}`);
    return { streams: [] };
  }
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`🚀 Servidor VEJA AE BR ELITE v0.1.9 ativo na porta ${PORT}`);
