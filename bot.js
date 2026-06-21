const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process'); // 👈 NUEVO: Necesario para leer Git

// ===== INICIALIZACIÓN BASE44 =====
let base44;

async function inicializarBase44() {
    try {
        const { createClient } = await import('@base44/sdk');
        base44 = createClient({
            appId: "697ceab9cdcd480e7b1472b0",
            headers: {
                "api_key": "968ef93889b24f499b127a8936469dc4"
            }
        });
        console.log('✅ SDK de Base44 cargado correctamente');
    } catch (error) {
        console.error('❌ Error al cargar Base44:', error);
    }
}

inicializarBase44();

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// ===== CARGAR WHITELIST =====
const whitelistPath = path.join(__dirname, 'whitelist.json');
function getWhitelist() {
    if (!fs.existsSync(whitelistPath)) {
        fs.writeFileSync(whitelistPath, JSON.stringify({ "34000000000@c.us": "ID_PARTICIPANTE_BASE44" }, null, 2));
    }
    return JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
}

// ===== EXTRACTOR DE ID ÚNICO =====
function getUniqueId(link) {
    if (!link) return "";
    try {
        if (link.includes('spotify')) {
            const match = link.match(/(?:album|track|playlist)[\/:]([a-zA-Z0-9]+)/i);
            if (match) return `spotify_${match[1]}`; 
        }
        
        if (link.includes('youtube.com') || link.includes('youtu.be')) {
            const listMatch = link.match(/list=([\w-]+)/i);
            if (listMatch) return `youtube_list_${listMatch[1]}`;
            
            const videoMatch = link.match(/(?:v=|youtu\.be\/)([\w-]+)/i);
            if (videoMatch) return `youtube_video_${videoMatch[1]}`;
        }

        return link.split('?')[0].replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    } catch (e) {
        return link;
    }
}

// ===== QR LOGIN =====
client.on('qr', (qr) => {
    console.log('Escanea este QR con WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('🤖 Bot listo y conectado\n');
});

// ===== HELPERS DE CONFIGURACIÓN =====
const configPath = path.join(__dirname, 'config.json');
function getConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ 
            admins: [], 
            logGroupId: "",
            mainGroupId: "",
            davidFalsoId: "",
            davidFalsoCooldownSec: 20,
            botVersion: "1.0.0" // 👈 NUEVO: Plan B si Git no está disponible
        }, null, 2));
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// ===== NORMALIZADOR DE URLs =====
function normalizeUrl(rawUrl) {
    try {
        const parsedUrl = new URL(rawUrl);
        
        if (parsedUrl.hostname.includes('spotify.com')) {
            parsedUrl.search = ''; 
            return parsedUrl.toString();
        }
        
        if (parsedUrl.hostname.includes('youtube.com') || parsedUrl.hostname.includes('youtu.be')) {
            const listId = parsedUrl.searchParams.get('list');
            const videoId = parsedUrl.searchParams.get('v');
            
            parsedUrl.search = ''; 
            
            if (listId) parsedUrl.searchParams.set('list', listId);
            if (videoId) parsedUrl.searchParams.set('v', videoId);
            
            return parsedUrl.toString();
        }
        
        return rawUrl;
    } catch (e) {
        return rawUrl; 
    }
}

