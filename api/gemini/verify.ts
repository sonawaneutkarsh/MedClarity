import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getVerifyKeyResponse } from "../../lib/gemini-server";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const result = await getVerifyKeyResponse(req.body);
  return res.status(result.status).json(result.body);
}
