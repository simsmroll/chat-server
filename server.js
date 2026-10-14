const { WebSocketServer } = require("ws");

const wss = new WebSocketServer({ port: process.env.PORT || 9080 });
const history = [];

function broadcast(obj) {
  const s = JSON.stringify(obj);
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(s);
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
    }
  });

  ws.on("close", () => {
    if (ws.user) broadcast({ type: "system", text: ws.user + " خرج" });
  });
});

console.log("Server running");
