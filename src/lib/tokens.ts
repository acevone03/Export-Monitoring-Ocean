import { createHash, randomBytes, randomInt } from "node:crypto";

/** URL-safe random token (session cookies, field magic links). */
export const newToken = () => randomBytes(32).toString("base64url");

/** Tokens are stored hashed so a database leak does not leak live sessions or links. */
/** Readable temporary password (no 0/O/1/l/I), e.g. "K7m-Qp4x-Zt9r". */
export function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const s = Array.from({ length: 12 }, () => chars[randomInt(chars.length)]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
