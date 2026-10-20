'use strict';

/**
 * Minimal CDP client for inspecting the running app.
 *
 *   node _re/cdp.js eval "navigator.userAgent"
 *   node _re/cdp.js shot _re/shot.png
 *   node _re/cdp.js clicktext "登录"
 *
 * Requires the app to be running with --remote-debugging-port=9222.
 */

const http = require('http');
const fs = require('fs');

const PORT = Number(process.env.CDP_PORT || 9222);

function getJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();

    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          ws.close();
        },
        raw: ws
      });
    });

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });

    ws.addEventListener('error', (err) => reject(new Error('ws error: ' + err.message)));
  });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const targets = await getJson('/json/list');
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const client = await connect(page.webSocketDebuggerUrl);

  await client.send('Runtime.enable');

  if (command === 'targets') {
    console.log(JSON.stringify(targets.map((t) => ({ title: t.title, url: t.url })), null, 2));
  } else if (command === 'eval') {
    const expression = rest.join(' ');
    const result = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      console.error('EXCEPTION:', JSON.stringify(result.exceptionDetails.exception && result.exceptionDetails.exception.description || result.exceptionDetails.text));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(result.result.value, null, 2));
    }
  } else if (command === 'shot') {
    const out = rest[0] || 'shot.png';
    const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    console.log('wrote ' + out);
  } else if (command === 'clicktext') {
    const text = rest.join(' ');
    const expression = `(() => {
      const wanted = ${JSON.stringify(text)};
      const nodes = [...document.querySelectorAll('button, a, [role="button"], span, div')];
      const hit = nodes.reverse().find((n) => (n.innerText || '').trim() === wanted && n.offsetParent !== null)
        || nodes.reverse().find((n) => (n.innerText || '').includes(wanted) && n.offsetParent !== null);
      if (!hit) return { clicked: false };
      hit.click();
      return { clicked: true, tag: hit.tagName, text: (hit.innerText || '').trim().slice(0, 60) };
    })()`;
    const result = await client.send('Runtime.evaluate', { expression, returnByValue: true });
    console.log(JSON.stringify(result.result.value, null, 2));
  } else {
    console.error('usage: targets | eval <expr> | shot <file> | clicktext <text>');
    process.exitCode = 1;
  }

  client.close();
  setTimeout(() => process.exit(process.exitCode || 0), 50);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
