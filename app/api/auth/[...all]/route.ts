import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";
import { ensureBootstrap } from "@/server/bootstrap";

export const GET = async (request: Request) => {
  await ensureBootstrap();
  return toNextJsHandler(getAuth()).GET(request);
};

export const POST = async (request: Request) => {
  await ensureBootstrap();
  return toNextJsHandler(getAuth()).POST(request);
};
