// MiniKnobsV bridge v4 — Two-Way Low-Latency MIDI (Output + Input Feedback) + mDNS
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const MDNS_HOST = 'phone-knobs';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.PK_DATA_DIR || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
const LAYOUT_FILE = path.join(DATA_DIR, 'layouts.v2.json');
const VIRTUAL_PORT_NAME = 'MiniKnobsV';

// ---------------------------------------------------------------- Two-Way MIDI

let wssRef = null;

function broadcastMidi(bytes) {
  if (!wssRef) return;
  const frame = Buffer.from(bytes);
  for (const client of wssRef.clients) {
    if (client.readyState === 1) client.send(frame, { binary: true });
  }
}

// DAW/plugin -> phone: forward CC and pitch bend to every connected phone
function attachFeedback(port) {
  port.on('cc', (msg) => {
    broadcastMidi([0xB0 | (msg.channel & 0x0F), msg.controller & 0x7F, msg.value & 0x7F]);
  });
  port.on('pitch', (msg) => {
    const val14 = Math.max(0, Math.min(16383, Math.round(msg.value)));
    broadcastMidi([0xE0 | (msg.channel & 0x0F), val14 & 0x7F, (val14 >> 7) & 0x7F]);
  });
}

function openMidi() {
  const wanted = (process.argv.find((a) => a.startsWith('--port=')) || '').slice(7)
    || process.env.MIDI_PORT || '';
  const wantedIn = (process.argv.find((a) => a.startsWith('--in=')) || '').slice(5)
    || process.env.MIDI_IN || '';

  let easymidi;
  try {
    easymidi = require('easymidi');
  } catch (err) {
    return consoleOutput('MIDI library could not load: ' + err.message);
  }

  try {
    const outputs = easymidi.getOutputs();
    let outPort, outName, inPort = null, inName = '';

    if (wanted) {
      const match = outputs.find((n) => n.toLowerCase().includes(wanted.toLowerCase()));
      if (!match) return consoleOutput(`Requested port "${wanted}" not found`);
      outPort = new easymidi.Output(match);
      outName = match;
    } else if (process.platform === 'win32') {
      const loop = outputs.find((n) => /loopmidi/i.test(n));
      if (!loop) return consoleOutput('No loopMIDI port found');
      outPort = new easymidi.Output(loop);
      outName = loop;
      // Feedback on Windows needs a SECOND loopMIDI port: the DAW sends to it, we listen to it.
      try {
        const inputs = easymidi.getInputs();
        const cand = inputs.find((n) => /loopmidi/i.test(n) && n !== loop &&
          (!wantedIn || n.toLowerCase().includes(wantedIn.toLowerCase())));
        if (cand) {
          inPort = new easymidi.Input(cand);
          inName = cand;
          attachFeedback(inPort);
        }
      } catch (_) { /* feedback optional */ }
    } else {
      // macOS / Linux: virtual MIDI Output AND virtual MIDI Input for DAW feedback
      outPort = new easymidi.Output(VIRTUAL_PORT_NAME, true);
      outName = VIRTUAL_PORT_NAME + ' (virtual)';
      try {
        inPort = new easymidi.Input(VIRTUAL_PORT_NAME, true);
        attachFeedback(inPort);
      } catch (_) { inPort = null; /* virtual input optional */ }
    }

    console.log(`MIDI out: ${outName}`);
    console.log(inPort
      ? `MIDI in (feedback): ${inName || VIRTUAL_PORT_NAME + ' (virtual)'}`
      : 'MIDI in (feedback): none');
    return {
      name: outName,
      live: true,
      feedback: !!inPort,
      sendCC(channel, controller, value) {
        outPort.send('cc', { channel: channel - 1, controller, value });
      },
      sendPitch(channel, value14) {
        outPort.send('pitch', { channel: channel - 1, value: value14 });
      },
      close() {
        try { outPort.close(); } catch (_) {}
        try { if (inPort) inPort.close(); } catch (_) {}
      },
    };
  } catch (err) {
    return consoleOutput('MIDI not available: ' + err.message.split('\n')[0]);
  }
}