// ===== PARSEADOR DE LENGUAJE NATURAL (BLINDADO) =====
function parseUserMessage(text) {
    const result = { url: null, isSE: false, rating: null, comment: "", customDateLabel: null };

    let rawMatchedUrl = "";
    const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch) {
        rawMatchedUrl = urlMatch[1];
        result.url = normalizeUrl(rawMatchedUrl);
    }

    const ratingRegex = /(\d+(?:[.,']\d+)?)\s*\/\s*10/g;
    let ratingMatch;
    let lastRating = null;
    let ratingStringToRemove = ""; 
    
    while ((ratingMatch = ratingRegex.exec(text)) !== null) {
        const cleanNumber = ratingMatch[1].replace(',', '.').replace("'", ".");
        lastRating = parseFloat(cleanNumber);
        ratingStringToRemove = ratingMatch[0];
    }
    if (lastRating !== null) result.rating = lastRating;

    if (/\bS\/E\b/i.test(text)) result.isSE = true;

    const fractionRegex = /\b\d+\s*\/\s*\d+(?:\s*\/\s*\d+)?(?:\s*\+\s*\d+)?\b/g;
    const fractions = text.match(fractionRegex);
    
    if (fractions) {
        for (let f of fractions) {
            if (f.includes('+') || f.match(/\/\d{4}\b/) || f.match(/\/(28|29|30|31)\b/)) {
                result.customDateLabel = f.trim();
            }
        }
    }

    let cleanText = text;
    
    if (rawMatchedUrl) cleanText = cleanText.replace(rawMatchedUrl, '');
    if (ratingStringToRemove) cleanText = cleanText.replace(ratingStringToRemove, '');
    
    cleanText = cleanText.replace(/\bS\/E(?:\s*:\s*\d+)?\b/ig, '');
    cleanText = cleanText.replace(/_:\s*\d+/g, '');
    cleanText = cleanText.replace(/\b\d+\s*\/\s*\d+(?:\s*\/\s*\d+)?(?:\s*\+\s*\d+)?\b/g, ''); 
    
    cleanText = cleanText.replace(/[📊📅💬⭐🔗`➤⊹★➯]/gu, '');
    cleanText = cleanText.replace(/[_*~]+/g, '');
    cleanText = cleanText.replace(/[•*\-]?\s*abi[\w\s]*$/i, '');

    result.comment = cleanText.trim().replace(/\n{3,}/g, '\n\n'); 

    return result;
}

// ===== VARIABLES DE ESTADO =====
const userCooldowns = {}; 

client.on('message_create', async (msg) => {
    const config = getConfig();

    // 🛑 FILTRO DE AISLAMIENTO ABSOLUTO (Corregido)
    // Comprobamos 'msg.from' (entrantes) y 'msg.to' (salientes, por si el bot y tú usáis el mismo número)
    const isMainGroup = msg.from === config.mainGroupId || msg.to === config.mainGroupId;
    const isLogGroup = msg.from === config.logGroupId || msg.to === config.logGroupId;

    if (!isMainGroup && !isLogGroup) {
        return; // Drop silencioso absoluto si no es en BotCOMM o Logs
    }

    const text = msg.body.trim();
    const PREFIX = "`[ Multimarzo ]` "; 
    
    // Obtenemos el ID real del usuario
    const senderId = msg.author || msg.from; 
    const chat = await msg.getChat();
    
    // --- ESPÍA SYSTEM RESTRINGIDO ---
    if (chat.isGroup) {
        const groupLabel = isMainGroup ? "MAIN GROUP" : "LOG GROUP";
        console.log(`━━━━━━━━━ [ ESPÍA SYSTEM - ${groupLabel} ] ━━━━━━━━━\nGrupo: ${chat.name} | Usuario: ${senderId}\n\n${text}\n`);
    }

    if (!text.startsWith('/')) return;

    // --- COMANDO EASTER EGG (Público con Cooldown Silencioso INDIVIDUAL) ---
    if (text === '/davidFalso') {
        const now = Date.now();
        
        const cooldownSec = config.davidFalsoCooldownSec !== undefined ? config.davidFalsoCooldownSec : 20;
        const cooldownTime = cooldownSec * 1000;

        // Comprobación del timeout individual (Drop Silencioso)
        const lastUserTime = userCooldowns[senderId] || 0;
        if (now - lastUserTime < cooldownTime) {
            return; 
        }

        try {
            if (!config.mainGroupId || !config.davidFalsoId) {
                await msg.reply("⚠️ Faltan configurar 'mainGroupId' o 'davidFalsoId' en el sistema.");
                return;
            }
            
            const mainChat = await client.getChatById(config.mainGroupId);
            const messages = await mainChat.fetchMessages({ limit: 500 });
            
            const davidMessages = messages.filter(m => 
                m.author === config.davidFalsoId && 
                m.body && 
                m.body.trim().length > 0 && 
                !m.hasMedia
            );
            
            if (davidMessages.length > 0) {
                const randomMsg = davidMessages[Math.floor(Math.random() * davidMessages.length)];
                await msg.reply(`📦 *Abriendo MM-Box...*\n✨ ¡Ha tocado sabiduría de David Falso!\n\n_"${randomMsg.body}"_`);
                
                userCooldowns[senderId] = Date.now();
            } else {
                await msg.reply("😔 No he encontrado frases recientes de David Falso en mi memoria caché.");
            }
        } catch (e) {
            console.error("Error en easter egg:", e);
        }
        return;
    }

    // --- FILTRO DE ADMINISTRADORES ---
    const admins = config.admins || [];
    if (!admins.includes(senderId)) {
        return; 
    }

    // --- COMANDOS PRIVADOS (Solo Admins) ---

    if (text === '/getTimeout') {
        const cooldown = config.davidFalsoCooldownSec !== undefined ? config.davidFalsoCooldownSec : 20;
        await msg.reply(`⏱️ El cooldown individual actual de /davidFalso es de *${cooldown}* segundos.`);
        return;
    }

    if (text.startsWith('/setTimeout ')) {
        const args = text.split(' ');
        const segs = parseInt(args[1], 10);
        if (isNaN(segs) || segs < 0) {
            await msg.reply("❌ Error: Especifica una cantidad de segundos válida y mayor o igual a 0.");
            return;
        }
        
        try {
            const currentConfig = getConfig();
            currentConfig.davidFalsoCooldownSec = segs;
            fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2));
            await msg.reply(`✅ Cooldown de /davidFalso modificado dinámicamente a *${segs}* segundos.`);
        } catch (err) {
            console.error(err);
            await msg.reply("❌ Error crítico escribiendo el nuevo valor en config.json.");
        }
        return;
    }

    if (text === '/version') {
        try {
            const gitDate = execSync('git log -1 --format="%cd" --date=format:"%d/%m/%Y %H:%M:%S"').toString().trim();
            const gitHash = execSync('git log -1 --format="%h"').toString().trim();
            
            // Intentamos leer la última modificación de FETCH_HEAD (Último intento de sincronización del Cron)
            let lastCheckDate = "Desconocida";
            try {
                const fetchHeadPath = path.join(__dirname, '.git', 'FETCH_HEAD');
                if (fs.existsSync(fetchHeadPath)) {
                    const stat = fs.statSync(fetchHeadPath);
                    const d = stat.mtime;
                    lastCheckDate = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
                }
            } catch (err) {}

            await msg.reply(`🤖 *BotCOMM - Estado del Sistema*\n\n🔄 *Última actualización aplicada:*\n📅 ${gitDate}\n🏷️ Commit: \`${gitHash}\`\n\n📡 *Último intento de sincronización (Cron):*\n⏱️ ${lastCheckDate}`);
        } catch (e) {
            const versionFallback = config.botVersion || "1.0.0";
            await msg.reply(`🤖 *BotCOMM - Estado del Sistema*\n\n🏷️ Versión (Config): \`${versionFallback}\`\n_(No se pudo contactar con el motor de Git)_`);
        }
        return;
    }

    if (text === '/info') {
        const infoMsg = `ℹ️ *SISTEMA MULTIMARZO - GUÍA DE USO*\n\n` +
        `🛠️ *COMANDOS DE UTILIDAD (Admins):*\n` +
        `🔹 */info* : Muestra este panel de ayuda.\n` +
        `🔹 */ping* : Comprueba si el bot está en línea.\n` +
        `🔹 */version* : Muestra la versión del bot y el último chequeo de Git.\n` +
        `🔹 */getTimeout* : Consulta el cooldown asignado al easter egg.\n` +
        `🔹 */setTimeout <segs>* : Modifica los segundos de cooldown en caliente.\n\n` +
        `🎧 *COMANDOS PÚBLICOS:*\n` +
        `🔹 */davidFalso* : Abre una caja sorpresa con sabiduría de David Falso.\n\n` +
        `🎧 *REGISTRO DE ESCUCHAS:*\n` +
        `Enviad las escuchas al grupo principal. El bot procesará al reaccionar con ☑️ o ✅.\n\n` +
        `*Obligatorio:*\n` +
        `🔗 Enlace Spotify/YouTube.\n` +
        `⭐ Nota X/10.\n` +
        `🏷️ S/E (Solo si es sin edición).\n` +
        `💬 Reseña.`;
        
        await msg.reply(infoMsg);
        return;
    }

    if (text === '/ping') {
        await msg.reply(`${PREFIX}pong`);
    }
});

