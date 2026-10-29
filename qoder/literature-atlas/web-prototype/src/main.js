import './style.css';
import './literature-axis.css';
import * as THREE from 'three';
import { createOverviewLayout, overviewLinkPath } from './overview.js';
import { findNearestNode, findNearestEdge } from './node-hit-test.js';
import { deleteGraphSelection } from './graph-editing.js';
import { readDocument, writeDocument, hydrateAssets, assetView } from './media-store.js';
import { normalizeNode, coverMedia, serializable, visibleColor } from './memory-model.js';
import { NodeEditor, editorMarkup } from './node-editor.js';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { navigationSensitivity, sampleVelocity, releaseVelocity, advanceInertia } from './navigation-motion.js';
import { createVectorScene } from './vector-scene.js';
import { createCameraTransition } from './camera-transition.js';
import { nodeType, nodeTypeIcon, nodeTypePicker } from './node-types.js';
import { LITERATURE_DOCUMENT_KEY, LEGACY_ATLAS_KEY, paperToNode, legacyAtlasToGraph, relationCandidates, topPaperKeyword } from './literature-model.js';
import { createCvDemoGraph } from './cv-demo.js';
import { askLiterature } from './literature-qa.js';
import { powerContextAvailable, powerContextHealth, syncPowerContext } from './powercontext-client.js';

const researchMode = !Capacitor.isNativePlatform() && !new URLSearchParams(window.location.search).has('legacy');
document.body.classList.toggle('literature-axis-mode', researchMode);
if (!researchMode) document.title = 'GlimmerAxis';

async function startApp() {
document.querySelector('#app').innerHTML = `<div style="margin:auto;color:#929a95">正在读取${researchMode ? '文献' : '本机记忆'}…</div>`;
const DAY_MS = 86_400_000;
const STORE_KEY = 'shiguang-web-prototype-v1';
const today = localDate(new Date());

const demoNodes = [
  { id: 'journal', date: today, title: '夜里的思考', type: 'memory', x: -1.25, z: 0.25, text: '把最近的一些念头慢慢写下来。', media: [] },
  { id: 'goal', date: today, title: '把 GlimmerAxis 做出来', type: 'goal', status: '进行中', x: 1.2, z: -0.2, text: '从一个能记录自己的小工具开始。', media: [] },
  { id: 'reading', date: shiftDate(today, -2), title: '读完了这本书', type: 'memory', x: -1.35, z: -0.3, text: '最后几页读得很慢，合上时心里很安静。', media: [] },
  { id: 'walk', date: shiftDate(today, -5), title: '湖边的早晨', type: 'memory', x: 1.2, z: 0.45, text: '空气很凉，湖面几乎没有波纹。', media: [{ kind: 'image', src: sceneImage('lake'), name: '湖边的早晨' }] },
  { id: 'milestone', date: shiftDate(today, -9), title: '第一版原型', type: 'milestone', x: -1.1, z: 0.3, text: '把想法整理成了可以操作的界面。', media: [] },
  { id: 'trip-start', date: shiftDate(today, -16), title: '出发去看海', type: 'start', x: 1.05, z: -0.35, text: '这趟旅程从清晨开始。', media: [] },
  { id: 'trip-end', date: shiftDate(today, -13), title: '回到家', type: 'end', x: -1.1, z: -0.15, text: '带回来几张照片和很多故事。', media: [] },
];

let storageLoadError = null;
let storageReadFailed = false;
let personalState = await loadState();
let collection = researchMode && new URLSearchParams(window.location.search).get('library') !== 'mine' ? 'demo' : 'personal';
let state = collection === 'demo' ? createCvDemoGraph() : personalState;
function prepareGraph(graph) {
  graph.trash ||= [];
  graph.drafts ||= {};
  graph.pendingRestoreLinks ||= [];
  graph.nodes.forEach(normalizeNode);
  graph.mode ||= 'preview';
  graph.scale ||= researchMode ? 'year' : 'week';
  graph.autoRotate ??= true;
  graph.angle ??= .52;
  graph.focusShift ||= 0;
  graph.editorDate ||= today;
  graph.tool ||= 'select';
  graph.selectedId ||= null;
  graph.selectedLinkId = null;
  graph.links ||= [
    { from: 'trip-start', to: 'trip-end', kind: 'progress' },
    { from: 'goal', to: 'milestone', kind: 'branch' },
  ];
  if (researchMode) graph.dismissedRelations ||= [];
  for (const link of graph.links) link.id ||= crypto.randomUUID();
}
prepareGraph(personalState);
if (state !== personalState) prepareGraph(state);

const scaleConfig = {
  day: { name: '天' },
  week: { name: '周' },
  month: { name: '月' },
  year: { name: '年' },
};

document.querySelector('#app').innerHTML = `
  <div class="ambient" aria-hidden="true"></div>
  <header class="topbar">
    <a class="brand" href="#" aria-label="${researchMode ? '文脉星图' : 'GlimmerAxis'} 首页">
      <span class="brand-mark"><i></i></span>
      <span><strong>${researchMode ? '文脉星图' : 'Glimmer Axis'}</strong>${researchMode ? '<small>LITERATURE AXIS</small>' : ''}</span>
    </a>
    <div class="mode-switch" role="tablist" aria-label="视图模式">
      <button class="mode-btn active" data-mode="preview"><span class="mode-glyph orbit-glyph">◉</span>预览</button>
      <button class="mode-btn" data-mode="edit"><span class="mode-glyph">⌖</span>编辑</button>
    </div>
    <div class="top-actions">
      <div class="scale-switch" role="group" aria-label="时间尺度">
        <button data-scale="day">日</button><button data-scale="week" class="active">周</button><button data-scale="month">月</button><button data-scale="year">年</button>
      </div>
      <button class="icon-button rotation-button" data-action="rotation" title="自动旋转" aria-label="切换自动旋转"><span class="rotate-symbol">◌</span><span class="rotation-label">自动旋转</span><span class="switch-indicator"></span></button>
      <button class="icon-button today-button" data-action="today">${researchMode ? '回到近年' : '今天'} <span>↗</span></button>
      ${researchMode ? '<button class="icon-button" data-action="open-about">作品介绍 ↗</button><button class="icon-button library-button" data-action="toggle-library">文献库 <span id="researchCount">0</span></button><button class="icon-button ask-button" data-action="toggle-qa">文献问答 ↗</button>' : ''}
      <button class="icon-button mobile-menu" data-action="menu" aria-label="更多操作" aria-expanded="false">···</button>
    </div>
    <div class="mobile-action-menu" id="mobileActionMenu" hidden><button data-action="today">${researchMode ? '回到近年' : '回到今天'} ↗</button><button data-action="rotation" id="mobileRotationButton">自动旋转</button>${researchMode ? '<button data-action="open-about">作品介绍</button><button data-action="toggle-library">文献库</button><button data-action="toggle-qa">文献问答</button>' : ''}</div>
  </header>

  <main class="workspace">
    <section class="timeline-stage" id="stage" aria-label="时间轴工作区">
      <div class="stage-vignette" aria-hidden="true"></div>
      <canvas id="timelineCanvas" class="timeline-canvas" aria-label="${researchMode ? '可旋转的三维文献时间轴' : '可旋转的三维记忆时间轴'}"></canvas>
      <svg id="sceneVectorLayer" class="scene-vector-layer" aria-hidden="true"></svg>
      <div id="sceneOverlay" class="scene-overlay" aria-hidden="false"></div>
      <button class="new-node-fab" data-action="add-node" aria-label="${researchMode ? '添加文献' : '新建节点'}"><span>＋</span><small>${researchMode ? '添加文献' : '新建节点'}</small></button>
      <div class="editor-toolbar" id="editorToolbar" role="toolbar" aria-label="布局编辑工具" aria-orientation="vertical" hidden>
        <button data-tool="select" class="selected" title="选择节点或关系线，拖动移动节点" aria-pressed="true"><b>↖</b><span>选择</span></button>
        <span class="tool-divider"></span>
        <button data-action="add-node" title="${researchMode ? '添加文献' : '新建节点'}"><b>＋</b><span>${researchMode ? '添加文献' : '新建节点'}</span></button>
        <button data-action="open-relation-toolkit" title="新建关系"><b>⟶</b><span>新建关系</span></button>
        <span class="tool-divider"></span>
        <button data-action="undo" title="撤销"><b>↶</b><span>撤销</span></button>
        <button data-action="redo" title="重做"><b>↷</b><span>重做</span></button>
        <span class="tool-divider"></span>
        <button data-action="delete-selection" title="删除选中项（Delete）" disabled><b>×</b><span>删除</span></button>
        <button data-action="open-detail" title="${researchMode ? '查看文献笔记' : '查看选中节点的记忆'}"><b>▤</b><span>${researchMode ? '文献笔记' : '查看记忆'}</span></button>
        <button class="toolbar-collapse" data-action="collapse-toolbar" title="收起工具栏">›</button>
      </div>
      <button class="toolbar-expand" data-action="expand-toolbar" hidden title="展开工具栏">‹ <span>工具</span></button>
      <div class="plane-controls">
        <div class="editor-date-chip" id="editorDateChip" hidden></div>
        <button class="plane-back" id="planeBack" data-action="exit-plane" hidden>← 返回全局时间轴</button>
      </div>
      <div class="mode-toast" id="modeToast" aria-live="polite"></div>
      <div class="toolkit-popover" id="relationToolkit" hidden>
        <div class="toolkit-title">新建关系</div>
        <button data-relation-kind="branch"><b class="line-icon">╱</b><span>关系线</span><small>连接相关节点</small></button>
        <button data-relation-kind="progress"><b>⟶</b><span>递进箭头</span><small>表示逐步推进</small></button>
      </div>
      <aside class="global-overview" id="globalOverview" aria-label="全局时间轴缩略图" hidden>
        <svg id="overviewSvg" viewBox="0 0 300 240" aria-label="全部日期的记忆与关系，点击节点切换日期"></svg>
      </aside>
      ${researchMode ? '<aside class="research-library" id="researchLibrary" aria-label="我的文献与关系建议"></aside>' : ''}
      ${researchMode ? '<div class="demo-ribbon" id="demoRibbon"><span>CV 经典论文 · 示例脉络</span><button data-action="show-personal">进入我的文献库 →</button></div>' : ''}
    </section>

    <aside class="inspector" id="inspector" aria-live="polite" hidden>
      <button class="inspector-close" data-action="close-inspector" aria-label="关闭简介">×</button>
      <div class="inspector-profile"><span id="inspectorIcon"></span><div><h2 id="inspectorTitle"></h2><span id="inspectorKind"></span><div class="inspector-date" id="inspectorDate"></div></div></div><span id="inspectorStatus"></span>
      <div class="inspector-memory"><div class="inspector-memory-heading"><span id="inspectorMemoryLabel">记忆片段</span><button class="text-button" data-action="edit-preview">编辑这条记忆 ↗</button></div><p id="inspectorText"></p><div class="inspector-media" id="inspectorMedia"></div></div>
      <div class="inspector-actions"><button class="primary-button" data-action="open-detail">查看全部记忆 →</button><button class="quiet-button" data-action="add-memory">＋ 添加记忆</button></div>
      <div class="inspector-secondary"><button class="text-button" data-action="node-settings">节点外观与设置</button><button class="text-button" data-action="edit-day">整理当天布局 ↗</button></div>
    </aside>
    ${researchMode ? `<aside class="literature-qa" id="literatureQa" aria-label="文献问答">
      <div class="qa-heading"><div><small>LIBRARY Q&A</small><h2>文献问答</h2></div><button data-action="toggle-qa" aria-label="关闭问答栏">×</button></div>
      <p class="qa-description">围绕当前文献库提问。回答会列出所依据的论文与连线。</p>
      <div class="qa-context" id="qaContext"></div>
      <div class="qa-messages" id="qaMessages" aria-live="polite"></div>
      <div class="qa-suggestions" id="qaSuggestions"></div>
      <form class="qa-form" id="qaForm"><label for="qaQuestion">向文献库提问</label><textarea id="qaQuestion" rows="2" maxlength="600" placeholder="例如：从 AlexNet 到 ViT 有什么变化？" required></textarea><button type="submit">发送 ↗</button></form>
      <p class="qa-mode" id="qaMode"></p>
    </aside>` : ''}
  </main>


  ${researchMode ? `<dialog class="project-about" id="projectAbout" aria-labelledby="projectAboutTitle">
    <div class="project-about-shell">
      <button class="project-about-close" data-action="close-about" aria-label="关闭作品介绍">×</button>
      <header class="project-about-hero">
        <small>QODER × OCEANBASE · 项目展示</small>
        <h1 id="projectAboutTitle">让文献之间的关系被看见</h1>
        <p>文脉星图把论文放到沿年份延展的 3D 时间轴上，用点表示文献、用边表示经过确认的关系。研究者可以从一篇论文出发，查看方法如何延续、分支和变化。</p>
        <div class="project-about-actions"><button data-action="close-about">进入交互演示 ↗</button><a href="https://github.com/SOLcat1021/PowerContext/tree/2026-competition-ecosystem/qoder/literature-atlas" target="_blank" rel="noopener noreferrer">查看代码仓库 ↗</a></div>
      </header>
      <section class="project-about-section"><small>01 / 解决的问题</small><h2>论文存了很多，却难以看清脉络</h2><p>标题和文件夹能保存文献，却不容易说明一项方法从哪里来、与哪些工作相关、下一步该读什么。文脉星图让阅读记录、论文信息和关系回到同一个可探索的空间。</p></section>
      <section class="project-about-section"><small>02 / 核心功能</small><div class="project-feature-grid"><article><strong>PDF 入库</strong><p>上传可复制文字的 PDF，自动提取标题、作者、年份、DOI、关键词和摘要，并允许核对。</p></article><article><strong>3D 文献轴</strong><p>复用 GlimmerAxis 的三维轴和节点类型；经典论文可标为里程碑，关系线可查看和编辑。</p></article><article><strong>文献问答</strong><p>围绕当前文献库提问并查看依据论文。在线演示提供本地检索；下载源码后可连接 PowerContext 进行持久检索，无需模型 API。</p></article></div></section>
      <section class="project-about-section"><small>03 / 演示截图</small><h2>计算机视觉经典论文脉络</h2><p>示例库收录 9 篇经典论文和 8 条经人工核对的关系。点击下图后可进入在线演示，旋转时间轴并查看论文来源。</p><button class="project-demo-shot" data-action="close-about" aria-label="进入计算机视觉示例演示"><img src="/demo-cv-axis.png" alt="文脉星图计算机视觉示例：三维论文时间轴与右侧文献问答栏" loading="lazy"></button></section>
      <footer class="project-about-footer"><div><strong>体验入口</strong><p>当前网站即交互演示；点击“进入交互演示”浏览 CV 示例，或切换到“我的文献库”上传 PDF。</p></div><button data-action="close-about">进入交互演示 ↗</button></footer>
    </div>
  </dialog>` : ''}

  <dialog class="create-dialog" id="createDialog">
    <form method="dialog" id="createForm">
      <div class="dialog-top"><button class="dialog-close" type="button" data-action="close-create" aria-label="关闭">×</button></div>
      <h2>${researchMode ? '添加文献' : '新建节点'}</h2>
      ${researchMode ? '<label class="paper-upload">上传 PDF，自动提取文献信息<input name="file" type="file" accept="application/pdf,.pdf"/><span>选择本机 PDF 文件</span></label><p id="pdfStatus" class="paper-form-hint" aria-live="polite">支持可复制文字的 PDF。识别结果可在下方核对。</p>' : ''}
      <label class="field-label" for="nodeTitle">标题</label><input id="nodeTitle" name="title" maxlength="300" placeholder="${researchMode ? '从 PDF 自动提取，也可手动修改' : '给这段时光一个名字'}" autocomplete="off" required />
      ${researchMode ? `<div class="paper-form-grid"><label>作者<input name="authors" autocomplete="off"/></label><label>发表年份<input name="year" type="number" min="1000" max="2100" value="${new Date().getFullYear()}" required/></label></div><label class="paper-form-label">DOI 或链接<input name="doi" autocomplete="off"/></label><label class="paper-form-label">主题标签<input name="tags" placeholder="多个标签用逗号分隔"/></label><label class="paper-form-label">摘要或核心观点<textarea name="abstract" rows="4"></textarea></label><p class="paper-form-hint">PDF 和文献信息仅保存在当前浏览器；扫描件可能需要手动补充信息。</p>` : `${nodeTypePicker()}<div class="date-note"><span>日期</span><strong id="createDate"></strong><small>默认今天</small></div>`}
      <div class="dialog-actions"><button class="quiet-button" type="button" data-action="close-create">取消</button><button class="primary-button" name="next" value="create">${researchMode ? '加入文献脉络' : '创建节点'}</button>${researchMode ? '' : '<button class="quiet-button" name="next" value="write">创建并写记忆 →</button>'}</div>
    </form>
  </dialog>

  ${researchMode ? editorMarkup.replaceAll('记忆', '笔记') : editorMarkup}
`;

const stage = document.querySelector('#stage');
const canvas = document.querySelector('#timelineCanvas');
const overlay = document.querySelector('#sceneOverlay');
const scene = new THREE.Scene();
scene.background = new THREE.Color(researchMode ? '#090909' : '#090a0b');
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 150);
const nativeRendering = Capacitor.isNativePlatform();
// Older Android WebViews can discard the canvas surface between native composition passes.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !nativeRendering, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: nativeRendering });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, nativeRendering ? 1.25 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const timelineGroup = new THREE.Group();
timelineGroup.rotation.y = state.angle || .52;
scene.add(timelineGroup);
const axisMaterial = new THREE.LineBasicMaterial({ color: researchMode ? 0xb0b0b0 : 0xaeb3b1, transparent: true, opacity: .68 });
const axisGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -12, 0), new THREE.Vector3(0, 12, 0)]);
const axisLine = new THREE.Line(axisGeometry, axisMaterial);
axisMaterial.visible = false;
timelineGroup.add(axisLine);
const vectorScene = createVectorScene(document.querySelector('#sceneVectorLayer'), camera);
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const nodeMeshes = new Map();
const nodeGlowMeshes = new Map();
const nodeObjects = new Map();
const nodeLabelOffsets = new Map();
const planeObjects = new Map();
let planeAxisMaterial = null;
let planeAxisHighlightUntil = 0;
const linkObjects = [];
const linkVisuals = [];
const tickObjects = [];
const starCount = 420;
const starGeometry = new THREE.BufferGeometry();
const starPositions = new Float32Array(starCount * 3);
const starColors = new Float32Array(starCount * 3);
const starSizes = new Float32Array(starCount);
const starPhases = new Float32Array(starCount);
const starFrequencies = new Float32Array(starCount);
const starOpacities = new Float32Array(starCount);
const starPalette = (researchMode ? ['#ededed', '#bdbdbd', '#ffffff'] : ['#fff0c5', '#d7e8ff', '#ffffff']).map((color) => new THREE.Color(color));
for (let i = 0; i < starCount; i++) {
  starPositions[i * 3] = (Math.random() - .5) * 1.9;
  starPositions[i * 3 + 1] = (Math.random() - .5) * 1.9;
  starPositions[i * 3 + 2] = 0;
  const color = starPalette[Math.floor(Math.random() * starPalette.length)];
  const tint = .94 + Math.random() * .06;
  starColors[i * 3] = color.r * tint;
  starColors[i * 3 + 1] = color.g * tint;
  starColors[i * 3 + 2] = color.b * tint;
  starSizes[i] = Math.random() < .08 ? .52 + Math.random() * .16 : .28 + Math.random() * .2;
  starPhases[i] = Math.random() * Math.PI * 2;
  starFrequencies[i] = .75 + Math.random() * 1.4;
  starOpacities[i] = Math.random() < .08 ? .96 + Math.random() * .04 : .8 + Math.random() * .18;
}
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
starGeometry.setAttribute('aColor', new THREE.BufferAttribute(starColors, 3));
starGeometry.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));
starGeometry.setAttribute('aPhase', new THREE.BufferAttribute(starPhases, 1));
starGeometry.setAttribute('aFrequency', new THREE.BufferAttribute(starFrequencies, 1));
starGeometry.setAttribute('aOpacity', new THREE.BufferAttribute(starOpacities, 1));
const starMaterial = new THREE.ShaderMaterial({
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  uniforms: { uTime: { value: 0 } },
  vertexShader: `
    uniform float uTime;
    attribute vec3 aColor;
    attribute float aSize;
    attribute float aPhase;
    attribute float aFrequency;
    attribute float aOpacity;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec3 point = position;
      float drift = uTime * .11 + aPhase;
      point.x += sin(drift + position.y * .09) * .018;
      point.y += cos(drift * .72 + position.x * .07) * .012;
      vec4 viewPosition = modelViewMatrix * vec4(point, 1.0);
      float pulse = .5 + .5 * sin(uTime * aFrequency + aPhase * 3.1);
      float twinkle = .16 + .84 * pow(pulse, 1.2);
      gl_PointSize = clamp(aSize * (340.0 / max(1.0, -viewPosition.z)), 2.3, 6.4);
      gl_Position = projectionMatrix * viewPosition;
      vColor = aColor;
      vAlpha = aOpacity * twinkle;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      float radius = length(gl_PointCoord - vec2(.5)) * 2.0;
      float core = exp(-radius * radius * 13.0);
      float halo = exp(-radius * radius * 3.2);
      float alpha = min(1.0, vAlpha * (core * 2.2 + halo * .7));
      if (alpha < .012) discard;
      gl_FragColor = vec4(vColor, alpha);
      #include <colorspace_fragment>
    }
  `,
});
const starField = new THREE.Points(starGeometry, starMaterial);
starField.renderOrder = -1;
scene.add(starField);

