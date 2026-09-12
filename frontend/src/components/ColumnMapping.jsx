import {
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  SwapHoriz as SwapHorizIcon,
  Close as CloseIcon,
  Tune as SettingsIcon,
} from "@mui/icons-material";
import { useState, useEffect } from "react";
import { mysqlColumns as loadMysqlColumns, mysqlTables as loadMysqlTables, postgresColumns as loadPostgresColumns, postgresTables as loadPostgresTables } from "../services/database";

export default function ColumnMapping({
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
      { from: "", to: "" },
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

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>

        <Typography variant="h5" gutterBottom>
          Column Mapping
        </Typography>

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
                          {(mapping.replacements || []).map((replacement, index) => (
                            <Stack direction="row" spacing={1} key={index} alignItems="center">
                              <TextField
                                label="If value is"
                                size="small"
                                value={replacement.from}
                                onChange={(event) =>
                                  updateReplacement(key, index, "from", event.target.value)
                                }
                                sx={{ flex: 1 }}
                              />
                              <TextField
                                label="Write"
                                size="small"
                                value={replacement.to}
                                onChange={(event) =>
                                  updateReplacement(key, index, "to", event.target.value)
                                }
                                sx={{ flex: 1 }}
                              />
                              <IconButton
                                aria-label="Remove data modification"
                                color="error"
                                size="small"
                                onClick={() => removeReplacement(key, index)}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Stack>
                          ))}
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
