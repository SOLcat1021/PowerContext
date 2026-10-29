import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

const DB_NAME = 'shiguang-local-memory';
let connection;
const urls = new Map();
const assets = new Map();

function database() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('documents');
      request.result.createObjectStore('assets', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = null; };
      resolve(request.result);
    };
    request.onerror = () => { connection = null; reject(request.error); };
    request.onblocked = () => reject(new Error('请关闭其他 GlimmerAxis 页面后重试'));
  });
  return connection;
}

async function transaction(store, mode, operation) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = operation(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () => reject(tx.error || new Error('本地写入中断'));
  });
}

export const readDocument = (key) => transaction('documents', 'readonly', (store) => store.get(key));
export const writeDocument = (key, value) => transaction('documents', 'readwrite', (store) => store.put(value, key));

function urlFor(key, blob) {
  if (!blob) return '';
  if (!urls.has(key)) urls.set(key, URL.createObjectURL(blob));
  return urls.get(key);
}

export async function resolveAsset(id) {
  if (!assets.has(id)) {
    const asset = await transaction('assets', 'readonly', (store) => store.get(id));
    if (asset) assets.set(id, asset);
  }
  const asset = assets.get(id);
  if (asset?.nativeFilePath && !asset.nativeUri) {
    const { uri } = await Filesystem.getUri({ path: asset.nativeFilePath, directory: Directory.Data });
    asset.nativeUri = Capacitor.convertFileSrc(uri);
  }
  return asset ? { ...asset, src: asset.nativeUri || urlFor(id, asset.blob), thumbnail: urlFor(`${id}:thumb`, asset.thumbnailBlob) } : null;
}

export function assetView(media) {
  const asset = assets.get(media?.id);
  if (!asset) return { ...media, src: media?.src || '', thumbnail: media?.kind === 'image' ? media?.src || '' : '', missing: !media?.src };
  return { ...media, src: asset.nativeUri || urlFor(asset.id, asset.blob), thumbnail: urlFor(`${asset.id}:thumb`, asset.thumbnailBlob),
    duration: asset.duration, width: asset.width, height: asset.height, previewError: asset.previewError, missing: false };
}

export async function hydrateAssets(state) {
  const ids = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'image' || value.kind === 'video') if (value.id) ids.add(value.id);
    Object.values(value).forEach(visit);
  };
  visit(state);
  await Promise.all([...ids].map((id) => resolveAsset(id)));
}

export async function deleteAsset(id) {
  const asset = assets.get(id) || await transaction('assets', 'readonly', (store) => store.get(id));
  if (asset?.nativeFilePath?.startsWith('media/') && !asset.nativeFilePath.split('/').includes('..')) {
    await Filesystem.deleteFile({ path: asset.nativeFilePath, directory: Directory.Data });
  }
  await transaction('assets', 'readwrite', (store) => store.delete(id));
  assets.delete(id);
  for (const key of [id, `${id}:thumb`]) {
    if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
    urls.delete(key);
  }
}

async function storeNativeOriginal(file, id) {
  const name = (file.name || `${id}.bin`).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  const path = `media/${id}/${name === '.' || name === '..' ? `${id}.bin` : name}`;
  const chunkSize = 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(reader.error || new Error('无法读取所选文件'));
      reader.readAsDataURL(file.slice(offset, offset + chunkSize));
    });
    if (offset === 0) await Filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Data });
  }
  if (!file.size) await Filesystem.writeFile({ path, data: '', directory: Directory.Data, recursive: true });
  return path;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('缩略图生成失败')), 'image/jpeg', .86));
}

