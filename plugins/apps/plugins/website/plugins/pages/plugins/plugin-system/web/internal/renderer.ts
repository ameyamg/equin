import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CX, CY, RIM } from "./world";

/**
 * The WebGL side of the picture: glass bricks. A face is a dark tint of its
 * brick's colour and lets what is behind it show through; the light is in the
 * edges, which add up where they cross. A brick that is landing, or is left
 * out of a build, is a ghost: edges only (alpha under 0.5).
 *
 * One instanced shader draws every box-ish thing: per instance a min corner, a
 * size, a colour (rgb + strength) and a turn around a vertical axis. Two
 * layers of it — the bricks, and the studs on them — plus a floor grid and a
 * soft bloom. World x, y (ground) and z (up) are three's x, z and y.
 *
 * The scene (`scene.ts`) writes the instance arrays every frame and calls
 * `render`; nothing here knows what a chapter is.
 */
export type RGB = readonly [number, number, number];

export interface InstanceLayer {
  pos: Float32Array;
  size: Float32Array;
  col: Float32Array;
  rot: Float32Array;
  /** The arrays were written: upload them with the next frame. */
  touch(): void;
  /** How bright the edges facing you are, and the ones behind a face. */
  gain(front: number, hidden: number): void;
}

export interface View {
  /** The stage's size in CSS pixels. */
  w: number;
  h: number;
  /** The world point looked at, and where it sits on the stage. */
  camX: number;
  camY: number;
  camZ: number;
  ox: number;
  oy: number;
  /** One stud along x, in pixels. */
  u: number;
}

export interface Renderer {
  bricks: InstanceLayer;
  studs: InstanceLayer;
  setSize(w: number, h: number): void;
  setView(v: View): void;
  /** The floor grid: its colour, how much of it shows, and how much of its fine lines. */
  setFloor(color: RGB, alpha: number, fine: number): void;
  render(): void;
  dispose(): void;
}

