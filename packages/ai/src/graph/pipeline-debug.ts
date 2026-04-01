/** Set `PIPELINE_DEBUG=1` in the environment to log checkpoint / resume diagnostics (server-side only). */
export function pipelineDebug(message: string, details?: Record<string, unknown>): void {
  if (process.env.PIPELINE_DEBUG !== "1") {
    return;
  }
  if (details && Object.keys(details).length > 0) {
    console.info(`[pipeline] ${message}`, details);
  } else {
    console.info(`[pipeline] ${message}`);
  }
}