function drawThumbnail(source, width, height) {
  const canvas = document.createElement('canvas');
  const ratio = Math.min(1, 720 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext('2d');
  context.fillStyle = '#131415'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvasBlob(canvas);
}

async function makePreview(file, kind) {
  const objectUrl = typeof file !== 'string';
  const src = objectUrl ? URL.createObjectURL(file) : file;
  const element = document.createElement(kind === 'video' ? 'video' : 'img');
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('此格式无法在当前浏览器预览，原件仍会保存')), 12000);
      element.onerror = () => reject(new Error('此格式无法在当前浏览器预览，原件仍会保存'));
      if (kind === 'video') {
        element.preload = 'auto'; element.muted = true;
        element.onloadeddata = () => resolve();
      } else element.onload = () => resolve();
      element.src = src;
    });
    const width = element.videoWidth || element.naturalWidth;
    const height = element.videoHeight || element.naturalHeight;
    return { thumbnailBlob: await drawThumbnail(element, width, height), width, height,
      duration: kind === 'video' && Number.isFinite(element.duration) ? element.duration : null };
  } finally {
    clearTimeout(timer);
    if (kind === 'video') { element.pause(); element.removeAttribute('src'); element.load(); }
    if (objectUrl) URL.revokeObjectURL(src);
  }
}

export async function importNativeAsset(file) {
  const existing = assets.get(file.id);
  if (!existing) {
    if (!/^media\/[\da-f-]+\/[^/\\]+$/i.test(file.nativeFilePath || '') || !/^(image|video)\//.test(file.type || '')) throw new Error('相册返回的媒体无效');
    let preview = {};
    try { preview = await makePreview(Capacitor.convertFileSrc(file.uri), file.kind); }
    catch (error) { preview.previewError = error.message; }
    const asset = { id: file.id, kind: file.kind, name: file.name, type: file.type, size: file.size,
      nativeFilePath: file.nativeFilePath, importedAt: new Date().toISOString(), capturedAt: null, ...preview };
    // Keep a copied original if metadata storage fails, so the import queue can retry it.
    await transaction('assets', 'readwrite', (store) => store.put(asset));
    assets.set(asset.id, asset);
  }
  const asset = assets.get(file.id);
  await resolveAsset(file.id);
  return { id: asset.id, kind: asset.kind, name: asset.name, type: asset.type, size: asset.size,
    importedAt: asset.importedAt, capturedAt: asset.capturedAt, duration: asset.duration, previewError: asset.previewError };
}

export async function importAsset(file) {
  if (!/^(image|video)\//.test(file.type)) throw new Error('请选择图片或视频文件');
  const kind = file.type.startsWith('video/') ? 'video' : 'image';
  let preview = {};
  try { preview = await makePreview(file, kind); }
  catch (error) { preview.previewError = error.message; }
  const asset = { id: crypto.randomUUID(), kind, name: file.name, type: file.type, size: file.size,
    importedAt: new Date().toISOString(), capturedAt: null, ...preview };
  if (Capacitor.isNativePlatform()) asset.nativeFilePath = await storeNativeOriginal(file, asset.id);
  else asset.blob = file;
  try { await transaction('assets', 'readwrite', (store) => store.put(asset)); }
  catch (error) {
    if (asset.nativeFilePath) await Filesystem.deleteFile({ path: asset.nativeFilePath, directory: Directory.Data }).catch(() => {});
    throw error;
  }
  assets.set(asset.id, asset);
  await resolveAsset(asset.id);
  return { id: asset.id, kind, name: asset.name, type: asset.type, size: asset.size,
    importedAt: asset.importedAt, capturedAt: asset.capturedAt, duration: asset.duration,
    previewError: asset.previewError };
}

export async function captureVideoPoster(id, video) {
  const asset = assets.get(id) || await transaction('assets', 'readonly', (store) => store.get(id));
  if (!asset || !video.videoWidth || video.readyState < 2) throw new Error('请先播放或定位到想要的画面');
  const updated = { ...asset, thumbnailBlob: await drawThumbnail(video, video.videoWidth, video.videoHeight) };
  await transaction('assets', 'readwrite', (store) => store.put(updated));
  const key = `${id}:thumb`;
  if (urls.has(key)) { URL.revokeObjectURL(urls.get(key)); urls.delete(key); }
  assets.set(id, updated);
}

// Runtime object URLs are revoked on unload; originals stay in local persistent storage.
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  urls.forEach((url) => URL.revokeObjectURL(url));
  urls.clear();
});
