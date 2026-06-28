import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getGeminiResponse } from "../lib/gemini-server.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const result = await getGeminiResponse(req.body);
  return res.status(result.status).json(result.body);
}
