const { WebSocketServer } = require("ws");
const fs = require("fs");

const wss = new WebSocketServer({ port: process.env.PORT || 9080 });
const history = [];

// ---------- تيليجرام (ما يشتغل إلا مع TG_TOKEN) ----------
const TOKEN = process.env.TG_TOKEN;
const SHOW_TEXT = true; // false = يوصل "رسالة جديدة من فلان" بدون النص
const FILE = "/tmp/tg_users.json";
let tgUsers = {};
try {
  tgUsers = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch {}
function saveUsers() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(tgUsers));
  } catch {}
}

async function tg(method, body) {
  if (!TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch {
    return null;
  }
}

let offset = 0;
async function pollTelegram() {
  while (TOKEN) {
    const r = await tg("getUpdates", { offset, timeout: 30 });
    if (r && r.ok) {
      for (const u of r.result) {
        offset = u.update_id + 1;
        const m = u.message;
        if (!m || !m.text) continue;
        if (m.text.startsWith("/name ")) {
          const name = m.text.slice(6).trim().slice(0, 20);
          if (name) {
            tgUsers[name] = m.chat.id;
            saveUsers();
            await tg("sendMessage", { chat_id: m.chat.id, text: "تم الربط ✅" });
          }
        } else {
          await tg("sendMessage", {
            chat_id: m.chat.id,
            text: "اكتب: /name اسمك (نفس اسمك في التطبيق)",
          });
        }
      }
    } else {
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
}

function isOnline(name) {
  for (const c of wss.clients) {
    if (c.readyState === 1 && c.user === name) return true;
  }
  return false;
}

const lastNotify = {};
function notifyOffline(from, text) {
  const now = Date.now();
  for (const [name, chat] of Object.entries(tgUsers)) {
    if (name === from || isOnline(name)) continue;
    if (now - (lastNotify[name] || 0) < 30000) continue; // تنبيه واحد كل 30 ثانية
    lastNotify[name] = now;
    tg("sendMessage", {
      chat_id: chat,
      text: SHOW_TEXT ? `💬 ${from}: ${text}` : `💬 رسالة جديدة من ${from}`,
    });
  }
}

// ---------- عام ----------
function broadcast(obj) {
  const s = JSON.stringify(obj);
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(s);
  });
}

function sendTo(filter, obj) {
  const s = JSON.stringify(obj);
  wss.clients.forEach((c) => {
    if (c.readyState === 1 && filter(c)) c.send(s);
  });
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "history", items: history }));

  ws.on("message", (raw) => {
    let d;
    try {
      d = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (d.type === "join") {
      ws.user = String(d.user).slice(0, 20);
      broadcast({ type: "system", text: ws.user + " دخل" });
    } else if (d.type === "msg" && ws.user) {
      const text = String(d.text).slice(0, 500);
      if (!text.trim()) return;
      const m = { type: "msg", user: ws.user, text, time: Date.now() };
      history.push(m);
      if (history.length > 50) history.shift();
      broadcast(m);
      notifyOffline(ws.user, text);
    } else if (d.type === "admin") {
      if ((ws.fails || 0) >= 5) return;
      const ok = process.env.ADMIN_KEY && d.key === process.env.ADMIN_KEY;
      if (!ok) {
        ws.fails = (ws.fails || 0) + 1;
        ws.send(JSON.stringify({ type: "admin_fail" }));
        return;
      }
      if (d.cmd === "auth") {
        ws.send(JSON.stringify({ type: "admin_ok" }));
      } else if (d.cmd === "delete_chat") {
        history.length = 0;
        broadcast({ type: "history", items: [] });
        broadcast({ type: "system", text: "تم مسح المحادثة" });
      }
    } else if (d.type === "pos" && ws.user) {
      sendTo((c) => c !== ws && c.user, {
        type: "pos",
        user: ws.user,
        x: Number(d.x) || 0,
        y: Number(d.y) || 0,
        facing: String(d.facing),
        left: !!d.left,
        walking: !!d.walking,
        look: d.look || {},
      });
    } else if (d.type === "invite" && ws.user) {
      ws.room = ws.user;
      sendTo((c) => c !== ws, { type: "invite", from: ws.user });
    } else if (d.type === "join_draw" && ws.user) {
      ws.room = String(d.room).slice(0, 20);
      sendTo((c) => c !== ws && c.room === ws.room, { type: "peer_joined", user: ws.user });
    } else if ((d.type === "stroke" || d.type === "clear") && ws.room) {
      sendTo((c) => c !== ws && c.room === ws.room, { ...d, user: ws.user });
    }
  });

  ws.on("close", () => {
    if (ws.user) {
      broadcast({ type: "system", text: ws.user + " خرج" });
      broadcast({ type: "leave", user: ws.user });
    }
  });
});

console.log("Server running");
pollTelegram();
