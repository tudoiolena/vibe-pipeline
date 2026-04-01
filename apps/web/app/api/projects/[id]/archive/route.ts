import { createClient, getProjectById, updateProjectById } from "@vibe/database";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const client = createClient();

  const { data: project, error: loadError } = await getProjectById(client, id);
  if (loadError) {
    return NextResponse.json({ error: `Failed to load project: ${loadError.message}` }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const { error: updateError } = await updateProjectById(client, id, { status: "archived" });
  if (updateError) {
    return NextResponse.json({ error: `Failed to archive project: ${updateError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
