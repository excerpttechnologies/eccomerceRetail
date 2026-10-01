import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { parseBody } from "@/lib/api/body";
import { fail, handler, ok } from "@/lib/api/response";
import { audit } from "@/lib/audit";
import { ADMIN_COOKIE, cookieOptions, signSession, type AdminSession } from "@/lib/auth";
import { getWebConnection } from "@/lib/db";
import { AdminUserModel, RoleModel, type Permission } from "@/models/web/commerce.models";

export const dynamic = "force-dynamic";
const TWELVE_HOURS = 60 * 60 * 12;

export const POST = handler(async (req: NextRequest) => {
  const b = await parseBody(req, z.object({ email: z.string().email(), password: z.string().min(1) }));
  if (!b.ok) return b.res;
  const conn = await getWebConnection();
  const Users = AdminUserModel(conn);
  const user = await Users.findOne({ email: b.data.email.toLowerCase() });
  const generic = () => fail("INVALID_CREDENTIALS", "Incorrect email or password", 401);
  if (!user || !user.isActive) return generic();
  if (user.lockedUntil && user.lockedUntil > new Date()) return fail("LOCKED", "Account locked after repeated failures. Try again in 15 minutes.", 423);
  if (!(await bcrypt.compare(b.data.password, user.passwordHash))) {
    const failed = (user.failedAttempts ?? 0) + 1;
    await Users.updateOne({ _id: user._id }, { $set: { failedAttempts: failed, ...(failed >= 5 ? { lockedUntil: new Date(Date.now() + 15 * 60_000) } : {}) } });
    return generic();
  }
  const role = await RoleModel(conn).findById(user.roleId).lean();
  const session: AdminSession = { kind: "admin", sub: String(user._id), email: user.email, name: user.name, role: role?.slug ?? "staff", permissions: (role?.permissions ?? []) as Permission[] };
  const token = await signSession(session, `${TWELVE_HOURS}s`);
  (await cookies()).set(ADMIN_COOKIE, token, cookieOptions(TWELVE_HOURS));
  await Users.updateOne({ _id: user._id }, { $set: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }, $push: { sessions: { $each: [{ id: token.slice(-16), ip: req.headers.get("x-forwarded-for") ?? "", userAgent: req.headers.get("user-agent") ?? "", createdAt: new Date(), lastSeenAt: new Date() }], $slice: -10 } } });
  await audit(session, "auth.login", "adminUser", user._id, undefined, undefined, req);
  return ok({ name: user.name, email: user.email, role: session.role, permissions: session.permissions });
});
