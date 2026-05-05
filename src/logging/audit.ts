import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

import pino from "pino";

import type { ActionRecord } from "../types.js";

export class AuditLogger {
  private readonly logger = pino({
    level: "info",
    base: undefined,
    timestamp: pino.stdTimeFunctions.epochTime,
  });

  public constructor(private readonly logPath: string) {}

  public async log(record: ActionRecord): Promise<void> {
    this.logger.info(record, "SAF evaluation");

    const dir = path.dirname(this.logPath);
    await mkdir(dir, { recursive: true });
    await appendFile(this.logPath, `${JSON.stringify(record)}\n`, "utf8");
  }
}
