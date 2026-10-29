import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { resolveAsset } from './media-store.js';

export const nativeApp = Capacitor.isNativePlatform();

function base64Chunk(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function shareOriginal(media, onProgress) {
  const asset = await resolveAsset(media.id);
  const name = (media.name || 'memory').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  const path = `glimmeraxis-exports/${crypto.randomUUID()}/${name}`;
  if (asset?.nativeFilePath) {
    await Filesystem.mkdir({ path: path.slice(0, path.lastIndexOf('/')), directory: Directory.Cache, recursive: true });
    await Filesystem.copy({ from: asset.nativeFilePath, directory: Directory.Data, to: path, toDirectory: Directory.Cache });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    await Share.share({ title: media.name || 'GlimmerAxis 原件', files: [uri], dialogTitle: '分享或保存记忆原件' });
    return;
  }
  const blob = asset?.blob || (media.src ? await (await fetch(media.src)).blob() : null);
  if (!blob) throw new Error('原件不存在，请重新导入');
  const chunkSize = 1024 * 1024;
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const data = await base64Chunk(blob.slice(offset, offset + chunkSize));
    if (offset === 0) await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
    onProgress?.(Math.round(Math.min(blob.size, offset + chunkSize) / blob.size * 100));
  }
  if (!blob.size) await Filesystem.writeFile({ path, data: '', directory: Directory.Cache, recursive: true });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  // Keep this cache copy available while the receiving application reads the shared URI.
  // Android can reclaim it as cache; the original asset stays in the private database.
  await Share.share({ title: media.name || 'GlimmerAxis 原件', files: [uri], dialogTitle: '分享或保存记忆原件' });
}
