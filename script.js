/* =========================================================
   CalenturaChat 😋 — lógica principal
   =========================================================
   Soporta:
   · OpenAI (GPT-4o, GPT-4.1, o1, etc.)           streaming SSE
   · Anthropic Claude (Sonnet, Haiku, Opus)         streaming SSE
   · Servidores locales compatibles con OpenAI      streaming SSE
   · Historial de chats persistido en localStorage
   · Ahorro de tokens: truncado configurable de contexto
   · Consulta de créditos / uso
   ========================================================= */

'use strict';

/* =========================================================
   CONSTANTES / MODELOS
   ========================================================= */

const PROVIDERS = {
    openai: {
        label: 'OpenAI',
        models: [
            { id: 'gpt-6-astra',  label: 'GPT-6 Astra', price: { in: 10.00, out: 50.00 } },
            { id: 'gpt-5.6-sol',  label: 'GPT-5.6 Sol', price: { in: 4.00, out: 20.00 } },
            { id: 'o1',           label: 'o1',            price: { in: 15.00, out: 60.00 } },
            { id: 'gpt-4.1',      label: 'GPT-4.1',       price: { in: 2.00, out: 8.00  } },
            { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', price: { in: 2.00, out: 12.00 } },
            { id: 'o3-mini',      label: 'o3 Mini',       price: { in: 1.10, out: 4.40  } },
            { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', price: { in: 0.40, out: 1.60  } },
            { id: 'gpt-5.6-luna',  label: 'GPT-5.6 Luna', price: { in: 0.20, out: 1.20 } },
            { id: 'gpt-image-2.5-sunburst', label: 'GPT-Image-2.5 (Sunburst)', price: { perImage: 0.040 } },
            { id: 'gpt-image-2.5-flare',    label: 'GPT-Image-2.5 (Flare)',    price: { perImage: 0.035 } },
        ]
    },
    anthropic: {
        label: 'Anthropic',
        models: [
            // Precios actualizados sept-2026 (por 1M tokens)
            { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  price: { in: 1.00, out: 5.00  } },
            { id: 'claude-sonnet-5',   label: 'Claude Sonnet 5',   price: { in: 2.00, out: 10.00 } },
            { id: 'claude-opus-5',     label: 'Claude Opus 5',     price: { in: 5.00, out: 25.00 } },
            { id: 'claude-fable-5-1',  label: 'Claude Fable 5.1',  price: { in: 10.00, out: 50.00 } },
        ]
    },
    local: {
        label: 'Local',
        models: [] // se completa dinámicamente
    }
};

/* =========================================================
   CONFIGURACIÓN (persistida en localStorage)
   ========================================================= */

function loadConfig() {
    return {
        provider:        localStorage.getItem('nc_provider')     || 'openai',
        openaiKey:       localStorage.getItem('nc_openai_key')   || '',
        anthropicKey:    localStorage.getItem('nc_anthropic_key')|| '',
        openaiModel:     localStorage.getItem('nc_openai_model') || 'gpt-5.6-sol',
        anthropicModel:  localStorage.getItem('nc_anthropic_model') || 'claude-sonnet-5',
        localApiUrl:     localStorage.getItem('nc_local_url')    || 'http://localhost:8080/v1',
        localKey:        localStorage.getItem('nc_local_key')    || '',
        localModel:      localStorage.getItem('nc_local_model')  || '',
        systemPrompt:    localStorage.getItem('nc_system')       ||
            'Eres un asistente útil, preciso y conversacional. Responde en el idioma en que te hablen.',
        maxContext:      Number(localStorage.getItem('nc_max_context'))  || 20,
        maxTokens:       Number(localStorage.getItem('nc_max_tokens'))   || 2048,
    };
}

function saveConfig() {
    localStorage.setItem('nc_provider',       cfg.provider);
    localStorage.setItem('nc_openai_key',     cfg.openaiKey);
    localStorage.setItem('nc_anthropic_key',  cfg.anthropicKey);
    localStorage.setItem('nc_openai_model',   cfg.openaiModel);
    localStorage.setItem('nc_anthropic_model',cfg.anthropicModel);
    localStorage.setItem('nc_local_url',      cfg.localApiUrl);
    localStorage.setItem('nc_local_key',      cfg.localKey);
    localStorage.setItem('nc_local_model',    cfg.localModel);
    localStorage.setItem('nc_system',         cfg.systemPrompt);
    localStorage.setItem('nc_max_context',    cfg.maxContext);
    localStorage.setItem('nc_max_tokens',     cfg.maxTokens);
}

let cfg = loadConfig();

if (cfg.localModel) {
    PROVIDERS.local.models = [{ id: cfg.localModel, label: cfg.localModel }];
}

/* =========================================================
   ESTADO
   ========================================================= */

let generating      = false;
let abortController = null;
let thinkingMode    = false;
let magicPrompt     = false;
let reasoningLevel  = 'medium'; // default reasoning level for new models

// Modelos que soportan reasoning_effort y sus niveles disponibles
const REASONING_LEVELS = {
    'gpt-6-astra':  [
        { value: 'low',    label: 'Ligero' },
        { value: 'medium', label: 'Moderado' },
        { value: 'high',   label: 'Profundo' },
        { value: 'xhigh',  label: 'Muy Profundo' },
    ],
    'gpt-5.6-sol': [
        { value: 'none',   label: 'Sin razonamiento' },
        { value: 'low',    label: 'Ligero' },
        { value: 'medium', label: 'Moderado' },
        { value: 'high',   label: 'Profundo' },
        { value: 'xhigh',  label: 'Muy Profundo' },
    ],
    'gpt-5.6-terra': [
        { value: 'none',   label: 'Sin razonamiento' },
        { value: 'low',    label: 'Ligero' },
        { value: 'medium', label: 'Moderado' },
        { value: 'high',   label: 'Profundo' },
        { value: 'xhigh',  label: 'Muy Profundo' },
    ],
    'gpt-5.6-luna': [
        { value: 'none',   label: 'Sin razonamiento' },
        { value: 'low',    label: 'Ligero' },
        { value: 'medium', label: 'Moderado' },
        { value: 'high',   label: 'Profundo' },
        { value: 'xhigh',  label: 'Muy Profundo' },
    ],
};

const IMAGE_ENHANCER_PROMPT = `Act as an expert prompt engineer and digital artist. 
The user will provide a short idea for an image. Your job is to rewrite it into a highly detailed, descriptive, and perfect English prompt for an image generation model.
Include specific details about: Subject, medium, lighting, color palette, camera angle, and atmosphere.
CRITICAL: Respect the original style requested by the user. Do not force a specific style (like photorealistic or cinematic) unless explicitly requested. Ensure the stylistic enhancements remain neutral but high quality.
DO NOT output any conversational text. ONLY output the final English prompt.`;

// Archivos adjuntos pendientes de enviar
// Cada elemento: { name, fileType, content, mediaType?, dataUrl? }
//   fileType: 'image' | 'pdf' | 'text'
//   content: string (texto extraído o base64 sin prefijo)
//   mediaType: 'image/png' etc. (solo para imágenes)
//   dataUrl: DataURL completo para previsualización en UI
let pendingAttachments = [];

// Sesión de tokens acumulados
let sessionTokens = { input: 0, output: 0 };
try {
    const saved = JSON.parse(localStorage.getItem('nc_session_tokens'));
    if (saved) sessionTokens = saved;
} catch (e) {}

function persistTokens() {
    localStorage.setItem('nc_session_tokens', JSON.stringify(sessionTokens));
}

// Historial de chats (array de sesiones)
// { id, title, provider, model, messages[], createdAt, updatedAt }
let chats          = [];
let activeChatId   = null;
let activeMessages = []; // mensajes del chat activo

/* =========================================================
   DOM REFS
   ========================================================= */

const $ = (id) => document.getElementById(id);

const chatEl        = $('chat');
const chatInnerEl   = $('chatInner');
const promptInput   = $('prompt');
const sendBtn       = $('send');
const sendIconEl    = $('sendIcon');
const statusDotEl   = $('statusDot');
const statusTextEl  = $('statusText');
const tokenCountEl  = $('tokenCount');
const contextCountEl= $('contextCount');
const sidebar       = $('sidebar');

/* =========================================================
   INICIO / ARRANQUE
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
    // Inicializar iconos Lucide
    if (window.lucide) lucide.createIcons();

    // Configurar marked
    if (window.marked) {
        marked.setOptions({ breaks: true, gfm: true });
    }

    // Cargar historial de chats
    loadChats();

    // Poblar selector de proveedor / modelo
    syncProviderSelect();
    populateModelSelect(cfg.provider);

    // Cargar tokens
    updateSessionUsageUI();

    // Abrir el último chat activo o crear uno nuevo
    if (chats.length > 0) {
        openChat(chats[0].id);
    } else {
        createNewChat();
    }

    // Verificar conexión local si aplica
    if (cfg.provider === 'local') testLocalConnection();

    // Autoexpansión del textarea
    promptInput.addEventListener('input', resizeTextarea);
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendButton();
        }
    });
});

/* =========================================================
   GESTIÓN DE CHATS (historial)
   ========================================================= */

function loadChats() {
    try {
        chats = JSON.parse(localStorage.getItem('nc_chats') || '[]');
    } catch {
        chats = [];
    }
    renderChatHistory();
}

function persistChats() {
    try {
        localStorage.setItem('nc_chats', JSON.stringify(chats));
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.message.includes('quota')) {
            let saved = false;
            while (chats.length > 1 && !saved) {
                chats.pop(); // Eliminar el chat más antiguo
                try {
                    localStorage.setItem('nc_chats', JSON.stringify(chats));
                    saved = true;
                    showNotice('Memoria llena. Se eliminaron chats muy antiguos automáticamente.', 'warning');
                } catch (err) {
                    // Si falla, en la siguiente iteración se borrará otro
                }
            }
            if (!saved) {
                showNotice('El chat es demasiado grande y no se pudo guardar. Limpia el contexto.', 'error');
            }
        } else {
            console.error('[CalenturaChat 😋] Error guardando historial:', e);
        }
    }
}

function createNewChat(type = 'chat') {
    const id = 'chat_' + Date.now();
    const chat = {
        id,
        type, // 'chat' | 'project'
        title: type === 'project' ? 'Nuevo proyecto' : 'Nuevo chat',
        provider: cfg.provider,
        model: getCurrentModelId(),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    if (type === 'project') chat.projectFiles = []; // { id, name, content }
    chats.unshift(chat);
    persistChats();
    openChat(id);
    renderChatHistory();

    // Resetear estado visual
    setSendState(false);
    setStatusNeutral();

    // Cerrar sidebar en móvil
    if (window.innerWidth <= 700 && sidebar) {
        sidebarOpen = false;
        sidebar.classList.add('collapsed');
    }
}

/**
 * Crea un chat de tipo "proyecto": un entorno donde se pueden subir uno
 * o varios archivos de código y la IA (especialmente el modelo local)
 * puede proponer ediciones (agregar/quitar líneas) que el usuario acepta
 * o rechaza antes de que se apliquen al archivo.
 */
function newProject() {
    createNewChat('project');
}

function getActiveChat() {
    return chats.find(c => c.id === activeChatId) || null;
}

function openChat(id) {
    activeChatId = id;
    const chat = chats.find(c => c.id === id);
    if (!chat) { createNewChat(); return; }

    activeMessages = chat.messages;
    renderChatHistory();
    renderProjectBar();
    renderChatMessages();
    updateContextCount();

    // Cerrar sidebar en móvil
    if (window.innerWidth <= 700 && sidebar) {
        sidebarOpen = false;
        sidebar.classList.add('collapsed');
    }
}

function updateActiveChat(newMessages, autoTitle = false) {
    const chat = chats.find(c => c.id === activeChatId);
    if (!chat) return;
    chat.messages  = newMessages;
    chat.updatedAt = Date.now();
    chat.provider  = cfg.provider;
    chat.model     = getCurrentModelId();

    if (autoTitle && newMessages.length > 0) {
        const firstUser = newMessages.find(m => m.role === 'user');
        if (firstUser) {
            // Título temporal mientras la IA genera uno mejor
            const rawContent = typeof firstUser.content === 'string'
                ? firstUser.content
                : (firstUser._display || 'Nuevo chat');
            chat.title = rawContent.replace(/\/think\n|\/no_think\n/g, '').slice(0, 42).trim() || 'Nuevo chat';
            // Generar título inteligente con IA en segundo plano
            generateSmartTitle(chat.id, rawContent);
        }
    }

    persistChats();
    renderChatHistory();
}

/**
 * Genera un título corto y descriptivo para el chat usando la IA.
 * Se ejecuta en segundo plano sin bloquear la conversación.
 */
async function generateSmartTitle(chatId, userMessage) {
    try {
        const cleanMsg = (typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage))
            .replace(/\/think\n|\/no_think\n/g, '')
            .slice(0, 300);

        let generatedTitle = null;

        if (cfg.provider === 'openai' && cfg.openaiKey) {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${cfg.openaiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4.1-mini',
                    messages: [
                        { role: 'system', content: 'Genera un título MUY corto (máximo 5 palabras) que resuma el tema del mensaje del usuario. Solo responde con el título, sin comillas, sin puntuación final, sin explicación. Responde en el mismo idioma del mensaje.' },
                        { role: 'user', content: cleanMsg }
                    ],
                    max_tokens: 30,
                    temperature: 0.7
                })
            });
            if (res.ok) {
                const data = await res.json();
                generatedTitle = data.choices?.[0]?.message?.content?.trim();
            }
        } else if (cfg.provider === 'anthropic' && cfg.anthropicKey) {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': cfg.anthropicKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-haiku-4-5',
                    max_tokens: 30,
                    messages: [
                        { role: 'user', content: 'Genera un título MUY corto (máximo 5 palabras) que resuma el tema de este mensaje. Solo responde con el título, sin comillas, sin puntuación final, sin explicación. Responde en el mismo idioma del mensaje.\n\nMensaje: ' + cleanMsg }
                    ]
                })
            });
            if (res.ok) {
                const data = await res.json();
                generatedTitle = data.content?.[0]?.text?.trim();
            }
        } else if (cfg.provider === 'local' && cfg.localApiUrl) {
            const headers = { 'Content-Type': 'application/json' };
            if (cfg.localKey) headers['Authorization'] = `Bearer ${cfg.localKey}`;
            const res = await fetch(`${cfg.localApiUrl}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: cfg.localModel,
                    messages: [
                        { role: 'system', content: 'Genera un título MUY corto (máximo 5 palabras) que resuma el tema del mensaje del usuario. Solo responde con el título, sin comillas, sin puntuación final, sin explicación. Responde en el mismo idioma del mensaje.' },
                        { role: 'user', content: cleanMsg }
                    ],
                    max_tokens: 30,
                    temperature: 0.7
                })
            });
            if (res.ok) {
                const data = await res.json();
                generatedTitle = data.choices?.[0]?.message?.content?.trim();
            }
        }

        if (generatedTitle && generatedTitle.length > 0 && generatedTitle.length <= 60) {
            // Limpiar comillas y puntuación final que la IA a veces agrega
            generatedTitle = generatedTitle.replace(/^["'""«»]+|["'""«».]+$/g, '').trim();
            const chat = chats.find(c => c.id === chatId);
            if (chat) {
                chat.title = generatedTitle;
                persistChats();
                renderChatHistory();
            }
        }
    } catch (e) {
        console.debug('[CalenturaChat 😋] No se pudo generar título inteligente:', e.message);
    }
}

let pendingDeleteChatId = null;

function deleteChat(id, event) {
    event.stopPropagation();
    pendingDeleteChatId = id;

    // Show chat title in the modal
    const chat = chats.find(c => c.id === id);
    const titleEl = $('confirmDeleteTitle');
    if (titleEl && chat) {
        titleEl.textContent = `"${chat.title}" — Esta acción no se puede deshacer.`;
    }

    const bg = $('confirmDeleteBg');
    if (bg) {
        bg.classList.add('visible');
        if (window.lucide) lucide.createIcons({ nodes: [bg] });
    }
}

function confirmDeleteChat() {
    if (!pendingDeleteChatId) return;
    const id = pendingDeleteChatId;
    pendingDeleteChatId = null;

    chats = chats.filter(c => c.id !== id);
    persistChats();

    // Resetear estado visual (quitar botón rojo si había error)
    setSendState(false);
    setStatusNeutral();

    if (activeChatId === id) {
        if (chats.length > 0) openChat(chats[0].id);
        else createNewChat();
    } else {
        renderChatHistory();
    }

    cancelDeleteChat();
}

function cancelDeleteChat() {
    pendingDeleteChatId = null;
    const bg = $('confirmDeleteBg');
    if (bg) bg.classList.remove('visible');
}


function renderChatHistory() {
    const container = $('chatHistory');
    if (!container) return;

    if (chats.length === 0) {
        container.innerHTML = `<p style="padding:16px 10px;color:var(--muted);font-size:12px;text-align:center">Sin chats guardados</p>`;
        return;
    }

    // Agrupar por fecha
    const groups = {};
    const now   = Date.now();
    const today = new Date().setHours(0,0,0,0);
    const yday  = today - 86400000;
    const week  = today - 7*86400000;

    chats.forEach(chat => {
        let group;
        if (chat.updatedAt >= today)    group = 'Hoy';
        else if (chat.updatedAt >= yday) group = 'Ayer';
        else if (chat.updatedAt >= week) group = 'Esta semana';
        else                             group = 'Antes';

        if (!groups[group]) groups[group] = [];
        groups[group].push(chat);
    });

    const order = ['Hoy','Ayer','Esta semana','Antes'];
    let html = '';

    for (const g of order) {
        if (!groups[g]) continue;
        html += `<div class="history-group-label">${g}</div>`;
        for (const chat of groups[g]) {
            const active = chat.id === activeChatId ? 'active' : '';
            const isProject = chat.type === 'project';
            const typeClass = isProject ? 'type-project' : '';
            const typeIcon = isProject
                ? `<span class="history-type-icon" title="Proyecto"><i data-lucide="folder-kanban"></i></span>`
                : '';
            html += `
                <div class="history-item ${active} ${typeClass}" onclick="openChat('${chat.id}')" title="${escHtml(chat.title)}">
                    <span class="history-provider-dot ${chat.provider || 'local'}"></span>
                    ${typeIcon}
                    <span class="history-title">${escHtml(chat.title)}</span>
                    <button class="history-delete" onclick="deleteChat('${chat.id}', event)" title="Eliminar">
                        <i data-lucide="x"></i>
                    </button>
                </div>`;
        }
    }

    container.innerHTML = html;
    if (window.lucide) lucide.createIcons({ nodes: [container] });
}

/* =========================================================
   RENDER DEL CHAT
   ========================================================= */

function renderChatMessages() {
    chatInnerEl.innerHTML = '';

    if (activeMessages.length === 0) {
        chatInnerEl.innerHTML = `
            <div id="welcome" class="welcome">
                <div class="welcome-icon"><i data-lucide="sparkles"></i></div>
                <h1>CalenturaChat 😋</h1>
                <p>Selecciona un proveedor y modelo arriba, luego empieza a conversar.<br>OpenAI, Anthropic Claude y modelos locales — todo en un lugar.</p>
                <div class="welcome-providers">
                    <div class="provider-chip" onclick="setProvider('openai')"><i data-lucide="cpu"></i> OpenAI</div>
                    <div class="provider-chip" onclick="setProvider('anthropic')"><i data-lucide="atom"></i> Anthropic</div>
                    <div class="provider-chip" onclick="setProvider('local')"><i data-lucide="server"></i> Local</div>
                </div>
            </div>`;
        if (window.lucide) lucide.createIcons({ nodes: [chatInnerEl] });
        return;
    }

    activeMessages.forEach(msg => {
        if (msg.role === 'system') return;
        const refs = addMessageDOM(msg.role);
        if (msg.role === 'user') {
            // Usar _display si existe (evita mostrar el contenido enorme de archivos)
            const rawDisplay = msg._display ?? (typeof msg.content === 'string' ? msg.content : '');
            const cleanDisplay = rawDisplay.replace(/^\/think\n|^\/no_think\n/, '');

            // Separar texto limpio de los badges [doc:...] e [img:...]
            const parts = cleanDisplay.split(/\s*\[(?:doc|img):[^\]]+\]/);
            refs.textEl.textContent = parts[0].trim();

            // Re-crear badges de archivos adjuntos
            const badges = [...cleanDisplay.matchAll(/\[(doc|img):([^\]]+)\]/g)];
            if (badges.length) {
                const docInfo = document.createElement('div');
                docInfo.style.cssText = 'margin-top:6px;font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px;';
                badges.forEach(([, type, name]) => {
                    const badge = document.createElement('span');
                    badge.style.cssText = 'background:var(--panel3);border:1px solid var(--border);border-radius:6px;padding:2px 8px;';
                    badge.textContent = (type === 'img' ? '🖼️ ' : '📎 ') + name;
                    docInfo.appendChild(badge);
                });
                refs.textEl.appendChild(docInfo);
            }
        } else {
            updateAssistantView(refs, msg.content);
            if (msg.edits && msg.edits.length) {
                renderEditCards(refs, msg);
            }
        }
    });

    scrollBottom();
}

/* =========================================================
   PROYECTOS — subir archivos, contador de líneas y
   edición tipo "agente" (agregar/quitar líneas con
   aprobación manual del usuario)
   ========================================================= */

function countLines(str) {
    if (!str) return 0;
    // Normaliza saltos de línea y cuenta líneas (una cadena vacía = 0 líneas)
    const norm = String(str).replace(/\r\n/g, '\n');
    return norm.length ? norm.split('\n').length : 0;
}

function totalProjectLines(chat) {
    if (!chat || !chat.projectFiles) return 0;
    return chat.projectFiles.reduce((sum, f) => sum + countLines(f.content), 0);
}

function renderProjectBar() {
    const bar = $('projectBar');
    if (!bar) return;
    const chat = getActiveChat();

    if (!chat || chat.type !== 'project') {
        bar.style.display = 'none';
        return;
    }

    bar.style.display = 'flex';

    const linesEl = $('projectLinesCount');
    if (linesEl) linesEl.textContent = totalProjectLines(chat).toLocaleString();

    const chipsWrap = $('projectFilesChips');
    if (!chipsWrap) return;

    const files = chat.projectFiles || [];
    if (!files.length) {
        chipsWrap.innerHTML = `<span class="project-files-empty">Sin archivos aún — agrega uno para empezar</span>`;
        return;
    }

    chipsWrap.innerHTML = files.map(f => `
        <span class="project-file-chip" onclick="openProjectFilePreview('${f.id}')" title="Ver ${escHtml(f.name)}">
            <span class="chip-file-name">${escHtml(f.name)}</span>
            <span class="chip-file-lines">${countLines(f.content)}L</span>
            <button class="chip-remove" onclick="removeProjectFile('${f.id}', event)" title="Quitar del proyecto">
                <i data-lucide="x"></i>
            </button>
        </span>
    `).join('');

    if (window.lucide) lucide.createIcons({ nodes: [chipsWrap] });
}

function triggerProjectFileInput() {
    const chat = getActiveChat();
    if (!chat || chat.type !== 'project') return;
    $('projectFileInput')?.click();
}

async function onProjectFilesSelected(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    const chat = getActiveChat();
    if (!chat || chat.type !== 'project') return;
    if (!chat.projectFiles) chat.projectFiles = [];

    for (const file of files) {
        try {
            const text = await file.text();
            const existing = chat.projectFiles.find(f => f.name === file.name);
            if (existing) {
                existing.content = text;
            } else {
                chat.projectFiles.push({
                    id: 'pf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                    name: file.name,
                    content: text
                });
            }
        } catch (e) {
            showNotice(`No se pudo leer "${file.name}" (¿es un archivo binario?).`, 'error');
        }
    }

    chat.updatedAt = Date.now();
    persistChats();
    renderProjectBar();
    showNotice(`${files.length} archivo(s) agregado(s) al proyecto.`, 'success');
}

function removeProjectFile(fileId, event) {
    event?.stopPropagation();
    const chat = getActiveChat();
    if (!chat || !chat.projectFiles) return;
    chat.projectFiles = chat.projectFiles.filter(f => f.id !== fileId);
    chat.updatedAt = Date.now();
    persistChats();
    renderProjectBar();
}

let previewingFileId = null;

function openProjectFilePreview(fileId) {
    const chat = getActiveChat();
    const file = chat?.projectFiles?.find(f => f.id === fileId);
    if (!file) return;

    previewingFileId = fileId;
    $('filePreviewName').textContent = file.name;
    $('filePreviewMeta').textContent = `${countLines(file.content)} líneas · ${(file.content.length / 1024).toFixed(1)} KB`;
    $('filePreviewCode').textContent = file.content;
    $('filePreviewModalBg').classList.add('show');
    if (window.lucide) lucide.createIcons({ nodes: [$('filePreviewModalBg')] });
}

function closeFilePreview() {
    previewingFileId = null;
    $('filePreviewModalBg')?.classList.remove('show');
}

function handleFilePreviewBgClick(e) {
    if (e.target === $('filePreviewModalBg')) closeFilePreview();
}

function deleteProjectFileFromPreview() {
    if (!previewingFileId) return;
    removeProjectFile(previewingFileId);
    closeFilePreview();
}

/**
 * Construye el bloque de contexto que se agrega al system prompt cuando
 * el chat activo es de tipo "proyecto": incluye el contenido íntegro de
 * cada archivo y las instrucciones de formato para que la IA proponga
 * ediciones (línea por línea) en vez de solo dar consejos en texto.
 */
function buildProjectSystemAddendum(chat) {
    const files = chat.projectFiles || [];
    if (!files.length) {
        return `\n\nEstás en un chat de tipo "Proyecto" pero todavía no hay archivos subidos. Pide al usuario que suba uno o más archivos con el botón "Agregar archivo" antes de proponer cambios.`;
    }

    const filesBlock = files.map(f =>
        `### Archivo: ${f.name} (${countLines(f.content)} líneas)\n\`\`\`\n${f.content}\n\`\`\``
    ).join('\n\n');

    return `\n\nESTÁS EN UN CHAT DE TIPO "PROYECTO". El usuario subió los siguientes archivos de código, y espera que actúes como un agente de edición de código:

${filesBlock}

INSTRUCCIONES PARA PROPONER CAMBIOS (obligatorio seguir este formato):
- Si el usuario te pide modificar, corregir, agregar o quitar líneas de un archivo, responde primero con una breve explicación en texto normal de qué vas a cambiar y por qué.
- Luego, por cada archivo que modifiques o crees, incluye un bloque de código con el CONTENIDO COMPLETO Y FINAL del archivo (no solo las líneas cambiadas), usando exactamente este formato de encabezado en el bloque de código:
\`\`\`file:nombre-del-archivo.ext
(contenido completo del archivo aquí, con tus cambios ya aplicados)
\`\`\`
- Usa el nombre exacto del archivo tal como aparece arriba si estás editando uno existente. Si es un archivo nuevo, usa un nombre de archivo apropiado.
- NUNCA apliques el cambio tú mismo ni digas que ya está aplicado: el usuario debe revisar el diff y presionar "Aceptar" o "Rechazar" en la interfaz. Tu única función es proponer el nuevo contenido del archivo.
- Puedes proponer cambios en varios archivos en la misma respuesta, cada uno en su propio bloque \`\`\`file:...\`\`\`.
- Si el usuario solo hace una pregunta sin pedir cambios, responde normalmente sin generar bloques \`\`\`file:...\`\`\`.`;
}

