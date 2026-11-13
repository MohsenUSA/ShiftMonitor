import { NextResponse } from 'next/server';
import { devStore } from '@/lib/server/devStore';
import { DEV_COOKIE, body, devHandler } from '@/lib/server/devRoute';

export const GET = devHandler(async req => {
  const user = devStore().user(req.cookies.get(DEV_COOKIE)?.value);
  return NextResponse.json({ user });
});

/* Dev sign-in: email only, no password. Replaced by Cognito on AWS. */
export const POST = devHandler(async req => {
  const { email, name } = await body<{ email?: string; name?: string }>(req);
  const user = devStore().signIn(email || '', name || '');
  const res = NextResponse.json({ user });
  res.cookies.set(DEV_COOKIE, user.id, { httpOnly: true, sameSite: 'lax', path: '/' });
  return res;
});

export const DELETE = devHandler(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(DEV_COOKIE);
  return res;
});
