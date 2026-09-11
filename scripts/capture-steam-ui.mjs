const targets = await fetch('http://127.0.0.1:8080/json').then((response) => response.json());
const target = targets.find((candidate) => candidate.title === 'Steam');
if (!target) throw new Error('The visible Steam page was not found.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

const screenshot = await new Promise((resolve, reject) => {
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result.data);
  });
  socket.send(JSON.stringify({
    id: 1,
    method: 'Page.captureScreenshot',
    params: { format: 'png', captureBeyondViewport: false }
  }));
});

socket.close();
const outputPath = process.argv[2];
if (outputPath) {
  await writeFile(outputPath, Buffer.from(screenshot, 'base64'));
  console.log(outputPath);
} else {
  process.stdout.write(screenshot);
}
import { writeFile } from 'node:fs/promises';