function updateStarField() {
  const viewDirection = cameraTarget.clone().sub(camera.position);
  const focusDistance = viewDirection.length();
  const depth = Math.min(focusDistance * 1.8, camera.far * .7);
  viewDirection.normalize();
  starField.position.copy(camera.position).addScaledVector(viewDirection, depth);
  starField.quaternion.copy(camera.quaternion);
  const halfHeight = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  starField.scale.set(halfHeight * camera.aspect, halfHeight, 1);
}
const planeHitMesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
planeHitMesh.rotation.x = -Math.PI / 2;
timelineGroup.add(planeHitMesh);
let viewport = { width: 0, height: 0 };
let sceneNeedsResize = false;
let lastFrame = performance.now();
let projectionDirty = true;
let appActive = true;
let animationFrame = null;
let nextRenderTime = 0;
let frameBudget = 0;
let paintedWidth = 0, paintedHeight = 0;
let contextLost = false;
let inertia = null;
const overlaySizes = new WeakMap();
let drag = null;
const touchPointers = new Map();
let pinch = null;
let connectFrom = null;
let openToolkit = null;
let lastRelationTool = 'progress';
let undoStack = [];
let redoStack = [];
let toastTimer = 0;
let cameraTarget = new THREE.Vector3(0, 0, 0);
const cameraTransition = createCameraTransition(camera, cameraTarget);
let currentView = 'global';
let orbitAngle = .56;
let cameraOrbitDistance = 22;
let pointerDown = null;
let lastNodeClick = null;
let overviewLayout = null;
let overviewSignature = null, overviewAngle = null, overviewDirty = true;

function localDate(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 10);
}

function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDate(value);
}

function dayDifference(a, b) {
  return Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / DAY_MS);
}

function formatDate(date, includeYear = false) {
  const d = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat('zh-CN', includeYear ? { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' } : { month: 'long', day: 'numeric', weekday: 'short' }).format(d);
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function safeSourceUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}
function uiNodeColor(value) {
  const color = visibleColor(value);
  if (!researchMode) return color;
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
  const gray = Math.round(channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722).toString(16).padStart(2, '0');
  return `#${gray}${gray}${gray}`;
}
function sceneTone(color) {
  if (!researchMode) return color;
  const red = (color >> 16) & 255, green = (color >> 8) & 255, blue = color & 255;
  const gray = Math.round(red * .2126 + green * .7152 + blue * .0722);
  return (gray << 16) | (gray << 8) | gray;
}

function sceneImage(kind) {
  const scenes = {
    lake: '<rect width="160" height="104" fill="#161819"/><path d="M0 60 43 21 64 43 91 9 160 63v41H0Z" fill="#6c7070"/><path d="m34 31 9-10 7 7-7-2-5 7Zm48-12 9-10 11 17-10-7-5 8Z" fill="#c6c8c6" opacity=".75"/><path d="M0 65q40-8 80 2t80 0v37H0Z" fill="#292e2e"/><path d="M0 79q42-7 82 1t78-1" fill="none" stroke="#9da1a0" stroke-opacity=".5"/><circle cx="124" cy="25" r="9" fill="#d9d9d5" opacity=".65"/>',
    mountain: '<rect width="160" height="104" fill="#1a1b1c"/><path d="M0 78 39 24l19 25L87 12l40 58 18-24 15 23v35H0Z" fill="#767a79"/><path d="m30 37 9-13 8 10-8-4-5 9Zm45-8 12-17 13 19-14-10-5 11Zm47 28 11-15 10 16-11-8-5 8Z" fill="#d2d3d0" opacity=".75"/><path d="M0 78q38-15 78-3t82-2v31H0Z" fill="#303434"/><path d="M0 86q42-12 81-2t79-3" fill="none" stroke="#b8bcba" stroke-opacity=".38"/>',
    window: '<rect width="160" height="104" fill="#191a1b"/><rect x="22" y="9" width="83" height="87" fill="#777a78"/><rect x="29" y="16" width="69" height="73" fill="#292d2e"/><path d="M63 16v73M29 50h69" stroke="#c8cac7" stroke-opacity=".55" stroke-width="3"/><path d="M107 104V54q13-19 27 0v50" fill="#393d3d"/><path d="M110 87q14-11 26 0v17h-26Z" fill="#848784"/><circle cx="134" cy="27" r="11" fill="#bfc1bd" opacity=".55"/>',
  };
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 104">${scenes[kind] || scenes.mountain}</svg>`)}`;
}

async function loadState() {
  if (researchMode) {
    try {
      const stored = await readDocument(LITERATURE_DOCUMENT_KEY);
      if (Array.isArray(stored?.nodes)) return stored;
    } catch (error) { storageLoadError = error; storageReadFailed = true; }
    try {
      const legacy = legacyAtlasToGraph(JSON.parse(localStorage.getItem(LEGACY_ATLAS_KEY)));
      if (legacy) return legacy;
    } catch { /* new research library */ }
    return { nodes: [], links: [], mode: 'preview', scale: 'year', autoRotate: true };
  }
  let stored;
  try { stored = await readDocument('graph'); }
  catch (error) { storageLoadError = error; storageReadFailed = true; }
  if (Array.isArray(stored?.nodes)) {
    try { await hydrateAssets(stored); } catch (error) { storageLoadError = error; }
    return stored;
  }
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY));
    if (Array.isArray(value?.nodes)) return value;
  } catch { /* fresh browser profile */ }
  return { nodes: structuredClone(demoNodes), links: null };
}

let storageQueue = Promise.resolve();
let pendingWrites = 0;
function persist() {
  if (researchMode && collection === 'demo') return Promise.resolve(true);
  const documentState = serializable({ nodes: state.nodes, links: state.links, trash: state.trash, drafts: state.drafts, pendingRestoreLinks: state.pendingRestoreLinks,
    mode: state.mode, scale: state.scale, autoRotate: state.autoRotate,
    angle: timelineGroup.rotation.y,
    focusShift: state.focusShift, editorDate: state.editorDate, editorSession: state.editorSession,
    dismissedRelations: state.dismissedRelations, version: researchMode ? 3 : 2 });
  pendingWrites++;
  // Capture every requested revision and serialize writes, so slow writes cannot overwrite newer edits.
  const task = storageQueue.then(async () => {
    if (storageReadFailed) {
      const original = await readDocument(researchMode ? LITERATURE_DOCUMENT_KEY : 'graph');
      if (original?.nodes) throw new Error('原记录尚未读取，请刷新后重试');
      storageReadFailed = false;
    }
    return writeDocument(researchMode ? LITERATURE_DOCUMENT_KEY : 'graph', documentState);
  });
  const result = task.then(() => {
    storageLoadError = null;
    pendingWrites--;
    return true;
  }, (error) => {
    pendingWrites--;
    const firstFailure = !storageLoadError;
    storageLoadError = error;
    if (firstFailure) showToast(researchMode ? '文献保存失败，请重试' : '本地保存失败，请进入记忆页重试');
    return false;
  });
  storageQueue = result.then(() => undefined);
  return result;
}

function captureSnapshot() {
  return JSON.stringify({ nodes: state.nodes, links: state.links, trash: state.trash, drafts: state.drafts, pendingRestoreLinks: state.pendingRestoreLinks, dismissedRelations: state.dismissedRelations, selectedId: state.selectedId, selectedLinkId: state.selectedLinkId });
}

function snapshot() {
  undoStack.push(captureSnapshot());
  if (undoStack.length > 40) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}

function restoreSnapshot(value) {
  if (!value) return;
  const parsed = JSON.parse(value);
  state.nodes = parsed.nodes;
  state.links = parsed.links;
  state.trash = parsed.trash || [];
  state.drafts = parsed.drafts || {};
  state.pendingRestoreLinks = parsed.pendingRestoreLinks || [];
  if (researchMode) state.dismissedRelations = parsed.dismissedRelations || [];
  state.selectedId = parsed.selectedId && state.nodes.some((node) => node.id === parsed.selectedId) ? parsed.selectedId : null;
  state.selectedLinkId = parsed.selectedLinkId && state.links.some((link) => link.id === parsed.selectedLinkId) ? parsed.selectedLinkId : null;
  if (state.selectedLinkId || state.selectedId) state.tool = 'select';
  connectFrom = null;
  persist();
  render();
}

function updateUndoButtons() {
  document.querySelector('[data-action="undo"]').disabled = undoStack.length === 0;
  document.querySelector('[data-action="redo"]').disabled = redoStack.length === 0;
}

function nodeById(id) { return state.nodes.find((item) => item.id === id); }
function selectedNode() { return nodeById(state.selectedId); }

function typeName(type) {
  return nodeType(type).name;
}

function specialGlyph(type, x, y) {
  if (type === 'memory') return '';
  const shape = nodeType(type).shape;
  return `<g class="special-glyph" transform="translate(${x} ${y})"><g stroke="#090a0b" stroke-width="4.5">${shape}</g><g>${shape}</g></g>`;
}

const DAY_SPACING = .34;
const PERIOD_SPACING = 1.15;
const NODE_SPREAD = 2;
const NODE_DOT_RADIUS = .14;
const NODE_DOT_PIXELS = 8;
const glowCanvas = document.createElement('canvas');
glowCanvas.width = glowCanvas.height = 96;
const glowContext = glowCanvas.getContext('2d');
const glowGradient = glowContext.createRadialGradient(48, 48, 0, 48, 48, 48);
glowGradient.addColorStop(0, 'rgba(255,255,255,.5)');
glowGradient.addColorStop(.14, 'rgba(255,255,255,.32)');
glowGradient.addColorStop(.38, 'rgba(255,255,255,.1)');
glowGradient.addColorStop(.72, 'rgba(255,255,255,.015)');
glowGradient.addColorStop(1, 'rgba(255,255,255,0)');
glowContext.fillStyle = glowGradient;
glowContext.fillRect(0, 0, 96, 96);
const glowTexture = new THREE.CanvasTexture(glowCanvas);
glowTexture.colorSpace = THREE.SRGBColorSpace;
// Special markers need an empty centre: their identity is the outline, not a luminous disc.
const iconGlowCanvas = document.createElement('canvas');
iconGlowCanvas.width = iconGlowCanvas.height = 96;
const iconGlowContext = iconGlowCanvas.getContext('2d');
const iconGlowGradient = iconGlowContext.createRadialGradient(48, 48, 0, 48, 48, 48);
iconGlowGradient.addColorStop(0, 'rgba(255,255,255,0)');
iconGlowGradient.addColorStop(.6, 'rgba(255,255,255,0)');
iconGlowGradient.addColorStop(.73, 'rgba(255,255,255,.08)');
iconGlowGradient.addColorStop(.86, 'rgba(255,255,255,.025)');
iconGlowGradient.addColorStop(1, 'rgba(255,255,255,0)');
iconGlowContext.fillStyle = iconGlowGradient;
iconGlowContext.fillRect(0, 0, 96, 96);
const iconGlowTexture = new THREE.CanvasTexture(iconGlowCanvas);
iconGlowTexture.colorSpace = THREE.SRGBColorSpace;
function startOfWeek(date) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() - ((value.getDay() + 6) % 7));
  return localDate(value);
}

