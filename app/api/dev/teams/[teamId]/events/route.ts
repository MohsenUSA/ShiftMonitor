import type { NextRequest } from 'next/server';
import { devStore } from '@/lib/server/devStore';
import { devHandler, requireUser } from '@/lib/server/devRoute';

/* Server-sent events: every write to the team is pushed to each open
   dashboard. Stands in for AppSync subscriptions during local development. */
export const GET = devHandler(async (req: NextRequest, ctx: RouteContext<'/api/dev/teams/[teamId]/events'>) => {
  const userId = requireUser(req);
  const { teamId } = await ctx.params;
  const enc = new TextEncoder();

  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try { controller.enqueue(enc.encode(chunk)); }
        catch { cleanup(); }
      };
      const unsubscribe = devStore().subscribe(userId, teamId, e => send(`data: ${JSON.stringify(e)}\n\n`));
      const ping = setInterval(() => send(': ping\n\n'), 15000);
      cleanup = () => { clearInterval(ping); unsubscribe(); };
      req.signal.addEventListener('abort', () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      });
      send(': connected\n\n');
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
});
