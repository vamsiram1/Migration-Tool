import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

export default function TableList({
  mysqlTables,
  postgresTables,
  mappings,
  setMappings,
  selectedTable,
  onSelectTable,
}) {
  const [sourceTable, setSourceTable] = useState("");
  const [destinationTable, setDestinationTable] = useState("");

  const addMapping = () => {
    if (!sourceTable || !destinationTable) return;

    const key = sourceTable === "no table" ? `no table (${destinationTable})` : sourceTable;

    setMappings((previous) => ({
      ...previous,
      [key]: {
        selected: true,
        destination: destinationTable,
      },
    }));
    setSourceTable("");
    setDestinationTable("");
  };

  const updateMapping = (source, field, value) => {
    setMappings((previous) => ({
      ...previous,
      [source]: {
        ...previous[source],
        [field]: value,
      },
    }));
  };

  const removeMapping = (source) => {
    setMappings((previous) => {
      const next = { ...previous };
      delete next[source];
      return next;
    });
  };

  const availableMysqlTables = mysqlTables.filter(
    (table) => !Object.hasOwn(mappings, table.table_name)
  );

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Typography variant="h5" gutterBottom>
          Table Mapping
        </Typography>

        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mb: 3 }}>
          <FormControl fullWidth>
            <InputLabel id="mysql-table-label">MySQL table</InputLabel>
            <Select
              labelId="mysql-table-label"
              label="MySQL table"
              value={sourceTable}
              onChange={(event) => setSourceTable(event.target.value)}
            >
              <MenuItem value="no table">no table</MenuItem>
              {availableMysqlTables.map((table) => (
                <MenuItem key={table.table_name} value={table.table_name}>
                  {table.table_name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel id="postgres-table-label">PostgreSQL table</InputLabel>
            <Select
              labelId="postgres-table-label"
              label="PostgreSQL table"
              value={destinationTable}
              onChange={(event) => setDestinationTable(event.target.value)}
            >
              {postgresTables.map((table) => (
                <MenuItem key={table.table_name} value={table.table_name}>
                  {table.table_name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            variant="contained"
            onClick={addMapping}
            disabled={!sourceTable || !destinationTable}
            sx={{ minWidth: 150 }}
          >
            Add mapping
          </Button>
        </Stack>

        {Object.keys(mappings).length === 0 ? (
          <Alert severity="info">Choose a MySQL table and its PostgreSQL destination to add a mapping.</Alert>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Include</TableCell>
                  <TableCell>MySQL table</TableCell>
                  <TableCell>PostgreSQL table</TableCell>
                  <TableCell>Columns</TableCell>
                  <TableCell>Remove</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(mappings).map(([source, mapping]) => (
                  <TableRow key={source}>
                    <TableCell>
                      <Checkbox
                        checked={mapping.selected}
                        onChange={(event) => updateMapping(source, "selected", event.target.checked)}
                      />
                    </TableCell>
                    <TableCell>{source}</TableCell>
                    <TableCell>{mapping.destination}</TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        onClick={() => onSelectTable(source)}
                        disabled={!mapping.selected}
                        variant={selectedTable === source ? "contained" : "outlined"}
                      >
                        {selectedTable === source ? "Mapping" : "Map columns"}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Button color="error" onClick={() => removeMapping(source)}>Remove</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
