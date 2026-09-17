const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = {
  id: 'org.ryan.flomesbr.v7',
  version: '0.0.369',
  name: 'flomes BR',
  description: 'Addon blindado 100% BR e gratis usando Torrentio como ponte para filmes (as vezes instavel)',
  resources: ['stream'],
  types: ['movie', 'series'],
  catalogs: [],
  idPrefixes: ['tt', 'tmdb']
};

const builder = new addonBuilder(manifest);

const httpConfig = {
  timeout: 10000 // 10 segundos para dar tempo do Torrentio responder
};

// Nossas palavras-chave de segurança
const PTBR_KEYWORDS = ['dublado', 'dual', 'pt-br', 'ptbr', 'portugues', 'pt_br'];

function isPtBr(title) {
  const t = title.toLowerCase();
  return PTBR_KEYWORDS.some(kw => t.includes(kw));
}

// Extrai qualidade e áudio para os botões do Nuvio
function getAudioInfo(title) {
  const text = title.toLowerCase();
  if (text.includes('dual') || (text.includes('dublado') && text.includes('legendado'))) return '🇧🇷 DUAL ÁUDIO';
  if (text.includes('dublado') || text.includes('ptbr') || text.includes('pt-br') || text.includes('portugues')) return '🇧🇷 DUBLADO';
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

// Extrai número de seeders do texto do Torrentio
function getSeeders(title) {
  const match = title.match(/👤\s*(\d+)/);
  return match ? match[1] : 'N/A';
}

// Busca Metadados do Stremio/Cinemeta para validar o Ano
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
    // 1. Pega os dados oficiais do filme
    const media = await getMediaInfo(type, id);
    const officialYear = media.year ? String(media.year) : null;
    console.log(`🎬 Validando: "${media.title || 'Desconhecido'}" (${officialYear || '?'})`);

    // 2. Faz a ponte pelo Torrentio
    console.log(`🌐 Extraindo links base do Torrentio...`);
    const torrentioUrl = `https://torrentio.strem.fun/stream/${type}/${id}.json`;
    
    const response = await axios.get(torrentioUrl, httpConfig);
    const torrentioStreams = response.data.streams || [];

    // 3. Aplica os seus filtros
    torrentioStreams.forEach(tStream => {
      const fullText = (tStream.title || "").toLowerCase() + " " + (tStream.name || "").toLowerCase();

      // FILTRO 1: Só passa se tiver tag de dublagem do Brasil
      if (!isPtBr(fullText)) return;

      // FILTRO 2: Validação rigorosa de ano
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
        name: `[${quality}]`,
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