function periodInfo(date, scale = state.scale) {
  const value = new Date(`${date}T12:00:00`);
  let start = date;
  if (scale === 'week') start = startOfWeek(date);
  else if (scale === 'month') start = `${date.slice(0, 7)}-01`;
  else if (scale === 'year') start = `${date.slice(0, 4)}-01-01`;
  let end = start;
  if (scale === 'week') end = shiftDate(start, 6);
  else if (scale === 'month') end = localDate(new Date(value.getFullYear(), value.getMonth() + 1, 0, 12));
  else if (scale === 'year') end = `${date.slice(0, 4)}-12-31`;
  let index = dayDifference(start, scale === 'week' ? startOfWeek(today) : today);
  if (scale === 'week') index /= 7;
  else if (scale === 'month') index = (value.getFullYear() - new Date(`${today}T12:00:00`).getFullYear()) * 12 + value.getMonth() - new Date(`${today}T12:00:00`).getMonth();
  else if (scale === 'year') index = value.getFullYear() - new Date(`${today}T12:00:00`).getFullYear();
  return { start, end, key: start, index };
}

function periodDateAtIndex(index, scale = state.scale) {
  if (scale === 'day') return shiftDate(today, index);
  if (scale === 'week') return shiftDate(startOfWeek(today), index * 7);
  if (scale === 'month') {
    const current = new Date(`${today}T12:00:00`);
    return localDate(new Date(current.getFullYear(), current.getMonth() + index, 1, 12));
  }
  return `${new Date(`${today}T12:00:00`).getFullYear() + index}-01-01`;
}

function periodLabel(date) {
  const { start, end } = periodInfo(date);
  if (state.scale === 'week') {
    const format = (value) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(`${value}T12:00:00`));
    return `${format(start)}—${format(end)}`;
  }
  if (state.scale === 'month') return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(new Date(`${start}T12:00:00`));
  if (state.scale === 'year') return `${start.slice(0, 4)}年`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(`${start}T12:00:00`));
}

function timelineY(date) {
  if (currentView === 'plane') return dayDifference(date, today) * DAY_SPACING;
  return periodInfo(date).index * PERIOD_SPACING;
}

function periodBounds() {
  const indexes = state.nodes.map((node) => periodInfo(node.date).index);
  if (researchMode && indexes.length) return { low: Math.min(...indexes), high: Math.max(...indexes) };
  const todayIndex = periodInfo(today).index;
  const low = Math.min(0, ...indexes, todayIndex);
  const high = Math.max(0, ...indexes, todayIndex);
  return { low, high };
}

function globalCameraPosition(targetY) {
  const { low, high } = periodBounds();
  const span = (high - low + 4) * PERIOD_SPACING;
  const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const verticalFit = span / (2 * halfFov * .92);
  const aspect = Math.max(.2, stage.clientWidth / Math.max(1, stage.clientHeight));
  const planeRadius = (state.scale === 'day' ? 3.5 : 2.4) * 1.8;
  const horizontalFit = stage.clientWidth <= 560 ? planeRadius / (halfFov * aspect) * 1.18 : 0;
  const distance = Math.max(9, verticalFit, horizontalFit);
  cameraOrbitDistance = distance;
  const centerY = targetY ?? (low + high) * .5 * PERIOD_SPACING;
  return new THREE.Vector3(globalAxisOffset(distance), centerY + distance * .36, distance);
}

function globalCameraTarget() {
  const { low, high } = periodBounds();
  return new THREE.Vector3(globalAxisOffset(cameraOrbitDistance), (low + high) * .5 * PERIOD_SPACING, 0);
}

function globalAxisOffset(distance = cameraOrbitDistance) {
  if (researchMode) return 0;
  const width = stage.clientWidth || window.innerWidth;
  const height = stage.clientHeight || window.innerHeight;
  const halfWidth = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (width / height);
  return halfWidth * .16;
}

function globalCameraUp(position, target) {
  const viewDirection = target.clone().sub(position).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  up.addScaledVector(viewDirection, -up.dot(viewDirection)).normalize();
  const distance = position.distanceTo(target);
  const elevation = (position.y - target.y) / distance;
  const verticalProjection = Math.sqrt(Math.max(.01, 1 - elevation * elevation));
  const roll = Math.atan((target.x / distance) * (elevation / verticalProjection));
  return up.applyAxisAngle(viewDirection, -roll);
}

function visibleTimelineBounds() {
  const destination = cameraTransition.destination;
  const position = destination?.position || camera.position;
  const target = destination?.toFocus || cameraTarget;
  const screenUp = destination?.up || new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const verticalProjection = Math.max(.25, Math.abs(screenUp.y));
  const halfWorld = position.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / verticalProjection * 1.22;
  const center = target.y / PERIOD_SPACING;
  const extent = Math.max(5, Math.ceil(halfWorld / PERIOD_SPACING));
  return { low: Math.floor(center) - extent, high: Math.ceil(center) + extent };
}

let renderedTickBounds = { low: 0, high: 0, scale: '' };
let sceneSignature = null, labelSignature = null;
let coverRevision = 0;
const coverSources = new Map();

function clearSceneObjects() {
  for (const obj of [...planeObjects.values(), ...nodeMeshes.values(), ...nodeGlowMeshes.values(), ...linkObjects, ...tickObjects]) {
    timelineGroup.remove(obj);
    obj.geometry?.dispose?.();
    if (obj.material && !Array.isArray(obj.material)) obj.material.dispose?.();
    obj.dispose?.();
  }
  planeObjects.clear(); nodeMeshes.clear(); nodeGlowMeshes.clear(); nodeObjects.clear(); linkObjects.length = 0; linkVisuals.length = 0; tickObjects.length = 0;
  planeAxisMaterial = null;
}

function makeCircle(radius, dashed = true) {
  const pts = [];
  for (let i = 0; i < 128; i++) { const a = i / 128 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius)); }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.LineLoop(geo, new THREE.LineDashedMaterial({ color: sceneTone(0xd1d5d2), transparent: true, opacity: .22, dashSize: .09, gapSize: .12 }));
  line.computeLineDistances();
  return line;
}

function makeOpenCircle(radius) {
  const points = [];
  const gap = .16;
  const stepsPerArc = 36;
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const start = quadrant * Math.PI / 2 + gap / 2;
    const end = (quadrant + 1) * Math.PI / 2 - gap / 2;
    for (let step = 0; step < stepsPerArc; step++) {
      const a = start + (end - start) * step / stepsPerArc;
      const b = start + (end - start) * (step + 1) / stepsPerArc;
      points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      points.push(new THREE.Vector3(Math.cos(b) * radius, 0, Math.sin(b) * radius));
    }
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: sceneTone(0xd1d5d2), transparent: true, opacity: .34, depthWrite: false }));
}

function updateTimelineTicks(low, high) {
  for (const obj of tickObjects) {
    timelineGroup.remove(obj); obj.geometry?.dispose(); obj.material?.dispose(); obj.dispose?.();
  }
  tickObjects.length = 0;
  renderedTickBounds = { low, high, scale: state.scale };
  const axisMin = currentView === 'plane' ? cameraTarget.y - 14 : (low - 2) * PERIOD_SPACING;
  const axisMax = currentView === 'plane' ? cameraTarget.y + 14 : (high + 2) * PERIOD_SPACING;
  axisGeometry.setFromPoints([new THREE.Vector3(0, axisMin, 0), new THREE.Vector3(0, axisMax, 0)]);
  axisGeometry.computeBoundingSphere();
  if (currentView === 'plane') {
    const tick = new THREE.Mesh(new THREE.SphereGeometry(.04, 8, 8), new THREE.MeshBasicMaterial({ color: sceneTone(0xe1e4e2), transparent: true, opacity: .8 }));
    tick.position.set(0, timelineY(state.editorDate), 0); timelineGroup.add(tick); tickObjects.push(tick);
  } else {
    const tickStep = Math.max(1, Math.ceil((high - low + 1) / 120));
    const groups = [[], [], []];
    for (let index = low - 1; index <= high + 1; index++) {
      if (index !== 0 && (index - low + 1) % tickStep !== 0) continue;
      const major = index === 0 || state.scale !== 'day' || tickStep > 1;
      groups[index === 0 ? 0 : major ? 1 : 2].push(index);
    }
    const matrix = new THREE.Matrix4();
    groups.forEach((indices, group) => {
      if (!indices.length) return;
      const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry([.047, .027, .014][group], 8, 8), new THREE.MeshBasicMaterial({ color: sceneTone([0xf0f1ef, 0xa5aaa8, 0x606565][group]), transparent: true, opacity: group < 2 ? .75 : .43 }), indices.length);
      indices.forEach((index, i) => mesh.setMatrixAt(i, matrix.makeTranslation(0, index * PERIOD_SPACING, 0)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      timelineGroup.add(mesh); tickObjects.push(mesh);
    });
  }
  projectionDirty = true;
}

function renderTimeline() {
  const width = stage.clientWidth, height = stage.clientHeight;
  if (width < 1 || height < 1) return;
  if (viewport.width !== width || viewport.height !== height) {
    camera.aspect = width / height; camera.updateProjectionMatrix();
    overlay.querySelectorAll('.date-label-3d, .scene-node-label, .scene-node-cover').forEach((el) => overlaySizes.delete(el));
    projectionDirty = true;
  }
  viewport = { width, height };
  const visibleNodes = currentView === 'plane' ? state.nodes.filter((node) => node.date === state.editorDate) : state.nodes;
  const nodeIds = new Set(visibleNodes.map((node) => node.id));
  for (const id of coverSources.keys()) if (!nodeIds.has(id)) coverSources.delete(id);
  for (const node of visibleNodes) {
    const media = coverMedia(node), source = media ? assetView(media).thumbnail : null;
    if (coverSources.get(node.id) !== source) { coverSources.set(node.id, source); coverRevision++; }
  }
  // No entry text or original media in the key. UI-only changes reuse the geometry and GPU materials.
  const nextScene = JSON.stringify([currentView, state.scale, currentView === 'plane' ? state.editorDate : null, coverRevision,
    visibleNodes.map((node) => [node.id, node.date, node.type, node.title, node.x, node.z, node.color, node.cover]),
    state.links.map((link) => [link.id, link.from, link.to, link.kind])]);
  const nextLabels = JSON.stringify([nextScene, state.mode, state.tool, state.selectedId, state.selectedLinkId, connectFrom]);
  const { low, high } = currentView === 'plane' ? periodBounds() : visibleTimelineBounds();
  if (nextScene === sceneSignature) {
    updateSceneSelection();
    if (nextLabels !== labelSignature) { renderLabels(visibleNodes, low, high); labelSignature = nextLabels; }
    return;
  }
  sceneSignature = nextScene; labelSignature = nextLabels;
  clearSceneObjects();
  updateTimelineTicks(low - 4, high + 4);
  const periods = new Map();
  for (const node of visibleNodes) {
    const key = currentView === 'plane' ? node.date : periodInfo(node.date).key;
    if (!periods.has(key)) periods.set(key, []);
    periods.get(key).push(node);
  }
  if (currentView === 'plane' && !periods.size) periods.set(state.editorDate, []);
  for (const [key, nodes] of periods) {
    const ringRadius = (currentView === 'plane' ? 4.25 : state.scale === 'day' ? 3.5 : 2.4) * 1.8;
    const ring = currentView === 'plane' ? makeOpenCircle(ringRadius) : makeCircle(ringRadius);
    ring.position.y = timelineY(nodes[0]?.date || state.editorDate); ring.userData.period = key;
    if (key === periodInfo(today).key) ring.material.opacity = .34;
    if (currentView === 'plane') ring.material.opacity = .34;
    timelineGroup.add(ring); planeObjects.set(key, ring);
  }
  if (currentView === 'plane') {
    const radius = 4.25 * 1.8 * .82;
    const planeY = timelineY(state.editorDate);
    // The day-layout plane uses world X/Z; the UI names its two directions X/Y.
    const centerGap = .48;
    const axesGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-radius, planeY, 0), new THREE.Vector3(-centerGap, planeY, 0),
      new THREE.Vector3(centerGap, planeY, 0), new THREE.Vector3(radius, planeY, 0),
      new THREE.Vector3(0, planeY, -radius), new THREE.Vector3(0, planeY, -centerGap),
      new THREE.Vector3(0, planeY, centerGap), new THREE.Vector3(0, planeY, radius),
    ]);
    planeAxisMaterial = new THREE.LineDashedMaterial({ color: sceneTone(0xb8c0bc), transparent: true, opacity: .3, dashSize: .075, gapSize: .11, depthWrite: false });
    const axes = new THREE.LineSegments(axesGeometry, planeAxisMaterial);
    axes.computeLineDistances();
    axes.renderOrder = 1;
    timelineGroup.add(axes); tickObjects.push(axes);
  }
  const dotGeometry = new THREE.SphereGeometry(NODE_DOT_RADIUS, 16, 12);
  const nodeSpread = currentView !== 'plane' && state.scale === 'day' ? NODE_SPREAD * 1.2 : NODE_SPREAD;
  for (const node of visibleNodes) {
    const selected = node.id === state.selectedId;
    const nodeColor = uiNodeColor(node.color);
    const { x, z } = displayNodePosition(node);
    const position = new THREE.Vector3(x * nodeSpread, timelineY(node.date), z * nodeSpread);
    const special = node.type !== 'memory';
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: special ? iconGlowTexture : glowTexture, color: nodeColor, transparent: true, opacity: special ? (selected ? .55 : .38) : (selected ? .85 : .7), depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    glow.position.copy(position); glow.scale.set(NODE_DOT_RADIUS * (special ? 12 : 8), NODE_DOT_RADIUS * (special ? 12 : 8), 1); glow.userData.nodeId = node.id; glow.userData.special = special; glow.renderOrder = 2; timelineGroup.add(glow); nodeGlowMeshes.set(node.id, glow);
    const dot = new THREE.Mesh(dotGeometry, new THREE.MeshBasicMaterial({ color: nodeColor }));
    dot.visible = node.type === 'memory';
    dot.position.copy(position); dot.userData.nodeId = node.id; timelineGroup.add(dot); nodeMeshes.set(node.id, dot); nodeObjects.set(node.id, node);
  }
  for (const link of state.links) {
    const from = nodeById(link.from), to = nodeById(link.to);
    if (!from || !to || !nodeMeshes.has(from.id) || !nodeMeshes.has(to.id)) continue;
    const selected = link.id === state.selectedLinkId;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([nodeMeshes.get(from.id).position, nodeMeshes.get(to.id).position]), new THREE.LineBasicMaterial({ color: sceneTone(selected ? 0xf4fbf7 : link.kind === 'progress' ? 0xc4c8c6 : 0xb7bcba), transparent: true, opacity: selected ? 1 : link.kind === 'progress' ? .62 : .32 }));
    timelineGroup.add(line); linkObjects.push(line);
    const visual = { id: link.id, kind: link.kind, from: from.id, to: to.id, line, arrow: null };
    if (link.kind === 'progress') {
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(.075, .2, 8), new THREE.MeshBasicMaterial({ color: sceneTone(selected ? 0xf4fbf7 : 0xc4c8c6), transparent: true, opacity: selected ? 1 : .72 }));
      visual.arrow = arrow;
      timelineGroup.add(arrow); linkObjects.push(arrow);
    }
    linkVisuals.push(visual);
  }
  updateLinkPositions();
  const guides = [axisLine, ...planeObjects.values(), ...tickObjects.filter((object) => object.isLineSegments)];
  for (const object of [...guides, ...linkObjects]) object.material.visible = false;
  vectorScene.setObjects(guides, linkVisuals);
  if (currentView === 'plane') {
    planeHitMesh.position.set(0, timelineY(state.editorDate), 0);
    planeHitMesh.visible = true;
  } else planeHitMesh.visible = false;
  renderLabels(visibleNodes, low, high);
}

