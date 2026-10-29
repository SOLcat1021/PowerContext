import { Capacitor, registerPlugin } from '@capacitor/core';

const MediaPicker = registerPlugin('MediaPicker');
export const nativeMediaPicker = Capacitor.isNativePlatform();

export function pickNativeMedia() { return MediaPicker.pickMedia(); }

export function pickBrowserMedia(input) {
  return new Promise((resolve, reject) => {
    let timer, blurred = false;
    const cleanup = () => {
      clearTimeout(timer); input.removeEventListener('change', selected); input.removeEventListener('cancel', cancelled);
      window.removeEventListener('focus', focused);
      window.removeEventListener('blur', onBlur);
    };
    const selected = () => {
      const files = [...input.files].filter((file) => /^(image|video)\//.test(file.type));
      cleanup(); input.value = ''; resolve({ files, cancelled: files.length === 0 });
    };
    const cancelled = () => { cleanup(); resolve({ files: [], cancelled: true }); };
    // Older browsers omit input.cancel; focus returns after their system dialog is dismissed.
    const onBlur = () => { blurred = true; };
    const focused = () => { if (blurred) timer = setTimeout(selected, 700); };
    input.addEventListener('change', selected, { once: true }); input.addEventListener('cancel', cancelled, { once: true });
    window.addEventListener('blur', onBlur, { once: true }); window.addEventListener('focus', focused);
    try { input.click(); } catch (error) { cleanup(); reject(error); }
  });
}
