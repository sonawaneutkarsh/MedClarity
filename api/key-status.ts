import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getKeyStatusResponse } from "../lib/gemini-server";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const result = await getKeyStatusResponse();
  return res.status(result.status).json(result.body);
}
