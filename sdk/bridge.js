/**
 * 浏览器端「面板签名桥」：car.html 用它调 3.0.6 接口。
 *
 * 为什么单独一份：
 *   api.html 是接口调试台，逻辑里混了大量表单/响应渲染；car.html 只需要「拿数据 + 写数据」。
 *   这里把 api.html 里那套已经踩过坑的请求路径抽出来复用（**语义保持一致**，不要各自演化）：
 *
 *   1) 面板模式（默认）：在隐藏 iframe 里加载同目录 index.html，直接借它的
 *      `API.call(panelTag, params, opts)` 与 `ZEEHO_SIGN.sign(url, params, body, method)`。
 *      面板的签名套件与登录态都在同源 localStorage 里，本页面不保存任何密钥。
 *   2) 自填模式：填 App 3.0.6 的 appId / appSecret，用 sdk/zeeho-api.js 的 buildHeaders 自签名。
 *
 * 已知坑（都是实测踩出来的，改这里前先读 docs/API-3.0.6.md）：
 *   · `vehicleHomePageV2` 网关按 UA 放行，浏览器 fetch 改不了 User-Agent（forbidden header），
 *     所以自填模式取不到它 —— 必须走面板模式的 API.call。
 *   · 面板 signer 的 preimage 是「规范化 query + body」，不含 scheme://host/path，
 *     因此不能拿完整 URL 去喂 buildHeaders，只能喂 `sign(url, toQuery, body, method)`。
 *   · 401 时网关返回 XML 而不是 JSON；这里统一归一化成 {ok:false,status:401,...}。
 */

import { DEFAULT_BASE, buildHeaders, rfc3986 } from './zeeho-api.js';

/** 与 api.html / 面板共用同一批 localStorage 键，登录一次三处都能用。 */
export const STORAGE = {
  token: 'zeeho.token',
  cfg: 'zeeho.api.cfg',
  mode: 'zeeho.api.mode',
  secret: 'zeeho.api.secret',
  basic: 'zeeho.api.basic',
  vin: 'zeeho.api.vin',
  uid: 'zeeho.api.uid',
  theme: 'zeeho.api.theme',
};

export const PANEL_URL = './index.html';

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 隐私模式 */ }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** 与 api.html 一致：只清掉填错的引号等，不做过度清洗。 */
export function trimUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

/** 面板签名用的 query 展开：同名多值 -> 数组。 */
export function queryParamsOf(url) {
  const params = {};
  for (const [key, value] of new URL(url).searchParams) {
    if (params[key] === undefined) params[key] = value;
    else if (Array.isArray(params[key])) params[key].push(value);
    else params[key] = [params[key], value];
  }
  return params;
}

/** 按 canonicalQuery 的规则拼 query（空格 %20、~ 保留），不能用 URLSearchParams。 */
export function buildUrl(base, path, query = {}) {
  let url = `${trimUrl(base)}${String(path).startsWith('/') ? '' : '/'}${path}`;
  const pairs = [];
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    pairs.push(`${rfc3986(key)}=${rfc3986(String(value))}`);
  }
  if (pairs.length) url += (url.includes('?') ? '&' : '?') + pairs.join('&');
  return url;
}

