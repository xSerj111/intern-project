export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface IHealthStatus {
  status: HealthStatus;
}

export interface IHealthCheckResult {
  status: "up" | "down";
  critical: boolean;
  latencyMs: number;
  // Short class name or message only, never connection strings.
  error?: string;
}

export interface IHealthReport {
  status: HealthStatus;
  service: string;
  checkedAt: string;
  checks: Record<string, IHealthCheckResult>;
}