/**
 * Extrae del texto de la respuesta de la IA todos los bloques
 * ```file:nombre.ext ... ``` que representan una propuesta de edición.
 */
function parseFileEdits(text) {
    if (!text) return [];
    const regex = /```file:([^\n`]+)\n([\s\S]*?)```/g;
    const results = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        const fileName = match[1].trim();
        let content = match[2];
        // Quitar un único salto de línea final sobrante (el que precede a ```)
        content = content.replace(/\n$/, '');
        if (fileName) results.push({ file: fileName, content });
    }
    return results;
}

/**
 * Diff simple línea por línea basado en LCS (subsecuencia común más larga).
 * Devuelve un array de { type: 'eq'|'add'|'del', text }.
 * Para archivos muy grandes (para evitar O(n*m) costoso) recurre a un
 * diff "grueso": todo el contenido viejo como eliminado y el nuevo como agregado.
 */
function computeLineDiff(oldStr, newStr) {
    const a = oldStr ? oldStr.replace(/\r\n/g, '\n').split('\n') : [];
    const b = newStr ? newStr.replace(/\r\n/g, '\n').split('\n') : [];

    const MAX_CELLS = 400 * 400; // límite razonable para no bloquear el navegador
    if (a.length * b.length > MAX_CELLS) {
        const out = [];
        a.forEach(l => out.push({ type: 'del', text: l }));
        b.forEach(l => out.push({ type: 'add', text: l }));
        return out;
    }

    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            out.push({ type: 'eq', text: a[i] });
            i++; j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            out.push({ type: 'del', text: a[i] });
            i++;
        } else {
            out.push({ type: 'add', text: b[j] });
            j++;
        }
    }
    while (i < n) { out.push({ type: 'del', text: a[i] }); i++; }
    while (j < m) { out.push({ type: 'add', text: b[j] }); j++; }
    return out;
}

