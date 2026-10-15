const { WebSocketServer } = require("ws");

const wss = new WebSocketServer({ port: process.env.PORT || 9080 });
const history = [];

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
    if (ws.user) broadcast({ type: "system", text: ws.user + " خرج" });
  });
});

console.log("Server running");
