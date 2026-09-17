const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const fetch = require('node-fetch'); // ou global fetch se usar Node v18+

const builder = new addonBuilder({
    id: 'org.meuaddon.br',
    version: '1.0.0',
    name: 'Meu Addon BR',
    description: 'Buscador PT-BR calibrado com qualidade e áudio',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: []
});

// Helper para extrair Áudio/Legenda com Emojis
function getAudioInfo(title) {
    const text = title.toLowerCase();
    if (text.includes('dual') || text.includes('tripla') || (text.includes('dublado') && text.includes('legendado'))) {
        return '🇧🇷 DUAL ÁUDIO (PT-BR / EN)';
    } else if (text.includes('dublado') || text.includes('ptbr') || text.includes('pt-br') || text.includes('portugues')) {
        return '🇧🇷 DUBLADO (PT-BR)';
    } else if (text.includes('legendado') || text.includes('subbed') || text.includes('leg')) {
        return '🇺🇸 LEGENDADO (PT-BR)';
    } else if (text.includes('english') || text.includes('eng')) {
        return '🇺🇸 INGLÊS (Sem Dublagem)';
    }
    return '🇧🇷 PT-BR / DUAL'; // Padrão se não especificar
}

// Helper para extrair Qualidade de Vídeo
function getQualityInfo(title) {
    const text = title.toLowerCase();
    if (text.includes('2160p') || text.includes('4k') || text.includes('uhd')) {
        return '4K UHD';
    } else if (text.includes('1080p') || text.includes('fhd') || text.includes('fullhd')) {
        return '1080p Full HD';
    } else if (text.includes('720p') || text.includes('hd')) {
        return '720p HD';
    }
    return '720p';
}

// Handler Principal do Stremio
builder.defineStreamHandler(async (args) => {
    if (args.type !== 'movie' && args.type !== 'series') {
        return { streams: [] };
    }

    try {
        // 1. Pega os dados oficiais do filme (Título e Ano) do Cinemeta pelo IMDB ID (ex: tt1234567)
        const metaRes = await fetch(`https://v3-cinemeta.stremio.com/meta/${args.type}/${args.id}.json`);
        const metaData = await metaRes.json();
        
        if (!metaData || !metaData.meta) return { streams: [] };

        const movieTitle = metaData.meta.name; // Ex: "Obsessão"
        const movieYear = metaData.meta.year;  // Ex: "2025"

        // 2. Busca nos seus provedores/fontes usando o título oficial
        // (Ajuste essa chamada para a sua função real de busca de torrents/links)
        const rawResults = await buscarFontes(movieTitle); 

        // 3. FILTRAGEM ESTRITA: Remove filmes errados, animes indesejados e anos diferentes
        const filteredResults = rawResults.filter(item => {
            const itemTitleLower = item.title.toLowerCase();
            
            // Requisito 1: O ano do filme DEVE estar no nome do arquivo (se disponível)
            if (movieYear && !itemTitleLower.includes(String(movieYear))) {
                return false; // Descarta se for de outro ano (evita filmes antigos com mesmo nome)
            }

            // Requisito 2: Se não for um anime nas metadados, ignora animes que aparecerem na busca
            if (metaData.meta.genres && !metaData.meta.genres.includes('Animation')) {
                if (itemTitleLower.includes('anime') || itemTitleLower.includes('batch')) {
                    return false;
                }
            }

            return true;
        });

        // 4. Formata os resultados no padrão bonito do Stremio
        const streams = filteredResults.map(item => {
            const quality = getQualityInfo(item.title);
            const audio = getAudioInfo(item.title);

            return {
                name: `[${quality}]`,
                title: `${movieTitle} (${movieYear})\n🔊 ${audio}\n💾 ${item.size || 'HD'}`,
                url: item.url,       // Se for link direto (HTTP/MP4/HLS)
                infoHash: item.hash  // Se for Magnet Link / Torrent
            };
        });

        return { streams };

    } catch (err) {
        console.error("Erro no processamento:", err);
        return { streams: [] };
    }
});

// Exemplo de função mock de busca (substitua pela sua lógica real)
async function buscarFontes(query) {
    // Aqui entra o seu scraper/fetch na sua fonte de torrents/links
    return [];
}

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Servidor ativo na porta ${PORT}`);