function consoleOutput(reason) {
  console.log(`\n[test mode] ${reason}\n`);
  return {
    name: 'console (no MIDI)',
    live: false,
    feedback: false,
    sendCC(channel, controller, value) {
      console.log(`CC    ch ${String(channel).padStart(2)}  #${String(controller).padStart(3)}  val ${value}`);
    },
    sendPitch(channel, value14) {
      console.log(`PITCH ch ${String(channel).padStart(2)}  val14 ${value14}`);
    },
    close() {},
  };
}

const midi = openMidi();

// ------------------------------------------------------------- saved layouts

function readLayouts() {
  try { return JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8')); } catch (_) { return null; }
}

let saveTimer = null;
function writeLayouts(data) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // The layout format changed (v3). Keep a copy of the previous file once.
    try {
      const cur = readLayouts();
      if (cur && cur.v !== 3 && data && data.v === 3) {
        const bak = path.join(DATA_DIR, `layouts.v${cur.v || 1}-backup.json`);
        if (!fs.existsSync(bak)) fs.copyFileSync(LAYOUT_FILE, bak);
      }
    } catch (_) {}
    const tmp = LAYOUT_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(data, null, 2), (err) => {
      if (err) return console.error('Could not save layouts:', err.message);
      fs.rename(tmp, LAYOUT_FILE, (e) => e && console.error('Could not save layouts:', e.message));
    });
  }, 300);
}

// --------------------------------------------------------------- static files

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  if (req.socket) req.socket.setNoDelay(true);
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));

  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.on('connection', (socket) => socket.setNoDelay(true));

// ------------------------------------------------------------------ websocket

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 256 * 1024,
  perMessageDeflate: false,
});
wssRef = wss;

const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

wss.on('connection', (ws, req) => {
  if (req && req.socket) req.socket.setNoDelay(true);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.send(JSON.stringify({
    t: 'hello', midi: midi.name, live: midi.live, fb: !!midi.feedback, layouts: readLayouts(),
  }));

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      for (let i = 0; i + 2 < raw.length; i += 3) {
        const status = raw[i];
        const d1 = raw[i + 1];
        const d2 = raw[i + 2];
        const type = status & 0xF0;
        const ch = (status & 0x0F) + 1;

        if (type === 0xB0 && d1 < 128 && d2 < 128) {
          midi.sendCC(ch, d1, d2);
        } else if (type === 0xE0 && d1 < 128 && d2 < 128) {
          midi.sendPitch(ch, (d2 << 7) | d1);
        }
      }
      return;
    }

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'cc' && isInt(msg.ch, 1, 16) && isInt(msg.cc, 0, 127) && isInt(msg.v, 0, 127)) {
      midi.sendCC(msg.ch, msg.cc, msg.v);
    } else if (msg.t === 'save' && msg.layouts && typeof msg.layouts === 'object') {
      writeLayouts(msg.layouts);
    }
  });
});

const pingTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// -------------------------------------------------------------------- startup

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

let bonjourInstance = null;
function startMdns() {
  try {
    const { Bonjour } = require('bonjour-service');
    bonjourInstance = new Bonjour();
    bonjourInstance.publish({ name: 'MiniKnobsV', type: 'http', port: PORT, host: `${MDNS_HOST}.local` });
    return `http://${MDNS_HOST}.local:${PORT}`;
  } catch (_) {
    return null;
  }
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  const mdnsUrl = startMdns();
  console.log('\nMiniKnobsV is running.\n');
  if (mdnsUrl) console.log(`  App URL:  ${mdnsUrl}`);
  ips.forEach((ip) => console.log(`  Direct IP: http://${ip}:${PORT}`));
  try {
    require('qrcode-terminal').generate(mdnsUrl || `http://${ips[0]}:${PORT}`, { small: true });
  } catch (_) {}
  console.log('\nPress Ctrl+C to stop.\n');
});

function shutdown() {
  clearInterval(pingTimer);
  try { if (bonjourInstance) bonjourInstance.destroy(); } catch (_) {}
  midi.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
