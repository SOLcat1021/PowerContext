import { DEFAULT_COLOR, COLOR_PALETTE, normalizeNode, syncNodeSummary, coverMedia, entryHasContent } from './memory-model.js';
import { assetView, importAsset, importNativeAsset, captureVideoPoster, deleteAsset } from './media-store.js';
import { nativeApp, shareOriginal } from './native-export.js';
import './node-editor.css';
import { nodeType, nodeTypeIcon } from './node-types.js';
import { createMediaPickerState } from './media-picker-state.js';
import { nativeMediaPicker, pickNativeMedia, pickBrowserMedia } from './media-picker.js';

const escape = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const stamp = (date) => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date));
const duration = (seconds) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '';
const blankBlock = () => ({ id: crypto.randomUUID(), type: 'text', text: '' });


export const editorMarkup = `
  <dialog class="memory-reader" id="detailDialog" aria-label="节点记忆">
    <header class="reader-header"><button type="button" class="reader-back" data-memory-action="close-reader" aria-label="返回时间轴">←</button><span class="reader-page-title">记忆</span>
      <div class="reader-header-actions"><span class="save-indicator" id="detailSaveStatus" role="status">已保存</span><button type="button" data-memory-action="retry-save" hidden>重试保存</button><button type="button" class="quiet-button" data-memory-action="settings">节点设置</button></div></header>
    <div class="reader-scroll"><div class="reader-content"><section class="reader-profile"><div id="readerNodeIcon" class="reader-node-icon"></div><div class="reader-identity"><h1 id="readerTitle"></h1><div id="detailDate" class="detail-date"></div><div id="readerMeta" class="reader-meta"></div></div></section>
      <div class="memory-filters" role="group" aria-label="记忆筛选"><button data-memory-filter="all" class="active">全部记忆</button><button data-memory-filter="image">照片</button><button data-memory-filter="video">视频</button></div>
      <section id="memoryEntries" aria-label="记忆内容"></section></div></div>
    <footer class="reader-footer"><span id="readerDraftHint"></span><button type="button" class="primary-button" data-memory-action="add-entry">＋ 添加记忆</button></footer>
  </dialog>
  <dialog class="memory-settings" id="nodeSettingsDialog" aria-label="节点设置"><div class="dialog-top"><h2>节点设置</h2><button class="dialog-close" type="button" data-memory-action="close-settings" aria-label="关闭设置">×</button></div>
    <div id="settingsType" class="settings-type"></div><section class="settings-section"><h3>关于节点</h3><label class="field-label" for="detailTitle">标题</label><input id="detailTitle" maxlength="64" />
    <div class="settings-date" id="settingsDate"></div><div id="detailState"></div></section><section class="settings-section"><h3>光与颜色</h3>
    <label class="field-label" for="detailColor">节点光色</label><div class="color-presets">${COLOR_PALETTE.map((color) => `<button type="button" data-memory-color="${color}" style="--swatch:${color}" aria-label="节点颜色 ${color}"></button>`).join('')}</div>
    <div class="custom-color"><input id="detailColor" type="color" aria-label="自定义节点颜色"/><span>自定义</span><button type="button" data-memory-action="reset-color">恢复默认</button></div><p class="settings-help">颜色只用于节点与图标。深色会适当提亮，确保在黑色背景上可见。</p>
    </section><section class="settings-section"><div class="cover-heading"><h3>图上封面</h3><button type="button" data-memory-action="hide-cover">隐藏封面</button></div><p class="settings-help">圆形裁切只影响图上封面，保留完整原件。</p>
    <div id="coverChoices" class="cover-choices"></div><div id="coverCrop" hidden><div class="crop-preview" id="cropPreview"></div>
      <label>水平位置<input data-cover-crop="x" type="range" min="0" max="100"/></label><label>垂直位置<input data-cover-crop="y" type="range" min="0" max="100"/></label><label>放大<input data-cover-crop="zoom" type="range" min="1" max="3" step=".05"/></label></div>
    </section><div class="settings-bottom"><button type="button" data-memory-action="delete-node">删除节点</button><button type="button" class="text-button" data-memory-action="open-trash">回收站</button><span class="save-indicator settings-save-status" role="status"></span><button type="button" data-memory-action="retry-save" hidden>重试保存</button><button type="button" class="quiet-button" data-memory-action="close-settings">完成</button></div></dialog>
  <dialog class="entry-composer" id="entryDialog" aria-label="编辑一条记忆"><header class="composer-header"><div><h2 id="composerTitle">添加记忆</h2></div><button type="button" class="dialog-close" data-memory-action="close-composer" aria-label="保存草稿并关闭">×</button></header>
    <div class="composer-scroll"><div id="composerBlocks"></div><div class="block-add-tools"><button type="button" data-memory-action="add-text">＋ 文字</button><button type="button" data-memory-action="pick-media">＋ 相册</button><input id="mediaInput" type="file" accept="image/*,video/*" multiple hidden /></div><div id="importQueue" aria-live="polite"></div></div>
    <footer class="composer-footer"><button type="button" data-memory-action="discard-draft">丢弃草稿</button><span id="draftStatus" role="status">草稿自动保存</span><button type="button" data-memory-action="retry-save" hidden>重试保存</button><button type="button" class="primary-button" data-memory-action="commit-entry">保存这条记忆</button></footer></dialog>
  <dialog class="media-viewer" id="mediaViewer" aria-label="媒体查看器"><header><span id="viewerTitle"></span><button type="button" class="dialog-close" data-memory-action="close-viewer" aria-label="关闭媒体">×</button></header><div id="viewerContent"></div>
    <footer><button type="button" data-memory-action="previous-image">← 上一张</button><label id="viewerZoomLabel">缩放<input id="viewerZoom" type="range" min="1" max="4" step=".1" value="1"/></label><button type="button" data-memory-action="video-cover" hidden>用当前画面做封面</button><button type="button" data-memory-action="download-original">保存原件</button><button type="button" data-memory-action="next-image">下一张 →</button></footer><p id="viewerMessage" role="status"></p></dialog>
  <dialog class="memory-trash" id="memoryTrash" aria-label="回收站"><div class="dialog-top"><h2>回收站</h2><button type="button" class="dialog-close" data-memory-action="close-trash" aria-label="关闭回收站">×</button></div><p class="settings-help">删除的节点、记忆和附件保留在本机，可恢复。彻底删除后无法恢复。</p><div id="trashList"></div></dialog>
`;

