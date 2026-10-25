/* ==== ZEEHO_PANEL_CAR:ENTRY:BEGIN ==== */
/* 面板页的入口与 sheet 开关。
   入口两处：
     1) 顶栏「车机」按钮（面板切 tab/重绘都会重建 topbar，所以用 MutationObserver 补回来）；
     2) 「车辆设置」页末尾追加一行「车机工具」，样式复用面板自己的 .group-card。
   打开后是一个全屏 sheet，里面就是 api-car-ui.js 渲染的那三块卡片（固件 / 设置 / 壁纸）。 */

const zeCarSheet = () => document.getElementById('ze-car-sheet');

function zeCarOpenSheet(focus) {
  const sheet = zeCarSheet();
  if (!sheet) { toast('车机工具还没准备好，刷新页面再试'); return; }
  sheet.hidden = false;
  document.body.classList.add('ze-car-lock');
  if (!readPanelToken()) toast('还没登录：先在「我的」里登录，再回来看车机工具', 3200);
  void (async () => {
    try {
      await loadVehiclesForPanel();
      await carInitPanels();
    } catch (error) {
      toast(`读取失败：${error.message}`);
    }
    if (focus) zeCarFocus(focus);
  })();
}

function zeCarCloseSheet() {
  const sheet = zeCarSheet();
  if (!sheet) return;
  sheet.hidden = true;
  document.body.classList.remove('ze-car-lock');
}

function zeCarFocus(name) {
  const target = { wallpaper: 'wallpaper-card', firmware: 'firmware-card', settings: 'settings-card' }[name] || name;
  const el = document.getElementById(target);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  for (const button of document.querySelectorAll('.ze-car-tabs button')) {
    button.setAttribute('aria-selected', String(button.dataset.zeFocus === name));
  }
}

/** 顶栏按钮：面板的 app.js 会重绘 topbar，靠 observer 补。 */
function zeCarEnsureTopButton() {
  const bar = document.getElementById('topbar');
  if (!bar || bar.querySelector('.ze-car-topbtn')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'iconbtn ze-car-topbtn';
  button.title = '车机壁纸 / OTA / 车辆设置';
  button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="12" rx="2"/><path d="M7 20h10"/><circle cx="9" cy="9.5" r="1.3"/><path d="M5 15l4-3.5 3.5 3 2.5-2 4 3"/></svg>';
  bar.appendChild(button);
}

/** 「车辆设置」页末尾追加的入口行。只在设置页出现（通过标题文案判断，避免绑到面板内部逻辑）。 */
function zeCarEnsureSettingsEntry() {
  const scroll = document.getElementById('scroll');
  const page = scroll?.querySelector('.page');
  if (!page || page.querySelector('.ze-car-entry')) return;
  if (!page.textContent.includes('设置项')) return;
  const block = document.createElement('div');
  block.className = 'ze-car-entry';
  block.innerHTML = `
    <div class="section-title ze-car-entry-title"><span>车机工具</span><span class="line"></span></div>
    <section class="card group-card">
      <button class="group-head ze-car-open" type="button" data-ze-focus="wallpaper">
        <span class="gt">车机壁纸</span><span class="gc">列表 · 应用 · 改名 · 上传</span>
        <span class="gv"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></span>
      </button>
    </section>
    <section class="card group-card">
      <button class="group-head ze-car-open" type="button" data-ze-focus="firmware">
        <span class="gt">OTA 升级</span><span class="gc">版本 · 检查更新 · 固件包</span>
        <span class="gv"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></span>
      </button>
    </section>
    <section class="card group-card">
      <button class="group-head ze-car-open" type="button" data-ze-focus="settings">
        <span class="gt">完整车辆设置</span><span class="gc">官方 3.0.6 的全部磁贴</span>
        <span class="gv"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></span>
      </button>
    </section>`;
  page.appendChild(block);
}

function zeCarSyncEntries() {
  zeCarEnsureTopButton();
  zeCarEnsureSettingsEntry();
}

document.addEventListener('click', (event) => {
  const close = event.target.closest?.('#ze-car-close');
  if (close) { zeCarCloseSheet(); return; }
  const tab = event.target.closest?.('.ze-car-tabs button');
  if (tab) { zeCarFocus(tab.dataset.zeFocus); return; }
  const open = event.target.closest?.('.ze-car-open, .ze-car-topbtn');
  if (open) {
    event.preventDefault();
    zeCarOpenSheet(open.dataset.zeFocus || 'wallpaper');
  }
}, true);

// 面板切 tab / 重绘会重建 #scroll 与 #topbar，这里补回入口（幂等）。
let zeCarSyncTimer = null;
const zeCarObserver = new MutationObserver(() => {
  clearTimeout(zeCarSyncTimer);
  zeCarSyncTimer = setTimeout(zeCarSyncEntries, 60);
});
for (const target of [document.body]) {
  zeCarObserver.observe(target, { childList: true, subtree: true });
}
zeCarSyncEntries();
setTimeout(zeCarSyncEntries, 800);
setTimeout(zeCarSyncEntries, 2500);
/* ==== ZEEHO_PANEL_CAR:ENTRY:END ==== */
