import { NextResponse, type NextRequest } from 'next/server';
import { HttpError, devStore } from './devStore.ts';

export const DEV_COOKIE = 'sm_dev_user';

/* The dev backend only answers in development, or when explicitly enabled
   (e.g. `next start` under the end-to-end tests). */
export function devBackendEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.SHIFTMONITOR_DEV_BACKEND === '1';
}

export function requireUser(req: NextRequest): string {
  const id = req.cookies.get(DEV_COOKIE)?.value;
  if (!devStore().user(id)) throw new HttpError(401, 'Not signed in.');
  return id!;
}

/* Wrap a handler: 404 when disabled, HttpErrors become JSON responses. */
export function devHandler<A extends unknown[]>(fn: (req: NextRequest, ...rest: A) => Promise<Response> | Response) {
  return async (req: NextRequest, ...rest: A): Promise<Response> => {
    if (!devBackendEnabled()) return new NextResponse('Not found', { status: 404 });
    try {
      return await fn(req, ...rest);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: 'Server error.' }, { status: 500 });
    }
  };
}

export async function body<T>(req: NextRequest): Promise<T> {
  try { return await req.json() as T; }
  catch { throw new HttpError(400, 'Invalid JSON body.'); }
}
