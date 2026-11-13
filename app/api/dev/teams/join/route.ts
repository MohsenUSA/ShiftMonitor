import { NextResponse } from 'next/server';
import { devStore } from '@/lib/server/devStore';
import { body, devHandler, requireUser } from '@/lib/server/devRoute';

export const POST = devHandler(async req => {
  const userId = requireUser(req);
  const { code } = await body<{ code?: string }>(req);
  return NextResponse.json({ team: devStore().joinTeam(userId, code || '') });
});