function diffStats(diffArr) {
    let added = 0, removed = 0;
    diffArr.forEach(d => {
        if (d.type === 'add') added++;
        else if (d.type === 'del') removed++;
    });
    return { added, removed };
}

function buildDiffHTML(diffArr) {
    return diffArr.map(d => {
        const mark = d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' ';
        return `<div class="diff-line ${d.type}"><span class="diff-line-mark">${mark}</span><span class="diff-line-text">${escHtml(d.text)}</span></div>`;
    }).join('');
}

/**
 * Renderiza, debajo de la burbuja del mensaje del asistente, una tarjeta
 * por cada archivo que la IA propuso modificar, con el diff y los
 * botones para Aceptar / Rechazar el cambio.
 */
function renderEditCards(refs, msgObj) {
    // Evitar duplicar tarjetas si ya se renderizaron antes
    refs.message.querySelector('.edit-cards')?.remove();

    const chat = getActiveChat();
    if (!chat) return;

    const wrap = document.createElement('div');
    wrap.className = 'edit-cards';

    const pendingCount = msgObj.edits.filter(e => e.status === 'pending').length;
    if (msgObj.edits.length > 1 && pendingCount > 1) {
        const bulk = document.createElement('div');
        bulk.className = 'edit-cards-bulk';
        bulk.innerHTML = `
            <button class="edit-card-btn accept" data-bulk="accept"><i data-lucide="check-check"></i> Aceptar todos (${pendingCount})</button>
            <button class="edit-card-btn reject" data-bulk="reject"><i data-lucide="x"></i> Rechazar todos</button>`;
        bulk.querySelector('[data-bulk="accept"]').addEventListener('click', () => {
            msgObj.edits.filter(e => e.status === 'pending').forEach(e => applyEditDecision(chat, msgObj, e, 'accepted'));
            renderEditCards(refs, msgObj);
        });
        bulk.querySelector('[data-bulk="reject"]').addEventListener('click', () => {
            msgObj.edits.filter(e => e.status === 'pending').forEach(e => applyEditDecision(chat, msgObj, e, 'rejected'));
            renderEditCards(refs, msgObj);
        });
        wrap.appendChild(bulk);
    }

    msgObj.edits.forEach(edit => {
        const existingFile = chat.projectFiles?.find(f => f.name === edit.file);
        const oldContent = existingFile ? existingFile.content : '';
        const isNewFile = !existingFile;
        const diffArr = computeLineDiff(oldContent, edit.newContent);
        const stats = diffStats(diffArr);

        const card = document.createElement('div');
        card.className = 'edit-card';

        const header = document.createElement('div');
        header.className = 'edit-card-header';
        header.innerHTML = `
            <i data-lucide="file-diff" class="edit-card-icon"></i>
            <span class="edit-card-filename">${escHtml(edit.file)}</span>
            ${isNewFile ? '<span class="edit-card-badge new">nuevo archivo</span>' : ''}
            <span class="edit-card-stats"><span class="added">+${stats.added}</span><span class="removed">−${stats.removed}</span></span>
            <span class="edit-card-spacer"></span>
            <button class="edit-card-toggle"><i data-lucide="chevrons-up-down"></i> Ver diff</button>`;
        card.appendChild(header);

        const diffEl = document.createElement('div');
        diffEl.className = 'edit-card-diff';
        diffEl.innerHTML = buildDiffHTML(diffArr);
        card.appendChild(diffEl);

        header.querySelector('.edit-card-toggle').addEventListener('click', () => {
            diffEl.classList.toggle('open');
        });

        if (edit.status === 'pending') {
            const actions = document.createElement('div');
            actions.className = 'edit-card-actions';
            actions.innerHTML = `
                <button class="edit-card-btn accept"><i data-lucide="check"></i> Aceptar</button>
                <button class="edit-card-btn reject"><i data-lucide="x"></i> Rechazar</button>`;
            actions.querySelector('.accept').addEventListener('click', () => {
                applyEditDecision(chat, msgObj, edit, 'accepted');
                renderEditCards(refs, msgObj);
            });
            actions.querySelector('.reject').addEventListener('click', () => {
                applyEditDecision(chat, msgObj, edit, 'rejected');
                renderEditCards(refs, msgObj);
            });
            card.appendChild(actions);
        } else {
            const status = document.createElement('div');
            status.className = `edit-card-status ${edit.status}`;
            status.innerHTML = edit.status === 'accepted'
                ? `<i data-lucide="check-circle-2"></i> Cambios aplicados al proyecto`
                : `<i data-lucide="x-circle"></i> Cambios rechazados`;
            card.appendChild(status);
        }

        wrap.appendChild(card);
    });

    refs.message.appendChild(wrap);
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
}

