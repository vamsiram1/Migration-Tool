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
} from "@mui/material";
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
        }
      }
    };

    preloadLookupOptions();
  }, [mappings, selectedSchemas.mysql, selectedSchemas.postgres, mysqlConnection, postgresConnection]);

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
      mysqlSchema: selectedSchemas.mysql,
      mysqlTable: "",
      mysqlIdColumn: "",
      mysqlMatchColumn: "",
      additionalMatchColumns: [],
      sourceMatchColumns: [],
      postgresSchema: selectedSchemas.postgres,
      postgresTable: "",
      postgresMatchColumn: "",
      postgresResultColumn: "",
      caseInsensitive: false,
    });
  };

  const selectMysqlLookupSchema = async (column, schema) => {
    updateMapping(column, "lookup", { ...(mappings[column]?.lookup || {}), mysqlSchema: schema, mysqlTable: "", mysqlIdColumn: "", mysqlMatchColumn: "", additionalMatchColumns: [] });
    if (!schema) return;
    const response = await loadMysqlTables({ ...mysqlConnection, schema_name: schema });
    setLookupTables((previous) => ({ ...previous, [column]: { ...previous[column], mysql: response.data } }));
  };

  const selectPostgresLookupSchema = async (column, schema) => {
    updateMapping(column, "lookup", { ...(mappings[column]?.lookup || {}), postgresSchema: schema, postgresTable: "", postgresMatchColumn: "", postgresResultColumn: "", additionalMatchColumns: [] });
    if (!schema) return;
    const response = await loadPostgresTables({ ...postgresConnection, schema_name: schema });
    setLookupTables((previous) => ({ ...previous, [column]: { ...previous[column], postgres: response.data } }));
  };

  const updateLookup = (column, field, value) => {
    const lookup = mappings[column]?.lookup || {};
    updateMapping(column, "lookup", { ...lookup, [field]: value });
  };

  const addLookupMatchColumn = (column) => {
    const lookup = mappings[column]?.lookup || {};
    updateMapping(column, "lookup", {
      ...lookup,
      additionalMatchColumns: [
        ...(lookup.additionalMatchColumns || []),
        { mysqlColumn: "", postgresColumn: "" },
      ],
    });
  };

  const updateLookupMatchColumn = (column, index, field, value) => {
    const lookup = mappings[column]?.lookup || {};
    const matchColumns = [...(lookup.additionalMatchColumns || [])];
    matchColumns[index] = { ...matchColumns[index], [field]: value };
    updateMapping(column, "lookup", { ...lookup, additionalMatchColumns: matchColumns });
  };

  const removeLookupMatchColumn = (column, index) => {
    const lookup = mappings[column]?.lookup || {};
    updateMapping(column, "lookup", {
      ...lookup,
      additionalMatchColumns: (lookup.additionalMatchColumns || []).filter((_, matchIndex) => matchIndex !== index),
    });
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

  const selectMysqlLookupTable = async (column, table) => {
    updateMapping(column, "lookup", {
      ...(mappings[column]?.lookup || {}),
      mysqlTable: table,
      mysqlIdColumn: "",
      mysqlMatchColumn: "",
      additionalMatchColumns: [],
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
      additionalMatchColumns: [],
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

  const mappedPostgresColumns = new Set([
    ...Object.entries(mappings)
      .filter(([source, mapping]) => !source.startsWith("__") && mapping.selected && mapping.destination)
      .map(([, mapping]) => mapping.destination),
    ...(mappings.__rowDuplication?.parts || [])
      .map((part) => part.destination)
      .filter(Boolean),
    mappings.__rowDuplication?.typeColumn,
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

                <TableCell width="10%">
                  Include
                </TableCell>

                <TableCell width="35%">
                  MySQL Column
                </TableCell>

                <TableCell width="30%">
                  PostgreSQL Column
                </TableCell>

                <TableCell width="25%">
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

                      <TableCell>

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
                        <Stack spacing={1}>
                          {(mapping.replacements || []).map((replacement, index) => (
                            <Stack direction="row" spacing={1} key={index} alignItems="center">
                              <TextField
                                label="If value is"
                                size="small"
                                value={replacement.from}
                                onChange={(event) =>
                                  updateReplacement(key, index, "from", event.target.value)
                                }
                              />
                              <TextField
                                label="Write"
                                size="small"
                                value={replacement.to}
                                onChange={(event) =>
                                  updateReplacement(key, index, "to", event.target.value)
                                }
                              />
                              <Button
                                aria-label="Remove data modification"
                                color="error"
                                onClick={() => removeReplacement(key, index)}
                              >
                                Remove
                              </Button>
                            </Stack>
                          ))}
                          <Button
                            size="small"
                            onClick={() => addReplacement(key)}
                            disabled={!mapping.selected || !mapping.destination}
                          >
                            Add replacement
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
                          />
                          <Stack direction="row" alignItems="center">
                            <Checkbox
                              checked={mapping.nullWhenEmpty !== false}
                              onChange={(event) =>
                                updateMapping(key, "nullWhenEmpty", event.target.checked)
                              }
                              disabled={!mapping.selected || !mapping.destination || Boolean(mapping.defaultValue)}
                            />
                            <Typography variant="body2">
                              Insert NULL when input is empty or NULL
                            </Typography>
                          </Stack>
                          {mapping.lookup ? (
                            <Stack spacing={1} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}>
                              <Typography variant="subtitle2">Lookup replacement</Typography>
                              <FormControl size="small" fullWidth>
                                <InputLabel>MySQL schema</InputLabel>
                                <Select label="MySQL schema" value={mapping.lookup.mysqlSchema || selectedSchemas.mysql} onChange={(event) => selectMysqlLookupSchema(key, event.target.value)}>
                                  {availableSchemas.mysql.map((schema) => <MenuItem key={schema.schema_name} value={schema.schema_name}>{schema.schema_name}</MenuItem>)}
                                </Select>
                              </FormControl>
                              <FormControl size="small" fullWidth>
                                <InputLabel>MySQL lookup table</InputLabel>
                                <Select label="MySQL lookup table" value={mapping.lookup.mysqlTable || ""} onChange={(event) => selectMysqlLookupTable(key, event.target.value)}>
                                  {(lookupTables[key]?.mysql || ((mapping.lookup.mysqlSchema || selectedSchemas.mysql) === selectedSchemas.mysql ? mysqlTables : [])).map((table) => <MenuItem key={table.table_name} value={table.table_name}>{table.table_name}</MenuItem>)}
                                </Select>
                              </FormControl>
                              <FormControl size="small" fullWidth>
                                <InputLabel>MySQL old ID column</InputLabel>
                                <Select label="MySQL old ID column" value={mapping.lookup.mysqlIdColumn || ""} onChange={(event) => updateLookup(key, "mysqlIdColumn", event.target.value)}>
                                  {(lookupColumns[key]?.mysql || []).map((item) => <MenuItem key={item.column_name} value={item.column_name}>{item.column_name} ({item.data_type})</MenuItem>)}
                                </Select>
                              </FormControl>
                              <FormControl size="small" fullWidth>
                                <InputLabel>MySQL matching value column</InputLabel>
                                <Select label="MySQL matching value column" value={mapping.lookup.mysqlMatchColumn || ""} onChange={(event) => updateLookup(key, "mysqlMatchColumn", event.target.value)}>
                                  {(lookupColumns[key]?.mysql || []).map((item) => <MenuItem key={item.column_name} value={item.column_name}>{item.column_name} ({item.data_type})</MenuItem>)}
                                </Select>
                              </FormControl>
                              <FormControl size="small" fullWidth>
                                <InputLabel>PostgreSQL schema</InputLabel>
                                <Select label="PostgreSQL schema" value={mapping.lookup.postgresSchema || selectedSchemas.postgres} onChange={(event) => selectPostgresLookupSchema(key, event.target.value)}>
                                  {availableSchemas.postgres.map((schema) => <MenuItem key={schema.schema_name} value={schema.schema_name}>{schema.schema_name}</MenuItem>)}
                                </Select>
                              </FormControl>
                              <FormControl size="small" fullWidth>
                                <InputLabel>PostgreSQL lookup table</InputLabel>
                                <Select label="PostgreSQL lookup table" value={mapping.lookup.postgresTable || ""} onChange={(event) => selectPostgresLookupTable(key, event.target.value)}>
                                  {(lookupTables[key]?.postgres || ((mapping.lookup.postgresSchema || selectedSchemas.postgres) === selectedSchemas.postgres ? postgresTables : [])).map((table) => <MenuItem key={table.table_name} value={table.table_name}>{table.table_name}</MenuItem>)}
                                </Select>
                              </FormControl>
                              <FormControl size="small" fullWidth>
                                <InputLabel>PostgreSQL matching value column</InputLabel>
                                <Select label="PostgreSQL matching value column" value={mapping.lookup.postgresMatchColumn || ""} onChange={(event) => updateLookup(key, "postgresMatchColumn", event.target.value)}>
                                  {(lookupColumns[key]?.postgres || []).map((item) => <MenuItem key={item.column_name} value={item.column_name}>{item.column_name} ({item.data_type})</MenuItem>)}
                                </Select>
                              </FormControl>
                              {(mapping.lookup.additionalMatchColumns || []).map((matchColumn, matchIndex) => (
                                <Stack spacing={1} sx={{ borderLeft: 2, borderColor: "primary.main", pl: 1 }} key={matchIndex}>
                                  <Typography variant="caption">Additional matching field {matchIndex + 2}</Typography>
                                  <FormControl size="small" fullWidth>
                                    <InputLabel>MySQL matching value column</InputLabel>
                                    <Select label="MySQL matching value column" value={matchColumn.mysqlColumn || ""} onChange={(event) => updateLookupMatchColumn(key, matchIndex, "mysqlColumn", event.target.value)}>
                                      {(lookupColumns[key]?.mysql || []).map((item) => <MenuItem key={item.column_name} value={item.column_name}>{item.column_name} ({item.data_type})</MenuItem>)}
                                    </Select>
                                  </FormControl>
                                  <FormControl size="small" fullWidth>
                                    <InputLabel>PostgreSQL matching value column</InputLabel>
                                    <Select label="PostgreSQL matching value column" value={matchColumn.postgresColumn || ""} onChange={(event) => updateLookupMatchColumn(key, matchIndex, "postgresColumn", event.target.value)}>
                                      {(lookupColumns[key]?.postgres || []).map((item) => <MenuItem key={item.column_name} value={item.column_name}>{item.column_name} ({item.data_type})</MenuItem>)}
                                    </Select>
                                  </FormControl>
                                  <Button color="error" size="small" onClick={() => removeLookupMatchColumn(key, matchIndex)}>Remove matching field</Button>
                                </Stack>
                              ))}
                              <Button size="small" variant="outlined" onClick={() => addLookupMatchColumn(key)}>
                                Add matching field
                              </Button>
                              {(mapping.lookup.sourceMatchColumns || []).map((matchColumn, matchIndex) => (
                                <Stack spacing={1} sx={{ borderLeft: 2, borderColor: "secondary.main", pl: 1 }} key={matchIndex}>
                                  <Typography variant="caption">Current-row matching field {matchIndex + 1}</Typography>
                                  <FormControl size="small" fullWidth>
                                    <InputLabel>Current MySQL table column</InputLabel>
                                    <Select label="Current MySQL table column" value={matchColumn.mysqlSourceColumn || ""} onChange={(event) => updateSourceMatchColumn(key, matchIndex, "mysqlSourceColumn", event.target.value)}>
                                      {mysqlColumns.map((item) => <MenuItem key={item.column_name} value={item.column_name}>{item.column_name} ({item.data_type})</MenuItem>)}
                                    </Select>
                                  </FormControl>
                                  <FormControl size="small" fullWidth>
                                    <InputLabel>PostgreSQL matching value column</InputLabel>
                                    <Select label="PostgreSQL matching value column" value={matchColumn.postgresColumn || ""} onChange={(event) => updateSourceMatchColumn(key, matchIndex, "postgresColumn", event.target.value)}>
                                      {(lookupColumns[key]?.postgres || []).map((item) => <MenuItem key={item.column_name} value={item.column_name}>{item.column_name} ({item.data_type})</MenuItem>)}
                                    </Select>
                                  </FormControl>
                                  <Button color="error" size="small" onClick={() => removeSourceMatchColumn(key, matchIndex)}>Remove current-row field</Button>
                                </Stack>
                              ))}
                              <Button size="small" variant="outlined" color="secondary" onClick={() => addSourceMatchColumn(key)}>
                                Add current-table matching field
                              </Button>
                              <FormControl size="small" fullWidth>
                                <InputLabel>PostgreSQL new ID column</InputLabel>
                                <Select label="PostgreSQL new ID column" value={mapping.lookup.postgresResultColumn || ""} onChange={(event) => updateLookup(key, "postgresResultColumn", event.target.value)}>
                                  {(lookupColumns[key]?.postgres || []).map((item) => <MenuItem key={item.column_name} value={item.column_name}>{item.column_name} ({item.data_type})</MenuItem>)}
                                </Select>
                              </FormControl>
                              <Stack direction="row" alignItems="center">
                                <Checkbox checked={Boolean(mapping.lookup.caseInsensitive)} onChange={(event) => updateLookup(key, "caseInsensitive", event.target.checked)} />
                                <Typography variant="body2">Case-insensitive matching</Typography>
                              </Stack>
                              <Button color="error" size="small" onClick={() => updateMapping(key, "lookup", null)}>Remove lookup replacement</Button>
                            </Stack>
                          ) : (
                            <Button size="small" onClick={() => enableLookupReplacement(key)} disabled={!mapping.selected || !mapping.destination}>
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
                  onChange={(event) => updateRowDuplication("active", event.target.checked)}
                />
                <Typography variant="body1">Enable Row Duplication and Splitting</Typography>
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

      </CardContent>
    </Card>
  );
}
