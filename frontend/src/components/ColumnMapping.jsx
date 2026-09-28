import {
  Alert,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Select,
  MenuItem,
  Checkbox,
  FormControl,
  InputLabel,
  Button,
  Stack,
  TextField,
  Divider,
  Box,
  Paper,
  Chip,
  IconButton,
  FormControlLabel,
  Switch,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
} from "@mui/material";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  SwapHoriz as SwapHorizIcon,
  Close as CloseIcon,
  Tune as SettingsIcon,
  CalendarToday as CalendarTodayIcon,
  FilterAlt as FilterAltIcon,
  RestartAlt as RestartAltIcon,
  Link as LinkIcon,
} from "@mui/icons-material";
import { useState, useEffect } from "react";
import {
  mysqlColumns as loadMysqlColumns,
  mysqlTables as loadMysqlTables,
  postgresColumns as loadPostgresColumns,
  postgresTables as loadPostgresTables,
  mysqlDistinctValues as loadMysqlDistinctValues,
  postgresMasterRows as loadPostgresMasterRows,
} from "../services/database";

const cleanSourceColumnName = (name) => (name.includes("__dup__") ? name.split("__dup__")[0] : name);

export default function ColumnMapping({
  selectedTable,
  mysqlColumns,
  postgresColumns,
  mappings,
  setMappings,
  mysqlTables,
  postgresTables,
  mysqlConnection,
  postgresConnection,
  selectedSchemas,
  availableSchemas,
}) {
  const [lookupColumns, setLookupColumns] = useState({});
  const [lookupTables, setLookupTables] = useState({});
  const [activeLookupKey, setActiveLookupKey] = useState(null);
  const [masterTableColumns, setMasterTableColumns] = useState({});
  const [masterTableTables, setMasterTableTables] = useState({});
  const [masterRowOptions, setMasterRowOptions] = useState({});
  const [distinctValuesLoading, setDistinctValuesLoading] = useState({});
  const [relatedTableColumns, setRelatedTableColumns] = useState({});
  const [loadingRelatedCols, setLoadingRelatedCols] = useState(false);

  useEffect(() => {
    const preloadLookupOptions = async () => {
      for (const [key, mapping] of Object.entries(mappings)) {
        if (mapping && mapping.lookup) {
          const lookup = mapping.lookup;
          const columnName = key;

          const mysqlSchema = lookup.mysqlSchema || selectedSchemas.mysql;
          if (mysqlSchema && !lookupTables[columnName]?.mysql) {
            try {
              const res = await loadMysqlTables({ ...mysqlConnection, schema_name: mysqlSchema });
              setLookupTables((prev) => ({
                ...prev,
                [columnName]: { ...prev[columnName], mysql: res.data },
              }));
            } catch (e) {
              console.error("Failed to preload MySQL lookup tables", e);
            }
          }

          if (mysqlSchema && lookup.mysqlTable && !lookupColumns[columnName]?.mysql) {
            try {
              const res = await loadMysqlColumns({
                ...mysqlConnection,
                schema_name: mysqlSchema,
                table_name: lookup.mysqlTable,
              });
              setLookupColumns((prev) => ({
                ...prev,
                [columnName]: { ...prev[columnName], mysql: res.data },
              }));
            } catch (e) {
              console.error("Failed to preload MySQL lookup columns", e);
            }
          }

          const postgresSchema = lookup.postgresSchema || selectedSchemas.postgres;
          if (postgresSchema && !lookupTables[columnName]?.postgres) {
            try {
              const res = await loadPostgresTables({ ...postgresConnection, schema_name: postgresSchema });
              setLookupTables((prev) => ({
                ...prev,
                [columnName]: { ...prev[columnName], postgres: res.data },
              }));
            } catch (e) {
              console.error("Failed to preload Postgres lookup tables", e);
            }
          }

          if (postgresSchema && lookup.postgresTable && !lookupColumns[columnName]?.postgres) {
            try {
              const res = await loadPostgresColumns({
                ...postgresConnection,
                schema_name: postgresSchema,
                table_name: lookup.postgresTable,
              });
              setLookupColumns((prev) => ({
                ...prev,
                [columnName]: { ...prev[columnName], postgres: res.data },
              }));
            } catch (e) {
              console.error("Failed to preload Postgres lookup columns", e);
            }
          }

          const backfill = lookup.backfill;
          if (lookup.alsoBackfillNull && backfill) {
            const backfillSchema = backfill.postgresSchema || selectedSchemas.postgres;
            if (backfillSchema && !lookupTables[columnName]?.postgresBackfill) {
              try {
                const res = await loadPostgresTables({ ...postgresConnection, schema_name: backfillSchema });
                setLookupTables((prev) => ({
                  ...prev,
                  [columnName]: { ...prev[columnName], postgresBackfill: res.data },
                }));
              } catch (e) {
                console.error("Failed to preload Postgres backfill tables", e);
              }
            }
            if (backfillSchema && backfill.postgresTable && !lookupColumns[columnName]?.postgresBackfill) {
              try {
                const res = await loadPostgresColumns({
                  ...postgresConnection,
                  schema_name: backfillSchema,
                  table_name: backfill.postgresTable,
                });
                setLookupColumns((prev) => ({
                  ...prev,
                  [columnName]: { ...prev[columnName], postgresBackfill: res.data },
                }));
              } catch (e) {
                console.error("Failed to preload Postgres backfill columns", e);
              }
            }
          }
        }
      }
    };

    preloadLookupOptions();
  }, [mappings, selectedSchemas.mysql, selectedSchemas.postgres, mysqlConnection, postgresConnection]);

  useEffect(() => {
    const relationRows = mappings.__relationRows;
    if (!relationRows || !relationRows.active) return;
    const relationConfig = relationRows.relation || {};
    const schema = relationConfig.postgresSchema || selectedSchemas.postgres;
    if (schema && !lookupTables.__relationRows?.postgres) {
      loadPostgresTables({ ...postgresConnection, schema_name: schema })
        .then((res) => setLookupTables((prev) => ({ ...prev, __relationRows: { ...prev.__relationRows, postgres: res.data } })))
        .catch((e) => console.error("Failed to preload relation lookup tables", e));
    }
    if (schema && relationConfig.postgresTable && !lookupColumns.__relationRows?.postgres) {
      loadPostgresColumns({ ...postgresConnection, schema_name: schema, table_name: relationConfig.postgresTable })
        .then((res) => setLookupColumns((prev) => ({ ...prev, __relationRows: { ...prev.__relationRows, postgres: res.data } })))
        .catch((e) => console.error("Failed to preload relation lookup columns", e));
    }
  }, [mappings, selectedSchemas.postgres, postgresConnection]);

  useEffect(() => {
    const relTable = mappings.__relatedTableFilter?.relatedTable;
    if (relTable && !relatedTableColumns[relTable]) {
      setLoadingRelatedCols(true);
      loadMysqlColumns({
        ...mysqlConnection,
        schema_name: selectedSchemas.mysql,
        table_name: relTable,
      })
        .then((res) => {
          setRelatedTableColumns((prev) => ({
            ...prev,
            [relTable]: res.data,
          }));
        })
        .catch((err) => {
          console.error("Failed to load related table columns:", err);
        })
        .finally(() => {
          setLoadingRelatedCols(false);
        });
    }
  }, [mappings.__relatedTableFilter?.relatedTable, selectedSchemas.mysql, mysqlConnection]);

  useEffect(() => {
    const preloadMasterTableTables = async () => {
      const wanted = [
        ...Object.entries(mappings)
          .filter(([, mapping]) => mapping && mapping.masterTable)
          .map(([key, mapping]) => [key, mapping.masterTable]),
        ...(mappings.__valueMappings || [])
          .map((group, groupIndex) => [`__valueMappings:${groupIndex}`, group.masterTable])
          .filter(([, masterTable]) => Boolean(masterTable)),
      ];
      for (const [key, masterTable] of wanted) {
        const schema = masterTable.schema || selectedSchemas.postgres;
        if (!schema || masterTableTables[key]?.signature === schema) continue;
        try {
          const res = await loadPostgresTables({ ...postgresConnection, schema_name: schema });
          setMasterTableTables((prev) => ({ ...prev, [key]: { signature: schema, tables: res.data } }));
        } catch (e) {
          console.error("Failed to load master tables for schema", e);
        }
      }
    };
    preloadMasterTableTables();
  }, [mappings, mappings.__valueMappings, selectedSchemas.postgres, postgresConnection]);

  useEffect(() => {
    const preloadMasterTableColumns = async () => {
      for (const [key, mapping] of Object.entries(mappings)) {
        const masterTable = mapping && mapping.masterTable;
        if (!masterTable || !masterTable.table || masterTableColumns[key]) continue;
        try {
          const res = await loadPostgresColumns({
            ...postgresConnection,
            schema_name: masterTable.schema || selectedSchemas.postgres,
            table_name: masterTable.table,
          });
          setMasterTableColumns((prev) => ({ ...prev, [key]: res.data }));
        } catch (e) {
          console.error("Failed to load master table columns", e);
        }
      }
    };
    preloadMasterTableColumns();
  }, [mappings, selectedSchemas.postgres, postgresConnection]);

  useEffect(() => {
    const preloadMasterRows = async () => {
      for (const [key, mapping] of Object.entries(mappings)) {
        const masterTable = mapping && mapping.masterTable;
        if (!masterTable || !masterTable.table || !masterTable.idColumn || !masterTable.displayColumn) continue;
        const signature = `${masterTable.schema || selectedSchemas.postgres}.${masterTable.table}.${masterTable.idColumn}.${masterTable.displayColumn}`;
        if (masterRowOptions[key]?.signature === signature) continue;
        try {
          const res = await loadPostgresMasterRows({
            ...postgresConnection,
            schema_name: masterTable.schema || selectedSchemas.postgres,
            table_name: masterTable.table,
            id_column: masterTable.idColumn,
            display_column: masterTable.displayColumn,
          });
          setMasterRowOptions((prev) => ({ ...prev, [key]: { signature, rows: res.data } }));
        } catch (e) {
          console.error("Failed to load master table rows", e);
        }
      }
    };
    preloadMasterRows();
  }, [mappings, selectedSchemas.postgres, postgresConnection]);

  useEffect(() => {
    const preloadGroupMasterData = async () => {
      for (const [groupIndex, group] of (mappings.__valueMappings || []).entries()) {
        const masterTable = group && group.masterTable;
        if (!masterTable || !masterTable.table) continue;
        const key = `__valueMappings:${groupIndex}`;
        const schema = masterTable.schema || selectedSchemas.postgres;
        if (!masterTableColumns[key]) {
          try {
            const res = await loadPostgresColumns({ ...postgresConnection, schema_name: schema, table_name: masterTable.table });
            setMasterTableColumns((prev) => ({ ...prev, [key]: res.data }));
          } catch (e) {
            console.error("Failed to load master table columns", e);
          }
        }
        if (masterTable.idColumn && masterTable.displayColumn) {
          const signature = `${schema}.${masterTable.table}.${masterTable.idColumn}.${masterTable.displayColumn}`;
          if (masterRowOptions[key]?.signature !== signature) {
            try {
              const res = await loadPostgresMasterRows({
                ...postgresConnection,
                schema_name: schema,
                table_name: masterTable.table,
                id_column: masterTable.idColumn,
                display_column: masterTable.displayColumn,
              });
              setMasterRowOptions((prev) => ({ ...prev, [key]: { signature, rows: res.data } }));
            } catch (e) {
              console.error("Failed to load master table rows", e);
            }
          }
        }
      }
    };
    preloadGroupMasterData();
  }, [mappings.__valueMappings, selectedSchemas.postgres, postgresConnection]);

  const addColumnMappingDuplicate = (columnName) => {
    let index = 1;
    while (`${columnName}__dup__${index}` in mappings) {
      index++;
    }
    const newKey = `${columnName}__dup__${index}`;
    setMappings((prev) => ({
      ...prev,
      [newKey]: {
        selected: true,
        destination: "",
        replacements: [],
        nullWhenEmpty: true,
      },
    }));
  };

  const removeColumnMappingDuplicate = (key) => {
    setMappings((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const updateMapping = (column, field, value) => {
    setMappings((prev) => ({
      ...prev,
      [column]: {
        selected: true,
        destination: "",
        replacements: [],
        nullWhenEmpty: true,
        ...prev[column],
        [field]: value,
      },
    }));
  };

  const addReplacement = (column) => {
    const mapping = mappings[column] || {};
    updateMapping(column, "replacements", [
      ...(mapping.replacements || []),
      { from: "", to: "", condition: "EQUALS" },
    ]);
  };

  const updateReplacement = (column, index, field, value) => {
    const mapping = mappings[column] || {};
    const replacements = [...(mapping.replacements || [])];
    replacements[index] = { ...replacements[index], [field]: value };
    updateMapping(column, "replacements", replacements);
  };

  const removeReplacement = (column, index) => {
    const mapping = mappings[column] || {};
    updateMapping(
      column,
      "replacements",
      (mapping.replacements || []).filter((_, replacementIndex) => replacementIndex !== index)
    );
  };

  const updateMasterTable = (column, field, value) => {
    const mapping = mappings[column] || {};
    const nextMasterTable = {
      schema: selectedSchemas.postgres,
      table: "",
      idColumn: "",
      displayColumn: "",
      ...mapping.masterTable,
      [field]: value,
    };
    if (field === "schema") {
      nextMasterTable.table = "";
      nextMasterTable.idColumn = "";
      nextMasterTable.displayColumn = "";
    }
    if (field === "table") {
      nextMasterTable.idColumn = "";
      nextMasterTable.displayColumn = "";
    }
    // Any of these changes invalidates previously fetched columns/rows for this
    // master table - clear them so a stale (e.g. numeric-labelled) result never
    // lingers in the "Target value" dropdown after the config changes.
    if (field === "schema" || field === "table") {
      setMasterTableColumns((prev) => ({ ...prev, [column]: undefined }));
    }
    setMasterRowOptions((prev) => ({ ...prev, [column]: undefined }));
    updateMapping(column, "masterTable", nextMasterTable);
  };

  const removeMasterTable = (column) => {
    setMasterTableColumns((prev) => ({ ...prev, [column]: undefined }));
    setMasterRowOptions((prev) => ({ ...prev, [column]: undefined }));
    updateMapping(column, "masterTable", null);
  };

  const loadDistinctValuesForColumn = async (column) => {
    if (!selectedTable || !selectedSchemas.mysql) return;
    setDistinctValuesLoading((prev) => ({ ...prev, [column]: true }));
    try {
      const res = await loadMysqlDistinctValues({
        ...mysqlConnection,
        schema_name: selectedSchemas.mysql,
        table_name: selectedTable,
        column_name: cleanSourceColumnName(column),
      });
      const { values = [], has_null: hasNull } = res.data || {};
      const mapping = mappings[column] || {};
      const existing = mapping.replacements || [];
      const existingKeys = new Set(
        existing.map((r) => (r.condition === "IS_NULL" ? "IS_NULL" : `EQUALS:${r.from}`))
      );
      const additions = [];
      values.forEach((value) => {
        const key = `EQUALS:${value}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          additions.push({ from: String(value), to: "", condition: "EQUALS" });
        }
      });
      if (hasNull && !existingKeys.has("IS_NULL")) {
        additions.push({ from: "", to: "", condition: "IS_NULL" });
      }
      if (additions.length > 0) {
        updateMapping(column, "replacements", [...existing, ...additions]);
      }
    } catch (e) {
      console.error("Failed to load distinct source values", e);
    } finally {
      setDistinctValuesLoading((prev) => ({ ...prev, [column]: false }));
    }
  };

  const enableLookupReplacement = (column) => {
    updateMapping(column, "lookup", {
      mode: "crosswalk",
      mysqlSchema: selectedSchemas.mysql,
      mysqlTable: "",
      mysqlIdColumn: "",
      mysqlMatchColumn: "",
      sourceMatchColumns: [],
      postgresSchema: selectedSchemas.postgres,
      postgresTable: "",
      postgresMatchColumn: "",
      postgresResultColumn: "",
      caseInsensitive: false,
    });
  };

  const selectMysqlLookupSchema = async (column, schema) => {
    updateMapping(column, "lookup", { ...(mappings[column]?.lookup || {}), mysqlSchema: schema, mysqlTable: "", mysqlIdColumn: "", mysqlMatchColumn: "" });
    if (!schema) return;
    const response = await loadMysqlTables({ ...mysqlConnection, schema_name: schema });
    setLookupTables((previous) => ({ ...previous, [column]: { ...previous[column], mysql: response.data } }));
  };

  const selectPostgresLookupSchema = async (column, schema) => {
    updateMapping(column, "lookup", { ...(mappings[column]?.lookup || {}), postgresSchema: schema, postgresTable: "", postgresMatchColumn: "", postgresResultColumn: "" });
    if (!schema) return;
    const response = await loadPostgresTables({ ...postgresConnection, schema_name: schema });
    setLookupTables((previous) => ({ ...previous, [column]: { ...previous[column], postgres: response.data } }));
  };

  const updateLookup = (column, field, value) => {
    const lookup = mappings[column]?.lookup || {};
    updateMapping(column, "lookup", { ...lookup, [field]: value });
  };

  const addSourceMatchColumn = (column) => {
    const lookup = mappings[column]?.lookup || {};
    updateMapping(column, "lookup", {
      ...lookup,
      sourceMatchColumns: [
        ...(lookup.sourceMatchColumns || []),
        { mysqlSourceColumn: "", postgresColumn: "" },
      ],
    });
  };

  const updateSourceMatchColumn = (column, index, field, value) => {
    const lookup = mappings[column]?.lookup || {};
    const matchColumns = [...(lookup.sourceMatchColumns || [])];
    matchColumns[index] = { ...matchColumns[index], [field]: value };
    updateMapping(column, "lookup", { ...lookup, sourceMatchColumns: matchColumns });
  };

  const removeSourceMatchColumn = (column, index) => {
    const lookup = mappings[column]?.lookup || {};
    updateMapping(column, "lookup", {
      ...lookup,
      sourceMatchColumns: (lookup.sourceMatchColumns || []).filter((_, matchIndex) => matchIndex !== index),
    });
  };

  const setAlsoBackfillNull = (column, enabled) => {
    const lookup = mappings[column]?.lookup || {};
    updateMapping(column, "lookup", {
      ...lookup,
      alsoBackfillNull: enabled,
      backfill: lookup.backfill || {
        postgresSchema: selectedSchemas.postgres,
        postgresTable: "",
        postgresResultColumn: "",
        sourceMatchColumns: [],
        caseInsensitive: false,
      },
    });
  };

  const updateLookupBackfill = (column, field, value) => {
    const lookup = mappings[column]?.lookup || {};
    updateMapping(column, "lookup", {
      ...lookup,
      backfill: { ...(lookup.backfill || {}), [field]: value },
    });
  };

  const selectPostgresBackfillSchema = async (column, schema) => {
    const lookup = mappings[column]?.lookup || {};
    updateMapping(column, "lookup", {
      ...lookup,
      backfill: {
        ...(lookup.backfill || {}),
        postgresSchema: schema,
        postgresTable: "",
        postgresResultColumn: "",
      },
    });
    if (!schema) return;
    const response = await loadPostgresTables({ ...postgresConnection, schema_name: schema });
    setLookupTables((previous) => ({ ...previous, [column]: { ...previous[column], postgresBackfill: response.data } }));
  };

  const selectPostgresBackfillTable = async (column, table) => {
    const lookup = mappings[column]?.lookup || {};
    updateMapping(column, "lookup", {
      ...lookup,
      backfill: { ...(lookup.backfill || {}), postgresTable: table, postgresResultColumn: "" },
    });
    if (!table) return;
    const response = await loadPostgresColumns({
      ...postgresConnection,
      schema_name: lookup.backfill?.postgresSchema || selectedSchemas.postgres,
      table_name: table,
    });
    setLookupColumns((previous) => ({ ...previous, [column]: { ...previous[column], postgresBackfill: response.data } }));
  };

  const addBackfillMatchColumn = (column) => {
    const lookup = mappings[column]?.lookup || {};
    const backfill = lookup.backfill || {};
    updateMapping(column, "lookup", {
      ...lookup,
      backfill: {
        ...backfill,
        sourceMatchColumns: [...(backfill.sourceMatchColumns || []), { mysqlSourceColumn: "", postgresColumn: "" }],
      },
    });
  };

  const updateBackfillMatchColumn = (column, index, field, value) => {
    const lookup = mappings[column]?.lookup || {};
    const backfill = lookup.backfill || {};
    const matchColumns = [...(backfill.sourceMatchColumns || [])];
    matchColumns[index] = { ...matchColumns[index], [field]: value };
    updateMapping(column, "lookup", { ...lookup, backfill: { ...backfill, sourceMatchColumns: matchColumns } });
  };

  const removeBackfillMatchColumn = (column, index) => {
    const lookup = mappings[column]?.lookup || {};
    const backfill = lookup.backfill || {};
    updateMapping(column, "lookup", {
      ...lookup,
      backfill: {
        ...backfill,
        sourceMatchColumns: (backfill.sourceMatchColumns || []).filter((_, matchIndex) => matchIndex !== index),
      },
    });
  };

  const selectMysqlLookupTable = async (column, table) => {
    updateMapping(column, "lookup", {
      ...(mappings[column]?.lookup || {}),
      mysqlTable: table,
      mysqlIdColumn: "",
      mysqlMatchColumn: "",
    });
    if (!table) return;
    const response = await loadMysqlColumns({
      ...mysqlConnection,
      schema_name: mappings[column]?.lookup?.mysqlSchema || selectedSchemas.mysql,
      table_name: table,
    });
    setLookupColumns((previous) => ({
      ...previous,
      [column]: { ...previous[column], mysql: response.data },
    }));
  };

  const selectPostgresLookupTable = async (column, table) => {
    updateMapping(column, "lookup", {
      ...(mappings[column]?.lookup || {}),
      postgresTable: table,
      postgresMatchColumn: "",
      postgresResultColumn: "",
    });
    if (!table) return;
    const response = await loadPostgresColumns({
      ...postgresConnection,
      schema_name: mappings[column]?.lookup?.postgresSchema || selectedSchemas.postgres,
      table_name: table,
    });
    setLookupColumns((previous) => ({
      ...previous,
      [column]: { ...previous[column], postgres: response.data },
    }));
  };

  const addPostgresDefault = () => {
    setMappings((previous) => ({
      ...previous,
      __postgresDefaults: [
        ...(previous.__postgresDefaults || []),
        { destination: "", value: "" },
      ],
    }));
  };

  const updatePostgresDefault = (index, field, value) => {
    setMappings((previous) => {
      const defaults = [...(previous.__postgresDefaults || [])];
      defaults[index] = { ...defaults[index], [field]: value };
      return { ...previous, __postgresDefaults: defaults };
    });
  };

  const removePostgresDefault = (index) => {
    setMappings((previous) => ({
      ...previous,
      __postgresDefaults: (previous.__postgresDefaults || []).filter(
        (_, defaultIndex) => defaultIndex !== index
      ),
    }));
  };

  // Condition-based value mapping: lets several source columns (e.g. a status
  // code column AND an amount column) each contribute rules that resolve to one
  // target column's master-table id. Rules within a group are evaluated in the
  // order shown, first match wins - this is the deterministic precedence rule
  // for when more than one condition could otherwise apply to the same row.
  const addValueMapping = () => {
    setMappings((previous) => ({
      ...previous,
      __valueMappings: [
        ...(previous.__valueMappings || []),
        {
          targetColumn: "",
          masterTable: { schema: selectedSchemas.postgres, table: "", idColumn: "", displayColumn: "" },
          rules: [],
        },
      ],
    }));
  };

  const updateValueMapping = (groupIndex, field, value) => {
    setMappings((previous) => {
      const groups = [...(previous.__valueMappings || [])];
      groups[groupIndex] = { ...groups[groupIndex], [field]: value };
      return { ...previous, __valueMappings: groups };
    });
  };

  const updateValueMappingMaster = (groupIndex, field, value) => {
    const key = `__valueMappings:${groupIndex}`;
    setMappings((previous) => {
      const groups = [...(previous.__valueMappings || [])];
      const group = groups[groupIndex] || {};
      const nextMaster = {
        schema: selectedSchemas.postgres,
        table: "",
        idColumn: "",
        displayColumn: "",
        ...group.masterTable,
        [field]: value,
      };
      if (field === "schema") {
        nextMaster.table = "";
        nextMaster.idColumn = "";
        nextMaster.displayColumn = "";
      }
      if (field === "table") {
        nextMaster.idColumn = "";
        nextMaster.displayColumn = "";
      }
      groups[groupIndex] = { ...group, masterTable: nextMaster };
      return { ...previous, __valueMappings: groups };
    });
    // Same staleness fix as the per-column picker: any change here invalidates
    // previously fetched columns/rows so the Target value dropdown never shows
    // leftover results from a different table/column combination.
    if (field === "schema" || field === "table") {
      setMasterTableColumns((prev) => ({ ...prev, [key]: undefined }));
    }
    setMasterRowOptions((prev) => ({ ...prev, [key]: undefined }));
  };

  const removeValueMapping = (groupIndex) => {
    const key = `__valueMappings:${groupIndex}`;
    setMasterTableColumns((prev) => ({ ...prev, [key]: undefined }));
    setMasterRowOptions((prev) => ({ ...prev, [key]: undefined }));
    setMappings((previous) => ({
      ...previous,
      __valueMappings: (previous.__valueMappings || []).filter((_, index) => index !== groupIndex),
    }));
  };

  const addValueMappingRule = (groupIndex) => {
    setMappings((previous) => {
      const groups = [...(previous.__valueMappings || [])];
      const group = groups[groupIndex] || { rules: [] };
      groups[groupIndex] = {
        ...group,
        rules: [...(group.rules || []), { sourceColumn: "", condition: "EQUALS", value: "", targetId: "" }],
      };
      return { ...previous, __valueMappings: groups };
    });
  };

  const updateValueMappingRule = (groupIndex, ruleIndex, field, value) => {
    setMappings((previous) => {
      const groups = [...(previous.__valueMappings || [])];
      const group = groups[groupIndex] || { rules: [] };
      const rules = [...(group.rules || [])];
      rules[ruleIndex] = { ...rules[ruleIndex], [field]: value };
      groups[groupIndex] = { ...group, rules };
      return { ...previous, __valueMappings: groups };
    });
  };

  const removeValueMappingRule = (groupIndex, ruleIndex) => {
    setMappings((previous) => {
      const groups = [...(previous.__valueMappings || [])];
      const group = groups[groupIndex] || { rules: [] };
      groups[groupIndex] = { ...group, rules: (group.rules || []).filter((_, index) => index !== ruleIndex) };
      return { ...previous, __valueMappings: groups };
    });
  };

  const [ruleDistinctValues, setRuleDistinctValues] = useState({});

  const loadDistinctValuesForRuleColumn = async (sourceColumn) => {
    if (!selectedTable || !selectedSchemas.mysql || !sourceColumn) return;
    setDistinctValuesLoading((prev) => ({ ...prev, [`rule:${sourceColumn}`]: true }));
    try {
      const res = await loadMysqlDistinctValues({
        ...mysqlConnection,
        schema_name: selectedSchemas.mysql,
        table_name: selectedTable,
        column_name: cleanSourceColumnName(sourceColumn),
      });
      setRuleDistinctValues((prev) => ({ ...prev, [sourceColumn]: res.data }));
    } catch (e) {
      console.error("Failed to load distinct source values", e);
    } finally {
      setDistinctValuesLoading((prev) => ({ ...prev, [`rule:${sourceColumn}`]: false }));
    }
  };

  const updateRowDuplication = (field, value) => {
    setMappings((previous) => {
      const dup = previous.__rowDuplication || {
        active: false,
        primarySource: "",
        secondarySource: "",
        typeColumn: "",
        primaryValue: "primary",
        secondaryValue: "secondary",
        delimiter: ",",
        parts: [],
      };
      return {
        ...previous,
        __rowDuplication: { ...dup, [field]: value },
      };
    });
  };

  const addRowDuplicationPart = () => {
    setMappings((previous) => {
      const dup = previous.__rowDuplication || {
        active: false,
        primarySource: "",
        secondarySource: "",
        typeColumn: "",
        primaryValue: "primary",
        secondaryValue: "secondary",
        delimiter: ",",
        parts: [],
      };
      const parts = [...(dup.parts || [])];
      parts.push({ destination: "", matchType: "index", index: 0, pattern: "" });
      return {
        ...previous,
        __rowDuplication: { ...dup, parts },
      };
    });
  };

  const updateRowDuplicationPart = (partIndex, field, value) => {
    setMappings((previous) => {
      const dup = previous.__rowDuplication || {};
      const parts = [...(dup.parts || [])];
      parts[partIndex] = { ...parts[partIndex], [field]: value };
      return {
        ...previous,
        __rowDuplication: { ...dup, parts },
      };
    });
  };

  const removeRowDuplicationPart = (partIndex) => {
    setMappings((previous) => {
      const dup = previous.__rowDuplication || {};
      const parts = (dup.parts || []).filter((_, idx) => idx !== partIndex);
      return {
        ...previous,
        __rowDuplication: { ...dup, parts },
      };
    });
  };

  const defaultRelationRows = () => ({
    active: false,
    nameColumn: "",
    relationIdColumn: "",
    skipEmpty: true,
    branches: [],
    relation: {
      postgresSchema: selectedSchemas.postgres,
      postgresTable: "",
      postgresMatchColumn: "",
      postgresResultColumn: "",
      caseInsensitive: false,
    },
  });

  const updateRelationRows = (field, value) => {
    setMappings((previous) => {
      const relationRows = previous.__relationRows || defaultRelationRows();
      return { ...previous, __relationRows: { ...relationRows, [field]: value } };
    });
  };

  const patchRelationLookup = (patch) => {
    setMappings((previous) => {
      const relationRows = previous.__relationRows || defaultRelationRows();
      return {
        ...previous,
        __relationRows: {
          ...relationRows,
          relation: { ...(relationRows.relation || {}), ...patch },
        },
      };
    });
  };

  const addRelationBranch = () => {
    setMappings((previous) => {
      const relationRows = previous.__relationRows || defaultRelationRows();
      return {
        ...previous,
        __relationRows: {
          ...relationRows,
          branches: [...(relationRows.branches || []), { sourceColumn: "", relationName: "" }],
        },
      };
    });
  };

  const updateRelationBranch = (branchIndex, field, value) => {
    setMappings((previous) => {
      const relationRows = previous.__relationRows || defaultRelationRows();
      const branches = [...(relationRows.branches || [])];
      branches[branchIndex] = { ...branches[branchIndex], [field]: value };
      return { ...previous, __relationRows: { ...relationRows, branches } };
    });
  };

  const removeRelationBranch = (branchIndex) => {
    setMappings((previous) => {
      const relationRows = previous.__relationRows || defaultRelationRows();
      return {
        ...previous,
        __relationRows: {
          ...relationRows,
          branches: (relationRows.branches || []).filter((_, idx) => idx !== branchIndex),
        },
      };
    });
  };

  const selectRelationLookupSchema = async (schema) => {
    patchRelationLookup({ postgresSchema: schema, postgresTable: "", postgresMatchColumn: "", postgresResultColumn: "" });
    if (!schema) return;
    try {
      const response = await loadPostgresTables({ ...postgresConnection, schema_name: schema });
      setLookupTables((previous) => ({
        ...previous,
        __relationRows: { ...previous.__relationRows, postgres: response.data },
      }));
    } catch (e) {
      console.error("Failed to load relation lookup tables", e);
    }
  };

  const selectRelationLookupTable = async (table) => {
    patchRelationLookup({ postgresTable: table, postgresMatchColumn: "", postgresResultColumn: "" });
    if (!table) return;
    try {
      const schema = mappings.__relationRows?.relation?.postgresSchema || selectedSchemas.postgres;
      const response = await loadPostgresColumns({ ...postgresConnection, schema_name: schema, table_name: table });
      setLookupColumns((previous) => ({
        ...previous,
        __relationRows: { ...previous.__relationRows, postgres: response.data },
      }));
    } catch (e) {
      console.error("Failed to load relation lookup columns", e);
    }
  };

  const mappedPostgresColumns = new Set([
    ...Object.entries(mappings)
      .filter(([source, mapping]) => !source.startsWith("__") && mapping.selected && mapping.destination)
      .map(([, mapping]) => mapping.destination),
    ...(mappings.__rowDuplication?.parts || [])
      .map((part) => part.destination)
      .filter(Boolean),
    mappings.__rowDuplication?.typeColumn,
    mappings.__relationRows?.nameColumn,
    mappings.__relationRows?.relationIdColumn,
  ].filter(Boolean));

  const DATE_TYPES = new Set(["date", "datetime", "timestamp"]);
  const dateColumns = (mysqlColumns || []).filter((col) =>
    DATE_TYPES.has(String(col.data_type || "").toLowerCase())
  );

  const dateFilter = mappings.__dateFilter || { column: "", fromDate: "", toDate: "" };

  const updateDateFilter = (field, value) => {
    setMappings((previous) => {
      const current = previous.__dateFilter || { column: "", fromDate: "", toDate: "" };
      const next = { ...current, [field]: value };
      if (field === "column" && !value) {
        next.fromDate = "";
        next.toDate = "";
      }
      return {
        ...previous,
        __dateFilter: next,
      };
    });
  };

  const clearDateFilter = () => {
    setMappings((previous) => ({
      ...previous,
      __dateFilter: { column: "", fromDate: "", toDate: "" },
    }));
  };

  const relatedTableFilter = mappings.__relatedTableFilter || {
    sourceJoinColumn: "",
    relatedTable: "",
    relatedJoinColumn: "",
    conditionColumn: "",
    operator: ">",
    conditionValue: "",
    limitEnabled: false,
    limitRows: 2000,
  };

  const updateRelatedTableFilter = async (field, value) => {
    setMappings((previous) => {
      const current = previous.__relatedTableFilter || {
        sourceJoinColumn: "",
        relatedTable: "",
        relatedJoinColumn: "",
        conditionColumn: "",
        operator: ">",
        conditionValue: "",
        limitEnabled: false,
        limitRows: 2000,
      };
      const next = { ...current, [field]: value };
      if (field === "relatedTable") {
        next.relatedJoinColumn = "";
        next.conditionColumn = "";
      }
      return {
        ...previous,
        __relatedTableFilter: next,
      };
    });

    if (field === "relatedTable" && value && !relatedTableColumns[value]) {
      try {
        setLoadingRelatedCols(true);
        const res = await loadMysqlColumns({
          ...mysqlConnection,
          schema_name: selectedSchemas.mysql,
          table_name: value,
        });
        setRelatedTableColumns((prev) => ({
          ...prev,
          [value]: res.data,
        }));
      } catch (err) {
        console.error("Failed to load related table columns:", err);
      } finally {
        setLoadingRelatedCols(false);
      }
    }
  };

  const clearRelatedTableFilter = () => {
    setMappings((previous) => ({
      ...previous,
      __relatedTableFilter: {
        sourceJoinColumn: "",
        relatedTable: "",
        relatedJoinColumn: "",
        conditionColumn: "",
        operator: ">",
        conditionValue: "",
        limitEnabled: false,
        limitRows: 2000,
      },
    }));
  };

  const isRelFilterActive = Boolean(
    relatedTableFilter.relatedTable &&
    relatedTableFilter.sourceJoinColumn &&
    relatedTableFilter.relatedJoinColumn &&
    relatedTableFilter.conditionColumn &&
    (relatedTableFilter.operator?.includes("NULL") ||
      (relatedTableFilter.conditionValue !== "" &&
        relatedTableFilter.conditionValue !== undefined))
  );

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>

        <Typography variant="h5" gutterBottom>
          Column Mapping
        </Typography>

        <Paper
          variant="outlined"
          sx={{
            p: 2.5,
            mb: 3,
            borderRadius: 2,
            bgcolor: (theme) =>
              theme.palette.mode === "dark"
                ? "rgba(33, 150, 243, 0.06)"
                : "rgba(33, 150, 243, 0.04)",
            borderColor: (theme) =>
              dateFilter.column && dateFilter.fromDate && dateFilter.toDate
                ? "primary.main"
                : "divider",
          }}
        >
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between" flexWrap="wrap">
              <Stack direction="row" spacing={1} alignItems="center">
                <CalendarTodayIcon color="primary" fontSize="small" />
                <Typography variant="h6" sx={{ fontSize: "1.05rem", fontWeight: 600 }}>
                  Date Range Filter (Optional)
                </Typography>
              </Stack>
              {dateFilter.column && (
                <Chip
                  icon={<FilterAltIcon />}
                  label={
                    dateFilter.fromDate && dateFilter.toDate && dateFilter.fromDate <= dateFilter.toDate
                      ? `Filter Active: ${dateFilter.column} (${dateFilter.fromDate} to ${dateFilter.toDate})`
                      : `Filtering by: ${dateFilter.column}`
                  }
                  color={
                    dateFilter.fromDate && dateFilter.toDate && dateFilter.fromDate <= dateFilter.toDate
                      ? "primary"
                      : "warning"
                  }
                  size="small"
                  variant="filled"
                  sx={{ fontWeight: 600 }}
                />
              )}
            </Stack>

            <Typography variant="body2" color="text.secondary">
              Filter source records from <strong>{selectedTable}</strong> by date/time before migration. Records on the end date are included in full.
            </Typography>

            {dateColumns.length === 0 ? (
              <Alert severity="info" sx={{ mt: 1 }}>
                No DATE, DATETIME, or TIMESTAMP columns found in <strong>{selectedTable}</strong>. Full table migration will be performed.
              </Alert>
            ) : (
              <>
                <Grid container spacing={2} alignItems="center">
                  <Grid size={{ xs: 12, md: dateFilter.column ? 4 : 6 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="date-column-select-label">Select Date Column</InputLabel>
                      <Select
                        labelId="date-column-select-label"
                        label="Select Date Column"
                        value={dateFilter.column || ""}
                        onChange={(e) => updateDateFilter("column", e.target.value)}
                      >
                        <MenuItem value="">
                          <em>-- No Date Filter (All records) --</em>
                        </MenuItem>
                        {dateColumns.map((col) => (
                          <MenuItem key={col.column_name} value={col.column_name}>
                            {col.column_name} ({col.data_type})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>

                  {dateFilter.column && (
                    <>
                      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <TextField
                          label="From Date"
                          type="date"
                          size="small"
                          fullWidth
                          value={dateFilter.fromDate || ""}
                          onChange={(e) => updateDateFilter("fromDate", e.target.value)}
                          slotProps={{ inputLabel: { shrink: true } }}
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>

                      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <TextField
                          label="To Date"
                          type="date"
                          size="small"
                          fullWidth
                          value={dateFilter.toDate || ""}
                          onChange={(e) => updateDateFilter("toDate", e.target.value)}
                          slotProps={{ inputLabel: { shrink: true } }}
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>

                      <Grid size={{ xs: 12, md: 2 }}>
                        <Button
                          variant="outlined"
                          color="inherit"
                          size="small"
                          startIcon={<RestartAltIcon />}
                          onClick={clearDateFilter}
                          fullWidth
                          sx={{ textTransform: "none", py: 0.8 }}
                        >
                          Clear
                        </Button>
                      </Grid>
                    </>
                  )}
                </Grid>

                {dateFilter.column && (
                  <Box>
                    {dateFilter.fromDate && dateFilter.toDate ? (
                      dateFilter.fromDate > dateFilter.toDate ? (
                        <Alert severity="error" sx={{ mt: 1 }}>
                          From Date (<strong>{dateFilter.fromDate}</strong>) cannot be greater than To Date (<strong>{dateFilter.toDate}</strong>). Please correct the date range.
                        </Alert>
                      ) : (
                        <Alert severity="success" sx={{ mt: 1 }}>
                          Records will be filtered where <strong>{dateFilter.column}</strong> is between <strong>{dateFilter.fromDate}</strong> and <strong>{dateFilter.toDate}</strong> (inclusive of entire day).
                        </Alert>
                      )
                    ) : dateFilter.fromDate && !dateFilter.toDate ? (
                      <Alert severity="warning" sx={{ mt: 1 }}>
                        Please select a <strong>To Date</strong> to complete the filter range.
                      </Alert>
                    ) : !dateFilter.fromDate && dateFilter.toDate ? (
                      <Alert severity="warning" sx={{ mt: 1 }}>
                        Please select a <strong>From Date</strong> to complete the filter range.
                      </Alert>
                    ) : (
                      <Alert severity="info" sx={{ mt: 1 }}>
                        Please select the <strong>From Date</strong> and <strong>To Date</strong> range for filtering.
                      </Alert>
                    )}
                  </Box>
                )}
              </>
            )}
          </Stack>
        </Paper>

        <Paper
          variant="outlined"
          sx={{
            p: 2.5,
            mb: 3,
            borderRadius: 2,
            bgcolor: (theme) =>
              theme.palette.mode === "dark"
                ? "rgba(156, 39, 176, 0.06)"
                : "rgba(156, 39, 176, 0.04)",
            borderColor: isRelFilterActive
              ? "secondary.main"
              : "divider",
          }}
        >
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between" flexWrap="wrap">
              <Stack direction="row" spacing={1} alignItems="center">
                <LinkIcon color="secondary" fontSize="small" />
                <Typography variant="h6" sx={{ fontSize: "1.05rem", fontWeight: 600 }}>
                  Related Table Filter (Optional)
                </Typography>
              </Stack>
              {relatedTableFilter.relatedTable && (
                <Chip
                  icon={<FilterAltIcon />}
                  label={
                    isRelFilterActive
                      ? `Filter Active: ${relatedTableFilter.relatedTable}.${relatedTableFilter.conditionColumn} ${relatedTableFilter.operator} ${
                          relatedTableFilter.operator?.includes("NULL")
                            ? ""
                            : relatedTableFilter.conditionValue
                        }${relatedTableFilter.limitEnabled && Number(relatedTableFilter.limitRows) > 0 ? ` (Limit: ${Number(relatedTableFilter.limitRows).toLocaleString()})` : ""}`
                      : `Filtering via: ${relatedTableFilter.relatedTable}`
                  }
                  color={isRelFilterActive ? "secondary" : "warning"}
                  size="small"
                  variant="filled"
                  sx={{ fontWeight: 600 }}
                />
              )}
            </Stack>

            <Typography variant="body2" color="text.secondary">
              Filter source records from <strong>{selectedTable}</strong> based on matching conditions in a related MySQL table.
            </Typography>

            <Grid container spacing={2} alignItems="center">
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel id="rel-filter-source-join-col-label">Main Join Column</InputLabel>
                  <Select
                    labelId="rel-filter-source-join-col-label"
                    label="Main Join Column"
                    value={relatedTableFilter.sourceJoinColumn || ""}
                    onChange={(e) => updateRelatedTableFilter("sourceJoinColumn", e.target.value)}
                  >
                    <MenuItem value="">
                      <em>-- Select Column ({selectedTable}) --</em>
                    </MenuItem>
                    {(mysqlColumns || []).map((col) => (
                      <MenuItem key={col.column_name} value={col.column_name}>
                        {col.column_name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel id="rel-filter-table-label">Related Table</InputLabel>
                  <Select
                    labelId="rel-filter-table-label"
                    label="Related Table"
                    value={relatedTableFilter.relatedTable || ""}
                    onChange={(e) => updateRelatedTableFilter("relatedTable", e.target.value)}
                  >
                    <MenuItem value="">
                      <em>-- No Related Filter --</em>
                    </MenuItem>
                    {(mysqlTables || [])
                      .filter((t) => t.table_name !== selectedTable)
                      .map((table) => (
                        <MenuItem key={table.table_name} value={table.table_name}>
                          {table.table_name}
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>
              </Grid>

              {relatedTableFilter.relatedTable && (
                <>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="rel-filter-related-join-col-label">Related Join Column</InputLabel>
                      <Select
                        labelId="rel-filter-related-join-col-label"
                        label="Related Join Column"
                        value={relatedTableFilter.relatedJoinColumn || ""}
                        onChange={(e) => updateRelatedTableFilter("relatedJoinColumn", e.target.value)}
                        disabled={loadingRelatedCols}
                      >
                        <MenuItem value="">
                          <em>-- Select Column ({relatedTableFilter.relatedTable}) --</em>
                        </MenuItem>
                        {(relatedTableColumns[relatedTableFilter.relatedTable] || []).map((col) => (
                          <MenuItem key={col.column_name} value={col.column_name}>
                            {col.column_name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="rel-filter-condition-col-label">Condition Column</InputLabel>
                      <Select
                        labelId="rel-filter-condition-col-label"
                        label="Condition Column"
                        value={relatedTableFilter.conditionColumn || ""}
                        onChange={(e) => updateRelatedTableFilter("conditionColumn", e.target.value)}
                        disabled={loadingRelatedCols}
                      >
                        <MenuItem value="">
                          <em>-- Select Condition Column --</em>
                        </MenuItem>
                        {(relatedTableColumns[relatedTableFilter.relatedTable] || []).map((col) => (
                          <MenuItem key={col.column_name} value={col.column_name}>
                            {col.column_name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 4, md: 2 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="rel-filter-operator-label">Operator</InputLabel>
                      <Select
                        labelId="rel-filter-operator-label"
                        label="Operator"
                        value={relatedTableFilter.operator || ">"}
                        onChange={(e) => updateRelatedTableFilter("operator", e.target.value)}
                      >
                        <MenuItem value=">">&gt; (Greater than)</MenuItem>
                        <MenuItem value=">=">&gt;= (Greater or equal)</MenuItem>
                        <MenuItem value="<">&lt; (Less than)</MenuItem>
                        <MenuItem value="<=">&lt;= (Less or equal)</MenuItem>
                        <MenuItem value="=">= (Equals)</MenuItem>
                        <MenuItem value="!=">!= (Not equals)</MenuItem>
                        <MenuItem value="LIKE">LIKE</MenuItem>
                        <MenuItem value="NOT LIKE">NOT LIKE</MenuItem>
                        <MenuItem value="IS NOT NULL">IS NOT NULL</MenuItem>
                        <MenuItem value="IS NULL">IS NULL</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>

                  {!relatedTableFilter.operator?.includes("NULL") && (
                    <Grid size={{ xs: 12, sm: 5, md: 3 }}>
                      <TextField
                        label="Condition Value"
                        size="small"
                        fullWidth
                        value={relatedTableFilter.conditionValue ?? ""}
                        onChange={(e) => updateRelatedTableFilter("conditionValue", e.target.value)}
                        placeholder="e.g. 0 or ACTIVE"
                      />
                    </Grid>
                  )}

                  <Grid size={{ xs: 12, sm: 3, md: 2 }}>
                    <Button
                      variant="outlined"
                      color="inherit"
                      size="small"
                      startIcon={<RestartAltIcon />}
                      onClick={clearRelatedTableFilter}
                      fullWidth
                      sx={{ textTransform: "none", py: 0.8 }}
                    >
                      Clear
                    </Button>
                  </Grid>

                  <Grid size={{ xs: 12 }}>
                    <Divider sx={{ my: 0.5 }} />
                  </Grid>

                  <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={Boolean(relatedTableFilter.limitEnabled)}
                          onChange={(e) => updateRelatedTableFilter("limitEnabled", e.target.checked)}
                          color="secondary"
                          size="small"
                        />
                      }
                      label={
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          Limit Related Table Records
                        </Typography>
                      }
                    />
                  </Grid>

                  {relatedTableFilter.limitEnabled && (
                    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                      <TextField
                        label="Related Record Limit"
                        type="number"
                        size="small"
                        fullWidth
                        value={relatedTableFilter.limitRows ?? 2000}
                        onChange={(e) => {
                          const val = e.target.value === "" ? "" : Math.max(1, parseInt(e.target.value) || 0);
                          updateRelatedTableFilter("limitRows", val);
                        }}
                        placeholder="2000"
                        helperText="Limits only records matched via this related condition"
                      />
                    </Grid>
                  )}
                </>
              )}
            </Grid>

            {relatedTableFilter.relatedTable && (
              <Box>
                {isRelFilterActive ? (
                  <Alert severity="success" sx={{ mt: 1 }}>
                    Records will be filtered where <strong>{selectedTable}.{relatedTableFilter.sourceJoinColumn}</strong> matches{" "}
                    <strong>{relatedTableFilter.relatedTable}.{relatedTableFilter.relatedJoinColumn}</strong> and{" "}
                    <strong>
                      {relatedTableFilter.relatedTable}.{relatedTableFilter.conditionColumn}{" "}
                      {relatedTableFilter.operator}{" "}
                      {relatedTableFilter.operator?.includes("NULL") ? "" : relatedTableFilter.conditionValue}
                    </strong>
                    {relatedTableFilter.limitEnabled && Number(relatedTableFilter.limitRows) > 0 && (
                      <span> (limited to <strong>{Number(relatedTableFilter.limitRows).toLocaleString()}</strong> related records)</span>
                    )}.
                  </Alert>
                ) : !relatedTableFilter.sourceJoinColumn ? (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Please select the <strong>Main Join Column</strong> in <strong>{selectedTable}</strong>.
                  </Alert>
                ) : !relatedTableFilter.relatedJoinColumn ? (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Please select the <strong>Related Join Column</strong> in <strong>{relatedTableFilter.relatedTable}</strong>.
                  </Alert>
                ) : !relatedTableFilter.conditionColumn ? (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Please select the <strong>Condition Column</strong> to evaluate.
                  </Alert>
                ) : (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Please enter the <strong>Condition Value</strong>.
                  </Alert>
                )}
              </Box>
            )}
          </Stack>
        </Paper>

        <TableContainer>

          <Table>

            <TableHead>

              <TableRow>

                <TableCell width="60px" align="center">
                  Include
                </TableCell>

                <TableCell width="25%">
                  MySQL Column
                </TableCell>

                <TableCell width="25%">
                  PostgreSQL Column
                </TableCell>

                <TableCell width="45%">
                  Data modifications
                </TableCell>

              </TableRow>

            </TableHead>

            <TableBody>

              {mysqlColumns.flatMap((column) => {
                const keys = [column.column_name];
                Object.keys(mappings).forEach((key) => {
                  if (key.startsWith(`${column.column_name}__dup__`)) {
                    keys.push(key);
                  }
                });

                return keys.map((key, keyIndex) => {
                  const mapping = mappings[key] || {
                    selected: true,
                    destination: "",
                    nullWhenEmpty: true,
                  };
                  const isDuplicate = keyIndex > 0;

                  return (
                    <TableRow key={key}>

                      <TableCell align="center">

                        <Checkbox
                          checked={mapping.selected}
                          onChange={(e) =>
                            updateMapping(
                              key,
                              "selected",
                              e.target.checked
                            )
                          }
                        />

                      </TableCell>

                      <TableCell>
                        <Stack spacing={1}>
                          <Typography>{column.column_name}</Typography>
                          {isDuplicate ? (
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                                (additional mapping)
                              </Typography>
                              <Button
                                size="small"
                                color="error"
                                variant="text"
                                onClick={() => removeColumnMappingDuplicate(key)}
                                sx={{ p: 0, minWidth: 0, textTransform: "none" }}
                              >
                                Remove copy
                              </Button>
                            </Stack>
                          ) : (
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => addColumnMappingDuplicate(column.column_name)}
                              sx={{ p: 0, minWidth: 0, textTransform: "none", alignSelf: "flex-start" }}
                            >
                              + Map to another column
                            </Button>
                          )}
                        </Stack>
                      </TableCell>

                      <TableCell>

                        <FormControl fullWidth>

                          <Select
                            value={mapping.destination}
                            displayEmpty
                            onChange={(e) =>
                              updateMapping(
                                key,
                                "destination",
                                e.target.value
                              )
                            }
                          >

                            <MenuItem value="">
                              -- Select Column --
                            </MenuItem>

                            {postgresColumns.map((pgColumn) => (

                              <MenuItem
                                key={pgColumn.column_name}
                                value={pgColumn.column_name}
                              >

                                {pgColumn.column_name}

                              </MenuItem>

                            ))}

                          </Select>

                        </FormControl>

                      </TableCell>

                      <TableCell>
                        <Stack spacing={1.5}>
                          {mapping.masterTable ? (
                            <Paper variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                              <Stack spacing={1}>
                                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                                  <Typography variant="caption" fontWeight={600}>
                                    Master table
                                  </Typography>
                                  <IconButton
                                    aria-label="Stop using a master table"
                                    size="small"
                                    onClick={() => removeMasterTable(key)}
                                  >
                                    <CloseIcon fontSize="small" />
                                  </IconButton>
                                </Stack>
                                <FormControl fullWidth size="small">
                                  <InputLabel>Schema</InputLabel>
                                  <Select
                                    label="Schema"
                                    value={mapping.masterTable.schema || selectedSchemas.postgres || ""}
                                    onChange={(e) => updateMasterTable(key, "schema", e.target.value)}
                                  >
                                    {availableSchemas.postgres.map((schema) => (
                                      <MenuItem key={schema.schema_name} value={schema.schema_name}>{schema.schema_name}</MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                                <FormControl fullWidth size="small">
                                  <InputLabel>Table</InputLabel>
                                  <Select
                                    label="Table"
                                    value={mapping.masterTable.table || ""}
                                    onChange={(e) => updateMasterTable(key, "table", e.target.value)}
                                  >
                                    {(masterTableTables[key]?.tables || []).map((t) => (
                                      <MenuItem key={t.table_name} value={t.table_name}>{t.table_name}</MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                                <Stack direction="row" spacing={1}>
                                  <FormControl fullWidth size="small">
                                    <InputLabel>ID column (stored)</InputLabel>
                                    <Select
                                      label="ID column (stored)"
                                      value={mapping.masterTable.idColumn || ""}
                                      onChange={(e) => updateMasterTable(key, "idColumn", e.target.value)}
                                    >
                                      {(masterTableColumns[key] || []).map((c) => (
                                        <MenuItem
                                          key={c.column_name}
                                          value={c.column_name}
                                          disabled={c.column_name === mapping.masterTable.displayColumn}
                                        >
                                          {c.column_name}
                                        </MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                  <FormControl fullWidth size="small">
                                    <InputLabel>Display column (shown)</InputLabel>
                                    <Select
                                      label="Display column (shown)"
                                      value={mapping.masterTable.displayColumn || ""}
                                      onChange={(e) => updateMasterTable(key, "displayColumn", e.target.value)}
                                    >
                                      {(masterTableColumns[key] || []).map((c) => (
                                        <MenuItem
                                          key={c.column_name}
                                          value={c.column_name}
                                          disabled={c.column_name === mapping.masterTable.idColumn}
                                        >
                                          {c.column_name}
                                        </MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                </Stack>
                                <Typography variant="caption" color="text.secondary">
                                  ID column is the value written to the target column. Display column is only the
                                  readable text shown in the "Target value" dropdown below - pick your table's
                                  name/label/status text column here, not the ID column.
                                </Typography>
                              </Stack>
                            </Paper>
                          ) : (
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => updateMasterTable(key, "table", "")}
                              disabled={!mapping.selected || !mapping.destination}
                              sx={{ textTransform: "none", alignSelf: "flex-start", p: 0, fontSize: "0.78rem" }}
                            >
                              Use a master table for values
                            </Button>
                          )}

                          {(mapping.replacements || []).map((replacement, index) => {
                            const masterRows = masterRowOptions[key]?.rows || [];
                            const isNullCondition = replacement.condition === "IS_NULL";
                            return (
                              <Stack direction="row" spacing={1} key={index} alignItems="center">
                                <FormControl size="small" sx={{ width: 110 }}>
                                  <Select
                                    value={replacement.condition || "EQUALS"}
                                    onChange={(event) =>
                                      updateReplacement(key, index, "condition", event.target.value)
                                    }
                                  >
                                    <MenuItem value="EQUALS">Equals</MenuItem>
                                    <MenuItem value="IS_NULL">Is NULL</MenuItem>
                                  </Select>
                                </FormControl>
                                <TextField
                                  label="If value is"
                                  size="small"
                                  value={isNullCondition ? "" : replacement.from}
                                  disabled={isNullCondition}
                                  placeholder={isNullCondition ? "NULL" : ""}
                                  onChange={(event) =>
                                    updateReplacement(key, index, "from", event.target.value)
                                  }
                                  sx={{ flex: 1 }}
                                />
                                {mapping.masterTable ? (
                                  <FormControl size="small" sx={{ flex: 1 }}>
                                    <InputLabel>Target value</InputLabel>
                                    <Select
                                      label="Target value"
                                      value={replacement.to || ""}
                                      onChange={(event) =>
                                        updateReplacement(key, index, "to", event.target.value)
                                      }
                                    >
                                      {masterRows.map((row) => (
                                        <MenuItem key={row.id} value={String(row.id)}>{row.label}</MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                ) : (
                                  <TextField
                                    label="Write"
                                    size="small"
                                    value={replacement.to}
                                    onChange={(event) =>
                                      updateReplacement(key, index, "to", event.target.value)
                                    }
                                    sx={{ flex: 1 }}
                                  />
                                )}
                                <IconButton
                                  aria-label="Remove data modification"
                                  color="error"
                                  size="small"
                                  onClick={() => removeReplacement(key, index)}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </Stack>
                            );
                          })}
                          <Stack direction="row" spacing={1.5} alignItems="center">
                            <Button
                              size="small"
                              variant="text"
                              startIcon={<AddIcon fontSize="small" />}
                              onClick={() => addReplacement(key)}
                              disabled={!mapping.selected || !mapping.destination}
                              sx={{ textTransform: "none", alignSelf: "flex-start", p: 0, fontSize: "0.8rem" }}
                            >
                              + Add replacement
                            </Button>
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => loadDistinctValuesForColumn(key)}
                              disabled={!mapping.selected || !mapping.destination || !selectedTable || distinctValuesLoading[key]}
                              sx={{ textTransform: "none", alignSelf: "flex-start", p: 0, fontSize: "0.8rem" }}
                            >
                              {distinctValuesLoading[key] ? "Loading..." : "Load distinct source values"}
                            </Button>
                          </Stack>
                          <TextField
                            label="New value if input is empty or NULL"
                            size="small"
                            value={mapping.defaultValue || ""}
                            onChange={(event) =>
                              updateMapping(key, "defaultValue", event.target.value)
                            }
                            disabled={!mapping.selected || !mapping.destination}
                            helperText="Use CURRENT_DATE or CURRENT_TIMESTAMP for dynamic date values."
                            fullWidth
                          />
                          <FormControlLabel
                            control={
                              <Checkbox
                                size="small"
                                checked={mapping.nullWhenEmpty !== false}
                                onChange={(event) =>
                                  updateMapping(key, "nullWhenEmpty", event.target.checked)
                                }
                                disabled={!mapping.selected || !mapping.destination || Boolean(mapping.defaultValue)}
                              />
                            }
                            label={
                              <Typography variant="body2" sx={{ fontSize: "0.82rem" }}>
                                Insert NULL when input is empty or NULL
                              </Typography>
                            }
                          />
                          {mapping.lookup ? (
                            <Paper
                              variant="outlined"
                              sx={{
                                p: 1.5,
                                borderRadius: 1.5,
                                bgcolor: (theme) =>
                                  theme.palette.mode === "dark"
                                    ? "rgba(25, 118, 210, 0.08)"
                                    : "#f0f7ff",
                                borderColor: "primary.main",
                              }}
                            >
                              <Stack spacing={1}>
                                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                                  <Stack direction="row" spacing={0.8} alignItems="center">
                                    <SwapHorizIcon color="primary" fontSize="small" />
                                    <Typography variant="subtitle2" fontWeight={600} color="primary.main">
                                      {mapping.lookup.mode === "backfill_null"
                                        ? "Null Backfill Lookup"
                                        : mapping.lookup.alsoBackfillNull
                                          ? "Lookup Crosswalk + Null Backfill"
                                          : "Lookup Crosswalk"}
                                    </Typography>
                                  </Stack>
                                  <Chip
                                    label="Configured"
                                    size="small"
                                    color="primary"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: "0.7rem", fontWeight: 600 }}
                                  />
                                </Stack>

                                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                                  {mapping.lookup.mode === "backfill_null" ? (
                                    <>
                                      NULL ➔ {mapping.lookup.postgresTable || "PostgreSQL Table"}
                                      {mapping.lookup.postgresResultColumn ? ` (${mapping.lookup.postgresResultColumn})` : ""}
                                    </>
                                  ) : (
                                    <>
                                      {mapping.lookup.mysqlTable || "MySQL Table"} ➔ {mapping.lookup.postgresTable || "PostgreSQL Table"}
                                      {mapping.lookup.mysqlIdColumn ? ` (${mapping.lookup.mysqlIdColumn})` : ""}
                                    </>
                                  )}
                                </Typography>

                                <Stack direction="row" spacing={1}>
                                  <Button
                                    size="small"
                                    variant="contained"
                                    color="primary"
                                    startIcon={<SettingsIcon fontSize="small" />}
                                    onClick={() => setActiveLookupKey(key)}
                                    sx={{ textTransform: "none", fontSize: "0.78rem", py: 0.3 }}
                                  >
                                    Configure / Edit
                                  </Button>
                                  <Button
                                    size="small"
                                    color="error"
                                    variant="text"
                                    startIcon={<DeleteIcon fontSize="small" />}
                                    onClick={() => updateMapping(key, "lookup", null)}
                                    sx={{ textTransform: "none", fontSize: "0.78rem", py: 0.3 }}
                                  >
                                    Remove
                                  </Button>
                                </Stack>
                              </Stack>
                            </Paper>
                          ) : (
                            <Button
                              size="small"
                              variant="outlined"
                              color="primary"
                              startIcon={<SwapHorizIcon fontSize="small" />}
                              onClick={() => {
                                enableLookupReplacement(key);
                                setActiveLookupKey(key);
                              }}
                              disabled={!mapping.selected || !mapping.destination}
                              sx={{ textTransform: "none", alignSelf: "flex-start", mt: 0.5 }}
                            >
                              Add lookup replacement
                            </Button>
                          )}
                        </Stack>
                      </TableCell>

                    </TableRow>
                  );
                });
              })}

            </TableBody>

          </Table>

        </TableContainer>

        <Stack spacing={2} sx={{ mt: 3 }}>
          <Typography variant="h6">PostgreSQL field defaults</Typography>
          {(mappings.__postgresDefaults || []).map((defaultMapping, index) => {
            const selectedByAnotherDefault = new Set(
              (mappings.__postgresDefaults || [])
                .filter((_, defaultIndex) => defaultIndex !== index)
                .map(({ destination }) => destination)
            );
            return (
              <Stack direction={{ xs: "column", md: "row" }} spacing={2} key={index}>
                <FormControl fullWidth>
                  <InputLabel id={`postgres-default-column-${index}`}>PostgreSQL field</InputLabel>
                  <Select
                    labelId={`postgres-default-column-${index}`}
                    label="PostgreSQL field"
                    value={defaultMapping.destination}
                    onChange={(event) => updatePostgresDefault(index, "destination", event.target.value)}
                  >
                    {postgresColumns.map((column) => (
                      <MenuItem
                        key={column.column_name}
                        value={column.column_name}
                        disabled={mappedPostgresColumns.has(column.column_name) || selectedByAnotherDefault.has(column.column_name)}
                      >
                        {column.column_name} ({column.data_type})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="Default value"
                  value={defaultMapping.value}
                  onChange={(event) => updatePostgresDefault(index, "value", event.target.value)}
                  helperText="CURRENT_DATE and CURRENT_TIMESTAMP are supported."
                  fullWidth
                />
                <Button color="error" onClick={() => removePostgresDefault(index)}>Remove</Button>
              </Stack>
            );
          })}
          <Button variant="outlined" onClick={addPostgresDefault}>
            Add PostgreSQL default
          </Button>
        </Stack>

        <Divider sx={{ my: 3 }} />

        <Stack spacing={2}>
          <Typography variant="h6">Value / condition → master table ID mapping</Typography>
          <Typography variant="body2" color="text.secondary">
            Map distinct values (or conditions like "is NULL") from one or more MySQL columns to a row picked from a
            PostgreSQL master table. Rules run top to bottom; the first one that matches a row wins, so order sets the
            precedence when more than one rule could apply.
          </Typography>

          {(mappings.__valueMappings || []).map((group, groupIndex) => {
            const masterKey = `__valueMappings:${groupIndex}`;
            const masterCols = masterTableColumns[masterKey] || [];
            const masterRows = masterRowOptions[masterKey]?.rows || [];
            const otherGroupTargets = new Set(
              (mappings.__valueMappings || [])
                .filter((_, i) => i !== groupIndex)
                .map((g) => g.targetColumn)
            );
            return (
              <Paper key={groupIndex} variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
                    <FormControl sx={{ minWidth: 220 }} size="small">
                      <InputLabel>Target column</InputLabel>
                      <Select
                        label="Target column"
                        value={group.targetColumn || ""}
                        onChange={(e) => updateValueMapping(groupIndex, "targetColumn", e.target.value)}
                      >
                        {postgresColumns.map((column) => (
                          <MenuItem
                            key={column.column_name}
                            value={column.column_name}
                          >
                            {column.column_name} ({column.data_type})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Button size="small" color="error" onClick={() => removeValueMapping(groupIndex)}>
                      Remove mapping group
                    </Button>
                  </Stack>

                  <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Master schema</InputLabel>
                      <Select
                        label="Master schema"
                        value={group.masterTable?.schema || selectedSchemas.postgres || ""}
                        onChange={(e) => updateValueMappingMaster(groupIndex, "schema", e.target.value)}
                      >
                        {availableSchemas.postgres.map((schema) => (
                          <MenuItem key={schema.schema_name} value={schema.schema_name}>{schema.schema_name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl fullWidth size="small">
                      <InputLabel>Master table</InputLabel>
                      <Select
                        label="Master table"
                        value={group.masterTable?.table || ""}
                        onChange={(e) => updateValueMappingMaster(groupIndex, "table", e.target.value)}
                      >
                        {(masterTableTables[masterKey]?.tables || []).map((t) => (
                          <MenuItem key={t.table_name} value={t.table_name}>{t.table_name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl fullWidth size="small">
                      <InputLabel>Master ID column (stored)</InputLabel>
                      <Select
                        label="Master ID column (stored)"
                        value={group.masterTable?.idColumn || ""}
                        onChange={(e) => updateValueMappingMaster(groupIndex, "idColumn", e.target.value)}
                      >
                        {masterCols.map((c) => (
                          <MenuItem
                            key={c.column_name}
                            value={c.column_name}
                            disabled={c.column_name === group.masterTable?.displayColumn}
                          >
                            {c.column_name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl fullWidth size="small">
                      <InputLabel>Master display column (shown)</InputLabel>
                      <Select
                        label="Master display column (shown)"
                        value={group.masterTable?.displayColumn || ""}
                        onChange={(e) => updateValueMappingMaster(groupIndex, "displayColumn", e.target.value)}
                      >
                        {masterCols.map((c) => (
                          <MenuItem
                            key={c.column_name}
                            value={c.column_name}
                            disabled={c.column_name === group.masterTable?.idColumn}
                          >
                            {c.column_name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    ID column is the value written to the target column. Display column is only the readable text
                    shown in each rule's "Target value" dropdown below - pick your table's name/label/status text
                    column here, not the ID column.
                  </Typography>

                  <Stack spacing={1.5}>
                    {(group.rules || []).map((rule, ruleIndex) => {
                      const isNullCondition = rule.condition === "IS_NULL";
                      const isZeroCondition = rule.condition === "IS_ZERO";
                      const isSpecialCondition = isNullCondition || isZeroCondition;
                      const distinctInfo = ruleDistinctValues[rule.sourceColumn];
                      const distinctListId = `value-mapping-${groupIndex}-${ruleIndex}-values`;
                      return (
                        <Stack direction="row" spacing={1} alignItems="center" key={ruleIndex}>
                          <FormControl size="small" sx={{ minWidth: 160 }}>
                            <InputLabel>Source column</InputLabel>
                            <Select
                              label="Source column"
                              value={rule.sourceColumn || ""}
                              onChange={(e) => updateValueMappingRule(groupIndex, ruleIndex, "sourceColumn", e.target.value)}
                            >
                              {mysqlColumns.map((column) => (
                                <MenuItem key={column.column_name} value={column.column_name}>
                                  {column.column_name}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          <FormControl size="small" sx={{ width: 110 }}>
                            <Select
                              value={rule.condition || "EQUALS"}
                              onChange={(e) => updateValueMappingRule(groupIndex, ruleIndex, "condition", e.target.value)}
                            >
                              <MenuItem value="EQUALS">Equals</MenuItem>
                              <MenuItem value="IS_NULL">Is NULL</MenuItem>
                              <MenuItem value="IS_ZERO">Is 0</MenuItem>
                            </Select>
                          </FormControl>
                          <TextField
                            label="Value"
                            size="small"
                            value={isNullCondition ? "" : isZeroCondition ? "0" : (rule.value || "")}
                            disabled={isSpecialCondition}
                            placeholder={isNullCondition ? "NULL" : isZeroCondition ? "0" : ""}
                            onChange={(e) => updateValueMappingRule(groupIndex, ruleIndex, "value", e.target.value)}
                            inputProps={{ list: distinctInfo ? distinctListId : undefined }}
                            sx={{ flex: 1 }}
                          />
                          {distinctInfo && (
                            <datalist id={distinctListId}>
                              {distinctInfo.values.map((value) => (
                                <option key={String(value)} value={value} />
                              ))}
                            </datalist>
                          )}
                          <Button
                            size="small"
                            sx={{ textTransform: "none", fontSize: "0.72rem" }}
                            disabled={!rule.sourceColumn || !selectedTable || distinctValuesLoading[`rule:${rule.sourceColumn}`]}
                            onClick={() => loadDistinctValuesForRuleColumn(rule.sourceColumn)}
                          >
                            {distinctValuesLoading[`rule:${rule.sourceColumn}`] ? "..." : "Load values"}
                          </Button>
                          <FormControl size="small" sx={{ flex: 1 }}>
                            <InputLabel>Target value</InputLabel>
                            <Select
                              label="Target value"
                              value={rule.targetId || ""}
                              onChange={(e) => updateValueMappingRule(groupIndex, ruleIndex, "targetId", e.target.value)}
                            >
                              {masterRows.map((row) => (
                                <MenuItem key={row.id} value={String(row.id)}>{row.label}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          <IconButton
                            aria-label="Remove rule"
                            color="error"
                            size="small"
                            onClick={() => removeValueMappingRule(groupIndex, ruleIndex)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      );
                    })}
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<AddIcon fontSize="small" />}
                      onClick={() => addValueMappingRule(groupIndex)}
                      sx={{ textTransform: "none", alignSelf: "flex-start", p: 0, fontSize: "0.8rem" }}
                    >
                      + Add rule
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
          <Button variant="outlined" onClick={addValueMapping}>
            Add value mapping group
          </Button>
        </Stack>

        <Divider sx={{ my: 3 }} />

        {(() => {
          const dup = mappings.__rowDuplication || {
            active: false,
            primarySource: "",
            secondarySource: "",
            typeColumn: "",
            primaryValue: "primary",
            secondaryValue: "secondary",
            delimiter: ",",
            parts: [],
          };
          return (
            <Stack spacing={2}>
              <Typography variant="h6">MySQL Row Duplication & Splitting</Typography>
              <Typography variant="body2" color="text.secondary">
                Duplicate each MySQL row to map primary and secondary address fields (like address and postal_address) into two separate PostgreSQL rows with a designated address type. Both rows apply the delimiter-based split matching.
              </Typography>

              <Stack direction="row" alignItems="center">
                <Checkbox
                  checked={Boolean(dup.active)}
                  disabled={Boolean(mappings.__relationRows?.active)}
                  onChange={(event) => updateRowDuplication("active", event.target.checked)}
                />
                <Typography variant="body1">Enable Row Duplication and Splitting</Typography>
                {Boolean(mappings.__relationRows?.active) && (
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    (disable the relationship rows section below to use this)
                  </Typography>
                )}
              </Stack>

              {dup.active && (
                <Card variant="outlined" sx={{ p: 2, bgcolor: "action.hover" }}>
                  <Stack spacing={2}>
                    <Typography variant="subtitle1" fontWeight="bold">Sources & Targets</Typography>

                    <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel id="mysql-dup-primary-source">Primary Source Column (MySQL)</InputLabel>
                        <Select
                          labelId="mysql-dup-primary-source"
                          label="Primary Source Column (MySQL)"
                          value={dup.primarySource || ""}
                          onChange={(event) => updateRowDuplication("primarySource", event.target.value)}
                        >
                          {mysqlColumns.map((column) => (
                            <MenuItem key={column.column_name} value={column.column_name}>
                              {column.column_name} ({column.data_type})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      <FormControl fullWidth size="small">
                        <InputLabel id="mysql-dup-secondary-source">Secondary Source Column (MySQL)</InputLabel>
                        <Select
                          labelId="mysql-dup-secondary-source"
                          label="Secondary Source Column (MySQL)"
                          value={dup.secondarySource || ""}
                          onChange={(event) => updateRowDuplication("secondarySource", event.target.value)}
                        >
                          {mysqlColumns.map((column) => (
                            <MenuItem key={column.column_name} value={column.column_name}>
                              {column.column_name} ({column.data_type})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Stack>

                    <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel id="postgres-dup-type-column">PostgreSQL Address Type Column</InputLabel>
                        <Select
                          labelId="postgres-dup-type-column"
                          label="PostgreSQL Address Type Column"
                          value={dup.typeColumn || ""}
                          onChange={(event) => updateRowDuplication("typeColumn", event.target.value)}
                        >
                          {postgresColumns.map((column) => (
                            <MenuItem
                              key={column.column_name}
                              value={column.column_name}
                              disabled={mappedPostgresColumns.has(column.column_name) && column.column_name !== dup.typeColumn}
                            >
                              {column.column_name} ({column.data_type})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      <TextField
                        label="Primary Type Value"
                        size="small"
                        value={dup.primaryValue || ""}
                        onChange={(event) => updateRowDuplication("primaryValue", event.target.value)}
                        fullWidth
                      />

                      <TextField
                        label="Secondary Type Value"
                        size="small"
                        value={dup.secondaryValue || ""}
                        onChange={(event) => updateRowDuplication("secondaryValue", event.target.value)}
                        fullWidth
                      />

                      <TextField
                        label="Delimiter"
                        size="small"
                        value={dup.delimiter || ""}
                        onChange={(event) => updateRowDuplication("delimiter", event.target.value)}
                        helperText="e.g. comma (,), semicolon (;)"
                        sx={{ width: { md: "250px" } }}
                      />
                    </Stack>

                    <Divider sx={{ my: 1 }} />

                    <Typography variant="subtitle1" fontWeight="bold">Destination Parts Splitting (Zigzag Matching)</Typography>
                    <Stack spacing={2} sx={{ pl: 2, borderLeft: 2, borderColor: "primary.main" }}>
                      {(dup.parts || []).map((part, partIndex) => (
                        <Stack direction={{ xs: "column", md: "row" }} spacing={2} key={partIndex} alignItems="center">
                          <FormControl size="small" sx={{ minWidth: 180 }}>
                            <InputLabel id={`postgres-dup-part-dest-${partIndex}`}>PostgreSQL Column</InputLabel>
                            <Select
                              labelId={`postgres-dup-part-dest-${partIndex}`}
                              label="PostgreSQL Column"
                              value={part.destination}
                              onChange={(event) => updateRowDuplicationPart(partIndex, "destination", event.target.value)}
                            >
                              {postgresColumns.map((column) => (
                                <MenuItem
                                  key={column.column_name}
                                  value={column.column_name}
                                  disabled={mappedPostgresColumns.has(column.column_name) && column.column_name !== part.destination}
                                >
                                  {column.column_name} ({column.data_type})
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>

                          <FormControl size="small" sx={{ minWidth: 150 }}>
                            <InputLabel id={`postgres-dup-part-type-${partIndex}`}>Match Type</InputLabel>
                            <Select
                              labelId={`postgres-dup-part-type-${partIndex}`}
                              label="Match Type"
                              value={part.matchType || "index"}
                              onChange={(event) => updateRowDuplicationPart(partIndex, "matchType", event.target.value)}
                            >
                              <MenuItem value="index">Match by Index</MenuItem>
                              <MenuItem value="regex">Match by Regex</MenuItem>
                            </Select>
                          </FormControl>

                          {(part.matchType || "index") === "index" ? (
                            <FormControl size="small" sx={{ minWidth: 120 }}>
                              <InputLabel id={`postgres-dup-part-index-${partIndex}`}>Part</InputLabel>
                              <Select
                                labelId={`postgres-dup-part-index-${partIndex}`}
                                label="Part"
                                value={part.index !== undefined ? part.index : 0}
                                onChange={(event) => updateRowDuplicationPart(partIndex, "index", parseInt(event.target.value))}
                              >
                                <MenuItem value={0}>1st part</MenuItem>
                                <MenuItem value={1}>2nd part</MenuItem>
                                <MenuItem value={2}>3rd part</MenuItem>
                                <MenuItem value={3}>4th part</MenuItem>
                                <MenuItem value={4}>5th part</MenuItem>
                                <MenuItem value={5}>6th part</MenuItem>
                                <MenuItem value={6}>7th part</MenuItem>
                                <MenuItem value={7}>8th part</MenuItem>
                              </Select>
                            </FormControl>
                          ) : (
                            <TextField
                              label="Regex Pattern"
                              size="small"
                              placeholder="e.g. [0-9]+|d\.?no"
                              value={part.pattern || ""}
                              onChange={(event) => updateRowDuplicationPart(partIndex, "pattern", event.target.value)}
                              sx={{ flexGrow: 1 }}
                            />
                          )}

                          <Button color="error" size="small" onClick={() => removeRowDuplicationPart(partIndex)}>
                            Remove Part
                          </Button>
                        </Stack>
                      ))}
                      <Button size="small" variant="text" onClick={addRowDuplicationPart}>
                        + Add Destination Part
                      </Button>
                    </Stack>
                  </Stack>
                </Card>
              )}
            </Stack>
          );
        })()}

        <Divider sx={{ my: 3 }} />

        {(() => {
          const relationRows = mappings.__relationRows || defaultRelationRows();
          const relationConfig = relationRows.relation || {};
          const rowDuplicationActive = Boolean(mappings.__rowDuplication?.active);
          const relationLookupTables = lookupTables.__relationRows?.postgres
            || ((relationConfig.postgresSchema || selectedSchemas.postgres) === selectedSchemas.postgres ? postgresTables : []);
          const relationLookupColumns = lookupColumns.__relationRows?.postgres || [];
          return (
            <Stack spacing={2}>
              <Typography variant="h6">One Source Row → Multiple Relationship Rows</Typography>
              <Typography variant="body2" color="text.secondary">
                Turn several relationship columns on one MySQL row (for example mother, father and guardian name columns)
                into one target row per relationship. Every new row keeps the shared columns you mapped above, writes the
                chosen name column, and stores a relationship-type ID that is looked up by name from a PostgreSQL master
                table &mdash; the ID is never hardcoded.
              </Typography>

              <Stack direction="row" alignItems="center">
                <Checkbox
                  checked={Boolean(relationRows.active)}
                  disabled={rowDuplicationActive}
                  onChange={(event) => updateRelationRows("active", event.target.checked)}
                />
                <Typography variant="body1">Enable one-to-many relationship rows</Typography>
                {rowDuplicationActive && (
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    (disable Row Duplication above to use this)
                  </Typography>
                )}
              </Stack>

              {relationRows.active && (
                <Card variant="outlined" sx={{ p: 2, bgcolor: "action.hover" }}>
                  <Stack spacing={2}>
                    <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel id="relation-name-column">PostgreSQL name column</InputLabel>
                        <Select
                          labelId="relation-name-column"
                          label="PostgreSQL name column"
                          value={relationRows.nameColumn || ""}
                          onChange={(event) => updateRelationRows("nameColumn", event.target.value)}
                        >
                          {postgresColumns.map((column) => (
                            <MenuItem
                              key={column.column_name}
                              value={column.column_name}
                              disabled={mappedPostgresColumns.has(column.column_name) && column.column_name !== relationRows.nameColumn}
                            >
                              {column.column_name} ({column.data_type})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      <FormControl fullWidth size="small">
                        <InputLabel id="relation-id-column">PostgreSQL relationship ID column</InputLabel>
                        <Select
                          labelId="relation-id-column"
                          label="PostgreSQL relationship ID column"
                          value={relationRows.relationIdColumn || ""}
                          onChange={(event) => updateRelationRows("relationIdColumn", event.target.value)}
                        >
                          {postgresColumns.map((column) => (
                            <MenuItem
                              key={column.column_name}
                              value={column.column_name}
                              disabled={mappedPostgresColumns.has(column.column_name) && column.column_name !== relationRows.relationIdColumn}
                            >
                              {column.column_name} ({column.data_type})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Stack>

                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={relationRows.skipEmpty !== false}
                          onChange={(event) => updateRelationRows("skipEmpty", event.target.checked)}
                        />
                      }
                      label={
                        <Typography variant="body2" sx={{ fontSize: "0.82rem" }}>
                          Skip a relationship row when its source name is empty or NULL
                        </Typography>
                      }
                    />

                    <Divider sx={{ my: 1 }} />
                    <Typography variant="subtitle1" fontWeight="bold">Relationship columns</Typography>
                    <Stack spacing={2} sx={{ pl: 2, borderLeft: 2, borderColor: "primary.main" }}>
                      {(relationRows.branches || []).map((branch, branchIndex) => (
                        <Stack direction={{ xs: "column", md: "row" }} spacing={2} key={branchIndex} alignItems="center">
                          <FormControl size="small" sx={{ minWidth: 200 }}>
                            <InputLabel id={`relation-branch-source-${branchIndex}`}>MySQL name column</InputLabel>
                            <Select
                              labelId={`relation-branch-source-${branchIndex}`}
                              label="MySQL name column"
                              value={branch.sourceColumn || ""}
                              onChange={(event) => updateRelationBranch(branchIndex, "sourceColumn", event.target.value)}
                            >
                              {mysqlColumns.map((column) => (
                                <MenuItem key={column.column_name} value={column.column_name}>
                                  {column.column_name} ({column.data_type})
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>

                          <TextField
                            label="Relationship name (as stored in master)"
                            size="small"
                            value={branch.relationName || ""}
                            onChange={(event) => updateRelationBranch(branchIndex, "relationName", event.target.value)}
                            sx={{ flexGrow: 1 }}
                          />

                          <Button color="error" size="small" onClick={() => removeRelationBranch(branchIndex)}>
                            Remove
                          </Button>
                        </Stack>
                      ))}
                      <Button size="small" variant="text" onClick={addRelationBranch}>
                        + Add relationship column
                      </Button>
                    </Stack>

                    <Divider sx={{ my: 1 }} />
                    <Typography variant="subtitle1" fontWeight="bold">Relationship master lookup (name → ID)</Typography>
                    <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel id="relation-lookup-schema">PostgreSQL schema</InputLabel>
                        <Select
                          labelId="relation-lookup-schema"
                          label="PostgreSQL schema"
                          value={relationConfig.postgresSchema || selectedSchemas.postgres}
                          onChange={(event) => selectRelationLookupSchema(event.target.value)}
                        >
                          {availableSchemas.postgres.map((schema) => (
                            <MenuItem key={schema.schema_name} value={schema.schema_name}>
                              {schema.schema_name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      <FormControl fullWidth size="small">
                        <InputLabel id="relation-lookup-table">Master table</InputLabel>
                        <Select
                          labelId="relation-lookup-table"
                          label="Master table"
                          value={relationConfig.postgresTable || ""}
                          onChange={(event) => selectRelationLookupTable(event.target.value)}
                        >
                          {relationLookupTables.map((table) => (
                            <MenuItem key={table.table_name} value={table.table_name}>
                              {table.table_name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Stack>

                    <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel id="relation-lookup-match">Master name column</InputLabel>
                        <Select
                          labelId="relation-lookup-match"
                          label="Master name column"
                          value={relationConfig.postgresMatchColumn || ""}
                          onChange={(event) => patchRelationLookup({ postgresMatchColumn: event.target.value })}
                        >
                          {relationLookupColumns.map((column) => (
                            <MenuItem key={column.column_name} value={column.column_name}>
                              {column.column_name} ({column.data_type})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      <FormControl fullWidth size="small">
                        <InputLabel id="relation-lookup-result">Master ID column</InputLabel>
                        <Select
                          labelId="relation-lookup-result"
                          label="Master ID column"
                          value={relationConfig.postgresResultColumn || ""}
                          onChange={(event) => patchRelationLookup({ postgresResultColumn: event.target.value })}
                        >
                          {relationLookupColumns.map((column) => (
                            <MenuItem key={column.column_name} value={column.column_name}>
                              {column.column_name} ({column.data_type})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Stack>

                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={Boolean(relationConfig.caseInsensitive)}
                          onChange={(event) => patchRelationLookup({ caseInsensitive: event.target.checked })}
                        />
                      }
                      label={
                        <Typography variant="body2" sx={{ fontSize: "0.82rem" }}>
                          Case-insensitive name matching
                        </Typography>
                      }
                    />
                  </Stack>
                </Card>
              )}
            </Stack>
          );
        })()}

        {/* Lookup Replacement Modal Dialog */}
        {Boolean(activeLookupKey && mappings[activeLookupKey]?.lookup) && (() => {
          const key = activeLookupKey;
          const lookup = mappings[key].lookup;

          return (
            <Dialog
              open={true}
              onClose={() => setActiveLookupKey(null)}
              maxWidth="md"
              fullWidth
              PaperProps={{
                sx: {
                  borderRadius: 2.5,
                },
              }}
            >
              <DialogTitle sx={{ m: 0, p: 2.5, pb: 1.5 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Box
                      sx={{
                        p: 0.8,
                        borderRadius: 1.5,
                        bgcolor: "primary.main",
                        color: "primary.contrastText",
                        display: "flex",
                      }}
                    >
                      <SwapHorizIcon fontSize="small" />
                    </Box>
                    <Box>
                      <Typography variant="h6" fontWeight={700}>
                        Configure Lookup Replacement
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Foreign key crosswalk lookup for source column: <strong>{key}</strong>
                      </Typography>
                    </Box>
                  </Stack>
                  <IconButton
                    aria-label="close"
                    onClick={() => setActiveLookupKey(null)}
                    sx={{ color: "text.secondary" }}
                  >
                    <CloseIcon />
                  </IconButton>
                </Stack>
              </DialogTitle>

              <DialogContent dividers sx={{ p: 3 }}>
                <Stack spacing={2.5}>
                  {/* Lookup mode */}
                  <FormControl size="small" fullWidth>
                    <InputLabel>Lookup mode</InputLabel>
                    <Select
                      label="Lookup mode"
                      value={lookup.mode === "backfill_null" ? "backfill_null" : "crosswalk"}
                      onChange={(event) => updateLookup(key, "mode", event.target.value)}
                    >
                      <MenuItem value="crosswalk">
                        Crosswalk — translate an existing ID via MySQL &amp; PostgreSQL master tables
                      </MenuItem>
                      <MenuItem value="backfill_null">
                        Backfill NULL — derive a missing ID from a PostgreSQL table using this row&apos;s other columns
                      </MenuItem>
                    </Select>
                  </FormControl>
                  {lookup.mode === "backfill_null" && (
                    <Typography variant="caption" color="text.secondary">
                      When the source value for <strong>{key}</strong> is empty or NULL, the current-table context fields
                      below are matched against the PostgreSQL table and the value of the <strong>new ID column</strong>
                      from the matching PostgreSQL row is written in. Rows that already have a value are left unchanged.
                    </Typography>
                  )}

                  {/* Side-by-Side MySQL vs PostgreSQL */}
                  <Stack direction={{ xs: "column", md: "row" }} spacing={2.5}>
                    {/* MySQL Source Side */}
                    {lookup.mode !== "backfill_null" && (
                      <Box
                        sx={{
                          flex: 1,
                          p: 2,
                          borderRadius: 2,
                          bgcolor: (theme) =>
                            theme.palette.mode === "dark"
                              ? "rgba(255,255,255,0.03)"
                              : "#ffffff",
                          border: 1,
                          borderColor: "info.light",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                        }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                          <Chip
                            label="MySQL (Source)"
                            size="small"
                            color="info"
                            variant="filled"
                            sx={{ fontWeight: 700, height: 24, fontSize: "0.75rem" }}
                          />
                          <Typography variant="caption" color="text.secondary" fontWeight={500}>
                            Old Table & Columns
                          </Typography>
                        </Stack>

                        <Stack spacing={2}>
                          <FormControl size="small" fullWidth>
                            <InputLabel>MySQL schema</InputLabel>
                            <Select
                              label="MySQL schema"
                              value={lookup.mysqlSchema || selectedSchemas.mysql}
                              onChange={(event) =>
                                selectMysqlLookupSchema(key, event.target.value)
                              }
                            >
                              {availableSchemas.mysql.map((schema) => (
                                <MenuItem key={schema.schema_name} value={schema.schema_name}>
                                  {schema.schema_name}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>

                          <FormControl size="small" fullWidth>
                            <InputLabel>MySQL lookup table</InputLabel>
                            <Select
                              label="MySQL lookup table"
                              value={lookup.mysqlTable || ""}
                              onChange={(event) =>
                                selectMysqlLookupTable(key, event.target.value)
                              }
                            >
                              {(
                                lookupTables[key]?.mysql ||
                                ((lookup.mysqlSchema || selectedSchemas.mysql) ===
                                  selectedSchemas.mysql
                                  ? mysqlTables
                                  : [])
                              ).map((table) => (
                                <MenuItem key={table.table_name} value={table.table_name}>
                                  {table.table_name}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>

                          <FormControl size="small" fullWidth>
                            <InputLabel>MySQL old ID column</InputLabel>
                            <Select
                              label="MySQL old ID column"
                              value={lookup.mysqlIdColumn || ""}
                              onChange={(event) =>
                                updateLookup(key, "mysqlIdColumn", event.target.value)
                              }
                            >
                              {(lookupColumns[key]?.mysql || []).map((item) => (
                                <MenuItem key={item.column_name} value={item.column_name}>
                                  {item.column_name} ({item.data_type})
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>

                          <FormControl size="small" fullWidth>
                            <InputLabel>MySQL matching value column</InputLabel>
                            <Select
                              label="MySQL matching value column"
                              value={lookup.mysqlMatchColumn || ""}
                              onChange={(event) =>
                                updateLookup(key, "mysqlMatchColumn", event.target.value)
                              }
                            >
                              {(lookupColumns[key]?.mysql || []).map((item) => (
                                <MenuItem key={item.column_name} value={item.column_name}>
                                  {item.column_name} ({item.data_type})
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Stack>
                      </Box>
                    )}

                    {/* PostgreSQL Target Side */}
                    <Box
                      sx={{
                        flex: 1,
                        p: 2,
                        borderRadius: 2,
                        bgcolor: (theme) =>
                          theme.palette.mode === "dark"
                            ? "rgba(255,255,255,0.03)"
                            : "#ffffff",
                        border: 1,
                        borderColor: "secondary.light",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                        <Chip
                          label="PostgreSQL (Target)"
                          size="small"
                          color="secondary"
                          variant="filled"
                          sx={{ fontWeight: 700, height: 24, fontSize: "0.75rem" }}
                        />
                        <Typography variant="caption" color="text.secondary" fontWeight={500}>
                          New Table & Columns
                        </Typography>
                      </Stack>

                      <Stack spacing={2}>
                        <FormControl size="small" fullWidth>
                          <InputLabel>PostgreSQL schema</InputLabel>
                          <Select
                            label="PostgreSQL schema"
                            value={
                              lookup.postgresSchema || selectedSchemas.postgres
                            }
                            onChange={(event) =>
                              selectPostgresLookupSchema(key, event.target.value)
                            }
                          >
                            {availableSchemas.postgres.map((schema) => (
                              <MenuItem key={schema.schema_name} value={schema.schema_name}>
                                {schema.schema_name}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        <FormControl size="small" fullWidth>
                          <InputLabel>PostgreSQL lookup table</InputLabel>
                          <Select
                            label="PostgreSQL lookup table"
                            value={lookup.postgresTable || ""}
                            onChange={(event) =>
                              selectPostgresLookupTable(key, event.target.value)
                            }
                          >
                            {(
                              lookupTables[key]?.postgres ||
                              ((lookup.postgresSchema ||
                                selectedSchemas.postgres) === selectedSchemas.postgres
                                ? postgresTables
                                : [])
                            ).map((table) => (
                              <MenuItem key={table.table_name} value={table.table_name}>
                                {table.table_name}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        {lookup.mode !== "backfill_null" && (
                          <FormControl size="small" fullWidth>
                            <InputLabel>PostgreSQL matching value column</InputLabel>
                            <Select
                              label="PostgreSQL matching value column"
                              value={lookup.postgresMatchColumn || ""}
                              onChange={(event) =>
                                updateLookup(key, "postgresMatchColumn", event.target.value)
                              }
                            >
                              {(lookupColumns[key]?.postgres || []).map((item) => (
                                <MenuItem key={item.column_name} value={item.column_name}>
                                  {item.column_name} ({item.data_type})
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        )}

                        <FormControl size="small" fullWidth>
                          <InputLabel>PostgreSQL new ID column</InputLabel>
                          <Select
                            label="PostgreSQL new ID column"
                            value={lookup.postgresResultColumn || ""}
                            onChange={(event) =>
                              updateLookup(key, "postgresResultColumn", event.target.value)
                            }
                          >
                            {(lookupColumns[key]?.postgres || []).map((item) => (
                              <MenuItem key={item.column_name} value={item.column_name}>
                                {item.column_name} ({item.data_type})
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Stack>
                    </Box>
                  </Stack>

                  {lookup.mode === "backfill_null" && (lookup.sourceMatchColumns || []).length === 0 && (
                    <Typography variant="caption" color="error">
                      Add at least one current-table context field below — these row columns are matched against the
                      PostgreSQL table to derive the missing value.
                    </Typography>
                  )}

                  {/* Current-Row Match Fields (Source Table Joins) */}
                  {(lookup.sourceMatchColumns || []).length > 0 && (
                    <Stack
                      spacing={1.5}
                      sx={{
                        p: 2,
                        borderRadius: 2,
                        bgcolor: (theme) =>
                          theme.palette.mode === "dark"
                            ? "rgba(156, 39, 176, 0.05)"
                            : "#fbf0ff",
                        border: "1px dashed",
                        borderColor: "secondary.main",
                      }}
                    >
                      <Typography variant="subtitle2" fontWeight={700} color="secondary.main">
                        Current Table Context Matching Fields
                      </Typography>
                      {(lookup.sourceMatchColumns || []).map((matchColumn, matchIndex) => (
                        <Stack
                          direction={{ xs: "column", sm: "row" }}
                          spacing={1.5}
                          key={matchIndex}
                          alignItems="center"
                        >
                          <FormControl size="small" fullWidth>
                            <InputLabel>Current MySQL column #{matchIndex + 1}</InputLabel>
                            <Select
                              label={`Current MySQL column #{matchIndex + 1}`}
                              value={matchColumn.mysqlSourceColumn || ""}
                              onChange={(event) =>
                                updateSourceMatchColumn(key, matchIndex, "mysqlSourceColumn", event.target.value)
                              }
                            >
                              {mysqlColumns.map((item) => (
                                <MenuItem key={item.column_name} value={item.column_name}>
                                  {item.column_name} ({item.data_type})
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>

                          <Typography
                            variant="body1"
                            color="text.secondary"
                            sx={{ px: 0.5, fontWeight: 700, display: { xs: "none", sm: "block" } }}
                          >
                            =
                          </Typography>

                          <FormControl size="small" fullWidth>
                            <InputLabel>PostgreSQL matching column</InputLabel>
                            <Select
                              label="PostgreSQL matching column"
                              value={matchColumn.postgresColumn || ""}
                              onChange={(event) =>
                                updateSourceMatchColumn(key, matchIndex, "postgresColumn", event.target.value)
                              }
                            >
                              {(lookupColumns[key]?.postgres || []).map((item) => (
                                <MenuItem key={item.column_name} value={item.column_name}>
                                  {item.column_name} ({item.data_type})
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>

                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => removeSourceMatchColumn(key, matchIndex)}
                            title="Remove current-row field"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      ))}
                    </Stack>
                  )}

                  {/* Action Button to Add Context Matching */}
                  <Stack direction="row" spacing={1.5} flexWrap="wrap">
                    <Button
                      size="small"
                      variant="outlined"
                      color="secondary"
                      startIcon={<AddIcon fontSize="small" />}
                      onClick={() => addSourceMatchColumn(key)}
                      sx={{ textTransform: "none", fontSize: "0.82rem" }}
                    >
                      Add current-table context field
                    </Button>
                  </Stack>

                  <Divider />

                  {/* Options */}
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={Boolean(lookup.caseInsensitive)}
                        onChange={(event) =>
                          updateLookup(key, "caseInsensitive", event.target.checked)
                        }
                      />
                    }
                    label={
                      <Typography variant="body2" fontWeight={500}>
                        Case-insensitive matching
                      </Typography>
                    }
                  />

                  {lookup.mode !== "backfill_null" && (
                    <>
                      <Divider />
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={Boolean(lookup.alsoBackfillNull)}
                            onChange={(event) => setAlsoBackfillNull(key, event.target.checked)}
                          />
                        }
                        label={
                          <Typography variant="body2" fontWeight={500}>
                            Also derive a value for rows where the source is NULL (backfill from a PostgreSQL table)
                          </Typography>
                        }
                      />

                      {lookup.alsoBackfillNull && (
                        <Box
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            border: "1px dashed",
                            borderColor: "secondary.main",
                            bgcolor: (theme) =>
                              theme.palette.mode === "dark"
                                ? "rgba(156, 39, 176, 0.05)"
                                : "#fbf0ff",
                          }}
                        >
                          <Stack spacing={2}>
                            <Typography variant="subtitle2" fontWeight={700} color="secondary.main">
                              NULL rows — derive <strong>{key}</strong> from PostgreSQL
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Rows where <strong>{key}</strong> already has a value are translated by the crosswalk above.
                              Rows where <strong>{key}</strong> is empty or NULL are matched against this PostgreSQL table
                              by the fields below, and its “new ID column” is written in.
                            </Typography>

                            <FormControl size="small" fullWidth>
                              <InputLabel>PostgreSQL schema</InputLabel>
                              <Select
                                label="PostgreSQL schema"
                                value={lookup.backfill?.postgresSchema || selectedSchemas.postgres}
                                onChange={(event) => selectPostgresBackfillSchema(key, event.target.value)}
                              >
                                {availableSchemas.postgres.map((schema) => (
                                  <MenuItem key={schema.schema_name} value={schema.schema_name}>
                                    {schema.schema_name}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>

                            <FormControl size="small" fullWidth>
                              <InputLabel>PostgreSQL table</InputLabel>
                              <Select
                                label="PostgreSQL table"
                                value={lookup.backfill?.postgresTable || ""}
                                onChange={(event) => selectPostgresBackfillTable(key, event.target.value)}
                              >
                                {(
                                  lookupTables[key]?.postgresBackfill ||
                                  ((lookup.backfill?.postgresSchema || selectedSchemas.postgres) === selectedSchemas.postgres
                                    ? postgresTables
                                    : [])
                                ).map((table) => (
                                  <MenuItem key={table.table_name} value={table.table_name}>
                                    {table.table_name}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>

                            <FormControl size="small" fullWidth>
                              <InputLabel>PostgreSQL new ID column</InputLabel>
                              <Select
                                label="PostgreSQL new ID column"
                                value={lookup.backfill?.postgresResultColumn || ""}
                                onChange={(event) => updateLookupBackfill(key, "postgresResultColumn", event.target.value)}
                              >
                                {(lookupColumns[key]?.postgresBackfill || []).map((item) => (
                                  <MenuItem key={item.column_name} value={item.column_name}>
                                    {item.column_name} ({item.data_type})
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>

                            {(lookup.backfill?.sourceMatchColumns || []).map((matchColumn, matchIndex) => (
                              <Stack
                                direction={{ xs: "column", sm: "row" }}
                                spacing={1.5}
                                key={matchIndex}
                                alignItems="center"
                              >
                                <FormControl size="small" fullWidth>
                                  <InputLabel>Current MySQL column #{matchIndex + 1}</InputLabel>
                                  <Select
                                    label={`Current MySQL column #${matchIndex + 1}`}
                                    value={matchColumn.mysqlSourceColumn || ""}
                                    onChange={(event) =>
                                      updateBackfillMatchColumn(key, matchIndex, "mysqlSourceColumn", event.target.value)
                                    }
                                  >
                                    {mysqlColumns.map((item) => (
                                      <MenuItem key={item.column_name} value={item.column_name}>
                                        {item.column_name} ({item.data_type})
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>

                                <Typography
                                  variant="body1"
                                  color="text.secondary"
                                  sx={{ px: 0.5, fontWeight: 700, display: { xs: "none", sm: "block" } }}
                                >
                                  =
                                </Typography>

                                <FormControl size="small" fullWidth>
                                  <InputLabel>PostgreSQL matching column</InputLabel>
                                  <Select
                                    label="PostgreSQL matching column"
                                    value={matchColumn.postgresColumn || ""}
                                    onChange={(event) =>
                                      updateBackfillMatchColumn(key, matchIndex, "postgresColumn", event.target.value)
                                    }
                                  >
                                    {(lookupColumns[key]?.postgresBackfill || []).map((item) => (
                                      <MenuItem key={item.column_name} value={item.column_name}>
                                        {item.column_name} ({item.data_type})
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>

                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => removeBackfillMatchColumn(key, matchIndex)}
                                  title="Remove match field"
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </Stack>
                            ))}

                            {(lookup.backfill?.sourceMatchColumns || []).length === 0 && (
                              <Typography variant="caption" color="error">
                                Add at least one match field — these row columns are compared to the PostgreSQL table
                                to derive the missing value.
                              </Typography>
                            )}

                            <Button
                              size="small"
                              variant="outlined"
                              color="secondary"
                              startIcon={<AddIcon fontSize="small" />}
                              onClick={() => addBackfillMatchColumn(key)}
                              sx={{ textTransform: "none", fontSize: "0.82rem", alignSelf: "flex-start" }}
                            >
                              Add match field
                            </Button>

                            <FormControlLabel
                              control={
                                <Checkbox
                                  checked={Boolean(lookup.backfill?.caseInsensitive)}
                                  onChange={(event) => updateLookupBackfill(key, "caseInsensitive", event.target.checked)}
                                />
                              }
                              label={
                                <Typography variant="body2">
                                  Case-insensitive matching (NULL rows)
                                </Typography>
                              }
                            />
                          </Stack>
                        </Box>
                      )}
                    </>
                  )}
                </Stack>
              </DialogContent>

              <DialogActions sx={{ px: 3, py: 2, justifyContent: "space-between" }}>
                <Button
                  color="error"
                  variant="text"
                  startIcon={<DeleteIcon />}
                  onClick={() => {
                    updateMapping(key, "lookup", null);
                    setActiveLookupKey(null);
                  }}
                  sx={{ textTransform: "none" }}
                >
                  Remove lookup replacement
                </Button>
                <Button
                  variant="contained"
                  onClick={() => setActiveLookupKey(null)}
                  sx={{ textTransform: "none", px: 3 }}
                >
                  Done
                </Button>
              </DialogActions>
            </Dialog>
          );
        })()}

      </CardContent>
    </Card>
  );
}
