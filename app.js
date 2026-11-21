/* ============================================================
   Crypto Intelligence, Futures & Airdrop Dashboard V2.0
   FASE 2 - Parte 1 + FASE 3 - Parte 2 + FASE 4 - Parte 3
   Motor core, conexiones, mercado, futuros, matriz 4H/1D,
   buscador híbrido CEX/DEX, wallet tracker multi-chain,
   cazador de airdrops DefiLlama, gestor anti-Sybil y directorio
   maestro de 26 fuentes primarias.
   Sin valores aleatorios: solo APIs, formulas reales y localStorage.
   ============================================================ */

(() => {
  'use strict';

  const APP_VERSION = '2.0.0-phase4';
  const STORAGE_PREFIX = 'cryptoIntel.v2';
  const STORAGE_KEYS = {
    apiKeys: `${STORAGE_PREFIX}.apiKeys`,
    proxy: `${STORAGE_PREFIX}.corsProxy`,
    sessions: `${STORAGE_PREFIX}.sessions`,
    sessionsHistory: `${STORAGE_PREFIX}.sessionsHistory`,
    macro: `${STORAGE_PREFIX}.macro`,
    macroAuto: `${STORAGE_PREFIX}.macroAuto`,
    selectedSymbol: `${STORAGE_PREFIX}.selectedSymbol`,
    cbbiCache: `${STORAGE_PREFIX}.cbbiCache`,
    fearGreedCache: `${STORAGE_PREFIX}.fearGreedCache`,
    wallets: `${STORAGE_PREFIX}.wallets`,
    walletTokenSnapshots: `${STORAGE_PREFIX}.walletTokenSnapshots`,
    walletWhaleAlerts: `${STORAGE_PREFIX}.walletWhaleAlerts`,
    airdropFarmingTasks: 'airdrop_farming_tasks'
  };

  const DEFAULT_PROXY = 'https://corsproxy.io/?';
  const ALLORIGINS_PROXY = 'https://api.allorigins.win/raw?url=';
  const CORSPROXY_PROXY = 'https://corsproxy.io/?';
  const LOCAL_PROXY = '/proxy?url=';
  // El proxy local solo existe cuando sirve server.py. En un host estatico
  // (GitHub Pages, Netlify...) no se intenta para no generar 404 inutiles.
  const DASHBOARD_PORT = '4173';
  const IS_LOCAL_NETWORK_HOST = (() => {
    const host = String(location.hostname || '');
    if (location.port === DASHBOARD_PORT) return true;
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(host)) return true;
    return /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  })();

  function localProxyAttempt(url) {
    return IS_LOCAL_NETWORK_HOST ? `${LOCAL_PROXY}${encodeURIComponent(url)}` : null;
  }

  // app.js se divide en varios IIFEs: los modulos posteriores (ATR journal,
  // estudio TCS, backtester) no ven este scope, asi que se expone en window.
  window.QuantLocalProxy = localProxyAttempt;

  // CoinGecko bloquea por CORS el origen de GitHub Pages aunque anuncie "*"
  // en la respuesta. En host estatico se prueba primero el proxy CORS publico
  // para no dejar errores en consola ni esperar al fallo directo.
  const CORS_BLOCKED_DIRECT_HOSTS = ['api.coingecko.com'];

  function prefersCorsProxyFirst(url) {
    if (IS_LOCAL_NETWORK_HOST) return false;
    const target = String(url || '');
    return CORS_BLOCKED_DIRECT_HOSTS.some((host) => target.includes(host));
  }
  const CBBI_URL = 'https://colintalkscrypto.com/cbbi/data/latest.json';
  const DUNE_QUERY_ID = 3265994;
  const SESSION_STALE_MS = 7 * 24 * 60 * 60 * 1000;
  const FUTURES_SYMBOLS = ['BTC', 'ETH', 'SOL', 'SUI', 'XRP', 'BNB'];
  const BITGET_POSITION_SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'XRP']);

  const API_PROVIDERS = ['fred', 'dune', 'coinalyze', 'livecoinwatch', 'coinmarketcap', 'cryptorank', 'coingecko'];
  const SESSION_PROVIDERS = [
    'glassnode', 'cryptoquant', 'chainexposed', 'tokenterminal',
    'artemis', 'fundingview', 'dropstab', 'gmgn', 'coinglass'
  ];
  const EXTERNAL_LOGIN_SYNC_KEY = 'external_login_sync_data';
  const EXTERNAL_LOGIN_PROVIDERS = [
    'cryptoquant', 'glassnode', 'chainexposed', 'tokenterminal',
    'artemis', 'fundingview', 'dropstab', 'gmgn'
  ];

  const PROVIDER_LABELS = {
    fred: 'FRED St. Louis',
    dune: 'Dune Analytics',
    coinalyze: 'Coinalyze',
    livecoinwatch: 'LiveCoinWatch',
    coinmarketcap: 'CoinMarketCap',
    cryptorank: 'CryptoRank',
    coingecko: 'CoinGecko'
  };

  const SESSION_LABELS = {
    glassnode: 'Glassnode Studio',
    cryptoquant: 'CryptoQuant',
    chainexposed: 'ChainExposed',
    tokenterminal: 'Token Terminal',
    artemis: 'Artemis',
    fundingview: 'FundingView',
    dropstab: 'DropsTab',
    gmgn: 'GMGN.ai',
    coinglass: 'Coinglass Pro'
  };

  const METRIC_LABELS = {
    'exchange-reserve': 'Reservas en exchanges',
    'supply-profit': 'Supply in Profit',
    'macro-liquidity': 'M2 / Liquidez FED',
    'oi-funding': 'OI / Funding global',
    'sector-flow': 'Flujo sectorial',
    'pf-ratio': 'P/F ratio',
    'airdrop-state': 'Estado de airdrop',
    'smart-money': 'Smart Money / Flujo DEX'
  };

  const PLATFORM_DEFAULT_METRIC = {
    glassnode: 'supply-profit',
    cryptoquant: 'exchange-reserve',
    chainexposed: 'supply-profit',
    tokenterminal: 'pf-ratio',
    artemis: 'sector-flow',
    fundingview: 'oi-funding',
    dropstab: 'airdrop-state',
    gmgn: 'smart-money',
    coinglass: 'oi-funding'
  };

  const METRIC_TO_MACRO = {
    'exchange-reserve': 'exchange-reserve',
    'supply-profit': 'supply-profit',
    'macro-liquidity': 'fed-balance',
    'oi-funding': 'fundingview',
    'sector-flow': 'btc-treasuries',
    'pf-ratio': 'dune-signal',
    'airdrop-state': 'toomanycooks'
  };

  const PLATFORM_TO_MACRO = {
    glassnode: 'glassnode',
    cryptoquant: 'exchange-reserve',
    chainexposed: 'supply-profit',
    tokenterminal: 'dune-signal',
    artemis: 'btc-treasuries',
    fundingview: 'fundingview',
    dropstab: 'toomanycooks',
    coinglass: 'fundingview'
  };

  const SOURCE_PROVIDER_MAP = [
    { match: 'fred.stlouisfed.org', type: 'key', provider: 'fred' },
    { match: 'dune.com', type: 'key', provider: 'dune' },
    { match: 'coinalyze.net', type: 'key', provider: 'coinalyze' },
    { match: 'livecoinwatch.com', type: 'key', provider: 'livecoinwatch' },
    { match: 'coinmarketcap.com', type: 'key', provider: 'coinmarketcap' },
    { match: 'cryptorank.io', type: 'key', provider: 'cryptorank' },
    { match: 'studio.glassnode.com', type: 'session', provider: 'glassnode' },
    { match: 'cryptoquant.com', type: 'session', provider: 'cryptoquant' },
    { match: 'chainexposed.com', type: 'session', provider: 'chainexposed' },
    { match: 'tokenterminal.com', type: 'session', provider: 'tokenterminal' },
    { match: 'artemis.xyz', type: 'session', provider: 'artemis' },
    { match: 'artemis.ai', type: 'session', provider: 'artemis' },
    { match: 'fundingview.app', type: 'session', provider: 'fundingview' },
    { match: 'dropstab.com', type: 'session', provider: 'dropstab' },
    { match: 'gmgn.ai', type: 'session', provider: 'gmgn' },
    { match: 'coinglass.com', type: 'session', provider: 'coinglass' }
  ];

  const STABLECOINS = new Set([
    'USDT', 'USDC', 'BUSD', 'TUSD', 'USDP', 'USDD', 'FDUSD', 'DAI', 'FRAX',
    'LUSD', 'PYUSD', 'EURC', 'EURT', 'UST', 'USTC', 'GUSD', 'USDE', 'USDS',
    'USD1', 'RLUSD', 'USDG', 'USDT0'
  ]);

  // Binance sigue devolviendo en /ticker/24hr los pares con la negociacion
  // detenida (status BREAK) con el ultimo snapshot congelado. Sin este limite
  // esos pares zombi ocupan siempre el top de ganadores/perdedores.
  const MAX_TICKER_AGE_MS = 60 * 60 * 1000;

  const state = {
    apiKeys: loadJSON(STORAGE_KEYS.apiKeys, {}),
    proxy: loadText(STORAGE_KEYS.proxy, DEFAULT_PROXY) || DEFAULT_PROXY,
    sessions: loadJSON(STORAGE_KEYS.sessions, {}),
    macro: loadJSON(STORAGE_KEYS.macro, {}),
    macroAuto: loadJSON(STORAGE_KEYS.macroAuto, {}),
    selectedSymbol: loadText(STORAGE_KEYS.selectedSymbol, 'BTC') || 'BTC',
    market: null,
    futures: {},
    klines: { '4h': null, '1d': null },
    decisions: { '4h': null, '1d': null },
    lastMacroScore: null,
    lastMacroCount: 0,
    isRefreshing: false,
    isDecisionLoading: false,
    pendingDecisionReload: false,
    focusBeforeModal: null,
    fundingTimer: null,
    initialized: false
  };

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    initNavigation();
    initConnections();
    initApiKeys();
    initSessions();
    initMacro();
    initDecisionControls();
    initRefreshButtons();
    initInstitutionalSessionClock();
    initDeltaNeutralTable();
    renderSessions();
    updateConnectionBadges();
    updateMacroSummary();
    loadSelectedSymbol();
    startFundingCountdown();
    refreshIcons();
    refreshMarketData({ silent: true });
    refreshOptionalApiData();

    window.CryptoIntel = Object.freeze({
      version: APP_VERSION,
      refreshMarket: () => refreshMarketData({ silent: false }),
      refreshConnections: () => refreshOptionalApiData(),
      recalcDecisions: () => loadDecisionEngine(),
      calculateEMA,
      calculateRSI,
      calculateATR,
      getSnapshot: () => ({
        selectedSymbol: state.selectedSymbol,
        macroScore: state.lastMacroScore,
        macroCount: state.lastMacroCount,
        futures: state.futures,
        decisions: state.decisions,
        updatedAt: Date.now()
      })
    });
  }

  /* ------------------------------------------------------------
     Navegacion, sidebar y modal de conexiones
     ------------------------------------------------------------ */

  function initNavigation() {
    $$('[data-panel-target]').forEach((link) => {
      link.addEventListener('click', (event) => {
        const target = link.dataset.panelTarget;
        if (!target) return;
        event.preventDefault();
        navigateTo(target);
      });
    });

    window.addEventListener('hashchange', syncNavigation);
    syncNavigation();

    const sidebar = byId('app-sidebar');
    const toggle = byId('sidebar-toggle');
    const scrim = byId('sidebar-scrim');

    if (toggle && sidebar) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        const isOpen = !sidebar.classList.contains('is-open');
        sidebar.classList.toggle('is-open', isOpen);
        if (scrim) scrim.classList.toggle('is-open', isOpen);
        toggle.setAttribute('aria-expanded', String(isOpen));
      });
    }

    if (scrim) scrim.addEventListener('click', closeSidebar);

    document.addEventListener('click', (event) => {
      if (window.innerWidth > 1024) return;
      if (!sidebar || !sidebar.classList.contains('is-open')) return;
      if (sidebar.contains(event.target)) return;
      if (toggle && (event.target === toggle || toggle.contains(event.target))) return;
      closeSidebar();
    });

    $$('[data-scroll-to]').forEach((button) => {
      button.addEventListener('click', () => scrollToId(button.dataset.scrollTo));
    });
  }

  function navigateTo(panelId) {
    if (!panelId) return;
    closeSidebar();
    if (window.location.hash === `#${panelId}`) {
      syncNavigation();
      return;
    }
    window.location.hash = panelId;
  }

  function syncNavigation() {
    const hash = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : '';
    const hashElement = hash ? byId(hash) : null;
    const panels = $$('.view-panel');
    let active = null;

    if (hashElement) {
      active = hashElement.classList.contains('view-panel')
        ? hashElement
        : hashElement.closest('.view-panel');
    }
    if (!active) active = byId('panel-market') || panels[0];
    if (!active) return;

    panels.forEach((panel) => panel.classList.toggle('is-active', panel === active));
    $$('.nav-link, .mobile-nav a').forEach((link) => {
      const isActive = link.dataset.panelTarget === active.id;
      link.classList.toggle('is-active', isActive);
      if (isActive) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.body.dataset.activePanel = active.dataset.panel || active.id;
  }

  function closeSidebar() {
    const sidebar = byId('app-sidebar');
    const toggle = byId('sidebar-toggle');
    const scrim = byId('sidebar-scrim');
    if (sidebar) sidebar.classList.remove('is-open');
    if (scrim) scrim.classList.remove('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function scrollToId(id) {
    const target = byId(id);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function initConnections() {
    const toggle = byId('connections-toggle');
    const modal = byId('connections-modal');

    $$('label[for="connections-toggle"]').forEach((label) => {
      label.addEventListener('click', (event) => {
        if (label.dataset.connectionTab) {
          event.preventDefault();
          openConnections(label.dataset.connectionTab);
        }
      });
      if (label.getAttribute('role') === 'button') {
        label.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            label.click();
          }
        });
      }
    });

    $$('.connections-trigger').forEach((trigger) => {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.addEventListener('click', () => {
        window.setTimeout(() => activateConnectionTab('public'), 0);
      });
    });

    if (toggle) {
      toggle.addEventListener('change', () => {
        const isOpen = toggle.checked;
        $$('.connections-trigger').forEach((trigger) => trigger.setAttribute('aria-expanded', String(isOpen)));
        if (isOpen) {
          state.focusBeforeModal = document.activeElement;
          window.setTimeout(() => {
            const activeInput = $('.conn-tab-input:checked');
            const activeLabel = activeInput ? $(`label[for="${activeInput.id}"]`) : null;
            if (activeLabel) activeLabel.focus();
          }, 40);
        } else if (state.focusBeforeModal && typeof state.focusBeforeModal.focus === 'function') {
          state.focusBeforeModal.focus();
          state.focusBeforeModal = null;
        }
      });
    }

    if (modal) {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) closeConnections();
      });
    }

    $$('.conn-tab').forEach((label) => {
      const input = byId(label.getAttribute('for'));
      if (!input) return;
      const panelName = input.id.replace('conn-tab-', '');
      label.setAttribute('tabindex', '0');
      label.setAttribute('role', 'tab');
      label.setAttribute('aria-controls', `conn-panel-${panelName}`);
      label.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activateConnectionTab(panelName);
        }
      });
      input.addEventListener('change', syncConnectionTabs);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (toggle && toggle.checked) closeConnections();
        closeSidebar();
        return;
      }
      if (event.key !== 'Tab' || !toggle || !toggle.checked || !modal) return;
      const focusable = getFocusableElements(modal);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    syncConnectionTabs();
  }

  function openConnections(tab = 'public') {
    const toggle = byId('connections-toggle');
    if (!toggle) return;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    activateConnectionTab(tab);
    window.setTimeout(() => {
      const label = $(`label[for="conn-tab-${tab}"]`);
      if (label) label.focus();
    }, 60);
  }

  function closeConnections() {
    const toggle = byId('connections-toggle');
    if (!toggle) return;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function activateConnectionTab(tab) {
    const input = byId(`conn-tab-${tab}`);
    if (!input) return;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    syncConnectionTabs();
  }

  function syncConnectionTabs() {
    $$('.conn-tab-input').forEach((input) => {
      const label = $(`label[for="${input.id}"]`);
      const panelName = input.id.replace('conn-tab-', '');
      const panel = byId(`conn-panel-${panelName}`);
      if (label) {
        label.setAttribute('aria-selected', String(input.checked));
        label.classList.toggle('is-active', input.checked);
      }
      if (panel) {
        panel.setAttribute('aria-hidden', String(!input.checked));
        panel.classList.toggle('is-active', input.checked);
      }
    });
  }

  function getFocusableElements(root) {
    return $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
      .filter((element) => element.getClientRects().length > 0);
  }

  /* ------------------------------------------------------------
     Utilidades de almacenamiento, red y formato
     ------------------------------------------------------------ */

  function loadJSON(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (error) {
      console.warn(`[localStorage] No se pudo leer ${key}`, error);
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn(`[localStorage] No se pudo guardar ${key}`, error);
      showToast('No se pudo guardar en localStorage. Revisa el espacio disponible.', 'error');
      return false;
    }
  }

  function loadText(key, fallback = '') {
    try {
      const value = window.localStorage.getItem(key);
      return value == null ? fallback : value;
    } catch (error) {
      console.warn(`[localStorage] No se pudo leer ${key}`, error);
      return fallback;
    }
  }

  function saveText(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn(`[localStorage] No se pudo guardar ${key}`, error);
      return false;
    }
  }

  /* ------------------------------------------------------------
     QuantFetch · cache en memoria (TTL 8s) + dedupe de peticiones
     en vuelo. Solo cachea GET publicos sin cabeceras de auth.
     Las firmas publicas (fetchJSON/fetchFirst/fetchPublic/
     fetchProtected) no cambian: todo pasa por aqui.
     ------------------------------------------------------------ */
  const QUANT_CACHE_TTL_MS = 8000;
  const QUANT_CACHE_MAX_ENTRIES = 200;
  const quantCache = new Map();
  const quantInFlight = new Map();

  function quantCacheGet(key) {
    const entry = quantCache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      quantCache.delete(key);
      return undefined;
    }
    quantCache.delete(key);
    quantCache.set(key, entry);
    return entry.value;
  }

  function quantCacheSet(key, value, ttl) {
    if (!(ttl > 0)) return;
    if (quantCache.size >= QUANT_CACHE_MAX_ENTRIES) {
      const oldest = quantCache.keys().next();
      if (!oldest.done) quantCache.delete(oldest.value);
    }
    quantCache.set(key, { value, expiresAt: Date.now() + ttl });
  }

  function quantCacheClear() {
    quantCache.clear();
    quantInFlight.clear();
  }

  function quantResolveTtl(options, method) {
    if (method !== 'GET') return 0;
    if (options.force === true) return 0;
    if (options.headers && Object.keys(options.headers).length) return 0;
    const raw = Number(options.ttl);
    return Number.isFinite(raw) && raw >= 0 ? raw : QUANT_CACHE_TTL_MS;
  }

  function quantDeduped(key, ttl, loader) {
    if (ttl > 0) {
      const cached = quantCacheGet(key);
      if (cached !== undefined) return Promise.resolve(cached);
      const pending = quantInFlight.get(key);
      if (pending) return pending;
    }

    const promise = (async () => {
      const value = await loader();
      if (ttl > 0) quantCacheSet(key, value, ttl);
      return value;
    })();

    if (ttl > 0) {
      quantInFlight.set(key, promise);
      const release = () => {
        if (quantInFlight.get(key) === promise) quantInFlight.delete(key);
      };
      promise.then(release, release);
    }
    return promise;
  }

  async function requestJSON(url, options = {}) {
    url = applyCoingeckoKey(url);
    const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 12000;
    const retries = Number.isInteger(options.retries) ? options.retries : 1;
    const method = options.method || 'GET';
    const headers = { ...(options.headers || {}) };
    const body = options.body == null ? undefined : options.body;
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'omit'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (response.status === 204) return null;
        const text = await response.text();
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch (error) {
          throw new Error('La respuesta no es JSON valido');
        }
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await new Promise((resolve) => window.setTimeout(resolve, 450));
        }
      } finally {
        window.clearTimeout(timer);
      }
    }
    throw lastError || new Error('Error de red desconocido');
  }

  async function fetchJSON(url, options = {}) {
    const method = options.method || 'GET';
    const ttl = quantResolveTtl(options, method);
    const key = options.cacheKey || `${method} ${url}`;
    return quantDeduped(key, ttl, () => requestJSON(url, options));
  }

  async function fetchFirst(urls, options = {}) {
    const attempts = [...new Set(urls.filter(Boolean))];
    const ttl = quantResolveTtl(options, 'GET');
    const key = options.cacheKey || `first ${attempts.join('|')}`;
    return quantDeduped(key, ttl, async () => {
      let lastError = null;
      for (const url of attempts) {
        try {
          return await requestJSON(url, { ...options, retries: 0 });
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error('Sin conexion disponible');
    });
  }

  function externalProxyAttempt(url, attempts) {
    if (state.proxy && state.proxy !== 'none' && state.proxy !== DEFAULT_PROXY) {
      const candidate = proxyUrl(url);
      if (!attempts.includes(candidate)) return candidate;
    }
    return null;
  }

  async function fetchPublic(url, options = {}) {
    const attempts = [];
    const local = localProxyAttempt(url);
    if (local) attempts.push(local);
    const userProxy = externalProxyAttempt(url, attempts);
    if (userProxy) attempts.push(userProxy);
    const proxyFirst = prefersCorsProxyFirst(url);
    const allOrigins = `${ALLORIGINS_PROXY}${encodeURIComponent(url)}`;
    if (proxyFirst) attempts.push(allOrigins);
    attempts.push(url);
    if (!proxyFirst) attempts.push(allOrigins);
    return fetchFirst(attempts, { ...options, cacheKey: options.cacheKey || `public ${url}` });
  }

  async function fetchProtected(url, options = {}) {
    const attempts = [];
    const local = localProxyAttempt(url);
    if (local) attempts.push(local);
    const userProxy = externalProxyAttempt(url, attempts);
    if (userProxy) attempts.push(userProxy);
    attempts.push(url);
    attempts.push(`${ALLORIGINS_PROXY}${encodeURIComponent(url)}`);
    return fetchFirst(attempts, { ...options, cacheKey: options.cacheKey || `secure ${url}` });
  }

  window.QuantFetch = {
    json: fetchJSON,
    first: fetchFirst,
    clear: quantCacheClear,
    stats: () => ({
      entries: quantCache.size,
      inFlight: quantInFlight.size,
      ttlMs: QUANT_CACHE_TTL_MS,
      maxEntries: QUANT_CACHE_MAX_ENTRIES
    })
  };

  // CoinGecko demo key (opcional). Si el usuario la guarda en Conexiones > API Keys,
  // se añade a todas las llamadas a api.coingecko.com para esquivar el rate limit
  // y el bloqueo CORS en hosts estaticos. La key vive solo en localStorage.
  function coingeckoDemoKey() {
    return (state.apiKeys && state.apiKeys.coingecko) || '';
  }
  window.QuantCoingeckoKey = coingeckoDemoKey;

  function applyCoingeckoKey(url) {
    const target = String(url || '');
    if (!target.includes('api.coingecko.com')) return target;
    const key = coingeckoDemoKey();
    if (!key) return target;
    const sep = target.includes('?') ? '&' : '?';
    return `${target}${sep}x_cg_demo_api_key=${encodeURIComponent(key)}`;
  }

  function proxyUrl(url) {
    const proxy = state.proxy || DEFAULT_PROXY;
    if (!proxy || proxy === 'none') return url;
    if (proxy.includes('{url}')) return proxy.replace('{url}', encodeURIComponent(url));
    return `${proxy}${encodeURIComponent(url)}`;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = value == null ? '—' : String(value);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function toFiniteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function parseNumeric(value) {
    if (value == null) return null;
    const normalized = String(value).replace(/%/g, '').replace(/\$/g, '').replace(/\s/g, '').replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatPrice(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '—';
    if (number >= 1000) return `$${number.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    if (number >= 1) return `$${number.toFixed(2)}`;
    if (number >= 0.01) return `$${number.toFixed(4)}`;
    return `$${number.toFixed(8)}`;
  }

  function formatCompactUSD(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 2
    }).format(number);
  }

  function formatNumber(value, digits = 0) {
    const number = toFiniteNumber(value);
    if (number == null) return '—';
    return number.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatSignedPct(value, digits = 2) {
    const number = toFiniteNumber(value);
    if (number == null) return '—';
    return `${number >= 0 ? '+' : ''}${number.toFixed(digits)}%`;
  }

  function formatFunding(value) {
    const number = toFiniteNumber(value);
    if (number == null) return '—';
    const pct = number * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(4)}%`;
  }

  function formatRatio(value) {
    const number = toFiniteNumber(value);
    return number == null ? '—' : number.toFixed(2);
  }

  function formatShortDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date).replace('.', '');
  }

  function formatShortDateTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date).replace('.', '');
  }

  function formatTimeWithSeconds(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date);
  }

  function formatFullDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('es-ES', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  function formatClock(milliseconds) {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
  }

  function signedPoints(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number === 0) return '0';
    return `${number > 0 ? '+' : ''}${Math.round(number)}`;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  function showToast(message, type = 'info') {
    const root = byId('toast-root');
    if (!root) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = document.createElement('i');
    const iconMap = { success: 'check-circle-2', error: 'circle-x', warning: 'triangle-alert', info: 'info' };
    icon.setAttribute('data-lucide', iconMap[type] || 'info');
    const text = document.createElement('span');
    text.textContent = message;
    toast.append(icon, text);
    root.appendChild(toast);
    refreshIcons();
    window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(4px)';
      window.setTimeout(() => toast.remove(), 220);
    }, 4200);
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  /* ------------------------------------------------------------
     Gestor de API Keys, proxy CORS y badges de conexion
     ------------------------------------------------------------ */

  function initApiKeys() {
    API_PROVIDERS.forEach((provider) => {
      const input = byId(`api-key-${provider}`);
      if (input && state.apiKeys[provider]) input.value = state.apiKeys[provider];
    });

    $$('[data-save-key]').forEach((button) => {
      button.addEventListener('click', () => saveApiKey(button.dataset.saveKey));
    });

    const proxySelect = byId('cors-proxy-select');
    if (proxySelect) {
      proxySelect.value = state.proxy || DEFAULT_PROXY;
      if (!proxySelect.value) {
        proxySelect.value = DEFAULT_PROXY;
        state.proxy = DEFAULT_PROXY;
        saveText(STORAGE_KEYS.proxy, state.proxy);
      }
      proxySelect.addEventListener('change', () => {
        state.proxy = proxySelect.value || DEFAULT_PROXY;
        saveText(STORAGE_KEYS.proxy, state.proxy);
        updateConnectionBadges();
        showToast(`Proxy CORS actualizado: ${state.proxy === 'none' ? 'llamada directa' : state.proxy}`, 'info');
        refreshOptionalApiData();
      });
    }
  }

  function saveApiKey(provider) {
    if (!API_PROVIDERS.includes(provider)) return;
    const input = byId(`api-key-${provider}`);
    if (!input) return;
    const value = input.value.trim();

    if (!value) {
      delete state.apiKeys[provider];
      saveJSON(STORAGE_KEYS.apiKeys, state.apiKeys);
      updateConnectionBadges();
      showToast(`${PROVIDER_LABELS[provider]}: clave eliminada de localStorage.`, 'info');
      refreshOptionalApiData();
      return;
    }

    if (value.length < 8) {
      showToast('La clave parece demasiado corta. Revisa el valor antes de guardar.', 'error');
      input.focus();
      return;
    }

    state.apiKeys[provider] = value;
    saveJSON(STORAGE_KEYS.apiKeys, state.apiKeys);
    updateConnectionBadges();
    showToast(`${PROVIDER_LABELS[provider]} guardada en localStorage. Validando conexion...`, 'success');
    refreshOptionalApiData();

    validateApiKey(provider)
      .then((isValid) => {
        if (isValid) {
          showToast(`${PROVIDER_LABELS[provider]} respondio correctamente.`, 'success');
        } else {
          showToast(`${PROVIDER_LABELS[provider]} quedo guardada, pero el proveedor no respondio desde el navegador. Revisa key o proxy.`, 'warning');
        }
      })
      .catch((error) => {
        console.warn(`[API Key] ${provider}`, error);
        showToast(`${PROVIDER_LABELS[provider]} guardada. La validacion fallo por red/CORS; se reintentara en la proxima consulta.`, 'warning');
      });
  }

  async function validateApiKey(provider) {
    const key = state.apiKeys[provider];
    if (!key) return false;

    switch (provider) {
      case 'fred':
        await fetchProtected(fredUrl('FEDFUNDS', key, 1), { timeout: 10000 });
        break;
      case 'dune':
        await fetchProtected(
          `https://api.dune.com/api/v1/query/${DUNE_QUERY_ID}/results?limit=1`,
          { headers: { 'X-Dune-API-Key': key }, timeout: 15000 }
        );
        break;
      case 'coinalyze':
        await fetchProtected(
          `https://api.coinalyze.net/v1/open-interest?symbols=BTCUSD_PERP.A&convert_to_usd=true&api_key=${encodeURIComponent(key)}`,
          { timeout: 10000 }
        );
        break;
      case 'livecoinwatch':
        await fetchProtected('https://api.livecoinwatch.com/coins/single', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key },
          body: JSON.stringify({ currency: 'USD', code: 'BTC', meta: true }),
          timeout: 12000
        });
        break;
      case 'coinmarketcap':
        await fetchProtected(
          'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=BTC&convert=USD',
          { headers: { 'X-CMC_PRO_API_KEY': key }, timeout: 10000 }
        );
        break;
      case 'cryptorank':
        await fetchProtected(
          `https://api.cryptorank.io/v1/currencies?api_key=${encodeURIComponent(key)}&limit=1`,
          { timeout: 10000 }
        );
        break;
      case 'coingecko':
        await fetchProtected(
          `https://api.coingecko.com/api/v3/ping?x_cg_demo_api_key=${encodeURIComponent(key)}`,
          { timeout: 10000 }
        );
        break;
      default:
        return false;
    }

    return true;
  }

  function updateConnectionBadges() {
    let connectedKeys = 0;
    let syncedSessions = 0;

    API_PROVIDERS.forEach((provider) => {
      const hasKey = Boolean(state.apiKeys[provider]);
      if (hasKey) connectedKeys += 1;

      const status = byId(`key-status-${provider}`);
      if (status) {
        status.textContent = hasKey ? '🟢 Conectada' : '⚪ Sin configurar';
        status.classList.toggle('is-connected', hasKey);
        status.title = hasKey
          ? `API Key guardada en localStorage. Se usa en las consultas de ${PROVIDER_LABELS[provider]}.`
          : 'Sin API Key. La fuente permanece inactiva hasta configurarla.';
      }

      const row = $(`[data-key-provider="${provider}"]`);
      if (row) row.classList.toggle('is-connected', hasKey);
    });

    SESSION_PROVIDERS.forEach((provider) => {
      const session = state.sessions[provider];
      if (session) syncedSessions += 1;
      updateSessionStatus(provider, session);
    });

    const totalKeys = Object.keys(PROVIDER_LABELS).length;
    const totalSessions = SESSION_PROVIDERS.length;
    setText('connections-count', `8 auto · ${connectedKeys + syncedSessions}/${totalKeys + totalSessions}`);
    setText('connections-keys-count', `${connectedKeys}/${totalKeys}`);
    setText('connections-sessions-count', `${syncedSessions}/${totalSessions}`);
    setText('connections-sessions-tab-count', String(totalSessions));

    const keyPanelBadge = $('#conn-panel-keys .conn-panel-head .access-badge.key');
    if (keyPanelBadge) {
      keyPanelBadge.innerHTML = `<i data-lucide="key-round"></i>${connectedKeys} de ${totalKeys} conectadas`;
    }

    const sessionPanelBadge = $('#conn-panel-sessions .conn-panel-head .access-badge.login');
    if (sessionPanelBadge) {
      sessionPanelBadge.innerHTML = `<i data-lucide="globe-2"></i>${syncedSessions} de ${totalSessions} sincronizadas`;
    }

    updateSourceStatuses();
    refreshIcons();
    document.dispatchEvent(new CustomEvent('crypto:intel:connections-updated', {
      detail: { connectedKeys, syncedSessions }
    }));
  }

  function findSourceProvider(domain) {
    const normalized = String(domain || '').toLowerCase();
    return SOURCE_PROVIDER_MAP.find((item) => normalized.includes(item.match)) || null;
  }

  function updateSourceStatuses() {
    $$('[data-source-card]').forEach((card) => {
      const status = card.querySelector('.source-status');
      if (!status) return;
      if (!status.dataset.originalStatus) {
        status.dataset.originalStatus = status.textContent.trim() || 'Configurable';
      }

      const providerInfo = findSourceProvider(card.dataset.domain);
      if (!providerInfo) return;

      status.classList.remove('is-connected', 'is-synced', 'is-stale');

      if (providerInfo.type === 'key' && state.apiKeys[providerInfo.provider]) {
        status.innerHTML = '<span class="status-dot"></span>Conectada';
        status.classList.add('is-connected');
        return;
      }

      if (providerInfo.type === 'session' && state.sessions[providerInfo.provider]) {
        const session = state.sessions[providerInfo.provider];
        const updatedAt = toFiniteNumber(session.updatedAt);
        const stale = updatedAt == null || Date.now() - updatedAt > SESSION_STALE_MS;
        status.innerHTML = `<span class="status-dot"></span>${stale ? 'Sync vencida' : 'Sincronizada'}`;
        status.classList.add(stale ? 'is-stale' : 'is-synced');
        return;
      }

      status.innerHTML = `<span class="status-dot"></span>${escapeHtml(status.dataset.originalStatus)}`;
    });
  }

  /* ------------------------------------------------------------
     Sesiones web y sincronizacion manual
     ------------------------------------------------------------ */

  function initSessions() {
    const form = byId('session-sync-data-form');
    if (form) form.addEventListener('submit', handleSessionSubmit);

    $$('[data-sync-session]').forEach((button) => {
      button.addEventListener('click', () => focusSessionForm(button.dataset.syncSession));
    });

    const platform = byId('session-platform');
    if (platform) {
      platform.addEventListener('change', () => setDefaultMetricForPlatform(platform.value));
      setDefaultMetricForPlatform(platform.value);
    }
  }

  function handleSessionSubmit(event) {
    event.preventDefault();
    const platformSelect = byId('session-platform');
    const metricSelect = byId('session-metric');
    const valueInput = byId('session-value');
    const noteInput = byId('session-note');

    const platform = platformSelect ? platformSelect.value : '';
    const metric = metricSelect ? metricSelect.value : '';
    const value = valueInput ? valueInput.value.trim() : '';
    const note = noteInput ? noteInput.value.trim() : '';

    if (!platform || !metric || !value) {
      showToast('Completa plataforma, dato observado y valor antes de sincronizar.', 'error');
      if (!value && valueInput) valueInput.focus();
      return;
    }

    const now = Date.now();
    const entry = {
      platform,
      metric,
      metricLabel: METRIC_LABELS[metric] || metric,
      value,
      note,
      updatedAt: now
    };

    state.sessions[platform] = entry;
    saveJSON(STORAGE_KEYS.sessions, state.sessions);

    const history = loadJSON(STORAGE_KEYS.sessionsHistory, []);
    history.unshift({ ...entry });
    saveJSON(STORAGE_KEYS.sessionsHistory, history.slice(0, 60));

    renderSessions();
    updateConnectionBadges();
    applySessionToMacro(entry, { force: true, persist: true });
    showToast(`Sync de ${SESSION_LABELS[platform] || platform} guardado con marca de tiempo.`, 'success');

    const keepPlatform = platform;
    if (form) form.reset();
    if (platformSelect) platformSelect.value = keepPlatform;
    setDefaultMetricForPlatform(keepPlatform);
  }

  function focusSessionForm(provider) {
    if (!provider) return;
    openConnections('sessions');
    const platformSelect = byId('session-platform');
    if (platformSelect) {
      platformSelect.value = provider;
      setDefaultMetricForPlatform(provider);
    }
    window.setTimeout(() => {
      const valueInput = byId('session-value');
      if (valueInput) valueInput.focus();
      const card = byId('session-sync-form');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  }

  function setDefaultMetricForPlatform(platform) {
    const metricSelect = byId('session-metric');
    if (!metricSelect) return;
    const defaultMetric = PLATFORM_DEFAULT_METRIC[platform];
    if (defaultMetric) metricSelect.value = defaultMetric;
  }

  /* ------------------------------------------------------------
     Puente Tampermonkey · external_login_sync_data
     ------------------------------------------------------------ */

  function initExternalLoginBridge() {
    if (phase4State.externalBridgeInitialized) return;
    phase4State.externalBridgeInitialized = true;

    const syncButton = byId('external-bridge-sync');
    if (syncButton) {
      syncButton.addEventListener('click', () => {
        syncExternalLoginData({ silent: false, force: true });
      });
    }

    window.addEventListener('storage', (event) => {
      if (event.key !== EXTERNAL_LOGIN_SYNC_KEY) return;
      syncExternalLoginData({ silent: false });
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncExternalLoginData({ silent: true });
    });

    window.addEventListener('focus', () => syncExternalLoginData({ silent: true }));

    document.addEventListener('crypto:intel:external-sync', () => {
      syncExternalLoginData({ silent: false, force: true });
    });

    if (phase4State.externalBridgeTimer) window.clearInterval(phase4State.externalBridgeTimer);
    phase4State.externalBridgeTimer = window.setInterval(() => {
      if (!document.hidden) syncExternalLoginData({ silent: true });
    }, 30000);

    updateExternalBridgeStatus(phase4State.externalSyncSummary);
  }

  function readExternalLoginData() {
    let raw = null;
    try {
      raw = localStorage.getItem(EXTERNAL_LOGIN_SYNC_KEY);
      if (!raw) return { raw: null, data: null, error: null };
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { raw, data: null, error: 'external_login_sync_data no contiene un objeto JSON válido.' };
      }
      return { raw, data, error: null };
    } catch (error) {
      return {
        raw: raw || 'invalid',
        data: null,
        error: error && error.message ? error.message : 'No se pudo leer external_login_sync_data.'
      };
    }
  }

  function normalizeExternalProvider(value) {
    const key = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (EXTERNAL_LOGIN_PROVIDERS.includes(key)) return key;
    const aliases = { gmgnai: 'gmgn', glassnodestudio: 'glassnode' };
    return aliases[key] || null;
  }

  function normalizeExternalBias(value) {
    const raw = String(value || '').toUpperCase();
    if (/(BULL|ALCISTA|POSITIV|COMPRA)/.test(raw)) return 'BULLISH';
    if (/(BEAR|BAJISTA|NEGATIV|VENTA)/.test(raw)) return 'BEARISH';
    if (/(NEUTRAL|NEUTRO|LATERAL)/.test(raw)) return 'NEUTRAL';
    return '';
  }

  function extractExternalUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const markdown = raw.match(/\((https?:\/\/[^)\s]+)\)/i);
    if (markdown) return markdown[1];
    const plain = raw.match(/https?:\/\/[^\s)\]]+/i);
    return plain ? plain[0] : '';
  }

  function parseExternalTimestamp(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
    }

    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\d{10,13}$/.test(raw)) {
      const numeric = Number(raw);
      return raw.length === 10 ? numeric * 1000 : numeric;
    }

    const normalized = raw
      .replace(/a\.?\s*m\.?/ig, 'AM')
      .replace(/p\.?\s*m\.?/ig, 'PM');
    const match = normalized.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
    if (match) {
      let day = Number(match[1]);
      let month = Number(match[2]);
      let year = Number(match[3]);
      if (year < 100) year += 2000;
      if (month > 12 && day <= 12) {
        const swap = day;
        day = month;
        month = swap;
      }

      let hour = Number(match[4] || 0);
      const minute = Number(match[5] || 0);
      const second = Number(match[6] || 0);
      const period = (match[7] || '').toUpperCase();
      if (period === 'PM' && hour < 12) hour += 12;
      if (period === 'AM' && hour === 12) hour = 0;

      const makeDate = (candidateDay, candidateMonth) => {
        const date = new Date(year, candidateMonth - 1, candidateDay, hour, minute, second);
        if (date.getFullYear() !== year || date.getMonth() !== candidateMonth - 1 || date.getDate() !== candidateDay) {
          return null;
        }
        return Number.isFinite(date.getTime()) ? date.getTime() : null;
      };
      const primary = makeDate(day, month);
      const alternate = day <= 12 && month <= 12 && day !== month ? makeDate(month, day) : null;
      if (primary != null && alternate != null) {
        return Math.abs(primary - Date.now()) <= Math.abs(alternate - Date.now()) ? primary : alternate;
      }
      if (primary != null) return primary;
      if (alternate != null) return alternate;
    }

    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function updateExternalBridgeStatus(summary) {
    const card = byId('external-bridge-card');
    const status = byId('external-bridge-status');
    const meta = byId('external-bridge-meta');
    if (!card || !status || !meta) return;

    card.classList.remove('is-connected', 'is-empty', 'is-error');
    if (summary && summary.error) {
      card.classList.add('is-error');
      status.textContent = 'Error de lectura del puente';
      meta.textContent = summary.error;
      return;
    }
    if (!summary || !summary.found) {
      card.classList.add('is-empty');
      status.textContent = 'Sin datos del puente';
      meta.textContent = 'El userscript aún no ha escrito external_login_sync_data o no hay lecturas válidas.';
      return;
    }

    const count = summary.synced || summary.updated || 0;
    if (!count && summary.invalid) {
      card.classList.add('is-error');
      status.textContent = 'Lecturas inválidas';
      meta.textContent = `${summary.invalid} entrada(s) sin value válido. Revisa la estructura del userscript.`;
      return;
    }
    if (!count && summary.skipped) {
      card.classList.add('is-connected');
      status.textContent = 'Lecturas locales conservadas';
      meta.textContent = `${summary.skipped} lectura(s) externa(s) más antigua(s) que tu sesión manual.`;
      return;
    }
    if (!count) {
      card.classList.add('is-error');
      status.textContent = 'Sin lecturas compatibles';
      meta.textContent = 'external_login_sync_data no contiene proveedores soportados o valores utilizables.';
      return;
    }

    card.classList.add('is-connected');
    const sessionWord = count === 1 ? 'sesión' : 'sesiones';
    status.textContent = `${count} ${sessionWord} sincronizada${count === 1 ? '' : 's'}`;
    const last = summary.lastUpdatedAt ? formatShortDate(summary.lastUpdatedAt) : 'sin fecha';
    const details = [];
    if (summary.updated) details.push(`${summary.updated} actualizada${summary.updated === 1 ? '' : 's'}`);
    if (summary.skipped) details.push(`${summary.skipped} conservada${summary.skipped === 1 ? '' : 's'}`);
    if (summary.invalid) details.push(`${summary.invalid} inválida${summary.invalid === 1 ? '' : 's'}`);
    meta.textContent = `Última lectura: ${last}${details.length ? ` · ${details.join(' · ')}` : ''}`;
  }

  function syncExternalLoginData({ silent = true, force = false } = {}) {
    const read = readExternalLoginData();
    if (!read.raw) {
      phase4State.lastExternalRaw = null;
      phase4State.externalSyncSummary = {
        found: false, synced: 0, updated: 0, skipped: 0, invalid: 0, error: read.error, lastUpdatedAt: null
      };
      updateExternalBridgeStatus(phase4State.externalSyncSummary);
      refreshTampermonkeyBridgeUI();
      if (!silent && read.error) showToast('Puente Tampermonkey: no se pudo leer external_login_sync_data.', 'error');
      return phase4State.externalSyncSummary;
    }

    if (!force && read.raw === phase4State.lastExternalRaw) {
      updateExternalBridgeStatus(phase4State.externalSyncSummary);
      refreshTampermonkeyBridgeUI();
      return phase4State.externalSyncSummary;
    }
    phase4State.lastExternalRaw = read.raw;

    if (read.error) {
      phase4State.externalSyncSummary = {
        found: false, synced: 0, updated: 0, skipped: 0, invalid: 0, error: read.error, lastUpdatedAt: null
      };
      updateExternalBridgeStatus(phase4State.externalSyncSummary);
      refreshTampermonkeyBridgeUI();
      if (!silent) showToast('Puente Tampermonkey: JSON inválido en external_login_sync_data.', 'error');
      return phase4State.externalSyncSummary;
    }

    const data = read.data || {};
    const storedHistory = loadJSON(STORAGE_KEYS.sessionsHistory, []);
    const history = Array.isArray(storedHistory) ? storedHistory : [];
    const changedEntries = [];
    let synced = 0;
    let updated = 0;
    let skipped = 0;
    let invalid = 0;
    let lastUpdatedAt = null;

    Object.keys(data).forEach((rawProvider) => {
      const rawEntry = data[rawProvider];
      if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
        invalid += 1;
        return;
      }
      const provider = normalizeExternalProvider(rawProvider) || normalizeExternalProvider(rawEntry.name);
      if (!provider) return;

      if (rawEntry.value == null || typeof rawEntry.value === 'object') {
        invalid += 1;
        return;
      }
      const value = String(rawEntry.value).trim();
      if (!value) {
        invalid += 1;
        return;
      }

      const metric = PLATFORM_DEFAULT_METRIC[provider] || 'sector-flow';
      const bias = normalizeExternalBias(rawEntry.bias);
      const updatedAt = parseExternalTimestamp(rawEntry.timestamp) || Date.now();
      const sourceName = String(rawEntry.name || SESSION_LABELS[provider] || provider).trim();
      const noteParts = [];
      if (sourceName && sourceName !== (SESSION_LABELS[provider] || '')) noteParts.push(sourceName);
      if (bias) noteParts.push(bias);
      const entry = {
        platform: provider,
        metric,
        metricLabel: METRIC_LABELS[metric] || metric,
        value: value.slice(0, 120),
        note: noteParts.join(' · ').slice(0, 120),
        updatedAt,
        bias,
        url: extractExternalUrl(rawEntry.url),
        external: true,
        externalTimestamp: String(rawEntry.timestamp || ''),
        sourceName
      };
      if (updatedAt > (lastUpdatedAt || 0)) lastUpdatedAt = updatedAt;

      const existing = state.sessions[provider];
      if (!force && existing && !existing.external && toFiniteNumber(existing.updatedAt) > updatedAt) {
        skipped += 1;
        return;
      }
      const sameCore = existing
        && existing.value === entry.value
        && existing.bias === entry.bias
        && toFiniteNumber(existing.updatedAt) === entry.updatedAt;
      const sameMeta = existing
        && existing.url === entry.url
        && existing.sourceName === entry.sourceName
        && existing.externalTimestamp === entry.externalTimestamp
        && existing.note === entry.note
        && existing.metric === entry.metric
        && existing.metricLabel === entry.metricLabel;
      if (sameCore && sameMeta) {
        synced += 1;
        return;
      }
      if (sameCore) {
        state.sessions[provider] = { ...existing, ...entry };
        changedEntries.push(state.sessions[provider]);
        history.unshift({ ...state.sessions[provider] });
        updated += 1;
        synced += 1;
        return;
      }

      state.sessions[provider] = entry;
      changedEntries.push(entry);
      history.unshift({ ...entry });
      updated += 1;
      synced += 1;
    });

    if (changedEntries.length) {
      saveJSON(STORAGE_KEYS.sessions, state.sessions);
      saveJSON(STORAGE_KEYS.sessionsHistory, history.slice(0, 60));
      renderSessions();
      changedEntries.forEach((entry) => applySessionToMacro(entry, { force: true, persist: true }));
      updateConnectionBadges();
    }

    phase4State.externalSyncSummary = {
      found: true,
      synced,
      updated,
      skipped,
      invalid,
      error: null,
      lastUpdatedAt
    };
    updateExternalBridgeStatus(phase4State.externalSyncSummary);
    refreshTampermonkeyBridgeUI({ recalc: changedEntries.length > 0 });

    if (!silent) {
      if (updated > 0) {
        const sessionWord = updated === 1 ? 'sesión' : 'sesiones';
        showToast(`Puente Tampermonkey: ${updated} ${sessionWord} sincronizada${updated === 1 ? '' : 's'} desde login web.`, 'success');
      } else if (skipped > 0) {
        showToast('Puente Tampermonkey: las lecturas locales son más recientes; no se sobrescribieron.', 'info');
      } else if (synced > 0) {
        showToast('Puente Tampermonkey: las sesiones ya estaban sincronizadas.', 'info');
      } else {
        showToast('Puente Tampermonkey: no se encontraron lecturas válidas.', 'warning');
      }
    }
    return phase4State.externalSyncSummary;
  }

  function renderSessions() {
    SESSION_PROVIDERS.forEach((provider) => {
      const entry = state.sessions[provider];
      updateSessionStatus(provider, entry);
      if (entry) applySessionToMacro(entry, { force: false, persist: false });
    });
  }

  function updateSessionStatus(provider, session) {
    const status = byId(`session-status-${provider}`);
    if (!status) return;

    status.classList.remove('is-synced', 'is-stale');

    if (!session) {
      status.textContent = '⚪ Sin sincronizar';
      status.title = 'Sin datos locales para esta plataforma.';
      return;
    }

    const updatedAt = toFiniteNumber(session.updatedAt);
    const stale = updatedAt == null || Date.now() - updatedAt > SESSION_STALE_MS;
    status.textContent = `${stale ? '🟡 Vencida' : '🟢 Sincronizada'} · ${updatedAt == null ? 'sin fecha' : formatShortDate(updatedAt)}`;
    status.classList.add(stale ? 'is-stale' : 'is-synced');
    status.title = `${session.metricLabel || METRIC_LABELS[session.metric] || session.metric}: ${session.value}${session.note ? ` · ${session.note}` : ''} · ${updatedAt == null ? 'sin fecha' : formatFullDate(updatedAt)}${session.url ? ` · ${session.url}` : ''}`;

    const row = $(`[data-sync-session="${provider}"]`)?.closest('.session-row');
    if (row) row.classList.toggle('is-synced', !stale);
  }

  function applySessionToMacro(entry, { force = false, persist = true } = {}) {
    if (!entry) return;
    const macroId = METRIC_TO_MACRO[entry.metric] || PLATFORM_TO_MACRO[entry.platform];
    if (!macroId) return;

    const updatedAt = toFiniteNumber(entry.updatedAt);
    const stale = updatedAt == null || Date.now() - updatedAt > SESSION_STALE_MS;
    const reading = deriveMacroReadingFromSession(entry);
    const tone = stale
      ? 'is-stale'
      : reading === 'bull'
        ? 'is-bull'
        : reading === 'bear'
          ? 'is-bear'
          : 'is-neutral';

    setMacroLive(
      macroId,
      `${SESSION_LABELS[entry.platform] || entry.platform}: ${entry.value}${entry.note ? ` · ${entry.note}` : ''} · ${updatedAt == null ? 'sin fecha' : formatShortDate(updatedAt)}`,
      tone,
      `${entry.metricLabel || METRIC_LABELS[entry.metric] || entry.metric}: ${entry.value} · ${updatedAt == null ? 'sin fecha' : formatFullDate(updatedAt)}`
    );

    if (entry.metric === 'supply-profit') {
      const numeric = parseNumeric(entry.value);
      const input = byId('supply-profit-input');
      if (numeric != null && input) input.value = String(clamp(numeric, 0, 100));
    }

    if (reading && !stale) {
      applyMacroAuto(macroId, reading, {
        force,
        source: 'session',
        persist
      });
      return;
    }

    if (stale) {
      const item = $(`[data-macro-item][data-macro-id="${macroId}"]`);
      const select = item ? item.querySelector('[data-macro-select]') : null;
      if (select && select.dataset.auto === 'session') {
        select.value = '';
        delete select.dataset.auto;
        select.classList.remove('is-auto');
        delete state.macro[macroId];
        delete state.macroAuto[macroId];
        if (persist) saveMacroState();
        updateMacroSummary();
      }
    }
  }

  function deriveMacroReadingFromSession(entry) {
    const raw = String(entry.value || '').toLowerCase().replace(',', '.');
    const numeric = parseNumeric(entry.value);
    const bias = String(entry.bias || '').toUpperCase();

    if (bias.includes('BULL')) return 'bull';
    if (bias.includes('BEAR')) return 'bear';
    if (bias.includes('NEUTRAL')) return 'neutral';

    switch (entry.metric) {
      case 'supply-profit':
        if (numeric == null) return 'neutral';
        if (numeric < 50) return 'bull';
        if (numeric > 95) return 'bear';
        return 'neutral';
      case 'exchange-reserve':
        if (/(baj|down|salida|outflow|retir|dismin)/.test(raw)) return 'bull';
        if (/(sub|up|entrada|inflow|deposit|aument)/.test(raw)) return 'bear';
        return 'neutral';
      case 'macro-liquidity':
        if (/(expans|aument|sub|up|positiv)/.test(raw)) return 'bull';
        if (/(contracc|reducc|baj|down|negativ)/.test(raw)) return 'bear';
        return 'neutral';
      case 'oi-funding':
        if (/(negativ|short)/.test(raw) || (numeric != null && numeric < 0)) return 'bull';
        if (/(positiv|long)/.test(raw) || (numeric != null && numeric > 0.03)) return 'bear';
        return 'neutral';
      case 'sector-flow':
        if (/(entrada|inflow|positiv|acumul)/.test(raw)) return 'bull';
        if (/(salida|outflow|negativ|distrib)/.test(raw)) return 'bear';
        return 'neutral';
      case 'pf-ratio':
        if (numeric == null) return 'neutral';
        if (numeric < 15) return 'bull';
        if (numeric > 30) return 'bear';
        return 'neutral';
      default:
        return null;
    }
  }

  /* ------------------------------------------------------------
     Checklist macro y validacion on-chain
     ------------------------------------------------------------ */

  function initMacro() {
    addMacroLiveValues();
    restoreMacroState();

    $$('[data-macro-item]').forEach((item) => {
      const select = item.querySelector('[data-macro-select]');
      if (!select) return;
      select.addEventListener('change', () => {
        const id = item.dataset.macroId;
        if (select.value) state.macro[id] = select.value;
        else delete state.macro[id];
        state.macroAuto[id] = false;
        delete select.dataset.auto;
        select.classList.remove('is-auto');
        saveMacroState();
        updateMacroSummary();
      });
    });

    const supplyProfitInput = byId('supply-profit-input');
    if (supplyProfitInput) {
      supplyProfitInput.addEventListener('change', () => {
        const numeric = parseNumeric(supplyProfitInput.value);
        if (numeric == null) return;
        const reading = numeric < 50 ? 'bull' : numeric > 95 ? 'bear' : 'neutral';
        applyMacroAuto('supply-profit', reading, { force: true, source: 'manual-input', persist: true });
      });
    }

    byId('macro-save')?.addEventListener('click', () => {
      saveMacroState();
      updateMacroSummary();
      showToast('Lectura macro guardada en localStorage.', 'success');
    });

    byId('macro-reset')?.addEventListener('click', resetMacroChecklist);

    byId('macro-apply')?.addEventListener('click', () => {
      updateMacroSummary();
      updateFinalDecision();
      showToast('Checklist macro aplicado a la matriz de decision.', 'success');
    });

    byId('final-apply-macro')?.addEventListener('click', () => {
      scrollToId('macro-validation');
      showToast('Edita los 15 indicadores y la matriz se recalcula automaticamente.', 'info');
    });

    updateMacroSummary();
  }

  function addMacroLiveValues() {
    $$('.macro-item[data-macro-id]').forEach((item) => {
      if (item.querySelector('.macro-live-value')) return;
      const id = item.dataset.macroId;
      const span = document.createElement('span');
      span.className = 'macro-live-value is-muted';
      span.id = `macro-live-${id}`;
      span.textContent = '—';
      const accessRow = item.querySelector('.macro-access-row');
      const copy = item.querySelector('.macro-item-copy');
      if (accessRow) accessRow.appendChild(span);
      else if (copy) copy.appendChild(span);
    });
  }

  function restoreMacroState() {
    $$('.macro-item[data-macro-id]').forEach((item) => {
      const id = item.dataset.macroId;
      const select = item.querySelector('[data-macro-select]');
      const stored = state.macro[id];
      if (!select || !['bull', 'neutral', 'bear'].includes(stored)) return;
      select.value = stored;
      const autoSource = state.macroAuto[id];
      if (autoSource) {
        select.dataset.auto = typeof autoSource === 'string' ? autoSource : 'auto';
        select.classList.add('is-auto');
      }
    });
  }

  function updateMacroSummary() {
    const selects = $$('[data-macro-select]');
    let evaluated = 0;
    let balance = 0;

    selects.forEach((select) => {
      const item = select.closest('[data-macro-item]');
      const value = select.value;
      if (item) {
        item.classList.remove('is-bull', 'is-bear', 'is-neutral');
        item.classList.toggle('is-auto', Boolean(select.dataset.auto));
      }
      if (value === 'bull') {
        balance += 1;
        evaluated += 1;
        item?.classList.add('is-bull');
      } else if (value === 'bear') {
        balance -= 1;
        evaluated += 1;
        item?.classList.add('is-bear');
      } else if (value === 'neutral') {
        evaluated += 1;
        item?.classList.add('is-neutral');
      }
    });

    const score = evaluated > 0 ? Math.round(50 + (balance / evaluated) * 50) : null;
    state.lastMacroScore = score;
    state.lastMacroCount = evaluated;

    setText('macro-score', score == null ? '—' : score);
    setText('macro-evaluated', `${evaluated} / 15 evaluados`);
    setText('overview-macro-count', `${evaluated} / 15`);
    setText('overview-macro', score == null ? '—' : `${score}/100`);

    const bias = byId('macro-bias');
    if (bias) {
      if (score == null) {
        bias.className = 'badge badge-neutral';
        bias.textContent = 'Sin evaluar';
      } else if (score >= 60) {
        bias.className = 'badge badge-bull';
        bias.textContent = 'Alcista';
      } else if (score <= 40) {
        bias.className = 'badge badge-bear';
        bias.textContent = 'Bajista';
      } else {
        bias.className = 'badge badge-amber';
        bias.textContent = 'Neutral';
      }
    }

    const progress = byId('macro-progress');
    if (progress) progress.style.width = `${score == null ? 0 : score}%`;
    const overviewMacroBar = byId('overview-macro-bar');
    if (overviewMacroBar) overviewMacroBar.style.width = `${score == null ? 0 : score}%`;

    if (state.decisions['4h'] && state.decisions['1d']) {
      if (!rebuildDecisionsFromCache()) updateFinalDecision();
    }

    document.dispatchEvent(new CustomEvent('crypto:intel:macro-updated', {
      detail: { score, evaluated }
    }));
  }

  function applyMacroAuto(id, value, { force = false, source = 'auto', persist = true } = {}) {
    if (!['bull', 'neutral', 'bear'].includes(value)) return false;
    const item = $(`[data-macro-item][data-macro-id="${id}"]`);
    const select = item ? item.querySelector('[data-macro-select]') : null;
    if (!select) return false;

    const canSet = force || !select.value || Boolean(select.dataset.auto);
    if (!canSet) return false;

    select.value = value;
    select.dataset.auto = source;
    select.classList.add('is-auto');
    state.macro[id] = value;
    state.macroAuto[id] = source;
    if (persist) saveMacroState();
    updateMacroSummary();
    return true;
  }

  function resetMacroChecklist() {
    $$('[data-macro-select]').forEach((select) => {
      select.value = '';
      delete select.dataset.auto;
      select.classList.remove('is-auto');
    });
    state.macro = {};
    state.macroAuto = {};
    saveMacroState();
    updateMacroSummary();
    showToast('Checklist macro reiniciado. Las fuentes automaticas se repoblaran al actualizar.', 'info');
  }

  function saveMacroState() {
    saveJSON(STORAGE_KEYS.macro, state.macro);
    saveJSON(STORAGE_KEYS.macroAuto, state.macroAuto);
  }

  function setMacroLive(id, text, tone = 'is-muted', title = '') {
    const element = byId(`macro-live-${id}`);
    if (!element) return;
    element.textContent = text;
    element.className = `macro-live-value ${tone}`;
    element.title = title || text;
  }

  /* ------------------------------------------------------------
     APIs opcionales con key: FRED, Coinalyze y Dune
     ------------------------------------------------------------ */

  async function refreshOptionalApiData() {
    await Promise.allSettled([
      loadFredData(),
      loadCoinalyzeData(),
      loadDuneData()
    ]);
  }

  async function loadFredData() {
    const key = state.apiKeys.fred;
    if (!key) {
      setMacroLive('fred-data', '🔑 Conecta FRED para tasas, CPI y M2', 'is-muted');
      return;
    }

    setMacroLive('fred-data', 'FRED · consultando series...', 'is-muted');

    try {
      const results = await Promise.allSettled([
        fetchProtected(fredUrl('FEDFUNDS', key, 2), { timeout: 10000 }),
        fetchProtected(fredUrl('CPIAUCSL', key, 13), { timeout: 12000 }),
        fetchProtected(fredUrl('M2SL', key, 13), { timeout: 12000 })
      ]);

      const fed = results[0].status === 'fulfilled' ? parseFredObservations(results[0].value) : [];
      const cpi = results[1].status === 'fulfilled' ? parseFredObservations(results[1].value) : [];
      const m2 = results[2].status === 'fulfilled' ? parseFredObservations(results[2].value) : [];

      if (!fed.length && !cpi.length && !m2.length) throw new Error('FRED no devolvio observaciones');

      const fedLatest = fed.length ? fed[0].value : null;
      const cpiYoY = computeFredYoY(cpi);
      const m2YoY = computeFredYoY(m2);
      const reading = deriveFredReading(fed, cpiYoY, m2YoY);

      const parts = [];
      if (fedLatest != null) parts.push(`FEDFUNDS ${fedLatest.toFixed(2)}%`);
      if (cpiYoY != null) parts.push(`CPI ${formatSignedPct(cpiYoY, 1)} YoY`);
      if (m2YoY != null) parts.push(`M2 ${formatSignedPct(m2YoY, 1)} YoY`);

      const tone = reading === 'bull' ? 'is-bull' : reading === 'bear' ? 'is-bear' : 'is-neutral';
      setMacroLive('fred-data', parts.join(' · ') || 'FRED · sin observaciones', tone, 'Fuente: FRED St. Louis. FEDFUNDS, CPI y M2.');

      if (reading) applyMacroAuto('fred-data', reading, { force: false, source: 'fred' });
    } catch (error) {
      console.warn('[FRED]', error);
      setMacroLive('fred-data', '⚠️ FRED no respondio · revisa key/proxy', 'is-bear');
    }
  }

  function fredUrl(seriesId, key, limit) {
    return `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=${limit}`;
  }

  function parseFredObservations(response) {
    const observations = response && Array.isArray(response.observations) ? response.observations : [];
    return observations
      .filter((observation) => observation && observation.value !== '.')
      .map((observation) => ({ date: observation.date, value: toFiniteNumber(observation.value) }))
      .filter((observation) => Number.isFinite(observation.value));
  }

  function computeFredYoY(observations) {
    if (!Array.isArray(observations) || observations.length < 13) return null;
    const latest = observations[0].value;
    const yearAgo = observations[12].value;
    if (!Number.isFinite(latest) || !Number.isFinite(yearAgo) || yearAgo === 0) return null;
    return (latest / yearAgo - 1) * 100;
  }

  function deriveFredReading(fed, cpiYoY, m2YoY) {
    let score = 0;

    if (fed.length >= 2 && Number.isFinite(fed[0].value) && Number.isFinite(fed[1].value)) {
      if (fed[0].value < fed[1].value) score += 1;
      else if (fed[0].value > fed[1].value) score -= 1;
    }
    if (cpiYoY != null) {
      if (cpiYoY < 2.5) score += 1;
      else if (cpiYoY > 4) score -= 1;
    }
    if (m2YoY != null) {
      if (m2YoY > 5) score += 1;
      else if (m2YoY < 0) score -= 1;
    }

    if (score >= 2) return 'bull';
    if (score <= -2) return 'bear';
    return 'neutral';
  }

  async function loadCoinalyzeData() {
    const key = state.apiKeys.coinalyze;
    if (!key) {
      setMacroLive('coinalyze', '🔑 Conecta Coinalyze para OI global', 'is-muted');
      return;
    }

    setMacroLive('coinalyze', 'Coinalyze · consultando OI y funding...', 'is-muted');

    try {
      const results = await Promise.allSettled([
        fetchProtected(
          `https://api.coinalyze.net/v1/open-interest?symbols=BTCUSD_PERP.A,ETHUSD_PERP.A&convert_to_usd=true&api_key=${encodeURIComponent(key)}`,
          { timeout: 12000 }
        ),
        fetchProtected(
          `https://api.coinalyze.net/v1/funding-rate?symbols=BTCUSD_PERP.A,ETHUSD_PERP.A&api_key=${encodeURIComponent(key)}`,
          { timeout: 12000 }
        )
      ]);

      const oiRows = results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : [];
      const fundingRows = results[1].status === 'fulfilled' && Array.isArray(results[1].value) ? results[1].value : [];
      if (!oiRows.length && !fundingRows.length) throw new Error('Coinalyze no devolvio datos');

      const btcOi = oiRows.find((row) => /BTC/i.test(String(row.symbol || '')));
      const btcFunding = fundingRows.find((row) => /BTC/i.test(String(row.symbol || '')));
      const oiValue = toFiniteNumber(btcOi && (btcOi.value ?? btcOi.openInterest));
      const fundingValue = toFiniteNumber(btcFunding && (btcFunding.value ?? btcFunding.fundingRate));

      const parts = [];
      if (oiValue != null && oiValue > 0) parts.push(`BTC OI ${formatCompactUSD(oiValue)}`);
      if (fundingValue != null) parts.push(`Funding ${formatFunding(fundingValue)}`);

      const reading = fundingValue != null
        ? fundingValue > 0.0003
          ? 'bear'
          : fundingValue < -0.0001
            ? 'bull'
            : 'neutral'
        : null;
      const tone = reading === 'bull' ? 'is-bull' : reading === 'bear' ? 'is-bear' : 'is-neutral';

      setMacroLive('coinalyze', parts.join(' · ') || 'Coinalyze · sin datos utiles', tone, 'Fuente: Coinalyze API v1.');
      if (reading) applyMacroAuto('coinalyze', reading, { force: false, source: 'coinalyze' });
    } catch (error) {
      console.warn('[Coinalyze]', error);
      setMacroLive('coinalyze', '⚠️ Coinalyze no respondio · revisa key/proxy', 'is-bear');
    }
  }

  async function loadDuneData() {
    const key = state.apiKeys.dune;
    if (!key) {
      setMacroLive('dune-signal', '🔑 Conecta Dune para Alts Buy Signal', 'is-muted');
      return;
    }

    setMacroLive('dune-signal', 'Dune · consultando Alts Buy Signal...', 'is-muted');

    try {
      const response = await fetchProtected(
        `https://api.dune.com/api/v1/query/${DUNE_QUERY_ID}/results?limit=10`,
        { headers: { 'X-Dune-API-Key': key }, timeout: 18000 }
      );

      const rows = response && response.result && Array.isArray(response.result.rows) ? response.result.rows : [];
      if (!rows.length) throw new Error('Dune no devolvio filas');

      const sorted = sortDuneRows(rows);
      const latest = sorted[0];
      const value = getNumericByKeys(latest, ['mv_ratio', 'alts_signal', 'alts', 'signal']);
      if (value == null) throw new Error('No se encontro la columna mv_ratio');

      const reading = value < 0.4 ? 'bull' : value > 0.6 ? 'bear' : 'neutral';
      const tone = reading === 'bull' ? 'is-bull' : reading === 'bear' ? 'is-bear' : 'is-neutral';
      const label = reading === 'bull' ? 'Acumulacion' : reading === 'bear' ? 'Distribucion' : 'Neutral';

      setMacroLive('dune-signal', `Alts Signal ${value.toFixed(3)} · ${label}`, tone, 'Dune: Crypto Buy Signal (query 3265994).');
      applyMacroAuto('dune-signal', reading, { force: false, source: 'dune' });
    } catch (error) {
      console.warn('[Dune]', error);
      setMacroLive('dune-signal', '⚠️ Dune no respondio · revisa key/proxy/query', 'is-bear');
    }
  }

  function sortDuneRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const first = rows[0];
    const dateKey = Object.keys(first || {}).find((key) => /date|time|day/i.test(key));
    if (!dateKey) return rows;
    return [...rows].sort((a, b) => {
      const timeA = new Date(a[dateKey]).getTime();
      const timeB = new Date(b[dateKey]).getTime();
      return (Number.isFinite(timeB) ? timeB : 0) - (Number.isFinite(timeA) ? timeA : 0);
    });
  }

  function getNumericByKeys(row, keys) {
    if (!row) return null;
    const normalizedKeys = keys.map((key) => key.toLowerCase());
    for (const [key, rawValue] of Object.entries(row)) {
      const normalized = key.toLowerCase();
      if (normalizedKeys.some((candidate) => normalized === candidate || normalized.includes(candidate))) {
        const number = toFiniteNumber(rawValue);
        if (number != null) return number;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------
     Mercado spot, global, sentimiento y futuros
     ------------------------------------------------------------ */

  async function loadBinanceMarket() {
    try {
      const data = await fetchPublic('https://api.binance.com/api/v3/ticker/24hr', { timeout: 15000 });
      if (!Array.isArray(data)) throw new Error('Binance devolvio un formato inesperado');

      const tickers = data
        .filter(isTradableUsdtPair)
        .map((ticker) => ({
          symbol: String(ticker.symbol),
          lastPrice: toFiniteNumber(ticker.lastPrice),
          priceChangePercent: toFiniteNumber(ticker.priceChangePercent),
          quoteVolume: toFiniteNumber(ticker.quoteVolume)
        }))
        .filter((ticker) => Number.isFinite(ticker.lastPrice) && ticker.lastPrice > 0);

      if (!tickers.length) throw new Error('Binance no devolvio pares USDT validos');

      state.market = { tickers, updatedAt: Date.now() };
      renderSpotTables(tickers);
      updateTopbarTickers(tickers);
      setPublicApiStatus('binance-spot', true);
      updateLastUpdate(state.market.updatedAt, false);
      updateSpotUpdatedAt(state.market.updatedAt, false);
      return tickers;
    } catch (error) {
      console.warn('[Binance Spot]', error);
      setPublicApiStatus('binance-spot', false, 'Sin actualizar');
      if (!state.market) {
        renderSpotRows('gainers-body', []);
        renderSpotRows('losers-body', []);
        renderSpotRows('volume-body', []);
        refreshIcons();
      }
      updateLastUpdate(state.market ? state.market.updatedAt : null, true);
      updateSpotUpdatedAt(state.market ? state.market.updatedAt : null, true);
      throw error;
    }
  }

  function isTradableUsdtPair(ticker) {
    const symbol = String(ticker && ticker.symbol ? ticker.symbol : '');
    if (!symbol.endsWith('USDT')) return false;
    const base = symbol.slice(0, -4);
    if (!base || STABLECOINS.has(base)) return false;
    // Tokens apalancados historicos (BTCUP, ETHDOWN, ETHBULL...), sin afectar
    // tickers reales que casualmente terminan en UP/DOWN como JUP o SYRUP.
    if (/^(BULL|BEAR|(BTC|ETH|BNB|ADA|XRP|DOT|LINK|TRX|EOS|BCH|LTC|XLM|SOL|DOGE)(UP|DOWN|BULL|BEAR))$/.test(base)) return false;
    if (base.includes('_')) return false;

    // Solo mercados que siguen vivos: Binance congela closeTime en los pares
    // con status BREAK, por eso se descartan los snapshots viejos.
    const closeTime = toFiniteNumber(ticker.closeTime);
    if (Number.isFinite(closeTime) && Date.now() - closeTime > MAX_TICKER_AGE_MS) return false;

    const price = toFiniteNumber(ticker.lastPrice);
    const volume = toFiniteNumber(ticker.quoteVolume);
    return Number.isFinite(price) && price > 0 && Number.isFinite(volume) && volume > 0;
  }

  function renderSpotTables(tickers) {
    if (!Array.isArray(tickers) || !tickers.length) {
      renderSpotRows('gainers-body', []);
      renderSpotRows('losers-body', []);
      renderSpotRows('volume-body', []);
      refreshIcons();
      return;
    }

    const gainers = [...tickers]
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
      .slice(0, 10);
    const losers = [...tickers]
      .sort((a, b) => a.priceChangePercent - b.priceChangePercent)
      .slice(0, 10);
    const volume = [...tickers]
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, 10);

    renderSpotRows('gainers-body', gainers);
    renderSpotRows('losers-body', losers);
    renderSpotRows('volume-body', volume);
    refreshIcons();
  }

  function renderSpotRows(tbodyId, rows) {
    const tbody = byId(tbodyId);
    if (!tbody) return;

    if (!Array.isArray(rows) || !rows.length) {
      tbody.innerHTML = emptyTableRow(5, 'Sin datos validos de Binance. Reintenta con el boton Actualizar mercado.');
      return;
    }

    tbody.innerHTML = rows.map((ticker, index) => {
      const base = ticker.symbol.slice(0, -4);
      const change = toFiniteNumber(ticker.priceChangePercent);
      const changeClass = change > 0 ? 'positive' : change < 0 ? 'negative' : 'text-muted';
      return `<tr>
        <td>${String(index + 1).padStart(2, '0')}</td>
        <td>
          <div class="asset-cell">
            <span class="asset-icon">${escapeHtml(base.slice(0, 3))}</span>
            <div><strong>${escapeHtml(base)}</strong><span class="futures-subvalue">USDT</span></div>
          </div>
        </td>
        <td>${formatPrice(ticker.lastPrice)}</td>
        <td class="${changeClass}">${formatSignedPct(change)}</td>
        <td>${formatCompactUSD(ticker.quoteVolume)}</td>
      </tr>`;
    }).join('');
  }

  function emptyTableRow(colspan, message) {
    return `<tr><td colspan="${colspan}"><div class="table-empty compact"><span class="empty-icon"><i data-lucide="wifi-off"></i></span><span>${escapeHtml(message)}</span></div></td></tr>`;
  }

  function updateTopbarTickers(tickers) {
    if (!Array.isArray(tickers)) return;
    const btc = tickers.find((ticker) => ticker.symbol === 'BTCUSDT');
    const eth = tickers.find((ticker) => ticker.symbol === 'ETHUSDT');

    if (btc) {
      setText('topbar-btc', formatPrice(btc.lastPrice));
      const change = byId('topbar-btc-change');
      if (change) {
        change.textContent = formatSignedPct(btc.priceChangePercent);
        change.className = `ticker-change ${btc.priceChangePercent > 0 ? 'up' : btc.priceChangePercent < 0 ? 'down' : 'neutral'}`;
      }
    }

    if (eth) {
      setText('topbar-eth', formatPrice(eth.lastPrice));
      const change = byId('topbar-eth-change');
      if (change) {
        change.textContent = formatSignedPct(eth.priceChangePercent);
        change.className = `ticker-change ${eth.priceChangePercent > 0 ? 'up' : eth.priceChangePercent < 0 ? 'down' : 'neutral'}`;
      }
    }
  }

  async function loadGlobalMarket() {
    try {
      const response = await fetchPublic('https://api.coingecko.com/api/v3/global', { timeout: 15000 });
      const data = response && response.data ? response.data : null;
      if (!data) throw new Error('CoinGecko no devolvio datos globales');

      const marketCap = toFiniteNumber(data.total_market_cap && data.total_market_cap.usd);
      const volume = toFiniteNumber(data.total_volume && data.total_volume.usd);
      const change = toFiniteNumber(data.market_cap_change_percentage_24h_usd);
      const btcDominance = toFiniteNumber(data.market_cap_percentage && data.market_cap_percentage.btc);
      const ethDominance = toFiniteNumber(data.market_cap_percentage && data.market_cap_percentage.eth);
      const active = toFiniteNumber(data.active_cryptocurrencies);
      const markets = toFiniteNumber(data.markets);

      setText('global-market-cap', formatCompactUSD(marketCap));
      setText('global-volume', formatCompactUSD(volume));
      setText('global-volume-change', 'Live');
      const volumeChange = byId('global-volume-change');
      if (volumeChange) volumeChange.className = 'metric-delta neutral';

      const capChange = byId('global-market-cap-change');
      if (capChange) {
        capChange.textContent = formatSignedPct(change);
        capChange.className = `metric-delta ${change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'}`;
      }

      setText('btc-dominance', Number.isFinite(btcDominance) ? `${btcDominance.toFixed(1)}%` : '—');
      setText('btc-dominance-label', Number.isFinite(btcDominance) ? `${btcDominance.toFixed(1)}% del total` : '—');
      const btcBar = byId('btc-dominance-bar');
      if (btcBar) btcBar.style.width = `${Number.isFinite(btcDominance) ? clamp(btcDominance, 0, 100) : 0}%`;

      setText('eth-dominance', Number.isFinite(ethDominance) ? `${ethDominance.toFixed(1)}%` : '—');
      setText('eth-dominance-label', Number.isFinite(ethDominance) ? `${ethDominance.toFixed(1)}% del total` : '—');
      const ethBar = byId('eth-dominance-bar');
      if (ethBar) ethBar.style.width = `${Number.isFinite(ethDominance) ? clamp(ethDominance, 0, 100) : 0}%`;

      setText('active-cryptos', Number.isFinite(active) ? formatNumber(active) : '—');
      setText('active-markets-change', Number.isFinite(markets) ? `${formatNumber(markets)} mercados` : '—');
      const activeChange = byId('active-markets-change');
      if (activeChange) activeChange.className = 'metric-delta neutral';

      setPublicApiStatus('coingecko', true);
      return data;
    } catch (error) {
      console.warn('[CoinGecko Global]', error);
      setPublicApiStatus('coingecko', false, 'Error');
      throw error;
    }
  }

  async function loadFearGreed() {
    try {
      const response = await fetchPublic('https://api.alternative.me/fng/?limit=1', { timeout: 12000 });
      const item = response && Array.isArray(response.data) ? response.data[0] : null;
      if (!item) throw new Error('Fear & Greed no devolvio datos');

      applyFearGreed(item, false);
      saveJSON(STORAGE_KEYS.fearGreedCache, {
        value: toFiniteNumber(item.value),
        classification: item.value_classification,
        updatedAt: Date.now()
      });
      setPublicApiStatus('alternative', true);
      return item;
    } catch (error) {
      console.warn('[Fear & Greed]', error);
      const cached = loadJSON(STORAGE_KEYS.fearGreedCache, null);
      if (cached && Number.isFinite(toFiniteNumber(cached.value))) {
        applyFearGreed(cached, true);
        setPublicApiStatus('alternative', true, 'Cache');
      } else {
        setText('fear-greed-value', '—');
        const label = byId('fear-greed-label');
        if (label) {
          label.className = 'badge badge-neutral';
          label.textContent = 'Sin datos';
        }
        const marker = byId('fear-greed-marker');
        if (marker) marker.style.left = '50%';
        setMacroLive('fear-greed', '⚠️ F&G no disponible · revisa proxy', 'is-bear');
        setPublicApiStatus('alternative', false, 'Error');
      }
      throw error;
    }
  }

  function applyFearGreed(item, fromCache = false) {
    const numeric = toFiniteNumber(item.value);
    if (numeric == null) return;
    const value = clamp(numeric, 0, 100);

    const classification = String(item.value_classification || item.classification || '').trim();
    const labels = {
      'Extreme Fear': 'Miedo extremo',
      Fear: 'Miedo',
      Neutral: 'Neutral',
      Greed: 'Avaricia',
      'Extreme Greed': 'Avaricia extrema'
    };
    const labelText = labels[classification] || classification || 'Sin clasificar';
    const badgeTone = value <= 25 ? 'bull' : value >= 75 ? 'bear' : value >= 45 && value <= 55 ? 'neutral' : 'amber';

    setText('fear-greed-value', String(Math.round(value)));
    const label = byId('fear-greed-label');
    if (label) {
      label.className = `badge badge-${badgeTone}`;
      label.textContent = labelText;
    }
    const marker = byId('fear-greed-marker');
    if (marker) marker.style.left = `${value}%`;

    const reading = value <= 25 ? 'bull' : value >= 75 ? 'bear' : 'neutral';
    const tone = reading === 'bull' ? 'is-bull' : reading === 'bear' ? 'is-bear' : 'is-neutral';
    setMacroLive(
      'fear-greed',
      `F&G ${Math.round(value)}/100 · ${labelText}${fromCache ? ' · cache' : ''}`,
      tone,
      'Alternative.me Crypto Fear & Greed Index.'
    );
    applyMacroAuto('fear-greed', reading, { force: false, source: 'fear-greed' });
  }

  async function loadCbbi() {
    const cached = loadJSON(STORAGE_KEYS.cbbiCache, null);
    if (cached && Number.isFinite(toFiniteNumber(cached.value))) {
      applyCbbi(cached, true);
    }
    try {
      const attempts = [];
      if (IS_LOCAL_NETWORK_HOST) {
        attempts.push('/cbbi');
        attempts.push(`${LOCAL_PROXY}${encodeURIComponent(CBBI_URL)}`);
      }
      // El JSON de CBBI pesa ~2.9 MB y tarda ~10 s: en host estatico conviene
      // pedirlo directo (manda CORS *) y con mas margen que el resto.
      attempts.push(CBBI_URL);
      attempts.push(`${ALLORIGINS_PROXY}${encodeURIComponent(CBBI_URL)}`);
      const response = await fetchFirst(attempts, { timeout: 30000, ttl: 300000 });
      const latest = extractLatestCbbi(response);
      if (!latest) throw new Error('Formato CBBI no reconocido');

      applyCbbi(latest, false);
      saveJSON(STORAGE_KEYS.cbbiCache, {
        value: latest.value,
        timestamp: latest.timestamp,
        updatedAt: Date.now()
      });
      setPublicApiStatus('cbbi', true);
      return latest;
    } catch (error) {
      console.warn('[CBBI]', error);
      const cached = loadJSON(STORAGE_KEYS.cbbiCache, null);
      if (cached && Number.isFinite(toFiniteNumber(cached.value))) {
        applyCbbi(cached, true);
        setPublicApiStatus('cbbi', true, 'Cache');
      } else {
        setMacroLive('cbbi', '⚠️ CBBI bloqueado por CORS · abre la fuente', 'is-bear');
        setPublicApiStatus('cbbi', false, 'Error');
        setText('cbbi-value', '—');
        const cbbiLabel = byId('cbbi-label');
        if (cbbiLabel) {
          cbbiLabel.className = 'badge badge-neutral';
          cbbiLabel.textContent = 'Sin datos';
        }
        const cbbiMarker = byId('cbbi-marker');
        if (cbbiMarker) cbbiMarker.style.left = '50%';
        const cbbiCard = byId('cbbi-sentiment-card');
        if (cbbiCard) cbbiCard.style.borderLeftColor = '#f59e0b';
        setText('cbbi-updated', 'CBBI no disponible · abre la fuente original');
      }
      throw error;
    }
  }

  function extractLatestCbbi(data) {
    if (!data) return null;
    const candidate = data.Confidence ?? data.Confidence2 ?? data.confidence ?? data.Price ?? data.price;
    const source = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : data;

    if (source && typeof source === 'object' && !Array.isArray(source)) {
      const entries = Object.entries(source)
        .map(([key, value]) => [toFiniteNumber(key), toFiniteNumber(value)])
        .filter(([key, value]) => Number.isFinite(key) && Number.isFinite(value));
      if (entries.length) {
        entries.sort((a, b) => b[0] - a[0]);
        const rawValue = entries[0][1];
        return {
          value: clamp(rawValue <= 1.5 ? rawValue * 100 : rawValue, 0, 100),
          timestamp: entries[0][0] * 1000
        };
      }
    }

    if (Array.isArray(data) && data.length) {
      const last = data[data.length - 1];
      const value = toFiniteNumber(last.Confidence ?? last.confidence ?? last.value);
      if (Number.isFinite(value)) {
        return {
          value: clamp(value <= 1.5 ? value * 100 : value, 0, 100),
          timestamp: Date.now()
        };
      }
    }

    return null;
  }

  function applyCbbi(latest, fromCache = false) {
    const numeric = toFiniteNumber(latest.value);
    if (numeric == null) return;
    const value = clamp(numeric, 0, 100);

    const reading = value <= 40 ? 'bull' : value >= 75 ? 'bear' : 'neutral';
    const label = reading === 'bull' ? 'Acumulacion' : reading === 'bear' ? 'Euforia' : 'Zona neutral';
    const tone = reading === 'bull' ? 'is-bull' : reading === 'bear' ? 'is-bear' : 'is-neutral';

    setMacroLive(
      'cbbi',
      `CBBI ${value.toFixed(1)}/100 · ${label}${fromCache ? ' · cache' : ''}`,
      tone,
      `ColinTalksCrypto Bitcoin Bullish Index. Ultimo dato: ${latest.timestamp ? formatFullDate(latest.timestamp) : 'sin fecha'}.`
    );

    const cbbiValue = byId('cbbi-value');
    if (cbbiValue) cbbiValue.textContent = value.toFixed(1);
    const cbbiLabel = byId('cbbi-label');
    if (cbbiLabel) {
      cbbiLabel.className = `badge ${reading === 'bull' ? 'badge-green' : reading === 'bear' ? 'badge-bear' : 'badge-neutral'}`;
      cbbiLabel.textContent = label;
    }
    const cbbiMarker = byId('cbbi-marker');
    if (cbbiMarker) cbbiMarker.style.left = `${value}%`;
    const cbbiCard = byId('cbbi-sentiment-card');
    if (cbbiCard) cbbiCard.style.borderLeftColor = reading === 'bull' ? '#10b981' : reading === 'bear' ? '#ef4444' : '#f59e0b';
    setText('cbbi-updated', latest.timestamp
      ? `Último dato: ${formatShortDate(latest.timestamp)}${fromCache ? ' · cache local' : ''}`
      : `Actualizado: ${formatShortDate(Date.now())}${fromCache ? ' · cache local' : ''}`);

    applyMacroAuto('cbbi', reading, { force: false, source: 'cbbi' });
  }

  async function loadFuturesMonitor() {
    try {
      const [premiumData, tickerData] = await Promise.all([
        fetchPublic('https://fapi.binance.com/fapi/v1/premiumIndex', { timeout: 15000 }),
        fetchPublic('https://fapi.binance.com/fapi/v1/ticker/24hr', { timeout: 15000 })
      ]);

      if (!Array.isArray(premiumData) || !Array.isArray(tickerData)) {
        throw new Error('Binance Futures devolvio un formato inesperado');
      }

      const premiumMap = new Map(premiumData.map((item) => [item.symbol, item]));
      const tickerMap = new Map(tickerData.map((item) => [item.symbol, item]));

      const results = await Promise.all(FUTURES_SYMBOLS.map(async (symbol) => {
        const pair = `${symbol}USDT`;
        const premium = premiumMap.get(pair) || {};
        const ticker = tickerMap.get(pair) || {};

        const ratioResults = await Promise.allSettled([
          fetchPublic(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${pair}`, { timeout: 10000 }),
          fetchPublic(`https://fapi.binance.com/fapi/v1/klines?symbol=${pair}&interval=4h&limit=1`, { timeout: 10000 }),
          fetchPublic(`https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${pair}&period=4h&limit=2`, { timeout: 10000 }),
          BITGET_POSITION_SYMBOLS.has(symbol)
            ? fetchPublic(`https://api.bitget.com/api/v2/mix/market/position-long-short?symbol=${pair}&productType=USDT-FUTURES&period=4h`, { timeout: 10000 })
            : Promise.resolve(null)
        ]);

        const oiJson = ratioResults[0].status === 'fulfilled' ? ratioResults[0].value : null;
        const klinesJson = ratioResults[1].status === 'fulfilled' ? ratioResults[1].value : null;
        const bybitJson = ratioResults[2].status === 'fulfilled' ? ratioResults[2].value : null;
        const bitgetPositionJson = ratioResults[3].status === 'fulfilled' ? ratioResults[3].value : null;

        const markPrice = toFiniteNumber(premium.markPrice);
        const indexPrice = toFiniteNumber(premium.indexPrice);
        const funding = toFiniteNumber(premium.lastFundingRate);
        const nextFundingTime = toFiniteNumber(premium.nextFundingTime);
        const openInterest = toFiniteNumber(oiJson && oiJson.openInterest);
        const change = toFiniteNumber(ticker.priceChangePercent);
        const bybitRatio = bybitLongShortRatio(bybitJson);
        const bitgetPositionRatio = bitgetLongShortRatio(bitgetPositionJson, 'longShortPositionRatio');
        const globalRatio = bybitRatio;
        const globalRatioSource = bybitRatio != null ? 'Bybit account-ratio' : 'Sin fuente';
        const topRatio = bitgetPositionRatio;
        const topRatioSource = bitgetPositionRatio != null ? 'Bitget position-long-short (fallback)' : 'Sin fuente';
        const takerRatio = takerRatioFromFuturesKlines(klinesJson);

        return {
          symbol,
          pair,
          markPrice,
          indexPrice,
          funding,
          nextFundingTime,
          openInterest,
          oiUsd: openInterest != null && markPrice != null ? openInterest * markPrice : null,
          change,
          globalRatio,
          globalRatioSource,
          topRatio,
          topRatioSource,
          takerRatio
        };
      }));

      const valid = results.filter((row) => row.markPrice != null);
      if (!valid.length) throw new Error('Sin datos de futuros para los simbolos configurados');

      valid.forEach((row) => {
        state.futures[row.symbol] = row;
      });
      renderFuturesRows();
      setPublicApiStatus('binance-futures', true);
      return valid;
    } catch (error) {
      console.warn('[Binance Futures]', error);
      setPublicApiStatus('binance-futures', false, 'Error');
      if (!Object.keys(state.futures).length) renderFuturesError();
      throw error;
    }
  }

  function bybitLongShortRatio(json) {
    const list = json && json.result && Array.isArray(json.result.list) ? json.result.list : null;
    if (!list || !list.length) return null;
    const sorted = [...list].sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    const latest = sorted[0];
    const buy = toFiniteNumber(latest && latest.buyRatio);
    const sell = toFiniteNumber(latest && latest.sellRatio);
    if (buy == null || sell == null || buy <= 0 || sell <= 0) return null;
    return buy / sell;
  }

  function bitgetLongShortRatio(json, ratioKey) {
    const list = json && Array.isArray(json.data) ? json.data : null;
    if (!list || !list.length) return null;
    const sorted = [...list].sort((a, b) => Number(b.ts) - Number(a.ts));
    const latest = sorted[0];
    const direct = toFiniteNumber(latest && latest[ratioKey]);
    if (direct != null) return direct;
    const longKey = ratioKey === 'longShortAccountRatio' ? 'longAccountRatio' : 'longPositionRatio';
    const shortKey = ratioKey === 'longShortAccountRatio' ? 'shortAccountRatio' : 'shortPositionRatio';
    const longValue = toFiniteNumber(latest && latest[longKey]);
    const shortValue = toFiniteNumber(latest && latest[shortKey]);
    if (longValue == null || shortValue == null || shortValue <= 0) return null;
    return longValue / shortValue;
  }

  function takerRatioFromFuturesKlines(json) {
    if (!Array.isArray(json) || !json.length) return null;
    const candle = json[json.length - 1];
    if (!Array.isArray(candle)) return null;
    return calculateTakerRatio(candle[7], candle[10]);
  }

  function takerRatioFromCandle(candle) {
    if (!candle) return null;
    return calculateTakerRatio(candle.quoteVolume, candle.takerBuyQuote);
  }

  function calculateTakerRatio(quoteVolumeRaw, takerBuyQuoteRaw) {
    const quoteVolume = toFiniteNumber(quoteVolumeRaw);
    const takerBuyQuote = toFiniteNumber(takerBuyQuoteRaw);
    if (quoteVolume == null || takerBuyQuote == null || quoteVolume <= 0) return null;
    const takerSellQuote = quoteVolume - takerBuyQuote;
    if (takerSellQuote <= 0) return null;
    return takerBuyQuote / takerSellQuote;
  }

  function latestRatio(json, key) {
    if (!Array.isArray(json) || !json.length) return null;
    for (let index = json.length - 1; index >= 0; index -= 1) {
      const value = toFiniteNumber(json[index] ? json[index][key] : null);
      if (value != null) return value;
    }
    return null;
  }

  function deriveFuturesBias(row) {
    let score = 0;
    const funding = toFiniteNumber(row.funding);
    const top = toFiniteNumber(row.topRatio);
    const global = toFiniteNumber(row.globalRatio);
    const taker = toFiniteNumber(row.takerRatio);

    if (funding != null) {
      if (funding > 0.0003) score -= 2;
      else if (funding < -0.0001) score += 2;
    }
    if (top != null) {
      if (top > 1.15) score += 2;
      else if (top < 0.85) score -= 2;
    }
    if (taker != null) {
      if (taker > 1.05) score += 1;
      else if (taker < 0.95) score -= 1;
    }
    if (global != null) {
      if (global > 1.2) score += 1;
      else if (global < 0.8) score -= 1;
    }
    if (top != null && global != null) {
      if (top > global + 0.1) score += 1;
      else if (top < global - 0.1) score -= 1;
    }

    if (score >= 3) return { label: 'Alcista', tone: 'buy' };
    if (score <= -3) return { label: 'Bajista', tone: 'sell' };
    if (funding != null && funding > 0.0003 && top != null && top > 1.1) {
      return { label: 'Longs saturados', tone: 'sell' };
    }
    if (funding != null && funding < -0.0001 && top != null && top < 0.9) {
      return { label: 'Shorts saturados', tone: 'buy' };
    }
    return { label: 'Neutral', tone: 'neutral' };
  }

  function renderFuturesRows() {
    const tbody = byId('futures-monitor-body');
    if (!tbody) return;

    const rows = FUTURES_SYMBOLS
      .map((symbol) => state.futures[symbol])
      .filter(Boolean);

    if (!rows.length) {
      renderFuturesError();
      return;
    }

    tbody.innerHTML = rows.map((row) => {
      const change = toFiniteNumber(row.change);
      const top = toFiniteNumber(row.topRatio);
      const taker = toFiniteNumber(row.takerRatio);
      const funding = toFiniteNumber(row.funding);
      const changeClass = change != null && change > 0 ? 'positive' : change != null && change < 0 ? 'negative' : 'text-muted';
      const topClass = top != null && top > 1.05 ? 'long' : top != null && top < 0.95 ? 'short' : '';
      const takerClass = taker != null && taker > 1.05 ? 'long' : taker != null && taker < 0.95 ? 'short' : '';
      const fundingClass = funding != null && funding > 0 ? 'positive' : funding != null && funding < 0 ? 'negative' : 'text-muted';
      const extremeFunding = funding != null && Math.abs(funding) >= 0.0003 ? 'is-extreme' : '';
      const bias = deriveFuturesBias(row);
      const selected = state.selectedSymbol === row.symbol ? 'is-selected' : '';
      const topTitle = top == null ? 'Top Trader L/S no disponible por CORS; se conserva el resto de la lectura.' : `Top L/S 4H · Fuente: ${row.topRatioSource || 'Sin fuente'}`;
      const globalTitle = `Global L/S 4H · Fuente: ${row.globalRatioSource || 'Sin fuente'}`;

      return `<tr class="${selected}" data-futures-symbol="${escapeHtml(row.symbol)}" title="Clic para analizar ${escapeHtml(row.symbol)} en la matriz 4H/1D">
        <td>
          <div class="asset-cell">
            <span class="asset-icon ${row.symbol.toLowerCase()}">${escapeHtml(row.symbol)}</span>
            <div><strong>${escapeHtml(row.symbol)}</strong><span class="futures-subvalue">Perpetuo</span></div>
          </div>
        </td>
        <td>
          <strong>${formatPrice(row.markPrice)}</strong>
          <small class="futures-subvalue">Index ${formatPrice(row.indexPrice)}</small>
        </td>
        <td class="${changeClass}">${change == null ? '—' : formatSignedPct(change)}</td>
        <td>${formatCompactUSD(row.oiUsd)}</td>
        <td>
          <span class="funding-value ${fundingClass} ${extremeFunding}">${formatFunding(funding)}</span>
          <small class="funding-countdown" data-next-funding="${row.nextFundingTime || ''}">--:--:--</small>
        </td>
        <td>
          <span class="ratio-pill ${topClass}" title="${escapeHtml(topTitle)}">${formatRatio(top)}</span>
          <small class="futures-subvalue" title="${escapeHtml(globalTitle)}">Global ${formatRatio(row.globalRatio)}</small>
        </td>
        <td><span class="ratio-pill ${takerClass}" title="Taker Buy/Sell 4H calculado con velas de Binance Futures">${formatRatio(taker)}</span></td>
        <td><span class="signal-pill ${bias.tone}">${escapeHtml(bias.label)}</span></td>
      </tr>`;
    }).join('');

    $$('#futures-monitor-body tr[data-futures-symbol]').forEach((row) => {
      row.addEventListener('click', () => selectDecisionSymbol(row.dataset.futuresSymbol, true));
    });

    updateFundingCountdowns();
    renderDeltaNeutralTable();
    refreshIcons();
  }

  function renderFuturesError() {
    const tbody = byId('futures-monitor-body');
    if (!tbody) return;
    tbody.innerHTML = emptyTableRow(8, 'Binance Futures no respondio. Se mantiene el ultimo dato valido si existe.');
    refreshIcons();
  }

  /* ------------------------------------------------------------
     Panel 02 · Reloj de sesiones institucionales + Delta-Neutral
     ------------------------------------------------------------ */

  const INSTITUTIONAL_SESSIONS = [
    { id: 'asia', label: 'Asia', start: 0, end: 4, startLabel: '00:00', endLabel: '04:00' },
    { id: 'london', label: 'Londres', start: 7, end: 10, startLabel: '07:00', endLabel: '10:00' },
    { id: 'newyork', label: 'Nueva York', start: 12, end: 15, startLabel: '12:00', endLabel: '15:00' }
  ];
  let sessionClockTimer = null;
  let deltaNeutralInitialized = false;

  function padClock(value) {
    return String(value).padStart(2, '0');
  }

  function formatSessionCountdown(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return `${padClock(hours)}:${padClock(minutes)}:${padClock(rest)}`;
  }

  function initInstitutionalSessionClock() {
    if (sessionClockTimer) window.clearInterval(sessionClockTimer);
    updateInstitutionalSessionClock();
    sessionClockTimer = window.setInterval(updateInstitutionalSessionClock, 1000);
  }

  function updateInstitutionalSessionClock() {
    const clock = byId('session-utc-clock');
    const dateLabel = byId('session-utc-date');
    if (!clock) return;
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const utcSeconds = now.getUTCSeconds();
    const nowSeconds = (utcHours * 3600) + (utcMinutes * 60) + utcSeconds;
    const nowMinutes = nowSeconds / 60;

    clock.textContent = `${padClock(utcHours)}:${padClock(utcMinutes)}:${padClock(utcSeconds)} UTC`;
    if (dateLabel) {
      dateLabel.textContent = now.toLocaleDateString('es-ES', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
      });
    }

    const sessionStates = INSTITUTIONAL_SESSIONS.map((session) => {
      const startSeconds = session.start * 3600;
      const endSeconds = session.end * 3600;
      const active = nowSeconds >= startSeconds && nowSeconds < endSeconds;
      const secondsToStart = active ? 0 : (nowSeconds < startSeconds ? startSeconds - nowSeconds : (86400 - nowSeconds) + startSeconds);
      const secondsToEnd = active ? endSeconds - nowSeconds : 0;
      const progress = active ? ((nowSeconds - startSeconds) / (endSeconds - startSeconds)) * 100 : 0;
      return { session, active, secondsToStart, secondsToEnd, progress };
    });

    const nextState = sessionStates
      .filter((item) => !item.active)
      .sort((a, b) => a.secondsToStart - b.secondsToStart)[0] || null;

    sessionStates.forEach((item) => {
      const card = byId(`session-${item.session.id}`);
      if (!card) return;
      const state = card.querySelector('.session-state');
      const bar = card.querySelector('.session-progress span');
      card.classList.toggle('is-active', item.active);
      card.classList.toggle('is-next', Boolean(nextState && nextState.session.id === item.session.id));
      if (state) {
        if (item.active) {
          state.textContent = `🟢 ACTIVA · cierra en ${formatSessionCountdown(item.secondsToEnd)}`;
        } else if (nextState && nextState.session.id === item.session.id) {
          state.textContent = `⏳ Próxima en ${formatSessionCountdown(item.secondsToStart)}`;
        } else {
          state.textContent = '⚪ Cerrada';
        }
      }
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, item.progress))}%`;
    });
  }

  function initDeltaNeutralTable() {
    if (deltaNeutralInitialized) return;
    deltaNeutralInitialized = true;
    const body = byId('delta-neutral-body');
    if (body) {
      body.addEventListener('click', (event) => {
        const button = event.target.closest('[data-delta-symbol]');
        if (!button) return;
        const symbol = button.dataset.deltaSymbol;
        if (symbol) selectDecisionSymbol(symbol, true);
      });
    }
    renderDeltaNeutralTable();
  }

  function renderDeltaNeutralTable() {
    const body = byId('delta-neutral-body');
    if (!body) return;
    const rows = FUTURES_SYMBOLS
      .map((symbol) => state.futures[symbol])
      .filter(Boolean)
      .map((row) => {
        const funding = toFiniteNumber(row.funding);
        const apr = funding == null ? null : Math.abs(funding) * 3 * 365 * 100;
        return { ...row, fundingValue: funding, apr };
      })
      .sort((a, b) => (b.apr == null ? -Infinity : b.apr) - (a.apr == null ? -Infinity : a.apr));

    if (!rows.length) {
      body.innerHTML = '<tr class="placeholder-row"><td colspan="7"><div class="table-empty compact"><span class="loading-orbit"><i data-lucide="loader-circle"></i></span><span>Esperando datos de funding de Binance Futures…</span></div></td></tr>';
      setText('delta-neutral-best', 'Sin datos');
      setText('delta-neutral-updated', 'Sin sincronizar');
      refreshIcons();
      return;
    }

    body.innerHTML = rows.map((row) => {
      const funding = row.fundingValue;
      const apr = row.apr;
      const aprClass = apr == null ? 'is-low' : apr >= 20 ? 'is-high' : apr >= 5 ? 'is-medium' : 'is-low';
      const direction = funding == null || Math.abs(funding) < 1e-12
        ? 'Neutral / sin funding'
        : funding > 0
          ? 'Long spot / Short perp'
          : 'Short spot / Long perp';
      const directionClass = funding == null || Math.abs(funding) < 1e-12
        ? ''
        : funding > 0 ? 'is-long-spot' : 'is-short-spot';
      const nextFunding = Number.isFinite(row.nextFundingTime)
        ? formatClock(Math.max(0, row.nextFundingTime - Date.now()))
        : '—';
      return `<tr>
        <td><div class="delta-neutral-asset"><span class="asset-icon ${escapeHtml(row.symbol.toLowerCase())}">${escapeHtml(row.symbol)}</span><span>${escapeHtml(row.symbol)}USDT</span></div></td>
        <td><span class="funding-value ${funding == null ? 'text-muted' : funding > 0 ? 'positive' : 'negative'}">${formatFunding(funding)}</span></td>
        <td><span class="delta-neutral-apr ${aprClass}">${apr == null ? '—' : `${apr.toFixed(2)}% APR`}</span></td>
        <td><span class="delta-neutral-direction ${directionClass}">${escapeHtml(direction)}</span></td>
        <td>${formatPrice(row.markPrice)} <small class="futures-subvalue">/ ${formatPrice(row.indexPrice)}</small></td>
        <td><span class="funding-countdown" data-next-funding="${row.nextFundingTime || ''}">${escapeHtml(nextFunding)}</span></td>
        <td><button class="delta-neutral-select" type="button" data-delta-symbol="${escapeHtml(row.symbol)}">Analizar</button></td>
      </tr>`;
    }).join('');

    const best = rows.find((row) => row.apr != null);
    if (best) {
      setText('delta-neutral-best', `Mejor APR: ${best.symbol} · ${best.apr.toFixed(2)}%`);
    } else {
      setText('delta-neutral-best', 'Sin funding válido');
    }
    setText('delta-neutral-updated', `Actualizado ${formatTimeWithSeconds(Date.now())}`);
    refreshIcons();
  }

  function updateFundingCountdowns() {
    const now = Date.now();
    $$('[data-next-funding]').forEach((element) => {
      const next = Number(element.dataset.nextFunding);
      if (!Number.isFinite(next) || next <= 0) {
        element.textContent = '—';
        return;
      }
      element.textContent = formatClock(next - now);
    });
  }

  function startFundingCountdown() {
    if (state.fundingTimer) window.clearInterval(state.fundingTimer);
    updateFundingCountdowns();
    state.fundingTimer = window.setInterval(updateFundingCountdowns, 1000);
  }

  function setPublicApiStatus(id, ok, label) {
    const item = document.querySelector(`[data-public-api="${id}"]`);
    if (!item) return;
    const status = item.querySelector('.public-api-status');
    if (!status) return;
    status.classList.toggle('is-error', !ok);
    status.innerHTML = `<span class="status-dot"></span>${escapeHtml(label || (ok ? 'Conectado' : 'Error'))}`;
  }

  async function refreshMarketData({ silent = false } = {}) {
    if (state.isRefreshing) return;
    state.isRefreshing = true;
    setRefreshButtonsLoading(true);

    const results = await Promise.allSettled([
      loadBinanceMarket(),
      loadGlobalMarket(),
      loadFearGreed(),
      loadCbbi(),
      loadFuturesMonitor()
    ]);

    state.isRefreshing = false;
    setRefreshButtonsLoading(false);

    await loadDecisionEngine();

    const failures = results.filter((result) => result.status === 'rejected');
    if (!silent && failures.length) {
      showToast(`${failures.length} fuente(s) no respondieron. Se conserva el ultimo dato valido y se muestra el error en su tarjeta.`, 'warning');
    }
  }

  function updateLastUpdate(timestamp = Date.now(), stale = false) {
    const element = byId('market-last-update');
    if (!element) return;
    if (!timestamp) {
      element.textContent = '⚠️ Sin conexión';
      element.title = 'No se pudo consultar Binance Spot.';
      element.classList.add('is-stale');
      return;
    }
    const date = new Date(timestamp);
    element.textContent = `${stale ? '⚠️ ' : ''}${formatShortDateTime(date)}`;
    element.title = `${stale ? 'Ultima actualizacion correcta' : 'Ultima actualizacion'}: ${formatFullDate(date)}`;
    element.classList.toggle('is-stale', stale);
  }

  function updateSpotUpdatedAt(timestamp, stale) {
    const label = timestamp
      ? `${stale ? '⚠️ Sin actualizar · ' : 'Actualizado '}${formatTimeWithSeconds(timestamp)}`
      : 'Sin datos';
    $$('[data-spot-updated]').forEach((element) => {
      element.textContent = label;
      element.classList.toggle('is-stale', Boolean(stale));
      element.title = timestamp
        ? `${stale ? 'Ultima actualizacion correcta' : 'Actualizado'}: ${formatFullDate(timestamp)} · Solo mercados activos (ticker ≤ 60 min)`
        : 'Sin datos de Binance';
    });
  }

  function setRefreshButtonsLoading(loading) {
    ['market-refresh', 'futures-refresh'].forEach((id) => {
      const button = byId(id);
      if (!button) return;
      button.disabled = loading;
      button.classList.toggle('is-loading', loading);
    });
  }

  /* ------------------------------------------------------------
     Selector de activo, botones de refresco y matriz 4H/1D
     ------------------------------------------------------------ */

  function initDecisionControls() {
    const select = byId('decision-symbol');
    if (select) {
      select.addEventListener('change', () => selectDecisionSymbol(select.value, true));
    }
    updateSelectedFuturesRow();
  }

  function initRefreshButtons() {
    byId('market-refresh')?.addEventListener('click', () => {
      refreshMarketData({ silent: false });
    });

    byId('futures-refresh')?.addEventListener('click', () => {
      refreshFuturesOnly();
    });
  }

  function loadSelectedSymbol() {
    if (!FUTURES_SYMBOLS.includes(state.selectedSymbol)) state.selectedSymbol = 'BTC';
    const select = byId('decision-symbol');
    if (select) select.value = state.selectedSymbol;
    updateSelectedFuturesRow();
  }

  function updateSelectedFuturesRow() {
    $$('#futures-monitor-body tr[data-futures-symbol]').forEach((row) => {
      row.classList.toggle('is-selected', row.dataset.futuresSymbol === state.selectedSymbol);
    });
  }

  function selectDecisionSymbol(symbol, announce = false) {
    const normalized = String(symbol || '').toUpperCase();
    if (!FUTURES_SYMBOLS.includes(normalized)) return;

    state.selectedSymbol = normalized;
    saveText(STORAGE_KEYS.selectedSymbol, normalized);
    const select = byId('decision-symbol');
    if (select) select.value = normalized;
    updateSelectedFuturesRow();
    loadDecisionEngine();
    document.dispatchEvent(new CustomEvent('crypto:intel:asset-updated', {
      detail: { mode: 'token', symbol: normalized, name: normalized, address: '', chain: '', slug: '' }
    }));

    if (announce) showToast(`Matriz 4H/1D recalculada para ${normalized}.`, 'info');
  }

  async function refreshFuturesOnly() {
    if (state.isRefreshing) return;
    state.isRefreshing = true;
    setRefreshButtonsLoading(true);
    try {
      await loadFuturesMonitor();
      await loadDecisionEngine();
      showToast('Futuros, funding y ratios actualizados.', 'success');
    } catch (error) {
      console.warn('[Futures Refresh]', error);
      showToast('No se pudieron actualizar los futuros. Se conserva el ultimo dato valido.', 'warning');
    } finally {
      state.isRefreshing = false;
      setRefreshButtonsLoading(false);
    }
  }

  async function loadDecisionEngine() {
    if (state.isDecisionLoading) {
      state.pendingDecisionReload = true;
      return;
    }
    state.isDecisionLoading = true;
    setDecisionLoading(true);

    try {
      const symbol = state.selectedSymbol;
      const [klines4h, klines1d] = await Promise.all([
        fetchKlines(symbol, '4h', 200),
        fetchKlines(symbol, '1d', 200)
      ]);

      state.klines['4h'] = klines4h;
      state.klines['1d'] = klines1d;

      const futures = state.futures[symbol] || null;
      const macro = { score: state.lastMacroScore, count: state.lastMacroCount };
      const externalLogin = getExternalLoginBiasPoints();
      const decision4h = buildDecision('4h', klines4h, futures, macro, externalLogin);
      const decision1d = buildDecision('1d', klines1d, futures, macro, externalLogin);

      state.decisions['4h'] = decision4h;
      state.decisions['1d'] = decision1d;

      renderDecisionCard('4h', decision4h);
      renderDecisionCard('1d', decision1d);
      updateFinalDecision();
      setDecisionLoading(false);
    } catch (error) {
      console.warn('[Decision Engine]', error);
      state.decisions['4h'] = null;
      state.decisions['1d'] = null;
      renderDecisionError('4h');
      renderDecisionError('1d');
      setDecisionLoading(false);
      showToast(`No se pudieron cargar las velas de ${state.selectedSymbol}. Revisa conexion/proxy y reintenta.`, 'warning');
    } finally {
      state.isDecisionLoading = false;
      if (state.pendingDecisionReload) {
        state.pendingDecisionReload = false;
        window.setTimeout(() => loadDecisionEngine(), 0);
      }
    }
  }

  function rebuildDecisionsFromCache() {
    if (state.isDecisionLoading) return false;
    const klines4h = state.klines['4h'];
    const klines1d = state.klines['1d'];
    if (!Array.isArray(klines4h) || !Array.isArray(klines1d)) return false;

    const futures = state.futures[state.selectedSymbol] || null;
    const macro = { score: state.lastMacroScore, count: state.lastMacroCount };
    const externalLogin = getExternalLoginBiasPoints();
    const decision4h = buildDecision('4h', klines4h, futures, macro, externalLogin);
    const decision1d = buildDecision('1d', klines1d, futures, macro, externalLogin);

    state.decisions['4h'] = decision4h;
    state.decisions['1d'] = decision1d;
    renderDecisionCard('4h', decision4h);
    renderDecisionCard('1d', decision1d);
    updateFinalDecision();
    return true;
  }

  function setDecisionLoading(loading) {
    if (!loading) return;
    ['4h', '1d'].forEach((timeframe) => {
      if (state.decisions[timeframe]) return;
      const badge = byId(`decision-${timeframe}-badge`);
      if (badge) {
        badge.className = 'badge badge-neutral';
        badge.textContent = 'Cargando';
      }
    });
  }

  async function fetchKlines(symbol, interval, limit = 200) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(`${symbol}USDT`)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const data = await fetchJSON(url, { timeout: 15000 });
    if (!Array.isArray(data) || data.length < 60) {
      throw new Error(`Velas insuficientes para ${symbol} ${interval}`);
    }
    return data.map((candle) => ({
      time: toFiniteNumber(candle[0]),
      open: toFiniteNumber(candle[1]),
      high: toFiniteNumber(candle[2]),
      low: toFiniteNumber(candle[3]),
      close: toFiniteNumber(candle[4]),
      volume: toFiniteNumber(candle[5]),
      closeTime: toFiniteNumber(candle[6]),
      quoteVolume: toFiniteNumber(candle[7]),
      takerBuyQuote: toFiniteNumber(candle[10])
    })).filter((candle) => (
      Number.isFinite(candle.open) && candle.open > 0
      && Number.isFinite(candle.high) && candle.high > 0
      && Number.isFinite(candle.low) && candle.low > 0
      && Number.isFinite(candle.close) && candle.close > 0
    ));
  }

  function calculateEMA(prices, period) {
    if (!Array.isArray(prices) || prices.length < period || period <= 0) return [];
    const multiplier = 2 / (period + 1);
    const result = new Array(prices.length).fill(null);
    let sum = 0;
    for (let index = 0; index < period; index += 1) sum += prices[index];
    let ema = sum / period;
    result[period - 1] = ema;
    for (let index = period; index < prices.length; index += 1) {
      ema = prices[index] * multiplier + ema * (1 - multiplier);
      result[index] = ema;
    }
    return result;
  }

  function calculateRSI(prices, period = 14) {
    if (!Array.isArray(prices) || prices.length <= period || period <= 0) return [];
    const result = new Array(prices.length).fill(null);
    let gain = 0;
    let loss = 0;

    for (let index = 1; index <= period; index += 1) {
      const change = prices[index] - prices[index - 1];
      if (change >= 0) gain += change;
      else loss -= change;
    }

    let averageGain = gain / period;
    let averageLoss = loss / period;
    result[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);

    for (let index = period + 1; index < prices.length; index += 1) {
      const change = prices[index] - prices[index - 1];
      const currentGain = Math.max(change, 0);
      const currentLoss = Math.max(-change, 0);
      averageGain = (averageGain * (period - 1) + currentGain) / period;
      averageLoss = (averageLoss * (period - 1) + currentLoss) / period;
      result[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
    }

    return result;
  }

  function calculateATR(klines, period = 14) {
    if (!Array.isArray(klines) || klines.length <= period || period <= 0) return [];
    const trueRanges = klines.map((candle, index) => {
      if (index === 0) return candle.high - candle.low;
      const previousClose = klines[index - 1].close;
      return Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose)
      );
    });

    const result = new Array(klines.length).fill(null);
    let atr = trueRanges.slice(1, period + 1).reduce((total, value) => total + value, 0) / period;
    result[period] = atr;

    for (let index = period + 1; index < klines.length; index += 1) {
      atr = (atr * (period - 1) + trueRanges[index]) / period;
      result[index] = atr;
    }
    return result;
  }

  function lastNonNull(series) {
    if (!Array.isArray(series)) return null;
    for (let index = series.length - 1; index >= 0; index -= 1) {
      if (Number.isFinite(series[index])) return series[index];
    }
    return null;
  }

  function buildDecision(timeframe, klines, futures, macro, externalLogin = null) {
    const closes = klines.map((candle) => candle.close);
    const ema20Series = calculateEMA(closes, 20);
    const ema50Series = calculateEMA(closes, 50);
    const ema200Series = calculateEMA(closes, 200);
    const rsiSeries = calculateRSI(closes, 14);
    const atrSeries = calculateATR(klines, 14);

    const price = closes[closes.length - 1];
    const ema20 = lastNonNull(ema20Series);
    const ema50 = lastNonNull(ema50Series);
    const ema200 = lastNonNull(ema200Series);
    const rsi = lastNonNull(rsiSeries);
    const atr = lastNonNull(atrSeries);

    const trend = calculateTrendFactor(price, ema20, ema50, ema200, ema20Series, ema50Series);
    const rsiFactor = calculateRsiFactor(rsi);
    const effectiveTakerRatio = takerRatioFromCandle(klines[klines.length - 1]) ?? (futures ? futures.takerRatio : null);
    const takerFactor = calculateTakerFactor(effectiveTakerRatio);
    const positioning = calculatePositioningFactor(futures);
    const macroPoints = macro && Number.isFinite(macro.score)
      ? clamp(((macro.score - 50) / 50) * 15, -15, 15)
      : 0;
    const externalPoints = externalLogin && Number.isFinite(externalLogin.points) ? externalLogin.points : 0;
    const externalCount = externalLogin && Number.isFinite(externalLogin.count) ? externalLogin.count : 0;
    const externalBullish = externalLogin && Number.isFinite(externalLogin.bullish) ? externalLogin.bullish : 0;
    const externalBearish = externalLogin && Number.isFinite(externalLogin.bearish) ? externalLogin.bearish : 0;
    const externalLabel = externalCount
      ? `${externalPoints > 0 ? '🟢' : externalPoints < 0 ? '🔴' : '🟡'} ${signedPoints(externalPoints)} pts · ${externalBullish}🟢/${externalBearish}🔴`
      : 'Sin lecturas';
    const raw = clamp(
      trend.points + rsiFactor.points + takerFactor.points + positioning.points + macroPoints + externalPoints,
      -100,
      100
    );
    const displayScore = Math.round((raw + 100) / 2);
    const macroCount = macro && Number.isFinite(macro.count) ? macro.count : 0;
    const confidence = Math.round(clamp(
      50 + Math.abs(raw) * 0.35 + (macroCount / 15) * 8 + (futures ? 4 : 0),
      50,
      96
    ));
    const verdict = getVerdict(raw);
    const levels = calculateLevels(price, ema20, atr, raw);

    return {
      timeframe,
      price,
      indicators: {
        ema20,
        ema50,
        ema200,
        rsi,
        atr,
        funding: futures ? futures.funding : null,
        topRatio: futures ? futures.topRatio : null,
        globalRatio: futures ? futures.globalRatio : null,
        takerRatio: effectiveTakerRatio
      },
      factors: {
        trend,
        rsi: rsiFactor,
        taker: takerFactor,
        funding: { points: positioning.fundingPoints, label: positioning.fundingLabel },
        ls: { points: positioning.lsPoints, label: positioning.lsLabel },
        positioning,
        macro: {
          points: macroPoints,
          label: macro && Number.isFinite(macro.score) ? `${macro.score}/100` : 'Sin evaluar'
        },
        external: {
          points: externalPoints,
          count: externalCount,
          label: externalLabel
        }
      },
      raw,
      displayScore,
      confidence,
      verdict,
      levels
    };
  }

  function calculateTrendFactor(price, ema20, ema50, ema200, ema20Series, ema50Series) {
    let points = 0;
    if (Number.isFinite(price) && Number.isFinite(ema20)) points += price > ema20 ? 6 : -6;
    if (Number.isFinite(price) && Number.isFinite(ema50)) points += price > ema50 ? 7 : -7;
    if (Number.isFinite(price) && Number.isFinite(ema200)) points += price > ema200 ? 9 : -9;
    if (Number.isFinite(ema20) && Number.isFinite(ema50)) points += ema20 > ema50 ? 4 : -4;
    if (Number.isFinite(ema50) && Number.isFinite(ema200)) points += ema50 > ema200 ? 4 : -4;

    const start = Math.max(1, ema20Series.length - 4);
    for (let index = start; index < ema20Series.length; index += 1) {
      const previous20 = ema20Series[index - 1];
      const previous50 = ema50Series[index - 1];
      const current20 = ema20Series[index];
      const current50 = ema50Series[index];
      if ([previous20, previous50, current20, current50].every(Number.isFinite)) {
        if (previous20 <= previous50 && current20 > current50) {
          points += 3;
          break;
        }
        if (previous20 >= previous50 && current20 < current50) {
          points -= 3;
          break;
        }
      }
    }

    points = clamp(points, -30, 30);
    const label = points >= 15 ? 'Alcista fuerte' : points >= 5 ? 'Alcista' : points <= -15 ? 'Bajista fuerte' : points <= -5 ? 'Bajista' : 'Mixta';
    return { points, label };
  }

  function calculateRsiFactor(rsi) {
    if (!Number.isFinite(rsi)) return { points: 0, label: 'Sin datos' };
    if (rsi < 30) return { points: 20, label: 'Sobreventa extrema' };
    if (rsi < 35) return { points: 14, label: 'Sobreventa' };
    if (rsi < 45) return { points: 6, label: 'Debil' };
    if (rsi <= 55) return { points: 0, label: 'Neutral' };
    if (rsi <= 65) return { points: 10, label: 'Fuerza' };
    if (rsi <= 72) return { points: 4, label: 'Sobrecompra moderada' };
    if (rsi <= 80) return { points: -10, label: 'Sobrecompra' };
    return { points: -18, label: 'Sobrecompra extrema' };
  }

  function calculateTakerFactor(ratio) {
    if (!Number.isFinite(ratio)) return { points: 0, label: 'Sin datos' };
    if (ratio >= 1.15) return { points: 20, label: 'Compra agresiva' };
    if (ratio >= 1.05) return { points: 14, label: 'Compradores' };
    if (ratio >= 1.01) return { points: 5, label: 'Leve compra' };
    if (ratio >= 0.99) return { points: 0, label: 'Equilibrado' };
    if (ratio >= 0.95) return { points: -5, label: 'Leve venta' };
    if (ratio >= 0.85) return { points: -14, label: 'Vendedores' };
    return { points: -20, label: 'Venta agresiva' };
  }

  function calculatePositioningFactor(futures) {
    if (!futures) {
      return {
        points: 0,
        fundingPoints: 0,
        lsPoints: 0,
        label: 'Sin datos',
        fundingLabel: 'Sin datos',
        lsLabel: 'Sin datos'
      };
    }

    const funding = toFiniteNumber(futures.funding);
    const top = toFiniteNumber(futures.topRatio);
    const global = toFiniteNumber(futures.globalRatio);
    let fundingPoints = 0;
    let fundingLabel = 'Sin datos';

    if (funding != null) {
      fundingLabel = 'Neutral';
      if (funding > 0.0003) {
        fundingPoints -= 8;
        fundingLabel = 'Longs pagan';
      } else if (funding < -0.0001) {
        fundingPoints += 6;
        fundingLabel = 'Shorts pagan';
      }
    }

    let lsPoints = 0;
    let lsLabel = 'Sin datos';
    if (top != null) {
      lsLabel = 'Alineado';
      if (top > 1.15) {
        lsPoints += 6;
        lsLabel = 'Ballenas long';
      } else if (top < 0.85) {
        lsPoints -= 6;
        lsLabel = 'Ballenas short';
      }
    }
    if (top != null && global != null) {
      if (top > global + 0.1) {
        lsPoints += 3;
        lsLabel = 'Ballenas > retail';
      } else if (top < global - 0.1) {
        lsPoints -= 3;
        lsLabel = 'Ballenas < retail';
      }
    }
    if (top != null && funding != null && top > 1.1 && funding <= 0.0001) {
      lsPoints += 3;
      lsLabel = 'Short squeeze';
    }
    if (top != null && funding != null && top < 0.9 && funding >= 0.0002) {
      lsPoints -= 3;
      lsLabel = 'Long squeeze';
    }

    const points = clamp(fundingPoints + lsPoints, -15, 15);
    const label = points > 0 ? 'Alcista' : points < 0 ? 'Bajista' : 'Neutral';
    return { points, fundingPoints, lsPoints, label, fundingLabel, lsLabel };
  }

  function calculateLevels(price, ema20, atr, raw) {
    const atrSafe = Number.isFinite(atr) && atr > 0 ? atr : price * 0.02;
    const direction = raw >= 0 ? 1 : -1;
    let entry = price;

    if (raw >= 25 && Number.isFinite(ema20)) entry = Math.min(price, ema20);
    else if (raw <= -25 && Number.isFinite(ema20)) entry = Math.max(price, ema20);

    const stop = entry - direction * 1.5 * atrSafe;
    const target = entry + direction * 3 * atrSafe;
    return { entry, stop, target, direction, atr: atrSafe };
  }

  function getVerdict(raw) {
    if (raw >= 60) return { label: '🟢 COMPRA FUERTE / SWING LONG', short: 'Compra fuerte', tone: 'bull' };
    if (raw >= 25) return { label: '🟢 BUSCAR LONG EN RETROCESO A EMA', short: 'Long retroceso', tone: 'bull' };
    if (raw > -25) return { label: '🟡 NEUTRAL / ESPERAR CONFIRMACIÓN', short: 'Neutral', tone: 'neutral' };
    if (raw > -60) return { label: '🔴 BUSCAR SHORT', short: 'Short', tone: 'bear' };
    return { label: '🔴 VENTA / TOMA DE GANANCIAS', short: 'Venta', tone: 'bear' };
  }

  function renderDecisionCard(timeframe, decision) {
    const ring = byId(`decision-${timeframe}-ring`);
    if (ring) {
      ring.style.setProperty('--score', String(decision.displayScore));
      ring.classList.remove('is-bull', 'is-bear', 'is-neutral');
      ring.classList.add(decision.verdict.tone === 'bull' ? 'is-bull' : decision.verdict.tone === 'bear' ? 'is-bear' : 'is-neutral');
    }

    setText(`decision-${timeframe}-score`, decision.displayScore);
    setText(`decision-${timeframe}-verdict`, decision.verdict.label);
    setText(`decision-${timeframe}-confidence`, `${decision.confidence}%`);

    const badge = byId(`decision-${timeframe}-badge`);
    if (badge) {
      badge.className = `badge badge-${decision.verdict.tone}`;
      badge.textContent = decision.verdict.tone === 'bull' ? 'Alcista' : decision.verdict.tone === 'bear' ? 'Bajista' : 'Neutral';
      badge.title = `Score bruto ${decision.raw.toFixed(1)} / 100 · Confianza ${decision.confidence}%`;
    }

    const rsiText = Number.isFinite(decision.indicators.rsi)
      ? `RSI ${decision.indicators.rsi.toFixed(1)} · ${decision.factors.rsi.label} · ${signedPoints(decision.factors.rsi.points)}`
      : 'RSI sin datos';
    const takerText = Number.isFinite(decision.indicators.takerRatio)
      ? `Taker ${formatRatio(decision.indicators.takerRatio)} · ${decision.factors.taker.label} · ${signedPoints(decision.factors.taker.points)}`
      : 'Taker sin datos';
    const fundingText = Number.isFinite(decision.indicators.funding)
      ? `Funding ${formatFunding(decision.indicators.funding)} · ${decision.factors.funding.label} · ${signedPoints(decision.factors.funding.points)}`
      : 'Funding sin datos';
    const lsText = Number.isFinite(decision.indicators.topRatio)
      ? `${formatRatio(decision.indicators.topRatio)} vs ${formatRatio(decision.indicators.globalRatio)} · ${decision.factors.ls.label} · ${signedPoints(decision.factors.ls.points)}`
      : 'L/S sin datos';

    setFactorValue(`decision-${timeframe}-ema`, `${decision.factors.trend.label} · ${signedPoints(decision.factors.trend.points)}`, decision.factors.trend.points);
    setFactorValue(`decision-${timeframe}-rsi`, rsiText, decision.factors.rsi.points);
    setFactorValue(`decision-${timeframe}-taker`, takerText, decision.factors.taker.points);
    setFactorValue(`decision-${timeframe}-funding`, fundingText, decision.factors.funding.points);
    setFactorValue(`decision-${timeframe}-ls`, lsText, decision.factors.ls.points);
    ensureDecisionExternalRow(timeframe);
    const externalFactor = decision.factors.external || { points: 0, label: 'Sin lecturas' };
    setFactorValue(`decision-${timeframe}-external`, externalFactor.label, externalFactor.points);

    const levels = byId(`decision-${timeframe}-levels`);
    if (levels) {
      levels.className = `trade-levels ${decision.raw >= 0 ? 'is-long' : 'is-short'}`;
      levels.title = `ATR 14: ${formatPrice(decision.levels.atr)} · Riesgo/Beneficio 1:2`;
    }
    setText(`decision-${timeframe}-entry`, formatPrice(decision.levels.entry));
    setText(`decision-${timeframe}-stop`, formatPrice(decision.levels.stop));
    setText(`decision-${timeframe}-target`, formatPrice(decision.levels.target));
  }

  function setFactorValue(id, text, points) {
    const element = byId(id);
    if (!element) return;
    element.textContent = text;
    element.className = points > 0 ? 'positive' : points < 0 ? 'negative' : 'text-muted';
  }

  function renderDecisionError(timeframe) {
    const ring = byId(`decision-${timeframe}-ring`);
    if (ring) {
      ring.style.setProperty('--score', '0');
      ring.classList.remove('is-bull', 'is-bear');
      ring.classList.add('is-neutral');
    }
    setText(`decision-${timeframe}-score`, '—');
    setText(`decision-${timeframe}-verdict`, 'Sin velas disponibles');
    setText(`decision-${timeframe}-confidence`, '—');

    const badge = byId(`decision-${timeframe}-badge`);
    if (badge) {
      badge.className = 'badge badge-bear';
      badge.textContent = 'Error';
    }

    ensureDecisionExternalRow(timeframe);
    ['ema', 'rsi', 'taker', 'funding', 'ls', 'external'].forEach((factor) => {
      setFactorValue(`decision-${timeframe}-${factor}`, '—', 0);
    });

    const levels = byId(`decision-${timeframe}-levels`);
    if (levels) levels.className = 'trade-levels';
    setText(`decision-${timeframe}-entry`, '—');
    setText(`decision-${timeframe}-stop`, '—');
    setText(`decision-${timeframe}-target`, '—');
  }

  function updateFinalDecision() {
    const decision4h = state.decisions['4h'];
    const decision1d = state.decisions['1d'];
    if (!decision4h || !decision1d) return;

    const externalLogin = getExternalLoginBiasPoints();
    const externalCopy = externalLogin.count
      ? ` · Login ${signedPoints(externalLogin.points)} pts (${externalLogin.bullish}🟢/${externalLogin.bearish}🔴)`
      : '';
    const externalSummary = externalLogin.count
      ? `Login web: ${signedPoints(externalLogin.points)} pts (${externalLogin.bullish}🟢/${externalLogin.bearish}🔴).`
      : 'Login web: sin lecturas.';
    const macroScore = state.lastMacroScore;
    const macroRaw = Number.isFinite(macroScore) ? ((macroScore - 50) / 50) * 100 : null;
    const finalRaw = macroRaw == null
      ? decision4h.raw * 0.5 + decision1d.raw * 0.5
      : decision4h.raw * 0.4 + decision1d.raw * 0.4 + macroRaw * 0.2;
    const finalDisplay = Math.round((clamp(finalRaw, -100, 100) + 100) / 2);
    const finalVerdict = getVerdict(finalRaw);
    const finalConfidence = Math.round(clamp(
      (decision4h.confidence + decision1d.confidence) / 2 + (macroRaw == null ? 0 : 5),
      50,
      97
    ));

    setText('final-score', finalDisplay);
    setText('final-confidence', `${finalConfidence}%`);
    setText('final-timeframe-copy', `4H ${decision4h.displayScore} · 1D ${decision1d.displayScore} · Macro ${macroScore == null ? '—' : macroScore}${externalCopy}`);
    setText('final-summary', `4H: ${decision4h.verdict.label}. 1D: ${decision1d.verdict.label}. Macro: ${macroScore == null ? 'sin evaluar' : `${macroScore}/100`}. ${externalSummary} Señal integrada: ${finalVerdict.label}.`);

    const finalBadge = byId('final-signal');
    if (finalBadge) {
      finalBadge.className = `badge badge-${finalVerdict.tone} badge-lg`;
      finalBadge.textContent = finalVerdict.short;
      finalBadge.title = `Score integrado ${finalDisplay}/100 · bruto ${finalRaw.toFixed(1)}`;
    }

    const progress = byId('final-progress-bar');
    if (progress) progress.style.width = `${finalDisplay}%`;

    const futures = state.futures[state.selectedSymbol] || null;
    const spotMode = decision4h.raw > 0 && decision1d.raw > 0 ? 'ok' : decision4h.raw < 0 && decision1d.raw < 0 ? 'bad' : 'neutral';
    const derivativesMode = futures
      ? (decision4h.factors.positioning.points + decision1d.factors.positioning.points) > 0
        ? 'ok'
        : (decision4h.factors.positioning.points + decision1d.factors.positioning.points) < 0
          ? 'bad'
          : 'neutral'
      : 'neutral';
    const macroMode = macroScore == null ? 'neutral' : macroScore >= 50 ? 'ok' : 'bad';

    setCheckIcon('final-spot-check', spotMode);
    setCheckIcon('final-derivatives-check', derivativesMode);
    setCheckIcon('final-macro-check', macroMode);

    const spotPoints = (decision4h.factors.trend.points + decision1d.factors.trend.points) / 2;
    const derivativesPoints = (
      decision4h.factors.taker.points + decision4h.factors.funding.points + decision4h.factors.ls.points +
      decision1d.factors.taker.points + decision1d.factors.funding.points + decision1d.factors.ls.points
    ) / 2;

    setText('overview-score', finalDisplay);
    setText('overview-spot', signedPoints(spotPoints));
    setText('overview-derivatives', signedPoints(derivativesPoints));
    setText('overview-macro', macroScore == null ? '—' : `${macroScore}/100`);
    setText('overview-summary', `Confluencia ${finalConfidence}% · 4H ${decision4h.displayScore}/100 · 1D ${decision1d.displayScore}/100 · Macro ${macroScore == null ? 'sin evaluar' : `${macroScore}/100`}${externalLogin.count ? ` · Login ${signedPoints(externalLogin.points)} pts` : ''}. ${finalVerdict.label}.`);

    const overviewRing = byId('overview-ring');
    if (overviewRing) {
      overviewRing.style.setProperty('--score', String(finalDisplay));
      overviewRing.className = `score-ring score-ring-large ${finalVerdict.tone === 'bull' ? 'is-bull' : finalVerdict.tone === 'bear' ? 'is-bear' : 'is-neutral'}`;
    }

    const overviewSignal = byId('overview-signal');
    if (overviewSignal) {
      overviewSignal.className = `badge badge-${finalVerdict.tone}`;
      overviewSignal.textContent = finalVerdict.short;
    }

    const spotBar = byId('overview-spot-bar');
    if (spotBar) spotBar.style.width = `${clamp(((spotPoints + 30) / 60) * 100, 0, 100)}%`;
    const derivativesBar = byId('overview-derivatives-bar');
    if (derivativesBar) derivativesBar.style.width = `${clamp(((derivativesPoints + 40) / 80) * 100, 0, 100)}%`;
    const macroBar = byId('overview-macro-bar');
    if (macroBar) macroBar.style.width = `${macroScore == null ? 0 : clamp(macroScore, 0, 100)}%`;

    const spotLabel = byId('overview-spot');
    if (spotLabel) spotLabel.className = spotPoints > 0 ? 'positive' : spotPoints < 0 ? 'negative' : 'text-muted';
    const derivativesLabel = byId('overview-derivatives');
    if (derivativesLabel) derivativesLabel.className = derivativesPoints > 0 ? 'positive' : derivativesPoints < 0 ? 'negative' : 'text-muted';

    refreshIcons();
  }

  function setCheckIcon(id, mode) {
    const element = byId(id);
    if (!element) return;
    element.classList.remove('is-ok', 'is-bad');
    if (mode === 'ok') {
      element.classList.add('is-ok');
      element.innerHTML = '<i data-lucide="check"></i>';
    } else if (mode === 'bad') {
      element.classList.add('is-bad');
      element.innerHTML = '<i data-lucide="x"></i>';
    } else {
      element.innerHTML = '<i data-lucide="minus"></i>';
    }
  }
  /* ============================================================
     FASE 3 - PARTE 2
     Buscador híbrido CEX/DEX, auditoría forense, simulador
     de valoración y wallet tracker multi-chain.
     ============================================================ */

  const DEEP_REFERENCE_IDS = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'sui', 'ripple'];
  const DEEP_REFERENCE_LABELS = {
    bitcoin: 'BTC',
    ethereum: 'ETH',
    solana: 'SOL',
    binancecoin: 'BNB',
    sui: 'SUI',
    ripple: 'XRP'
  };

  const phase3State = {
    chart: null,
    chartSeries: null,
    chartResizeObserver: null,
    chartContainer: null,
    activeTimeframe: '4h',
    klines: { '4h': null, '1d': null },
    currentToken: null,
    currentDex: null,
    currentQuery: '',
    searchRequest: 0,
    suggestionTimer: null,
    fundingTimer: null,
    wallets: (() => {
      const stored = loadJSON(STORAGE_KEYS.wallets, []);
      return Array.isArray(stored) ? stored : [];
    })(),
    currentWallet: null,
    referenceAssets: [],
    simReference: null,
    lastWalletsRefresh: null,
    walletSnapshots: (() => {
      const stored = loadJSON(STORAGE_KEYS.walletTokenSnapshots, {});
      return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    })(),
    whaleAlerts: (() => {
      const stored = loadJSON(STORAGE_KEYS.walletWhaleAlerts, []);
      return Array.isArray(stored) ? stored : [];
    })(),
    isSearching: false,
    initialDeepSearchRequested: false,
    initialized: false,
    deepPanelInitialized: false,
    walletPanelInitialized: false,
    securityKey: '',
    securityAuditLoadedKey: ''
  };

  function initPhase3() {
    if (phase3State.initialized) return;
    phase3State.initialized = true;
    initDeepSearchPanel();
    initWalletTrackerPanel();
    loadSimReferenceAssets();

    document.addEventListener('crypto:intel:macro-updated', () => {
      if (phase3State.currentToken && (phase3State.klines['4h'] || phase3State.klines['1d'])) {
        renderDeepSignal(phase3State.currentToken);
      }
    });

    const ensureInitialDeepSearch = () => {
      if (phase3State.initialDeepSearchRequested || phase3State.currentToken || phase3State.isSearching) return;
      const panel = byId('panel-deep-dive');
      if (!panel || !panel.classList.contains('is-active')) return;
      phase3State.initialDeepSearchRequested = true;
      searchCryptoAsset('BTC', { silent: true });
    };

    window.addEventListener('hashchange', () => window.setTimeout(ensureInitialDeepSearch, 80));
    window.setTimeout(ensureInitialDeepSearch, 140);

    if (window.CryptoIntelPhase3 == null) {
      window.CryptoIntelPhase3 = Object.freeze({
        searchAsset: (query) => searchCryptoAsset(query),
        fetchWalletBalance,
        getState: () => ({
          currentQuery: phase3State.currentQuery,
          currentSymbol: phase3State.currentToken ? phase3State.currentToken.symbol : null,
          wallets: phase3State.wallets.length,
          updatedAt: Date.now()
        })
      });
    }
  }

  function initDeepSearchPanel() {
    if (phase3State.deepPanelInitialized) return;
    phase3State.deepPanelInitialized = true;
    const form = byId('token-search-form');
    const input = byId('token-search-input');

    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        searchCryptoAsset(input ? input.value : '');
      });
    }

    if (input) {
      input.addEventListener('input', () => {
        window.clearTimeout(phase3State.suggestionTimer);
        const query = input.value.trim();
        if (query.length < 2 || isContractQuery(query)) {
          hideSuggestions();
          return;
        }
        phase3State.suggestionTimer = window.setTimeout(() => loadSuggestions(query), 350);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hideSuggestions();
      });
    }

    $$('[data-quick-token]').forEach((button) => {
      button.addEventListener('click', () => {
        const token = button.dataset.quickToken;
        if (!token) return;
        if (input) input.value = token;
        hideSuggestions();
        searchCryptoAsset(token);
      });
    });

    byId('deep-dive-refresh')?.addEventListener('click', () => {
      const query = (input && input.value.trim()) || phase3State.currentQuery || 'BTC';
      searchCryptoAsset(query);
    });

    $$('#token-chart-timeframes [data-timeframe]').forEach((button) => {
      button.addEventListener('click', () => {
        const timeframe = button.dataset.timeframe;
        if (!['4h', '1d'].includes(timeframe)) return;
        phase3State.activeTimeframe = timeframe;
        syncDeepTimeframeButtons();
        renderDeepChart(timeframe);
      });
    });

    $$('[data-chart-indicator]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.chartIndicator;
        const series = phase3State.chartSeries && phase3State.chartSeries[key];
        if (!series) return;
        const active = button.classList.toggle('is-active');
        series.applyOptions({ visible: active });
      });
    });

    byId('token-signal-explain')?.addEventListener('click', () => {
      showToast('La señal combina tendencia EMA 20/50/200, RSI 14, ATR 14, taker buy/sell, funding y posicionamiento L/S. El score se normaliza a 0-100 y los niveles usan 1.5x ATR para stop y 3x ATR para objetivo.', 'info');
    });

    byId('sim-calculate')?.addEventListener('click', calculateSimulator);
    byId('sim-reset')?.addEventListener('click', () => {
      autofillSimulator(phase3State.currentToken);
      calculateSimulator();
    });

    $$('[data-sim-multiplier]').forEach((button) => {
      button.addEventListener('click', () => {
        const multiplier = parseSimNumber(button.dataset.simMultiplier);
        const currentMarketCap = getCurrentMarketCap();
        if (multiplier == null || currentMarketCap == null) {
          showToast('Primero carga un activo con market cap disponible.', 'warning');
          return;
        }
        const targetInput = byId('sim-target-mcap');
        if (targetInput) targetInput.value = String(Math.round(currentMarketCap * multiplier));
        const multiplierInput = byId('sim-multiplier');
        if (multiplierInput) multiplierInput.value = String(multiplier);
        phase3State.simReference = null;
        const reference = byId('sim-reference');
        if (reference) reference.value = '';
        calculateSimulator();
      });
    });

    const reference = byId('sim-reference');
    if (reference) {
      reference.addEventListener('change', () => {
        const asset = phase3State.referenceAssets.find((item) => item.id === reference.value);
        phase3State.simReference = asset || null;
        if (asset) {
          const targetInput = byId('sim-target-mcap');
          if (targetInput) targetInput.value = String(Math.round(asset.marketCap));
          calculateSimulator();
        }
      });
    }

    byId('lowcap-contract-copy')?.addEventListener('click', async () => {
      const address = phase3State.currentDex?.baseToken?.address || byId('lowcap-contract')?.textContent || '';
      if (await copyToClipboard(address)) showToast('Contrato copiado al portapapeles.', 'success');
      else showToast('No se pudo copiar el contrato. Cópialo manualmente.', 'warning');
    });

    byId('security-refresh')?.addEventListener('click', () => {
      if (phase3State.currentDex) loadTokenSecurityAudit(phase3State.currentDex, true);
      else showToast('Primero selecciona un token con contrato on-chain.', 'warning');
    });

    byId('forensic-load')?.addEventListener('click', loadForensicFromInput);
    byId('forensic-contract-input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        loadForensicFromInput();
      }
    });

    const bubbleTab = byId('forensic-tab-bubble');
    if (bubbleTab) {
      bubbleTab.addEventListener('change', () => {
        if (bubbleTab.checked && phase3State.currentDex) renderForensics(phase3State.currentDex);
      });
    }

    const suggestions = byId('token-search-suggestions');
    if (suggestions) {
      suggestions.addEventListener('click', (event) => {
        const button = event.target.closest('[data-suggestion-query]');
        if (!button) return;
        const query = button.dataset.suggestionQuery;
        if (input) input.value = query;
        hideSuggestions();
        searchCryptoAsset(query);
      });
    }
  }

  function hideSuggestions() {
    const box = byId('token-search-suggestions');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
  }

  async function loadSuggestions(query) {
    try {
      const coins = await fetchCoinGeckoSearch(query);
      const input = byId('token-search-input');
      if (!input || input.value.trim() !== query) return;
      if (!coins.length) {
        hideSuggestions();
        return;
      }
      renderSuggestions(coins.slice(0, 6));
    } catch (error) {
      hideSuggestions();
    }
  }

  function renderSuggestions(coins) {
    const box = byId('token-search-suggestions');
    if (!box) return;
    box.innerHTML = coins.map((coin) => {
      const symbol = String(coin.symbol || '').toUpperCase();
      const query = symbol || String(coin.id || '');
      const rank = coin.market_cap_rank == null ? '—' : `#${escapeHtml(coin.market_cap_rank)}`;
      return `<button type="button" class="suggestion-item" data-suggestion-query="${escapeHtml(query)}">
        <span class="asset-icon">${escapeHtml(symbol.slice(0, 3) || '?')}</span>
        <span class="suggestion-item-copy"><strong>${escapeHtml(symbol)}</strong><span>${escapeHtml(coin.name || '')}</span></span>
        <span>${rank}</span>
      </button>`;
    }).join('');
    box.hidden = false;
    refreshIcons();
  }

  async function fetchCoinGeckoSearch(query) {
    const data = await fetchPublic(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
      { timeout: 12000 }
    );
    return data && Array.isArray(data.coins) ? data.coins : [];
  }

  async function fetchCoinGeckoAsset(query) {
    const coins = await fetchCoinGeckoSearch(query);
    if (!coins.length) return null;

    const normalized = String(query || '').trim().replace(/^\$/, '').toLowerCase();
    const coin = coins.find((item) => String(item.symbol || '').toLowerCase() === normalized)
      || coins.find((item) => String(item.name || '').toLowerCase() === normalized)
      || coins[0];
    if (!coin || !coin.id) return null;

    const data = await fetchPublic(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coin.id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
      { timeout: 15000 }
    );
    if (!data) return null;

    const market = data.market_data || {};
    const image = data.image && typeof data.image === 'object'
      ? (data.image.large || data.image.small || '')
      : (coin.large || coin.thumb || '');

    return {
      id: data.id || coin.id,
      symbol: String(data.symbol || coin.symbol || '').toUpperCase(),
      name: data.name || coin.name || '',
      image,
      description: stripHtml(data.description && data.description.en ? data.description.en : ''),
      marketCapRank: toFiniteNumber(data.market_cap_rank != null ? data.market_cap_rank : coin.market_cap_rank),
      price: toFiniteNumber(market.current_price && market.current_price.usd),
      change24h: toFiniteNumber(market.price_change_percentage_24h),
      high24h: toFiniteNumber(market.high_24h && market.high_24h.usd),
      low24h: toFiniteNumber(market.low_24h && market.low_24h.usd),
      volume24h: toFiniteNumber(market.total_volume && market.total_volume.usd),
      marketCap: toFiniteNumber(market.market_cap && market.market_cap.usd),
      fdv: toFiniteNumber(market.fully_diluted_valuation && market.fully_diluted_valuation.usd),
      circulatingSupply: toFiniteNumber(market.circulating_supply),
      totalSupply: toFiniteNumber(market.total_supply),
      maxSupply: toFiniteNumber(market.max_supply),
      ath: toFiniteNumber(market.ath && market.ath.usd),
      atl: toFiniteNumber(market.atl && market.atl.usd),
      lastUpdated: data.last_updated || null
    };
  }

  function stripHtml(value) {
    return String(value == null ? '' : value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function fetchDexScreener(query, isContract) {
    const url = isContract
      ? `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(query)}`
      : `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`;
    const data = await fetchPublic(url, { timeout: 15000 });
    const rawPairs = data && Array.isArray(data.pairs) ? data.pairs : [];
    const pairs = rawPairs
      .filter((pair) => pair && pair.baseToken && pair.liquidity)
      .map((pair) => ({ pair, liquidity: toFiniteNumber(pair.liquidity && pair.liquidity.usd) }))
      .filter((item) => item.liquidity != null && item.liquidity > 0)
      .sort((a, b) => b.liquidity - a.liquidity)
      .map((item) => item.pair);

    if (!pairs.length) return null;
    return { pair: pairs[0], pairs, query };
  }

  function isContractQuery(query) {
    const value = String(query == null ? '' : query).trim();
    if (!value) return false;
    if (/^0x[a-fA-F0-9]{1,64}(::.*)?$/.test(value)) return true;
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return true;
    return false;
  }

  function normalizeSymbol(value) {
    let symbol = String(value == null ? '' : value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (symbol.endsWith('USDT') && symbol.length > 4) symbol = symbol.slice(0, -4);
    return symbol;
  }

  async function searchCryptoAsset(rawQuery, options = {}) {
    const query = String(rawQuery == null ? '' : rawQuery).trim();
    if (!query) {
      if (!options.silent) showToast('Escribe un ticker, nombre o contrato para iniciar el análisis.', 'warning');
      return;
    }

    const requestId = ++phase3State.searchRequest;
    phase3State.isSearching = true;
    phase3State.currentQuery = query;
    phase3State.initialDeepSearchRequested = true;

    const input = byId('token-search-input');
    if (input && input.value.trim() !== query) input.value = query;
    hideSuggestions();
    setDeepLoading(true);
    showDeepChartLoading();

    const contract = isContractQuery(query);
    const identityPromise = contract
      ? Promise.resolve(null)
      : fetchCoinGeckoAsset(query).catch((error) => {
        console.warn('[CoinGecko Search]', error);
        return null;
      });
    const dexPromise = fetchDexScreener(query, contract).catch((error) => {
      console.warn('[DEX Screener]', error);
      return null;
    });
    const cexPromise = contract
      ? Promise.resolve(null)
      : (async () => {
        const identity = await identityPromise.catch(() => null);
        const symbol = normalizeSymbol(identity && identity.symbol ? identity.symbol : query);
        if (!symbol) return null;
        return fetchCexBundle(symbol).catch((error) => {
          console.warn('[CEX Bundle]', error);
          return null;
        });
      })();

    try {
      const [identityResult, cexResult, dexResult] = await Promise.allSettled([
        identityPromise,
        cexPromise,
        dexPromise
      ]);
      if (requestId !== phase3State.searchRequest) return;

      const identity = identityResult.status === 'fulfilled' ? identityResult.value : null;
      const cex = cexResult.status === 'fulfilled' ? cexResult.value : null;
      const dex = dexResult.status === 'fulfilled' ? dexResult.value : null;
      const token = buildDeepToken(identity, cex, dex, query);

      if (!token.hasData) {
        clearDeepDive('No se encontraron datos CEX ni DEX para esa búsqueda. Verifica el ticker o pega el contrato completo.');
        if (!options.silent) showToast('Sin resultados para esa búsqueda. Prueba con otro ticker o contrato.', 'warning');
        return;
      }

      phase3State.currentToken = token;
      phase3State.currentDex = token.pair;
      phase3State.klines = { '4h': token.klines4h, '1d': token.klines1d };
      phase3State.activeTimeframe = token.klines4h ? '4h' : '1d';

      renderDeepDive(token);
      if (token.pair) renderLowcapPair(token.pair, token.dex);
      else renderLowcapEmpty();
      renderForensics(token.pair);
      updateValidationLinks(token.identity, token.pair);
      if (!options.preserveSourceContext) {
        document.dispatchEvent(new CustomEvent('crypto:intel:asset-updated', {
          detail: {
            mode: 'token',
            symbol: token.symbol,
            name: token.name,
            address: token.pair && token.pair.baseToken ? token.pair.baseToken.address : '',
            chain: token.pair ? token.pair.chainId : '',
            slug: token.identity && token.identity.id ? token.identity.id : ''
          }
        }));
      }
      if (token.identity && token.identity.symbol) {
        void loadLiveCoinWatchLiquidity(token.identity.symbol, token.identity);
      }

      if (!options.silent) {
        if (!token.spot && !token.pair) {
          showToast('No se encontraron datos CEX ni DEX para esa búsqueda.', 'warning');
        } else if (!token.spot) {
          showToast('Sin par spot en Binance; mostrando datos DEX y on-chain.', 'info');
        } else {
          showToast(`Análisis actualizado para ${token.symbol}.`, 'success');
        }
      }
    } finally {
      if (requestId === phase3State.searchRequest) {
        setDeepLoading(false);
        phase3State.isSearching = false;
        refreshIcons();
      }
    }
  }

  function setDeepLoading(loading) {
    const button = byId('token-search-btn');
    if (button) {
      if (loading) {
        if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<i data-lucide="loader-circle"></i> Analizando';
      } else {
        button.disabled = false;
        button.innerHTML = button.dataset.originalHtml || '<i data-lucide="search"></i> Analizar';
        delete button.dataset.originalHtml;
      }
    }
    const refresh = byId('deep-dive-refresh');
    if (refresh) refresh.disabled = loading;
    refreshIcons();
  }

  function showDeepChartLoading() {
    setDeepChartOverlay('Cargando velas y métricas...', 'Consultando Binance Spot, fapi y DEX Screener.');
  }

  function setDeepChartOverlay(title, copy) {
    const overlay = byId('chart-overlay');
    if (!overlay) return;
    overlay.hidden = false;
    const strong = overlay.querySelector('strong');
    const span = overlay.querySelector('span:last-child');
    if (strong) strong.textContent = title;
    if (span) span.textContent = copy;
  }

  function hideDeepChartOverlay() {
    const overlay = byId('chart-overlay');
    if (overlay) overlay.hidden = true;
  }

  async function fetchCexBundle(symbol) {
    const [spot, futures, klines4h, klines1d] = await Promise.allSettled([
      fetchBinanceSpotTicker(symbol),
      fetchDeepFutures(symbol),
      fetchDeepKlines(symbol, '4h', 300),
      fetchDeepKlines(symbol, '1d', 300)
    ]);

    return {
      symbol,
      spot: spot.status === 'fulfilled' ? spot.value : null,
      futures: futures.status === 'fulfilled' ? futures.value : null,
      klines4h: klines4h.status === 'fulfilled' ? klines4h.value : null,
      klines1d: klines1d.status === 'fulfilled' ? klines1d.value : null
    };
  }

  async function fetchBinanceSpotTicker(symbol) {
    if (!symbol) return null;
    const pair = `${symbol}USDT`;
    const data = await fetchJSON(
      `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`,
      { timeout: 9000, retries: 0 }
    );
    const lastPrice = toFiniteNumber(data && data.lastPrice);
    if (lastPrice == null || lastPrice <= 0) throw new Error(`Sin precio spot para ${pair}`);
    return {
      symbol,
      pair,
      lastPrice,
      change24h: toFiniteNumber(data.priceChangePercent),
      high24h: toFiniteNumber(data.highPrice),
      low24h: toFiniteNumber(data.lowPrice),
      volume24h: toFiniteNumber(data.quoteVolume),
      baseVolume: toFiniteNumber(data.volume)
    };
  }

  async function fetchDeepFutures(symbol) {
    if (!symbol) return null;
    const pair = `${symbol}USDT`;
    const [premiumResult, oiResult, klinesResult, bybitResult, bitgetResult] = await Promise.allSettled([
      fetchJSON(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(pair)}`, { timeout: 9000, retries: 0 }),
      fetchJSON(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(pair)}`, { timeout: 9000, retries: 0 }),
      fetchJSON(`https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(pair)}&interval=4h&limit=1`, { timeout: 9000, retries: 0 }),
      fetchJSON(`https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${encodeURIComponent(pair)}&period=4h&limit=2`, { timeout: 9000, retries: 0 }),
      BITGET_POSITION_SYMBOLS.has(symbol)
        ? fetchJSON(`https://api.bitget.com/api/v2/mix/market/position-long-short?symbol=${encodeURIComponent(pair)}&productType=USDT-FUTURES&period=4h`, { timeout: 9000, retries: 0 })
        : Promise.resolve(null)
    ]);

    if (premiumResult.status !== 'fulfilled' || !premiumResult.value) return null;
    const premium = premiumResult.value;
    const markPrice = toFiniteNumber(premium.markPrice);
    if (markPrice == null) return null;

    const oiJson = oiResult.status === 'fulfilled' ? oiResult.value : null;
    const klinesJson = klinesResult.status === 'fulfilled' ? klinesResult.value : null;
    const bybitJson = bybitResult.status === 'fulfilled' ? bybitResult.value : null;
    const bitgetJson = bitgetResult.status === 'fulfilled' ? bitgetResult.value : null;

    const openInterest = toFiniteNumber(oiJson && oiJson.openInterest);
    const topRatio = bitgetLongShortRatio(bitgetJson, 'longShortPositionRatio');
    const globalRatio = bybitLongShortRatio(bybitJson);
    const takerRatio = takerRatioFromFuturesKlines(klinesJson);

    return {
      symbol,
      pair,
      markPrice,
      indexPrice: toFiniteNumber(premium.indexPrice),
      funding: toFiniteNumber(premium.lastFundingRate),
      nextFundingTime: toFiniteNumber(premium.nextFundingTime),
      openInterest,
      openInterestUsd: openInterest != null ? openInterest * markPrice : null,
      topRatio,
      globalRatio,
      takerRatio
    };
  }

  async function fetchDeepKlines(symbol, interval, limit) {
    if (!symbol) return null;
    const pair = `${symbol}USDT`;
    const urls = [
      `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(interval)}&limit=${limit}`,
      `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(interval)}&limit=${limit}`
    ];

    for (const url of urls) {
      try {
        const data = await fetchJSON(url, { timeout: 15000, retries: 0 });
        const parsed = parseDeepKlines(data);
        if (parsed.length >= 60) return parsed;
      } catch (error) {
        // Se intenta el siguiente endpoint (spot -> futuros).
      }
    }
    return null;
  }

  function parseDeepKlines(data) {
    if (!Array.isArray(data)) return [];
    return data.map((candle) => ({
      time: toFiniteNumber(candle && candle[0]),
      open: toFiniteNumber(candle && candle[1]),
      high: toFiniteNumber(candle && candle[2]),
      low: toFiniteNumber(candle && candle[3]),
      close: toFiniteNumber(candle && candle[4]),
      volume: toFiniteNumber(candle && candle[5]),
      closeTime: toFiniteNumber(candle && candle[6]),
      quoteVolume: toFiniteNumber(candle && candle[7]),
      takerBuyQuote: toFiniteNumber(candle && candle[10])
    })).filter((candle) => (
      Number.isFinite(candle.time)
      && Number.isFinite(candle.open) && candle.open > 0
      && Number.isFinite(candle.high) && candle.high > 0
      && Number.isFinite(candle.low) && candle.low > 0
      && Number.isFinite(candle.close) && candle.close > 0
    ));
  }

  function buildDeepToken(identity, cex, dex, query) {
    const pair = dex && dex.pair ? dex.pair : null;
    const symbol = normalizeSymbol(
      (identity && identity.symbol)
      || (cex && cex.symbol)
      || (pair && pair.baseToken && pair.baseToken.symbol)
      || query
    );
    const name = (identity && identity.name)
      || (pair && pair.baseToken && pair.baseToken.name)
      || symbol
      || query;
    const price = (cex && cex.spot && cex.spot.lastPrice)
      ?? (identity && identity.price)
      ?? toFiniteNumber(pair && pair.priceUsd);
    const change = (cex && cex.spot && cex.spot.change24h)
      ?? (identity && identity.change24h)
      ?? toFiniteNumber(pair && pair.priceChange && pair.priceChange.h24);

    const effectiveIdentity = identity || {
      id: null,
      symbol,
      name,
      image: '',
      description: pair
        ? `${(pair.baseToken && pair.baseToken.name) || name} · ${pair.chainId || 'DEX'} · ${pair.dexId || 'DEX'}`
        : '',
      marketCapRank: null,
      price,
      change24h: change,
      high24h: null,
      low24h: null,
      volume24h: toFiniteNumber(pair && pair.volume && pair.volume.h24),
      marketCap: toFiniteNumber(pair && pair.marketCap),
      fdv: toFiniteNumber(pair && pair.fdv),
      circulatingSupply: null,
      totalSupply: null,
      maxSupply: null,
      ath: null,
      atl: null,
      lastUpdated: null
    };

    return {
      query,
      contract: isContractQuery(query),
      symbol,
      name,
      price,
      change,
      identity: effectiveIdentity,
      spot: cex && cex.spot ? cex.spot : null,
      futures: cex && cex.futures ? cex.futures : null,
      klines4h: cex && cex.klines4h ? cex.klines4h : null,
      klines1d: cex && cex.klines1d ? cex.klines1d : null,
      dex: dex || null,
      pair,
      hasData: Boolean(identity || (cex && cex.spot) || (cex && cex.futures) || (cex && cex.klines4h) || (cex && cex.klines1d) || pair)
    };
  }

  function formatDeepPrice(value) {
    const number = toFiniteNumber(value);
    if (number == null || number <= 0) return '—';
    if (number >= 1000) return `$${number.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    if (number >= 1) return `$${number.toFixed(2)}`;
    if (number >= 0.01) return `$${number.toFixed(4)}`;
    if (number >= 0.0001) return `$${number.toFixed(6)}`;
    if (number >= 0.00000001) return `$${number.toFixed(10).replace(/0+$/, '')}`;
    return `$${number.toExponential(4)}`;
  }

  function renderDeepDive(token) {
    renderTokenIdentity(token);
    renderSpotMetrics(token);
    renderFuturesMetrics(token);
    phase3State.klines = { '4h': token.klines4h, '1d': token.klines1d };
    phase3State.activeTimeframe = token.klines4h ? '4h' : '1d';
    syncDeepTimeframeButtons();
    renderDeepChart(phase3State.activeTimeframe);
    renderDeepSignal(token);
    autofillSimulator(token);
  }

  function renderTokenIdentity(token) {
    const identity = token.identity || {};
    const symbol = token.symbol || identity.symbol || '—';
    const name = token.name || identity.name || symbol;
    const glyphs = { BTC: '₿', ETH: 'Ξ', SOL: 'S', SUI: 'S', XRP: 'X', BNB: 'B', LINK: 'L' };

    setText('token-name', name);
    setText('token-symbol', symbol);
    const logo = byId('token-logo');
    if (logo) logo.textContent = glyphs[symbol] || symbol.slice(0, 1) || '?';

    const rank = toFiniteNumber(identity.marketCapRank);
    setText('token-rank', rank == null ? '—' : `#${formatNumber(rank)}`);

    const description = String(identity.description || '').trim();
    const chain = token.pair && token.pair.chainId ? ` · ${token.pair.chainId}` : '';
    setText('token-subtitle', description
      ? `${description.slice(0, 180)}${description.length > 180 ? '…' : ''}`
      : `${name} · ${symbol}${chain}`);

    setText('token-price', formatDeepPrice(token.price));
    const change = toFiniteNumber(token.change);
    const changeElement = byId('token-change');
    if (changeElement) {
      changeElement.textContent = change == null ? '— 24H' : `${formatSignedPct(change)} 24H`;
      changeElement.className = `price-change ${change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'}`;
    }

    const marketCap = toFiniteNumber(identity.marketCap) ?? toFiniteNumber(token.pair && token.pair.marketCap);
    const volume = toFiniteNumber(identity.volume24h) ?? toFiniteNumber(token.pair && token.pair.volume && token.pair.volume.h24);
    const fdv = toFiniteNumber(identity.fdv) ?? toFiniteNumber(token.pair && token.pair.fdv);
    setText('token-marketcap', formatCompactUSD(marketCap));
    setText('token-volume', formatCompactUSD(volume));
    setText('token-fdv', formatCompactUSD(fdv));

    const card = byId('token-identity-card');
    if (card) card.dataset.symbol = symbol;
  }

  function renderSpotMetrics(token) {
    const identity = token.identity || {};
    const spot = token.spot || {};
    const pair = token.pair || {};
    const price = token.price ?? spot.lastPrice;
    const change = token.change ?? spot.change24h ?? identity.change24h;
    const high = spot.high24h ?? identity.high24h;
    const low = spot.low24h ?? identity.low24h;
    const volume = identity.volume24h ?? spot.volume24h ?? (pair.volume && pair.volume.h24);
    const marketCap = identity.marketCap ?? pair.marketCap;
    const fdv = identity.fdv ?? pair.fdv;
    const rank = identity.marketCapRank;

    setText('spot-price', formatDeepPrice(price));
    const changeElement = byId('spot-change-24h');
    if (changeElement) {
      changeElement.textContent = formatSignedPct(change);
      changeElement.className = change > 0 ? 'positive' : change < 0 ? 'negative' : 'text-muted';
    }
    setText('spot-high', formatDeepPrice(high));
    setText('spot-low', formatDeepPrice(low));
    setText('spot-volume', formatCompactUSD(volume));
    setText('spot-marketcap', formatCompactUSD(marketCap));
    setText('spot-fdv', formatCompactUSD(fdv));
    setText('spot-rank', rank == null ? '—' : `#${formatNumber(rank)}`);
  }

  function renderFuturesMetrics(token) {
    const futures = token.futures;
    if (!futures) {
      ['fut-mark', 'fut-funding', 'fut-oi', 'fut-longshort', 'fut-taker', 'fut-index'].forEach((id) => setText(id, '—'));
      const callout = byId('futures-callout');
      const span = callout ? callout.querySelector('span') : null;
      if (span) span.textContent = 'Activo sin contrato perpetuo en Binance - Analizando Liquidez On-Chain DEX';
      if (callout) callout.classList.remove('is-live');
      stopDeepFundingCountdown();
      return;
    }

    setText('fut-mark', formatDeepPrice(futures.markPrice));
    setText('fut-funding', formatFunding(futures.funding));
    setText('fut-oi', formatCompactUSD(futures.openInterestUsd));
    setText('fut-longshort', formatRatio(futures.topRatio));
    setText('fut-taker', formatRatio(futures.takerRatio));
    setText('fut-index', formatDeepPrice(futures.indexPrice));

    const callout = byId('futures-callout');
    if (callout) callout.classList.add('is-live');
    updateDeepFuturesCallout();
    startDeepFundingCountdown(futures);
  }

  function updateDeepFuturesCallout() {
    const callout = byId('futures-callout');
    const futures = phase3State.currentToken && phase3State.currentToken.futures;
    if (!callout || !futures) return;
    const span = callout.querySelector('span');
    if (!span) return;

    const parts = [`Contrato ${futures.pair}`];
    if (Number.isFinite(futures.funding)) parts.push(`Funding ${formatFunding(futures.funding)}`);
    if (Number.isFinite(futures.nextFundingTime)) {
      parts.push(`próximo en ${formatClock(futures.nextFundingTime - Date.now())}`);
    }
    if (Number.isFinite(futures.openInterestUsd)) parts.push(`OI ${formatCompactUSD(futures.openInterestUsd)}`);
    if (futures.topRatio == null) parts.push('Top L/S sin fuente pública');
    span.textContent = parts.join(' · ');
  }

  function startDeepFundingCountdown(futures) {
    stopDeepFundingCountdown();
    if (!futures || !Number.isFinite(futures.nextFundingTime)) return;
    phase3State.fundingTimer = window.setInterval(updateDeepFuturesCallout, 1000);
  }

  function stopDeepFundingCountdown() {
    if (phase3State.fundingTimer) {
      window.clearInterval(phase3State.fundingTimer);
      phase3State.fundingTimer = null;
    }
  }

  function syncDeepTimeframeButtons() {
    $$('#token-chart-timeframes [data-timeframe]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.timeframe === phase3State.activeTimeframe);
    });
  }

  function ensureDeepChart() {
    if (phase3State.chart) return phase3State.chart;
    const container = byId('token-chart');
    if (!container) return null;

    if (!window.LightweightCharts || typeof window.LightweightCharts.createChart !== 'function') {
      setDeepChartOverlay('Lightweight Charts no disponible', 'No se pudo cargar la librería desde el CDN. Revisa la conexión y recarga.');
      return null;
    }

    const width = Math.max(320, container.clientWidth || 800);
    const height = Math.max(300, container.clientHeight || 360);
    const chart = window.LightweightCharts.createChart(container, {
      width,
      height,
      layout: {
        background: { type: 'solid', color: '#0b0e14' },
        textColor: '#8b93a7',
        fontFamily: 'Inter, system-ui, sans-serif'
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.035)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.035)' }
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.06, bottom: 0.26 }
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false
      },
      crosshair: {
        mode: 0
      }
    });

    const candles = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      priceLineVisible: false
    });
    const volume = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      priceLineVisible: false,
      lastValueVisible: false
    });
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 }
    });

    const lineOptions = {
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    };
    const ema20 = chart.addLineSeries({ ...lineOptions, color: '#f59e0b' });
    const ema50 = chart.addLineSeries({ ...lineOptions, color: '#60a5fa' });
    const ema200 = chart.addLineSeries({ ...lineOptions, color: '#a78bfa' });

    phase3State.chart = chart;
    phase3State.chartContainer = container;
    phase3State.chartSeries = { candles, volume, ema20, ema50, ema200 };

    const gridLines = container.parentElement ? container.parentElement.querySelector('.chart-grid-lines') : null;
    if (gridLines) gridLines.style.display = 'none';

    if (typeof window.ResizeObserver === 'function') {
      phase3State.chartResizeObserver = new window.ResizeObserver(resizeDeepChart);
      phase3State.chartResizeObserver.observe(container);
    }
    window.addEventListener('resize', resizeDeepChart);
    return chart;
  }

  function resizeDeepChart() {
    if (!phase3State.chart || !phase3State.chartContainer) return;
    const width = phase3State.chartContainer.clientWidth;
    const height = phase3State.chartContainer.clientHeight;
    if (width > 0 && height > 0) {
      phase3State.chart.applyOptions({ width, height });
    }
  }

  function renderDeepChart(timeframe) {
    const chart = ensureDeepChart();
    const series = phase3State.chartSeries;
    if (!chart || !series) return;

    const klines = phase3State.klines[timeframe];
    if (!Array.isArray(klines) || klines.length < 20) {
      series.candles.setData([]);
      series.volume.setData([]);
      series.ema20.setData([]);
      series.ema50.setData([]);
      series.ema200.setData([]);
      setDeepChartOverlay(
        'Sin velas para este activo',
        'No hay pares spot o futuros en Binance. Revisa el bloque DEX para operar el low-cap.'
      );
      setText('chart-last-price', 'Último cierre: —');
      setText('chart-legend-ohlc', 'O — · H — · L — · C —');
      return;
    }

    const seen = new Set();
    const candleData = [];
    klines.forEach((candle) => {
      const time = Math.floor(candle.time / 1000);
      if (!Number.isFinite(time) || seen.has(time)) return;
      seen.add(time);
      candleData.push({
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close
      });
    });
    if (!candleData.length) {
      setDeepChartOverlay('Sin velas válidas', 'Binance devolvió un formato sin precios utilizables.');
      return;
    }

    const closes = klines.map((candle) => candle.close);
    const ema20Data = calculateEMA(closes, 20);
    const ema50Data = calculateEMA(closes, 50);
    const ema200Data = calculateEMA(closes, 200);
    const toLineData = (values) => values
      .map((value, index) => (Number.isFinite(value) && candleData[index] ? { time: candleData[index].time, value } : null))
      .filter(Boolean);
    const volumeData = klines
      .map((candle, index) => (candleData[index] ? {
        time: candleData[index].time,
        value: Number.isFinite(candle.volume) ? candle.volume : 0,
        color: candle.close >= candle.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)'
      } : null))
      .filter(Boolean);

    const lastClose = candleData[candleData.length - 1].close;
    const precision = lastClose >= 1
      ? 2
      : lastClose >= 0.01
        ? 4
        : lastClose >= 0.0001
          ? 6
          : lastClose >= 0.000001
            ? 8
            : lastClose >= 0.00000001
              ? 10
              : 12;
    series.candles.applyOptions({
      priceFormat: {
        type: 'price',
        precision,
        minMove: 1 / (10 ** precision)
      }
    });
    series.candles.setData(candleData);
    series.volume.setData(volumeData);
    series.ema20.setData(toLineData(ema20Data));
    series.ema50.setData(toLineData(ema50Data));
    series.ema200.setData(toLineData(ema200Data));
    chart.timeScale().fitContent();
    hideDeepChartOverlay();
    setText('chart-subtitle', `Velas ${timeframe.toUpperCase()} · EMA 20/50/200 · Volumen`);
    setText('chart-last-price', `Último cierre: ${formatDeepPrice(candleData[candleData.length - 1].close)} · ${timeframe.toUpperCase()}`);

    const last = klines[klines.length - 1];
    setText('chart-legend-ohlc', `O ${formatDeepPrice(last.open)} · H ${formatDeepPrice(last.high)} · L ${formatDeepPrice(last.low)} · C ${formatDeepPrice(last.close)}`);
  }

  function renderDeepSignal(token) {
    const futures = token.futures || null;
    const macro = { score: state.lastMacroScore, count: state.lastMacroCount };
    const decision4h = token.klines4h ? buildDecision('4h', token.klines4h, futures, macro) : null;
    const decision1d = token.klines1d ? buildDecision('1d', token.klines1d, futures, macro) : null;
    const decisions = [decision4h, decision1d].filter(Boolean);

    if (!decisions.length) {
      setText('token-signal-score', '—');
      setText('token-signal-verdict', 'Sin velas para calcular');
      setText('token-signal-updated', 'Sin actualizar');
      const ring = byId('token-signal-ring');
      if (ring) {
        ring.style.setProperty('--score', '0');
        ring.className = 'score-ring is-neutral';
      }
      const badge = byId('token-signal-badge');
      if (badge) {
        badge.className = 'badge badge-neutral';
        badge.textContent = 'Sin datos';
      }
      setText('token-signal-summary', 'No hay velas suficientes para calcular EMA, RSI, ATR y niveles. Revisa el bloque DEX.');
      ['ema', 'rsi', 'atr', 'funding', 'ls', 'taker'].forEach((factor) => setFactorValue(`token-signal-${factor}`, '—', 0));
      return;
    }

    const raw = decisions.reduce((sum, decision) => sum + decision.raw, 0) / decisions.length;
    const displayScore = Math.round(decisions.reduce((sum, decision) => sum + decision.displayScore, 0) / decisions.length);
    const confidence = Math.round(decisions.reduce((sum, decision) => sum + decision.confidence, 0) / decisions.length);
    const verdict = getVerdict(raw);

    setText('token-signal-score', String(displayScore));
    setText('token-signal-verdict', verdict.label);
    setText('token-signal-updated', `4H/1D · ${formatShortDate(Date.now())}`);
    const ring = byId('token-signal-ring');
    if (ring) {
      ring.style.setProperty('--score', String(displayScore));
      ring.className = `score-ring ${verdict.tone === 'bull' ? 'is-bull' : verdict.tone === 'bear' ? 'is-bear' : 'is-neutral'}`;
      ring.title = `Score ${displayScore}/100 · bruto ${raw.toFixed(1)} · confianza ${confidence}%`;
    }
    const badge = byId('token-signal-badge');
    if (badge) {
      badge.className = `badge badge-${verdict.tone}`;
      badge.textContent = verdict.short;
      badge.title = `Score ${displayScore}/100 · confianza ${confidence}%`;
    }

    const summaryLines = [];
    if (decision4h) {
      summaryLines.push(`4H: ${decision4h.verdict.label} · Entrada ${formatDeepPrice(decision4h.levels.entry)} · Stop ${formatDeepPrice(decision4h.levels.stop)} · TP ${formatDeepPrice(decision4h.levels.target)}`);
    }
    if (decision1d) {
      summaryLines.push(`1D: ${decision1d.verdict.label} · Entrada ${formatDeepPrice(decision1d.levels.entry)} · Stop ${formatDeepPrice(decision1d.levels.stop)} · TP ${formatDeepPrice(decision1d.levels.target)}`);
    }
    const summary = byId('token-signal-summary');
    if (summary) summary.innerHTML = summaryLines.map((line) => escapeHtml(line)).join('<br>');

    const emaParts = [];
    if (decision4h) emaParts.push(`4H ${decision4h.factors.trend.label} (${signedPoints(decision4h.factors.trend.points)})`);
    if (decision1d) emaParts.push(`1D ${decision1d.factors.trend.label} (${signedPoints(decision1d.factors.trend.points)})`);
    setFactorValue('token-signal-ema', emaParts.join(' · '), decisions.reduce((sum, decision) => sum + decision.factors.trend.points, 0));

    const rsiParts = [];
    if (decision4h) rsiParts.push(`4H ${Number.isFinite(decision4h.indicators.rsi) ? decision4h.indicators.rsi.toFixed(1) : '—'}`);
    if (decision1d) rsiParts.push(`1D ${Number.isFinite(decision1d.indicators.rsi) ? decision1d.indicators.rsi.toFixed(1) : '—'}`);
    setFactorValue('token-signal-rsi', rsiParts.join(' · '), decisions.reduce((sum, decision) => sum + decision.factors.rsi.points, 0));

    const atrParts = [];
    if (decision4h) atrParts.push(`4H ${formatDeepPrice(decision4h.indicators.atr)}`);
    if (decision1d) atrParts.push(`1D ${formatDeepPrice(decision1d.indicators.atr)}`);
    setFactorValue('token-signal-atr', atrParts.join(' · '), 0);

    const fundingText = Number.isFinite(futures && futures.funding)
      ? `${formatFunding(futures.funding)}${Number.isFinite(futures.nextFundingTime) ? ` · ${formatClock(futures.nextFundingTime - Date.now())}` : ''}`
      : 'Sin contrato perpetuo';
    setFactorValue('token-signal-funding', fundingText, decisions.reduce((sum, decision) => sum + decision.factors.funding.points, 0));

    const lsText = futures && (futures.topRatio != null || futures.globalRatio != null)
      ? `Top ${formatRatio(futures.topRatio)} · Global ${formatRatio(futures.globalRatio)}`
      : 'Sin fuente pública';
    setFactorValue('token-signal-ls', lsText, decisions.reduce((sum, decision) => sum + decision.factors.ls.points, 0));

    const takerParts = [];
    if (decision4h) takerParts.push(`4H ${formatRatio(decision4h.indicators.takerRatio)}`);
    if (decision1d) takerParts.push(`1D ${formatRatio(decision1d.indicators.takerRatio)}`);
    setFactorValue('token-signal-taker', takerParts.join(' · '), decisions.reduce((sum, decision) => sum + decision.factors.taker.points, 0));

    const tradingView = byId('token-open-tradingview');
    if (tradingView) {
      const symbol = token.symbol || 'BTC';
      tradingView.href = token.spot
        ? `https://www.tradingview.com/chart/?symbol=BINANCE%3A${encodeURIComponent(`${symbol}USDT`)}`
        : `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`${symbol}USD`)}`;
    }
  }

  function clearDeepDive(message) {
    stopDeepFundingCountdown();
    phase3State.currentToken = null;
    phase3State.currentDex = null;
    phase3State.klines = { '4h': null, '1d': null };
    phase3State.activeTimeframe = '4h';
    syncDeepTimeframeButtons();

    setText('token-name', 'Sin resultados');
    setText('token-symbol', '—');
    setText('token-rank', '—');
    setText('token-subtitle', message);
    setText('token-price', '—');
    const logo = byId('token-logo');
    if (logo) logo.textContent = '?';
    const change = byId('token-change');
    if (change) {
      change.textContent = '— 24H';
      change.className = 'price-change neutral';
    }
    setText('token-marketcap', '—');
    setText('token-volume', '—');
    setText('token-fdv', '—');
    setText('spot-price', '—');
    setText('spot-change-24h', '—');
    const spotChange = byId('spot-change-24h');
    if (spotChange) spotChange.className = 'text-muted';
    setText('spot-high', '—');
    setText('spot-low', '—');
    setText('spot-volume', '—');
    setText('spot-marketcap', '—');
    setText('spot-fdv', '—');
    setText('spot-rank', '—');
    ['fut-mark', 'fut-funding', 'fut-oi', 'fut-longshort', 'fut-taker', 'fut-index'].forEach((id) => setText(id, '—'));
    const callout = byId('futures-callout');
    if (callout) {
      callout.classList.remove('is-live');
      const span = callout.querySelector('span');
      if (span) span.textContent = 'Selecciona un activo con contrato perpetuo en Binance para ver funding y Open Interest.';
    }
    setText('token-signal-score', '—');
    setText('token-signal-verdict', 'Esperando análisis');
    setText('token-signal-updated', 'Sin actualizar');
    const ring = byId('token-signal-ring');
    if (ring) {
      ring.style.setProperty('--score', '0');
      ring.className = 'score-ring is-neutral';
    }
    const badge = byId('token-signal-badge');
    if (badge) {
      badge.className = 'badge badge-neutral';
      badge.textContent = 'Sin datos';
    }
    setText('token-signal-summary', message);
    ['ema', 'rsi', 'atr', 'funding', 'ls', 'taker'].forEach((factor) => setFactorValue(`token-signal-${factor}`, '—', 0));

    if (phase3State.chartSeries) {
      Object.values(phase3State.chartSeries).forEach((series) => series.setData([]));
    }
    setDeepChartOverlay('Sin resultados', message);
    setText('chart-last-price', 'Último cierre: —');
    setText('chart-legend-ohlc', 'O — · H — · L — · C —');
    renderLowcapEmpty();
    renderForensics(null);
    setText('validation-symbol-badge', '—');
    autofillSimulator(null);
    document.dispatchEvent(new CustomEvent('crypto:intel:asset-updated', {
      detail: { mode: 'token', symbol: state.selectedSymbol || 'BTC', name: state.selectedSymbol || 'BTC', address: '', chain: '', slug: '' }
    }));
  }

  function renderLowcapPair(pair, dex) {
    if (!pair) {
      renderLowcapEmpty();
      return;
    }

    const liquidity = toFiniteNumber(pair.liquidity && pair.liquidity.usd);
    const fdv = toFiniteNumber(pair.fdv);
    const marketCap = toFiniteNumber(pair.marketCap);
    const txns1h = pair.txns && pair.txns.h1 ? pair.txns.h1 : {};
    const txns24h = pair.txns && pair.txns.h24 ? pair.txns.h24 : {};
    const buys1h = toFiniteNumber(txns1h.buys);
    const sells1h = toFiniteNumber(txns1h.sells);
    const buys24h = toFiniteNumber(txns24h.buys);
    const sells24h = toFiniteNumber(txns24h.sells);
    const volume24h = toFiniteNumber(pair.volume && pair.volume.h24);
    const chainId = pair.chainId || '';
    const dexId = pair.dexId || '-';
    const pairAddress = pair.pairAddress || '';
    const baseAddress = pair.baseToken && pair.baseToken.address ? pair.baseToken.address : '';
    const chainNames = {
      ethereum: 'Ethereum',
      eth: 'Ethereum',
      bsc: 'BNB Chain',
      solana: 'Solana',
      base: 'Base',
      arbitrum: 'Arbitrum',
      sui: 'Sui'
    };
    const chainLabel = chainNames[chainId.toLowerCase()] || chainId || '—';

    setText('lowcap-liquidity', formatCompactUSD(liquidity));
    setText('lowcap-fdv', formatCompactUSD(fdv));
    setText('lowcap-mcap', formatCompactUSD(marketCap));
    setText('lowcap-buys-1h', `${formatNumber(buys1h)} / ${formatNumber(sells1h)}`);
    setText('lowcap-buys-24h', `${formatNumber(buys24h)} / ${formatNumber(sells24h)}`);
    setText('lowcap-volume', formatCompactUSD(volume24h));
    setText('lowcap-pair-age', `Edad del par: ${formatPairAge(pair.pairCreatedAt)}`);
    setText('lowcap-dex', dexId);
    setText('lowcap-chain', chainLabel);
    setText('lowcap-contract', baseAddress || '-');

    const liquidityMetric = byId('lowcap-liquidity-metric');
    if (liquidityMetric) {
      liquidityMetric.classList.remove('is-safe', 'is-warning', 'is-risk');
      if (liquidity != null && liquidity >= 100000) liquidityMetric.classList.add('is-safe');
      else if (liquidity != null && liquidity >= 25000) liquidityMetric.classList.add('is-warning');
      else liquidityMetric.classList.add('is-risk');
    }

    let liquidityNote = 'Sin liquidez reportada';
    if (liquidity != null && liquidity >= 100000) liquidityNote = '🟢 Segura > $100k';
    else if (liquidity != null && liquidity >= 25000) liquidityNote = '🟡 Precaución $25k - $100k';
    else if (liquidity != null) liquidityNote = '🔴 Riesgo Alto de Rugpull < $25k';
    setText('lowcap-liquidity-note', liquidityNote);

    const risk = getDexRisk(pair, liquidity, buys24h, sells24h);
    setText('lowcap-risk-score', risk.label);
    const riskElement = byId('lowcap-risk-score');
    if (riskElement) {
      riskElement.className = risk.tone === 'safe' ? 'positive' : risk.tone === 'risk' ? 'negative' : 'text-muted';
    }
    const riskAlert = byId('lowcap-risk-alert');
    if (riskAlert) riskAlert.classList.toggle('is-danger', risk.tone === 'risk');
    const riskText = byId('lowcap-risk-text');
    if (riskText) {
      riskText.innerHTML = `<strong>Riesgo ${escapeHtml(risk.label)}:</strong> ${escapeHtml(risk.text)}`;
    }

    const dexLink = byId('lowcap-dexscreener-link');
    if (dexLink) dexLink.href = pairAddress ? `https://dexscreener.com/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}` : 'https://dexscreener.com/';
    const bubbleLink = byId('lowcap-bubblemaps-link');
    if (bubbleLink) bubbleLink.href = baseAddress ? `https://v2.bubblemaps.io/?chain=${encodeURIComponent(mapChainToBubblemaps(chainId))}&address=${encodeURIComponent(baseAddress)}` : 'https://v2.bubblemaps.io/';
    const gmgnLink = byId('lowcap-gmgn-link');
    if (gmgnLink) gmgnLink.href = baseAddress ? `https://gmgn.ai/${encodeURIComponent(mapChainToGmgn(chainId))}/token/${encodeURIComponent(baseAddress)}` : 'https://gmgn.ai/';

    const forensicInput = byId('forensic-contract-input');
    if (forensicInput && document.activeElement !== forensicInput) forensicInput.value = baseAddress;

    const securityKey = `${chainId}:${baseAddress}`;
    if (baseAddress && securityKey !== phase3State.securityKey) {
      phase3State.securityKey = securityKey;
      loadTokenSecurityAudit(pair);
    }
  }

  const GOPLUS_CHAIN_IDS = {
    ethereum: '1',
    eth: '1',
    bsc: '56',
    'binance-smart-chain': '56',
    base: '8453',
    arbitrum: '42161',
    solana: 'solana'
  };
  let securityAuditRequest = 0;

  function securityPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return number <= 1 ? number * 100 : number;
  }

  function setSecurityMetric(id, value, tone) {
    const strong = byId(id);
    if (strong) strong.textContent = value;
    const card = strong ? strong.closest('.security-metric') : null;
    if (card) {
      card.classList.remove('is-safe', 'is-warning', 'is-risk');
      if (tone) card.classList.add(`is-${tone}`);
    }
  }

  function renderSecurityEmpty(message = 'Selecciona un token para ejecutar la auditoría.') {
    setSecurityMetric('security-honeypot', '—');
    setSecurityMetric('security-buy-tax', '—');
    setSecurityMetric('security-sell-tax', '—');
    setSecurityMetric('security-mintable', '—');
    setSecurityMetric('security-lp', '—');
    setSecurityMetric('security-rugcheck-score', '—');
    const badge = byId('security-risk-badge');
    if (badge) {
      badge.className = 'badge badge-neutral';
      badge.textContent = 'Sin auditar';
    }
    const risks = byId('security-risks');
    if (risks) risks.innerHTML = `<div class="security-empty"><i data-lucide="shield-alert"></i><span>${escapeHtml(message)}</span></div>`;
    setText('security-status', message);
    const goplusLink = byId('security-goplus-link');
    const rugcheckLink = byId('security-rugcheck-link');
    if (goplusLink) goplusLink.href = 'https://gopluslabs.io/';
    if (rugcheckLink) rugcheckLink.href = 'https://rugcheck.xyz/';
    refreshIcons();
  }

  async function loadTokenSecurityAudit(pair, force = false) {
    const baseAddress = pair && pair.baseToken ? pair.baseToken.address : '';
    const chainId = pair && pair.chainId ? String(pair.chainId).toLowerCase() : '';
    if (!baseAddress || !chainId) {
      renderSecurityEmpty('Selecciona un token con contrato on-chain para auditar la seguridad.');
      return;
    }
    const key = `${chainId}:${baseAddress}`;
    if (!force && phase3State.securityAuditLoadedKey === key) return;
    phase3State.securityKey = key;
    const requestId = ++securityAuditRequest;
    setText('security-status', 'Consultando GoPlus Security y RugCheck…');
    const badge = byId('security-risk-badge');
    if (badge) {
      badge.className = 'badge badge-neutral';
      badge.textContent = 'Analizando…';
    }

    const goplusChain = GOPLUS_CHAIN_IDS[chainId] || '';
    const goplusUrl = goplusChain
      ? `https://api.gopluslabs.io/api/v1/token_security/${encodeURIComponent(goplusChain)}?contract_addresses=${encodeURIComponent(baseAddress)}`
      : '';
    const rugcheckUrl = chainId === 'solana'
      ? `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(baseAddress)}/report/summary`
      : '';

    const [goplusResult, rugcheckResult] = await Promise.allSettled([
      goplusUrl ? fetchPublic(goplusUrl, { timeout: 15000 }) : Promise.resolve(null),
      rugcheckUrl ? fetchPublic(rugcheckUrl, { timeout: 15000 }) : Promise.resolve(null)
    ]);
    if (requestId !== securityAuditRequest) return;

    const goplus = goplusResult.status === 'fulfilled' && goplusResult.value && goplusResult.value.result
      ? Object.values(goplusResult.value.result)[0] || null
      : null;
    const rugcheck = rugcheckResult.status === 'fulfilled' && rugcheckResult.value ? rugcheckResult.value : null;

    if (!goplus && !rugcheck) {
      renderSecurityEmpty('No se pudo obtener la auditoría. Revisa el contrato, la red o el proxy CORS.');
      return;
    }

    const buyTax = goplus ? securityPercent(goplus.buy_tax) : null;
    const sellTax = goplus ? securityPercent(goplus.sell_tax) : null;
    const honeypot = Boolean(goplus && String(goplus.is_honeypot) === '1');
    const mintable = Boolean(goplus && String(goplus.is_mintable) === '1');
    const ownerBalance = Boolean(goplus && String(goplus.owner_change_balance) === '1');
    const takeBack = Boolean(goplus && String(goplus.can_take_back_ownership) === '1');
    const hiddenOwner = Boolean(goplus && String(goplus.hidden_owner) === '1');
    const selfdestruct = Boolean(goplus && String(goplus.selfdestruct) === '1');
    const pausable = Boolean(goplus && String(goplus.transfer_pausable) === '1');
    const blacklisted = Boolean(goplus && String(goplus.is_blacklisted) === '1');
    const openSource = goplus ? String(goplus.is_open_source) !== '0' : null;
    const proxy = Boolean(goplus && String(goplus.is_proxy) === '1');
    const lpHolders = goplus && Array.isArray(goplus.lp_holders) ? goplus.lp_holders : [];
    const lockedPct = lpHolders.length
      ? lpHolders
        .filter((holder) => holder && (String(holder.is_locked) === '1' || /lock/i.test(String(holder.tag || ''))))
        .reduce((sum, holder) => sum + (securityPercent(holder.percent) || 0), 0)
      : null;
    const rugcheckScore = rugcheck && Number.isFinite(Number(rugcheck.score)) ? Number(rugcheck.score) : null;
    const rugRisks = rugcheck && Array.isArray(rugcheck.risks) ? rugcheck.risks : [];

    let riskPoints = 0;
    if (honeypot) riskPoints += 6;
    if (buyTax != null && buyTax > 10) riskPoints += 2;
    else if (buyTax != null && buyTax > 5) riskPoints += 1;
    if (sellTax != null && sellTax > 10) riskPoints += 2;
    else if (sellTax != null && sellTax > 5) riskPoints += 1;
    if (mintable) riskPoints += 1;
    if (ownerBalance) riskPoints += 2;
    if (takeBack) riskPoints += 1;
    if (hiddenOwner) riskPoints += 2;
    if (selfdestruct) riskPoints += 1;
    if (pausable) riskPoints += 1;
    if (blacklisted) riskPoints += 1;
    if (openSource === false) riskPoints += 1;
    if (proxy) riskPoints += 1;
    if (lockedPct != null && lockedPct < 50) riskPoints += 1;
    if (rugRisks.some((risk) => /danger|high|critical/i.test(String(risk.level || risk.severity || '')))) riskPoints += 2;
    else if (rugRisks.length) riskPoints += 1;

    setSecurityMetric('security-honeypot', honeypot ? '🔴 SÍ' : goplus ? '🟢 NO' : '—', honeypot ? 'risk' : goplus ? 'safe' : 'warning');
    setSecurityMetric('security-buy-tax', buyTax == null ? '—' : `${buyTax.toFixed(2)}%`, buyTax == null ? 'warning' : buyTax > 10 ? 'risk' : buyTax > 5 ? 'warning' : 'safe');
    setSecurityMetric('security-sell-tax', sellTax == null ? '—' : `${sellTax.toFixed(2)}%`, sellTax == null ? 'warning' : sellTax > 10 ? 'risk' : sellTax > 5 ? 'warning' : 'safe');
    const ownerFlags = [
      mintable ? 'Mintable' : '',
      ownerBalance ? 'Owner cambia saldos' : '',
      takeBack ? 'Ownership recuperable' : '',
      hiddenOwner ? 'Owner oculto' : ''
    ].filter(Boolean);
    setSecurityMetric('security-mintable', ownerFlags.length ? `🔴 ${ownerFlags.join(' · ')}` : goplus ? '🟢 Sin privilegios críticos' : '—', ownerFlags.length ? 'risk' : goplus ? 'safe' : 'warning');
    setSecurityMetric('security-lp', lockedPct == null ? '—' : `${Math.min(100, lockedPct).toFixed(1)}% bloqueada`, lockedPct == null ? 'warning' : lockedPct >= 50 ? 'safe' : 'risk');
    setSecurityMetric('security-rugcheck-score', rugcheckScore == null ? '—' : `${rugcheckScore} / 100`, rugcheckScore == null ? 'warning' : rugRisks.length ? 'warning' : 'safe');

    const badgeElement = byId('security-risk-badge');
    if (badgeElement) {
      if (riskPoints >= 6) {
        badgeElement.className = 'badge badge-bear';
        badgeElement.textContent = '🔴 Riesgo alto';
      } else if (riskPoints >= 3) {
        badgeElement.className = 'badge badge-amber';
        badgeElement.textContent = '🟡 Riesgo medio';
      } else {
        badgeElement.className = 'badge badge-green';
        badgeElement.textContent = '🟢 Riesgo bajo';
      }
    }

    const riskItems = [];
    if (honeypot) riskItems.push({ level: 'high', name: 'Honeypot', text: 'El contrato puede bloquear la venta o impedir retirar fondos.' });
    if (buyTax != null && buyTax > 5) riskItems.push({ level: 'high', name: 'Impuesto de compra alto', text: `Cobra ${buyTax.toFixed(2)}% al comprar.` });
    if (sellTax != null && sellTax > 5) riskItems.push({ level: 'high', name: 'Impuesto de venta alto', text: `Cobra ${sellTax.toFixed(2)}% al vender.` });
    if (mintable) riskItems.push({ level: 'medium', name: 'Token mintable', text: 'El owner puede emitir nuevos tokens y diluir el supply.' });
    if (ownerBalance) riskItems.push({ level: 'high', name: 'Owner puede cambiar saldos', text: 'El propietario puede modificar balances de holders.' });
    if (takeBack) riskItems.push({ level: 'medium', name: 'Ownership recuperable', text: 'El contrato puede recuperar la propiedad tras renunciar.' });
    if (hiddenOwner) riskItems.push({ level: 'high', name: 'Owner oculto', text: 'Hay un propietario no visible en la interfaz pública.' });
    if (selfdestruct) riskItems.push({ level: 'medium', name: 'Selfdestruct', text: 'El contrato puede autodestruirse.' });
    if (pausable) riskItems.push({ level: 'medium', name: 'Transferencias pausables', text: 'El owner puede pausar transferencias.' });
    if (blacklisted) riskItems.push({ level: 'medium', name: 'Blacklist', text: 'El contrato puede bloquear direcciones.' });
    if (openSource === false) riskItems.push({ level: 'medium', name: 'Contrato no verificado', text: 'El código fuente no está verificado públicamente.' });
    if (proxy) riskItems.push({ level: 'medium', name: 'Contrato proxy', text: 'La lógica puede cambiarse mediante un proxy.' });
    if (lockedPct != null && lockedPct < 50) riskItems.push({ level: 'medium', name: 'Liquidez poco bloqueada', text: `Solo ${lockedPct.toFixed(1)}% de la LP aparece bloqueada.` });
    rugRisks.forEach((risk) => {
      const name = risk.name || risk.title || 'RugCheck';
      if (riskItems.some((item) => item.name === name)) return;
      riskItems.push({
        level: String(risk.level || risk.severity || 'medium').toLowerCase(),
        name,
        text: risk.description || 'Riesgo detectado por RugCheck.'
      });
    });

    const risksBox = byId('security-risks');
    if (risksBox) {
      risksBox.innerHTML = riskItems.length
        ? riskItems.slice(0, 14).map((item) => `<div class="security-risk-item ${item.level === 'high' || item.level === 'critical' ? 'is-high' : item.level === 'low' || item.level === 'info' ? 'is-low' : ''}"><strong>${escapeHtml(item.name)}:</strong> ${escapeHtml(item.text)}</div>`).join('')
        : '<div class="security-empty"><i data-lucide="shield-check"></i><span>Sin alertas críticas detectadas por GoPlus/RugCheck. Verifica igualmente liquidez y holders.</span></div>';
    }
    setText('security-status', `Auditoría completada · ${goplus ? 'GoPlus' : 'GoPlus sin datos'} · ${rugcheck ? 'RugCheck' : 'RugCheck no aplica'} · ${riskItems.length} alerta(s).`);
    const goplusLink = byId('security-goplus-link');
    const rugcheckLink = byId('security-rugcheck-link');
    if (goplusLink) goplusLink.href = goplusChain ? `https://gopluslabs.io/token-security/${encodeURIComponent(goplusChain)}/${encodeURIComponent(baseAddress)}` : 'https://gopluslabs.io/';
    if (rugcheckLink) rugcheckLink.href = chainId === 'solana' ? `https://rugcheck.xyz/tokens/${encodeURIComponent(baseAddress)}` : 'https://rugcheck.xyz/';
    phase3State.securityAuditLoadedKey = key;
    refreshIcons();
  }

  function renderLowcapEmpty() {
    setText('lowcap-title', 'Escáner de liquidez y micro-cap on-chain');
    setText('lowcap-liquidity', '—');
    setText('lowcap-liquidity-note', 'Alerta si < $25,000');
    setText('lowcap-fdv', '—');
    setText('lowcap-mcap', '—');
    setText('lowcap-buys-1h', '- / -');
    setText('lowcap-buys-24h', '- / -');
    setText('lowcap-volume', '-');
    setText('lowcap-pair-age', 'Edad del par: -');
    setText('lowcap-dex', '-');
    setText('lowcap-chain', '-');
    setText('lowcap-risk-score', '-');
    const riskElement = byId('lowcap-risk-score');
    if (riskElement) riskElement.className = 'text-muted';
    setText('lowcap-contract', 'Selecciona un activo o pega 0x… / mint / package');
    const liquidityMetric = byId('lowcap-liquidity-metric');
    if (liquidityMetric) liquidityMetric.classList.remove('is-safe', 'is-warning', 'is-risk');
    const riskAlert = byId('lowcap-risk-alert');
    if (riskAlert) riskAlert.classList.remove('is-danger');
    const riskText = byId('lowcap-risk-text');
    if (riskText) riskText.innerHTML = '<strong>Alerta de liquidez:</strong> si el pool baja de $25,000, el slippage y el riesgo de rug pull se disparan. No compres solo porque el precio sube.';
    const dexLink = byId('lowcap-dexscreener-link');
    if (dexLink) dexLink.href = 'https://dexscreener.com/';
    const bubbleLink = byId('lowcap-bubblemaps-link');
    if (bubbleLink) bubbleLink.href = 'https://v2.bubblemaps.io/';
    const gmgnLink = byId('lowcap-gmgn-link');
    if (gmgnLink) gmgnLink.href = 'https://gmgn.ai/';
    phase3State.securityAuditLoadedKey = '';
    renderSecurityEmpty('Selecciona un activo con contrato para ejecutar la auditoría de seguridad.');
  }

  function formatPairAge(value) {
    const created = toFiniteNumber(value);
    if (created == null) return '—';
    const age = Math.max(0, Date.now() - created);
    const days = Math.floor(age / 86400000);
    const hours = Math.floor((age % 86400000) / 3600000);
    const minutes = Math.floor((age % 3600000) / 60000);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${Math.max(1, minutes)}m`;
  }

  function getDexRisk(pair, liquidity, buys24h, sells24h) {
    let points = 0;
    const age = pair && Number.isFinite(toFiniteNumber(pair.pairCreatedAt))
      ? Date.now() - toFiniteNumber(pair.pairCreatedAt)
      : null;
    const volume = toFiniteNumber(pair && pair.volume && pair.volume.h24);

    if (liquidity != null && liquidity >= 100000) points += 2;
    else if (liquidity != null && liquidity >= 25000) points += 1;
    else points -= 2;

    if (age != null && age >= 30 * 86400000) points += 1;
    else if (age != null && age < 7 * 86400000) points -= 1;

    if (buys24h != null && sells24h != null) {
      if (buys24h > sells24h) points += 1;
      else if (buys24h < sells24h) points -= 1;
    }
    if (volume != null && volume >= 100000) points += 1;

    if (points >= 3) {
      return {
        label: 'Bajo',
        tone: 'safe',
        text: `Liquidez ${formatCompactUSD(liquidity)} · Edad ${formatPairAge(pair.pairCreatedAt)} · Flujo 24H ${formatNumber(buys24h)}/${formatNumber(sells24h)}. Pool profundo y actividad equilibrada; aun así verifica contrato y holders.`
      };
    }
    if (points >= 0) {
      return {
        label: 'Medio',
        tone: 'warning',
        text: `Liquidez ${formatCompactUSD(liquidity)} · Edad ${formatPairAge(pair.pairCreatedAt)} · Flujo 24H ${formatNumber(buys24h)}/${formatNumber(sells24h)}. Revisa bloqueo de liquidez, holders y concentración antes de entrar.`
      };
    }
    return {
      label: 'Alto',
      tone: 'risk',
      text: `Liquidez ${formatCompactUSD(liquidity)} · Edad ${formatPairAge(pair.pairCreatedAt)} · Flujo 24H ${formatNumber(buys24h)}/${formatNumber(sells24h)}. Slippage y rugpull elevados; no compres solo porque el precio sube.`
    };
  }

  function renderForensics(pair) {
    if (!pair) {
      const dexShell = byId('forensic-dex-shell');
      const bubbleShell = byId('forensic-bubble-shell');
      if (dexShell) dexShell.classList.add('is-empty');
      if (bubbleShell) bubbleShell.classList.add('is-empty');
      const dexEmpty = byId('forensic-dex-empty');
      const bubbleEmpty = byId('forensic-bubble-empty');
      if (dexEmpty) dexEmpty.hidden = false;
      if (bubbleEmpty) bubbleEmpty.hidden = false;
      const dexFrame = byId('forensic-dex-iframe');
      const bubbleFrame = byId('forensic-bubble-iframe');
      if (dexFrame) {
        dexFrame.hidden = true;
        dexFrame.removeAttribute('src');
      }
      if (bubbleFrame) {
        bubbleFrame.hidden = true;
        bubbleFrame.removeAttribute('src');
      }
      const dexOpen = byId('forensic-dex-open');
      const bubbleOpen = byId('forensic-bubble-open');
      const gmgnOpen = byId('forensic-gmgn-open');
      if (dexOpen) dexOpen.href = 'https://dexscreener.com/';
      if (bubbleOpen) bubbleOpen.href = 'https://v2.bubblemaps.io/';
      if (gmgnOpen) gmgnOpen.href = 'https://gmgn.ai/';
      return;
    }
    loadForensicViewer(pair);
  }

  function loadForensicViewer(pair) {
    if (!pair) return;
    const chainId = pair.chainId || '';
    const pairAddress = pair.pairAddress || '';
    const baseAddress = pair.baseToken && pair.baseToken.address ? pair.baseToken.address : '';
    if (!pairAddress || !baseAddress) return;

    const dexOpenUrl = `https://dexscreener.com/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`;
    const dexEmbedUrl = `${dexOpenUrl}?embed=1&theme=dark&trades=0&info=0`;
    const bubbleUrl = `https://v2.bubblemaps.io/?chain=${encodeURIComponent(mapChainToBubblemaps(chainId))}&address=${encodeURIComponent(baseAddress)}`;
    const gmgnUrl = `https://gmgn.ai/${encodeURIComponent(mapChainToGmgn(chainId))}/token/${encodeURIComponent(baseAddress)}`;

    const dexFrame = byId('forensic-dex-iframe');
    const bubbleFrame = byId('forensic-bubble-iframe');
    const dexShell = byId('forensic-dex-shell');
    const bubbleShell = byId('forensic-bubble-shell');
    const dexEmpty = byId('forensic-dex-empty');
    const bubbleEmpty = byId('forensic-bubble-empty');

    if (dexFrame) {
      dexFrame.src = dexEmbedUrl;
      dexFrame.hidden = false;
    }
    if (bubbleFrame) {
      bubbleFrame.src = bubbleUrl;
      bubbleFrame.hidden = false;
    }
    if (dexShell) dexShell.classList.remove('is-empty');
    if (bubbleShell) bubbleShell.classList.remove('is-empty');
    if (dexEmpty) dexEmpty.hidden = true;
    if (bubbleEmpty) bubbleEmpty.hidden = true;

    const dexOpen = byId('forensic-dex-open');
    const bubbleOpen = byId('forensic-bubble-open');
    const gmgnOpen = byId('forensic-gmgn-open');
    if (dexOpen) dexOpen.href = dexOpenUrl;
    if (bubbleOpen) bubbleOpen.href = bubbleUrl;
    if (gmgnOpen) gmgnOpen.href = gmgnUrl;

    const forensicInput = byId('forensic-contract-input');
    if (forensicInput && document.activeElement !== forensicInput) forensicInput.value = baseAddress;
  }

  async function loadForensicFromInput() {
    const input = byId('forensic-contract-input');
    const query = input ? input.value.trim() : '';
    if (!query) {
      showToast('Pega un contrato 0x, mint Solana o package Sui para cargar el visor.', 'warning');
      return;
    }

    const currentPair = phase3State.currentDex;
    if (currentPair) {
      const baseAddress = currentPair.baseToken && currentPair.baseToken.address;
      if (baseAddress && baseAddress.toLowerCase() === query.toLowerCase()) {
        loadForensicViewer(currentPair);
        return;
      }
    }

    if (!isContractQuery(query)) {
      showToast('El visor forense necesita una dirección de contrato completa.', 'warning');
      return;
    }

    const button = byId('forensic-load');
    const original = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i data-lucide="loader-circle"></i> Buscando';
      refreshIcons();
    }

    try {
      const dex = await fetchDexScreener(query, true);
      if (!dex || !dex.pair) {
        showToast('DEX Screener no encontró un par con liquidez para ese contrato.', 'warning');
        return;
      }
      phase3State.currentDex = dex.pair;
      renderLowcapPair(dex.pair, dex);
      loadForensicViewer(dex.pair);
      showToast('Visor forense actualizado con el par de mayor liquidez.', 'success');
    } catch (error) {
      console.warn('[Forensic Viewer]', error);
      showToast('No se pudo cargar el visor forense. Revisa el contrato o el proxy.', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = original;
        refreshIcons();
      }
    }
  }

  function mapChainToGmgn(chainId) {
    const chain = String(chainId || '').toLowerCase();
    const map = {
      ethereum: 'eth',
      eth: 'eth',
      bsc: 'bsc',
      binance: 'bsc',
      solana: 'sol',
      sol: 'sol',
      base: 'base',
      arbitrum: 'arb',
      arb: 'arb',
      sui: 'sui',
      polygon: 'polygon',
      avalanche: 'avax',
      avax: 'avax'
    };
    return map[chain] || chain;
  }

  function mapChainToBubblemaps(chainId) {
    const chain = String(chainId || '').toLowerCase();
    const map = {
      ethereum: 'eth',
      eth: 'eth',
      bsc: 'bsc',
      binance: 'bsc',
      solana: 'sol',
      sol: 'sol',
      base: 'base',
      arbitrum: 'arbitrum',
      arb: 'arbitrum',
      sui: 'sui',
      polygon: 'polygon',
      avalanche: 'avax',
      avax: 'avax'
    };
    return map[chain] || chain;
  }

  function updateValidationLinks(identity, pair) {
    const symbol = identity && identity.symbol ? identity.symbol : (pair && pair.baseToken && pair.baseToken.symbol ? pair.baseToken.symbol : '');
    const name = identity && identity.name ? identity.name : (pair && pair.baseToken && pair.baseToken.name ? pair.baseToken.name : symbol);
    const id = identity && identity.id ? identity.id : '';
    const slug = id || String(name || symbol || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const badge = byId('validation-symbol-badge');
    if (badge) badge.textContent = symbol || '—';

    const terminal = $('#link-token-terminal .validation-open');
    if (terminal) terminal.href = slug ? `https://tokenterminal.com/explorer/projects/${encodeURIComponent(slug)}` : 'https://tokenterminal.com/explorer';
    const artemis = $('#link-artemis .validation-open');
    if (artemis) artemis.href = slug ? `https://classic.artemis.ai/project/${encodeURIComponent(slug)}` : 'https://www.artemis.ai/sectors/flows';
    const calendar = $('#link-coinmarketcal .validation-open');
    if (calendar) calendar.href = symbol ? `https://coinmarketcal.com/en/coin/${encodeURIComponent(symbol.toLowerCase())}` : 'https://coinmarketcal.com/';
    const perspective = $('#link-perspective .validation-open');
    if (perspective) perspective.href = slug ? `https://thecoinperspective.com/?p=${encodeURIComponent(slug)}` : 'https://thecoinperspective.com/';
    const livecoinwatch = $('#link-livecoinwatch .validation-open');
    if (livecoinwatch) livecoinwatch.href = symbol ? `https://www.livecoinwatch.com/price/${encodeURIComponent(name || symbol)}-${encodeURIComponent(symbol)}` : 'https://www.livecoinwatch.com/';

    const terminalAccess = $('#link-token-terminal .source-access-group');
    if (terminalAccess) terminalAccess.innerHTML = '<span class="access-badge login">🌐 Login Web</span>';
    const artemisAccess = $('#link-artemis .source-access-group');
    if (artemisAccess) artemisAccess.innerHTML = '<span class="access-badge login">🌐 Login Web</span>';
    const calendarAccess = $('#link-coinmarketcal .source-access-group');
    if (calendarAccess) calendarAccess.innerHTML = '<span class="access-badge key">🔑 API Key Gratis</span><span class="access-badge login">🌐 Login Web</span>';
    const liveAccess = $('#link-livecoinwatch .source-access-group');
    if (liveAccess) {
      liveAccess.innerHTML = state.apiKeys.livecoinwatch
        ? '<span class="access-badge key">🟢 Conectada</span>'
        : '<span class="access-badge key">🔑 API Key Gratis</span>';
    }

    const copy = $('#link-livecoinwatch .validation-copy p');
    if (copy && !copy.dataset.original) copy.dataset.original = copy.textContent;
    if (copy && !state.apiKeys.livecoinwatch) copy.textContent = copy.dataset.original;
    refreshIcons();
  }

  async function loadLiveCoinWatchLiquidity(symbol, identity) {
    const key = state.apiKeys.livecoinwatch;
    const copy = $('#link-livecoinwatch .validation-copy p');
    if (copy && !copy.dataset.original) copy.dataset.original = copy.textContent;
    if (!key) {
      if (copy) copy.textContent = copy.dataset.original || 'Profundidad del order book ±2% y liquidez real.';
      return;
    }
    if (!symbol) return;

    if (copy) copy.textContent = 'Consultando liquidez real en LiveCoinWatch...';
    try {
      const data = await fetchProtected('https://api.livecoinwatch.com/coins/single', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ currency: 'USD', code: symbol, meta: true }),
        timeout: 12000
      });
      const liquidity = toFiniteNumber(data && (data.liquidity ?? data.liquidityUsd ?? data.volume));
      const volume = toFiniteNumber(data && data.volume);
      const marketCap = toFiniteNumber(data && data.marketCap);
      if (copy) {
        if (liquidity != null || volume != null) {
          copy.textContent = `Liquidez/Volumen 24H: ${formatCompactUSD(liquidity ?? volume)}${marketCap != null ? ` · Market cap: ${formatCompactUSD(marketCap)}` : ''}.`;
        } else {
          copy.textContent = 'LiveCoinWatch respondió sin profundidad de libro; abre la fuente para revisar el order book.';
        }
      }
      const access = $('#link-livecoinwatch .source-access-group');
      if (access) access.innerHTML = '<span class="access-badge key">🟢 Conectada</span>';
      refreshIcons();
    } catch (error) {
      console.warn('[LiveCoinWatch]', error);
      if (copy) copy.textContent = 'No se pudo consultar LiveCoinWatch desde el navegador (CORS/key). Abre la fuente para revisar la liquidez.';
    }
  }

  function loadSimReferenceAssets() {
    fetchPublic(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(DEEP_REFERENCE_IDS.join(','))}&order=market_cap_desc&sparkline=false`,
      { timeout: 15000 }
    ).then((data) => {
      if (!Array.isArray(data)) return;
      phase3State.referenceAssets = data
        .map((coin) => ({
          id: coin.id,
          symbol: String(coin.symbol || '').toUpperCase(),
          name: coin.name,
          marketCap: toFiniteNumber(coin.market_cap),
          price: toFiniteNumber(coin.current_price)
        }))
        .filter((coin) => coin.id && coin.symbol && coin.marketCap != null);
      populateSimReferenceOptions();
    }).catch((error) => {
      console.warn('[CoinGecko References]', error);
    });
  }

  function populateSimReferenceOptions() {
    const select = byId('sim-reference');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Personalizado</option>' + phase3State.referenceAssets.map((asset) => (
      `<option value="${escapeHtml(asset.id)}">${escapeHtml(asset.symbol)} · ${escapeHtml(formatCompactUSD(asset.marketCap))}</option>`
    )).join('');
    if (phase3State.referenceAssets.some((asset) => asset.id === current)) select.value = current;
  }

  function getCurrentMarketCap() {
    const token = phase3State.currentToken;
    if (!token) return null;
    return toFiniteNumber(token.identity && token.identity.marketCap)
      ?? toFiniteNumber(token.pair && token.pair.marketCap)
      ?? toFiniteNumber(token.identity && token.identity.fdv)
      ?? toFiniteNumber(token.pair && token.pair.fdv)
      ?? null;
  }

  function parseSimNumber(value) {
    if (value == null) return null;
    const raw = String(value).trim().replace(/[$%\s]/g, '');
    if (!raw) return null;
    const normalized = raw.includes(',') && raw.includes('.')
      ? raw.replace(/,/g, '')
      : raw.replace(/,/g, '');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function autofillSimulator(token) {
    const priceInput = byId('sim-current-price');
    const targetInput = byId('sim-target-mcap');
    const circulatingInput = byId('sim-circulating');
    const totalInput = byId('sim-total');
    const maxInput = byId('sim-max');
    const multiplierInput = byId('sim-multiplier');
    const reference = byId('sim-reference');
    phase3State.simReference = null;
    if (reference) reference.value = '';

    if (!token) {
      if (priceInput) priceInput.value = '—';
      if (targetInput) targetInput.value = '';
      if (circulatingInput) circulatingInput.value = '';
      if (totalInput) totalInput.value = '';
      if (maxInput) maxInput.value = '';
      if (multiplierInput) multiplierInput.value = '2';
      setText('sim-target-price', '$—');
      setText('sim-used-mcap', '—');
      setText('sim-implied-fdv', '—');
      setText('sim-price-per-token', '—');
      setText('sim-ratio', '—');
      const upside = byId('sim-upside');
      if (upside) {
        upside.textContent = '—';
        upside.className = 'sim-upside neutral';
      }
      const badge = byId('sim-valuation-badge');
      if (badge) {
        badge.className = 'badge badge-neutral';
        badge.textContent = 'Sin calcular';
      }
      setText('sim-valuation-note', 'El simulador es una herramienta de escenarios, no una predicción de precio.');
      const bar = byId('sim-visual-bar');
      if (bar) bar.style.width = '50%';
      return;
    }

    const identity = token.identity || {};
    const marketCap = getCurrentMarketCap();
    const derivedSupply = marketCap != null && Number.isFinite(token.price) && token.price > 0
      ? marketCap / token.price
      : null;
    const circulating = toFiniteNumber(identity.circulatingSupply) ?? derivedSupply;
    if (priceInput) priceInput.value = Number.isFinite(token.price) ? String(token.price) : '—';
    if (targetInput) targetInput.value = marketCap != null ? String(Math.round(marketCap)) : '';
    if (circulatingInput) circulatingInput.value = circulating != null ? String(Math.round(circulating)) : '';
    if (totalInput) totalInput.value = identity.totalSupply != null ? String(identity.totalSupply) : '';
    if (maxInput) maxInput.value = identity.maxSupply != null ? String(identity.maxSupply) : '';
    if (multiplierInput) multiplierInput.value = '2';
    calculateSimulator();
  }

  function calculateSimulator() {
    const token = phase3State.currentToken;
    const priceInput = byId('sim-current-price');
    const targetInput = byId('sim-target-mcap');
    const circulatingInput = byId('sim-circulating');
    const totalInput = byId('sim-total');
    const maxInput = byId('sim-max');
    const multiplierInput = byId('sim-multiplier');

    const currentPrice = parseSimNumber(priceInput && priceInput.value);
    if (!token || currentPrice == null || currentPrice <= 0) {
      setText('sim-target-price', '$—');
      setText('sim-used-mcap', '—');
      setText('sim-implied-fdv', '—');
      setText('sim-price-per-token', '—');
      setText('sim-ratio', '—');
      const badge = byId('sim-valuation-badge');
      if (badge) {
        badge.className = 'badge badge-neutral';
        badge.textContent = 'Sin calcular';
      }
      setText('sim-valuation-note', 'Carga un activo con precio y suministro para simular escenarios.');
      const upsideElement = byId('sim-upside');
      if (upsideElement) {
        upsideElement.textContent = '—';
        upsideElement.className = 'sim-upside neutral';
      }
      const bar = byId('sim-visual-bar');
      if (bar) bar.style.width = '50%';
      return;
    }

    const currentMarketCap = getCurrentMarketCap();
    const multiplier = parseSimNumber(multiplierInput && multiplierInput.value) ?? 1;
    let targetMarketCap = parseSimNumber(targetInput && targetInput.value);
    if (targetMarketCap == null && currentMarketCap != null) targetMarketCap = currentMarketCap * multiplier;
    const circulating = parseSimNumber(circulatingInput && circulatingInput.value)
      ?? toFiniteNumber(token.identity && token.identity.circulatingSupply)
      ?? toFiniteNumber(token.identity && token.identity.totalSupply)
      ?? (currentMarketCap != null && currentPrice > 0 ? currentMarketCap / currentPrice : null);
    const total = parseSimNumber(totalInput && totalInput.value)
      ?? toFiniteNumber(token.identity && token.identity.totalSupply)
      ?? circulating;
    const max = parseSimNumber(maxInput && maxInput.value)
      ?? toFiniteNumber(token.identity && token.identity.maxSupply)
      ?? total
      ?? circulating;

    if (targetMarketCap == null || circulating == null || circulating <= 0) {
      setText('sim-target-price', '$—');
      setText('sim-used-mcap', '—');
      setText('sim-implied-fdv', '—');
      setText('sim-price-per-token', '—');
      setText('sim-ratio', '—');
      const upsideElement = byId('sim-upside');
      if (upsideElement) {
        upsideElement.textContent = '—';
        upsideElement.className = 'sim-upside neutral';
      }
      setText('sim-valuation-note', 'Falta el market cap objetivo o el suministro circulante para calcular el precio implícito.');
      const badge = byId('sim-valuation-badge');
      if (badge) {
        badge.className = 'badge badge-neutral';
        badge.textContent = 'Faltan datos';
      }
      const bar = byId('sim-visual-bar');
      if (bar) bar.style.width = '50%';
      return;
    }

    const targetPrice = targetMarketCap / circulating;
    const impliedFdv = targetPrice * (max || total || circulating);
    const ratio = targetPrice / currentPrice;
    const upside = (ratio - 1) * 100;
    const reference = phase3State.simReference;

    if (targetInput && !targetInput.value.trim()) targetInput.value = String(Math.round(targetMarketCap));
    setText('sim-target-price', formatDeepPrice(targetPrice));
    setText('sim-used-mcap', formatCompactUSD(targetMarketCap));
    setText('sim-implied-fdv', formatCompactUSD(impliedFdv));
    setText('sim-price-per-token', formatDeepPrice(targetPrice));
    setText('sim-ratio', `×${ratio.toFixed(2)}`);
    const upsideElement = byId('sim-upside');
    if (upsideElement) {
      upsideElement.textContent = `${upside >= 0 ? '+' : ''}${upside.toFixed(2)}%`;
      upsideElement.className = `sim-upside ${upside > 0 ? 'up' : upside < 0 ? 'down' : 'neutral'}`;
    }
    const badge = byId('sim-valuation-badge');
    if (badge) {
      badge.className = `badge badge-${ratio > 1 ? 'bull' : ratio < 1 ? 'bear' : 'neutral'}`;
      badge.textContent = ratio > 1 ? 'Alcista' : ratio < 1 ? 'Bajista' : 'Neutral';
    }
    const bar = byId('sim-visual-bar');
    if (bar && currentMarketCap != null && targetMarketCap > 0) {
      bar.style.width = `${clamp((currentMarketCap / targetMarketCap) * 100, 4, 100)}%`;
    }
    const targetLabel = reference ? `el market cap de ${reference.symbol} (${formatCompactUSD(targetMarketCap)})` : `un market cap de ${formatCompactUSD(targetMarketCap)}`;
    setText('sim-valuation-note', `Si ${token.symbol} alcanzara ${targetLabel}, su precio sería ${formatDeepPrice(targetPrice)} (Multiplicador: ${ratio.toFixed(2)}x).`);
  }

  async function copyToClipboard(text) {
    const value = String(text == null ? '' : text).trim();
    if (!value) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (error) {
      // Se usa el fallback de textarea.
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    } catch (error) {
      return false;
    }
  }

  const WALLET_CHAINS = {
    eth: {
      label: 'Ethereum',
      nativeSymbol: 'ETH',
      priceSymbol: 'ETH',
      coingeckoId: 'ethereum',
      decimals: 18,
      type: 'evm',
      rpc: 'https://ethereum-rpc.publicnode.com',
      rpcFallbacks: ['https://cloudflare-eth.com'],
      explorer: 'https://etherscan.io/address/',
      gmgn: 'eth',
      bubblemaps: 'eth',
      dexscreener: 'ethereum',
      placeholder: '0x… dirección EVM de 40 caracteres'
    },
    bnb: {
      label: 'BNB Chain',
      nativeSymbol: 'BNB',
      priceSymbol: 'BNB',
      coingeckoId: 'binancecoin',
      decimals: 18,
      type: 'evm',
      rpc: 'https://bsc-dataseed.binance.org',
      rpcFallbacks: ['https://bsc-rpc.publicnode.com'],
      explorer: 'https://bscscan.com/address/',
      gmgn: 'bsc',
      bubblemaps: 'bsc',
      dexscreener: 'bsc',
      placeholder: '0x… dirección EVM de 40 caracteres'
    },
    sol: {
      label: 'Solana',
      nativeSymbol: 'SOL',
      priceSymbol: 'SOL',
      coingeckoId: 'solana',
      decimals: 9,
      type: 'solana',
      rpc: 'https://api.mainnet-beta.solana.com',
      rpcFallbacks: ['https://solana-rpc.publicnode.com'],
      explorer: 'https://solscan.io/account/',
      gmgn: 'sol',
      bubblemaps: 'sol',
      dexscreener: 'solana',
      placeholder: 'Dirección Base58 de Solana'
    },
    sui: {
      label: 'Sui',
      nativeSymbol: 'SUI',
      priceSymbol: 'SUI',
      coingeckoId: 'sui',
      decimals: 9,
      type: 'sui',
      rpc: 'https://fullnode.mainnet.sui.io:443',
      rpcFallbacks: ['https://sui-mainnet-endpoint.blockvision.org'],
      explorer: 'https://suiscan.xyz/mainnet/account/',
      gmgn: 'sui',
      bubblemaps: 'sui',
      dexscreener: 'sui',
      placeholder: '0x… dirección o package Sui'
    },
    xrp: {
      label: 'XRP Ledger',
      nativeSymbol: 'XRP',
      priceSymbol: 'XRP',
      coingeckoId: 'ripple',
      decimals: 6,
      type: 'xrp',
      rpc: 'https://s1.ripple.com:51234/',
      rpcFallbacks: ['https://xrplcluster.com/'],
      explorer: 'https://xrpscan.com/account/',
      gmgn: 'xrp',
      bubblemaps: 'xrp',
      dexscreener: 'xrp',
      placeholder: 'Dirección XRP que empieza por r'
    },
    btc: {
      label: 'Bitcoin',
      nativeSymbol: 'BTC',
      priceSymbol: 'BTC',
      coingeckoId: 'bitcoin',
      decimals: 8,
      type: 'btc',
      rpc: 'https://mempool.space/api/address/',
      explorer: 'https://mempool.space/address/',
      gmgn: 'btc',
      bubblemaps: 'btc',
      dexscreener: 'bitcoin',
      placeholder: 'bc1… / 1… / 3… dirección Bitcoin'
    },
    base: {
      label: 'Base',
      nativeSymbol: 'ETH',
      priceSymbol: 'ETH',
      coingeckoId: 'ethereum',
      decimals: 18,
      type: 'evm',
      rpc: 'https://mainnet.base.org',
      rpcFallbacks: ['https://base-rpc.publicnode.com'],
      explorer: 'https://basescan.org/address/',
      gmgn: 'base',
      bubblemaps: 'base',
      dexscreener: 'base',
      placeholder: '0x… dirección EVM de 40 caracteres'
    },
    arbitrum: {
      label: 'Arbitrum',
      nativeSymbol: 'ETH',
      priceSymbol: 'ETH',
      coingeckoId: 'ethereum',
      decimals: 18,
      type: 'evm',
      rpc: 'https://arb1.arbitrum.io/rpc',
      rpcFallbacks: ['https://arbitrum-one-rpc.publicnode.com'],
      explorer: 'https://arbiscan.io/address/',
      gmgn: 'arb',
      bubblemaps: 'arbitrum',
      dexscreener: 'arbitrum',
      placeholder: '0x… dirección EVM de 40 caracteres'
    }
  };

  function initWalletTrackerPanel() {
    if (phase3State.walletPanelInitialized) return;
    phase3State.walletPanelInitialized = true;
    const form = byId('wallet-form');
    const network = byId('wallet-network');
    const refresh = byId('wallet-refresh');
    const clear = byId('clear-wallets');
    const save = byId('wallet-save-current');
    const table = byId('watched-wallets-body');

    if (network) network.addEventListener('change', updateWalletPlaceholder);
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        handleWalletSubmit();
      });
    }
    if (refresh) refresh.addEventListener('click', refreshAllWallets);
    if (clear) clear.addEventListener('click', clearWallets);
    if (save) save.addEventListener('click', saveCurrentWallet);
    byId('clear-whale-alerts')?.addEventListener('click', clearWhaleAlerts);

    $$('[data-wallet-network]').forEach((button) => {
      button.addEventListener('click', () => {
        const chain = button.dataset.walletNetwork;
        if (!WALLET_CHAINS[chain]) return;
        if (network) network.value = chain;
        updateWalletPlaceholder();
        const address = byId('wallet-address');
        if (address) address.focus();
      });
    });

    byId('wallet-result-address')?.addEventListener('click', async () => {
      const wallet = phase3State.currentWallet;
      if (!wallet) return;
      if (await copyToClipboard(wallet.address)) showToast('Dirección copiada al portapapeles.', 'success');
      else showToast('No se pudo copiar la dirección.', 'warning');
    });

    byId('wallet-copy-address')?.addEventListener('click', async () => {
      const wallet = phase3State.currentWallet;
      if (!wallet) return;
      if (await copyToClipboard(wallet.address)) showToast('Dirección copiada al portapapeles.', 'success');
      else showToast('No se pudo copiar la dirección.', 'warning');
    });

    if (table) {
      table.addEventListener('click', (event) => {
        const action = event.target.closest('[data-wallet-action]');
        if (!action) return;
        const row = action.closest('[data-wallet-id]');
        const wallet = phase3State.wallets.find((item) => item.id === (row && row.dataset.walletId));
        if (!wallet) return;
        const command = action.dataset.walletAction;
        if (command === 'refresh') refreshWallet(wallet, action);
        else if (command === 'delete') deleteWallet(wallet.id);
        else if (command === 'load') loadWalletIntoForm(wallet);
      });
    }

    updateWalletPlaceholder();
    renderWatchedWallets();
    renderWhaleAlerts();
  }

  function updateWalletPlaceholder() {
    const select = byId('wallet-network');
    const address = byId('wallet-address');
    if (!select || !address) return;
    const config = WALLET_CHAINS[select.value];
    if (config) address.placeholder = config.placeholder;
  }

  function validateWalletAddress(network, address) {
    const value = String(address == null ? '' : address).trim();
    const config = WALLET_CHAINS[network];
    if (!config || !value) return false;
    if (config.type === 'evm') return /^0x[a-fA-F0-9]{40}$/.test(value);
    if (config.type === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
    if (config.type === 'sui') return /^0x[a-fA-F0-9]{1,64}$/.test(value);
    if (config.type === 'xrp') return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value);
    if (config.type === 'btc') return /^(bc1[a-zA-HJ-NP-Z0-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(value);
    return false;
  }

  async function handleWalletSubmit() {
    const select = byId('wallet-network');
    const addressInput = byId('wallet-address');
    const aliasInput = byId('wallet-alias');
    const button = byId('wallet-track-btn');
    const network = select ? select.value : '';
    const address = addressInput ? addressInput.value.trim() : '';
    const alias = aliasInput ? aliasInput.value.trim() : '';
    const config = WALLET_CHAINS[network];

    if (!config) {
      showToast('Selecciona una red compatible.', 'warning');
      return;
    }
    if (!validateWalletAddress(network, address)) {
      showToast(`Dirección inválida para ${config.label}. Formato esperado: ${config.placeholder}`, 'warning');
      return;
    }

    const original = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i data-lucide="loader-circle"></i><span>Consultando...</span>';
      refreshIcons();
    }

    try {
      const wallet = await fetchWalletBalance(network, address, alias);
      phase3State.currentWallet = wallet;
      renderWalletResult(wallet);
      updateWalletAuditLinks(wallet);
      showToast(`Saldo consultado en ${config.label}.`, 'success');
    } catch (error) {
      console.warn('[Wallet Tracker]', error);
      showToast(`No se pudo consultar la wallet: ${error.message || 'RPC no disponible'}.`, 'error');
      const empty = byId('wallet-result-empty');
      const content = byId('wallet-result-content');
      if (empty) empty.hidden = false;
      if (content) content.hidden = true;
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = original;
        refreshIcons();
      }
    }
  }

  async function fetchWalletBalance(network, address, alias = '') {
    const config = WALLET_CHAINS[network];
    if (!config) throw new Error('Red no soportada');
    if (!validateWalletAddress(network, address)) throw new Error('Dirección inválida');

    const nativeBalance = await fetchNativeBalance(network, address);
    let price = null;
    let priceSource = 'Sin precio';
    try {
      const quote = await fetchWalletPrice(config.priceSymbol, config.coingeckoId);
      if (quote) {
        price = quote.price;
        priceSource = quote.source;
      }
    } catch (error) {
      console.warn('[Wallet Price]', error);
    }

    const usd = price != null && Number.isFinite(nativeBalance) ? nativeBalance * price : null;
    let tokenResult = { tokens: [], ok: false };
    try {
      tokenResult = await fetchWalletTokens(network, address, config);
    } catch (error) {
      console.warn('[Wallet Tokens]', error);
    }
    const tokens = (() => {
      if (tokenResult.ok) return Array.isArray(tokenResult.tokens) ? tokenResult.tokens : [];
      const previousSnapshot = phase3State.walletSnapshots[`${network}:${address}`];
      const fallback = tokensFromWalletSnapshot(previousSnapshot);
      return fallback.length ? fallback : (Array.isArray(tokenResult.tokens) ? tokenResult.tokens : []);
    })();
    const tokensUsd = tokens.reduce((sum, token) => sum + (Number.isFinite(token.usd) ? token.usd : 0), 0);
    const totalUsd = (Number.isFinite(usd) ? usd : 0) + tokensUsd;
    const tokenChanges = detectWalletBalanceChanges({
      id: `${network}:${address}`,
      network,
      address,
      alias: alias || '',
      symbol: config.nativeSymbol,
      price
    }, nativeBalance, tokens, tokenResult.ok);
    const fetchedAt = Date.now();
    return {
      id: `${network}:${address}`,
      network,
      address,
      alias: alias || '',
      chainName: config.label,
      symbol: config.nativeSymbol,
      nativeBalance,
      price,
      priceSource,
      usd,
      tokens,
      tokensUsd,
      totalUsd: Number.isFinite(totalUsd) && totalUsd > 0 ? totalUsd : usd,
      tokensAvailable: tokenResult.ok,
      tokenChanges,
      explorerUrl: `${config.explorer}${encodeURIComponent(address)}`,
      gmgnUrl: `https://gmgn.ai/${config.gmgn}/address/${encodeURIComponent(address)}`,
      bubblemapsUrl: `https://v2.bubblemaps.io/?chain=${encodeURIComponent(config.bubblemaps)}&address=${encodeURIComponent(address)}`,
      dexscreenerUrl: `https://dexscreener.com/${config.dexscreener}/${encodeURIComponent(address)}`,
      fetchedAt,
      error: null
    };
  }

  async function fetchNativeBalance(network, address) {
    const config = WALLET_CHAINS[network];
    if (!config) throw new Error('Red no soportada');

    if (config.type === 'evm') {
      const result = await rpcRequestWithFallback(config, 'eth_getBalance', [address, 'latest']);
      return formatUnits(result, config.decimals);
    }

    if (config.type === 'btc') {
      const data = await fetchJSON(`${config.rpc}${encodeURIComponent(address)}`, { timeout: 15000, retries: 0 });
      const stats = data && data.chain_stats;
      if (!stats) throw new Error('Mempool no devolvió chain_stats');
      const funded = toFiniteNumber(stats.funded_txo_sum);
      const spent = toFiniteNumber(stats.spent_txo_sum);
      if (funded == null || spent == null) throw new Error('Mempool devolvió saldos inválidos');
      return formatUnits(funded - spent, config.decimals);
    }

    if (config.type === 'solana') {
      const result = await rpcRequestWithFallback(config, 'getBalance', [address]);
      if (!result || result.value == null) throw new Error('Solana RPC sin saldo');
      return formatUnits(result.value, config.decimals);
    }

    if (config.type === 'sui') {
      try {
        const result = await rpcRequestWithFallback(config, 'suix_getBalance', [address]);
        if (!result || result.totalBalance == null) throw new Error('Sui RPC sin saldo');
        return formatUnits(result.totalBalance, config.decimals);
      } catch (error) {
        return fetchSuiGraphQLBalance(address, config.decimals);
      }
    }

    if (config.type === 'xrp') {
      const endpoints = [config.rpc, ...(config.rpcFallbacks || [])];
      let lastError = null;
      for (const endpoint of endpoints) {
        try {
          const data = await fetchJSON(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              method: 'account_info',
              params: [{ account: address, ledger_index: 'validated', strict: true }]
            }),
            timeout: 15000,
            retries: 0
          });
          if (data && data.result && data.result.error) throw new Error(data.result.error_message || data.result.error);
          const balance = data && data.result && data.result.account_data ? data.result.account_data.Balance : null;
          if (balance == null) throw new Error('XRPL no devolvió el saldo de la cuenta');
          return formatUnits(balance, config.decimals);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error('XRPL RPC no disponible');
    }

    throw new Error('Tipo de red no implementado');
  }

  async function rpcRequest(url, method, params) {
    const data = await fetchJSON(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      timeout: 15000,
      retries: 0
    });
    if (data && data.error) throw new Error(data.error.message || 'Error RPC');
    if (!data || data.result == null) throw new Error('RPC sin resultado');
    return data.result;
  }

  async function rpcRequestWithFallback(config, method, params) {
    const endpoints = [config.rpc, ...(config.rpcFallbacks || [])].filter(Boolean);
    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        return await rpcRequest(endpoint, method, params);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('RPC no disponible');
  }

  async function fetchSuiGraphQLBalance(address, decimals) {
    const query = `query { address(address: "${address}") { balance(coinType: "0x2::sui::SUI") { totalBalance } } }`;
    const data = await fetchJSON('https://graphql.mainnet.sui.io/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      timeout: 15000,
      retries: 0
    });
    if (data && Array.isArray(data.errors) && data.errors.length) {
      throw new Error(data.errors[0].message || 'Sui GraphQL error');
    }
    const total = data && data.data && data.data.address && data.data.address.balance
      ? data.data.address.balance.totalBalance
      : null;
    if (total == null) throw new Error('Sui GraphQL no devolvió saldo');
    return formatUnits(total, decimals);
  }

  function formatUnits(raw, decimals) {
    let value;
    if (typeof raw === 'bigint') value = raw;
    else if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) throw new Error('Saldo numérico inválido');
      value = BigInt(Math.trunc(raw));
    } else if (typeof raw === 'string') {
      const text = raw.trim();
      if (!text) throw new Error('Saldo vacío');
      value = text.startsWith('0x') || text.startsWith('0X') ? BigInt(text) : BigInt(text);
    } else {
      throw new Error('Formato de saldo no soportado');
    }

    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const base = 10n ** BigInt(decimals);
    const whole = absolute / base;
    const fraction = absolute % base;
    const fractionText = fraction.toString().padStart(decimals, '0');
    const numeric = Number(`${whole.toString()}.${fractionText}`);
    return negative ? -numeric : numeric;
  }

  async function fetchWalletPrice(symbol, coingeckoId) {
    if (!symbol) return null;
    try {
      const data = await fetchJSON(
        `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(`${symbol}USDT`)}`,
        { timeout: 9000, retries: 0 }
      );
      const price = toFiniteNumber(data && data.price);
      if (price != null && price > 0) return { price, source: `Binance ${symbol}USDT` };
    } catch (error) {
      // Se intenta CoinGecko como respaldo.
    }

    if (coingeckoId) {
      try {
        const data = await fetchPublic(
          `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd`,
          { timeout: 12000 }
        );
        const price = toFiniteNumber(data && data[coingeckoId] && data[coingeckoId].usd);
        if (price != null && price > 0) return { price, source: 'CoinGecko' };
      } catch (error) {
        // Sin precio disponible.
      }
    }
    return null;
  }

  const EVM_STABLECOINS = {
    eth: [
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 }
    ],
    bnb: [
      { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 }
    ],
    base: [
      { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
      { symbol: 'USDT', address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 }
    ],
    arbitrum: [
      { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
      { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
      { symbol: 'USDC.e', address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', decimals: 6 }
    ]
  };

  function sortWalletTokens(tokens) {
    return tokens.slice().sort((a, b) => {
      const usdA = Number.isFinite(a.usd) ? a.usd : -1;
      const usdB = Number.isFinite(b.usd) ? b.usd : -1;
      if (usdB !== usdA) return usdB - usdA;
      return (b.amount || 0) - (a.amount || 0);
    });
  }

  async function fetchJupiterPrices(mints) {
    const unique = [...new Set(mints.filter(Boolean))];
    const result = {};
    for (let index = 0; index < unique.length; index += 50) {
      const chunk = unique.slice(index, index + 50);
      const endpoints = [
        `https://price.jup.ag/v6/price?ids=${chunk.map(encodeURIComponent).join(',')}`,
        `https://api.jup.ag/price/v3?ids=${chunk.map(encodeURIComponent).join(',')}`
      ];
      let found = false;
      for (const endpoint of endpoints) {
        try {
          const data = await fetchPublic(endpoint, { timeout: 10000 });
          const map = data && data.data && typeof data.data === 'object' ? data.data : data;
          if (!map || typeof map !== 'object') continue;
          Object.entries(map).forEach(([mint, value]) => {
            const price = Number(value && (value.price ?? value.usdPrice ?? value.usd));
            if (Number.isFinite(price) && price > 0) {
              result[mint] = {
                price,
                symbol: value.mintSymbol || value.symbol || '',
                name: value.name || '',
                source: 'Jupiter'
              };
              found = true;
            }
          });
          if (found) break;
        } catch (error) {
          // Probar el endpoint alternativo.
        }
      }
    }
    return result;
  }

  async function fetchDexTokenPrice(symbol, chainId) {
    const clean = String(symbol || '').trim();
    if (!clean) return null;
    try {
      const data = await fetchPublic(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(clean)}`,
        { timeout: 9000 }
      );
      const pairs = data && Array.isArray(data.pairs) ? data.pairs : [];
      const matches = pairs
        .filter((pair) => pair && Number(pair.priceUsd) > 0)
        .filter((pair) => !chainId || String(pair.chainId || '').toLowerCase() === String(chainId).toLowerCase())
        .sort((a, b) => (Number(b.liquidity && b.liquidity.usd) || 0) - (Number(a.liquidity && a.liquidity.usd) || 0));
      if (!matches.length) return null;
      return { price: Number(matches[0].priceUsd), source: `DEX ${matches[0].chainId || chainId}` };
    } catch (error) {
      return null;
    }
  }

  async function fetchSolanaWalletTokens(config, address) {
    const programs = [
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
    ];
    const results = await Promise.allSettled(programs.map((programId) => (
      rpcRequestWithFallback(config, 'getTokenAccountsByOwner', [
        address,
        { programId },
        { encoding: 'jsonParsed', commitment: 'confirmed' }
      ])
    )));
    const ok = results.every((result) => (
      result.status === 'fulfilled' && result.value && Array.isArray(result.value.value)
    ));
    if (!ok) return { tokens: [], ok: false };

    const accounts = [];
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value && Array.isArray(result.value.value)) {
        accounts.push(...result.value.value);
      }
    });

    const byMint = new Map();
    accounts.forEach((account) => {
      const info = account && account.account && account.account.data
        && account.account.data.parsed && account.account.data.parsed.info;
      if (!info || !info.mint) return;
      const decimals = Math.max(0, Number(info.tokenAmount && info.tokenAmount.decimals) || 0);
      const uiAmount = Number(info.tokenAmount && info.tokenAmount.uiAmount);
      const rawAmount = Number(info.tokenAmount && info.tokenAmount.amount);
      const amount = Number.isFinite(uiAmount)
        ? uiAmount
        : (Number.isFinite(rawAmount) ? rawAmount / Math.pow(10, decimals) : 0);
      if (!(amount > 0)) return;
      const previous = byMint.get(info.mint) || { mint: info.mint, amount: 0, decimals };
      previous.amount += amount;
      previous.decimals = decimals;
      byMint.set(info.mint, previous);
    });

    const mints = Array.from(byMint.keys());
    const prices = await fetchJupiterPrices(mints);
    const tokens = Array.from(byMint.values()).map((item) => {
      const quote = prices[item.mint] || null;
      const price = quote && Number.isFinite(quote.price) ? quote.price : null;
      const shortMint = `${item.mint.slice(0, 4)}…${item.mint.slice(-4)}`;
      return {
        key: `mint:${item.mint}`,
        kind: 'spl',
        symbol: (quote && quote.symbol) || shortMint,
        name: (quote && quote.name) || 'SPL Token',
        address: item.mint,
        amount: item.amount,
        decimals: item.decimals,
        price,
        source: quote ? quote.source : 'Sin precio',
        usd: price != null ? item.amount * price : null
      };
    });
    return { tokens: sortWalletTokens(tokens), ok: true };
  }

  async function fetchSuiWalletTokens(config, address) {
    let balances = null;
    try {
      balances = await rpcRequestWithFallback(config, 'suix_getAllBalances', [address]);
    } catch (error) {
      return { tokens: [], ok: false };
    }
    if (!Array.isArray(balances)) return { tokens: [], ok: true };
    const nonNative = balances
      .filter((balance) => balance && balance.coinType !== '0x2::sui::SUI' && Number(balance.totalBalance) > 0)
      .sort((a, b) => Number(b.totalBalance) - Number(a.totalBalance))
      .slice(0, 30);
    if (!nonNative.length) return { tokens: [], ok: true };

    const metadataResults = await Promise.allSettled(nonNative.map((balance) => (
      rpcRequestWithFallback(config, 'suix_getCoinMetadata', [balance.coinType])
    )));
    const tokens = (await Promise.all(nonNative.map(async (balance, index) => {
      const metadata = metadataResults[index].status === 'fulfilled' ? metadataResults[index].value : null;
      const decimals = metadata && Number.isFinite(Number(metadata.decimals)) ? Number(metadata.decimals) : 9;
      const amount = Number(balance.totalBalance) / Math.pow(10, decimals);
      if (!(amount > 0)) return null;
      const symbol = (metadata && metadata.symbol) || String(balance.coinType).split('::').pop() || 'SUI';
      const quote = await fetchDexTokenPrice(symbol, 'sui');
      const price = quote ? quote.price : null;
      return {
        key: `coin:${balance.coinType}`,
        kind: 'sui',
        symbol,
        name: (metadata && metadata.name) || symbol,
        address: balance.coinType,
        amount,
        decimals,
        price,
        source: quote ? quote.source : 'Sin precio',
        usd: price != null ? amount * price : null
      };
    }))).filter(Boolean);
    return { tokens: sortWalletTokens(tokens), ok: true };
  }

  async function fetchEvmWalletTokens(config, network, address) {
    const stablecoins = EVM_STABLECOINS[network] || [];
    if (!stablecoins.length) return { tokens: [], ok: true };
    const paddedAddress = address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const results = await Promise.allSettled(stablecoins.map(async (token) => {
      const raw = await rpcRequestWithFallback(config, 'eth_call', [
        { to: token.address, data: `0x70a08231${paddedAddress}` },
        'latest'
      ]);
      const amount = formatUnits(raw, token.decimals);
      if (!(amount > 0)) return null;
      return {
        key: `contract:${token.address.toLowerCase()}`,
        kind: 'evm',
        symbol: token.symbol,
        name: token.symbol,
        address: token.address,
        amount,
        decimals: token.decimals,
        price: 1,
        source: 'Stablecoin',
        usd: amount
      };
    }));
    const ok = results.every((result) => result.status === 'fulfilled');
    const tokens = results
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => result.value);
    return { tokens: sortWalletTokens(tokens), ok };
  }

  async function fetchWalletTokens(network, address, config) {
    if (config.type === 'solana') return fetchSolanaWalletTokens(config, address);
    if (config.type === 'sui') return fetchSuiWalletTokens(config, address);
    if (config.type === 'evm') return fetchEvmWalletTokens(config, network, address);
    return { tokens: [], ok: true };
  }

  function buildWalletTokenMap(tokens) {
    const map = {};
    (Array.isArray(tokens) ? tokens : []).forEach((token) => {
      map[token.key] = {
        amount: token.amount,
        symbol: token.symbol,
        price: token.price == null ? null : token.price
      };
    });
    return map;
  }

  function tokensFromWalletSnapshot(snapshot) {
    if (!snapshot || !snapshot.tokens || typeof snapshot.tokens !== 'object') return [];
    return Object.entries(snapshot.tokens).map(([key, entry]) => {
      const value = typeof entry === 'number' ? { amount: entry } : (entry || {});
      const address = key.replace(/^(mint|coin|contract):/, '');
      return {
        key,
        kind: key.startsWith('mint:') ? 'spl' : key.startsWith('coin:') ? 'sui' : 'evm',
        symbol: value.symbol || address.slice(0, 8),
        name: value.symbol || 'Token',
        address,
        amount: Number(value.amount) || 0,
        decimals: 0,
        price: Number.isFinite(Number(value.price)) ? Number(value.price) : null,
        source: 'Snapshot local',
        usd: Number.isFinite(Number(value.price)) ? (Number(value.amount) || 0) * Number(value.price) : null
      };
    }).filter((token) => token.amount > 0);
  }

  function detectWalletBalanceChanges(wallet, nativeBalance, tokens, tokensOk) {
    const previous = phase3State.walletSnapshots[wallet.id] || null;
    const previousTokensComplete = Boolean(previous && previous.tokensComplete !== false);
    const currentTokenMap = buildWalletTokenMap(tokens);
    const tokenChanges = {};
    const changes = [];
    const nativePrice = Number.isFinite(wallet.price) ? wallet.price : null;

    if (previous) {
      const previousNative = Number(previous.native);
      if (Number.isFinite(previousNative) && Number.isFinite(nativeBalance)) {
        const nativeDelta = nativeBalance - previousNative;
        if (Math.abs(nativeDelta) > 1e-9) {
          tokenChanges.native = nativeDelta;
          changes.push({
            asset: wallet.symbol || 'NATIVE',
            tokenKey: 'native',
            delta: nativeDelta,
            previous: previousNative,
            current: nativeBalance,
            usdDelta: nativePrice != null ? nativeDelta * nativePrice : null
          });
        }
      }

      if (tokensOk && previousTokensComplete) {
        const previousTokens = previous.tokens && typeof previous.tokens === 'object' ? previous.tokens : {};
        const keys = new Set([...Object.keys(previousTokens), ...Object.keys(currentTokenMap)]);
        keys.forEach((key) => {
          const previousEntry = previousTokens[key];
          const previousAmount = Number(typeof previousEntry === 'number' ? previousEntry : (previousEntry && previousEntry.amount) || 0);
          const currentEntry = currentTokenMap[key] || null;
          const currentAmount = Number(currentEntry ? currentEntry.amount : 0);
          const delta = currentAmount - previousAmount;
          if (!Number.isFinite(delta) || Math.abs(delta) <= 1e-9) return;
          const metadata = currentEntry || (typeof previousEntry === 'object' ? previousEntry : null) || {};
          const price = Number(metadata.price);
          tokenChanges[key] = delta;
          changes.push({
            asset: metadata.symbol || key,
            tokenKey: key,
            delta,
            previous: previousAmount,
            current: currentAmount,
            usdDelta: Number.isFinite(price) ? delta * price : null
          });
        });
      }
    }

    const nextTokensComplete = tokensOk ? true : Boolean(previous && previous.tokensComplete !== false);
    phase3State.walletSnapshots[wallet.id] = {
      native: nativeBalance,
      tokens: tokensOk ? currentTokenMap : (previous && previous.tokens) || {},
      tokensComplete: nextTokensComplete,
      at: Date.now()
    };
    saveJSON(STORAGE_KEYS.walletTokenSnapshots, phase3State.walletSnapshots);

    if (changes.length) {
      const enriched = changes.map((change) => ({
        ...change,
        id: `whale-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        walletId: wallet.id,
        walletAlias: wallet.alias || 'Wallet',
        walletAddress: wallet.address,
        network: wallet.network,
        at: Date.now()
      }));
      phase3State.whaleAlerts = [...enriched, ...phase3State.whaleAlerts].slice(0, 50);
      saveJSON(STORAGE_KEYS.walletWhaleAlerts, phase3State.whaleAlerts);
      enriched.slice(0, 3).forEach(showWhaleAlertToast);
      renderWhaleAlerts();
    }
    return tokenChanges;
  }

  function formatWalletTokenAmount(amount) {
    const value = toFiniteNumber(amount);
    if (value == null) return '—';
    const digits = Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 1 ? 4 : 8;
    return formatNumber(value, digits);
  }

  function renderWalletTokenPortfolio(wallet) {
    const body = byId('wallet-token-body');
    if (!body) return;
    const tokens = Array.isArray(wallet.tokens) ? wallet.tokens : [];
    const tokensUsd = tokens.reduce((sum, token) => sum + (Number.isFinite(token.usd) ? token.usd : 0), 0);
    const tokenChanges = wallet.tokenChanges && typeof wallet.tokenChanges === 'object' ? wallet.tokenChanges : {};

    setText('wallet-token-summary', tokens.length
      ? `${tokens.length} token${tokens.length === 1 ? '' : 's'} internos · ${formatUsd(tokensUsd)} en tokens`
      : 'Sin tokens internos con saldo');
    setText('wallet-token-count', `${tokens.length} token${tokens.length === 1 ? '' : 's'}`);
    setText('wallet-token-usd', formatUsd(tokensUsd));
    setText('wallet-token-status', wallet.tokensAvailable === false
      ? 'No se pudieron leer los tokens internos en esta consulta. Se conserva la última instantánea para evitar falsos positivos.'
      : 'La lectura compara cada saldo con la instantánea local y dispara 🚨 Whale Alert cuando detecta un cambio.');

    if (!tokens.length) {
      body.innerHTML = '<tr class="placeholder-row"><td colspan="5"><div class="table-empty compact"><span class="empty-icon"><i data-lucide="coins"></i></span><div><strong>Sin tokens internos</strong><span>La wallet no tiene tokens compatibles con saldo o la red solo expone el saldo nativo.</span></div></div></td></tr>';
      refreshIcons();
      return;
    }

    body.innerHTML = tokens.map((token) => {
      const delta = Number(tokenChanges[token.key] || 0);
      const changeClass = delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral';
      const changeLabel = Math.abs(delta) > 1e-9
        ? `${delta > 0 ? '+' : ''}${formatWalletTokenAmount(delta)}`
        : '—';
      const priceLabel = Number.isFinite(token.price) ? formatPrice(token.price) : '—';
      const usdLabel = Number.isFinite(token.usd) ? formatUsd(token.usd) : '—';
      return `<tr>
        <td>
          <div class="wallet-token-symbol">
            <strong>${escapeHtml(token.symbol || 'TOKEN')}</strong>
            <span title="${escapeHtml(token.address || '')}">${escapeHtml(shortAddress(token.address || ''))}</span>
          </div>
        </td>
        <td>${escapeHtml(formatWalletTokenAmount(token.amount))}</td>
        <td>${escapeHtml(priceLabel)}</td>
        <td>${escapeHtml(usdLabel)}</td>
        <td><span class="wallet-token-change ${changeClass}">${escapeHtml(changeLabel)}</span></td>
      </tr>`;
    }).join('');
    refreshIcons();
  }

  function showWhaleAlertToast(change) {
    let container = byId('whale-alert-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'whale-alert-toast-container';
      document.body.appendChild(container);
    }
    const isIn = Number(change.delta) > 0;
    const item = document.createElement('div');
    item.className = `whale-alert-toast${isIn ? '' : ' is-out'}`;
    const direction = isIn ? 'recibió' : 'envió';
    const usd = Number.isFinite(change.usdDelta) ? ` · ${formatUsd(Math.abs(change.usdDelta))}` : '';
    item.innerHTML = `
      <strong>🚨 Whale Alert · ${escapeHtml(change.walletAlias || 'Wallet')}</strong>
      <span>${escapeHtml(direction)} ${escapeHtml(formatWalletTokenAmount(Math.abs(change.delta)))} ${escapeHtml(change.asset || 'tokens')}${escapeHtml(usd)}</span>
      <span>${escapeHtml(shortAddress(change.walletAddress || ''))} · ${escapeHtml(new Date(change.at || Date.now()).toLocaleTimeString('es-ES'))}</span>
    `;
    container.appendChild(item);
    window.setTimeout(() => item.remove(), 12000);
  }

  function renderWhaleAlerts() {
    const feed = byId('whale-alert-feed');
    const summary = byId('whale-alert-summary');
    if (!feed) return;
    const alerts = Array.isArray(phase3State.whaleAlerts) ? phase3State.whaleAlerts : [];
    if (summary) {
      summary.textContent = alerts.length
        ? `${alerts.length} cambio${alerts.length === 1 ? '' : 's'} detectado${alerts.length === 1 ? '' : 's'} · últimas ${Math.min(alerts.length, 50)} lecturas.`
        : 'Sin cambios de saldo detectados todavía.';
    }
    if (!alerts.length) {
      feed.innerHTML = '<div class="whale-alert-empty"><span class="empty-icon"><i data-lucide="waves"></i></span><div><strong>Radar de ballenas en espera</strong><span>Cuando un token interno cambie de saldo, aparecerá aquí con su delta y la hora exacta.</span></div></div>';
      refreshIcons();
      return;
    }
    feed.innerHTML = alerts.map((alertItem) => {
      const isIn = Number(alertItem.delta) > 0;
      const usd = Number.isFinite(alertItem.usdDelta) ? ` · ${formatUsd(Math.abs(alertItem.usdDelta))}` : '';
      return `<div class="whale-alert-item ${isIn ? 'is-in' : 'is-out'}">
        <span class="whale-alert-icon">${isIn ? '🟢' : '🔴'}</span>
        <div class="whale-alert-copy">
          <strong>${escapeHtml(alertItem.walletAlias || 'Wallet')} · ${escapeHtml(alertItem.asset || 'TOKEN')}</strong>
          <span>${isIn ? 'Entrada' : 'Salida'} de ${escapeHtml(formatWalletTokenAmount(Math.abs(alertItem.delta)))} ${escapeHtml(alertItem.asset || '')}${escapeHtml(usd)} · saldo ${escapeHtml(formatWalletTokenAmount(alertItem.current))}</span>
        </div>
        <span class="whale-alert-time">${escapeHtml(new Date(alertItem.at || Date.now()).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }))}</span>
      </div>`;
    }).join('');
    refreshIcons();
  }

  function clearWhaleAlerts() {
    if (!phase3State.whaleAlerts.length) {
      showToast('No hay alertas de ballenas para limpiar.', 'info');
      return;
    }
    phase3State.whaleAlerts = [];
    saveJSON(STORAGE_KEYS.walletWhaleAlerts, phase3State.whaleAlerts);
    renderWhaleAlerts();
    showToast('Historial de Whale Alerts limpiado.', 'success');
  }

  function renderWalletResult(wallet) {
    const empty = byId('wallet-result-empty');
    const content = byId('wallet-result-content');
    if (empty) empty.hidden = true;
    if (content) content.hidden = false;

    const config = WALLET_CHAINS[wallet.network] || {};
    setText('wallet-result-alias', wallet.alias || 'Wallet consultada');
    setText('wallet-result-network', config.nativeSymbol || wallet.symbol || '—');
    setText('wallet-result-native', formatTokenAmount(wallet.nativeBalance, wallet.network));
    setText('wallet-result-symbol', wallet.symbol || config.nativeSymbol || '—');
    setText('wallet-result-usd', wallet.usd == null ? '— USD' : `${formatUsd(wallet.usd)} USD`);
    setText('wallet-result-price', formatPrice(wallet.price));
    setText('wallet-result-source', wallet.priceSource || 'Sin precio');
    setText('wallet-result-chain-name', wallet.chainName || config.label || '—');
    setText('wallet-result-time', wallet.fetchedAt ? new Date(wallet.fetchedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' }) : '—');

    const address = byId('wallet-result-address');
    if (address) {
      address.textContent = shortAddress(wallet.address);
      address.title = `Copiar ${wallet.address}`;
    }
    const icon = byId('wallet-result-icon');
    if (icon) {
      icon.innerHTML = '<i data-lucide="wallet-minimal"></i>';
    }
    const status = byId('wallet-result-status');
    if (status) {
      status.className = wallet.error ? 'is-error' : '';
      status.innerHTML = `<span class="live-dot"></span> ${wallet.error ? 'Error de consulta' : wallet.price == null ? 'Saldo leído · precio no disponible' : 'Consulta correcta'}`;
    }
    renderWalletTokenPortfolio(wallet);
    refreshIcons();
    document.dispatchEvent(new CustomEvent('crypto:intel:wallet-updated', {
      detail: { wallet }
    }));
  }

  function updateWalletAuditLinks(wallet) {
    const config = WALLET_CHAINS[wallet.network] || {};
    const explorer = byId('wallet-explorer-link');
    const dexscreener = byId('wallet-dexscreener-link');
    const gmgn = byId('wallet-gmgn-link');
    const gmgnMain = byId('gmgn-main-link');
    const bubbleFrame = byId('wallet-bubblemaps-iframe');
    const bubbleEmpty = byId('wallet-bubblemaps-empty');
    const bubbleToolbarLink = $('#wallet-bubblemaps-card .iframe-toolbar a');
    const forensicLinks = $$('#wallet-bubblemaps-card .forensic-links a');

    if (explorer) explorer.href = wallet.explorerUrl || '#';
    if (dexscreener) dexscreener.href = wallet.dexscreenerUrl || 'https://dexscreener.com/';
    if (gmgn) gmgn.href = wallet.gmgnUrl || 'https://gmgn.ai/';
    if (gmgnMain) {
      gmgnMain.href = wallet.gmgnUrl || 'https://gmgn.ai/';
      gmgnMain.innerHTML = `<i data-lucide="arrow-up-right"></i> Abrir GMGN · ${escapeHtml(config.label || wallet.chainName || '')}`;
    }
    if (bubbleFrame) {
      bubbleFrame.src = wallet.bubblemapsUrl || 'https://v2.bubblemaps.io/';
      bubbleFrame.hidden = false;
    }
    if (bubbleEmpty) bubbleEmpty.hidden = true;
    if (bubbleToolbarLink) bubbleToolbarLink.href = wallet.bubblemapsUrl || 'https://v2.bubblemaps.io/';
    if (forensicLinks[0]) forensicLinks[0].href = wallet.gmgnUrl || 'https://gmgn.ai/';
    if (forensicLinks[1]) forensicLinks[1].href = wallet.dexscreenerUrl || 'https://dexscreener.com/';
    refreshIcons();
  }

  function saveCurrentWallet() {
    const wallet = phase3State.currentWallet;
    if (!wallet) {
      showToast('Primero consulta una wallet para poder guardarla.', 'warning');
      return;
    }
    const aliasInput = byId('wallet-alias');
    if (aliasInput && aliasInput.value.trim()) wallet.alias = aliasInput.value.trim();
    phase3State.lastWalletsRefresh = Date.now();
    const existing = phase3State.wallets.find((item) => (
      item.network === wallet.network && String(item.address).toLowerCase() === String(wallet.address).toLowerCase()
    ));
    if (existing) {
      Object.assign(existing, wallet, { id: existing.id, alias: wallet.alias || existing.alias });
      saveJSON(STORAGE_KEYS.wallets, phase3State.wallets);
      renderWatchedWallets();
      showToast('Wallet actualizada en la lista de seguimiento.', 'success');
      return;
    }

    phase3State.wallets.push({
      ...wallet,
      id: wallet.id || `${wallet.network}:${wallet.address}`,
      alias: wallet.alias || '',
      savedAt: Date.now()
    });
    saveJSON(STORAGE_KEYS.wallets, phase3State.wallets);
    renderWatchedWallets();
    showToast('Wallet añadida a vigiladas y guardada en localStorage.', 'success');
  }

  function renderWatchedWallets() {
    const body = byId('watched-wallets-body');
    const summary = byId('watched-wallets-summary');
    const count = byId('wallets-count');
    const totalElement = byId('wallets-total-usd');
    const lastRefresh = byId('wallets-last-refresh');
    if (!body) return;

    const wallets = Array.isArray(phase3State.wallets) ? phase3State.wallets : [];
    const latestFetch = wallets.reduce((latest, wallet) => {
      const fetchedAt = toFiniteNumber(wallet.fetchedAt);
      return fetchedAt != null && fetchedAt > latest ? fetchedAt : latest;
    }, 0);
    const lastTimestamp = phase3State.lastWalletsRefresh || latestFetch || null;
    if (!wallets.length) {
      body.innerHTML = `<tr class="placeholder-row"><td colspan="6"><div class="table-empty"><span class="empty-icon"><i data-lucide="wallet-cards"></i></span><div><strong>Sin wallets vigiladas</strong><span>Rastrea una dirección y guárdala para seguirla en cada visita.</span></div></div></td></tr>`;
      if (summary) summary.textContent = 'Aún no has guardado ninguna wallet.';
      if (count) count.textContent = '0';
      if (totalElement) totalElement.textContent = '$0.00';
      if (lastRefresh) lastRefresh.textContent = lastTimestamp ? `Última sincronización: ${formatWalletTime(lastTimestamp)}` : 'Sin sincronizar';
      refreshIcons();
      dispatchWalletsUpdated();
      return;
    }

    const totalUsd = wallets.reduce((sum, wallet) => {
      if (wallet.error) return sum;
      const value = Number.isFinite(wallet.totalUsd) ? wallet.totalUsd : wallet.usd;
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    body.innerHTML = wallets.map((wallet) => {
      const config = WALLET_CHAINS[wallet.network] || {};
      const balance = wallet.error ? 'Error' : formatTokenAmount(wallet.nativeBalance, wallet.network);
      const totalValue = Number.isFinite(wallet.totalUsd) ? wallet.totalUsd : wallet.usd;
      const usd = wallet.error ? '—' : formatUsd(totalValue);
      const tokenCount = Array.isArray(wallet.tokens) ? wallet.tokens.length : 0;
      const valueTitle = wallet.error
        ? escapeHtml(wallet.error)
        : `Nativo ${formatUsd(wallet.usd)} · Tokens ${formatUsd(wallet.tokensUsd)} · ${tokenCount} token(s)`;
      return `<tr data-wallet-id="${escapeHtml(wallet.id)}">
        <td>
          <div class="wallet-row-name"><div><strong>${escapeHtml(wallet.alias || 'Wallet')}</strong><small>${escapeHtml(config.label || wallet.chainName || '')}</small></div></div>
        </td>
        <td><span class="wallet-chain-badge" title="${escapeHtml(config.label || '')}">${escapeHtml(config.nativeSymbol || wallet.symbol || '—')}</span></td>
        <td><button class="address-copy" type="button" data-wallet-action="load" title="Cargar en el formulario">${escapeHtml(shortAddress(wallet.address))}</button></td>
        <td><span class="wallet-row-balance" title="${wallet.error ? escapeHtml(wallet.error) : 'Saldo nativo'}">${escapeHtml(balance)} ${escapeHtml(wallet.symbol || config.nativeSymbol || '')}</span></td>
        <td><span class="wallet-row-usd" title="${valueTitle}">${escapeHtml(usd)}</span>${tokenCount ? `<small class="futures-subvalue">${tokenCount} token(s)</small>` : ''}</td>
        <td>
          <div class="wallet-row-actions">
            <button class="icon-button small" type="button" data-wallet-action="refresh" aria-label="Actualizar wallet" title="Actualizar wallet"><i data-lucide="refresh-ccw"></i></button>
            <a class="icon-button small" href="${escapeHtml(wallet.explorerUrl || '#')}" target="_blank" rel="noopener noreferrer" aria-label="Explorador" title="Explorador"><i data-lucide="external-link"></i></a>
            <a class="icon-button small gmgn" href="${escapeHtml(wallet.gmgnUrl || 'https://gmgn.ai/')}" target="_blank" rel="noopener noreferrer" aria-label="GMGN" title="GMGN"><i data-lucide="radar"></i></a>
            <a class="icon-button small" href="${escapeHtml(wallet.bubblemapsUrl || 'https://v2.bubblemaps.io/')}" target="_blank" rel="noopener noreferrer" aria-label="Bubblemaps" title="Bubblemaps"><i data-lucide="network"></i></a>
            <a class="icon-button small" href="${escapeHtml(wallet.dexscreenerUrl || 'https://dexscreener.com/')}" target="_blank" rel="noopener noreferrer" aria-label="DEX Screener" title="DEX Screener"><i data-lucide="scan-search"></i></a>
            <button class="icon-button small danger" type="button" data-wallet-action="delete" aria-label="Eliminar wallet" title="Eliminar wallet"><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      </tr>`;
    }).join('');

    if (summary) summary.textContent = `${wallets.length} wallet${wallets.length === 1 ? '' : 's'} en seguimiento · ${formatUsd(totalUsd)} USD estimados.`;
    if (count) count.textContent = String(wallets.length);
    if (totalElement) totalElement.textContent = formatUsd(totalUsd);
    if (lastRefresh) lastRefresh.textContent = lastTimestamp ? `Última sincronización: ${formatWalletTime(lastTimestamp)}` : 'Sin sincronizar';
    refreshIcons();
    dispatchWalletsUpdated();
  }

  function dispatchWalletsUpdated() {
    document.dispatchEvent(new CustomEvent('crypto:intel:wallets-updated', {
      detail: { wallets: phase3State.wallets.slice() }
    }));
  }

  async function refreshWallet(wallet, action) {
    if (!wallet) return;
    const original = action ? action.innerHTML : '';
    if (action) {
      action.disabled = true;
      action.innerHTML = '<i data-lucide="loader-circle"></i>';
      refreshIcons();
    }
    try {
      const fresh = await fetchWalletBalance(wallet.network, wallet.address, wallet.alias);
      Object.assign(wallet, fresh, { id: wallet.id, alias: wallet.alias || fresh.alias });
      saveJSON(STORAGE_KEYS.wallets, phase3State.wallets);
      phase3State.lastWalletsRefresh = Date.now();
      renderWatchedWallets();
      showToast('Wallet actualizada.', 'success');
    } catch (error) {
      wallet.error = error.message || 'RPC no disponible';
      saveJSON(STORAGE_KEYS.wallets, phase3State.wallets);
      renderWatchedWallets();
      showToast(`No se pudo actualizar la wallet: ${wallet.error}`, 'error');
    } finally {
      if (action) {
        action.disabled = false;
        action.innerHTML = original;
        refreshIcons();
      }
    }
  }

  async function refreshAllWallets() {
    if (!phase3State.wallets.length) {
      showToast('No hay wallets vigiladas para actualizar.', 'warning');
      return;
    }
    const button = byId('wallet-refresh');
    const original = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i data-lucide="loader-circle"></i> Sincronizando';
      refreshIcons();
    }

    const results = await Promise.allSettled(phase3State.wallets.map((wallet) => (
      fetchWalletBalance(wallet.network, wallet.address, wallet.alias)
    )));

    results.forEach((result, index) => {
      const wallet = phase3State.wallets[index];
      if (!wallet) return;
      if (result.status === 'fulfilled') {
        Object.assign(wallet, result.value, { id: wallet.id, alias: wallet.alias || result.value.alias });
      } else {
        wallet.error = result.reason && result.reason.message ? result.reason.message : 'RPC no disponible';
      }
    });

    phase3State.lastWalletsRefresh = Date.now();
    saveJSON(STORAGE_KEYS.wallets, phase3State.wallets);
    renderWatchedWallets();
    if (button) {
      button.disabled = false;
      button.innerHTML = original;
      refreshIcons();
    }
    const failed = results.filter((result) => result.status === 'rejected').length;
    showToast(
      failed
        ? `${phase3State.wallets.length - failed} wallets actualizadas; ${failed} con error de RPC.`
        : 'Wallets vigiladas sincronizadas.',
      failed ? 'warning' : 'success'
    );
  }

  function deleteWallet(id) {
    const before = phase3State.wallets.length;
    phase3State.wallets = phase3State.wallets.filter((wallet) => wallet.id !== id);
    if (phase3State.wallets.length === before) return;
    if (phase3State.currentWallet && phase3State.currentWallet.id === id) phase3State.currentWallet = null;
    if (phase3State.walletSnapshots[id]) {
      delete phase3State.walletSnapshots[id];
      saveJSON(STORAGE_KEYS.walletTokenSnapshots, phase3State.walletSnapshots);
    }
    if (!phase3State.wallets.length) phase3State.lastWalletsRefresh = null;
    saveJSON(STORAGE_KEYS.wallets, phase3State.wallets);
    renderWatchedWallets();
    renderWhaleAlerts();
    showToast('Wallet eliminada de la lista de seguimiento.', 'success');
  }

  function clearWallets() {
    if (!phase3State.wallets.length) {
      showToast('No hay wallets vigiladas para limpiar.', 'info');
      return;
    }
    if (!window.confirm('¿Eliminar todas las wallets vigiladas de este navegador?')) return;
    phase3State.wallets = [];
    phase3State.currentWallet = null;
    phase3State.lastWalletsRefresh = null;
    phase3State.walletSnapshots = {};
    saveJSON(STORAGE_KEYS.wallets, phase3State.wallets);
    saveJSON(STORAGE_KEYS.walletTokenSnapshots, phase3State.walletSnapshots);
    renderWatchedWallets();
    renderWhaleAlerts();
    showToast('Lista de wallets vigiladas vaciada.', 'success');
  }

  function loadWalletIntoForm(wallet) {
    const network = byId('wallet-network');
    const address = byId('wallet-address');
    const alias = byId('wallet-alias');
    if (network) network.value = wallet.network;
    if (address) address.value = wallet.address;
    if (alias) alias.value = wallet.alias || '';
    updateWalletPlaceholder();
    const form = byId('wallet-form');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    handleWalletSubmit();
  }

  function formatTokenAmount(value, network) {
    const number = toFiniteNumber(value);
    if (number == null) return '—';
    const digits = network === 'btc' ? 8 : network === 'xrp' ? 2 : 6;
    return formatNumber(number, digits);
  }

  function formatUsd(value) {
    const number = toFiniteNumber(value);
    if (number == null) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(number);
  }

  function shortAddress(address) {
    const value = String(address == null ? '' : address);
    if (value.length <= 14) return value;
    return `${value.slice(0, 6)}…${value.slice(-6)}`;
  }

  function formatWalletTime(timestamp) {
    const value = toFiniteNumber(timestamp);
    if (value == null) return '—';
    return new Date(value).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  }


  /* ============================================================
     FASE 4 - PARTE 3
     Panel 05: Airdrops DefiLlama + Gestor Anti-Sybil
     Panel 04: Directorio maestro de 26 fuentes primarias
     Orquestador global, auto-refresh y cierre de la aplicacion.
     ============================================================ */

  const AIRDROP_PROTOCOLS_URL = 'https://api.llama.fi/protocols';
  const AIRDROP_MIN_TVL = 1000000;
  const AUTO_REFRESH_MS = 60000;
  const FARM_STATUS_OPTIONS = [
    { value: 'potential', label: 'Potencial' },
    { value: 'confirmed', label: 'Confirmado / Puntos' },
    { value: 'testnet', label: 'Testnet' },
    { value: 'snapshot', label: 'Snapshot Tomado' },
    { value: 'claimable', label: 'Reclamable' }
  ];
  const FARM_STATUS_MAP = FARM_STATUS_OPTIONS.reduce((map, item) => {
    map[item.value] = item.label;
    return map;
  }, {});
  const ACTIVE_FARM_STATUSES = new Set(['potential', 'confirmed', 'testnet']);
  const SOURCE_CATEGORY_LABELS = {
    macro: 'Macro & FED',
    onchain: 'On-chain & Ciclo',
    futures: 'Futuros & Sentimiento',
    fundamentals: 'Fundamentales & DeFi',
    dex_airdrops: 'DEX & Airdrops'
  };
  const SOURCE_CATEGORY_ICONS = {
    macro: 'landmark',
    onchain: 'network',
    futures: 'chart-candlestick',
    fundamentals: 'bar-chart-3',
    dex_airdrops: 'sparkles'
  };
  const SOURCE_ACCESS_LABELS = {
    auto: '🟢 Automáticas',
    apikey: '🔑 API Key Gratis',
    login: '🌐 Login Web',
    iframe: '🖼️ Iframe'
  };
  const SOURCE_PROVIDER_LABELS = {
    fred: 'FRED St. Louis',
    dune: 'Dune Analytics',
    coinalyze: 'Coinalyze',
    livecoinwatch: 'LiveCoinWatch',
    coinmarketcap: 'CoinMarketCap',
    cryptorank: 'CryptoRank',
    coingecko: 'CoinGecko',
    glassnode: 'Glassnode Studio',
    cryptoquant: 'CryptoQuant',
    chainexposed: 'ChainExposed',
    tokenterminal: 'Token Terminal',
    artemis: 'Artemis',
    fundingview: 'FundingView',
    dropstab: 'DropsTab',
    gmgn: 'GMGN.ai',
    coinglass: 'Coinglass Pro'
  };

  const phase4State = {
    airdropInitialized: false,
    sourcesInitialized: false,
    globalControlsInitialized: false,
    appInitialized: false,
    protocols: [],
    protocolChain: 'all',
    protocolSort: 'tvl-desc',
    protocolQuery: '',
    protocolUpdatedAt: null,
    protocolLoading: false,
    farms: (() => {
      const stored = loadJSON(STORAGE_KEYS.airdropFarmingTasks, []);
      return Array.isArray(stored) ? stored : [];
    })(),
    farmSequence: 0,
    sourcesCategory: 'all',
    sourcesAccess: 'all',
    sourcesQuery: '',
    sourceContext: {
      mode: 'token',
      symbol: state.selectedSymbol || 'BTC',
      name: state.selectedSymbol || 'BTC',
      address: '',
      chain: '',
      slug: ''
    },
    autoRefreshTimer: null,
    isRefreshingAll: false,
    externalBridgeInitialized: false,
    externalBridgeTimer: null,
    tampermonkeyListenerInitialized: false,
    externalSyncSummary: {
      found: false,
      synced: 0,
      updated: 0,
      skipped: 0,
      invalid: 0,
      error: null,
      lastUpdatedAt: null
    },
    lastExternalRaw: null
  };

  /* ------------------------------------------------------------
     Panel 05 - Cazador de airdrops y gestor anti-Sybil
     ------------------------------------------------------------ */

  function parseAirdropRoiNumber(value) {
    const text = String(value == null ? '' : value).trim().replace(/\s/g, '');
    if (!text) return null;
    let normalized = text;
    if (text.includes(',') && text.includes('.')) {
      normalized = text.replace(/,/g, '');
    } else if (text.includes(',')) {
      const parts = text.split(',');
      normalized = parts.length === 2 && parts[1].length !== 3
        ? text.replace(',', '.')
        : text.replace(/,/g, '');
    }
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function updateAirdropRoiGas() {
    const gas = phase4State.farms.reduce((sum, task) => sum + (toFiniteNumber(task.gasUsd) || 0), 0);
    setText('airdrop-roi-gas', formatUsd(gas));
    calculateAirdropRoi(true);
  }

  function calculateAirdropRoi(silent = false) {
    const fdvInput = byId('airdrop-roi-fdv');
    const supplyInput = byId('airdrop-roi-supply');
    const usersInput = byId('airdrop-roi-users');
    if (!fdvInput || !supplyInput || !usersInput) return;

    const fdv = parseAirdropRoiNumber(fdvInput.value);
    const supplyPct = parseAirdropRoiNumber(supplyInput.value);
    const users = parseAirdropRoiNumber(usersInput.value);
    const gas = phase4State.farms.reduce((sum, task) => sum + (toFiniteNumber(task.gasUsd) || 0), 0);
    setText('airdrop-roi-gas', formatUsd(gas));

    const output = byId('airdrop-roi-percent');
    const outputBox = output ? output.closest('.airdrop-roi-output') : null;
    const verdict = byId('airdrop-roi-verdict');
    const setVerdict = (label, className) => {
      if (!verdict) return;
      verdict.className = `badge ${className}`;
      verdict.textContent = label;
    };

    if (!fdv || fdv <= 0 || supplyPct == null || supplyPct <= 0 || !users || users <= 0) {
      if (!silent) {
        setText('airdrop-roi-pool', '—');
        setText('airdrop-roi-per-user', '—');
        setText('airdrop-roi-percent', '—');
        setText('airdrop-roi-multiple', '—');
        setText('airdrop-roi-cost-user', '—');
        setText('airdrop-roi-note', 'Completa FDV, % de supply y usuarios elegibles con valores mayores que cero.');
        setVerdict('Sin calcular', 'badge-neutral');
        if (outputBox) outputBox.classList.remove('is-positive', 'is-negative');
      }
      return;
    }

    const pool = fdv * (supplyPct / 100);
    const perUser = pool / users;
    const costPerUser = users > 0 ? gas / users : null;
    const roi = gas > 0 ? ((perUser - gas) / gas) * 100 : null;
    const multiple = gas > 0 ? perUser / gas : null;

    setText('airdrop-roi-pool', formatCompactUSD(pool));
    setText('airdrop-roi-per-user', formatUsd(perUser));
    setText('airdrop-roi-cost-user', costPerUser == null ? '—' : formatUsd(costPerUser));
    if (roi == null || multiple == null) {
      setText('airdrop-roi-percent', '—');
      setText('airdrop-roi-multiple', '—');
      setText('airdrop-roi-note', 'No hay gas registrado en la tabla Anti-Sybil. Añade el gas de tus campañas para calcular el ROI real.');
      setVerdict('Sin gas registrado', 'badge-neutral');
      if (outputBox) outputBox.classList.remove('is-positive', 'is-negative');
      return;
    }

    setText('airdrop-roi-percent', `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`);
    setText('airdrop-roi-multiple', `${multiple.toFixed(2)}x`);
    const positive = roi >= 0;
    if (outputBox) {
      outputBox.classList.toggle('is-positive', positive);
      outputBox.classList.toggle('is-negative', !positive);
    }
    if (roi >= 100) setVerdict('🟢 Muy rentable', 'badge-green');
    else if (roi >= 0) setVerdict('🟢 Rentable', 'badge-green');
    else if (roi >= -50) setVerdict('🟡 Marginal', 'badge-amber');
    else setVerdict('🔴 No rentable', 'badge-bear');
    setText('airdrop-roi-note', `Pool estimado: FDV × ${supplyPct}% = ${formatCompactUSD(pool)}. Valor medio por usuario elegible: ${formatUsd(perUser)}. Gas total Anti-Sybil: ${formatUsd(gas)}. ROI bruto = (valor por usuario - gas total) / gas total. No incluye vesting, impuestos, comisiones futuras ni precio real de venta.`);
  }

  function initAirdropPanel() {
    if (phase4State.airdropInitialized) return;
    phase4State.airdropInitialized = true;

    const roiFdv = byId('airdrop-roi-fdv');
    const roiSupply = byId('airdrop-roi-supply');
    const roiUsers = byId('airdrop-roi-users');
    if (roiFdv && !roiFdv.value) roiFdv.value = '1000000000';
    if (roiSupply && !roiSupply.value) roiSupply.value = '5';
    if (roiUsers && !roiUsers.value) roiUsers.value = '100000';
    [roiFdv, roiSupply, roiUsers].forEach((input) => {
      if (input) input.addEventListener('input', () => calculateAirdropRoi(false));
    });
    byId('airdrop-roi-calc')?.addEventListener('click', () => calculateAirdropRoi(false));
    updateAirdropRoiGas();

    const refresh = byId('tokenless-refresh');
    if (refresh) refresh.addEventListener('click', () => loadTokenlessProtocols({ silent: false }));

    $$('#tokenless-chain-filters [data-tokenless-chain]').forEach((button) => {
      button.addEventListener('click', () => {
        phase4State.protocolChain = button.dataset.tokenlessChain || 'all';
        $$('#tokenless-chain-filters [data-tokenless-chain]').forEach((item) => {
          item.classList.toggle('is-active', item === button);
        });
        renderTokenlessProtocols();
      });
    });

    const sort = byId('tokenless-sort');
    if (sort) {
      sort.addEventListener('change', () => {
        phase4State.protocolSort = sort.value || 'tvl-desc';
        renderTokenlessProtocols();
      });
    }

    const search = byId('tokenless-search');
    if (search) {
      search.addEventListener('input', () => {
        phase4State.protocolQuery = search.value.trim().toLowerCase();
        renderTokenlessProtocols();
      });
    }

    const tokenlessBody = byId('tokenless-body');
    if (tokenlessBody) tokenlessBody.addEventListener('click', handleTokenlessTableClick);

    const farmForm = byId('farm-form');
    if (farmForm) farmForm.addEventListener('submit', handleFarmSubmit);

    const farmToggle = byId('farm-form-toggle');
    if (farmToggle) farmToggle.addEventListener('click', openFarmEditor);

    const farmCancel = byId('farm-cancel');
    if (farmCancel) farmCancel.addEventListener('click', () => {
      resetFarmForm();
      const editor = byId('farm-editor');
      if (editor) editor.open = false;
    });

    const farmsSearch = byId('farms-search');
    if (farmsSearch) farmsSearch.addEventListener('input', renderFarms);

    const farmsFilter = byId('farms-status-filter');
    if (farmsFilter) farmsFilter.addEventListener('change', renderFarms);

    const farmsBody = byId('farms-body');
    if (farmsBody) farmsBody.addEventListener('click', handleFarmTableClick);

    document.addEventListener('crypto:intel:wallets-updated', () => {
      populateFarmWalletOptions();
      renderFarms();
    });

    populateFarmWalletOptions();
    resetFarmForm();
    renderFarms();
    loadTokenlessProtocols({ silent: true });
  }

  async function loadTokenlessProtocols({ silent = false } = {}) {
    if (phase4State.protocolLoading) return;
    phase4State.protocolLoading = true;
    const button = byId('tokenless-refresh');
    const original = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i data-lucide="loader-circle"></i> Consultando DefiLlama';
      refreshIcons();
    }

    try {
      const data = await fetchPublic(AIRDROP_PROTOCOLS_URL, { timeout: 22000, retries: 0 });
      if (!Array.isArray(data)) throw new Error('DefiLlama no devolvio un arreglo de protocolos');

      const protocols = data
        .filter(isTokenlessAirdropCandidate)
        .map(normalizeAirdropProtocol)
        .filter((protocol) => protocol.tvl != null && protocol.tvl > AIRDROP_MIN_TVL);

      phase4State.protocols = protocols;
      phase4State.protocolUpdatedAt = Date.now();
      renderTokenlessProtocols();
      setText('tokenless-updated', `Actualizado ${formatShortDate(phase4State.protocolUpdatedAt)}`);
      setText('tokenless-count', formatNumber(protocols.length));
      const totalTvl = protocols.reduce((sum, protocol) => sum + protocol.tvl, 0);
      setText('tokenless-tvl-total', formatCompactUSD(totalTvl));

      if (!silent) {
        showToast(`DefiLlama: ${protocols.length} protocolos sin token con TVL > $1M.`, 'success');
      }
    } catch (error) {
      console.warn('[DefiLlama Airdrops]', error);
      setText('tokenless-updated', 'Error de sincronizacion');
      if (!phase4State.protocols.length) {
        const body = byId('tokenless-body');
        if (body) {
          body.innerHTML = `<tr class="placeholder-row"><td colspan="9"><div class="table-empty"><span class="empty-icon"><i data-lucide="triangle-alert"></i></span><div><strong>DefiLlama no respondio</strong><span>${escapeHtml(error.message || 'Error de red')}. Usa el boton Actualizar DefiLlama para reintentar.</span></div></div></td></tr>`;
          refreshIcons();
        }
      }
      if (!silent) {
        showToast('No se pudo consultar DefiLlama. Se conserva el ultimo resultado valido.', 'warning');
      }
    } finally {
      phase4State.protocolLoading = false;
      if (button) {
        button.disabled = false;
        button.innerHTML = original;
        refreshIcons();
      }
    }
  }

  function isTokenlessAirdropCandidate(protocol) {
    if (!protocol) return false;
    const symbol = protocol.symbol;
    const tokenless = symbol == null || String(symbol).trim() === '' || String(symbol).trim() === '-';
    const tvl = toFiniteNumber(protocol.tvl);
    if (!tokenless || tvl == null || tvl <= AIRDROP_MIN_TVL) return false;

    const category = String(protocol.category || '').toLowerCase();
    const name = String(protocol.name || '').toLowerCase();
    if (category.includes('cex') || category.includes('centralized exchange')) return false;
    if (category.includes('bridge') || category.includes('canonical bridge')) return false;
    if (name.includes('wrapped') || name.includes('bridge')) return false;
    return true;
  }

  function normalizeAirdropProtocol(protocol) {
    const name = String(protocol.name || 'Protocolo sin nombre').trim();
    const slug = String(protocol.slug || '').trim() || sourceSlug({ name, symbol: '' });
    const chains = Array.isArray(protocol.chains)
      ? protocol.chains.map((chain) => String(chain || '').trim()).filter(Boolean)
      : [];
    const tvl = toFiniteNumber(protocol.tvl);
    const change7d = toFiniteNumber(protocol.change_7d);
    const change1m = toFiniteNumber(protocol.change_1m);
    return {
      id: slug || name,
      name,
      slug,
      symbol: protocol.symbol || '—',
      category: protocol.category || 'DeFi',
      chains,
      tvl,
      change7d,
      change1m,
      description: String(protocol.description || '').trim(),
      logo: protocol.logo || '',
      url: protocol.url || `https://defillama.com/protocol/${encodeURIComponent(slug)}`,
      listedAt: protocol.listedAt || null
    };
  }

  function renderTokenlessProtocols() {
    const body = byId('tokenless-body');
    if (!body) return;
    const protocols = getFilteredAirdropProtocols();
    if (!protocols.length) {
      body.innerHTML = `<tr class="placeholder-row"><td colspan="9"><div class="table-empty"><span class="empty-icon"><i data-lucide="search-x"></i></span><div><strong>Sin protocolos para este filtro</strong><span>Prueba otra cadena, limpia la busqueda o actualiza DefiLlama.</span></div></div></td></tr>`;
      refreshIcons();
      return;
    }

    body.innerHTML = protocols.map((protocol, index) => renderTokenlessRow(protocol, index)).join('');
    refreshIcons();
  }

  function getFilteredAirdropProtocols() {
    const query = phase4State.protocolQuery;
    return phase4State.protocols
      .filter((protocol) => protocolMatchesChain(protocol, phase4State.protocolChain))
      .filter((protocol) => {
        if (!query) return true;
        const haystack = [
          protocol.name,
          protocol.symbol,
          protocol.category,
          protocol.chains.join(' '),
          protocol.description
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => compareAirdropProtocols(a, b, phase4State.protocolSort));
  }

  function protocolMatchesChain(protocol, chain) {
    if (!chain || chain === 'all') return true;
    const target = String(chain).toLowerCase();
    return protocol.chains.some((item) => {
      const normalized = String(item).toLowerCase();
      if (target === 'bsc') return normalized === 'bsc' || normalized === 'binance' || normalized === 'bnb';
      if (target === 'arbitrum') return normalized === 'arbitrum' || normalized === 'arb';
      return normalized === target;
    });
  }

  function compareAirdropProtocols(a, b, sort) {
    if (sort === 'name-asc') return a.name.localeCompare(b.name);
    if (sort === 'change7d-desc' || sort === 'change-desc') {
      return compareNullableDesc(a.change7d, b.change7d) || compareNullableDesc(a.tvl, b.tvl);
    }
    if (sort === 'change7d-asc' || sort === 'change-asc') {
      return compareNullableAsc(a.change7d, b.change7d) || compareNullableDesc(a.tvl, b.tvl);
    }
    return compareNullableDesc(a.tvl, b.tvl) || a.name.localeCompare(b.name);
  }

  function compareNullableDesc(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return b - a;
  }

  function compareNullableAsc(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a - b;
  }

  function renderTokenlessRow(protocol, index) {
    const fit = getAirdropFit(protocol);
    const chains = protocol.chains.slice(0, 3).map((chain) => (
      `<span class="chain-tag">${escapeHtml(formatAirdropChain(chain))}</span>`
    )).join('');
    const moreChains = protocol.chains.length > 3
      ? `<span class="chain-tag">+${protocol.chains.length - 3}</span>`
      : '';
    const change7dClass = protocol.change7d == null
      ? 'text-muted'
      : protocol.change7d > 0 ? 'positive' : protocol.change7d < 0 ? 'negative' : 'text-muted';
    const change1mClass = protocol.change1m == null
      ? 'text-muted'
      : protocol.change1m > 0 ? 'positive' : protocol.change1m < 0 ? 'negative' : 'text-muted';
    return `<tr data-airdrop-id="${escapeHtml(protocol.id)}">
      <td class="muted-cell">${index + 1}</td>
      <td>
        <div class="protocol-cell">
          <span class="protocol-logo">${escapeHtml(initialsFromName(protocol.name))}</span>
          <div class="protocol-copy">
            <strong>${escapeHtml(protocol.name)}</strong>
            <span>${escapeHtml(protocol.category)}</span>
          </div>
        </div>
      </td>
      <td><div class="chain-list">${chains}${moreChains || '<span class="text-muted">—</span>'}</div></td>
      <td><span class="category-tag">${escapeHtml(protocol.category)}</span></td>
      <td class="tvl-cell">${formatCompactUSD(protocol.tvl)}</td>
      <td class="${change1mClass}">${formatSignedPct(protocol.change1m)}</td>
      <td class="${change7dClass}">${formatSignedPct(protocol.change7d)}</td>
      <td><span class="airdrop-fit ${fit.class}">${escapeHtml(fit.label)}</span></td>
      <td>
        <div class="tokenless-actions">
          <button class="table-action-link tokenless-add tokenless-add-label" type="button" data-airdrop-add="${escapeHtml(protocol.id)}" title="➕ Enviar a mi Tracker" aria-label="➕ Enviar a mi Tracker"><span>➕ Enviar a mi Tracker</span></button>
          <a class="table-action-link" href="https://cryptorank.io/drophunting" target="_blank" rel="noopener noreferrer" title="CryptoRank Drop Hunting · 🔑 API Key Gratis + 🌐 Login Web" aria-label="CryptoRank Drop Hunting · 🔑 API Key Gratis + 🌐 Login Web"><i data-lucide="trophy"></i></a>
          <a class="table-action-link" href="https://cryptorank.io/es" target="_blank" rel="noopener noreferrer" title="Buscar en CryptoRank · 🔑 API Key Gratis + 🌐 Login Web" aria-label="Buscar en CryptoRank · 🔑 API Key Gratis + 🌐 Login Web"><i data-lucide="search"></i></a>
          <a class="table-action-link" href="https://dropstab.com/" target="_blank" rel="noopener noreferrer" title="DropsTab Activities · 🌐 Login Web para ActiveScore y Tareas" aria-label="DropsTab Activities · 🌐 Login Web para ActiveScore y Tareas"><i data-lucide="sparkles"></i></a>
          <a class="table-action-link" href="https://defillama.com/airdrops" target="_blank" rel="noopener noreferrer" title="DefiLlama Airdrops Oficial" aria-label="DefiLlama Airdrops Oficial"><i data-lucide="layers-3"></i></a>
        </div>
      </td>
    </tr>`;
  }

  function getAirdropFit(protocol) {
    const tvl = toFiniteNumber(protocol.tvl) || 0;
    const change = toFiniteNumber(protocol.change7d);
    if (tvl >= 100000000 && (change == null || change >= 0)) return { label: 'Alta', class: 'high' };
    if (tvl >= 10000000 || (change != null && change >= 10)) return { label: 'Media', class: 'medium' };
    return { label: 'Vigilar', class: 'low' };
  }

  function formatAirdropChain(chain) {
    const value = String(chain || '').trim();
    const aliases = {
      ethereum: 'Ethereum',
      eth: 'Ethereum',
      bsc: 'BSC',
      binance: 'BSC',
      bnb: 'BSC',
      solana: 'Solana',
      sol: 'Solana',
      arbitrum: 'Arbitrum',
      arb: 'Arbitrum',
      base: 'Base',
      sui: 'Sui',
      polygon: 'Polygon',
      avalanche: 'Avalanche',
      avax: 'Avalanche'
    };
    return aliases[value.toLowerCase()] || value;
  }

  function initialsFromName(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  function handleTokenlessTableClick(event) {
    const addButton = event.target.closest('[data-airdrop-add]');
    if (!addButton) return;
    const protocol = phase4State.protocols.find((item) => item.id === addButton.dataset.airdropAdd);
    if (protocol) sendProtocolToTracker(protocol);
  }

  function sendProtocolToTracker(protocol) {
    if (!protocol) return;
    resetFarmForm();
    const editor = byId('farm-editor');
    if (editor) editor.open = true;
    const project = byId('farm-project');
    const chain = byId('farm-chain');
    const guide = byId('farm-guide');
    const notes = byId('farm-notes');
    const status = byId('farm-status');
    const lastInteraction = byId('farm-last-interaction');
    if (project) project.value = protocol.name;
    if (chain) chain.value = mapProtocolChainToFarmChain(protocol.chains);
    if (guide) guide.value = protocol.url || '';
    if (notes) notes.value = `Candidato DefiLlama · TVL ${formatCompactUSD(protocol.tvl)} · 7D ${formatSignedPct(protocol.change7d)}`;
    if (status) status.value = 'potential';
    if (lastInteraction) lastInteraction.value = new Date().toISOString().slice(0, 10);
    const submit = byId('farm-submit');
    if (submit) submit.innerHTML = '<i data-lucide="save"></i> Guardar campaña';
    refreshIcons();
    const form = byId('farm-form');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast(`${protocol.name} enviado al gestor de farming. Completa wallet y capital.`, 'success');
  }

  function mapProtocolChainToFarmChain(chains) {
    const list = Array.isArray(chains) ? chains.map((chain) => String(chain).toLowerCase()) : [];
    if (list.includes('ethereum') || list.includes('eth')) return 'Ethereum';
    if (list.includes('solana') || list.includes('sol')) return 'Solana';
    if (list.includes('sui')) return 'Sui';
    if (list.includes('base')) return 'Base';
    if (list.includes('arbitrum') || list.includes('arb')) return 'Arbitrum';
    if (list.includes('bsc') || list.includes('binance') || list.includes('bnb')) return 'BNB';
    return 'Otra';
  }

  function populateFarmWalletOptions() {
    const select = byId('farm-wallet');
    if (!select) return;
    const current = select.value;
    const wallets = Array.isArray(phase3State.wallets) ? phase3State.wallets : [];
    select.innerHTML = '<option value="">Sin wallet asignada</option>' + wallets.map((wallet) => {
      const config = WALLET_CHAINS[wallet.network] || {};
      const alias = wallet.alias || 'Wallet';
      return `<option value="${escapeHtml(wallet.id)}">${escapeHtml(alias)} · ${escapeHtml(config.label || wallet.network || 'Red')} · ${escapeHtml(shortAddress(wallet.address))}</option>`;
    }).join('');
    if (wallets.some((wallet) => wallet.id === current)) select.value = current;
  }

  function handleFarmSubmit(event) {
    event.preventDefault();
    const projectInput = byId('farm-project');
    const chainInput = byId('farm-chain');
    const walletInput = byId('farm-wallet');
    const statusInput = byId('farm-status');
    const capitalInput = byId('farm-capital');
    const gasInput = byId('farm-gas');
    const txInput = byId('farm-tx-count');
    const dateInput = byId('farm-last-interaction');
    const guideInput = byId('farm-guide');
    const notesInput = byId('farm-notes');
    const frequencyInput = byId('farm-frequency');
    const idInput = byId('farm-id');

    const project = projectInput ? projectInput.value.trim() : '';
    const chain = chainInput ? chainInput.value : '';
    const walletId = walletInput ? walletInput.value : '';
    const status = statusInput ? statusInput.value : 'potential';
    const capitalUsd = parseFarmNumber(capitalInput ? capitalInput.value : '');
    const gasUsd = parseFarmNumber(gasInput ? gasInput.value : '');
    const txCount = parseFarmNumber(txInput ? txInput.value : '');
    const lastInteractionDate = dateInput ? dateInput.value : '';
    const guide = guideInput ? guideInput.value.trim() : '';
    const notes = notesInput ? notesInput.value.trim() : '';
    const frequency = Math.max(1, Math.min(7, Math.round(parseFarmNumber(frequencyInput ? frequencyInput.value : '1') || 1)));

    if (!project) {
      showToast('El nombre del proyecto es obligatorio.', 'warning');
      if (projectInput) projectInput.focus();
      return;
    }
    if (!chain) {
      showToast('Selecciona la red de la campana.', 'warning');
      if (chainInput) chainInput.focus();
      return;
    }
    if (!FARM_STATUS_MAP[status]) {
      showToast('Selecciona un estado valido para la campana.', 'warning');
      return;
    }
    if (capitalUsd == null || capitalUsd < 0 || gasUsd == null || gasUsd < 0 || txCount == null || txCount < 0) {
      showToast('Capital, gas y transacciones deben ser numeros mayores o iguales a cero.', 'warning');
      return;
    }

    const wallet = phase3State.wallets.find((item) => item.id === walletId) || null;
    const id = idInput && idInput.value ? idInput.value : `farm-${Date.now()}-${phase4State.farmSequence++}`;
    const existing = phase4State.farms.find((item) => item.id === id) || null;
    const now = new Date().toISOString();
    const task = {
      id,
      project,
      chain,
      walletId: wallet ? wallet.id : '',
      walletAddress: wallet ? wallet.address : '',
      walletAlias: wallet ? (wallet.alias || '') : '',
      status,
      capitalUsd,
      gasUsd,
      txCount: Math.floor(txCount),
      lastInteractionDate: normalizeInteractionDate(lastInteractionDate),
      guide,
      notes,
      frequency,
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedAt: now
    };

    if (existing) {
      phase4State.farms = phase4State.farms.map((item) => item.id === id ? task : item);
      showToast('Campana actualizada en localStorage.', 'success');
    } else {
      phase4State.farms.unshift(task);
      showToast('Campana guardada en localStorage.', 'success');
    }
    saveJSON(STORAGE_KEYS.airdropFarmingTasks, phase4State.farms);
    renderFarms();
    resetFarmForm();
  }

  function parseFarmNumber(value) {
    if (value == null || String(value).trim() === '') return 0;
    const normalized = String(value).replace(/\s/g, '').replace(',', '.');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeInteractionDate(value) {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      const date = new Date(`${value}T12:00:00`);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function getFarmTaskById(id) {
    return phase4State.farms.find((item) => item.id === id) || null;
  }

  function renderFarms() {
    const body = byId('farms-body');
    if (!body) return;
    const search = byId('farms-search');
    const statusFilter = byId('farms-status-filter');
    const query = search ? search.value.trim().toLowerCase() : '';
    const filter = statusFilter ? statusFilter.value : 'all';

    const farms = phase4State.farms.filter((task) => {
      if (filter !== 'all' && task.status !== filter) return false;
      if (!query) return true;
      const haystack = [task.project, task.chain, task.walletAlias, task.walletAddress, task.notes, task.status]
        .join(' ').toLowerCase();
      return haystack.includes(query);
    });

    if (!farms.length) {
      body.innerHTML = `<tr class="placeholder-row"><td colspan="11"><div class="table-empty"><span class="empty-icon"><i data-lucide="sprout"></i></span><div><strong>Sin campanas para este filtro</strong><span>Crea una campana o cambia el estado de busqueda.</span></div></div></td></tr>`;
      updateFarmMetrics();
      refreshIcons();
      return;
    }

    body.innerHTML = farms.map(renderFarmRow).join('');
    updateFarmMetrics();
    refreshIcons();
  }

  function renderFarmRow(task) {
    const health = getSybilHealth(task);
    const statusLabel = FARM_STATUS_MAP[task.status] || task.status;
    const walletLabel = task.walletAlias
      ? `${task.walletAlias} · ${shortAddress(task.walletAddress)}`
      : task.walletAddress ? shortAddress(task.walletAddress) : 'Sin wallet';
    const lastDate = task.lastInteractionDate ? formatFarmDate(task.lastInteractionDate) : 'Sin fecha';
    const guide = String(task.guide || '').trim();
    return `<tr data-farm-id="${escapeHtml(task.id)}">
      <td>
        <div class="farm-project-cell">
          <span class="farm-project-icon">${escapeHtml(initialsFromName(task.project))}</span>
          <div class="farm-project-copy">
            <strong>${escapeHtml(task.project)}</strong>
            <span>${escapeHtml(task.notes || 'Sin notas')}</span>
          </div>
        </div>
      </td>
      <td><span class="chain-tag">${escapeHtml(task.chain)}</span></td>
      <td><span class="farm-wallet-cell"><i data-lucide="wallet-minimal"></i><span>${escapeHtml(walletLabel)}</span></span></td>
      <td><span class="farm-status ${escapeHtml(task.status)}">${escapeHtml(statusLabel)}</span></td>
      <td class="tvl-cell">${formatUsd(task.capitalUsd)}</td>
      <td class="tvl-cell">${formatUsd(task.gasUsd)}</td>
      <td class="tvl-cell">${formatNumber(task.txCount)}</td>
      <td><span class="farm-last-interaction ${health.days > 7 ? 'is-due' : ''}">${escapeHtml(lastDate)}</span></td>
      <td><span class="farm-sybil ${health.class}">${escapeHtml(health.label)}</span></td>
      <td>${guide ? `<a class="farm-guide-link" href="${escapeHtml(guide)}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i>Guia</a>` : '<span class="text-muted">—</span>'}</td>
      <td>
        <div class="farm-row-actions">
          <button class="farm-interact-button" type="button" data-farm-action="interact" title="⚡ Registrar Interacción Hoy" aria-label="⚡ Registrar Interacción Hoy"><i data-lucide="zap"></i><span>⚡ Registrar Interacción Hoy</span></button>
          <button class="icon-button small" type="button" data-farm-action="edit" title="Editar campana" aria-label="Editar campana"><i data-lucide="pencil"></i></button>
          <button class="icon-button small danger" type="button" data-farm-action="delete" title="Eliminar campana" aria-label="Eliminar campana"><i data-lucide="trash-2"></i></button>
        </div>
      </td>
    </tr>`;
  }

  function getSybilHealth(task) {
    const last = task && task.lastInteractionDate ? new Date(task.lastInteractionDate) : null;
    const valid = last && !Number.isNaN(last.getTime());
    const days = valid ? Math.floor((Date.now() - last.getTime()) / 86400000) : Infinity;
    const txCount = Math.max(0, Math.floor(toFiniteNumber(task && task.txCount) || 0));
    if (days > 7) {
      return {
        label: '🔴 Riesgo Sybil / Inactivo (>7 días sin TX)',
        class: 'danger',
        days,
        txCount
      };
    }
    if (days >= 4) {
      return {
        label: '🟡 Toca Interactuar Pronto',
        class: 'warning',
        days,
        txCount
      };
    }
    return {
      label: '🟢 Wallet Saludable / Activa',
      class: 'healthy',
      days,
      txCount
    };
  }

  function formatFarmDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sin fecha';
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function updateFarmMetrics() {
    const farms = phase4State.farms;
    const active = farms.filter((task) => ACTIVE_FARM_STATUSES.has(task.status)).length;
    const gas = farms.reduce((sum, task) => sum + (toFiniteNumber(task.gasUsd) || 0), 0);
    const tx = farms.reduce((sum, task) => sum + (toFiniteNumber(task.txCount) || 0), 0);
    setText('farms-total', formatNumber(farms.length));
    setText('farms-active-label', `${active} activos`);
    setText('farms-gas', formatUsd(gas));
    setText('farms-summary-total', formatNumber(farms.length));
    setText('farms-summary-active', formatNumber(active));
    setText('farms-summary-gas', formatUsd(gas));
    setText('farms-summary-weekly', formatNumber(tx));
    setText('farms-last-updated', `Datos locales · ${formatShortDate(Date.now())}`);
    updateAirdropRoiGas();
  }

  function handleFarmTableClick(event) {
    const action = event.target.closest('[data-farm-action]');
    if (!action) return;
    const row = action.closest('[data-farm-id]');
    const task = row ? getFarmTaskById(row.dataset.farmId) : null;
    if (!task) return;
    const command = action.dataset.farmAction;
    if (command === 'edit') loadFarmIntoForm(task);
    else if (command === 'delete') deleteFarmTask(task.id);
    else if (command === 'interact') registerFarmInteraction(task.id);
  }

  function loadFarmIntoForm(task) {
    if (!task) return;
    const editor = byId('farm-editor');
    if (editor) editor.open = true;
    const values = {
      'farm-id': task.id,
      'farm-project': task.project,
      'farm-chain': task.chain,
      'farm-status': task.status,
      'farm-capital': task.capitalUsd,
      'farm-gas': task.gasUsd,
      'farm-tx-count': task.txCount,
      'farm-last-interaction': task.lastInteractionDate ? String(task.lastInteractionDate).slice(0, 10) : '',
      'farm-guide': task.guide || '',
      'farm-notes': task.notes || '',
      'farm-frequency': task.frequency || 1
    };
    Object.entries(values).forEach(([id, value]) => {
      const input = byId(id);
      if (input) input.value = value == null ? '' : String(value);
    });
    const walletSelect = byId('farm-wallet');
    if (walletSelect) {
      if (task.walletId && !Array.from(walletSelect.options).some((option) => option.value === task.walletId)) {
        const option = document.createElement('option');
        option.value = task.walletId;
        option.textContent = `${task.walletAlias || 'Wallet'} · ${shortAddress(task.walletAddress)}`;
        walletSelect.appendChild(option);
      }
      walletSelect.value = task.walletId || '';
    }
    const submit = byId('farm-submit');
    if (submit) submit.innerHTML = '<i data-lucide="save"></i> Actualizar campana';
    refreshIcons();
    const form = byId('farm-form');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function deleteFarmTask(id) {
    const task = getFarmTaskById(id);
    if (!task) return;
    if (!window.confirm(`¿Eliminar la campana "${task.project}"?`)) return;
    phase4State.farms = phase4State.farms.filter((item) => item.id !== id);
    saveJSON(STORAGE_KEYS.airdropFarmingTasks, phase4State.farms);
    renderFarms();
    showToast('Campana eliminada de localStorage.', 'success');
  }

  function registerFarmInteraction(id) {
    const task = getFarmTaskById(id);
    if (!task) return;
    const gasRaw = window.prompt('Gas gastado hoy en USD (deja 0 si no aplica):', '0');
    if (gasRaw == null) return;
    const gas = parseFarmNumber(gasRaw);
    if (gas == null || gas < 0) {
      showToast('Gas invalido. Introduce un numero mayor o igual a cero.', 'warning');
      return;
    }
    task.txCount = Math.max(0, Math.floor(toFiniteNumber(task.txCount) || 0)) + 1;
    task.gasUsd = (toFiniteNumber(task.gasUsd) || 0) + gas;
    task.lastInteractionDate = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    saveJSON(STORAGE_KEYS.airdropFarmingTasks, phase4State.farms);
    renderFarms();
    showToast(`Interaccion registrada en ${task.project}: +1 TX y ${formatUsd(gas)} de gas.`, 'success');
  }

  function resetFarmForm() {
    const form = byId('farm-form');
    if (form) form.reset();
    const defaults = {
      'farm-id': '',
      'farm-status': 'potential',
      'farm-capital': '',
      'farm-gas': '',
      'farm-tx-count': '0',
      'farm-last-interaction': new Date().toISOString().slice(0, 10),
      'farm-frequency': '1'
    };
    Object.entries(defaults).forEach(([id, value]) => {
      const input = byId(id);
      if (input) input.value = value;
    });
    const submit = byId('farm-submit');
    if (submit) submit.innerHTML = '<i data-lucide="save"></i> Guardar campaña';
    refreshIcons();
  }

  function openFarmEditor() {
    resetFarmForm();
    const editor = byId('farm-editor');
    if (editor) editor.open = true;
    const project = byId('farm-project');
    if (project) {
      project.focus();
      project.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /* ------------------------------------------------------------
     Panel 04 - Directorio maestro de 26 fuentes primarias
     ------------------------------------------------------------ */

  const PRIMARY_SOURCES_DIRECTORY = [
    {
      id: 'fred-st-louis',
      name: 'FRED St. Louis Fed',
      category: 'macro',
      access: ['apikey'],
      description: 'Tipos de interes, inflacion, M2 y liquidez de EE. UU. con API Key gratuita.',
      domain: 'fred.stlouisfed.org',
      icon: 'landmark',
      provider: 'fred',
      providerType: 'key',
      buildUrl: () => 'https://fred.stlouisfed.org/'
    },
    {
      id: 'federal-reserve',
      name: 'Federal Reserve Oficial',
      category: 'macro',
      access: ['auto'],
      description: 'Comunicados, actas y tono oficial de la Reserva Federal para validar el regimen macro.',
      domain: 'federalreserve.gov',
      icon: 'landmark',
      buildUrl: () => 'https://www.federalreserve.gov/'
    },
    {
      id: 'bitbo-fed-balance',
      name: 'BitBo Fed Balance Sheet',
      category: 'macro',
      access: ['auto'],
      description: 'Expansion y contraccion del balance de la FED como proxy de liquidez global.',
      domain: 'charts.bitbo.io',
      icon: 'chart-no-axes-combined',
      buildUrl: () => 'https://charts.bitbo.io/fed-balance-sheet/'
    },
    {
      id: 'glassnode',
      name: 'Glassnode Studio',
      category: 'onchain',
      access: ['login'],
      description: 'Oferta, demanda, holders y comportamiento on-chain de largo plazo.',
      domain: 'studio.glassnode.com',
      icon: 'network',
      provider: 'glassnode',
      providerType: 'session',
      buildUrl: () => 'https://studio.glassnode.com/'
    },
    {
      id: 'cryptoquant-exchange-reserve',
      name: 'CryptoQuant Exchange Reserve',
      category: 'onchain',
      access: ['login'],
      description: 'Reservas de BTC en exchanges y presion de oferta con lectura web sincronizada.',
      domain: 'cryptoquant.com',
      icon: 'arrow-left-right',
      provider: 'cryptoquant',
      providerType: 'session',
      buildUrl: (context) => {
        const asset = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'].includes(context.symbol)
          ? context.symbol.toLowerCase()
          : 'btc';
        return `https://cryptoquant.com/asset/${asset}/chart/exchange-flows/exchange-reserve?exchange=all_exchange&window=DAY&sma=0&ema=0_100&priceScale=log&metricScale=log&chartStyle=line`;
      }
    },
    {
      id: 'chainexposed-supply-profit',
      name: 'ChainExposed Supply in Profit',
      category: 'onchain',
      access: ['login'],
      description: 'Porcentaje de suministro en ganancia. Mas de 95% alerta; menos de 50% zona de compra.',
      domain: 'chainexposed.com',
      icon: 'pie-chart',
      provider: 'chainexposed',
      providerType: 'session',
      buildUrl: () => 'https://chainexposed.com/SupplyInProfit.html'
    },
    {
      id: 'bitbo-realized-price',
      name: 'BitBo Realized Price',
      category: 'onchain',
      access: ['auto'],
      description: 'Precio realizado de BTC como referencia de coste on-chain del mercado.',
      domain: 'charts.bitbo.io',
      icon: 'line-chart',
      buildUrl: () => 'https://charts.bitbo.io/realized-price/'
    },
    {
      id: 'cbbi-index',
      name: 'CBBI Index',
      category: 'onchain',
      access: ['auto'],
      description: 'Indice compuesto de valoracion de ciclo para Bitcoin mediante JSON publico.',
      domain: 'colintalkscrypto.com',
      icon: 'gauge',
      buildUrl: () => 'https://colintalkscrypto.com/cbbi/'
    },
    {
      id: 'dune-crypto-buy-signal',
      name: 'Dune Crypto Buy Signal',
      category: 'onchain',
      access: ['apikey'],
      description: 'Modelo publico de compra basado en metricas de ciclo y datos on-chain.',
      domain: 'dune.com',
      icon: 'database',
      provider: 'dune',
      providerType: 'key',
      buildUrl: () => 'https://dune.com/cryptokoryo/crypto-buy-signal'
    },
    {
      id: 'tradingview-btc-seasonals',
      name: 'TradingView BTC Seasonals',
      category: 'onchain',
      access: ['iframe'],
      description: 'Patrones historicos mensuales de BTC como contexto estacional adicional.',
      domain: 'tradingview.com',
      icon: 'calendar-range',
      buildUrl: (context) => context.symbol
        ? `https://es.tradingview.com/symbols/${encodeURIComponent(context.symbol)}USD/seasonals/`
        : 'https://es.tradingview.com/symbols/BTCUSD/seasonals/'
    },
    {
      id: 'coingecko-btc-treasuries',
      name: 'CoinGecko BTC Treasuries',
      category: 'macro',
      access: ['auto'],
      description: 'Tesorias corporativas de BTC y demanda institucional agregada.',
      domain: 'coingecko.com',
      icon: 'building-2',
      buildUrl: () => 'https://www.coingecko.com/en/treasuries/bitcoin'
    },
    {
      id: 'coinalyze-global-futures',
      name: 'Coinalyze Global Futures',
      category: 'futures',
      access: ['apikey'],
      description: 'Open Interest, funding y liquidaciones agregadas con API Key gratuita.',
      domain: 'coinalyze.net',
      icon: 'chart-candlestick',
      provider: 'coinalyze',
      providerType: 'key',
      buildUrl: () => 'https://coinalyze.net/futures-data/global-charts/'
    },
    {
      id: 'fundingview-dashboard',
      name: 'FundingView Arbitrage Dashboard',
      category: 'futures',
      access: ['login'],
      description: 'Arbitraje de funding rates entre exchanges y extremos de posicionamiento.',
      domain: 'fundingview.app',
      icon: 'arrow-down-up',
      provider: 'fundingview',
      providerType: 'session',
      buildUrl: () => 'https://fundingview.app/dashboard'
    },
    {
      id: 'coinglass-fear-greed',
      name: 'Coinglass Fear & Greed Index',
      category: 'futures',
      access: ['auto', 'login'],
      description: 'Termometro del sentimiento con datos de derivados y spot.',
      domain: 'coinglass.com',
      icon: 'gauge-circle',
      provider: 'coinglass',
      providerType: 'session',
      buildUrl: () => 'https://www.coinglass.com/pro/i/FearGreedIndex'
    },
    {
      id: 'toomanycooks',
      name: 'TooManyCooks Sentiment',
      category: 'futures',
      access: ['auto'],
      description: 'Consenso de senales y lectura agregada de indicadores de sentimiento.',
      domain: 'toomanycooks.app',
      icon: 'users',
      buildUrl: () => 'https://toomanycooks.app/'
    },
    {
      id: 'coinmarketcap',
      name: 'CoinMarketCap',
      category: 'fundamentals',
      access: ['auto', 'apikey'],
      description: 'Ranking, market cap, FDV, suministro circulante y volumen 24h de todos los activos. API Key gratuita para cotizaciones.',
      domain: 'coinmarketcap.com',
      icon: 'coins',
      provider: 'coinmarketcap',
      providerType: 'key',
      buildUrl: (context) => context.slug
        ? `https://coinmarketcap.com/currencies/${encodeURIComponent(context.slug)}/`
        : 'https://coinmarketcap.com/',
      links: [
        { label: 'Ranking completo', buildUrl: () => 'https://coinmarketcap.com/all/views/all/', note: 'Market cap en vivo' },
        { label: 'API gratuita', buildUrl: () => 'https://coinmarketcap.com/api/', note: '🔑 API Key Gratis', provider: 'coinmarketcap' }
      ]
    },
    {
      id: 'defillama',
      name: 'DefiLlama',
      category: 'fundamentals',
      access: ['auto'],
      description: 'TVL, yields, cadenas y protocolos sin token para detectar airdrops.',
      domain: 'defillama.com',
      icon: 'layers-3',
      buildUrl: (context) => context.symbol
        ? `https://defillama.com/token/${encodeURIComponent(context.symbol)}`
        : 'https://defillama.com/',
      links: [
        { label: 'Airdrops oficial', buildUrl: () => 'https://defillama.com/airdrops', note: 'Directorio oficial' }
      ]
    },
    {
      id: 'token-terminal',
      name: 'Token Terminal Explorer',
      category: 'fundamentals',
      access: ['login'],
      description: 'Ingresos, fees, valoracion y uso real de protocolos y activos.',
      domain: 'tokenterminal.com',
      icon: 'bar-chart-3',
      provider: 'tokenterminal',
      providerType: 'session',
      buildUrl: (context) => context.slug
        ? `https://tokenterminal.com/explorer/projects/${encodeURIComponent(context.slug)}`
        : 'https://tokenterminal.com/explorer'
    },
    {
      id: 'artemis-sector-flows',
      name: 'Artemis Sector Flows',
      category: 'fundamentals',
      access: ['login'],
      description: 'Rotacion de capital y flujos netos entre sectores cripto.',
      domain: 'artemis.ai',
      icon: 'waves',
      provider: 'artemis',
      providerType: 'session',
      buildUrl: (context) => context.slug
        ? `https://classic.artemis.ai/project/${encodeURIComponent(context.slug)}`
        : 'https://www.artemis.ai/sectors/flows'
    },
    {
      id: 'l2beat',
      name: 'L2BEAT',
      category: 'fundamentals',
      access: ['auto'],
      description: 'TVL, riesgos y etapa de descentralizacion de redes Layer 2 antes de farmear.',
      domain: 'l2beat.com',
      icon: 'shield-check',
      buildUrl: (context) => {
        const chain = String(context.chain || context.walletChain || '').toLowerCase();
        if (chain === 'base') return 'https://l2beat.com/scaling/projects/base';
        if (chain === 'arbitrum' || chain === 'arb') return 'https://l2beat.com/scaling/projects/arbitrum';
        return 'https://l2beat.com/';
      }
    },
    {
      id: 'orwee',
      name: 'Orwee.io Liquidity Pools',
      category: 'fundamentals',
      access: ['auto'],
      description: 'Pools de liquidez y rendimiento real para capital farmeado mientras se acumulan puntos.',
      domain: 'orwee.io',
      icon: 'sprout',
      buildUrl: () => 'https://orwee.io/'
    },
    {
      id: 'thecoinperspective',
      name: 'TheCoinPerspective',
      category: 'fundamentals',
      access: ['auto'],
      description: 'Escenarios de market cap y FDV frente a otras criptomonedas.',
      domain: 'thecoinperspective.com',
      icon: 'flask-conical',
      buildUrl: (context) => context.slug
        ? `https://thecoinperspective.com/?p=${encodeURIComponent(context.slug)}`
        : 'https://thecoinperspective.com/'
    },
    {
      id: 'dexscreener',
      name: 'DEX Screener',
      category: 'dex_airdrops',
      access: ['auto', 'iframe'],
      description: 'Liquidez, pares, compras/ventas, FDV, edad del pool y grafico embebido.',
      domain: 'dexscreener.com',
      icon: 'scan-search',
      buildUrl: (context) => {
        if (context.address && context.chain) {
          return `https://dexscreener.com/${encodeURIComponent(context.chain)}/${encodeURIComponent(context.address)}`;
        }
        if (context.walletAddress && context.walletChain) {
          return `https://dexscreener.com/${encodeURIComponent(context.walletChain)}/${encodeURIComponent(context.walletAddress)}`;
        }
        if (context.symbol) return `https://dexscreener.com/search?q=${encodeURIComponent(context.symbol)}`;
        return 'https://dexscreener.com/';
      }
    },
    {
      id: 'bubblemaps-v2',
      name: 'Bubblemaps V2',
      category: 'dex_airdrops',
      access: ['login', 'iframe'],
      description: 'Magic Nodes, Time Travel y clusters de insiders antes de comprar.',
      domain: 'v2.bubblemaps.io',
      icon: 'network',
      buildUrl: (context) => {
        if (context.address && context.chain) {
          return `https://v2.bubblemaps.io/?chain=${encodeURIComponent(mapChainToBubblemaps(context.chain))}&address=${encodeURIComponent(context.address)}`;
        }
        if (context.walletAddress && context.walletChain) {
          return `https://v2.bubblemaps.io/?chain=${encodeURIComponent(mapChainToBubblemaps(context.walletChain))}&address=${encodeURIComponent(context.walletAddress)}`;
        }
        return 'https://v2.bubblemaps.io/';
      }
    },
    {
      id: 'gmgn-smart-money',
      name: 'GMGN.ai Smart Money',
      category: 'dex_airdrops',
      access: ['login'],
      description: 'Ballenas, compras inteligentes y analisis anti-rugpull en DEX.',
      domain: 'gmgn.ai',
      icon: 'radar',
      provider: 'gmgn',
      providerType: 'session',
      buildUrl: (context) => {
        if (context.address && context.chain) {
          return `https://gmgn.ai/${encodeURIComponent(mapChainToGmgn(context.chain))}/token/${encodeURIComponent(context.address)}`;
        }
        if (context.walletAddress && context.walletChain) {
          return `https://gmgn.ai/${encodeURIComponent(mapChainToGmgn(context.walletChain))}/address/${encodeURIComponent(context.walletAddress)}`;
        }
        return 'https://gmgn.ai/?chain=bsc';
      }
    },
    {
      id: 'cryptorank',
      name: 'CryptoRank',
      category: 'dex_airdrops',
      access: ['apikey', 'login'],
      description: 'Drop Hunting, estado de airdrops, testnets y financiacion VC.',
      domain: 'cryptorank.io',
      icon: 'trophy',
      provider: 'cryptorank',
      providerType: 'key',
      buildUrl: () => 'https://cryptorank.io/drophunting',
      links: [
        { label: 'Drop Hunting', buildUrl: () => 'https://cryptorank.io/drophunting', note: '🔑 API Key Gratis + 🌐 Login Web' },
        { label: 'Buscar en CryptoRank', buildUrl: () => 'https://cryptorank.io/es', note: '🔑 API Key Gratis + 🌐 Login Web' }
      ]
    },
    {
      id: 'dropstab-aggregators',
      name: 'DropsTab · CoinMarketCap · LiveCoinWatch · CoinMarketCal',
      category: 'dex_airdrops',
      access: ['login', 'apikey'],
      description: 'DropsTab Activities con ActiveScore, CoinMarketCap, LiveCoinWatch y CoinMarketCal integrados.',
      domain: 'dropstab.com',
      icon: 'sparkles',
      provider: 'dropstab',
      providerType: 'session',
      buildUrl: () => 'https://dropstab.com/',
      links: [
        { label: 'DropsTab Activities', buildUrl: () => 'https://dropstab.com/', note: '🌐 Login Web para ActiveScore y Tareas' },
        {
          label: 'CoinMarketCap',
          buildUrl: (context) => context.slug
            ? `https://coinmarketcap.com/currencies/${encodeURIComponent(context.slug)}/`
            : 'https://coinmarketcap.com/',
          note: '🔑 API Key Gratis',
          provider: 'coinmarketcap'
        },
        {
          label: 'LiveCoinWatch',
          buildUrl: (context) => context.symbol
            ? `https://www.livecoinwatch.com/price/${encodeURIComponent(context.name || context.symbol)}-${encodeURIComponent(context.symbol)}`
            : 'https://www.livecoinwatch.com/',
          note: '🔑 API Key Gratis',
          provider: 'livecoinwatch'
        },
        {
          label: 'CoinMarketCal',
          buildUrl: (context) => context.symbol
            ? `https://coinmarketcal.com/en/coin/${encodeURIComponent(context.symbol.toLowerCase())}`
            : 'https://coinmarketcal.com/',
          note: '🌐 Login Web'
        }
      ]
    }
  ];

  function initPrimarySourcesHub() {
    if (phase4State.sourcesInitialized) return;
    phase4State.sourcesInitialized = true;

    renderPrimarySources();

    const search = byId('sources-search');
    if (search) {
      search.addEventListener('input', () => {
        phase4State.sourcesQuery = search.value.trim().toLowerCase();
        applySourceFilters();
      });
    }

    const clear = byId('sources-search-clear');
    if (clear) {
      clear.addEventListener('click', () => {
        if (search) search.value = '';
        phase4State.sourcesQuery = '';
        applySourceFilters();
        if (search) search.focus();
      });
    }

    const category = byId('sources-category-filter');
    if (category) {
      category.addEventListener('change', () => {
        phase4State.sourcesCategory = category.value || 'all';
        applySourceFilters();
      });
    }

    $$('input[name="source-filter"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        phase4State.sourcesAccess = input.id.replace('source-filter-', '');
        applySourceFilters();
      });
    });

    const reset = byId('sources-reset-filters');
    if (reset) reset.addEventListener('click', resetSourceFilters);

    const grid = byId('sources-grid');
    if (grid) {
      grid.addEventListener('click', (event) => {
        const config = event.target.closest('[data-source-config]');
        if (!config) return;
        event.preventDefault();
        const tab = config.dataset.sourceConfig === 'sessions' ? 'sessions' : 'keys';
        const provider = config.dataset.sourceProvider || '';
        if (tab === 'sessions') {
          focusSessionForm(provider);
        } else {
          openConnections('keys');
          if (provider) {
            window.setTimeout(() => {
              const input = byId(`api-key-${provider}`);
              if (input) {
                input.focus();
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }, 140);
          }
        }
      });
    }

    document.addEventListener('crypto:intel:connections-updated', () => {
      if (phase4State.sourcesInitialized) renderPrimarySources();
    });
    document.addEventListener('crypto:intel:asset-updated', (event) => {
      setSourceContextFromAsset(event.detail || {});
    });
    document.addEventListener('crypto:intel:wallet-updated', (event) => {
      setSourceContextFromWallet(event.detail && event.detail.wallet ? event.detail.wallet : phase3State.currentWallet);
    });
    document.addEventListener('crypto:intel:wallets-updated', () => {
      if (phase4State.sourceContext.mode === 'wallet' && !phase3State.currentWallet) {
        setSourceContextFromAsset({ symbol: state.selectedSymbol || 'BTC' });
      } else {
        renderPrimarySources();
      }
    });
    window.addEventListener('hashchange', () => {
      if (phase4State.sourceContext.mode === 'wallet' && !phase3State.currentWallet) {
        setSourceContextFromAsset({ symbol: state.selectedSymbol || 'BTC' });
      }
    });

    updateSourceCounts();
    updateSourceContextLabel(getActiveSourceContext());
  }

  function renderPrimarySources() {
    const grid = byId('sources-grid');
    if (!grid) return;
    const context = getActiveSourceContext();
    grid.innerHTML = PRIMARY_SOURCES_DIRECTORY.map((source) => renderSourceCard(source, context)).join('');
    updateSourceCounts();
    applySourceFilters();
    updateSourceContextLabel(context);
    refreshIcons();
    updateTampermonkeyLoginCards();
  }

  function renderSourceCard(source, context) {
    const accessList = sourceAccessList(source);
    const url = sourceUrl(source.buildUrl, context);
    const status = getSourceStatus(source);
    const session = source.provider && source.providerType === 'session' ? state.sessions[source.provider] : null;
    const sessionBias = session ? normalizeExternalBias(session.bias) || (session.external ? 'NEUTRAL' : '') : '';
    const sessionBiasClass = sessionBias === 'BULLISH'
      ? 'is-bullish'
      : sessionBias === 'BEARISH'
        ? 'is-bearish'
        : 'is-neutral';
    const sessionTimestamp = session
      ? String(session.externalTimestamp || '').trim() || (session.updatedAt ? formatShortDate(session.updatedAt) : '')
      : '';
    const badges = accessList.map(sourceAccessBadge).join('');
    const sublinks = (source.links || []).map((link) => renderSourceSublink(link, context)).join('');
    const config = sourceConfigButton(source);
    const reading = session
      ? `<div class="source-session-reading tampermonkey-live-reading ${sessionBiasClass}"><span class="source-session-bias ${sessionBiasClass}">${escapeHtml(sessionBias || (session.external ? 'SYNC' : 'LOCAL'))}</span><span class="tampermonkey-live-value">${escapeHtml(session.value || '')}</span>${sessionTimestamp ? `<span class="tampermonkey-live-time">${escapeHtml(sessionTimestamp)}</span>` : ''}</div>`
      : '';
    const viewer = accessList.includes('iframe')
      ? `<a class="source-config" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="Abrir visor de ${escapeHtml(source.name)}"><i data-lucide="monitor-play"></i>Visor</a>`
      : '';
    return `<article class="source-card" data-source-card data-source-id="${escapeHtml(source.id)}" data-category="${escapeHtml(source.category)}" data-access="${escapeHtml(accessList.join(' '))}" data-title="${escapeHtml(source.name)}" data-domain="${escapeHtml(source.domain)}">
      <div class="source-card-top">
        <span class="source-icon ${escapeHtml(source.category)}"><i data-lucide="${escapeHtml(source.icon || SOURCE_CATEGORY_ICONS[source.category] || 'link-2')}"></i></span>
        <span class="source-category">${escapeHtml(SOURCE_CATEGORY_LABELS[source.category] || source.category)}</span>
        <div class="source-access-group">${badges}</div>
      </div>
      <div class="source-card-copy">
        <h4>${escapeHtml(source.name)}</h4>
        <p>${escapeHtml(source.description)}</p>
        ${reading}
      </div>
      <div class="source-card-foot">
        <span>${escapeHtml(source.domain)}</span>
        <span class="source-status ${status.className}" data-original-status="${escapeHtml(status.label)}" title="${escapeHtml(status.title || status.label)}"><span class="status-dot"></span>${escapeHtml(status.label)}</span>
      </div>
      <div class="source-card-actions">
        <a class="source-open" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i>Abrir</a>
        ${config}
        ${viewer}
      </div>
      ${sublinks ? `<div class="source-sublinks">${sublinks}</div>` : ''}
    </article>`;
  }

  function renderSourceSublink(link, context) {
    const url = sourceUrl(link.buildUrl, context);
    const provider = link.provider || '';
    const status = provider
      ? (state.apiKeys[provider] ? '🟢' : '⚪')
      : '';
    const config = provider
      ? `<button type="button" class="source-sub-config" data-source-config="keys" data-source-provider="${escapeHtml(provider)}" title="Configurar ${escapeHtml(SOURCE_PROVIDER_LABELS[provider] || link.label)}">${status}</button>`
      : '';
    const note = link.note ? `<span class="source-sub-note">${escapeHtml(link.note)}</span>` : '';
    return `<span class="source-sub-item"><a class="source-sub-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(link.note || link.label)}">${escapeHtml(link.label)}</a>${config}${note}</span>`;
  }

  function sourceConfigButton(source) {
    const access = sourceAccessList(source);
    if (!source.provider) return '';
    const tab = source.providerType === 'session' ? 'sessions' : 'keys';
    const connected = tab === 'sessions'
      ? Boolean(state.sessions[source.provider])
      : Boolean(state.apiKeys[source.provider]);
    const label = tab === 'sessions'
      ? (connected ? 'Sincronizar' : 'Sincronizar')
      : (connected ? 'Key conectada' : 'Configurar key');
    const icon = tab === 'sessions' ? 'refresh-cw' : 'key-round';
    const title = tab === 'sessions'
      ? `Abrir sincronizacion de ${SOURCE_PROVIDER_LABELS[source.provider] || source.name}`
      : `Configurar API Key de ${SOURCE_PROVIDER_LABELS[source.provider] || source.name}`;
    return `<button type="button" class="source-config" data-source-config="${tab}" data-source-provider="${escapeHtml(source.provider)}" title="${escapeHtml(title)}"><i data-lucide="${icon}"></i>${escapeHtml(label)}</button>`;
  }

  function sourceAccessList(source) {
    const raw = Array.isArray(source.access) ? source.access : [source.access];
    return raw.filter((access) => SOURCE_ACCESS_LABELS[access]);
  }

  function sourceAccessBadge(access) {
    if (access === 'auto') return '<span class="access-badge auto"><span class="access-dot"></span>🟢 Automáticas</span>';
    if (access === 'apikey') return '<span class="access-badge key"><i data-lucide="key-round"></i>🔑 API Key Gratis</span>';
    if (access === 'login') return '<span class="access-badge login"><i data-lucide="globe-2"></i>🌐 Login Web</span>';
    if (access === 'iframe') return '<span class="access-badge iframe"><i data-lucide="monitor-play"></i>🖼️ Iframe</span>';
    return '';
  }

  function getSourceStatus(source) {
    const access = sourceAccessList(source);
    const provider = source.provider;
    if (access.includes('auto') && !access.includes('apikey')) {
      return { label: '🟢 API Directa', className: 'is-connected', title: 'API pública directa sin key.' };
    }
    if (provider && source.providerType === 'session') {
      const session = state.sessions[provider];
      if (!session) return { label: '⚪ Sin configurar', className: '', title: 'Sin sesión web sincronizada.' };
      const updatedAt = toFiniteNumber(session.updatedAt);
      const stale = updatedAt == null || Date.now() - updatedAt > SESSION_STALE_MS;
      const detail = `${session.value || 'Sin valor'}${session.bias ? ` · ${session.bias}` : ''}${updatedAt == null ? '' : ` · ${formatShortDate(updatedAt)}`}`;
      return stale
        ? { label: '🟡 Sync vencida', className: 'is-stale', title: detail }
        : { label: '🟢 Conectada', className: 'is-synced', title: detail };
    }
    if (provider && (source.providerType === 'key' || access.includes('apikey'))) {
      return state.apiKeys[provider]
        ? { label: '🟢 Conectada', className: 'is-connected', title: 'API Key guardada en localStorage.' }
        : { label: '⚪ Sin configurar', className: '', title: 'Sin API Key configurada.' };
    }
    if (access.includes('iframe')) return { label: '🖼️ Iframe', className: '', title: 'Fuente embebible.' };
    return { label: '🟢 API Directa', className: 'is-connected', title: 'API pública directa.' };
  }

  function sourceUrl(builder, context) {
    try {
      const value = typeof builder === 'function' ? builder(context) : builder;
      return value || 'https://defillama.com/';
    } catch (error) {
      console.warn('[Source URL]', error);
      return 'https://defillama.com/';
    }
  }

  function getActiveSourceContext() {
    const base = { ...phase4State.sourceContext };
    if (base.mode === 'wallet' && base.walletAddress) return base;
    const token = phase3State.currentToken;
    if (token && (!base.symbol || token.symbol === base.symbol)) {
      return {
        ...base,
        mode: 'token',
        symbol: token.symbol || base.symbol || 'BTC',
        name: token.name || base.name || token.symbol || 'BTC',
        address: token.pair && token.pair.baseToken ? token.pair.baseToken.address : base.address,
        chain: token.pair ? token.pair.chainId : base.chain,
        slug: token.identity && token.identity.id ? token.identity.id : (base.slug || sourceSlug({ name: token.name, symbol: token.symbol }))
      };
    }
    return base;
  }

  function setSourceContextFromAsset(detail) {
    const symbol = normalizeSymbol(detail.symbol || detail.query || state.selectedSymbol || 'BTC');
    const name = detail.name || symbol;
    phase4State.sourceContext = {
      mode: 'token',
      symbol,
      name,
      address: detail.address || '',
      chain: detail.chain || '',
      slug: detail.slug || sourceSlug({ name, symbol })
    };
    if (phase4State.sourcesInitialized) renderPrimarySources();
  }

  function setSourceContextFromWallet(wallet) {
    if (!wallet) return;
    const config = WALLET_CHAINS[wallet.network] || {};
    phase4State.sourceContext = {
      mode: 'wallet',
      symbol: wallet.symbol || config.nativeSymbol || '',
      name: wallet.alias || wallet.symbol || 'Wallet',
      address: wallet.address || '',
      chain: wallet.network || '',
      slug: '',
      walletAddress: wallet.address || '',
      walletChain: wallet.network || '',
      wallet
    };
    if (phase4State.sourcesInitialized) renderPrimarySources();
  }

  function applySourceFilters() {
    const grid = byId('sources-grid');
    if (!grid) return;
    const query = phase4State.sourcesQuery;
    const accessFilter = phase4State.sourcesAccess === 'key' ? 'apikey' : phase4State.sourcesAccess;
    let visible = 0;
    $$('[data-source-card]', grid).forEach((card) => {
      const access = String(card.dataset.access || '').split(/\s+/).filter(Boolean);
      const matchesCategory = phase4State.sourcesCategory === 'all' || card.dataset.category === phase4State.sourcesCategory;
      const matchesAccess = phase4State.sourcesAccess === 'all' || access.includes(accessFilter);
      const matchesQuery = !query || card.textContent.toLowerCase().includes(query);
      const show = matchesCategory && matchesAccess && matchesQuery;
      card.classList.toggle('is-filtered-out', !show);
      if (show) visible += 1;
    });
    setText('sources-count', formatNumber(visible));
    const empty = byId('sources-empty');
    if (empty) empty.hidden = visible > 0;
    const clear = byId('sources-search-clear');
    if (clear) clear.hidden = !query;
    const activeInput = byId(`source-filter-${phase4State.sourcesAccess}`);
    if (activeInput && !activeInput.checked) activeInput.checked = true;
  }

  function updateSourceCounts() {
    const counts = { all: PRIMARY_SOURCES_DIRECTORY.length, auto: 0, key: 0, login: 0, iframe: 0 };
    PRIMARY_SOURCES_DIRECTORY.forEach((source) => {
      const access = sourceAccessList(source);
      if (access.includes('auto')) counts.auto += 1;
      if (access.includes('apikey')) counts.key += 1;
      if (access.includes('login')) counts.login += 1;
      if (access.includes('iframe')) counts.iframe += 1;
    });
    $$('[data-source-access-count]').forEach((element) => {
      const key = element.dataset.sourceAccessCount;
      element.textContent = formatNumber(counts[key] || 0);
    });
  }

  function updateSourceContextLabel(context) {
    if (!context) return;
    const label = context.mode === 'wallet'
      ? `${context.name} · ${shortAddress(context.walletAddress)}`
      : `${context.symbol}${context.chain ? ` · ${context.chain}` : ''}`;
    setText('sources-active-symbol', label);
    const extra = byId('sources-active-context');
    if (extra) {
      extra.textContent = context.mode !== 'wallet' && context.address ? ` · ${shortAddress(context.address)}` : '';
    }
  }

  function resetSourceFilters() {
    phase4State.sourcesCategory = 'all';
    phase4State.sourcesAccess = 'all';
    phase4State.sourcesQuery = '';
    const search = byId('sources-search');
    if (search) search.value = '';
    const category = byId('sources-category-filter');
    if (category) category.value = 'all';
    const all = byId('source-filter-all');
    if (all) all.checked = true;
    applySourceFilters();
  }

  function sourceSlug(context) {
    const raw = context && (context.slug || context.name || context.symbol) ? (context.slug || context.name || context.symbol) : '';
    return String(raw)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /* ------------------------------------------------------------
     Orquestador global, auto-refresh y API publica de la Fase 4
     ------------------------------------------------------------ */

  function initDashboardApp() {
    if (phase4State.appInitialized) return;
    phase4State.appInitialized = true;

    const initializers = [
      ['Panel 02 · Mercado y motor de decision', init],
      ['Puente Tampermonkey · login web', initExternalLoginBridge],
      ['Panel 01 · Wallet tracker multi-chain', initWalletTrackerPanel],
      ['Panel 03 · Deep dive CEX/DEX', initDeepSearchPanel],
      ['Panel 04 · Centro de fuentes primarias', initPrimarySourcesHub],
      ['Panel 05 · Airdrops y farming', initAirdropPanel],
      ['Arranque Fase 3', initPhase3],
      ['Puente Tampermonkey · tarjetas y tabla en vivo', initTampermonkeyBridgeListener],
      ['Controles globales', initGlobalControls]
    ];

    initializers.forEach(([name, initializer]) => {
      try {
        initializer();
      } catch (error) {
        console.warn(`[Dashboard] ${name}`, error);
        showToast(`${name} no pudo inicializarse por completo. El resto del dashboard sigue activo.`, 'error');
      }
    });

    try {
      syncExternalLoginData({ silent: true });
    } catch (error) {
      console.warn('[Puente Tampermonkey]', error);
    }

    primeInitialDeepDive();
  }

  function primeInitialDeepDive() {
    if (phase3State.currentToken || phase3State.isSearching) return;
    const symbol = FUTURES_SYMBOLS.includes(state.selectedSymbol) ? state.selectedSymbol : 'SOL';
    const initialPair = `${symbol}USDT`;
    phase3State.initialDeepSearchRequested = true;
    window.setTimeout(() => {
      if (!phase3State.currentToken && !phase3State.isSearching) {
        searchCryptoAsset(initialPair, { silent: true });
      }
    }, 260);
  }

  function initGlobalControls() {
    if (phase4State.globalControlsInitialized) return;
    phase4State.globalControlsInitialized = true;

    const refresh = byId('refresh-all');
    if (refresh) {
      refresh.addEventListener('click', refreshEverything);
      refresh.title = 'Refrescar todo · auto-refresh cada 60 segundos';
    }

    startAutoRefresh();
    window.CryptoIntelPhase4 = Object.freeze({
      version: APP_VERSION,
      autoRefreshMs: AUTO_REFRESH_MS,
      refreshAll: refreshEverything,
      refreshAirdrops: () => loadTokenlessProtocols({ silent: false }),
      syncExternalLoginData: (options = {}) => syncExternalLoginData({ silent: false, force: true, ...options }),
      getExternalBridge: () => ({ ...phase4State.externalSyncSummary }),
      getExternalBiasPoints: () => getTampermonkeyBiasSummary(),
      getTampermonkeyLiveEntries: () => buildTampermonkeyLiveEntries().map((entry) => ({
        provider: entry.provider,
        name: entry.name,
        value: entry.value,
        bias: entry.bias,
        timestamp: entry.timestampLabel,
        url: entry.url,
        applied: entry.applied,
        stale: entry.stale,
        points: entry.points,
        status: entry.status
      })),
      getFarms: () => phase4State.farms.map((task) => ({ ...task })),
      getSources: () => PRIMARY_SOURCES_DIRECTORY.map((source) => ({ ...source })),
      getSourceContext: () => ({ ...getActiveSourceContext() }),
      getSnapshot: () => ({
        airdrops: phase4State.protocols.length,
        farms: phase4State.farms.length,
        sources: PRIMARY_SOURCES_DIRECTORY.length,
        externalSessions: EXTERNAL_LOGIN_PROVIDERS.filter((provider) => Boolean(state.sessions[provider])).length,
        updatedAt: Date.now()
      })
    });
  }

  async function refreshEverything() {
    if (phase4State.isRefreshingAll) return;
    phase4State.isRefreshingAll = true;
    const button = byId('refresh-all');
    const original = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.classList.add('is-loading');
      button.innerHTML = '<i data-lucide="loader-circle"></i><span>Refrescando</span>';
      refreshIcons();
    }

    const tasks = [
      refreshMarketData({ silent: true }),
      refreshOptionalApiData()
    ];
    if (phase3State.currentToken) {
      const current = phase3State.currentToken;
      const refreshQuery = FUTURES_SYMBOLS.includes(current.symbol)
        ? `${current.symbol}USDT`
        : (current.query || current.symbol || state.selectedSymbol || 'BTC');
      tasks.push(searchCryptoAsset(refreshQuery, { silent: true, preserveSourceContext: true }));
    }
    if (phase3State.wallets.length) tasks.push(refreshAllWallets());
    if (byId('tokenless-body')) tasks.push(loadTokenlessProtocols({ silent: true }));

    const results = await Promise.allSettled(tasks);
    phase4State.isRefreshingAll = false;
    if (button) {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.innerHTML = original;
      refreshIcons();
    }
    const failures = results.filter((result) => result.status === 'rejected').length;
    showToast(
      failures
        ? `Refresco global completado con ${failures} fuente(s) con error. Se conserva el ultimo dato valido.`
        : 'Refresco global completado: mercado, wallets, deep dive y airdrops.',
      failures ? 'warning' : 'success'
    );
  }

  function startAutoRefresh() {
    if (phase4State.autoRefreshTimer) window.clearInterval(phase4State.autoRefreshTimer);
    phase4State.autoRefreshTimer = window.setInterval(() => {
      if (document.hidden || phase4State.isRefreshingAll) return;
      refreshMarketData({ silent: true });
    }, AUTO_REFRESH_MS);
  }

  /* ------------------------------------------------------------
     Puente Tampermonkey · listener DashboardBridgeSync, tarjetas
     en vivo y conexion matematica con la matriz 4H/1D
     ------------------------------------------------------------ */

  const TAMPERMONKEY_BIAS_POINTS = Object.freeze({
    BULLISH: 15,
    BEARISH: -15,
    NEUTRAL: 0
  });

  const TAMPERMONKEY_CARD_PROVIDER_PATTERNS = Object.freeze([
    { provider: 'glassnode', pattern: /glass\s*node/i },
    { provider: 'cryptoquant', pattern: /crypto\s*quant/i },
    { provider: 'chainexposed', pattern: /chain\s*exposed/i },
    { provider: 'tokenterminal', pattern: /token\s*terminal/i },
    { provider: 'artemis', pattern: /artemis/i },
    { provider: 'fundingview', pattern: /funding\s*view/i },
    { provider: 'dropstab', pattern: /dropstab/i },
    { provider: 'gmgn', pattern: /gmgn/i }
  ]);

  const tampermonkeyBadgeOriginals = new WeakMap();
  const tampermonkeySeenEvents = new WeakSet();

  function initTampermonkeyBridgeListener() {
    if (phase4State.tampermonkeyListenerInitialized) return;
    phase4State.tampermonkeyListenerInitialized = true;

    const handleDashboardBridgeSync = (event) => {
      if (event && typeof event === 'object') {
        if (tampermonkeySeenEvents.has(event)) return;
        tampermonkeySeenEvents.add(event);
      }
      try {
        syncExternalLoginData({ silent: true });
      } catch (error) {
        console.warn('[Tampermonkey Bridge Listener]', error);
      }
      refreshTampermonkeyBridgeUI({ recalc: true });
    };

    window.addEventListener('DashboardBridgeSync', handleDashboardBridgeSync);
    document.addEventListener('DashboardBridgeSync', handleDashboardBridgeSync);
    document.addEventListener('crypto:intel:connections-updated', () => {
      window.setTimeout(() => refreshTampermonkeyBridgeUI(), 0);
    });

    try {
      syncExternalLoginData({ silent: true });
    } catch (error) {
      console.warn('[Tampermonkey Bridge Listener]', error);
    }
    startTampermonkeyHiddenNodePoll();
    refreshTampermonkeyBridgeUI({ recalc: true });
  }

  function startTampermonkeyHiddenNodePoll() {
    if (phase4State.tampermonkeyHiddenPollTimer) return;
    phase4State.tampermonkeyHiddenPollTimer = window.setInterval(() => {
      const node = document.getElementById('tm-bridge-hidden-json');
      if (!node) {
        phase4State.lastHiddenBridgeRaw = null;
        return;
      }
      const raw = String(node.textContent || '').trim();
      if (!raw || raw === phase4State.lastHiddenBridgeRaw) return;
      phase4State.lastHiddenBridgeRaw = raw;
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
        const currentRaw = localStorage.getItem(EXTERNAL_LOGIN_SYNC_KEY);
        if (currentRaw !== raw) localStorage.setItem(EXTERNAL_LOGIN_SYNC_KEY, JSON.stringify(parsed));
        syncExternalLoginData({ silent: true });
        refreshTampermonkeyBridgeUI({ recalc: true });
      } catch (error) {
        // El userscript puede escribir JSON parcial; se reintenta cuando cambie el nodo.
      }
    }, 2000);
  }

  function renderTampermonkeySyncData(data) {
    try {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return getTampermonkeyBiasSummary();
      }
      localStorage.setItem(EXTERNAL_LOGIN_SYNC_KEY, JSON.stringify(data));
      syncExternalLoginData({ silent: true });
      refreshTampermonkeyBridgeUI({ recalc: true });
    } catch (error) {
      console.warn('[Tampermonkey Receiver]', error);
    }
    return getTampermonkeyBiasSummary();
  }

  window.renderTampermonkeySyncData = renderTampermonkeySyncData;

  function refreshTampermonkeyBridgeUI({ recalc = false } = {}) {
    try {
      updateTampermonkeyBonusScoreMirror();
      ensureTampermonkeyLiveTable();
      updateTampermonkeyLoginCards();
      updateTampermonkeyLiveTable();
      updateTampermonkeySyncBanner();
      if (recalc) refreshExternalLoginDecisions();
    } catch (error) {
      console.warn('[Tampermonkey Bridge UI]', error);
    }
  }

  function refreshExternalLoginDecisions() {
    if (!state.decisions['4h'] || !state.decisions['1d']) return false;
    if (state.isDecisionLoading) return false;
    return rebuildDecisionsFromCache();
  }

  function ensureDecisionExternalRow(timeframe) {
    const table = byId(`decision-${timeframe}-factors`);
    if (!table || byId(`decision-${timeframe}-external`)) return;
    const row = document.createElement('div');
    row.className = 'factor-table-row';
    row.dataset.factor = 'external';
    row.innerHTML = `<span>Sesgo Login Web</span><strong class="text-muted" id="decision-${timeframe}-external">—</strong>`;
    const anchor = table.querySelector('[data-factor="ls"]');
    if (anchor) anchor.insertAdjacentElement('afterend', row);
    else table.appendChild(row);
  }

  function buildTampermonkeyLiveEntries() {
    const entries = new Map();
    const read = readExternalLoginData();
    const data = read && read.data ? read.data : {};

    Object.keys(data).forEach((rawProvider) => {
      const raw = data[rawProvider];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      const provider = normalizeExternalProvider(rawProvider) || normalizeExternalProvider(raw.name);
      if (!provider) return;
      if (raw.value == null || typeof raw.value === 'object') return;
      const value = String(raw.value).trim().slice(0, 120);
      if (!value) return;

      const bias = normalizeExternalBias(raw.bias) || 'NEUTRAL';
      const updatedAt = parseExternalTimestamp(raw.timestamp) || Date.now();
      const timestampRaw = raw.timestamp == null ? '' : String(raw.timestamp).trim();
      const session = state.sessions[provider] || null;
      const sessionBias = session && session.bias ? String(session.bias).toUpperCase() : '';
      const applied = Boolean(
        session
        && session.external
        && session.value === value
        && (!sessionBias || sessionBias === bias)
      );
      const stale = Date.now() - updatedAt > SESSION_STALE_MS;

      entries.set(provider, {
        provider,
        name: String(raw.name || SESSION_LABELS[provider] || provider),
        value,
        bias,
        updatedAt,
        timestampRaw,
        timestampLabel: timestampRaw || formatShortDate(updatedAt),
        url: extractExternalUrl(raw.url),
        metric: PLATFORM_DEFAULT_METRIC[provider] || 'sector-flow',
        metricLabel: METRIC_LABELS[PLATFORM_DEFAULT_METRIC[provider]] || 'Lectura web',
        session,
        applied,
        stale,
        points: applied && !stale ? (TAMPERMONKEY_BIAS_POINTS[bias] || 0) : 0,
        status: applied ? (stale ? 'Vencida' : 'Aplicada') : (session ? 'Manual conservada' : 'Pendiente')
      });
    });

    EXTERNAL_LOGIN_PROVIDERS.forEach((provider) => {
      if (entries.has(provider)) return;
      const session = state.sessions[provider];
      if (!session || !session.external) return;
      const bias = normalizeExternalBias(session.bias) || 'NEUTRAL';
      const updatedAt = toFiniteNumber(session.updatedAt) || Date.now();
      const stale = Date.now() - updatedAt > SESSION_STALE_MS;
      const timestampRaw = String(session.externalTimestamp || '').trim();
      entries.set(provider, {
        provider,
        name: String(session.sourceName || SESSION_LABELS[provider] || provider),
        value: String(session.value || '').trim().slice(0, 120),
        bias,
        updatedAt,
        timestampRaw,
        timestampLabel: timestampRaw || formatShortDate(updatedAt),
        url: session.url || '',
        metric: session.metric || PLATFORM_DEFAULT_METRIC[provider] || 'sector-flow',
        metricLabel: session.metricLabel || METRIC_LABELS[session.metric] || 'Lectura web',
        session,
        applied: true,
        stale,
        points: !stale ? (TAMPERMONKEY_BIAS_POINTS[bias] || 0) : 0,
        status: stale ? 'Vencida' : 'Aplicada'
      });
    });

    return EXTERNAL_LOGIN_PROVIDERS
      .map((provider) => entries.get(provider))
      .filter(Boolean);
  }

  function summarizeTampermonkeyEntries(entries) {
    const applied = entries.filter((entry) => entry.applied && !entry.stale);
    return {
      entries,
      count: applied.length,
      total: entries.length,
      bullish: applied.filter((entry) => entry.bias === 'BULLISH').length,
      bearish: applied.filter((entry) => entry.bias === 'BEARISH').length,
      neutral: applied.filter((entry) => entry.bias === 'NEUTRAL').length,
      stale: entries.filter((entry) => entry.stale).length,
      points: applied.reduce((sum, entry) => sum + (entry.points || 0), 0),
      lastUpdatedAt: entries.reduce((latest, entry) => Math.max(latest, entry.updatedAt || 0), 0)
    };
  }

  function getExternalLoginBiasPoints() {
    return summarizeTampermonkeyEntries(buildTampermonkeyLiveEntries());
  }

  function getTampermonkeyBiasSummary() {
    const summary = getExternalLoginBiasPoints();
    return {
      points: summary.points,
      count: summary.count,
      total: summary.total,
      bullish: summary.bullish,
      bearish: summary.bearish,
      neutral: summary.neutral,
      stale: summary.stale,
      lastUpdatedAt: summary.lastUpdatedAt
    };
  }

  function tampermonkeyBiasMeta(bias) {
    const normalized = normalizeExternalBias(bias) || 'NEUTRAL';
    if (normalized === 'BULLISH') return { label: '🟢 BULLISH', className: 'is-bullish' };
    if (normalized === 'BEARISH') return { label: '🔴 BEARISH', className: 'is-bearish' };
    return { label: '🟡 NEUTRAL', className: 'is-neutral' };
  }

  function resolveTampermonkeyProvider(card) {
    if (!card) return null;

    const explicit = card.dataset.sourceProvider || card.dataset.provider || card.dataset.sessionProvider || '';
    const explicitProvider = normalizeExternalProvider(explicit);
    if (explicitProvider) return explicitProvider;

    const macroProvider = normalizeExternalProvider(card.dataset.macroId || '');
    if (macroProvider) return macroProvider;

    const domain = card.dataset.domain || '';
    if (domain) {
      const info = findSourceProvider(domain);
      if (info && EXTERNAL_LOGIN_PROVIDERS.includes(info.provider)) return info.provider;
    }

    if (card.matches('.validation-card, .hub-card, .smart-money-card')) {
      const haystack = `${card.id || ''} ${card.dataset.title || ''} ${card.textContent || ''}`;
      for (const item of TAMPERMONKEY_CARD_PROVIDER_PATTERNS) {
        if (item.pattern.test(haystack)) return item.provider;
      }
    }

    return null;
  }

  function collectTampermonkeyLoginCards() {
    const selector = [
      '[data-source-card]',
      '.validation-card',
      '.macro-item',
      '.hub-card',
      '.smart-money-card',
      '.forensic-card',
      '.dex-forensics-card',
      '.token-search-card',
      '[data-tampermonkey-card]'
    ].join(',');
    return $$(selector).filter((card) => {
      if (card.querySelector('.access-badge.login')) return true;
      const access = `${card.dataset.access || ''} ${card.dataset.macroAccess || ''}`;
      return /\blogin\b/i.test(access);
    });
  }

  function getTampermonkeyReadingHost(card) {
    if (card.matches('.source-card')) return card.querySelector('.source-card-copy');
    if (card.matches('.validation-card')) return card.querySelector('.validation-copy');
    if (card.matches('.macro-item')) return card.querySelector('.macro-item-copy');
    if (card.matches('.hub-card')) return card.querySelector('.hub-copy');
    if (card.matches('.smart-money-card')) return card.querySelector('.smart-money-copy');
    return card;
  }

  function insertTampermonkeyReading(card, reading) {
    if (card.matches('.smart-money-card')) {
      const copy = card.querySelector('.smart-money-copy');
      if (copy) {
        copy.insertAdjacentElement('afterend', reading);
        return;
      }
    }
    const host = getTampermonkeyReadingHost(card);
    if (host) host.appendChild(reading);
    else card.appendChild(reading);
  }

  function renderTampermonkeyReading(entry) {
    const meta = tampermonkeyBiasMeta(entry.bias);
    const time = entry.timestampLabel || (entry.updatedAt ? formatShortDate(entry.updatedAt) : 'sin fecha');
    const fullDate = entry.updatedAt ? formatFullDate(entry.updatedAt) : 'Sin fecha';
    const note = entry.applied ? '' : `<span class="tampermonkey-live-note">${escapeHtml(entry.status || 'No aplicada')}</span>`;
    const value = entry.url
      ? `<a class="tampermonkey-live-value" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.value)}</a>`
      : `<span class="tampermonkey-live-value">${escapeHtml(entry.value)}</span>`;
    return `<span class="source-session-bias ${meta.className}">${meta.label}</span>${value}<span class="tampermonkey-live-time" title="${escapeHtml(fullDate)}">${escapeHtml(time)}</span>${note}`;
  }

  function updateTampermonkeyCardBadge(card, entry) {
    $$('.access-badge.login', card).forEach((badge) => {
      if (!tampermonkeyBadgeOriginals.has(badge)) {
        tampermonkeyBadgeOriginals.set(badge, badge.innerHTML);
      }
      if (entry) {
        const meta = tampermonkeyBiasMeta(entry.bias);
        badge.innerHTML = '<span class="status-dot"></span>🟢 Sincronizado vía Tampermonkey';
        badge.classList.add('is-tampermonkey-synced');
        badge.title = `${entry.name}: ${entry.value} · ${meta.label} · ${entry.timestampLabel || formatShortDate(entry.updatedAt)}${entry.applied ? '' : ` · ${entry.status}`}`;
      } else {
        const original = tampermonkeyBadgeOriginals.get(badge);
        if (original != null) badge.innerHTML = original;
        badge.classList.remove('is-tampermonkey-synced');
        badge.removeAttribute('title');
      }
    });
  }

  function updateTampermonkeyCardReading(card, entry) {
    const existing = card.querySelector('.tampermonkey-live-reading') || card.querySelector('.source-session-reading');
    if (!entry) {
      if (existing && existing.dataset.tampermonkeyGenerated === 'true' && !card.matches('.source-card')) {
        existing.remove();
      }
      return;
    }
    const reading = existing || document.createElement('div');
    reading.className = `source-session-reading tampermonkey-live-reading ${tampermonkeyBiasMeta(entry.bias).className}`;
    reading.dataset.tampermonkeyGenerated = 'true';
    reading.innerHTML = renderTampermonkeyReading(entry);
    if (!existing) insertTampermonkeyReading(card, reading);
  }

  function updateTampermonkeyLoginCards() {
    const entries = buildTampermonkeyLiveEntries();
    const byProvider = new Map(entries.map((entry) => [entry.provider, entry]));

    collectTampermonkeyLoginCards().forEach((card) => {
      const provider = resolveTampermonkeyProvider(card);
      if (!provider) return;
      const entry = byProvider.get(provider) || null;
      updateTampermonkeyCardBadge(card, entry);
      updateTampermonkeyCardReading(card, entry);
    });
  }

  function ensureTampermonkeyLiveTable() {
    const existing = document.getElementById('tampermonkey-live-accounts');
    if (existing) return existing;

    const decisionSection = $('.decision-section');
    const panel = byId('panel-market');
    if (!decisionSection && !panel) return null;

    ensureTampermonkeyLiveStyles();

    const card = document.createElement('article');
    card.className = 'card tampermonkey-live-card';
    card.id = 'tampermonkey-live-accounts';
    card.setAttribute('aria-labelledby', 'tampermonkey-live-title');
    card.innerHTML = `
      <header class="card-header">
        <div>
          <div class="eyebrow">Puente Tampermonkey · login web</div>
          <h3 id="tampermonkey-live-title">Tabla en Vivo de Cuentas con Login Sincronizadas</h3>
          <p>Lecturas recibidas desde <code>external_login_sync_data</code>. Cada BULLISH suma +15 pts y cada BEARISH resta -15 pts a la matriz 4H/1D.</p>
        </div>
        <div class="card-header-meta">
          <span class="badge badge-neutral" id="tampermonkey-live-count">0 cuentas</span>
          <span class="badge badge-neutral" id="tampermonkey-live-points">0 pts</span>
          <button class="btn btn-ghost btn-sm" type="button" id="tampermonkey-live-paste"><i data-lucide="clipboard-paste"></i>Pegar JSON</button>
          <button class="btn btn-ghost btn-sm" type="button" id="tampermonkey-live-sync"><i data-lucide="refresh-cw"></i>Sincronizar ahora</button>
        </div>
      </header>
      <div class="table-wrap">
        <table class="data-table compact-table tampermonkey-live-table">
          <thead>
            <tr><th>Cuenta</th><th>Métrica</th><th>Valor</th><th>Sesgo</th><th>Puntos</th><th>Sincronización</th><th>Estado</th></tr>
          </thead>
          <tbody id="tampermonkey-live-body"></tbody>
        </table>
      </div>
      <footer class="card-footer">
        <span><i data-lucide="info"></i> La matriz usa solo lecturas aplicadas y vigentes (&lt;7 días). Las lecturas manuales más recientes conservan prioridad.</span>
        <span id="tampermonkey-live-updated">Sin datos</span>
      </footer>
    `;

    if (decisionSection) decisionSection.insertAdjacentElement('afterend', card);
    else panel.appendChild(card);

    const paste = document.getElementById('tampermonkey-live-paste');
    if (paste) paste.addEventListener('click', handleTampermonkeyClipboardPaste);

    const sync = document.getElementById('tampermonkey-live-sync');
    if (sync) {
      sync.addEventListener('click', () => {
        try {
          syncExternalLoginData({ silent: false, force: true });
        } catch (error) {
          console.warn('[Tampermonkey Bridge Sync]', error);
          showToast('No se pudo sincronizar el puente Tampermonkey.', 'error');
        }
        refreshTampermonkeyBridgeUI({ recalc: true });
      });
    }

    refreshIcons();
    return card;
  }

  function renderTampermonkeyLiveRow(entry) {
    const meta = tampermonkeyBiasMeta(entry.bias);
    const statusClass = entry.stale ? 'badge-amber' : entry.applied ? 'badge-bull' : 'badge-amber';
    const statusLabel = entry.stale
      ? '🟡 Vencida'
      : entry.applied
        ? '🟢 Aplicada'
        : `🟡 ${entry.status || 'No aplicada'}`;
    const pointsClass = entry.points > 0 ? 'positive' : entry.points < 0 ? 'negative' : 'text-muted';
    const providerLabel = SESSION_LABELS[entry.provider] || entry.provider;
    const subtitle = providerLabel === entry.name ? entry.provider : providerLabel;
    const link = entry.url
      ? ` <a class="table-action-link" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer" title="Abrir lectura"><i data-lucide="external-link"></i></a>`
      : '';
    return `<tr data-tampermonkey-provider="${escapeHtml(entry.provider)}">
      <td><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(subtitle)}</small></td>
      <td>${escapeHtml(entry.metricLabel || 'Lectura web')}</td>
      <td class="tampermonkey-live-value-cell" title="${escapeHtml(entry.value)}">${escapeHtml(entry.value)}${link}</td>
      <td><span class="source-session-bias ${meta.className}">${meta.label}</span></td>
      <td class="${pointsClass}">${entry.points ? signedPoints(entry.points) : '0'}</td>
      <td><span class="tampermonkey-live-time" title="${escapeHtml(entry.updatedAt ? formatFullDate(entry.updatedAt) : 'Sin fecha')}">${escapeHtml(entry.timestampLabel || 'Sin fecha')}</span></td>
      <td><span class="badge ${statusClass}">${statusLabel}</span></td>
    </tr>`;
  }

  function updateTampermonkeyLiveTable() {
    const card = document.getElementById('tampermonkey-live-accounts');
    if (!card) return;
    const body = document.getElementById('tampermonkey-live-body');
    if (!body) return;

    const entries = buildTampermonkeyLiveEntries();
    const summary = summarizeTampermonkeyEntries(entries);

    body.innerHTML = entries.length
      ? entries.map(renderTampermonkeyLiveRow).join('')
      : `<tr class="placeholder-row"><td colspan="7"><div class="table-empty"><span class="empty-icon"><i data-lucide="plug-zap"></i></span><div><strong>Sin datos del puente</strong><span>Abre Tampermonkey, inicia sesión en tus fuentes y sincroniza para ver las métricas en vivo.</span></div></div></td></tr>`;

    const count = document.getElementById('tampermonkey-live-count');
    if (count) count.textContent = `${entries.length} cuenta${entries.length === 1 ? '' : 's'}`;
    const points = document.getElementById('tampermonkey-live-points');
    if (points) {
      points.textContent = `${signedPoints(summary.points)} pts`;
      points.className = `badge ${summary.points > 0 ? 'badge-bull' : summary.points < 0 ? 'badge-bear' : 'badge-neutral'}`;
      points.title = `${summary.bullish} BULLISH · ${summary.bearish} BEARISH · ${summary.neutral} NEUTRAL · ${summary.stale} vencida(s)`;
    }
    const updated = document.getElementById('tampermonkey-live-updated');
    if (updated) updated.textContent = summary.lastUpdatedAt ? `Última lectura: ${formatShortDate(summary.lastUpdatedAt)}` : 'Sin datos';
    refreshIcons();
  }

  function updateTampermonkeyBonusScoreMirror() {
    try {
      const next = String(getExternalLoginBiasPoints().points);
      if (localStorage.getItem('login_sync_bonus_score') !== next) {
        localStorage.setItem('login_sync_bonus_score', next);
      }
    } catch (error) {
      // localStorage puede estar bloqueado en modo privado; el dashboard sigue funcionando.
    }
  }

  function scrollToTampermonkeyLiveTable(attempt = 0) {
    const table = document.getElementById('tampermonkey-live-accounts');
    const panel = document.getElementById('panel-market');
    if (!table) return;
    if (panel && !panel.classList.contains('is-active') && attempt < 12) {
      window.setTimeout(() => scrollToTampermonkeyLiveTable(attempt + 1), 60);
      return;
    }
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    try {
      table.scrollIntoView({ behavior: 'auto', block: 'start' });
    } finally {
      root.style.scrollBehavior = previous;
    }
  }

  function ensureTampermonkeySyncBanner() {
    let banner = document.getElementById('live-login-sync-banner');
    if (banner) return banner;

    const main = byId('main-content');
    if (!main) return null;

    ensureTampermonkeyLiveStyles();
    banner = document.createElement('article');
    banner.id = 'live-login-sync-banner';
    banner.className = 'tampermonkey-sync-banner';
    banner.hidden = true;
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = `
      <div class="tampermonkey-sync-banner-head">
        <span class="badge badge-bull"><i data-lucide="zap"></i> Cuentas con login sincronizadas</span>
        <strong class="tampermonkey-sync-points is-neutral" id="live-login-sync-points">0 pts</strong>
        <span class="tampermonkey-sync-count" id="live-login-sync-count">0/0 aplicadas</span>
        <div class="tampermonkey-sync-banner-actions">
          <button class="btn btn-ghost btn-sm" type="button" id="btn-manual-paste-sync"><i data-lucide="clipboard-paste"></i>Pegar JSON copiado</button>
          <a class="btn btn-ghost btn-sm" href="#tampermonkey-live-accounts" data-panel-target="panel-market"><i data-lucide="table-2"></i>Ver tabla</a>
        </div>
      </div>
      <div class="tampermonkey-sync-banner-track" id="live-login-sync-track"></div>
    `;

    main.insertBefore(banner, main.firstChild);

    const paste = document.getElementById('btn-manual-paste-sync');
    if (paste) paste.addEventListener('click', handleTampermonkeyClipboardPaste);

    const tableLink = banner.querySelector('a[data-panel-target="panel-market"]');
    if (tableLink) {
      tableLink.addEventListener('click', (event) => {
        event.preventDefault();
        navigateTo('panel-market');
        window.setTimeout(() => scrollToTampermonkeyLiveTable(), 90);
      });
    }

    refreshIcons();
    return banner;
  }

  function renderTampermonkeySyncChip(entry) {
    const meta = tampermonkeyBiasMeta(entry.bias);
    const status = entry.stale ? 'Vencida' : entry.applied ? 'Aplicada' : (entry.status || 'No aplicada');
    const content = `
      <span class="tampermonkey-sync-chip-name">${escapeHtml(entry.name)}</span>
      <strong class="tampermonkey-sync-chip-value">${escapeHtml(entry.value)}</strong>
      <span class="tampermonkey-sync-chip-meta">${meta.label} · ${escapeHtml(status)} · ${escapeHtml(entry.timestampLabel || 'sin fecha')}</span>
    `;
    if (entry.url) {
      return `<a class="tampermonkey-sync-chip ${meta.className}" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer" title="Abrir ${escapeHtml(entry.name)}">${content}</a>`;
    }
    return `<div class="tampermonkey-sync-chip ${meta.className}">${content}</div>`;
  }

  function updateTampermonkeySyncBanner() {
    const banner = ensureTampermonkeySyncBanner();
    if (!banner) return;

    const entries = buildTampermonkeyLiveEntries();
    const summary = summarizeTampermonkeyEntries(entries);
    if (!entries.length) {
      banner.hidden = true;
      return;
    }

    banner.hidden = false;
    const points = document.getElementById('live-login-sync-points');
    if (points) {
      points.textContent = `${signedPoints(summary.points)} pts`;
      points.className = `tampermonkey-sync-points ${summary.points > 0 ? 'is-bullish' : summary.points < 0 ? 'is-bearish' : 'is-neutral'}`;
      points.title = `${summary.count} aplicadas · ${summary.bullish} BULLISH · ${summary.bearish} BEARISH · ${summary.neutral} NEUTRAL · ${summary.stale} vencidas`;
    }
    const count = document.getElementById('live-login-sync-count');
    if (count) count.textContent = `${summary.count}/${summary.total} aplicadas`;
    const track = document.getElementById('live-login-sync-track');
    if (track) {
      track.innerHTML = entries.map(renderTampermonkeySyncChip).join('');
      refreshIcons();
    }
  }

  async function handleTampermonkeyClipboardPaste() {
    try {
      let text = '';
      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        try {
          text = await navigator.clipboard.readText();
        } catch (error) {
          text = '';
        }
      }
      if (!text) {
        text = window.prompt('Pega el JSON de external_login_sync_data:') || '';
      }
      text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      if (!text) return;

      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('El JSON debe ser un objeto de proveedores.');
      }

      localStorage.setItem(EXTERNAL_LOGIN_SYNC_KEY, JSON.stringify(parsed));
      syncExternalLoginData({ silent: false, force: true });
      refreshTampermonkeyBridgeUI({ recalc: true });
    } catch (error) {
      console.warn('[Tampermonkey Paste]', error);
      showToast('No se pudo pegar el JSON. Copia un objeto JSON válido y reintenta.', 'error');
    }
  }

  function ensureTampermonkeyLiveStyles() {
    if (document.getElementById('tampermonkey-live-styles')) return;
    const style = document.createElement('style');
    style.id = 'tampermonkey-live-styles';
    style.textContent = `
      .tampermonkey-live-card { margin-top: 12px; scroll-margin-top: calc(var(--topbar-height) + 18px); }
      .tampermonkey-live-card .card-header { align-items: flex-start; }
      .tampermonkey-live-card .card-header-meta { flex-wrap: wrap; justify-content: flex-end; }
      .tampermonkey-live-table { font-size: 8px; }
      .tampermonkey-live-table th,
      .tampermonkey-live-table td { padding: 7px 8px; vertical-align: middle; }
      .tampermonkey-live-table td small { display: block; margin-top: 2px; color: var(--faint); font-size: 6px; }
      .tampermonkey-live-value-cell { max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tampermonkey-live-value-cell .table-action-link { margin-left: 4px; }
      .tampermonkey-live-reading { display: flex; align-items: center; gap: 4px; margin-top: 5px; padding: 4px 6px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 5px; background: rgba(255, 255, 255, 0.025); color: var(--muted); font-size: 6.5px; }
      .tampermonkey-live-reading .tampermonkey-live-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-soft); }
      .tampermonkey-live-reading .tampermonkey-live-time { flex: 0 0 auto; color: var(--faint); font-size: 5.8px; }
      .tampermonkey-live-reading .tampermonkey-live-note { flex: 0 0 auto; color: var(--amber-bright); font-size: 5.5px; }
      .tampermonkey-live-reading.is-bullish { border-color: rgba(16, 185, 129, 0.14); }
      .tampermonkey-live-reading.is-bearish { border-color: rgba(239, 68, 68, 0.14); }
      .tampermonkey-live-reading.is-neutral { border-color: rgba(245, 158, 11, 0.14); }
      .access-badge.login.is-tampermonkey-synced { border-color: rgba(16, 185, 129, 0.2); background: var(--green-soft); color: var(--green-bright); }
      .access-badge.login.is-tampermonkey-synced .status-dot { background: var(--green-bright); box-shadow: 0 0 6px rgba(16, 185, 129, 0.7); }
      .tampermonkey-live-card .badge { white-space: nowrap; }
      .tampermonkey-sync-banner { margin: 0 0 16px; overflow: hidden; border: 1px solid rgba(16, 185, 129, 0.24); border-radius: 10px; background: linear-gradient(180deg, rgba(17, 24, 39, 0.98), rgba(11, 14, 20, 0.98)); box-shadow: 0 12px 30px rgba(0, 0, 0, 0.26); }
      .tampermonkey-sync-banner[hidden] { display: none; }
      .tampermonkey-sync-banner-head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; padding: 9px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
      .tampermonkey-sync-banner-head .badge { white-space: nowrap; }
      .tampermonkey-sync-points { font-size: 13px; font-weight: 800; }
      .tampermonkey-sync-points.is-bullish { color: var(--green-bright); }
      .tampermonkey-sync-points.is-bearish { color: var(--red-bright); }
      .tampermonkey-sync-points.is-neutral { color: var(--amber-bright); }
      .tampermonkey-sync-count { color: var(--faint); font-size: 8px; font-weight: 600; }
      .tampermonkey-sync-banner-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }
      .tampermonkey-sync-banner-track { display: flex; gap: 8px; overflow-x: auto; padding: 9px 12px 10px; scrollbar-width: thin; }
      .tampermonkey-sync-chip { display: flex; flex: 0 0 210px; flex-direction: column; gap: 3px; padding: 7px 9px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.07); border-left: 3px solid var(--amber-bright); border-radius: 7px; background: rgba(255, 255, 255, 0.025); color: inherit; text-decoration: none; }
      .tampermonkey-sync-chip:hover { border-color: rgba(255, 255, 255, 0.14); background: rgba(255, 255, 255, 0.045); }
      .tampermonkey-sync-chip.is-bullish { border-left-color: var(--green-bright); }
      .tampermonkey-sync-chip.is-bearish { border-left-color: var(--red-bright); }
      .tampermonkey-sync-chip.is-neutral { border-left-color: var(--amber-bright); }
      .tampermonkey-sync-chip-name { overflow: hidden; color: var(--text); font-size: 9px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
      .tampermonkey-sync-chip-value { overflow: hidden; color: var(--text-soft); font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
      .tampermonkey-sync-chip-meta { overflow: hidden; color: var(--faint); font-size: 7px; text-overflow: ellipsis; white-space: nowrap; }
      @media (max-width: 720px) {
        .tampermonkey-live-card .card-header { flex-direction: column; }
        .tampermonkey-live-card .card-header-meta { justify-content: flex-start; }
        .tampermonkey-sync-banner-actions { margin-left: 0; width: 100%; }
        .tampermonkey-sync-chip { flex-basis: 180px; }
      }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboardApp, { once: true });
  } else {
    initDashboardApp();
  }

})();

/* ============================================================================
   MÓDULO 6 V3.0: CALCULADORA ATR + ENTRADAS ESCALONADAS (EMA 20/50) + BITÁCORA
   - Calcula 3 órdenes escalonadas (40% / 35% / 25%) o una entrada única.
   - Extrae precio, EMA20, EMA50 y ATR(14) reales de Binance vía proxy local.
   - Stop Loss único anclado a E1, al promedio ponderado o a E3 / EMA 50.
   - Guarda planes en localStorage y sigue el PnL flotante en vivo.
   - Exporta la bitácora a CSV (Blob) compatible con Excel.
   ============================================================================ */
(function initAtrCalculatorStaggeredAndJournalV3() {
  'use strict';

  const oldBtn = document.getElementById('btn-open-risk-calc');
  const oldModal = document.getElementById('atr-risk-calculator-modal');
  const oldStyle = document.getElementById('atr-journal-module-styles');
  if (oldBtn) oldBtn.remove();
  if (oldModal) oldModal.remove();
  if (oldStyle) oldStyle.remove();

  const JOURNAL_KEY = 'crypto_swing_trading_journal_v1';
  let lastCalculatedTrade = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function priceDecimalsFor(price) {
    if (!Number.isFinite(price) || price <= 0) return 2;
    if (price < 0.001) return 8;
    if (price < 1) return 5;
    if (price < 10) return 4;
    return 2;
  }

  function formatCoins(value) {
    const coins = Number(value) || 0;
    if (coins >= 1000) return coins.toFixed(2);
    if (coins >= 1) return coins.toFixed(4);
    if (coins >= 0.01) return coins.toFixed(6);
    return coins.toFixed(8);
  }

  function csvCell(value) {
    return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  }

  function localDateStamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async function binanceJson(path, timeoutMs = 15000) {
    const target = `https://api.binance.com${path}`;
    const attempts = [];
    const local = typeof window.QuantLocalProxy === 'function' ? window.QuantLocalProxy(target) : null;
    if (local) attempts.push(local);
    attempts.push(target);
    if (window.QuantFetch && typeof window.QuantFetch.first === 'function') {
      return window.QuantFetch.first(attempts, { timeout: timeoutMs, cacheKey: `public ${target}` });
    }
    let lastError = null;
    for (const url of attempts) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'omit',
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
      } finally {
        window.clearTimeout(timer);
      }
    }
    throw lastError || new Error('Binance no respondió');
  }

  // El botón flotante no debe tapar los toasts ni la navegación móvil.
  const moduleStyle = document.createElement('style');
  moduleStyle.id = 'atr-journal-module-styles';
  moduleStyle.textContent = `
    #btn-open-risk-calc { transition: transform .15s ease, box-shadow .15s ease; }
    #btn-open-risk-calc:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(16,185,129,.5); }
    body:has(#btn-open-risk-calc) .toast-root { bottom: 74px; }
    @media (max-width: 1024px) {
      #btn-open-risk-calc { bottom: 82px !important; right: 12px !important; }
      body:has(#btn-open-risk-calc) .toast-root { bottom: 142px; }
    }
  `;
  document.head.appendChild(moduleStyle);

  // 1. Botón flotante principal
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'btn-open-risk-calc';
  toggleBtn.type = 'button';
  toggleBtn.setAttribute('aria-label', 'Abrir calculadora ATR con entradas escalonadas y bitácora');
  toggleBtn.style.cssText = 'position:fixed;bottom:15px;right:15px;z-index:999998;background:linear-gradient(135deg,#10b981,#059669);color:#000;font-weight:bold;border:none;padding:10px 16px;border-radius:8px;font-family:sans-serif;font-size:13px;cursor:pointer;box-shadow:0 6px 20px rgba(16,185,129,0.4);display:flex;align-items:center;gap:8px;';
  toggleBtn.innerHTML = '📐 Calculadora ATR (3 Órdenes) & Bitácora';
  document.body.appendChild(toggleBtn);

  // 2. Contenedor Modal
  const modal = document.createElement('div');
  modal.id = 'atr-risk-calculator-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('aria-label', 'Calculadora ATR con entradas escalonadas y bitácora');
  modal.style.cssText = 'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:999999;background:#0b0e14;border:2px solid #10b981;border-radius:12px;width:95%;max-width:940px;color:#f3f4f6;font-family:sans-serif;box-shadow:0 20px 60px rgba(0,0,0,0.95);padding:20px;max-height:93vh;overflow-y:auto;';

  const savedCap = Number(localStorage.getItem('user_trading_capital')) || 1000;
  const savedRisk = Number(localStorage.getItem('user_risk_percent')) || 1.5;

  modal.innerHTML = `
      <!-- Cabecera y Pestañas -->
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1f2937;padding-bottom:12px;margin-bottom:15px;flex-wrap:wrap;gap:10px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button id="tab-btn-calc" style="background:#10b981;color:#000;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:13px;">
                  📐 1. Calculadora ATR & 3 Entradas (EMA 20/50)
              </button>
              <button id="tab-btn-journal" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:13px;">
                  📓 2. Bitácora de Operaciones (<span id="journal-count-badge">0</span>)
              </button>
          </div>
          <button id="close-risk-calc" style="background:#1f2937;color:#9ca3af;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:bold;">✕ Cerrar</button>
      </div>

      <!-- ============================================================== -->
      <!-- PESTAÑA 1: CALCULADORA CON ENTRADAS ESCALONADAS                -->
      <!-- ============================================================== -->
      <div id="view-tab-calc">
          <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
              <span style="font-size:11px;color:#9ca3af;">Activos Swing:</span>
              <button class="quick-pair-btn" data-sym="SOL" style="background:#151924;color:#10b981;border:1px solid #10b981;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">SOL</button>
              <button class="quick-pair-btn" data-sym="SUI" style="background:#151924;color:#10b981;border:1px solid #10b981;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">SUI</button>
              <button class="quick-pair-btn" data-sym="XRP" style="background:#151924;color:#10b981;border:1px solid #10b981;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">XRP</button>
              <button class="quick-pair-btn" data-sym="BNB" style="background:#151924;color:#10b981;border:1px solid #10b981;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">BNB</button>
              <button class="quick-pair-btn" data-sym="BTC" style="background:#151924;color:#10b981;border:1px solid #10b981;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">BTC</button>
              <input id="rc-symbol" type="text" value="SOL" style="background:#151924;border:1px solid #374151;color:#fff;padding:5px 8px;border-radius:5px;width:70px;font-size:12px;text-transform:uppercase;font-weight:bold;" />
              <select id="rc-tf" style="background:#151924;border:1px solid #374151;color:#fff;padding:5px 8px;border-radius:5px;font-size:12px;">
                  <option value="4h" selected>Gráfico 4H (Swing)</option>
                  <option value="1d">Gráfico 1D (Posicional)</option>
                  <option value="1h">Gráfico 1H (Intradía)</option>
              </select>
              <button id="rc-fetch-btn" style="background:#2563eb;color:#fff;border:none;padding:6px 12px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">🔄 Extraer Precio, EMA 20/50 y ATR</button>
          </div>

          <!-- Parámetros Principales -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin-bottom:12px;background:#151924;padding:12px;border-radius:8px;border:1px solid #1f2937;">
              <div>
                  <label style="font-size:11px;color:#9ca3af;display:block;margin-bottom:3px;">Capital Cartera (USDT)</label>
                  <input id="rc-capital" type="number" step="any" value="${savedCap}" style="width:100%;box-sizing:border-box;background:#0b0e14;border:1px solid #374151;color:#fff;padding:6px;border-radius:5px;font-size:13px;font-weight:bold;" />
              </div>
              <div>
                  <label style="font-size:11px;color:#9ca3af;display:block;margin-bottom:3px;">Riesgo Total Trade (%)</label>
                  <input id="rc-risk-pct" type="number" step="0.1" value="${savedRisk}" style="width:100%;box-sizing:border-box;background:#0b0e14;border:1px solid #374151;color:#10b981;padding:6px;border-radius:5px;font-size:13px;font-weight:bold;" />
              </div>
              <div>
                  <label style="font-size:11px;color:#9ca3af;display:block;margin-bottom:3px;">Dirección</label>
                  <select id="rc-side" style="width:100%;box-sizing:border-box;background:#0b0e14;border:1px solid #374151;color:#fff;padding:6px;border-radius:5px;font-size:13px;font-weight:bold;">
                      <option value="LONG">🟢 LONG (Compra)</option>
                      <option value="SHORT">🔴 SHORT (Venta)</option>
                  </select>
              </div>
              <div>
                  <label style="font-size:11px;color:#9ca3af;display:block;margin-bottom:3px;">Modo de Ejecución</label>
                  <select id="rc-mode" style="width:100%;box-sizing:border-box;background:#0b0e14;border:1px solid #10b981;color:#10b981;padding:6px;border-radius:5px;font-size:12px;font-weight:bold;">
                      <option value="STAGGERED" selected>📊 3 Órdenes Escalonadas</option>
                      <option value="SINGLE">🎯 1 Entrada Única</option>
                  </select>
              </div>
              <div>
                  <label style="font-size:11px;color:#9ca3af;display:block;margin-bottom:3px;">ATR (14) Actual ($)</label>
                  <input id="rc-atr" type="number" step="any" style="width:100%;box-sizing:border-box;background:#0b0e14;border:1px solid #374151;color:#f59e0b;padding:6px;border-radius:5px;font-size:13px;" />
              </div>
              <div>
                  <label style="font-size:11px;color:#9ca3af;display:block;margin-bottom:3px;">Colchón SL por ATR</label>
                  <select id="rc-atr-mult" style="width:100%;box-sizing:border-box;background:#0b0e14;border:1px solid #374151;color:#fff;padding:6px;border-radius:5px;font-size:12px;">
                      <option value="1.0">1.0x ATR (Ajustado)</option>
                      <option value="1.5" selected>1.5x ATR (Estándar Swing)</option>
                      <option value="2.0">2.0x ATR (Anti-Mechas)</option>
                  </select>
              </div>
              <div>
                  <label style="font-size:11px;color:#9ca3af;display:block;margin-bottom:3px;">Anclaje del Stop Loss</label>
                  <select id="rc-sl-anchor" style="width:100%;box-sizing:border-box;background:#0b0e14;border:1px solid #374151;color:#60a5fa;padding:6px;border-radius:5px;font-size:11px;">
                      <option value="E3" selected>Bajo Entrada 3 / EMA 50 (Seguro)</option>
                      <option value="AVG">Bajo Precio Promedio Ponderado</option>
                      <option value="E1">Bajo Entrada 1 (Actual)</option>
                  </select>
              </div>
              <div>
                  <label style="font-size:11px;color:#9ca3af;display:block;margin-bottom:3px;">Ratio R:R / Margen Máx %</label>
                  <div style="display:flex;gap:4px;">
                      <select id="rc-rr" style="width:55%;background:#0b0e14;border:1px solid #374151;color:#fff;padding:6px 4px;border-radius:5px;font-size:11px;">
                          <option value="1.5">1:1.5</option>
                          <option value="2.0" selected>1:2.0</option>
                          <option value="3.0">1:3.0</option>
                      </select>
                      <input id="rc-margin-pct" type="number" value="15" title="% Margen Máximo" style="width:45%;background:#0b0e14;border:1px solid #374151;color:#fff;padding:6px;border-radius:5px;font-size:12px;" />
                  </div>
              </div>
          </div>
          <!-- Panel de Configuración de las 3 Entradas Escalonadas (Actual / EMA 20 / EMA 50) -->
          <div id="staggered-inputs-box" style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:12px;margin-bottom:12px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
                  <span id="staggered-title" style="font-size:12px;font-weight:bold;color:#10b981;">⚡ Configuración de las 3 Órdenes Límite Escalonadas (Auto-calculadas con EMAs en vivo)</span>
                  <button id="btn-reset-weights" style="background:#1f2937;color:#9ca3af;border:1px solid #374151;padding:3px 8px;border-radius:4px;font-size:10px;cursor:pointer;">Restaurar 40% / 35% / 25%</button>
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;">
                  <!-- Orden 1 -->
                  <div style="background:#151924;padding:8px 10px;border-radius:6px;border-left:3px solid #3b82f6;">
                      <div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-bottom:4px;">
                          <span><strong>Orden 1:</strong> Precio Actual / Mercado</span>
                          <span style="color:#60a5fa;">Peso %</span>
                      </div>
                      <div style="display:flex;gap:6px;">
                          <input id="rc-entry" type="number" step="any" placeholder="Precio 1" style="width:68%;background:#0b0e14;border:1px solid #374151;color:#fff;padding:5px;border-radius:4px;font-size:12px;font-weight:bold;" />
                          <input id="rc-w1" type="number" step="1" value="40" style="width:32%;background:#0b0e14;border:1px solid #3b82f6;color:#60a5fa;padding:5px;border-radius:4px;font-size:12px;font-weight:bold;text-align:center;" />
                      </div>
                  </div>
                  <!-- Orden 2 -->
                  <div id="rc-order-2-card" style="background:#151924;padding:8px 10px;border-radius:6px;border-left:3px solid #f59e0b;">
                      <div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-bottom:4px;">
                          <span><strong>Orden 2:</strong> Retroceso EMA 20 <span id="lbl-ema20" style="color:#f59e0b;"></span></span>
                          <span style="color:#f59e0b;">Peso %</span>
                      </div>
                      <div style="display:flex;gap:6px;">
                          <input id="rc-entry-2" type="number" step="any" placeholder="Precio EMA 20" style="width:68%;background:#0b0e14;border:1px solid #374151;color:#fff;padding:5px;border-radius:4px;font-size:12px;font-weight:bold;" />
                          <input id="rc-w2" type="number" step="1" value="35" style="width:32%;background:#0b0e14;border:1px solid #f59e0b;color:#f59e0b;padding:5px;border-radius:4px;font-size:12px;font-weight:bold;text-align:center;" />
                      </div>
                  </div>
                  <!-- Orden 3 -->
                  <div id="rc-order-3-card" style="background:#151924;padding:8px 10px;border-radius:6px;border-left:3px solid #8b5cf6;">
                      <div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-bottom:4px;">
                          <span><strong>Orden 3:</strong> Retroceso EMA 50 <span id="lbl-ema50" style="color:#a78bfa;"></span></span>
                          <span style="color:#a78bfa;">Peso %</span>
                      </div>
                      <div style="display:flex;gap:6px;">
                          <input id="rc-entry-3" type="number" step="any" placeholder="Precio EMA 50" style="width:68%;background:#0b0e14;border:1px solid #374151;color:#fff;padding:5px;border-radius:4px;font-size:12px;font-weight:bold;" />
                          <input id="rc-w3" type="number" step="1" value="25" style="width:32%;background:#0b0e14;border:1px solid #8b5cf6;color:#a78bfa;padding:5px;border-radius:4px;font-size:12px;font-weight:bold;text-align:center;" />
                      </div>
                  </div>
              </div>
          </div>

          <!-- Resultados y Tabla de Desglose de las 3 Órdenes -->
          <div id="rc-results-box" style="background:#111827;border:1px solid #374151;border-radius:8px;padding:14px;margin-bottom:12px;">
              Calculando estructura de órdenes escalonadas...
          </div>

          <!-- Guardar en Bitácora -->
          <div style="display:flex;gap:10px;align-items:center;background:#151924;padding:10px 14px;border-radius:8px;border:1px solid #10b981;flex-wrap:wrap;">
              <input id="rc-trade-notes" type="text" placeholder="Nota (ej: Escalonado 40/35/25 en EMA 20 y EMA 50 de 4H + SL bajo EMA 50)..." style="flex:1;min-width:240px;background:#0b0e14;border:1px solid #374151;color:#fff;padding:8px 10px;border-radius:6px;font-size:12px;" />
              <button id="btn-save-to-journal" style="background:#10b981;color:#000;font-weight:bold;border:none;padding:9px 16px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;">
                  💾 Guardar Plan en Bitácora
              </button>
              <button id="btn-draw-atr-on-quant" style="background:#2563eb;color:#fff;font-weight:bold;border:none;padding:9px 16px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;">
                  📈 Dibujar en gráfico cuantitativo
              </button>
              <span id="rc-save-status" style="font-size:11px;color:#9ca3af;min-height:14px;"></span>
          </div>
      </div>

      <!-- ============================================================== -->
      <!-- PESTAÑA 2: BITÁCORA DE OPERACIONES Y MÉTRICAS DE RENDIMIENTO   -->
      <!-- ============================================================== -->
      <div id="view-tab-journal" style="display:none;">
          <div id="journal-stats-bar" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:15px;"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
              <span style="font-size:12px;color:#9ca3af;">Seguimiento en vivo contra el precio spot actual de Binance.</span>
              <div style="display:flex;gap:8px;">
                  <button id="btn-refresh-journal-pnl" style="background:#2563eb;color:#fff;border:none;padding:6px 12px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">🔄 Actualizar PnL en Vivo</button>
                  <button id="btn-export-journal-csv" style="background:#1f2937;color:#10b981;border:1px solid #10b981;padding:6px 12px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">📥 Exportar Excel (CSV)</button>
              </div>
          </div>
          <div style="overflow-x:auto;border:1px solid #1f2937;border-radius:8px;">
              <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
                  <thead>
                      <tr style="background:#151924;color:#9ca3af;border-bottom:1px solid #1f2937;">
                          <th style="padding:10px;">Fecha / Par</th>
                          <th style="padding:10px;">Lado / Lev</th>
                          <th style="padding:10px;">Entrada Promedio / Actual</th>
                          <th style="padding:10px;">SL / TP</th>
                          <th style="padding:10px;">Tamaño Total</th>
                          <th style="padding:10px;">PnL ($) / Estado</th>
                          <th style="padding:10px;">Acciones</th>
                      </tr>
                  </thead>
                  <tbody id="journal-table-body"></tbody>
              </table>
          </div>
      </div>
  `;
  document.body.appendChild(modal);

  function setModalOpen(open) {
    modal.style.display = open ? 'block' : 'none';
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function isModalOpen() {
    return modal.style.display !== 'none';
  }

  // 3. Funciones Matemáticas para EMA(20), EMA(50) y ATR(14)
  function computeEMA(closes, period) {
    if (closes.length < period) return closes[closes.length - 1];
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i += 1) {
      ema = (closes[i] * k) + (ema * (1 - k));
    }
    return ema;
  }

  async function fetchBinanceAtrAndEmas() {
    const symInput = document.getElementById('rc-symbol');
    const tf = document.getElementById('rc-tf').value;
    const side = document.getElementById('rc-side').value;
    const fetchBtn = document.getElementById('rc-fetch-btn');
    const resultsBox = document.getElementById('rc-results-box');
    const cleanSym = symInput.value.trim().toUpperCase().replace(/USDT$/, '').replace(/[^A-Z0-9]/g, '');
    symInput.value = cleanSym;

    if (!cleanSym) {
      resultsBox.innerHTML = '<div style="color:#f59e0b;font-size:12px;">Escribe un símbolo válido, por ejemplo SOL, SUI, XRP, BNB o BTC.</div>';
      return;
    }

    const previousText = fetchBtn.textContent;
    fetchBtn.disabled = true;
    fetchBtn.textContent = '⏳ Consultando…';
    resultsBox.innerHTML = '<div style="color:#9ca3af;font-size:12px;">Consultando velas, EMA 20/50 y ATR(14) en Binance…</div>';

    try {
      const klines = await binanceJson(
        `/api/v3/klines?symbol=${encodeURIComponent(cleanSym + 'USDT')}&interval=${encodeURIComponent(tf)}&limit=120`,
        20000
      );

      if (!Array.isArray(klines) || klines.length < 55) {
        throw new Error('Binance no devolvió suficientes velas (mínimo 55).');
      }

      const closes = klines.map((k) => parseFloat(k[4]));
      const lastClose = closes[closes.length - 1];
      const ema20 = computeEMA(closes, 20);
      const ema50 = computeEMA(closes, 50);
      const decimals = priceDecimalsFor(lastClose);

      let trSum = 0;
      for (let i = klines.length - 14; i < klines.length; i += 1) {
        const high = parseFloat(klines[i][2]);
        const low = parseFloat(klines[i][3]);
        const prevClose = parseFloat(klines[i - 1][4]);
        trSum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      }
      const atr14 = trSum / 14;

      document.getElementById('rc-entry').value = lastClose.toFixed(decimals);
      document.getElementById('rc-atr').value = atr14.toPrecision(4);
      document.getElementById('lbl-ema20').innerText = `($${ema20.toFixed(decimals)})`;
      document.getElementById('lbl-ema50').innerText = `($${ema50.toFixed(decimals)})`;

      // Si el precio ya rompió las EMAs, sugiere escalonado por ATR (-0.75x y -1.5x).
      let p2 = ema20;
      let p3 = ema50;
      if (side === 'LONG') {
        if (p2 >= lastClose) p2 = lastClose - (0.75 * atr14);
        if (p3 >= p2) p3 = lastClose - (1.5 * atr14);
      } else {
        if (p2 <= lastClose) p2 = lastClose + (0.75 * atr14);
        if (p3 <= p2) p3 = lastClose + (1.5 * atr14);
      }

      document.getElementById('rc-entry-2').value = p2.toFixed(decimals);
      document.getElementById('rc-entry-3').value = p3.toFixed(decimals);

      recalculatePosition();
    } catch (error) {
      console.error('Error al extraer EMAs y ATR de Binance:', error);
      resultsBox.innerHTML = `<div style="color:#f59e0b;font-size:12px;">No se pudo consultar Binance para ${escapeHtml(cleanSym)}USDT (${escapeHtml(tf)}). Revisa el símbolo o reintenta en unos segundos.</div>`;
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = previousText;
    }
  }
  // 4. Motor de Cálculo Escalonado (40% / 35% / 25%) con Stop Loss único por ATR
  function recalculatePosition() {
    const capital = parseFloat(document.getElementById('rc-capital').value) || 0;
    const riskPct = parseFloat(document.getElementById('rc-risk-pct').value) || 0;
    const side = document.getElementById('rc-side').value;
    const mode = document.getElementById('rc-mode').value;
    const atr = parseFloat(document.getElementById('rc-atr').value) || 0;
    const atrMult = parseFloat(document.getElementById('rc-atr-mult').value) || 1.5;
    const slAnchor = document.getElementById('rc-sl-anchor').value;
    const rr = parseFloat(document.getElementById('rc-rr').value) || 2.0;
    const maxMarginPct = parseFloat(document.getElementById('rc-margin-pct').value) || 15;
    const sym = document.getElementById('rc-symbol').value.trim().toUpperCase();
    const tf = document.getElementById('rc-tf').value.toUpperCase();
    const resultsBox = document.getElementById('rc-results-box');
    const statusEl = document.getElementById('rc-save-status');
    if (statusEl) statusEl.innerHTML = '';

    const isStaggered = mode === 'STAGGERED';
    const order2Card = document.getElementById('rc-order-2-card');
    const order3Card = document.getElementById('rc-order-3-card');
    const resetBtn = document.getElementById('btn-reset-weights');
    const staggeredTitle = document.getElementById('staggered-title');
    if (order2Card) order2Card.style.display = isStaggered ? '' : 'none';
    if (order3Card) order3Card.style.display = isStaggered ? '' : 'none';
    if (resetBtn) resetBtn.style.display = isStaggered ? '' : 'none';
    if (staggeredTitle) {
      staggeredTitle.textContent = isStaggered
        ? '⚡ Configuración de las 3 Órdenes Límite Escalonadas (Auto-calculadas con EMAs en vivo)'
        : '🎯 Modo Entrada Única: usa el precio de la Orden 1 (EMA 20/50 no se usan)';
    }

    const p1 = parseFloat(document.getElementById('rc-entry').value) || 0;
    const p2 = isStaggered ? (parseFloat(document.getElementById('rc-entry-2').value) || p1) : p1;
    const p3 = isStaggered ? (parseFloat(document.getElementById('rc-entry-3').value) || p1) : p1;

    const w1 = isStaggered ? (parseFloat(document.getElementById('rc-w1').value) || 0) : 100;
    const w2 = isStaggered ? (parseFloat(document.getElementById('rc-w2').value) || 0) : 0;
    const w3 = isStaggered ? (parseFloat(document.getElementById('rc-w3').value) || 0) : 0;

    const wSum = w1 + w2 + w3;
    if (wSum <= 0 || capital <= 0 || p1 <= 0 || atr <= 0) {
      lastCalculatedTrade = null;
      resultsBox.innerHTML = '<div style="color:#9ca3af;font-size:12px;">Completa capital, riesgo, precio de entrada y ATR (o pulsa “🔄 Extraer Precio, EMA 20/50 y ATR”) para calcular el plan.</div>';
      return;
    }

    const n1 = w1 / wSum;
    const n2 = w2 / wSum;
    const n3 = w3 / wSum;

    localStorage.setItem('user_trading_capital', capital);
    localStorage.setItem('user_risk_percent', riskPct);

    const riskUSD = capital * (riskPct / 100);
    const slPaddingUSD = atr * atrMult;
    const decimals = priceDecimalsFor(p1);

    // Precio promedio ponderado exacto cuando se llenan las 3 órdenes por capital USDT:
    // Total_Coins = U * (n1/p1 + n2/p2 + n3/p3) => Avg_Entry = 1 / (n1/p1 + n2/p2 + n3/p3)
    const coinsPerDollar = (n1 / p1) + (n2 / p2) + (n3 / p3);
    const avgEntryPrice = 1 / coinsPerDollar;

    // Punto base desde el que se mide el único Stop Loss por ATR.
    let baseAnchorPrice = p3;
    if (mode === 'SINGLE' || slAnchor === 'E1') baseAnchorPrice = p1;
    else if (slAnchor === 'AVG') baseAnchorPrice = avgEntryPrice;
    else baseAnchorPrice = side === 'LONG' ? Math.min(p1, p2, p3) : Math.max(p1, p2, p3);

    const stopLossPrice = side === 'LONG' ? (baseAnchorPrice - slPaddingUSD) : (baseAnchorPrice + slPaddingUSD);
    const slDistanceSigned = side === 'LONG' ? (avgEntryPrice - stopLossPrice) : (stopLossPrice - avgEntryPrice);

    if (!Number.isFinite(slDistanceSigned) || slDistanceSigned <= 0) {
      lastCalculatedTrade = null;
      resultsBox.innerHTML = `<div style="color:#f59e0b;font-size:12px;">El Stop Loss calculado ($${stopLossPrice.toFixed(decimals)}) queda en el lado incorrecto del precio promedio ($${avgEntryPrice.toFixed(decimals)}). Cambia el anclaje del SL (E3/EMA 50 o AVG) o revisa los precios de entrada.</div>`;
      return;
    }

    const avgSlDistanceUSD = slDistanceSigned;
    const avgSlDistancePct = avgSlDistanceUSD / avgEntryPrice;
    const totalCoins = riskUSD / avgSlDistanceUSD;
    const totalPositionUSDT = totalCoins * avgEntryPrice;

    const takeProfitPrice = side === 'LONG'
      ? (avgEntryPrice + (avgSlDistanceUSD * rr))
      : (avgEntryPrice - (avgSlDistanceUSD * rr));
    const expectedProfitUSD = riskUSD * rr;

    // Apalancamiento y Margen
    const desiredMarginUSDT = capital * (maxMarginPct / 100);
    let optimalLeverage = desiredMarginUSDT > 0 ? Math.ceil(totalPositionUSDT / desiredMarginUSDT) : 1;
    if (optimalLeverage < 1) optimalLeverage = 1;
    const actualMarginUsed = totalPositionUSDT / optimalLeverage;

    // Desglose exacto de las 3 órdenes límite
    const ord1USDT = totalPositionUSDT * n1;
    const ord1Coins = ord1USDT / p1;
    const ord1Margin = ord1USDT / optimalLeverage;
    const ord2USDT = totalPositionUSDT * n2;
    const ord2Coins = ord2USDT / p2;
    const ord2Margin = ord2USDT / optimalLeverage;
    const ord3USDT = totalPositionUSDT * n3;
    const ord3Coins = ord3USDT / p3;
    const ord3Margin = ord3USDT / optimalLeverage;

    // ¿Cuánto arriesgas si SOLO se llena la Orden 1 y el mercado va al SL?
    const riskIfOnlyOrd1 = Math.abs(p1 - stopLossPrice) * ord1Coins;
    const coinsDecimals = totalCoins >= 1000 ? 2 : (totalCoins >= 1 ? 4 : (totalCoins >= 0.01 ? 6 : 8));
    const anchorLabel = mode === 'SINGLE' ? 'Entrada única' : (slAnchor === 'AVG' ? 'Promedio' : (slAnchor === 'E1' ? 'Entrada 1' : 'Entrada 3 / EMA 50'));
    const staggeredPlan = isStaggered
      ? `E1:$${p1.toFixed(decimals)}(${(n1 * 100).toFixed(0)}%) | E2:$${p2.toFixed(decimals)}(${(n2 * 100).toFixed(0)}%) | E3:$${p3.toFixed(decimals)}(${(n3 * 100).toFixed(0)}%)`
      : 'Entrada Única';

    const signature = [
      sym, tf, side, mode,
      p1.toFixed(decimals), p2.toFixed(decimals), p3.toFixed(decimals),
      n1.toFixed(4), n2.toFixed(4), n3.toFixed(4),
      String(atrMult), slAnchor, String(rr),
      stopLossPrice.toFixed(decimals), takeProfitPrice.toFixed(decimals),
      totalPositionUSDT.toFixed(2)
    ].join('|');

    lastCalculatedTrade = {
      id: 'TRD_' + Date.now(),
      date: new Date().toLocaleString(),
      symbol: sym,
      timeframe: tf,
      side: side,
      mode: mode,
      slAnchor: slAnchor,
      entryPrice: Number(avgEntryPrice.toFixed(decimals)),
      entry1: Number(p1.toFixed(decimals)),
      entry2: Number(p2.toFixed(decimals)),
      entry3: Number(p3.toFixed(decimals)),
      weights: { e1: n1, e2: n2, e3: n3 },
      stopLoss: Number(stopLossPrice.toFixed(decimals)),
      takeProfit: Number(takeProfitPrice.toFixed(decimals)),
      positionUSDT: Number(totalPositionUSDT.toFixed(2)),
      positionCoins: Number(totalCoins.toFixed(coinsDecimals)),
      leverage: optimalLeverage,
      marginUsed: Number(actualMarginUsed.toFixed(2)),
      riskUSD: Number(riskUSD.toFixed(2)),
      expectedProfitUSD: Number(expectedProfitUSD.toFixed(2)),
      rr: rr,
      status: 'OPEN',
      realizedPnL: 0,
      staggeredPlan: staggeredPlan,
      signature: signature
    };

    const levColor = optimalLeverage <= 5 ? '#10b981' : (optimalLeverage <= 10 ? '#f59e0b' : '#ef4444');
    const safeSym = escapeHtml(sym);
    const safeTf = escapeHtml(tf);
    const ordersTableHtml = isStaggered ? `
        <div style="margin-top:12px;border-top:1px solid #1f2937;padding-top:10px;">
            <div style="font-size:12px;font-weight:bold;color:#f3f4f6;margin-bottom:8px;">
                📋 Hoja de Ruta para Colocar tus 3 Órdenes en el Exchange (Mismo Stop Loss Único: <span style="color:#ef4444;">$${stopLossPrice.toFixed(decimals)}</span>)
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:11px;text-align:left;background:#0b0e14;border-radius:6px;overflow:hidden;">
                    <thead>
                        <tr style="background:#151924;color:#9ca3af;border-bottom:1px solid #1f2937;">
                            <th style="padding:8px;">Tramo / Nivel</th>
                            <th style="padding:8px;">Peso (%)</th>
                            <th style="padding:8px;">Precio Límite</th>
                            <th style="padding:8px;">Tamaño Orden (USDT)</th>
                            <th style="padding:8px;">Cantidad (${safeSym})</th>
                            <th style="padding:8px;">Margen Requerido (${optimalLeverage}x)</th>
                            <th style="padding:8px;">Stop Loss Único</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom:1px solid #1f2937;">
                            <td style="padding:8px;color:#60a5fa;font-weight:bold;">1️⃣ Entrada Actual</td>
                            <td style="padding:8px;">${(n1 * 100).toFixed(1)}%</td>
                            <td style="padding:8px;font-weight:bold;color:#fff;">$${p1.toFixed(decimals)}</td>
                            <td style="padding:8px;font-weight:bold;color:#fff;">$${ord1USDT.toFixed(2)} USDT</td>
                            <td style="padding:8px;color:#60a5fa;">${formatCoins(ord1Coins)} ${safeSym}</td>
                            <td style="padding:8px;">$${ord1Margin.toFixed(2)}</td>
                            <td style="padding:8px;color:#ef4444;font-weight:bold;">$${stopLossPrice.toFixed(decimals)}</td>
                        </tr>
                        <tr style="border-bottom:1px solid #1f2937;">
                            <td style="padding:8px;color:#f59e0b;font-weight:bold;">2️⃣ Límite EMA 20</td>
                            <td style="padding:8px;">${(n2 * 100).toFixed(1)}%</td>
                            <td style="padding:8px;font-weight:bold;color:#fff;">$${p2.toFixed(decimals)}</td>
                            <td style="padding:8px;font-weight:bold;color:#fff;">$${ord2USDT.toFixed(2)} USDT</td>
                            <td style="padding:8px;color:#f59e0b;">${formatCoins(ord2Coins)} ${safeSym}</td>
                            <td style="padding:8px;">$${ord2Margin.toFixed(2)}</td>
                            <td style="padding:8px;color:#ef4444;font-weight:bold;">$${stopLossPrice.toFixed(decimals)}</td>
                        </tr>
                        <tr>
                            <td style="padding:8px;color:#a78bfa;font-weight:bold;">3️⃣ Límite EMA 50</td>
                            <td style="padding:8px;">${(n3 * 100).toFixed(1)}%</td>
                            <td style="padding:8px;font-weight:bold;color:#fff;">$${p3.toFixed(decimals)}</td>
                            <td style="padding:8px;font-weight:bold;color:#fff;">$${ord3USDT.toFixed(2)} USDT</td>
                            <td style="padding:8px;color:#a78bfa;">${formatCoins(ord3Coins)} ${safeSym}</td>
                            <td style="padding:8px;">$${ord3Margin.toFixed(2)}</td>
                            <td style="padding:8px;color:#ef4444;font-weight:bold;">$${stopLossPrice.toFixed(decimals)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div style="margin-top:8px;font-size:11px;color:#9ca3af;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">
                <span>🎯 <strong>Precio Promedio Ponderado Final (si llenan las 3):</strong> <strong style="color:#10b981;">$${avgEntryPrice.toFixed(decimals)}</strong></span>
                <span>🛡️ <strong>Riesgo si solo llena la Orden 1 y toca SL:</strong> -$${riskIfOnlyOrd1.toFixed(2)} | <strong>Riesgo si llenan las 3 y toca SL:</strong> <strong style="color:#ef4444;">-$${riskUSD.toFixed(2)} (${riskPct}%)</strong></span>
            </div>
        </div>
    ` : '';

    resultsBox.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px;">
            <div style="background:#1f2937;padding:10px;border-radius:6px;border-left:4px solid #3b82f6;">
                <div style="font-size:11px;color:#9ca3af;">Posición Total Combinada</div>
                <div style="font-size:17px;font-weight:bold;color:#fff;">$${totalPositionUSDT.toFixed(2)} USDT</div>
                <div style="font-size:11px;color:#60a5fa;">${formatCoins(totalCoins)} ${safeSym} @ Prom: $${avgEntryPrice.toFixed(decimals)}</div>
            </div>
            <div style="background:#1f2937;padding:10px;border-radius:6px;border-left:4px solid ${levColor};">
                <div style="font-size:11px;color:#9ca3af;">Apalancamiento & Margen Total</div>
                <div style="font-size:17px;font-weight:bold;color:${levColor};">${optimalLeverage}x (Margen: $${actualMarginUsed.toFixed(2)})</div>
                <div style="font-size:10px;color:#d1d5db;">Margen Aislado Recomendado</div>
            </div>
            <div style="background:#1f2937;padding:10px;border-radius:6px;border-left:4px solid #ef4444;">
                <div style="font-size:11px;color:#9ca3af;">Stop Loss Único (${anchorLabel}, -${(avgSlDistancePct * 100).toFixed(2)}% desde Prom)</div>
                <div style="font-size:17px;font-weight:bold;color:#ef4444;">$${stopLossPrice.toFixed(decimals)}</div>
                <div style="font-size:11px;color:#fca5a5;">Pérdida máx. total: -$${riskUSD.toFixed(2)} (${riskPct}%)</div>
            </div>
            <div style="background:#1f2937;padding:10px;border-radius:6px;border-left:4px solid #10b981;">
                <div style="font-size:11px;color:#9ca3af;">Take Profit Global (R:R 1:${rr})</div>
                <div style="font-size:17px;font-weight:bold;color:#10b981;">$${takeProfitPrice.toFixed(decimals)}</div>
                <div style="font-size:11px;color:#6ee7b7;">Ganancia objetivo: +$${expectedProfitUSD.toFixed(2)}</div>
            </div>
        </div>
        ${ordersTableHtml}
    `;
  }
  // 5. Lógica de Pestañas y Bitácora (Journal)
  const tabCalcBtn = document.getElementById('tab-btn-calc');
  const tabJournalBtn = document.getElementById('tab-btn-journal');
  const viewCalc = document.getElementById('view-tab-calc');
  const viewJournal = document.getElementById('view-tab-journal');

  function switchTab(tab) {
    if (tab === 'calc') {
      viewCalc.style.display = 'block';
      viewJournal.style.display = 'none';
      tabCalcBtn.style.background = '#10b981';
      tabCalcBtn.style.color = '#000';
      tabJournalBtn.style.background = '#1f2937';
      tabJournalBtn.style.color = '#d1d5db';
    } else {
      viewCalc.style.display = 'none';
      viewJournal.style.display = 'block';
      tabJournalBtn.style.background = '#10b981';
      tabJournalBtn.style.color = '#000';
      tabCalcBtn.style.background = '#1f2937';
      tabCalcBtn.style.color = '#d1d5db';
      renderJournalTableAndLivePnL();
    }
  }

  tabCalcBtn.onclick = () => switchTab('calc');
  tabJournalBtn.onclick = () => switchTab('journal');

  function getJournalTrades() {
    try {
      const parsed = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function saveJournalTrades(trades) {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(trades));
    const badge = document.getElementById('journal-count-badge');
    if (badge) badge.innerText = trades.length;
  }

  document.getElementById('btn-save-to-journal').onclick = () => {
    const statusEl = document.getElementById('rc-save-status');
    if (!lastCalculatedTrade) {
      if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b;">⚠️ Calcula primero un plan válido.</span>';
      return;
    }

    const notesInput = document.getElementById('rc-trade-notes').value.trim();
    const planText = lastCalculatedTrade.staggeredPlan || 'Entrada Única';
    const combinedNotes = notesInput ? `${notesInput} [${planText}]` : planText;
    const trades = getJournalTrades();
    const signature = lastCalculatedTrade.signature;

    if (signature && trades.some((t) => t.status === 'OPEN' && t.signature === signature)) {
      if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b;">⚠️ Ya existe una operación abierta con este mismo plan.</span>';
      return;
    }

    trades.unshift({ ...lastCalculatedTrade, id: 'TRD_' + Date.now(), notes: combinedNotes });
    saveJournalTrades(trades);
    document.getElementById('rc-trade-notes').value = '';
    if (statusEl) statusEl.innerHTML = '<span style="color:#10b981;">✅ Plan guardado en la bitácora.</span>';
    switchTab('journal');
  };

  window.getAtrTradePlan = () => (lastCalculatedTrade ? JSON.parse(JSON.stringify(lastCalculatedTrade)) : null);

  document.getElementById('btn-draw-atr-on-quant').onclick = () => {
    const statusEl = document.getElementById('rc-save-status');
    if (!lastCalculatedTrade) {
      if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b;">⚠️ Calcula primero un plan válido.</span>';
      return;
    }
    if (typeof window.tcsOpenQuantWithPlan !== 'function') {
      if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;">El laboratorio cuantitativo aún no está disponible.</span>';
      return;
    }
    const plan = {
      ...lastCalculatedTrade,
      entry1: lastCalculatedTrade.entry1,
      entry2: lastCalculatedTrade.entry2,
      entry3: lastCalculatedTrade.entry3,
      weights: lastCalculatedTrade.weights ? { ...lastCalculatedTrade.weights } : null
    };
    const ok = window.tcsOpenQuantWithPlan(plan);
    if (ok) {
      if (statusEl) statusEl.innerHTML = '<span style="color:#10b981;">✅ Plan enviado al gráfico cuantitativo.</span>';
      setModalOpen(false);
    } else if (statusEl) {
      statusEl.innerHTML = '<span style="color:#f59e0b;">No se pudo abrir el gráfico cuantitativo.</span>';
    }
  };

  async function renderJournalTableAndLivePnL() {
    const trades = getJournalTrades();
    const badge = document.getElementById('journal-count-badge');
    if (badge) badge.innerText = trades.length;
    const tbody = document.getElementById('journal-table-body');
    const statsBar = document.getElementById('journal-stats-bar');

    let livePrices = {};
    try {
      const allPrices = await binanceJson('/api/v3/ticker/price', 15000);
      if (Array.isArray(allPrices)) {
        allPrices.forEach((p) => { livePrices[p.symbol] = parseFloat(p.price); });
      }
    } catch (error) {
      console.warn('[Journal] No se pudo actualizar el PnL en vivo:', error);
    }

    const closedTrades = trades.filter((t) => t.status !== 'OPEN');
    const wins = closedTrades.filter((t) => t.realizedPnL > 0);
    const losses = closedTrades.filter((t) => t.realizedPnL < 0);
    const winRate = closedTrades.length > 0 ? ((wins.length / closedTrades.length) * 100).toFixed(1) : '0.0';
    const grossProfit = wins.reduce((acc, t) => acc + t.realizedPnL, 0);
    const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.realizedPnL, 0));
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? '∞' : '0.00');
    const netRealizedPnL = grossProfit - grossLoss;
    let floatingPnLTotal = 0;

    if (trades.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:#9ca3af;">No hay operaciones guardadas aún. Calcula un plan en la Pestaña 1 y pulsa "💾 Guardar Plan en Bitácora".</td></tr>';
    } else {
      tbody.innerHTML = trades.map((t) => {
        const entryPrice = Number(t.entryPrice) || 0;
        const decimals = priceDecimalsFor(entryPrice);
        const livePrice = Number.isFinite(livePrices[t.symbol + 'USDT']) ? livePrices[t.symbol + 'USDT'] : entryPrice;
        const positionCoins = Number(t.positionCoins) || 0;
        const marginUsed = Number(t.marginUsed) || 0;
        const safeId = String(t.id || '').replace(/[^A-Za-z0-9_-]/g, '');
        let pnlDisplay = '';
        let actionButtons = '';
        let priceLine = '';

        if (t.status === 'OPEN') {
          const priceDiff = t.side === 'LONG' ? (livePrice - entryPrice) : (entryPrice - livePrice);
          const floatingUSD = priceDiff * positionCoins;
          const floatingROE = marginUsed > 0 ? (floatingUSD / marginUsed) * 100 : 0;
          floatingPnLTotal += floatingUSD;
          const pnlColor = floatingUSD >= 0 ? '#10b981' : '#ef4444';

          priceLine = `Act: $${livePrice.toFixed(decimals)}`;
          pnlDisplay = `
              <div style="color:${pnlColor};font-weight:bold;">${floatingUSD >= 0 ? '+' : ''}$${floatingUSD.toFixed(2)} USDT</div>
              <div style="font-size:10px;color:#9ca3af;">ROE: ${floatingROE >= 0 ? '+' : ''}${floatingROE.toFixed(1)}%</div>
          `;
          actionButtons = `
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                  <button onclick="window.closeJournalTrade('${safeId}', 'TP')" style="background:#065f46;color:#fff;border:none;padding:4px 7px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:bold;">✅ TP</button>
                  <button onclick="window.closeJournalTrade('${safeId}', 'SL')" style="background:#7f1d1d;color:#fff;border:none;padding:4px 7px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:bold;">❌ SL</button>
                  <button onclick="window.closeJournalTrade('${safeId}', 'LIVE', ${floatingUSD.toFixed(2)})" style="background:#374151;color:#fff;border:none;padding:4px 7px;border-radius:4px;cursor:pointer;font-size:10px;">🖐️ Cerrar</button>
                  <button onclick="window.deleteJournalTrade('${safeId}')" style="background:transparent;color:#9ca3af;border:1px solid #374151;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:10px;">🗑️</button>
              </div>
          `;
        } else {
          const realized = Number(t.realizedPnL) || 0;
          const isWin = realized >= 0;
          const color = isWin ? '#10b981' : '#ef4444';
          const exitDisplay = Number.isFinite(Number(t.exitPrice)) ? Number(t.exitPrice) : livePrice;

          priceLine = `Sal: $${exitDisplay.toFixed(decimals)}`;
          pnlDisplay = `
              <div style="color:${color};font-weight:bold;">${isWin ? '+' : ''}$${realized.toFixed(2)} USDT</div>
              <span style="font-size:10px;background:${isWin ? '#064e3b' : '#7f1d1d'};color:#fff;padding:1px 6px;border-radius:3px;">CERRADA (${escapeHtml(t.status)})</span>
          `;
          actionButtons = `
              <button onclick="window.deleteJournalTrade('${safeId}')" style="background:#1f2937;color:#9ca3af;border:1px solid #374151;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:10px;">🗑️ Eliminar</button>
          `;
        }

        return `
            <tr style="border-bottom:1px solid #1f2937;background:${t.status === 'OPEN' ? '#111827' : '#0b0e14'};">
                <td style="padding:10px;">
                    <div style="font-weight:bold;color:#fff;">${escapeHtml(t.symbol)}/USDT (${escapeHtml(t.timeframe)})</div>
                    <div style="font-size:10px;color:#9ca3af;">${escapeHtml(t.date)}</div>
                    <div style="font-size:10px;color:#60a5fa;max-width:220px;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(t.notes || '')}">📌 ${escapeHtml(t.notes || '')}</div>
                </td>
                <td style="padding:10px;"><strong style="color:${t.side === 'LONG' ? '#10b981' : '#ef4444'};">${escapeHtml(t.side)}</strong> (${escapeHtml(t.leverage)}x)</td>
                <td style="padding:10px;"><div>Prom: <strong>$${entryPrice.toFixed(decimals)}</strong></div><div style="font-size:11px;color:#9ca3af;">${priceLine}</div></td>
                <td style="padding:10px;"><div style="color:#ef4444;">SL: $${(Number(t.stopLoss) || 0).toFixed(decimals)}</div><div style="color:#10b981;">TP: $${(Number(t.takeProfit) || 0).toFixed(decimals)}</div></td>
                <td style="padding:10px;"><div><strong>$${Number(t.positionUSDT) || 0}</strong></div><div style="font-size:10px;color:#9ca3af;">${formatCoins(positionCoins)} ${escapeHtml(t.symbol)}</div></td>
                <td style="padding:10px;">${pnlDisplay}</td>
                <td style="padding:10px;">${actionButtons}</td>
            </tr>
        `;
      }).join('');
    }

    statsBar.innerHTML = `
        <div style="background:#151924;padding:10px;border-radius:8px;border:1px solid #1f2937;">
            <div style="font-size:11px;color:#9ca3af;">Win Rate (${closedTrades.length})</div>
            <div style="font-size:18px;font-weight:bold;color:#10b981;">${winRate}% (${wins.length}W / ${losses.length}L)</div>
        </div>
        <div style="background:#151924;padding:10px;border-radius:8px;border:1px solid #1f2937;">
            <div style="font-size:11px;color:#9ca3af;">PnL Realizado</div>
            <div style="font-size:18px;font-weight:bold;color:${netRealizedPnL >= 0 ? '#10b981' : '#ef4444'};">${netRealizedPnL >= 0 ? '+' : ''}$${netRealizedPnL.toFixed(2)}</div>
        </div>
        <div style="background:#151924;padding:10px;border-radius:8px;border:1px solid #1f2937;">
            <div style="font-size:11px;color:#9ca3af;">PnL Flotante</div>
            <div style="font-size:18px;font-weight:bold;color:${floatingPnLTotal >= 0 ? '#60a5fa' : '#f59e0b'};">${floatingPnLTotal >= 0 ? '+' : ''}$${floatingPnLTotal.toFixed(2)}</div>
        </div>
        <div style="background:#151924;padding:10px;border-radius:8px;border:1px solid #1f2937;">
            <div style="font-size:11px;color:#9ca3af;">Profit Factor</div>
            <div style="font-size:18px;font-weight:bold;color:#fff;">${profitFactor}</div>
        </div>
    `;
  }
  // 6. Cerrar / eliminar operaciones y actualizar capital
  window.closeJournalTrade = function closeJournalTrade(id, outcome, livePnL = 0) {
    const trades = getJournalTrades();
    const idx = trades.findIndex((t) => t.id === id);
    if (idx === -1) return;

    const trade = trades[idx];
    let pnl = 0;
    if (outcome === 'TP') pnl = Number(trade.expectedProfitUSD) || 0;
    else if (outcome === 'SL') pnl = -(Number(trade.riskUSD) || 0);
    else pnl = parseFloat(livePnL) || 0;

    const entryPrice = Number(trade.entryPrice) || 0;
    const positionCoins = Number(trade.positionCoins) || 0;
    const decimals = priceDecimalsFor(entryPrice);
    let exitPrice = entryPrice;

    if (outcome === 'TP') {
      exitPrice = Number(trade.takeProfit) || entryPrice;
    } else if (outcome === 'SL') {
      exitPrice = Number(trade.stopLoss) || entryPrice;
    } else if (positionCoins > 0) {
      const diff = pnl / positionCoins;
      exitPrice = trade.side === 'LONG' ? (entryPrice + diff) : (entryPrice - diff);
    }

    trade.status = outcome;
    trade.realizedPnL = Number(pnl.toFixed(2));
    trade.exitPrice = Number(exitPrice.toFixed(decimals));
    trade.closedAt = new Date().toLocaleString();
    saveJournalTrades(trades);

    // Actualiza automáticamente el capital total de la cartera con la ganancia o pérdida.
    const capInput = document.getElementById('rc-capital');
    const currentCap = capInput ? (parseFloat(capInput.value) || 1000) : (Number(localStorage.getItem('user_trading_capital')) || 1000);
    const newCap = Number((currentCap + pnl).toFixed(2));
    if (capInput) capInput.value = newCap;
    localStorage.setItem('user_trading_capital', newCap);

    renderJournalTableAndLivePnL();
  };

  window.deleteJournalTrade = function deleteJournalTrade(id) {
    saveJournalTrades(getJournalTrades().filter((t) => t.id !== id));
    renderJournalTableAndLivePnL();
  };

  // Exportar bitácora a CSV compatible con Excel
  document.getElementById('btn-export-journal-csv').onclick = () => {
    const trades = getJournalTrades();
    if (trades.length === 0) return;
    const headers = ['Fecha', 'Par', 'TF', 'Lado', 'EntradaPromedio', 'StopLoss', 'TakeProfit', 'Precio_Salida', 'PosicionUSDT', 'Apalancamiento', 'Estado', 'PnL_USDT', 'Plan_Escalonado', 'Notas'];
    const rows = trades.map((t) => [
      csvCell(t.date),
      csvCell(t.symbol),
      csvCell(t.timeframe),
      csvCell(t.side),
      t.entryPrice,
      t.stopLoss,
      t.takeProfit,
      Number.isFinite(Number(t.exitPrice)) ? Number(t.exitPrice) : '',
      t.positionUSDT,
      csvCell(`${t.leverage}x`),
      csvCell(t.status),
      t.realizedPnL,
      csvCell(t.staggeredPlan || ''),
      csvCell(t.notes || '')
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Bitacora_Swing_DCA_${localDateStamp()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // 7. Eventos de Interfaz
  toggleBtn.onclick = () => {
    const willOpen = !isModalOpen();
    setModalOpen(willOpen);
    if (willOpen) {
      const badge = document.getElementById('journal-count-badge');
      if (badge) badge.innerText = getJournalTrades().length;
      fetchBinanceAtrAndEmas();
      window.setTimeout(() => {
        const symbolInput = document.getElementById('rc-symbol');
        if (symbolInput) symbolInput.focus();
      }, 60);
    }
  };

  document.getElementById('close-risk-calc').onclick = () => setModalOpen(false);
  document.getElementById('rc-fetch-btn').onclick = fetchBinanceAtrAndEmas;
  document.getElementById('rc-tf').onchange = fetchBinanceAtrAndEmas;
  document.getElementById('rc-side').onchange = fetchBinanceAtrAndEmas;
  document.getElementById('btn-refresh-journal-pnl').onclick = renderJournalTableAndLivePnL;

  document.getElementById('btn-reset-weights').onclick = () => {
    document.getElementById('rc-w1').value = 40;
    document.getElementById('rc-w2').value = 35;
    document.getElementById('rc-w3').value = 25;
    recalculatePosition();
  };

  document.querySelectorAll('.quick-pair-btn').forEach((btn) => {
    btn.onclick = () => {
      document.getElementById('rc-symbol').value = btn.getAttribute('data-sym');
      fetchBinanceAtrAndEmas();
    };
  });

  ['rc-capital', 'rc-risk-pct', 'rc-mode', 'rc-entry', 'rc-entry-2', 'rc-entry-3', 'rc-w1', 'rc-w2', 'rc-w3', 'rc-atr', 'rc-atr-mult', 'rc-sl-anchor', 'rc-rr', 'rc-margin-pct'].forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.addEventListener('input', recalculatePosition);
    element.addEventListener('change', recalculatePosition);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isModalOpen()) {
      setModalOpen(false);
    }
  });

  const initialBadge = document.getElementById('journal-count-badge');
  if (initialBadge) initialBadge.innerText = getJournalTrades().length;
})();

// ============================================================================
// MÓDULO AUTO-INYECTABLE: ESTUDIO TRIPLE DE GRÁFICOS & LABORATORIO CUANTITATIVO
// Vista 1: TradingView Pro | Vista 2: DEX Screener/Gecko | Vista 3: CVD/POC/Velas
// Se inyecta dentro del Panel 03 / Deep-dive intelligence, sin tocar el resto.
// ============================================================================
(function initSelfInjectingTripleChartStudio() {
  'use strict';

  const oldStudio = document.getElementById('triple-chart-studio-wrapper');
  if (oldStudio) oldStudio.remove();
  const oldStyle = document.getElementById('tcs-studio-styles');
  if (oldStyle) oldStyle.remove();

  const panel = document.getElementById('panel-deep-dive');
  if (!panel) return;

  let currentAsset = 'SOL';
  let currentTimeframe = '4h';
  let activeTab = 'TV';
  let currentTvPreset = 'SWING';
  let currentDexProvider = 'DEXSCREENER';
  let cachedDexPair = null;
  let tvLoadPending = false;
  let tvScriptState = 'idle';
  let tvRequestId = 0;
  let tvWidgetBuilding = false;
  let quantRequestId = 0;
  let dexRequestId = 0;
  let showVmcHiddenDivs = false;
  let lastVmcContext = null;
  let lastQuantChartContext = null;
  let quantResizeTimer = 0;
  let lastAtrOverlay = null;
  const tvScriptWaiters = [];
  const TCS_CANONICAL_TOKENS = {
    SOL: ['So11111111111111111111111111111111111111112'],
    BTC: ['0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'],
    ETH: ['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'],
    BNB: ['0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'],
    XRP: ['0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE'],
    SUI: ['0x2::sui::SUI']
  };

  function tcsEscape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  function tcsSanitizeAsset(raw) {
    const cleaned = String(raw == null ? '' : raw).trim().replace(/^\$/, '');
    if (!cleaned) return '';
    const compact = cleaned.replace(/\s+/g, '');
    if (/^[A-Za-z0-9]{20,100}$/.test(compact)) return compact;
    if (/^0x[A-Fa-f0-9]{1,64}::[A-Za-z0-9_]+::[A-Za-z0-9_]+$/.test(compact)) return compact;
    return compact.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
  }

  function tcsIsContract(value) {
    const text = String(value || '');
    return /^[A-Za-z0-9]{20,100}$/.test(text)
      || /^0x[A-Fa-f0-9]{1,64}::[A-Za-z0-9_]+::[A-Za-z0-9_]+$/.test(text);
  }

  function tcsTicker(value) {
    return String(value || '').replace(/USDT$/i, '').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 15);
  }

  function tcsPriceDecimals(price) {
    const value = Number(price);
    if (!Number.isFinite(value) || value <= 0) return 2;
    if (value >= 1000) return 2;
    if (value >= 1) return 4;
    if (value >= 0.01) return 6;
    return 8;
  }

  function tcsFormatPrice(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '—';
    return `${number.toLocaleString('en-US', { maximumFractionDigits: tcsPriceDecimals(number) })}`;
  }

  function tcsFormatUsd(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '—';
    return `${number.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }

  function tcsFormatCompact(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(number);
  }

  async function tcsFetchJson(target, timeoutMs = 15000) {
    const attempts = [];
    const local = typeof window.QuantLocalProxy === 'function' ? window.QuantLocalProxy(target) : null;
    if (local) attempts.push(local);
    attempts.push(target);
    if (window.QuantFetch && typeof window.QuantFetch.first === 'function') {
      return window.QuantFetch.first(attempts, { timeout: timeoutMs, cacheKey: `public ${target}` });
    }
    let lastError = null;
    for (const url of attempts) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'omit',
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
      } finally {
        window.clearTimeout(timer);
      }
    }
    throw lastError || new Error('Sin respuesta de la API');
  }

  const studioStyle = document.createElement('style');
  studioStyle.id = 'tcs-studio-styles';
  studioStyle.textContent = `
    #triple-chart-studio-wrapper { box-sizing: border-box; }
    #triple-chart-studio-wrapper * { box-sizing: border-box; }
    #triple-chart-studio-wrapper button { transition: filter .15s ease, background .15s ease; }
    #triple-chart-studio-wrapper button:hover { filter: brightness(1.12); }
    #triple-chart-studio-wrapper input:focus,
    #triple-chart-studio-wrapper select:focus { outline: 2px solid rgba(16,185,129,.55); outline-offset: 1px; }
    #triple-chart-studio-wrapper a { transition: filter .15s ease; }
    #triple-chart-studio-wrapper a:hover { filter: brightness(1.15); }
    @media (max-width: 760px) {
      #triple-chart-studio-wrapper { padding: 12px !important; }
      #tcs-tv-widget-box, #tcs-dex-iframe-box { height: 420px !important; }
      #tcs-quant-main-canvas { height: 300px !important; }
      #tcs-quant-cvd-canvas { height: 120px !important; }
      #tcs-vmc-canvas { height: 360px !important; }
      #tcs-search-input { width: 100% !important; }
    }
    #tcs-view-quant.tcs-quant-pseudo-fs {
      display: block !important;
      position: fixed;
      inset: 0;
      z-index: 1000000;
      background: #0b0e14;
      padding: 18px;
      overflow-y: auto;
      box-sizing: border-box;
    }
    body.tcs-quant-fs-lock { overflow: hidden; }
    body.tcs-quant-fs-lock #panel-deep-dive { transform: none !important; }
    body.tcs-quant-fs-lock #btn-open-risk-calc { display: none !important; }
    #tcs-view-quant:fullscreen {
      background: #0b0e14;
      padding: 18px;
      overflow-y: auto;
    }
    #tcs-view-quant:fullscreen #tcs-quant-main-canvas,
    #tcs-view-quant.tcs-quant-pseudo-fs #tcs-quant-main-canvas { height: 55vh !important; }
    #tcs-view-quant:fullscreen #tcs-quant-cvd-canvas,
    #tcs-view-quant.tcs-quant-pseudo-fs #tcs-quant-cvd-canvas { height: 16vh !important; }
    #tcs-view-quant:fullscreen #tcs-vmc-canvas,
    #tcs-view-quant.tcs-quant-pseudo-fs #tcs-vmc-canvas { height: 58vh !important; }
    #tcs-view-tv.tcs-tv-pseudo-fs {
      display: flex !important;
      flex-direction: column;
      position: fixed;
      inset: 0;
      z-index: 1000000;
      background: #0b0e14;
      padding: 18px;
      overflow: hidden;
      box-sizing: border-box;
    }
    body.tcs-tv-fs-lock { overflow: hidden; }
    body.tcs-tv-fs-lock #panel-deep-dive { transform: none !important; }
    body.tcs-tv-fs-lock #btn-open-risk-calc { display: none !important; }
    #tcs-view-tv:fullscreen {
      display: flex !important;
      flex-direction: column;
      background: #0b0e14;
      padding: 18px;
      overflow: hidden;
    }
    #tcs-view-tv:fullscreen #tcs-tv-widget-box,
    #tcs-view-tv.tcs-tv-pseudo-fs #tcs-tv-widget-box {
      flex: 1 1 auto;
      height: auto !important;
      min-height: 0;
    }
  `;
  document.head.appendChild(studioStyle);

  const studioWrapper = document.createElement('div');
  studioWrapper.id = 'triple-chart-studio-wrapper';
  studioWrapper.setAttribute('aria-label', 'Estudio triple de gráficos y laboratorio cuantitativo');
  studioWrapper.style.cssText = 'background:#0b0e14;border:1px solid #1f2937;border-radius:12px;padding:16px;margin:16px 0;color:#f3f4f6;font-family:sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.6);';
  studioWrapper.innerHTML = `
        <!-- Barra superior: buscador sincronizado + selector de las 3 vistas -->
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;border-bottom:1px solid #1f2937;padding-bottom:12px;margin-bottom:14px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="background:#10b981;color:#000;font-weight:bold;padding:4px 9px;border-radius:6px;font-size:12px;">STUDIO PRO</span>
            <input id="tcs-search-input" type="text" value="SOL" placeholder="Ticker (SOL, SUI, BTC) o contrato 0x..." aria-label="Ticker o contrato para el estudio triple" style="background:#151924;border:1px solid #374151;color:#fff;padding:7px 12px;border-radius:6px;font-size:13px;font-weight:bold;width:230px;" />
            <button id="tcs-load-btn" type="button" style="background:#2563eb;color:#fff;border:none;padding:7px 14px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;">🔍 Analizar activo</button>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
              <button class="tcs-quick-coin" type="button" data-coin="SOL" style="background:#151924;color:#10b981;border:1px solid #1f2937;padding:5px 9px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">SOL</button>
              <button class="tcs-quick-coin" type="button" data-coin="SUI" style="background:#151924;color:#10b981;border:1px solid #1f2937;padding:5px 9px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">SUI</button>
              <button class="tcs-quick-coin" type="button" data-coin="XRP" style="background:#151924;color:#10b981;border:1px solid #1f2937;padding:5px 9px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">XRP</button>
              <button class="tcs-quick-coin" type="button" data-coin="BNB" style="background:#151924;color:#10b981;border:1px solid #1f2937;padding:5px 9px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">BNB</button>
              <button class="tcs-quick-coin" type="button" data-coin="BTC" style="background:#151924;color:#10b981;border:1px solid #1f2937;padding:5px 9px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">BTC</button>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button id="tcs-tab-tv" type="button" style="background:#10b981;color:#000;border:none;padding:8px 13px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;">📈 1. TradingView Pro</button>
            <button id="tcs-tab-dex" type="button" style="background:#151924;color:#d1d5db;border:1px solid #374151;padding:8px 13px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;">🦎 2. DEX Screener & Gecko</button>
            <button id="tcs-tab-quant" type="button" style="background:#151924;color:#d1d5db;border:1px solid #374151;padding:8px 13px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;">🧠 3. Laboratorio CVD, POC & Patrones</button>
          </div>
        </div>

        <!-- ================================================================== -->
        <!-- VISTA 1: ESTUDIO TRADINGVIEW PRO                                   -->
        <!-- ================================================================== -->
        <div id="tcs-view-tv" style="display:block;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;background:#151924;padding:8px 12px;border-radius:8px;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-size:11px;color:#9ca3af;">Exchange fuente:</span>
              <select id="tcs-tv-exchange" style="background:#0b0e14;color:#fff;border:1px solid #374151;padding:5px 8px;border-radius:5px;font-size:12px;">
                <option value="BINANCE" selected>Binance Spot (USDT)</option>
                <option value="BINANCE_PERP">Binance Futuros Perpetuos (.P)</option>
                <option value="BYBIT">Bybit (USDT)</option>
                <option value="OKX">OKX (USDT)</option>
                <option value="MEXC">MEXC (Mid/Low Caps)</option>
              </select>
              <span style="font-size:11px;color:#9ca3af;margin-left:6px;">Temporalidad inicial:</span>
              <select id="tcs-tv-interval" style="background:#0b0e14;color:#fff;border:1px solid #374151;padding:5px 8px;border-radius:5px;font-size:12px;">
                <option value="240" selected>4 Horas (Swing)</option>
                <option value="D">1 Día (Macro)</option>
                <option value="60">1 Hora (Intradía)</option>
                <option value="15">15 Minutos (Scalp)</option>
              </select>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="font-size:11px;color:#9ca3af;">Pack de indicadores:</span>
              <button class="tcs-preset-btn" type="button" data-preset="SWING" style="background:#10b981;color:#000;border:none;padding:4px 9px;border-radius:4px;font-size:11px;font-weight:bold;cursor:pointer;">🔥 EMA + RSI + MACD</button>
              <button class="tcs-preset-btn" type="button" data-preset="VOLATILITY" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:4px 9px;border-radius:4px;font-size:11px;cursor:pointer;">🌊 Bollinger + Ichimoku + StochRSI</button>
              <button class="tcs-preset-btn" type="button" data-preset="FLOW" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:4px 9px;border-radius:4px;font-size:11px;cursor:pointer;">⚡ VWAP + ADX + OBV</button>
              <button id="tcs-tv-fullscreen-btn" type="button" title="Pantalla completa del gráfico de TradingView (Esc para salir)" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:4px 9px;border-radius:4px;font-size:11px;font-weight:bold;cursor:pointer;white-space:nowrap;">⛶ Pantalla completa</button>
              <a id="tcs-tv-open-direct" href="https://www.tradingview.com/chart/" target="_blank" rel="noopener" style="background:#1f2937;color:#60a5fa;text-decoration:none;padding:4px 9px;border-radius:4px;font-size:11px;font-weight:bold;border:1px solid #374151;">Abrir en TradingView ↗</a>
            </div>
          </div>
          <div id="tcs-tv-widget-box" style="height:560px;width:100%;border:1px solid #1f2937;border-radius:8px;overflow:hidden;background:#090b10;"></div>
        </div>

        <!-- ================================================================== -->
        <!-- VISTA 2: ESTUDIO ON-CHAIN DEX SCREENER & GECKOTERMINAL             -->
        <!-- ================================================================== -->
        <div id="tcs-view-dex" style="display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;background:#151924;padding:8px 12px;border-radius:8px;">
            <div id="tcs-dex-pair-info" style="font-size:12px;color:#d1d5db;line-height:1.5;max-width:760px;">
              Escribe un ticker o contrato y pulsa <strong>Analizar activo</strong>. Se elegirá el pool con mayor liquidez.
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button id="btn-provider-dexscreener" type="button" style="background:#10b981;color:#000;border:none;padding:5px 10px;border-radius:5px;font-size:11px;font-weight:bold;cursor:pointer;">🦅 Motor DEX Screener</button>
              <button id="btn-provider-gecko" type="button" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:5px 10px;border-radius:5px;font-size:11px;cursor:pointer;">🦎 Motor GeckoTerminal</button>
              <a id="btn-open-bubblemaps-direct" href="https://v2.bubblemaps.io/" target="_blank" rel="noopener" style="background:#7c3aed;color:#fff;text-decoration:none;padding:5px 10px;border-radius:5px;font-size:11px;font-weight:bold;">🫧 Auditar clústeres en Bubblemaps V2 ↗</a>
            </div>
          </div>
          <div id="tcs-dex-iframe-box" style="height:560px;width:100%;border:1px solid #1f2937;border-radius:8px;overflow:hidden;background:#090b10;"></div>
        </div>

        <!-- ================================================================== -->
        <!-- VISTA 3: LABORATORIO CUANTITATIVO (CVD, POC, VAH/VAL, FIB & VELAS) -->
        <!-- ================================================================== -->
        <div id="tcs-view-quant" style="display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;background:#151924;padding:8px 12px;border-radius:8px;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-size:12px;font-weight:bold;color:#10b981;">Temporalidad del escaneo (200 velas):</span>
              <button class="tcs-quant-tf" type="button" data-tf="4h" style="background:#10b981;color:#000;border:none;padding:5px 12px;border-radius:5px;font-size:12px;font-weight:bold;cursor:pointer;">4H (Swing principal)</button>
              <button class="tcs-quant-tf" type="button" data-tf="1d" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:5px 12px;border-radius:5px;font-size:12px;cursor:pointer;">1D (Tendencia mayor)</button>
              <button class="tcs-quant-tf" type="button" data-tf="1h" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:5px 12px;border-radius:5px;font-size:12px;cursor:pointer;">1H (Gatillo de entrada)</button>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
              <div id="tcs-quant-summary-badge" style="font-size:12px;font-weight:bold;color:#60a5fa;">
                Calculando order flow y perfil de volumen...
              </div>
              <button id="tcs-atr-overlay-clear" type="button" title="Quitar el plan ATR del gráfico" style="display:none;background:#7c3aed;color:#fff;border:none;padding:5px 10px;border-radius:5px;font-size:11px;font-weight:bold;cursor:pointer;white-space:nowrap;">✕ Quitar plan ATR</button>
              <button id="tcs-quant-fullscreen-btn" type="button" title="Pantalla completa del laboratorio (Esc para salir)" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:5px 10px;border-radius:5px;font-size:11px;font-weight:bold;cursor:pointer;white-space:nowrap;">⛶ Pantalla completa</button>
            </div>
          </div>

          <div id="tcs-quant-metrics-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px;margin-bottom:12px;"></div>

          <div style="display:grid;grid-template-columns:1fr;gap:12px;">
            <div style="background:#090d16;border:1px solid #1f2937;border-radius:8px;padding:10px;position:relative;">
              <div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-bottom:6px;flex-wrap:wrap;gap:8px;">
                <span><strong>Gráfico cuantitativo:</strong> Velas + <span style="color:#3b82f6;">EMA 20</span> + <span style="color:#f59e0b;">EMA 50</span> + <span style="color:#a855f7;">EMA 200</span> + barras derechas de <strong>Volume Profile</strong></span>
                <span>Líneas: <strong style="color:#facc15;">━━ POC</strong> | <strong style="color:#10b981;">┈┈ VAH</strong> | <strong style="color:#ef4444;">┈┈ VAL</strong> | <strong style="color:#38bdf8;">┈┈ Fib 0.618</strong></span>
              </div>
              <canvas id="tcs-quant-main-canvas" width="900" height="340" style="width:100%;height:340px;display:block;"></canvas>
            </div>

            <div style="background:#090d16;border:1px solid #1f2937;border-radius:8px;padding:10px;">
              <div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-bottom:4px;flex-wrap:wrap;gap:8px;">
                <span><strong>CVD real (Cumulative Volume Delta):</strong> compras taker menos ventas taker, calculado con las velas de Binance</span>
                <span id="tcs-cvd-status-text" style="font-weight:bold;color:#10b981;">Analizando flujo...</span>
              </div>
              <canvas id="tcs-quant-cvd-canvas" width="900" height="130" style="width:100%;height:130px;display:block;"></canvas>
            </div>

            <div style="background:#090d16;border:1px solid #1f2937;border-radius:8px;padding:10px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
                <div>
                  <div style="font-size:12px;font-weight:bold;color:#e2a400;">🌊 VMC Cipher B · VuManChu B Divergences (réplica cuantitativa)</div>
                  <div style="font-size:11px;color:#9ca3af;">WaveTrend 9/12/3 + RSI+MFI 60 + RSI 14 + Stochastic RSI 14/14/3/3 + STC + divergencias fractales de 5 velas · eje temporal alineado con el gráfico de precios</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <span id="tcs-vmc-status" style="font-size:11px;font-weight:bold;color:#9ca3af;">Esperando escaneo...</span>
                  <button id="tcs-vmc-hidden-toggle" type="button" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:5px 10px;border-radius:5px;font-size:11px;font-weight:bold;cursor:pointer;">Divergencias ocultas: OFF</button>
                </div>
              </div>
              <div id="tcs-vmc-live-readout" style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 8px;"></div>
              <canvas id="tcs-vmc-canvas" width="900" height="470" style="width:100%;height:470px;display:block;"></canvas>
              <div id="tcs-vmc-metrics" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:8px;"></div>
              <div style="margin-top:8px;">
                <div style="font-size:11px;font-weight:bold;color:#e2a400;margin-bottom:4px;">Señales VMC recientes (últimas 120 velas)</div>
                <div id="tcs-vmc-signals-list" style="font-size:12px;display:flex;flex-direction:column;gap:6px;"></div>
              </div>
            </div>
          </div>
        </div>
  `;

  // Inserción segura: SOLO dentro del Panel 03. Nunca en main/body.
  const tokenSearchCard = panel.querySelector('.token-search-card');
  if (tokenSearchCard && tokenSearchCard.parentNode === panel) {
    panel.insertBefore(studioWrapper, tokenSearchCard);
  } else {
    panel.appendChild(studioWrapper);
  }

  const searchInput = document.getElementById('tcs-search-input');
  const tvBox = document.getElementById('tcs-tv-widget-box');
  const dexInfoBox = document.getElementById('tcs-dex-pair-info');
  const dexIframeBox = document.getElementById('tcs-dex-iframe-box');
  const quantBadge = document.getElementById('tcs-quant-summary-badge');

  // ========================================================================
  // MOTOR VISTA 1: TRADINGVIEW PRO (exchange, temporalidad y presets)
  // ========================================================================
  function tcsTvSymbol(exchange) {
    const clean = tcsTicker(currentAsset) || 'SOL';
    if (exchange === 'BINANCE_PERP') return `BINANCE:${clean}USDT.P`;
    if (exchange === 'BYBIT') return `BYBIT:${clean}USDT`;
    if (exchange === 'OKX') return `OKX:${clean}USDT`;
    if (exchange === 'MEXC') return `MEXC:${clean}USDT`;
    return `BINANCE:${clean}USDT`;
  }

  function tcsShowTvFallback(message) {
    if (!tvBox) return;
    tvWidgetBuilding = false;
    const exchange = document.getElementById('tcs-tv-exchange');
    const symbol = tcsTvSymbol(exchange ? exchange.value : 'BINANCE');
    const directUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
    tvBox.dataset.tcsTvKey = '';
    tvBox.innerHTML = `
      <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;background:#090d16;">
        <div style="font-size:34px;">📈</div>
        <strong style="color:#f59e0b;font-size:14px;">No se pudo cargar el widget de TradingView</strong>
        <span style="font-size:12px;color:#9ca3af;max-width:560px;line-height:1.5;">${tcsEscape(message)} El gráfico directo sigue disponible con el símbolo ${tcsEscape(symbol)}.</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
          <a href="${tcsEscape(directUrl)}" target="_blank" rel="noopener" style="background:#2563eb;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:bold;">Abrir gráfico directo ↗</a>
          <button id="tcs-tv-retry" type="button" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">Reintentar widget</button>
        </div>
      </div>
    `;
    const retry = document.getElementById('tcs-tv-retry');
    if (retry) {
      retry.onclick = () => {
        const failedScript = document.querySelector('script[src*="tradingview.com/tv.js"]');
        if (failedScript) failedScript.remove();
        tvScriptState = 'idle';
        tvWidgetBuilding = false;
        loadTradingViewWidget();
      };
    }
  }

  function tcsFlushTvWaiters() {
    const waiters = tvScriptWaiters.splice(0);
    waiters.forEach((waiter) => {
      try {
        waiter.onReady();
      } catch (error) {
        console.error('TradingView waiter:', error);
      }
    });
  }

  function tcsFailTvWaiters() {
    const waiters = tvScriptWaiters.splice(0);
    waiters.forEach((waiter) => {
      try {
        waiter.onFail();
      } catch (error) {
        console.error('TradingView waiter:', error);
      }
    });
  }

  function tcsLoadTvScript(onReady, onFail) {
    if (window.TradingView && typeof window.TradingView.widget === 'function') {
      onReady();
      return;
    }
    if (tvScriptState === 'loading') {
      tvScriptWaiters.push({ onReady, onFail });
      return;
    }
    if (tvScriptState === 'failed') {
      onFail();
      return;
    }

    tvScriptState = 'loading';
    tvScriptWaiters.push({ onReady, onFail });

    const check = (attempt = 0) => {
      if (window.TradingView && typeof window.TradingView.widget === 'function') {
        tvScriptState = 'ready';
        tcsFlushTvWaiters();
        return;
      }
      if (attempt >= 30) {
        tvScriptState = 'failed';
        tcsFailTvWaiters();
        return;
      }
      window.setTimeout(() => check(attempt + 1), 150);
    };

    const existing = document.querySelector('script[src*="tradingview.com/tv.js"]');
    if (existing) {
      check();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => check();
    script.onerror = () => {
      tvScriptState = 'failed';
      tcsFailTvWaiters();
    };
    document.head.appendChild(script);
  }

  function loadTradingViewWidget() {
    if (activeTab !== 'TV' || !tvBox) return;

    if (tcsIsContract(currentAsset)) {
      tvWidgetBuilding = false;
      tvBox.dataset.tcsTvKey = '';
      tvBox.innerHTML = `
        <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;background:#090d16;">
          <div style="font-size:34px;">🦎</div>
          <strong style="color:#60a5fa;font-size:14px;">El activo actual es un contrato on-chain</strong>
          <span style="font-size:12px;color:#9ca3af;max-width:560px;line-height:1.5;">TradingView trabaja con pares de exchanges centralizados. Para un contrato usa la Vista 2 (DEX Screener / GeckoTerminal).</span>
          <button id="tcs-tv-go-dex" type="button" style="background:#10b981;color:#000;border:none;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">Ir a la Vista 2 (DEX) →</button>
        </div>
      `;
      const goDex = document.getElementById('tcs-tv-go-dex');
      if (goDex) goDex.onclick = () => switchStudioTab('DEX');
      return;
    }

    if (!panel.classList.contains('is-active')) {
      tvLoadPending = true;
      tvWidgetBuilding = false;
      if (!tvBox.querySelector('iframe')) {
        tvBox.dataset.tcsTvKey = '';
        tvBox.innerHTML = `
          <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;text-align:center;background:#090d16;color:#9ca3af;">
            <div style="font-size:34px;">📈</div>
            <strong style="color:#d1d5db;font-size:13px;">El widget se cargará al abrir el Panel 03</strong>
            <span style="font-size:12px;">TradingView necesita un contenedor visible para calcular su tamaño.</span>
          </div>
        `;
      }
      return;
    }

    tvLoadPending = false;
    const exchangeSelect = document.getElementById('tcs-tv-exchange');
    const intervalSelect = document.getElementById('tcs-tv-interval');
    const exchange = exchangeSelect ? exchangeSelect.value : 'BINANCE';
    const interval = intervalSelect ? intervalSelect.value : '240';
    const symbol = tcsTvSymbol(exchange);
    const key = `${symbol}|${interval}|${currentTvPreset}`;

    if (tvBox.dataset.tcsTvKey === key && tvBox.querySelector('iframe')) return;
    if (tvWidgetBuilding && tvBox.dataset.tcsTvKey === key) return;

    const directLink = document.getElementById('tcs-tv-open-direct');
    if (directLink) {
      directLink.href = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
    }

    tvBox.dataset.tcsTvKey = key;
    tvBox.innerHTML = '<div id="tv_chart_inner_target" style="height:100%;width:100%;"></div>';

    let studies = ['MAExp@tv-basicstudies', 'RSI@tv-basicstudies', 'MACD@tv-basicstudies'];
    if (currentTvPreset === 'VOLATILITY') {
      studies = ['BB@tv-basicstudies', 'IchimokuCloud@tv-basicstudies', 'StochasticRSI@tv-basicstudies'];
    } else if (currentTvPreset === 'FLOW') {
      studies = ['VWAP@tv-basicstudies', 'DMI@tv-basicstudies', 'OBV@tv-basicstudies'];
    }

    tvWidgetBuilding = true;
    const requestId = ++tvRequestId;
    const instantiate = () => {
      if (requestId !== tvRequestId || activeTab !== 'TV') return;
      if (!panel.classList.contains('is-active')) {
        tvLoadPending = true;
        return;
      }
      const target = document.getElementById('tv_chart_inner_target');
      if (!target) return;
      try {
        new window.TradingView.widget({
          autosize: true,
          symbol,
          interval,
          timezone: 'Etc/UTC',
          theme: 'dark',
          style: '1',
          locale: 'es',
          enable_publishing: false,
          backgroundColor: '#0b0e14',
          gridColor: 'rgba(31, 41, 55, 0.5)',
          hide_top_toolbar: false,
          hide_side_toolbar: false,
          allow_symbol_change: true,
          save_image: true,
          withdateranges: true,
          details: true,
          studies,
          container_id: 'tv_chart_inner_target'
        });
        window.setTimeout(() => {
          tvWidgetBuilding = false;
        }, 1500);
      } catch (error) {
        tvWidgetBuilding = false;
        console.error('TradingView widget:', error);
        tcsShowTvFallback('El widget no pudo inicializarse en este navegador.');
      }
    };

    if (window.TradingView && typeof window.TradingView.widget === 'function') {
      instantiate();
    } else {
      tcsLoadTvScript(
        instantiate,
        () => {
          if (requestId === tvRequestId) {
            tcsShowTvFallback('El script tv.js no respondió o fue bloqueado por el navegador.');
          }
        }
      );
    }
  }

  // ========================================================================
  // MOTOR VISTA 2: DEX SCREENER & GECKOTERMINAL ON-CHAIN
  // ========================================================================
  function tcsGeckoNetwork(chainId) {
    const map = {
      ethereum: 'eth',
      eth: 'eth',
      bsc: 'bsc',
      'binance-smart-chain': 'bsc',
      polygon: 'polygon_pos',
      'polygon-pos': 'polygon_pos',
      arbitrum: 'arbitrum',
      base: 'base',
      optimism: 'optimism',
      avalanche: 'avax',
      avax: 'avax',
      solana: 'solana',
      sui: 'sui-network',
      tron: 'tron',
      pulsechain: 'pulsechain',
      blast: 'blast',
      linea: 'linea',
      scroll: 'scroll',
      zksync: 'zksync',
      mantle: 'mantle',
      celo: 'celo',
      cronos: 'cronos',
      fantom: 'ftm',
      ftm: 'ftm'
    };
    const key = String(chainId || '').toLowerCase();
    return map[key] || key;
  }

  async function loadDexOnChainChart() {
    if (!dexInfoBox || !dexIframeBox) return;
    const requestId = ++dexRequestId;
    const asset = currentAsset;
    const isAddress = tcsIsContract(asset);

    dexInfoBox.innerHTML = `⏳ Buscando el pool con mayor liquidez para <strong>${tcsEscape(asset)}</strong> en DEX Screener...`;
    dexIframeBox.innerHTML = `
      <div style="height:100%;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:12px;background:#090b10;">
        Consultando pares on-chain...
      </div>
    `;

    try {
      const searchEndpoint = isAddress
        ? `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(asset)}`
        : `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(asset)}`;
      const cexSymbol = tcsTicker(asset);
      const canonicalTargets = !isAddress ? (TCS_CANONICAL_TOKENS[cexSymbol] || null) : null;
      const cexEndpoint = !isAddress && /^[A-Z0-9]{2,15}$/.test(cexSymbol)
        ? `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(`${cexSymbol}USDT`)}`
        : null;
      const dexRequests = canonicalTargets && canonicalTargets.length
        ? canonicalTargets.map((address) => tcsFetchJson(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`, 15000))
        : [tcsFetchJson(searchEndpoint, 15000)];
      const settled = await Promise.allSettled([
        ...dexRequests,
        cexEndpoint ? tcsFetchJson(cexEndpoint, 6000) : Promise.resolve(null)
      ]);
      if (requestId !== dexRequestId) return;

      const dexResults = settled.slice(0, dexRequests.length);
      const cexResult = settled[settled.length - 1];
      const cexPrice = cexResult.status === 'fulfilled' && cexResult.value
        ? Number(cexResult.value.price)
        : NaN;

      let pairs = [];
      dexResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value && Array.isArray(result.value.pairs)) {
          pairs.push(...result.value.pairs);
        }
      });

      let usedCanonical = !isAddress && pairs.length > 0;
      if (!pairs.length && canonicalTargets) {
        const fallback = await tcsFetchJson(searchEndpoint, 15000);
        if (requestId !== dexRequestId) return;
        pairs = Array.isArray(fallback && fallback.pairs) ? fallback.pairs : [];
        usedCanonical = false;
      }

      const allValid = pairs.filter((pair) => pair && pair.pairAddress && pair.chainId && pair.baseToken);
      if (!allValid.length) {
        dexInfoBox.innerHTML = `<span style="color:#ef4444;">⚠️ No se encontraron pools DEX para "${tcsEscape(asset)}". Pega la dirección exacta del contrato o prueba otro ticker.</span>`;
        dexIframeBox.innerHTML = `
          <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#9ca3af;font-size:12px;background:#090b10;padding:20px;text-align:center;">
            <span>Sin embed disponible para este activo.</span>
            <a href="https://dexscreener.com/search?q=${tcsEscape(encodeURIComponent(asset))}" target="_blank" rel="noopener" style="color:#60a5fa;font-weight:bold;text-decoration:none;">Buscar manualmente en DEX Screener ↗</a>
          </div>
        `;
        return;
      }

      let valid = allValid;
      let cexFiltered = false;
      if (!usedCanonical && Number.isFinite(cexPrice) && cexPrice > 0) {
        const nearCex = allValid.filter((pair) => {
          const pairPrice = Number(pair.priceUsd);
          return Number.isFinite(pairPrice) && pairPrice > 0
            && pairPrice >= cexPrice * 0.85
            && pairPrice <= cexPrice * 1.15;
        });
        if (nearCex.length) {
          valid = nearCex;
          cexFiltered = nearCex.length < allValid.length;
        }
      }

      valid.sort((a, b) => (Number(b.liquidity && b.liquidity.usd) || 0) - (Number(a.liquidity && a.liquidity.usd) || 0));
      const best = valid[0];
      cachedDexPair = best;

      const chainId = String(best.chainId || '').replace(/[^a-z0-9-]/gi, '');
      const pairAddress = String(best.pairAddress || '').replace(/[^A-Za-z0-9]/g, '');
      const tokenAddress = String((best.baseToken && best.baseToken.address) || '').replace(/[^A-Za-z0-9:_]/g, '');
      if (!chainId || !pairAddress) throw new Error('Pool sin cadena o dirección válida');

      const baseSymbol = tcsEscape((best.baseToken && best.baseToken.symbol) || '?');
      const quoteSymbol = tcsEscape((best.quoteToken && best.quoteToken.symbol) || '?');
      const dexId = tcsEscape(best.dexId || 'DEX');
      const chainLabel = tcsEscape(chainId);
      const liqUsd = tcsFormatUsd(best.liquidity && best.liquidity.usd);
      const fdvUsd = tcsFormatUsd(best.fdv || best.marketCap);
      const priceLabel = tcsFormatPrice(best.priceUsd);
      const changeRaw = Number(best.priceChange && best.priceChange.h24);
      const changeLabel = Number.isFinite(changeRaw)
        ? `${changeRaw >= 0 ? '+' : ''}${changeRaw.toFixed(2)}% 24H`
        : '— 24H';
      const changeColor = Number.isFinite(changeRaw) && changeRaw < 0 ? '#ef4444' : '#10b981';
      const shortAddress = tokenAddress
        ? (tokenAddress.length <= 20
          ? tcsEscape(tokenAddress)
          : `${tcsEscape(tokenAddress.slice(0, 8))}...${tcsEscape(tokenAddress.slice(-6))}`)
        : '—';

      dexInfoBox.innerHTML = `
        <span style="color:#10b981;font-weight:bold;">🟢 ${baseSymbol}/${quoteSymbol}</span>
        | Red: <strong style="text-transform:uppercase;color:#60a5fa;">${chainLabel}</strong> (${dexId})
        | Precio: <strong>${tcsEscape(priceLabel)}</strong>
        <span style="color:${changeColor};font-weight:bold;">${tcsEscape(changeLabel)}</span>
        | Liquidez: <strong>${tcsEscape(liqUsd)}</strong>
        | FDV: <strong>${tcsEscape(fdvUsd)}</strong>
        | Contrato: <code title="${tcsEscape(tokenAddress || 'No disponible')}" style="background:#0b0e14;padding:2px 6px;border-radius:4px;color:#f59e0b;">${shortAddress}</code>
        ${usedCanonical ? ' | <span style="color:#10b981;">Token canónico verificado</span>' : (cexFiltered ? ' | <span style="color:#9ca3af;">Filtro anti-homónimos: precio ±15% vs Binance</span>' : '')}
      `;

      const bubblemaps = document.getElementById('btn-open-bubblemaps-direct');
      if (bubblemaps) bubblemaps.href = 'https://v2.bubblemaps.io/';

      const isDexScreener = currentDexProvider === 'DEXSCREENER';
      const geckoNetwork = tcsGeckoNetwork(chainId);
      const embedUrl = isDexScreener
        ? `https://dexscreener.com/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}?embed=1&theme=dark&trades=0&info=0`
        : `https://www.geckoterminal.com/${encodeURIComponent(geckoNetwork)}/pools/${encodeURIComponent(pairAddress)}?embed=1&info=0&swaps=0`;
      const directUrl = isDexScreener
        ? `https://dexscreener.com/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`
        : `https://www.geckoterminal.com/${encodeURIComponent(geckoNetwork)}/pools/${encodeURIComponent(pairAddress)}`;
      const providerName = isDexScreener ? 'DEX Screener' : 'GeckoTerminal';

      dexIframeBox.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;">
          <iframe src="${tcsEscape(embedUrl)}" title="${tcsEscape(`Pool ${baseSymbol}/${quoteSymbol} en ${providerName}`)}" style="flex:1;width:100%;border:none;background:#090b10;" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>
          <div style="height:32px;flex:0 0 32px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 10px;background:#0b0e14;border-top:1px solid #1f2937;font-size:11px;color:#9ca3af;">
            <span>Embed de ${tcsEscape(providerName)}. Si el proveedor lo bloquea, usa el enlace directo.</span>
            <a href="${tcsEscape(directUrl)}" target="_blank" rel="noopener" style="color:#60a5fa;text-decoration:none;font-weight:bold;white-space:nowrap;">Abrir pool ↗</a>
          </div>
        </div>
      `;
    } catch (error) {
      if (requestId !== dexRequestId) return;
      console.error('DEX Screener:', error);
      dexInfoBox.innerHTML = `<span style="color:#ef4444;">No se pudo consultar DEX Screener. Revisa la conexión o abre el pool manualmente.</span>`;
      dexIframeBox.innerHTML = `
        <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#9ca3af;font-size:12px;background:#090b10;padding:20px;text-align:center;">
          <span>El embed no está disponible en este momento.</span>
          <a href="https://dexscreener.com/search?q=${tcsEscape(encodeURIComponent(asset))}" target="_blank" rel="noopener" style="color:#60a5fa;font-weight:bold;text-decoration:none;">Abrir DEX Screener ↗</a>
        </div>
      `;
    }
  }

  // ========================================================================
  // MOTOR VISTA 3: LABORATORIO CUANTITATIVO (CVD, POC, VAH/VAL, FIB, VELAS)
  // ========================================================================
  function tcsCalcEma(values, period) {
    if (!values.length) return [];
    const k = 2 / (period + 1);
    const result = [];
    let ema = values[0];
    for (let i = 0; i < values.length; i += 1) {
      ema = i === 0 ? values[i] : (values[i] * k) + (ema * (1 - k));
      result.push(ema);
    }
    return result;
  }

  function tcsRsiValue(avgGain, avgLoss) {
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
  }

  function tcsCalcRsi(closes, period = 14) {
    const rsi = new Array(closes.length).fill(50);
    if (closes.length <= period) return rsi;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i += 1) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    rsi[period] = tcsRsiValue(avgGain, avgLoss);
    for (let i = period + 1; i < closes.length; i += 1) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = ((avgGain * (period - 1)) + gain) / period;
      avgLoss = ((avgLoss * (period - 1)) + loss) / period;
      rsi[i] = tcsRsiValue(avgGain, avgLoss);
    }
    return rsi;
  }

  function tcsValueArea(bins, pocIndex) {
    const total = bins.reduce((sum, bin) => sum + bin.vol, 0);
    let accumulated = bins[pocIndex].vol;
    let lowIndex = pocIndex;
    let highIndex = pocIndex;
    const target = total * 0.7;
    while (accumulated < target && (lowIndex > 0 || highIndex < bins.length - 1)) {
      const below = lowIndex > 0 ? bins[lowIndex - 1].vol : -1;
      const above = highIndex < bins.length - 1 ? bins[highIndex + 1].vol : -1;
      if (above >= below) {
        highIndex += 1;
        accumulated += bins[highIndex].vol;
      } else {
        lowIndex -= 1;
        accumulated += bins[lowIndex].vol;
      }
    }
    return { val: bins[lowIndex].low, vah: bins[highIndex].high };
  }

  // ========================================================================
  // RÉPLICA VMC CIPHER B / VUMANCHU B DIVERGENCES (PINE v4 -> JS)
  // WaveTrend, RSI+MFI, RSI, Stochastic RSI, STC y divergencias fractales.
  // ========================================================================
  function tcsCalcSma(values, period) {
    const out = new Array(values.length).fill(NaN);
    if (!values.length || period <= 0) return out;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < values.length; i += 1) {
      const value = Number(values[i]);
      if (Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
      if (i >= period) {
        const oldValue = Number(values[i - period]);
        if (Number.isFinite(oldValue)) {
          sum -= oldValue;
          count -= 1;
        }
      }
      if (i >= period - 1 && count === period) out[i] = sum / period;
    }
    return out;
  }

  function tcsCalcRsiStrict(closes, period = 14) {
    const rsi = tcsCalcRsi(closes, period);
    return rsi.map((value, index) => (index < period ? NaN : value));
  }

  function tcsCalcWaveTrend(candles, channelLen = 9, averageLen = 12, maLen = 3) {
    const src = candles.map((candle) => (candle.high + candle.low + candle.close) / 3);
    const esa = tcsCalcEma(src, channelLen);
    const deviation = src.map((value, index) => Math.abs(value - esa[index]));
    const de = tcsCalcEma(deviation, channelLen);
    const ci = src.map((value, index) => {
      const denominator = 0.015 * de[index];
      return Math.abs(denominator) > 1e-12 ? (value - esa[index]) / denominator : 0;
    });
    const wt1 = tcsCalcEma(ci, averageLen);
    const wt2 = tcsCalcSma(wt1, maLen);
    const vwap = wt1.map((value, index) => (Number.isFinite(value) && Number.isFinite(wt2[index]) ? value - wt2[index] : NaN));
    return { src, wt1, wt2, vwap };
  }

  function tcsCalcRsiMfi(candles, period = 60, multiplier = 150, posY = 2.5) {
    const raw = candles.map((candle) => {
      const range = candle.high - candle.low;
      if (!(range > 0)) return 0;
      return ((candle.close - candle.open) / range) * multiplier;
    });
    const average = tcsCalcSma(raw, period);
    return average.map((value) => (Number.isFinite(value) ? value - posY : NaN));
  }

  function tcsCalcStochRsi(closes, stochLen = 14, rsiLen = 14, kSmooth = 3, dSmooth = 3, useLog = true) {
    const src = closes.map((value) => (useLog ? Math.log(Math.max(value, 1e-12)) : value));
    const rsi = tcsCalcRsiStrict(src, rsiLen);
    const rawK = new Array(rsi.length).fill(NaN);
    for (let i = stochLen - 1; i < rsi.length; i += 1) {
      let lowest = Infinity;
      let highest = -Infinity;
      let valid = true;
      for (let j = i - stochLen + 1; j <= i; j += 1) {
        const value = rsi[j];
        if (!Number.isFinite(value)) {
          valid = false;
          break;
        }
        if (value < lowest) lowest = value;
        if (value > highest) highest = value;
      }
      if (!valid) continue;
      const range = highest - lowest;
      rawK[i] = range > 0 ? ((rsi[i] - lowest) / range) * 100 : 50;
    }
    const k = tcsCalcSma(rawK, kSmooth);
    const d = tcsCalcSma(k, dSmooth);
    return { k, d, rsi, rawK };
  }

  function tcsCalcStc(closes, length = 10, fastLength = 23, slowLength = 50, factor = 0.5) {
    const fast = tcsCalcEma(closes, fastLength);
    const slow = tcsCalcEma(closes, slowLength);
    const macd = closes.map((_, index) => fast[index] - slow[index]);
    const gamma = new Array(closes.length).fill(NaN);
    const delta = new Array(closes.length).fill(NaN);
    for (let i = 0; i < closes.length; i += 1) {
      let lowest = Infinity;
      let highest = -Infinity;
      for (let j = Math.max(0, i - length + 1); j <= i; j += 1) {
        if (macd[j] < lowest) lowest = macd[j];
        if (macd[j] > highest) highest = macd[j];
      }
      const range = highest - lowest;
      gamma[i] = range > 0 ? ((macd[i] - lowest) / range) * 100 : (i > 0 ? gamma[i - 1] : 0);
      delta[i] = i === 0 ? gamma[i] : delta[i - 1] + factor * (gamma[i] - delta[i - 1]);
    }
    const eta = new Array(closes.length).fill(NaN);
    for (let i = 0; i < closes.length; i += 1) {
      let lowest = Infinity;
      let highest = -Infinity;
      for (let j = Math.max(0, i - length + 1); j <= i; j += 1) {
        if (delta[j] < lowest) lowest = delta[j];
        if (delta[j] > highest) highest = delta[j];
      }
      const range = highest - lowest;
      eta[i] = range > 0 ? ((delta[i] - lowest) / range) * 100 : (i > 0 ? eta[i - 1] : 0);
    }
    const stc = new Array(closes.length).fill(NaN);
    for (let i = 0; i < closes.length; i += 1) {
      stc[i] = i === 0 ? eta[i] : stc[i - 1] + factor * (eta[i] - stc[i - 1]);
    }
    return stc;
  }

  function tcsFindDivergences(srcArr, highArr, lowArr, topLimit, botLimit, useLimits) {
    const len = srcArr.length;
    const result = {
      topPivot: new Array(len).fill(false),
      botPivot: new Array(len).fill(false),
      regularTop: new Array(len).fill(false),
      regularBot: new Array(len).fill(false),
      hiddenTop: new Array(len).fill(false),
      hiddenBot: new Array(len).fill(false),
      prevTopIndex: new Array(len).fill(-1),
      prevBotIndex: new Array(len).fill(-1)
    };
    let prevTop = -1;
    let prevBot = -1;
    for (let pivot = 2; pivot < len - 2; pivot += 1) {
      const s0 = srcArr[pivot - 2];
      const s1 = srcArr[pivot - 1];
      const s2 = srcArr[pivot];
      const s3 = srcArr[pivot + 1];
      const s4 = srcArr[pivot + 2];
      if (![s0, s1, s2, s3, s4].every(Number.isFinite)) continue;
      const isTop = s0 < s2 && s1 < s2 && s2 > s3 && s2 > s4;
      const isBot = s0 > s2 && s1 > s2 && s2 < s3 && s2 < s4;
      if (isTop && (!useLimits || s2 >= topLimit)) {
        result.topPivot[pivot] = true;
        result.prevTopIndex[pivot] = prevTop;
        if (prevTop >= 0) {
          if (highArr[pivot] > highArr[prevTop] && s2 < srcArr[prevTop]) result.regularTop[pivot] = true;
          if (highArr[pivot] < highArr[prevTop] && s2 > srcArr[prevTop]) result.hiddenTop[pivot] = true;
        }
        prevTop = pivot;
      }
      if (isBot && (!useLimits || s2 <= botLimit)) {
        result.botPivot[pivot] = true;
        result.prevBotIndex[pivot] = prevBot;
        if (prevBot >= 0) {
          if (lowArr[pivot] < lowArr[prevBot] && s2 > srcArr[prevBot]) result.regularBot[pivot] = true;
          if (lowArr[pivot] > lowArr[prevBot] && s2 < srcArr[prevBot]) result.hiddenBot[pivot] = true;
        }
        prevBot = pivot;
      }
    }
    return result;
  }

  function tcsCalcVmc(candles) {
    const closes = candles.map((candle) => candle.close);
    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);
    const wt = tcsCalcWaveTrend(candles, 9, 12, 3);
    const rsi = tcsCalcRsiStrict(closes, 14);
    const rsiMfi = tcsCalcRsiMfi(candles, 60, 150, 2.5);
    const stoch = tcsCalcStochRsi(closes, 14, 14, 3, 3, true);
    const stc = tcsCalcStc(closes, 10, 23, 50, 0.5);

    const wtRegular = tcsFindDivergences(wt.wt2, highs, lows, 45, -65, true);
    const wtAdd = tcsFindDivergences(wt.wt2, highs, lows, 15, -40, true);
    const wtNoLimits = tcsFindDivergences(wt.wt2, highs, lows, 0, 0, false);
    const rsiRegular = tcsFindDivergences(rsi, highs, lows, 60, 30, true);
    const rsiNoLimits = tcsFindDivergences(rsi, highs, lows, 0, 0, false);
    const stochNoLimits = tcsFindDivergences(stoch.k, highs, lows, 0, 0, false);

    const len = candles.length;
    const crossUp = new Array(len).fill(false);
    const crossDown = new Array(len).fill(false);
    const buy = new Array(len).fill(false);
    const sell = new Array(len).fill(false);
    const gold = new Array(len).fill(false);

    for (let i = 1; i < len; i += 1) {
      const wt1Prev = wt.wt1[i - 1];
      const wt2Prev = wt.wt2[i - 1];
      const wt1 = wt.wt1[i];
      const wt2 = wt.wt2[i];
      if (![wt1Prev, wt2Prev, wt1, wt2].every(Number.isFinite)) continue;
      const crossed = (wt1Prev < wt2Prev && wt1 >= wt2) || (wt1Prev > wt2Prev && wt1 <= wt2);
      if (!crossed) continue;
      crossUp[i] = wt2 <= wt1;
      crossDown[i] = wt2 >= wt1;
      if (crossUp[i] && wt2 <= -53) buy[i] = true;
      if (crossDown[i] && wt2 >= 53) sell[i] = true;
    }

    for (let pivot = 2; pivot < len - 2; pivot += 1) {
      const confirm = pivot + 2;
      const bullDiv = wtRegular.regularBot[pivot] || wtAdd.regularBot[pivot] || rsiRegular.regularBot[pivot] || stochNoLimits.regularBot[pivot];
      if (!bullDiv) continue;
      const prevBot = wtRegular.prevBotIndex[pivot];
      if (prevBot < 0) continue;
      const wtLowPrev = wt.wt2[prevBot];
      const rsiPrev = rsi[prevBot];
      const wtNow = wt.wt2[confirm];
      if (![wtLowPrev, rsiPrev, wtNow].every(Number.isFinite)) continue;
      if (wtLowPrev <= -75 && wtNow > -75 && (wtLowPrev - wtNow <= -5) && rsiPrev < 30) {
        gold[confirm] = true;
      }
    }

    return {
      wt,
      rsi,
      rsiMfi,
      stoch,
      stc,
      divergences: { wtRegular, wtAdd, wtNoLimits, rsiRegular, rsiNoLimits, stochNoLimits },
      crossUp,
      crossDown,
      buy,
      sell,
      gold
    };
  }

  function tcsClearQuantOutputs(message) {
    lastQuantChartContext = null;
    const grid = document.getElementById('tcs-quant-metrics-grid');
    if (grid) grid.innerHTML = '';
    const mainCanvas = document.getElementById('tcs-quant-main-canvas');
    if (mainCanvas) {
      const ctx = mainCanvas.getContext('2d');
      ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    }
    const cvdCanvas = document.getElementById('tcs-quant-cvd-canvas');
    if (cvdCanvas) {
      const ctx = cvdCanvas.getContext('2d');
      ctx.clearRect(0, 0, cvdCanvas.width, cvdCanvas.height);
    }
    tcsSetCvdStatus('Analizando flujo...', '#9ca3af');
    tcsClearVmc(message);
  }

  function tcsSetCvdStatus(text, color) {
    const status = document.getElementById('tcs-cvd-status-text');
    if (!status) return;
    status.innerText = text;
    status.style.color = color;
  }

  async function runQuantitativeLabScan() {
    const requestId = ++quantRequestId;
    if (!quantBadge) return;

    if (tcsIsContract(currentAsset)) {
      quantBadge.innerHTML = `<span style="color:#f59e0b;">⚠️ El activo es un contrato on-chain. Usa la Vista 2 (DEX) para su pool.</span>`;
      tcsClearQuantOutputs('El laboratorio CVD/POC trabaja con pares de Binance Spot. Para contratos on-chain usa la Vista 2.');
      tcsSetCvdStatus('Sin datos on-chain', '#f59e0b');
      return;
    }

    const cleanSym = tcsTicker(currentAsset);
    if (!/^[A-Z0-9]{2,15}$/.test(cleanSym)) {
      quantBadge.innerHTML = `<span style="color:#f59e0b;">⚠️ Ticker no válido. Escribe un símbolo como SOL, BTC o SUI.</span>`;
      tcsClearQuantOutputs('Introduce un ticker válido para ejecutar el escaneo cuantitativo.');
      tcsSetCvdStatus('Ticker no válido', '#f59e0b');
      return;
    }

    const interval = ['4h', '1d', '1h'].includes(currentTimeframe) ? currentTimeframe : '4h';
    quantBadge.innerHTML = `⏳ Descargando 200 velas de ${tcsEscape(cleanSym)}USDT (${tcsEscape(interval.toUpperCase())}) y calculando CVD/POC...`;
    tcsClearQuantOutputs('Descargando velas y calculando order flow...');

    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(`${cleanSym}USDT`)}&interval=${encodeURIComponent(interval)}&limit=200`;
      const rawKlines = await tcsFetchJson(url, 20000);
      if (requestId !== quantRequestId) return;

      if (!Array.isArray(rawKlines) || rawKlines.length < 50) {
        quantBadge.innerHTML = `<span style="color:#f59e0b;">⚠️ ${tcsEscape(cleanSym)}USDT no está listado en Binance Spot. Usa la Vista 2 (DEX) para activos on-chain.</span>`;
        tcsClearQuantOutputs('Par no disponible en Binance Spot. Prueba otro ticker o usa la Vista 2 para el pool DEX.');
        tcsSetCvdStatus('Par no disponible', '#f59e0b');
        return;
      }

      const candles = rawKlines.map((k) => {
        const open = Number(k[1]);
        const high = Number(k[2]);
        const low = Number(k[3]);
        const close = Number(k[4]);
        const vol = Number(k[5]);
        const rawBuy = Number(k[9]);
        if (![open, high, low, close, vol, rawBuy].every(Number.isFinite)) return null;
        const buyVol = Math.min(Math.max(rawBuy, 0), Math.max(vol, 0));
        const sellVol = Math.max(vol - buyVol, 0);
        return {
          time: Number(k[0]),
          open,
          high,
          low,
          close,
          vol,
          buyVol,
          sellVol,
          delta: buyVol - sellVol
        };
      }).filter(Boolean);

      if (candles.length < 50) {
        quantBadge.innerHTML = `<span style="color:#f59e0b;">⚠️ No hay suficientes velas válidas para ${tcsEscape(cleanSym)}USDT.</span>`;
        tcsClearQuantOutputs('No hay suficientes velas válidas para calcular el perfil de volumen.');
        tcsSetCvdStatus('Sin velas suficientes', '#f59e0b');
        return;
      }

      const closes = candles.map((c) => c.close);
      const ema20 = tcsCalcEma(closes, 20);
      const ema50 = tcsCalcEma(closes, 50);
      const ema200 = tcsCalcEma(closes, 200);
      const rsiArr = tcsCalcRsi(closes, 14);

      const cvdArr = [];
      let cumulativeDelta = 0;
      candles.forEach((candle) => {
        cumulativeDelta += candle.delta;
        cvdArr.push(cumulativeDelta);
      });

      const minPrice = Math.min(...candles.map((c) => c.low));
      const maxPrice = Math.max(...candles.map((c) => c.high));
      const numBins = 24;
      const priceRange = maxPrice - minPrice;
      const binSize = priceRange > 0 ? priceRange / numBins : 1;
      const bins = new Array(numBins).fill(0).map((_, index) => ({
        low: minPrice + (index * binSize),
        high: minPrice + ((index + 1) * binSize),
        mid: minPrice + ((index + 0.5) * binSize),
        vol: 0
      }));

      candles.forEach((candle) => {
        const typical = (candle.high + candle.low + candle.close) / 3;
        let binIndex = Math.floor((typical - minPrice) / binSize);
        if (binIndex < 0) binIndex = 0;
        if (binIndex >= numBins) binIndex = numBins - 1;
        bins[binIndex].vol += candle.vol;
      });

      let pocBin = bins[0];
      bins.forEach((bin) => {
        if (bin.vol > pocBin.vol) pocBin = bin;
      });
      const pocIndex = bins.indexOf(pocBin);
      const pocPrice = pocBin.mid;
      const valueArea = tcsValueArea(bins, pocIndex);

      const recent100 = candles.slice(-100);
      const swingHigh = Math.max(...recent100.map((c) => c.high));
      const swingLow = Math.min(...recent100.map((c) => c.low));
      const lastPrice = closes[closes.length - 1];
      const lastEma50 = ema50[ema50.length - 1];
      const isUptrend = Number.isFinite(lastEma50) ? lastPrice >= lastEma50 : true;
      const fib618 = swingHigh > swingLow
        ? (isUptrend ? swingHigh - ((swingHigh - swingLow) * 0.618) : swingLow + ((swingHigh - swingLow) * 0.618))
        : lastPrice;

      const lastRsi = rsiArr[rsiArr.length - 1];
      const rsiLabel = Number.isFinite(lastRsi) ? lastRsi.toFixed(1) : '—';
      const rsiColor = lastRsi > 70 ? '#ef4444' : (lastRsi < 35 ? '#10b981' : '#a855f7');
      const rsiZone = lastRsi > 70 ? '🔴 Sobrecompra (>70)' : (lastRsi < 35 ? '🟢 Sobreventa (<35)' : '🟡 Zona neutral');

      const priceChange15 = candles.length > 15 ? lastPrice - closes[closes.length - 15] : 0;
      const cvdChange15 = cvdArr.length > 15 ? cvdArr[cvdArr.length - 1] - cvdArr[cvdArr.length - 15] : 0;
      let cvdFlowVerdict = '🟢 Compras institucionales acompañando';
      if (priceChange15 < 0 && cvdChange15 > 0) cvdFlowVerdict = '🔥 Absorción alcista: el precio baja pero las ballenas compran a mercado';
      else if (priceChange15 > 0 && cvdChange15 < 0) cvdFlowVerdict = '⚠️ Distribución bajista: el precio sube pero las ballenas venden a mercado';
      else if (cvdChange15 < 0) cvdFlowVerdict = '🔴 Presión de venta taker dominante';

      tcsSetCvdStatus(cvdFlowVerdict, cvdChange15 >= 0 ? '#10b981' : '#ef4444');
      quantBadge.innerHTML = `✅ Escaneo completado: <strong>${tcsEscape(cleanSym)}/USDT (${tcsEscape(interval.toUpperCase())})</strong>`;

      const grid = document.getElementById('tcs-quant-metrics-grid');
      if (grid) {
        const ema20Label = tcsFormatPrice(ema20[ema20.length - 1]);
        const ema50Label = tcsFormatPrice(ema50[ema50.length - 1]);
        const ema200Label = tcsFormatPrice(ema200[ema200.length - 1]);
        const cvdLastLabel = tcsFormatCompact(cvdArr[cvdArr.length - 1]);
        const cvdDeltaLabel = tcsFormatCompact(cvdChange15);
        const cvdColor = cvdChange15 >= 0 ? '#10b981' : '#ef4444';
        grid.innerHTML = `
          <div style="background:#151924;padding:10px;border-radius:6px;border-left:3px solid #facc15;">
            <div style="font-size:11px;color:#9ca3af;">POC (Point of Control)</div>
            <div style="font-size:16px;font-weight:bold;color:#facc15;">${tcsEscape(tcsFormatPrice(pocPrice))}</div>
            <div style="font-size:10px;color:#d1d5db;">${tcsEscape(lastPrice > pocPrice ? '🟢 Precio sobre el POC (soporte)' : '🔴 Precio bajo el POC (resistencia)')}</div>
          </div>
          <div style="background:#151924;padding:10px;border-radius:6px;border-left:3px solid #10b981;">
            <div style="font-size:11px;color:#9ca3af;">VAH / VAL (área de valor 70%)</div>
            <div style="font-size:14px;font-weight:bold;color:#10b981;">VAH ${tcsEscape(tcsFormatPrice(valueArea.vah))}</div>
            <div style="font-size:12px;color:#ef4444;font-weight:bold;">VAL ${tcsEscape(tcsFormatPrice(valueArea.val))}</div>
          </div>
          <div style="background:#151924;padding:10px;border-radius:6px;border-left:3px solid #38bdf8;">
            <div style="font-size:11px;color:#9ca3af;">Fibonacci 0.618 (100 velas)</div>
            <div style="font-size:16px;font-weight:bold;color:#38bdf8;">${tcsEscape(tcsFormatPrice(fib618))}</div>
            <div style="font-size:10px;color:#d1d5db;">Rango: ${tcsEscape(tcsFormatPrice(swingLow))} - ${tcsEscape(tcsFormatPrice(swingHigh))}</div>
          </div>
          <div style="background:#151924;padding:10px;border-radius:6px;border-left:3px solid #3b82f6;">
            <div style="font-size:11px;color:#9ca3af;">Estructura EMAs (${tcsEscape(interval.toUpperCase())})</div>
            <div style="font-size:12px;font-weight:bold;color:#fff;">EMA20: ${tcsEscape(ema20Label)}</div>
            <div style="font-size:11px;color:#f59e0b;">EMA50: ${tcsEscape(ema50Label)}</div>
            <div style="font-size:11px;color:#a855f7;">EMA200: ${tcsEscape(ema200Label)}</div>
          </div>
          <div style="background:#151924;padding:10px;border-radius:6px;border-left:3px solid ${rsiColor};">
            <div style="font-size:11px;color:#9ca3af;">RSI (14) actual</div>
            <div style="font-size:16px;font-weight:bold;color:#fff;">${tcsEscape(rsiLabel)}</div>
            <div style="font-size:10px;color:#d1d5db;">${tcsEscape(rsiZone)}</div>
          </div>
          <div style="background:#151924;padding:10px;border-radius:6px;border-left:3px solid ${cvdColor};">
            <div style="font-size:11px;color:#9ca3af;">CVD acumulado (200 velas)</div>
            <div style="font-size:16px;font-weight:bold;color:#fff;">${tcsEscape(cvdLastLabel)}</div>
            <div style="font-size:10px;color:${cvdColor};">Δ15 velas: ${tcsEscape(cvdDeltaLabel)}</div>
          </div>
        `;
      }

      drawMainQuantCanvas(candles, ema20, ema50, ema200, bins, pocIndex, fib618, minPrice, maxPrice, valueArea.vah, valueArea.val);
      drawCvdCanvas(cvdArr);
      const vmc = tcsCalcVmc(candles);
      tcsRenderVmc({ vmc, candles, interval, symbol: cleanSym }, showVmcHiddenDivs);
      lastQuantChartContext = {
        candles,
        ema20,
        ema50,
        ema200,
        cvdArr,
        bins,
        pocIndex,
        fib618,
        minPrice,
        maxPrice,
        vah: valueArea.vah,
        val: valueArea.val
      };
      window.setTimeout(tcsRedrawQuantCharts, 40);
    } catch (error) {
      if (requestId !== quantRequestId) return;
      console.error('Laboratorio cuantitativo:', error);
      quantBadge.innerHTML = `<span style="color:#ef4444;">No se pudo descargar ${tcsEscape(cleanSym)}USDT (${tcsEscape(interval.toUpperCase())}). Revisa la conexión o prueba otro par.</span>`;
      tcsClearQuantOutputs('Error de conexión con Binance. El escaneo no se pudo completar.');
      tcsSetCvdStatus('Sin datos', '#ef4444');
    }
  }

  function drawMainQuantCanvas(candles, ema20, ema50, ema200, bins, pocIndex, fib618, minP, maxP, vah, val) {
    const canvas = document.getElementById('tcs-quant-main-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const padTop = 15;
    const padBot = 15;
    const chartH = H - padTop - padBot;
    const chartW = W * 0.84;
    const range = (maxP - minP) || 1;
    const yOf = (price) => padTop + chartH - (((price - minP) / range) * chartH);

    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i += 1) {
      const y = (H / 5) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    if (Number.isFinite(vah)) {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yOf(vah));
      ctx.lineTo(chartW, yOf(vah));
      ctx.stroke();
    }
    if (Number.isFinite(val)) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yOf(val));
      ctx.lineTo(chartW, yOf(val));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const yPoc = yOf(pocBinPrice(bins, pocIndex));
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, yPoc);
    ctx.lineTo(W, yPoc);
    ctx.stroke();

    const yFib = yOf(fib618);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, yFib);
    ctx.lineTo(chartW, yFib);
    ctx.stroke();
    ctx.setLineDash([]);

    const viewCount = 120;
    const startIdx = Math.max(0, candles.length - viewCount);
    const visible = candles.slice(startIdx);
    const stepX = chartW / visible.length;

    visible.forEach((candle, index) => {
      const x = (index * stepX) + (stepX / 2);
      const isGreen = candle.close >= candle.open;
      ctx.strokeStyle = isGreen ? '#10b981' : '#ef4444';
      ctx.fillStyle = isGreen ? '#10b981' : '#ef4444';
      ctx.beginPath();
      ctx.moveTo(x, yOf(candle.high));
      ctx.lineTo(x, yOf(candle.low));
      ctx.stroke();
      const yOpen = yOf(candle.open);
      const yClose = yOf(candle.close);
      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(Math.abs(yClose - yOpen), 1.5);
      ctx.fillRect(x - (stepX * 0.35), bodyTop, stepX * 0.7, bodyH);
    });

    function drawCurve(arr, color) {
      if (!arr.length) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = startIdx; i < arr.length; i += 1) {
        const x = ((i - startIdx) * stepX) + (stepX / 2);
        const y = yOf(arr[i]);
        if (i === startIdx) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    drawCurve(ema20, '#3b82f6');
    drawCurve(ema50, '#f59e0b');
    drawCurve(ema200, '#a855f7');

    const maxBinVol = Math.max(...bins.map((bin) => bin.vol)) || 1;
    const vpMaxWidth = W - chartW - 8;
    bins.forEach((bin, index) => {
      const barW = (bin.vol / maxBinVol) * vpMaxWidth;
      const yTop = yOf(bin.high);
      const yBot = yOf(bin.low);
      ctx.fillStyle = index === pocIndex ? 'rgba(250, 204, 21, 0.85)' : 'rgba(59, 130, 246, 0.38)';
      ctx.fillRect(W - barW, yTop, barW, Math.max(yBot - yTop - 1, 2));
    });

    drawAtrPlanOverlay(ctx, yOf, chartW, H);
  }

  function drawAtrPlanOverlay(ctx, yOf, chartW, H) {
    const plan = lastAtrOverlay;
    if (!plan) return;
    const levels = [
      { label: 'E1', value: Number(plan.entry1), color: '#60a5fa' },
      { label: 'E2', value: Number(plan.entry2), color: '#f59e0b' },
      { label: 'E3', value: Number(plan.entry3), color: '#a855f7' },
      { label: 'SL', value: Number(plan.stopLoss), color: '#ef4444' },
      { label: 'TP', value: Number(plan.takeProfit), color: '#10b981' }
    ].filter((level) => Number.isFinite(level.value));

    levels.forEach((level) => {
      const y = yOf(level.value);
      if (!Number.isFinite(y) || y < 0 || y > H) return;
      ctx.save();
      ctx.strokeStyle = level.color;
      ctx.lineWidth = level.label === 'SL' || level.label === 'TP' ? 1.6 : 1.2;
      ctx.setLineDash(level.label === 'SL' || level.label === 'TP' ? [7, 4] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartW, y);
      ctx.stroke();
      ctx.restore();
    });

    const legendX = 4;
    const legendY = 4;
    const legendWidth = 176;
    const legendHeight = 14 + (levels.length * 13);
    ctx.save();
    ctx.fillStyle = 'rgba(7, 10, 16, 0.88)';
    ctx.strokeStyle = 'rgba(226, 164, 0, 0.65)';
    ctx.lineWidth = 1;
    ctx.fillRect(legendX, legendY, legendWidth, legendHeight);
    ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);
    ctx.fillStyle = '#e2a400';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    const side = String(plan.side || '').toUpperCase();
    ctx.fillText(`PLAN ATR · ${plan.symbol || ''} ${String(plan.timeframe || '').toUpperCase()}${side ? ` · ${side}` : ''}`, legendX + 4, legendY + 11);
    ctx.font = '9px sans-serif';
    levels.forEach((level, index) => {
      const rowY = legendY + 23 + (index * 13);
      ctx.fillStyle = level.color;
      ctx.fillRect(legendX + 4, rowY - 6, 6, 6);
      ctx.fillStyle = '#d1d5db';
      const weight = plan.weights && plan.weights[`e${level.label.slice(1)}`];
      const weightText = Number.isFinite(Number(weight)) ? ` (${(Number(weight) * 100).toFixed(0)}%)` : '';
      ctx.fillText(`${level.label}  $${tcsFormatPrice(level.value)}${weightText}`, legendX + 14, rowY);
    });
    ctx.restore();
  }

  function pocBinPrice(bins, pocIndex) {
    return bins[pocIndex] ? bins[pocIndex].mid : bins[0].mid;
  }

  function drawCvdCanvas(cvdArr) {
    const canvas = document.getElementById('tcs-quant-cvd-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const visible = cvdArr.slice(-120);
    if (!visible.length) return;
    const minC = Math.min(...visible);
    const maxC = Math.max(...visible);
    const range = (maxC - minC) || 1;
    const stepX = (W * 0.84) / visible.length;
    const yOf = (value) => 10 + (H - 20) - (((value - minC) / range) * (H - 20));

    if (minC <= 0 && maxC >= 0) {
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, yOf(0));
      ctx.lineTo(W * 0.84, yOf(0));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const isPositiveTrend = visible[visible.length - 1] >= visible[0];
    const lineColor = isPositiveTrend ? '#10b981' : '#ef4444';

    ctx.beginPath();
    visible.forEach((value, index) => {
      const x = (index * stepX) + (stepX / 2);
      const y = yOf(value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo((visible.length - 1) * stepX + (stepX / 2), H - 10);
    ctx.lineTo(stepX / 2, H - 10);
    ctx.closePath();
    ctx.fillStyle = isPositiveTrend ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)';
    ctx.fill();

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    visible.forEach((value, index) => {
      const x = (index * stepX) + (stepX / 2);
      const y = yOf(value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = lineColor;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`CVD ${tcsFormatCompact(visible[visible.length - 1])}`, W - 8, 14);
    ctx.textAlign = 'left';
  }

  // ========================================================================
  // RENDER, SEÑALES Y CANVAS VMC (3 BANDAS)
  // ========================================================================
  function tcsVmcTimeLabel(ms) {
    if (!Number.isFinite(ms)) return '—';
    try {
      return new Date(ms).toLocaleString('es-ES', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return '—';
    }
  }

  function tcsVmcFormat(value, decimals = 1) {
    return Number.isFinite(value) ? value.toFixed(decimals) : '—';
  }

  function tcsBuildVmcEvents(vmc, candles, showHidden) {
    const events = [];
    const len = candles.length;
    const start = Math.max(0, len - 120);
    const add = (index, type, color, label, detail, sources) => {
      if (index < start) return;
      events.push({
        index,
        type,
        color,
        label,
        detail,
        sources: sources || [],
        time: candles[index] ? candles[index].time : NaN
      });
    };
    const divergences = vmc.divergences;
    for (let pivot = 2; pivot < len - 2; pivot += 1) {
      const bullSources = [];
      if (divergences.wtRegular.regularBot[pivot]) bullSources.push('WT');
      if (divergences.wtAdd.regularBot[pivot]) bullSources.push('WT 2ª');
      if (divergences.rsiRegular.regularBot[pivot]) bullSources.push('RSI');
      if (divergences.stochNoLimits.regularBot[pivot]) bullSources.push('Stoch');
      if (bullSources.length) {
        add(pivot, 'div-bull', '#00e676', 'Divergencia alcista', `${bullSources.join(' + ')} · pivote de 5 velas confirmado`, bullSources);
      }

      const bearSources = [];
      if (divergences.wtRegular.regularTop[pivot]) bearSources.push('WT');
      if (divergences.wtAdd.regularTop[pivot]) bearSources.push('WT 2ª');
      if (divergences.rsiRegular.regularTop[pivot]) bearSources.push('RSI');
      if (divergences.stochNoLimits.regularTop[pivot]) bearSources.push('Stoch');
      if (bearSources.length) {
        add(pivot, 'div-bear', '#ff5252', 'Divergencia bajista', `${bearSources.join(' + ')} · pivote de 5 velas confirmado`, bearSources);
      }

      if (!showHidden) continue;
      const hiddenBullSources = [];
      if (divergences.wtNoLimits.hiddenBot[pivot]) hiddenBullSources.push('WT');
      if (divergences.rsiNoLimits.hiddenBot[pivot]) hiddenBullSources.push('RSI');
      if (divergences.stochNoLimits.hiddenBot[pivot]) hiddenBullSources.push('Stoch');
      if (hiddenBullSources.length) {
        add(pivot, 'div-bull-hidden', '#31c0ff', 'Divergencia oculta alcista', `${hiddenBullSources.join(' + ')} · continuación de tendencia`, hiddenBullSources);
      }

      const hiddenBearSources = [];
      if (divergences.wtNoLimits.hiddenTop[pivot]) hiddenBearSources.push('WT');
      if (divergences.rsiNoLimits.hiddenTop[pivot]) hiddenBearSources.push('RSI');
      if (divergences.stochNoLimits.hiddenTop[pivot]) hiddenBearSources.push('Stoch');
      if (hiddenBearSources.length) {
        add(pivot, 'div-bear-hidden', '#e600e6', 'Divergencia oculta bajista', `${hiddenBearSources.join(' + ')} · continuación de tendencia`, hiddenBearSources);
      }
    }

    for (let i = 1; i < len; i += 1) {
      if (vmc.buy[i]) add(i, 'buy', '#3fff00', 'Compra fuerte WT', 'Cruce alcista con WT2 en sobreventa (≤ -53)');
      if (vmc.sell[i]) add(i, 'sell', '#ff0000', 'Venta fuerte WT', 'Cruce bajista con WT2 en sobrecompra (≥ 53)');
      if (vmc.gold[i]) add(i, 'gold', '#e2a400', 'GOLD Buy', 'Divergencia alcista + WT2 saliendo de -75 + RSI del pivote < 30');
    }
    return events.sort((a, b) => b.index - a.index);
  }

  function tcsPaintVmcToggle() {
    const button = document.getElementById('tcs-vmc-hidden-toggle');
    if (!button) return;
    button.innerText = `Divergencias ocultas: ${showVmcHiddenDivs ? 'ON' : 'OFF'}`;
    button.style.background = showVmcHiddenDivs ? '#7c3aed' : '#1f2937';
    button.style.color = showVmcHiddenDivs ? '#fff' : '#d1d5db';
    button.style.border = showVmcHiddenDivs ? 'none' : '1px solid #374151';
  }

  function tcsClearVmc(message) {
    lastVmcContext = null;
    const canvas = document.getElementById('tcs-vmc-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    const metrics = document.getElementById('tcs-vmc-metrics');
    if (metrics) metrics.innerHTML = '';
    const readout = document.getElementById('tcs-vmc-live-readout');
    if (readout) readout.innerHTML = `<div style="color:#9ca3af;font-size:11px;padding:4px;">${tcsEscape(message)}</div>`;
    const signals = document.getElementById('tcs-vmc-signals-list');
    if (signals) signals.innerHTML = `<div style="color:#9ca3af;padding:6px;">${tcsEscape(message)}</div>`;
    const status = document.getElementById('tcs-vmc-status');
    if (status) {
      status.innerText = message;
      status.style.color = '#9ca3af';
    }
  }

  function tcsRenderVmc(context, showHidden) {
    if (!context || !context.vmc) return;
    const vmc = context.vmc;
    const candles = context.candles;
    const lastIndex = candles.length - 1;
    const wt1 = vmc.wt.wt1[lastIndex];
    const wt2 = vmc.wt.wt2[lastIndex];
    const rsi = vmc.rsi[lastIndex];
    const mfi = vmc.rsiMfi[lastIndex];
    const stochK = vmc.stoch.k[lastIndex];
    const stochD = vmc.stoch.d[lastIndex];
    const stc = vmc.stc[lastIndex];
    const events = tcsBuildVmcEvents(vmc, candles, showHidden);
    context.showHidden = showHidden;
    context.events = events;
    lastVmcContext = context;

    const wtColor = Number.isFinite(wt2) ? (wt2 <= -53 ? '#10b981' : (wt2 >= 53 ? '#ef4444' : '#facc15')) : '#9ca3af';
    const wtState = Number.isFinite(wt2) ? (wt2 <= -53 ? '🟢 Sobreventa' : (wt2 >= 53 ? '🔴 Sobrecompra' : '🟡 Neutral')) : '—';
    const rsiColor = Number.isFinite(rsi) ? (rsi <= 30 ? '#10b981' : (rsi >= 60 ? '#ef4444' : '#c084fc')) : '#9ca3af';
    const rsiState = Number.isFinite(rsi) ? (rsi <= 30 ? '🟢 Sobreventa' : (rsi >= 60 ? '🔴 Sobrecompra' : '🟡 Neutral')) : '—';
    const mfiColor = Number.isFinite(mfi) ? (mfi >= 0 ? '#10b981' : '#ef4444') : '#9ca3af';
    const mfiState = Number.isFinite(mfi) ? (mfi >= 0 ? '🟢 Flujo comprador' : '🔴 Flujo vendedor') : '—';
    const stochColor = Number.isFinite(stochK) ? (stochK <= 20 ? '#10b981' : (stochK >= 80 ? '#ef4444' : '#21baf3')) : '#9ca3af';
    const stochState = Number.isFinite(stochK) ? (stochK <= 20 ? '🟢 Sobreventa' : (stochK >= 80 ? '🔴 Sobrecompra' : '🟡 Neutral')) : '—';
    const stcColor = Number.isFinite(stc) ? (stc >= 50 ? '#10b981' : '#ef4444') : '#9ca3af';
    const stcState = Number.isFinite(stc) ? (stc >= 50 ? '🟢 Impulso alcista' : '🔴 Impulso bajista') : '—';
    const lastEvent = events[0];

    const card = (label, value, sub, color) => `
      <div style="background:#151924;padding:8px;border-radius:6px;border-left:3px solid ${color};">
        <div style="font-size:10px;color:#9ca3af;">${tcsEscape(label)}</div>
        <div style="font-size:15px;font-weight:bold;color:${color};">${tcsEscape(value)}</div>
        <div style="font-size:10px;color:#d1d5db;">${tcsEscape(sub)}</div>
      </div>`;

    const chip = (label, value, sub, color) => `
      <div style="display:flex;flex-direction:column;gap:1px;flex:1 1 118px;min-width:118px;background:#151924;border:1px solid #1f2937;border-left:3px solid ${color};border-radius:6px;padding:5px 8px;">
        <span style="font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em;">${tcsEscape(label)}</span>
        <strong style="font-size:13px;color:${color};line-height:1.15;">${tcsEscape(value)}</strong>
        <span style="font-size:9px;color:#d1d5db;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${tcsEscape(sub)}</span>
      </div>`;

    const readout = document.getElementById('tcs-vmc-live-readout');
    if (readout) {
      readout.innerHTML = [
        chip('WT2', tcsVmcFormat(wt2, 1), `${wtState} · WT1 ${tcsVmcFormat(wt1, 1)}`, wtColor),
        chip('RSI 14', tcsVmcFormat(rsi, 1), rsiState, rsiColor),
        chip('RSI+MFI', tcsVmcFormat(mfi, 1), mfiState, mfiColor),
        chip('Stoch K/D', `${tcsVmcFormat(stochK, 1)}/${tcsVmcFormat(stochD, 1)}`, stochState, stochColor),
        chip('STC', tcsVmcFormat(stc, 1), stcState, stcColor),
        chip('Señal', lastEvent ? lastEvent.label : 'Sin señal', lastEvent ? tcsVmcTimeLabel(lastEvent.time) : 'Últimas 120 velas', lastEvent ? lastEvent.color : '#9ca3af')
      ].join('');
    }

    const metrics = document.getElementById('tcs-vmc-metrics');
    if (metrics) {
      metrics.innerHTML = [
        card('WaveTrend WT2', tcsVmcFormat(wt2, 1), `${wtState} · WT1 ${tcsVmcFormat(wt1, 1)}`, wtColor),
        card('RSI 14', tcsVmcFormat(rsi, 1), rsiState, rsiColor),
        card('RSI + MFI 60', tcsVmcFormat(mfi, 1), mfiState, mfiColor),
        card('Stoch RSI K / D', `${tcsVmcFormat(stochK, 1)} / ${tcsVmcFormat(stochD, 1)}`, stochState, stochColor),
        card('Schaff Trend Cycle', tcsVmcFormat(stc, 1), stcState, stcColor),
        card('Última señal VMC', lastEvent ? lastEvent.label : 'Sin señales', lastEvent ? tcsVmcTimeLabel(lastEvent.time) : 'Últimas 120 velas', lastEvent ? lastEvent.color : '#9ca3af')
      ].join('');
    }

    const signals = document.getElementById('tcs-vmc-signals-list');
    if (signals) {
      const recent = events.slice(0, 6);
      signals.innerHTML = recent.length
        ? recent.map((event) => `
            <div style="background:#111827;padding:7px 10px;border-radius:6px;border-left:3px solid ${event.color};">
              <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                <strong style="color:${event.color};">${tcsEscape(event.label)}</strong>
                <span style="font-size:10px;color:#9ca3af;">${tcsEscape(tcsVmcTimeLabel(event.time))}</span>
              </div>
              <div style="font-size:11px;color:#d1d5db;">${tcsEscape(event.detail)}</div>
            </div>`).join('')
        : '<div style="color:#9ca3af;padding:6px;">Sin señales fuertes ni divergencias en las últimas 120 velas. Los puntos pequeños del canvas marcan cada cruce WT.</div>';
    }

    const status = document.getElementById('tcs-vmc-status');
    if (status) {
      status.innerText = `✅ VMC listo · ${context.symbol}/USDT · ${context.interval.toUpperCase()} · 200 velas`;
      status.style.color = '#10b981';
    }
    tcsPaintVmcToggle();
    tcsDrawVmcCanvas(context, showHidden);
  }

  function tcsDrawVmcCanvas(context, showHidden) {
    const canvas = document.getElementById('tcs-vmc-canvas');
    if (!canvas || !context || !context.vmc) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const candles = context.candles;
    const vmc = context.vmc;
    const len = candles.length;
    if (!len) return;
    ctx.clearRect(0, 0, W, H);

    const viewCount = 120;
    const start = Math.max(0, len - viewCount);
    const leftPad = 0;
    const chartW = W * 0.84;
    const visibleCount = Math.max(1, len - start);
    const stepX = chartW / visibleCount;
    const xOf = (index) => leftPad + ((index - start) * stepX) + (stepX / 2);

    const bandGap = Math.max(10, Math.round(H * 0.03));
    const bandTopPad = 10;
    const bandBottomPad = 10;
    const usableHeight = Math.max(120, H - bandTopPad - bandBottomPad - (bandGap * 2));
    const wtHeight = usableHeight * 0.52;
    const mfiHeight = usableHeight * 0.22;
    const stochHeight = usableHeight * 0.26;
    const bandWT = { top: bandTopPad, bottom: bandTopPad + wtHeight };
    const bandMFI = { top: bandWT.bottom + bandGap, bottom: bandWT.bottom + bandGap + mfiHeight };
    const bandStoch = { top: bandMFI.bottom + bandGap, bottom: bandMFI.bottom + bandGap + stochHeight };
    const yWT = (value) => bandWT.top + ((100 - value) / 200) * (bandWT.bottom - bandWT.top);
    const yMFI = (value) => bandMFI.top + ((100 - value) / 200) * (bandMFI.bottom - bandMFI.top);
    const yRsi = (value) => bandMFI.top + ((100 - value) / 100) * (bandMFI.bottom - bandMFI.top);
    const yStoch = (value) => bandStoch.top + ((100 - value) / 100) * (bandStoch.bottom - bandStoch.top);

    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, W, H);
    [bandWT, bandMFI, bandStoch].forEach((band) => {
      ctx.fillStyle = '#0b101a';
      ctx.fillRect(leftPad, band.top, chartW, band.bottom - band.top);
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 1;
      ctx.strokeRect(leftPad, band.top, chartW, band.bottom - band.top);
    });

    ctx.fillStyle = 'rgba(239,68,68,0.045)';
    ctx.fillRect(leftPad, bandWT.top, chartW, yWT(53) - bandWT.top);
    ctx.fillStyle = 'rgba(16,185,129,0.045)';
    ctx.fillRect(leftPad, yWT(-53), chartW, bandWT.bottom - yWT(-53));

    ctx.strokeStyle = '#141c2b';
    ctx.lineWidth = 1;
    for (let i = start; i < len; i += 20) {
      const x = xOf(i);
      ctx.beginPath();
      ctx.moveTo(x, bandWT.top);
      ctx.lineTo(x, bandStoch.bottom);
      ctx.stroke();
    }

    ctx.textAlign = 'left';
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.fillText('WaveTrend 9/12/3', leftPad + 4, bandWT.top + 12);
    ctx.fillText('RSI 14 + RSI+MFI 60', leftPad + 4, bandMFI.top + 12);
    ctx.fillText('Stochastic RSI 14/14/3/3', leftPad + 4, bandStoch.top + 12);

    const wtLevels = [
      { value: 60, color: 'rgba(239,68,68,0.38)', label: '60' },
      { value: 53, color: 'rgba(239,68,68,0.22)', label: '53' },
      { value: 0, color: 'rgba(148,163,184,0.35)', label: '0' },
      { value: -53, color: 'rgba(16,185,129,0.22)', label: '-53' },
      { value: -60, color: 'rgba(16,185,129,0.38)', label: '-60' },
      { value: -75, color: 'rgba(16,185,129,0.55)', label: '-75' }
    ];
    wtLevels.forEach((level) => {
      const y = yWT(level.value);
      ctx.strokeStyle = level.color;
      ctx.lineWidth = 1;
      ctx.setLineDash(level.value === 0 ? [] : [3, 4]);
      ctx.beginPath();
      ctx.moveTo(leftPad, y);
      ctx.lineTo(leftPad + chartW, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'left';
      ctx.fillText(level.label, leftPad + chartW + 4, y + 3);
    });

    const mfiZeroY = yMFI(0);
    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(leftPad, mfiZeroY);
    ctx.lineTo(leftPad + chartW, mfiZeroY);
    ctx.stroke();
    ctx.fillStyle = '#6b7280';
    ctx.fillText('0', leftPad + chartW + 4, mfiZeroY + 3);

    [{ value: 60, label: '60' }, { value: 30, label: '30' }].forEach((level) => {
      const y = yRsi(level.value);
      ctx.strokeStyle = level.value === 60 ? 'rgba(239,68,68,0.38)' : 'rgba(16,185,129,0.38)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(leftPad, y);
      ctx.lineTo(leftPad + chartW, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#6b7280';
      ctx.fillText(level.label, leftPad + chartW + 4, y + 3);
    });

    [80, 50, 20].forEach((level) => {
      const y = yStoch(level);
      ctx.strokeStyle = level === 50 ? 'rgba(148,163,184,0.25)' : (level === 80 ? 'rgba(239,68,68,0.38)' : 'rgba(16,185,129,0.38)');
      ctx.setLineDash(level === 50 ? [] : [3, 4]);
      ctx.beginPath();
      ctx.moveTo(leftPad, y);
      ctx.lineTo(leftPad + chartW, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#6b7280';
      ctx.fillText(String(level), leftPad + chartW + 4, y + 3);
    });

    const drawSeries = (values, yFn, color, width = 1.4, dash = []) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      for (let i = start; i < len; i += 1) {
        const value = values[i];
        if (!Number.isFinite(value)) {
          started = false;
          continue;
        }
        const x = xOf(i);
        const y = yFn(value);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const fillToZero = (values, yFn, zeroY, fillStyle) => {
      ctx.beginPath();
      let started = false;
      let lastX = 0;
      for (let i = start; i < len; i += 1) {
        const value = values[i];
        if (!Number.isFinite(value)) continue;
        const x = xOf(i);
        const y = yFn(value);
        if (!started) {
          ctx.moveTo(x, zeroY);
          ctx.lineTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
        lastX = x;
      }
      if (started) {
        ctx.lineTo(lastX, zeroY);
        ctx.closePath();
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
    };

    fillToZero(vmc.wt.wt1, yWT, yWT(0), 'rgba(73,148,236,0.16)');
    fillToZero(vmc.wt.wt2, yWT, yWT(0), 'rgba(124,58,237,0.14)');
    drawSeries(vmc.wt.wt1, yWT, '#4994ec', 1.4);
    drawSeries(vmc.wt.wt2, yWT, '#c084fc', 1.9);
    drawSeries(vmc.wt.vwap, yWT, 'rgba(255,255,255,0.62)', 1.1, [4, 3]);

    for (let i = start; i < len; i += 1) {
      const value = vmc.rsiMfi[i];
      if (!Number.isFinite(value)) continue;
      const x = xOf(i);
      const y = yMFI(value);
      ctx.fillStyle = value >= 0 ? 'rgba(62,225,69,0.24)' : 'rgba(255,61,46,0.24)';
      ctx.fillRect(x - (stepX * 0.4), Math.min(y, mfiZeroY), stepX * 0.8, Math.max(Math.abs(y - mfiZeroY), 1));
    }

    for (let i = start + 1; i < len; i += 1) {
      const previous = vmc.rsi[i - 1];
      const current = vmc.rsi[i];
      if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
      ctx.strokeStyle = current <= 30 ? '#3ee145' : (current >= 60 ? '#e13e3e' : '#c33ee1');
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(xOf(i - 1), yRsi(previous));
      ctx.lineTo(xOf(i), yRsi(current));
      ctx.stroke();
    }

    const stochKPoints = [];
    const stochDPoints = [];
    for (let i = start; i < len; i += 1) {
      const k = vmc.stoch.k[i];
      const d = vmc.stoch.d[i];
      if (!Number.isFinite(k) || !Number.isFinite(d)) continue;
      stochKPoints.push({ x: xOf(i), y: yStoch(k) });
      stochDPoints.push({ x: xOf(i), y: yStoch(d) });
    }
    if (stochKPoints.length > 1) {
      ctx.beginPath();
      stochKPoints.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      for (let index = stochDPoints.length - 1; index >= 0; index -= 1) {
        ctx.lineTo(stochDPoints[index].x, stochDPoints[index].y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(33,186,243,0.10)';
      ctx.fill();
    }
    drawSeries(vmc.stoch.k, yStoch, '#21baf3', 1.6);
    drawSeries(vmc.stoch.d, yStoch, '#673ab7', 1.3);

    for (let i = start; i < len; i += 1) {
      if (!vmc.crossUp[i] && !vmc.crossDown[i]) continue;
      const value = vmc.wt.wt2[i];
      if (!Number.isFinite(value)) continue;
      ctx.beginPath();
      ctx.arc(xOf(i), yWT(value), 2.2, 0, Math.PI * 2);
      ctx.fillStyle = vmc.crossDown[i] ? '#ff5252' : '#00e676';
      ctx.fill();
    }

    for (let i = start; i < len; i += 1) {
      const value = vmc.wt.wt2[i];
      if (!Number.isFinite(value)) continue;
      if (vmc.buy[i] || vmc.sell[i]) {
        const x = xOf(i);
        const y = yWT(value);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = vmc.buy[i] ? 'rgba(63,255,0,0.22)' : 'rgba(255,0,0,0.22)';
        ctx.fill();
        ctx.strokeStyle = vmc.buy[i] ? '#3fff00' : '#ff0000';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
      if (vmc.gold[i]) {
        const x = xOf(i);
        const y = yWT(value);
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(226,164,0,0.3)';
        ctx.fill();
        ctx.strokeStyle = '#e2a400';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#e2a400';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('G', x, y - 9);
      }
    }

    const drawDivMarker = (x, y, isBull, color, hidden) => {
      ctx.beginPath();
      ctx.arc(x, y, hidden ? 3 : 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = hidden ? 0.72 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (hidden) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      ctx.beginPath();
      if (isBull) {
        ctx.moveTo(x, y + 7);
        ctx.lineTo(x - 3, y + 12);
        ctx.lineTo(x + 3, y + 12);
      } else {
        ctx.moveTo(x, y - 7);
        ctx.lineTo(x - 3, y - 12);
        ctx.lineTo(x + 3, y - 12);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };

    const events = context.events || tcsBuildVmcEvents(vmc, candles, showHidden);
    events.forEach((event) => {
      if (!event.sources || !event.sources.length) return;
      const isBull = event.type.indexOf('bull') >= 0;
      const hidden = event.type.indexOf('hidden') >= 0;
      if (event.sources.indexOf('WT') >= 0 || event.sources.indexOf('WT 2ª') >= 0) {
        const value = vmc.wt.wt2[event.index];
        if (Number.isFinite(value)) drawDivMarker(xOf(event.index), yWT(value), isBull, event.color, hidden);
      }
      if (event.sources.indexOf('RSI') >= 0) {
        const value = vmc.rsi[event.index];
        if (Number.isFinite(value)) drawDivMarker(xOf(event.index), yRsi(value), isBull, event.color, hidden);
      }
      if (event.sources.indexOf('Stoch') >= 0) {
        const value = vmc.stoch.k[event.index];
        if (Number.isFinite(value)) drawDivMarker(xOf(event.index), yStoch(value), isBull, event.color, hidden);
      }
    });

    ctx.textAlign = 'left';
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#d1d5db';
    ctx.fillText(`WT1 ${tcsVmcFormat(vmc.wt.wt1[len - 1], 1)}  WT2 ${tcsVmcFormat(vmc.wt.wt2[len - 1], 1)}  VWAP ${tcsVmcFormat(vmc.wt.vwap[len - 1], 1)}`, leftPad + 4, bandWT.top + 24);
    ctx.fillText(`RSI ${tcsVmcFormat(vmc.rsi[len - 1], 1)}  MFI ${tcsVmcFormat(vmc.rsiMfi[len - 1], 1)}`, leftPad + 4, bandMFI.top + 24);
    ctx.fillText(`K ${tcsVmcFormat(vmc.stoch.k[len - 1], 1)}  D ${tcsVmcFormat(vmc.stoch.d[len - 1], 1)}  STC ${tcsVmcFormat(vmc.stc[len - 1], 1)}`, leftPad + 4, bandStoch.top + 24);

    ctx.textAlign = 'left';
  }

  // ========================================================================
  // PANTALLA COMPLETA DEL LABORATORIO CUANTITATIVO
  // ========================================================================
  function tcsIsQuantFullscreen() {
    const view = document.getElementById('tcs-view-quant');
    if (!view) return false;
    return document.fullscreenElement === view || view.classList.contains('tcs-quant-pseudo-fs');
  }

  function tcsUpdateQuantFullscreenButton() {
    const button = document.getElementById('tcs-quant-fullscreen-btn');
    if (!button) return;
    const expanded = tcsIsQuantFullscreen();
    button.innerText = expanded ? '✕ Salir de pantalla completa' : '⛶ Pantalla completa';
    button.style.background = expanded ? '#ef4444' : '#1f2937';
    button.style.color = expanded ? '#fff' : '#d1d5db';
    button.style.border = expanded ? 'none' : '1px solid #374151';
  }

  function tcsFitCanvasToDisplay(canvas) {
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return false;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return true;
  }

  function tcsRedrawQuantCharts() {
    const chart = lastQuantChartContext;
    if (!chart) return;
    const mainCanvas = document.getElementById('tcs-quant-main-canvas');
    const cvdCanvas = document.getElementById('tcs-quant-cvd-canvas');
    const vmcCanvas = document.getElementById('tcs-vmc-canvas');
    const mainVisible = tcsFitCanvasToDisplay(mainCanvas);
    const cvdVisible = tcsFitCanvasToDisplay(cvdCanvas);
    const vmcVisible = tcsFitCanvasToDisplay(vmcCanvas);
    if (mainVisible) {
      drawMainQuantCanvas(
        chart.candles,
        chart.ema20,
        chart.ema50,
        chart.ema200,
        chart.bins,
        chart.pocIndex,
        chart.fib618,
        chart.minPrice,
        chart.maxPrice,
        chart.vah,
        chart.val
      );
    }
    if (cvdVisible) drawCvdCanvas(chart.cvdArr);
    if (vmcVisible && lastVmcContext) tcsDrawVmcCanvas(lastVmcContext, showVmcHiddenDivs);
  }

  function tcsExitQuantFullscreen() {
    const view = document.getElementById('tcs-view-quant');
    if (!view) return;
    if (document.fullscreenElement) {
      const request = document.exitFullscreen();
      if (request && typeof request.catch === 'function') request.catch(() => {});
    }
    if (view.classList.contains('tcs-quant-pseudo-fs')) {
      view.classList.remove('tcs-quant-pseudo-fs');
      document.body.classList.remove('tcs-quant-fs-lock');
    }
    tcsUpdateQuantFullscreenButton();
    window.setTimeout(tcsRedrawQuantCharts, 100);
  }

  function tcsToggleQuantFullscreen() {
    const view = document.getElementById('tcs-view-quant');
    if (!view) return;
    if (tcsIsQuantFullscreen()) {
      tcsExitQuantFullscreen();
      return;
    }
    const enableFallback = () => {
      if (document.fullscreenElement === view) return;
      view.classList.add('tcs-quant-pseudo-fs');
      document.body.classList.add('tcs-quant-fs-lock');
      tcsUpdateQuantFullscreenButton();
      window.setTimeout(tcsRedrawQuantCharts, 120);
    };
    if (typeof view.requestFullscreen === 'function') {
      let request = null;
      try {
        request = view.requestFullscreen();
      } catch (error) {
        enableFallback();
        return;
      }
      if (request && typeof request.then === 'function') {
        const fallbackTimer = window.setTimeout(() => {
          if (!document.fullscreenElement) enableFallback();
        }, 800);
        request.then(() => {
          window.clearTimeout(fallbackTimer);
          if (document.fullscreenElement === view) {
            view.classList.remove('tcs-quant-pseudo-fs');
            document.body.classList.remove('tcs-quant-fs-lock');
          }
          tcsUpdateQuantFullscreenButton();
          window.setTimeout(tcsRedrawQuantCharts, 140);
        }).catch(() => {
          window.clearTimeout(fallbackTimer);
          enableFallback();
        });
      } else {
        tcsUpdateQuantFullscreenButton();
        window.setTimeout(tcsRedrawQuantCharts, 140);
      }
    } else {
      enableFallback();
    }
  }

  // ========================================================================
  // PANTALLA COMPLETA DE TRADINGVIEW PRO
  // ========================================================================
  function tcsIsTvFullscreen() {
    const view = document.getElementById('tcs-view-tv');
    if (!view) return false;
    return document.fullscreenElement === view || view.classList.contains('tcs-tv-pseudo-fs');
  }

  function tcsUpdateTvFullscreenButton() {
    const button = document.getElementById('tcs-tv-fullscreen-btn');
    if (!button) return;
    const expanded = tcsIsTvFullscreen();
    button.innerText = expanded ? '✕ Salir de pantalla completa' : '⛶ Pantalla completa';
    button.style.background = expanded ? '#ef4444' : '#1f2937';
    button.style.color = expanded ? '#fff' : '#d1d5db';
    button.style.border = expanded ? 'none' : '1px solid #374151';
  }

  function tcsResizeTradingViewWidget() {
    const box = document.getElementById('tcs-tv-widget-box');
    if (!box) return;
    const iframe = box.querySelector('iframe');
    if (iframe) {
      iframe.style.width = '100%';
      iframe.style.height = '100%';
    }
    window.dispatchEvent(new Event('resize'));
    if (!iframe && activeTab === 'TV') loadTradingViewWidget();
  }

  function tcsExitTvFullscreen() {
    const view = document.getElementById('tcs-view-tv');
    if (!view) return;
    if (document.fullscreenElement === view) {
      const request = document.exitFullscreen();
      if (request && typeof request.catch === 'function') request.catch(() => {});
    }
    if (view.classList.contains('tcs-tv-pseudo-fs')) {
      view.classList.remove('tcs-tv-pseudo-fs');
      document.body.classList.remove('tcs-tv-fs-lock');
    }
    tcsUpdateTvFullscreenButton();
    window.setTimeout(tcsResizeTradingViewWidget, 120);
  }

  function tcsToggleTvFullscreen() {
    const view = document.getElementById('tcs-view-tv');
    if (!view) return;
    if (tcsIsTvFullscreen()) {
      tcsExitTvFullscreen();
      return;
    }
    const enableFallback = () => {
      if (document.fullscreenElement === view) return;
      view.classList.add('tcs-tv-pseudo-fs');
      document.body.classList.add('tcs-tv-fs-lock');
      tcsUpdateTvFullscreenButton();
      window.setTimeout(tcsResizeTradingViewWidget, 160);
    };
    if (typeof view.requestFullscreen === 'function') {
      let request = null;
      try {
        request = view.requestFullscreen();
      } catch (error) {
        enableFallback();
        return;
      }
      if (request && typeof request.then === 'function') {
        const fallbackTimer = window.setTimeout(() => {
          if (!document.fullscreenElement) enableFallback();
        }, 800);
        request.then(() => {
          window.clearTimeout(fallbackTimer);
          if (document.fullscreenElement === view) {
            view.classList.remove('tcs-tv-pseudo-fs');
            document.body.classList.remove('tcs-tv-fs-lock');
          }
          tcsUpdateTvFullscreenButton();
          window.setTimeout(tcsResizeTradingViewWidget, 160);
        }).catch(() => {
          window.clearTimeout(fallbackTimer);
          enableFallback();
        });
      } else {
        tcsUpdateTvFullscreenButton();
        window.setTimeout(tcsResizeTradingViewWidget, 160);
      }
    } else {
      enableFallback();
    }
  }

  function tcsUpdateAtrOverlayButton() {
    const button = document.getElementById('tcs-atr-overlay-clear');
    if (!button) return;
    button.style.display = lastAtrOverlay ? 'inline-block' : 'none';
  }

  function tcsDrawAtrPlanOverlay(plan) {
    lastAtrOverlay = plan && typeof plan === 'object' ? { ...plan } : null;
    tcsUpdateAtrOverlayButton();
    tcsRedrawQuantCharts();
    return Boolean(lastAtrOverlay);
  }

  function tcsClearAtrOverlay() {
    lastAtrOverlay = null;
    tcsUpdateAtrOverlayButton();
    tcsRedrawQuantCharts();
  }

  function tcsOpenQuantWithPlan(plan) {
    if (!plan || !plan.symbol) return false;
    lastAtrOverlay = { ...plan, symbol: String(plan.symbol).toUpperCase() };
    tcsUpdateAtrOverlayButton();
    currentAsset = String(plan.symbol).toUpperCase();
    if (searchInput) searchInput.value = currentAsset;
    const timeframe = String(plan.timeframe || '4h').toLowerCase();
    if (['4h', '1d', '1h'].includes(timeframe)) currentTimeframe = timeframe;
    tcsPaintQuantTfButtons();
    const navLink = document.querySelector('[data-panel-target="panel-deep-dive"]');
    if (navLink) navLink.click();
    window.setTimeout(() => {
      switchStudioTab('QUANT');
      window.setTimeout(tcsRedrawQuantCharts, 140);
    }, 140);
    return true;
  }

  window.tcsDrawAtrPlanOverlay = tcsDrawAtrPlanOverlay;
  window.tcsClearAtrOverlay = tcsClearAtrOverlay;
  window.tcsOpenQuantWithPlan = tcsOpenQuantWithPlan;
  window.tcsGetAtrOverlay = () => (lastAtrOverlay ? { ...lastAtrOverlay } : null);

  // ========================================================================
  // CONTROLADORES DE NAVEGACIÓN Y SINCRONIZACIÓN CON EL DASHBOARD
  // ========================================================================
  function tcsSetButtonStyle(button, active, activeBackground = '#10b981', inactiveBackground = '#1f2937') {
    if (!button) return;
    button.style.background = active ? activeBackground : inactiveBackground;
    button.style.color = active ? '#000' : '#d1d5db';
    button.style.border = active ? 'none' : '1px solid #374151';
  }

  function tcsPaintTabs() {
    tcsSetButtonStyle(document.getElementById('tcs-tab-tv'), activeTab === 'TV', '#10b981', '#151924');
    tcsSetButtonStyle(document.getElementById('tcs-tab-dex'), activeTab === 'DEX', '#10b981', '#151924');
    tcsSetButtonStyle(document.getElementById('tcs-tab-quant'), activeTab === 'QUANT', '#10b981', '#151924');
  }

  function tcsPaintPresetButtons() {
    document.querySelectorAll('.tcs-preset-btn').forEach((button) => {
      tcsSetButtonStyle(button, button.getAttribute('data-preset') === currentTvPreset, '#10b981', '#1f2937');
    });
  }

  function tcsPaintQuantTfButtons() {
    document.querySelectorAll('.tcs-quant-tf').forEach((button) => {
      tcsSetButtonStyle(button, button.getAttribute('data-tf') === currentTimeframe, '#10b981', '#1f2937');
    });
  }

  function tcsPaintDexProviderButtons() {
    tcsSetButtonStyle(document.getElementById('btn-provider-dexscreener'), currentDexProvider === 'DEXSCREENER', '#10b981', '#1f2937');
    tcsSetButtonStyle(document.getElementById('btn-provider-gecko'), currentDexProvider === 'GECKOTERMINAL', '#10b981', '#1f2937');
  }

  function switchStudioTab(tab) {
    activeTab = ['TV', 'DEX', 'QUANT'].includes(tab) ? tab : 'TV';
    const views = {
      TV: document.getElementById('tcs-view-tv'),
      DEX: document.getElementById('tcs-view-dex'),
      QUANT: document.getElementById('tcs-view-quant')
    };
    Object.keys(views).forEach((key) => {
      if (views[key]) views[key].style.display = key === activeTab ? 'block' : 'none';
    });
    tcsPaintTabs();
    if (activeTab !== 'QUANT') tcsExitQuantFullscreen();
    if (activeTab !== 'TV') tcsExitTvFullscreen();
    if (activeTab === 'TV') loadTradingViewWidget();
    else if (activeTab === 'DEX') loadDexOnChainChart();
    else runQuantitativeLabScan();
  }

  function loadNewAsset(raw) {
    const sanitized = tcsSanitizeAsset(raw);
    if (!sanitized) return;
    if (lastAtrOverlay && String(lastAtrOverlay.symbol || '').toUpperCase() !== String(sanitized).toUpperCase()) {
      tcsClearAtrOverlay();
    }
    currentAsset = sanitized;
    if (searchInput) searchInput.value = currentAsset;
    if (tcsIsContract(currentAsset)) switchStudioTab('DEX');
    else switchStudioTab(activeTab);
  }

  window.loadAssetInTripleChart = (value) => loadNewAsset(value);

  const tabTv = document.getElementById('tcs-tab-tv');
  const tabDex = document.getElementById('tcs-tab-dex');
  const tabQuant = document.getElementById('tcs-tab-quant');
  if (tabTv) tabTv.onclick = () => switchStudioTab('TV');
  if (tabDex) tabDex.onclick = () => switchStudioTab('DEX');
  if (tabQuant) tabQuant.onclick = () => switchStudioTab('QUANT');

  const loadButton = document.getElementById('tcs-load-btn');
  if (loadButton) loadButton.onclick = () => loadNewAsset(searchInput ? searchInput.value : '');
  if (searchInput) {
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        loadNewAsset(searchInput.value);
      }
    });
  }

  document.querySelectorAll('.tcs-quick-coin').forEach((button) => {
    button.onclick = () => loadNewAsset(button.getAttribute('data-coin'));
  });

  const exchangeSelect = document.getElementById('tcs-tv-exchange');
  const intervalSelect = document.getElementById('tcs-tv-interval');
  if (exchangeSelect) exchangeSelect.onchange = loadTradingViewWidget;
  if (intervalSelect) intervalSelect.onchange = loadTradingViewWidget;

  document.querySelectorAll('.tcs-preset-btn').forEach((button) => {
    button.onclick = () => {
      currentTvPreset = button.getAttribute('data-preset') || 'SWING';
      tcsPaintPresetButtons();
      loadTradingViewWidget();
    };
  });

  const providerDexScreener = document.getElementById('btn-provider-dexscreener');
  const providerGecko = document.getElementById('btn-provider-gecko');
  if (providerDexScreener) {
    providerDexScreener.onclick = () => {
      currentDexProvider = 'DEXSCREENER';
      tcsPaintDexProviderButtons();
      loadDexOnChainChart();
    };
  }
  if (providerGecko) {
    providerGecko.onclick = () => {
      currentDexProvider = 'GECKOTERMINAL';
      tcsPaintDexProviderButtons();
      loadDexOnChainChart();
    };
  }

  document.querySelectorAll('.tcs-quant-tf').forEach((button) => {
    button.onclick = () => {
      currentTimeframe = button.getAttribute('data-tf') || '4h';
      tcsPaintQuantTfButtons();
      runQuantitativeLabScan();
    };
  });

  const vmcHiddenToggle = document.getElementById('tcs-vmc-hidden-toggle');
  if (vmcHiddenToggle) {
    vmcHiddenToggle.onclick = () => {
      showVmcHiddenDivs = !showVmcHiddenDivs;
      tcsPaintVmcToggle();
      if (lastVmcContext) tcsRenderVmc(lastVmcContext, showVmcHiddenDivs);
    };
  }

  const quantFullscreenButton = document.getElementById('tcs-quant-fullscreen-btn');
  if (quantFullscreenButton) quantFullscreenButton.onclick = tcsToggleQuantFullscreen;

  const atrOverlayClearButton = document.getElementById('tcs-atr-overlay-clear');
  if (atrOverlayClearButton) atrOverlayClearButton.onclick = tcsClearAtrOverlay;

  const tvFullscreenButton = document.getElementById('tcs-tv-fullscreen-btn');
  if (tvFullscreenButton) tvFullscreenButton.onclick = tcsToggleTvFullscreen;

  document.addEventListener('fullscreenchange', () => {
    const quantView = document.getElementById('tcs-view-quant');
    const tvView = document.getElementById('tcs-view-tv');
    if (quantView && document.fullscreenElement === quantView) {
      quantView.classList.remove('tcs-quant-pseudo-fs');
      document.body.classList.remove('tcs-quant-fs-lock');
    }
    if (tvView && document.fullscreenElement === tvView) {
      tvView.classList.remove('tcs-tv-pseudo-fs');
      document.body.classList.remove('tcs-tv-fs-lock');
    }
    tcsUpdateQuantFullscreenButton();
    tcsUpdateTvFullscreenButton();
    window.setTimeout(() => {
      tcsRedrawQuantCharts();
      tcsResizeTradingViewWidget();
    }, 140);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const quantView = document.getElementById('tcs-view-quant');
    const tvView = document.getElementById('tcs-view-tv');
    if (quantView && quantView.classList.contains('tcs-quant-pseudo-fs')) tcsExitQuantFullscreen();
    if (tvView && tvView.classList.contains('tcs-tv-pseudo-fs')) tcsExitTvFullscreen();
  });

  window.addEventListener('resize', () => {
    if (tcsIsQuantFullscreen()) {
      window.clearTimeout(quantResizeTimer);
      quantResizeTimer = window.setTimeout(tcsRedrawQuantCharts, 180);
    }
  });

  // Sincronización acotada: solo el buscador del Panel 03. No secuestra otros inputs.
  const dashboardTokenSearch = document.getElementById('token-search-input');
  if (dashboardTokenSearch) {
    const syncFromDashboard = () => {
      const value = tcsSanitizeAsset(dashboardTokenSearch.value);
      if (value.length >= 2 && value !== currentAsset) loadNewAsset(value);
    };
    dashboardTokenSearch.addEventListener('change', syncFromDashboard);
    dashboardTokenSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') syncFromDashboard();
    });
  }

  // TradingView necesita un contenedor visible: recargar al activar el Panel 03.
  if (typeof MutationObserver === 'function') {
    const panelObserver = new MutationObserver(() => {
      if (!panel.classList.contains('is-active')) return;
      if (activeTab === 'TV') {
        if (tvLoadPending) tvLoadPending = false;
        loadTradingViewWidget();
      }
    });
    panelObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  tcsPaintTabs();
  tcsPaintPresetButtons();
  tcsPaintQuantTfButtons();
  tcsPaintDexProviderButtons();
  tcsPaintVmcToggle();
  tcsUpdateQuantFullscreenButton();
  tcsUpdateTvFullscreenButton();
  tcsUpdateAtrOverlayButton();

  window.setTimeout(() => {
    if (activeTab === 'TV') loadTradingViewWidget();
  }, 450);
})();


// ============================================================================
// MÓDULO 11 · BACKTESTER HISTÓRICO 500 VELAS
// + BARRA MAESTRA UNIFICADA (DOCK INFERIOR DE HERRAMIENTAS)
// ============================================================================
(function initBacktesterAndMasterUnifiedDock() {
  'use strict';

  const oldOverlay = document.getElementById('quant-backtester-overlay');
  const oldModal = document.getElementById('quant-backtester-modal');
  const oldDock = document.getElementById('master-unified-bottom-dock');
  const oldStyle = document.getElementById('quant-backtester-styles');
  [oldOverlay, oldModal, oldDock, oldStyle].forEach((element) => {
    if (element) element.remove();
  });

  const CONFIG_KEY = 'quant_backtester_config_v1';
  const DEFAULT_CONFIG = {
    symbol: 'SOL',
    timeframe: '4h',
    capital: 1000,
    riskPct: 2,
    atrMult: 1.5,
    rr: 2
  };
  const LEGACY_FLOATERS = [
    'btn-open-smc-radar',
    'btn-open-liq-altbtc',
    'btn-open-alerts-hub',
    'btn-open-risk-calc'
  ];

  let lastResult = null;
  let running = false;
  let dockToastTimer = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  function sanitizeSymbol(raw) {
    return String(raw == null ? '' : raw)
      .trim()
      .toUpperCase()
      .replace(/USDT$/i, '')
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 15);
  }

  function fmtPrice(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '—';
    if (number >= 1000) return number.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (number >= 1) return number.toFixed(2);
    if (number >= 0.01) return number.toFixed(4);
    return number.toFixed(8);
  }

  function fmtUsd(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `$${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtPct(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${number >= 0 ? '+' : ''}${number.toFixed(digits)}%`;
  }

  function fmtDate(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  }

  function loadConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      return {
        symbol: sanitizeSymbol(saved.symbol) || DEFAULT_CONFIG.symbol,
        timeframe: ['4h', '1d', '1h'].includes(String(saved.timeframe)) ? String(saved.timeframe) : DEFAULT_CONFIG.timeframe,
        capital: Number(saved.capital) > 0 ? Number(saved.capital) : DEFAULT_CONFIG.capital,
        riskPct: Number(saved.riskPct) > 0 && Number(saved.riskPct) <= 100 ? Number(saved.riskPct) : DEFAULT_CONFIG.riskPct,
        atrMult: Number(saved.atrMult) > 0 ? Number(saved.atrMult) : DEFAULT_CONFIG.atrMult,
        rr: Number(saved.rr) > 0 ? Number(saved.rr) : DEFAULT_CONFIG.rr
      };
    } catch (error) {
      return { ...DEFAULT_CONFIG };
    }
  }

  function saveConfig(config) {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch (error) {
      // localStorage puede estar bloqueado.
    }
  }

  const initialConfig = loadConfig();

  async function fetchJson(url, timeoutMs = 15000) {
    const attempts = [];
    const local = typeof window.QuantLocalProxy === 'function' ? window.QuantLocalProxy(url) : null;
    if (local) attempts.push(local);
    attempts.push(url);
    attempts.push(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
    if (window.QuantFetch && typeof window.QuantFetch.first === 'function') {
      return window.QuantFetch.first(attempts, { timeout: timeoutMs, cacheKey: `public ${url}` });
    }
    let lastError = null;
    for (const target of attempts) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(target, {
          cache: 'no-store',
          credentials: 'omit',
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
      } finally {
        window.clearTimeout(timer);
      }
    }
    throw lastError || new Error('Sin respuesta de Binance');
  }

  async function fetchKlines(symbol, timeframe) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(`${symbol}USDT`)}&interval=${encodeURIComponent(timeframe)}&limit=500`;
    const raw = await fetchJson(url, 20000);
    if (!Array.isArray(raw) || raw.length < 60) {
      throw new Error('Binance devolvió menos de 60 velas válidas.');
    }
    return raw.map((k) => ({
      time: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]) || 0
    })).filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite));
  }

  function calcEma(values, period) {
    const output = new Array(values.length).fill(NaN);
    if (!values.length || values.length < period) return output;
    const k = 2 / (period + 1);
    let seed = 0;
    for (let i = 0; i < period; i += 1) seed += values[i];
    output[period - 1] = seed / period;
    for (let i = period; i < values.length; i += 1) {
      output[i] = (values[i] * k) + (output[i - 1] * (1 - k));
    }
    return output;
  }

  function calcAtr(candles, period = 14) {
    const output = new Array(candles.length).fill(NaN);
    if (candles.length < period) return output;
    const trueRanges = candles.map((candle, index) => {
      if (index === 0) return candle.high - candle.low;
      const previousClose = candles[index - 1].close;
      return Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose)
      );
    });
    let seed = 0;
    for (let i = 0; i < period; i += 1) seed += trueRanges[i];
    output[period - 1] = seed / period;
    for (let i = period; i < candles.length; i += 1) {
      output[i] = ((output[i - 1] * (period - 1)) + trueRanges[i]) / period;
    }
    return output;
  }

  function runBacktestEngine(candles, config) {
    const closes = candles.map((candle) => candle.close);
    const ema20 = calcEma(closes, 20);
    const ema50 = calcEma(closes, 50);
    const atr14 = calcAtr(candles, 14);

    let balance = config.capital;
    const initialBalance = balance;
    let peak = balance;
    let maxDrawdown = 0;
    const trades = [];
    const equity = [{ label: 'Inicio', balance }];

    let index = 55;
    while (index < candles.length) {
      if (!Number.isFinite(ema20[index]) || !Number.isFinite(ema50[index]) || !Number.isFinite(atr14[index])) {
        index += 1;
        continue;
      }
      const ema20Value = ema20[index];
      const ema50Value = ema50[index];
      const trigger = ema20Value > ema50Value
        && candles[index].low <= (ema20Value * 1.002)
        && candles[index].close > (ema20Value * 0.995);
      if (!trigger) {
        index += 1;
        continue;
      }

      const E1 = candles[index].close;
      const E2 = ema20Value;
      const E3 = ema50Value;
      const SL = E3 - (atr14[index] * config.atrMult);
      const TP = E1 + ((E1 - SL) * config.rr);
      if (!(E1 > E3) || !(SL < E3) || !(TP > E1)) {
        index += 1;
        continue;
      }

      const riskUsd = balance * (config.riskPct / 100);
      const orderRisk = {
        o1: riskUsd * 0.40,
        o2: riskUsd * 0.35,
        o3: riskUsd * 0.25
      };
      const coins1 = orderRisk.o1 / Math.max(E1 - SL, 1e-9);
      let coins = coins1;
      let cost = coins1 * E1;
      let filled2 = false;
      let filled3 = false;
      let exitIndex = -1;
      let exitPrice = null;
      let exitReason = 'Cierre final';

      for (let j = index + 1; j < candles.length; j += 1) {
        const candle = candles[j];
        if (!filled2 && candle.low <= E2) {
          filled2 = true;
          const coins2 = orderRisk.o2 / Math.max(E2 - SL, 1e-9);
          coins += coins2;
          cost += coins2 * E2;
        }
        if (!filled3 && candle.low <= E3) {
          filled3 = true;
          const coins3 = orderRisk.o3 / Math.max(E3 - SL, 1e-9);
          coins += coins3;
          cost += coins3 * E3;
        }

        if (candle.open <= SL) {
          exitPrice = candle.open;
          exitReason = 'SL · gap';
          exitIndex = j;
          break;
        }
        if (candle.low <= SL) {
          exitPrice = SL;
          exitReason = 'SL';
          exitIndex = j;
          break;
        }
        if (candle.open >= TP) {
          exitPrice = candle.open;
          exitReason = 'TP · gap';
          exitIndex = j;
          break;
        }
        if (candle.high >= TP) {
          exitPrice = TP;
          exitReason = 'TP';
          exitIndex = j;
          break;
        }
      }

      if (exitIndex < 0) {
        exitIndex = candles.length - 1;
        exitPrice = candles[exitIndex].close;
        exitReason = 'Cierre final';
      }

      const averageEntry = cost / coins;
      const pnl = coins * (exitPrice - averageEntry);
      balance += pnl;
      peak = Math.max(peak, balance);
      const drawdown = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      const filledWeight = 0.40 + (filled2 ? 0.35 : 0) + (filled3 ? 0.25 : 0);

      trades.push({
        index,
        time: candles[index].time,
        exitIndex,
        exitTime: candles[exitIndex].time,
        E1,
        E2,
        E3,
        SL,
        TP,
        averageEntry,
        exitPrice,
        exitReason,
        filled2,
        filled3,
        filledWeight,
        coins,
        notional: cost,
        pnl,
        result: pnl >= 0 ? 'WIN' : 'LOSS',
        balance
      });
      equity.push({ label: `Trade ${trades.length}`, balance });
      index = exitIndex + 1;
    }

    const wins = trades.filter((trade) => trade.pnl > 0);
    const losses = trades.filter((trade) => trade.pnl < 0);
    const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? Infinity : 0);
    return {
      trades,
      equity,
      initialBalance,
      finalBalance: balance,
      returnPct: initialBalance > 0 ? ((balance - initialBalance) / initialBalance) * 100 : 0,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      profitFactor,
      maxDrawdown
    };
  }

  const overlay = document.createElement('div');
  overlay.id = 'quant-backtester-overlay';
  overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:999998;background:rgba(0,0,0,.72);backdrop-filter:blur(3px);';

  const modal = document.createElement('div');
  modal.id = 'quant-backtester-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('aria-label', 'Backtester histórico de 500 velas');
  modal.style.cssText = 'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:999999;width:95%;max-width:1120px;max-height:92vh;overflow-y:auto;background:#0b0e14;border:2px solid #3b82f6;border-radius:12px;padding:18px;color:#f3f4f6;font-family:sans-serif;box-shadow:0 25px 70px rgba(0,0,0,.95);';
  modal.innerHTML = `
    <div class="bt-header">
      <div>
        <div class="bt-eyebrow">Módulo 11 · Binance Spot · 500 velas</div>
        <h2>🧪 Backtester Histórico · Swing 3 órdenes DCA</h2>
        <p>Simula la estrategia de retroceso a EMA 20/50 con Stop Loss por ATR, Take Profit R:R y tres órdenes escalonadas 40% / 35% / 25%.</p>
      </div>
      <div class="bt-header-actions">
        <span class="bt-badge">Datos históricos reales</span>
        <button type="button" id="bt-close" class="bt-icon-btn" aria-label="Cerrar backtester">✕</button>
      </div>
    </div>

    <div class="bt-inputs">
      <label><span>Activo</span><input id="bt-symbol" type="text" value="${escapeHtml(initialConfig.symbol)}" placeholder="SOL" spellcheck="false" /></label>
      <label><span>Temporalidad</span>
        <select id="bt-timeframe">
          <option value="4h"${initialConfig.timeframe === '4h' ? ' selected' : ''}>4H</option>
          <option value="1d"${initialConfig.timeframe === '1d' ? ' selected' : ''}>1D</option>
          <option value="1h"${initialConfig.timeframe === '1h' ? ' selected' : ''}>1H</option>
        </select>
      </label>
      <label><span>Capital inicial ($)</span><input id="bt-capital" type="number" min="1" step="1" value="${escapeHtml(initialConfig.capital)}" /></label>
      <label><span>Riesgo por operación (%)</span><input id="bt-risk-pct" type="number" min="0.1" max="100" step="0.1" value="${escapeHtml(initialConfig.riskPct)}" /></label>
      <label><span>Multiplicador SL / ATR</span><input id="bt-atr-mult" type="number" min="0.1" step="0.1" value="${escapeHtml(initialConfig.atrMult)}" /></label>
      <label><span>Ratio Riesgo:Beneficio</span><input id="bt-rr" type="number" min="0.1" step="0.1" value="${escapeHtml(initialConfig.rr)}" /></label>
      <div class="bt-input-actions">
        <button type="button" id="bt-run" class="bt-primary-btn">▶ Ejecutar backtest</button>
        <button type="button" id="bt-reset" class="bt-secondary-btn">Valores por defecto</button>
      </div>
    </div>

    <div id="bt-status" class="bt-status">Configura los parámetros y pulsa Ejecutar backtest.</div>

    <div class="bt-metrics">
      <div class="bt-metric"><span>Balance final</span><strong id="bt-final-balance">—</strong><small id="bt-return-pct">—</small></div>
      <div class="bt-metric"><span>Win rate real</span><strong id="bt-winrate">—</strong><small id="bt-winrate-sub">—</small></div>
      <div class="bt-metric"><span>Profit factor</span><strong id="bt-profit-factor">—</strong><small>Ganancia bruta / pérdida bruta</small></div>
      <div class="bt-metric"><span>Drawdown máximo</span><strong id="bt-max-dd">—</strong><small>Peak to trough</small></div>
    </div>

    <div class="bt-canvas-wrap">
      <div class="bt-canvas-head"><strong>Curva de capital</strong><span id="bt-equity-summary">—</span></div>
      <canvas id="bt-equity-canvas" width="900" height="280" style="width:100%;height:280px;display:block;"></canvas>
    </div>

    <div class="bt-table-wrap">
      <table class="bt-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>DCA llenado</th>
            <th>Precio promedio</th>
            <th>SL / TP</th>
            <th>Resultado</th>
            <th>PnL USD</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody id="bt-trades-body">
          <tr><td colspan="7" class="bt-empty">Aún no hay operaciones simuladas.</td></tr>
        </tbody>
      </table>
    </div>

    <div class="bt-footnote">
      <strong>Modelo:</strong> E1 al cierre del gatillo, E2 en EMA20 y E3 en EMA50. SL = E3 − ATR14 × multiplicador. TP = E1 + (E1 − SL) × R:R.
      Si una vela toca SL y TP en el mismo periodo, se asume SL primero (modelo conservador). No incluye comisiones, slippage ni funding.
    </div>
  `;

  const style = document.createElement('style');
  style.id = 'quant-backtester-styles';
  style.textContent = `
    #quant-backtester-overlay { pointer-events: auto; }
    #quant-backtester-modal * { box-sizing: border-box; }
    .bt-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid #1f2937; margin-bottom: 12px; }
    .bt-eyebrow { font-size: 10px; color: #60a5fa; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
    .bt-header h2 { margin: 3px 0 4px; font-size: 20px; color: #f3f4f6; }
    .bt-header p { margin: 0; max-width: 760px; font-size: 11px; color: #9ca3af; line-height: 1.5; }
    .bt-header-actions { display: flex; align-items: center; gap: 8px; }
    .bt-badge { display: inline-flex; padding: 4px 8px; border-radius: 5px; background: #1e3a8a; color: #bfdbfe; font-size: 10px; font-weight: 700; }
    .bt-icon-btn { background: #1f2937; color: #9ca3af; border: 1px solid #374151; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-weight: 700; }
    .bt-inputs { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 9px; background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 12px; margin-bottom: 10px; }
    .bt-inputs label { display: flex; flex-direction: column; gap: 4px; }
    .bt-inputs label span { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; }
    .bt-inputs input, .bt-inputs select { background: #0b0e14; border: 1px solid #374151; color: #fff; border-radius: 5px; padding: 7px 8px; font-size: 12px; font-weight: 700; }
    .bt-input-actions { display: flex; align-items: flex-end; gap: 6px; flex-wrap: wrap; }
    .bt-primary-btn { background: #10b981; color: #000; border: none; border-radius: 6px; padding: 8px 13px; font-size: 12px; font-weight: 800; cursor: pointer; white-space: nowrap; }
    .bt-primary-btn:disabled { opacity: .55; cursor: wait; }
    .bt-secondary-btn { background: #1f2937; color: #d1d5db; border: 1px solid #374151; border-radius: 6px; padding: 8px 11px; font-size: 11px; font-weight: 700; cursor: pointer; }
    .bt-status { padding: 7px 10px; border-radius: 6px; background: #111827; border: 1px solid #1f2937; font-size: 11px; color: #9ca3af; margin-bottom: 10px; }
    .bt-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 9px; margin-bottom: 10px; }
    .bt-metric { background: #151924; border: 1px solid #1f2937; border-left: 3px solid #3b82f6; border-radius: 7px; padding: 9px 10px; }
    .bt-metric span { display: block; font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; }
    .bt-metric strong { display: block; margin-top: 3px; font-size: 18px; color: #f3f4f6; }
    .bt-metric small { display: block; margin-top: 2px; font-size: 10px; color: #9ca3af; }
    .bt-metric.is-positive { border-left-color: #10b981; }
    .bt-metric.is-negative { border-left-color: #ef4444; }
    .bt-canvas-wrap { background: #070a10; border: 1px solid #1f2937; border-radius: 8px; padding: 8px; margin-bottom: 10px; }
    .bt-canvas-head { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 11px; color: #d1d5db; margin-bottom: 4px; }
    .bt-canvas-head span { color: #9ca3af; }
    .bt-table-wrap { max-height: 330px; overflow: auto; border: 1px solid #1f2937; border-radius: 8px; }
    .bt-table { width: 100%; border-collapse: collapse; font-size: 11px; text-align: left; }
    .bt-table th { position: sticky; top: 0; z-index: 1; background: #151924; color: #9ca3af; padding: 8px; border-bottom: 1px solid #1f2937; white-space: nowrap; }
    .bt-table td { padding: 8px; border-bottom: 1px solid #111827; color: #d1d5db; vertical-align: top; }
    .bt-table small { display: block; color: #6b7280; font-size: 9px; margin-top: 2px; }
    .bt-table .is-win { color: #10b981; font-weight: 800; }
    .bt-table .is-loss { color: #ef4444; font-weight: 800; }
    .bt-empty { color: #9ca3af; text-align: center; padding: 18px !important; }
    .bt-footnote { margin-top: 10px; padding: 9px 10px; border-radius: 6px; background: #111827; border: 1px solid #1f2937; font-size: 10px; color: #9ca3af; line-height: 1.5; }
    .bt-footnote strong { color: #d1d5db; }

    #master-unified-bottom-dock {
      position: fixed;
      bottom: 10px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999998;
      display: flex;
      align-items: center;
      gap: 6px;
      max-width: calc(100vw - 16px);
      overflow-x: auto;
      padding: 7px;
      border-radius: 14px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background: rgba(11, 14, 20, 0.82);
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      scrollbar-width: thin;
    }
    #master-unified-bottom-dock::-webkit-scrollbar { height: 5px; }
    #master-unified-bottom-dock::-webkit-scrollbar-thumb { background: #374151; border-radius: 99px; }
    .dock-btn {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid #374151;
      background: #151924;
      color: #d1d5db;
      font-family: sans-serif;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: filter .15s ease, border-color .15s ease, background .15s ease;
    }
    .dock-btn:hover { filter: brightness(1.16); border-color: #60a5fa; }
    .dock-btn.is-primary { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; border-color: #60a5fa; }
    .dock-btn.is-green { background: linear-gradient(135deg, #10b981, #059669); color: #000; border-color: #6ee7b7; }
    .dock-btn.is-amber { background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; border-color: #fcd34d; }
    .dock-btn .dock-icon { font-size: 13px; line-height: 1; }
    .dock-status-toast {
      position: fixed;
      left: 50%;
      bottom: 68px;
      transform: translateX(-50%);
      z-index: 2147483000;
      max-width: min(520px, calc(100vw - 24px));
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(11, 14, 20, 0.96);
      border: 1px solid #3b82f6;
      color: #f3f4f6;
      font-family: sans-serif;
      font-size: 11px;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.65);
    }
    @media (max-width: 760px) {
      #master-unified-bottom-dock { bottom: 76px; padding: 6px; }
      .dock-status-toast { bottom: 132px; }
      #quant-backtester-modal { padding: 12px; width: 96%; }
      .bt-header h2 { font-size: 17px; }
      .bt-inputs { grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); }
      .bt-table { min-width: 720px; }
    }
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(modal);
  document.head.appendChild(style);

  const symbolInput = document.getElementById('bt-symbol');
  const timeframeInput = document.getElementById('bt-timeframe');
  const capitalInput = document.getElementById('bt-capital');
  const riskInput = document.getElementById('bt-risk-pct');
  const atrMultInput = document.getElementById('bt-atr-mult');
  const rrInput = document.getElementById('bt-rr');
  const runButton = document.getElementById('bt-run');
  const resetButton = document.getElementById('bt-reset');
  const closeButton = document.getElementById('bt-close');
  const statusBox = document.getElementById('bt-status');
  const tradesBody = document.getElementById('bt-trades-body');
  const equityCanvas = document.getElementById('bt-equity-canvas');

  function setBtStatus(text, color = '#9ca3af') {
    if (!statusBox) return;
    statusBox.textContent = text;
    statusBox.style.color = color;
  }

  function setBtText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function openBacktester() {
    overlay.style.display = 'block';
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => runBacktestFromForm(), 100);
  }

  function closeBacktester() {
    overlay.style.display = 'none';
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function readConfigFromForm() {
    return {
      symbol: sanitizeSymbol(symbolInput ? symbolInput.value : ''),
      timeframe: timeframeInput && ['4h', '1d', '1h'].includes(timeframeInput.value) ? timeframeInput.value : '4h',
      capital: Number(capitalInput ? capitalInput.value : 0),
      riskPct: Number(riskInput ? riskInput.value : 0),
      atrMult: Number(atrMultInput ? atrMultInput.value : 0),
      rr: Number(rrInput ? rrInput.value : 0)
    };
  }

  function validateConfig(config) {
    if (!config.symbol) return 'Escribe un activo válido, por ejemplo SOL, BTC o ETH.';
    if (!(config.capital > 0)) return 'El capital inicial debe ser mayor que cero.';
    if (!(config.riskPct > 0 && config.riskPct <= 100)) return 'El riesgo por operación debe estar entre 0.1% y 100%.';
    if (!(config.atrMult > 0)) return 'El multiplicador de ATR debe ser mayor que cero.';
    if (!(config.rr > 0)) return 'El ratio Riesgo:Beneficio debe ser mayor que cero.';
    return '';
  }

  function renderMetrics(result) {
    const balanceCard = document.getElementById('bt-final-balance');
    const returnCard = document.getElementById('bt-return-pct');
    const winrateCard = document.getElementById('bt-winrate');
    const winrateSub = document.getElementById('bt-winrate-sub');
    const profitFactorCard = document.getElementById('bt-profit-factor');
    const drawdownCard = document.getElementById('bt-max-dd');

    setBtText('bt-final-balance', fmtUsd(result.finalBalance));
    setBtText('bt-return-pct', `${fmtPct(result.returnPct)} · ${result.trades.length} trades`);
    setBtText('bt-winrate', `${result.winRate.toFixed(1)}%`);
    setBtText('bt-winrate-sub', `${result.wins}W / ${result.losses}L · ${result.trades.length} operaciones`);
    setBtText('bt-profit-factor', result.profitFactor === Infinity ? '∞' : result.profitFactor.toFixed(2));
    setBtText('bt-max-dd', `${result.maxDrawdown.toFixed(2)}%`);
    setBtText('bt-equity-summary', `Inicial ${fmtUsd(result.initialBalance)} → Final ${fmtUsd(result.finalBalance)}`);

    const cards = [
      [balanceCard, result.finalBalance >= result.initialBalance],
      [returnCard, result.returnPct >= 0],
      [winrateCard, result.winRate >= 50],
      [profitFactorCard, result.profitFactor >= 1],
      [drawdownCard, result.maxDrawdown <= 20]
    ];
    cards.forEach(([element, positive]) => {
      const card = element ? element.closest('.bt-metric') : null;
      if (!card) return;
      card.classList.remove('is-positive', 'is-negative');
      card.classList.add(positive ? 'is-positive' : 'is-negative');
    });
  }

  function renderTrades(trades) {
    if (!tradesBody) return;
    if (!trades.length) {
      tradesBody.innerHTML = '<tr><td colspan="7" class="bt-empty">No se activó ningún trade con estas condiciones. Prueba otra temporalidad, activo o parámetros.</td></tr>';
      return;
    }
    tradesBody.innerHTML = trades.map((trade) => {
      const dcaPercent = Math.round(trade.filledWeight * 100);
      const filledOrders = `O1${trade.filled2 ? ' + O2' : ''}${trade.filled3 ? ' + O3' : ''}`;
      const resultClass = trade.result === 'WIN' ? 'is-win' : 'is-loss';
      const pnlClass = trade.pnl >= 0 ? 'is-win' : 'is-loss';
      const detailTitle = `E1 ${fmtPrice(trade.E1)} · E2 ${fmtPrice(trade.E2)} · E3 ${fmtPrice(trade.E3)} · Salida ${fmtPrice(trade.exitPrice)} (${trade.exitReason})`;
      return `<tr title="${escapeHtml(detailTitle)}">
        <td>${escapeHtml(fmtDate(trade.time))}<small>Salida ${escapeHtml(fmtDate(trade.exitTime))}</small></td>
        <td><strong>${dcaPercent}%</strong><small>${escapeHtml(filledOrders)}</small></td>
        <td>$${escapeHtml(fmtPrice(trade.averageEntry))}<small>E1 $${escapeHtml(fmtPrice(trade.E1))} · E2 $${escapeHtml(fmtPrice(trade.E2))} · E3 $${escapeHtml(fmtPrice(trade.E3))}</small></td>
        <td><span style="color:#ef4444;">SL $${escapeHtml(fmtPrice(trade.SL))}</span><small style="color:#10b981;">TP $${escapeHtml(fmtPrice(trade.TP))}</small></td>
        <td><span class="${resultClass}">${escapeHtml(trade.result)}</span><small>${escapeHtml(trade.exitReason)}</small></td>
        <td><span class="${pnlClass}">${trade.pnl >= 0 ? '+' : ''}${escapeHtml(fmtUsd(trade.pnl))}</span><small>${trade.filled2 ? '' : 'Solo O1'}</small></td>
        <td>${escapeHtml(fmtUsd(trade.balance))}</td>
      </tr>`;
    }).join('');
  }

  function drawEquityCurve(result) {
    if (!equityCanvas) return;
    const ctx = equityCanvas.getContext('2d');
    const W = equityCanvas.width;
    const H = equityCanvas.height;
    const left = 58;
    const right = 18;
    const top = 18;
    const bottom = 28;
    const chartW = W - left - right;
    const chartH = H - top - bottom;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, W, H);

    const points = result.equity.length ? result.equity : [{ label: 'Inicio', balance: result.initialBalance }];
    const values = points.map((point) => point.balance);
    const minValue = Math.min(...values, result.initialBalance);
    const maxValue = Math.max(...values, result.initialBalance);
    const padding = Math.max((maxValue - minValue) * 0.15, maxValue * 0.02, 1);
    const rangeMin = minValue - padding;
    const rangeMax = maxValue + padding;
    const range = rangeMax - rangeMin || 1;
    const xOf = (index) => left + (points.length <= 1 ? chartW / 2 : (index / (points.length - 1)) * chartW);
    const yOf = (value) => top + chartH - (((value - rangeMin) / range) * chartH);

    ctx.strokeStyle = '#141c2b';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + chartW, y);
      ctx.stroke();
      ctx.fillStyle = '#6b7280';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'right';
      const value = rangeMax - ((range / 4) * i);
      ctx.fillText(fmtUsd(value), left - 6, y + 3);
    }

    const initialY = yOf(result.initialBalance);
    ctx.strokeStyle = 'rgba(209,213,219,.65)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(left, initialY);
    ctx.lineTo(left + chartW, initialY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Capital inicial ${fmtUsd(result.initialBalance)}`, left + 4, initialY - 5);

    if (points.length <= 1) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Sin operaciones para dibujar la curva de capital.', left + chartW / 2, top + chartH / 2);
      return;
    }

    const isPositive = result.finalBalance >= result.initialBalance;
    const lineColor = isPositive ? '#10b981' : '#ef4444';
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = xOf(index);
      const y = yOf(point.balance);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(xOf(points.length - 1), top + chartH);
    ctx.lineTo(xOf(0), top + chartH);
    ctx.closePath();
    ctx.fillStyle = isPositive ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)';
    ctx.fill();

    ctx.beginPath();
    points.forEach((point, index) => {
      const x = xOf(index);
      const y = yOf(point.balance);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    points.forEach((point, index) => {
      const x = xOf(index);
      const y = yOf(point.balance);
      ctx.beginPath();
      ctx.arc(x, y, index === points.length - 1 ? 4 : 2.4, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
    });

    ctx.fillStyle = lineColor;
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(fmtUsd(result.finalBalance), left + chartW, Math.max(top + 10, yOf(result.finalBalance) - 8));
    ctx.fillStyle = '#6b7280';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Inicio', left, H - 8);
    ctx.textAlign = 'right';
    ctx.fillText('Final', left + chartW, H - 8);
    ctx.textAlign = 'left';
  }

  async function runBacktestFromForm() {
    if (running) return;
    const config = readConfigFromForm();
    const validationError = validateConfig(config);
    if (validationError) {
      setBtStatus(validationError, '#ef4444');
      return;
    }
    running = true;
    if (runButton) {
      runButton.disabled = true;
      runButton.textContent = '⏳ Simulando…';
    }
    setBtStatus(`Descargando 500 velas de ${config.symbol}USDT en ${config.timeframe.toUpperCase()}…`, '#f59e0b');
    saveConfig(config);
    try {
      const candles = await fetchKlines(config.symbol, config.timeframe);
      const result = runBacktestEngine(candles, config);
      lastResult = result;
      renderMetrics(result);
      renderTrades(result.trades);
      drawEquityCurve(result);
      setBtStatus(
        result.trades.length
          ? `Backtest completado: ${result.trades.length} operaciones sobre ${candles.length} velas de ${config.symbol} ${config.timeframe.toUpperCase()}.`
          : `Backtest completado sin operaciones: ${candles.length} velas analizadas.`,
        result.trades.length ? '#10b981' : '#f59e0b'
      );
    } catch (error) {
      lastResult = null;
      setBtStatus(`No se pudo completar el backtest: ${error.message || 'error de datos'}.`, '#ef4444');
      if (tradesBody) tradesBody.innerHTML = '<tr><td colspan="7" class="bt-empty">No hay resultados. Revisa el activo, la conexión o prueba otra temporalidad.</td></tr>';
      const ctx = equityCanvas ? equityCanvas.getContext('2d') : null;
      if (ctx && equityCanvas) ctx.clearRect(0, 0, equityCanvas.width, equityCanvas.height);
    } finally {
      running = false;
      if (runButton) {
        runButton.disabled = false;
        runButton.textContent = '▶ Ejecutar backtest';
      }
    }
  }

  function resetBacktesterDefaults() {
    if (symbolInput) symbolInput.value = DEFAULT_CONFIG.symbol;
    if (timeframeInput) timeframeInput.value = DEFAULT_CONFIG.timeframe;
    if (capitalInput) capitalInput.value = DEFAULT_CONFIG.capital;
    if (riskInput) riskInput.value = DEFAULT_CONFIG.riskPct;
    if (atrMultInput) atrMultInput.value = DEFAULT_CONFIG.atrMult;
    if (rrInput) rrInput.value = DEFAULT_CONFIG.rr;
    setBtStatus('Valores por defecto restaurados. Pulsa Ejecutar backtest.', '#9ca3af');
  }

  runButton?.addEventListener('click', runBacktestFromForm);
  resetButton?.addEventListener('click', resetBacktesterDefaults);
  closeButton?.addEventListener('click', closeBacktester);
  overlay.addEventListener('click', closeBacktester);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.style.display === 'block') closeBacktester();
  });

  // --------------------------------------------------------------------------
  // DOCK MAESTRO
  // --------------------------------------------------------------------------
  const dock = document.createElement('div');
  dock.id = 'master-unified-bottom-dock';
  dock.setAttribute('role', 'toolbar');
  dock.setAttribute('aria-label', 'Herramientas maestras del dashboard');
  dock.innerHTML = `
    <button type="button" class="dock-btn is-primary" id="dock-open-smc" title="Abrir SMC & Radar 4H/1D"><span class="dock-icon">🏛️</span><span class="dock-label">SMC & Radar 4H/1D</span></button>
    <button type="button" class="dock-btn" id="dock-open-liq" title="Liquidaciones & ALT/BTC"><span class="dock-icon">🧲</span><span class="dock-label">Liquidaciones & ALT/BTC</span></button>
    <button type="button" class="dock-btn is-green" id="dock-open-backtester" title="Abrir Backtester de 500 velas"><span class="dock-icon">🧪</span><span class="dock-label">Backtester 500v</span></button>
    <button type="button" class="dock-btn is-amber" id="dock-open-alerts" title="Abrir Alertas & Telegram"><span class="dock-icon">🔔</span><span class="dock-label">Alertas & Telegram</span></button>
    <button type="button" class="dock-btn" id="dock-open-atr" title="Abrir Calculadora ATR + Bitácora"><span class="dock-icon">🧮</span><span class="dock-label">Calculadora ATR + Bitácora</span></button>
  `;
  document.body.appendChild(dock);

  function hideLegacyFloatingButtons() {
    LEGACY_FLOATERS.forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.style.setProperty('display', 'none', 'important');
    });
  }
  hideLegacyFloatingButtons();
  if (typeof MutationObserver === 'function') {
    let hideScheduled = false;
    const scheduleHideLegacy = () => {
      if (hideScheduled) return;
      hideScheduled = true;
      window.setTimeout(() => {
        hideScheduled = false;
        hideLegacyFloatingButtons();
      }, 180);
    };
    const observer = new MutationObserver(scheduleHideLegacy);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function showDockToast(text, color = '#60a5fa') {
    let toast = document.getElementById('dock-status-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'dock-status-toast';
      toast.className = 'dock-status-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.borderColor = color;
    toast.style.display = 'block';
    window.clearTimeout(dockToastTimer);
    dockToastTimer = window.setTimeout(() => {
      toast.style.display = 'none';
    }, 3200);
  }

  function clickWhenReady(id, fallback) {
    const existing = document.getElementById(id);
    if (existing) {
      existing.click();
      return;
    }
    let attempts = 0;
    const timer = window.setInterval(() => {
      const target = document.getElementById(id);
      if (target) {
        window.clearInterval(timer);
        target.click();
        return;
      }
      attempts += 1;
      if (attempts >= 30) {
        window.clearInterval(timer);
        if (typeof fallback === 'function') fallback();
      }
    }, 100);
  }

  function navigateToPanel(panelId) {
    const link = document.querySelector(`[data-panel-target="${panelId}"]`);
    if (link) link.click();
    else window.location.hash = panelId;
  }

  function scrollToElement(id) {
    const element = document.getElementById(id);
    if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return Boolean(element);
  }

  document.getElementById('dock-open-backtester')?.addEventListener('click', openBacktester);

  document.getElementById('dock-open-smc')?.addEventListener('click', () => {
    const target = document.getElementById('btn-open-smc-radar');
    if (target) {
      target.click();
      return;
    }
    navigateToPanel('panel-deep-dive');
    window.setTimeout(() => {
      if (!scrollToElement('smc-modules-wrapper')) {
        showDockToast('El módulo SMC & Radar aún no está disponible en esta página.', '#f59e0b');
      }
    }, 350);
  });

  document.getElementById('dock-open-liq')?.addEventListener('click', () => {
    const target = document.getElementById('btn-open-liq-altbtc');
    if (target) {
      target.click();
      return;
    }
    navigateToPanel('panel-market');
    window.setTimeout(() => {
      scrollToElement('delta-neutral-card');
      showDockToast('Módulo de Liquidaciones & ALT/BTC no instalado. Te llevo al monitor de futuros, funding y delta-neutral.', '#f59e0b');
    }, 350);
  });

  document.getElementById('dock-open-alerts')?.addEventListener('click', () => {
    clickWhenReady('btn-open-alerts-hub', () => {
      showDockToast('El módulo de Alertas & Telegram aún no está cargado. Reintenta en unos segundos.', '#f59e0b');
    });
  });

  document.getElementById('dock-open-atr')?.addEventListener('click', () => {
    clickWhenReady('btn-open-risk-calc', () => {
      showDockToast('La Calculadora ATR no está disponible en esta página.', '#f59e0b');
    });
  });

  window.quantBacktester = {
    open: openBacktester,
    close: closeBacktester,
    run: runBacktestFromForm,
    getLastResult: () => (lastResult ? { ...lastResult } : null),
    runEngine: runBacktestEngine,
    fetchKlines
  };
})();


// === ZONA RESERVADA PARA EXPANSIÓN DE FUTUROS MÓDULOS (PANEL 6+) ===

// ============================================================================
// MÓDULO 13 AUTO-INYECTABLE: RADAR BINANCE ALPHA (GANADORES Y PERDEDORES)
// + RADIOGRAFÍA HISTÓRICA EXACTA DE PRECIO, VOLUMEN Y MARKET CAP (24H/7D/30D/90D)
// (blindado: fetch con fallback /proxy → directo → AllOrigins, escape HTML,
//  delegación de eventos y caché 2 min.)
// ============================================================================
(function initBinanceAlphaRadarModule() {
    const oldModal = document.getElementById('binance-alpha-radar-modal');
    const oldDockBtn = document.getElementById('dock-btn-binance-alpha');
    const oldFallbackBtn = document.getElementById('btn-open-binance-alpha-fallback');
    if (oldModal) oldModal.remove();
    if (oldDockBtn) oldDockBtn.remove();
    if (oldFallbackBtn) oldFallbackBtn.remove();

    let alphaCoinsCache = [];
    let lastFetchTime = 0;
    const coinHistoryCache = new Map(); // Caché de 90d por moneda
    let currentFilterMode = 'GAINERS_24H';
    let currentSearch = '';

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    // Fetch con fallback (proxy local -> directo -> AllOrigins) y deteccion de 429.
    async function alphaFetchJson(url, timeoutMs = 25000) {
        if (typeof window.QuantCoingeckoKey === 'function' && String(url).includes('api.coingecko.com')) {
            const key = window.QuantCoingeckoKey();
            if (key) {
                const sep = String(url).includes('?') ? '&' : '?';
                url = url + sep + 'x_cg_demo_api_key=' + encodeURIComponent(key);
            }
        }
        const attempts = [];
        const local = typeof window.QuantLocalProxy === 'function' ? window.QuantLocalProxy(url) : null;
        if (local) attempts.push(local);
        attempts.push(url);
        attempts.push('https://api.allorigins.win/raw?url=' + encodeURIComponent(url));

        if (window.QuantFetch && typeof window.QuantFetch.first === 'function') {
            try {
                return await window.QuantFetch.first(attempts, { timeout: timeoutMs, cacheKey: 'alpha ' + url });
            } catch (e) {
                if (e && (e.status === 429 || /429/.test(String(e.message || '')))) {
                    throw new Error('Límite temporal de peticiones de CoinGecko alcanzado (429). Espera 45 segundos y pulsa Actualizar.');
                }
                throw e;
            }
        }

        let lastError = null;
        let saw429 = false;
        for (const target of attempts) {
            const controller = new AbortController();
            const timer = window.setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(target, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
                if (response.status === 429) { saw429 = true; throw new Error('HTTP 429'); }
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return await response.json();
            } catch (error) {
                lastError = error;
            } finally {
                window.clearTimeout(timer);
            }
        }
        if (saw429) throw new Error('Límite temporal de peticiones de CoinGecko alcanzado (429). Espera 45 segundos y pulsa Actualizar.');
        throw lastError || new Error('Sin respuesta de la API');
    }

    // 1. Ventana Modal del Módulo 13
    const modal = document.createElement('div');
    modal.id = 'binance-alpha-radar-modal';
    modal.style.cssText = 'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:999999;background:#0b0e14;border:2px solid #facc15;border-radius:12px;width:96%;max-width:1120px;color:#f3f4f6;font-family:sans-serif;box-shadow:0 25px 65px rgba(0,0,0,0.95);padding:20px;max-height:93vh;overflow-y:auto;';

    modal.innerHTML = `
        <!-- Cabecera -->
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1f2937;padding-bottom:12px;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
            <div>
                <h3 style="margin:0;color:#facc15;font-size:17px;">🌟 Módulo 13: Radar Binance Alpha — Ganadores, Perdedores & Radiografía 90D</h3>
                <span style="font-size:11px;color:#9ca3af;">Categoría oficial <code>binance-alpha-spotlight</code> (CoinGecko). Haz clic en cualquier activo para ver su crecimiento real de Precio, Volumen y Market Cap en 24h, 7d, 30d y 90d.</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                <button id="btn-refresh-alpha-list" style="background:#1f2937;color:#facc15;border:1px solid #facc15;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:bold;">🔄 Actualizar Lista</button>
                <button id="close-alpha-modal" style="background:#1f2937;color:#9ca3af;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:bold;">✕ Cerrar</button>
            </div>
        </div>

        <!-- Panel de Radiografía 24h / 7d / 30d / 90d (Se despliega al elegir una moneda) -->
        <div id="alpha-xray-panel" style="display:none;background:#111827;border:1px solid #facc15;border-radius:10px;padding:14px;margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
                <div id="alpha-xray-title" style="font-size:15px;font-weight:bold;color:#fff;">🔬 Radiografía Histórica</div>
                <button id="btn-close-alpha-xray" style="background:#1f2937;color:#9ca3af;border:none;padding:4px 9px;border-radius:5px;cursor:pointer;font-size:11px;">Ocultar Radiografía ▲</button>
            </div>
            <div id="alpha-xray-content" style="display:grid;grid-template-columns:1.35fr 1fr;gap:12px;align-items:center;"></div>
        </div>

        <!-- Barra de Filtros Rápidos y Buscador -->
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;background:#151924;padding:10px 12px;border-radius:8px;margin-bottom:10px;">
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="alpha-filter-btn" data-mode="GAINERS_24H" style="background:#10b981;color:#000;border:none;padding:6px 11px;border-radius:5px;font-size:11px;font-weight:bold;cursor:pointer;">🚀 Top Ganadores 24h</button>
                <button class="alpha-filter-btn" data-mode="LOSERS_24H" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:6px 11px;border-radius:5px;font-size:11px;font-weight:bold;cursor:pointer;">🩸 Top Perdedores 24h</button>
                <button class="alpha-filter-btn" data-mode="GAINERS_7D" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:6px 11px;border-radius:5px;font-size:11px;font-weight:bold;cursor:pointer;">🔥 Top 7 Días</button>
                <button class="alpha-filter-btn" data-mode="GAINERS_30D" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:6px 11px;border-radius:5px;font-size:11px;font-weight:bold;cursor:pointer;">💎 Top 30 Días</button>
                <button class="alpha-filter-btn" data-mode="VOL_DESC" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:6px 11px;border-radius:5px;font-size:11px;font-weight:bold;cursor:pointer;">📊 Mayor Volumen</button>
                <button class="alpha-filter-btn" data-mode="MCAP_DESC" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:6px 11px;border-radius:5px;font-size:11px;font-weight:bold;cursor:pointer;">🏛️ Mayor Market Cap</button>
            </div>
            <input id="alpha-search-input" type="text" placeholder="Buscar token Alpha..." style="background:#0b0e14;border:1px solid #374151;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;width:180px;" />
        </div>

        <div id="alpha-status-bar" style="font-size:11px;color:#9ca3af;margin-bottom:8px;">Listo para consultar el ecosistema Binance Alpha.</div>

        <!-- Tabla Principal -->
        <div style="overflow-x:auto;border:1px solid #1f2937;border-radius:8px;max-height:460px;overflow-y:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
                <thead style="position:sticky;top:0;background:#151924;color:#9ca3af;border-bottom:1px solid #1f2937;z-index:2;">
                    <tr>
                        <th style="padding:10px;"># / Activo Alpha</th>
                        <th style="padding:10px;">Precio USD</th>
                        <th style="padding:10px;">24h %</th>
                        <th style="padding:10px;">7d %</th>
                        <th style="padding:10px;">30d %</th>
                        <th style="padding:10px;">Volumen 24h</th>
                        <th style="padding:10px;">Market Cap (24h%)</th>
                        <th style="padding:10px;">Vol/MCap</th>
                        <th style="padding:10px;">Análisis 90D</th>
                    </tr>
                </thead>
                <tbody id="alpha-table-tbody"></tbody>
            </table>
        </div>
    `;
    document.body.appendChild(modal);

    // 2. Utilidades de Formato
    function fmtUSD(num) {
        if (num === null || num === undefined || isNaN(num)) return '-';
        if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return '$' + (num / 1e3).toFixed(1) + 'K';
        return '$' + num.toFixed(2);
    }

    function fmtPrice(p) {
        if (p === null || p === undefined || isNaN(p)) return '-';
        if (p < 0.0001) return '$' + p.toFixed(7);
        if (p < 0.01) return '$' + p.toFixed(5);
        if (p < 1) return '$' + p.toFixed(4);
        return '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function fmtPctBadge(val) {
        if (val === null || val === undefined || isNaN(val)) return '<span style="color:#6b7280;">N/A</span>';
        const color = val >= 0 ? '#10b981' : '#ef4444';
        const sign = val >= 0 ? '+' : '';
        return `<strong style="color:${color};">${sign}${val.toFixed(2)}%</strong>`;
    }

    // 3. Descargar Lista de Monedas Binance Alpha (CoinGecko)
    async function loadBinanceAlphaList(forceRefresh = false) {
        const statusEl = document.getElementById('alpha-status-bar');
        const tbody = document.getElementById('alpha-table-tbody');
        const now = Date.now();

        if (!forceRefresh && alphaCoinsCache.length > 0 && (now - lastFetchTime) < 120000) {
            renderAlphaTable();
            return;
        }

        statusEl.innerHTML = '⏳ Descargando ranking actualizado de monedas <strong>Binance Alpha</strong> desde CoinGecko...';
        tbody.innerHTML = `<tr><td colspan="9" style="padding:20px;text-align:center;color:#9ca3af;">Cargando mercado Binance Alpha (24h, 7d, 30d)...</td></tr>`;

        try {
            const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=binance-alpha-spotlight&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h,7d,30d';
            const data = await alphaFetchJson(url);
            if (!Array.isArray(data) || data.length === 0) {
                throw new Error('CoinGecko devolvió una lista vacía para la categoría.');
            }

            alphaCoinsCache = data;
            lastFetchTime = now;
            statusEl.innerHTML = `✅ <strong>${data.length} activos de Binance Alpha</strong> cargados (${new Date().toLocaleTimeString()}). Selecciona <strong>🔬 Ver 90d</strong> en cualquier fila para calcular cambios de Volumen y Market Cap a 7d, 30d y 90d.`;
            renderAlphaTable();
        } catch (err) {
            statusEl.innerHTML = `<span style="color:#ef4444;">⚠️ ${esc(err.message)}</span>`;
            tbody.innerHTML = `<tr><td colspan="9" style="padding:18px;text-align:center;color:#fca5a5;">${esc(err.message)}</td></tr>`;
        }
    }

    // 4. Renderizar Tabla Filtrada y Ordenada
    function renderAlphaTable() {
        const tbody = document.getElementById('alpha-table-tbody');
        let list = [...alphaCoinsCache];

        if (currentSearch) {
            const q = currentSearch.toLowerCase();
            list = list.filter(c => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q));
        }

        const getVal = (v, fallback) => (v === null || v === undefined || isNaN(v)) ? fallback : v;
        if (currentFilterMode === 'GAINERS_24H') {
            list.sort((a, b) => getVal(b.price_change_percentage_24h_in_currency, -9999) - getVal(a.price_change_percentage_24h_in_currency, -9999));
        } else if (currentFilterMode === 'LOSERS_24H') {
            list.sort((a, b) => getVal(a.price_change_percentage_24h_in_currency, 9999) - getVal(b.price_change_percentage_24h_in_currency, 9999));
        } else if (currentFilterMode === 'GAINERS_7D') {
            list.sort((a, b) => getVal(b.price_change_percentage_7d_in_currency, -9999) - getVal(a.price_change_percentage_7d_in_currency, -9999));
        } else if (currentFilterMode === 'GAINERS_30D') {
            list.sort((a, b) => getVal(b.price_change_percentage_30d_in_currency, -9999) - getVal(a.price_change_percentage_30d_in_currency, -9999));
        } else if (currentFilterMode === 'VOL_DESC') {
            list.sort((a, b) => getVal(b.total_volume, 0) - getVal(a.total_volume, 0));
        } else if (currentFilterMode === 'MCAP_DESC') {
            list.sort((a, b) => getVal(b.market_cap, 0) - getVal(a.market_cap, 0));
        }

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="padding:18px;text-align:center;color:#9ca3af;">No hay monedas que coincidan con la búsqueda.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map((c, idx) => {
            const volMcapRatio = (c.market_cap > 0 && c.total_volume > 0) ? ((c.total_volume / c.market_cap) * 100).toFixed(1) + '%' : '-';
            const highActivity = c.market_cap > 0 && (c.total_volume / c.market_cap) >= 0.35;

            return `
                <tr style="border-bottom:1px solid #1f2937;background:${idx < 3 && currentFilterMode.startsWith('GAINERS') ? 'rgba(6,78,59,0.22)' : (idx < 3 && currentFilterMode === 'LOSERS_24H' ? 'rgba(127,29,29,0.22)' : '#0b0e14')};">
                    <td style="padding:9px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="color:#6b7280;font-size:10px;width:18px;">${idx + 1}</span>
                            <img src="${esc(c.image)}" alt="" style="width:20px;height:20px;border-radius:50%;" />
                            <div>
                                <strong style="color:#fff;font-size:12px;">${esc(c.symbol.toUpperCase())}</strong>
                                <div style="font-size:10px;color:#9ca3af;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.name)}</div>
                            </div>
                        </div>
                    </td>
                    <td style="padding:9px;font-weight:bold;color:#fff;">${fmtPrice(c.current_price)}</td>
                    <td style="padding:9px;">${fmtPctBadge(c.price_change_percentage_24h_in_currency)}</td>
                    <td style="padding:9px;">${fmtPctBadge(c.price_change_percentage_7d_in_currency)}</td>
                    <td style="padding:9px;">${fmtPctBadge(c.price_change_percentage_30d_in_currency)}</td>
                    <td style="padding:9px;color:#60a5fa;font-weight:bold;">${fmtUSD(c.total_volume)}</td>
                    <td style="padding:9px;">
                        <div style="color:#d1d5db;">${fmtUSD(c.market_cap)}</div>
                        <div style="font-size:10px;">${fmtPctBadge(c.market_cap_change_percentage_24h)}</div>
                    </td>
                    <td style="padding:9px;color:${highActivity ? '#facc15' : '#9ca3af'};font-weight:${highActivity ? 'bold' : 'normal'};">
                        ${volMcapRatio} ${highActivity ? '🔥' : ''}
                    </td>
                    <td style="padding:9px;">
                        <button data-alpha-xray="${esc(c.id)}" style="background:#facc15;color:#000;border:none;padding:5px 10px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">
                            🔬 Ver 90d
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // 5. Cálculo Exacto de Variación por Timestamp (24h, 7d, 30d y 90d)
    function findClosestValueAtDaysAgo(series, daysAgo) {
        if (!Array.isArray(series) || series.length < 2) return null;
        const latestTs = series[series.length - 1][0];
        const targetTs = latestTs - (daysAgo * 86400 * 1000);
        const oldestTs = series[0][0];
        if (targetTs < oldestTs - (2 * 86400 * 1000)) return null;

        let closest = series[0];
        let minDiff = Math.abs(series[0][0] - targetTs);
        for (let i = 1; i < series.length; i++) {
            const diff = Math.abs(series[i][0] - targetTs);
            if (diff < minDiff) {
                minDiff = diff;
                closest = series[i];
            }
        }
        return closest[1];
    }

    function calcSeriesGrowthPct(series, daysAgo) {
        if (!Array.isArray(series) || series.length < 2) return null;
        const currentVal = series[series.length - 1][1];
        const pastVal = findClosestValueAtDaysAgo(series, daysAgo);
        if (pastVal === null || pastVal <= 0 || currentVal === null) return null;
        return ((currentVal - pastVal) / pastVal) * 100;
    }

    // 6. Radiografía Profunda de Precio, Volumen y Market Cap (24h, 7d, 30d, 90d)
    window.inspectBinanceAlphaCoin90d = async function(coinId) {
        const coin = alphaCoinsCache.find(c => c.id === coinId);
        if (!coin) return;

        const panel = document.getElementById('alpha-xray-panel');
        const titleEl = document.getElementById('alpha-xray-title');
        const contentEl = document.getElementById('alpha-xray-content');

        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        titleEl.innerHTML = `🔬 Radiografía 24h / 7d / 30d / 90d: <span style="color:#facc15;">${esc(coin.name)} (${esc(coin.symbol.toUpperCase())})</span>`;
        contentEl.innerHTML = `<div style="grid-column:span 2;color:#9ca3af;font-size:12px;padding:10px;">⏳ Descargando historial de 90 días (Precio, Volumen y Market Cap) desde CoinGecko...</div>`;

        try {
            let histData = coinHistoryCache.get(coinId);
            if (!histData) {
                const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=90`;
                histData = await alphaFetchJson(url, 30000);
                coinHistoryCache.set(coinId, histData);
            }

            const prices = histData.prices || [];
            const mcaps = histData.market_caps || [];
            const vols = histData.total_volumes || [];

            const metrics = [
                {
                    label: '💵 Precio USD',
                    now: fmtPrice(coin.current_price),
                    d1: coin.price_change_percentage_24h_in_currency ?? calcSeriesGrowthPct(prices, 1),
                    d7: coin.price_change_percentage_7d_in_currency ?? calcSeriesGrowthPct(prices, 7),
                    d30: coin.price_change_percentage_30d_in_currency ?? calcSeriesGrowthPct(prices, 30),
                    d90: calcSeriesGrowthPct(prices, 90)
                },
                {
                    label: '📊 Volumen Total',
                    now: fmtUSD(coin.total_volume),
                    d1: calcSeriesGrowthPct(vols, 1),
                    d7: calcSeriesGrowthPct(vols, 7),
                    d30: calcSeriesGrowthPct(vols, 30),
                    d90: calcSeriesGrowthPct(vols, 90)
                },
                {
                    label: '🏛️ Market Cap',
                    now: fmtUSD(coin.market_cap),
                    d1: coin.market_cap_change_percentage_24h ?? calcSeriesGrowthPct(mcaps, 1),
                    d7: calcSeriesGrowthPct(mcaps, 7),
                    d30: calcSeriesGrowthPct(mcaps, 30),
                    d90: calcSeriesGrowthPct(mcaps, 90)
                }
            ];

            contentEl.innerHTML = `
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;background:#0b0e14;border:1px solid #1f2937;border-radius:6px;">
                        <thead>
                            <tr style="background:#151924;color:#9ca3af;border-bottom:1px solid #1f2937;">
                                <th style="padding:8px;">Métrica</th>
                                <th style="padding:8px;">Actual</th>
                                <th style="padding:8px;">24 Horas</th>
                                <th style="padding:8px;">7 Días</th>
                                <th style="padding:8px;">30 Días</th>
                                <th style="padding:8px;">90 Días</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${metrics.map(m => `
                                <tr style="border-bottom:1px solid #1f2937;">
                                    <td style="padding:8px;font-weight:bold;color:#fff;">${m.label}</td>
                                    <td style="padding:8px;color:#60a5fa;font-weight:bold;">${m.now}</td>
                                    <td style="padding:8px;">${fmtPctBadge(m.d1)}</td>
                                    <td style="padding:8px;">${fmtPctBadge(m.d7)}</td>
                                    <td style="padding:8px;">${fmtPctBadge(m.d30)}</td>
                                    <td style="padding:8px;">${fmtPctBadge(m.d90)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <div style="font-size:10px;color:#9ca3af;margin-top:6px;">
                        * Si aparece <strong>N/A</strong> en 30d o 90d significa que el token Alpha se listó recientemente y aún no cumple esa antigüedad en el mercado.
                    </div>
                </div>
                <div style="background:#090d16;border:1px solid #1f2937;border-radius:8px;padding:8px;">
                    <div style="font-size:10px;color:#facc15;margin-bottom:4px;font-weight:bold;">Curva de Precio Histórica (Hasta 90 Días)</div>
                    <canvas id="alpha-xray-canvas" width="380" height="120" style="width:100%;height:120px;display:block;"></canvas>
                </div>
            `;

            drawAlphaMiniChart(prices);
        } catch (err) {
            contentEl.innerHTML = `<div style="grid-column:span 2;color:#fca5a5;font-size:12px;">⚠️ ${esc(err.message)}</div>`;
        }
    };

    function drawAlphaMiniChart(prices) {
        const canvas = document.getElementById('alpha-xray-canvas');
        if (!canvas || prices.length < 2) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        const vals = prices.map(p => p[1]);
        const minV = Math.min(...vals);
        const maxV = Math.max(...vals);
        const range = (maxV - minV) || 1;
        const isUp = vals[vals.length - 1] >= vals[0];
        const color = isUp ? '#10b981' : '#ef4444';

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        vals.forEach((v, i) => {
            const x = (i / (vals.length - 1)) * (W - 10) + 5;
            const y = H - 10 - (((v - minV) / range) * (H - 20));
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    // 7. Eventos de Filtros, Busqueda, Cierre y Radiografía (delegados)
    document.querySelectorAll('.alpha-filter-btn').forEach(btn => {
        btn.onclick = () => {
            currentFilterMode = btn.getAttribute('data-mode');
            document.querySelectorAll('.alpha-filter-btn').forEach(b => {
                b.style.background = '#1f2937'; b.style.color = '#d1d5db'; b.style.border = '1px solid #374151';
            });
            btn.style.background = currentFilterMode === 'LOSERS_24H' ? '#ef4444' : '#facc15';
            btn.style.color = currentFilterMode === 'LOSERS_24H' ? '#fff' : '#000';
            btn.style.border = 'none';
            renderAlphaTable();
        };
    });

    document.getElementById('alpha-search-input').addEventListener('input', (e) => {
        currentSearch = e.target.value.trim();
        renderAlphaTable();
    });

    document.getElementById('alpha-table-tbody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-alpha-xray]');
        if (btn) window.inspectBinanceAlphaCoin90d(btn.getAttribute('data-alpha-xray'));
    });

    document.getElementById('btn-refresh-alpha-list').onclick = () => loadBinanceAlphaList(true);
    document.getElementById('close-alpha-modal').onclick = () => { modal.style.display = 'none'; };
    document.getElementById('btn-close-alpha-xray').onclick = () => {
        document.getElementById('alpha-xray-panel').style.display = 'none';
    };

    function openAlphaModal() {
        const isHidden = modal.style.display === 'none';
        modal.style.display = isHidden ? 'block' : 'none';
        if (isHidden) loadBinanceAlphaList(false);
    }

    window.openBinanceAlphaRadar = openAlphaModal;

    // 8. Inyectar Botón directamente en el Dock Maestro Unificado (o botón flotante si no existe)
    setTimeout(() => {
        const dock = document.getElementById('master-unified-bottom-dock');
        if (dock) {
            const btn = document.createElement('button');
            btn.id = 'dock-btn-binance-alpha';
            btn.style.cssText = 'background:linear-gradient(135deg,#eab308,#ca8a04);color:#000;border:none;padding:6px 11px;border-radius:6px;font-size:11px;font-weight:bold;cursor:pointer;';
            btn.innerHTML = '🌟 Binance Alpha';
            btn.onclick = openAlphaModal;
            dock.appendChild(btn);
        } else {
            const fbBtn = document.createElement('button');
            fbBtn.id = 'btn-open-binance-alpha-fallback';
            fbBtn.style.cssText = 'position:fixed;bottom:65px;left:15px;z-index:999998;background:#eab308;color:#000;font-weight:bold;border:1px solid #fef08a;padding:9px 14px;border-radius:8px;font-size:12px;cursor:pointer;';
            fbBtn.innerHTML = '🌟 Binance Alpha';
            fbBtn.onclick = openAlphaModal;
            document.body.appendChild(fbBtn);
        }
    }, 1000);
})();

// ============================================================================
// PANEL 6 AUTO-INYECTABLE: PLAYBOOK TÁCTICO INSTITUCIONAL & FILTROS DE EJECUCIÓN
// Integrado como PANEL REAL en la barra lateral (índice 06, debajo de Airdrops).
// 4 pestañas: Shorts parabólicos · Fibonacci DCA · Radar Binance Alpha 100X · MM
// ============================================================================
(function initPanel6TacticalPlaybook() {
    // Idempotencia: limpia inyecciones previas.
    ['panel-playbook', 'nav-panel-playbook', 'mnav-panel-playbook'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function pfApplyCoinGeckoKey(url) {
        if (typeof window.QuantCoingeckoKey === 'function' && String(url).includes('api.coingecko.com')) {
            const key = window.QuantCoingeckoKey();
            if (key) {
                const sep = String(url).includes('?') ? '&' : '?';
                return url + sep + 'x_cg_demo_api_key=' + encodeURIComponent(key);
            }
        }
        return url;
    }

    async function pfFetch(url, timeoutMs = 20000) {
        url = pfApplyCoinGeckoKey(url);
        const attempts = [];
        const local = typeof window.QuantLocalProxy === 'function' ? window.QuantLocalProxy(url) : null;
        if (local) attempts.push(local);
        attempts.push(url);
        attempts.push('https://api.allorigins.win/raw?url=' + encodeURIComponent(url));

        if (window.QuantFetch && typeof window.QuantFetch.first === 'function') {
            return window.QuantFetch.first(attempts, { timeout: timeoutMs, cacheKey: 'p6 ' + url });
        }

        let lastError = null;
        for (const target of attempts) {
            const controller = new AbortController();
            const timer = window.setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(target, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return await response.json();
            } catch (error) {
                lastError = error;
            } finally {
                window.clearTimeout(timer);
            }
        }
        throw lastError || new Error('Sin respuesta de la API');
    }

    function fmtUSD(num) {
        if (num === null || num === undefined || isNaN(num)) return '-';
        const abs = Math.abs(num);
        if (abs >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
        if (abs >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
        if (abs >= 1e3) return '$' + (num / 1e3).toFixed(1) + 'K';
        return '$' + Number(num).toFixed(2);
    }

    function fmtPct(val, digits = 2) {
        if (val === null || val === undefined || isNaN(val)) return 'N/A';
        return (val >= 0 ? '+' : '') + Number(val).toFixed(digits) + '%';
    }

    function fmtCoinPrice(val) {
        const num = Number(val);
        if (!Number.isFinite(num)) return '-';
        if (num < 0.0001) return '$' + num.toFixed(7);
        if (num < 0.01) return '$' + num.toFixed(5);
        if (num < 1) return '$' + num.toFixed(4);
        return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // ------------------------------------------------------------------------
    // SECCIÓN DEL PANEL
    // ------------------------------------------------------------------------
    const section = document.createElement('section');
    section.className = 'view-panel';
    section.id = 'panel-playbook';
    section.setAttribute('data-panel', 'playbook');
    section.setAttribute('aria-labelledby', 'playbook-title');

    section.innerHTML = `
        <header class="section-heading">
            <div class="section-heading-copy">
                <div class="eyebrow"><span class="live-dot"></span> Panel 06 / Playbook táctico</div>
                <h2 id="playbook-title">Playbook Táctico Institucional</h2>
                <p>Shorts parabólicos · Fibonacci DCA · Radar Binance Alpha 100X · Manipulación de Market Makers.</p>
            </div>
            <div class="heading-actions">
                <span class="access-badge auto"><span class="access-dot"></span>Binance Futures + CoinGecko</span>
            </div>
        </header>

        <div class="card" style="padding:16px;margin-bottom:0;">
            <div id="p6-tabbar" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
                <button class="p6-tab" data-p6-tab="1" style="background:#3b82f6;color:#fff;border:none;padding:8px 12px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">🎯 Cazador de Shorts</button>
                <button class="p6-tab" data-p6-tab="2" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:8px 12px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">📐 Fibonacci DCA</button>
                <button class="p6-tab" data-p6-tab="3" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:8px 12px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">🚀 Radar Binance Alpha 100X</button>
                <button class="p6-tab" data-p6-tab="4" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:8px 12px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">🐋 Market Makers</button>
            </div>

            <!-- PESTAÑA 1 -->
            <div class="p6-pane" data-p6-pane="1">
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                    <button id="p6-scan-shorts" style="background:#3b82f6;color:#fff;border:none;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">🔍 Escanear Top Ganadores Futures</button>
                    <input id="p6-short-symbol" type="text" placeholder="o escribe un ticker (ej. PEPE)" style="background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px 10px;border-radius:6px;font-size:12px;width:180px;" />
                    <button id="p6-validate-symbol" style="background:#10b981;color:#000;border:none;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">Validar Ticker</button>
                </div>
                <div id="p6-shorts-status" style="font-size:11px;color:#9ca3af;margin-bottom:8px;">Pulsa "Escanear" para ver el Top 15 de Binance Futures por subida 24h.</div>
                <div id="p6-shorts-result" style="margin-bottom:10px;"></div>
                <div style="overflow-x:auto;border:1px solid #1f2937;border-radius:8px;max-height:420px;overflow-y:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
                        <thead style="position:sticky;top:0;background:#151924;color:#9ca3af;border-bottom:1px solid #1f2937;z-index:2;">
                            <tr>
                                <th style="padding:9px;">#</th><th style="padding:9px;">Par</th><th style="padding:9px;">Precio</th>
                                <th style="padding:9px;">24h %</th><th style="padding:9px;">Vol. 24h (USDT)</th><th style="padding:9px;">Acción</th>
                            </tr>
                        </thead>
                        <tbody id="p6-shorts-tbody"></tbody>
                    </table>
                </div>
            </div>

            <!-- PESTAÑA 2 -->
            <div class="p6-pane" data-p6-pane="2" style="display:none;">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px;">
                    <label style="font-size:11px;color:#9ca3af;">Activo (opcional)<input id="p6-fib-asset" type="text" placeholder="BTC" style="width:100%;margin-top:4px;background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px;border-radius:6px;font-size:12px;" /></label>
                    <label style="font-size:11px;color:#9ca3af;">Mínimo del Impulso (Low)<input id="p6-fib-low" type="number" step="any" placeholder="25000" style="width:100%;margin-top:4px;background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px;border-radius:6px;font-size:12px;" /></label>
                    <label style="font-size:11px;color:#9ca3af;">Máximo del Impulso (High)<input id="p6-fib-high" type="number" step="any" placeholder="40000" style="width:100%;margin-top:4px;background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px;border-radius:6px;font-size:12px;" /></label>
                    <label style="font-size:11px;color:#9ca3af;">Capital Total (USD)<input id="p6-fib-capital" type="number" step="any" placeholder="10000" style="width:100%;margin-top:4px;background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px;border-radius:6px;font-size:12px;" /></label>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
                    <button id="p6-fib-load" type="button" style="background:#3b82f6;color:#fff;border:none;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">🔄 Cargar impulso real (90d)</button>
                    <span id="p6-fib-status" style="font-size:11px;color:#9ca3af;">Se carga automáticamente con BTC; escribe otro activo y pulsa el botón para cambiarlo.</span>
                </div>
                <div id="p6-fib-output" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;"></div>
            </div>

            <!-- PESTAÑA 3 · RADAR BINANCE ALPHA 100X -->
            <div class="p6-pane" data-p6-pane="3" style="display:none;">
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                    <button id="p6-scan-alpha" style="background:#facc15;color:#000;border:none;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">🔍 Escanear Binance Alpha (Ready 100X)</button>
                    <button id="p6-alpha-refresh" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">🔄 Refrescar</button>
                </div>
                <div style="background:#151924;border:1px solid #facc15;border-radius:8px;padding:10px 12px;margin-bottom:10px;">
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <span style="font-size:12px;color:#facc15;font-weight:bold;">🔎 Analizar cualquier cripto:</span>
                        <input id="p6-custom-asset" type="text" placeholder="BTC, ETH, PEPE, ARB..." style="background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px 10px;border-radius:6px;font-size:12px;width:170px;" />
                        <button id="p6-analyze-custom" type="button" style="background:#facc15;color:#000;border:none;padding:7px 14px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">Analizar</button>
                        <span id="p6-custom-status" style="font-size:11px;color:#9ca3af;">Escribe un ticker o nombre y pulsa Analizar (o Enter).</span>
                    </div>
                    <div id="p6-custom-result" style="display:none;margin-top:10px;"></div>
                </div>
                <div id="p6-alpha-status" style="font-size:11px;color:#9ca3af;margin-bottom:8px;">Pulsa "Escanear" para puntuar cada activo de Binance Alpha según su probabilidad de explotar (0–100%).</div>
                <div id="p6-alpha-xray" style="display:none;margin-bottom:10px;"></div>
                <div style="overflow-x:auto;border:1px solid #1f2937;border-radius:8px;max-height:440px;overflow-y:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
                        <thead style="position:sticky;top:0;background:#151924;color:#9ca3af;border-bottom:1px solid #1f2937;z-index:2;">
                            <tr>
                                <th style="padding:9px;">#</th><th style="padding:9px;">Activo Alpha</th><th style="padding:9px;">Curva 7d</th>
                                <th style="padding:9px;">Readiness 100X</th><th style="padding:9px;">Desglose</th><th style="padding:9px;">Vol. 24h</th><th style="padding:9px;">Análisis</th>
                            </tr>
                        </thead>
                        <tbody id="p6-alpha-tbody"></tbody>
                    </table>
                </div>

                <div style="border-top:1px solid #1f2937;padding-top:12px;margin-top:14px;">
                    <h4 style="margin:0 0 8px;color:#10b981;font-size:13px;">➕ Añadir a Watchlist 100X</h4>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                        <input id="p6-wl-ticker" type="text" placeholder="Ticker (SOL)" style="background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px;border-radius:6px;font-size:12px;width:110px;" />
                        <input id="p6-wl-days" type="number" placeholder="Días en rango" style="background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px;border-radius:6px;font-size:12px;width:120px;" />
                        <input id="p6-wl-ceiling" type="text" placeholder="Techo Test Pump" style="background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px;border-radius:6px;font-size:12px;width:130px;" />
                        <input id="p6-wl-notes" type="text" placeholder="Notas" style="background:#0b0e14;border:1px solid #374151;color:#fff;padding:7px;border-radius:6px;font-size:12px;width:180px;" />
                        <button id="p6-wl-add" style="background:#3b82f6;color:#fff;border:none;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">Guardar</button>
                    </div>
                    <div id="p6-wl-status" style="font-size:11px;color:#9ca3af;margin-bottom:8px;"></div>
                    <div style="overflow-x:auto;border:1px solid #1f2937;border-radius:8px;">
                        <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
                            <thead style="background:#151924;color:#9ca3af;"><tr><th style="padding:8px;">Ticker</th><th style="padding:8px;">Días en rango</th><th style="padding:8px;">Techo Test Pump</th><th style="padding:8px;">Notas</th><th style="padding:8px;"></th></tr></thead>
                            <tbody id="p6-wl-tbody"></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- PESTAÑA 4 -->
            <div class="p6-pane" data-p6-pane="4" style="display:none;">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;" id="p6-mm-grid"></div>
            </div>
        </div>
    `;

    // Inyectar el panel después de Airdrops.
    const airdrops = document.getElementById('panel-airdrops');
    if (airdrops && airdrops.parentElement) {
        airdrops.parentElement.appendChild(section);
    } else {
        document.body.appendChild(section);
    }

    // ------------------------------------------------------------------------
    // ENLACES DE NAVEGACIÓN (barra lateral + nav móvil)
    // ------------------------------------------------------------------------
    function makeNavLink() {
        const a = document.createElement('a');
        a.className = 'nav-link';
        a.href = '#panel-playbook';
        a.setAttribute('data-panel-target', 'panel-playbook');
        a.innerHTML = `
            <span class="nav-index">06</span>
            <span class="nav-icon"><i data-lucide="target"></i></span>
            <span class="nav-copy"><strong>Playbook</strong><small>Shorts, DCA y MM</small></span>
            <i class="nav-chevron" data-lucide="chevron-right"></i>`;
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const sidebar = document.getElementById('app-sidebar');
            const scrim = document.getElementById('sidebar-scrim');
            if (sidebar) sidebar.classList.remove('is-open');
            if (scrim) scrim.classList.remove('is-open');
            if (window.location.hash === '#panel-playbook') {
                const panel = document.getElementById('panel-playbook');
                document.querySelectorAll('[data-panel-target]').forEach((l) => l.classList.toggle('is-active', l.dataset.panelTarget === 'panel-playbook'));
                document.querySelectorAll('.view-panel').forEach((p) => { if (p !== panel) p.classList.remove('is-active'); });
                if (panel) panel.classList.add('is-active');
            } else {
                window.location.hash = 'panel-playbook';
            }
            window.setTimeout(ensurePlaybookData, 140);
        });
        return a;
    }

    const sideNav = document.querySelector('nav.primary-nav a[data-panel-target="panel-airdrops"]');
    if (sideNav) sideNav.insertAdjacentElement('afterend', makeNavLink());
    const mobileNav = document.querySelector('.mobile-nav a[data-panel-target="panel-airdrops"]');
    if (mobileNav) mobileNav.insertAdjacentElement('afterend', makeNavLink());

    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();

    // Si se entra directo por #panel-playbook, el router inicial pudo ejecutarse
    // antes de inyectar este panel. Lo activamos explícitamente.
    if (window.location.hash === '#panel-playbook') {
        document.querySelectorAll('.view-panel').forEach((p) => p.classList.toggle('is-active', p === section));
        document.querySelectorAll('.nav-link, .mobile-nav a').forEach((link) => {
            const isActive = link.dataset.panelTarget === 'panel-playbook';
            link.classList.toggle('is-active', isActive);
            if (isActive) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
        document.body.dataset.activePanel = 'playbook';
    }

    // ------------------------------------------------------------------------
    // CAMBIO DE PESTAÑAS
    // ------------------------------------------------------------------------
    let p6CurrentTab = '1';
    let p6ShortsLoaded = false;
    let p6ShortsLoading = false;
    let p6FibAutoLoaded = false;
    let p6FibLoading = false;

    function switchTab(tab) {
        p6CurrentTab = tab;
        section.querySelectorAll('.p6-tab').forEach((b) => {
            const active = b.getAttribute('data-p6-tab') === tab;
            b.style.background = active ? '#3b82f6' : '#1f2937';
            b.style.color = active ? '#fff' : '#d1d5db';
            b.style.border = active ? 'none' : '1px solid #374151';
        });
        section.querySelectorAll('.p6-pane').forEach((p) => {
            p.style.display = p.getAttribute('data-p6-pane') === tab ? 'block' : 'none';
        });
        if (tab === '1' && !p6ShortsLoaded && !p6ShortsLoading) scanTopGainers();
        if (tab === '2' && !p6FibAutoLoaded && !p6FibLoading) autoFibFromMarket(false);
    }

    section.querySelector('#p6-tabbar').addEventListener('click', (e) => {
        const tab = e.target.closest('.p6-tab');
        if (tab) switchTab(tab.getAttribute('data-p6-tab'));
    });

    // ------------------------------------------------------------------------
    // PESTAÑA 1 · CAZADOR DE SHORTS PARABÓLICOS
    // ------------------------------------------------------------------------
    async function scanTopGainers() {
        if (p6ShortsLoading) return;
        p6ShortsLoading = true;
        const status = document.getElementById('p6-shorts-status');
        const tbody = document.getElementById('p6-shorts-tbody');
        status.innerHTML = '⏳ Descargando ticker/24hr de Binance Futures...';
        tbody.innerHTML = '';
        try {
            const data = await pfFetch('https://fapi.binance.com/fapi/v1/ticker/24hr', 20000);
            if (!Array.isArray(data)) throw new Error('Formato inesperado de Binance Futures');
            const usdt = data
                .filter((t) => String(t.symbol || '').endsWith('USDT'))
                .map((t) => ({ symbol: t.symbol, lastPrice: Number(t.lastPrice), pct: Number(t.priceChangePercent), quoteVol: Number(t.quoteVolume) }))
                .filter((t) => Number.isFinite(t.pct))
                .sort((a, b) => b.pct - a.pct)
                .slice(0, 15);
            renderShortsRows(usdt);
            status.innerHTML = `✅ Top ${usdt.length} pares USDT por subida 24h. Haz clic en una fila (o escribe un ticker) para validar en profundidad.`;
            p6ShortsLoaded = true;
        } catch (err) {
            status.innerHTML = `<span style="color:#ef4444;">⚠️ ${esc(err.message)}</span>`;
        } finally {
            p6ShortsLoading = false;
        }
    }

    function renderShortsRows(list) {
        const tbody = document.getElementById('p6-shorts-tbody');
        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="padding:14px;color:#9ca3af;">Sin datos.</td></tr>';
            return;
        }
        tbody.innerHTML = list.map((t, i) => {
            const hot = t.pct >= 200 ? 'rgba(153,27,27,0.35)' : (t.pct >= 100 ? 'rgba(120,53,15,0.28)' : 'transparent');
            const badge = t.pct >= 200 ? '🔥 +200%' : (t.pct >= 100 ? '🚀 +100%' : '');
            return `<tr style="border-bottom:1px solid #1f2937;background:${hot};cursor:pointer;" data-p6-short-row="${esc(t.symbol)}">
                <td style="padding:8px;color:#6b7280;">${i + 1}</td>
                <td style="padding:8px;font-weight:bold;color:#fff;">${esc(t.symbol)}</td>
                <td style="padding:8px;color:#d1d5db;">${Number(t.lastPrice).toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
                <td style="padding:8px;"><strong style="color:${t.pct >= 0 ? '#10b981' : '#ef4444'};">${fmtPct(t.pct)}</strong> ${badge}</td>
                <td style="padding:8px;color:#60a5fa;">${fmtUSD(t.quoteVol)}</td>
                <td style="padding:8px;"><button data-p6-short-validate="${esc(t.symbol)}" style="background:#3b82f6;color:#fff;border:none;padding:4px 9px;border-radius:5px;cursor:pointer;font-size:11px;">Validar</button></td>
            </tr>`;
        }).join('');
    }

    async function validateShort(symbolRaw) {
        let sym = String(symbolRaw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (sym.endsWith('USDT')) sym = sym.slice(0, -4);
        if (!/^[A-Z0-9]{2,15}$/.test(sym)) {
            document.getElementById('p6-shorts-result').innerHTML = '<div style="color:#f59e0b;">Ticker no válido.</div>';
            return;
        }
        const resultEl = document.getElementById('p6-shorts-result');
        resultEl.innerHTML = `<div style="color:#9ca3af;font-size:12px;">⏳ Validando ${esc(sym)}USDT (funding, open interest y datos CoinGecko)...</div>`;

        try {
            const [premium, oi, cg] = await Promise.allSettled([
                pfFetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}USDT`, 15000),
                pfFetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}USDT`, 15000),
                pfFetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&symbols=${encodeURIComponent(sym.toLowerCase())}&price_change_percentage=7d,30d`, 20000)
            ]);

            const fundingRate = premium.status === 'fulfilled' && premium.value ? Number(premium.value.lastFundingRate) : null;
            const openInterest = oi.status === 'fulfilled' && oi.value ? Number(oi.value.openInterest) : null;
            const cgList = cg.status === 'fulfilled' && Array.isArray(cg.value) ? cg.value : [];
            const coin = cgList.find((c) => String(c.symbol).toUpperCase() === sym) || cgList[0] || null;

            const price24h = coin && Number.isFinite(coin.price_change_percentage_24h) ? coin.price_change_percentage_24h : null;
            const pct7d = coin ? Number(coin.price_change_percentage_7d_in_currency) : null;
            const pct30d = coin ? Number(coin.price_change_percentage_30d_in_currency) : null;
            const marketCap = coin ? Number(coin.market_cap) : null;
            const volume = coin ? Number(coin.total_volume) : null;
            const currentPrice = coin ? Number(coin.current_price) : null;
            const ath = coin ? Number(coin.ath) : null;

            const rows = [];
            const push = (ok, warn, text) => rows.push({ ok, warn, na: /N\/A/.test(text), text });

            const parabolic = (price24h != null && price24h > 200);
            push(parabolic, !parabolic && price24h != null && price24h > 100, `Subida 24h > 200% (parabólica): ${price24h == null ? 'N/A' : fmtPct(price24h)}`);

            const perf = (pct7d != null && pct7d > 500) && (pct30d != null && pct30d > 700);
            push(perf, false, `Rendimiento 7D > 500% y 30D > 700%: ${fmtPct(pct7d)} / ${fmtPct(pct30d)}`);

            const liqOk = (marketCap != null && marketCap > 100e6);
            push(liqOk, !liqOk, `Market Cap > $100M (evitar baja liquidez): ${fmtUSD(marketCap)} · Vol. 24h ${fmtUSD(volume)}`);

            const belowAth = (ath != null && currentPrice != null && (1 - currentPrice / ath) > 0.5);
            push(!belowAth, belowAth, `Regla ATH: ${ath == null || currentPrice == null ? 'N/A' : `actual ${fmtUSD(currentPrice)} vs ATH ${fmtUSD(ath)} (${fmtPct(((currentPrice / ath) - 1) * 100)})`}`);

            const squeeze = (fundingRate != null && fundingRate < -0.0005);
            push(!squeeze, squeeze, `Riesgo short squeeze: funding ${fundingRate == null ? 'N/A' : fmtPct(fundingRate * 100)} (alerta si < -0.05%)`);

            const oiNote = openInterest == null ? 'Open Interest: N/A' : `Open Interest: ${fmtUSD(openInterest)}`;

            resultEl.innerHTML = `
                <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:12px;margin-bottom:6px;">
                    <div style="font-size:13px;font-weight:bold;color:#fff;margin-bottom:8px;">🔍 Validación profunda: ${esc(sym)}USDT</div>
                    <div style="display:grid;gap:5px;font-size:12px;">
                        ${rows.map((r) => {
                            const icon = r.na ? '⚪' : (r.warn ? '⚠️' : (r.ok ? '✅' : '❌'));
                            const color = r.na ? '#9ca3af' : (r.warn ? '#f59e0b' : (r.ok ? '#10b981' : '#ef4444'));
                            return `<div style="color:${color};">${icon} ${esc(r.text)}</div>`;
                        }).join('')}
                        <div style="color:#9ca3af;">ℹ️ ${esc(oiNote)}</div>
                    </div>
                    <label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-size:12px;color:#d1d5db;cursor:pointer;">
                        <input type="checkbox" id="p6-short-confirm" style="margin-top:2px;" />
                        <span>Confirmo debilidad, rechazo o ruptura de estructura en el gráfico (No entrar en máximos crecientes)</span>
                    </label>
                    <div id="p6-short-verdict" style="margin-top:10px;font-size:12px;color:#9ca3af;">Marca la casilla para obtener el veredicto final.</div>
                </div>`;

            const confirmBox = document.getElementById('p6-short-confirm');
            const verdict = document.getElementById('p6-short-verdict');
            const hardFail = belowAth;
            const warnings = rows.filter((r) => r.warn).length;
            const passes = rows.filter((r) => r.ok).length;
            const total = rows.length;

            const updateVerdict = () => {
                if (hardFail) {
                    verdict.innerHTML = '<span style="color:#ef4444;font-weight:bold;">❌ NO SHORTEAR: Activo >50% debajo de su ATH.</span>';
                    return;
                }
                if (!confirmBox.checked) {
                    verdict.innerHTML = '<span style="color:#9ca3af;">Marca la casilla de confirmación manual para continuar.</span>';
                    return;
                }
                if (warnings > 0) {
                    verdict.innerHTML = '<span style="color:#f59e0b;font-weight:bold;">⚠️ Setup con riesgos: ' + warnings + ' advertencia(s) activa(s). Reduce tamaño o espera confirmación.</span>';
                } else if (passes >= total - 1) {
                    verdict.innerHTML = '<span style="color:#10b981;font-weight:bold;">✅ Setup válido bajo filtros. Gestiona tamaño y stop.</span>';
                } else {
                    verdict.innerHTML = '<span style="color:#ef4444;font-weight:bold;">❌ No cumple los filtros mínimos.</span>';
                }
            };
            confirmBox.addEventListener('change', updateVerdict);
            updateVerdict();
        } catch (err) {
            resultEl.innerHTML = `<div style="color:#ef4444;">⚠️ ${esc(err.message)}</div>`;
        }
    }

    document.getElementById('p6-scan-shorts').onclick = scanTopGainers;
    document.getElementById('p6-validate-symbol').onclick = () => validateShort(document.getElementById('p6-short-symbol').value);

    document.getElementById('p6-shorts-tbody').addEventListener('click', (e) => {
        const valBtn = e.target.closest('[data-p6-short-validate]');
        const row = e.target.closest('[data-p6-short-row]');
        if (valBtn) validateShort(valBtn.getAttribute('data-p6-short-validate'));
        else if (row) validateShort(row.getAttribute('data-p6-short-row'));
    });

    // ------------------------------------------------------------------------
    // PESTAÑA 2 · FIBONACCI + PLAN DCA
    // ------------------------------------------------------------------------
    const FIB_LEVELS = [
        { ratio: 0.382, title: '38.2% — Fortaleza Agresiva', psych: 'Compradores hambrientos. Tendencia fuerte, pero no es precio de ganga.', dca: 0 },
        { ratio: 0.5, title: '50.0% — Territorio Neutral', psych: 'Mitad del movimiento. Zona de indecisión, requiere confirmación.', dca: 0 },
        { ratio: 0.618, title: '61.8% — La Proporción Áurea', psych: 'Zona de acumulación institucional. Equilibrio óptimo entre riesgo y oportunidad.', dca: 0.4 },
        { ratio: 0.786, title: '78.6% — El Verdadero Regalo', psych: 'Pánico extremo / mejor punto de entrada histórica.', dca: 0.6 }
    ];

    function renderFib() {
        const out = document.getElementById('p6-fib-output');
        const low = Number(document.getElementById('p6-fib-low').value);
        const high = Number(document.getElementById('p6-fib-high').value);
        const capital = Number(document.getElementById('p6-fib-capital').value);

        if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
            out.innerHTML = '<div style="grid-column:1/-1;color:#9ca3af;font-size:12px;">Introduce Low y High válidos (High > Low) para calcular los retrocesos.</div>';
            return;
        }
        const range = high - low;
        const cap = Number.isFinite(capital) && capital > 0 ? capital : null;

        const cards = FIB_LEVELS.map((lvl) => {
            const price = high - range * lvl.ratio;
            let dcaHtml = '';
            if (lvl.dca > 0 && cap) {
                const amount = cap * lvl.dca;
                const units = price > 0 ? amount / price : 0;
                dcaHtml = `<div style="margin-top:8px;padding:8px;background:#0b0e14;border-radius:6px;font-size:11px;">
                    <div style="color:#10b981;font-weight:bold;">DCA ${Math.round(lvl.dca * 100)}% = ${fmtUSD(amount)}</div>
                    <div style="color:#9ca3af;">≈ ${units.toFixed(units < 0.01 ? 6 : 2)} unidades a ${price.toLocaleString('en-US', { maximumFractionDigits: 6 })}</div>
                </div>`;
            }
            return `<div style="background:#111827;border:1px solid ${lvl.dca > 0 ? '#3b82f6' : '#1f2937'};border-radius:8px;padding:12px;">
                <div style="color:#3b82f6;font-weight:bold;font-size:12px;">${lvl.title}</div>
                <div style="color:#fff;font-size:20px;font-weight:bold;margin:6px 0;">${price.toLocaleString('en-US', { maximumFractionDigits: 6 })}</div>
                <div style="color:#9ca3af;font-size:11px;">${esc(lvl.psych)}</div>
                ${dcaHtml}
            </div>`;
        }).join('');

        const invalidation = `<div style="grid-column:1/-1;background:#3b0d0d;border:1px solid #ef4444;border-radius:8px;padding:12px;color:#fca5a5;font-size:12px;">
            ⛔ <strong>Invalidación:</strong> un cierre sólido por debajo del <strong>78.6% (${(high - range * 0.786).toLocaleString('en-US', { maximumFractionDigits: 6 })})</strong> invalida la tesis alcista y activa el plan de salida.
        </div>`;

        out.innerHTML = cards + invalidation;
    }

    ['p6-fib-low', 'p6-fib-high', 'p6-fib-capital'].forEach((id) => {
        document.getElementById(id).addEventListener('input', renderFib);
    });

    function p6FibSymbol() {
        return String(document.getElementById('p6-fib-asset').value || '')
            .trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/USDT$/, '') || 'BTC';
    }

    async function autoFibFromMarket(force) {
        const lowEl = document.getElementById('p6-fib-low');
        const highEl = document.getElementById('p6-fib-high');
        const status = document.getElementById('p6-fib-status');
        if (!force && lowEl.value && highEl.value) {
            p6FibAutoLoaded = true;
            renderFib();
            return;
        }
        if (p6FibLoading) return;
        p6FibLoading = true;
        const symbol = p6FibSymbol();
        if (status) status.innerHTML = `⏳ Cargando el impulso de 90 días de ${esc(symbol)}USDT desde Binance...`;
        try {
            const rows = await pfFetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=90`, 20000);
            if (!Array.isArray(rows) || rows.length < 10) throw new Error('Sin velas suficientes para ' + symbol + 'USDT');
            const lows = rows.map((r) => Number(r[3])).filter(Number.isFinite);
            const highs = rows.map((r) => Number(r[2])).filter(Number.isFinite);
            const low = Math.min(...lows);
            const high = Math.max(...highs);
            if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) throw new Error('Rango de impulso inválido');
            lowEl.value = String(low);
            highEl.value = String(high);
            const capEl = document.getElementById('p6-fib-capital');
            if (!capEl.value) capEl.value = '10000';
            renderFib();
            p6FibAutoLoaded = true;
            if (status) status.innerHTML = `<span style="color:#10b981;">✅ ${esc(symbol)}USDT · mínimo ${fmtUSD(low)} / máximo ${fmtUSD(high)} en los últimos 90 días.</span>`;
        } catch (error) {
            if (status) status.innerHTML = `<span style="color:#ef4444;">⚠️ ${esc(error.message)}. Escribe Low/High manualmente.</span>`;
        } finally {
            p6FibLoading = false;
        }
    }

    document.getElementById('p6-fib-load').addEventListener('click', () => autoFibFromMarket(true));
    document.getElementById('p6-fib-asset').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            autoFibFromMarket(true);
        }
    });

    renderFib();

    function ensurePlaybookData() {
        const panel = document.getElementById('panel-playbook');
        if (!panel || !panel.classList.contains('is-active')) return;
        if (p6CurrentTab === '1' && !p6ShortsLoaded && !p6ShortsLoading) scanTopGainers();
        if (p6CurrentTab === '2' && !p6FibAutoLoaded && !p6FibLoading) autoFibFromMarket(false);
    }

    window.setTimeout(ensurePlaybookData, 700);
    window.addEventListener('hashchange', () => window.setTimeout(ensurePlaybookData, 140));

    // ------------------------------------------------------------------------
    // PESTAÑA 3 · RADAR BINANCE ALPHA 100X (automático + gráficos)
    // ------------------------------------------------------------------------
    const WL_KEY = 'crypto_100x_testpump_watchlist_v1';

    let alpha100x = [];
    let alpha100xAt = 0;

    function sparklineSvg(points, w, h, color) {
        if (!Array.isArray(points) || points.length < 2) return '';
        const vals = points.map(Number).filter(Number.isFinite);
        if (vals.length < 2) return '';
        const min = Math.min(...vals), max = Math.max(...vals);
        const range = (max - min) || 1;
        const pts = vals.map((v, i) => {
            const x = 1 + (i / (vals.length - 1)) * (w - 2);
            const y = h - 2 - ((v - min) / range) * (h - 4);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
    }

    const MET_ICON = { yes: '✅', partial: '⚠️', no: '❌' };
    const MET_COLOR = { yes: '#10b981', partial: '#f59e0b', no: '#ef4444' };
    const MET_SHORT = { acumulacion: 'Acum', noExplotada: 'NoExp', testPump: 'TPump', liquidez: 'Liq' };

    function computeReadiness(coin) {
        const sparkRaw = coin.sparkline_in_7d && Array.isArray(coin.sparkline_in_7d.price) ? coin.sparkline_in_7d.price : [];
        const spark = sparkRaw.map(Number).filter(Number.isFinite);
        const pct7d = coin.price_change_percentage_7d_in_currency;
        const pct30d = coin.price_change_percentage_30d_in_currency;
        const mcap = Number(coin.market_cap);
        const vol = Number(coin.total_volume);

        const parts = { acumulacion: 0, noExplotada: 0, testPump: 0, liquidez: 0 };
        const checks = [];

        // 1) Acumulación (0-25): baja volatilidad del sparkline 7d
        let cv = null;
        if (spark.length >= 8) {
            const mean = spark.reduce((a, b) => a + b, 0) / spark.length;
            const std = Math.sqrt(spark.reduce((a, b) => a + (b - mean) * (b - mean), 0) / spark.length);
            cv = mean > 0 ? std / mean : 1;
            parts.acumulacion = Math.round(Math.max(0, Math.min(25, ((0.30 - cv) / 0.30) * 25)));
        }
        checks.push({
            key: 'acumulacion', label: 'Acumulación (consolidación)', pts: parts.acumulacion, max: 25,
            met: parts.acumulacion >= 20 ? 'yes' : (parts.acumulacion >= 10 ? 'partial' : 'no'),
            why: cv == null
                ? 'Sin curva de 7d suficiente para medir la consolidación.'
                : `Volatilidad 7d (CV) ${(cv * 100).toFixed(1)}% → ${cv < 0.08 ? 'consolidación clara' : (cv < 0.2 ? 'rango moderado' : 'mucha volatilidad')}.`
        });

        // 2) No explotada aún (0-25)
        const d7 = Number.isFinite(pct7d) ? pct7d : 999;
        const d30 = Number.isFinite(pct30d) ? pct30d : 999;
        if (d7 > 200 || d30 > 700) parts.noExplotada = 0;
        else if (d7 > 100 || d30 > 300) parts.noExplotada = 10;
        else if (d7 > 40 || d30 > 120) parts.noExplotada = 18;
        else parts.noExplotada = 25;
        checks.push({
            key: 'noExplotada', label: 'No explotada aún', pts: parts.noExplotada, max: 25,
            met: parts.noExplotada === 25 ? 'yes' : (parts.noExplotada > 0 ? 'partial' : 'no'),
            why: `7d ${Number.isFinite(pct7d) ? fmtPct(pct7d) : 'N/A'} · 30d ${Number.isFinite(pct30d) ? fmtPct(pct30d) : 'N/A'} → ${parts.noExplotada === 25 ? 'aún no ha despegado' : (parts.noExplotada === 0 ? 'ya explotó' : 'fase intermedia')}.`
        });

        // 3) Test pump (0-25): pico del sparkline que retrajo
        let tpMax = null, tpMedian = null, tpLast = null;
        if (spark.length >= 8) {
            const sorted = [...spark].sort((a, b) => a - b);
            tpMedian = sorted[Math.floor(sorted.length / 2)];
            tpMax = Math.max(...spark);
            tpLast = spark[spark.length - 1];
            if (tpMax > tpMedian * 1.20 && tpLast < tpMax) parts.testPump = 25;
            else if (tpMax > tpMedian * 1.20) parts.testPump = 10;
        }
        checks.push({
            key: 'testPump', label: 'Test Pump', pts: parts.testPump, max: 25,
            met: parts.testPump === 25 ? 'yes' : (parts.testPump === 10 ? 'partial' : 'no'),
            why: tpMax == null
                ? 'Sin curva de 7d suficiente para detectar el test pump.'
                : `Pico ${fmtCoinPrice(tpMax)} (${fmtPct(((tpMax / tpMedian) - 1) * 100)} vs mediana) y ${tpLast < tpMax ? 'ya retrajo al rango' : 'aún no retrae'}.`
        });

        // 4) Liquidez (0-25)
        if (mcap >= 100e6) parts.liquidez += 15;
        else if (mcap >= 20e6) parts.liquidez += 10;
        else if (mcap >= 5e6) parts.liquidez += 5;
        if (vol >= 1e6) parts.liquidez += 10;
        else if (vol >= 2e5) parts.liquidez += 5;
        checks.push({
            key: 'liquidez', label: 'Liquidez', pts: parts.liquidez, max: 25,
            met: parts.liquidez >= 20 ? 'yes' : (parts.liquidez >= 10 ? 'partial' : 'no'),
            why: `${mcap > 0 ? `Market Cap ${fmtUSD(mcap)}` : 'Market Cap no disponible'} + Vol. 24h ${fmtUSD(vol)}.`
        });

        const score = parts.acumulacion + parts.noExplotada + parts.testPump + parts.liquidez;
        return { score, parts, spark, checks };
    }

    function scoreColor(s) {
        if (s >= 75) return '#10b981';
        if (s >= 55) return '#facc15';
        return '#ef4444';
    }

    async function scanAlpha100x(force) {
        const status = document.getElementById('p6-alpha-status');
        const tbody = document.getElementById('p6-alpha-tbody');
        const now = Date.now();
        if (!force && alpha100x.length && (now - alpha100xAt) < 120000) {
            renderAlpha100x();
            return;
        }
        status.innerHTML = '⏳ Descargando lista Binance Alpha (con sparkline 7d) y puntuando cada activo...';
        tbody.innerHTML = '<tr><td colspan="7" style="padding:16px;color:#9ca3af;">Cargando y calculando Readiness 100X...</td></tr>';
        try {
            const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=binance-alpha-spotlight&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h,7d,30d';
            const data = await pfFetch(url, 25000);
            if (!Array.isArray(data) || !data.length) throw new Error('Lista vacía de Binance Alpha');
            alpha100x = data.map((c) => ({ coin: c, r: computeReadiness(c) })).sort((a, b) => b.r.score - a.r.score);
            alpha100xAt = now;
            renderAlpha100x();
            status.innerHTML = `✅ ${data.length} activos de Binance Alpha puntuados. <strong>Readiness</strong> = % de condiciones para un movimiento 100X. Pulsa <strong>🔬 90d</strong> para ver el gráfico y la afirmación de cada activo.`;
        } catch (e) {
            status.innerHTML = `<span style="color:#ef4444;">⚠️ ${esc(e.message)}</span>`;
            tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:#fca5a5;">${esc(e.message)}</td></tr>`;
        }
    }

    function renderAlpha100x() {
        const tbody = document.getElementById('p6-alpha-tbody');
        if (!alpha100x.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="padding:14px;color:#9ca3af;">Sin datos. Pulsa Escanear.</td></tr>';
            return;
        }
        const chip = (label, val) => `<span style="display:inline-block;font-size:9px;color:#9ca3af;background:#0b0e14;border:1px solid #1f2937;border-radius:4px;padding:1px 4px;margin:1px;">${label} ${val}</span>`;
        tbody.innerHTML = alpha100x.map((row, i) => {
            const c = row.coin, r = row.r;
            const color = scoreColor(r.score);
            const up = (c.price_change_percentage_7d_in_currency || 0) >= 0;
            return `<tr data-p6-alpha90="${esc(c.id)}" style="border-bottom:1px solid #1f2937;background:${r.score >= 75 ? 'rgba(6,78,59,0.18)' : 'transparent'};cursor:pointer;">
                <td style="padding:8px;color:#6b7280;">${i + 1}</td>
                <td style="padding:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <img src="${esc(c.image)}" alt="" style="width:20px;height:20px;border-radius:50%;" />
                        <div><strong style="color:#fff;">${esc(c.symbol.toUpperCase())}</strong><div style="font-size:10px;color:#9ca3af;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.name)}</div></div>
                    </div>
                </td>
                <td style="padding:8px;">${sparklineSvg(r.spark, 110, 30, up ? '#10b981' : '#ef4444')}<span style="font-size:10px;color:${up ? '#10b981' : '#ef4444'};">${fmtPct(c.price_change_percentage_7d_in_currency)}</span></td>
                <td style="padding:8px;min-width:120px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:16px;font-weight:bold;color:${color};">${r.score}%</span>
                        <div style="flex:1;height:8px;background:#1f2937;border-radius:5px;overflow:hidden;"><div style="height:100%;width:${r.score}%;background:${color};"></div></div>
                    </div>
                </td>
                <td style="padding:8px;">${r.checks.map((ch) => `<span title="${esc(ch.why)}" style="display:inline-block;font-size:9px;color:${MET_COLOR[ch.met]};background:#0b0e14;border:1px solid #1f2937;border-radius:4px;padding:1px 4px;margin:1px;cursor:help;">${MET_ICON[ch.met]} ${MET_SHORT[ch.key]} ${ch.pts}</span>`).join('')}</td>
                <td style="padding:8px;color:#60a5fa;">${fmtUSD(c.total_volume)}</td>
                <td style="padding:8px;"><button data-p6-alpha90="${esc(c.id)}" style="background:#facc15;color:#000;border:none;padding:4px 9px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">🔬 90d</button></td>
            </tr>`;
        }).join('');
    }

    function xray90Svg(prices, lo, hi, max, current, testPump) {
        const W = 620, H = 180, pad = 8;
        const vals = prices.map((p) => Number(p[1])).filter(Number.isFinite);
        if (vals.length < 2) return '';
        const step = Math.max(1, Math.floor(vals.length / 160));
        const down = [];
        for (let i = 0; i < vals.length; i += step) down.push(vals[i]);
        if (down[down.length - 1] !== vals[vals.length - 1]) down.push(vals[vals.length - 1]);
        const min = Math.min(...down), maxV = Math.max(...down);
        const range = (maxV - min) || 1;
        const y = (v) => pad + (1 - (v - min) / range) * (H - pad * 2);
        const pts = down.map((v, i) => `${(pad + (i / (down.length - 1)) * (W - pad * 2)).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
        const yLo = y(Math.max(lo, min));
        const yHi = y(Math.min(hi, maxV));
        const bandTop = Math.min(yLo, yHi);
        const bandH = Math.abs(yHi - yLo);
        const yCur = y(current);
        return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:180px;background:#090d16;border-radius:8px;">
            <rect x="${pad}" y="${bandTop}" width="${W - pad * 2}" height="${Math.max(bandH, 1)}" fill="#3b82f6" opacity="0.12"/>
            <line x1="${pad}" y1="${yLo}" x2="${W - pad}" y2="${yLo}" stroke="#3b82f6" stroke-dasharray="4 3" stroke-width="1"/>
            <line x1="${pad}" y1="${yHi}" x2="${W - pad}" y2="${yHi}" stroke="#3b82f6" stroke-dasharray="4 3" stroke-width="1"/>
            <polyline points="${pts}" fill="none" stroke="#f43f5e" stroke-width="1.8"/>
            <line x1="${pad}" y1="${yCur}" x2="${W - pad}" y2="${yCur}" stroke="#10b981" stroke-width="1" stroke-dasharray="3 3"/>
            ${testPump ? `<text x="${W / 2}" y="14" fill="#f43f5e" font-size="11" font-weight="bold" text-anchor="middle">TEST PUMP ${fmtUSD(max)}</text>` : ''}
            <text x="${pad}" y="${H - 3}" fill="#9ca3af" font-size="9">rango ${fmtUSD(lo)}–${fmtUSD(hi)} · actual ${fmtUSD(current)}</text>
        </svg>`;
    }

    async function analyzeAlpha90d(coinId) {
        const entry = alpha100x.find((r) => r.coin.id === coinId);
        if (!entry) return;
        const coin = entry.coin;
        const xray = document.getElementById('p6-alpha-xray');
        xray.style.display = 'block';
        xray.innerHTML = `<div style="color:#9ca3af;font-size:12px;">⏳ Descargando 90 días de ${esc(coin.symbol.toUpperCase())}...</div>`;
        xray.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        try {
            const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=90`;
            const hist = await pfFetch(url, 30000);
            const prices = (hist && Array.isArray(hist.prices)) ? hist.prices : [];
            if (prices.length < 10) throw new Error('Historial insuficiente para este activo.');

            const vals = prices.map((p) => Number(p[1])).filter(Number.isFinite);
            const sorted = [...vals].sort((a, b) => a - b);
            const lo = sorted[Math.floor(sorted.length * 0.05)];
            const hi = sorted[Math.floor(sorted.length * 0.95)];
            const max = Math.max(...vals);
            const current = vals[vals.length - 1];
            const testPump = max > hi * 1.15 && current < max;
            const drawdown = ((max - current) / max) * 100;

            const claim = testPump
                ? `Se detecta un <strong>Test Pump</strong> en ${fmtUSD(max)} (${fmtPct(((max / hi) - 1) * 100)} sobre el techo del rango), que ya retrajo al nivel actual.`
                : `No se detecta un Test Pump claro sobre el rango en los últimos 90 días.`;

            xray.innerHTML = `
                <div style="background:#111827;border:1px solid #facc15;border-radius:8px;padding:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
                        <div style="font-weight:bold;color:#fff;">🔬 ${esc(coin.name)} (${esc(coin.symbol.toUpperCase())}) · 90 días</div>
                        <div style="font-size:12px;color:#facc15;">Readiness ${entry.r.score}%</div>
                    </div>
                    ${xray90Svg(prices, lo, hi, max, current, testPump)}
                    <div style="margin-top:10px;border-top:1px solid #1f2937;padding-top:8px;">
                        <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">🧩 Condiciones evaluadas (qué se cumple y por qué)</div>
                        ${entry.r.checks.map((ch) => `
                            <div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px solid #1f2937;">
                                <span style="font-size:12px;">${MET_ICON[ch.met]}</span>
                                <div style="flex:1;">
                                    <div style="font-size:12px;color:#fff;">${esc(ch.label)} <span style="color:${MET_COLOR[ch.met]};">${ch.pts}/${ch.max}</span></div>
                                    <div style="font-size:10px;color:#9ca3af;">${esc(ch.why)}</div>
                                </div>
                            </div>`).join('')}
                    </div>
                    <div style="font-size:11px;color:#d1d5db;margin-top:8px;line-height:1.6;">
                        <div>📦 Rango de acumulación (5%–95%): <strong style="color:#fff;">${fmtUSD(lo)} – ${fmtUSD(hi)}</strong></div>
                        <div>🧪 ${claim}</div>
                        <div>📉 Drawdown desde el máximo 90d: <strong style="color:${drawdown > 50 ? '#ef4444' : '#10b981'};">-${drawdown.toFixed(1)}%</strong></div>
                        <div>💧 Market Cap ${fmtUSD(coin.market_cap)} · Vol. 24h ${fmtUSD(coin.total_volume)}</div>
                        <div style="color:#9ca3af;margin-top:4px;">* Rango estimado con los percentiles 5% y 95% del historial de 90 días.</div>
                    </div>
                    ${entryPlanHtml(coin, lo, hi, max, current)}
                </div>`;
        } catch (e) {
            xray.innerHTML = `<div style="color:#ef4444;font-size:12px;">⚠️ ${esc(e.message)}</div>`;
        }
    }

    // ------------------------------------------------------------------------
    // ANÁLISIS DE CUALQUIER CRIPTO CON EL MISMO MOTOR DE READINESS 100X
    // ------------------------------------------------------------------------
    function customPrice(p) {
        return fmtCoinPrice(p);
    }

    function custom90Svg(prices, lo, hi, max, current, testPump) {
        const W = 620, H = 180, pad = 8;
        const vals = prices.map((p) => Number(p[1])).filter(Number.isFinite);
        if (vals.length < 2) return '';
        const step = Math.max(1, Math.floor(vals.length / 160));
        const down = [];
        for (let i = 0; i < vals.length; i += step) down.push(vals[i]);
        if (down[down.length - 1] !== vals[vals.length - 1]) down.push(vals[vals.length - 1]);
        const min = Math.min(...down), maxV = Math.max(...down);
        const range = (maxV - min) || 1;
        const y = (v) => pad + (1 - (v - min) / range) * (H - pad * 2);
        const pts = down.map((v, i) => `${(pad + (i / (down.length - 1)) * (W - pad * 2)).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
        const yLo = y(Math.max(lo, min));
        const yHi = y(Math.min(hi, maxV));
        const bandTop = Math.min(yLo, yHi);
        const bandH = Math.abs(yHi - yLo);
        const yCur = y(current);
        return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:180px;background:#090d16;border-radius:8px;">
            <rect x="${pad}" y="${bandTop}" width="${W - pad * 2}" height="${Math.max(bandH, 1)}" fill="#3b82f6" opacity="0.12"/>
            <line x1="${pad}" y1="${yLo}" x2="${W - pad}" y2="${yLo}" stroke="#3b82f6" stroke-dasharray="4 3" stroke-width="1"/>
            <line x1="${pad}" y1="${yHi}" x2="${W - pad}" y2="${yHi}" stroke="#3b82f6" stroke-dasharray="4 3" stroke-width="1"/>
            <polyline points="${pts}" fill="none" stroke="#f43f5e" stroke-width="1.8"/>
            <line x1="${pad}" y1="${yCur}" x2="${W - pad}" y2="${yCur}" stroke="#10b981" stroke-width="1" stroke-dasharray="3 3"/>
            ${testPump ? `<text x="${W / 2}" y="14" fill="#f43f5e" font-size="11" font-weight="bold" text-anchor="middle">TEST PUMP ${customPrice(max)}</text>` : ''}
            <text x="${pad}" y="${H - 3}" fill="#9ca3af" font-size="9">rango ${customPrice(lo)}–${customPrice(hi)} · actual ${customPrice(current)}</text>
        </svg>`;
    }

    function entryPlanHtml(coin, lo, hi, max, current) {
        const span = Math.max(hi - lo, 1e-12);
        const invalidation = lo * 0.97;
        const target1 = Math.max(hi, current * 1.03);
        const target2 = Math.max(max, target1 * 1.02);
        const defs = [
            { ratio: 0.382, label: '38.2%', tag: 'Entrada temprana', weight: 15 },
            { ratio: 0.5, label: '50.0%', tag: 'Equilibrio', weight: 20 },
            { ratio: 0.618, label: '61.8%', tag: 'Golden Pocket · mejor R:R', weight: 30 },
            { ratio: 0.786, label: '78.6%', tag: 'Máxima acumulación', weight: 25 },
            { ratio: null, label: 'Soporte 90d', tag: 'Mínimo del rango · última defensa', weight: 10 }
        ];
        const rows = defs.map((d) => {
            const price = d.ratio == null ? lo : hi - span * d.ratio;
            const dist = ((price / current) - 1) * 100;
            const buyable = price <= current * 1.005;
            let state, color;
            if (!buyable) { state = `Solo si recupera +${dist.toFixed(1)}%`; color = '#f59e0b'; }
            else if (dist >= -1.5) { state = '✅ Precio en zona'; color = '#facc15'; }
            else { state = `Comprar ${Math.abs(dist).toFixed(1)}% abajo`; color = '#60a5fa'; }
            const risk = price - invalidation;
            const rr = risk > 0 ? (target1 - price) / risk : null;
            return { ...d, price, dist, state, color, rr, buyable };
        });

        let bestPrice = null;
        let best;
        if (current < lo) {
            best = { color: '#ef4444', text: `⚠️ El precio está por debajo del mínimo de 90 días (${customPrice(lo)}). Estructura rota: no promedies a la baja sin una reconquista diaria de ${customPrice(lo)} con volumen. Los niveles de abajo solo son válidos si el precio recupera ese soporte.` };
        } else {
            const buys = rows.filter((r) => r.buyable).sort((a, b) => b.price - a.price);
            const inZone = buys.find((r) => Math.abs(r.dist) <= 1.5);
            if (inZone) {
                bestPrice = inZone.price;
                best = { color: '#facc15', text: `✅ Precio dentro del ${inZone.label} (${inZone.tag}): válido escalonar 1/3 ahora y reservar el resto para 61.8%, 78.6% y el soporte de 90d.` };
            } else if (buys.length) {
                const nearest = buys[0];
                bestPrice = nearest.price;
                best = { color: '#60a5fa', text: `🎯 Mejor entrada ahora: orden límite en ${customPrice(nearest.price)} (${nearest.label} · ${nearest.tag}), un ${Math.abs(nearest.dist).toFixed(1)}% por debajo del precio actual. El resto del capital, escalonado hacia el soporte de 90d (${customPrice(lo)}).` };
            } else {
                best = { color: '#10b981', text: `✅ Precio por debajo de todas las zonas Fibonacci: descuento profundo. Acumula con el 10% del soporte y espera reconquista de ${customPrice(lo)} para confirmar estructura.` };
            }
        }

        const fmtTarget = (target) => {
            const pct = ((target / current) - 1) * 100;
            return `${customPrice(target)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
        };

        return `
            <div style="margin-top:8px;background:#0b0e14;border:1px solid #374151;border-radius:8px;padding:10px;">
                <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;align-items:center;">
                    <div style="font-size:11px;color:#facc15;font-weight:bold;">🎯 Puntos de entrada mejor posicionados</div>
                    <div style="font-size:10px;color:#9ca3af;">Fibonacci del impulso 90d: ${customPrice(lo)} → ${customPrice(hi)}</div>
                </div>
                <div style="font-size:10px;color:${best.color};background:${best.color}14;border:1px solid ${best.color}55;border-radius:6px;padding:6px 8px;margin:7px 0;line-height:1.45;">${best.text}</div>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:10px;text-align:left;">
                        <thead><tr style="color:#6b7280;border-bottom:1px solid #1f2937;">
                            <th style="padding:4px;">Zona</th><th style="padding:4px;">Precio</th><th style="padding:4px;">Desde actual</th>
                            <th style="padding:4px;">Estado</th><th style="padding:4px;">DCA</th><th style="padding:4px;">R:R vs techo</th>
                        </tr></thead>
                        <tbody>${rows.map((r) => `<tr style="border-bottom:1px solid #111827;background:${r.price === bestPrice ? 'rgba(250,204,21,0.08)' : 'transparent'};">
                            <td style="padding:4px;color:#fff;font-weight:bold;">${r.label} <span style="color:#6b7280;font-weight:normal;">${r.tag}</span></td>
                            <td style="padding:4px;color:#e5e7eb;">${customPrice(r.price)}</td>
                            <td style="padding:4px;color:${r.color};">${r.dist >= 0 ? '+' : ''}${r.dist.toFixed(1)}%</td>
                            <td style="padding:4px;color:${r.color};">${r.state}</td>
                            <td style="padding:4px;color:#facc15;">${r.weight}%</td>
                            <td style="padding:4px;color:#9ca3af;">${r.rr && r.rr > 0 ? r.rr.toFixed(2) + 'x' : '—'}</td>
                        </tr>`).join('')}</tbody>
                    </table>
                </div>
                <div style="font-size:10px;color:#d1d5db;margin-top:6px;line-height:1.55;">
                    <div>📌 Plan DCA: reparte el capital <strong>15% / 20% / 30% / 25% / 10%</strong> en 38.2%, 50%, 61.8%, 78.6% y soporte de 90d.</div>
                    <div>🎯 Objetivo 1 (techo del rango): <strong>${fmtTarget(target1)}</strong> · Objetivo 2 (máximo/Test Pump): <strong>${fmtTarget(target2)}</strong>.</div>
                    <div>🛑 Invalidación: cierre diario por debajo de <strong>${customPrice(invalidation)}</strong> (−3% del mínimo de 90d).</div>
                </div>
            </div>`;
    }

    function renderEntryPlan(coin, lo, hi, max, current) {
        const el = document.getElementById('p6-custom-entries');
        if (!el) return;
        el.innerHTML = entryPlanHtml(coin, lo, hi, max, current);
    }

    async function loadCustom90d(coin) {
        const el = document.getElementById('p6-custom-90d');
        if (!el) return;
        el.innerHTML = '<div style="font-size:10px;color:#9ca3af;">⏳ Cargando gráfico de 90 días...</div>';
        try {
            let vals = [];
            let historySource = '';
            const isBinance = Boolean(coin.binanceSymbol);
            const binSym = coin.binanceSymbol || (String(coin.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '') + 'USDT');
            const loadBinanceHistory = async () => {
                const rows = await pfFetch(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(binSym)}&interval=1d&limit=90`, 25000);
                return (Array.isArray(rows) ? rows : []).map((k) => Number(k[4])).filter(Number.isFinite);
            };
            if (!isBinance) {
                try {
                    const cgId = coin.coingeckoId || coin.id;
                    const hist = await pfFetch(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=90`, 30000);
                    vals = (hist && Array.isArray(hist.prices) ? hist.prices : []).map((p) => Number(p[1])).filter(Number.isFinite);
                    historySource = 'CoinGecko';
                } catch (cgHistoryError) {
                    vals = await loadBinanceHistory();
                    historySource = 'Binance (CoinGecko limitado)';
                }
            } else {
                vals = await loadBinanceHistory();
                historySource = 'Binance';
            }
            if (vals.length < 10) throw new Error('Historial de 90 días insuficiente');
            const sorted = [...vals].sort((a, b) => a - b);
            const lo = sorted[Math.floor(sorted.length * 0.05)];
            const hi = sorted[Math.floor(sorted.length * 0.95)];
            const max = Math.max(...vals);
            const current = vals[vals.length - 1];
            const testPump = max > hi * 1.15 && current < max;
            const drawdown = ((max - current) / max) * 100;
            const prices = vals.map((v, i) => [i, v]);
            renderEntryPlan(coin, lo, hi, max, current);
            el.innerHTML = `
                <div style="font-size:10px;color:#9ca3af;margin:4px 0;">📈 Últimos 90 días · ${esc(historySource)} · rango de acumulación (5%–95%) y Test Pump</div>
                ${custom90Svg(prices, lo, hi, max, current, testPump)}
                <div style="font-size:10px;color:#d1d5db;margin-top:4px;">Rango ${customPrice(lo)} – ${customPrice(hi)} · Drawdown ${drawdown.toFixed(1)}% · ${testPump ? 'Test Pump detectado' : 'Sin Test Pump claro'}</div>`;
        } catch (e) {
            el.innerHTML = `<div style="font-size:10px;color:#ef4444;">⚠️ No se pudo cargar el gráfico: ${esc(e.message)}</div>`;
            const entries = document.getElementById('p6-custom-entries');
            if (entries) entries.innerHTML = `<div style="font-size:10px;color:#ef4444;margin-top:6px;">⚠️ Sin historial de 90 días no se pueden calcular los puntos de entrada.</div>`;
        }
    }

    function renderCustomAnalysis(coin, r, source) {
        const box = document.getElementById('p6-custom-result');
        const color = scoreColor(r.score);
        const level = r.score >= 75 ? 'ALTA' : (r.score >= 55 ? 'MEDIA' : 'BAJA');
        const sym = String(coin.symbol || '').toUpperCase();
        const pct24 = Number(coin.price_change_percentage_24h_in_currency);
        const pct7 = Number(coin.price_change_percentage_7d_in_currency);
        const pct30 = Number(coin.price_change_percentage_30d_in_currency);
        const volMcap = (Number(coin.market_cap) > 0 && Number(coin.total_volume) > 0)
            ? ((Number(coin.total_volume) / Number(coin.market_cap)) * 100).toFixed(1) + '%'
            : 'N/D';
        const passed = r.checks.filter((ch) => ch.met === 'yes').length;
        const partial = r.checks.filter((ch) => ch.met === 'partial').length;
        const failed = r.checks.filter((ch) => ch.met === 'no').length;
        const chip = (label, val, colorChip) => `<span style="display:inline-block;font-size:10px;background:#0b0e14;border:1px solid #1f2937;border-radius:5px;padding:2px 7px;margin:2px;"><span style="color:#6b7280;">${esc(label)}</span> <strong style="color:${colorChip || '#e5e7eb'};">${val}</strong></span>`;

        box.style.display = 'block';
        box.innerHTML = `
            <div style="background:#111827;border:1px solid #facc15;border-radius:8px;padding:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        ${coin.image ? `<img src="${esc(coin.image)}" alt="" style="width:24px;height:24px;border-radius:50%;" />` : ''}
                        <div>
                            <div style="font-weight:bold;color:#fff;font-size:14px;">${esc(sym)} <span style="font-size:11px;color:#9ca3af;font-weight:normal;">${esc(coin.name || '')}</span></div>
                            <div style="font-size:11px;color:#9ca3af;">${customPrice(Number(coin.current_price))} · fuente: ${esc(source)}</div>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;">Cumplimiento 100X</div>
                        <div style="font-size:26px;font-weight:bold;color:${color};line-height:1.1;">${r.score}%</div>
                        <div style="font-size:10px;color:${color};font-weight:bold;">Nivel ${level}</div>
                    </div>
                </div>
                <div style="height:9px;background:#1f2937;border-radius:5px;overflow:hidden;margin:8px 0 10px;">
                    <div style="height:100%;width:${r.score}%;background:${color};"></div>
                </div>
                <div style="margin-bottom:10px;">
                    ${chip('24h', isFinite(pct24) ? fmtPct(pct24) : 'N/A', pct24 >= 0 ? '#10b981' : '#ef4444')}
                    ${chip('7d', isFinite(pct7) ? fmtPct(pct7) : 'N/A', pct7 >= 0 ? '#10b981' : '#ef4444')}
                    ${chip('30d', isFinite(pct30) ? fmtPct(pct30) : 'N/A', pct30 >= 0 ? '#10b981' : '#ef4444')}
                    ${chip('Market Cap', Number(coin.market_cap) > 0 ? fmtUSD(Number(coin.market_cap)) : 'N/D')}
                    ${chip('Vol. 24h', fmtUSD(Number(coin.total_volume)))}
                    ${chip('Vol/MCap', volMcap)}
                </div>
                <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">🧩 Parámetros evaluados · <span style="color:#10b981;">${passed} cumplidos</span> · <span style="color:#f59e0b;">${partial} parciales</span> · <span style="color:#ef4444;">${failed} fallidos</span></div>
                ${r.checks.map((ch) => {
                    const pct = Math.round((ch.pts / ch.max) * 100);
                    return `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid #1f2937;">
                        <span style="font-size:13px;">${MET_ICON[ch.met]}</span>
                        <div style="flex:1;min-width:0;">
                            <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#fff;">
                                <span>${esc(ch.label)}</span>
                                <span style="color:${MET_COLOR[ch.met]};font-weight:bold;white-space:nowrap;">${ch.pts}/${ch.max} · ${pct}%</span>
                            </div>
                            <div style="height:5px;background:#1f2937;border-radius:4px;overflow:hidden;margin:3px 0;">
                                <div style="height:100%;width:${pct}%;background:${MET_COLOR[ch.met]};"></div>
                            </div>
                            <div style="font-size:10px;color:#9ca3af;">${esc(ch.why)}</div>
                        </div>
                    </div>`;
                }).join('')}
                <div id="p6-custom-entries" style="margin-top:8px;"></div>
                <div id="p6-custom-90d" style="margin-top:8px;"></div>
                <div style="font-size:9px;color:#6b7280;margin-top:6px;">Score = Acumulación (25) + No explotada (25) + Test Pump (25) + Liquidez (25). Cada bloque muestra su porcentaje de cumplimiento.</div>
            </div>`;
        loadCustom90d(coin);
    }

    async function resolveCoinGeckoCoin(query) {
        const search = await pfFetch('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(query), 20000);
        const coins = (search && Array.isArray(search.coins)) ? search.coins : [];
        if (!coins.length) throw new Error('CoinGecko no encontró "' + query + '"');
        const exact = coins.filter((c) => String(c.symbol || '').toLowerCase() === query.toLowerCase());
        const pool = (exact.length ? exact : coins).slice().sort((a, b) => (a.market_cap_rank || 1e9) - (b.market_cap_rank || 1e9));
        const pick = pool[0];
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(pick.id)}&sparkline=true&price_change_percentage=24h,7d,30d`;
        const data = await pfFetch(url, 25000);
        if (!Array.isArray(data) || !data.length) throw new Error('Sin datos de mercado para ' + pick.symbol);
        const coin = data[0];
        coin.coingeckoId = pick.id;
        return coin;
    }

    async function binanceFallbackCoin(query) {
        const raw = String(query).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/USDT$/, '');
        if (!raw) throw new Error('Escribe una cripto válida');
        const symbol = raw + 'USDT';
        const [ticker, klines] = await Promise.all([
            pfFetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, 15000),
            pfFetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=90`, 20000)
        ]);
        const closes = (Array.isArray(klines) ? klines : []).map((k) => Number(k[4])).filter(Number.isFinite);
        if (closes.length < 30) throw new Error('Binance no tiene historial suficiente para ' + symbol);
        const back = (n) => {
            const i = closes.length - 1 - n;
            return i >= 0 ? ((closes[closes.length - 1] / closes[i]) - 1) * 100 : null;
        };
        return {
            id: 'binance:' + symbol,
            binanceSymbol: symbol,
            coingeckoId: null,
            symbol: raw.toLowerCase(),
            name: raw + ' (Binance Spot)',
            image: '',
            current_price: Number(ticker.lastPrice) || closes[closes.length - 1],
            market_cap: 0,
            total_volume: Number(ticker.quoteVolume) || 0,
            price_change_percentage_24h_in_currency: Number(ticker.priceChangePercent),
            price_change_percentage_7d_in_currency: back(7),
            price_change_percentage_30d_in_currency: back(30),
            sparkline_in_7d: { price: closes.slice(-14) }
        };
    }

    function withTimeout(promise, ms) {
        return new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error('Tiempo de espera agotado')), ms);
            promise.then((value) => { window.clearTimeout(timer); resolve(value); },
                         (error) => { window.clearTimeout(timer); reject(error); });
        });
    }

    let customRequestSeq = 0;

    async function analyzeCustomAsset() {
        const input = document.getElementById('p6-custom-asset');
        const status = document.getElementById('p6-custom-status');
        const box = document.getElementById('p6-custom-result');
        const btn = document.getElementById('p6-analyze-custom');
        const query = (input.value || '').trim();
        if (!query) {
            status.innerHTML = '<span style="color:#ef4444;">Escribe un ticker o nombre.</span>';
            input.focus();
            return;
        }
        if (btn.disabled) return;
        btn.disabled = true;
        const token = ++customRequestSeq;
        const isCurrent = () => token === customRequestSeq;
        status.innerHTML = `⏳ Analizando ${esc(query.toUpperCase())} con Binance y CoinGecko...`;
        try {
            const q = query.toLowerCase();
            const cached = alpha100x.map((row) => row.coin).find((c) => c.sparkline_in_7d && String(c.symbol || '').toLowerCase() === q);
            if (cached) {
                renderCustomAnalysis(cached, computeReadiness(cached), 'lista Binance Alpha cargada');
                status.innerHTML = `<span style="color:#10b981;">✅ ${esc(String(cached.symbol || '').toUpperCase())} analizada · lista Binance Alpha.</span>`;
                return;
            }

            // Binance responde primero (rápido) y CoinGecko llega después con el Market Cap real.
            const cgPromise = resolveCoinGeckoCoin(query);
            cgPromise.catch(() => {});
            let binanceCoin = null;
            try { binanceCoin = await binanceFallbackCoin(query); } catch (e) { binanceCoin = null; }
            if (!isCurrent()) return;

            if (binanceCoin) {
                renderCustomAnalysis(binanceCoin, computeReadiness(binanceCoin), 'Binance Spot · Market Cap pendiente');
                status.innerHTML = `✅ ${esc(String(binanceCoin.symbol || '').toUpperCase())} analizada con Binance · completando Market Cap con CoinGecko...`;
                btn.disabled = false;
            } else {
                status.innerHTML = `⏳ Binance no cotiza ${esc(query.toUpperCase())}USDT; consultando CoinGecko...`;
            }

            let cgCoin = null;
            try {
                cgCoin = await withTimeout(cgPromise, 45000);
            } catch (cgError) {
                cgCoin = null;
            }
            if (!isCurrent()) return;

            if (cgCoin) {
                renderCustomAnalysis(cgCoin, computeReadiness(cgCoin), 'CoinGecko');
                status.innerHTML = `<span style="color:#10b981;">✅ ${esc(String(cgCoin.symbol || '').toUpperCase())} analizada · CoinGecko (Market Cap incluido).</span>`;
            } else if (binanceCoin) {
                status.innerHTML = `<span style="color:#f59e0b;">⚠️ ${esc(String(binanceCoin.symbol || '').toUpperCase())}: CoinGecko no respondió; score calculado solo con Binance (sin Market Cap).</span>`;
            } else {
                throw new Error('No se encontró el activo en Binance ni en CoinGecko');
            }
        } catch (error) {
            if (!isCurrent()) return;
            box.style.display = 'block';
            box.innerHTML = `<div style="color:#ef4444;font-size:12px;">⚠️ ${esc(error.message)}. Prueba con el ticker exacto (ej. PEPE) o espera unos segundos si CoinGecko está limitado.</div>`;
            status.innerHTML = '<span style="color:#ef4444;">No se pudo analizar el activo.</span>';
        } finally {
            btn.disabled = false;
        }
    }

    document.getElementById('p6-analyze-custom').addEventListener('click', analyzeCustomAsset);
    document.getElementById('p6-custom-asset').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            analyzeCustomAsset();
        }
    });

    document.getElementById('p6-scan-alpha').onclick = () => scanAlpha100x(false);
    document.getElementById('p6-alpha-refresh').onclick = () => scanAlpha100x(true);
    document.getElementById('p6-alpha-tbody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-p6-alpha90]');
        if (btn) analyzeAlpha90d(btn.getAttribute('data-p6-alpha90'));
    });

    // --- Watchlist (persistente) ---
    function readWatchlist() {
        try { return JSON.parse(localStorage.getItem(WL_KEY) || '[]'); } catch (e) { return []; }
    }
    function writeWatchlist(list) {
        try { localStorage.setItem(WL_KEY, JSON.stringify(list)); } catch (e) {}
    }

    function renderWatchlist() {
        const tbody = document.getElementById('p6-wl-tbody');
        const list = readWatchlist();
        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="padding:12px;color:#9ca3af;">Watchlist vacía. Añade tu primera moneda en vigilancia.</td></tr>';
            return;
        }
        tbody.innerHTML = list.map((w) => `
            <tr style="border-bottom:1px solid #1f2937;">
                <td style="padding:8px;font-weight:bold;color:#fff;">${esc(w.ticker)}</td>
                <td style="padding:8px;color:#d1d5db;">${esc(w.days)}</td>
                <td style="padding:8px;color:#facc15;">${esc(w.ceiling)}</td>
                <td style="padding:8px;color:#9ca3af;">${esc(w.notes)}</td>
                <td style="padding:8px;"><button data-p6-wl-del="${esc(w.id)}" style="background:#1f2937;color:#ef4444;border:none;padding:4px 9px;border-radius:5px;cursor:pointer;font-size:11px;">✕</button></td>
            </tr>`).join('');
    }

    function addWatchlist() {
        const ticker = document.getElementById('p6-wl-ticker').value.trim().toUpperCase();
        if (!ticker) {
            document.getElementById('p6-wl-status').innerHTML = '<span style="color:#ef4444;">Escribe al menos un ticker.</span>';
            return;
        }
        const item = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            ticker,
            days: document.getElementById('p6-wl-days').value.trim(),
            ceiling: document.getElementById('p6-wl-ceiling').value.trim(),
            notes: document.getElementById('p6-wl-notes').value.trim()
        };
        const list = readWatchlist();
        list.unshift(item);
        writeWatchlist(list);
        ['p6-wl-ticker', 'p6-wl-days', 'p6-wl-ceiling', 'p6-wl-notes'].forEach((id) => { document.getElementById(id).value = ''; });
        document.getElementById('p6-wl-status').innerHTML = `<span style="color:#10b981;">${esc(ticker)} añadida a la watchlist.</span>`;
        renderWatchlist();
    }

    renderWatchlist();
    document.getElementById('p6-wl-add').onclick = addWatchlist;
    document.getElementById('p6-wl-tbody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-p6-wl-del]');
        if (!btn) return;
        const list = readWatchlist().filter((w) => w.id !== btn.getAttribute('data-p6-wl-del'));
        writeWatchlist(list);
        renderWatchlist();
    });

    // ------------------------------------------------------------------------
    // PESTAÑA 4 · PATRONES DE MANIPULACIÓN DE MARKET MAKERS (SVG)
    // ------------------------------------------------------------------------
    function mmSvg(path, labels) {
        return `<svg viewBox="0 0 300 170" preserveAspectRatio="none" style="width:100%;height:170px;display:block;background:#090d16;border-radius:8px;">
            <rect width="300" height="170" fill="#090d16"/>
            <path d="${path}" fill="none" stroke="#f43f5e" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
            ${labels.map((l) => `<text x="${l.x}" y="${l.y}" fill="#fff" font-size="10" font-family="sans-serif" font-weight="bold">${l.text}</text>`).join('')}
        </svg>`;
    }

    function renderMmCards() {
        const grid = document.getElementById('p6-mm-grid');
        const cards = [
            {
                name: 'DWF LABS',
                path: 'M15,120 L70,120 L82,108 L95,122 L130,72 L150,66 L180,30 L180,150',
                labels: [{ x: 120, y: 20, text: 'FLASH DUMP' }, { x: 20, y: 140, text: 'Consolidación' }],
                rule: 'No perseguir velas verdes; asegurar ganancias agresivas en resistencias y usar Trailing Stop ajustado.'
            },
            {
                name: 'WINTERMUTE',
                path: 'M15,130 L60,110 L75,40 L85,115 L115,95 L135,30 L150,100 L175,80 L205,55 L205,150',
                labels: [{ x: 78, y: 32, text: 'LIQ LONG' }, { x: 138, y: 22, text: 'LIQ LONG' }, { x: 130, y: 68, text: 'FLASH DUMP' }],
                rule: 'Evitar apalancamiento alto; colocar órdenes límite justo en las mechas de liquidación de Longs.'
            },
            {
                name: 'JUMP TRADING',
                path: 'M15,150 L30,30 L55,60 L70,45 L85,70 L95,55 L110,80 L135,75 L160,95 L185,90 L215,130 L235,150',
                labels: [{ x: 40, y: 24, text: 'Impulso' }, { x: 120, y: 50, text: 'Distribución' }, { x: 170, y: 120, text: 'SLOW DUMP' }],
                rule: 'Observar la pérdida de estructura en la distribución superior para salir o buscar cortos tras la ruptura.'
            }
        ];

        grid.innerHTML = cards.map((c) => `
            <div style="background:#111827;border:1px solid #1f2937;border-radius:10px;padding:12px;">
                <div style="color:#f43f5e;font-weight:bold;font-size:13px;margin-bottom:8px;">${esc(c.name)}</div>
                ${mmSvg(c.path, c.labels)}
                <div style="font-size:11px;color:#d1d5db;margin-top:8px;line-height:1.5;">🎯 <strong style="color:#fff;">Regla táctica:</strong> ${esc(c.rule)}</div>
            </div>`).join('');
    }
    renderMmCards();

    window.navigateToPlaybook = () => { window.location.hash = 'panel-playbook'; };
})();

// ============================================================================
// MÓDULO AUTO-INYECTABLE: LIQUIDACIONES EN VIVO & ALT/BTC
// Se abre desde el dock "Liquidaciones & ALT/BTC" mediante #btn-open-liq-altbtc.
// 3 pestañas: Liquidaciones en vivo (WebSocket Binance) · ALT/BTC & Alt Season · Funding & OI
// No modifica funciones previas: solo añade modal, overlay y trigger.
// ============================================================================
(function initLiquidacionesAltBtcModule() {
    ['liq-altbtc-modal', 'liq-altbtc-overlay', 'btn-open-liq-altbtc'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });

    // ------------------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------------------
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function fmtUSD(num) {
        const n = Number(num);
        if (!Number.isFinite(n)) return '—';
        const abs = Math.abs(n);
        if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
        if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
        if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
        if (abs >= 1) return '$' + n.toFixed(2);
        return '$' + n.toPrecision(3);
    }

    function fmtPct(val, digits = 2) {
        const n = Number(val);
        if (!Number.isFinite(n)) return '—';
        return (n >= 0 ? '+' : '') + n.toFixed(digits) + '%';
    }

    function fmtPrice(num) {
        const n = Number(num);
        if (!Number.isFinite(n) || n <= 0) return '—';
        if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
        if (n >= 1) return n.toFixed(4);
        if (n >= 0.01) return n.toFixed(5);
        return n.toPrecision(4);
    }

    function fmtTime(ts) {
        const d = new Date(Number(ts) || Date.now());
        return d.toLocaleTimeString('es-ES', { hour12: false });
    }

    function pctColor(val) {
        const n = Number(val);
        if (!Number.isFinite(n)) return '#9ca3af';
        return n >= 0 ? '#10b981' : '#ef4444';
    }

    function cgKey(url) {
        if (typeof window.QuantCoingeckoKey === 'function' && String(url).includes('api.coingecko.com')) {
            const key = window.QuantCoingeckoKey();
            if (key) {
                const sep = String(url).includes('?') ? '&' : '?';
                return url + sep + 'x_cg_demo_api_key=' + encodeURIComponent(key);
            }
        }
        return url;
    }

    async function liqFetch(url, timeoutMs = 22000) {
        url = cgKey(url);
        const attempts = [];
        const local = typeof window.QuantLocalProxy === 'function' ? window.QuantLocalProxy(url) : null;
        if (local) attempts.push(local);
        attempts.push(url);
        attempts.push('https://api.allorigins.win/raw?url=' + encodeURIComponent(url));

        if (window.QuantFetch && typeof window.QuantFetch.first === 'function') {
            return window.QuantFetch.first(attempts, { timeout: timeoutMs, cacheKey: 'liqalt ' + url });
        }

        let lastError = null;
        for (const target of attempts) {
            const controller = new AbortController();
            const timer = window.setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(target, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return await response.json();
            } catch (error) {
                lastError = error;
            } finally {
                window.clearTimeout(timer);
            }
        }
        throw lastError || new Error('Sin respuesta de la API');
    }

    // ------------------------------------------------------------------------
    // Estado
    // ------------------------------------------------------------------------
    const ALT_BASKET = [
        { pair: 'ETHBTC', label: 'ETH' },
        { pair: 'SOLBTC', label: 'SOL' },
        { pair: 'BNBBTC', label: 'BNB' },
        { pair: 'XRPBTC', label: 'XRP' },
        { pair: 'ADABTC', label: 'ADA' },
        { pair: 'DOGEBTC', label: 'DOGE' },
        { pair: 'AVAXBTC', label: 'AVAX' },
        { pair: 'LINKBTC', label: 'LINK' }
    ];

    const FUNDING_WHITELIST = new Set([
        'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT',
        'LINKUSDT', 'DOTUSDT', 'LTCUSDT', 'TRXUSDT', 'BCHUSDT', 'NEARUSDT', 'ATOMUSDT', 'UNIUSDT',
        'AAVEUSDT', 'ETCUSDT', 'FILUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'SEIUSDT',
        'TIAUSDT', 'INJUSDT', 'PEPEUSDT', 'WIFUSDT', 'BONKUSDT', 'FLOKIUSDT', 'SHIBUSDT', 'WLDUSDT',
        'FETUSDT', 'RENDERUSDT', 'TAOUSDT', 'TONUSDT', 'HBARUSDT', 'ICPUSDT', 'STXUSDT', 'IMXUSDT',
        'GALAUSDT', 'SANDUSDT', 'MANAUSDT', 'AXSUSDT', 'GMTUSDT', 'BLURUSDT', 'ORDIUSDT', 'CRVUSDT',
        'ONDOUSDT', 'ENAUSDT', 'JUPUSDT', 'PYTHUSDT'
    ]);

    function emptyStats() {
        return { total: 0, long: 0, short: 0, count: 0, bySymbol: {} };
    }

    const state = {
        open: false,
        tab: 'liq',
        paused: false,
        polling: false,
        pollTimer: null,
        lastPollAt: 0,
        seen: new Set(),
        instruments: null,
        stats: emptyStats(),
        events: [],
        altData: null,
        altLoading: false,
        fundingData: null,
        fundingLoading: false
    };

    // ------------------------------------------------------------------------
    // Modal + overlay
    // ------------------------------------------------------------------------
    const overlay = document.createElement('div');
    overlay.id = 'liq-altbtc-overlay';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:999997;background:rgba(2,4,8,0.72);backdrop-filter:blur(3px);';
    overlay.addEventListener('click', () => closeModal());
    document.body.appendChild(overlay);

    const modal = document.createElement('div');
    modal.id = 'liq-altbtc-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Liquidaciones y ALT/BTC');
    modal.style.cssText = 'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:999999;background:#0b0e14;border:2px solid #38bdf8;border-radius:12px;width:96%;max-width:1180px;color:#f3f4f6;font-family:sans-serif;box-shadow:0 25px 65px rgba(0,0,0,0.95);padding:18px;max-height:93vh;overflow-y:auto;';

    modal.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #1f2937;padding-bottom:12px;margin-bottom:12px;flex-wrap:wrap;gap:10px;">
            <div>
                <h3 style="margin:0;color:#38bdf8;font-size:17px;">🧲 Liquidaciones &amp; ALT/BTC</h3>
                <span style="font-size:11px;color:#9ca3af;">Liquidaciones recientes de OKX SWAP · Índice ALT/BTC de 90 días · Funding y Open Interest.</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                <button id="liq-refresh" type="button" style="background:#1f2937;color:#38bdf8;border:1px solid #38bdf8;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:bold;">🔄 Refrescar</button>
                <button id="liq-close" type="button" style="background:#1f2937;color:#9ca3af;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:bold;">✕ Cerrar</button>
            </div>
        </div>

        <div id="liq-tabbar" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">
            <button type="button" class="liq-tab" data-liq-tab="liq" style="background:#38bdf8;color:#000;border:none;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">🧲 Liquidaciones en vivo</button>
            <button type="button" class="liq-tab" data-liq-tab="altbtc" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">📊 ALT/BTC &amp; Alt Season</button>
            <button type="button" class="liq-tab" data-liq-tab="funding" style="background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;">💹 Funding &amp; OI</button>
        </div>

        <!-- PESTAÑA 1 · LIQUIDACIONES -->
        <div class="liq-pane" data-liq-pane="liq">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                <div id="liq-ws-status" style="font-size:11px;color:#9ca3af;">○ Feed en espera.</div>
                <div style="display:flex;gap:6px;">
                    <button id="liq-ws-toggle" type="button" style="background:#1f2937;color:#f59e0b;border:1px solid #f59e0b;padding:5px 10px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">⏸ Pausar</button>
                    <button id="liq-reset" type="button" style="background:#1f2937;color:#9ca3af;border:1px solid #374151;padding:5px 10px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;">🧹 Reiniciar</button>
                </div>
            </div>

            <div id="liq-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px;"></div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;margin-bottom:12px;">
                <div style="background:#0f1420;border:1px solid #1f2937;border-radius:8px;padding:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <strong style="font-size:12px;color:#e5e7eb;">Top símbolos liquidados</strong>
                        <span style="font-size:9px;color:#9ca3af;"><span style="color:#ef4444;">■</span> Longs &nbsp;<span style="color:#10b981;">■</span> Shorts</span>
                    </div>
                    <div id="liq-bars"></div>
                </div>
                <div style="background:#0f1420;border:1px solid #1f2937;border-radius:8px;padding:10px;">
                    <strong style="font-size:12px;color:#e5e7eb;">Resumen por símbolo</strong>
                    <div id="liq-symbol-table" style="margin-top:6px;"></div>
                </div>
            </div>

            <div style="background:#0f1420;border:1px solid #1f2937;border-radius:8px;padding:10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <strong style="font-size:12px;color:#e5e7eb;">Feed en vivo</strong>
                    <span id="liq-feed-count" style="font-size:10px;color:#6b7280;">0 eventos</span>
                </div>
                <div id="liq-feed" style="max-height:250px;overflow-y:auto;"></div>
            </div>

            <div style="font-size:10px;color:#6b7280;margin-top:8px;line-height:1.5;">
                Fuente: OKX SWAP (liquidaciones públicas). Se consultan BTC, ETH, SOL, XRP, DOGE, BNB, ADA, AVAX, LINK, SUI, PEPE y WIF cada 20 s. Los totales incluyen los últimos 30 minutos al abrir y se acumulan mientras el módulo está activo; se reinician con 🧹.
                Una liquidación <span style="color:#ef4444;">LONG</span> es una venta forzada; una <span style="color:#10b981;">SHORT</span> es una compra forzada.
            </div>
        </div>

        <!-- PESTAÑA 2 · ALT/BTC -->
        <div class="liq-pane" data-liq-pane="altbtc" style="display:none;">
            <div id="altbtc-status" style="font-size:11px;color:#9ca3af;margin-bottom:8px;">Pulsa Refrescar para construir el índice ALT/BTC.</div>
            <div id="altbtc-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px;"></div>
            <div style="background:#0f1420;border:1px solid #1f2937;border-radius:8px;padding:10px;margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:6px;">
                    <strong style="font-size:12px;color:#e5e7eb;">Índice ALT/BTC · 90 días (base 100)</strong>
                    <span style="font-size:9px;color:#9ca3af;">Media equiponderada de 8 pares ALT/BTC de Binance Spot</span>
                </div>
                <div id="altbtc-chart"></div>
            </div>
            <div style="background:#0f1420;border:1px solid #1f2937;border-radius:8px;padding:10px;">
                <strong style="font-size:12px;color:#e5e7eb;">Desempeño relativo vs BTC</strong>
                <div id="altbtc-table" style="margin-top:6px;"></div>
            </div>
            <div style="font-size:10px;color:#6b7280;margin-top:8px;line-height:1.5;">
                El índice sube cuando las alts ganan terreno a BTC. Un valor &gt;100 significa que la canasta supera a BTC desde el inicio de la ventana.
                Alt Season Score combina el % de pares que superan a BTC en 30 días y la tendencia del índice.
            </div>
        </div>

        <!-- PESTAÑA 3 · FUNDING -->
        <div class="liq-pane" data-liq-pane="funding" style="display:none;">
            <div id="funding-status" style="font-size:11px;color:#9ca3af;margin-bottom:8px;">Pulsa Refrescar para cargar funding y open interest.</div>
            <div id="funding-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px;"></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;">
                <div style="background:#0f1420;border:1px solid #1f2937;border-radius:8px;padding:10px;">
                    <strong style="font-size:12px;color:#ef4444;">Funding más positivo · longs pagan</strong>
                    <div style="font-size:10px;color:#6b7280;margin:2px 0 6px;">Posicionamiento alcista congestionado: riesgo de long squeeze.</div>
                    <div id="funding-long-table"></div>
                </div>
                <div style="background:#0f1420;border:1px solid #1f2937;border-radius:8px;padding:10px;">
                    <strong style="font-size:12px;color:#10b981;">Funding más negativo · shorts pagan</strong>
                    <div style="font-size:10px;color:#6b7280;margin:2px 0 6px;">Posicionamiento bajista congestionado: riesgo de short squeeze.</div>
                    <div id="funding-short-table"></div>
                </div>
            </div>
            <div style="font-size:10px;color:#6b7280;margin-top:8px;line-height:1.5;">
                Fuente: Binance Futures <code>premiumIndex</code> y <code>openInterestHist</code>. Funding anualizado = tasa de 8h × 3 × 365.
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // ------------------------------------------------------------------------
    // Trigger oculto para el dock existente (#dock-open-liq busca este ID)
    // ------------------------------------------------------------------------
    const trigger = document.createElement('button');
    trigger.id = 'btn-open-liq-altbtc';
    trigger.type = 'button';
    trigger.style.display = 'none';
    trigger.addEventListener('click', openModal);
    document.body.appendChild(trigger);

    // ------------------------------------------------------------------------
    // Pestañas
    // ------------------------------------------------------------------------
    function switchTab(tab) {
        state.tab = tab;
        modal.querySelectorAll('.liq-tab').forEach((b) => {
            const active = b.getAttribute('data-liq-tab') === tab;
            b.style.background = active ? '#38bdf8' : '#1f2937';
            b.style.color = active ? '#000' : '#d1d5db';
            b.style.border = active ? 'none' : '1px solid #374151';
        });
        modal.querySelectorAll('.liq-pane').forEach((p) => {
            p.style.display = p.getAttribute('data-liq-pane') === tab ? 'block' : 'none';
        });

        if (tab === 'liq') {
            if (state.open && !state.paused) connectWs();
        } else {
            stopWs('Feed en pausa (pestaña inactiva).');
        }
        if (tab === 'altbtc') loadAltBtc(false);
        if (tab === 'funding') loadFunding(false);
    }

    document.getElementById('liq-tabbar').addEventListener('click', (e) => {
        const btn = e.target.closest('.liq-tab');
        if (btn) switchTab(btn.getAttribute('data-liq-tab'));
    });

    // ------------------------------------------------------------------------
    // Abrir / cerrar
    // ------------------------------------------------------------------------
    function openModal() {
        state.open = true;
        overlay.style.display = 'block';
        modal.style.display = 'block';
        switchTab(state.tab || 'liq');
        renderLiqDashboard();
    }

    function closeModal() {
        state.open = false;
        overlay.style.display = 'none';
        modal.style.display = 'none';
        stopWs('Feed en pausa (módulo cerrado).');
    }

    document.getElementById('liq-close').addEventListener('click', closeModal);

    if (window.__liqAltBtcEsc) document.removeEventListener('keydown', window.__liqAltBtcEsc);
    window.__liqAltBtcEsc = (event) => {
        if (event.key === 'Escape' && modal.style.display === 'block') closeModal();
    };
    document.addEventListener('keydown', window.__liqAltBtcEsc);

    document.getElementById('liq-refresh').addEventListener('click', () => {
        if (state.tab === 'liq') {
            stopWs('');
            connectWs();
            renderLiqDashboard();
        } else if (state.tab === 'altbtc') {
            loadAltBtc(true);
        } else {
            loadFunding(true);
        }
    });

    // ------------------------------------------------------------------------
    // ------------------------------------------------------------------------
    // PESTAÑA 1 · LIQUIDACIONES (OKX SWAP, sondeo cada 20 s)
    // ------------------------------------------------------------------------
    const LIQ_UNDERLYINGS = [
        'BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB',
        'ADA', 'AVAX', 'LINK', 'SUI', 'PEPE', 'WIF'
    ];
    const LIQ_POLL_MS = 20000;
    const LIQ_SEED_MS = 30 * 60 * 1000;

    function setWsStatus(kind, text) {
        const el = document.getElementById('liq-ws-status');
        if (!el) return;
        const colors = { live: '#10b981', connecting: '#f59e0b', error: '#ef4444', paused: '#9ca3af', idle: '#6b7280' };
        const dots = { live: '●', connecting: '◌', error: '●', paused: '❚❚', idle: '○' };
        el.innerHTML = `<span style="color:${colors[kind] || '#9ca3af'};">${dots[kind] || '○'} ${esc(text)}</span>`;
    }

    function stopWs(reason) {
        state.polling = false;
        if (state.pollTimer) {
            window.clearInterval(state.pollTimer);
            state.pollTimer = null;
        }
        if (reason) setWsStatus(reason === 'Feed pausado por el usuario.' ? 'paused' : 'idle', reason);
    }

    async function loadOkxInstruments() {
        if (state.instruments && Object.keys(state.instruments).length) return state.instruments;
        const map = {};
        const results = await Promise.allSettled(LIQ_UNDERLYINGS.map((sym) =>
            liqFetch(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${sym}-USDT-SWAP`, 15000)
        ));
        results.forEach((res, index) => {
            if (res.status !== 'fulfilled') return;
            const row = (res.value && Array.isArray(res.value.data)) ? res.value.data[0] : null;
            if (!row) return;
            const ctVal = Number(row.ctVal);
            if (Number.isFinite(ctVal) && ctVal > 0) {
                map[LIQ_UNDERLYINGS[index]] = { ctVal, ctValCcy: row.ctValCcy || '' };
            }
        });
        state.instruments = map;
        return map;
    }

    function connectWs() {
        if (!state.open || state.tab !== 'liq' || state.paused) return;
        if (state.polling) return;
        state.polling = true;
        setWsStatus('connecting', 'Consultando liquidaciones de OKX SWAP…');
        pollLiquidations(true);
        state.pollTimer = window.setInterval(() => pollLiquidations(false), LIQ_POLL_MS);
    }

    async function pollLiquidations(initial) {
        if (!state.polling) return;
        try {
            const instruments = await loadOkxInstruments();
            const results = await Promise.allSettled(LIQ_UNDERLYINGS.map((sym) =>
                liqFetch(`https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&state=filled&uly=${sym}-USDT`, 18000)
            ));
            if (!state.polling) return;
            const now = Date.now();
            const cutoff = (initial || state.stats.count === 0) ? now - LIQ_SEED_MS : state.lastPollAt - 60000;
            let added = 0;
            let failed = 0;

            results.forEach((res, index) => {
                if (res.status !== 'fulfilled') { failed += 1; return; }
                const sym = LIQ_UNDERLYINGS[index];
                const meta = instruments[sym];
                if (!meta) { failed += 1; return; }
                const data = res.value && Array.isArray(res.value.data) ? res.value.data : [];
                data.forEach((group) => {
                    const details = Array.isArray(group.details) ? group.details : [];
                    details.forEach((detail) => {
                        const ts = Number(detail.ts || detail.time);
                        if (!Number.isFinite(ts) || ts < cutoff) return;
                        const key = `${sym}|${ts}|${detail.bkPx}|${detail.sz}|${detail.posSide}|${detail.side}`;
                        if (state.seen.has(key)) return;
                        state.seen.add(key);
                        const price = Number(detail.bkPx);
                        const contracts = Number(detail.sz);
                        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(contracts) || contracts <= 0) return;
                        const notional = contracts * meta.ctVal * price;
                        if (!Number.isFinite(notional) || notional <= 0) return;
                        const side = String(detail.posSide || '').toLowerCase() === 'long' ? 'long' : 'short';
                        ingestEvent({
                            symbol: sym + 'USDT',
                            side,
                            price,
                            qty: contracts * meta.ctVal,
                            notional,
                            ts
                        });
                        added += 1;
                    });
                });
            });

            if (state.seen.size > 8000) {
                state.seen = new Set([...state.seen].slice(-4000));
            }
            state.events.sort((a, b) => b.ts - a.ts);
            state.lastPollAt = now;
            if (added > 0) renderLiqDashboard();

            const time = new Date(now).toLocaleTimeString('es-ES', { hour12: false });
            if (failed === LIQ_UNDERLYINGS.length) {
                setWsStatus('error', `OKX no respondió (${time}). Reintentando en ${LIQ_POLL_MS / 1000}s…`);
            } else if (added > 0) {
                setWsStatus('live', `OKX SWAP · ${added} nueva(s) · ${time}`);
            } else {
                setWsStatus('live', `OKX SWAP · sin nuevas · ${time}`);
            }
        } catch (error) {
            setWsStatus('error', `Error al consultar OKX: ${error.message}`);
        }
    }

    function ingestEvent(event) {
        const symbol = event.symbol;
        const side = event.side;
        const notional = event.notional;
        state.stats[side] += notional;
        state.stats.total += notional;
        state.stats.count += 1;

        const bucket = state.stats.bySymbol[symbol] || (state.stats.bySymbol[symbol] = { long: 0, short: 0, count: 0, max: 0 });
        bucket[side] += notional;
        bucket.count += 1;
        bucket.max = Math.max(bucket.max, notional);

        state.events.push({
            symbol,
            side,
            price: event.price,
            qty: event.qty,
            notional,
            ts: event.ts
        });
        if (state.events.length > 150) state.events.length = 150;
    }

    let liqRenderTimer = null;
    function scheduleLiqRender() {
        if (liqRenderTimer) return;
        liqRenderTimer = window.setTimeout(() => {
            liqRenderTimer = null;
            if (state.tab === 'liq' && state.open) renderLiqDashboard();
        }, 600);
    }

    function kpiCard(label, value, sub, color) {
        return `<div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:10px;">
            <div style="font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;">${esc(label)}</div>
            <div style="font-size:18px;font-weight:bold;color:${color || '#fff'};margin-top:3px;">${value}</div>
            ${sub ? `<div style="font-size:9px;color:#6b7280;margin-top:2px;">${sub}</div>` : ''}
        </div>`;
    }

    function topSymbols(limit) {
        return Object.keys(state.stats.bySymbol)
            .map((symbol) => ({ symbol, ...state.stats.bySymbol[symbol] }))
            .sort((a, b) => (b.long + b.short) - (a.long + a.short))
            .slice(0, limit);
    }

    function renderBars() {
        const rows = topSymbols(7);
        const el = document.getElementById('liq-bars');
        if (!rows.length) {
            el.innerHTML = '<div style="font-size:11px;color:#6b7280;padding:14px 0;">Aún no hay liquidaciones. El feed se llena en cuanto llega el primer evento.</div>';
            return;
        }
        const W = 520;
        const rowH = 27;
        const H = rows.length * rowH + 6;
        const max = Math.max(...rows.map((r) => r.long + r.short), 1);
        const barW = W - 190;
        const svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:#090d16;border-radius:6px;">
            ${rows.map((r, i) => {
                const y = 4 + i * rowH;
                const total = r.long + r.short;
                const wTotal = Math.max((total / max) * barW, 2);
                const wLong = total > 0 ? (r.long / total) * wTotal : 0;
                return `<text x="4" y="${y + 13}" fill="#d1d5db" font-size="10" font-family="sans-serif">${esc(r.symbol.replace('USDT', ''))}</text>
                    <rect x="68" y="${y + 3}" width="${wLong.toFixed(1)}" height="14" fill="#ef4444" rx="2"/>
                    <rect x="${(68 + wLong).toFixed(1)}" y="${y + 3}" width="${Math.max(wTotal - wLong, 0).toFixed(1)}" height="14" fill="#10b981" rx="2"/>
                    <text x="${(74 + wTotal).toFixed(1)}" y="${y + 14}" fill="#9ca3af" font-size="10" font-family="sans-serif">${fmtUSD(total)}</text>`;
            }).join('')}
        </svg>`;
        el.innerHTML = svg;
    }

    function renderSymbolTable() {
        const rows = topSymbols(10);
        const el = document.getElementById('liq-symbol-table');
        if (!rows.length) {
            el.innerHTML = '<div style="font-size:11px;color:#6b7280;padding:10px 0;">Sin datos todavía.</div>';
            return;
        }
        el.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;text-align:left;">
            <thead><tr style="color:#9ca3af;border-bottom:1px solid #1f2937;">
                <th style="padding:5px;">Par</th><th style="padding:5px;">Longs</th><th style="padding:5px;">Shorts</th>
                <th style="padding:5px;">Total</th><th style="padding:5px;">Mayor</th>
            </tr></thead>
            <tbody>${rows.map((r) => `<tr style="border-bottom:1px solid #111827;">
                <td style="padding:5px;font-weight:bold;color:#fff;">${esc(r.symbol.replace('USDT', ''))}</td>
                <td style="padding:5px;color:#ef4444;">${fmtUSD(r.long)}</td>
                <td style="padding:5px;color:#10b981;">${fmtUSD(r.short)}</td>
                <td style="padding:5px;color:#e5e7eb;">${fmtUSD(r.long + r.short)}</td>
                <td style="padding:5px;color:#f59e0b;">${fmtUSD(r.max)}</td>
            </tr>`).join('')}</tbody>
        </table></div>`;
    }

    function renderFeed() {
        const el = document.getElementById('liq-feed');
        const count = document.getElementById('liq-feed-count');
        if (count) count.textContent = `${state.stats.count} eventos · mostrando ${Math.min(state.events.length, 40)}`;
        if (!state.events.length) {
            el.innerHTML = '<div style="font-size:11px;color:#6b7280;padding:14px 0;">Esperando la primera liquidación…</div>';
            return;
        }
        el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:11px;text-align:left;">
            <thead style="position:sticky;top:0;background:#0f1420;color:#9ca3af;"><tr>
                <th style="padding:5px;">Hora</th><th style="padding:5px;">Par</th><th style="padding:5px;">Lado</th>
                <th style="padding:5px;">Precio</th><th style="padding:5px;">Cantidad</th><th style="padding:5px;">Notional</th>
            </tr></thead>
            <tbody>${state.events.slice(0, 40).map((e) => {
                const isLong = e.side === 'long';
                const color = isLong ? '#ef4444' : '#10b981';
                return `<tr style="border-bottom:1px solid #111827;">
                    <td style="padding:5px;color:#6b7280;">${fmtTime(e.ts)}</td>
                    <td style="padding:5px;font-weight:bold;color:#fff;">${esc(e.symbol.replace('USDT', ''))}</td>
                    <td style="padding:5px;color:${color};font-weight:bold;">${isLong ? 'LONG' : 'SHORT'}</td>
                    <td style="padding:5px;color:#d1d5db;">${fmtPrice(e.price)}</td>
                    <td style="padding:5px;color:#9ca3af;">${Number(e.qty).toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                    <td style="padding:5px;color:${color};font-weight:bold;">${fmtUSD(e.notional)}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    }

    function renderLiqDashboard() {
        const kpis = document.getElementById('liq-kpis');
        if (!kpis) return;
        const ratio = state.stats.short > 0 ? state.stats.long / state.stats.short : null;
        kpis.innerHTML = [
            kpiCard('Total liquidado', fmtUSD(state.stats.total), `${state.stats.count} eventos`, '#38bdf8'),
            kpiCard('Longs liquidados', fmtUSD(state.stats.long), ratio == null ? '—' : `Ratio L/S ${ratio.toFixed(2)}`, '#ef4444'),
            kpiCard('Shorts liquidados', fmtUSD(state.stats.short), state.stats.total > 0 ? `${((state.stats.short / state.stats.total) * 100).toFixed(1)}% del total` : '—', '#10b981'),
            kpiCard('Ratio Long/Short', ratio == null ? '—' : ratio.toFixed(2), ratio == null ? 'Sin shorts aún' : (ratio > 1 ? 'Presión de longs' : 'Presión de shorts'), ratio == null ? '#9ca3af' : (ratio > 1 ? '#ef4444' : '#10b981'))
        ].join('');
        renderBars();
        renderSymbolTable();
        renderFeed();
    }

    document.getElementById('liq-ws-toggle').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (state.paused) {
            state.paused = false;
            btn.textContent = '⏸ Pausar';
            btn.style.color = '#f59e0b';
            btn.style.borderColor = '#f59e0b';
            connectWs();
        } else {
            state.paused = true;
            btn.textContent = '▶ Reanudar';
            btn.style.color = '#10b981';
            btn.style.borderColor = '#10b981';
            stopWs('Feed pausado por el usuario.');
        }
    });

    document.getElementById('liq-reset').addEventListener('click', () => {
        state.stats = emptyStats();
        state.events = [];
        renderLiqDashboard();
        setWsStatus(state.paused ? 'paused' : 'live', state.paused ? 'Feed pausado por el usuario.' : 'Contadores reiniciados. OKX SWAP se actualiza cada 20 s.');
    });

    // PESTAÑA 2 · ALT/BTC & ALT SEASON
    // ------------------------------------------------------------------------
    function setTabStatus(id, kind, text) {
        const el = document.getElementById(id);
        if (!el) return;
        const colors = { ok: '#10b981', loading: '#f59e0b', error: '#ef4444', idle: '#9ca3af' };
        const icons = { ok: '✅', loading: '⏳', error: '⚠️', idle: 'ℹ️' };
        el.innerHTML = `<span style="color:${colors[kind] || '#9ca3af'};">${icons[kind] || ''} ${esc(text)}</span>`;
    }

    function miniSpark(closes, color) {
        if (!Array.isArray(closes) || closes.length < 2) return '';
        const W = 110;
        const H = 26;
        const min = Math.min(...closes);
        const max = Math.max(...closes);
        const span = (max - min) || 1;
        const pts = closes.map((v, i) => {
            const x = 1 + (i / (closes.length - 1)) * (W - 2);
            const y = H - 2 - ((v - min) / span) * (H - 4);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.4"/></svg>`;
    }

    function altChartSvg(series) {
        const W = 1000;
        const H = 260;
        const padL = 46;
        const padR = 14;
        const padT = 16;
        const padB = 26;
        const vals = series.map((p) => p.v);
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const span = (max - min) || 1;
        const x = (i) => padL + (i / (series.length - 1)) * (W - padL - padR);
        const y = (v) => padT + (1 - (v - min) / span) * (H - padT - padB);
        const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
        const area = `${padL},${(H - padB).toFixed(1)} ${pts} ${(W - padR).toFixed(1)},${(H - padB).toFixed(1)}`;
        const y100 = y(100);
        const first = series[0];
        const last = series[series.length - 1];
        return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:240px;background:#090d16;border-radius:6px;">
            <defs>
                <linearGradient id="altbtcFillGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.34"/>
                    <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.02"/>
                </linearGradient>
            </defs>
            <line x1="${padL}" y1="${y100.toFixed(1)}" x2="${W - padR}" y2="${y100.toFixed(1)}" stroke="#6b7280" stroke-dasharray="4 4" stroke-width="1"/>
            <text x="${padL + 4}" y="${(y100 - 4).toFixed(1)}" fill="#6b7280" font-size="9" font-family="sans-serif">100 (base)</text>
            <polygon points="${area}" fill="url(#altbtcFillGrad)"/>
            <polyline points="${pts}" fill="none" stroke="#38bdf8" stroke-width="2"/>
            <circle cx="${x(series.length - 1).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="3.5" fill="#38bdf8"/>
            <text x="${padL}" y="${H - 7}" fill="#9ca3af" font-size="9" font-family="sans-serif">${new Date(first.t).toLocaleDateString('es-ES')}</text>
            <text x="${W - padR}" y="${H - 7}" fill="#9ca3af" font-size="9" font-family="sans-serif" text-anchor="end">${new Date(last.t).toLocaleDateString('es-ES')}</text>
            <text x="${W - padR}" y="${padT + 10}" fill="#e5e7eb" font-size="11" font-family="sans-serif" text-anchor="end">${last.v.toFixed(1)}</text>
            <text x="${padL + 4}" y="${padT + 10}" fill="#6b7280" font-size="9" font-family="sans-serif">máx ${max.toFixed(1)} · mín ${min.toFixed(1)}</text>
        </svg>`;
    }

    function altSeasonScore(series, pairs) {
        const last = series[series.length - 1].v;
        const ref = series.length > 30 ? series[series.length - 31].v : series[0].v;
        const d30 = ref > 0 ? ((last / ref) - 1) * 100 : 0;
        const outperform = pairs.length ? pairs.filter((p) => Number.isFinite(p.d30) && p.d30 > 0).length / pairs.length * 100 : 0;
        const trend = Math.max(0, Math.min(50, ((d30 + 20) / 40) * 50));
        const score = Math.round(outperform * 0.5 + trend);
        let label = 'BTC Season';
        let color = '#ef4444';
        if (score >= 75) { label = 'Alt Season'; color = '#10b981'; }
        else if (score >= 50) { label = 'Rotación a alts'; color = '#facc15'; }
        else if (score >= 25) { label = 'Neutral'; color = '#f59e0b'; }
        return { score, label, color, d30, outperform };
    }

    async function loadAltBtc(force) {
        if (state.altLoading) return;
        if (state.altData && !force) {
            renderAltBtc();
            return;
        }
        state.altLoading = true;
        setTabStatus('altbtc-status', 'loading', 'Descargando 90 días de 8 pares ALT/BTC desde Binance Spot…');

        try {
            const results = await Promise.allSettled(ALT_BASKET.map((asset) =>
                liqFetch(`https://api.binance.com/api/v3/klines?symbol=${asset.pair}&interval=1d&limit=91`, 25000)
                    .then((rows) => ({ asset, rows }))
            ));

            const seriesList = [];
            const failed = [];
            for (const result of results) {
                if (result.status !== 'fulfilled') {
                    failed.push('red');
                    continue;
                }
                const { asset, rows } = result.value;
                if (!Array.isArray(rows) || rows.length < 10) {
                    failed.push(asset.label);
                    continue;
                }
                const map = new Map();
                rows.forEach((row) => {
                    const t = Number(row[0]);
                    const c = Number(row[4]);
                    if (Number.isFinite(t) && Number.isFinite(c) && c > 0) map.set(t, c);
                });
                if (map.size >= 10) seriesList.push({ ...asset, map });
                else failed.push(asset.label);
            }

            if (!seriesList.length) throw new Error('Binance no devolvió datos de los pares ALT/BTC. Puede ser un bloqueo regional o de red.');

            const common = [...seriesList[0].map.keys()]
                .filter((t) => seriesList.every((s) => s.map.has(t)))
                .sort((a, b) => a - b);
            if (common.length < 10) throw new Error('Historial insuficiente para construir el índice ALT/BTC.');

            const base = common[0];
            const idxSeries = common.map((t) => {
                const avg = seriesList.reduce((acc, s) => acc + (s.map.get(t) / s.map.get(base)), 0) / seriesList.length;
                return { t, v: avg * 100 };
            });

            const pairs = seriesList.map((s) => {
                const closes = common.map((t) => s.map.get(t));
                const last = closes[closes.length - 1];
                const change = (n) => closes.length > n ? ((last / closes[closes.length - 1 - n]) - 1) * 100 : null;
                return {
                    pair: s.pair,
                    label: s.label,
                    last,
                    d1: change(1),
                    d7: change(7),
                    d30: change(30),
                    d90: ((last / closes[0]) - 1) * 100,
                    closes
                };
            }).sort((a, b) => b.d30 - a.d30);

            let btc = null;
            try {
                const btcRows = await liqFetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=91', 25000);
                const closes = btcRows.map((row) => Number(row[4])).filter(Number.isFinite);
                if (closes.length > 1) {
                    const last = closes[closes.length - 1];
                    btc = {
                        last,
                        d30: closes.length > 30 ? ((last / closes[closes.length - 31]) - 1) * 100 : null,
                        d90: ((last / closes[0]) - 1) * 100
                    };
                }
            } catch (e) { /* BTC es opcional */ }

            let dominance = null;
            try {
                const global = await liqFetch('https://api.coingecko.com/api/v3/global', 18000);
                if (global && global.data && global.data.market_cap_percentage) {
                    const dom = Number(global.data.market_cap_percentage.btc);
                    if (Number.isFinite(dom)) dominance = dom;
                }
            } catch (e) { /* dominancia opcional */ }

            state.altData = { idxSeries, pairs, btc, dominance, failed, at: Date.now() };
            renderAltBtc();
            const suffix = failed.length ? ` (${failed.length} pares sin datos)` : '';
            setTabStatus('altbtc-status', 'ok', `Índice construido con ${pairs.length} pares y ${idxSeries.length} días${suffix}.`);
        } catch (error) {
            setTabStatus('altbtc-status', 'error', error.message || 'No se pudo construir el índice ALT/BTC.');
            document.getElementById('altbtc-kpis').innerHTML = '';
            document.getElementById('altbtc-chart').innerHTML = `<div style="font-size:11px;color:#fca5a5;padding:16px;">${esc(error.message || 'Error de datos')}</div>`;
            document.getElementById('altbtc-table').innerHTML = '';
        } finally {
            state.altLoading = false;
        }
    }

    function renderAltBtc() {
        const data = state.altData;
        if (!data) return;
        const season = altSeasonScore(data.idxSeries, data.pairs);
        const last = data.idxSeries[data.idxSeries.length - 1].v;
        const first = data.idxSeries[0].v;
        const d90 = ((last / first) - 1) * 100;
        const d7ref = data.idxSeries.length > 7 ? data.idxSeries[data.idxSeries.length - 8].v : first;
        const d7 = ((last / d7ref) - 1) * 100;

        document.getElementById('altbtc-kpis').innerHTML = [
            kpiCard('Índice ALT/BTC', last.toFixed(1), 'Base 100 · 90 días', '#38bdf8'),
            kpiCard('30 días', fmtPct(season.d30), `${season.outperform.toFixed(0)}% de alts superan a BTC`, pctColor(season.d30)),
            kpiCard('7 días', fmtPct(d7), 'Tendencia de corto plazo', pctColor(d7)),
            kpiCard('90 días', fmtPct(d90), 'Ventana completa', pctColor(d90)),
            kpiCard('Alt Season Score', `${season.score}/100`, season.label, season.color),
            kpiCard('Dominancia BTC', data.dominance == null ? '—' : data.dominance.toFixed(1) + '%', 'CoinGecko global', '#f59e0b'),
            kpiCard('BTC 30d', data.btc ? fmtPct(data.btc.d30) : '—', data.btc ? `BTC 90d ${fmtPct(data.btc.d90)}` : 'Sin referencia', data.btc ? pctColor(data.btc.d30) : '#9ca3af')
        ].join('');

        document.getElementById('altbtc-chart').innerHTML = altChartSvg(data.idxSeries);

        document.getElementById('altbtc-table').innerHTML = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;text-align:left;">
            <thead><tr style="color:#9ca3af;border-bottom:1px solid #1f2937;">
                <th style="padding:6px;">Par</th><th style="padding:6px;">Ratio</th><th style="padding:6px;">24h</th>
                <th style="padding:6px;">7d</th><th style="padding:6px;">30d</th><th style="padding:6px;">90d</th>
                <th style="padding:6px;">Curva 90d</th>
            </tr></thead>
            <tbody>${data.pairs.map((p) => `<tr style="border-bottom:1px solid #111827;">
                <td style="padding:6px;font-weight:bold;color:#fff;">${esc(p.label)}<span style="color:#6b7280;font-weight:normal;">/BTC</span></td>
                <td style="padding:6px;color:#d1d5db;">${fmtPrice(p.last)}</td>
                <td style="padding:6px;color:${pctColor(p.d1)};">${fmtPct(p.d1)}</td>
                <td style="padding:6px;color:${pctColor(p.d7)};">${fmtPct(p.d7)}</td>
                <td style="padding:6px;color:${pctColor(p.d30)};">${fmtPct(p.d30)}</td>
                <td style="padding:6px;color:${pctColor(p.d90)};">${fmtPct(p.d90)}</td>
                <td style="padding:6px;">${miniSpark(p.closes, pctColor(p.d30))}</td>
            </tr>`).join('')}</tbody>
        </table></div>`;
    }

    // ------------------------------------------------------------------------
    // PESTAÑA 3 · FUNDING & OPEN INTEREST
    // ------------------------------------------------------------------------
    function fundingTable(rows, positive) {
        if (!rows.length) return '<div style="font-size:11px;color:#6b7280;padding:10px 0;">Sin datos.</div>';
        return `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;text-align:left;">
            <thead><tr style="color:#9ca3af;border-bottom:1px solid #1f2937;">
                <th style="padding:5px;">Par</th><th style="padding:5px;">Funding 8h</th><th style="padding:5px;">Anualizado</th><th style="padding:5px;">Mark</th>
            </tr></thead>
            <tbody>${rows.map((r) => {
                const rate = Number(r.rate) * 100;
                const annual = rate * 3 * 365;
                const color = positive ? '#ef4444' : '#10b981';
                return `<tr style="border-bottom:1px solid #111827;">
                    <td style="padding:5px;font-weight:bold;color:#fff;">${esc(r.symbol.replace('USDT', ''))}</td>
                    <td style="padding:5px;color:${color};font-weight:bold;">${rate >= 0 ? '+' : ''}${rate.toFixed(4)}%</td>
                    <td style="padding:5px;color:${color};">${annual >= 0 ? '+' : ''}${annual.toFixed(1)}%</td>
                    <td style="padding:5px;color:#9ca3af;">${fmtPrice(r.markPrice)}</td>
                </tr>`;
            }).join('')}</tbody>
        </table></div>`;
    }

    async function loadFunding(force) {
        if (state.fundingLoading) return;
        if (state.fundingData && !force) {
            renderFunding();
            return;
        }
        state.fundingLoading = true;
        setTabStatus('funding-status', 'loading', 'Descargando funding de Binance Futures y open interest de BTC…');

        try {
            const [premiumResult, oiResult] = await Promise.allSettled([
                liqFetch('https://fapi.binance.com/fapi/v1/premiumIndex', 22000),
                liqFetch('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25', 22000)
            ]);

            if (premiumResult.status !== 'fulfilled' || !Array.isArray(premiumResult.value)) {
                throw new Error('Binance no devolvió el funding de futuros.');
            }

            const rows = premiumResult.value
                .filter((r) => FUNDING_WHITELIST.has(String(r.symbol || '').toUpperCase()))
                .map((r) => ({
                    symbol: String(r.symbol).toUpperCase(),
                    rate: Number(r.lastFundingRate),
                    markPrice: Number(r.markPrice),
                    nextFundingTime: Number(r.nextFundingTime)
                }))
                .filter((r) => Number.isFinite(r.rate));

            if (!rows.length) throw new Error('Sin tasas de funding válidas.');

            const sorted = [...rows].sort((a, b) => b.rate - a.rate);
            const positive = sorted.slice(0, 8);
            const negative = [...sorted].reverse().slice(0, 8).filter((r) => r.rate < 0);
            const btc = rows.find((r) => r.symbol === 'BTCUSDT') || null;

            let oi = null;
            if (oiResult.status === 'fulfilled' && Array.isArray(oiResult.value) && oiResult.value.length > 1) {
                const hist = oiResult.value;
                const first = hist[0];
                const last = hist[hist.length - 1];
                const firstValue = Number(first.sumOpenInterestValue);
                const lastValue = Number(last.sumOpenInterestValue);
                if (Number.isFinite(firstValue) && Number.isFinite(lastValue) && firstValue > 0) {
                    oi = {
                        value: lastValue,
                        change: ((lastValue / firstValue) - 1) * 100,
                        points: hist.length
                    };
                }
            }

            state.fundingData = { rows, positive, negative, btc, oi, at: Date.now() };
            renderFunding();
            setTabStatus('funding-status', 'ok', `Funding de ${rows.length} pares líquidos y OI de BTC actualizados.`);
        } catch (error) {
            setTabStatus('funding-status', 'error', error.message || 'No se pudo cargar funding/OI.');
            document.getElementById('funding-kpis').innerHTML = '';
            document.getElementById('funding-long-table').innerHTML = '';
            document.getElementById('funding-short-table').innerHTML = '';
        } finally {
            state.fundingLoading = false;
        }
    }

    function renderFunding() {
        const data = state.fundingData;
        if (!data) return;
        const btcRate = data.btc ? data.btc.rate * 100 : null;
        const nextIn = data.btc && data.btc.nextFundingTime ? data.btc.nextFundingTime - Date.now() : null;
        const nextText = nextIn == null ? '—' : (nextIn <= 0 ? 'ahora' : `${Math.floor(nextIn / 3600000)}h ${Math.floor((nextIn % 3600000) / 60000)}m`);
        const avgTop = data.positive.length ? data.positive.reduce((acc, r) => acc + r.rate, 0) / data.positive.length * 100 : null;

        document.getElementById('funding-kpis').innerHTML = [
            kpiCard('Funding BTC 8h', btcRate == null ? '—' : (btcRate >= 0 ? '+' : '') + btcRate.toFixed(4) + '%', btcRate == null ? 'Sin dato' : (btcRate >= 0 ? 'Longs pagan a shorts' : 'Shorts pagan a longs'), btcRate == null ? '#9ca3af' : (btcRate >= 0 ? '#ef4444' : '#10b981')),
            kpiCard('Próximo funding BTC', nextText, 'Cuenta atrás estimada', '#38bdf8'),
            kpiCard('Open Interest BTC', data.oi ? fmtUSD(data.oi.value) : '—', data.oi ? `${data.oi.points} puntos horarios` : 'Sin histórico', '#f59e0b'),
            kpiCard('OI BTC 24h', data.oi ? fmtPct(data.oi.change) : '—', data.oi ? (data.oi.change >= 0 ? 'Dinero entrando' : 'Dinero saliendo') : '—', data.oi ? pctColor(data.oi.change) : '#9ca3af'),
            kpiCard('Funding medio top 8', avgTop == null ? '—' : (avgTop >= 0 ? '+' : '') + avgTop.toFixed(4) + '%', 'Presión media de longs', avgTop == null ? '#9ca3af' : (avgTop >= 0 ? '#ef4444' : '#10b981'))
        ].join('');

        document.getElementById('funding-long-table').innerHTML = fundingTable(data.positive, true);
        document.getElementById('funding-short-table').innerHTML = fundingTable(data.negative, false);
    }

    // ------------------------------------------------------------------------
    // API pública
    // ------------------------------------------------------------------------
    window.openLiquidacionesAltBtc = openModal;
    window.quantLiquidaciones = {
        open: openModal,
        close: closeModal,
        refresh: () => {
            if (state.tab === 'liq') { stopWs(''); connectWs(); renderLiqDashboard(); }
            else if (state.tab === 'altbtc') loadAltBtc(true);
            else loadFunding(true);
        },
        reset: () => {
            state.stats = emptyStats();
            state.events = [];
            renderLiqDashboard();
        },
        getStats: () => JSON.parse(JSON.stringify(state.stats))
    };
})();
