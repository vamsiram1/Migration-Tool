import api from "./api";

export const runDockerMigration = (data) => api.post("/docker-run", data);
