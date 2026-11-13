import { NextResponse, type NextRequest } from 'next/server';
import type { WriteOp } from '@/lib/model';
import { devStore } from '@/lib/server/devStore';
import { body, devHandler, requireUser } from '@/lib/server/devRoute';

export const POST = devHandler(async (req: NextRequest, ctx: RouteContext<'/api/dev/teams/[teamId]/ops'>) => {
  const userId = requireUser(req);
  const { teamId } = await ctx.params;
  const { ops, clientId } = await body<{ ops: WriteOp[]; clientId?: string }>(req);
  devStore().write(userId, teamId, ops, clientId || '');
  return NextResponse.json({ ok: true });
});
