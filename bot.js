const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process'); 

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

// ===== NORMALIZADOR DE IDs DE WHATSAPP (MULTI-DEVICE) =====
function normalizeWhatsAppId(id) {
    if (!id) return "";
    return id.replace(/:[0-9]+@/, '@');
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
            botVersion: "1.0.0" 
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

    // 🐛 FIX: Expresión regular ultratolerante (acepta espacios raros, guiones y letras O en vez de ceros)
    const ratingRegex = /(\d+(?:[.,']\s*\d+)?)\s*[\/∕-]\s*1[0oO]/gi;
    let ratingMatch;
    let lastRating = null;
    let ratingStringToRemove = ""; 
    
    while ((ratingMatch = ratingRegex.exec(text)) !== null) {
        // Limpiamos todo lo que no sea número o decimal para el parseFloat
        const cleanNumber = ratingMatch[1].replace(',', '.').replace("'", ".").replace(/\s+/g, '');
        lastRating = parseFloat(cleanNumber);
        ratingStringToRemove = ratingMatch[0];
    }
    if (lastRating !== null) result.rating = lastRating;

    if (/\bS\/E\b/i.test(text)) result.isSE = true;

    const fractionRegex = /\b\d+\s*\/\s*\d+(?:\s*\/\s*\d+)?(?:\s*\+\s*\d+)?\b/g;
    const fractions = text.match(fractionRegex);
    
    let dateStringToRemove = "";
    if (fractions) {
        for (let f of fractions) {
            if (f.includes('+') || f.match(/\/\d{4}\b/) || f.match(/\/(28|29|30|31)\b/)) {
                result.customDateLabel = f.trim();
                dateStringToRemove = f; 
            }
        }
    }

    let cleanText = text;
    
    // 1. Quitar enlaces, notas y fechas detectadas
    if (rawMatchedUrl) cleanText = cleanText.replace(rawMatchedUrl, '');
    if (ratingStringToRemove) cleanText = cleanText.replace(ratingStringToRemove, '');
    if (dateStringToRemove) cleanText = cleanText.replace(dateStringToRemove, '');
    cleanText = cleanText.replace(/\bS\/E(?:\s*:\s*\d+)?\b/ig, '');
    cleanText = cleanText.replace(/_:\s*\d+/g, '');
    
    // 2. Limpiar símbolos y decoración ANTES de la escoba
    cleanText = cleanText.replace(/[📊📅💬⭐🔗`➤⊹★➯]/gu, '');
    cleanText = cleanText.replace(/[_*~]+/g, '');
    cleanText = cleanText.replace(/[•*\-]?\s*abi[\w\s]*$/i, ''); // Firma específica

    // 3. Limpiar espacios en blanco de líneas vacías para que las regex multilínea funcionen bien
    cleanText = cleanText.replace(/^[ \t]+$/gm, '');

    // 4. ESCOBA INTELIGENTE: Ahora sí atrapará el "190/372" porque el "➤" ya fue eliminado
    cleanText = cleanText.replace(/^[ \t]*\d+\s*\/\s*\d+[ \t]*$/gm, '');

    // 5. Reducir los saltos de línea múltiples a un máximo de dos
    result.comment = cleanText.trim().replace(/\n{3,}/g, '\n\n'); 

    return result;
}

// ===== VARIABLES DE ESTADO =====
const userCooldowns = {}; 
const emergencyMessageCache = new Map(); // Cola local de mensajes
const MAX_CACHE_SIZE = 100; // Guardaremos las últimas 100 reseñas detectadas

client.on('message_create', async (msg) => {
    const config = getConfig();

    const isMainGroup = msg.from === config.mainGroupId || msg.to === config.mainGroupId;
    const isLogGroup = msg.from === config.logGroupId || msg.to === config.logGroupId;

    if (!isMainGroup && !isLogGroup) {
        return; 
    }

    const text = msg.body ? msg.body.trim() : "";
    const PREFIX = "`[ Multimarzo ]` "; 
    
    const rawSenderId = msg.author || msg.from; 
    const senderId = normalizeWhatsAppId(rawSenderId);
    
    // 📥 [NUEVO] INTERCEPTOR ABSOLUTO MOVIDO AL PRINCIPIO
    // Lo primero que hace el bot es guardar TODO, sin bloqueos.
    if ((isMainGroup || isLogGroup) && text) {
        try {
            emergencyMessageCache.set(msg.id.id, msg);
            emergencyMessageCache.set(msg.id._serialized, msg);
            console.log(`[📥 CACHÉ LOCAL] Mensaje guardado en RAM (ID: ${msg.id.id})`);
            
            if (emergencyMessageCache.size > 200) { // Ampliado para dar más margen
                const oldestKey = emergencyMessageCache.keys().next().value;
                emergencyMessageCache.delete(oldestKey);
            }
        } catch (err) {
            console.error("Error en interceptor:", err);
        }
    }

    // --- ESPÍA SYSTEM RESTRINGIDO (SIN BLOQUEOS) ---
    // Usamos .then() en lugar de await para que el bot NO se congele jamás
    msg.getChat().then(chat => {
        if (chat.isGroup) {
            const groupLabel = isMainGroup ? "MAIN GROUP" : "LOG GROUP";
            console.log(`━━━━━━━━━ [ ESPÍA SYSTEM - ${groupLabel} ] ━━━━━━━━━\nGrupo: ${chat.name} | Usuario: ${senderId}\n\n${text}\n`);
        }
    }).catch(() => {});

    if (!text.startsWith('/')) return;

    if (text === '/davidFalso') {
        const now = Date.now();
        
        const cooldownSec = config.davidFalsoCooldownSec !== undefined ? config.davidFalsoCooldownSec : 20;
        const cooldownTime = cooldownSec * 1000;

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
            
            const targetId = normalizeWhatsAppId(config.davidFalsoId);
            const davidMessages = messages.filter(m => 
                normalizeWhatsAppId(m.author) === targetId && 
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

    // Filtramos administradores aplicando normalización en ambos lados
    const admins = (config.admins || []).map(normalizeWhatsAppId);
    if (!admins.includes(senderId)) {
        return; 
    }

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

    // ===== COMANDO /upload <participante> <reseña> =====
    if (text.startsWith('/upload')) {
        const rawSenderId = msg.author || msg.from;
        const senderId = normalizeWhatsAppId(rawSenderId);
        const config = getConfig();
        const admins = (config.admins || []).map(normalizeWhatsAppId);

        if (!admins.includes(senderId)) {
            await msg.reply("❌ No tienes permisos para ejecutar comandos de administración.");
            return;
        }

        const match = text.match(/^\/upload\s+([^\s\n]+)[\s\n]+([\s\S]+)/i);

        if (!match) {
            await msg.reply("⚠️ *Uso correcto:*\n`/upload <participante> <reseña>`");
            return;
        }

        const targetName = match[1].trim();
        const reviewText = match[2].trim();
        const PREFIX = "`[ Multimarzo BD ]` ";

        await msg.reply(`${PREFIX}⏳ Procesando subida manual para *${targetName}*...`);

        try {
            // 1. Buscar participante
            const rawParticipants = await base44.entities.Participant.list();
            const allParticipants = Array.isArray(rawParticipants) ? rawParticipants : (rawParticipants.data || rawParticipants.items || rawParticipants.records || []);
            const participantRecord = allParticipants.find(p => p.name.toLowerCase() === targetName.toLowerCase());

            if (!participantRecord) {
                await msg.reply(`${PREFIX}❌ No he encontrado a ningún participante llamado "*${targetName}*" en Base44.`);
                return;
            }
            
            const participantId = participantRecord.id;
            const participantName = participantRecord.name;

            // 2. Parsear reseña
            const parsedData = parseUserMessage(reviewText);

            if (!parsedData.url || parsedData.rating === null) {
                await msg.reply(`${PREFIX}❌ Subida abortada. Faltan datos en el texto de la reseña (URL o Nota).`);
                return;
            }

            const userUniqueId = getUniqueId(parsedData.url);
            
            // 3. Lógica Base44 (Extraída de tu motor principal)
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
            
            let existingDisc = allDiscs.find(disc => {
                if (!disc.link) return false;
                return getUniqueId(disc.link) === userUniqueId;
            });
            
            let discId;

            if (existingDisc) {
                discId = existingDisc.id;
            } else {
                await msg.reply(`${PREFIX}⏳ Verificando metadatos para evitar duplicados en otras plataformas...`);
                
                const metadata = await fetchDiscMetadata(parsedData.url, userUniqueId);
                
                if (!metadata) {
                    await msg.reply(`${PREFIX}❌ Subida abortada.\nNo se pudieron extraer los metadatos de:\n🔗 ${parsedData.url}`);
                    return;
                }

                existingDisc = allDiscs.find(disc => {
                    if (!disc.title || !disc.artist) return false;
                    const normalize = (str) => str.toLowerCase().replace(/\s*-\s*topic\s*$/i, '').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, '');              
                    
                    const dbTitle = normalize(disc.title);
                    const newTitle = normalize(metadata.title);
                    if (!dbTitle || !newTitle) return false; 
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
                }
            }

            let listenOrder = null;
            if (editionYear !== null) {
                const rawListens = await base44.entities.Listen.list();
                const allListens = Array.isArray(rawListens) ? rawListens : (rawListens.data || rawListens.items || rawListens.records || []);
                
                const userEditionListens = allListens.filter(l => l.participant_id === participantId && l.edition_year === editionYear);
                listenOrder = userEditionListens.length + 1;

                if (listenOrder > currentEditionLimit) {
                    await msg.reply(`${PREFIX}❌ Límite alcanzado.\n${participantName} ya ha completado los ${currentEditionLimit} discos de la edición.`);
                    return;
                }
            }

            const messageDate = new Date(); 

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

            const createdListen = await base44.entities.Listen.create(listenPayload);

            let creditAwarded = 0; 
            let newCreditsBalance = participantRecord.credits || 0;

            if (editionYear !== null && participantRecord) {
                let isAlive = true;
                const status = participantRecord.edition_status ? participantRecord.edition_status[editionYear] : 'En curso';
                const defeatOrder = participantRecord.edition_defeat_order ? participantRecord.edition_defeat_order[editionYear] : null;

                if (defeatOrder && listenOrder >= defeatOrder) {
                    isAlive = false;
                } else if (status === 'Derrota' && !defeatOrder) {
                    isAlive = false;
                } else if (status === 'Inactivo') {
                    isAlive = false;
                }

                if (isAlive) {
                    let creditsToAward = 1; 
                    try {
                        const rawConfigs = await base44.entities.AppConfig.list();
                        const allConfigs = Array.isArray(rawConfigs) ? rawConfigs : (rawConfigs.data || rawConfigs.items || rawConfigs.records || []);
                        const creditConfig = allConfigs.find(c => c.key === 'credits_per_listen');
                        if (creditConfig && typeof creditConfig.value === 'number') {
                            creditsToAward = creditConfig.value;
                        }
                    } catch (e) {}

                    if (creditsToAward > 0) {
                        newCreditsBalance += creditsToAward;
                        await base44.entities.Participant.update(participantId, { credits: newCreditsBalance });

                        await base44.entities.CreditTransaction.create({
                            participant_id: participantId,
                            amount: creditsToAward,
                            balance_after: newCreditsBalance,
                            type: "listen_reward",
                            description: `Recompensa por escucha #${listenOrder} (Edición ${editionYear}) [Manual]`,
                            related_listen_id: createdListen.id,
                            related_disc_id: discId,
                            transaction_date: messageDate.toISOString()
                        });
                        creditAwarded = creditsToAward;
                    }
                }
            }

            let dateFeedback;
            if (parsedData.isSE) {
                const d = messageDate.getDate().toString().padStart(2, '0');
                const m = (messageDate.getMonth() + 1).toString().padStart(2, '0');
                const y = messageDate.getFullYear();
                dateFeedback = `${d}/${m}/${y}`;
            } else {
                dateFeedback = parsedData.customDateLabel;
                if (!dateFeedback) {
                    const d = messageDate.getDate();
                    const mDays = new Date(messageDate.getFullYear(), messageDate.getMonth() + 1, 0).getDate();
                    dateFeedback = `${d}/${mDays}`;
                }
            }
            if (dateFeedback && dateFeedback.includes('+')) {
                dateFeedback = dateFeedback.replace(/\s*\+\s*/g, ' +');
            }

            const orderText = parsedData.isSE ? 'S/E' : `${listenOrder}/${currentEditionLimit}`;

            let finalLog = `${PREFIX}✅ ¡Escucha subida manualmente con éxito!\n\n` +
                           `👤 *${participantName}*\n` +
                           `🔗 ${parsedData.url}\n\n` +
                           `📊 \`${orderText}\`\n` +
                           `📅 \`${dateFeedback}\`\n\n` +
                           `💬 ${parsedData.comment}\n\n` +
                           `⭐ \`${parsedData.rating}/10\``;

            if (creditAwarded > 0) {
                finalLog += `\n\n> 🪙 +${creditAwarded} cr. (Total: ${newCreditsBalance})`;
            }

            await msg.reply(finalLog);

        } catch (error) {
            console.error("Error en /upload:", error);
            await msg.reply(`${PREFIX}💥 Error crítico procesando la subida manual: ${error.message || error}`);
        }
        return; 
    }

    if (text === '/info') {
        const infoMsg = `ℹ️ *SISTEMA MULTIMARZO - GUÍA DE USO*\n\n` +
        `🛠️ *COMANDOS DE UTILIDAD (Admins):*\n` +
        `🔹 */info* : Muestra este panel de ayuda.\n` +
        `🔹 */ping* : Comprueba si el bot está en línea.\n` +
        `🔹 */version* : Muestra la versión del bot y el último chequeo de Git.\n` +
        `🔹 */whitelist* : Muestra la lista de usuarios autorizados.\n` +
        `🔹 */upload <nombre> <reseña>* : Sube una escucha a Base44 reasignada a un participante.\n` +
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

    if (text === '/whitelist') {
        try {
            await msg.reply("⏳ Cruzando datos locales con Base44...");
            
            const rawWhitelist = getWhitelist();
            // Filtramos las claves para ignorar las etiquetas manuales como "1.", "2."
            const validWaIds = Object.keys(rawWhitelist).filter(key => key.includes('@'));
            
            if (validWaIds.length === 0) {
                await msg.reply("📋 La whitelist está vacía o no tiene IDs válidos.");
                return;
            }

            // Descargamos todos los participantes de Base44 en una sola llamada para no saturar la API
            const rawParticipants = await base44.entities.Participant.list();
            const allParticipants = Array.isArray(rawParticipants) ? rawParticipants : (rawParticipants.data || rawParticipants.items || rawParticipants.records || []);
            
            let message = `📋 *WHITELIST DE MULTIMARZO*\n\n`;
            
            for (const waId of validWaIds) {
                const b44Id = rawWhitelist[waId];
                const participant = allParticipants.find(p => p.id === b44Id);
                const name = participant ? participant.name : "⚠️ Desconocido (ID de Base44 inválido)";
                
                message += `👤 *${name}*\n└ 📱 \`${waId}\`\n\n`;
            }
            
            await msg.reply(message.trim());
            
        } catch (error) {
            console.error("Error en /whitelist:", error);
            await msg.reply("❌ Error conectando con Base44 para obtener los nombres.");
        }
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
    
    if (!reaction || !reaction.msgId) {
        return;
    }

    const config = getConfig();
    const mainGroupId = config.mainGroupId;
    const logGroupId = config.logGroupId;

    if (reaction.msgId.remote !== mainGroupId && reaction.msgId.remote !== logGroupId) {
        return; 
    }
    
    const cleanEmoji = reaction.reaction.replace(/[\uFE0F\u200D]/g, '');
    if (cleanEmoji !== '☑' && cleanEmoji !== '✅') return;

    const reactorId = normalizeWhatsAppId(reaction.senderId);
    const admins = (config.admins || []).map(normalizeWhatsAppId);
    
    if (!admins.includes(reactorId)) {
        return;
    }

    let msg;
    const targetId = reaction.msgId.id; 
    const targetSerialized = reaction.msgId._serialized;

    try {
        // 1. WhatsApp Oficial Rápido
        msg = await client.getMessageById(targetSerialized);
        if (!msg) throw new Error("Mensaje undefined"); 
        
        // 🚨 EL ESCUDO CONTRA LA LOCURA DE WWebJS 🚨
        if (msg.id.id !== targetId) {
            console.log(`[⚠️ ALUCINACIÓN WWebJS] Pedí el ID ${targetId} pero me dio el ${msg.id.id}. Forzando rescate...`);
            throw new Error("WWebJS devolvió el mensaje incorrecto");
        }
        
    } catch (e) {
        // 2. Caché Local Inmediata (Busca por las dos claves)
        if (emergencyMessageCache.has(targetId)) {
            msg = emergencyMessageCache.get(targetId);
            console.log(`[♻️ RESCATE LOCAL ÉPICO] Mensaje recuperado por ID puro: ${targetId}`);
        } else if (emergencyMessageCache.has(targetSerialized)) {
            msg = emergencyMessageCache.get(targetSerialized);
            console.log(`[♻️ RESCATE LOCAL ÉPICO] Mensaje recuperado por ID serializado: ${targetSerialized}`);
        } else {
            // 3. Fallback a Historial
            console.log(`[📡 BÚSQUEDA ACTIVA] Buscando código: ${targetId}`);
            
            try {
                const chatToFetch = await client.getChatById(reaction.msgId.remote);
                const history = await chatToFetch.fetchMessages({ limit: 100 });
                const foundMsg = history.find(m => m.id.id === targetId);
                
                if (foundMsg) {
                    msg = foundMsg;
                    console.log(`[✅ RESCATE ÉPICO] Mensaje encontrado exitosamente en el historial.`);
                } else {
                    throw new Error("No está en el historial bajado");
                }
            } catch (fetchErr) {
                console.error("\n[🚨 ERROR EN DESCARGA DE HISTORIAL]:", fetchErr.message || fetchErr, "\n");
                const PREFIX = "`[ Multimarzo BD ]` "; 
                try {
                    await client.sendMessage(logGroupId, `${PREFIX}⚠️ *ALERTA CRÍTICA*\nNo puedo leer esta reseña por un error de sincronización. Por favor, copiad el texto, enviadlo como un mensaje NUEVO e intentad reaccionar al nuevo.`);
                } catch (err) {}
                return;
            }
        }
    }

    const text = msg.body ? msg.body.trim() : "";
    if (!text) return; // Abortamos si no hay texto extraíble
    
    // Normalizamos también el autor original del mensaje reaccionado
    const rawSenderId = msg.author || msg.from;
    const senderId = normalizeWhatsAppId(rawSenderId);
    
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

    // Cargamos y normalizamos la whitelist
    const rawWhitelist = getWhitelist();
    const whitelist = {};
    for (const key in rawWhitelist) {
        whitelist[normalizeWhatsAppId(key)] = rawWhitelist[key];
    }
    const participantId = whitelist[senderId];

    if (!participantId) {
        console.log(`[⚠️ DIAGNÓSTICO] Fallo de Whitelist para el ID: ${senderId}`);
        await updateLog(`${PREFIX}🚫 Bloqueado: El usuario origen (${senderId}) no está en la whitelist.`);
        return;
    }

    await updateLog(`${PREFIX}⏳ Procesando reacción... Analizando mensaje.`);

    const parsedData = parseUserMessage(text);

    // 🐛 DIAGNÓSTICO VISUAL EXACTO PARA REACCIONES
    if (!parsedData.url || parsedData.rating === null) {
        const debugUrl = parsedData.url ? '✅ Detectada' : '❌ Falla';
        const debugRating = parsedData.rating !== null ? `✅ Detectada (${parsedData.rating}/10)` : '❌ Falla';
        
        await updateLog(`${PREFIX}❌ Reacción abortada. Faltan datos en el mensaje.\n\n🔍 *Diagnóstico Forense:*\n🔗 URL: ${debugUrl}\n⭐ Nota: ${debugRating}\n\nLa reseña es:\n${text}`);
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

            existingDisc = allDiscs.find(disc => {
                if (!disc.title || !disc.artist) return false;
                
                const normalize = (str) => str.toLowerCase()
                    .replace(/\s*-\s*topic\s*$/i, '') 
                    .replace(/[^\p{L}\p{N}\s]/gu, '') 
                    .replace(/\s+/g, '');             
                
                const dbTitle = normalize(disc.title);
                const newTitle = normalize(metadata.title);
                
                if (!dbTitle || !newTitle) return false; 
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

        const createdListen = await base44.entities.Listen.create(listenPayload);

        let creditAwarded = 0; 
        let newCreditsBalance = 0;

        if (editionYear !== null && participantRecord) {
            let isAlive = true;
            const status = participantRecord.edition_status ? participantRecord.edition_status[editionYear] : 'En curso';
            const defeatOrder = participantRecord.edition_defeat_order ? participantRecord.edition_defeat_order[editionYear] : null;

            if (defeatOrder && listenOrder >= defeatOrder) {
                isAlive = false;
            } else if (status === 'Derrota' && !defeatOrder) {
                isAlive = false;
            } else if (status === 'Inactivo') {
                isAlive = false;
            }

            if (isAlive) {
                let creditsToAward = 1; 
                
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

                if (creditsToAward > 0) {
                    newCreditsBalance = (participantRecord.credits || 0) + creditsToAward;
                    
                    await base44.entities.Participant.update(participantId, {
                        credits: newCreditsBalance
                    });

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