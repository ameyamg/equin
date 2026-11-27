import { createInViewWatcher } from "@plugins/primitives/plugins/dom/plugins/in-view/web";
import { clamp01, lerp, smooth, type Vec3 } from "./math";
import { createRenderer, type RGB } from "./renderer";
import {
  buildWorld,
  CHX,
  CHY,
  CX,
  CY,
  HX,
  HY,
  PICK,
  REM_Z,
  SLIDE,
  type Block,
  type Tower,
} from "./world";

/**
 * The picture: the world drawn at a place p on the page's timeline. Where
 * every brick is, is a pure function of p; the only things that play on their
 * own are the light (bricks breathing, a band climbing the towers), the
 * pointer's highlight and a click's ring. p eases after the scroll's target, so
 * the picture follows the wheel instead of stepping with it.
 *
 * The framing is worked out in screen pixels: a world point (camX, camY, camZ)
 * sits at (ox, oy) on the stage and one stud is U pixels. PX / PY place the
 * labels and test the pointer; the 3D camera is set to the same view.
 *
 * One rAF loop, only while the stage is on screen and the tab visible.
 */
export interface ScenePalette {
  /** The bricks. */
  block: RGB;
  /** The removed feature and the swapped-in piece. */
  swap: RGB;
  /** What a build selects. */
  pick: RGB;
  /** The ground the picture is drawn on. */
  background: RGB;
}

export interface SceneOptions {
  /** The stage: an empty box the scene fills (a canvas, and the labels over it). */
  stage: HTMLElement;
  /** The pane's scroll container: pointer and click are read from it. */
  scroller: HTMLElement;
  palette: ScenePalette;
  /** How far below the scroller's top the header and the chapter strip reach: the pointer is not read there. */
  coveredTop(): number;
  /** Where the text column ends on the stage (0 when the text sits under the picture). */
  sceneLeft(): number;
}

export interface Scene {
  /** The scroll moved: where the picture should go. */
  setTarget(p: number): void;
  /** Be at p now, without easing (the first measure). */
  jump(p: number): void;
  /** The stage changed size. */
  resize(): void;
  /** The labels' text changed size (web fonts arrived). */
  remeasure(): void;
  dispose(): void;
}

interface Label {
  el: HTMLDivElement;
  name: HTMLElement;
  gloss: HTMLElement | null;
  last: number;
  w: number;
  h: number;
}

interface Pin {
  /** The range of p it shows in. */
  a: number;
  b: number;
  at: Vec3 | (() => Vec3);
  t: string;
  /** Text to the right (1) or the left (-1) of its dot. */
  dir: 1 | -1;
  strong?: boolean;
  picked?: boolean;
  alpha?: () => number;
}

interface Ring {
  x: number;
  y: number;
  z: number;
  t0: number;
  set: (b: Block) => boolean;
}

const C30 = Math.cos(Math.PI / 6);
const S30 = 0.5;
/** The inset between neighbouring bricks. */
const GAP = 0.11;
/** This world's bricks are about 1.6× the size the far-dimming curve was tuned for. */
const FAR_UNIT = 1.6;
/** Foundation layers 0…4, tower, tower accent, swapped-in. */
const SHADE = [0.62, 0.7, 0.78, 0.86, 0.95, 1.08, 1.18, 1.3] as const;
const shadeOf = (c: number) => SHADE[c] ?? 1;

