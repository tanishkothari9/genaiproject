import { NextResponse } from "next/server";
import { listBriefs } from "@/lib/store";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId") || undefined;
    const briefs = await listBriefs(sessionId);
    return NextResponse.json(briefs);
  } catch (error) {
    return NextResponse.json({ error: "Failed to list briefs" }, { status: 500 });
  }
}