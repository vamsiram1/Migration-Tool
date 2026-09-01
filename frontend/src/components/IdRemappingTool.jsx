import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  Typography,
  Grid,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  Stack,
  Alert,
  AlertTitle,
  Divider,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  CircularProgress,
  InputAdornment,
  IconButton,
  Tooltip,
  Box,
  Radio,
  RadioGroup,
  FormControlLabel,
} from "@mui/material";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  SwapHoriz as SwapHorizIcon,
  RestartAlt as RestartAltIcon,
  CheckCircle as CheckCircleIcon,
  Search as SearchIcon,
  Undo as UndoIcon,
} from "@mui/icons-material";
import {
  discoverRelatedTables,
  previewIdRemap,
  executeIdRemap,
  revertIdRemap,
  fetchRemapHistory,
} from "../services/idRemapping";
import {
  postgresTables as fetchPgTables,
  postgresSchemas as fetchPgSchemas,
} from "../services/database";

const extractErrorMessage = (err, fallback) => {
  if (err.response?.data?.detail) {
    return err.response.data.detail;
  }
  if (err.message === "Network Error" || err.code === "ERR_NETWORK") {
    return "Cannot reach the backend API server. Please ensure the backend is running on port 8000 and try again.";
  }
  return err.message || fallback;
};

