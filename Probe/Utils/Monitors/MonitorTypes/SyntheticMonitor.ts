import { PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS } from "../../../Config";
import ProxyConfig from "../../ProxyConfig";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import { ChildProcess, fork } from "child_process";
import path from "path";

export interface SyntheticMonitorOptions {
  monitorId?: ObjectID | undefined;
  screenSizeTypes?: Array<ScreenSizeType> | undefined;
  browserTypes?: Array<BrowserType> | undefined;
  script: string;
  retryCountOnError?: number | undefined;
}

interface WorkerConfig {
  script: string;
  browserType: BrowserType;
  screenSizeType: ScreenSizeType;
  timeout: number;
  proxy?:
    | {
        server: string;
        username?: string | undefined;
        password?: string | undefined;
      }
    | undefined;
}

interface WorkerResult {
  logMessages: string[];
  scriptError?: string | undefined;
  result?: unknown | undefined;
  screenshots: Record<string, string>;
  executionTimeInMS: number;
}

export default class SyntheticMonitor {
  public static async execute(
    options: SyntheticMonitorOptions,
  ): Promise<Array<SyntheticMonitorResponse> | null> {
    const results: Array<SyntheticMonitorResponse> = [];

    for (const browserType of options.browserTypes || []) {
      for (const screenSizeType of options.screenSizeTypes || []) {
        logger.debug(
          `Running Synthetic Monitor: ${options?.monitorId?.toString()}, Screen Size: ${screenSizeType}, Browser: ${browserType}`,
        );

        const result: SyntheticMonitorResponse | null =
          await this.executeWithRetry({
            script: options.script,
            browserType: browserType,
            screenSizeType: screenSizeType,
            retryCountOnError: options.retryCountOnError || 0,
          });

        if (result) {
          result.browserType = browserType;
          result.screenSizeType = screenSizeType;
          results.push(result);
        }
      }
    }

    return results;
  }

  private static async executeWithRetry(options: {
    script: string;
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
    retryCountOnError: number;
    currentRetry?: number;
  }): Promise<SyntheticMonitorResponse | null> {
    const currentRetry: number = options.currentRetry || 0;
    const maxRetries: number = options.retryCountOnError;

    const result: SyntheticMonitorResponse | null =
      await this.executeByBrowserAndScreenSize({
        script: options.script,
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
      });

    // If there's an error and we haven't exceeded retry count, retry
    if (result?.scriptError && currentRetry < maxRetries) {
      logger.debug(
        `Synthetic Monitor script error, retrying (${currentRetry + 1}/${maxRetries}): ${result.scriptError}`,
      );

      // Wait a bit before retrying
      await new Promise((resolve: (value: void) => void) => {
        setTimeout(resolve, 1000);
      });

      return this.executeWithRetry({
        script: options.script,
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
        retryCountOnError: maxRetries,
        currentRetry: currentRetry + 1,
      });
    }

    return result;
  }

  private static getSanitizedEnv(): Record<string, string> {
    /*
     * Only pass safe environment variables to the worker process.
     * Explicitly exclude all secrets (DATABASE_PASSWORD, REDIS_PASSWORD,
     * CLICKHOUSE_PASSWORD, ONEUPTIME_SECRET, ENCRYPTION_SECRET, BILLING_PRIVATE_KEY, etc.)
     */
    const safeKeys: string[] = [
      "PATH",
      "HOME",
      "NODE_ENV",
      "PLAYWRIGHT_BROWSERS_PATH",
      "HTTP_PROXY_URL",
      "http_proxy",
      "HTTPS_PROXY_URL",
      "https_proxy",
      "NO_PROXY",
      "no_proxy",
    ];

    const env: Record<string, string> = {};

    for (const key of safeKeys) {
      if (process.env[key]) {
        env[key] = process.env[key]!;
      }
    }

    return env;
  }

  private static getProxyConfig(): WorkerConfig["proxy"] | undefined {
    if (!ProxyConfig.isProxyConfigured()) {
      return undefined;
    }

    const httpsProxyUrl: string | null = ProxyConfig.getHttpsProxyUrl();
    const httpProxyUrl: string | null = ProxyConfig.getHttpProxyUrl();
    const proxyUrl: string | null = httpsProxyUrl || httpProxyUrl;

    if (!proxyUrl) {
      return undefined;
    }

    const proxyConfig: WorkerConfig["proxy"] = {
      server: proxyUrl,
    };

    try {
      const parsedUrl: globalThis.URL = new URL(proxyUrl);
      if (parsedUrl.username && parsedUrl.password) {
        proxyConfig.username = parsedUrl.username;
        proxyConfig.password = parsedUrl.password;
      }
    } catch (error) {
      logger.warn(`Failed to parse proxy URL for authentication: ${error}`);
    }

    return proxyConfig;
  }

