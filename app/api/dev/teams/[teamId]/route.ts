import { NextResponse, type NextRequest } from 'next/server';
import { devStore } from '@/lib/server/devStore';
import { devHandler, requireUser } from '@/lib/server/devRoute';

export const GET = devHandler(async (req: NextRequest, ctx: RouteContext<'/api/dev/teams/[teamId]'>) => {
  const { teamId } = await ctx.params;
  return NextResponse.json(devStore().snapshot(requireUser(req), teamId));
});