export class NodeEditor {
  constructor({ state, persist, onChange, snapshot, deleteNode, clearHistory, formatDate, toast, researchMode = false }) {
    Object.assign(this, { state, persist, onChange, snapshot, deleteNode, clearHistory, formatDate, toast, researchMode });
    this.nodeId = null; this.filter = 'all'; this.imports = []; this.pending = 0; this.saveVersion = 0;
    this.expandedBlocks = new Set();
    this.mediaPicker = createMediaPickerState();
    this.reader = document.querySelector('#detailDialog');
    this.settings = document.querySelector('#nodeSettingsDialog');
    this.composer = document.querySelector('#entryDialog');
    this.viewer = document.querySelector('#mediaViewer');
    this.trash = document.querySelector('#memoryTrash');
    if (this.researchMode) document.querySelector('#detailTitle').maxLength = 300;
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.post-more')) this.reader.querySelectorAll('.post-more[open]').forEach((menu) => { menu.open = false; });
      if (!event.target.closest('.memory-reader, .memory-settings, .entry-composer, .media-viewer, .memory-trash')) return;
      this.handleClick(event).catch((error) => this.fail(error));
    });
    this.reader.addEventListener('toggle', (event) => {
      if (event.target.matches('.post-more[open]')) this.reader.querySelectorAll('.post-more[open]').forEach((menu) => { if (menu !== event.target) menu.open = false; });
    }, true);
    this.reader.addEventListener('cancel', (event) => {
      const menu = this.reader.querySelector('.post-more[open]');
      if (menu) { event.preventDefault(); menu.open = false; }
    });
    document.querySelector('#detailTitle').addEventListener('input', (event) => {
      const node = this.node(); if (!node) return;
      if (!event.target.value.trim()) { this.setStatus('标题不能为空', true); return; }
      node.title = event.target.value.trim(); this.changed();
    });
    document.querySelector('#detailColor').addEventListener('input', (event) => this.setColor(event.target.value));
    this.settings.querySelectorAll('[data-cover-crop]').forEach((input) => input.addEventListener('input', () => {
      this.node().cover[input.dataset.coverCrop] = Number(input.value); this.renderCrop(); this.changed();
    }));
    this.composer.addEventListener('input', (event) => {
      const block = this.draft()?.blocks.find((item) => item.id === event.target.dataset.blockInput);
      if (!block) return;
      block[event.target.dataset.field] = event.target.value;
      this.saveDraft();
    });
    document.querySelector('#viewerZoom').addEventListener('input', (event) => {
      this.fitViewerImage(Number(event.target.value));
    });
    this.composer.addEventListener('cancel', (event) => {
      if (this.mediaPicker.blocksBack()) { event.preventDefault(); return; }
      this.saveDraft();
    });
    this.composer.addEventListener('close', () => {
      if (this.mediaPicker.active && this.draft()) {
        queueMicrotask(() => { if (!this.composer.open) this.composer.showModal(); });
        return;
      }
      if (this.state.editorSession?.nodeId === this.nodeId) { delete this.state.editorSession; this.saveDraft(); }
      this.onChange();
    });
    this.settings.addEventListener('close', () => this.renderReader());
    this.viewer.addEventListener('close', () => { this.viewer.querySelector('video')?.pause(); document.querySelector('#viewerContent').innerHTML = ''; });
    const pane = document.querySelector('#viewerContent');
    let pan = null;
    pane.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('img') || Number(document.querySelector('#viewerZoom').value) <= 1) return;
      event.preventDefault(); pane.setPointerCapture(event.pointerId);
      pan = { x: event.clientX, y: event.clientY, left: pane.scrollLeft, top: pane.scrollTop };
    });
    pane.addEventListener('pointermove', (event) => { if (pan) { pane.scrollLeft = pan.left - event.clientX + pan.x; pane.scrollTop = pan.top - event.clientY + pan.y; } });
    pane.addEventListener('pointerup', () => { pan = null; }); pane.addEventListener('pointercancel', () => { pan = null; });
  }

  node() { return this.state.nodes.find((node) => node.id === this.nodeId); }
  draft() { return this.state.drafts[this.nodeId]; }
  open(node, { view = 'reader', entryId = null } = {}) {
    if (this.pending && this.nodeId !== node.id) { this.toast('媒体正在导入，请稍候再打开其他节点'); return; }
    if (this.nodeId !== node.id) this.expandedBlocks.clear();
    this.nodeId = node.id; normalizeNode(node); this.filter = 'all'; this.renderReader();
    if (view === 'composer') { this.startDraft(entryId); return; }
    if (view === 'settings') { this.renderSettings(); this.settings.showModal(); return; }
    if (!this.reader.open) this.reader.showModal();
  }
  setStatus(message, failed = false) {
    for (const element of document.querySelectorAll('#detailSaveStatus, #draftStatus, .settings-save-status')) {
      element.textContent = message; element.classList.toggle('failed', failed);
    }
    document.querySelectorAll('[data-memory-action="retry-save"]').forEach((button) => { button.hidden = !failed; });
  }
  async save() {
    const version = ++this.saveVersion;
    this.setStatus('保存中…');
    const ok = await this.persist();
    if (version === this.saveVersion) this.setStatus(ok ? '已保存到本机' : '保存失败 · 请重试', !ok);
    return ok;
  }
  changed() { const node = this.node(); if (node) syncNodeSummary(node); this.onChange(); this.renderReader(); return this.save(); }
  saveDraft() { return this.save(); }
  fail(error) { this.setStatus(error.message || '操作失败，请重试', true); this.toast(error.message || '操作失败'); }

  renderReader() {
    const node = this.node(); if (!node) return;
    document.querySelector('#readerTitle').textContent = node.title;
    const cover = coverMedia(node), thumbnail = cover && assetView(cover).thumbnail;
    document.querySelector('#readerNodeIcon').innerHTML = thumbnail ? `<img src="${escape(thumbnail)}" alt="" style="object-position:${node.cover.x}% ${node.cover.y}%;transform:scale(${node.cover.zoom})"/>` : nodeTypeIcon(node.type);
    document.querySelector('#readerNodeIcon').style.color = node.color || DEFAULT_COLOR;
    document.querySelector('#detailDate').textContent = this.researchMode ? `${node.paper?.year || node.date.slice(0, 4)} 年 · ${node.paper?.authors || '作者待补充'}` : this.formatDate(node.date, true);
    document.querySelector('#readerMeta').textContent = this.researchMode ? `文献节点 · ${node.entries.length} 条笔记` : `${nodeType(node.type).name}${node.type === 'goal' ? ` · ${node.status || '进行中'}` : ''} · ${node.entries.length} 条记忆`;
    document.querySelector('#readerDraftHint').textContent = this.draft() ? '有一条未完成的草稿' : '';
    document.querySelector('#readerDraftHint').hidden = !this.draft();
    document.querySelector('[data-memory-action="add-entry"]').textContent = this.draft() ? '继续草稿' : `＋ 添加${this.researchMode ? '笔记' : '记忆'}`;
    this.reader.querySelectorAll('[data-memory-filter]').forEach((button) => button.classList.toggle('active', button.dataset.memoryFilter === this.filter));
    const entries = node.entries.filter((entry) => this.filter === 'all' || entry.blocks.some((block) => block.type === this.filter));
    document.querySelector('#memoryEntries').innerHTML = entries.map((entry) => {
      const index = node.entries.indexOf(entry);
      const blocks = entry.blocks.filter((block) => this.filter === 'all' || block.type === this.filter);
      return `<article class="memory-entry"><header><div class="post-avatar" style="color:${escape(node.color || DEFAULT_COLOR)}">${nodeTypeIcon(node.type)}</div><div class="post-heading"><strong>${escape(node.title)}</strong><time datetime="${escape(entry.createdAt)}">${escape(stamp(entry.createdAt))}${entry.updatedAt ? ' · 已编辑' : ''}</time></div><details class="post-more"><summary aria-label="这条${this.researchMode ? '笔记' : '记忆'}的更多操作"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></summary><div class="post-menu"><button data-entry-edit="${entry.id}">编辑${this.researchMode ? '笔记' : '记忆'}</button><button data-entry-move="${entry.id}" data-step="-1" ${index === 0 ? 'disabled' : ''}>上移</button><button data-entry-move="${entry.id}" data-step="1" ${index === node.entries.length - 1 ? 'disabled' : ''}>下移</button><button class="post-delete" data-entry-delete="${entry.id}">删除${this.researchMode ? '笔记' : '记忆'}</button></div></details></header><div class="post-body">${blocks.map((block) => this.blockHTML(block, node.media)).join('')}</div></article>`;
    }).join('') || `<div class="reader-empty">${this.filter === 'all' ? `暂无${this.researchMode ? '笔记' : '记忆'}` : '暂无这类记录'}</div>`;
  }

  blockHTML(block, media, composing = false) {
    if (block.type === 'text') {
      if (composing) return `<textarea data-block-input="${block.id}" data-field="text" placeholder="${this.researchMode ? '写下阅读观点或批注…' : '写下想留下的话…'}" aria-label="${this.researchMode ? '笔记' : '记忆'}文字">${escape(block.text)}</textarea>`;
      const collapsible = block.text.length > 360 || block.text.split('\n').length > 8;
      const expanded = this.expandedBlocks.has(block.id);
      return `<div class="post-copy ${collapsible ? 'collapsible' : ''} ${expanded ? 'expanded' : ''}"><p class="memory-text" id="text-${escape(block.id)}">${escape(block.text)}</p>${collapsible ? `<button class="post-expand" data-expand-text="${escape(block.id)}" aria-controls="text-${escape(block.id)}" aria-expanded="${expanded}">${expanded ? '收起' : '展开全文'}</button>` : ''}</div>`;
    }
    const items = (block.mediaIds || []).map((id) => media.find((item) => item.id === id)).filter(Boolean);
    return `<div class="memory-media-grid ${block.type === 'video' ? 'video-grid' : ''}" data-count="${items.length}">${items.map((item, index) => {
      const view = assetView(item);
      const ratio = view.width && view.height ? Math.max(.4, Math.min(1.8, view.width / view.height)) : 1.4;
      return `<div class="memory-media-item"><button type="button" class="media-open" style="--media-ratio:${ratio}" data-media-open="${item.id}" ${view.missing ? 'disabled' : ''} aria-label="查看${escape(item.name)}">${view.thumbnail ? `<img src="${escape(view.thumbnail)}" alt="${escape(item.name)}" loading="lazy" decoding="async"/>` : '<span class="media-placeholder">原件</span>'}${item.kind === 'video' ? `<span class="video-play">▶ ${duration(view.duration)}</span>` : ''}</button>${view.missing ? '<small class="media-warning">旧版原件未保存，请重新导入</small>' : view.previewError ? '<small class="media-warning">当前浏览器无法预览，可保存原件</small>' : ''}${composing ? `<div class="attachment-actions"><button data-media-move="${item.id}" data-block="${block.id}" data-step="-1" ${index === 0 ? 'disabled' : ''}>←</button><button data-media-remove="${item.id}" data-block="${block.id}">移除</button><button data-media-move="${item.id}" data-block="${block.id}" data-step="1" ${index === items.length - 1 ? 'disabled' : ''}>→</button></div>` : ''}</div>`;
    }).join('')}</div>${composing ? `<textarea class="media-caption" data-block-input="${block.id}" data-field="caption" rows="2" placeholder="为这组${block.type === 'image' ? '照片' : '视频'}写一点说明…" aria-label="媒体说明">${escape(block.caption || '')}</textarea>` : block.caption ? `<p class="memory-caption">${escape(block.caption)}</p>` : ''}`;
  }

  renderSettings() {
    const node = this.node();
    document.querySelector('#detailTitle').value = node.title;
    document.querySelector('#settingsDate').textContent = this.formatDate(node.date, true);
    document.querySelector('#settingsType').innerHTML = `${nodeTypeIcon(node.type)}<div><strong>${this.researchMode ? '文献节点' : nodeType(node.type).name}</strong></div>`;
    document.querySelector('#detailColor').value = node.color || DEFAULT_COLOR;
    this.markColor();
    document.querySelector('#detailState').innerHTML = node.type === 'goal' ? `<span class="field-label">目标状态</span><div class="goal-state-options" role="group" aria-label="目标状态">${['进行中', '已完成'].map((status) => `<button type="button" data-goal-status="${status}" aria-pressed="${(node.status || '进行中') === status}">${status}</button>`).join('')}</div>` : '';
    document.querySelector('#coverChoices').innerHTML = node.media.filter((item) => assetView(item).thumbnail).map((item) => `<button type="button" data-cover-id="${item.id}" class="${!node.cover.hidden && node.cover.mediaId === item.id ? 'chosen' : ''}" aria-label="将${escape(item.name)}设为封面"><img src="${escape(assetView(item).thumbnail)}" alt=""/>${item.kind === 'video' ? '<span>▶</span>' : ''}</button>`).join('') || '<span class="settings-help">添加照片或视频后，可以选择封面。</span>';
    document.querySelector('[data-memory-action="hide-cover"]').disabled = !node.cover.mediaId || node.cover.hidden;
    this.renderCrop();
  }
  renderCrop() {
    const node = this.node(); const item = coverMedia(node); const src = item && assetView(item).thumbnail;
    document.querySelector('#coverCrop').hidden = !src;
    document.querySelector('#cropPreview').innerHTML = src ? `<img src="${escape(src)}" alt="圆形封面裁切预览" style="object-position:${node.cover.x}% ${node.cover.y}%;transform:scale(${node.cover.zoom})"/>` : '';
    for (const input of this.settings.querySelectorAll('[data-cover-crop]')) input.value = node.cover[input.dataset.coverCrop];
  }
  markColor() { this.settings.querySelectorAll('[data-memory-color]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.memoryColor === (this.node().color || DEFAULT_COLOR)))); }
  setColor(color) { if (!this.node()) return; this.node().color = color; document.querySelector('#detailColor').value = color; this.markColor(); this.changed(); }

  startDraft(entryId = null) {
    if (this.pending) { this.toast('媒体正在导入，完成后可编辑其他记忆'); return; }
    if (this.draft() && this.draft().entryId !== entryId && entryId) { this.toast('请先完成或丢弃当前草稿'); this.renderComposer(); this.composer.showModal(); return; }
    if (!this.draft()) {
      const entry = this.node().entries.find((item) => item.id === entryId);
      this.state.drafts[this.nodeId] = { entryId: entry?.id || null, createdAt: entry?.createdAt || new Date().toISOString(), blocks: entry ? structuredClone(entry.blocks) : [blankBlock()], media: structuredClone(this.node().media) };
      this.saveDraft();
    }
    this.imports = []; this.renderComposer(); this.composer.showModal();
  }

  restoreEditingSession() {
    const session = this.state.editorSession;
    const node = session && this.state.nodes.find((item) => item.id === session.nodeId);
    if (!node || !this.state.drafts[node.id]) return false;
    if (this.composer.open && this.nodeId === node.id) return true;
    this.state.selectedId = node.id; this.state.selectedLinkId = null; this.onChange();
    if (session.readerOpen && !this.reader.open) this.open(node);
    this.open(node, { view: 'composer' });
    this.composer.querySelector('.composer-scroll').scrollTop = session.scroll || 0;
    return true;
  }

  async chooseMedia() {
    if (!this.draft() || this.pending || !this.mediaPicker.begin()) return;
    this.state.editorSession = { nodeId: this.nodeId, readerOpen: this.reader.open,
      scroll: this.composer.querySelector('.composer-scroll').scrollTop };
    this.renderImports();
    try {
      let result;
      if (nativeMediaPicker) {
        if (!await this.saveDraft()) throw new Error('草稿保存失败，请重试后再打开相册');
        result = await pickNativeMedia();
      } else {
        // Open within the click's user activation; browser file dialogs may reject a delayed click.
        this.saveDraft();
        result = await pickBrowserMedia(document.querySelector('#mediaInput'));
      }
      await this.acceptMediaSelection(result);
    } finally {
      this.mediaPicker.end(); this.renderImports();
    }
  }

  async acceptMediaSelection(result) {
    if (result.files?.length) await this.importFiles(result.files);
    if (result.errors?.length) this.toast(result.errors.join('；'));
    // Cancelling changes neither the content nor the editor stack.
    if (!this.composer.open && this.draft()) this.composer.showModal();
  }

  async restoreMediaSelection(result) {
    if (!this.restoreEditingSession()) return;
    if (!this.mediaPicker.begin()) return;
    this.renderImports();
    try { await this.acceptMediaSelection(result); }
    finally { this.mediaPicker.end(); this.renderImports(); }
  }
  renderComposer() {
    const draft = this.draft(); if (!draft) return;
    document.querySelector('#composerTitle').textContent = draft.entryId ? `编辑${this.researchMode ? '笔记' : '记忆'}` : `添加${this.researchMode ? '笔记' : '记忆'}`;
    document.querySelector('#composerBlocks').innerHTML = draft.blocks.map((block, index) => `<section class="composer-block"><div class="block-controls"><span>${({ text: '文字', image: '照片', video: '视频' })[block.type]}</span><button data-block-move="${block.id}" data-step="-1" ${index === 0 ? 'disabled' : ''} aria-label="前移内容">↑</button><button data-block-move="${block.id}" data-step="1" ${index === draft.blocks.length - 1 ? 'disabled' : ''} aria-label="后移内容">↓</button><button data-block-delete="${block.id}" aria-label="删除内容块">×</button></div>${this.blockHTML(block, draft.media, true)}</section>`).join('');
    this.renderImports();
  }
  renderImports() {
    document.querySelector('#importQueue').innerHTML = this.imports.map((item, index) => `<div class="import-item ${item.status === 'failed' ? 'failed' : ''}"><span>${escape(item.file.name)}</span><small>${escape(item.message || ({ queued: '等待导入', importing: '保存原件与缩略图…', done: '已导入本机', failed: '导入失败' })[item.status])}</small>${item.status === 'failed' ? `<button data-import-retry="${index}">重试</button><button data-import-dismiss="${index}">移除</button>` : ''}</div>`).join('');
    document.querySelector('[data-memory-action="commit-entry"]').disabled = this.mediaPicker.active || this.pending > 0 || this.imports.some((item) => item.status === 'failed');
    document.querySelector('[data-memory-action="discard-draft"]').disabled = this.mediaPicker.active || this.pending > 0;
    document.querySelector('[data-memory-action="pick-media"]').disabled = this.mediaPicker.active || this.pending > 0;
  }
  async importFiles(files) {
    if (!this.draft()) return;
    const tasks = files.map((file) => ({ file, status: 'queued' })); this.imports.push(...tasks);
    this.pending += tasks.length; this.renderImports();
    for (const item of tasks) await this.importOne(item);
  }
  async importOne(item, retry = false) {
    if (retry) this.pending++;
    const draft = this.draft();
    item.status = 'importing'; item.message = ''; this.renderImports();
    try {
      item.media ||= await (item.file.nativeFilePath ? importNativeAsset(item.file) : importAsset(item.file));
      if (!draft.media.some((media) => media.id === item.media.id)) {
        draft.media.push(item.media);
        let block = draft.blocks.at(-1);
        if (block?.type !== item.media.kind) { block = { id: crypto.randomUUID(), type: item.media.kind, mediaIds: [], caption: '' }; draft.blocks.push(block); }
        block.mediaIds.push(item.media.id);
      }
      if (!await this.saveDraft()) throw new Error('原件已存储，草稿保存失败，请重试');
      item.status = 'done'; item.message = '';
    } catch (error) { item.status = 'failed'; item.message = error.message; }
    finally { this.pending--; if (this.draft() === draft) this.renderComposer(); }
  }
  async commitDraft() {
    const node = this.node(); const draft = this.draft();
    if (!draft || this.mediaPicker.active || this.pending || this.imports.some((item) => item.status === 'failed')) return;
    if (!entryHasContent(draft)) { this.toast('写一点文字，或添加照片、视频'); return; }
    this.snapshot();
    const now = new Date().toISOString();
    const entry = { id: draft.entryId || crypto.randomUUID(), createdAt: draft.createdAt,
      updatedAt: draft.entryId ? now : null, blocks: structuredClone(draft.blocks).filter((block) => block.type === 'text' ? block.text.trim() : block.mediaIds.length) };
    const old = node.entries.findIndex((item) => item.id === entry.id);
    const removed = new Set((old >= 0 ? node.entries[old].blocks : []).flatMap((block) => block.mediaIds || []));
    entry.blocks.forEach((block) => block.mediaIds?.forEach((id) => removed.delete(id)));
    for (const id of removed) {
      if (node.entries.some((other) => other.id !== entry.id && other.blocks.some((block) => block.mediaIds?.includes(id)))) continue;
      const media = node.media.find((item) => item.id === id);
      if (media) this.state.trash.push({ id: crypto.randomUUID(), kind: 'media', nodeId: node.id, entryId: entry.id, value: structuredClone(media), deletedAt: now });
      node.media = node.media.filter((item) => item.id !== id);
    }
    if (old >= 0) node.entries[old] = entry; else node.entries.push(entry);
    const used = new Set(entry.blocks.flatMap((block) => block.mediaIds || []));
    const referenced = new Set(node.entries.flatMap((entry) => entry.blocks.flatMap((block) => block.mediaIds || [])));
    for (const media of draft.media) {
      if (referenced.has(media.id) || this.state.trash.some((item) => item.kind === 'media' && item.value.id === media.id)) continue;
      this.state.trash.push({ id: crypto.randomUUID(), kind: 'media', nodeId: node.id, entryId: entry.id, value: media, deletedAt: now });
    }
    draft.media.filter((media) => used.has(media.id)).forEach((media) => { if (!node.media.some((item) => item.id === media.id)) node.media.push(media); });
    if (!node.cover.mediaId && !node.cover.hidden) node.cover.mediaId = node.media.find((media) => media.kind === 'image')?.id || null;
    if (node.cover.mediaId && !node.media.some((media) => media.id === node.cover.mediaId)) node.cover.mediaId = null;
    delete this.state.drafts[node.id];
    const ok = await this.changed();
    if (ok) this.composer.close();
    else { draft.entryId = entry.id; this.state.drafts[node.id] = draft; this.renderReader(); this.toast('尚未可靠保存，草稿保留，请重试'); }
  }

  async openMedia(id) {
    const item = this.draft()?.media.find((media) => media.id === id) || this.node()?.media.find((media) => media.id === id);
    if (!item) return;
    this.viewing = item; const view = assetView(item);
    this.viewer.querySelector('video')?.pause();
    document.querySelector('#viewerTitle').textContent = item.name || '记忆原件';
    document.querySelector('#viewerMessage').textContent = view.missing ? '旧版本没有保存原件，需要重新导入。' : '';
    document.querySelector('#viewerContent').innerHTML = view.src ? item.kind === 'image'
      ? `<img src="${escape(view.src)}" alt="${escape(item.name)}" draggable="false"/>`
      : `<video src="${escape(view.src)}" ${view.thumbnail ? `poster="${escape(view.thumbnail)}"` : ''} controls playsinline preload="metadata"></video>` : '';
    document.querySelector('#viewerZoom').value = 1;
    document.querySelector('#viewerZoomLabel').hidden = item.kind !== 'image';
    for (const action of ['previous-image', 'next-image']) document.querySelector(`[data-memory-action="${action}"]`).hidden = item.kind !== 'image';
    document.querySelector('[data-memory-action="video-cover"]').hidden = item.kind !== 'video' || !this.node()?.media.some((media) => media.id === id) || view.missing;
    document.querySelector('[data-memory-action="download-original"]').disabled = !view.src;
    document.querySelector('[data-memory-action="download-original"]').textContent = nativeApp ? '分享／保存原件' : '保存原件';
    const element = document.querySelector('#viewerContent img, #viewerContent video');
    element?.addEventListener('error', () => { document.querySelector('#viewerMessage').textContent = '原件已保留；当前浏览器无法显示此格式，可保存原件到本机查看。'; });
    if (item.kind === 'image') element?.addEventListener('load', () => this.fitViewerImage(1));
    if (!this.viewer.open) this.viewer.showModal();
  }
  fitViewerImage(zoom) {
    const pane = document.querySelector('#viewerContent');
    const image = pane.querySelector('img');
    if (!image?.naturalWidth) return;
    const fit = Math.min(pane.clientWidth / image.naturalWidth, pane.clientHeight / image.naturalHeight);
    image.style.width = `${image.naturalWidth * fit * zoom}px`;
    image.style.height = `${image.naturalHeight * fit * zoom}px`;
    image.style.maxWidth = 'none'; image.style.maxHeight = 'none';
    if (zoom === 1) { pane.scrollLeft = 0; pane.scrollTop = 0; }
  }
  navigateImage(step) {
    const items = (this.composer.open ? this.draft()?.media : this.node()?.media)?.filter((media) => media.kind === 'image' && !assetView(media).missing) || [];
    if (items.length) this.openMedia(items[(items.findIndex((media) => media.id === this.viewing.id) + step + items.length) % items.length].id);
  }
  showTrash() { this.renderTrash(); if (!this.trash.open) this.trash.showModal(); }
  renderTrash() {
    document.querySelector('#trashList').innerHTML = [...this.state.trash].reverse().map((item) => `<article class="trash-item"><div><strong>${escape(item.value.title || item.value.name || (item.kind === 'entry' ? `一条${this.researchMode ? '笔记' : '记忆'}` : '附件'))}</strong><small>${(this.researchMode ? { node: '文献及关联关系', entry: '笔记内容', media: '附件' } : { node: '节点及关联关系', entry: '记忆内容', media: '附件' })[item.kind]} · ${escape(stamp(item.deletedAt))}</small></div><button data-trash-restore="${item.id}">恢复</button><button data-trash-purge="${item.id}">彻底删除</button></article>`).join('') || '<div class="reader-empty">回收站是空的</div>';
  }
  async restoreTrash(id) {
    const item = this.state.trash.find((value) => value.id === id); if (!item) return;
    const node = this.state.nodes.find((node) => node.id === item.nodeId);
    if (item.kind !== 'node' && !node) { this.toast('请先恢复这条记忆所属的节点'); return; }
    this.snapshot();
    if (item.kind === 'node') {
      if (!this.state.nodes.some((node) => node.id === item.value.id)) this.state.nodes.push(normalizeNode(item.value));
      for (const link of item.links || []) if (!this.state.pendingRestoreLinks.some((other) => other.id === link.id)) this.state.pendingRestoreLinks.push(link);
      if (item.draft) this.state.drafts[item.value.id] = item.draft;
    } else if (item.kind === 'entry') {
      if (!node.entries.some((entry) => entry.id === item.value.id)) node.entries.splice(Math.min(item.index ?? node.entries.length, node.entries.length), 0, item.value);
      for (const media of item.media || []) if (!node.media.some((other) => other.id === media.id)) node.media.push(media);
      if (item.cover && !node.cover.mediaId) node.cover = item.cover;
      syncNodeSummary(node);
    } else {
      if (!node.media.some((media) => media.id === item.value.id)) node.media.push(item.value);
      const entry = node.entries.find((entry) => entry.id === item.entryId);
      const block = entry?.blocks.find((block) => block.type === item.value.kind);
      if (block && !block.mediaIds.includes(item.value.id)) block.mediaIds.push(item.value.id);
      else if (!block) node.entries.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), blocks: [{ id: crypto.randomUUID(), type: item.value.kind, mediaIds: [item.value.id], caption: '' }] });
    }
    this.state.pendingRestoreLinks = this.state.pendingRestoreLinks.filter((link) => {
      if (!this.state.nodes.some((node) => node.id === link.from) || !this.state.nodes.some((node) => node.id === link.to)) return true;
      if (!this.state.links.some((other) => other.id === link.id)) this.state.links.push(link);
      return false;
    });
    this.state.trash = this.state.trash.filter((value) => value.id !== id);
    await this.changed(); this.renderTrash();
  }
  async purgeTrash(id) {
    const item = this.state.trash.find((value) => value.id === id); if (!item) return;
    if (!confirm('彻底删除这项内容？此操作无法恢复。')) return;
    const pending = this.state.pendingRestoreLinks;
    if (item.kind === 'node') this.state.pendingRestoreLinks = pending.filter((link) => link.from !== item.value.id && link.to !== item.value.id);
    this.state.trash = this.state.trash.filter((value) => value.id !== id);
    if (!await this.save()) { this.state.trash.push(item); this.state.pendingRestoreLinks = pending; this.renderTrash(); return; }
    this.clearHistory();
    // Permanent deletion clears session undo. Files referenced by remaining documents survive.
    const used = JSON.stringify({ nodes: this.state.nodes, drafts: this.state.drafts, trash: this.state.trash });
    const media = item.kind === 'node' ? [...(item.value.media || []), ...(item.draft?.media || [])] : item.kind === 'entry' ? item.media || [] : [item.value];
    for (const file of media) if (!used.includes(file.id)) await deleteAsset(file.id);
    const pdfId = item.kind === 'node' && this.researchMode ? item.value.paper?.pdfId : null;
    if (pdfId && !used.includes(pdfId)) {
      const { deletePdf } = await import('./pdf-store.js');
      await deletePdf(pdfId);
    }
    this.renderTrash();
  }

  async handleClick(event) {
    const el = event.target.closest('button');
    if (el) this.reader.querySelectorAll('.post-more[open]').forEach((menu) => { menu.open = false; });
    if (el?.dataset.expandText) {
      const id = el.dataset.expandText, expanded = !this.expandedBlocks.has(id);
      if (expanded) this.expandedBlocks.add(id); else this.expandedBlocks.delete(id);
      el.closest('.post-copy').classList.toggle('expanded', expanded);
      el.setAttribute('aria-expanded', String(expanded)); el.textContent = expanded ? '收起' : '展开全文';
      return;
    }
    const filter = el?.dataset.memoryFilter;
    if (filter) { this.filter = filter; this.renderReader(); return; }
    if (el?.dataset.memoryColor) { this.setColor(el.dataset.memoryColor); return; }
    if (el?.dataset.coverId) { this.snapshot(); this.node().cover = { mediaId: el.dataset.coverId, hidden: false, x: 50, y: 50, zoom: 1 }; this.renderSettings(); await this.changed(); return; }
    if (el?.dataset.mediaOpen) { await this.openMedia(el.dataset.mediaOpen); return; }
    if (el?.dataset.entryEdit) { this.startDraft(el.dataset.entryEdit); return; }
    if (el?.dataset.entryDelete) {
      const node = this.node(); const index = node.entries.findIndex((entry) => entry.id === el.dataset.entryDelete);
      if (this.draft()?.entryId === el.dataset.entryDelete) { this.toast('这条记忆还有编辑草稿，请先完成或丢弃草稿'); return; }
      this.snapshot(); const [entry] = node.entries.splice(index, 1);
      const ids = new Set(entry.blocks.flatMap((block) => block.mediaIds || []));
      const remaining = new Set(node.entries.flatMap((entry) => entry.blocks.flatMap((block) => block.mediaIds || [])));
      const media = node.media.filter((item) => ids.has(item.id));
      this.state.trash.push({ id: crypto.randomUUID(), kind: 'entry', nodeId: node.id, value: entry, media, index, cover: ids.has(node.cover.mediaId) ? structuredClone(node.cover) : null, deletedAt: new Date().toISOString() });
      node.media = node.media.filter((item) => !ids.has(item.id) || remaining.has(item.id));
      if (!node.media.some((item) => item.id === node.cover.mediaId)) node.cover.mediaId = null;
      await this.changed(); this.toast('记忆已移入回收站'); return;
    }
    if (el?.dataset.entryMove) { this.snapshot(); this.move(this.node().entries, el.dataset.entryMove, Number(el.dataset.step)); await this.changed(); return; }
    if (el?.dataset.blockMove) { this.move(this.draft().blocks, el.dataset.blockMove, Number(el.dataset.step)); this.renderComposer(); await this.saveDraft(); return; }
    if (el?.dataset.blockDelete) { this.draft().blocks = this.draft().blocks.filter((block) => block.id !== el.dataset.blockDelete); this.renderComposer(); await this.saveDraft(); return; }
    if (el?.dataset.mediaRemove) { const block = this.draft().blocks.find((block) => block.id === el.dataset.block); block.mediaIds = block.mediaIds.filter((id) => id !== el.dataset.mediaRemove); this.renderComposer(); await this.saveDraft(); return; }
    if (el?.dataset.mediaMove) { const ids = this.draft().blocks.find((block) => block.id === el.dataset.block).mediaIds; this.move(ids, el.dataset.mediaMove, Number(el.dataset.step)); this.renderComposer(); await this.saveDraft(); return; }
    if (el?.dataset.importRetry !== undefined) { await this.importOne(this.imports[Number(el.dataset.importRetry)], true); return; }
    if (el?.dataset.importDismiss !== undefined) { this.imports.splice(Number(el.dataset.importDismiss), 1); this.renderImports(); return; }
    if (el?.dataset.trashRestore) { await this.restoreTrash(el.dataset.trashRestore); return; }
    if (el?.dataset.trashPurge) { await this.purgeTrash(el.dataset.trashPurge); return; }
    if (el?.dataset.goalStatus) { this.snapshot(); this.node().status = el.dataset.goalStatus; this.renderSettings(); await this.changed(); return; }
    const action = el?.dataset.memoryAction;
    if (action === 'pick-media') { await this.chooseMedia(); return; }
    if (action === 'close-composer' && this.mediaPicker.blocksBack()) return;
    if (action === 'close-reader') this.reader.close();
    if (action === 'settings') { this.renderSettings(); this.settings.showModal(); }
    if (action === 'close-settings') { if (!document.querySelector('#detailTitle').value.trim()) document.querySelector('#detailTitle').value = this.node().title; this.settings.close(); }
    if (action === 'reset-color') this.setColor(DEFAULT_COLOR);
    if (action === 'hide-cover') { this.snapshot(); this.node().cover.hidden = true; this.renderSettings(); await this.changed(); }
    if (action === 'toggle-goal') { this.snapshot(); this.node().status = this.node().status === '已完成' ? '进行中' : '已完成'; this.renderSettings(); await this.changed(); }
    if (action === 'delete-node') { if (this.pending) { this.toast('媒体正在导入，请稍候'); return; } this.settings.close(); this.reader.close(); this.deleteNode(this.nodeId); }
    if (action === 'add-entry') this.startDraft();
    if (action === 'add-text') { this.draft().blocks.push(blankBlock()); this.renderComposer(); await this.saveDraft(); }
    if (action === 'close-composer') { await this.saveDraft(); this.composer.close(); this.renderReader(); }
    if (action === 'discard-draft' && !this.pending) {
      const draft = this.draft();
      const previousTrash = [...this.state.trash];
      const used = new Set(draft.blocks.flatMap((block) => block.mediaIds || []));
      if (entryHasContent(draft)) this.state.trash.push({ id: crypto.randomUUID(), kind: 'entry', nodeId: this.nodeId,
        value: { id: crypto.randomUUID(), createdAt: draft.createdAt, blocks: structuredClone(draft.blocks) }, media: draft.media.filter((media) => used.has(media.id)), deletedAt: new Date().toISOString() });
      for (const media of draft.media) if (!used.has(media.id) && !this.node().media.some((item) => item.id === media.id)) this.state.trash.push({ id: crypto.randomUUID(), kind: 'media', nodeId: this.nodeId, value: media, deletedAt: new Date().toISOString() });
      delete this.state.drafts[this.nodeId];
      if (!await this.save()) { this.state.drafts[this.nodeId] = draft; this.state.trash = previousTrash; return; }
      this.composer.close(); this.renderReader();
    }
    if (action === 'commit-entry') await this.commitDraft();
    if (action === 'retry-save') await this.save();
    if (action === 'close-viewer') this.viewer.close();
    if (action === 'previous-image') this.navigateImage(-1);
    if (action === 'next-image') this.navigateImage(1);
    if (action === 'download-original') {
      if (nativeApp) {
        el.disabled = true;
        try { await shareOriginal(this.viewing, (percent) => { document.querySelector('#viewerMessage').textContent = `准备原件 ${percent}%`; }); }
        catch (error) { if (error?.message !== 'Share canceled') throw error; }
        finally { el.disabled = !assetView(this.viewing).src; document.querySelector('#viewerMessage').textContent = ''; }
      } else { const a = document.createElement('a'); a.href = assetView(this.viewing).src; a.download = this.viewing.name || 'memory'; a.click(); }
    }
    if (action === 'video-cover') {
      await captureVideoPoster(this.viewing.id, this.viewer.querySelector('video'));
      this.node().cover = { mediaId: this.viewing.id, hidden: false, x: 50, y: 50, zoom: 1 };
      this.renderSettings(); await this.changed(); document.querySelector('#viewerMessage').textContent = '当前画面已设为封面，视频原件保留';
    }
    if (action === 'close-trash') this.trash.close();
    if (action === 'open-trash') this.showTrash();
  }
  move(array, id, step) { const index = array.findIndex((item) => typeof item === 'string' ? item === id : item.id === id); const to = index + step; if (index >= 0 && to >= 0 && to < array.length) [array[index], array[to]] = [array[to], array[index]]; }
}