function updateSceneSelection() {
  for (const [id, glow] of nodeGlowMeshes) glow.material.opacity = glow.userData.special ? (id === state.selectedId ? .55 : .38) : (id === state.selectedId ? .85 : .7);
  for (const visual of linkVisuals) {
    const selected = visual.id === state.selectedLinkId;
    visual.line.material.color.set(selected ? 0xf4fbf7 : visual.kind === 'progress' ? 0xc4c8c6 : 0xb7bcba);
    visual.line.material.opacity = selected ? 1 : visual.kind === 'progress' ? .62 : .32;
    if (visual.arrow) {
      visual.arrow.material.color.set(selected ? 0xf4fbf7 : 0xc4c8c6);
      visual.arrow.material.opacity = selected ? 1 : .72;
    }
  }
  projectionDirty = true;
}

function updateLinkPositions(nodeId = null) {
  const direction = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const visual of linkVisuals) {
    if (nodeId && visual.from !== nodeId && visual.to !== nodeId) continue;
    const from = nodeMeshes.get(visual.from)?.position;
    const to = nodeMeshes.get(visual.to)?.position;
    if (!from || !to) continue;
    const positions = visual.line.geometry.getAttribute('position');
    positions.setXYZ(0, from.x, from.y, from.z);
    positions.setXYZ(1, to.x, to.y, to.z);
    positions.needsUpdate = true;
    visual.line.geometry.computeBoundingSphere();
    if (visual.arrow) {
      direction.subVectors(to, from);
      visual.arrow.visible = direction.lengthSq() > 1e-10;
      visual.arrow.position.copy(from).lerp(to, .86);
      if (visual.arrow.visible) visual.arrow.quaternion.setFromUnitVectors(up, direction.normalize());
    }
  }
}

function updateNodeDotScales() {
  if (!viewport.height) return;
  camera.updateMatrixWorld();
  timelineGroup.updateMatrixWorld();
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  for (const [id, dot] of nodeMeshes) {
    local.copy(dot.position);
    timelineGroup.localToWorld(local);
    world.copy(local).applyMatrix4(camera.matrixWorldInverse);
    const depth = Math.max(.1, -world.z);
    const radius = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * NODE_DOT_PIXELS / viewport.height;
    dot.scale.setScalar((radius / NODE_DOT_RADIUS) * (id === state.selectedId ? 1.14 : 1));
    const glow = nodeGlowMeshes.get(id);
    if (glow) {
      const glowSize = radius * (glow.userData.special ? 12 : 8);
      glow.scale.set(glowSize, glowSize, 1);
    }
  }
}

function displayNodePosition(node) {
  if (currentView === 'plane' || state.scale === 'day') return { x: node.x, z: node.z };
  const date = new Date(`${node.date}T12:00:00`);
  let fraction = 0;
  if (state.scale === 'week') fraction = (date.getDay() + 6) % 7;
  else if (state.scale === 'month') fraction = date.getDate() - 1;
  else fraction = date.getMonth();
  const count = state.scale === 'week' ? 7 : state.scale === 'month' ? new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() : 12;
  const angle = (fraction / count) * Math.PI * 2 - Math.PI / 2;
  const radius = .24;
  return { x: node.x + Math.cos(angle) * radius, z: node.z + Math.sin(angle) * radius };
}

function renderGlobalOverview() {
  const panel = document.querySelector('#globalOverview');
  const workspace = document.querySelector('.workspace');
  const docked = currentView === 'plane' && window.matchMedia('(max-width: 560px)').matches;
  workspace.classList.toggle('mobile-plane-layout', docked);
  const host = docked ? workspace : stage;
  if (panel.parentElement !== host) host.append(panel);
  panel.hidden = currentView !== 'plane';
  if (panel.hidden) return;
  const signature = JSON.stringify([state.editorDate, state.tool, state.selectedId, state.selectedLinkId, connectFrom,
    state.nodes.map((node) => [node.id, node.date, node.title, node.x, node.z, node.color]), state.links]);
  if (overviewSignature === signature) { updateGlobalOverview(); return; }
  overviewSignature = signature; overviewDirty = true;

  overviewLayout = createOverviewLayout(state.nodes, state.editorDate, timelineGroup.rotation.y);
  const { dates, dateY } = overviewLayout;
  const activeY = dateY(state.editorDate);
  const rings = dates.map((date) => `<ellipse cx="138" cy="${dateY(date)}" rx="76" ry="14" class="overview-plane ${date === state.editorDate ? 'current' : ''}"/>`).join('');
  const dateLabels = dates.filter((date, index) => date === state.editorDate || ((index === 0 || index === dates.length - 1) && Math.abs(dateY(date) - activeY) > 22));
  const labels = dateLabels.map((date) => `<text x="147" y="${dateY(date) + 8}" class="overview-date ${date === state.editorDate ? 'current' : ''}">${escapeHTML(date.slice(5).replace('-', '/'))}</text>`).join('');
  const nodeIds = new Set(state.nodes.map((node) => node.id));
  const links = state.links.filter((link) => nodeIds.has(link.from) && nodeIds.has(link.to));
  const paths = links.map((link) => {
    const label = `${link.kind === 'progress' ? '递进关系' : '关系线'}：${nodeById(link.from).title} → ${nodeById(link.to).title}`;
    const interactive = state.tool === 'select' ? `data-overview-edge="${escapeHTML(link.id)}" role="button" tabindex="0" aria-label="${escapeHTML(label)}"` : '';
    const hit = interactive ? `<path class="overview-edge-hit ${link.kind === 'progress' ? 'progress' : ''}" data-from="${escapeHTML(link.from)}" data-to="${escapeHTML(link.to)}" ${interactive}/>` : '';
    return `${hit}<path class="overview-connection ${link.kind === 'progress' ? 'progress' : ''} ${link.from === state.selectedId || link.to === state.selectedId ? 'related' : ''} ${link.id === state.selectedLinkId ? 'selected' : ''}" data-link-id="${escapeHTML(link.id)}" data-from="${escapeHTML(link.from)}" data-to="${escapeHTML(link.to)}" ${link.kind === 'progress' ? 'marker-end="url(#overviewArrow)"' : ''}/>`;
  }).join('');
  const dots = state.nodes.map((node) => {
    const color = uiNodeColor(node.color);
    return `<g class="overview-node ${node.date === state.editorDate ? 'current' : ''} ${node.id === state.selectedId ? 'selected' : ''} ${node.id === connectFrom ? 'source' : ''}" data-overview-node="${escapeHTML(node.id)}" role="button" tabindex="0" aria-label="${escapeHTML(`${formatDate(node.date)}：${node.title}`)}" style="color:${color}"><title>${escapeHTML(`${formatDate(node.date, true)} · ${node.title}`)}</title><circle class="overview-hit" r="10"/><circle class="overview-selection" r="7"/><circle class="overview-dot" r="${node.id === state.selectedId || node.id === connectFrom ? 3.4 : 2.8}"/></g>`;
  }).join('');
  document.querySelector('#overviewSvg').innerHTML = `<defs><marker id="overviewArrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L6 3 L0 6 Z" fill="#b9c1bc"/></marker></defs><path class="overview-axis" d="M138 224V16"/><ellipse cx="138" cy="${activeY}" rx="76" ry="14" class="overview-active-fill"/>${rings}${paths}${labels}${dots}`;
  updateGlobalOverview();
}

function updateGlobalOverview() {
  if (currentView !== 'plane' || !overviewLayout) return;
  if (!overviewDirty && overviewAngle === timelineGroup.rotation.y) return;
  overviewDirty = false; overviewAngle = timelineGroup.rotation.y;
  const points = new Map(state.nodes.map((node) => [node.id, overviewLayout.projectNode(node, timelineGroup.rotation.y)]));
  const svg = document.querySelector('#overviewSvg');
  svg.querySelectorAll('[data-overview-node]').forEach((element) => {
    const point = points.get(element.dataset.overviewNode);
    if (point) element.setAttribute('transform', `translate(${point.x} ${point.y})`);
  });
  svg.querySelectorAll('.overview-connection, .overview-edge-hit').forEach((element) => {
    element.setAttribute('d', overviewLinkPath(points.get(element.dataset.from), points.get(element.dataset.to), element.classList.contains('progress')));
  });
}

function activateOverviewNode(id) {
  const node = nodeById(id);
  if (!node) return;
  if (state.tool === 'branch' || state.tool === 'progress') addConnection(id);
  else if (node.date === state.editorDate) selectNode(id);
  else enterPlane(node);
}

function renderLabels(visibleNodes, low, high) {
  const labels = [];
  if ((state.mode === 'edit' && state.tool === 'select') || state.selectedLinkId) {
    const hits = state.mode === 'edit' && state.tool === 'select' ? linkVisuals.map((link) => `<path class="scene-edge-hit" data-edge-id="${escapeHTML(link.id)}" role="button" tabindex="0" aria-label="${escapeHTML(`${link.kind === 'progress' ? '递进关系' : '关系线'}：${nodeById(link.from).title} → ${nodeById(link.to).title}`)}"/>`).join('') : '';
    const selected = state.selectedLinkId ? `<g data-selected-edge="${escapeHTML(state.selectedLinkId)}" aria-hidden="true"><path class="edge-selection-halo"/><path class="edge-selection-line"/><circle class="edge-selection-end from" r="5"/><circle class="edge-selection-end to" r="5"/></g>` : '';
    labels.push(`<svg class="scene-edge-layer" viewBox="0 0 ${viewport.width} ${viewport.height}">${hits}${selected}</svg>`);
  }
  const showNode = currentView === 'plane' ? visibleNodes.filter((n) => n.date === state.editorDate) : visibleNodes;
  for (const node of showNode) {
    const coverItem = coverMedia(node);
    const cover = coverItem && assetView(coverItem).thumbnail;
    if (node.id === state.selectedId || node.id === connectFrom) {
      labels.push(`<span class="scene-node-selection ${node.type !== 'memory' ? 'special' : ''} ${cover ? 'with-cover' : ''} ${node.id === connectFrom ? 'source' : ''}" data-selection-id="${escapeHTML(node.id)}" aria-hidden="true"></span>`);
    }
    if (cover) {
      labels.push(`<button class="event-group scene-node-cover ${node.id === state.selectedId ? 'selected' : ''}" data-node-id="${escapeHTML(node.id)}" aria-label="${escapeHTML(`${node.title}照片封面`)}"><img src="${escapeHTML(cover)}" alt="" style="object-position:${node.cover.x}% ${node.cover.y}%;transform:scale(${node.cover.zoom})"/></button>`);
    }
    if (node.type !== 'memory') {
      labels.push(`<button class="scene-node-icon" style="color:${uiNodeColor(node.color)};--node-light:${uiNodeColor(node.color)}" data-node-id="${escapeHTML(node.id)}" aria-label="${escapeHTML(`${typeName(node.type)}：${node.title}`)}"><svg viewBox="-12 -12 24 24" aria-hidden="true">${specialGlyph(node.type, 0, 0)}</svg></button>`);
    }
    const exactDate = !researchMode && (state.scale === 'day' || currentView === 'plane') ? '' : `<small>${escapeHTML(new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(`${node.date}T12:00:00`)))}</small>`;
    const labelContent = researchMode
      ? `<strong class="paper-keyword">${escapeHTML(topPaperKeyword({ ...node.paper, title: node.title }))}</strong><span class="paper-title">${escapeHTML(String(node.paper?.year || node.date.slice(0, 4)))} · ${escapeHTML(node.title)}</span>`
      : `<span>${escapeHTML(node.title)}</span>${exactDate}`;
    labels.push(`<button class="event-group scene-node-label ${cover ? 'with-cover' : ''} ${node.id === state.selectedId ? 'selected' : ''}" data-node-id="${escapeHTML(node.id)}" aria-label="${escapeHTML(node.title)}">${labelContent}</button>`);
  }
  if (currentView !== 'plane') {
    labels.push(globalDateLabels(low, high));
  } else {
    const planeY = timelineY(state.editorDate).toFixed(3);
    labels.push(`<span class="date-label-3d plane-time-label" data-world="0.42,${planeY},1.05">${escapeHTML(formatDate(state.editorDate, true))}</span>`);
    const radius = (4.25 * 1.8 * .82).toFixed(3);
    labels.push(`<span class="date-label-3d plane-axis-label axis-x-label" data-world="${radius},${planeY},0">+X</span>`);
    labels.push(`<span class="date-label-3d plane-axis-label axis-y-label" data-world="0,${planeY},-${radius}">+Y</span>`);
  }
  updateOverlayElements(labels.join(''));
}

function globalDateLabels(low, high) {
  const labels = [];
  const tickStep = Math.max(1, Math.ceil((high - low + 1) / 120));
  for (let index = low - 1; index <= high + 1; index++) {
    if (index !== 0 && (index - low + 1) % tickStep !== 0) continue;
    const date = periodDateAtIndex(index);
    const current = index === 0;
    labels.push(`<span class="date-label-3d" data-world="0,${(index * PERIOD_SPACING).toFixed(3)},0">${escapeHTML(periodLabel(date))}${current ? ` · ${researchMode ? '当前年份' : '今天'}` : ''}</span>`);
  }
  return labels.join('');
}

function updateOverlayElements(markup) {
  // Keep cover buttons and decoded images connected to the same overlay during scene rebuilds.
  // Their compositor layers and crop no longer reset when ticks or selection change.
  const covers = new Map([...overlay.querySelectorAll('.scene-node-cover')].map((element) => [element.dataset.nodeId, element]));
  const template = document.createElement('template');
  template.innerHTML = markup;
  const children = [...template.content.children].map((element) => {
    if (!element.classList.contains('scene-node-cover')) return element;
    const existing = covers.get(element.dataset.nodeId);
    if (!existing) return element;
    existing.className = element.className;
    existing.setAttribute('aria-label', element.getAttribute('aria-label'));
    const image = existing.querySelector('img'), nextImage = element.querySelector('img');
    for (const attribute of ['src', 'style']) {
      const value = nextImage.getAttribute(attribute);
      if (image.getAttribute(attribute) !== value) image.setAttribute(attribute, value);
    }
    return existing;
  });
  children.forEach((element, index) => {
    const current = overlay.children[index];
    if (current !== element) overlay.insertBefore(element, current || null);
  });
  while (overlay.children.length > children.length) overlay.lastElementChild.remove();
  overlay.querySelectorAll('.date-label-3d, .scene-node-label, .scene-node-cover').forEach((el) => overlaySizes.delete(el));
  projectionDirty = true;
}