/**
 * Aplica la decisión del usuario (aceptar/rechazar) sobre una edición
 * propuesta: si se acepta, actualiza (o crea) el archivo en el proyecto.
 */
function applyEditDecision(chat, msgObj, edit, decision) {
    edit.status = decision;

    if (decision === 'accepted') {
        if (!chat.projectFiles) chat.projectFiles = [];
        const existing = chat.projectFiles.find(f => f.name === edit.file);
        if (existing) {
            existing.content = edit.newContent;
        } else {
            chat.projectFiles.push({
                id: 'pf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                name: edit.file,
                content: edit.newContent
            });
        }
        chat.updatedAt = Date.now();
    }

    persistChats();
    renderProjectBar();
}

/* =========================================================
   SELECCIÓN DE PROVEEDOR / MODELO
   ========================================================= */

function syncProviderSelect() {
    const sel = $('providerSelect');
    if (sel) sel.value = cfg.provider;
}

function populateModelSelect(provider) {
    const sel = $('modelSelect');
    if (!sel) return;

    sel.innerHTML = '';

    const models = PROVIDERS[provider]?.models || [];
    models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        sel.appendChild(opt);
    });

    // Valor por defecto
    const current = getCurrentModelId();
    if (models.find(m => m.id === current)) {
        sel.value = current;
    } else if (models.length) {
        sel.value = models[0].id;
        setModelConfig(provider, models[0].id);
    }
    updateModelPriceUI(provider, sel.value);
    updateReasoningUI(sel.value);
}

function updateModelPriceUI(provider, modelId) {
    const badge = $('modelPriceBadge');
    
    let isImageModel = false;
    const model = PROVIDERS[provider]?.models.find(m => m.id === modelId);
    if (model && model.price && model.price.perImage) {
        isImageModel = true;
    }
    
    const magicBtn = $('magicPromptBtn');
    if (magicBtn) {
        magicBtn.style.display = isImageModel ? '' : 'none';
        if (!isImageModel && typeof magicPrompt !== 'undefined' && magicPrompt) {
            if (typeof toggleMagicPrompt === 'function') toggleMagicPrompt();
        }
    }
    
    if (!badge) return;
    
    if (provider === 'local') {
        badge.innerHTML = `<i data-lucide="coins"></i> Gratis`;
        badge.title = "Los modelos locales no tienen costo por token.";
    } else {
        if (model && model.price) {
            if (model.price.perImage) {
                badge.innerHTML = `<i data-lucide="image"></i> $${model.price.perImage.toFixed(3)}`;
                badge.title = `Precio por imagen generada: $${model.price.perImage}`;
            } else {
                badge.innerHTML = `<i data-lucide="coins"></i> $${model.price.in} / $${model.price.out}`;
                badge.title = `Precio por 1M de tokens: Entrada $${model.price.in} / Salida $${model.price.out}`;
            }
        } else {
            badge.innerHTML = `<i data-lucide="coins"></i> ?`;
        }
    }
    if (window.lucide) lucide.createIcons({ nodes: [badge] });
}

function getCurrentModelId() {
    switch (cfg.provider) {
        case 'openai':    return cfg.openaiModel;
        case 'anthropic': return cfg.anthropicModel;
        case 'local':     return cfg.localModel;
    }
    return '';
}

function setModelConfig(provider, modelId) {
    if (provider === 'openai')    cfg.openaiModel    = modelId;
    if (provider === 'anthropic') cfg.anthropicModel = modelId;
    if (provider === 'local')     cfg.localModel     = modelId;
    saveConfig();
}

function onProviderChange() {
    const sel = $('providerSelect');
    cfg.provider = sel.value;
    saveConfig();
    populateModelSelect(cfg.provider);
    if (cfg.provider === 'local') testLocalConnection();
    else setStatusNeutral();
}

function onModelChange() {
    const sel = $('modelSelect');
    setModelConfig(cfg.provider, sel.value);
    updateModelPriceUI(cfg.provider, sel.value);
    updateReasoningUI(sel.value);
}

/**
 * Muestra/oculta el selector de nivel de razonamiento según el modelo seleccionado.
 */
function updateReasoningUI(modelId) {
    const wrap = $('reasoningLevelWrap');
    const thinkingBtn = $('thinkingBtn');
    const levels = REASONING_LEVELS[modelId];

    if (levels) {
        // Modelo con reasoning levels — mostrar dropdown, ocultar toggle viejo
        if (thinkingBtn) thinkingBtn.style.display = 'none';
        if (wrap) {
            wrap.style.display = 'flex';
            const sel = $('reasoningLevelSelect');
            sel.innerHTML = '';
            levels.forEach(l => {
                const opt = document.createElement('option');
                opt.value = l.value;
                opt.textContent = l.label;
                sel.appendChild(opt);
            });
            // Restaurar valor guardado o usar medium por defecto
            const saved = localStorage.getItem('nc_reasoning_level') || 'medium';
            if (levels.find(l => l.value === saved)) {
                sel.value = saved;
                reasoningLevel = saved;
            } else {
                sel.value = levels[0].value;
                reasoningLevel = levels[0].value;
            }
            // Estilo activo si no es 'none'
            wrap.classList.toggle('active', reasoningLevel !== 'none');
            if (window.lucide) lucide.createIcons({ nodes: [wrap] });
        }
    } else {
        // Modelo sin reasoning levels — ocultar dropdown, mostrar toggle viejo para local
        if (wrap) wrap.style.display = 'none';
        if (thinkingBtn) {
            thinkingBtn.style.display = (cfg.provider === 'local') ? '' : 'none';
        }
    }
}

function onReasoningLevelChange() {
    const sel = $('reasoningLevelSelect');
    reasoningLevel = sel.value;
    localStorage.setItem('nc_reasoning_level', reasoningLevel);
    const wrap = $('reasoningLevelWrap');
    if (wrap) wrap.classList.toggle('active', reasoningLevel !== 'none');
}

function setProvider(provider) {
    cfg.provider = provider;
    saveConfig();
    syncProviderSelect();
    populateModelSelect(provider);
    if (provider === 'local') testLocalConnection();
    else setStatusNeutral();
}

/* =========================================================
   SIDEBAR
   ========================================================= */

let sidebarOpen = true;

function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    sidebar.classList.toggle('collapsed', !sidebarOpen);
}

$('sidebarCloseBtn')?.addEventListener('click', () => {
    sidebarOpen = false;
    sidebar.classList.add('collapsed');
});

/* =========================================================
   CONFIGURACIÓN — MODAL
   ========================================================= */

function openSettings() {
    $('openaiKey').value         = cfg.openaiKey;
    $('anthropicKey').value      = cfg.anthropicKey;
    if ($('localKey')) $('localKey').value = cfg.localKey;
    $('localApiUrl').value       = cfg.localApiUrl;
    $('localModel').value        = cfg.localModel;
    $('systemPrompt').value      = cfg.systemPrompt;
    $('maxContext').value        = cfg.maxContext;
    $('maxTokens').value         = cfg.maxTokens;
    $('openaiDefaultModel').value    = cfg.openaiModel;
    $('anthropicDefaultModel').value = cfg.anthropicModel;

    switchTab(cfg.provider === 'local' ? 'local' : cfg.provider);
    $('modalBg').classList.add('show');
}

function closeSettings() {
    $('modalBg').classList.remove('show');
}

function handleModalBgClick(e) {
    if (e.target === $('modalBg')) closeSettings();
}

function saveSettings() {
    cfg.openaiKey      = $('openaiKey').value.trim();
    cfg.anthropicKey   = $('anthropicKey').value.trim();
    if ($('localKey')) cfg.localKey = $('localKey').value.trim();
    cfg.localApiUrl    = $('localApiUrl').value.trim().replace(/\/$/, '');
    cfg.localModel     = $('localModel').value.trim();
    if (cfg.localModel) {
        PROVIDERS.local.models = [{ id: cfg.localModel, label: cfg.localModel }];
    }
    cfg.systemPrompt   = $('systemPrompt').value.trim();
    cfg.maxContext     = Math.max(2, Number($('maxContext').value) || 20);
    cfg.maxTokens      = Math.max(128, Number($('maxTokens').value) || 2048);
    cfg.openaiModel    = $('openaiDefaultModel').value;
    cfg.anthropicModel = $('anthropicDefaultModel').value;

    saveConfig();
    populateModelSelect(cfg.provider);
    closeSettings();

    if (cfg.provider === 'local') testLocalConnection();
    else setStatusNeutral();
}

