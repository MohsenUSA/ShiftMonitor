import { NextResponse } from 'next/server';
import { devStore } from '@/lib/server/devStore';
import { body, devHandler, requireUser } from '@/lib/server/devRoute';

export const GET = devHandler(async req => {
  return NextResponse.json({ teams: devStore().listTeams(requireUser(req)) });
});

export const POST = devHandler(async req => {
  const userId = requireUser(req);
  const { name } = await body<{ name?: string }>(req);
  return NextResponse.json({ team: devStore().createTeam(userId, name || '') });
});