function projectLabels() {
  // Read all sizes before writing transforms. Hidden elements retain their last known size.
  overlay.querySelectorAll('.date-label-3d, .scene-node-label, .scene-node-cover').forEach((el) => {
    if (!overlaySizes.has(el) && !el.hidden) overlaySizes.set(el, { width: el.offsetWidth, height: el.offsetHeight });
  });
  const sizeOf = (el) => overlaySizes.get(el) || { width: 52, height: 24 };
  timelineGroup.updateMatrixWorld(true); camera.updateMatrixWorld();
  const projectedEdges = overlay.querySelector('[data-edge-id], [data-selected-edge]')
    ? new Map(linkVisuals.map((visual) => [visual.id, projectEdge(visual)])) : new Map();
  const projectedNodes = new Map([...nodeMeshes].map(([id, mesh]) => [id, mesh.position.clone().applyMatrix4(timelineGroup.matrixWorld).project(camera)]));
  overlay.querySelectorAll('[data-edge-id]').forEach((element) => {
    const edge = projectedEdges.get(element.dataset.edgeId);
    element.toggleAttribute('hidden', !edge);
    element.setAttribute('d', edge ? `M${edge.from.x} ${edge.from.y}L${edge.to.x} ${edge.to.y}` : '');
  });
  overlay.querySelectorAll('[data-selected-edge]').forEach((element) => {
    const edge = projectedEdges.get(element.dataset.selectedEdge);
    element.toggleAttribute('hidden', !edge);
    if (!edge) return;
    element.querySelectorAll('path').forEach((path) => path.setAttribute('d', `M${edge.from.x} ${edge.from.y}L${edge.to.x} ${edge.to.y}`));
    for (const end of ['from', 'to']) {
      const circle = element.querySelector(`.${end}`);
      circle.setAttribute('cx', edge[end].x); circle.setAttribute('cy', edge[end].y);
    }
  });
  const placedLabels = [];
  overlay.querySelectorAll('.date-label-3d').forEach((el) => {
    const [x, y, z] = el.dataset.world.split(',').map(Number);
    const p = timelineGroup.localToWorld(new THREE.Vector3(x, y, z)).project(camera);
    const axisLabel = el.classList.contains('plane-axis-label');
    const left = (p.x * .5 + .5) * viewport.width + (axisLabel ? 7 : 28);
    const top = (-p.y * .5 + .5) * viewport.height + (el.classList.contains('axis-y-label') ? -7 : axisLabel ? 0 : 6);
    el.style.transform = `translate3d(${left}px, ${top}px, 0) translateY(-50%)`;
    el.hidden = p.z < -1 || p.z > 1 || left < -120 || left > viewport.width + 20 || top < -20 || top > viewport.height + 20;
    if (!el.hidden) {
      const { width, height } = sizeOf(el);
      placedLabels.push({ left, right: left + width, top: top - height / 2, bottom: top + height / 2 });
    }
  });
  const projectedLabels = [];
  const activeLabelIds = new Set();
  overlay.querySelectorAll('.scene-node-selection').forEach((el) => {
    const obj = nodeMeshes.get(el.dataset.selectionId);
    if (!obj) { el.hidden = true; return; }
    const p = projectedNodes.get(el.dataset.selectionId);
    el.style.transform = `translate3d(${(p.x * .5 + .5) * viewport.width}px, ${(-p.y * .5 + .5) * viewport.height}px, 0) translate(-50%, -50%)`;
    el.hidden = p.z < -1 || p.z > 1 || p.x < -1.1 || p.x > 1.1 || p.y < -1.1 || p.y > 1.1;
  });
  overlay.querySelectorAll('.scene-node-icon, .scene-node-cover').forEach((el) => {
    const node = nodeObjects.get(el.dataset.nodeId); const obj = nodeMeshes.get(el.dataset.nodeId);
    if (!node || !obj || (currentView === 'plane' && node.date !== state.editorDate)) { el.hidden = true; return; }
    const p = projectedNodes.get(el.dataset.nodeId);
    const cover = el.classList.contains('scene-node-cover');
    const x = (p.x * .5 + .5) * viewport.width;
    const y = (-p.y * .5 + .5) * viewport.height - (cover ? 10 : 0);
    if (cover) {
      // Move the already-rasterized picture and its circular window as one layer.
      // Keep fractional positions: integer rounding would turn slow rotation into steps.
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    } else {
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    }
    el.hidden = p.z < -1 || p.z > 1 || p.x < -1.1 || p.x > 1.1 || p.y < -1.1 || p.y > 1.1;
    if (!el.hidden && cover) {
      // Fixed cover dimensions let label placement use the projection directly, avoiding a
      // layout read immediately after moving the image layer.
      const { width, height } = sizeOf(el);
      placedLabels.push({ left: x - width / 2, right: x + width / 2, top: y - height, bottom: y });
    }
  });
  overlay.querySelectorAll('.scene-node-label').forEach((el) => {
    const n = nodeObjects.get(el.dataset.nodeId); const obj = nodeMeshes.get(el.dataset.nodeId);
    if (!n || !obj || (currentView === 'plane' && n.date !== state.editorDate)) { el.hidden = true; return; }
    activeLabelIds.add(n.id);
    const p = projectedNodes.get(el.dataset.nodeId);
    const x = (p.x * .5 + .5) * viewport.width, y = (-p.y * .5 + .5) * viewport.height;
    const { width, height } = sizeOf(el);
    const hidden = p.z < -1 || p.z > 1 || x < -width || x > viewport.width + width || y < -height || y > viewport.height + height;
    el.hidden = hidden;
    if (!hidden) projectedLabels.push({ el, node: n, x, y, width, height });
  });
  for (const id of nodeLabelOffsets.keys()) if (!activeLabelIds.has(id)) nodeLabelOffsets.delete(id);
  projectedLabels.sort((a, b) => a.node.date.localeCompare(b.node.date) || a.node.id.localeCompare(b.node.id));
  for (const label of projectedLabels) {
    const { width, height } = label;
    const side = width / 2 + 14;
    const up = height + 9;
    const selectionGap = label.node.type === 'memory' ? 22 : 27;
    const offsets = label.el.classList.contains('with-cover')
      ? [[0, height + 12], [-side, height + 12], [side, height + 12], [-side, 0], [side, 0], [0, height + 12 + up], [-side, height + 12 + up], [side, height + 12 + up]]
      : [[0, 0], [-side, 0], [side, 0], [0, -up], [0, up], [-side, -up], [side, -up], [-side, up], [side, up], [0, -up * 2], [0, up * 2]].map(([dx, dy]) => [dx, dy - selectionGap]);
    let chosen = null;
    const previousIndex = nodeLabelOffsets.get(label.node.id);
    const placeAt = (index) => {
      const [dx, dy] = offsets[index];
      const x = THREE.MathUtils.clamp(label.x + dx, width / 2 + 6, viewport.width - width / 2 - 6);
      const y = THREE.MathUtils.clamp(label.y + dy, height + 6, viewport.height - 6);
      return { x, y, offsetIndex: index, left: x - width / 2, right: x + width / 2, top: y - height, bottom: y };
    };
    if (previousIndex !== undefined && previousIndex < offsets.length) {
      chosen = placeAt(previousIndex);
    } else {
      for (let index = 0; index < offsets.length; index++) {
        const candidate = placeAt(index);
        if (placedLabels.every((placed) => candidate.right + 5 <= placed.left || candidate.left - 5 >= placed.right || candidate.bottom + 5 <= placed.top || candidate.top - 5 >= placed.bottom)) {
          chosen = candidate;
          break;
        }
      }
    }
    if (!chosen) {
      const x = THREE.MathUtils.clamp(label.x, width / 2 + 6, viewport.width - width / 2 - 6);
      const y = THREE.MathUtils.clamp(label.y, height + 6, viewport.height - 6);
      chosen = { x, y, offsetIndex: 0, left: x - width / 2, right: x + width / 2, top: y - height, bottom: y };
    }
    nodeLabelOffsets.set(label.node.id, chosen.offsetIndex);
    label.el.style.transform = `translate3d(${chosen.x}px, ${chosen.y}px, 0) translate(-50%, -100%)`;
    placedLabels.push(chosen);
  }
}

function setCameraPose(position, target, up = globalCameraUp(position, target)) {
  camera.position.copy(position); cameraTarget.copy(target); camera.up.copy(up); camera.lookAt(cameraTarget);
}

function animateCameraTo(position, target, up = globalCameraUp(position, target)) {
  cameraTransition.start(position, target, up);
  projectionDirty = true;
}

function enterPlane(node) {
  if (!node) return;
  stopInertia();
  state.mode = 'edit';
  state.editorDate = node.date; state.selectedId = node.id; currentView = 'plane'; state.autoRotate = false;
  state.selectedLinkId = null;
  renderGlobalOverview();
  const target = new THREE.Vector3(0, timelineY(node.date), 0);
  const planeRadius = 4.25 * 1.8;
  const aspect = (stage.clientWidth || window.innerWidth) / (stage.clientHeight || window.innerHeight);
  const distance = planeRadius / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, aspect)) * 1.18;
  animateCameraTo(target.clone().add(new THREE.Vector3(0, distance, .001)), target, new THREE.Vector3(0, 0, -1));
  render(); persist();
}

function exitPlane() {
  stopInertia();
  currentView = 'global';
  renderGlobalOverview();
  animateCameraTo(globalCameraPosition(), globalCameraTarget());
  render();
}

function renderEditor() { renderTimeline(); }

function renderInspector() {
  const panel = document.querySelector('#inspector');
  const node = selectedNode();
  panel.hidden = state.mode === 'edit' || !node;
  if (!node || state.mode === 'edit') return;
  if (researchMode) {
    const paper = node.paper || {};
    const linked = state.links.filter((link) => link.from === node.id || link.to === node.id);
    panel.innerHTML = `<button class="inspector-close" data-action="close-inspector" aria-label="关闭简介">×</button>
      <div class="inspector-profile"><span id="inspectorIcon">${nodeTypeIcon(node.type)}</span><div><h2>${escapeHTML(node.title)}</h2><span>文献节点</span><div class="inspector-date">${escapeHTML(String(paper.year || node.date.slice(0, 4)))} 年 · ${escapeHTML(paper.authors || '作者待补充')}</div></div></div>
      <div class="inspector-memory"><div class="inspector-memory-heading">摘要与核心观点</div><p>${escapeHTML(paper.abstract || '还没有摘要。可以编辑文献补充核心观点。')}</p></div>
      ${paper.tags?.length ? `<div class="research-tags">${paper.tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join('')}</div>` : ''}
      ${safeSourceUrl(paper.doi) ? `<p class="research-source">来源：<a href="${escapeHTML(safeSourceUrl(paper.doi))}" target="_blank" rel="noopener noreferrer">打开论文原文 ↗</a></p>` : ''}
      ${paper.fileName ? `<p class="research-source">PDF：${escapeHTML(paper.fileName)}${paper.pdfId ? ' · <button class="research-open-pdf" data-action="open-pdf">打开原文</button>' : ''}</p>` : ''}
      <div class="research-connections"><strong>已确认关系 · ${linked.length}</strong>${linked.map((link) => { const other = nodeById(link.from === node.id ? link.to : link.from); return `<p>${escapeHTML(other?.title || '')}${link.reason ? ` · ${escapeHTML(link.reason)}` : ''}</p>`; }).join('') || '<p>尚无关系线。可在编辑模式连接文献节点。</p>'}</div>
      <div class="inspector-actions">${collection === 'demo' ? `<a class="primary-button" href="${escapeHTML(safeSourceUrl(paper.doi))}" target="_blank" rel="noopener noreferrer">阅读原论文 ↗</a>` : '<button class="primary-button" data-action="edit-paper">编辑文献信息</button><button class="quiet-button" data-action="open-detail">阅读笔记 →</button>'}</div>`;
    return;
  }
  document.querySelector('#inspectorKind').textContent = typeName(node.type);
  document.querySelector('#inspectorDate').textContent = formatDate(node.date, true);
  document.querySelector('#inspectorTitle').textContent = node.title;
  document.querySelector('#inspectorIcon').innerHTML = nodeTypeIcon(node.type);
  document.querySelector('#inspectorIcon').style.color = uiNodeColor(node.color);
  const entry = node.entries?.[0];
  const text = entry?.blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n\n');
  document.querySelector('#inspectorText').textContent = text || (entry ? '' : '还没有记忆。写下一句话，或放入照片、视频。');
  document.querySelector('#inspectorText').hidden = Boolean(entry && !text);
  document.querySelector('#inspectorMemoryLabel').textContent = entry ? `记忆片段 · 共 ${node.entries.length} 条` : '';
  document.querySelector('.inspector-memory-heading').hidden = !entry;
  const edit = document.querySelector('[data-action="edit-preview"]');
  edit.hidden = !entry;
  document.querySelector('[data-action="add-memory"]').textContent = state.drafts[node.id] ? '继续草稿' : '＋ 添加记忆';
  edit.dataset.entryId = entry?.id || '';
  document.querySelector('#inspectorStatus').textContent = node.type === 'goal' ? node.status || '进行中' : '';
  const mediaIds = new Set(entry?.blocks.flatMap((block) => block.mediaIds || []) || []);
  document.querySelector('#inspectorMedia').innerHTML = node.media.filter((item) => mediaIds.has(item.id)).slice(0, 3).map((item) => {
    const media = assetView(item);
    return media.thumbnail ? `<button class="inspector-thumb" data-action="open-detail" aria-label="查看${item.kind === 'video' ? '视频' : '照片'}"><img src="${escapeHTML(media.thumbnail)}" alt=""/>${item.kind === 'video' ? '<span>▶</span>' : ''}</button>` : '';
  }).join('');
}

let researchLibraryOpen = false;
let editingPaperId = null;
let pendingPdfExtraction = Promise.resolve();
let qaOpen = window.innerWidth > 1050;
const qaHistory = [];
let powerContextStatus = powerContextAvailable() ? '正在检查本机服务…' : '';
async function refreshPowerContextStatus() {
  if (!powerContextAvailable()) return;
  try {
    const health = await powerContextHealth();
    powerContextStatus = health.connected ? `已连接 · Scope ${health.scopeId}` : `未连接：${health.error || '请先启动 PowerContext'}`;
  } catch (error) { powerContextStatus = `未连接：${error.message}`; }
  renderResearchLibrary();
}
function switchCollection(next) {
  if (!researchMode || collection === next) return;
  if (collection === 'personal') personalState = state;
  collection = next;
  state = next === 'demo' ? createCvDemoGraph() : personalState;
  prepareGraph(state);
  state.mode = 'preview';
  state.scale = 'year';
  state.selectedId = null;
  state.selectedLinkId = null;
  currentView = 'global';
  researchLibraryOpen = next === 'personal' && state.nodes.length === 0;
  qaHistory.length = 0;
  undoStack.length = 0; redoStack.length = 0;
  cameraTransition.finish();
  setCameraPose(globalCameraPosition(), globalCameraTarget());
  projectionDirty = true;
  render();
}

function renderQa() {
  if (!researchMode) return;
  const panel = document.querySelector('#literatureQa');
  panel.classList.toggle('qa-open', qaOpen);
  document.querySelector('#qaContext').innerHTML = `<span>${collection === 'demo' ? 'CV 示例库' : '我的文献库'}</span><strong>${state.nodes.length} 篇论文 · ${state.links.length} 条关系</strong>`;
  document.querySelector('#qaMode').textContent = import.meta.env.VITE_LITERATURE_ASK_ENDPOINT
    ? '已配置 AI 服务地址；请求失败时使用本地文献检索。'
    : powerContextAvailable() ? '优先使用 PowerContext 检索已同步文献；未命中时使用本地检索。无需模型 API。'
      : '当前为本地文献检索与摘要组合；尚未连接生成式 AI 服务。';
  document.querySelector('#qaSuggestions').innerHTML = qaHistory.length ? '' : (collection === 'demo'
    ? ['CV 经典论文的发展脉络是什么？', 'Faster R-CNN 与 Mask R-CNN 有什么关系？', 'ResNet 和 ViT 有什么区别？']
    : ['这批文献主要研究什么？', '有哪些目标检测相关论文？']).map((question) => `<button type="button" data-qa-prompt="${escapeHTML(question)}">${escapeHTML(question)}</button>`).join('');
  document.querySelector('#qaMessages').innerHTML = qaHistory.length ? qaHistory.map((item) => item.role === 'user'
    ? `<div class="qa-message user">${escapeHTML(item.text)}</div>`
    : `<div class="qa-message answer"><span class="qa-answer-label">${item.model ? 'AI 综合回答' : item.context ? 'PowerContext 检索回答' : '库内检索回答'}</span><p>${escapeHTML(item.text)}</p>${item.sources?.length ? `<div class="qa-sources"><strong>依据 · ${item.sources.length}</strong>${item.sources.map((source, index) => `<button data-qa-source="${escapeHTML(source.id)}"><span>${index + 1}</span>${escapeHTML(source.title)} <small>${escapeHTML(String(source.year || ''))}</small>${source.citation ? `<cite class="qa-citation">${escapeHTML(source.citation)}</cite>` : ''}</button>`).join('')}</div>` : ''}</div>`).join('')
    : '<div class="qa-empty"><span>✦</span><strong>从问题进入脉络</strong><p>点击下方示例问题，或针对当前库中的论文自由提问。</p></div>';
  const messages = document.querySelector('#qaMessages');
  messages.scrollTop = messages.scrollHeight;
}

