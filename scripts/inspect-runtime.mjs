const targets = await fetch('http://127.0.0.1:8080/json').then(r => r.json());
const target = targets.find(t => t.title === 'SharedJSContext');
if (!target) throw new Error('SharedJSContext indisponível');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const timer = setTimeout(() => { socket.close(); process.exitCode = 1; }, 20000);
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id !== 1) return;
  console.log(JSON.stringify(message.result ?? message.error, null, 2));
  clearTimeout(timer); socket.close();
};
socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
  expression: process.argv[2], returnByValue: true, awaitPromise: true
} }));
