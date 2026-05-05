import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { loadConfig } from "../src/config.js";
import { SAFPipeline } from "../src/saf.js";

interface ScenarioRecord {
  name?: string;
  payload?: string;
  goal?: string;
  action?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadScenarios(fileName: string): Promise<ScenarioRecord[]> {
  const filePath = path.resolve(__dirname, `../tests/scenarios/${fileName}`);
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as ScenarioRecord[];
}

async function run(): Promise<void> {
  const config = await loadConfig(path.resolve(__dirname, "../configs/saf-config.json"));
  const saf = await SAFPipeline.create(config);

  const scenarioFiles = ["injection-payloads.json", "evasion-payloads.json", "drift-scenarios.json"];
  const rows: Array<{ file: string; name: string; verdict: string; reason: string }> = [];

  for (const fileName of scenarioFiles) {
    const scenarios = await loadScenarios(fileName);
    for (const scenario of scenarios) {
      const command = scenario.payload ?? scenario.action ?? "";
      const goal = scenario.goal ?? "evaluate scenario";
      const result = await saf.evaluate({
        toolName: "bash",
        rawArgs: { command },
        userGoal: goal,
      });

      rows.push({
        file: fileName,
        name: scenario.name ?? scenario.goal ?? "unnamed",
        verdict: result.verdict,
        reason: result.reason,
      });
    }
  }

  for (const row of rows) {
    console.log(`${row.file}\t${row.name}\t${row.verdict}\t${row.reason}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
