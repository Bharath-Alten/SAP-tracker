export const config = {
  appName: 'SAP Tracker Automation',
  port: Number(process.env.PORT || 4000),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  baseUrl: process.env.CP_BASE_URL || 'https://example.com',
  uploadDir: 'uploads',
  // A run waits for the user to sign in to SAP and then writes every grid row, so the
  // ceiling has to be generous: 20 minutes, overridable with AUTOMATION_TIMEOUT_MS.
  automationTimeoutMs: Number(process.env.AUTOMATION_TIMEOUT_MS || 1200000)
};
