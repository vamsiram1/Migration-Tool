import api from "./api";

export const runDockerMigration = (data) => api.post("/docker-run", data, { timeout: 0 });

export const cancelDockerMigration = () => api.post("/docker-run/cancel");