function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${name}`));
}

function toggleVisibility(inputId) {
    const inp = $(inputId);
    inp.type = inp.type === 'password' ? 'text' : 'password';
}

/* =========================================================
   AUTO-DETECTAR MODELO LOCAL
   ========================================================= */

async function detectLocalModel() {
    const btn     = $('detectModelBtn');
    const urlField = $('localApiUrl');
    const url     = (urlField.value.trim() || cfg.localApiUrl).replace(/\/$/, '');
    const keyField = $('localKey');
    const key     = keyField ? keyField.value.trim() : cfg.localKey;

    btn.disabled = true;
    const icon = btn.querySelector('i');
    if (icon) { icon.setAttribute('data-lucide','loader-2'); lucide.createIcons({nodes:[btn]}); }

    try {
        const headers = {};
        if (key) headers['Authorization'] = `Bearer ${key}`;
        const res = await fetch(`${url}/models`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const firstId = data?.data?.[0]?.id;

        if (firstId) {
            $('localModel').value = firstId;
            PROVIDERS.local.models = [{ id: firstId, label: firstId }];
            if (icon) { icon.setAttribute('data-lucide','check'); lucide.createIcons({nodes:[btn]}); }
        } else {
            if (icon) { icon.setAttribute('data-lucide','x'); lucide.createIcons({nodes:[btn]}); }
        }
    } catch {
        if (icon) { icon.setAttribute('data-lucide','x'); lucide.createIcons({nodes:[btn]}); }
    }

    setTimeout(() => {
        btn.disabled = false;
        if (icon) { icon.setAttribute('data-lucide','search'); lucide.createIcons({nodes:[btn]}); }
    }, 2000);
}

/* =========================================================
   CRÉDITOS
   ========================================================= */

function openCredits() {
    updateSessionUsageUI();
    $('creditsModalBg').classList.add('show');
}

function closeCredits() {
    $('creditsModalBg').classList.remove('show');
}

function handleCreditsBgClick(e) {
    if (e.target === $('creditsModalBg')) closeCredits();
}

function updateSessionUsageUI() {
    $('sessionInputTokens').textContent  = sessionTokens.input.toLocaleString();
    $('sessionOutputTokens').textContent = sessionTokens.output.toLocaleString();
    $('sessionTotalTokens').textContent  = (sessionTokens.input + sessionTokens.output).toLocaleString();
    tokenCountEl.textContent = (sessionTokens.input + sessionTokens.output).toLocaleString();
}

async function fetchOpenAICredits() {
    const body = $('openaiCreditsBody');
    body.innerHTML = '<span class="muted">Verificando API Key...</span>';

    if (!cfg.openaiKey) {
        body.innerHTML = `
            <div class="credits-no-key">
                <i data-lucide="key-round"></i>
                <p>Ingresa tu API Key de OpenAI en <strong>Configuración</strong>.</p>
            </div>`;
        if (window.lucide) lucide.createIcons({ nodes: [body] });
        return;
    }

    try {
        // Verificar que la key sea válida
        const res = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${cfg.openaiKey}` }
        });

        if (res.status === 401) throw new Error('API Key inválida o revocada.');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // La API de billing de OpenAI (credit_grants) no acepta
        // peticiones desde el navegador (CORS bloqueado por OpenAI).
        // El balance solo puede consultarse desde la web oficial.
        const masked = cfg.openaiKey.slice(0, 7) + '...' + cfg.openaiKey.slice(-4);
        const totalSession = (sessionTokens.input + sessionTokens.output).toLocaleString();

        body.innerHTML = `
            <div class="credits-status ok">
                <i data-lucide="check-circle-2"></i>
                <strong>API Key válida</strong>
                <span class="key-mask">${escHtml(masked)}</span>
            </div>
            <div class="credits-why">
                <i data-lucide="info"></i>
                OpenAI bloquea la consulta de balance desde el navegador (CORS).
                Tu saldo real solo es visible en el dashboard oficial.
            </div>
            <div class="credits-session">
                <span>Tokens usados en esta sesión:</span>
                <strong>${totalSession}</strong>
            </div>
            <a class="credits-link" href="https://platform.openai.com/usage" target="_blank" rel="noopener">
                <i data-lucide="external-link"></i>
                Ver uso y saldo en platform.openai.com
            </a>`;
        if (window.lucide) lucide.createIcons({ nodes: [body] });

    } catch (err) {
        body.innerHTML = `
            <div class="credits-status error">
                <i data-lucide="x-circle"></i>
                <strong>${escHtml(err.message)}</strong>
            </div>
            <a class="credits-link" href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">
                <i data-lucide="external-link"></i>
                Administrar API Keys en OpenAI
            </a>`;
        if (window.lucide) lucide.createIcons({ nodes: [body] });
    }
}

async function fetchAnthropicCredits() {
    const body = $('anthropicCreditsBody');
    body.innerHTML = '<span class="muted">Verificando API Key...</span>';

    if (!cfg.anthropicKey) {
        body.innerHTML = `
            <div class="credits-no-key">
                <i data-lucide="key-round"></i>
                <p>Ingresa tu API Key de Anthropic en <strong>Configuración</strong>.</p>
            </div>`;
        if (window.lucide) lucide.createIcons({ nodes: [body] });
        return;
    }

    try {
        // Verificar la key con una petición ligera
        const testRes = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
                'x-api-key': cfg.anthropicKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            }
        });

        if (testRes.status === 401) throw new Error('API Key inválida o revocada.');
        // 404 es normal (endpoint no existe en versión pública), la key es válida
        if (!testRes.ok && testRes.status !== 404) throw new Error(`HTTP ${testRes.status}`);

        const masked = cfg.anthropicKey.slice(0, 10) + '...' + cfg.anthropicKey.slice(-4);
        const inTok  = sessionTokens.input.toLocaleString();
        const outTok = sessionTokens.output.toLocaleString();

        body.innerHTML = `
            <div class="credits-status ok">
                <i data-lucide="check-circle-2"></i>
                <strong>API Key válida</strong>
                <span class="key-mask">${escHtml(masked)}</span>
            </div>
            <div class="credits-why">
                <i data-lucide="info"></i>
                Anthropic no tiene un endpoint público de balance. Tu saldo se consulta solo desde la consola oficial.
            </div>
            <div class="credits-session">
                <span>Entrada (sesión):</span> <strong>${inTok}</strong>
            </div>
            <div class="credits-session">
                <span>Salida (sesión):</span> <strong>${outTok}</strong>
            </div>
            <a class="credits-link" href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener">
                <i data-lucide="external-link"></i>
                Ver saldo en console.anthropic.com
            </a>`;
        if (window.lucide) lucide.createIcons({ nodes: [body] });

    } catch (err) {
        body.innerHTML = `
            <div class="credits-status error">
                <i data-lucide="x-circle"></i>
                <strong>${escHtml(err.message)}</strong>
            </div>
            <a class="credits-link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">
                <i data-lucide="external-link"></i>
                Administrar API Keys en Anthropic
            </a>`;
        if (window.lucide) lucide.createIcons({ nodes: [body] });
    }
}

/* =========================================================
   ADJUNTAR ARCHIVOS
   ========================================================= */

/**
 * Abre el selector de archivos del sistema operativo.
 */
function triggerFileInput() {
    $('fileInput').value = ''; // Permite re-seleccionar el mismo archivo
    $('fileInput').click();
}

/**
 * Handler para el input file: procesa cada archivo seleccionado.
 */
async function onFilesSelected(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;

    const MAX_FILES = 5;
    const MAX_TEXT_CHARS = 60000; // ~15k tokens de seguridad

    for (const file of files) {
        if (pendingAttachments.length >= MAX_FILES) {
            showNotice(`Máximo ${MAX_FILES} archivos por mensaje.`, 'warning');
            break;
        }
        try {
            const attachment = await processFile(file, MAX_TEXT_CHARS);
            pendingAttachments.push(attachment);
        } catch (err) {
            showNotice(`No se pudo leer "${file.name}": ${err.message}`, 'warning');
        }
    }

    renderAttachmentPreview();
}

/**
 * Procesa un archivo y devuelve un objeto de adjunto normalizado.
 */
async function processFile(file, maxChars) {
    const name = file.name;
    const mime = file.type;

    // --- IMAGEN ---
    if (mime.startsWith('image/')) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_SIZE = 800; // Redimensionar a máx 800px para ahorrar espacio en localStorage
                    let width = img.width;
                    let height = img.height;

                    if (width > MAX_SIZE || height > MAX_SIZE) {
                        if (width > height) {
                            height = Math.round(height * (MAX_SIZE / width));
                            width = MAX_SIZE;
                        } else {
                            width = Math.round(width * (MAX_SIZE / height));
                            height = MAX_SIZE;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Convertir a JPEG con calidad 0.75 para reducir muchísimo el tamaño en base64
                    const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.75);
                    const base64 = compressedDataUrl.split(',')[1];
                    
                    resolve({ name, fileType: 'image', content: base64, mediaType: 'image/jpeg', dataUrl: compressedDataUrl });
                };
                img.onerror = () => reject(new Error('Error al decodificar la imagen.'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Error al leer la imagen.'));
            reader.readAsDataURL(file);
        });
    }

    // --- PDF ---
    if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const text = await extractPdfText(e.target.result, maxChars);
                    resolve({ name, fileType: 'pdf', content: text });
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('Error al leer el PDF.'));
            reader.readAsArrayBuffer(file);
        });
    }

    // --- TEXTO PLANO ---
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            let text = e.target.result;
            if (text.length > maxChars) {
                text = text.slice(0, maxChars) + '\n\n[... contenido truncado para caber en el contexto ...]';
            }
            resolve({ name, fileType: 'text', content: text });
        };
        reader.onerror = () => reject(new Error('Error al leer el archivo.'));
        reader.readAsText(file, 'utf-8');
    });
}

/**
 * Extrae texto de un ArrayBuffer de PDF usando PDF.js (importación dinámica).
 */
async function extractPdfText(arrayBuffer, maxChars) {
    let getDocument, GlobalWorkerOptions;

    try {
        const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs');
        getDocument         = pdfjs.getDocument;
        GlobalWorkerOptions = pdfjs.GlobalWorkerOptions;
    } catch {
        throw new Error('No se pudo cargar PDF.js. Verifica tu conexión a internet.');
    }

    // Worker separado es obligatorio en navegadores
    GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';

    const pdf = await getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        if (fullText.length >= maxChars) break;
        const page    = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        fullText += `\n--- Página ${i} ---\n${pageText}`;
    }

    if (fullText.length > maxChars) {
        fullText = fullText.slice(0, maxChars) + '\n\n[... PDF truncado para caber en el contexto ...]';
    }

    return fullText.trim() || '(El PDF no contiene texto extraíble — puede ser un PDF escaneado o de solo imágenes.)';
}


/**
 * Elimina un adjunto por índice.
 */
function removeAttachment(index) {
    pendingAttachments.splice(index, 1);
    renderAttachmentPreview();
}

/**
 * Renderiza los chips de adjuntos en #attachmentPreview.
 */
