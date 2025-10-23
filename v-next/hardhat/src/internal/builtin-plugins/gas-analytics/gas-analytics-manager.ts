import type { GasAnalyticsManager, GasMeasurement } from "./types.js";
import type { TableItem } from "@nomicfoundation/hardhat-utils/format";

import crypto from "node:crypto";
import path from "node:path";

import { divider, formatTable } from "@nomicfoundation/hardhat-utils/format";
import {
  ensureDir,
  getAllFilesMatching,
  readJsonFile,
  remove,
  writeJsonFile,
} from "@nomicfoundation/hardhat-utils/fs";
import chalk from "chalk";
import debug from "debug";

const gasStatsLog = debug(
  "hardhat:core:gas-analytics:gas-analytics-manager:gas-stats",
);

interface GasStats {
  min: number;
  max: number;
  avg: number;
  median: number;
  calls: number;
}

export class GasAnalyticsManagerImplementation implements GasAnalyticsManager {
  public gasMeasurements: GasMeasurement[] = [];
  readonly #gasStatsPath: string;
  #gasStatsReportEnabled = true;

  constructor(gasStatsPath: string) {
    this.#gasStatsPath = gasStatsPath;
  }

  public addGasMeasurement(gasMeasurement: GasMeasurement): void {
    this.gasMeasurements.push(gasMeasurement);

    gasStatsLog(
      "Added gas measurement",
      JSON.stringify(gasMeasurement, null, 2),
    );
  }

  public async clearGasMeasurements(id: string): Promise<void> {
    const gasMeasurementsPath = await this.#getGasMeasurementsPath(id);
    await remove(gasMeasurementsPath);
    this.gasMeasurements = [];
    gasStatsLog("Cleared gas measurements from disk and memory");
  }

  public async saveGasMeasurements(id: string): Promise<void> {
    const gasMeasurementsPath = await this.#getGasMeasurementsPath(id);
    const filePath = path.join(
      gasMeasurementsPath,
      `${crypto.randomUUID()}.json`,
    );
    await writeJsonFile(filePath, this.gasMeasurements);
    gasStatsLog("Saved gas measurements", id, filePath);
  }

  public async reportGasStats(...ids: string[]): Promise<void> {
    if (!this.#gasStatsReportEnabled) {
      return;
    }

    await this._loadGasMeasurements(...ids);

    const gasStatsReport = this._calculateGasStats();

    // TODO size: only for deployments
    const markdownReport = this._formatGasStatsMarkdownReport(gasStatsReport);

    console.log(markdownReport);
    gasStatsLog("Printed markdown report");
  }

  public enableGasStatsReport(): void {
    this.#gasStatsReportEnabled = true;
  }

  public disableGasStatsReport(): void {
    this.#gasStatsReportEnabled = false;
  }

  async #getGasMeasurementsPath(id: string): Promise<string> {
    const dataPath = path.join(this.#gasStatsPath, "gas-stats", id);
    await ensureDir(dataPath);
    return dataPath;
  }

  /**
   * @private exposed for testing purposes only
   */
  public async _loadGasMeasurements(...ids: string[]): Promise<void> {
    this.gasMeasurements = [];
    for (const id of ids) {
      const gasStatsPath = await this.#getGasMeasurementsPath(id);
      const filePaths = await getAllFilesMatching(gasStatsPath);
      for (const filePath of filePaths) {
        const entries = await readJsonFile<GasMeasurement[]>(filePath);
        for (const entry of entries) {
          this.gasMeasurements.push(entry);
        }
        gasStatsLog("Loaded gas measurements", id, filePath);
      }
    }
  }

  /**
   * @private exposed for testing purposes only
   */
  public _calculateGasStats(): Map<string, Map<string, GasStats>> {
    const report: Map<string, Map<string, GasStats>> = new Map();
    const measurementsByContract = this._aggregateGasMeasurements();

    for (const [contractFqn, measurements] of measurementsByContract) {
      const contractGasStats = new Map<string, GasStats>();

      for (const [functionOrDeployment, gasValues] of measurements) {
        const stats: GasStats = {
          min: Math.min(...gasValues),
          max: Math.max(...gasValues),
          avg: avg(gasValues),
          median: median(gasValues),
          calls: gasValues.length,
          // TODO size: only for deployments
        };

        contractGasStats.set(functionOrDeployment, stats);
      }

      report.set(contractFqn, contractGasStats);
    }

    return report;
  }

  /**
   * @private exposed for testing purposes only
   */
  public _aggregateGasMeasurements(): Map<string, Map<string, number[]>> {
    const measurementsByContract = new Map<
      string,
      Map<string, number[]> // functionSig or "deployment"
    >();

    for (const currentMeasurement of this.gasMeasurements) {
      let contractMeasurements = measurementsByContract.get(
        currentMeasurement.contractFqn,
      );
      if (contractMeasurements === undefined) {
        contractMeasurements = new Map<string, number[]>();
        measurementsByContract.set(
          currentMeasurement.contractFqn,
          contractMeasurements,
        );
      }

      const key =
        currentMeasurement.type === "deployment"
          ? "deployment"
          : currentMeasurement.functionSig;

      let measurements = contractMeasurements.get(key);
      if (measurements === undefined) {
        measurements = [];
        contractMeasurements.set(key, measurements);
      }

      measurements.push(currentMeasurement.gas);
    }

    return measurementsByContract;
  }

  /**
   * @private exposed for testing purposes only
   */
  public _formatGasStatsMarkdownReport(
    gasStatsReport: Map<string, Map<string, GasStats>>,
  ): string {
    const rows: TableItem[] = [];
    for (const [contractFqn, contractGasStats] of gasStatsReport) {
      rows.push([chalk.cyan.bold(getUserFqn(contractFqn))]);
      rows.push(divider);

      const deploymentGasStats = contractGasStats.get("deployment");
      if (deploymentGasStats !== undefined) {
        rows.push(
          ["Deployment Cost", "Deployment Size"].map((s) => chalk.yellow(s)),
        );
        rows.push([`${deploymentGasStats.avg}`, ""]);
      }

      rows.push(
        ["Function name", "Min", "Average", "Median", "Max", "#calls"].map(
          (s) => chalk.yellow(s),
        ),
      );

      for (const [functionOrDeployment, gasStats] of contractGasStats) {
        if (functionOrDeployment !== "deployment") {
          rows.push([
            functionOrDeployment,
            `${gasStats.min}`,
            `${gasStats.avg}`,
            `${gasStats.median}`,
            `${gasStats.max}`,
            `${gasStats.calls}`,
          ]);
        }
      }
      rows.push([]);
    }

    return formatTable(rows);
  }
}

export function avg(values: number[]): number {
  return values.reduce((a, c) => a + c, 0) / values.length;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function getUserFqn(inputFqn: string): string {
  if (inputFqn.startsWith("project/")) {
    return inputFqn.slice("project/".length);
  }

  if (inputFqn.startsWith("npm/")) {
    const withoutPrefix = inputFqn.slice("npm/".length);
    // Match "<pkg>@<version>/<rest>", where <pkg> may be scoped (@scope/pkg)
    const match = withoutPrefix.match(/^(@?[^@/]+(?:\/[^@/]+)*)@[^/]+\/(.*)$/);
    if (match !== null) {
      return `${match[1]}/${match[2]}`;
    }
    return withoutPrefix;
  }

  return inputFqn;
}
