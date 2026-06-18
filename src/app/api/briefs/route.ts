import { NextResponse } from "next/server";
import { listBriefs } from "@/lib/store";

export async function GET() {
  try {
    const briefs = await listBriefs();
    return NextResponse.json(briefs);
  } catch (error) {
    return NextResponse.json({ error: "Failed to list briefs" }, { status: 500 });
  }
}