function renderAttachmentPreview() {
    const container = $('attachmentPreview');
    const btn       = $('attachBtn');
    if (!container) return;

    if (pendingAttachments.length === 0) {
        container.style.display = 'none';
        btn?.classList.remove('has-files');
        return;
    }

    container.style.display = 'flex';
    btn?.classList.add('has-files');

    container.innerHTML = pendingAttachments.map((att, i) => {
        const icon = att.fileType === 'image'
            ? `<img class="chip-thumb" src="${escHtml(att.dataUrl)}" alt="">`
            : `<span class="chip-icon"><i data-lucide="${att.fileType === 'pdf' ? 'file-text' : 'file-code'}"></i></span>`;

        const typeLabel = att.fileType === 'image' ? att.mediaType?.split('/')[1]?.toUpperCase() || 'IMG'
                        : att.fileType === 'pdf'   ? 'PDF'
                        : 'TXT';

        return `
            <div class="attachment-chip">
                ${icon}
                <span class="chip-name" title="${escHtml(att.name)}">${escHtml(att.name)}</span>
                <span class="chip-type">${typeLabel}</span>
                <button class="chip-remove" onclick="removeAttachment(${i})" title="Quitar">
                    <i data-lucide="x"></i>
                </button>
            </div>`;
    }).join('');

    if (window.lucide) lucide.createIcons({ nodes: [container] });
}

/**
 * Construye el campo `content` del mensaje del usuario para la API.
 * Devuelve un string si no hay adjuntos, o un array de content blocks si los hay.
 *
 * @param {string}  textRaw   - Texto escrito por el usuario
 * @param {string}  provider  - 'openai' | 'anthropic' | 'local'
 * @param {Array}   attachments - copia de pendingAttachments al momento de enviar
 */
function buildUserContent(textRaw, provider, attachments) {
    if (!attachments.length) return textRaw;

    // Separar imágenes y documentos de texto
    const images = attachments.filter(a => a.fileType === 'image');
    const docs   = attachments.filter(a => a.fileType !== 'image');

    // Prefijo con el contenido de los documentos adjuntos
    let textWithDocs = textRaw;
    if (docs.length) {
        const docBlocks = docs.map(d =>
            `\n\n---\n**Archivo adjunto: ${d.name}**\n\`\`\`\n${d.content}\n\`\`\``
        ).join('');
        textWithDocs = textRaw + docBlocks;
    }

    if (!images.length) {
        // Solo texto/documentos — devolver string (compatible con todos los modelos)
        return textWithDocs;
    }

    // Hay imágenes: construir array de content blocks según proveedor
    if (provider === 'anthropic') {
        const blocks = [
            { type: 'text', text: textWithDocs || '(Revisa la imagen adjunta)' },
            ...images.map(img => ({
                type: 'image',
                source: {
                    type:       'base64',
                    media_type: img.mediaType,
                    data:       img.content
                }
            }))
        ];
        return blocks;
    }

    // OpenAI / Local (vision format)
    const blocks = [
        { type: 'text', text: textWithDocs || '(Revisa la imagen adjunta)' },
        ...images.map(img => ({
            type:      'image_url',
            image_url: { url: img.dataUrl, detail: 'auto' }
        }))
    ];
    return blocks;
}

/* =========================================================
   ENVIAR / DETENER
   ========================================================= */

function handleSendButton() {
    if (generating) stopGeneration();
    else            sendMessage();
}

function stopGeneration() {
    abortController?.abort();
}

function setSendState(isGenerating) {
    generating = isGenerating;
    sendBtn.classList.toggle('stop', isGenerating);
    sendBtn.disabled = false;
    const icon = sendBtn.querySelector('i');
    if (icon) {
        icon.setAttribute('data-lucide', isGenerating ? 'square' : 'send');
        lucide.createIcons({ nodes: [sendBtn] });
    }
    sendBtn.title = isGenerating ? 'Detener generación' : 'Enviar';
}

async function sendMessage() {
    if (generating) return;
    const text = promptInput.value.trim();

    // Debe haber texto O archivos adjuntos
    if (!text && pendingAttachments.length === 0) return;

    // Validar key si no es local
    if (cfg.provider === 'openai' && !cfg.openaiKey) {
        showNotice('Configura tu API Key de OpenAI en Configuración.', 'warning');
        openSettings();
        return;
    }
    if (cfg.provider === 'anthropic' && !cfg.anthropicKey) {
        showNotice('Configura tu API Key de Anthropic en Configuración.', 'warning');
        openSettings();
        return;
    }

    // Snapshot de adjuntos antes de limpiar
    const attachmentsSnapshot = [...pendingAttachments];

    setSendState(true);
    promptInput.value = '';
    resizeTextarea();

    // Limpiar adjuntos de la UI
    pendingAttachments = [];
    renderAttachmentPreview();

    // Mostrar mensaje del usuario en la UI
    $('welcome')?.remove();
    const userRefs = addMessageDOM('user');
    userRefs.textEl.textContent = text || '';

    // Mostrar previews de imágenes en la burbuja del usuario
    const userImages = attachmentsSnapshot.filter(a => a.fileType === 'image');
    userImages.forEach(img => {
        const el = document.createElement('img');
        el.src = img.dataUrl;
        el.className = 'user-attached-image';
        el.alt = img.name;
        userRefs.textEl.appendChild(el);
    });
    const userDocs = attachmentsSnapshot.filter(a => a.fileType !== 'image');
    if (userDocs.length) {
        const docInfo = document.createElement('div');
        docInfo.style.cssText = 'margin-top:6px;font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px;';
        userDocs.forEach(d => {
            const badge = document.createElement('span');
            badge.style.cssText = 'background:var(--panel3);border:1px solid var(--border);border-radius:6px;padding:2px 8px;';
            badge.textContent = `📎 ${d.name}`;
            docInfo.appendChild(badge);
        });
        userRefs.textEl.appendChild(docInfo);
    }

    // Construir el content del mensaje según proveedor y adjuntos
    const baseText = cfg.provider === 'local'
        ? (thinkingMode ? `/think\n${text}` : `/no_think\n${text}`)
        : text;

    const userContent = buildUserContent(baseText, cfg.provider, attachmentsSnapshot);

    // _display: texto visible en el chat (sin el contenido de archivos adjuntos).
    // Se usa al recargar para no mostrar el bloque enorme de texto de los archivos.
    const displayParts = [];
    if (text) displayParts.push(text);
    attachmentsSnapshot.forEach(a => {
        if (a.fileType === 'image') displayParts.push(`[img:${a.name}]`);
        else displayParts.push(`[doc:${a.name}]`);
    });
    activeMessages.push({ role: 'user', content: userContent, _display: displayParts.join(' ') || text });

    // Actualizar título si es el primer mensaje
    const isFirst = activeMessages.filter(m => m.role === 'user').length === 1;
    updateActiveChat(activeMessages, isFirst);
    updateContextCount();

    // Crear burbuja del asistente
    const asstRefs = addMessageDOM('assistant');

    let fullText    = '';
    let usageInput  = 0;
    let usageOutput = 0;

    abortController = new AbortController();

    try {
        let isImageModel = false;
        const currentModelData = PROVIDERS[cfg.provider]?.models.find(m => m.id === getCurrentModelId());
        if (currentModelData && currentModelData.price && currentModelData.price.perImage) {
            isImageModel = true;
        }

        if (cfg.provider === 'openai' && isImageModel) {
            // Modelo de imagen (endpoint /images/generations)
            ({ fullText, usageInput, usageOutput } = await generateImageOpenAI(asstRefs, text, cfg.openaiModel));
        } else if (cfg.provider === 'openai' || cfg.provider === 'local') {
            ({ fullText, usageInput, usageOutput } = await streamOpenAI(asstRefs, fullText));
        } else if (cfg.provider === 'anthropic') {
            ({ fullText, usageInput, usageOutput } = await streamAnthropic(asstRefs, fullText));
        }

        // Guardar respuesta
        const asstMsg = { role: 'assistant', content: fullText };
        activeMessages.push(asstMsg);
        updateActiveChat(activeMessages);
        updateContextCount();

        // Si estamos en un chat de tipo "proyecto", buscar propuestas de
        // edición de archivos (bloques ```file:...```) en la respuesta.
        const projectChat = getActiveChat();
        if (projectChat && projectChat.type === 'project') {
            const proposed = parseFileEdits(fullText);
            if (proposed.length) {
                asstMsg.edits = proposed.map(e => ({
                    id: 'edit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                    file: e.file,
                    newContent: e.content,
                    status: 'pending'
                }));
                persistChats();
                renderEditCards(asstRefs, asstMsg);
            }
        }

        // Actualizar tokens
        sessionTokens.input  += usageInput;
        sessionTokens.output += usageOutput;
        persistTokens();
        updateSessionUsageUI();

        // Mostrar tokens en el mensaje
        if (usageInput + usageOutput > 0) {
            showTokenInfoOnMessage(asstRefs, usageInput, usageOutput);
        }

        setStatusOnline();

    } catch (err) {
        if (err.name === 'AbortError') {
            if (fullText) {
                updateAssistantView(asstRefs, fullText + '\n\n_(Generación detenida)_');
                activeMessages.push({ role: 'assistant', content: fullText });
                updateActiveChat(activeMessages);
            } else {
                asstRefs.message.remove();
            }
        } else {
            console.error('[CalenturaChat 😋] Error:', err);
            asstRefs.textEl.innerHTML = '';
            asstRefs.textEl.textContent = `Error: ${err.message}`;
            setStatusError();
        }
    } finally {
        setSendState(false);
        abortController = null;
        promptInput.focus();
    }
}

/* =========================================================
   GENERACIÓN DE IMÁGENES — OpenAI (DALL-E)
   ========================================================= */