// ===== METADATA FETCHER (APIs Oficiales + Web Scraping) =====
async function fetchDiscMetadata(url, uniqueId) {
    const config = getConfig();

    const extractYearFromText = (text) => {
        if (!text) return null;
        const m1 = text.match(/Released on:\s*(\d{4})/i);
        const m2 = text.match(/Release date:\s*(\d{4})/i);
        const m3 = text.match(/[℗©]\s*(\d{4})/i); 
        if (m1) return parseInt(m1[1]);
        if (m2) return parseInt(m2[1]);
        if (m3) return parseInt(m3[1]);
        return null;
    };
    
    try {
        // --- SPOTIFY ---
        if (uniqueId.startsWith('spotify_')) {
            const spotifyId = uniqueId.split('_')[1];
            
            const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(config.spotifyClientId + ':' + config.spotifyClientSecret).toString('base64')
                },
                body: 'grant_type=client_credentials'
            });

            if (!tokenResponse.ok) return null;
            const tokenData = await tokenResponse.json();
            const accessToken = tokenData.access_token;

            const albumResponse = await fetch(`https://api.spotify.com/v1/albums/${spotifyId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (!albumResponse.ok) return null;
            const albumData = await albumResponse.json();

            const title = albumData.name;
            const artist = albumData.artists.map(a => a.name).join(', ');
            const year = parseInt(albumData.release_date.substring(0, 4));
            
            let type = "Álbum";
            if (albumData.album_type === "single") type = albumData.total_tracks > 1 ? "EP" : "Sencillo";
            if (albumData.album_type === "compilation") type = "Recopilatorio";

            const trackCount = albumData.total_tracks;
            const coverUrl = albumData.images.length > 0 ? albumData.images[0].url : "";

            const totalMs = albumData.tracks.items.reduce((acc, track) => acc + track.duration_ms, 0);
            const totalMinutes = Math.floor(totalMs / 60000);

            return { title, artist, year, type, trackCount, coverUrl, duration_minutes: totalMinutes, source: 'Spotify' };
        }
        
        // --- YOUTUBE MUSIC ---
        if (uniqueId.startsWith('youtube_')) {
            const isPlaylist = uniqueId.startsWith('youtube_list_');
            const ytId = uniqueId.replace('youtube_list_', '').replace('youtube_video_', '');
            const apiKey = config.youtubeApiKey;

            let permanentCoverUrl = "";
            let webScrapedYear = null;
            let webScrapedType = null;
            let systemScrapedType = null;
            let webScrapedArtists = []; 
            
            try {
                const publicUrl = isPlaylist ? `https://music.youtube.com/playlist?list=${ytId}` : `https://music.youtube.com/watch?v=${ytId}`;
                
                const webRes = await fetch(publicUrl, {
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                        'Cookie': 'CONSENT=YES+cb.20230101-11-p0.es+FX+308; SOCS=CAI;' 
                    }
                });
                
                if (webRes.ok) {
                    const htmlText = await webRes.text();
                    
                    const perenneRegex = /(?:https?:)?[\\\/]+(?:[a-zA-Z0-9-]+\.)?googleusercontent\.com[\\\/]+profile[\\\/]+picture[\\\/]+\d+/i;
                    const perenneMatch = htmlText.match(perenneRegex);
                    
                    if (perenneMatch) {
                        permanentCoverUrl = perenneMatch[0].replace(/\\/g, '');
                        if (permanentCoverUrl.startsWith('//')) permanentCoverUrl = 'https:' + permanentCoverUrl;
                    } else {
                        const ogImageMatch = htmlText.match(/<meta\s+(?:property|name)=["'](?:og|twitter):image["']\s+content=["']([^"']+)["']/i);
                        if (ogImageMatch && ogImageMatch[1] && !ogImageMatch[1].includes('ytimg.com')) {
                            permanentCoverUrl = ogImageMatch[1];
                        }
                    }

                    const yearRegex = /"musicAlbumReleaseContext":\{"releaseDate":\{"year":(\d{4})/i;
                    const yearMatch = htmlText.match(yearRegex);
                    if (yearMatch) {
                        webScrapedYear = parseInt(yearMatch[1]);
                    }

                    try {
                        const scriptMatch = htmlText.match(/ytInitialData\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
                        if (scriptMatch) {
                            const data = JSON.parse(scriptMatch[1]);
                            const tabContent = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0];
                            const header = tabContent?.musicResponsiveHeaderRenderer || tabContent?.musicDetailHeaderRenderer;
                            
                            if (!permanentCoverUrl && header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.length > 0) {
                                const thumbs = header.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails;
                                permanentCoverUrl = thumbs[thumbs.length - 1].url;
                            }
                            
                            if (header?.subtitle?.runs?.length > 0) {
                                for (const run of header.subtitle.runs) {
                                    const text = run.text.trim();
                                    const textLower = text.toLowerCase();
                                    
                                    if (textLower === 'single' || textLower === 'sencillo') webScrapedType = 'Sencillo';
                                    else if (textLower === 'ep') webScrapedType = 'EP';
                                    else if (textLower === 'album' || textLower === 'álbum') webScrapedType = 'Álbum';
                                    else if (/^\d{4}$/.test(textLower)) webScrapedYear = parseInt(textLower);
                                    
                                    if (run.navigationEndpoint && !/^\d{4}$/.test(textLower) && !['single', 'sencillo', 'ep', 'album', 'álbum'].includes(textLower)) {
                                        webScrapedArtists.push(text.replace(/\s*-\s*Topic/i, ''));
                                    }
                                }
                            }
                        }
                    } catch (jsonErr) {}

                    const releaseTypeRegex = /"musicAlbumReleaseType":\s*"MUSIC_ALBUM_RELEASE_TYPE_([A-Z]+)"/i;
                    const typeMatch = htmlText.match(releaseTypeRegex);
                    if (typeMatch) {
                        const t = typeMatch[1].toLowerCase();
                        if (t === 'single') systemScrapedType = "Sencillo";
                        else if (t === 'ep') systemScrapedType = "EP";
                        else if (t === 'album') systemScrapedType = "Álbum";
                    }
                }
            } catch (e) {}

            if (isPlaylist) {
                const ytRes = await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&id=${ytId}&key=${apiKey}`);
                if (!ytRes.ok) return null;
                const ytData = await ytRes.json();
                if (!ytData.items || ytData.items.length === 0) return null;

                const item = ytData.items[0];
                const rawTitle = item.snippet.title;
                const trackCount = item.contentDetails.itemCount;
                
                let type = "Álbum";
                let title = rawTitle;

                const prefixRegex = /^(Álbum|Album|EP|Single|Sencillo)\s*[-–—•]\s*/i;
                const suffixRegex = /\s*[-–—•]\s*(Álbum|Album|EP|Single|Sencillo)$/i;

                let titleScrapedType = null;
                const prefixMatch = rawTitle.match(prefixRegex);
                const suffixMatch = rawTitle.match(suffixRegex);

                if (prefixMatch) {
                    const t = prefixMatch[1].toLowerCase();
                    if (t === 'single' || t === 'sencillo') titleScrapedType = 'Sencillo';
                    else if (t === 'ep') titleScrapedType = 'EP';
                } else if (suffixMatch) {
                    const t = suffixMatch[1].toLowerCase();
                    if (t === 'single' || t === 'sencillo') titleScrapedType = 'Sencillo';
                    else if (t === 'ep') titleScrapedType = 'EP';
                }

                if (webScrapedType) {
                    type = webScrapedType;
                } else if (titleScrapedType) {
                    type = titleScrapedType;
                } else if (systemScrapedType && systemScrapedType !== "Álbum") {
                    type = systemScrapedType;
                } else {
                    if (trackCount === 1) type = "Sencillo";
                    else if (trackCount > 1 && trackCount <= 5) type = "EP";
                    else type = "Álbum";
                }

                title = rawTitle.replace(prefixRegex, '').replace(suffixRegex, '');

                let artist = item.snippet.channelTitle.replace(/\s*-\s*Topic/i, ''); 
                if (webScrapedArtists.length > 0) {
                    artist = [...new Set(webScrapedArtists)].join(', ');
                }
                
                let year = null; 
                let coverUrl = permanentCoverUrl;
                
                if (!coverUrl) {
                    const thumbs = item.snippet.thumbnails || {};
                    const bestThumb = thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default;
                    coverUrl = bestThumb ? bestThumb.url : "";
                }

                let totalSeconds = 0;
                let foundReleaseYear = null;

                try {
                    let videoIds = [];
                    let pageToken = "";
                    
                    do {
                        const pageParam = pageToken ? `&pageToken=${pageToken}` : '';
                        const itemsRes = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${ytId}&key=${apiKey}${pageParam}`);
                        if (!itemsRes.ok) break;
                        const itemsData = await itemsRes.json();
                        
                        const ids = itemsData.items.map(i => i.contentDetails.videoId).filter(Boolean);
                        videoIds.push(...ids);
                        
                        pageToken = itemsData.nextPageToken || "";
                    } while (pageToken);

                    let isFirstVideoRefined = false;

                    for (let i = 0; i < videoIds.length; i += 50) {
                        const batchIds = videoIds.slice(i, i + 50).join(',');
                        const vidRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${batchIds}&key=${apiKey}`);
                        if (!vidRes.ok) continue;
                        const vidData = await vidRes.json();
                        
                        for (const vid of vidData.items) {
                            if (!isFirstVideoRefined && webScrapedArtists.length === 0) {
                                const refinedArtist = vid.snippet.channelTitle.replace(/\s*-\s*Topic/i, '');
                                if (refinedArtist && refinedArtist.toLowerCase() !== 'youtube') {
                                    artist = refinedArtist;
                                }
                                isFirstVideoRefined = true;
                            }

                            if (!foundReleaseYear) {
                                const desc = vid.snippet.description || '';
                                const extracted = extractYearFromText(desc);
                                if (extracted) foundReleaseYear = extracted;
                            }

                            const durStr = vid.contentDetails.duration;
                            const match = durStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
                            if (match) {
                                const h = parseInt(match[1] || 0, 10);
                                const m = parseInt(match[2] || 0, 10);
                                const s = parseInt(match[3] || 0, 10);
                                totalSeconds += (h * 3600) + (m * 60) + s;
                            }
                        }
                    }

                    if (webScrapedYear) {
                        year = webScrapedYear; 
                    } else if (foundReleaseYear) {
                        year = foundReleaseYear; 
                    } else {
                        year = parseInt(item.snippet.publishedAt.substring(0, 4)); 
                    }

                } catch (err) {}
                
                const totalMinutes = Math.floor(totalSeconds / 60);

                return { title, artist, year, type, trackCount, coverUrl, duration_minutes: totalMinutes, source: 'YouTube Music' };
            
            } else {
                const ytRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${ytId}&key=${apiKey}`);
                if (!ytRes.ok) return null;
                const ytData = await ytRes.json();
                if (!ytData.items || ytData.items.length === 0) return null;

                const item = ytData.items[0];
                let title = item.snippet.title;
                
                let artist = item.snippet.channelTitle.replace(/\s*-\s*Topic/i, '');
                if (webScrapedArtists.length > 0) {
                    artist = [...new Set(webScrapedArtists)].join(', ');
                }
                
                let coverUrl = permanentCoverUrl;
                if (!coverUrl) {
                    const thumbs = item.snippet.thumbnails || {};
                    const bestThumb = thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default;
                    coverUrl = bestThumb ? bestThumb.url : "";
                }

                let year = null;
                const desc = item.snippet.description || '';
                const extracted = extractYearFromText(desc);
                
                if (webScrapedYear) {
                    year = webScrapedYear;
                } else if (extracted) {
                    year = extracted;
                } else {
                    year = parseInt(item.snippet.publishedAt.substring(0, 4));
                }

                let type = "Sencillo";
                if (webScrapedType) {
                    type = webScrapedType;
                }

                const durStr = item.contentDetails.duration;
                let totalSeconds = 0;
                const match = durStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
                if (match) {
                    const h = parseInt(match[1] || 0, 10);
                    const m = parseInt(match[2] || 0, 10);
                    const s = parseInt(match[3] || 0, 10);
                    totalSeconds = (h * 3600) + (m * 60) + s;
                }
                const totalMinutes = Math.floor(totalSeconds / 60);

                return { title, artist, year, type, trackCount: 1, coverUrl, duration_minutes: totalMinutes, source: 'YouTube Music' };
            }
        }
    } catch (e) {
        return null;
    }
    return null;
}