export default function IdRemappingTool({
  postgresConnection,
  postgresTables: initialPostgresTables,
  selectedSchema,
}) {
  // Schema and Table States
  const [pgSchemas, setPgSchemas] = useState([]);
  const [parentTable, setParentTable] = useState("");
  const [pgTables, setPgTables] = useState(initialPostgresTables || []);

  // Target schema for related tables
  const [relatedSchema, setRelatedSchema] = useState(selectedSchema || "public");
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [relatedTables, setRelatedTables] = useState([]);
  const [tableSearch, setTableSearch] = useState("");

  // Conflict handling mode: 'swap', 'auto_displace', or 'child_only'
  const [conflictMode, setConflictMode] = useState("swap");
  const [singleDisplaceId, setSingleDisplaceId] = useState("");

  // ID Mappings (for Remap/Swap mode)
  const [mappings, setMappings] = useState([
    { id: "row-1", old_id: "", new_id: "" },
  ]);

  // Preview & Execution
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [discoveredPk, setDiscoveredPk] = useState("");
  const [discoveredParentSchema, setDiscoveredParentSchema] = useState("");
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [executeResult, setExecuteResult] = useState(null);

  // Revert State
  const [lastOperation, setLastOperation] = useState(null);
  const [revertLoading, setRevertLoading] = useState(false);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const [revertResult, setRevertResult] = useState(null);

  // 1. Fetch available PostgreSQL schemas once when connection is available
  useEffect(() => {
    if (postgresConnection?.database) {
      fetchPgSchemas(postgresConnection)
        .then((res) => {
          if (Array.isArray(res.data) && res.data.length > 0) {
            setPgSchemas(res.data);
            setRelatedSchema((current) => {
              if (current && current !== "public") return current;
              if (selectedSchema) return selectedSchema;
              return res.data.some((s) => s.schema_name === "public")
                ? "public"
                : res.data[0].schema_name;
            });
          }
        })
        .catch(() => {});
    }
  }, [postgresConnection?.database, postgresConnection?.host]);

  // 2. Fetch PostgreSQL tables if not provided
  useEffect(() => {
    if (initialPostgresTables && initialPostgresTables.length > 0) {
      setPgTables(initialPostgresTables);
    } else if (postgresConnection?.database) {
      fetchPgTables({
        ...postgresConnection,
        schema_name: selectedSchema || "public",
      })
        .then((res) => {
          if (Array.isArray(res.data)) {
            setPgTables(res.data);
          }
        })
        .catch(() => {});
    }
  }, [initialPostgresTables, postgresConnection, selectedSchema]);

  // 3. Trigger Discovery of Related PostgreSQL Tables
  const fetchRelatedTables = async () => {
    if (!parentTable) {
      setError("Please select a PostgreSQL parent table first.");
      return;
    }

    setError("");
    setDiscoveryLoading(true);
    setRelatedTables([]);
    setPreviewData(null);
    setExecuteResult(null);

    try {
      const res = await discoverRelatedTables({
        connection: postgresConnection,
        parent_table: parentTable,
        target_schema: relatedSchema,
      });

      const data = res.data;
      if (!data.success) {
        setError(data.error || "Failed to discover related tables.");
        return;
      }

      if (data.primary_key_column) {
        setDiscoveredPk(data.primary_key_column);
      }
      if (data.parent_schema) {
        setDiscoveredParentSchema(data.parent_schema);
      }

      const tablesWithSelection = (data.related_tables || []).map((t) => ({
        ...t,
        selected: true,
        affected_rows_count: 0,
      }));
      setRelatedTables(tablesWithSelection);
    } catch (err) {
      setError(
        extractErrorMessage(err, "Failed to discover related tables in PostgreSQL.")
      );
    } finally {
      setDiscoveryLoading(false);
    }
  };

  // Dynamic Mapping Handlers
  const handleAddMapping = () => {
    setMappings((prev) => [
      ...prev,
      { id: `row-${Date.now()}`, old_id: "", new_id: "" },
    ]);
  };

  const handleRemoveMapping = (id) => {
    if (mappings.length <= 1) return;
    setMappings((prev) => prev.filter((m) => m.id !== id));
  };

  const handleMappingChange = (id, field, value) => {
    setMappings((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: value } : m))
    );
  };

  const handleClearMappings = () => {
    setMappings([{ id: "row-1", old_id: "", new_id: "" }]);
    setSingleDisplaceId("");
    setPreviewData(null);
    setExecuteResult(null);
  };

  // Normalized helper key
  const getTableRowKey = (t) => {
    const s = (t.child_schema || "").toLowerCase();
    const tbl = (t.child_table || "").toLowerCase();
    const fk = (t.foreign_key_column || "").toLowerCase();
    return `${s}.${tbl}.${fk}`;
  };

  // Toggle selection for a specific table row
  const handleToggleTableRowKey = (targetKey) => {
    setRelatedTables((prev) =>
      prev.map((t) => {
        if (getTableRowKey(t) === targetKey) {
          return { ...t, selected: !t.selected };
        }
        return t;
      })
    );
  };

  // Select all / Deselect all
  const handleSelectAll = (select) => {
    if (tableSearch.trim()) {
      const visibleKeys = new Set(filteredRelatedTables.map(getTableRowKey));
      setRelatedTables((prev) =>
        prev.map((t) => {
          if (visibleKeys.has(getTableRowKey(t))) {
            return { ...t, selected: select };
          }
          return t;
        })
      );
    } else {
      setRelatedTables((prev) => prev.map((t) => ({ ...t, selected: select })));
    }
  };

  // Validate ID inputs
  const validateInputs = () => {
    if (!parentTable) {
      setError("Please select a PostgreSQL parent table.");
      return false;
    }

    if (conflictMode === "auto_displace") {
      if (!singleDisplaceId.trim()) {
        setError("Please enter the Existing ID to change.");
        return false;
      }
      return true;
    }

    for (let i = 0; i < mappings.length; i++) {
      const row = mappings[i];
      const oldVal = row.old_id.trim();
      const newVal = row.new_id.trim();
      const rowNum = i + 1;

      if (!oldVal) {
        setError(`Mapping Row #${rowNum}: Please enter Old ID / ID A.`);
        return false;
      }
      if (!newVal) {
        setError(`Mapping Row #${rowNum}: Please enter New ID / ID B.`);
        return false;
      }
      if (oldVal === newVal) {
        setError(
          `Mapping Row #${rowNum}: Old ID '${oldVal}' and New ID cannot be the same.`
        );
        return false;
      }
    }

    return true;
  };

  // Preview & Count Rows for Selected Tables
  const handlePreview = async () => {
    setError("");
    setPreviewData(null);
    setExecuteResult(null);

    if (!validateInputs()) return;

    const cleanedMappings =
      conflictMode === "auto_displace"
        ? [{ old_id: singleDisplaceId.trim(), new_id: "" }]
        : mappings.map((m) => ({
            old_id: m.old_id.trim(),
            new_id: m.new_id.trim(),
          }));

    const selectedChildren = relatedTables
      .filter((t) => t.selected)
      .map((t) => ({
        child_schema: t.child_schema,
        child_table: t.child_table,
        foreign_key_column: t.foreign_key_column,
      }));

    try {
      setPreviewLoading(true);
      const res = await previewIdRemap({
        connection: postgresConnection,
        parent_table: parentTable,
        mappings: cleanedMappings,
        old_id: cleanedMappings[0].old_id,
        new_id: cleanedMappings[0].new_id || undefined,
        target_schemas: relatedSchema === "__ALL__" ? [] : [relatedSchema],
        selected_child_tables: selectedChildren,
        conflict_mode: conflictMode,
      });

      const data = res.data;
      if (!data.success) {
        setError(data.conflict_message || "Validation failed.");
        return;
      }

      setPreviewData(data);

      // Merge returned row counts back into relatedTables
      if (Array.isArray(data.related_tables)) {
        const countMap = new Map();
        data.related_tables.forEach((t) => {
          const key = `${t.child_schema}.${t.child_table}.${t.foreign_key_column}`;
          countMap.set(key, t.affected_rows_count);
        });

        setRelatedTables((prev) =>
          prev.map((t) => {
            const key = getTableRowKey(t);
            return {
              ...t,
              affected_rows_count: countMap.has(key) ? countMap.get(key) : t.affected_rows_count,
            };
          })
        );
      }
    } catch (err) {
      setError(
        extractErrorMessage(err, "Failed to inspect PostgreSQL foreign-key and logical relationships.")
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  // Pre-Execution Dialog Opener
  const handleOpenExecuteDialog = () => {
    setError("");
    if (!validateInputs()) return;
    setConfirmOpen(true);
  };

  // Atomic Execution
  const handleExecuteConfirm = async () => {
    setConfirmOpen(false);
    setError("");
    setExecuteLoading(true);
    setExecuteResult(null);

    const selectedChildren = relatedTables
      .filter((t) => t.selected)
      .map((t) => ({
        child_schema: t.child_schema,
        child_table: t.child_table,
        foreign_key_column: t.foreign_key_column,
      }));

    const cleanedMappings =
      conflictMode === "auto_displace"
        ? [{ old_id: singleDisplaceId.trim(), new_id: "" }]
        : (previewData?.mappings?.length
            ? previewData.mappings.map((m) => ({ old_id: m.old_id, new_id: m.new_id }))
            : mappings.map((m) => ({ old_id: m.old_id.trim(), new_id: m.new_id.trim() })));

    try {
      const res = await executeIdRemap({
        connection: postgresConnection,
        parent_schema: previewData?.parent_schema || discoveredParentSchema || undefined,
        parent_table: previewData?.parent_table || parentTable,
        primary_key_column: previewData?.primary_key_column || discoveredPk || undefined,
        mappings: cleanedMappings,
        old_id: cleanedMappings[0]?.old_id || "",
        new_id: cleanedMappings[0]?.new_id || "",
        selected_child_tables: selectedChildren,
        conflict_mode: conflictMode,
      });

      setExecuteResult(res.data);
      setLastOperation(res.data);
      setRevertResult(null);
      // Reset inputs after successful transaction
      setPreviewData(null);
      if (conflictMode === "auto_displace") {
        setSingleDisplaceId("");
      } else {
        setMappings([{ id: "row-1", old_id: "", new_id: "" }]);
      }
      setTableSearch("");
    } catch (err) {
      setError(
        extractErrorMessage(err, "Transaction failed. All PostgreSQL changes have been rolled back.")
      );
    } finally {
      setExecuteLoading(false);
    }
  };

  // Open Revert Dialog
  const handleOpenRevertDialog = () => {
    setError("");
    setRevertConfirmOpen(true);
  };

  // Execute Database Revert
  const handleRevertConfirm = async () => {
    setRevertConfirmOpen(false);
    setError("");
    setRevertLoading(true);
    setRevertResult(null);

    try {
      const res = await revertIdRemap({
        connection: postgresConnection,
        operation_id: lastOperation?.operation_id || undefined,
      });

      setRevertResult(res.data);
      setLastOperation(null);
      setExecuteResult(null);

      // Refresh related tables counts if parent table is currently loaded
      if (parentTable) {
        fetchRelatedTables();
      }
    } catch (err) {
      setError(
        extractErrorMessage(err, "Failed to revert the last database operation.")
      );
    } finally {
      setRevertLoading(false);
    }
  };

  // Filter tables based on search term
  const filteredRelatedTables = relatedTables.filter((t) => {
    if (!tableSearch.trim()) return true;
    const q = tableSearch.toLowerCase().trim();
    const fullTableName = `${t.child_schema}.${t.child_table}`.toLowerCase();
    return (
      fullTableName.includes(q) ||
      t.child_schema?.toLowerCase().includes(q) ||
      t.child_table?.toLowerCase().includes(q) ||
      t.foreign_key_column?.toLowerCase().includes(q) ||
      t.constraint_name?.toLowerCase().includes(q)
    );
  });

  const selectedTablesCount = relatedTables.filter((t) => t.selected).length;
  const filteredSelectedCount = filteredRelatedTables.filter((t) => t.selected).length;
  const allFilteredSelected =
    filteredRelatedTables.length > 0 &&
    filteredSelectedCount === filteredRelatedTables.length;
  const someFilteredSelected =
    filteredSelectedCount > 0 &&
    filteredSelectedCount < filteredRelatedTables.length;

  return (
    <Card sx={{ mt: 3, border: 1, borderColor: "primary.light" }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="h5" color="primary.main" sx={{ fontWeight: "bold" }}>
            ⚡ PostgreSQL ID Remapping & Cascading Tool
          </Typography>
          <Chip
            label={`PostgreSQL: ${postgresConnection?.database || "postgres"}`}
            size="small"
            color="primary"
            variant="outlined"
          />
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Operates <strong>strictly on PostgreSQL</strong>. Safely remap or swap multiple IDs in a PostgreSQL table and cascade updates to selected PostgreSQL related tables across schemas in a single atomic transaction.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}

        {revertResult && (
          <Alert severity="info" sx={{ mb: 2 }} onClose={() => setRevertResult(null)}>
            <AlertTitle sx={{ fontWeight: "bold" }}>↩️ PostgreSQL Changes Reverted Successfully!</AlertTitle>
            <Typography variant="body2">{revertResult.message}</Typography>
            <Typography variant="caption" color="text.secondary">
              Table: <strong>{revertResult.parent_schema}.{revertResult.parent_table}</strong> | Reverted At: {revertResult.timestamp} | Related Tables Restored: {revertResult.updated_child_tables?.length || 0}
            </Typography>
          </Alert>
        )}

        {executeResult && (
          <Alert
            severity="success"
            sx={{ mb: 2 }}
            onClose={() => setExecuteResult(null)}
            action={
              <Button
                color="warning"
                size="small"
                variant="outlined"
                startIcon={<UndoIcon />}
                onClick={handleOpenRevertDialog}
                sx={{ mt: 0.5, bgcolor: "background.paper" }}
              >
                Revert This Change
              </Button>
            }
          >
            <AlertTitle sx={{ fontWeight: "bold" }}>
              {executeResult.is_swap || executeResult.operation_type === "multi_swap"
                ? "PostgreSQL ID Swap Succeeded!"
                : (executeResult.operation_type === "child_only"
                  ? "PostgreSQL Child Tables ID Remap Succeeded!"
                  : (executeResult.operation_type === "auto_displace"
                    ? "PostgreSQL ID Auto-Displace Succeeded!"
                    : "PostgreSQL ID Remap Succeeded!"))}
            </AlertTitle>
            <Typography variant="body2">{executeResult.message}</Typography>
            <Typography variant="caption" color="text.secondary">
              Operation: <strong>{executeResult.operation_type?.toUpperCase() || "ID OPERATION"}</strong> | Timestamp: {executeResult.timestamp} | Parent Rows: {executeResult.updated_parent_rows} | Related Tables Updated: {executeResult.updated_child_tables?.length || 0}
            </Typography>
          </Alert>
        )}

        {/* STEP 1: Parent Table & Related Schema Selection */}
        <Paper variant="outlined" sx={{ p: 2.5, mb: 3, bgcolor: "background.paper" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: "bold", mb: 2 }}>
            1. Select PostgreSQL Parent Table & Related Tables Schema
          </Typography>

          <Grid container spacing={2}>
            {/* Parent Table */}
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel id="parent-table-select-label">PostgreSQL Parent Table</InputLabel>
                <Select
                  labelId="parent-table-select-label"
                  label="PostgreSQL Parent Table"
                  value={parentTable}
                  MenuProps={{ disableAutoFocusItem: true }}
                  onChange={(e) => {
                    setParentTable(e.target.value);
                    setPreviewData(null);
                    setError("");
                  }}
                >
                  <MenuItem value="">-- Select PostgreSQL Table --</MenuItem>
                  {pgTables.map((t) => (
                    <MenuItem key={t.table_name} value={t.table_name}>
                      {t.table_name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Related Tables Schema */}
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel id="related-schema-select-label">Schema for Related Tables</InputLabel>
                <Select
                  labelId="related-schema-select-label"
                  label="Schema for Related Tables"
                  value={relatedSchema}
                  MenuProps={{ disableAutoFocusItem: true }}
                  onChange={(e) => setRelatedSchema(e.target.value)}
                >
                  {pgSchemas.map((s) => (
                    <MenuItem key={s.schema_name} value={s.schema_name}>
                      {s.schema_name}
                    </MenuItem>
                  ))}
                  <MenuItem value="__ALL__">
                    <em>🌐 All Schemas (Full Database)</em>
                  </MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>

          {/* Button below dropdown to get tables without entering IDs */}
          <Box sx={{ mt: 2.5, display: "flex", justifyContent: "flex-end" }}>
            <Button
              variant="contained"
              color="primary"
              onClick={() => fetchRelatedTables(parentTable, relatedSchema)}
              disabled={!parentTable || discoveryLoading}
              startIcon={
                discoveryLoading ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <SearchIcon />
                )
              }
            >
              {discoveryLoading ? "Searching Related Tables..." : "Get Related Tables"}
            </Button>
          </Box>
        </Paper>

        {/* STEP 2: Discovered Related Tables List */}
        {parentTable && (
          <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", sm: "center" }}
              spacing={1}
              sx={{ mb: 2 }}
            >
              <div>
                <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
                  2. Discovered Related Tables in Schema ({relatedSchema === "__ALL__" ? "All Schemas" : relatedSchema})
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Found <strong>{relatedTables.length}</strong> related table(s) referencing <strong>{parentTable}</strong>. Check/uncheck tables to cascade updates.
                </Typography>
              </div>

              {relatedTables.length > 0 && (
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => handleSelectAll(true)}
                  >
                    {tableSearch.trim() ? "Select Filtered" : "Select All"}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="inherit"
                    onClick={() => handleSelectAll(false)}
                  >
                    {tableSearch.trim() ? "Deselect Filtered" : "Deselect All"}
                  </Button>
                </Stack>
              )}
            </Stack>

            {/* Quick Filter */}
            {relatedTables.length > 0 && (
              <TextField
                fullWidth
                size="small"
                label="Filter Related Tables"
                placeholder="Search by table name, column, or rule (e.g. 'class_id', 'student')..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                sx={{ mb: 2 }}
                InputProps={{
                  endAdornment: tableSearch ? (
                    <InputAdornment position="end">
                      <Button size="small" onClick={() => setTableSearch("")}>
                        Clear
                      </Button>
                    </InputAdornment>
                  ) : null,
                }}
              />
            )}

            {discoveryLoading ? (
              <Box sx={{ py: 3, textAlign: "center" }}>
                <CircularProgress size={28} sx={{ mb: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  Discovering related tables in schema...
                </Typography>
              </Box>
            ) : filteredRelatedTables.length === 0 ? (
              <Alert severity="info" sx={{ my: 1 }}>
                {tableSearch.trim()
                  ? `No related tables matched "${tableSearch}".`
                  : `No referencing child tables found in schema '${relatedSchema}'. Only the parent table row ID(s) will be updated.`}
              </Alert>
            ) : (
              <TableContainer sx={{ mb: 1, maxHeight: 360 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={allFilteredSelected}
                          indeterminate={someFilteredSelected}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          inputProps={{ "aria-label": "select all related tables" }}
                        />
                      </TableCell>
                      <TableCell><strong>PostgreSQL Table</strong></TableCell>
                      <TableCell><strong>Referencing Column</strong></TableCell>
                      <TableCell><strong>Type</strong></TableCell>
                      <TableCell><strong>Constraint / Rule</strong></TableCell>
                      <TableCell align="right"><strong>Affected Records</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredRelatedTables.map((rel) => {
                      const rowKey = getTableRowKey(rel);
                      const isChecked = Boolean(rel.selected);

                      return (
                        <TableRow
                          key={rowKey}
                          hover
                          onClick={() => handleToggleTableRowKey(rowKey)}
                          sx={{
                            cursor: "pointer",
                            bgcolor: isChecked ? "action.hover" : "inherit",
                            opacity: isChecked ? 1 : 0.55,
                            transition: "background-color 0.15s ease, opacity 0.15s ease",
                          }}
                        >
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={isChecked}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => handleToggleTableRowKey(rowKey)}
                              inputProps={{ "aria-label": `select ${rowKey}` }}
                            />
                          </TableCell>
                          <TableCell>
                            <strong>{rel.child_schema}.{rel.child_table}</strong>
                          </TableCell>
                          <TableCell>
                            <code>{rel.foreign_key_column}</code>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={rel.match_type === "foreign_key" ? "🔒 SQL FK" : "🔍 Logical Match"}
                              color={rel.match_type === "foreign_key" ? "secondary" : "info"}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {rel.constraint_name}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            {rel.affected_rows_count !== null && rel.affected_rows_count !== undefined ? (
                              <Chip
                                label={`${rel.affected_rows_count} rows`}
                                size="small"
                                color={isChecked ? (rel.affected_rows_count > 0 ? "primary" : "default") : "default"}
                                variant={isChecked && rel.affected_rows_count > 0 ? "filled" : "outlined"}
                              />
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                {isChecked ? "Selected for Remap" : "Excluded"}
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        )}

        {/* STEP 3: Enter IDs & Execution */}
        {parentTable && (
          <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
                3. Configure ID Operation (Remap / Swap / Auto-Displace)
              </Typography>
              {conflictMode === "swap" && mappings.length > 1 && (
                <Chip
                  label={`${mappings.length} ID Mappings`}
                  color="primary"
                  size="small"
                  variant="outlined"
                />
              )}
            </Stack>

            {/* Operation Mode Selector: 3 Visual Mode Cards */}
            <Grid container spacing={2} sx={{ mb: 2.5 }} alignItems="stretch">
              {/* Tile 1: Remap / Swap IDs */}
              <Grid size={{ xs: 12, md: 4 }} sx={{ display: "flex" }}>
                <Paper
                  variant="outlined"
                  onClick={() => {
                    setConflictMode("swap");
                    setPreviewData(null);
                    setError("");
                  }}
                  sx={{
                    p: 2,
                    cursor: "pointer",
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    borderRadius: 2,
                    borderWidth: 2,
                    borderColor: conflictMode === "swap" ? "primary.main" : "divider",
                    bgcolor: (theme) =>
                      conflictMode === "swap"
                        ? theme.palette.mode === "dark"
                          ? "rgba(25, 118, 210, 0.15)"
                          : "rgba(25, 118, 210, 0.06)"
                        : "background.paper",
                    transition: "all 0.2s ease-in-out",
                    "&:hover": { borderColor: "primary.light" },
                  }}
                >
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <Radio checked={conflictMode === "swap"} size="small" sx={{ p: 0 }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: "bold", color: conflictMode === "swap" ? "primary.main" : "text.primary" }}>
                        🔄 Remap / Swap IDs
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5, minHeight: 38 }}>
                      Updates <strong>Parent Table</strong> primary keys & cascades to related tables. Multi-step chaining and mutual swaps supported.
                    </Typography>
                  </Box>
                  <Box sx={{ alignSelf: "flex-start" }}>
                    <Chip label="Parent + Children" size="small" color={conflictMode === "swap" ? "primary" : "default"} variant="outlined" />
                  </Box>
                </Paper>
              </Grid>

              {/* Tile 2: Displace & Generate New ID */}
              <Grid size={{ xs: 12, md: 4 }} sx={{ display: "flex" }}>
                <Paper
                  variant="outlined"
                  onClick={() => {
                    setConflictMode("auto_displace");
                    setPreviewData(null);
                    setError("");
                  }}
                  sx={{
                    p: 2,
                    cursor: "pointer",
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    borderRadius: 2,
                    borderWidth: 2,
                    borderColor: conflictMode === "auto_displace" ? "secondary.main" : "divider",
                    bgcolor: (theme) =>
                      conflictMode === "auto_displace"
                        ? theme.palette.mode === "dark"
                          ? "rgba(156, 39, 176, 0.15)"
                          : "rgba(156, 39, 176, 0.06)"
                        : "background.paper",
                    transition: "all 0.2s ease-in-out",
                    "&:hover": { borderColor: "secondary.light" },
                  }}
                >
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <Radio checked={conflictMode === "auto_displace"} size="small" color="secondary" sx={{ p: 0 }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: "bold", color: conflictMode === "auto_displace" ? "secondary.main" : "text.primary" }}>
                        ✨ Auto-Displace ID
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5, minHeight: 38 }}>
                      Enter <strong>ONE ID</strong> to change to the next available ID (Max + 1) in Parent Table and cascade to child tables.
                    </Typography>
                  </Box>
                  <Box sx={{ alignSelf: "flex-start" }}>
                    <Chip label="Auto (Max + 1)" size="small" color={conflictMode === "auto_displace" ? "secondary" : "default"} variant="outlined" />
                  </Box>
                </Paper>
              </Grid>

              {/* Tile 3: Child Tables Only */}
              <Grid size={{ xs: 12, md: 4 }} sx={{ display: "flex" }}>
                <Paper
                  variant="outlined"
                  onClick={() => {
                    setConflictMode("child_only");
                    setPreviewData(null);
                    setError("");
                  }}
                  sx={{
                    p: 2,
                    cursor: "pointer",
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    borderRadius: 2,
                    borderWidth: 2,
                    borderColor: conflictMode === "child_only" ? "warning.main" : "divider",
                    bgcolor: (theme) =>
                      conflictMode === "child_only"
                        ? theme.palette.mode === "dark"
                          ? "rgba(237, 108, 2, 0.15)"
                          : "rgba(237, 108, 2, 0.06)"
                        : "background.paper",
                    transition: "all 0.2s ease-in-out",
                    "&:hover": { borderColor: "warning.light" },
                  }}
                >
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <Radio checked={conflictMode === "child_only"} size="small" color="warning" sx={{ p: 0 }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: "bold", color: conflictMode === "child_only" ? "warning.main" : "text.primary" }}>
                        🎯 Child Tables Only
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5, minHeight: 38 }}>
                      Updates foreign keys in <strong>Selected Child Tables ONLY</strong>. Parent table (<code>{parentTable}</code>) is untouched.
                    </Typography>
                  </Box>
                  <Box sx={{ alignSelf: "flex-start" }}>
                    <Chip label="Child FKs Only" size="small" color={conflictMode === "child_only" ? "warning" : "default"} variant="outlined" />
                  </Box>
                </Paper>
              </Grid>
            </Grid>

            {/* SCENARIO 1: Remap / Swap IDs UI */}
            {conflictMode === "swap" && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2.5,
                  mb: 2.5,
                  borderRadius: 2,
                  borderColor: "primary.light",
                  bgcolor: (theme) => (theme.palette.mode === "dark" ? "grey.900" : "grey.50"),
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: "bold", color: "primary.main" }}>
                    🔄 Scenario 1: Parent & Related Tables ID Remapping / Swapping
                  </Typography>
                </Stack>
                <Alert severity="info" sx={{ py: 0.5, px: 1.5, mb: 2 }}>
                  <Typography variant="caption">
                    Changes apply to <strong>{parentTable}</strong> and cascade to <strong>{selectedTablesCount} selected child tables</strong>. If the target ID already exists, a mutual swap will be performed atomically.
                  </Typography>
                </Alert>

                <Stack spacing={1.5}>
                  {mappings.map((row, index) => (
                    <Paper
                      key={row.id}
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        bgcolor: "background.paper",
                        borderColor: "divider",
                      }}
                    >
                      <Grid container spacing={2} alignItems="center">
                        <Grid size={{ xs: 12, sm: 1 }} sx={{ textAlign: { xs: "left", sm: "center" } }}>
                          <Typography variant="body2" sx={{ fontWeight: "bold", color: "text.secondary" }}>
                            #{index + 1}
                          </Typography>
                        </Grid>

                        <Grid size={{ xs: 12, sm: 4.5 }}>
                          <TextField
                            fullWidth
                            size="small"
                            label={`Old ID (in ${parentTable})`}
                            placeholder="e.g. 1"
                            value={row.old_id}
                            onChange={(e) => handleMappingChange(row.id, "old_id", e.target.value)}
                          />
                        </Grid>

                        <Grid size={{ xs: 12, sm: 1 }} sx={{ textAlign: "center", display: "flex", justifyContent: "center", alignItems: "center" }}>
                          <SwapHorizIcon color="primary" />
                        </Grid>

                        <Grid size={{ xs: 12, sm: 4.5 }}>
                          <TextField
                            fullWidth
                            size="small"
                            label={`New ID (to assign or swap)`}
                            placeholder="e.g. 2"
                            value={row.new_id}
                            onChange={(e) => handleMappingChange(row.id, "new_id", e.target.value)}
                          />
                        </Grid>

                        <Grid size={{ xs: 12, sm: 1 }} sx={{ textAlign: { xs: "right", sm: "center" } }}>
                          {mappings.length > 1 ? (
                            <Tooltip title="Remove this mapping row">
                              <IconButton color="error" size="small" onClick={() => handleRemoveMapping(row.id)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              Step 1
                            </Typography>
                          )}
                        </Grid>
                      </Grid>
                    </Paper>
                  ))}
                </Stack>
              </Paper>
            )}

            {/* SCENARIO 2: Auto-Displace Mode UI */}
            {conflictMode === "auto_displace" && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2.5,
                  mb: 2.5,
                  borderRadius: 2,
                  borderColor: "secondary.light",
                  bgcolor: (theme) => (theme.palette.mode === "dark" ? "grey.900" : "grey.50"),
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: "bold", color: "secondary.main" }}>
                    ✨ Scenario 2: Displace & Auto-Generate Unique ID (Max + 1)
                  </Typography>
                </Stack>
                <Alert severity="secondary" sx={{ py: 0.5, px: 1.5, mb: 2, bgcolor: (theme) => theme.palette.mode === "dark" ? "rgba(156, 39, 176, 0.1)" : "rgba(156, 39, 176, 0.05)" }}>
                  <Typography variant="caption">
                    Enter the ID you want to displace. The system will calculate the next highest available unused ID (<code>MAX(id) + 1</code>) and update <strong>{parentTable}</strong> and all selected child tables.
                  </Typography>
                </Alert>

                <Grid container spacing={2} alignItems="center">
                  <Grid size={{ xs: 12, sm: 8, md: 6 }}>
                    <TextField
                      fullWidth
                      size="small"
                      label={`Existing ID in ${parentTable} to Change`}
                      placeholder="e.g. 1"
                      value={singleDisplaceId}
                      onChange={(e) => {
                        setSingleDisplaceId(e.target.value);
                        setPreviewData(null);
                        setError("");
                      }}
                      helperText="This record's ID will be changed to Max + 1 in PostgreSQL, cascading to selected child tables."
                    />
                  </Grid>
                </Grid>
              </Paper>
            )}

            {/* SCENARIO 3: Child Tables Only Mode UI */}
            {conflictMode === "child_only" && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2.5,
                  mb: 2.5,
                  borderRadius: 2,
                  borderColor: "warning.main",
                  bgcolor: (theme) => (theme.palette.mode === "dark" ? "grey.900" : "rgba(237, 108, 2, 0.02)"),
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: "bold", color: "warning.main" }}>
                    🎯 Scenario 3: Child Tables Only Foreign Key Reassignment
                  </Typography>
                </Stack>

                <Alert severity="warning" sx={{ py: 0.75, px: 1.5, mb: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: "bold" }}>
                    🛡️ Parent Table Protection:
                  </Typography>
                  <Typography variant="caption">
                    The parent table (<code>{parentTable}</code>) will <strong>NOT</strong> be touched. Foreign keys in the <strong>{selectedTablesCount} selected child tables</strong> will be redirected from the Old Foreign Key ID to an existing Parent ID.
                  </Typography>
                </Alert>

                {mappings.map((row, index) => (
                  <Paper
                    key={row.id}
                    variant="outlined"
                    sx={{
                      p: 2,
                      bgcolor: "background.paper",
                      borderColor: "warning.light",
                      borderRadius: 1.5,
                    }}
                  >
                    <Grid container spacing={2} alignItems="center">
                      <Grid size={{ xs: 12, sm: 5 }}>
                        <TextField
                          fullWidth
                          size="small"
                          label="Current Foreign Key ID (in Child Tables)"
                          placeholder="e.g. 1"
                          value={row.old_id}
                          onChange={(e) => handleMappingChange(row.id, "old_id", e.target.value)}
                          helperText="Rows in selected child tables with this foreign key will be updated"
                        />
                      </Grid>

                      <Grid size={{ xs: 12, sm: 2 }} sx={{ textAlign: "center", display: "flex", justifyContent: "center", alignItems: "center" }}>
                        <Typography variant="h5" sx={{ color: "warning.main", fontWeight: "bold" }}>
                          ➔
                        </Typography>
                      </Grid>

                      <Grid size={{ xs: 12, sm: 5 }}>
                        <TextField
                          fullWidth
                          size="small"
                          label={`New Target Parent ID (Must exist in ${parentTable})`}
                          placeholder="e.g. 2"
                          value={row.new_id}
                          onChange={(e) => handleMappingChange(row.id, "new_id", e.target.value)}
                          helperText={`Must be an active ID existing in parent table '${parentTable}'`}
                        />
                      </Grid>
                    </Grid>
                  </Paper>
                ))}
              </Paper>
            )}

            {/* Action Row */}
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: previewData ? 2.5 : 0 }}
            >
              <Stack direction="row" spacing={1}>
                {conflictMode === "swap" && (
                  <>
                    <Button
                      variant="outlined"
                      color="primary"
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={handleAddMapping}
                    >
                      Add Another ID Mapping
                    </Button>
                    {mappings.length > 1 && (
                      <Button
                        variant="text"
                        color="inherit"
                        size="small"
                        startIcon={<RestartAltIcon />}
                        onClick={handleClearMappings}
                      >
                        Reset to 1 Row
                      </Button>
                    )}
                  </>
                )}
              </Stack>

              <Stack direction="row" spacing={1.5} alignItems="center">
                {lastOperation && (
                  <Button
                    variant="outlined"
                    color="warning"
                    size="medium"
                    onClick={handleOpenRevertDialog}
                    disabled={revertLoading || executeLoading || previewLoading}
                    startIcon={revertLoading ? <CircularProgress size={16} color="inherit" /> : <UndoIcon />}
                  >
                    {revertLoading ? "Reverting..." : "Revert Last DB Change"}
                  </Button>
                )}

                <Button
                  variant="outlined"
                  color="primary"
                  onClick={handlePreview}
                  disabled={
                    previewLoading ||
                    discoveryLoading ||
                    (conflictMode === "auto_displace"
                      ? !singleDisplaceId.trim()
                      : mappings.some((m) => !m.old_id.trim() || !m.new_id.trim()))
                  }
                  startIcon={previewLoading ? <CircularProgress size={16} color="inherit" /> : null}
                >
                  {previewLoading ? "Checking Counts..." : "Preview / Check Counts"}
                </Button>

                <Button
                  variant="contained"
                  color="primary"
                  size="medium"
                  onClick={handleOpenExecuteDialog}
                  disabled={
                    executeLoading ||
                    previewLoading ||
                    discoveryLoading ||
                    (conflictMode === "auto_displace"
                      ? !singleDisplaceId.trim()
                      : mappings.some((m) => !m.old_id.trim() || !m.new_id.trim()))
                  }
                  startIcon={<CheckCircleIcon />}
                >
                  {conflictMode === "auto_displace"
                    ? "Execute Auto-Generate New ID"
                    : (conflictMode === "child_only"
                      ? "Execute Child Tables Only Remap"
                      : "Execute ID Remap / Swap")}
                </Button>
              </Stack>
            </Stack>

            {/* Preview Summary Info (if previewed) */}
            {previewData && (
              <Box sx={{ mt: 2.5, pt: 2, borderTop: 1, borderColor: "divider" }}>
                <Alert
                  severity={
                    previewData.operation_type === "auto_displace" || previewData.total_displaces_count > 0
                      ? "success"
                      : (previewData.operation_type === "child_only"
                        ? "warning"
                        : (previewData.is_swap || previewData.total_swaps_count > 0 ? "info" : "success"))
                  }
                  sx={{ mb: 1.5 }}
                >
                  <AlertTitle sx={{ fontWeight: "bold" }}>
                    {previewData.operation_type === "auto_displace" || previewData.total_displaces_count > 0
                      ? "✨ Displace & Auto-Generate ID Operation"
                      : (previewData.operation_type === "child_only"
                        ? "🎯 Child Tables Only ID Remap"
                        : (previewData.is_swap || previewData.total_swaps_count > 0
                          ? "🔄 ID Swap Operation"
                          : "➡️ ID Remap Operation"))}
                  </AlertTitle>
                  <Typography variant="body2">
                    {previewData.operation_type === "child_only" ? (
                      <>
                        Targeting <strong>{selectedTablesCount} selected child tables</strong>. Parent Table (<code>{previewData.parent_schema}.{previewData.parent_table}</code>) will <strong>NOT</strong> be changed.
                      </>
                    ) : (
                      <>
                        Parent Table: <strong>{previewData.parent_schema}.{previewData.parent_table}</strong> (Primary Key: <code>{previewData.primary_key_column}</code>). Total Selected Child Tables: <strong>{selectedTablesCount}</strong>.
                      </>
                    )}
                  </Typography>
                  {previewData.operation_type === "auto_displace" ? (
                    <Typography variant="body2" sx={{ mt: 0.5, fontWeight: "medium" }}>
                      Auto-Displacement: ID <strong>{previewData.old_id}</strong> will be changed to auto-generated ID <strong>{previewData.new_id}</strong> and cascaded to selected child tables.
                    </Typography>
                  ) : (
                    previewData.operation_type === "child_only" ? (
                      <Typography variant="body2" sx={{ mt: 0.5, fontWeight: "medium" }}>
                        Foreign Key Remap: ID <strong>{previewData.old_id}</strong> ➔ <strong>{previewData.new_id}</strong> in selected child tables.
                      </Typography>
                    ) : (
                      previewData.mappings?.some((m) => m.is_displace) && (
                        <Typography variant="body2" sx={{ mt: 0.5, fontWeight: "medium" }}>
                          Auto-Displacement:{" "}
                          {previewData.mappings
                            .filter((m) => m.is_displace)
                            .map((m) => `Existing row with ID ${m.new_id} will be auto-displaced to new ID ${m.displaced_new_id}`)
                            .join("; ")}
                        </Typography>
                      )
                    )
                  )}
                </Alert>
              </Box>
            )}
          </Paper>
        )}

        {/* Revert Confirmation Dialog */}
        <Dialog open={revertConfirmOpen} onClose={() => setRevertConfirmOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ fontWeight: "bold", color: "warning.main", display: "flex", alignItems: "center", gap: 1 }}>
            <UndoIcon /> Confirm Database Revert
          </DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              Are you sure you want to revert the last database changes? This will undo the changes and restore the previous IDs across PostgreSQL tables.
            </DialogContentText>

            {lastOperation && (
              <Paper
                variant="outlined"
                sx={{
                  p: 1.5,
                  mb: 2,
                  bgcolor: (theme) => (theme.palette.mode === "dark" ? "grey.900" : "grey.50"),
                  borderColor: "divider",
                }}
              >
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: "bold", mb: 0.5 }}>
                  Operation to be Reverted:
                </Typography>
                <Typography variant="body2">
                  • Parent Table: <strong>{lastOperation.parent_schema}.{lastOperation.parent_table}</strong>
                </Typography>
                <Typography variant="body2">
                  • Mode: <strong>{lastOperation.conflict_mode}</strong>
                </Typography>
                {lastOperation.mappings?.map((m, i) => (
                  <Typography key={i} variant="body2">
                    • Step #{i + 1}: Restoring <strong>{m.new_id || m.displaced_new_id}</strong> ➔ back to <strong>{m.old_id}</strong>
                  </Typography>
                ))}
                <Typography variant="body2">
                  • Related Tables to Undo: <strong>{lastOperation.updated_child_tables?.length || 0} table(s)</strong>
                </Typography>
              </Paper>
            )}

            <Alert severity="warning">
              This will execute strictly inside an atomic transaction on PostgreSQL. Primary keys and foreign keys will be restored to their prior state.
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRevertConfirmOpen(false)} color="inherit">
              Cancel
            </Button>
            <Button
              onClick={handleRevertConfirm}
              variant="contained"
              color="warning"
              startIcon={revertLoading ? <CircularProgress size={16} color="inherit" /> : <UndoIcon />}
              disabled={revertLoading}
            >
              {revertLoading ? "Reverting..." : "Yes, Revert Database Changes"}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Confirmation Dialog */}
        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ fontWeight: "bold", color: "primary.main" }}>
            Confirm PostgreSQL Atomic ID Operation
          </DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              {conflictMode === "child_only" ? (
                <>
                  Are you sure you want to update foreign keys in <strong>{selectedTablesCount} selected child tables</strong>? Parent table <strong>{parentTable}</strong> will remain unchanged.
                </>
              ) : (
                <>
                  Are you sure you want to execute ID changes on PostgreSQL table <strong>{parentTable}</strong>?
                </>
              )}
            </DialogContentText>

            <Paper variant="outlined" sx={{ p: 1.5, mb: 2, maxHeight: 180, overflowY: "auto" }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5, fontWeight: "bold" }}>
                {conflictMode === "auto_displace" ? "Configured Auto-Displace ID:" : `Configured ID Mappings (${mappings.length}):`}
              </Typography>
              {conflictMode === "auto_displace" ? (
                <Typography variant="body2">
                  • Change Existing ID <strong>{singleDisplaceId}</strong> ➔ <strong>Next Available Unused ID (Max + 1)</strong>
                </Typography>
              ) : (
                mappings.map((m, i) => (
                  <Typography key={i} variant="body2">
                    • Row #{i + 1}: <strong>{m.old_id}</strong> ➔ <strong>{m.new_id}</strong>
                  </Typography>
                ))
              )}
            </Paper>

            <DialogContentText variant="body2" sx={{ mb: 1 }}>
              • Operation: <strong>
                {conflictMode === "auto_displace"
                  ? "Auto-Generate New ID (Displace to Max + 1)"
                  : (conflictMode === "child_only"
                    ? "Child Tables Only (Skip Parent Table)"
                    : "ID Remap / Swap")}
              </strong>
            </DialogContentText>
            <DialogContentText variant="body2" sx={{ mb: 1 }}>
              • Selected PostgreSQL related tables to cascade: <strong>{selectedTablesCount} of {relatedTables.length}</strong>
            </DialogContentText>
            <Alert severity={conflictMode === "child_only" ? "info" : "warning"}>
              {conflictMode === "child_only"
                ? "This will update ONLY the selected child tables in an atomic database transaction. The parent table will not be changed."
                : `This will execute strictly on PostgreSQL inside a single atomic database transaction. Only the ${selectedTablesCount} selected PostgreSQL table(s) will be updated. (MySQL is not accessed).`}
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmOpen(false)} color="inherit">
              Cancel
            </Button>
            <Button
              onClick={handleExecuteConfirm}
              variant="contained"
              color="primary"
              autoFocus
            >
              {conflictMode === "auto_displace"
                ? "Yes, Execute Auto-Generate New ID"
                : (conflictMode === "child_only"
                  ? "Yes, Execute Child Tables Only Remap"
                  : "Yes, Execute Remap / Swap")}
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
}
