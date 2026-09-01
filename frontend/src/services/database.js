import api from "./api";

export const testMysql = (data) =>
    api.post("/mysql/test", data);

export const testPostgres = (data) =>
    api.post("/postgres/test", data);

export const mysqlSchemas = (data) =>
    api.post("/mysql/schemas", data);

export const postgresSchemas = (data) =>
    api.post("/postgres/schemas", data);

export const postgresDatabases = (data) =>
    api.post("/postgres/databases", data);

export const mysqlTables = (data) =>
    api.post("/mysql/tables", data);

export const postgresTables = (data) =>
    api.post("/postgres/tables", data);

export const mysqlColumns = (data) =>
    api.post("/mysql/columns", data);

export const postgresColumns = (data) =>
    api.post("/postgres/columns", data);