async function generateImageOpenAI(asstRefs, promptText, modelId) {
    if (!promptText) {
        throw new Error("Se requiere texto (prompt) para generar una imagen.");
    }

    if (asstRefs.thinkingDetails) {
        asstRefs.thinkingDetails.style.display = 'none';
    }

    let finalPrompt = promptText;
    let extraUsageIn = 0;
    let extraUsageOut = 0;

    if (magicPrompt) {
        asstRefs.textEl.innerHTML = '<span class="muted"><i data-lucide="wand-2" class="spin"></i> Mejorando prompt mágicamente...</span>';
        if (window.lucide) lucide.createIcons({ nodes: [asstRefs.textEl] });

        try {
            // Llamada al modelo de texto rápido para mejorar el prompt
            // Usamos GPT-4.1 Mini por defecto para esto
            const textModel = 'gpt-4.1-mini';
            const resOpt = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${cfg.openaiKey}`
                },
                signal: abortController.signal,
                body: JSON.stringify({
                    model: textModel,
                    messages: [
                        { role: 'system', content: IMAGE_ENHANCER_PROMPT },
                        { role: 'user', content: promptText }
                    ],
                    max_tokens: 500,
                    temperature: 0.7
                })
            });

            if (resOpt.ok) {
                const optData = await resOpt.json();
                if (optData.choices && optData.choices[0]?.message?.content) {
                    finalPrompt = optData.choices[0].message.content.trim();
                    extraUsageIn = optData.usage?.prompt_tokens || 0;
                    extraUsageOut = optData.usage?.completion_tokens || 0;
                }
            }
        } catch (e) {
            console.warn("Error al mejorar el prompt mágicamente. Usando prompt original.", e);
        }
    }

    asstRefs.textEl.innerHTML = '<span class="muted"><i data-lucide="loader-2" class="spin"></i> Generando imagen...</span>';
    if (window.lucide) lucide.createIcons({ nodes: [asstRefs.textEl] });

    const body = {
        model: modelId,
        prompt: finalPrompt,
        n: 1,
        size: "1024x1024"
    };

    if (modelId === 'dall-e-3') {
        body.quality = "standard";
    }

    const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.openaiKey}`
        },
        signal: abortController.signal,
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    const item = data.data && data.data[0] ? data.data[0] : {};
    const url = item.url || (item.b64_json ? 'data:image/png;base64,' + item.b64_json : '');
    const revisedPrompt = item.revised_prompt || promptText;

    // Retornamos el markdown. Usaremos HTML inline para que la imagen se adapte mejor visualmente.
    const fullText = `<img src="${url}" alt="Imagen generada" referrerpolicy="no-referrer" style="max-width: 400px; max-height: 400px; width: 100%; object-fit: contain; border-radius:10px; margin-top:8px; border:1px solid var(--border2);">`;

    updateAssistantView(asstRefs, fullText);

    // Sumamos los tokens usados en el enhancer (si los hubo)
    return { fullText, usageInput: extraUsageIn, usageOutput: extraUsageOut };
}

/* =========================================================
   STREAMING — OpenAI / Local
   ========================================================= */

async function streamOpenAI(asstRefs, accumulated) {
    let fullText    = accumulated;
    let usageInput  = 0;
    let usageOutput = 0;
    let reasoningText    = '';   // acumula delta.reasoning_content del stream
    let renderScheduled = false;

    const scheduleRender = () => {
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(() => {
            renderScheduled = false;
            updateAssistantView(asstRefs, fullText);
        });
    };

    const baseUrl  = cfg.provider === 'openai' ? 'https://api.openai.com/v1' : cfg.localApiUrl;
    const modelId  = cfg.provider === 'openai' ? cfg.openaiModel : cfg.localModel;
    const headers  = { 'Content-Type': 'application/json' };

    if (cfg.provider === 'openai') {
        headers['Authorization'] = `Bearer ${cfg.openaiKey}`;
    } else if (cfg.provider === 'local' && cfg.localKey) {
        headers['Authorization'] = `Bearer ${cfg.localKey}`;
    }

    const contextMessages = buildContext();

    // Todos los modelos usan /chat/completions (incluidos gpt-5.6-* y gpt-6-*).
    // El endpoint /responses requiere un formato de input completamente distinto
    // y no es compatible con el array {role,content} de chat/completions.
    const body = {
        model:              modelId,
        messages:           contextMessages,
        stream:             true,
        stream_options:     { include_usage: true }
    };

    // Modelo LOCAL: sin límite de tokens de salida.
    // No se envía max_tokens / max_completion_tokens, así que el servidor
    // genera hasta terminar la respuesta (o hasta llenar su ventana de contexto).
    // Para OpenAI se mantiene el límite configurado, según la familia de modelo.
    if (cfg.provider !== 'local') {
        if (modelId.startsWith('o1') || modelId.startsWith('o3')) {
            body.max_completion_tokens = cfg.maxTokens;
        } else if (modelId.startsWith('gpt-5.6') || modelId.startsWith('gpt-6')) {
            body.max_completion_tokens = cfg.maxTokens;
        } else {
            body.max_tokens = cfg.maxTokens;
        }
    }

    // Agregar reasoning_effort si el modelo lo soporta.
    // Se omite si el valor es 'none', 'max' (no soportado por la API) o está vacío.
    const VALID_REASONING = ['low', 'medium', 'high', 'xhigh'];
    if (REASONING_LEVELS[modelId] && VALID_REASONING.includes(reasoningLevel)) {
        body.reasoning_effort = reasoningLevel;
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal: abortController.signal,
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;

            try {
                const json  = JSON.parse(data);
                const delta = json.choices?.[0]?.delta || {};

                // Razonamiento en tiempo real (modelos con reasoning_effort)
                const reasoningDelta = delta.reasoning_content || '';
                if (reasoningDelta) {
                    reasoningText += reasoningDelta;
                    // Mostrar panel de thinking en vivo
                    if (asstRefs.thinkingDetails) {
                        asstRefs.thinkingDetails.style.display = 'block';
                        asstRefs.thinkingDetails.open = true;
                    }
                    if (asstRefs.thinkingContent) {
                        const escaped = reasoningText
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/\n/g, '<br>');
                        asstRefs.thinkingContent.innerHTML =
                            (window.DOMPurify ? DOMPurify.sanitize(escaped) : escaped)
                            + '<span class="think-cursor">▊</span>';
                        scrollBottom();
                    }
                }

                // Texto de respuesta normal
                const content = delta.content || '';
                if (content) {
                    // Al empezar a responder: cerrar el thinking
                    if (reasoningText && asstRefs.thinkingDetails && !asstRefs.collapsedOnce) {
                        asstRefs.thinkingDetails.open = false;
                        asstRefs.collapsedOnce = true;
                        // Quitar cursor parpadeante del thinking
                        if (asstRefs.thinkingContent) {
                            const escaped = reasoningText
                                .replace(/&/g, '&amp;')
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;')
                                .replace(/\n/g, '<br>');
                            asstRefs.thinkingContent.innerHTML =
                                window.DOMPurify ? DOMPurify.sanitize(escaped) : escaped;
                        }
                    }
                    fullText += content;
                    scheduleRender();
                }

                // Uso de tokens (viene al final gracias a stream_options.include_usage)
                if (json.usage) {
                    usageInput  = json.usage.prompt_tokens || json.usage.input_tokens || 0;
                    usageOutput = json.usage.completion_tokens || json.usage.output_tokens || 0;
                }
            } catch { /* fragmento incompleto */ }
        }
    }

    updateAssistantView(asstRefs, fullText);

    // Si el servidor local no devolvió usage, estimamos (~4 chars por token)
    if (cfg.provider === 'local' && usageInput === 0 && usageOutput === 0) {
        const contextChars = contextMessages.reduce((acc, m) => {
            const c = m.content;
            return acc + (typeof c === 'string' ? c.length : JSON.stringify(c).length);
        }, 0);
        usageInput  = Math.round(contextChars / 4);
        usageOutput = Math.round(fullText.length / 4);
    }

    return { fullText, usageInput, usageOutput };
}

/* =========================================================
   STREAMING — Anthropic
   ========================================================= */

async function streamAnthropic(asstRefs, accumulated) {
    let fullText    = accumulated;
    let usageInput  = 0;
    let usageOutput = 0;
    let renderScheduled = false;

    const scheduleRender = () => {
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(() => {
            renderScheduled = false;
            updateAssistantView(asstRefs, fullText);
        });
    };

const contextMessages = buildContext();

// Anthropic solo acepta user y assistant dentro de messages.
// Además, se eliminan campos internos de la interfaz, como _display.
const anthropicMessages = contextMessages
    .filter(msg => msg.role === 'user' || msg.role === 'assistant')
    .map(({ role, content }) => ({
        role,
        content
    }));

const body = {
    model: cfg.anthropicModel,
    max_tokens: cfg.maxTokens,
    stream: true,
    messages: anthropicMessages
};

// El prompt de sistema se manda fuera de `messages` en Anthropic.
// Se usa cache_control para ahorrar tokens en llamadas sucesivas.
if (cfg.systemPrompt && cfg.systemPrompt.trim()) {
    body.system = [
        {
            type: 'text',
            text: cfg.systemPrompt.trim(),
            cache_control: { type: 'ephemeral' }
        }
    ];
}

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type':      'application/json',
            'x-api-key':         cfg.anthropicKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta':    'prompt-caching-2024-07-31',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        signal: abortController.signal,
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (line.startsWith('data:')) {
                const data = line.slice(5).trim();
                try {
                    const json = JSON.parse(data);

                    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
                        fullText += json.delta.text;
                        scheduleRender();
                    }

                    if (json.type === 'message_delta' && json.usage) {
                        usageOutput = json.usage.output_tokens || 0;
                    }

                    if (json.type === 'message_start' && json.message?.usage) {
                        // input_tokens ya descuenta los cache_read_input_tokens
                        const u = json.message.usage;
                        usageInput = (u.input_tokens || 0)
                                   + (u.cache_creation_input_tokens || 0);
                        // Log de caché para debugging
                        if (u.cache_read_input_tokens > 0) {
                            console.debug(
                                `[CalenturaChat] Prompt cache HIT: ${u.cache_read_input_tokens.toLocaleString()} tokens ahorrados`);
                        }
                    }
                } catch { /* fragmento incompleto */ }
            }
        }
    }

    updateAssistantView(asstRefs, fullText);
    return { fullText, usageInput, usageOutput };
}

/* =========================================================
   CONTEXTO (ahorro de tokens)
   ========================================================= */

function buildContext() {
    // Tomar solo los últimos N mensajes del historial.
    // _display y cualquier otro campo interno de UI se descartan aquí.
    const recentMessages = activeMessages
        .filter(msg =>
            msg &&
            (msg.role === 'user' || msg.role === 'assistant')
        )
        .slice(-cfg.maxContext)
        .map(({ role, content }) => ({
            role,
            content
        }));

    // Si el chat activo es de tipo "proyecto", se agrega al system prompt
    // el contenido de los archivos y las instrucciones de edición tipo agente.
    const activeChat = getActiveChat();
    let systemPrompt = cfg.systemPrompt || '';
    if (activeChat && activeChat.type === 'project') {
        systemPrompt = (systemPrompt || 'Eres un asistente útil, preciso y conversacional.') + buildProjectSystemAddendum(activeChat);
    }

    // OpenAI y los servidores locales esperan el system prompt
    // como un mensaje dentro de `messages`.
    if (systemPrompt) {
        return [
            {
                role: 'system',
                content: systemPrompt
            },
            ...recentMessages
        ];
    }

    return recentMessages;
}



function updateContextCount() {
    const count = activeMessages.filter(m => m.role !== 'system').length;
    if (contextCountEl) contextCountEl.textContent = count;
}

/* =========================================================
   MENSAJES — DOM
   ========================================================= */