async function submitQa(question) {
  const trimmed = question.trim();
  if (!trimmed) return;
  qaHistory.push({ role: 'user', text: trimmed });
  const form = document.querySelector('#qaForm');
  const button = form.querySelector('button');
  button.disabled = true; button.textContent = '检索中…';
  renderQa();
  try { qaHistory.push({ role: 'answer', ...await askLiterature(state.nodes, state.links, trimmed) }); }
  catch { qaHistory.push({ role: 'answer', text: '回答暂时失败，请重试。', sources: [] }); }
  button.disabled = false; button.textContent = '发送 ↗';
  renderQa();
}
function renderResearchLibrary() {
  if (!researchMode) return;
  const panel = document.querySelector('#researchLibrary');
  panel.hidden = !researchLibraryOpen;
  document.querySelector('#researchCount').textContent = String(state.nodes.length);
  if (!researchLibraryOpen) return;
  const suggestions = collection === 'demo' ? [] : relationCandidates(state.nodes, state.links, state.dismissedRelations);
  const papers = [...state.nodes].sort((a, b) => Number(b.paper?.year || 0) - Number(a.paper?.year || 0));
  panel.innerHTML = `<div class="research-library-head"><div><small>LITERATURE AXIS</small><h2>${collection === 'demo' ? 'CV 示例文献' : '我的文献'} <span>${state.nodes.length}</span></h2></div><button data-research-close aria-label="收起文献库">×</button></div>
    <div class="research-collection-switch"><button data-action="show-demo" class="${collection === 'demo' ? 'selected' : ''}">CV 示例</button><button data-action="show-personal" class="${collection === 'personal' ? 'selected' : ''}">我的文献</button></div>
    <p class="research-library-intro">原 GlimmerAxis 三维时间轴：点是文献，边是经你确认的关联。</p>
    <button class="research-add-button" data-action="add-node">＋ ${collection === 'demo' ? '添加到我的文献库' : '添加文献'}</button>
    ${powerContextAvailable() ? `<div class="research-library-section"><h3>PowerContext 文献检索</h3><p class="research-method">${escapeHTML(powerContextStatus)}。同步后，问答会优先检索持久化的文献信息；无需模型 API。</p><button class="research-add-button" data-context-sync ${state.nodes.length ? '' : 'disabled'}>同步当前 ${state.nodes.length} 篇文献</button></div>` : ''}
    <div class="research-library-section"><h3>文献节点</h3>${papers.length ? papers.map((node) => `<button class="research-paper-row ${node.id === state.selectedId ? 'selected' : ''}" data-research-select="${escapeHTML(node.id)}"><span class="research-paper-dot"></span><span><strong>${escapeHTML(node.title)}</strong><small>${escapeHTML(String(node.paper?.year || node.date.slice(0, 4)))} · ${escapeHTML(node.paper?.authors || '作者待补充')}</small></span></button>`).join('') : '<p class="research-empty">从第一篇文献开始，3D 轴会随发表年份生长。</p>'}</div>
    ${collection === 'demo' ? '<p class="research-method">示例关系由人工核对论文后编排；点击节点可查看原文与关联说明。</p>' : `<div class="research-library-section"><h3>待确认的关系 <span>${suggestions.length}</span></h3><p class="research-method">目前按共同主题标签生成候选，需人工确认。</p>${suggestions.slice(0, 8).map((candidate) => `<div class="research-suggestion"><strong>${escapeHTML(candidate.a.title)}</strong><span>↔</span><strong>${escapeHTML(candidate.b.title)}</strong><small>共同主题：${escapeHTML(candidate.shared.join('、'))}</small><div><button data-research-accept="${escapeHTML(candidate.key)}">确认连线</button><button data-research-dismiss="${escapeHTML(candidate.key)}">忽略</button></div></div>`).join('') || '<p class="research-empty">给两篇文献添加相同主题标签，可得到关系候选；也可以在编辑模式手动连线。</p>'}</div>`}`;
}

function render() {
  document.querySelectorAll('.mode-btn').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.mode));
  document.querySelectorAll('.scale-switch button').forEach((button) => button.classList.toggle('active', button.dataset.scale === state.scale));
  document.querySelector('.rotation-button').classList.toggle('is-on', state.autoRotate);
  document.querySelector('#mobileRotationButton').textContent = state.autoRotate ? '关闭自动旋转' : '开启自动旋转';
  document.querySelector('#mobileRotationButton').disabled = state.mode !== 'preview' || currentView === 'plane';
  const editing = state.mode === 'edit';
  const editorToolbar = document.querySelector('#editorToolbar');
  editorToolbar.hidden = !editing || document.body.classList.contains('toolbar-collapsed');
  document.querySelector('.toolbar-expand').hidden = !editing || !document.body.classList.contains('toolbar-collapsed');
  document.querySelector('#relationToolkit').hidden = !editing || openToolkit !== 'relation' || document.body.classList.contains('toolbar-collapsed');
  document.querySelectorAll('.editor-toolbar [data-tool]').forEach((button) => {
    const active = button.dataset.tool === state.tool;
    button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active));
  });
  const relationTool = document.querySelector('[data-action="open-relation-toolkit"]');
  const relating = state.tool === 'branch' || state.tool === 'progress';
  relationTool.classList.toggle('selected', relating);
  relationTool.setAttribute('aria-pressed', String(relating));
  relationTool.setAttribute('aria-expanded', String(openToolkit === 'relation'));
  document.querySelectorAll('[data-relation-kind]').forEach((button) => button.classList.toggle('selected', button.dataset.relationKind === state.tool));
  const deleteButton = document.querySelector('[data-action="delete-selection"]');
  deleteButton.disabled = !selectedNode() && !state.links.some((link) => link.id === state.selectedLinkId);
  deleteButton.title = state.selectedLinkId ? '删除选中的关系线（Delete）' : '删除选中的节点及其关系（Delete）';
  document.querySelector('.editor-toolbar [data-action="open-detail"]').disabled = !selectedNode();
  document.querySelector('#editorDateChip').hidden = !editing || currentView !== 'plane';
  document.querySelector('#editorDateChip').textContent = formatDate(state.editorDate, true);
  document.querySelector('#planeBack').hidden = currentView !== 'plane';
  renderGlobalOverview();
  if (connectFrom) {
    document.querySelector('#modeToast').classList.add('visible');
    document.querySelector('#modeToast').textContent = `在主图或全局图点击另一节点，创建${state.tool === 'progress' ? '递进关系' : '关系线'} · Esc 取消`;
  } else if (state.mode !== 'edit') {
    document.querySelector('#modeToast').classList.remove('visible');
    document.querySelector('#modeToast').textContent = '';
  }
  document.querySelector('.new-node-fab').hidden = editing;
  document.querySelector('.rotation-button').hidden = editing || currentView === 'plane';
  renderTimeline();
  renderInspector();
  renderResearchLibrary();
  if (researchMode) {
    document.querySelector('#demoRibbon').hidden = collection !== 'demo';
    renderQa();
  }
  updateUndoButtons();
}

function showToast(message) {
  const el = document.querySelector('#modeToast');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (!connectFrom) el.classList.remove('visible'); }, 2200);
}

function selectNode(id) {
  state.selectedId = id;
  state.selectedLinkId = null;
  const node = nodeById(id);
  if (node && state.mode === 'edit') state.editorDate = node.date;
  if (currentView === 'plane') planeAxisHighlightUntil = performance.now() + 900;
  render();
  persist();
}

function selectEdge(id) {
  state.selectedLinkId = state.links.some((link) => link.id === id) ? id : null;
  state.selectedId = null;
  connectFrom = null;
  lastNodeClick = null;
  render();
}

function setEditorTool(tool) {
  state.tool = tool;
  state.selectedId = null; state.selectedLinkId = null;
  connectFrom = null; openToolkit = null; lastNodeClick = null;
  if (tool === 'branch' || tool === 'progress') lastRelationTool = tool;
}

function deleteSelected() {
  if (nodeEditor.pending && nodeEditor.nodeId === state.selectedId) { showToast('媒体正在导入，请稍候再删除节点'); return; }
  const result = deleteGraphSelection(state.nodes, state.links, state.selectedId, state.selectedLinkId);
  if (!result) return;
  snapshot();
  if (result.deleted === 'node') {
    const node = selectedNode();
    state.trash.push({ id: crypto.randomUUID(), kind: 'node', nodeId: node.id, value: structuredClone(node),
      links: structuredClone(state.links.filter((link) => link.from === node.id || link.to === node.id)),
      draft: state.drafts[node.id], deletedAt: new Date().toISOString() });
    delete state.drafts[node.id];
  }
  state.nodes = result.nodes; state.links = result.links;
  state.selectedId = null; state.selectedLinkId = null; connectFrom = null;
  if (document.querySelector('#detailDialog').open) document.querySelector('#detailDialog').close();
  persist(); render();
  showToast(result.deleted === 'edge' ? '关系线已删除 · 可撤销' : '节点及其关联关系已移入回收站');
}

function enterEditor(date = selectedNode()?.date || today) {
  state.mode = 'edit';
  state.editorDate = date;
  state.autoRotate = false;
  state.selectedId = null;
  state.selectedLinkId = null;
  state.tool = 'select';
  currentView = 'global';
  renderGlobalOverview();
  animateCameraTo(globalCameraPosition(), globalCameraTarget());
  connectFrom = null;
  document.body.classList.remove('toolbar-collapsed');
  render();
  persist();
}

function openDetail() {
  if (!selectedNode()) return;
  nodeEditor.open(selectedNode());
}

function updateEditorDateFromDateInput(event) {
  state.editorDate = event.target.value || today;
  render();
}

function startCreate(type = 'memory') {
  if (researchMode && collection === 'demo') switchCollection('personal');
  openToolkit = null; connectFrom = null;
  render();
  if (researchMode) {
    editingPaperId = null;
    pendingPdfExtraction = Promise.resolve();
    document.querySelector('#createForm').reset();
    document.querySelector('#createForm h2').textContent = '添加文献';
    document.querySelector('#createForm [name="next"]').textContent = '加入文献脉络';
    document.querySelector('#createForm [name="year"]').value = String(new Date().getFullYear());
    document.querySelector('#pdfStatus').textContent = '支持可复制文字的 PDF。识别结果可在下方核对。';
  } else document.querySelector('#createDate').textContent = formatDate(today, true);
  document.querySelector('#nodeTitle').value = '';
  document.querySelectorAll('#createForm [name="type"]').forEach((input) => { input.checked = input.value === type; });
  document.querySelector('#createDialog').showModal();
  setTimeout(() => document.querySelector('#nodeTitle').focus(), 30);
}

function editPaper() {
  const node = selectedNode();
  if (!researchMode || !node) return;
  editingPaperId = node.id;
  const form = document.querySelector('#createForm');
  form.reset();
  form.querySelector('h2').textContent = '编辑文献';
  document.querySelector('#pdfStatus').textContent = node.paper?.fileName ? `已保存：${node.paper.fileName}。选择新 PDF 可重新提取。` : '选择 PDF 可自动提取信息。';
  form.elements.title.value = node.title;
  form.elements.authors.value = node.paper?.authors || '';
  form.elements.year.value = String(node.paper?.year || node.date.slice(0, 4));
  form.elements.doi.value = node.paper?.doi || '';
  form.elements.tags.value = (node.paper?.tags || []).join('，');
  form.elements.abstract.value = node.paper?.abstract || '';
  form.querySelector('[name="next"]').textContent = '保存文献';
  document.querySelector('#createDialog').showModal();
}

async function savePaper(form) {
  await pendingPdfExtraction;
  const data = new FormData(form);
  const title = String(data.get('title') || '').trim();
  if (!title) return;
  const year = Number(data.get('year'));
  if (!Number.isInteger(year) || year < 1000 || year > 2100) return;
  const existing = editingPaperId ? nodeById(editingPaperId) : null;
  const file = data.get('file');
  const pdfId = file instanceof File && file.size ? `pdf-${crypto.randomUUID()}` : existing?.paper?.pdfId || '';
  if (file instanceof File && file.size) {
    const { savePdf } = await import('./pdf-store.js');
    await savePdf(pdfId, file);
  }
  const paper = {
    authors: String(data.get('authors') || '').trim(), year,
    doi: String(data.get('doi') || '').trim(),
    tags: [...new Set(String(data.get('tags') || '').split(/[,，;；]/).map((tag) => tag.trim()).filter(Boolean))],
    abstract: String(data.get('abstract') || '').trim(),
    fileName: file?.name || existing?.paper?.fileName || '',
    pdfId,
  };
  let classification = null;
  if (import.meta.env.VITE_LITERATURE_CLASSIFY_ENDPOINT) {
    const status = document.querySelector('#pdfStatus');
    status.textContent = '正在由 AI 判定节点类型和核心关键词…';
    try {
      const response = await fetch(import.meta.env.VITE_LITERATURE_CLASSIFY_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, year, abstract: paper.abstract, tags: paper.tags }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      classification = await response.json();
      if (!['memory', 'milestone'].includes(classification.type)) throw new Error('分类结果无效');
    } catch {
      status.textContent = 'AI 分类暂不可用；文献将作为普通节点加入，之后仍可编辑。';
    }
  }
  paper.topKeyword = String(classification?.topKeyword || existing?.paper?.topKeyword || '').trim().slice(0, 40);
  snapshot();
  if (existing) {
    existing.title = title;
    existing.date = `${year}-01-01`;
    if (classification) existing.type = classification.type;
    existing.paper = paper;
    existing.text = paper.abstract;
  } else {
    const node = paperToNode({ id: `paper-${crypto.randomUUID()}`, title, type: classification?.type, ...paper }, state.nodes.length);
    state.nodes.push(node);
    state.selectedId = node.id;
  }
  state.selectedLinkId = null;
  editingPaperId = null;
  researchLibraryOpen = false;
  document.querySelector('#createDialog').close();
  if (currentView === 'global') {
    if (researchMode) { cameraTransition.finish(); setCameraPose(globalCameraPosition(), globalCameraTarget()); projectionDirty = true; }
    else animateCameraTo(globalCameraPosition(), globalCameraTarget());
  }
  persist(); render();
  const candidateCount = relationCandidates(state.nodes, state.links, state.dismissedRelations).length;
  showToast(`${existing ? '文献信息已更新' : '文献已加入三维时间轴'}${classification ? ` · AI 判定为${classification.type === 'milestone' ? '里程碑' : '普通'}节点` : ''}${candidateCount ? ` · ${candidateCount} 条待审关系在文献库` : ''}`);
  if (powerContextAvailable()) {
    const savedNode = existing || selectedNode();
    syncPowerContext([savedNode]).then((result) => {
      powerContextStatus = `已同步 ${result.synced} 篇，已存在 ${result.skipped} 篇`;
      renderResearchLibrary();
    }).catch((error) => {
      powerContextStatus = `本地已保存，PowerContext 同步失败：${error.message}`;
      renderResearchLibrary();
    });
  }
}

function createNode(title, type) {
  const date = today;
  snapshot();
  const id = `node-${crypto.randomUUID()}`;
  const sameDay = state.nodes.filter((node) => node.date === date).length;
  const side = sameDay % 2 ? 1 : -1;
  state.nodes.push(normalizeNode({ id, date, title, type, createdAt: new Date().toISOString(), x: side * (0.85 + Math.random() * 0.25), z: (Math.random() - 0.5) * 1.1, text: '', media: [], status: type === 'goal' ? '进行中' : undefined }));
  state.tool = 'select'; state.selectedLinkId = null; connectFrom = null;
  state.editorDate = today;
  state.selectedId = id;
  persist();
  render();
  if (state.mode === 'preview') {
    const inspector = document.querySelector('#inspector');
    inspector.hidden = true;
    enterEditor(date);
    selectNode(id);
  }
}

