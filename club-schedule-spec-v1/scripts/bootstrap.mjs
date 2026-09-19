import { createInterface } from "node:readline/promises";
import { randomBytes, randomUUID, webcrypto } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";

const rl = createInterface({ input: stdin, output: stdout });
const name = (await rl.question("Initial manager display name: ")).trim();
const grade = Number(await rl.question("Grade (positive integer): "));
const year = Number(await rl.question("Registration year: "));
const campus = (await rl.question("Primary campus (omiya/hirakata): ")).trim();
rl.close();
if (
  !name ||
  name.length > 80 ||
  !Number.isInteger(grade) ||
  grade < 1 ||
  !Number.isInteger(year) ||
  year < 1900 ||
  year > 2200 ||
  !["omiya", "hirakata"].includes(campus)
) {
  throw new Error("Invalid initial user fields");
}
if (!stdin.isTTY)
  throw new Error(
    "Run interactively to keep the password out of shell history",
  );
stdout.write("Unique initial password (8-1024 characters): ");
stdin.setRawMode(true);
stdin.resume();
let password = "";
await new Promise((resolve, reject) => {
  const onData = (chunk) => {
    const text = chunk.toString();
    if (text === "\r" || text === "\n") {
      stdin.off("data", onData);
      resolve();
    } else if (text === "\u0003") reject(new Error("Cancelled"));
    else if (text === "\u007f") password = password.slice(0, -1);
    else password += text;
  };
  stdin.on("data", onData);
}).finally(() => {
  stdin.setRawMode(false);
  stdin.pause();
  stdout.write("\n");
});
if (password.length < 8 || password.length > 1024)
  throw new Error("Invalid password length");
const salt = randomBytes(16);
const key = await webcrypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(password),
  "PBKDF2",
  false,
  ["deriveBits"],
);
const hash = Buffer.from(
  await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 600_000 },
    key,
    256,
  ),
);
password = "";
const encoded = `pbkdf2-sha256$600000$${salt.toString("base64url")}$${hash.toString("base64url")}`;
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const now = new Date().toISOString();
const userId = randomUUID();
const roleId = randomUUID();
const sql = `INSERT INTO users (id,display_name,password_hash,grade,registration_year,primary_campus_id,created_at,updated_at)
VALUES (${quote(userId)},${quote(name)},${quote(encoded)},${grade},${year},${quote(campus)},${quote(now)},${quote(now)});
INSERT INTO roles (id,name,created_at,updated_at) VALUES (${quote(roleId)},'Initial manager',${quote(now)},${quote(now)});
INSERT INTO role_permissions (role_id,permission_key) VALUES (${quote(roleId)},'ROLE_MANAGE'),(${quote(roleId)},'USER_MANAGE'),(${quote(roleId)},'USER_PASSWORD_RESET');
INSERT INTO user_roles (user_id,role_id) VALUES (${quote(userId)},${quote(roleId)});
`;
const output = "bootstrap-local.sql";
await writeFile(output, sql, { flag: "wx", mode: 0o600 });
stdout.write(
  `Created ${output}. Apply to a local or approved non-production D1 database, then delete it.\n`,
);
