import fs from 'node:fs/promises';

const port = Number(process.env.CDP_PORT || 9223);
const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((item) => item.type === 'page' && item.url === 'about:blank') || pages.find((item) => item.type === 'page' && item.url.startsWith('http://localhost:4173/'));
if (!page?.webSocketDebuggerUrl) throw new Error('No CDP page found');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 1;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  message.error ? reject(new Error(message.error.message)) : resolve(message.result);
};
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
await send('Page.enable');
await send('Runtime.enable');
const width = Number(process.env.SMOKE_WIDTH || 1440);
const height = Number(process.env.SMOKE_HEIGHT || 900);
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 720 });
await send('Page.navigate', { url: 'http://localhost:4173/' });
let ready = false;
for (let attempt = 0; attempt < 80; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  ready = await evaluate('!!document.querySelector("#literatureQa")');
  if (ready) break;
}
if (!ready) throw new Error(`App failed to load: ${await evaluate('document.body.innerText.slice(0,500)')}`);
await new Promise((resolve) => setTimeout(resolve, 1300));
const initial = await evaluate('({title: document.title, nodes: new Set([...document.querySelectorAll("[data-node-id]")].map((element) => element.dataset.nodeId)).size, qa: !!document.querySelector("#literatureQa.qa-open"), ribbon: !document.querySelector("#demoRibbon").hidden, body: document.body.innerText.slice(0,500)})');
console.log('Initial:', JSON.stringify(initial));
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await fs.writeFile(process.env.SCREENSHOT || 'smoke-desktop.png', Buffer.from(screenshot.data, 'base64'));
await evaluate('document.querySelector("[data-qa-prompt]").click()');
await new Promise((resolve) => setTimeout(resolve, 500));
const answer = await evaluate('({messages: document.querySelectorAll(".qa-message").length, sources: document.querySelectorAll("[data-qa-source]").length, text: document.querySelector(".qa-message.answer")?.innerText.slice(0,120)})');
console.log('Question:', JSON.stringify(answer));
await evaluate('document.querySelector("[data-qa-source]").click()');
const source = await evaluate('({visible: !document.querySelector("#inspector").hidden, original: !!document.querySelector("#inspector .research-source a")})');
console.log('Source:', JSON.stringify(source));
await evaluate('document.querySelector("[data-action=show-personal]").click()');
const personal = await evaluate('({ribbon: document.querySelector("#demoRibbon").hidden, context: document.querySelector("#qaContext").innerText, count: document.querySelector("#researchCount").innerText})');
console.log('Personal:', JSON.stringify(personal));
socket.close();
if (initial.qa !== (width > 1050) || !initial.ribbon || initial.nodes !== 9 || answer.messages < 2 || answer.sources < 1 || !source.visible || !source.original || !personal.ribbon) process.exitCode = 1;