const VS = `
  attribute vec3 iPos; attribute vec3 iSize; attribute vec4 iCol; attribute vec3 iRot; // angle, pivot x, pivot z
  varying vec4 vCol; varying vec3 vN; varying float vY;
  void main() {
    vec3 p = iPos + position * iSize;
    float c = cos(iRot.x), s = sin(iRot.x);
    vec2 d = p.xz - iRot.yz;
    p.xz = iRot.yz + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    vec3 n = normal; n.xz = vec2(c * n.x - s * n.z, s * n.x + c * n.z);
    vCol = iCol; vN = n; vY = p.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const FACE_FS = `
  uniform float uOpacity;
  varying vec4 vCol; varying vec3 vN;
  void main() {
    if (vCol.a < 0.5) discard;              // a ghost (landing, or left out of a build) is edges only
    float shade = vN.y > 0.5 ? 1.0 : mix(0.42, 0.62, abs(vN.x));
    gl_FragColor = vec4(vCol.rgb * shade * 0.2, uOpacity);
  }`;
const EDGE_FS = `
  uniform float uGain;
  varying vec4 vCol;
  void main() { gl_FragColor = vec4(vCol.rgb * vCol.a * uGain, 1.0); }`;

export function createRenderer(
  canvas: HTMLCanvasElement,
  background: RGB,
  brickCount: number,
  studCount: number,
): Renderer {
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => {
    owned.push(x);
    return x;
  };

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  // Colours are display values end to end (no linear↔sRGB step anywhere), so the bloom and the plain render agree.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(
    new THREE.Color().setRGB(
      background[0] / 255,
      background[1] / 255,
      background[2] / 255,
      THREE.LinearSRGBColorSpace,
    ),
    1,
  );
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 400);
  const ISO = new THREE.Vector3(1, 1, 1).normalize();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  // the soft glow: the look picked on the prototype
  const bloom = own(
    new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.18, 0.3),
  );
  composer.addPass(bloom);

  function instanced(geom: THREE.BufferGeometry, count: number) {
    const g = own(new THREE.InstancedBufferGeometry());
    g.index = geom.index;
    g.setAttribute("position", geom.getAttribute("position"));
    if (geom.hasAttribute("normal"))
      g.setAttribute("normal", geom.getAttribute("normal"));
    g.instanceCount = count;
    return g;
  }
  function layer(
    baseGeom: THREE.BufferGeometry,
    count: number,
    order: number,
  ): InstanceLayer {
    const attr = (n: number) => {
      const a = new THREE.InstancedBufferAttribute(
        new Float32Array(count * n),
        n,
      );
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    const attrs = {
      iPos: attr(3),
      iSize: attr(3),
      iCol: attr(4),
      iRot: attr(3),
    };
    const faceGeom = instanced(baseGeom, count);
    const edgeGeom = instanced(
      own(new THREE.EdgesGeometry(baseGeom, 30)),
      count,
    );
    // the faces and the edges read the same buffers
    for (const g of [faceGeom, edgeGeom])
      for (const [name, a] of Object.entries(attrs)) g.setAttribute(name, a);
    const frontGain = { value: 1.0 };
    const hiddenGain = { value: 0.22 };
    const faces = new THREE.Mesh(
      faceGeom,
      own(
        new THREE.ShaderMaterial({
          vertexShader: VS,
          fragmentShader: FACE_FS,
          uniforms: { uOpacity: { value: 0.62 } },
          transparent: true,
          depthWrite: true,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      ),
    );
    const front = new THREE.LineSegments(
      edgeGeom,
      own(
        new THREE.ShaderMaterial({
          vertexShader: VS,
          fragmentShader: EDGE_FS,
          uniforms: { uGain: frontGain },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    const hidden = new THREE.LineSegments(
      edgeGeom,
      own(
        new THREE.ShaderMaterial({
          vertexShader: VS,
          fragmentShader: EDGE_FS,
          uniforms: { uGain: hiddenGain },
          transparent: true,
          depthWrite: false,
          depthFunc: THREE.GreaterDepth,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    faces.renderOrder = order;
    front.renderOrder = 10 + order;
    hidden.renderOrder = 20 + order;
    for (const m of [faces, front, hidden]) {
      m.frustumCulled = false;
      scene.add(m);
    }
    return {
      pos: attrs.iPos.array as Float32Array,
      size: attrs.iSize.array as Float32Array,
      col: attrs.iCol.array as Float32Array,
      rot: attrs.iRot.array as Float32Array,
      touch() {
        attrs.iPos.needsUpdate = true;
        attrs.iSize.needsUpdate = true;
        attrs.iCol.needsUpdate = true;
        attrs.iRot.needsUpdate = true;
      },
      gain(f, h) {
        frontGain.value = f;
        hiddenGain.value = h;
      },
    };
  }

  const unitBox = own(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5));
  const studGeom = own(
    new THREE.CylinderGeometry(0.27, 0.27, 1, 18, 1).translate(0, 0.5, 0),
  );
  const bricks = layer(unitBox, brickCount, 1);
  const studs = layer(studGeom, Math.max(1, studCount), 2);

  // The floor: a grid, its fine lines fading as the camera pulls back.
  const floorColor = new THREE.Color();
  const floorFine = { value: 1 };
  const floorAlpha = { value: 1 };
  const floorMat = own(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: floorColor },
        uFine: floorFine,
        uAlpha: floorAlpha,
        uC: { value: new THREE.Vector2(CX, CY) },
      },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uFine; uniform float uAlpha; uniform vec2 uC; varying vec3 vW;
        float grid(vec2 p, float s) { vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }
        void main() {
          float r = length(vW.xz - uC);
          float fade = 1.0 - smoothstep(${(RIM * 1.3).toFixed(1)}, ${(RIM * 3.2).toFixed(1)}, r);
          float a = (grid(vW.xz, 2.0) * 0.08 * uFine + grid(vW.xz, 8.0) * 0.14) * fade * uAlpha;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
    }),
  );
  const floor = new THREE.Mesh(
    own(new THREE.PlaneGeometry(280, 280).rotateX(-Math.PI / 2)),
    floorMat,
  );
  floor.position.set(CX, -0.02, CY);
  floor.renderOrder = 0;
  scene.add(floor);

  return {
    bricks,
    studs,
    setSize(w, h) {
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
    },
    // the camera, on the (1,1,1) diagonal: the scene's 2D framing, in its units
    setView(v) {
      const s = v.u * Math.sqrt(1.5);
      cam.left = -v.ox / s;
      cam.right = (v.w - v.ox) / s;
      cam.top = v.oy / s;
      cam.bottom = -(v.h - v.oy) / s;
      cam.position.set(v.camX, v.camZ, v.camY).addScaledVector(ISO, 120);
      cam.lookAt(v.camX, v.camZ, v.camY);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    },
    setFloor(color, alpha, fine) {
      floorColor.setRGB(color[0] / 255, color[1] / 255, color[2] / 255);
      floorAlpha.value = alpha;
      floorFine.value = fine;
    },
    render() {
      composer.render();
    },
    dispose() {
      for (const x of owned) x.dispose();
      composer.dispose();
      renderer.dispose();
      // hand the GL context back now: a browser keeps only a handful per page
      renderer.forceContextLoss();
    },
  };
}
