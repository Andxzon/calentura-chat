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
            { id: 'gpt-4o-mini',  label: 'GPT-4o Mini', price: { in: 0.15, out: 0.60 } },
            { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', price: { in: 0.30, out: 1.20 } },
            { id: 'o3-mini',      label: 'o3 Mini', price: { in: 1.50, out: 6.00 } },
            { id: 'gpt-4o',       label: 'GPT-4o', price: { in: 2.50, out: 10.00 } },
            { id: 'o1-mini',      label: 'o1 Mini', price: { in: 3.00, out: 12.00 } },
            { id: 'gpt-4.1',      label: 'GPT-4.1', price: { in: 5.00, out: 20.00 } },
            { id: 'o1',           label: 'o1', price: { in: 15.00, out: 60.00 } },
        ]
    },
    anthropic: {
        label: 'Anthropic',
        models: [
            { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5', price: { in: 0.20, out: 1.00 } },
            { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku (2024-10-22)', price: { in: 0.25, out: 1.25 } },
            { id: 'claude-sonnet-5',            label: 'Claude Sonnet 5', price: { in: 2.50, out: 12.50 } },
            { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (2024-10-22)', price: { in: 3.00, out: 15.00 } },
            { id: 'claude-opus-5',              label: 'Claude Opus 5', price: { in: 10.00, out: 50.00 } },
            { id: 'claude-3-opus-20240229',     label: 'Claude 3 Opus (2024-02-29)', price: { in: 15.00, out: 75.00 } },
            { id: 'claude-fable-5-1',           label: 'Claude Fable 5.1', price: { in: 20.00, out: 80.00 } },
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
        openaiModel:     localStorage.getItem('nc_openai_model') || 'gpt-4o-mini',
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

/* =========================================================
   ESTADO
   ========================================================= */

let generating      = false;
let abortController = null;
let thinkingMode    = false;

// Sesión de tokens acumulados
let sessionTokens = { input: 0, output: 0 };

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
    localStorage.setItem('nc_chats', JSON.stringify(chats));
}

function createNewChat() {
    const id = 'chat_' + Date.now();
    const chat = {
        id,
        title: 'Nuevo chat',
        provider: cfg.provider,
        model: getCurrentModelId(),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    chats.unshift(chat);
    persistChats();
    openChat(id);
    renderChatHistory();
}

function openChat(id) {
    activeChatId = id;
    const chat = chats.find(c => c.id === id);
    if (!chat) { createNewChat(); return; }

    activeMessages = chat.messages;
    renderChatHistory();
    renderChatMessages();
    updateContextCount();
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
            chat.title = firstUser.content.replace(/\/think\n|\/no_think\n/g, '').slice(0, 42).trim() || 'Nuevo chat';
        }
    }

    persistChats();
    renderChatHistory();
}

function deleteChat(id, event) {
    event.stopPropagation();
    chats = chats.filter(c => c.id !== id);
    persistChats();

    if (activeChatId === id) {
        if (chats.length > 0) openChat(chats[0].id);
        else createNewChat();
    } else {
        renderChatHistory();
    }
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
            html += `
                <div class="history-item ${active}" onclick="openChat('${chat.id}')" title="${escHtml(chat.title)}">
                    <span class="history-provider-dot ${chat.provider || 'local'}"></span>
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
            refs.textEl.textContent = msg.content.replace(/^\/think\n|^\/no_think\n/, '');
        } else {
            updateAssistantView(refs, msg.content);
        }
    });

    scrollBottom();
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
}

function updateModelPriceUI(provider, modelId) {
    const badge = $('modelPriceBadge');
    if (!badge) return;
    
    if (provider === 'local') {
        badge.innerHTML = `<i data-lucide="coins"></i> Gratis`;
        badge.title = "Los modelos locales no tienen costo por token.";
    } else {
        const model = PROVIDERS[provider]?.models.find(m => m.id === modelId);
        if (model && model.price) {
            badge.innerHTML = `<i data-lucide="coins"></i> $${model.price.in} / $${model.price.out}`;
            badge.title = `Precio por 1M de tokens: Entrada $${model.price.in} / Salida $${model.price.out}`;
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
    if (!text) return;

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

    setSendState(true);
    promptInput.value = '';
    resizeTextarea();

    // Mostrar mensaje del usuario
    $('welcome')?.remove();
    const userRefs = addMessageDOM('user');
    userRefs.textEl.textContent = text;

    // Agregar al historial interno
    const userContent = cfg.provider === 'local'
        ? (thinkingMode ? `/think\n${text}` : `/no_think\n${text}`)
        : text;

    activeMessages.push({ role: 'user', content: userContent });

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
        if (cfg.provider === 'openai' || cfg.provider === 'local') {
            ({ fullText, usageInput, usageOutput } = await streamOpenAI(asstRefs, fullText));
        } else if (cfg.provider === 'anthropic') {
            ({ fullText, usageInput, usageOutput } = await streamAnthropic(asstRefs, fullText));
        }

        // Guardar respuesta
        activeMessages.push({ role: 'assistant', content: fullText });
        updateActiveChat(activeMessages);
        updateContextCount();

        // Actualizar tokens
        sessionTokens.input  += usageInput;
        sessionTokens.output += usageOutput;
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
   STREAMING — OpenAI / Local
   ========================================================= */

async function streamOpenAI(asstRefs, accumulated) {
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

    const baseUrl  = cfg.provider === 'openai' ? 'https://api.openai.com/v1' : cfg.localApiUrl;
    const modelId  = cfg.provider === 'openai' ? cfg.openaiModel : cfg.localModel;
    const headers  = { 'Content-Type': 'application/json' };

    if (cfg.provider === 'openai') {
        headers['Authorization'] = `Bearer ${cfg.openaiKey}`;
    } else if (cfg.provider === 'local' && cfg.localKey) {
        headers['Authorization'] = `Bearer ${cfg.localKey}`;
    }

    const contextMessages = buildContext();

    const body = {
        model:       modelId,
        messages:    contextMessages,
        stream:      true,
        stream_options: { include_usage: true }
    };

    if (modelId.startsWith('o1') || modelId.startsWith('o3')) {
        body.max_completion_tokens = cfg.maxTokens;
    } else {
        body.max_tokens = cfg.maxTokens;
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
                const json   = JSON.parse(data);
                const delta  = json.choices?.[0]?.delta?.content;
                if (delta) { fullText += delta; scheduleRender(); }

                // Uso de tokens (viene al final en stream_options)
                if (json.usage) {
                    usageInput  = json.usage.prompt_tokens     || 0;
                    usageOutput = json.usage.completion_tokens || 0;
                }
            } catch { /* fragmento incompleto */ }
        }
    }

    updateAssistantView(asstRefs, fullText);
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

    const contextMessages = buildContext(false); // Anthropic: sin system en messages

    const body = {
        model:      cfg.anthropicModel,
        max_tokens: cfg.maxTokens,
        system:     cfg.systemPrompt,
        messages:   contextMessages,
        stream:     true
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type':   'application/json',
            'x-api-key':      cfg.anthropicKey,
            'anthropic-version': '2023-06-01',
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
                        usageInput = json.message.usage.input_tokens || 0;
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

function buildContext(includeSystem = true) {
    // Truncamos desde el inicio para mantenernos dentro de maxContext
    let msgs = activeMessages.filter(m => m.role !== 'system');

    if (msgs.length > cfg.maxContext) {
        msgs = msgs.slice(msgs.length - cfg.maxContext);
    }

    if (includeSystem && cfg.systemPrompt) {
        return [{ role: 'system', content: cfg.systemPrompt }, ...msgs];
    }

    return msgs;
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
    tokenEl.appendChild(document.createTextNode(` ${(inputTokens + outputTokens).toLocaleString()} tokens`));
    refs.nameEl.appendChild(tokenEl);
    if (window.lucide) lucide.createIcons({ nodes: [tokenEl] });
}

/* Actualiza burbuja del asistente con texto acumulado */
function updateAssistantView(refs, rawText) {
    const parsed = splitThinking(rawText);

    if (parsed.thinking !== null && refs.thinkingDetails) {
        refs.thinkingDetails.style.display = 'block';
        refs.thinkingContent.textContent   = parsed.thinking;

        if (parsed.inProgress) {
            refs.thinkingDetails.open = true;
        } else if (!refs.collapsedOnce) {
            refs.thinkingDetails.open = false;
            refs.collapsedOnce = true;
        }
    }

    renderMarkdown(refs.textEl, parsed.answer);
    scrollBottom();
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
        position:fixed;bottom:100px;left:50%;transform:translateX(-50%);
        background:var(--panel);border:1px solid var(--border2);
        padding:12px 20px;border-radius:12px;font-size:14px;
        z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,.4);
        display:flex;align-items:center;gap:10px;
        animation:appear .2s ease-out;
        color:${type === 'warning' ? 'var(--warning)' : 'var(--text)'};
    `;
    n.textContent = msg;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3500);
}

/* =========================================================
   TEXTAREA AUTO-RESIZE
   ========================================================= */

function resizeTextarea() {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 200) + 'px';
}

/* =========================================================
   TOKEN BADGE → abre modal de créditos
   ========================================================= */

$('tokenBadge')?.addEventListener('click', openCredits);