// ===== REACTION HANDLER (El motor principal) =====
client.on('message_reaction', async (reaction) => {
    
    const config = getConfig();
    const mainGroupId = config.mainGroupId;
    const logGroupId = config.logGroupId;

    // 🛑 FILTRO DE AISLAMIENTO ABSOLUTO: Ignorar si la reacción ocurre fuera del mainGroup o logGroup
    if (reaction.msgId.remote !== mainGroupId && reaction.msgId.remote !== logGroupId) {
        return; 
    }
    
    const cleanEmoji = reaction.reaction.replace(/[\uFE0F\u200D]/g, '');
    if (cleanEmoji !== '☑' && cleanEmoji !== '✅') return;

    const admins = config.admins || [];
    if (!admins.includes(reaction.senderId)) return;

    let msg;
    try {
        msg = await client.getMessageById(reaction.msgId._serialized);
    } catch (e) {
        return;
    }

    const text = msg.body.trim();
    const senderId = msg.author || msg.from;
    const logGroup = config.logGroupId;
    const PREFIX = "`[ Multimarzo BD ]` "; 

    let logMsgObj = null;
    const updateLog = async (logText, isFinal = false) => {
        if (!logGroup) {
            console.log(logText); 
            return;
        }
        try {
            if (!logMsgObj) {
                logMsgObj = await client.sendMessage(logGroup, logText);
            } else {
                if (isFinal) {
                    await logMsgObj.delete(true).catch(() => {});
                    logMsgObj = await client.sendMessage(logGroup, logText);
                } else if (typeof logMsgObj.edit === 'function') {
                    await logMsgObj.edit(logText);
                } else {
                    await logMsgObj.delete(true).catch(() => {});
                    logMsgObj = await client.sendMessage(logGroup, logText);
                }
            }
        } catch (e) {
            console.log("Error actualizando Log en WhatsApp:", logText);
        }
    };

    const whitelist = getWhitelist();
    const participantId = whitelist[senderId];

    if (!participantId) {
        await updateLog(`${PREFIX}🚫 Bloqueado: El usuario origen (${senderId}) no está en la whitelist.`);
        return;
    }

    await updateLog(`${PREFIX}⏳ Procesando reacción... Analizando mensaje.`);

    const parsedData = parseUserMessage(text);

    if (!parsedData.url || parsedData.rating === null) {
        await updateLog(`${PREFIX}❌ Reacción abortada. Faltan datos (Enlace o Nota X/10) en el mensaje.`);
        return;
    }

    if (parsedData.rating < 0 || parsedData.rating > 10) {
        await updateLog(`${PREFIX}❌ Error: La nota debe estar entre 0 y 10. (Detectado: ${parsedData.rating}).`);
        return;
    }

    const userUniqueId = getUniqueId(parsedData.url);

    try {
        let participantName = "Desconocido";
        let participantRecord = null;
        try {
            // Quitamos el 'const' para no sombrear la variable externa
            participantRecord = await base44.entities.Participant.get(participantId);
            if (participantRecord) participantName = participantRecord.name;
        } catch (e) {}

        const rawEditions = await base44.entities.Edition.list();
        const allEditions = Array.isArray(rawEditions) ? rawEditions : (rawEditions.data || rawEditions.items || rawEditions.records || []);
        
        let currentEditionYear = new Date().getFullYear();
        let currentEditionLimit = Infinity;

        if (allEditions.length > 0) {
            const currentEdition = allEditions.reduce((prev, current) => (prev.year > current.year) ? prev : current);
            currentEditionYear = currentEdition.year;
            currentEditionLimit = currentEdition.total_discs;
        }

        const editionYear = parsedData.isSE ? null : currentEditionYear;

        const rawDiscs = await base44.entities.Disc.list();
        const allDiscs = Array.isArray(rawDiscs) ? rawDiscs : (rawDiscs.data || rawDiscs.items || rawDiscs.records || []);
        
        // 1. PRIMERA COMPROBACIÓN: Por URL exacta (ID único)
        let existingDisc = allDiscs.find(disc => {
            if (!disc.link) return false;
            return getUniqueId(disc.link) === userUniqueId;
        });
        
        let discId;
        if (existingDisc) {
            discId = existingDisc.id;
        } else {
            await updateLog(`${PREFIX}⏳ Verificando metadatos para evitar duplicados en otras plataformas...`);
            
            const metadata = await fetchDiscMetadata(parsedData.url, userUniqueId);
            
            if (!metadata) {
                await updateLog(`${PREFIX}❌ Subida abortada.\nNo se pudieron extraer los metadatos de:\n🔗 ${parsedData.url}`);
                return;
            }

            // 2. SEGUNDA COMPROBACIÓN: Por Título y Artista (Magia Unicode anti-duplicados)
            existingDisc = allDiscs.find(disc => {
                if (!disc.title || !disc.artist) return false;
                
                const normalize = (str) => str.toLowerCase()
                    .replace(/\s*-\s*topic\s*$/i, '') 
                    .replace(/[^\p{L}\p{N}\s]/gu, '') // Mantiene letras de cualquier idioma (Japonés, Ruso, etc) y números
                    .replace(/\s+/g, '');             
                
                const dbTitle = normalize(disc.title);
                const newTitle = normalize(metadata.title);
                
                if (!dbTitle || !newTitle) return false; // Blindaje contra strings vacíos
                if (dbTitle !== newTitle) return false;
                
                const dbArtist = normalize(disc.artist);
                const newArtist = normalize(metadata.artist);
                const artistMatch = dbArtist.includes(newArtist) || newArtist.includes(dbArtist);
                
                const sameTracks = disc.track_count && metadata.trackCount && (disc.track_count === metadata.trackCount);
                const sameYear = disc.year && metadata.year && (Math.abs(disc.year - metadata.year) <= 1);
                
                return artistMatch || sameTracks || sameYear;
            });

            if (existingDisc) {
                discId = existingDisc.id;
            } else {
                try {
                    const newDiscPayload = {
                        title: metadata.title,
                        artist: metadata.artist,
                        year: metadata.year,
                        type: metadata.type,
                        duration_minutes: metadata.duration_minutes, 
                        track_count: metadata.trackCount,
                        cover_url: metadata.coverUrl, 
                        link: parsedData.url,
                        source: metadata.source 
                    };
                    
                    const createdDisc = await base44.entities.Disc.create(newDiscPayload);
                    discId = createdDisc.id;
                    
                } catch (err) {
                    console.error("Error insertando el disco:", err);
                    await updateLog(`${PREFIX}❌ Error crítico insertando el nuevo disco en la base de datos.`);
                    return;
                }
            }
        }

        let listenOrder = null;
        if (editionYear !== null) {
            const rawListens = await base44.entities.Listen.list();
            const allListens = Array.isArray(rawListens) ? rawListens : (rawListens.data || rawListens.items || rawListens.records || []);
            
            const userEditionListens = allListens.filter(l => 
                l.participant_id === participantId && 
                l.edition_year === editionYear
            );
            
            listenOrder = userEditionListens.length + 1;

            if (listenOrder > currentEditionLimit) {
                await updateLog(`${PREFIX}❌ Límite alcanzado.\n${participantName} ya ha completado los ${currentEditionLimit} discos de la edición.`);
                return;
            }
        }

        const messageDate = new Date(msg.timestamp * 1000); 

        const listenPayload = {
            participant_id: participantId,
            disc_id: discId,
            edition_year: editionYear,
            rating: parsedData.rating,
            comment: parsedData.comment,
            listen_date: messageDate.toISOString() 
        };

        if (listenOrder !== null) {
            listenPayload.listen_order = listenOrder;
        }

        // 1. CREAMOS LA ESCUCHA Y GUARDAMOS SU ID
        const createdListen = await base44.entities.Listen.create(listenPayload);

        // --- SISTEMA DE CRÉDITOS ---
        let creditAwarded = 0; // Ahora guardará la cantidad dinámica en lugar de un booleano
        let newCreditsBalance = 0;

        // Comprobamos que no sea S/E y que hayamos podido obtener los datos del participante
        if (editionYear !== null && participantRecord) {
            let isAlive = true;
            const status = participantRecord.edition_status ? participantRecord.edition_status[editionYear] : 'En curso';
            const defeatOrder = participantRecord.edition_defeat_order ? participantRecord.edition_defeat_order[editionYear] : null;

            // Lógica de "En Vivo": 
            // - Si hay un orden de derrota fijado, comprobamos que la escucha actual sea anterior a ese número.
            // - Si el estado es "Derrota" (pero no hay número) o "Inactivo", está fuera.
            if (defeatOrder && listenOrder >= defeatOrder) {
                isAlive = false;
            } else if (status === 'Derrota' && !defeatOrder) {
                isAlive = false;
            } else if (status === 'Inactivo') {
                isAlive = false;
            }

            if (isAlive) {
                // FETCH DINÁMICO DE CRÉDITOS DESDE AppConfig
                let creditsToAward = 1; // Valor por defecto (salvavidas)
                
                try {
                    const rawConfigs = await base44.entities.AppConfig.list();
                    const allConfigs = Array.isArray(rawConfigs) ? rawConfigs : (rawConfigs.data || rawConfigs.items || rawConfigs.records || []);
                    
                    const creditConfig = allConfigs.find(c => c.key === 'credits_per_listen');
                    if (creditConfig && typeof creditConfig.value === 'number') {
                        creditsToAward = creditConfig.value;
                    }
                } catch (e) {
                    console.error("⚠️ No se pudo obtener 'credits_per_listen' de AppConfig. Usando 1 por defecto.", e);
                }

                // Si la recompensa es mayor a 0, procedemos con la transacción
                if (creditsToAward > 0) {
                    newCreditsBalance = (participantRecord.credits || 0) + creditsToAward;
                    
                    // Actualizamos el saldo en el perfil del participante
                    await base44.entities.Participant.update(participantId, {
                        credits: newCreditsBalance
                    });

                    // Dejamos la huella en el registro de transacciones
                    await base44.entities.CreditTransaction.create({
                        participant_id: participantId,
                        amount: creditsToAward,
                        balance_after: newCreditsBalance,
                        type: "listen_reward",
                        description: `Recompensa por escucha #${listenOrder} (Edición ${editionYear})`,
                        related_listen_id: createdListen.id,
                        related_disc_id: discId,
                        transaction_date: messageDate.toISOString()
                    });

                    creditAwarded = creditsToAward;
                }
            }
        }

        // --- LÓGICA DE FORMATO DE FECHAS PARA EL LOG ---
        let dateFeedback;
        if (parsedData.isSE) {
            const msgDate = new Date(msg.timestamp * 1000);
            const d = msgDate.getDate().toString().padStart(2, '0');
            const m = (msgDate.getMonth() + 1).toString().padStart(2, '0');
            const y = msgDate.getFullYear();
            dateFeedback = `${d}/${m}/${y}`;
        } else {
            dateFeedback = parsedData.customDateLabel;
            if (!dateFeedback) {
                const msgDate = new Date(msg.timestamp * 1000);
                const d = msgDate.getDate();
                const mDays = new Date(msgDate.getFullYear(), msgDate.getMonth() + 1, 0).getDate();
                dateFeedback = `${d}/${mDays}`;
            }
        }
        
        if (dateFeedback && dateFeedback.includes('+')) {
            dateFeedback = dateFeedback.replace(/\s*\+\s*/g, ' +');
        }

        const orderText = parsedData.isSE ? 'S/E' : `${listenOrder}/${currentEditionLimit}`;

        let finalLog = `${PREFIX}✅ ¡Escucha subida con éxito!\n\n` +
                         `👤 *${participantName}*\n` +
                         `🔗 ${parsedData.url}\n\n` +
                         `📊 \`${orderText}\`\n` +
                         `📅 \`${dateFeedback}\`\n\n` +
                         `💬 ${parsedData.comment}\n\n` +
                         `⭐ \`${parsedData.rating}/10\``;

        // Añadimos un pequeño indicador visual al log si se han ganado créditos
        if (creditAwarded > 0) {
            finalLog += `\n\n> 🪙 +${creditAwarded} cr. (Total: ${newCreditsBalance})`;
        }

        await updateLog(finalLog, true);

    } catch (error) {
        console.error('❌ ERROR EN BASE44:', error);
        await updateLog(`${PREFIX}⚠️ Error crítico conectando con la base de datos durante la reacción.`);
    }
});

client.initialize();