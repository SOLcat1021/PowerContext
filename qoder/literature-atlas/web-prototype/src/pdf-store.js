const DB_NAME = 'literature-axis-pdfs-v1';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, callback) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('files', mode);
      const request = callback(transaction.objectStore('files'));
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

export function savePdf(id, file) { return withStore('readwrite', (store) => store.put(file, id)); }
export function loadPdf(id) { return withStore('readonly', (store) => store.get(id)); }
export function deletePdf(id) { return withStore('readwrite', (store) => store.delete(id)); }
