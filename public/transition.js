/* 穿云转场 v2：镜头从云层上方下沉、穿过云海、落到新场景，
 * 两端各带一段以点击位置为焦点的缩放，让画面有扑向入口、
 * 再落进新场景的连贯感，不再是雾一起一散的生硬切换。
 *
 * 用法（在 app.js 里）：
 *   import { cloudDescend } from "./transition.js";
 *   onActivate: () => cloudDescend(() => showChapterMap("ch1"), {
 *     exit:  { el: () => sceneEl, origin: "80.6% 56.8%", to: 1.45 },
 *     fade:  () => [...document.querySelectorAll(".scene-gate, .room-topbar")],
 *     enter: { el: () => nextSceneEl, from: 0.94 },
 *   }),
 *
 * 做法：全屏画布 + 一层暖纸白底色，雾纹理是程序当场生成的（多层
 * 值噪声拼成的云海），不依赖任何素材图。前半段雾浓度升到 1、纹理
 * 一边下流一边放大（下沉感），同时旧视图以 origin 为焦点放大
 * （exit，画面扑向被点的入口），被点的按钮等界面元素先淡出；
 * 浓度到顶那一刻调用 swap() 换视图；后半段新视图从 enter.from
 * 的缩放长回 1（enter，像落进新场景时画面由远及近），雾随之散去。
 * 缩放都走元素独立的 scale 属性，和地图、房间自己用 transform 做的
 * 相机平移互不冲突。enter 的缩放幅度必须留在目标画面自身的溢出
 * 范围内（地图场景有 22% 溢出；房间舞台没有高度溢出，调用方用
 * enter.hold 让雾在缩放走完前保持浓度，把边缘盖住）。
 * 总时长默认 1.3 秒。进行中再次调用会直接返回同一份进行中的
 * Promise，不会叠加两次转场。换视图那一步抛错时，先撤掉覆盖层、
 * 恢复被改过的元素，再把错抛出去，画面不会被雾盖住动不了。
 * 用户开了减弱动效（prefers-reduced-motion）时直接换视图，不播动画。
 */

const DEFAULT_DURATION_MS = 1300;
// 游戏纸色是 #fbf0dc / #fcf1dd，雾跟着走暖纸白，不用纯白。
const VEIL_COLOR = "#f7efdd";
const TILE = 256;

let inFlight = null;
let tiles = null;

function smoothstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function resolveEl(target) {
  if (!target) return null;
  try {
    return typeof target === "function" ? target() : target;
  } catch (_) {
    return null;
  }
}

/* 一张值噪声 tile：三层不同密度的随机网格做双线性插值再叠加，
 * 出来的团块和絮状就是云海的样子。只在第一次转场时生成两张，
 * 之后每次复用，生成成本不进转场时间。 */