export function mountScene(opts: SceneOptions): Scene {
  const { stage, scroller, palette } = opts;
  const world = buildWorld();
  const { blocks, towers, systems, builds, studs } = world;
  const AM = world.agent;
  const CH = world.first;
  const [blockR, blockG, blockB] = palette.block;
  const [swapR, swapG, swapB] = palette.swap;
  const [pickR, pickG, pickB] = palette.pick;

  const canvas = document.createElement("canvas");
  const labelHost = document.createElement("div");
  labelHost.className = "psys-labels";
  stage.append(canvas, labelHost);
  const gl = createRenderer(
    canvas,
    palette.background,
    blocks.length,
    studs.length,
  );

  // ---------- the state p drives ----------
  let burst = 1;
  let remOut = 0;
  let remGone = 0;
  let settle = 0;
  let swapOut = 0;
  let swapGone = 0;
  let swapIn = 0;
  /** How far each build's light has spread, 0…1. */
  const BW = builds.map(() => 0);
  const litOf = (n: number) => {
    let v = 0;
    for (let k = 0; k < builds.length; k++) {
      const B = builds[k]!;
      const w = BW[k]!;
      if (w > 0 && B.sel[n]) v = Math.max(v, smooth((w - B.delay[n]!) / 0.68));
    }
    return v;
  };

  // ---------- camera ----------
  let W = 1;
  let H = 1;
  let U = 30;
  let camX = 0;
  let camY = 0;
  let camZ = 0;
  let ox = 0;
  let oy = 0;
  let sceneLeft = 0;
  interface Key {
    c: Vec3;
    u: number;
  }
  function keys(): Key[] {
    // the width left for the picture, beside the text
    const Wa = W - sceneLeft;
    const k0 = Math.max(54, Math.min(140, Math.min(Wa, H) / 8));
    const k3 = Math.min(H / 31, Wa / 30);
    const k6 = Math.min(H / 100, Wa / 96);
    const plugin: Vec3 = [HX + 1.6, HY + 1, 1];
    const app: Key = { c: [CHX + 3.5, CHY + 2, 9], u: k3 * 0.97 };
    const city: Key = { c: [CX + 1, CY + 1, 19], u: k6 };
    return [
      // chapters that share a subject share one framing exactly, so the ground does not slide while you read
      { c: plugin, u: k0 },
      { c: plugin, u: k0 * 0.66 },
      { c: [CHX + 2.5, CHY + 3, 2], u: Math.min(Wa / 40, H / 28, k0 * 0.5) },
      app,
      app,
      app,
      city,
      city,
      city,
      city,
      city,
    ];
  }
  function camera(p: number) {
    const K = keys();
    const i = Math.min(K.length - 2, Math.max(0, Math.floor(p)));
    const t = smooth(p - i);
    const a = K[i]!;
    const b = K[i + 1]!;
    camX = lerp(a.c[0], b.c[0], t);
    camY = lerp(a.c[1], b.c[1], t);
    camZ = lerp(a.c[2], b.c[2], t);
    U = Math.exp(lerp(Math.log(a.u), Math.log(b.u), t));
    ox = sceneLeft + (W - sceneLeft) / 2;
    oy = H * (W > 760 ? 0.54 : 0.4);
  }
  const PX = (x: number, y: number) => ox + (x - camX - (y - camY)) * C30 * U;
  const PY = (x: number, y: number, z: number) =>
    oy + (x - camX + (y - camY)) * S30 * U - (z - camZ) * U;

  // ---------- labels: HTML over the canvas, each pinned to a world point and shown over a range of p ----------
  function mkLabel(text: string, cls: string, gloss = false): Label {
    const el = document.createElement("div");
    el.className = `psys-lbl ${cls}`.trim();
    const dot = document.createElement("i");
    const span = document.createElement("span");
    const name = document.createElement("b");
    name.textContent = text;
    span.append(name);
    let em: HTMLElement | null = null;
    if (gloss) {
      em = document.createElement("em");
      span.append(em);
    }
    el.append(dot, span);
    labelHost.append(el);
    return { el, name, gloss: em, last: -1, w: 0, h: 0 };
  }
  function place(l: Label, op: number, x: number, y: number) {
    if (op < 0.01) {
      if (l.last !== 0) {
        l.el.style.opacity = "0";
        l.last = 0;
      }
      return;
    }
    if (!l.w) {
      l.w = l.el.offsetWidth;
      l.h = l.el.offsetHeight;
    }
    l.el.style.opacity = op.toFixed(3);
    l.last = op;
    const dx = l.el.classList.contains("is-left") ? -l.w + 3 : -3;
    l.el.style.transform = `translate(${x + dx}px, ${y - l.h / 2}px)`;
  }
  const half = (k: number) => (): Vec3 => [
    HX + 4,
    HY + 1,
    k * 0.5 + 0.25 + k * burst * 0.7,
  ];
  const PINS: Pin[] = [
    { a: -1, b: 0.36, at: half(1), t: "Browser code", dir: 1 },
    { a: -1, b: 0.36, at: half(0), t: "Server code", dir: 1 },
    { a: 0.14, b: 0.6, at: [HX + 3.5, HY + 1.5, 1.18], t: "Open slot", dir: 1 },
    {
      a: 0.8,
      b: 1.2,
      at: [HX + 4, HY + 1, 1.5],
      t: "Another plugin, plugged in",
      dir: 1,
    },
    {
      a: 2.8,
      b: 5.25,
      at: () => [CH.tip[0], CH.tip[1], CH.tip[2] - settle],
      t: "Mail",
      dir: 1,
      strong: true,
    },
    { a: 2.8, b: 3.3, at: [CHX + 3.5, CHY + 2, 4 + 2.5], t: "Inbox", dir: 1 },
    { a: 2.8, b: 3.3, at: [CHX + 2, CHY + 4, 4 + 9.5], t: "Composer", dir: -1 },
    {
      a: 2.8,
      b: 3.45,
      at: [CHX + 3.5, CHY + 2, REM_Z + 0.5],
      t: "Snooze",
      dir: 1,
    },
    {
      a: 3.5,
      b: 4.3,
      at: () => [CHX + 3.5 + remOut * 5, CHY + 2, REM_Z + 0.5],
      t: "Snooze, removed",
      dir: 1,
      alpha: () => 1 - remGone,
      picked: true,
    },
    {
      a: 4.04,
      b: 4.66,
      at: () => [CHX + 8 + swapOut * SLIDE, CHY + 1, 1.5],
      t: "Database",
      dir: 1,
      alpha: () => 1 - swapGone,
    },
    {
      a: 4.7,
      b: 5.25,
      at: [CHX + 8, CHY + 1, 1.5],
      t: "Another database system",
      dir: 1,
      picked: true,
    },
  ];
  // chapter 2: the sub-systems around the first app, named
  for (const id of [1, 2, 3, 5, 6]) {
    const S = systems[id]!;
    let best: Block | null = null;
    let bd = 1e9;
    for (const b of blocks) {
      if (b.role !== "found" || b.sys !== S.id || !b.studs || b.t0 > 3)
        continue;
      const d = Math.hypot(b.x + b.w / 2 - S.x, b.y + b.d / 2 - S.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best)
      PINS.push({
        a: 1.7,
        b: 2.3,
        at: [best.x + best.w / 2, best.y + best.d / 2, best.z + 1],
        t: S.name,
        dir: best.x - best.y > CHX - CHY ? 1 : -1,
      });
  }
  const pins = PINS.map((pin) => ({
    pin,
    l: mkLabel(
      pin.t,
      [
        pin.dir < 0 ? "is-left" : "",
        pin.strong ? "is-big" : "",
        pin.picked ? "is-pick" : "",
      ]
        .filter(Boolean)
        .join(" "),
    ),
  }));
  const names = towers
    .filter((t) => t.name)
    .map((t) => ({
      t,
      l: mkLabel(
        t.name,
        [
          t === AM ? "is-big" : "",
          t !== AM && t !== CH && t.cx - t.cy < CX - CY ? "is-left" : "",
        ]
          .filter(Boolean)
          .join(" "),
      ),
    }));

  // ---------- under the pointer ----------
  // What lights up depends on how far out you are: one plugin up close, a whole sub-system around the
  // first app, a whole app once the city stands.
  const hoverLabel = mkLabel("", "is-hover", true);
  let mouse: readonly [number, number] | null = null;
  let hovKey = "";
  let hovK = 0;
  let hovTest: (b: Block) => boolean = () => false;
  let hovName = "";
  let hovGloss = "";
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const onMove = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    const top = Math.max(
      r.top,
      scroller.getBoundingClientRect().top + opts.coveredTop(),
    );
    mouse =
      e.pointerType === "touch" ||
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < top ||
      e.clientY > r.bottom
        ? null
        : [e.clientX - r.left, e.clientY - r.top];
  };
  const onLeave = () => {
    mouse = null;
  };
  let ring: Ring | null = null;
  const onClick = (e: MouseEvent) => {
    if (calm) return;
    if (e.target instanceof Element && e.target.closest("a, button")) return;
    const r = stage.getBoundingClientRect();
    const n = pickBlock(e.clientX - r.left, e.clientY - r.top);
    if (n < 0) return;
    const b = blocks[n]!;
    ring = {
      x: b.dx + b.w / 2,
      y: b.y + b.d / 2,
      z: b.dz + b.h / 2,
      t0: performance.now(),
      set: hovKey ? hovTest : (o) => o === b,
    };
  };
  scroller.addEventListener("pointermove", onMove, { passive: true });
  scroller.addEventListener("pointerleave", onLeave);
  scroller.addEventListener("click", onClick);

  const QC = [0, 0, 0, 0, 0, 0, 0, 0];
  // the nearest brick whose silhouette holds the point: the last one in draw order
  function pickBlock(mx: number, my: number): number {
    let hit = -1;
    for (let n = 0; n < blocks.length; n++) {
      const b = blocks[n]!;
      if (!b.on || b.da < 0.5) continue;
      const top = b.dz + b.h;
      if (b.q)
        for (let i = 0; i < 4; i++) {
          const qx = b.q[2 * i]!;
          const qy = b.q[2 * i + 1]!;
          QC[2 * i] = PX(qx, qy);
          QC[2 * i + 1] = PY(qx, qy, top);
        }
      else {
        const x0 = b.dx;
        const x1 = b.dx + b.w;
        const y0 = b.y;
        const y1 = b.y + b.d;
        QC[0] = PX(x0, y0);
        QC[1] = PY(x0, y0, top);
        QC[2] = PX(x1, y0);
        QC[3] = PY(x1, y0, top);
        QC[4] = PX(x1, y1);
        QC[5] = PY(x1, y1, top);
        QC[6] = PX(x0, y1);
        QC[7] = PY(x0, y1, top);
      }
      let ya = 1e9;
      let yb = -1e9;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) & 3;
        const xa = QC[2 * i]!;
        const xb = QC[2 * j]!;
        if (xa <= mx === xb <= mx) continue;
        const y =
          QC[2 * i + 1]! +
          ((QC[2 * j + 1]! - QC[2 * i + 1]!) * (mx - xa)) / (xb - xa);
        if (y < ya) ya = y;
        if (y > yb) yb = y;
      }
      if (my >= ya && my <= yb + b.h * U) hit = n;
    }
    return hit;
  }
  function hover(p: number) {
    let key = "";
    const n = mouse ? pickBlock(mouse[0], mouse[1]) : -1;
    if (n >= 0) {
      const b = blocks[n]!;
      const T: Tower | null = b.group >= 0 ? (towers[b.group] ?? null) : null;
      if (b.role === "removed" && p > 3.5) {
        // once it is out of the tower the removed feature is its own thing; its pin already names it
        key = "r";
        hovTest = (o) => o.role === "removed";
        hovName = "";
        hovGloss = "";
      } else if (T && p >= 1.5) {
        const cut = p > 3.5;
        key = `t${T.id}${cut ? "x" : ""}`;
        hovTest = (o) => o.group === T.id && !(cut && o.role === "removed");
        // once the city stands, a named app's own label already says it
        const named = T.name !== "" && p >= 5.85;
        hovName = named ? "" : T.name || "An app";
        hovGloss = named ? "" : T.name ? "one app" : "any app you add";
      } else if (T) key = "";
      else if (p < 1.5) {
        key = `b${n}`;
        hovTest = (o) => o === b;
        hovName = b.plugin;
        hovGloss = "one plugin";
      } else if (p < 5.5) {
        const S = systems[b.sys]!;
        key = `s${S.id}`;
        hovTest = (o) => o.group < 0 && o.sys === S.id;
        hovName = S.name;
        hovGloss = S.sub;
      } else {
        key = "f";
        hovTest = (o) => o.group < 0;
        hovName = "The shared foundation";
        hovGloss = "used by every app";
      }
    }
    if (key !== hovKey) {
      // moving from one thing to the next: no blink through dark
      if (key && hovKey) hovK = 0.35;
      hovKey = key;
      if (key) {
        hoverLabel.name.textContent = hovName;
        if (hoverLabel.gloss) hoverLabel.gloss.textContent = hovGloss;
        hoverLabel.w = 0;
        for (const b of blocks) b.hov = hovTest(b);
      }
    }
    hovK += ((hovKey ? 1 : 0) - hovK) * 0.22;
    if (hovK < 0.004) hovK = 0;
    stage.style.cursor = hovKey ? "pointer" : "";
  }

  // ---------- per frame: every instance's place, size and colour from p (and a slow time pulse) ----------
  function update(p: number, time: number) {
    camera(p);
    gl.setView({ w: W, h: H, camX, camY, camZ, ox, oy, u: U });
    const s = U * Math.sqrt(1.5);

    const scan = ((time * 3.2) % 56) - 2;
    // after its chapter the swapped-in piece is one of the foundation again
    const back = smooth((p - 5.12) / 0.4);
    // the first plugin's two halves, apart then together
    burst = 1 - smooth(p / 0.3);
    // the removed feature: out beside the tower, fading, while the floors above already settle
    remOut = smooth((p - 3.5) / 0.4);
    remGone = smooth((p - 3.9) / 0.2);
    settle = smooth((p - 3.68) / 0.3);
    // the swap: the old piece slides out sideways as one and fades; the new one is already coming down into its place
    swapOut = smooth((p - 4.3) / 0.28);
    swapGone = smooth((p - 4.54) / 0.12);
    swapIn = smooth((p - 4.42) / 0.3);
    // the builds: each lights up outwards from its towers, holds a moment and fades as the next one starts;
    // the rest steps back from the edge of the city inwards, brick by brick
    const m = smooth((p - 6.1) / 0.75);
    const D0 = builds[0]!.delay;
    for (let k = 0; k < builds.length; k++)
      BW[k] = Math.min(
        clamp01((p - 6.4 - k) / 0.5),
        k === builds.length - 1 ? 1 : clamp01((7.6 + k * 0.95 - p) / 0.35),
      );
    const studA = clamp01((U - 7) / 4) * (1 - smooth((p - 2.4) / 0.45));
    const heroStud = 1 - smooth((p - 1.25) / 0.35);

    hover(p);
    let rT = -1;
    let rR = 0;
    let rW = 1;
    let rHop = 0;
    let rPop = 0;
    let rFar = 0;
    let rFlash = 0;
    if (ring) {
      rT = (performance.now() - ring.t0) / 1000;
      if (rT > 2.2) ring = null;
      else {
        // far out a ring runs through the whole city; close up only what was clicked answers, with a small hop and a flash
        rFar = clamp01((22 - U) / 10);
        rR = (rT * 620) / U;
        rW = 46 / U;
        rHop = Math.min(0.8, 11 / U) * rFar;
        rPop = (Math.exp(-rT * 5) * Math.sin(rT * 16) * 9) / U;
        rFlash = 0.7 * Math.exp(-rT * 4);
      }
    }
    const live = ring;
    const P3 = gl.bricks.pos;
    const S3 = gl.bricks.size;
    const C4 = gl.bricks.col;
    const R3 = gl.bricks.rot;
    // where each brick is right now
    for (let n = 0; n < blocks.length; n++) {
      const b = blocks[n]!;
      const i3 = n * 3;
      const i4 = n * 4;
      let x = b.x;
      let z = b.z;
      let alpha = 1;
      let on = true;
      if (b.role === "swapNew") {
        if (swapIn <= 0) on = false;
        z += (1 - swapIn) * 6;
        alpha = Math.min(1, swapIn * 2.5);
      } else {
        const t = (p - b.t0) / b.dur;
        if (t <= 0) on = false;
        if (t < 1) {
          const e = 1 - Math.pow(1 - t, 3);
          z += (1 - e) * b.drop;
          alpha = Math.min(1, t * 1.6);
        }
        if (b.role === "hero") z += b.k * burst * 0.7;
        else if (b.role === "removed") {
          if (remGone >= 1) on = false;
          x += remOut * 5;
          alpha *= 1 - remGone;
        } else if (b.role === "swapOld") {
          if (swapGone >= 1) on = false;
          x += swapOut * SLIDE;
          alpha *= 1 - swapGone;
        } else if (b.group === CH.id && b.z > REM_Z) z -= settle;
      }
      let sh =
        b.c === PICK ? shadeOf(Math.min(4, Math.floor(b.z))) : shadeOf(b.c);
      // the first bricks are read alone: brighter
      if (b.role === "hero" || b.role === "early")
        sh = lerp(
          b.role === "hero" && b.k === 0 ? 0.8 : 1.08,
          sh,
          1 - heroStud,
        );
      else if (b.role === "swapOld") sh *= 1 + 0.5 * swapOut;
      // at rest: every brick breathes a little on its own beat, and a band of light climbs the towers
      const mid = z + b.h / 2 - scan;
      sh *=
        0.88 +
        0.12 * Math.sin(time * 0.9 + n * 1.7) +
        0.55 * Math.exp((-mid * mid) / 0.18) * (1 - m);
      // pointer and click light: applied after the colour, so the orange pieces follow it too
      let lit = 1;
      if (live) {
        const dx = b.x + b.w / 2 - live.x;
        const dy = b.y + b.d / 2 - live.y;
        const dz = (b.z + b.h / 2 - live.z) * 0.7;
        const e = (Math.sqrt(dx * dx + dy * dy + dz * dz) - rR) / rW;
        const k = Math.exp(-e * e) * Math.max(0, 1 - rT / 2.2);
        lit *= 1 + 1.1 * k * rFar;
        z += rHop * k;
        if (live.set(b)) {
          z += rPop;
          lit *= 1 + rFlash;
        }
      }
      // what is under the pointer lights up, the rest steps back
      if (hovK > 0) lit *= b.hov ? 1 + 0.9 * hovK : 1 - 0.45 * hovK;
      let cr = blockR * sh;
      let cg = blockG * sh;
      let cb = blockB * sh;
      if (b.c === PICK) {
        const t = 1 - back;
        const k = lerp(1, 1.3 / sh, t);
        cr = lerp(cr, swapR, t) * k;
        cg = lerp(cg, swapG, t) * k;
        cb = lerp(cb, swapB, t) * k;
      }
      if (b.role === "removed") {
        const t = remOut * (1 - remGone);
        const k = 1 + 0.6 * t;
        cr = lerp(cr, swapR, t) * k;
        cg = lerp(cg, swapG, t) * k;
        cb = lerp(cb, swapB, t) * k;
      }
      cr *= lit;
      cg *= lit;
      cb *= lit;
      if (m > 0) {
        const mb = smooth((p - 6.1 - (0.32 - D0[n]!) * 1.2) / 0.35);
        const hl = litOf(n);
        const t = hl * mb;
        alpha *= 1 - 0.8 * mb * (1 - hl);
        cr = lerp(cr, pickR, t);
        cg = lerp(cg, pickG, t);
        cb = lerp(cb, pickB, t);
        z += 0.16 * t;
      }
      if (alpha < 0.012) on = false;
      b.on = on;
      b.dx = x;
      b.dz = z;
      b.da = on ? Math.min(1, alpha) : 0;
      b.cr = cr / 255;
      b.cg = cg / 255;
      b.cb = cb / 255;
      if (b.flat) {
        P3[i3] = x;
        P3[i3 + 1] = z;
        P3[i3 + 2] = b.y;
        S3[i3] = b.w;
        S3[i3 + 1] = b.h;
        S3[i3 + 2] = b.d;
      } else {
        P3[i3] = x + GAP;
        P3[i3 + 1] = z;
        P3[i3 + 2] = b.y + GAP;
        S3[i3] = b.w - 2 * GAP;
        S3[i3 + 1] = b.h - GAP;
        S3[i3 + 2] = b.d - 2 * GAP;
      }
      C4[i4] = b.cr;
      C4[i4 + 1] = b.cg;
      C4[i4 + 2] = b.cb;
      C4[i4 + 3] = b.da;
      R3[i3] = b.rot;
      R3[i3 + 1] = b.px;
      R3[i3 + 2] = b.py;
    }
    gl.bricks.touch();

    // studs follow their brick
    {
      const P = gl.studs.pos;
      const S = gl.studs.size;
      const C = gl.studs.col;
      for (let i = 0; i < studs.length; i++) {
        const st = studs[i]!;
        const b = st.b;
        const i3 = i * 3;
        const i4 = i * 4;
        const sa =
          (b.role === "hero" || b.role === "early") && b.z < 1 ? heroStud : 1;
        P[i3] = b.dx + st.ox;
        P[i3 + 1] = b.dz + b.h - GAP;
        P[i3 + 2] = b.y + st.oy;
        S[i3] = 1;
        S[i3 + 1] = 0.13;
        S[i3 + 2] = 1;
        C[i4] = b.cr;
        C[i4 + 1] = b.cg;
        C[i4 + 2] = b.cb;
        C[i4 + 3] = b.da * studA * sa;
      }
      gl.studs.touch();
    }

    // the further out, the denser the lines: dim them so the city doesn't burn white
    const far = clamp01(
      Math.log(H / (2 * s) / FAR_UNIT / 2.7) / Math.log(20 / 2.7),
    );
    // the city is drawn at few pixels per brick, so its lines sit close: dim them by that ratio
    const dense = Math.max(0.6, Math.min(1, s / 13.5));
    const front = lerp(1, 0.62, far) * dense;
    const hidden = lerp(0.2, 0.08, far) * dense;
    gl.bricks.gain(front, hidden);
    gl.studs.gain(front, hidden);

    // floor: invisible near the first brick, coming in around the first app, the fine grid gone once far out
    gl.setFloor(
      palette.block,
      smooth((p - 2.3) / 1.2),
      1 - smooth((p - 5.2) / 0.8),
    );

    // labels
    const hovering = hovName !== "";
    for (const { pin, l } of pins) {
      let a = Math.min(
        clamp01((p - pin.a) / 0.12),
        clamp01((pin.b - p) / 0.12),
      );
      if (pin.alpha) a *= pin.alpha();
      if (hovering) a *= 1 - hovK;
      const at = typeof pin.at === "function" ? pin.at() : pin.at;
      place(l, a, PX(at[0], at[1]), PY(at[0], at[1], at[2]));
    }
    if (hovKey && hovering) {
      // its name goes outside what is lit: off its right-most corner, or its left-most when there is no room
      let rx = -1e9;
      let ry = 0;
      let lx = 1e9;
      let ly = 0;
      for (const b of blocks) {
        if (!b.hov || !b.on) continue;
        const top = b.dz + b.h;
        if (b.q)
          for (let i = 0; i < 4; i++) {
            const qx = b.q[2 * i]!;
            const qy = b.q[2 * i + 1]!;
            const X = PX(qx, qy);
            const Y = PY(qx, qy, top);
            if (X > rx) {
              rx = X;
              ry = Y;
            }
            if (X < lx) {
              lx = X;
              ly = Y;
            }
          }
        else {
          let X = PX(b.dx + b.w, b.y);
          if (X > rx) {
            rx = X;
            ry = PY(b.dx + b.w, b.y, top);
          }
          X = PX(b.dx, b.y + b.d);
          if (X < lx) {
            lx = X;
            ly = PY(b.dx, b.y + b.d, top);
          }
        }
      }
      if (!hoverLabel.w) {
        hoverLabel.el.classList.remove("is-left");
        hoverLabel.w = hoverLabel.el.offsetWidth;
        hoverLabel.h = hoverLabel.el.offsetHeight;
      }
      const left =
        rx + hoverLabel.w + 10 > W - 12 && lx - hoverLabel.w - 10 > sceneLeft;
      hoverLabel.el.classList.toggle("is-left", left);
      if (rx > -1e8)
        place(hoverLabel, hovK, left ? lx - 6 : rx + 6, left ? ly : ry);
      else place(hoverLabel, 0, 0, 0);
    } else place(hoverLabel, 0, 0, 0);
    // app names, once the city stands
    const shown = smooth((p - 5.85) / 0.15);
    for (const { t, l } of names) {
      let a = shown;
      if (m > 0) a *= lerp(1, lerp(0.16, 1, litOf(world.firstOf[t.id]!)), m);
      place(
        l,
        a,
        PX(t.tip[0], t.tip[1]),
        PY(t.tip[0], t.tip[1], t.tip[2] - (t === CH ? 1 : 0) + 0.15),
      );
    }
  }

  // ---------- loop ----------
  let pd = 0;
  let pt = 0;
  let running = false;
  let onScreen = false;
  let raf = 0;
  function frame(ms: number) {
    if (!running) return;
    // the next frame is asked for first, so an error in one frame cannot stop the picture for good
    raf = requestAnimationFrame(frame);
    // the picture eases after the scroll wheel
    const d = pt - pd;
    pd = Math.abs(d) < 0.0008 ? pt : pd + d * 0.16;
    // with reduced motion the light holds still; the scroll still drives everything
    update(pd, calm ? 0 : ms / 1000);
    gl.render();
  }
  function setRunning() {
    const want = onScreen && !document.hidden;
    if (want === running) return;
    running = want;
    if (running) raf = requestAnimationFrame(frame);
    else cancelAnimationFrame(raf);
  }
  const watcher = createInViewWatcher((es) => {
    onScreen = es[es.length - 1]!.isIntersecting;
    setRunning();
  });
  watcher.observe(stage);
  document.addEventListener("visibilitychange", setRunning);

  function resize() {
    sceneLeft = opts.sceneLeft();
    W = stage.clientWidth || 1;
    H = stage.clientHeight || 1;
    gl.setSize(W, H);
  }
  resize();

  return {
    setTarget(p) {
      pt = p;
    },
    jump(p) {
      pt = p;
      pd = p;
    },
    resize,
    remeasure() {
      for (const { l } of pins) l.w = 0;
      for (const { l } of names) l.w = 0;
      hoverLabel.w = 0;
    },
    dispose() {
      watcher.disconnect();
      document.removeEventListener("visibilitychange", setRunning);
      running = false;
      cancelAnimationFrame(raf);
      scroller.removeEventListener("pointermove", onMove);
      scroller.removeEventListener("pointerleave", onLeave);
      scroller.removeEventListener("click", onClick);
      stage.style.cursor = "";
      gl.dispose();
      canvas.remove();
      labelHost.remove();
    },
  };
}
