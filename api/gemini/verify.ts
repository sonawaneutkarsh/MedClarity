import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getVerifyKeyResponse } from "../../lib/gemini-server.js";
import { clientKey, rateLimitedBody, verifyLimiter } from "../../lib/rate-limit.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const rl = verifyLimiter.check(clientKey(req.headers, req.socket?.remoteAddress || "unknown"));
  if (!rl.allowed) {
    res.setHeader("Retry-After", String(rl.retryAfterSeconds));
    return res.status(429).json(rateLimitedBody(rl.retryAfterSeconds));
  }
  const result = await getVerifyKeyResponse(req.body);
  return res.status(result.status).json(result.body);
}
