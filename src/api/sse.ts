import { Router, type Request, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { addSSEClient } from "./events.js";

const router = Router();

router.get("/", requireAuth, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ userId })}\n\n`);

  addSSEClient(userId, res);

  const keepAlive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 30_000);

  req.on("close", () => {
    clearInterval(keepAlive);
  });
});

export default router;
