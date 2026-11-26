import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}
const source = (await files(fileURLToPath(new URL("../src", import.meta.url)))).filter((file) => /\.[tj]sx?$/.test(file));
const forbidden = [/dangerouslySetInnerHTML/, /\bconsole\.(log|debug)\b/, /:\s*any\b/];
for (const file of source) {
  const content = await readFile(file, "utf8");
  for (const rule of forbidden) if (rule.test(content)) throw new Error(`Admin lint: ${rule} em ${file}`);
}
console.log(`admin lint: ${source.length} arquivo(s) verificado(s)`);