function addConnection(toId) {
  state.selectedLinkId = null;
  if (!connectFrom) {
    connectFrom = toId;
    state.selectedId = toId;
    render();
    return;
  }
  if (connectFrom === toId) { connectFrom = null; showToast('已取消关系连接'); render(); return; }
  const exists = state.links.some((link) => link.from === connectFrom && link.to === toId && link.kind === state.tool);
  state.selectedId = toId;
  if (!exists) {
    snapshot();
    state.links.push({ id: crypto.randomUUID(), from: connectFrom, to: toId, kind: state.tool });
    persist();
    showToast(state.tool === 'progress' ? '递进箭头已连接' : '关系线已连接');
  } else showToast('这两个节点已存在该关系');
  connectFrom = null;
  render();
}

function setRayFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointerNdc, camera);
}

function projectEdge(visual) {
  const fromMesh = nodeMeshes.get(visual.from), toMesh = nodeMeshes.get(visual.to);
  if (!fromMesh || !toMesh) return null;
  const from = fromMesh.getWorldPosition(new THREE.Vector3()).project(camera);
  const to = toMesh.getWorldPosition(new THREE.Vector3()).project(camera);
  if (from.z < -1 || from.z > 1 || to.z < -1 || to.z > 1) return null;
  return {
    id: visual.id,
    from: { x: (from.x * .5 + .5) * viewport.width, y: (-from.y * .5 + .5) * viewport.height },
    to: { x: (to.x * .5 + .5) * viewport.width, y: (-to.y * .5 + .5) * viewport.height },
  };
}

function edgeIdFromEvent(event) {
  camera.updateMatrixWorld(); timelineGroup.updateMatrixWorld(true);
  const rect = canvas.getBoundingClientRect();
  const arrows = linkVisuals.filter((visual) => visual.arrow?.visible).map((visual) => {
    const p = visual.arrow.getWorldPosition(new THREE.Vector3()).project(camera);
    return { id: visual.id, x: (p.x * .5 + .5) * viewport.width, y: (-p.y * .5 + .5) * viewport.height, depth: p.z };
  }).filter((point) => point.depth >= -1 && point.depth <= 1);
  const arrow = findNearestNode(arrows, event.clientX - rect.left, event.clientY - rect.top, event.pointerType === 'touch' ? 14 : 10);
  if (arrow) return arrow;
  const edges = linkVisuals.map(projectEdge).filter(Boolean);
  return findNearestEdge(edges, event.clientX - rect.left, event.clientY - rect.top, event.pointerType === 'touch' ? 14 : 8);
}

function nodeIdFromEvent(event) {
  const label = event.target.closest('.event-group, .scene-node-icon');
  if (label) return label.dataset.nodeId;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  camera.updateMatrixWorld(); timelineGroup.updateMatrixWorld(true);
  const points = [];
  const position = new THREE.Vector3();
  for (const [id, mesh] of nodeMeshes) {
    mesh.getWorldPosition(position).project(camera);
    if (position.z < -1 || position.z > 1) continue;
    points.push({ id, x: (position.x * .5 + .5) * rect.width, y: (-position.y * .5 + .5) * rect.height, depth: position.z });
  }
  return findNearestNode(points, event.clientX - rect.left, event.clientY - rect.top, event.pointerType === 'touch' ? 32 : 24);
}

const stageControlSelector = '.global-overview, .editor-toolbar, .toolkit-popover, .plane-controls, .toolbar-expand, .new-node-fab, .demo-ribbon';

let nodeHoldTimer = null;
function clearNodeHold() { clearTimeout(nodeHoldTimer); nodeHoldTimer = null; }

function stopInertia() {
  if (!inertia) return;
  inertia = null; state.manualUntil = performance.now() + 5000; persist();
}

// A new touch takes priority over motion, including controls outside the canvas.
document.addEventListener('pointerdown', stopInertia, { capture: true });

stage.addEventListener('pointerdown', (event) => {
  clearNodeHold();
  if (event.target.closest(stageControlSelector)) return;
  if (event.button !== undefined && event.button !== 0) return;
  if (event.pointerType === 'touch') {
    touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPointers.size >= 2) {
      cameraTransition.finish();
      const [a, b] = [...touchPointers.values()];
      pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cameraDistance: camera.position.distanceTo(cameraTarget) };
      drag = null; lastNodeClick = null; state.manualUntil = performance.now() + 5000;
      stage.setPointerCapture(event.pointerId); event.preventDefault(); return;
    }
  }
  const nodeId = nodeIdFromEvent(event);
  // Hit testing selects on tap; it must never block a navigation gesture.
  const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const sensitivity = navigationSensitivity(viewport.width, viewport.height, camera.position.distanceTo(cameraTarget), camera.fov, Math.abs(screenUp.y));
  const pos = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, time: performance.now(), sensitivity, velocity: null };
  if (currentView === 'plane' && state.mode === 'edit' && nodeId && state.tool === 'select' && event.pointerType !== 'touch') {
    const node = nodeById(nodeId), mesh = nodeMeshes.get(nodeId); if (!node || !mesh) return;
    setRayFromPointer(event);
    const hit = raycaster.intersectObject(planeHitMesh, false)[0];
    const local = hit ? timelineGroup.worldToLocal(hit.point.clone()) : mesh.position;
    drag = { kind: 'node', id: node.id, ...pos, moved: false, offsetX: mesh.position.x - local.x, offsetZ: mesh.position.z - local.z, snapshotTaken: false }; event.preventDefault();
  } else if (state.mode === 'preview') {
    drag = { kind: 'orbit', ...pos, moved: false };
  } else if (state.mode === 'edit' && currentView === 'global') {
    drag = { kind: 'orbit', ...pos, moved: false };
  } else if (state.mode === 'edit' && currentView === 'plane') {
    drag = { kind: 'plane-rotate', ...pos, moved: false };
  }
  if (drag && drag.kind !== 'node') {
    state.manualUntil = performance.now() + 5000;
  }
  if (event.pointerType === 'touch' && nodeId && currentView === 'plane' && state.mode === 'edit' && state.tool === 'select') {
    const pending = drag;
    nodeHoldTimer = setTimeout(() => {
      if (drag !== pending || !drag || drag.moved || touchPointers.size !== 1) return;
      const mesh = nodeMeshes.get(nodeId); if (!mesh) return;
      cameraTransition.finish();
      setRayFromPointer(event);
      const hit = raycaster.intersectObject(planeHitMesh, false)[0];
      const local = hit ? timelineGroup.worldToLocal(hit.point.clone()) : mesh.position;
      Object.assign(drag, { kind: 'node', id: nodeId, held: true, offsetX: mesh.position.x - local.x, offsetZ: mesh.position.z - local.z, snapshotTaken: false });
      stage.setPointerCapture(event.pointerId);
      state.selectedId = nodeId; state.selectedLinkId = null; lastNodeClick = null;
      render(); showToast('拖动调整节点位置');
    }, 360);
  }
});

// Prevent native image/button drag from stealing the scene gesture.
stage.addEventListener('dragstart', (event) => event.preventDefault());
stage.addEventListener('contextmenu', (event) => { if (!event.target.closest(stageControlSelector)) event.preventDefault(); });

window.addEventListener('pointermove', (event) => {
  if (touchPointers.has(event.pointerId)) touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && touchPointers.size >= 2) {
    const [a, b] = [...touchPointers.values()];
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    setZoomDistance(pinch.cameraDistance * pinch.distance / distance);
    state.manualUntil = performance.now() + 5000;
    return;
  }
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) >= (event.pointerType === 'touch' ? 8 : 4)) {
    clearNodeHold();
    const settling = cameraTransition.active;
    cameraTransition.finish();
    if (settling && drag.kind === 'node') {
      setRayFromPointer(event);
      const hit = raycaster.intersectObject(planeHitMesh, false)[0], mesh = nodeMeshes.get(drag.id);
      if (hit && mesh) {
        const local = timelineGroup.worldToLocal(hit.point.clone());
        drag.offsetX = mesh.position.x - local.x; drag.offsetZ = mesh.position.z - local.z;
      }
    }
    drag.moved = true; lastNodeClick = null;
    stage.setPointerCapture(event.pointerId);
    if (drag.kind === 'node' && state.selectedId !== drag.id) { state.selectedId = drag.id; state.selectedLinkId = null; render(); }
  }
  if (!drag.moved) return;
  event.preventDefault();
  if (drag.kind === 'orbit' || drag.kind === 'plane-rotate') {
    const now = performance.now();
    const rotation = dx * drag.sensitivity.rotation;
    const pan = drag.kind === 'orbit' ? dy * drag.sensitivity.pan : 0;
    timelineGroup.rotation.y += rotation;
    drag.velocity = sampleVelocity(drag.velocity, rotation, pan, now - drag.time);
    drag.time = now;
    if (drag.kind === 'orbit') {
      cameraTarget.y += pan;
      camera.position.y += pan;
      state.manualUntil = performance.now() + 5000;
    }
    projectionDirty = true;
  } else if (drag.kind === 'node') {
    setRayFromPointer(event);
    const hit = raycaster.intersectObject(planeHitMesh, false)[0];
    const node = nodeById(drag.id);
    if (hit && node) {
      if (!drag.snapshotTaken) { snapshot(); drag.snapshotTaken = true; }
      const local = timelineGroup.worldToLocal(hit.point.clone());
      const nodeSpread = currentView !== 'plane' && state.scale === 'day' ? NODE_SPREAD * 1.2 : NODE_SPREAD;
      node.x = Math.max(-2.05, Math.min(2.05, (local.x + drag.offsetX) / nodeSpread)); node.z = Math.max(-2.05, Math.min(2.05, (local.z + drag.offsetZ) / nodeSpread));
      const mesh = nodeMeshes.get(node.id);
      if (mesh) {
        mesh.position.x = node.x * nodeSpread; mesh.position.z = node.z * nodeSpread;
        nodeGlowMeshes.get(node.id)?.position.copy(mesh.position);
        updateLinkPositions(node.id); overviewDirty = true;
      }
      projectionDirty = true;
    }
  }
  drag.x = event.clientX; drag.y = event.clientY;
});

window.addEventListener('pointerup', (event) => {
  clearNodeHold();
  touchPointers.delete(event.pointerId);
  if (pinch) {
    if (touchPointers.size < 2) { pinch = null; state.manualUntil = performance.now() + 5000; persist(); }
    state.suppressClickUntil = performance.now() + 350;
    return;
  }
  if (!drag || event.pointerId !== drag.pointerId) return;
  const released = drag;
  const wasDrag = drag.moved, kind = drag.kind; drag = null;
  if (wasDrag || released.held) state.suppressClickUntil = performance.now() + 350;
  if (wasDrag && kind === 'node') { persist(); showToast('节点位置已调整'); }
  if (wasDrag && (kind === 'orbit' || kind === 'plane-rotate')) {
    const now = performance.now();
    const velocity = releaseVelocity(released.velocity, now - released.time);
    if (advanceInertia(velocity, 0).active) inertia = { kind, velocity, time: now };
    state.manualUntil = now + 5000;
    projectionDirty = true; persist();
  }
});

window.addEventListener('pointercancel', (event) => {
  clearNodeHold();
  touchPointers.delete(event.pointerId); pinch = null;
  if (drag?.moved) persist();
  drag = null; state.suppressClickUntil = performance.now() + 350;
  stopInertia();
  state.manualUntil = performance.now() + 5000;
});

stage.addEventListener('click', (event) => {
  if (event.target.closest(stageControlSelector)) return;
  if (performance.now() < (state.suppressClickUntil || 0)) return;
  const id = nodeIdFromEvent(event);
  if (!id && state.mode === 'edit' && state.tool === 'select') {
    const edgeId = edgeIdFromEvent(event);
    if (edgeId) { selectEdge(edgeId); return; }
  }
  if (id) {
    const now = performance.now();
    if (state.mode === 'edit' && (state.tool === 'branch' || state.tool === 'progress')) {
      lastNodeClick = null;
      addConnection(id);
      return;
    }
    if (lastNodeClick?.id === id && now - lastNodeClick.time < 450) {
      lastNodeClick = null;
      enterPlane(nodeById(id));
      return;
    }
    lastNodeClick = { id, time: now };
    selectNode(id);
  } else if (state.mode === 'edit' && state.tool === 'select') {
    state.selectedId = null; state.selectedLinkId = null; lastNodeClick = null; render();
  }
});

function setZoomDistance(requestedDistance) {
  cameraTransition.finish();
  const viewOffset = camera.position.clone().sub(cameraTarget);
  const minDistance = currentView === 'plane' ? 5.5 : 4.5;
  const maxDistance = currentView === 'plane' ? 52 : 130;
  const distance = THREE.MathUtils.clamp(requestedDistance, minDistance, maxDistance);
  viewOffset.setLength(distance);
  if (currentView === 'global') cameraTarget.x = globalAxisOffset(distance);
  camera.position.copy(cameraTarget).add(viewOffset);
  cameraOrbitDistance = distance;
  camera.lookAt(cameraTarget);
  projectionDirty = true;
}

stage.addEventListener('wheel', (event) => {
  if (event.target.closest(stageControlSelector)) return;
  stopInertia();
  event.preventDefault();
  const delta = THREE.MathUtils.clamp(event.deltaY, -180, 180);
  setZoomDistance(camera.position.distanceTo(cameraTarget) * Math.exp(delta * .0012));
  persist();
}, { passive: false });

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-action], [data-mode], [data-scale]')) stopInertia();
  if (event.target.closest('.memory-reader, .memory-settings, .entry-composer, .media-viewer, .memory-trash')) return;
  if (!event.target.closest('#mobileActionMenu, .mobile-menu')) {
    document.querySelector('#mobileActionMenu').hidden = true;
    document.querySelector('.mobile-menu').setAttribute('aria-expanded', 'false');
  }
  const overviewEdge = event.target.closest('[data-overview-edge]');
  if (overviewEdge) { selectEdge(overviewEdge.dataset.overviewEdge); return; }
  const overviewNode = event.target.closest('[data-overview-node]');
  if (overviewNode) { activateOverviewNode(overviewNode.dataset.overviewNode); return; }
  const relationKind = event.target.closest('[data-relation-kind]');
  if (relationKind) {
    setEditorTool(relationKind.dataset.relationKind);
    showToast(state.tool === 'progress' ? '依次点击两个节点，创建递进箭头' : '依次点击两个节点，创建关系线');
    render();
    return;
  }
  if (openToolkit && !event.target.closest('#relationToolkit, .editor-toolbar')) {
    openToolkit = null;
    render();
  }
  const modeButton = event.target.closest('[data-mode]');
  if (modeButton) {
    if (researchMode && collection === 'demo' && modeButton.dataset.mode === 'edit') switchCollection('personal');
    if (state.mode === modeButton.dataset.mode) return;
    stopInertia(); clearNodeHold(); drag = null; pinch = null; touchPointers.clear();
    if (modeButton.dataset.mode === 'edit') enterEditor();
    else {
      state.mode = 'preview'; connectFrom = null; state.selectedId = null; state.selectedLinkId = null;
      state.tool = 'select'; openToolkit = null;
      currentView = 'global';
      renderGlobalOverview();
      animateCameraTo(globalCameraPosition(), globalCameraTarget());
      render(); persist();
    }
    return;
  }
  const scaleButton = event.target.closest('[data-scale]');
  if (scaleButton) { state.scale = scaleButton.dataset.scale; state.focusShift = 0; if (currentView === 'global') animateCameraTo(globalCameraPosition(), globalCameraTarget()); render(); persist(); return; }
  const toolButton = event.target.closest('[data-tool]');
  if (toolButton) {
    setEditorTool(toolButton.dataset.tool);
    showToast('点击节点或关系线选择，双击节点进入当天平面');
    render();
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'menu') {
    const menu = document.querySelector('#mobileActionMenu'); menu.hidden = !menu.hidden;
    document.querySelector('.mobile-menu').setAttribute('aria-expanded', String(!menu.hidden));
    return;
  }
  if (event.target.closest('#mobileActionMenu')) {
    document.querySelector('#mobileActionMenu').hidden = true;
    document.querySelector('.mobile-menu').setAttribute('aria-expanded', 'false');
  }
  if (action === 'open-relation-toolkit') {
    const opening = openToolkit !== 'relation';
    if (opening) { setEditorTool(lastRelationTool); openToolkit = 'relation'; }
    else openToolkit = null;
    render();
    return;
  }
  if (action === 'close-create') { document.querySelector('#createDialog').close(); return; }
  if (action === 'open-about' && researchMode) { document.querySelector('#projectAbout').showModal(); return; }
  if (action === 'close-about' && researchMode) { document.querySelector('#projectAbout').close(); return; }
  if (action === 'rotation') { state.autoRotate = !state.autoRotate; state.manualUntil = 0; render(); persist(); }
  if (action === 'today') {
    state.focusShift = 0;
    // Returning from a day plane must restore the global interaction state too;
    // camera-only navigation leaves the scene filtered to one day and disables orbit.
    if (currentView === 'plane') {
      currentView = 'global';
    }
    renderGlobalOverview();
    const position = globalCameraPosition(0);
    const target = new THREE.Vector3(globalAxisOffset(cameraOrbitDistance), 0, 0);
    animateCameraTo(position, target);
    render(); persist();
  }
  if (action === 'add-node') startCreate('memory');
  if (action === 'show-personal') switchCollection('personal');
  if (action === 'show-demo') switchCollection('demo');
  if (action === 'toggle-qa' && researchMode) { qaOpen = !qaOpen; renderQa(); }
  if (action === 'toggle-library' && researchMode) { researchLibraryOpen = !researchLibraryOpen; renderResearchLibrary(); }
  if (action === 'edit-paper' && researchMode && collection === 'personal') editPaper();
  if (action === 'open-pdf' && researchMode && selectedNode()?.paper?.pdfId) {
    const pdfId = selectedNode().paper.pdfId;
    const pdfWindow = window.open('', '_blank');
    import('./pdf-store.js').then(({ loadPdf }) => loadPdf(pdfId)).then((file) => {
      if (!file) throw new Error('本地 PDF 文件未找到');
      const url = URL.createObjectURL(file);
      if (pdfWindow) pdfWindow.location.href = url;
      else { const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name || '文献.pdf'; anchor.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }).catch((error) => { pdfWindow?.close(); showToast(error.message); });
  }
  if (action === 'edit-day') { const node = selectedNode(); enterEditor(node?.date || today); if (node) enterPlane(node); }
  if (action === 'exit-plane') exitPlane();
  if (action === 'open-detail') openDetail();
  if (['edit-preview', 'add-memory', 'node-settings'].includes(action) && selectedNode()) {
    nodeEditor.open(selectedNode(), { view: action === 'node-settings' ? 'settings' : 'composer', entryId: action === 'edit-preview' ? event.target.closest('[data-entry-id]').dataset.entryId : null });
  }
  if (action === 'close-inspector') { state.selectedId = null; render(); }
  if (action === 'collapse-toolbar') { openToolkit = null; document.body.classList.add('toolbar-collapsed'); render(); }
  if (action === 'expand-toolbar') { document.body.classList.remove('toolbar-collapsed'); render(); }
  if (action === 'delete-selection') deleteSelected();
  if (action === 'undo' && undoStack.length) {
    redoStack.push(captureSnapshot());
    restoreSnapshot(undoStack.pop());
  }
  if (action === 'redo' && redoStack.length) {
    undoStack.push(captureSnapshot());
    restoreSnapshot(redoStack.pop());
  }
  if (action === 'delete-node') deleteSelected();
});

