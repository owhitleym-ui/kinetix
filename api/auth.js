import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { findUserById } from "./db.js";

const JWT_SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Set JWT_SECRET in api/.env");
  return s;
};

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.userId,
      role: user.role,
      email: user.email,
      patientId: user.patientId || null,
    },
    JWT_SECRET(),
    { expiresIn: "7d" },
  );
}

export function publicUser(user) {
  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    patientId: user.patientId || null,
  };
}

/** Express middleware: require Bearer JWT. Attaches req.user. */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: "Authentication required" });
    }
    let payload;
    try {
      payload = jwt.verify(match[1], JWT_SECRET());
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    const user = await findUserById(payload.sub);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = publicUser(user);
    next();
  } catch (e) {
    console.error("requireAuth", e);
    res.status(500).json({ error: e.message });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