function addMessageDOM(role) {
    $('welcome')?.remove();

    const message = document.createElement('div');
    message.className = `message ${role} ${cfg.provider}`;

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    const avatarIcon = document.createElement('i');
    avatarIcon.setAttribute('data-lucide', role === 'user' ? 'user' : 'bot');
    avatar.appendChild(avatarIcon);

    const content = document.createElement('div');
    content.className = 'content';

    // Nombre
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = role === 'user' ? 'Tú' : PROVIDERS[cfg.provider]?.label || 'IA';

    if (role === 'assistant') {
        const tag = document.createElement('span');
        tag.className = 'model-tag';
        tag.textContent = getLabelForModel(cfg.provider, getCurrentModelId());
        name.appendChild(tag);
    }

    content.appendChild(name);

    // Thinking (solo para asistente)
    let thinkingDetails = null;
    let thinkingContent = null;

    if (role === 'assistant') {
        thinkingDetails = document.createElement('details');
        thinkingDetails.className = 'thinking';
        thinkingDetails.style.display = 'none';

        const summary = document.createElement('summary');
        const brainIcon = document.createElement('i');
        brainIcon.setAttribute('data-lucide', 'brain');
        summary.appendChild(brainIcon);
        summary.appendChild(document.createTextNode(' Razonamiento'));
        thinkingDetails.appendChild(summary);

        thinkingContent = document.createElement('div');
        thinkingContent.className = 'thinking-content';
        thinkingDetails.appendChild(thinkingContent);

        content.appendChild(thinkingDetails);
    }

    const textEl = document.createElement('div');
    textEl.className = 'text';
    content.appendChild(textEl);

    message.appendChild(avatar);
    message.appendChild(content);
    chatInnerEl.appendChild(message);

    if (window.lucide) lucide.createIcons({ nodes: [avatar, ...(thinkingDetails ? [thinkingDetails.querySelector('summary')] : [])] });

    scrollBottom();

    return { message, nameEl: name, thinkingDetails, thinkingContent, textEl, collapsedOnce: false };
}

function getLabelForModel(provider, modelId) {
    const models = PROVIDERS[provider]?.models || [];
    return models.find(m => m.id === modelId)?.label || modelId || provider;
}

function showTokenInfoOnMessage(refs, inputTokens, outputTokens) {
    const tokenEl = document.createElement('span');
    tokenEl.className = 'token-info';
    const zapIcon = document.createElement('i');
    zapIcon.setAttribute('data-lucide', 'zap');
    tokenEl.appendChild(zapIcon);

    const total = inputTokens + outputTokens;
    const isLocal = cfg.provider === 'local';
    const prefix = isLocal ? '~' : '';
    const suffix = isLocal ? ' (est.)' : '';
    tokenEl.appendChild(document.createTextNode(` ${prefix}${total.toLocaleString()} tokens${suffix}`));
    tokenEl.title = `↓ entrada: ${prefix}${inputTokens.toLocaleString()}  ↑ salida: ${prefix}${outputTokens.toLocaleString()}`;

    refs.nameEl.appendChild(tokenEl);
    if (window.lucide) lucide.createIcons({ nodes: [tokenEl] });
}

function updateAssistantView(refs, rawText) {
    const parsed = splitThinking(rawText);

    if (parsed.thinking !== null && refs.thinkingDetails) {
        refs.thinkingDetails.style.display = 'block';

        // Mostrar el razonamiento con markdown básico
        if (refs.thinkingContent) {
            // Durante el streaming mostramos en tiempo real con un cursor parpadeante
            if (parsed.inProgress) {
                refs.thinkingContent.innerHTML =
                    (window.DOMPurify
                        ? DOMPurify.sanitize(parsed.thinking.replace(/\n/g, '<br>'))
                        : parsed.thinking.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'))
                    + '<span class="think-cursor">▊</span>';
            } else {
                refs.thinkingContent.innerHTML =
                    window.DOMPurify
                        ? DOMPurify.sanitize(parsed.thinking.replace(/\n/g, '<br>'))
                        : parsed.thinking.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
            }
        }

        if (parsed.inProgress) {
            // Mientras razona: mostrar abierto
            refs.thinkingDetails.open = true;
        } else if (!refs.collapsedOnce) {
            // Al terminar: colapsar automáticamente (solo la primera vez)
            refs.thinkingDetails.open = false;
            refs.collapsedOnce = true;
        }
    }

    renderMarkdown(refs.textEl, stripFileEditBlocks(parsed.answer));
    scrollBottom();
}

/**
 * Reemplaza los bloques ```file:nombre ... ``` (propuestas de edición de
 * proyecto) por una nota corta, para no duplicar el contenido completo del
 * archivo dentro de la burbuja de texto — el detalle se ve en la tarjeta
 * de edición (con diff) que se renderiza debajo del mensaje.
 */
function stripFileEditBlocks(text) {
    if (!text || text.indexOf('```file:') === -1) return text;
    return text.replace(/```file:([^\n`]+)\n[\s\S]*?```/g,
        (_, fname) => `\n\n📄 *Propuesta de cambios para \`${fname.trim()}\` — revisa la tarjeta de edición debajo.*\n`);
}

/* =========================================================
   RAZONAMIENTO (<think> ... </think>)
   ========================================================= */

function splitThinking(text) {
    const closed = text.match(/<think>([\s\S]*?)<\/think>/i);
    if (closed) {
        const before = text.slice(0, closed.index);
        const after  = text.slice(closed.index + closed[0].length);
        return { thinking: closed[1].trim(), answer: (before + after).trim(), inProgress: false };
    }

    const open = text.match(/<think>([\s\S]*)$/i);
    if (open) {
        return { thinking: open[1].trim(), answer: text.slice(0, open.index).trim(), inProgress: true };
    }

    return { thinking: null, answer: text, inProgress: false };
}

function toggleThinking() {
    thinkingMode = !thinkingMode;
    const btn = $('thinkingBtn');
    if (btn) {
        btn.classList.toggle('thinking-active', thinkingMode);
        const span = btn.querySelector('span');
        if (span) span.textContent = `Razonamiento: ${thinkingMode ? 'ON' : 'OFF'}`;
    }
}

function toggleMagicPrompt() {
    magicPrompt = !magicPrompt;
    const btn = $('magicPromptBtn');
    if (btn) {
        btn.classList.toggle('thinking-active', magicPrompt); // Reusing thinking-active class for visual feedback
        const span = btn.querySelector('span');
        if (span) span.textContent = `Magia: ${magicPrompt ? 'ON' : 'OFF'}`;
    }
}

/* =========================================================
   MARKDOWN + LATEX + SANITIZACIÓN
   ========================================================= */

const MATH_ENVS = 'matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|array|align\\*?|equation\\*?|eqnarray\\*?|gather\\*?|cases|split';

function protectMath(text) {
    const store = [];
    const stash = (raw) => { store.push(raw); return `\uE000${store.length - 1}\uE001`; };

    let out = text;
    out = out.replace(/\$\$[\s\S]+?\$\$/g, stash);
    out = out.replace(/\\\[[\s\S]+?\\\]/g, stash);
    out = out.replace(/\\\([\s\S]+?\\\)/g, stash);

    const envRe = new RegExp(`\\\\begin\\{(${MATH_ENVS})\\}[\\s\\S]+?\\\\end\\{\\1\\}`, 'g');
    out = out.replace(envRe, (block) => stash(`\\[${block}\\]`));

    out = out.replace(/\$([^$\n]+?)\$/g, (whole, inner) =>
        /\\[a-zA-Z]+|[_^{}]/.test(inner) ? stash(whole) : whole
    );

    return { text: out, store };
}

function restoreMath(html, store) {
    return html.replace(/\uE000(\d+)\uE001/g, (_, i) => escHtml(store[Number(i)]));
}

function renderMarkdown(container, rawText) {
    if (!rawText) { container.innerHTML = ''; return; }

    try {
        const { text: protected_, store } = protectMath(rawText);
        let html;

        if (window.marked && window.DOMPurify) {
            html = marked.parse(protected_);
            html = restoreMath(html, store);
            html = DOMPurify.sanitize(html);
        } else {
            html = basicMarkdownFallback(protected_);
            html = restoreMath(html, store);
        }

        container.innerHTML = html;

        if (window.renderMathInElement) {
            try {
                renderMathInElement(container, {
                    delimiters: [
                        { left: '$$', right: '$$', display: true },
                        { left: '\\[', right: '\\]', display: true },
                        { left: '\\(', right: '\\)', display: false },
                        { left: '$',  right: '$',  display: false }
                    ],
                    throwOnError: false
                });
            } catch { /* silent */ }
        }

        addCopyButtons(container);
    } catch (err) {
        console.error('[CalenturaChat 😋] Render error:', err);
        container.textContent = rawText;
    }
}

function basicMarkdownFallback(text) {
    let h = escHtml(text);
    h = h.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c}</code></pre>`);
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    h = h.replace(/\n/g, '<br>');
    return h;
}

function addCopyButtons(container) {
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.copy-btn')) return;

        const btn = document.createElement('button');
        btn.type      = 'button';
        btn.className = 'copy-btn';
        btn.textContent = 'Copiar';

        btn.addEventListener('click', () => {
            const code = pre.querySelector('code')?.textContent ?? pre.textContent;
            navigator.clipboard.writeText(code)
                .then(() => {
                    btn.textContent = '¡Copiado!';
                    setTimeout(() => (btn.textContent = 'Copiar'), 1500);
                })
                .catch(() => {
                    btn.textContent = 'Error';
                    setTimeout(() => (btn.textContent = 'Copiar'), 1500);
                });
        });

        pre.appendChild(btn);
    });
}

/* =========================================================
   ACCIONES DEL CHAT
   ========================================================= */

function clearChat() {
    activeMessages = [];
    updateActiveChat(activeMessages);
    renderChatMessages();
    updateContextCount();
}

function newChat() {
    createNewChat();
    promptInput.focus();
}

function scrollBottom() {
    chatEl.scrollTop = chatEl.scrollHeight;
}

/* =========================================================
   CONEXIÓN LOCAL
   ========================================================= */

async function testLocalConnection() {
    setStatusConnecting();

    try {
        const headers = {};
        if (cfg.localKey) headers['Authorization'] = `Bearer ${cfg.localKey}`;
        const res = await fetch(`${cfg.localApiUrl}/models`, { method: 'GET', headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const firstId = data?.data?.[0]?.id;

        setStatusOnline();

        if (firstId) {
            cfg.localModel = firstId;
            localStorage.setItem('nc_local_model', firstId);
            populateModelSelect('local');
            statusTextEl.textContent = `Conectado — ${firstId.slice(0, 22)}`;
        }
    } catch {
        setStatusError();
    }
}

/* =========================================================
   ESTADO DE CONEXIÓN
   ========================================================= */

function setStatusOnline() {
    statusDotEl.className  = 'status-dot online';
    statusTextEl.textContent = 'Conectado';
}

function setStatusError() {
    statusDotEl.className  = 'status-dot error';
    statusTextEl.textContent = 'Error';
}

function setStatusConnecting() {
    statusDotEl.className  = 'status-dot';
    statusTextEl.textContent = 'Conectando...';
}

function setStatusNeutral() {
    statusDotEl.className  = 'status-dot';
    statusTextEl.textContent = 'Listo';
}

/* =========================================================
   UTILIDADES
   ========================================================= */

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showNotice(msg, type = 'info') {
    // Notificación flotante temporal
    const n = document.createElement('div');
    n.style.cssText = `
        position:fixed;bottom:100px;left:50%;tr