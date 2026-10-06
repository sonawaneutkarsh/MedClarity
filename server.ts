import express from "express";
import path from "path";
import { getGeminiResponse, getVerifyKeyResponse } from "./lib/gemini-server.js";
import { clientKey, geminiLimiter, rateLimitedBody, verifyLimiter, type RateLimiter } from "./lib/rate-limit.js";

function limit(limiter: RateLimiter): express.RequestHandler {
  return (req, res, next) => {
    const result = limiter.check(clientKey(req.headers, req.socket.remoteAddress || "unknown"));
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      res.status(429).json(rateLimitedBody(result.retryAfterSeconds));
      return;
    }
    next();
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // Extracted PDF text only; the PDFs themselves never leave the browser.
  app.use("/api", express.json({ limit: "4mb" }));

  app.post("/api/gemini", limit(geminiLimiter), async (req, res) => {
    const result = await getGeminiResponse(req.body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/gemini/verify", limit(verifyLimiter), async (req, res) => {
    const result = await getVerifyKeyResponse(req.body);
    res.status(result.status).json(result.body);
  });

  if (process.env.NODE_ENV !== "production") {
    // Vite is a dev dependency, so load it only in development.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}
