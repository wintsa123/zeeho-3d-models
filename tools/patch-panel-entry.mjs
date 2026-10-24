#!/usr/bin/env node
/**
 * 给面板 index.html 注入「车机壁纸 / OTA / 车辆设置」入口。
 *
 * 为什么需要这个脚本：index.html 是 dashboard/ 私有工作区的**构建产物**（混淆 + 自包含），
 * 上游每次 release 都会整份覆盖。直接手改会在下一次同步里丢掉，所以入口以「可重放的注入块」形式维护：
 *   同步上游后跑一次 `node tools/patch-panel-entry.mjs` 即可复原。
 *
 * 注入的内容（幂等，靠 ZEEHO_PANEL_ENTRY 标记判断）：
 *   1. 一段 <style>：.ze-panel-entry，锚在 .phone 里、悬浮在底部 tabbar 上方；
 *   2. 一段 <script>：把 <a> 塞进 .phone（面板的 app.js 只重绘 topbar/scroll/tabbar，
 *      .phone 本身稳定，所以不跟框架抢 DOM），拿不到 .phone 就退化成 fixed 悬浮。
 *
 * 用法：
 *   node tools/patch-panel-entry.mjs            # 就地注入 index.html
 *   node tools/patch-panel-entry.mjs --check    # 只检查，不写
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const MARK = 'ZEEHO_PANEL_ENTRY';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'index.html');

const BLOCK = `
<!-- ==== ${MARK}：车机壁纸 / OTA / 车辆设置 入口（本 fork 追加；上游重构建后重跑 tools/patch-panel-entry.mjs） ==== -->
<style id="ze-panel-entry-style">
  .ze-panel-entry {
    position: absolute; right: 12px;
    bottom: calc(var(--tabbar-inset, 0px) + var(--sab, 0px) + 66px);
    z-index: 8; display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 12px; border-radius: 999px; text-decoration: none;
    font-size: 12px; line-height: 1; letter-spacing: .01em;
    color: var(--md-sys-color-on-surface, #e9e4f0);
    background: color-mix(in srgb, var(--md-sys-color-primary, #b9a3f0) 20%, var(--bg-surface, #1d1b22));
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    box-shadow: 0 6px 18px #0003;
    -webkit-tap-highlight-color: transparent;
  }
  .ze-panel-entry:active { transform: scale(.97); }
  .ze-panel-entry b { font-weight: 600; }
  @media (max-width: 420px) { .ze-panel-entry { font-size: 11.5px; padding: 6px 10px; } }
  .ze-panel-entry.ze-floating { position: fixed; right: 14px; bottom: calc(88px + env(safe-area-inset-bottom)); }
</style>
<script id="ze-panel-entry-script">
(() => {
  const HREF = './car.html';
  const make = () => {
    const link = document.createElement('a');
    link.className = 'ze-panel-entry';
    link.href = HREF;
    link.innerHTML = '<span aria-hidden="true">🛠</span><b>壁纸 / OTA / 设置</b>';
    link.title = '车机壁纸、OTA 升级、车辆设置（App 3.0.6）';
    return link;
  };
  const mount = () => {
    if (document.querySelector('.ze-panel-entry')) return true;
    const host = document.querySelector('.phone') || document.body;
    const link = make();
    if (host === document.body) link.classList.add('ze-floating');
    host.appendChild(link);
    return true;
  };
  if (!mount()) {
    // 面板的 app.js 是异步渲染 .phone 的，这里等到它出现；10 秒还没有就退化到 fixed。
    const started = Date.now();
    const timer = setInterval(() => {
      if (mount() || Date.now() - started > 10000) {
        clearInterval(timer);
        mount();
      }
    }, 200);
  }
  // 面板切页会重绘 .scroll 里的一切，但 .phone 不重建；万一被清掉，observer 兜一次。
  const observer = new MutationObserver(() => { if (!document.querySelector('.ze-panel-entry')) mount(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
</script>
<!-- ==== /${MARK} ==== -->
`;

async function main() {
  const checkOnly = process.argv.includes('--check');
  const html = await readFile(target, 'utf8');
  if (html.includes(MARK)) {
    console.log('index.html 已含入口块，无需注入。');
    return;
  }
  if (!html.includes('</body>')) {
    console.error('index.html 里找不到 </body>，结构变了，先人工看一下。');
    process.exitCode = 1;
    return;
  }
  if (checkOnly) {
    console.log('index.html 缺少入口块（--check 不写文件）。');
    process.exitCode = 2;
    return;
  }
  const next = html.replace('</body>', `${BLOCK}</body>`);
  await writeFile(target, next, 'utf8');
  console.log(`已注入入口块：${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
