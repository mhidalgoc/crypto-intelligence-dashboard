// ============================================================================
// MÓDULO 8 · RADAR MULTI-MONEDA 4H/1D
// MÓDULO 7 · ESCÁNER SMC (BOS/CHoCH, Order Blocks, FVG, Premium/Discount)
// Auto-inyectable en Panel 03 · Deep-dive intelligence
// ============================================================================
(function initSmcAndRadarModules() {
  'use strict';

  const oldWrapper = document.getElementById('smc-modules-wrapper');
  const oldStyle = document.getElementById('smc-modules-styles');
  if (oldWrapper) oldWrapper.remove();
  if (oldStyle) oldStyle.remove();

  const DEFAULT_WATCHLIST = [
    'SOL', 'SUI', 'XRP', 'BNB', 'BTC', 'ETH', 'LINK', 'AVAX',
    'AAVE', 'NEAR', 'RENDER', 'INJ', 'APT', 'ARB', 'DOGE'
  ];
  const CONFIG_KEY = 'crypto_smc_radar_config_v1';
  const MAX_WATCHLIST = 20;
  // En GitHub Pages no existe /proxy: se omite para no generar 404.
  const LOCAL_PROXY_ENABLED = location.port === '4173'
    || /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(location.hostname)
    || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(location.hostname);

  let radarRows = [];
  let radarTimeframe = '4h';
  let radarScanning = false;
  let smcTimeframe = '4h';
  let smcScanning = false;
  let lastRadarConfig = null;
  let lastSmcResult = null;

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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatPrice(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '—';
    if (number >= 1000) return number.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (number >= 1) return number.toFixed(2);
    if (number >= 0.01) return number.toFixed(4);
    return number.toFixed(8);
  }

  function formatPct(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${number >= 0 ? '+' : ''}${number.toFixed(digits)}%`;
  }

  function formatFunding(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${(number * 100).toFixed(4)}%`;
  }

  function loadConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      const watchlist = Array.isArray(saved.watchlist)
        ? saved.watchlist.map(sanitizeSymbol).filter(Boolean)
        : [];
      return {
        watchlist: watchlist.length ? watchlist.slice(0, MAX_WATCHLIST) : DEFAULT_WATCHLIST.slice(),
        timeframe: saved.timeframe === '1d' ? '1d' : '4h'
      };
    } catch (error) {
      return { watchlist: DEFAULT_WATCHLIST.slice(), timeframe: '4h' };
    }
  }

  function saveConfig(config) {
    lastRadarConfig = config;
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch (error) {
      // localStorage puede estar bloqueado.
    }
  }

  async function fetchJson(url, timeoutMs = 15000) {
    const attempts = [];
    if (LOCAL_PROXY_ENABLED) attempts.push(`/proxy?url=${encodeURIComponent(url)}`);
    attempts.push(url);
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

  async function fetchKlines(symbol, interval) {
    const pair = `${symbol}USDT`;
    const spot = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(interval)}&limit=200`;
    const futures = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(interval)}&limit=200`;
    let raw = null;
    try {
      raw = await fetchJson(spot);
    } catch (error) {
      raw = await fetchJson(futures);
    }
    if (!Array.isArray(raw) || raw.length < 60) {
      throw new Error('Velas insuficientes');
    }
    return raw.map((k) => ({
      time: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]) || 0,
      takerBuy: Number(k[9]) || 0
    })).filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite));
  }

  async function fetchPremiumMap() {
    try {
      const data = await fetchJson('https://fapi.binance.com/fapi/v1/premiumIndex');
      return new Map(Array.isArray(data) ? data.map((item) => [item.symbol, item]) : []);
    } catch (error) {
      return new Map();
    }
  }

  function calcEma(values, period) {
    if (!values.length) return [];
    const k = 2 / (period + 1);
    const output = [];
    let ema = values[0];
    for (let i = 0; i < values.length; i += 1) {
      ema = i === 0 ? values[i] : (values[i] * k) + (ema * (1 - k));
      output.push(ema);
    }
    return output;
  }

  function calcRsi(closes, period = 14) {
    const output = new Array(closes.length).fill(50);
    if (closes.length <= period) return output;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i += 1) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    output[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
    for (let i = period + 1; i < closes.length; i += 1) {
      const diff = closes[i] - closes[i - 1];
      avgGain = ((avgGain * (period - 1)) + (diff > 0 ? diff : 0)) / period;
      avgLoss = ((avgLoss * (period - 1)) + (diff < 0 ? -diff : 0)) / period;
      output[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
    }
    return output;
  }

  function calcCvd(candles) {
    let cumulative = 0;
    return candles.map((candle) => {
      const buy = Number.isFinite(candle.takerBuy) ? candle.takerBuy : candle.volume / 2;
      const sell = Math.max(0, candle.volume - buy);
      cumulative += buy - sell;
      return cumulative;
    });
  }

  function analyzeSmc(candles) {
    const len = candles.length;
    const swings = [];
    for (let i = 2; i < len - 2; i += 1) {
      const current = candles[i];
      const prev1 = candles[i - 1];
      const prev2 = candles[i - 2];
      const next1 = candles[i + 1];
      const next2 = candles[i + 2];
      if (current.high > prev1.high && current.high > prev2.high && current.high > next1.high && current.high > next2.high) {
        swings.push({ index: i, price: current.high, type: 'high' });
      }
      if (current.low < prev1.low && current.low < prev2.low && current.low < next1.low && current.low < next2.low) {
        swings.push({ index: i, price: current.low, type: 'low' });
      }
    }
    swings.sort((a, b) => a.index - b.index);

    const swingHighs = swings.filter((swing) => swing.type === 'high');
    const swingLows = swings.filter((swing) => swing.type === 'low');
    const events = [];
    const orderBlocks = [];
    let trend = 'neutral';
    let lastSwingHigh = null;
    let lastSwingLow = null;
    let highPointer = 0;
    let lowPointer = 0;

    const addOrderBlock = (type, breakIndex) => {
      for (let j = breakIndex - 1; j >= Math.max(0, breakIndex - 22); j -= 1) {
        const candle = candles[j];
        const bearishCandle = candle.close < candle.open;
        const bullishCandle = candle.close > candle.open;
        if ((type === 'bullish' && bearishCandle) || (type === 'bearish' && bullishCandle)) {
          orderBlocks.push({
            index: j,
            type,
            top: Math.max(candle.open, candle.close),
            bottom: Math.min(candle.open, candle.close),
            candleHigh: candle.high,
            candleLow: candle.low,
            eventIndex: breakIndex,
            mitigated: false
          });
          break;
        }
      }
    };

    for (let i = 0; i < len; i += 1) {
      while (highPointer < swingHighs.length && swingHighs[highPointer].index <= i - 2) {
        if (!lastSwingHigh || swingHighs[highPointer].index > lastSwingHigh.index) {
          lastSwingHigh = swingHighs[highPointer];
        }
        highPointer += 1;
      }
      while (lowPointer < swingLows.length && swingLows[lowPointer].index <= i - 2) {
        if (!lastSwingLow || swingLows[lowPointer].index > lastSwingLow.index) {
          lastSwingLow = swingLows[lowPointer];
        }
        lowPointer += 1;
      }

      const close = candles[i].close;
      if (lastSwingHigh && i > lastSwingHigh.index + 1 && close > lastSwingHigh.price) {
        const type = trend === 'bearish' ? 'CHoCH' : 'BOS';
        events.push({
          index: i,
          type,
          direction: 'bullish',
          level: lastSwingHigh.price,
          swingIndex: lastSwingHigh.index
        });
        trend = 'bullish';
        addOrderBlock('bullish', i);
        lastSwingHigh = null;
      }
      if (lastSwingLow && i > lastSwingLow.index + 1 && close < lastSwingLow.price) {
        const type = trend === 'bullish' ? 'CHoCH' : 'BOS';
        events.push({
          index: i,
          type,
          direction: 'bearish',
          level: lastSwingLow.price,
          swingIndex: lastSwingLow.index
        });
        trend = 'bearish';
        addOrderBlock('bearish', i);
        lastSwingLow = null;
      }
    }

    orderBlocks.forEach((block) => {
      for (let k = block.eventIndex + 1; k < len; k += 1) {
        if (block.type === 'bullish' && candles[k].low <= block.top) {
          block.mitigated = true;
          break;
        }
        if (block.type === 'bearish' && candles[k].high >= block.bottom) {
          block.mitigated = true;
          break;
        }
      }
    });

    const fvgs = [];
    for (let i = 2; i < len; i += 1) {
      const first = candles[i - 2];
      const current = candles[i];
      if (current.low > first.high) {
        const top = current.low;
        const bottom = first.high;
        let mitigated = false;
        for (let k = i + 1; k < len; k += 1) {
          if (candles[k].low <= top) {
            mitigated = true;
            break;
          }
        }
        fvgs.push({ index: i - 2, type: 'bullish', top, bottom, mitigated });
      } else if (current.high < first.low) {
        const top = first.low;
        const bottom = current.high;
        let mitigated = false;
        for (let k = i + 1; k < len; k += 1) {
          if (candles[k].high >= bottom) {
            mitigated = true;
            break;
          }
        }
        fvgs.push({ index: i - 2, type: 'bearish', top, bottom, mitigated });
      }
    }

    const lookback = Math.min(120, len);
    const rangeSlice = candles.slice(len - lookback);
    const rangeHigh = Math.max(...rangeSlice.map((candle) => candle.high));
    const rangeLow = Math.min(...rangeSlice.map((candle) => candle.low));
    const equilibrium = (rangeHigh + rangeLow) / 2;

    return {
      swings,
      events,
      orderBlocks,
      fvgs,
      trend,
      lastEvent: events.length ? events[events.length - 1] : null,
      equilibrium,
      rangeHigh,
      rangeLow,
      lastClose: candles[len - 1].close
    };
  }

  function zoneDistancePct(zone, price) {
    if (!zone || !Number.isFinite(price) || price <= 0) return Infinity;
    if (price >= zone.bottom && price <= zone.top) return 0;
    return (Math.min(Math.abs(price - zone.top), Math.abs(price - zone.bottom)) / price) * 100;
  }

  function nearestZones(smc, price) {
    const zones = [
      ...smc.orderBlocks.filter((zone) => !zone.mitigated),
      ...smc.fvgs.filter((zone) => !zone.mitigated)
    ];
    const bullish = zones
      .filter((zone) => zone.type === 'bullish')
      .sort((a, b) => zoneDistancePct(a, price) - zoneDistancePct(b, price))[0] || null;
    const bearish = zones
      .filter((zone) => zone.type === 'bearish')
      .sort((a, b) => zoneDistancePct(a, price) - zoneDistancePct(b, price))[0] || null;
    return {
      bullish,
      bearish,
      bullishDistancePct: zoneDistancePct(bullish, price),
      bearishDistancePct: zoneDistancePct(bearish, price)
    };
  }

  async function analyzeSymbol(symbol, interval, premiumMap) {
    const candles = await fetchKlines(symbol, interval);
    const closes = candles.map((candle) => candle.close);
    const ema20 = calcEma(closes, 20);
    const ema50 = calcEma(closes, 50);
    const rsiSeries = calcRsi(closes, 14);
    const cvd = calcCvd(candles);
    const smc = analyzeSmc(candles);
    const price = closes[closes.length - 1];
    const currentEma20 = ema20[ema20.length - 1];
    const currentEma50 = ema50[ema50.length - 1];
    const rsi = rsiSeries[rsiSeries.length - 1];
    const dist20 = currentEma20 ? ((price - currentEma20) / currentEma20) * 100 : 0;
    const dist50 = currentEma50 ? ((price - currentEma50) / currentEma50) * 100 : 0;
    const lookback = Math.min(20, candles.length - 1);
    const cvdChange = cvd[cvd.length - 1] - cvd[cvd.length - 1 - lookback];
    const averageVolume = candles.slice(-lookback).reduce((sum, candle) => sum + candle.volume, 0) / lookback || 1;
    const cvdNorm = clamp(cvdChange / (averageVolume * lookback), -1, 1);
    const priceChangePct = lookback > 0
      ? ((price - closes[closes.length - 1 - lookback]) / closes[closes.length - 1 - lookback]) * 100
      : 0;
    const pricePosition = price >= smc.equilibrium ? 'premium' : 'discount';
    const nearest = nearestZones(smc, price);
    const premium = premiumMap.get(`${symbol}USDT`) || null;
    const funding = premium ? Number(premium.lastFundingRate) : null;
    const nextFundingTime = premium ? Number(premium.nextFundingTime) : null;

    const emaLong = clamp(
      (price > currentEma20 && currentEma20 > currentEma50 ? 1
        : price > currentEma50 ? 0.75
          : price > currentEma20 ? 0.5 : 0.15)
      + (Math.abs(dist20) <= 1.5 ? 0.15 : (dist20 < -2 && price > currentEma50 ? 0.1 : 0)),
      0, 1
    );
    const emaShort = clamp(
      (price < currentEma20 && currentEma20 < currentEma50 ? 1
        : price < currentEma50 ? 0.75
          : price < currentEma20 ? 0.5 : 0.15)
      + (Math.abs(dist20) <= 1.5 ? 0.15 : (dist20 > 2 && price < currentEma50 ? 0.1 : 0)),
      0, 1
    );
    const rsiLong = rsi < 30 ? 0.9 : rsi < 45 ? 0.8 : rsi <= 60 ? 1 : rsi <= 70 ? 0.6 : 0.2;
    const rsiShort = rsi > 70 ? 0.9 : rsi > 55 ? 1 : rsi >= 40 ? 0.7 : rsi >= 30 ? 0.5 : 0.2;
    const cvdLong = clamp(0.5 + (cvdNorm * 2) + (priceChangePct < 0 && cvdChange > 0 ? 0.25 : 0), 0, 1);
    const cvdShort = clamp(0.5 - (cvdNorm * 2) + (priceChangePct > 0 && cvdChange < 0 ? 0.25 : 0), 0, 1);
    const smcLong = clamp(
      0.25
      + (smc.trend === 'bullish' ? 0.4 : 0)
      + (smc.lastEvent && smc.lastEvent.direction === 'bullish' ? 0.15 : 0)
      + (pricePosition === 'discount' ? 0.1 : 0)
      + (nearest.bullishDistancePct <= 1.5 ? 0.1 : 0),
      0, 1
    );
    const smcShort = clamp(
      0.25
      + (smc.trend === 'bearish' ? 0.4 : 0)
      + (smc.lastEvent && smc.lastEvent.direction === 'bearish' ? 0.15 : 0)
      + (pricePosition === 'premium' ? 0.1 : 0)
      + (nearest.bearishDistancePct <= 1.5 ? 0.1 : 0),
      0, 1
    );
    const longScore = 100 * ((0.3 * emaLong) + (0.2 * rsiLong) + (0.25 * cvdLong) + (0.25 * smcLong));
    const shortScore = 100 * ((0.3 * emaShort) + (0.2 * rsiShort) + (0.25 * cvdShort) + (0.25 * smcShort));
    const rawBias = longScore >= shortScore ? 'LONG' : 'SHORT';
    const score = Math.max(longScore, shortScore);
    const bias = score >= 50 ? rawBias : 'NEUTRAL';

    return {
      symbol,
      interval,
      price,
      rsi,
      ema20: currentEma20,
      ema50: currentEma50,
      dist20,
      dist50,
      cvdNorm,
      cvdChange,
      priceChangePct,
      smc,
      pricePosition,
      nearest,
      funding,
      nextFundingTime,
      longScore,
      shortScore,
      score: Math.round(score),
      bias,
      candles,
      ema20Series: ema20,
      ema50Series: ema50,
      rsiSeries
    };
  }

  async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function run() {
      while (nextIndex < items.length) {
        const current = nextIndex;
        nextIndex += 1;
        results[current] = await worker(items[current], current);
      }
    }
    const runners = Array.from({ length: Math.min(limit, items.length) }, run);
    await Promise.all(runners);
    return results;
  }

  function parserWatchlist(value) {
    const symbols = String(value || '')
      .split(/[\s,;]+/)
      .map(sanitizeSymbol)
      .filter(Boolean);
    return [...new Set(symbols)].slice(0, MAX_WATCHLIST);
  }

  const initialConfig = loadConfig();
  radarTimeframe = initialConfig.timeframe;

  const wrapper = document.createElement('div');
  wrapper.id = 'smc-modules-wrapper';
  wrapper.style.cssText = 'display:grid;grid-template-columns:1fr;gap:14px;margin:16px 0;';
  wrapper.innerHTML = `
    <article class="card smc-radar-card" id="smc-radar-card">
      <header class="card-header">
        <div>
          <div class="eyebrow">Módulo 8 · Radar multi-moneda</div>
          <h3>Radar de setups 4H / 1D</h3>
          <p>Escanea una watchlist configurable con EMA 20/50, RSI 14, absorción CVD, estructura SMC y funding de Binance Futures.</p>
        </div>
        <div class="card-header-meta">
          <span class="access-badge auto"><span class="access-dot"></span>Binance Spot + fapi</span>
          <span class="badge badge-neutral" id="smc-radar-top3">Top 3 pendiente</span>
        </div>
      </header>
      <div class="smc-controls">
        <label class="smc-field smc-watchlist-field">
          <span>Watchlist</span>
          <input id="smc-radar-watchlist" type="text" spellcheck="false" value="${escapeHtml(initialConfig.watchlist.join(', '))}" placeholder="SOL, SUI, XRP, BTC…" />
        </label>
        <div class="smc-tf-group" role="group" aria-label="Temporalidad del radar">
          <button type="button" class="smc-tf-btn${radarTimeframe === '4h' ? ' is-active' : ''}" data-radar-tf="4h">4H</button>
          <button type="button" class="smc-tf-btn${radarTimeframe === '1d' ? ' is-active' : ''}" data-radar-tf="1d">1D</button>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="smc-radar-scan">Escanear watchlist</button>
        <button type="button" class="btn btn-secondary btn-sm" id="smc-radar-restore">Restaurar lista</button>
        <button type="button" class="btn btn-secondary btn-sm" id="smc-send-top3">📲 Enviar Top 3 a Telegram</button>
      </div>
      <div class="smc-status-row">
        <span id="smc-radar-status">Pulsa “Escanear watchlist” para calcular los setups.</span>
        <span id="smc-radar-updated">Sin sincronizar</span>
      </div>
      <div class="table-wrap smc-radar-table-wrap">
        <table class="data-table smc-radar-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Activo</th>
              <th>Precio</th>
              <th>RSI</th>
              <th>EMA 20 / 50</th>
              <th>CVD</th>
              <th>SMC</th>
              <th>Funding</th>
              <th>Score</th>
              <th>Sesgo</th>
            </tr>
          </thead>
          <tbody id="smc-radar-body">
            <tr class="placeholder-row"><td colspan="10"><div class="table-empty compact"><span class="empty-icon"><i data-lucide="radar"></i></span><div><strong>Radar en espera</strong><span>Configura la watchlist y pulsa Escanear watchlist.</span></div></div></td></tr>
          </tbody>
        </table>
      </div>
    </article>

    <article class="card smc-scanner-card" id="smc-scanner-card">
      <header class="card-header">
        <div>
          <div class="eyebrow">Módulo 7 · Smart Money Concepts</div>
          <h3>Escáner SMC · BOS, CHoCH, OB y FVG</h3>
          <p>Detecta pivotes Swing High/Low, cambios de estructura, Order Blocks sin mitigar, Fair Value Gaps de 3 velas y la línea de equilibrio Premium/Discount.</p>
        </div>
        <div class="card-header-meta">
          <span class="access-badge auto"><span class="access-dot"></span>Binance Klines</span>
          <span class="badge badge-neutral" id="smc-bias-badge">Sin escanear</span>
        </div>
      </header>
      <div class="smc-controls">
        <label class="smc-field smc-symbol-field">
          <span>Activo</span>
          <input id="smc-symbol" type="text" spellcheck="false" value="SOL" placeholder="SOL, BTC, ETH…" />
        </label>
        <div class="smc-tf-group" role="group" aria-label="Temporalidad del escáner SMC">
          <button type="button" class="smc-tf-btn${smcTimeframe === '4h' ? ' is-active' : ''}" data-smc-tf="4h">4H</button>
          <button type="button" class="smc-tf-btn${smcTimeframe === '1d' ? ' is-active' : ''}" data-smc-tf="1d">1D</button>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="smc-scan">Escanear SMC</button>
        <button type="button" class="btn btn-secondary btn-sm" id="smc-use-current">Usar activo actual</button>
      </div>
      <div class="smc-status-row">
        <span id="smc-status">Iniciando escáner SMC…</span>
        <span id="smc-updated">Sin sincronizar</span>
      </div>
      <div class="smc-metrics-grid" id="smc-metrics">
        <div class="smc-metric"><span>Precio</span><strong id="smc-price">—</strong><small id="smc-price-sub">Última vela</small></div>
        <div class="smc-metric"><span>RSI 14</span><strong id="smc-rsi">—</strong><small>Momentum</small></div>
        <div class="smc-metric"><span>Estructura</span><strong id="smc-structure">—</strong><small id="smc-structure-sub">BOS / CHoCH</small></div>
        <div class="smc-metric"><span>Order Blocks</span><strong id="smc-ob-count">—</strong><small>Sin mitigar</small></div>
        <div class="smc-metric"><span>Fair Value Gaps</span><strong id="smc-fvg-count">—</strong><small>Sin mitigar</small></div>
        <div class="smc-metric"><span>Equilibrio 50%</span><strong id="smc-eq">—</strong><small id="smc-eq-position">Premium / Discount</small></div>
      </div>
      <div class="smc-canvas-wrap">
        <canvas id="smc-canvas" width="900" height="430" style="width:100%;height:430px;display:block;"></canvas>
      </div>
      <div class="smc-zones-wrap">
        <div class="smc-zones-head"><strong>Zonas SMC sin mitigar</strong><span id="smc-zones-count">0 zonas</span></div>
        <div class="table-wrap">
          <table class="data-table smc-zones-table">
            <thead><tr><th>Tipo</th><th>Zona</th><th>Estado</th><th>Distancia al precio</th></tr></thead>
            <tbody id="smc-zones-body">
              <tr class="placeholder-row"><td colspan="4"><div class="table-empty compact"><span>Sin zonas detectadas todavía.</span></div></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </article>
  `;

  const style = document.createElement('style');
  style.id = 'smc-modules-styles';
  style.textContent = `
    .smc-radar-card, .smc-scanner-card { margin-top: 0; }
    .smc-controls { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
    .smc-field { display: flex; flex-direction: column; gap: 4px; }
    .smc-field span { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; }
    .smc-field input { background: #0b0e14; border: 1px solid #374151; color: #fff; padding: 7px 9px; border-radius: 6px; font-size: 12px; font-weight: 600; }
    .smc-watchlist-field { flex: 1 1 360px; min-width: 240px; }
    .smc-symbol-field { flex: 0 1 140px; }
    .smc-tf-group { display: inline-flex; border: 1px solid #374151; border-radius: 6px; overflow: hidden; }
    .smc-tf-btn { background: #1f2937; color: #d1d5db; border: none; padding: 7px 12px; font-size: 11px; font-weight: 700; cursor: pointer; }
    .smc-tf-btn.is-active { background: #10b981; color: #000; }
    .smc-status-row { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 10px; color: #9ca3af; margin-bottom: 8px; }
    .smc-radar-table-wrap { max-height: 460px; overflow: auto; border: 1px solid #1f2937; border-radius: 8px; }
    .smc-radar-table { font-size: 11px; }
    .smc-radar-table th { position: sticky; top: 0; z-index: 1; background: #151924; }
    .smc-radar-table tr[data-radar-symbol] { cursor: pointer; }
    .smc-radar-table tr[data-radar-symbol]:hover { background: #111827; }
    .smc-score { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; padding: 3px 7px; border-radius: 5px; font-weight: 800; font-size: 11px; }
    .smc-score.is-high { background: #064e3b; color: #86efac; }
    .smc-score.is-medium { background: #78350f; color: #fde68a; }
    .smc-score.is-low { background: #1f2937; color: #d1d5db; }
    .smc-bias { display: inline-flex; padding: 3px 7px; border-radius: 5px; font-size: 10px; font-weight: 800; }
    .smc-bias.is-long { background: #064e3b; color: #86efac; }
    .smc-bias.is-short { background: #7f1d1d; color: #fca5a5; }
    .smc-bias.is-neutral { background: #1f2937; color: #d1d5db; }
    .smc-sub { color: #6b7280; font-size: 9px; }
    .smc-metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 8px; margin-bottom: 10px; }
    .smc-metric { background: #151924; border: 1px solid #1f2937; border-left: 3px solid #374151; border-radius: 7px; padding: 8px 9px; }
    .smc-metric span { display: block; font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; }
    .smc-metric strong { display: block; margin-top: 2px; font-size: 14px; color: #f3f4f6; }
    .smc-metric small { display: block; margin-top: 2px; font-size: 9px; color: #6b7280; }
    .smc-metric.is-long { border-left-color: #10b981; }
    .smc-metric.is-short { border-left-color: #ef4444; }
    .smc-metric.is-neutral { border-left-color: #64748b; }
    .smc-canvas-wrap { border: 1px solid #1f2937; border-radius: 8px; overflow: hidden; background: #070a10; margin-bottom: 10px; }
    .smc-zones-wrap { border-top: 1px solid #1f2937; padding-top: 10px; }
    .smc-zones-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #d1d5db; margin-bottom: 6px; }
    .smc-zones-head span { color: #9ca3af; font-size: 10px; }
    .smc-zones-table { font-size: 11px; }
    .smc-zone-type { font-weight: 800; }
    .smc-zone-type.bullish { color: #10b981; }
    .smc-zone-type.bearish { color: #ef4444; }
    @media (max-width: 760px) {
      .smc-controls { align-items: stretch; }
      .smc-watchlist-field, .smc-symbol-field { flex: 1 1 100%; }
      .smc-canvas-wrap canvas { height: 360px !important; }
      #smc-radar-card .card-header, #smc-scanner-card .card-header { flex-direction: column; align-items: flex-start; }
    }
  `;

  const panel = document.getElementById('panel-deep-dive');
  if (!panel) return;
  const anchor = panel.querySelector('.token-search-card');
  if (anchor) panel.insertBefore(wrapper, anchor);
  else panel.appendChild(wrapper);
  document.head.appendChild(style);

  const radarWatchlistInput = document.getElementById('smc-radar-watchlist');
  const radarStatus = document.getElementById('smc-radar-status');
  const radarUpdated = document.getElementById('smc-radar-updated');
  const radarBody = document.getElementById('smc-radar-body');
  const radarTop3 = document.getElementById('smc-radar-top3');
  const smcSymbolInput = document.getElementById('smc-symbol');
  const smcStatus = document.getElementById('smc-status');
  const smcUpdated = document.getElementById('smc-updated');
  const smcCanvas = document.getElementById('smc-canvas');
  const smcBiasBadge = document.getElementById('smc-bias-badge');

  function setRadarStatus(text, color = '#9ca3af') {
    if (!radarStatus) return;
    radarStatus.textContent = text;
    radarStatus.style.color = color;
  }

  function setSmcStatus(text, color = '#9ca3af') {
    if (!smcStatus) return;
    smcStatus.textContent = text;
    smcStatus.style.color = color;
  }

  function renderRadarRows(rows) {
    if (!radarBody) return;
    const valid = rows.filter((row) => row && !row.error)
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    if (!rows.length) {
      radarBody.innerHTML = '<tr class="placeholder-row"><td colspan="10"><div class="table-empty compact"><span>Sin activos en la watchlist.</span></div></td></tr>';
      radarTop3.textContent = 'Top 3 pendiente';
      return;
    }
    const sorted = rows.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    radarBody.innerHTML = sorted.map((row, index) => {
      if (row.error) {
        return `<tr><td>${index + 1}</td><td><strong>${escapeHtml(row.symbol)}</strong></td><td colspan="8" class="smc-sub">Error: ${escapeHtml(row.error)}</td></tr>`;
      }
      const scoreClass = row.score >= 75 ? 'is-high' : row.score >= 55 ? 'is-medium' : 'is-low';
      const biasClass = row.bias === 'LONG' ? 'is-long' : row.bias === 'SHORT' ? 'is-short' : 'is-neutral';
      const smcLabel = row.smc.lastEvent
        ? `${row.smc.lastEvent.type} ${row.smc.lastEvent.direction === 'bullish' ? '↑' : '↓'}`
        : row.smc.trend === 'bullish' ? 'Bullish' : row.smc.trend === 'bearish' ? 'Bearish' : 'Neutral';
      const cvdLabel = `${row.cvdNorm >= 0 ? '+' : ''}${row.cvdNorm.toFixed(2)}`;
      return `<tr data-radar-symbol="${escapeHtml(row.symbol)}">
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(row.symbol)}</strong><div class="smc-sub">${escapeHtml(row.interval.toUpperCase())} · ${escapeHtml(row.pricePosition)}</div></td>
        <td>$${escapeHtml(formatPrice(row.price))}</td>
        <td>${row.rsi.toFixed(1)}</td>
        <td>${escapeHtml(formatPct(row.dist20))}<div class="smc-sub">${escapeHtml(formatPct(row.dist50))}</div></td>
        <td>${escapeHtml(cvdLabel)}<div class="smc-sub">${row.priceChangePct < 0 && row.cvdChange > 0 ? 'Absorción' : row.priceChangePct > 0 && row.cvdChange < 0 ? 'Distribución' : 'Neutral'}</div></td>
        <td>${escapeHtml(smcLabel)}<div class="smc-sub">${escapeHtml(row.smc.trend)}</div></td>
        <td>${escapeHtml(formatFunding(row.funding))}</td>
        <td><span class="smc-score ${scoreClass}">${row.score}</span></td>
        <td><span class="smc-bias ${biasClass}">${escapeHtml(row.bias)}</span></td>
      </tr>`;
    }).join('');

    const top = valid.slice(0, 3);
    if (radarTop3) {
      radarTop3.textContent = top.length
        ? `Top 3: ${top.map((row) => `${row.symbol} ${row.score}`).join(' · ')}`
        : 'Top 3 pendiente';
    }
  }

  function buildTop3Message(rows) {
    const top = rows.filter((row) => row && !row.error)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 3);
    if (!top.length) return '';
    const lines = top.map((row, index) => {
      return `${index + 1}. <b>${escapeHtml(row.symbol)}</b> · ${escapeHtml(row.bias)} · ${row.score}/100\n` +
        `   Precio $${escapeHtml(formatPrice(row.price))} · RSI ${row.rsi.toFixed(1)} · EMA20 ${escapeHtml(formatPct(row.dist20))} · Funding ${escapeHtml(formatFunding(row.funding))}`;
    });
    return `🎯 <b>Radar Multi-Moneda · Top 3</b>\n⏱ ${String(radarTimeframe).toUpperCase()} · ${escapeHtml(new Date().toLocaleString('es-ES'))}\n\n${lines.join('\n\n')}`;
  }

  async function scanRadar() {
    if (radarScanning) return;
    const symbols = parserWatchlist(radarWatchlistInput ? radarWatchlistInput.value : '');
    if (!symbols.length) {
      setRadarStatus('Escribe al menos un ticker válido en la watchlist.', '#ef4444');
      return;
    }
    radarScanning = true;
    if (radarWatchlistInput) radarWatchlistInput.value = symbols.join(', ');
    saveConfig({ watchlist: symbols, timeframe: radarTimeframe });
    setRadarStatus(`Escaneando ${symbols.length} activos en ${radarTimeframe.toUpperCase()}…`, '#f59e0b');
    if (radarUpdated) radarUpdated.textContent = 'Escaneando…';
    const scanButton = document.getElementById('smc-radar-scan');
    if (scanButton) scanButton.disabled = true;
    try {
      const premiumMap = await fetchPremiumMap();
      const rows = await mapLimit(symbols, 4, async (symbol) => {
        try {
          return await analyzeSymbol(symbol, radarTimeframe, premiumMap);
        } catch (error) {
          return { symbol, error: error && error.message ? error.message : 'Error de datos' };
        }
      });
      radarRows = rows.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
      renderRadarRows(radarRows);
      const valid = rows.filter((row) => !row.error);
      const errors = rows.length - valid.length;
      setRadarStatus(
        `Escaneo completado: ${valid.length}/${rows.length} activos válidos${errors ? ` · ${errors} con error` : ''}.`,
        errors ? '#f59e0b' : '#10b981'
      );
      if (radarUpdated) radarUpdated.textContent = `Actualizado ${new Date().toLocaleTimeString('es-ES')}`;
    } catch (error) {
      setRadarStatus(`No se pudo completar el radar: ${error.message || 'error de red'}.`, '#ef4444');
    } finally {
      radarScanning = false;
      if (scanButton) scanButton.disabled = false;
    }
  }

  function smcStructureLabel(smc) {
    if (!smc) return '—';
    if (smc.lastEvent) {
      return `${smc.lastEvent.type} ${smc.lastEvent.direction === 'bullish' ? '↑' : '↓'}`;
    }
    return smc.trend === 'bullish' ? 'Bullish' : smc.trend === 'bearish' ? 'Bearish' : 'Neutral';
  }

  function drawSmcCanvas(result) {
    if (!smcCanvas || !result) return;
    const ctx = smcCanvas.getContext('2d');
    const W = smcCanvas.width;
    const H = smcCanvas.height;
    const candles = result.candles;
    const smc = result.smc;
    const len = candles.length;
    const viewCount = 120;
    const start = Math.max(0, len - viewCount);
    const visible = candles.slice(start);
    const left = 8;
    const rightPad = 78;
    const top = 10;
    const bottom = 10;
    const chartW = W - left - rightPad;
    const chartH = H - top - bottom;
    const stepX = chartW / visible.length;
    const minPrice = Math.min(...visible.map((candle) => candle.low));
    const maxPrice = Math.max(...visible.map((candle) => candle.high));
    const padding = (maxPrice - minPrice) * 0.06 || 1;
    const rangeMin = minPrice - padding;
    const rangeMax = maxPrice + padding;
    const range = rangeMax - rangeMin || 1;
    const xOf = (index) => left + ((index - start) * stepX) + (stepX / 2);
    const yOf = (price) => top + chartH - (((price - rangeMin) / range) * chartH);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#141c2b';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i += 1) {
      const y = top + (chartH / 5) * i;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + chartW, y);
      ctx.stroke();
    }

    // Zonas premium / discount
    const eqY = yOf(smc.equilibrium);
    ctx.fillStyle = 'rgba(239,68,68,0.035)';
    ctx.fillRect(left, top, chartW, Math.max(0, eqY - top));
    ctx.fillStyle = 'rgba(16,185,129,0.035)';
    ctx.fillRect(left, eqY, chartW, Math.max(0, top + chartH - eqY));

    // Velas
    visible.forEach((candle, index) => {
      const globalIndex = start + index;
      const x = xOf(globalIndex);
      const isGreen = candle.close >= candle.open;
      ctx.strokeStyle = isGreen ? '#10b981' : '#ef4444';
      ctx.fillStyle = isGreen ? '#10b981' : '#ef4444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(candle.high));
      ctx.lineTo(x, yOf(candle.low));
      ctx.stroke();
      const yOpen = yOf(candle.open);
      const yClose = yOf(candle.close);
      const bodyTop = Math.min(yOpen, yClose);
      const bodyHeight = Math.max(Math.abs(yClose - yOpen), 1);
      ctx.fillRect(x - (stepX * 0.32), bodyTop, stepX * 0.64, bodyHeight);
    });

    // EMA 20/50
    const drawEma = (series, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let started = false;
      for (let i = start; i < len; i += 1) {
        const value = series[i];
        if (!Number.isFinite(value)) continue;
        const x = xOf(i);
        const y = yOf(value);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };
    drawEma(result.ema20Series, 'rgba(59,130,246,0.75)');
    drawEma(result.ema50Series, 'rgba(245,158,11,0.7)');

    // Order Blocks y FVG sin mitigar
    const drawZone = (zone, fill, border, label, dashed) => {
      if (zone.mitigated) return;
      const zoneStart = Math.max(start, zone.index);
      const x1 = xOf(zoneStart);
      const x2 = W - 4;
      const yTop = yOf(zone.top);
      const yBottom = yOf(zone.bottom);
      ctx.fillStyle = fill;
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.setLineDash(dashed ? [4, 4] : []);
      ctx.fillRect(x1, Math.min(yTop, yBottom), Math.max(1, x2 - x1), Math.max(1, Math.abs(yBottom - yTop)));
      ctx.strokeRect(x1, Math.min(yTop, yBottom), Math.max(1, x2 - x1), Math.max(1, Math.abs(yBottom - yTop)));
      ctx.setLineDash([]);
      ctx.fillStyle = border;
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(label, x2 - 3, Math.min(yTop, yBottom) + 10);
    };

    smc.orderBlocks.forEach((block) => {
      drawZone(
        block,
        block.type === 'bullish' ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.14)',
        block.type === 'bullish' ? '#10b981' : '#ef4444',
        block.type === 'bullish' ? 'OB +' : 'OB -',
        false
      );
    });
    smc.fvgs.forEach((gap) => {
      drawZone(
        gap,
        gap.type === 'bullish' ? 'rgba(59,130,246,0.12)' : 'rgba(245,158,11,0.12)',
        gap.type === 'bullish' ? '#60a5fa' : '#f59e0b',
        gap.type === 'bullish' ? 'FVG +' : 'FVG -',
        true
      );
    });

    // Línea de equilibrio 50%
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(left, eqY);
    ctx.lineTo(left + chartW, eqY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`EQ 50% ${formatPrice(smc.equilibrium)}`, left + chartW + rightPad - 6, eqY - 5);

    // Pivotes Swing High/Low
    smc.swings.forEach((swing) => {
      if (swing.index < start || swing.index >= len) return;
      const x = xOf(swing.index);
      const y = yOf(swing.price);
      ctx.beginPath();
      if (swing.type === 'high') {
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x - 3, y - 10);
        ctx.lineTo(x + 3, y - 10);
      } else {
        ctx.moveTo(x, y + 5);
        ctx.lineTo(x - 3, y + 10);
        ctx.lineTo(x + 3, y + 10);
      }
      ctx.closePath();
      ctx.fillStyle = swing.type === 'high' ? 'rgba(239,68,68,0.8)' : 'rgba(16,185,129,0.8)';
      ctx.fill();
    });

    // BOS / CHoCH
    smc.events.forEach((event) => {
      if (event.index < start || event.index >= len) return;
      const x = xOf(event.index);
      const y = yOf(event.level);
      const label = `${event.type} ${event.direction === 'bullish' ? '↑' : '↓'}`;
      ctx.font = 'bold 9px sans-serif';
      const width = ctx.measureText(label).width + 8;
      const boxX = clamp(x - (width / 2), left, left + chartW - width);
      ctx.fillStyle = 'rgba(11,14,20,0.88)';
      ctx.fillRect(boxX, y - 18, width, 13);
      ctx.fillStyle = event.direction === 'bullish' ? '#10b981' : '#ef4444';
      ctx.textAlign = 'center';
      ctx.fillText(label, boxX + (width / 2), y - 8);
    });

    // Último precio
    const lastPrice = candles[len - 1].close;
    const lastY = yOf(lastPrice);
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(left, lastY);
    ctx.lineTo(left + chartW, lastY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#d1d5db';
    ctx.textAlign = 'left';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(`$${formatPrice(lastPrice)}`, left + chartW + 4, lastY + 3);

    // Leyenda
    const unfinishedOb = smc.orderBlocks.filter((block) => !block.mitigated).length;
    const unfinishedFvg = smc.fvgs.filter((gap) => !gap.mitigated).length;
    ctx.fillStyle = 'rgba(11,14,20,0.88)';
    ctx.fillRect(left + 4, top + 4, 188, 30);
    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.strokeRect(left + 4, top + 4, 188, 30);
    ctx.fillStyle = '#f3f4f6';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${result.symbol} · ${result.interval.toUpperCase()} · ${smcStructureLabel(smc)}`, left + 10, top + 16);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9px sans-serif';
    ctx.fillText(`OB sin mitigar: ${unfinishedOb} · FVG sin mitigar: ${unfinishedFvg}`, left + 10, top + 28);

    ctx.textAlign = 'left';
  }

  function renderSmcZones(result) {
    const body = document.getElementById('smc-zones-body');
    const count = document.getElementById('smc-zones-count');
    if (!body || !result) return;
    const allZones = [
      ...result.smc.orderBlocks.filter((zone) => !zone.mitigated).map((zone) => ({ ...zone, kind: 'OB' })),
      ...result.smc.fvgs.filter((zone) => !zone.mitigated).map((zone) => ({ ...zone, kind: 'FVG' }))
    ]
      .map((zone) => ({ ...zone, distance: zoneDistancePct(zone, result.price) }))
      .sort((a, b) => a.distance - b.distance);
    const zones = allZones.slice(0, 14);

    if (count) count.textContent = `${allZones.length} zona${allZones.length === 1 ? '' : 's'}`;
    if (!zones.length) {
      body.innerHTML = '<tr class="placeholder-row"><td colspan="4"><div class="table-empty compact"><span>Sin Order Blocks ni FVG sin mitigar en las últimas velas.</span></div></td></tr>';
      return;
    }
    body.innerHTML = zones.map((zone) => {
      const typeLabel = `${zone.kind} ${zone.type === 'bullish' ? 'alcista' : 'bajista'}`;
      return `<tr>
        <td><span class="smc-zone-type ${zone.type}">${escapeHtml(typeLabel)}</span></td>
        <td>$${escapeHtml(formatPrice(zone.bottom))} – $${escapeHtml(formatPrice(zone.top))}</td>
        <td>${zone.mitigated ? 'Mitigada' : '🟢 Sin mitigar'}</td>
        <td>${zone.distance === 0 ? 'Dentro de la zona' : `${zone.distance.toFixed(2)}%`}</td>
      </tr>`;
    }).join('');
  }

  function renderSmcMetrics(result) {
    if (!result) return;
    const smc = result.smc;
    const unfinishedOb = smc.orderBlocks.filter((block) => !block.mitigated).length;
    const unfinishedFvg = smc.fvgs.filter((gap) => !gap.mitigated).length;
    const structure = smcStructureLabel(smc);
    const bias = smc.trend === 'bullish' ? 'Bullish' : smc.trend === 'bearish' ? 'Bearish' : 'Neutral';
    const biasClass = smc.trend === 'bullish' ? 'is-long' : smc.trend === 'bearish' ? 'is-short' : 'is-neutral';
    const eqPosition = result.price >= smc.equilibrium ? 'Premium' : 'Discount';
    const setMetricTone = (id, className) => {
      const element = document.getElementById(id);
      const card = element ? element.closest('.smc-metric') : null;
      if (card) {
        card.classList.remove('is-long', 'is-short', 'is-neutral');
        card.classList.add(className);
      }
    };
    const setText = (id, text) => {
      const element = document.getElementById(id);
      if (element) element.textContent = text;
    };
    setText('smc-price', `$${formatPrice(result.price)}`);
    setText('smc-price-sub', `${result.symbol} · ${result.interval.toUpperCase()}`);
    setText('smc-rsi', result.rsi.toFixed(1));
    setText('smc-structure', structure);
    setText('smc-structure-sub', bias);
    setText('smc-ob-count', String(unfinishedOb));
    setText('smc-fvg-count', String(unfinishedFvg));
    setText('smc-eq', `$${formatPrice(smc.equilibrium)}`);
    setText('smc-eq-position', `${eqPosition} · rango ${formatPrice(smc.rangeLow)} – ${formatPrice(smc.rangeHigh)}`);
    if (smcBiasBadge) {
      smcBiasBadge.className = `badge ${smc.trend === 'bullish' ? 'badge-green' : smc.trend === 'bearish' ? 'badge-bear' : 'badge-neutral'}`;
      smcBiasBadge.textContent = bias;
    }
    setMetricTone('smc-price', 'is-neutral');
    setMetricTone('smc-structure', biasClass);
    setMetricTone('smc-eq', eqPosition === 'Premium' ? 'is-short' : 'is-long');
    if (smcUpdated) smcUpdated.textContent = `Actualizado ${new Date().toLocaleTimeString('es-ES')}`;
  }

  async function scanSmc(symbolInput = null, intervalInput = null) {
    if (smcScanning) return;
    const symbol = sanitizeSymbol(symbolInput || (smcSymbolInput ? smcSymbolInput.value : '') || 'SOL');
    if (!symbol) {
      setSmcStatus('Escribe un ticker válido para el escáner SMC.', '#ef4444');
      return;
    }
    const interval = intervalInput || smcTimeframe;
    smcTimeframe = interval === '1d' ? '1d' : '4h';
    if (smcSymbolInput) smcSymbolInput.value = symbol;
    document.querySelectorAll('[data-smc-tf]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.smcTf === smcTimeframe);
    });
    smcScanning = true;
    setSmcStatus(`Escaneando ${symbol} en ${smcTimeframe.toUpperCase()}…`, '#f59e0b');
    const scanButton = document.getElementById('smc-scan');
    if (scanButton) scanButton.disabled = true;
    try {
      const premiumMap = await fetchPremiumMap();
      const result = await analyzeSymbol(symbol, smcTimeframe, premiumMap);
      lastSmcResult = result;
      renderSmcMetrics(result);
      renderSmcZones(result);
      drawSmcCanvas(result);
      setSmcStatus(
        `SMC completado: ${result.smc.trend} · ${result.smc.events.length} eventos · ${result.smc.orderBlocks.filter((block) => !block.mitigated).length} OB y ${result.smc.fvgs.filter((gap) => !gap.mitigated).length} FVG sin mitigar.`,
        '#10b981'
      );
    } catch (error) {
      lastSmcResult = null;
      const ctx = smcCanvas ? smcCanvas.getContext('2d') : null;
      if (ctx && smcCanvas) ctx.clearRect(0, 0, smcCanvas.width, smcCanvas.height);
      setSmcStatus(`No se pudo escanear ${symbol}: ${error.message || 'error de datos'}.`, '#ef4444');
    } finally {
      smcScanning = false;
      if (scanButton) scanButton.disabled = false;
    }
  }

  async function sendTop3() {
    const valid = radarRows.filter((row) => row && !row.error);
    if (!valid.length) {
      setRadarStatus('Primero escanea la watchlist para generar el Top 3.', '#f59e0b');
      return;
    }
    if (!window.universalAlerts || typeof window.universalAlerts.sendTelegramNotification !== 'function') {
      setRadarStatus('El módulo de Telegram no está disponible. Abre Alertas & Telegram.', '#f59e0b');
      return;
    }
    const message = buildTop3Message(valid);
    const button = document.getElementById('smc-send-top3');
    if (button) button.disabled = true;
    setRadarStatus('Enviando Top 3 a Telegram…', '#60a5fa');
    try {
      const ok = await window.universalAlerts.sendTelegramNotification(message);
      if (ok) {
        setRadarStatus('✅ Top 3 enviado a Telegram.', '#10b981');
      } else {
        const error = window.universalAlerts.getLastTelegramError ? window.universalAlerts.getLastTelegramError() : '';
        setRadarStatus(`⚠️ No se pudo enviar a Telegram: ${error || 'revisa la configuración.'}`, '#ef4444');
      }
    } catch (error) {
      setRadarStatus(`⚠️ Error al enviar a Telegram: ${error.message || 'desconocido'}.`, '#ef4444');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function restoreWatchlist() {
    radarTimeframe = '4h';
    if (radarWatchlistInput) radarWatchlistInput.value = DEFAULT_WATCHLIST.join(', ');
    document.querySelectorAll('[data-radar-tf]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.radarTf === radarTimeframe);
    });
    saveConfig({ watchlist: DEFAULT_WATCHLIST.slice(), timeframe: radarTimeframe });
    setRadarStatus('Watchlist restaurada. Pulsa Escanear watchlist.', '#9ca3af');
  }

  document.querySelectorAll('[data-radar-tf]').forEach((button) => {
    button.addEventListener('click', () => {
      radarTimeframe = button.dataset.radarTf === '1d' ? '1d' : '4h';
      document.querySelectorAll('[data-radar-tf]').forEach((item) => {
        item.classList.toggle('is-active', item.dataset.radarTf === radarTimeframe);
      });
      const symbols = parserWatchlist(radarWatchlistInput ? radarWatchlistInput.value : '');
      saveConfig({ watchlist: symbols.length ? symbols : DEFAULT_WATCHLIST.slice(), timeframe: radarTimeframe });
      setRadarStatus(`Temporalidad ${radarTimeframe.toUpperCase()} seleccionada. Pulsa Escanear watchlist.`, '#9ca3af');
    });
  });

  document.querySelectorAll('[data-smc-tf]').forEach((button) => {
    button.addEventListener('click', () => {
      smcTimeframe = button.dataset.smcTf === '1d' ? '1d' : '4h';
      document.querySelectorAll('[data-smc-tf]').forEach((item) => {
        item.classList.toggle('is-active', item.dataset.smcTf === smcTimeframe);
      });
      scanSmc(null, smcTimeframe);
    });
  });

  document.getElementById('smc-radar-scan')?.addEventListener('click', scanRadar);
  document.getElementById('smc-radar-restore')?.addEventListener('click', restoreWatchlist);
  document.getElementById('smc-send-top3')?.addEventListener('click', sendTop3);
  document.getElementById('smc-scan')?.addEventListener('click', () => scanSmc());
  document.getElementById('smc-use-current')?.addEventListener('click', () => {
    const current = sanitizeSymbol(
      (document.getElementById('tcs-search-input') && document.getElementById('tcs-search-input').value)
      || (document.getElementById('token-search-input') && document.getElementById('token-search-input').value)
      || 'SOL'
    );
    if (smcSymbolInput) smcSymbolInput.value = current;
    scanSmc(current, smcTimeframe);
  });

  radarBody?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-radar-symbol]');
    if (!row) return;
    const symbol = row.dataset.radarSymbol;
    if (!symbol) return;
    if (smcSymbolInput) smcSymbolInput.value = symbol;
    const panelDeepDive = document.getElementById('smc-scanner-card');
    if (panelDeepDive) panelDeepDive.scrollIntoView({ behavior: 'smooth', block: 'start' });
    scanSmc(symbol, radarTimeframe);
  });

  radarWatchlistInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      scanRadar();
    }
  });
  smcSymbolInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      scanSmc();
    }
  });

  window.smcModules = {
    scanRadar,
    scanSmc,
    analyzeSymbol,
    analyzeSmc,
    buildTop3Message,
    sendTop3,
    getRadarRows: () => radarRows.map((row) => ({ ...row })),
    getSmcResult: () => lastSmcResult,
    getConfig: () => (lastRadarConfig ? { ...lastRadarConfig } : loadConfig())
  };

  // Arranque: escaneo SMC del activo actual con 4H. El radar espera el botón.
  const currentSymbol = sanitizeSymbol(
    (document.getElementById('tcs-search-input') && document.getElementById('tcs-search-input').value)
    || 'SOL'
  ) || 'SOL';
  if (smcSymbolInput) smcSymbolInput.value = currentSymbol;
  window.setTimeout(() => scanSmc(currentSymbol, smcTimeframe), 700);
})();