  private static async executeByBrowserAndScreenSize(options: {
    script: string;
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
  }): Promise<SyntheticMonitorResponse | null> {
    if (!options) {
      options = {
        script: "",
        browserType: BrowserType.Chromium,
        screenSizeType: ScreenSizeType.Desktop,
      };
    }

    const scriptResult: SyntheticMonitorResponse = {
      logMessages: [],
      scriptError: undefined,
      result: undefined,
      screenshots: {},
      executionTimeInMS: 0,
      browserType: options.browserType,
      screenSizeType: options.screenSizeType,
    };

    const timeout: number = PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS;

    const workerConfig: WorkerConfig = {
      script: options.script,
      browserType: options.browserType,
      screenSizeType: options.screenSizeType,
      timeout: timeout,
      proxy: this.getProxyConfig(),
    };

    try {
      const workerResult: WorkerResult = await this.forkWorker(
        workerConfig,
        timeout,
      );

      scriptResult.logMessages = workerResult.logMessages;
      scriptResult.scriptError = workerResult.scriptError;
      scriptResult.result = workerResult.result as typeof scriptResult.result;
      scriptResult.screenshots = workerResult.screenshots;
      scriptResult.executionTimeInMS = workerResult.executionTimeInMS;
    } catch (err: unknown) {
      logger.error(err);
      scriptResult.scriptError =
        (err as Error)?.message || (err as Error).toString();
    }

    return scriptResult;
  }

  private static async forkWorker(
    config: WorkerConfig,
    timeout: number,
  ): Promise<WorkerResult> {
    return new Promise(
      (
        resolve: (value: WorkerResult) => void,
        reject: (reason: Error) => void,
      ) => {
        const workerPath: string = path.resolve(
          __dirname,
          "SyntheticMonitorWorker",
        );

        const child: ChildProcess = fork(workerPath, [], {
          env: this.getSanitizedEnv(),
          execArgv: [...process.execArgv, "--max-old-space-size=512"], // preserve parent execArgv (e.g. ts-node/register) and limit worker heap
          timeout: timeout + 60000, // fork-level timeout: generous margin since the worker handles its own script timeout
          stdio: ["pipe", "pipe", "pipe", "ipc"],
        });

        let resolved: boolean = false;
        let stderrOutput: string = "";

        // Capture child stderr for debugging worker crashes
        if (child.stderr) {
          child.stderr.on("data", (data: Buffer) => {
            stderrOutput += data.toString();
          });
        }

        /**
         * Ensure the child process is always killed to prevent leaked processes.
         * The worker calls process.exit() on itself, but if that hangs (e.g.
         * browser cleanup holding a ref) the child would linger until the OS
         * reclaims it.  We send SIGTERM first to allow graceful shutdown, then
         * schedule a SIGKILL as a guaranteed cleanup.
         */
        const ensureChildKilled: () => void = (): void => {
          try {
            if (child.exitCode === null && child.signalCode === null) {
              // Child is still running — ask it to exit gracefully
              child.kill("SIGTERM");

              // If it doesn't exit within 5s, force-kill
              const forceKillTimer: ReturnType<typeof setTimeout> =
                global.setTimeout(() => {
                  try {
                    if (child.exitCode === null && child.signalCode === null) {
                      child.kill("SIGKILL");
                    }
                  } catch {
                    // ignore — process may have already exited
                  }
                }, 5000);

              // Don't let this timer keep the parent process alive
              if (forceKillTimer.unref) {
                forceKillTimer.unref();
              }
            }
          } catch {
            // ignore — process may have already exited
          }
        };

        // Explicit kill timer as final safety net (well beyond the worker's own safety timer)
        const killTimer: ReturnType<typeof setTimeout> = global.setTimeout(
          () => {
            if (!resolved) {
              resolved = true;
              try {
                child.kill("SIGKILL");
              } catch {
                // ignore — process may have already exited
              }
              reject(
                new Error("Synthetic monitor worker killed after timeout"),
              );
            }
          },
          timeout + 120000, // kill after script timeout + 120s (last resort)
        );

        child.on("message", (result: WorkerResult) => {
          if (!resolved) {
            resolved = true;
            global.clearTimeout(killTimer);
            // Kill the child in case it hangs during its own cleanup
            ensureChildKilled();
            resolve(result);
          }
        });

        child.on("error", (err: Error) => {
          if (!resolved) {
            resolved = true;
            global.clearTimeout(killTimer);
            // Kill the child — it errored but may still be running
            ensureChildKilled();
            reject(err);
          }
        });

        child.on("exit", (exitCode: number | null, signal: string | null) => {
          if (!resolved) {
            resolved = true;
            global.clearTimeout(killTimer);

            const stderrInfo: string = stderrOutput.trim()
              ? `: ${stderrOutput.trim().substring(0, 500)}`
              : "";

            if (exitCode === null) {
              // Process was killed by a signal (OOM, resource limits, or fork timeout)
              const signalInfo: string = signal ? ` (signal: ${signal})` : "";
              reject(
                new Error(
                  `Synthetic monitor worker was terminated by the system${signalInfo}. This is usually caused by high memory usage or resource limits in the container${stderrInfo}`,
                ),
              );
            } else if (exitCode !== 0) {
              reject(
                new Error(
                  `Synthetic monitor worker exited with code ${exitCode}${stderrInfo}`,
                ),
              );
            } else {
              reject(
                new Error(
                  `Synthetic monitor worker exited without sending results${stderrInfo}`,
                ),
              );
            }
          }
        });

        // Send config to worker via IPC
        child.send(config);
      },
    );
  }
}