function makeTile(seedOffset) {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(TILE, TILE);
  const data = image.data;
  let seed = 1234567 + seedOffset * 7919;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const grids = [4, 8, 16].map((cells) => {
    const grid = [];
    for (let i = 0; i <= cells; i++) {
      grid.push(Array.from({ length: cells + 1 }, () => rand()));
    }
    return { cells, grid };
  });
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let value = 0;
      let weightSum = 0;
      for (const { cells, grid } of grids) {
        const weight = 1 / cells;
        const gx = (x / TILE) * cells;
        const gy = (y / TILE) * cells;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = gx - x0;
        const fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const top = grid[y0][x0] * (1 - sx) + grid[y0][x0 + 1] * sx;
        const bottom = grid[y0 + 1][x0] * (1 - sx) + grid[y0 + 1][x0 + 1] * sx;
        value += (top * (1 - sy) + bottom * sy) * weight;
        weightSum += weight;
      }
      const v = value / weightSum;
      const i = (y * TILE + x) * 4;
      // 亮部偏纸白、暗部偏暖灰，雾纹理本身带明暗，不是一片平白。
      const light = v > 0.55 ? 1 : 0;
      data[i] = 247;
      data[i + 1] = 239;
      data[i + 2] = 221;
      data[i + 3] = Math.round((light ? 235 : 150 + v * 120));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function getTiles() {
  if (!tiles) tiles = [makeTile(0), makeTile(1)];
  return tiles;
}

export function cloudDescend(swap, options = {}) {
  if (inFlight) return inFlight;
  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || durationMs <= 0) {
    return Promise.resolve().then(swap);
  }

  inFlight = (async () => {
    // 覆盖层挂在 document.body 下，不挂在 #app 里：app.js 的 page()
    // 会把 #app 的子节点整个换掉，挂在里面会在中点换视图时被清掉。
    const overlay = document.createElement("div");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText =
      "position:fixed;top:var(--ui-header-height,58px);right:0;bottom:0;left:0;" +
      "z-index:5500;pointer-events:none;overflow:hidden;";
    const veil = document.createElement("div");
    veil.style.cssText =
      `position:absolute;inset:0;background:${VEIL_COLOR};opacity:0;`;
    const canvas = document.createElement("canvas");
    // 一半分辨率渲染再拉满屏幕，云雾不需要高清，性能留够。
    const scale = 0.5;
    canvas.width = Math.max(2, Math.ceil(window.innerWidth * scale));
    const headerHeight = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue("--ui-header-height")) || 58;
    canvas.height = Math.max(2, Math.ceil((window.innerHeight - headerHeight) * scale));
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
    overlay.append(veil, canvas);
    document.body.append(overlay);
    const ctx = canvas.getContext("2d");
    const [tileA, tileB] = getTiles();

    // 被缩放、被淡出的元素都要在结束（或出错）时恢复原状：
    // 换视图成功时旧元素会被 page() 丢弃，恢复是无害的多余动作；
    // 换视图失败时旧画面还要继续用，恢复就是必须的。
    const touched = [];
    const touch = (el) => {
      if (!el || touched.some((t) => t.el === el)) return null;
      const record = {
        el,
        scale: el.style.scale,
        origin: el.style.transformOrigin,
        opacity: el.style.opacity,
        transition: el.style.transition,
      };
      touched.push(record);
      return record;
    };
    const restoreAll = () => {
      for (const t of touched) {
        t.el.style.scale = t.scale;
        t.el.style.transformOrigin = t.origin;
        t.el.style.opacity = t.opacity;
        t.el.style.transition = t.transition;
      }
      touched.length = 0;
    };

    const exitEl = resolveEl(options.exit?.el);
    const exitTo = options.exit?.to ?? 1.45;
    if (exitEl && options.exit) {
      touch(exitEl);
      exitEl.style.transformOrigin = options.exit.origin || "50% 50%";
    }
    const fadeEls = options.fade ? resolveEl(options.fade) || [] : [];
    for (const el of fadeEls) {
      if (touch(el)) {
        el.style.transition = "opacity .25s ease";
        el.style.opacity = "0";
      }
    }
    let enterEl = null;

    const drawFog = (progress, density) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      // 纹理越放越大、越流越快：穿云时云是朝镜头扑过来、向四周散开的。
      const zoom = 1 + progress * 0.55;
      const drift = progress * TILE * 1.2;
      // No early fog: opacity is exactly zero until the zoom delay ends.
      if (density <= 0) return;
      ctx.globalAlpha = density;
      for (const [tile, offsetX, offsetY] of [
        [tileA, 0, drift],
        [tileB, TILE / 2, -drift * 0.6],
      ]) {
        const size = TILE * zoom;
        const startX = offsetX - size;
        const startY = ((offsetY % size) + size) % size - size;
        for (let y = startY; y < h + size; y += size) {
          for (let x = startX; x < w + size; x += size) {
            ctx.drawImage(tile, x, y, size, size);
          }
        }
      }
      ctx.globalAlpha = 1;
    };

    const start = performance.now();
    const nextFrame = () =>
      new Promise((resolve) => requestAnimationFrame(resolve));
    let swapped = false;
    try {
      for (;;) {
        const now = await nextFrame();
        const progress = Math.min(1, (now - start) / durationMs);
        const firstHalf = progress < 0.5;
        const half = firstHalf ? progress / 0.5 : (progress - 0.5) / 0.5;
        let density;
        if (firstHalf) {
          // 云雾在镜头放大约一半后才出现（fogDelay，默认 0.48）：点击后先看见
          // 画面朝入口扑过去，雾再跟上来盖住，沉降感是连着的。
          const fogDelay = options.fogDelay ?? 0.48;
          const fogT = Math.min(1, Math.max(0, (half - fogDelay) / (1 - fogDelay)));
          density = smoothstep(fogT);
          if (exitEl) {
            exitEl.style.scale = String(1 + (exitTo - 1) * smoothstep(half));
          }
        } else {
          // enter.hold：新画面先长大、雾稍晚再散，缩放走完前边缘有雾盖着。
          const hold = options.enter?.hold ?? 0;
          const fadeT = Math.min(1, Math.max(0, (half - hold) / (1 - hold || 1)));
          density = 1 - smoothstep(fadeT);
          if (enterEl && options.enter) {
            const from = options.enter.from ?? 0.94;
            enterEl.style.scale = String(from + (1 - from) * smoothstep(half));
          }
        }
        veil.style.opacity = String(density);
        drawFog(progress, density);
        if (progress >= 0.5 && !swapped) {
          swapped = true;
          // 帧步进未必正好落在 0.5 上，先把底色锁死到完全不透明，
          // 再换视图，玩家看不见切换动作。
          veil.style.opacity = "1";
          // swap() 是同步还是异步都行：await 住它，换完再继续后半段。
          // 换视图失败（比如章节未开发）时，finally 会先撤覆盖层再报错。
          await swap();
          if (options.enter) {
            enterEl = resolveEl(options.enter.el);
            if (enterEl) {
              touch(enterEl);
              enterEl.style.transformOrigin = options.enter.origin || "50% 50%";
              enterEl.style.scale = String(options.enter.from ?? 0.94);
            }
          }
        }
        if (progress >= 1) break;
      }
    } finally {
      restoreAll();
      overlay.remove();
      inFlight = null;
    }
  })();
  return inFlight;
}
