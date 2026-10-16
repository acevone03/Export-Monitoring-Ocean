import { createHash, randomBytes } from "node:crypto";

/** URL-safe random token (session cookies, field magic links). */
export const newToken = () => randomBytes(32).toString("base64url");

/** Tokens are stored hashed so a database leak does not leak live sessions or links. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
