// ============================================================================
// MÓDULO 12 AUTO-INYECTABLE: CENTRAL UNIVERSAL DE ALERTAS (CUALQUIER ACTIVO
// CEX/DEX + PRECIO PERSONALIZADO + EMAs/RSI) + BOT TELEGRAM + BACKUP TOTAL
// ============================================================================
(function initUniversalAlertsAndTelegramModule() {
  'use strict';

  const oldBtn = document.getElementById('btn-open-alerts-hub');
  const oldModal = document.getElementById('universal-alerts-modal');
  const oldStyle = document.getElementById('universal-alerts-styles');
  if (oldBtn) oldBtn.remove();
  if (oldModal) oldModal.remove();
  if (oldStyle) oldStyle.remove();

  if (window.__universalAlertsInterval) {
    window.clearInterval(window.__universalAlertsInterval);
    window.__universalAlertsInterval = null;
  }
  const oldToast = document.getElementById('live-alert-toast-container');
  if (oldToast) oldToast.remove();

  const ALERTS_KEY = 'crypto_universal_alerts_v1';
  const TG_CONFIG_KEY = 'crypto_telegram_bot_config_v1';
  const JOURNAL_KEY = 'crypto_swing_trading_journal_v1';
  const CHECK_INTERVAL_MS = 15000;
  // En GitHub Pages no existe /proxy: se omite para no generar 404.
  const LOCAL_PROXY_ENABLED = location.port === '4173'
    || /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(location.hostname)
    || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(location.hostname);

  let audioContext = null;
  let evaluatingAlerts = false;
  let lastTelegramError = '';
  let lastTelegramResult = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  function tgEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function sanitizeTickerOrContract(raw) {
    const value = String(raw == null ? '' : raw).trim();
    if (!value) return '';
    if (/^0x[a-fA-F0-9]{20,}$/.test(value)) return value;
    if (/^0x[A-Fa-f0-9]{1,64}::[A-Za-z0-9_]+::[A-Za-z0-9_]+$/.test(value)) return value;
    if (/^[A-Za-z0-9]{20,100}$/.test(value)) return value;
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
  }

  function getTgConfig() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TG_CONFIG_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function getJournalTrades() {
    try {
      const parsed = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function alertFetchJson(target, timeoutMs = 15000) {
    const attempts = [];
    if (LOCAL_PROXY_ENABLED) attempts.push(`/proxy?url=${encodeURIComponent(target)}`);
    attempts.push(target);
    if (window.QuantFetch && typeof window.QuantFetch.first === 'function') {
      return window.QuantFetch.first(attempts, { timeout: timeoutMs, cacheKey: `public ${target}` });
    }
    let lastError = null;
    for (const url of attempts) {
      try {
        const response = await fetchWithTimeout(url, {
          cache: 'no-store',
          credentials: 'omit'
        }, timeoutMs);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Sin respuesta de la API');
  }

  // 1. Sintetizador de Alarma Sonora Nativo (Web Audio API)
  function getAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioContext) audioContext = new AudioCtx();
    if (audioContext.state === 'suspended') {
      const resume = audioContext.resume();
      if (resume && typeof resume.catch === 'function') resume.catch(() => {});
    }
    return audioContext;
  }

  function playAlertSound(type = 'ALARM') {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const notes = type === 'ALARM' ? [587.33, 880, 587.33, 880, 1174.66] : [523.25, 659.25, 783.99];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startAt = ctx.currentTime + (idx * 0.14);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startAt);
        gain.gain.setValueAtTime(0.25, startAt);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.13);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + 0.13);
      });
    } catch (error) {
      console.warn('Audio bloqueado hasta interactuar con la página:', error);
    }
  }

  // 2. Envío a Telegram Bot API con relay opcional y reintentos
  function buildTelegramRelayUrl(relayUrl, target) {
    const base = String(relayUrl || '').trim();
    if (!base) return '';
    if (base.includes('{url}')) return base.replace('{url}', encodeURIComponent(target));
    return base + (base.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(target);
  }

  function telegramErrorMessage(data, status) {
    if (data && data.description) return data.description;
    if (status) return `HTTP ${status}`;
    return 'Error de conexión con Telegram';
  }

  async function telegramRequestDetailed(method, params = null, options = {}) {
    const cfg = getTgConfig();
    if (!cfg.token) {
      lastTelegramError = 'Falta el Bot Token de Telegram.';
      return { ok: false, path: null, error: lastTelegramError };
    }
    const query = params ? `?${new URLSearchParams(params).toString()}` : '';
    const target = `https://api.telegram.org/bot${String(cfg.token).trim()}/${method}${query}`;
    const allowNoCors = options.allowNoCors === true;
    const attempts = [];

    if (cfg.relayUrl) {
      const relayUrl = buildTelegramRelayUrl(cfg.relayUrl, target);
      if (relayUrl) {
        attempts.push({
          name: 'relay',
          run: async () => {
            const response = await fetchWithTimeout(relayUrl, {
              cache: 'no-store',
              credentials: 'omit'
            }, 20000);
            const text = await response.text();
            let data = null;
            try { data = JSON.parse(text); } catch (error) {}
            return { response, data };
          }
        });
      }
    }

    if (!allowNoCors) {
      attempts.push({
        name: 'directo',
        run: async () => {
          const response = await fetchWithTimeout(target, {
            cache: 'no-store',
            credentials: 'omit'
          }, 8000);
          const text = await response.text();
          let data = null;
          try { data = JSON.parse(text); } catch (error) {}
          return { response, data };
        }
      });
    }

    if (LOCAL_PROXY_ENABLED) {
      attempts.push({
        name: 'proxy local',
        run: async () => {
          const response = await fetchWithTimeout(`/proxy?url=${encodeURIComponent(target)}`, {
            cache: 'no-store',
            credentials: 'omit'
          }, 8000);
          const text = await response.text();
          let data = null;
          try { data = JSON.parse(text); } catch (error) {}
          return { response, data };
        }
      });
    }

    attempts.push({
      name: 'allorigins',
      run: async () => {
        const response = await fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`, {
          cache: 'no-store',
          credentials: 'omit'
        }, 10000);
        const text = await response.text();
        let data = null;
        try { data = JSON.parse(text); } catch (error) {}
        return { response, data };
      }
    });

    if (allowNoCors) {
      attempts.push({
        name: 'directo sin CORS',
        run: async () => {
          const response = await fetchWithTimeout(target, {
            mode: 'no-cors',
            cache: 'no-store',
            credentials: 'omit'
          }, 8000);
          return { response, data: null, opaque: true };
        }
      });
    }

    let lastError = 'No se pudo contactar con Telegram.';
    for (const attempt of attempts) {
      try {
        const result = await attempt.run();
        if (result.opaque) {
          lastTelegramError = '';
          lastTelegramResult = { ok: true, confirmed: false, path: attempt.name, status: 0 };
          return lastTelegramResult;
        }
        const { response, data } = result;
        if (response.ok && data && data.ok) {
          lastTelegramError = '';
          lastTelegramResult = {
            ok: true,
            confirmed: true,
            path: attempt.name,
            status: response.status,
            data
          };
          return lastTelegramResult;
        }
        lastError = telegramErrorMessage(data, response.status);
        if (data && data.error_code && [400, 401, 403, 404].includes(Number(data.error_code))) {
          lastTelegramError = lastError;
          lastTelegramResult = {
            ok: false,
            confirmed: true,
            path: attempt.name,
            status: response.status,
            error: lastError,
            data
          };
          return lastTelegramResult;
        }
      } catch (error) {
        lastError = `${error && error.name ? error.name : 'Error'} (${attempt.name})`;
      }
    }
    lastTelegramError = lastError;
    lastTelegramResult = { ok: false, confirmed: false, path: null, error: lastError };
    return lastTelegramResult;
  }

  async function sendTelegramNotification(messageText) {
    const cfg = getTgConfig();
    if (!cfg.token || !cfg.chatId) {
      lastTelegramError = 'Falta el Bot Token o el Chat ID.';
      return false;
    }
    const result = await telegramRequestDetailed('sendMessage', {
      chat_id: String(cfg.chatId).trim(),
      text: messageText,
      parse_mode: 'HTML',
      disable_web_page_preview: 'true'
    }, { allowNoCors: true });
    return result.ok;
  }

  async function testTelegramConnection() {
    const cfg = getTgConfig();
    if (!cfg.token) {
      lastTelegramError = 'Falta el Bot Token.';
      return { ok: false, error: lastTelegramError };
    }
    const result = await telegramRequestDetailed('getMe', null, { allowNoCors: false });
    if (result.ok && result.data && result.data.result) {
      return {
        ok: true,
        username: result.data.result.username || result.data.result.first_name || 'bot',
        path: result.path
      };
    }
    return { ok: false, error: lastTelegramError };
  }

  // 3. Banner Visual de Alerta Disparada en Pantalla
  function showVisualAlertToast(alertObj, livePrice) {
    let toastBox = document.getElementById('live-alert-toast-container');
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.id = 'live-alert-toast-container';
      toastBox.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;display:flex;flex-direction:column;gap:10px;max-width:360px;font-family:sans-serif;';
      document.body.appendChild(toastBox);
    }

    const item = document.createElement('div');
    item.style.cssText = 'background:#064e3b;border:2px solid #10b981;color:#fff;padding:14px;border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,0.9);';
    item.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <strong style="color:#10b981;font-size:13px;">🚨 ¡ALERTA DISPARADA! (${escapeHtml(alertObj.asset)})</strong>
        <button type="button" data-close-toast="1" style="background:transparent;color:#9ca3af;border:none;cursor:pointer;font-weight:bold;">✕</button>
      </div>
      <div style="font-size:12px;color:#f3f4f6;margin-bottom:4px;">
        Condición: <strong>${escapeHtml(alertObj.conditionLabel)}</strong>
      </div>
      <div style="font-size:13px;font-weight:bold;color:#facc15;">
        Precio / Valor Actual: $${escapeHtml(livePrice)}
      </div>
      <div style="font-size:11px;color:#a7f3d0;margin-top:4px;">📌 ${escapeHtml(alertObj.note || 'Enviado a Telegram y notificado en PC')}</div>
    `;
    const closeButton = item.querySelector('[data-close-toast]');
    if (closeButton) closeButton.onclick = () => item.remove();
    toastBox.appendChild(item);

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`🚨 Alerta Cripto: ${alertObj.asset}`, {
        body: `${alertObj.conditionLabel} | Actual: ${livePrice} | ${alertObj.note || ''}`
      });
    }
  }

  // 4. Botón Flotante en el Dashboard
  const openBtn = document.createElement('button');
  openBtn.id = 'btn-open-alerts-hub';
  openBtn.type = 'button';
  openBtn.style.cssText = 'position:fixed;bottom:15px;right:295px;z-index:999998;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;font-weight:bold;border:1px solid #60a5fa;padding:10px 15px;border-radius:8px;font-family:sans-serif;font-size:13px;cursor:pointer;box-shadow:0 6px 20px rgba(37,99,235,0.45);display:flex;align-items:center;gap:7px;';
  openBtn.innerHTML = '🔔 Alertas & Telegram (<span id="active-alerts-count">0</span>)';
  document.body.appendChild(openBtn);

  const style = document.createElement('style');
  style.id = 'universal-alerts-styles';
  style.textContent = `
    @media (max-width: 760px) {
      #btn-open-alerts-hub { right: 12px !important; bottom: 70px !important; font-size: 11px !important; padding: 8px 11px !important; }
      #universal-alerts-modal { width: 96% !important; padding: 14px !important; max-height: 94vh !important; }
      #live-alert-toast-container { left: 12px !important; right: 12px !important; max-width: none !important; }
    }
  `;
  document.head.appendChild(style);

  // 5. Ventana Modal de la Central de Alertas + Backup
  const modal = document.createElement('div');
  modal.id = 'universal-alerts-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Central universal de alertas, Telegram y backup');
  modal.style.cssText = 'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:999999;background:#0b0e14;border:2px solid #3b82f6;border-radius:12px;width:95%;max-width:920px;color:#f3f4f6;font-family:sans-serif;box-shadow:0 25px 60px rgba(0,0,0,0.95);padding:20px;max-height:92vh;overflow-y:auto;';

  const savedTg = getTgConfig();

  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1f2937;padding-bottom:12px;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
      <div>
        <h3 style="margin:0;color:#60a5fa;font-size:17px;">🔔 Central Universal de Alertas en Vivo + Bot de Telegram + Backup</h3>
        <span style="font-size:11px;color:#9ca3af;">Soporta cualquier activo de Binance (Spot/Futuros) y cualquier contrato/token DEX (vía DEX Screener)</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="btn-export-full-backup" title="Incluye claves API y token de Telegram. Guárdalo en un lugar seguro." style="background:#065f46;color:#fff;border:1px solid #10b981;padding:6px 11px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:bold;">💾 Exportar Backup Total (.JSON)</button>
        <button id="btn-import-full-backup" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:6px 11px;border-radius:6px;cursor:pointer;font-size:11px;">📂 Restaurar Backup</button>
        <input id="input-file-backup" type="file" accept=".json" style="display:none;" />
        <button id="close-alerts-modal" style="background:#1f2937;color:#9ca3af;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:bold;">✕ Cerrar</button>
      </div>
    </div>

    <div style="background:#151924;border:1px solid #1f2937;border-radius:8px;padding:12px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
        <span style="font-size:12px;font-weight:bold;color:#38bdf8;">✈️ Conexión Directa a tu Bot de Telegram (Opcional - Envía alertas al móvil)</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button id="btn-test-sound" style="background:#1f2937;color:#facc15;border:1px solid #374151;padding:4px 10px;border-radius:5px;font-size:11px;cursor:pointer;">🔊 Probar Alarma PC</button>
          <button id="btn-test-tg-connection" style="background:#0f766e;color:#fff;border:none;padding:4px 10px;border-radius:5px;font-size:11px;font-weight:bold;cursor:pointer;">🔌 Probar conexión</button>
          <button id="btn-test-tg" style="background:#2563eb;color:#fff;border:none;padding:4px 10px;border-radius:5px;font-size:11px;font-weight:bold;cursor:pointer;">📲 Guardar y Enviar Mensaje de Prueba</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;">
        <input id="tg-bot-token" type="password" value="${escapeHtml(savedTg.token || '')}" placeholder="Bot Token de @BotFather (ej: 7123456:AAH...)" style="background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px 10px;border-radius:6px;font-size:12px;" />
        <input id="tg-chat-id" type="text" value="${escapeHtml(savedTg.chatId || '')}" placeholder="Tu Chat ID numérico (ej: 123456789)" style="background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px 10px;border-radius:6px;font-size:12px;" />
        <input id="tg-relay-url" type="text" value="${escapeHtml(savedTg.relayUrl || '')}" placeholder="Relay opcional: https://tu-worker.workers.dev" style="grid-column:1 / -1;background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px 10px;border-radius:6px;font-size:12px;" />
      </div>
      <details style="margin-top:8px;background:#0b0e14;border:1px solid #1f2937;border-radius:6px;padding:8px 10px;font-size:11px;color:#9ca3af;">
        <summary style="cursor:pointer;color:#60a5fa;font-weight:bold;">¿Tu red bloquea Telegram? Cómo crear un relay gratis</summary>
        <div style="margin-top:8px;line-height:1.5;">
          1. Crea un Worker gratuito en Cloudflare.<br />
          2. Pega el código de abajo y publícalo.<br />
          3. Copia su URL <strong>*.workers.dev</strong> y pégala arriba en “Relay opcional”.
        </div>
        <pre style="white-space:pre-wrap;background:#05070b;border:1px solid #1f2937;border-radius:4px;padding:8px;margin-top:6px;font-size:10px;color:#d1d5db;overflow:auto;">export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target || !target.startsWith('https://api.telegram.org/')) {
      return new Response('Bad target', {
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
    const upstream = await fetch(target, { method: request.method });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};</pre>
      </details>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <span id="tg-status" style="font-size:11px;color:#9ca3af;">Conexión sin probar.</span>
        <span style="font-size:10px;color:#9ca3af;">Si tu red bloquea api.telegram.org, usa un relay CORS/Cloudflare Worker. El botón de prueba te dirá el error exacto.</span>
      </div>
    </div>

    <div style="background:#111827;border:1px solid #3b82f6;border-radius:8px;padding:14px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
        <span style="font-size:13px;font-weight:bold;color:#10b981;">➕ Crear Nueva Alerta (Cualquier Ticker o Contrato DEX)</span>
        <button id="btn-import-journal-alerts" style="background:#7c3aed;color:#fff;border:none;padding:5px 12px;border-radius:5px;font-size:11px;font-weight:bold;cursor:pointer;">
          ⚡ Importar Entradas, SL y TP de mi Bitácora ATR
        </button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:10px;">
        <div>
          <label style="font-size:11px;color:#9ca3af;display:block;margin-bottom:3px;">Activo (Ticker o Contrato 0x...)</label>
          <div style="display:flex;gap:4px;">
            <input id="al-asset" type="text" value="SOL" placeholder="Ej: SOL, PEPE, 0x..." style="width:100%;background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px;border-radius:5px;font-size:12px;font-weight:bold;text-transform:uppercase;" />
            <button id="btn-check-live-price" title="Consultar precio actual" style="background:#1f2937;color:#60a5fa;border:1px solid #374151;padding:0 8px;border-radius:5px;cursor:pointer;font-size:11px;">🔍</button>
          </div>
          <span id="al-live-price-hint" style="font-size:10px;color:#10b981;"></span>
        </div>

        <div>
          <label style="font-size:11px;color:#9ca3af;display:block;margin-bottom:3px;">Tipo de Condición</label>
          <select id="al-type" style="width:100%;background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px;border-radius:5px;font-size:12px;font-weight:bold;">
            <option value="PRICE_ABOVE">📈 Precio Sube o Toca >= ($)</option>
            <option value="PRICE_BELOW">📉 Precio Baja o Toca <= ($)</option>
            <option value="TOUCH_EMA20">🎯 Precio Toca EMA 20 (4H/1D)</option>
            <option value="TOUCH_EMA50">🛡️ Precio Toca EMA 50 (4H/1D)</option>
            <option value="RSI_BELOW">🟢 RSI (14) Baja de <= (Sobreventa)</option>
            <option value="RSI_ABOVE">🔴 RSI (14) Sube de >= (Sobrecompra)</option>
          </select>
        </div>

        <div id="box-target-val">
          <label id="lbl-target-val" style="font-size:11px;color:#9ca3af;display:block;margin-bottom:3px;">Precio / Valor Objetivo ($)</label>
          <input id="al-target" type="number" step="any" placeholder="Escribe cualquier precio..." style="width:100%;box-sizing:border-box;background:#0b0e14;border:1px solid #10b981;color:#facc15;padding:7px;border-radius:5px;font-size:13px;font-weight:bold;" />
        </div>

        <div>
          <label style="font-size:11px;color:#9ca3af;display:block;margin-bottom:3px;">Temporalidad (Para EMA/RSI)</label>
          <select id="al-tf" style="width:100%;background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px;border-radius:5px;font-size:12px;">
            <option value="4h" selected>4 Horas (Swing)</option>
            <option value="1d">1 Día (Posicional)</option>
            <option value="1h">1 Hora (Intradía)</option>
            <option value="15m">15 Minutos</option>
          </select>
        </div>
      </div>

      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <input id="al-note" type="text" placeholder="Nota personalizada (ej: Comprar Orden 2 en soporte / Tomar ganancia TP1)..." style="flex:1;min-width:220px;background:#0b0e14;border:1px solid #374151;color:#fff;padding:8px 10px;border-radius:6px;font-size:12px;" />
        <button id="btn-add-alert" style="background:#10b981;color:#000;font-weight:bold;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:12px;">
          🔔 Activar Alerta Ahora
        </button>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
      <span style="font-size:12px;color:#9ca3af;">⚡ El radar verifica precios en Binance y DEX Screener automáticamente cada 15 segundos.</span>
      <button id="btn-scan-alerts-now" style="background:#1f2937;color:#60a5fa;border:1px solid #374151;padding:4px 10px;border-radius:5px;font-size:11px;cursor:pointer;">🔄 Verificar Todas Ahora</button>
    </div>
    <div style="overflow-x:auto;border:1px solid #1f2937;border-radius:8px;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
        <thead>
          <tr style="background:#151924;color:#9ca3af;border-bottom:1px solid #1f2937;">
            <th style="padding:10px;">Activo / Fuente</th>
            <th style="padding:10px;">Condición Programada</th>
            <th style="padding:10px;">Último Valor Leído</th>
            <th style="padding:10px;">Nota / Estrategia</th>
            <th style="padding:10px;">Estado</th>
            <th style="padding:10px;">Acciones</th>
          </tr>
        </thead>
        <tbody id="alerts-table-body"></tbody>
      </table>
    </div>
  `;
  document.body.appendChild(modal);

  // 6. Obtener precio de CUALQUIER activo (Binance Spot/Futuros -> DEX Screener)
  function pickBestDexPair(data) {
    if (!data || !Array.isArray(data.pairs) || !data.pairs.length) return null;
    return data.pairs
      .filter((pair) => pair && Number.isFinite(Number(pair.priceUsd)) && Number(pair.priceUsd) > 0)
      .sort((a, b) => (Number(b.liquidity && b.liquidity.usd) || 0) - (Number(a.liquidity && a.liquidity.usd) || 0))[0] || null;
  }

  function dexPairResult(pair) {
    return {
      price: Number(pair.priceUsd),
      source: `DEX (${pair.chainId || 'on-chain'})`,
      symbol: (pair.baseToken && pair.baseToken.symbol) || 'TOKEN'
    };
  }

  async function fetchUniversalAssetPrice(assetStr) {
    const clean = String(assetStr == null ? '' : assetStr).trim();
    if (!clean) return null;

    if (clean.length > 20) {
      try {
        const data = await alertFetchJson(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(clean)}`);
        const pair = pickBestDexPair(data);
        if (pair) return dexPairResult(pair);
      } catch (error) {
        // Continuar con Binance / búsqueda DEX.
      }
    }

    const sym = sanitizeTickerOrContract(clean).replace(/USDT$/i, '');
    if (sym) {
      try {
        const data = await alertFetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(sym)}USDT`);
        const price = Number(data && data.price);
        if (Number.isFinite(price) && price > 0) {
          return { price, source: 'Binance Spot', symbol: sym };
        }
      } catch (error) {
        // Probar futuros.
      }
      try {
        const data = await alertFetchJson(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(sym)}USDT`);
        const price = Number(data && data.price);
        if (Number.isFinite(price) && price > 0) {
          return { price, source: 'Binance Futures', symbol: sym };
        }
      } catch (error) {
        // Probar DEX.
      }
    }

    try {
      const data = await alertFetchJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(clean)}`);
      const pair = pickBestDexPair(data);
      if (pair) return dexPairResult(pair);
    } catch (error) {
      // Sin resultado.
    }

    return null;
  }

  // 7. Cálculo de EMA y RSI para alertas técnicas
  async function fetchTechnicalIndicatorValue(sym, tf, indicatorType) {
    const cleanSym = sanitizeTickerOrContract(sym).replace(/USDT$/i, '');
    if (!cleanSym) return null;
    const interval = ['4h', '1d', '1h', '15m'].includes(String(tf)) ? String(tf) : '4h';
    const urls = [
      `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(cleanSym)}USDT&interval=${encodeURIComponent(interval)}&limit=100`,
      `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(cleanSym)}USDT&interval=${encodeURIComponent(interval)}&limit=100`
    ];
    let klines = null;
    for (const url of urls) {
      try {
        const data = await alertFetchJson(url);
        if (Array.isArray(data) && data.length >= 50) {
          klines = data;
          break;
        }
      } catch (error) {
        // Probar la siguiente fuente.
      }
    }
    if (!klines) return null;

    const closes = klines.map((k) => Number(k[4])).filter((value) => Number.isFinite(value));
    if (closes.length < 50) return null;
    const lastPrice = closes[closes.length - 1];

    if (indicatorType === 'TOUCH_EMA20' || indicatorType === 'TOUCH_EMA50') {
      const period = indicatorType === 'TOUCH_EMA20' ? 20 : 50;
      const k = 2 / (period + 1);
      let ema = closes.slice(0, period).reduce((total, value) => total + value, 0) / period;
      for (let i = period; i < closes.length; i += 1) {
        ema = (closes[i] * k) + (ema * (1 - k));
      }
      return { price: lastPrice, ema };
    }

    if (indicatorType === 'RSI_BELOW' || indicatorType === 'RSI_ABOVE') {
      let gains = 0;
      let losses = 0;
      for (let i = 1; i <= 14; i += 1) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
      }
      let avgGain = gains / 14;
      let avgLoss = losses / 14;
      for (let i = 15; i < closes.length; i += 1) {
        const diff = closes[i] - closes[i - 1];
        avgGain = ((avgGain * 13) + (diff > 0 ? diff : 0)) / 14;
        avgLoss = ((avgLoss * 13) + (diff < 0 ? -diff : 0)) / 14;
      }
      const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
      return { price: lastPrice, rsi };
    }

    return null;
  }

  // 8. CRUD de alertas en localStorage
  function getAlerts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function saveAlerts(list) {
    try {
      localStorage.setItem(ALERTS_KEY, JSON.stringify(list));
    } catch (error) {
      console.warn('No se pudo guardar la lista de alertas:', error);
    }
    const counter = document.getElementById('active-alerts-count');
    if (counter) counter.innerText = list.filter((alertItem) => alertItem.status === 'ACTIVE').length;
  }

  function renderAlertsTable() {
    const list = getAlerts();
    const counter = document.getElementById('active-alerts-count');
    if (counter) counter.innerText = list.filter((alertItem) => alertItem.status === 'ACTIVE').length;
    const tbody = document.getElementById('alerts-table-body');
    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding:18px;text-align:center;color:#9ca3af;">No tienes alertas activas. Escribe cualquier moneda y el precio al que quieres que te avise arriba.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((alertItem) => {
      const isTriggered = alertItem.status === 'TRIGGERED';
      const alertId = escapeHtml(alertItem.id);
      const telegramBadge = isTriggered
        ? (alertItem.telegramSent
          ? '<span style="display:inline-block;margin-top:3px;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:bold;background:#0f766e;color:#ccfbf1;">📲 Telegram OK</span>'
          : (alertItem.telegramPending
            ? '<span style="display:inline-block;margin-top:3px;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:bold;background:#78350f;color:#fde68a;">⏳ Telegram pendiente</span>'
            : ''))
        : '';
      const telegramError = isTriggered && alertItem.telegramError
        ? `<div style="font-size:9px;color:#fca5a5;margin-top:3px;">${escapeHtml(alertItem.telegramError)}</div>`
        : '';
      return `
        <tr style="border-bottom:1px solid #1f2937;background:${isTriggered ? 'rgba(6,78,59,0.35)' : '#0b0e14'};">
          <td style="padding:10px;">
            <strong style="color:#fff;font-size:13px;">${escapeHtml(alertItem.asset || '—')}</strong>
            <div style="font-size:10px;color:#60a5fa;">${escapeHtml(alertItem.source || 'Auto CEX/DEX')} (${escapeHtml(String(alertItem.tf || '4h').toUpperCase())})</div>
          </td>
          <td style="padding:10px;font-weight:bold;color:#facc15;">${escapeHtml(alertItem.conditionLabel || '—')}</td>
          <td style="padding:10px;color:#d1d5db;">${escapeHtml(alertItem.lastCheckedValue || 'Pendiente...')}</td>
          <td style="padding:10px;color:#9ca3af;font-size:11px;">${escapeHtml(alertItem.note || '-')}</td>
          <td style="padding:10px;">
            <span style="padding:3px 8px;border-radius:4px;font-size:10px;font-weight:bold;background:${isTriggered ? '#10b981' : '#1e3a8a'};color:${isTriggered ? '#000' : '#93c5fd'};">
              ${isTriggered ? `✅ DISPARADA (${escapeHtml(alertItem.triggeredAt || '')})` : '📡 VIGILANDO'}
            </span>
            ${telegramBadge}
            ${telegramError}
          </td>
          <td style="padding:10px;">
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              ${isTriggered ? `<button type="button" data-alert-action="resend" data-alert-id="${alertId}" style="background:#0f766e;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:10px;">📲 Reenviar</button>` : ''}
              ${isTriggered ? `<button type="button" data-alert-action="reactivate" data-alert-id="${alertId}" style="background:#2563eb;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:10px;">🔄 Reactivar</button>` : ''}
              <button type="button" data-alert-action="delete" data-alert-id="${alertId}" style="background:#7f1d1d;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:10px;">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function deleteAlertItem(id) {
    saveAlerts(getAlerts().filter((alertItem) => alertItem.id !== id));
    renderAlertsTable();
  }

  function reactivateAlert(id) {
    const list = getAlerts();
    const item = list.find((alertItem) => alertItem.id === id);
    if (item) item.status = 'ACTIVE';
    saveAlerts(list);
    renderAlertsTable();
  }

  window.deleteAlertItem = deleteAlertItem;
  window.reactivateAlert = reactivateAlert;

  function buildTelegramMessageFromAlert(alertItem) {
    return `🚨 <b>ALERTA ${tgEscape(alertItem.type || '')}</b>\n\n` +
      `🪙 <b>Activo:</b> ${tgEscape(alertItem.asset)}\n` +
      `🎯 <b>Condición:</b> ${tgEscape(alertItem.conditionLabel)}\n` +
      `💵 <b>Último valor:</b> ${tgEscape(alertItem.lastCheckedValue || '—')}\n` +
      `📌 <b>Nota:</b> ${tgEscape(alertItem.note || '')}`;
  }

  function recordTelegramResult(alertItem, message, ok) {
    alertItem.telegramMessage = message;
    alertItem.telegramSent = ok;
    alertItem.telegramPending = !ok;
    alertItem.telegramError = ok ? '' : (lastTelegramError || 'No se pudo enviar a Telegram.');
    if (ok) alertItem.telegramSentAt = new Date().toLocaleTimeString();
  }

  async function resendAlertTelegram(id) {
    const list = getAlerts();
    const alertItem = list.find((item) => item.id === id);
    if (!alertItem) return false;
    const message = alertItem.telegramMessage || buildTelegramMessageFromAlert(alertItem);
    const ok = await sendTelegramNotification(message);
    recordTelegramResult(alertItem, message, ok);
    saveAlerts(list);
    renderAlertsTable();
    showVisualAlertToast({
      asset: alertItem.asset,
      conditionLabel: 'Reenvío a Telegram',
      note: ok
        ? 'Mensaje reenviado correctamente.'
        : `Error: ${lastTelegramError || 'sin conexión con Telegram'}`
    }, alertItem.lastCheckedValue || '—');
    return ok;
  }

  window.resendAlertTelegram = resendAlertTelegram;

  // 9. Motor evaluador en segundo plano
  async function evaluateAllActiveAlerts() {
    if (evaluatingAlerts) return;
    evaluatingAlerts = true;
    try {
      const list = getAlerts();
      const tgConfig = getTgConfig();
      let updated = false;

      if (tgConfig.token && tgConfig.chatId) {
        const now = Date.now();
        const pendingTelegram = list.filter((alertItem) => alertItem.status === 'TRIGGERED'
          && alertItem.telegramPending
          && alertItem.telegramMessage
          && (!alertItem.telegramLastAttempt || now - alertItem.telegramLastAttempt > 60000));
        for (const alertItem of pendingTelegram) {
          alertItem.telegramLastAttempt = now;
          const ok = await sendTelegramNotification(alertItem.telegramMessage);
          if (ok) {
            alertItem.telegramPending = false;
            alertItem.telegramSent = true;
            alertItem.telegramSentAt = new Date().toLocaleTimeString();
            alertItem.telegramError = '';
            updated = true;
          } else {
            alertItem.telegramError = lastTelegramError || 'No se pudo enviar a Telegram.';
          }
        }
      }

      const activeList = list.filter((alertItem) => alertItem.status === 'ACTIVE');
      if (activeList.length === 0) {
        if (updated) saveAlerts(list);
        return;
      }

      for (const alertItem of activeList) {
        if (alertItem.type === 'PRICE_ABOVE' || alertItem.type === 'PRICE_BELOW') {
          const info = await fetchUniversalAssetPrice(alertItem.asset);
          if (!info) continue;

          const decimals = info.price < 1 ? 6 : (info.price < 10 ? 4 : 2);
          alertItem.lastCheckedValue = `$${info.price.toFixed(decimals)}`;
          alertItem.source = info.source;
          updated = true;

          const hitAbove = alertItem.type === 'PRICE_ABOVE' && info.price >= Number(alertItem.target);
          const hitBelow = alertItem.type === 'PRICE_BELOW' && info.price <= Number(alertItem.target);

          if (hitAbove || hitBelow) {
            alertItem.status = 'TRIGGERED';
            alertItem.triggeredAt = new Date().toLocaleTimeString();
            playAlertSound('ALARM');
            showVisualAlertToast(alertItem, info.price.toFixed(decimals));
            const telegramMessage =
              `🚨 <b>ALERTA DE PRECIO ALCANZADA</b>\n\n` +
              `🪙 <b>Activo:</b> ${tgEscape(info.symbol)} (${tgEscape(info.source)})\n` +
              `🎯 <b>Condición:</b> ${tgEscape(alertItem.conditionLabel)}\n` +
              `💵 <b>Precio Actual:</b> $${info.price.toFixed(decimals)}\n` +
              `📌 <b>Nota:</b> ${tgEscape(alertItem.note || 'Revisar gráfico en el Dashboard')}`;
            const telegramOk = await sendTelegramNotification(telegramMessage);
            recordTelegramResult(alertItem, telegramMessage, telegramOk);
          }
        } else {
          const tech = await fetchTechnicalIndicatorValue(alertItem.asset, alertItem.tf, alertItem.type);
          if (!tech) continue;
          const decimals = tech.price < 1 ? 5 : (tech.price < 10 ? 4 : 2);
          alertItem.source = 'Binance Klines';
          updated = true;

          if (alertItem.type === 'TOUCH_EMA20' || alertItem.type === 'TOUCH_EMA50') {
            const distPct = Math.abs(tech.price - tech.ema) / tech.ema * 100;
            alertItem.lastCheckedValue = `Precio: $${tech.price.toFixed(decimals)} | EMA: $${tech.ema.toFixed(decimals)} (${distPct.toFixed(2)}%)`;
            if (distPct <= 0.35) {
              alertItem.status = 'TRIGGERED';
              alertItem.triggeredAt = new Date().toLocaleTimeString();
              playAlertSound('ALARM');
              showVisualAlertToast(alertItem, tech.price.toFixed(decimals));
              const telegramMessage =
                `🎯 <b>TOQUE DE MEDIA MÓVIL (${tgEscape(String(alertItem.tf).toUpperCase())})</b>\n\n` +
                `🪙 <b>Activo:</b> ${tgEscape(alertItem.asset)}\n` +
                `📐 <b>Condición:</b> ${tgEscape(alertItem.conditionLabel)}\n` +
                `💵 <b>Precio Actual:</b> $${tech.price.toFixed(decimals)} (EMA en $${tech.ema.toFixed(decimals)})\n` +
                `📌 <b>Nota:</b> ${tgEscape(alertItem.note || 'Zona de entrada técnica')}`;
              const telegramOk = await sendTelegramNotification(telegramMessage);
              recordTelegramResult(alertItem, telegramMessage, telegramOk);
            }
          } else if (alertItem.type === 'RSI_BELOW' || alertItem.type === 'RSI_ABOVE') {
            alertItem.lastCheckedValue = `RSI: ${tech.rsi.toFixed(1)} ($${tech.price.toFixed(decimals)})`;
            const hitRsiLow = alertItem.type === 'RSI_BELOW' && tech.rsi <= Number(alertItem.target);
            const hitRsiHigh = alertItem.type === 'RSI_ABOVE' && tech.rsi >= Number(alertItem.target);
            if (hitRsiLow || hitRsiHigh) {
              alertItem.status = 'TRIGGERED';
              alertItem.triggeredAt = new Date().toLocaleTimeString();
              playAlertSound('ALARM');
              showVisualAlertToast(alertItem, `RSI ${tech.rsi.toFixed(1)}`);
              const telegramMessage =
                `⚡ <b>ALERTA DE RSI EXTREMO (${tgEscape(String(alertItem.tf).toUpperCase())})</b>\n\n` +
                `🪙 <b>Activo:</b> ${tgEscape(alertItem.asset)}\n` +
                `📊 <b>RSI Actual:</b> ${tech.rsi.toFixed(1)} (Objetivo: ${tgEscape(alertItem.conditionLabel)})\n` +
                `💵 <b>Precio:</b> $${tech.price.toFixed(decimals)}\n` +
                `📌 <b>Nota:</b> ${tgEscape(alertItem.note || '')}`;
              const telegramOk = await sendTelegramNotification(telegramMessage);
              recordTelegramResult(alertItem, telegramMessage, telegramOk);
            }
          }
        }
      }

      if (updated) {
        saveAlerts(list);
        if (modal.style.display === 'block') renderAlertsTable();
      }
    } finally {
      evaluatingAlerts = false;
    }
  }

  // 10. Crear alertas y autocompletar precio actual
  async function checkAndFillCurrentPrice() {
    const assetInput = document.getElementById('al-asset');
    const hint = document.getElementById('al-live-price-hint');
    if (!assetInput || !hint) return;
    const asset = assetInput.value.trim();
    if (!asset) return;
    hint.innerText = 'Consultando precio...';
    const info = await fetchUniversalAssetPrice(asset);
    if (info) {
      const decimals = info.price < 1 ? 6 : (info.price < 10 ? 4 : 2);
      hint.innerText = `Actual: $${info.price.toFixed(decimals)} (${info.source})`;
      const targetInput = document.getElementById('al-target');
      if (targetInput && !targetInput.value) targetInput.value = info.price.toFixed(decimals);
    } else {
      hint.innerText = 'No encontrado. Verifica el ticker o contrato.';
    }
  }

  function addAlertFromForm() {
    if ('Notification' in window && Notification.permission === 'default') {
      const permissionRequest = Notification.requestPermission();
      if (permissionRequest && typeof permissionRequest.catch === 'function') {
        permissionRequest.catch(() => {});
      }
    }

    const assetInput = document.getElementById('al-asset');
    const typeInput = document.getElementById('al-type');
    const targetInput = document.getElementById('al-target');
    const tfInput = document.getElementById('al-tf');
    const noteInput = document.getElementById('al-note');
    if (!assetInput || !typeInput || !targetInput || !tfInput || !noteInput) return null;

    const asset = sanitizeTickerOrContract(assetInput.value);
    const type = typeInput.value;
    const target = parseFloat(targetInput.value) || 0;
    const tf = tfInput.value;
    const note = noteInput.value.trim();

    if (!asset) {
      window.alert('Escribe un ticker o contrato válido.');
      return null;
    }
    if ((type === 'PRICE_ABOVE' || type === 'PRICE_BELOW' || type.startsWith('RSI')) && target <= 0) {
      window.alert('Escribe el precio o nivel objetivo para la alerta.');
      return null;
    }

    const labelsMap = {
      PRICE_ABOVE: `Precio >= $${target}`,
      PRICE_BELOW: `Precio <= $${target}`,
      TOUCH_EMA20: `Toque de EMA 20 (${tf.toUpperCase()})`,
      TOUCH_EMA50: `Toque de EMA 50 (${tf.toUpperCase()})`,
      RSI_BELOW: `RSI(14) <= ${target} (${tf.toUpperCase()})`,
      RSI_ABOVE: `RSI(14) >= ${target} (${tf.toUpperCase()})`
    };

    const list = getAlerts();
    const newAlert = {
      id: 'AL_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      asset,
      type,
      target,
      tf,
      conditionLabel: labelsMap[type] || type,
      note,
      status: 'ACTIVE',
      lastCheckedValue: 'Verificando...',
      createdAt: new Date().toISOString()
    };
    list.unshift(newAlert);

    saveAlerts(list);
    noteInput.value = '';
    renderAlertsTable();
    evaluateAllActiveAlerts();
    return newAlert;
  }

  document.getElementById('btn-check-live-price').onclick = checkAndFillCurrentPrice;
  document.getElementById('al-asset').addEventListener('blur', checkAndFillCurrentPrice);

  document.getElementById('al-type').onchange = (event) => {
    const val = event.target.value;
    const box = document.getElementById('box-target-val');
    const label = document.getElementById('lbl-target-val');
    const input = document.getElementById('al-target');
    if (!box || !label || !input) return;
    if (val === 'TOUCH_EMA20' || val === 'TOUCH_EMA50') {
      box.style.opacity = '0.4';
      input.disabled = true;
      input.value = '';
      label.innerText = 'Automático (Cruce EMA)';
    } else if (val === 'RSI_BELOW' || val === 'RSI_ABOVE') {
      box.style.opacity = '1';
      input.disabled = false;
      input.value = val === 'RSI_BELOW' ? '30' : '70';
      label.innerText = 'Nivel de RSI (14)';
    } else {
      box.style.opacity = '1';
      input.disabled = false;
      label.innerText = 'Precio Objetivo Exacto ($)';
      checkAndFillCurrentPrice();
    }
  };

  document.getElementById('btn-add-alert').onclick = addAlertFromForm;

  document.getElementById('btn-import-journal-alerts').onclick = () => {
    const journal = getJournalTrades();
    const openTrades = journal.filter((trade) => trade && trade.status === 'OPEN'
      && Number.isFinite(Number(trade.takeProfit))
      && Number.isFinite(Number(trade.stopLoss)));
    if (openTrades.length === 0) {
      window.alert('No tienes operaciones abiertas en tu Bitácora ATR para importar.');
      return;
    }

    const list = getAlerts();
    const existingSignatures = new Set(list.map((alertItem) => alertItem.signature).filter(Boolean));
    let imported = 0;

    openTrades.forEach((trade) => {
      const asset = sanitizeTickerOrContract(trade.symbol);
      if (!asset) return;
      const isLong = String(trade.side || '').toUpperCase() === 'LONG';
      const tf = String(trade.timeframe || '4h').toLowerCase();
      const leverage = Number(trade.leverage) || 1;
      const timestamp = Date.now() + Math.random().toString(36).slice(2, 6);

      const tpSignature = `ATR|${asset}|TP|${trade.takeProfit}|${tf}|${trade.id || ''}`;
      if (!existingSignatures.has(tpSignature)) {
        list.unshift({
          id: 'AL_TP_' + timestamp,
          asset,
          type: isLong ? 'PRICE_ABOVE' : 'PRICE_BELOW',
          target: Number(trade.takeProfit),
          tf,
          conditionLabel: `Take Profit ${isLong ? '>=' : '<='} $${trade.takeProfit}`,
          note: `🎯 TP Bitácora (${isLong ? 'LONG' : 'SHORT'} ${leverage}x)`,
          status: 'ACTIVE',
          lastCheckedValue: 'Importado',
          signature: tpSignature
        });
        existingSignatures.add(tpSignature);
        imported += 1;
      }

      const slSignature = `ATR|${asset}|SL|${trade.stopLoss}|${tf}|${trade.id || ''}`;
      if (!existingSignatures.has(slSignature)) {
        list.unshift({
          id: 'AL_SL_' + timestamp,
          asset,
          type: isLong ? 'PRICE_BELOW' : 'PRICE_ABOVE',
          target: Number(trade.stopLoss),
          tf,
          conditionLabel: `Stop Loss ${isLong ? '<=' : '>='} $${trade.stopLoss}`,
          note: `🛑 SL Bitácora (${isLong ? 'LONG' : 'SHORT'} ${leverage}x)`,
          status: 'ACTIVE',
          lastCheckedValue: 'Importado',
          signature: slSignature
        });
        existingSignatures.add(slSignature);
        imported += 1;
      }
    });

    if (imported === 0) {
      window.alert('Las órdenes abiertas de tu Bitácora ya tienen alertas activas importadas.');
      return;
    }

    saveAlerts(list);
    renderAlertsTable();
    evaluateAllActiveAlerts();
  };

  // 11. Telegram, sonido y backup total
  document.getElementById('btn-test-sound').onclick = () => playAlertSound('ALARM');

  function saveTelegramConfigFromForm() {
    const tokenInput = document.getElementById('tg-bot-token');
    const chatInput = document.getElementById('tg-chat-id');
    const relayInput = document.getElementById('tg-relay-url');
    if (!tokenInput || !chatInput) return null;
    const config = {
      token: tokenInput.value.trim(),
      chatId: chatInput.value.trim(),
      relayUrl: relayInput ? relayInput.value.trim() : ''
    };
    localStorage.setItem(TG_CONFIG_KEY, JSON.stringify(config));
    return config;
  }

  function updateTgStatus(text, color) {
    const status = document.getElementById('tg-status');
    if (!status) return;
    status.innerText = text;
    status.style.color = color;
  }

  document.getElementById('btn-test-tg-connection').onclick = async () => {
    saveTelegramConfigFromForm();
    updateTgStatus('Probando conexión con Telegram...', '#9ca3af');
    const result = await testTelegramConnection();
    if (result.ok) {
      updateTgStatus(`✅ Conectado como @${result.username} (${result.path})`, '#10b981');
    } else {
      updateTgStatus(`⚠️ ${result.error || lastTelegramError || 'No se pudo conectar.'}`, '#ef4444');
    }
  };

  document.getElementById('btn-test-tg').onclick = async () => {
    saveTelegramConfigFromForm();
    updateTgStatus('Enviando mensaje de prueba...', '#9ca3af');
    const ok = await sendTelegramNotification('✅ <b>Crypto Intelligence Dashboard Conectado</b>\nTu central de alertas en vivo está enviando notificaciones correctamente.');
    if (ok) {
      const confirmed = lastTelegramResult && lastTelegramResult.confirmed;
      updateTgStatus(confirmed ? '✅ Mensaje de prueba enviado y confirmado.' : '✅ Mensaje enviado (sin confirmación de Telegram).', '#10b981');
      window.alert(confirmed ? '✅ ¡Mensaje enviado a tu Telegram con éxito!' : '✅ Mensaje enviado. Revisa tu Telegram; el navegador no pudo leer la confirmación por CORS.');
    } else {
      updateTgStatus(`⚠️ ${lastTelegramError || 'No se pudo enviar.'}`, '#ef4444');
      window.alert(`⚠️ No se pudo enviar: ${lastTelegramError || 'Error de conexión con Telegram.'}\n\nSi tu red bloquea api.telegram.org, configura un relay o activa una VPN.`);
    }
  };

  document.getElementById('btn-export-full-backup').onclick = () => {
    const backupObj = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      backupObj[key] = localStorage.getItem(key);
    }
    const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `Backup_Crypto_Dashboard_${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  };

  document.getElementById('btn-import-full-backup').onclick = () => {
    document.getElementById('input-file-backup').click();
  };

  document.getElementById('input-file-backup').onchange = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      try {
        const data = JSON.parse(readerEvent.target.result);
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('Formato inválido');
        }
        Object.keys(data).forEach((key) => {
          if (typeof data[key] === 'string') localStorage.setItem(key, data[key]);
        });
        window.alert('✅ Backup restaurado al 100%. La página se recargará ahora.');
        window.location.reload();
      } catch (error) {
        window.alert('Error al leer el archivo JSON de backup.');
      }
    };
    reader.readAsText(file);
  };

  // 12. Eventos de apertura y cierre
  openBtn.onclick = () => {
    const isHidden = modal.style.display === 'none';
    modal.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      renderAlertsTable();
      checkAndFillCurrentPrice();
    }
  };
  document.getElementById('close-alerts-modal').onclick = () => {
    modal.style.display = 'none';
  };
  document.getElementById('btn-scan-alerts-now').onclick = evaluateAllActiveAlerts;

  document.getElementById('alerts-table-body').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-alert-action]');
    if (!button) return;
    const action = button.getAttribute('data-alert-action');
    const id = button.getAttribute('data-alert-id');
    if (!id) return;
    if (action === 'delete') deleteAlertItem(id);
    else if (action === 'reactivate') reactivateAlert(id);
    else if (action === 'resend') resendAlertTelegram(id);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.style.display === 'block') {
      modal.style.display = 'none';
    }
  });

  // API pública mínima para pruebas y automatización local
  window.universalAlerts = {
    getAlerts,
    saveAlerts,
    renderAlertsTable,
    evaluateAllActiveAlerts,
    fetchUniversalAssetPrice,
    fetchTechnicalIndicatorValue,
    sendTelegramNotification,
    testTelegramConnection,
    telegramRequestDetailed,
    resendAlertTelegram,
    getLastTelegramError: () => lastTelegramError,
    getLastTelegramResult: () => lastTelegramResult,
    addAlert: addAlertFromForm,
    deleteAlert: deleteAlertItem,
    reactivateAlert
  };

  // 13. Contador inicial y radar automático cada 15 segundos
  renderAlertsTable();
  window.__universalAlertsInterval = window.setInterval(() => {
    evaluateAllActiveAlerts();
  }, CHECK_INTERVAL_MS);
})();