/** 401 的 XML / 网关 HTML 不能让 JSON.parse 抛出去。 */
export function parseBody(text) {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

export function createBridge({ onStatus } = {}) {
  const state = {
    mode: 'panel',
    cfg: { base: DEFAULT_BASE, appId: '', appSecret: '', basic: '' },
    token: '',
    vin: '',
    uid: '',
    panelFrame: null,
    panelWin: null,
    loading: null,
  };

  const status = (kind, text) => { try { onStatus?.(kind, text); } catch { /* UI 不该影响请求 */ } };

  function loadSettings() {
    state.mode = localStorage.getItem(STORAGE.mode) || 'panel';
    const stored = loadJson(STORAGE.cfg, {});
    // appSecret / Basic 比 appId 敏感：只放 sessionStorage（关标签页即失效）。
    delete stored.appSecret;
    delete stored.basic;
    state.cfg = { base: DEFAULT_BASE, appId: '', appSecret: '', basic: '', ...stored };
    try { state.cfg.appSecret = sessionStorage.getItem(STORAGE.secret) || ''; } catch { /* 隐私模式 */ }
    try { state.cfg.basic = sessionStorage.getItem(STORAGE.basic) || ''; } catch { /* 隐私模式 */ }
    state.token = localStorage.getItem(STORAGE.token) || '';
    state.vin = localStorage.getItem(STORAGE.vin) || '';
    state.uid = localStorage.getItem(STORAGE.uid) || '';
    return state;
  }

  function saveSettings({ mode, base, appId, appSecret, basic } = {}) {
    if (mode) { state.mode = mode; localStorage.setItem(STORAGE.mode, mode); }
    if (base !== undefined) state.cfg.base = trimUrl(base) || DEFAULT_BASE;
    if (appId !== undefined) state.cfg.appId = appId;
    if (appSecret !== undefined) state.cfg.appSecret = appSecret;
    if (basic !== undefined) state.cfg.basic = basic;
    saveJson(STORAGE.cfg, { base: state.cfg.base, appId: state.cfg.appId });
    try {
      if (state.cfg.appSecret) sessionStorage.setItem(STORAGE.secret, state.cfg.appSecret);
      else sessionStorage.removeItem(STORAGE.secret);
      if (state.cfg.basic) sessionStorage.setItem(STORAGE.basic, state.cfg.basic);
      else sessionStorage.removeItem(STORAGE.basic);
    } catch { /* 隐私模式 */ }
  }

  function setToken(token) {
    state.token = String(token || '');
    try {
      if (state.token) localStorage.setItem(STORAGE.token, state.token);
      else localStorage.removeItem(STORAGE.token);
    } catch { /* 隐私模式 */ }
  }

  function setVin(vin) {
    state.vin = String(vin || '');
    try { if (state.vin) localStorage.setItem(STORAGE.vin, state.vin); } catch { /* 隐私模式 */ }
  }

  function setUid(uid) {
    state.uid = String(uid || '');
    try { if (state.uid) localStorage.setItem(STORAGE.uid, state.uid); } catch { /* 隐私模式 */ }
  }

  function hasOwnCredentials() {
    return Boolean(state.cfg.appId && state.cfg.appSecret);
  }

  function base() {
    return trimUrl(state.cfg.base) || DEFAULT_BASE;
  }

  /** 加载面板签名载体。并发调用共享同一次加载。 */
  function loadPanel(timeoutMs = 12000) {
    if (state.panelWin?.ZEEHO_SIGN?.buildHeaders) return Promise.resolve(true);
    if (state.loading) return state.loading;
    state.loading = (async () => {
      if (!state.panelFrame) {
        const iframe = document.createElement('iframe');
        iframe.src = PANEL_URL;
        iframe.title = '面板签名载体';
        iframe.setAttribute('aria-hidden', 'true');
        iframe.tabIndex = -1;
        iframe.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;opacity:0;pointer-events:none;border:0';
        document.body.appendChild(iframe);
        state.panelFrame = iframe;
      }
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        try {
          const win = state.panelFrame.contentWindow;
          if (win?.ZEEHO_SIGN?.buildHeaders) {
            state.panelWin = win;
            // 面板与调试台/本页共享 localStorage 登录态；面板内存里的 token 更新，UUID 形态优先。
            const apiToken = String(win.API?.token || '');
            const storedToken = win.localStorage?.getItem(STORAGE.token) || '';
            const panelToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(apiToken)
              ? apiToken
              : (storedToken || apiToken);
            if (panelToken && panelToken !== state.token) setToken(panelToken);
            return true;
          }
        } catch { /* iframe 还没初始化完 */ }
        await sleep(120);
      }
      return false;
    })().finally(() => { state.loading = null; });
    return state.loading;
  }

  /** 面板 API.call 的参数别名对齐（面板内部用的是 vin/carUid/uid 这套名字）。 */
  function panelParams(values) {
    const params = { ...(values || {}) };
    delete params.__body;
    if (params.vin == null && params.vinNo) params.vin = params.vinNo;
    if (params.vinNo == null && params.vin) params.vinNo = params.vin;
    if (params.carUid == null && params.carUserId) params.carUid = params.carUserId;
    if (params.carUserId == null && params.carUid) params.carUserId = params.carUid;
    if (params.uid == null && params.userId) params.uid = params.userId;
    if (params.userId == null && params.uid) params.userId = params.uid;
    if (params.uid == null && state.uid) params.uid = state.uid;
    return params;
  }

  function panelHeaders(url, method, bodyText) {
    const sign = state.panelWin?.ZEEHO_SIGN;
    if (!sign?.sign) throw new Error('面板签名未就绪');
    const signed = sign.sign(url, queryParamsOf(url), bodyText || '', String(method || 'GET').toUpperCase());
    return {
      'Content-Type': 'application/json;charset=UTF-8',
      'Accept-Language': 'zh-CN',
      interfaceversion: '2',
      'cfmoto-x-param': signed.param,
      'cfmoto-x-sign': signed.sign,
      'cfmoto-x-sign-type': '0',
    };
  }

  function ownHeaders(url, method, bodyText) {
    if (!hasOwnCredentials()) throw new Error('自填模式需要 appId 与 appSecret');
    // nonce 与 timestamp 必须同一毫秒。
    const timestamp = Date.now();
    const nonce = `${String(timestamp).slice(-8)}${Math.random().toString(36).slice(2, 10)}`;
    return buildHeaders({
      url,
      method,
      body: bodyText,
      appId: state.cfg.appId,
      appSecret: state.cfg.appSecret,
      nonce,
      timestamp,
      token: state.token,
    });
  }

  function normalize({ url, method, text, status: httpStatus, elapsed, panel, panelTag }) {
    const data = parseBody(text);
    const code = String(data?.code ?? '');
    // 业务成功只认 10000；但登录/OTA 有些接口直接返回裸值（true/false/数字），也算成功。
    const ok = panel
      ? Boolean(code === '10000' || data?.ok === true)
      : (httpStatus >= 200 && httpStatus < 300) && (code === '' || code === '10000');
    return {
      ok,
      http: httpStatus,
      code,
      message: String(data?.message ?? (text && !data ? String(text).slice(0, 200) : '')),
      data: data?.data !== undefined ? data.data : data,
      raw: data,
      text,
      url,
      method,
      elapsed,
      panel,
      panelTag: panelTag || '',
    };
  }

  async function panelCall({ panelTag, query, method = 'GET', body }) {
    if (!state.panelWin) status('warn', '加载面板签名…');
    const ready = await loadPanel();
    if (!ready) throw new Error('面板签名加载失败：请确认同目录 index.html 能打开，或改用「自填凭据」');
    const api = state.panelWin?.API;
    if (!api?.call) throw new Error('面板 API 未就绪（面板版本过旧？）');
    if (api.authFailed) { try { api.clearAuthFail?.(); } catch { /* 旧面板没有 */ } }
    try { await api.setSource?.('direct'); } catch { /* 旧面板没有 */ }
    if (state.token) api.token = state.token;
    const opts = {};
    if (body !== undefined && body !== null) opts.body = body;
    if (method) opts.method = String(method).toUpperCase();
    const started = performance.now();
    let result = await api.call(panelTag, panelParams(query), opts);
    if (!result?.ok && /401|登录态已失效/.test(String(result?.message || ''))) {
      try { api.clearAuthFail?.(); } catch { /* ignore */ }
      await sleep(400);
      result = await api.call(panelTag, panelParams(query), opts);
    }
    const text = JSON.stringify(result?.raw ?? { code: result?.code ?? '', message: result?.message ?? '', data: result?.data ?? null });
    return normalize({
      url: `panel://${panelTag}`,
      method,
      text,
      status: Number(result?.http) || (result?.ok ? 200 : 0),
      elapsed: Math.round(performance.now() - started),
      panel: true,
      panelTag,
    });
  }

  /**
   * 统一入口。
   * @param {object} req
   * @param {string} req.path            业务路径（含 /v1.0/... 前缀）
   * @param {object} [req.query]         query 参数（自动去掉空值）
   * @param {string} [req.method]        GET/POST/PUT/DELETE
   * @param {object} [req.body]          JSON body
   * @param {string} [req.panelTag]      面板识别的 tag；给了且处于面板模式就走 API.call
   * @param {'token'|'basic'|'none'} [req.auth]
   * @param {boolean} [req.forceSign]    面板模式下也强制走自签名（排查用）
   */
  async function request({ path, query = {}, method = 'GET', body, panelTag = '', auth = 'token', forceSign = false }) {
    const upper = String(method || 'GET').toUpperCase();
    if (auth === 'token' && !state.token) {
      throw new Error('缺少 token：先在面板用手机号登录一次，或在本页「设置」里粘贴 token');
    }
    if (state.mode === 'panel' && panelTag && !forceSign) {
      return panelCall({ panelTag, query, method: upper, body });
    }
    const url = buildUrl(base(), path, query);
    const bodyText = body == null ? '' : JSON.stringify(body);
    const useOwn = state.mode !== 'panel' || hasOwnCredentials() || forceSign;
    let headers;
    if (useOwn) {
      headers = ownHeaders(url, upper, bodyText);
    } else {
      const ready = await loadPanel();
      if (!ready) throw new Error('面板签名加载失败：请确认同目录 index.html 能打开，或改用「自填凭据」');
      headers = panelHeaders(url, upper, bodyText);
    }
    if (auth === 'token') headers.Authorization = `Bearer ${state.token}`;
    else if (auth === 'basic') {
      const basic = state.cfg.basic || state.panelWin?.ZEEHO_SIGN?.APP_BASIC_AUTH || '';
      if (!basic) throw new Error('缺少 Basic：登录接口需要它');
      headers.Authorization = String(basic).startsWith('Basic ') ? basic : `Basic ${basic}`;
    }
    const started = performance.now();
    const response = await fetch(url, {
      method: upper,
      headers,
      body: upper === 'GET' || upper === 'HEAD' ? undefined : (bodyText || undefined),
      cache: 'no-store',
    });
    const text = await response.text();
    return normalize({
      url, method: upper, text, status: response.status,
      elapsed: Math.round(performance.now() - started), panel: false,
    });
  }

  /**
   * 只算签名头，不自己发请求 —— 给 multipart 上传这类 fetch 自己拼 body 的场景用。
   * bodyText 必须与「签名时声明的内容」一致；multipart 的真实 body 浏览器才生成，
   * 所以这里的 bodyText 传 '' 是**未验证**的近似做法（见壁纸上传的注释）。
   */
  async function signHeaders({ url, method = 'GET', bodyText = '', auth = 'token' } = {}) {
    const upper = String(method || 'GET').toUpperCase();
    const useOwn = state.mode !== 'panel' || hasOwnCredentials();
    let headers;
    if (useOwn) {
      headers = ownHeaders(url, upper, bodyText);
    } else {
      const ready = await loadPanel();
      if (!ready) throw new Error('面板签名加载失败');
      headers = panelHeaders(url, upper, bodyText);
    }
    if (auth === 'token' && state.token) headers.Authorization = `Bearer ${state.token}`;
    return headers;
  }

  return {
    state,
    STORAGE,
    loadSettings, saveSettings, setToken, setVin, setUid,
    loadPanel, request, signHeaders, hasOwnCredentials, base,
    get token() { return state.token; },
    get vin() { return state.vin; },
    get uid() { return state.uid; },
    get mode() { return state.mode; },
    get panelWin() { return state.panelWin; },
  };
}

