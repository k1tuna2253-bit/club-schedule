const encoder = new TextEncoder();
const ITERATIONS = 600_000;

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decode(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return encode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(value: string): Promise<string> {
  return encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: salt as BufferSource,
        iterations,
      },
      key,
      256,
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8 || password.length > 1024)
    throw new Error("Invalid password length");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${encode(salt)}$${encode(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (
    !Number.isInteger(iterations) ||
    iterations < 100_000 ||
    iterations > 2_000_000
  )
    return false;
  try {
    const salt = decode(parts[2]);
    const expected = decode(parts[3]);
    if (salt.length !== 16 || expected.length !== 32) return false;
    const actual = await derive(password, salt, iterations);
    let difference = 0;
    for (let i = 0; i < expected.length; i++)
      difference |= actual[i] ^ expected[i];
    return difference === 0;
  } catch {
    return false;
  }
}
