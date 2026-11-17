import { NextResponse } from "next/server";
import { getRequestContext } from "./request-context";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function isEmail(value: string) {
  return value.length <= 320 && EMAIL_PATTERN.test(value);
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function contextOr401() {
  const context = await getRequestContext();
  if (!context) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!context.isActive) {
    return NextResponse.json({ error: "Your workspace access has been deactivated." }, { status: 403 });
  }
  return context;
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

export function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function readJson(request: Request) {
  return await request.json().catch(() => null) as Record<string, unknown> | null;
}
