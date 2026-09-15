export const config = {
    appName: 'SAP Tracker Automation',
    port: Number(process.env.PORT || 4000),
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    baseUrl: process.env.CP_BASE_URL || 'https://example.com',
    uploadDir: 'uploads',
    automationTimeoutMs: Number(process.env.AUTOMATION_TIMEOUT_MS || 120000)
};