/* ------------------------- 面板同款摘要解析（轻量） ------------------------- */

/** 面板/vehicleHomePageV2 的字段名在不同版本里漂过，这里按优先级取。 */
export function pickVehicle(home) {
  const d = home?.data ?? home ?? {};
  const vehicle = d.vehicleInfo ?? d.vehicle ?? d;
  return {
    vin: String(vehicle.vin ?? vehicle.vinNo ?? d.vin ?? d.vinNo ?? ''),
    name: String(vehicle.vehicleName ?? vehicle.name ?? d.vehicleName ?? ''),
    model: String(vehicle.vehicleType ?? vehicle.modelName ?? d.vehicleType ?? ''),
    soc: numberOrNull(vehicle.bmssoc ?? vehicle.soc ?? d.bmssoc),
    range: numberOrNull(vehicle.hmiRidableMile ?? vehicle.endurance ?? d.hmiRidableMile),
    online: toBool(vehicle.onlineStatus ?? d.onlineStatus),
    otaVersion: String(vehicle.otaVersion ?? vehicle.softwareVersion ?? d.otaVersion ?? ''),
    pic3d: String(vehicle.vehiclePic3dUrl ?? d.vehiclePic3dUrl ?? ''),
    raw: d,
  };
}

export function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toBool(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}
