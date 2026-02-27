export interface ExternalStatusPageComponentStatus {
  name: string;
  status: string;
  description?: string | undefined;
}

export default interface ExternalStatusPageMonitorResponse {
  isOnline: boolean;
  overallStatus: string;
  componentStatuses: Array<ExternalStatusPageComponentStatus>;
  activeIncidentCount: number;
  responseTimeInMs: number;
  failureCause: string;
  rawBody?: string | undefined;
  isTimeout?: boolean | undefined;
}
