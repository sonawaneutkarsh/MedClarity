import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import {
  getKeyStatusResponse,
  getGeminiResponse,
  getVerifyKeyResponse,
} from "./lib/gemini-server.js";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: "20mb" }));

  app.get("/api/key-status", async (req, res) => {
    const result = await getKeyStatusResponse();
    return res.status(result.status).json(result.body);
  });

  app.post("/api/gemini", async (req, res) => {
    const result = await getGeminiResponse(req.body);
    return res.status(result.status).json(result.body);
  });

  app.post("/api/gemini/verify", async (req, res) => {
    const result = await getVerifyKeyResponse(req.body);
    return res.status(result.status).json(result.body);
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}
