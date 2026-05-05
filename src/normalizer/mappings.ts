import type { ActionCategory, ActionOperation } from "../types.js";

export type OpMapEntry = {
  category: ActionCategory;
  operation: ActionOperation;
};

export const SHELL_COMMAND_MAP: Record<string, OpMapEntry> = {
  rm: { category: "filesystem", operation: "delete" },
  del: { category: "filesystem", operation: "delete" },
  cat: { category: "filesystem", operation: "read" },
  less: { category: "filesystem", operation: "read" },
  head: { category: "filesystem", operation: "read" },
  tail: { category: "filesystem", operation: "read" },
  sed: { category: "filesystem", operation: "write" },
  tee: { category: "filesystem", operation: "write" },
  cp: { category: "filesystem", operation: "write" },
  mv: { category: "filesystem", operation: "write" },
  curl: { category: "network", operation: "connect" },
  wget: { category: "network", operation: "connect" },
  nc: { category: "network", operation: "connect" },
  ssh: { category: "network", operation: "connect" },
  node: { category: "process", operation: "execute" },
  python: { category: "process", operation: "execute" },
  python3: { category: "process", operation: "execute" },
  sh: { category: "process", operation: "execute" },
  bash: { category: "process", operation: "execute" },
  npm: { category: "process", operation: "execute" },
  npx: { category: "process", operation: "execute" },
  pnpm: { category: "process", operation: "execute" },
  yarn: { category: "process", operation: "execute" },
  bun: { category: "process", operation: "execute" },
  make: { category: "process", operation: "execute" },
};

export const PYTHON_CALL_MAP: Record<string, OpMapEntry> = {
  "os.remove": { category: "filesystem", operation: "delete" },
  "os.unlink": { category: "filesystem", operation: "delete" },
  "shutil.rmtree": { category: "filesystem", operation: "delete" },
  "Path.unlink": { category: "filesystem", operation: "delete" },
  "Path.write_text": { category: "filesystem", operation: "write" },
  "Path.read_text": { category: "filesystem", operation: "read" },
  "requests.get": { category: "network", operation: "connect" },
  "requests.post": { category: "network", operation: "connect" },
  "urllib.request": { category: "network", operation: "connect" },
  "subprocess.run": { category: "process", operation: "execute" },
  "os.system": { category: "process", operation: "execute" },
};

export const TYPESCRIPT_CALL_MAP: Array<{ pattern: RegExp; value: OpMapEntry }> = [
  { pattern: /\bfs\.(?:readFile|readFileSync|createReadStream)\b/, value: { category: "filesystem", operation: "read" } },
  { pattern: /\bfs\.(?:writeFile|writeFileSync|appendFile|appendFileSync)\b/, value: { category: "filesystem", operation: "write" } },
  { pattern: /\bfs\.(?:unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync)\b/, value: { category: "filesystem", operation: "delete" } },
  { pattern: /\bfetch\s*\(/, value: { category: "network", operation: "connect" } },
  { pattern: /\bhttps?\.request\s*\(/, value: { category: "network", operation: "connect" } },
  { pattern: /\bchild_process\.(?:exec|spawn|execSync|spawnSync)\b/, value: { category: "process", operation: "execute" } },
];
