import api from "./api";

export const discoverRelatedTables = async (data) => {
  try {
    return await api.post("/postgres/id-remap/discover-tables", {
      connection: data.connection,
      parent_table: data.parent_table,
      target_schema: data.target_schema,
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return await api.post("/postgres/id-remap/preview", {
        connection: data.connection,
        parent_table: data.parent_table,
        target_schemas:
          data.target_schema && data.target_schema !== "__ALL__"
            ? [data.target_schema]
            : [],
      });
    }
    throw err;
  }
};

export const previewIdRemap = (data) =>
  api.post("/postgres/id-remap/preview", data);

export const executeIdRemap = (data) =>
  api.post("/postgres/id-remap/execute", data);

export const revertIdRemap = (data) =>
  api.post("/postgres/id-remap/revert", data);

export const fetchRemapHistory = (connection) =>
  api.post("/postgres/id-remap/history", { connection });