document.querySelector('#createForm').addEventListener('submit', (event) => {
  if (!['create', 'write'].includes(event.submitter?.value)) return;
  event.preventDefault();
  if (researchMode) {
    savePaper(event.currentTarget).catch((error) => {
      document.querySelector('#pdfStatus').textContent = `保存失败：${error.message}`;
    });
    return;
  }
  const title = document.querySelector('#nodeTitle').value.trim();
  if (!title) return;
  const type = document.querySelector('#createForm [name="type"]:checked').value;
  document.querySelector('#createDialog').close();
  createNode(title, type);
  if (event.submitter.value === 'write') nodeEditor.open(selectedNode(), { view: 'composer' });
});

if (researchMode) {
  document.querySelector('#createForm [name="file"]').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = document.querySelector('#createForm');
    const status = document.querySelector('#pdfStatus');
    const submit = form.querySelector('[name="next"]');
    status.textContent = `正在解析 ${file.name}…`;
    submit.disabled = true;
    pendingPdfExtraction = import('./pdf-import.js').then(({ extractPdfMetadata }) => extractPdfMetadata(file)).then((extracted) => {
      if (form.elements.file.files?.[0] !== file) return;
      if (extracted.title) form.elements.title.value = extracted.title;
      if (extracted.authors) form.elements.authors.value = extracted.authors;
      if (extracted.year) form.elements.year.value = String(extracted.year);
      if (extracted.doi) form.elements.doi.value = extracted.doi;
      if (extracted.tags.length) form.elements.tags.value = extracted.tags.join('，');
      if (extracted.abstract) form.elements.abstract.value = extracted.abstract;
      status.textContent = extracted.hasText
        ? `已读取 ${extracted.pageCount} 页 PDF，自动提取了可识别的信息。请核对后加入。`
        : '这份 PDF 没有可复制的文字，已用文件名填写标题；请补充必要信息。';
    }).catch((error) => {
      status.textContent = `PDF 解析失败：${error.message}。仍可手动填写信息。`;
    }).finally(() => { submit.disabled = false; });
  });
}

document.querySelectorAll('#createDialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
}));

if (researchMode) {
  const library = document.querySelector('#researchLibrary');
  library.addEventListener('pointerdown', (event) => event.stopPropagation());
  library.addEventListener('wheel', (event) => event.stopPropagation());
  library.addEventListener('click', (event) => {
    if (event.target.closest('[data-research-close]')) { researchLibraryOpen = false; renderResearchLibrary(); return; }
    if (event.target.closest('[data-context-sync]')) {
      powerContextStatus = '正在同步当前文献库…'; renderResearchLibrary();
      syncPowerContext(state.nodes).then((result) => {
        powerContextStatus = `已同步 ${result.synced} 篇，已存在 ${result.skipped} 篇`;
        renderResearchLibrary();
      }).catch((error) => { powerContextStatus = `同步失败：${error.message}`; renderResearchLibrary(); });
      return;
    }
    const select = event.target.closest('[data-research-select]');
    if (select) { if (window.innerWidth < 760) researchLibraryOpen = false; selectNode(select.dataset.researchSelect); return; }
    const accept = event.target.closest('[data-research-accept]');
    const dismiss = event.target.closest('[data-research-dismiss]');
    if (!accept && !dismiss) return;
    const key = (accept || dismiss).dataset.researchAccept || (accept || dismiss).dataset.researchDismiss;
    const candidate = relationCandidates(state.nodes, state.links, state.dismissedRelations).find((item) => item.key === key);
    if (!candidate) return;
    snapshot();
    if (accept) state.links.push({ id: crypto.randomUUID(), from: candidate.a.id, to: candidate.b.id, kind: 'branch', reason: candidate.shared.join('、'), confirmedAt: new Date().toISOString() });
    else state.dismissedRelations.push(key);
    persist(); render();
  });
}

if (researchMode) {
  const qa = document.querySelector('#literatureQa');
  qa.addEventListener('pointerdown', (event) => event.stopPropagation());
  qa.addEventListener('wheel', (event) => event.stopPropagation());
  qa.addEventListener('click', (event) => {
    const prompt = event.target.closest('[data-qa-prompt]');
    if (prompt) { submitQa(prompt.dataset.qaPrompt); return; }
    const source = event.target.closest('[data-qa-source]');
    if (source) selectNode(source.dataset.qaSource);
  });
  document.querySelector('#qaForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector('#qaQuestion');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    submitQa(question);
  });
  document.querySelector('#qaQuestion').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); document.querySelector('#qaForm').requestSubmit(); }
  });
}

document.addEventListener('keydown', (event) => {
  if (event.target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
  const edge = event.target.closest('[data-overview-edge], [data-edge-id]');
  if (edge && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault(); selectEdge(edge.dataset.overviewEdge || edge.dataset.edgeId); return;
  }
  const overviewNode = event.target.closest('[data-overview-node]');
  if (overviewNode && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault(); activateOverviewNode(overviewNode.dataset.overviewNode); return;
  }
  if (event.key === 'Escape' && openToolkit) { openToolkit = null; render(); }
  if (event.key === 'Escape' && connectFrom) { connectFrom = null; showToast('已取消关系连接'); render(); }
  if ((event.key === 'Delete' || event.key === 'Backspace') && state.mode === 'edit') { event.preventDefault(); deleteSelected(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    const action = document.querySelector(event.shiftKey ? '[data-action="redo"]' : '[data-action="undo"]');
    action.click();
  }
});

window.addEventListener('resize', () => { sceneNeedsResize = true; });
new ResizeObserver(() => {
  if (viewport.width !== stage.clientWidth || viewport.height !== stage.clientHeight) sceneNeedsResize = true;
}).observe(stage);

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault(); contextLost = true; stopInertia();
  console.warn('GlimmerAxis: graphics context lost; vector scene remains available');
});
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false; paintedWidth = 0; paintedHeight = 0; projectionDirty = true;
});

function animate(now) {
  animationFrame = null;
  if (document.hidden || !appActive) return;
  animationFrame = requestAnimationFrame(animate);
  // A modal covers the scene; keep its last frame instead of competing with media playback.
  const modalOpen = Boolean(document.querySelector('dialog[open]'));
  if (modalOpen && !projectionDirty && !sceneNeedsResize) { lastFrame = now; return; }
  const autoOrbit = !modalOpen && currentView === 'global' && state.mode === 'preview' && state.autoRotate && !drag && !pinch && !inertia && now >= (state.manualUntil || 0);
  const moving = drag || pinch || inertia || cameraTransition.active || autoOrbit;
  const frameInterval = nativeRendering ? 1000 / (moving || projectionDirty || sceneNeedsResize ? 60 : 24) : 0;
  if (frameInterval !== frameBudget) { frameBudget = frameInterval; nextRenderTime = now; }
  if (now + 1 < nextRenderTime && !sceneNeedsResize) return;
  nextRenderTime = now + frameInterval - Math.min(frameInterval, Math.max(0, now - nextRenderTime));
  if (sceneNeedsResize) { sceneNeedsResize = false; render(); }
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  starMaterial.uniforms.uTime.value = now * .001;
  if (!modalOpen && cameraTransition.update(now)) {
    projectionDirty = true;
  } else if (autoOrbit) {
    timelineGroup.rotation.y += dt * .000055;
    projectionDirty = true;
  } else if (!modalOpen && inertia && !drag && !pinch) {
    const step = advanceInertia(inertia.velocity, Math.max(0, now - inertia.time));
    inertia.time = Math.max(now, inertia.time);
    timelineGroup.rotation.y += step.rotation;
    if (inertia.kind === 'orbit') { cameraTarget.y += step.pan; camera.position.y += step.pan; }
    inertia.velocity = step.velocity;
    state.manualUntil = now + 5000;
    projectionDirty = true;
    if (!step.active) { inertia = null; persist(); }
  }
  camera.lookAt(cameraTarget);
  if (planeAxisMaterial) {
    const opacity = (drag && ['plane-rotate', 'node'].includes(drag.kind)) || now < planeAxisHighlightUntil ? .68 : .3;
    if (planeAxisMaterial.opacity !== opacity) { planeAxisMaterial.opacity = opacity; projectionDirty = true; }
  }
  if (currentView === 'global' && projectionDirty && !cameraTransition.active) {
    const { low, high } = visibleTimelineBounds();
    if (renderedTickBounds.scale !== state.scale || low < renderedTickBounds.low + 2 || high > renderedTickBounds.high - 2 || renderedTickBounds.high - renderedTickBounds.low > (high - low + 8) * 2) {
      // Only ticks and date labels change while browsing time; preserve nodes and links.
      updateTimelineTicks(low - 4, high + 4);
      overlay.querySelectorAll('.date-label-3d').forEach((el) => el.remove());
      overlay.insertAdjacentHTML('beforeend', globalDateLabels(low - 4, high + 4));
    }
  }
  if (projectionDirty) {
    updateNodeDotScales(); updateStarField(); projectLabels(); updateGlobalOverview();
    vectorScene.update(viewport.width, viewport.height);
    projectionDirty = false;
  }
  if (!contextLost) {
    // Resizing clears the WebGL buffer. Resize and paint together in this animation callback.
    if (paintedWidth !== viewport.width || paintedHeight !== viewport.height) {
      renderer.setSize(viewport.width, viewport.height, false);
      paintedWidth = viewport.width; paintedHeight = viewport.height;
    }
    renderer.render(scene, camera);
  }
}

function resumeAnimation() {
  if (!document.hidden && appActive && animationFrame === null) {
    lastFrame = performance.now(); nextRenderTime = lastFrame; projectionDirty = true;
    animationFrame = requestAnimationFrame(animate);
  }
}
function resetNavigation() {
  clearNodeHold();
  stopInertia(); touchPointers.clear(); pinch = null;
  if (drag?.moved) persist();
  drag = null; state.manualUntil = performance.now() + 5000;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) resetNavigation(); else resumeAnimation(); });
document.fonts?.ready.then(() => {
  overlay.querySelectorAll('.date-label-3d, .scene-node-label, .scene-node-cover').forEach((el) => overlaySizes.delete(el));
  projectionDirty = true;
});

const nodeEditor = new NodeEditor({ state, persist, onChange: () => { render(); }, snapshot, researchMode,
  deleteNode: (id) => { state.selectedId = id; state.selectedLinkId = null; deleteSelected(); },
  clearHistory: () => { undoStack = []; redoStack = []; updateUndoButtons(); }, formatDate, toast: showToast });
if (Capacitor.isNativePlatform()) {
  App.addListener('appStateChange', ({ isActive }) => { appActive = isActive; if (!isActive) resetNavigation(); else resumeAnimation(); });
  App.addListener('backButton', async () => {
    if (nodeEditor.mediaPicker.blocksBack()) return;
    const dialogs = [...document.querySelectorAll('dialog[open]')];
    const activeDialog = document.activeElement?.closest('dialog[open]') || dialogs.at(-1);
    if (activeDialog) {
      if (activeDialog.id === 'entryDialog' && !await nodeEditor.saveDraft()) return;
      activeDialog.close(); nodeEditor.renderReader(); return;
    }
    if (!document.querySelector('#mobileActionMenu').hidden) {
      document.querySelector('#mobileActionMenu').hidden = true;
      document.querySelector('.mobile-menu').setAttribute('aria-expanded', 'false');
      return;
    }
    if (openToolkit || connectFrom) { openToolkit = null; connectFrom = null; render(); return; }
    if (currentView === 'plane') { exitPlane(); return; }
    if (pendingWrites || nodeEditor.pending) { showToast('正在保存记忆，请稍候'); return; }
    if (storageLoadError) { showToast('本地保存失败，请先进入节点重试'); return; }
    await App.exitApp();
  });
  App.addListener('appRestoredResult', (result) => {
    if (result.pluginId !== 'MediaPicker' || result.methodName !== 'pickMedia') return;
    if (result.success) nodeEditor.restoreMediaSelection(result.data || { files: [] }).catch((error) => nodeEditor.fail(error));
    else { nodeEditor.restoreEditingSession(); showToast(result.error?.message || '相册未完成选择，草稿已保留'); }
  });
}
setCameraPose(globalCameraPosition(), globalCameraTarget());
render();
refreshPowerContextStatus();
nodeEditor.restoreEditingSession();
if (storageLoadError) {
  showToast('无法读取本地存储，请检查浏览器权限');
  nodeEditor.setStatus('本地存储不可用，请重试', true);
} else persist();
window.addEventListener('beforeunload', (event) => {
  if (pendingWrites || storageLoadError || nodeEditor.pending) { event.preventDefault(); event.returnValue = ''; }
});
resumeAnimation();
}

startApp().catch((error) => {
  console.error('GlimmerAxis 启动失败', error);
  const app = document.querySelector('#app');
  app.replaceChildren();
  const message = document.createElement('p');
  message.style.cssText = 'margin:auto;padding:32px;color:#bfc7c1;line-height:2';
  message.textContent = `暂时无法打开${researchMode ? '文脉星图' : 'GlimmerAxis'}：${error.message}。本机记录未被删除，请刷新重试。`;
  app.append(message);
});
