import { useRef, useState } from "react";
import {
  Container,
  Typography,
  Grid,
  Button,
  Divider,
  Alert,
  Stack,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Tab,
  Box,
} from "@mui/material";

import DatabaseCard from "../components/DatabaseCard";
import TableList from "../components/TableList";
import ColumnMapping from "../components/ColumnMapping";
import IdRemappingTool from "../components/IdRemappingTool";
import { generatePgloaderConfig } from "../services/pgloader";
import { runDockerMigration } from "../services/dockerRun";

import {
  testMysql,
  testPostgres,
  mysqlTables,
  postgresTables,
  mysqlColumns,
  postgresColumns,
  mysqlSchemas,
  postgresSchemas,
  postgresDatabases,
} from "../services/database";

const DEFAULT_MYSQL_SCHEMA = "esaplive";
const DEFAULT_POSTGRES_SCHEMA = "public";

export default function Connection() {
  // -------------------------------
  // MySQL Connection
  // -------------------------------

  const [mysqlConnection, setMysqlConnection] = useState({
    host: "192.168.20.9",
    port: 3306,
    database: DEFAULT_MYSQL_SCHEMA,
    username: "vamsi",
    password: "Vamsi@123",
  });

  // -------------------------------
  // PostgreSQL Connection
  // -------------------------------

  const [postgresConnection, setPostgresConnection] = useState({
    host: "192.168.20.220",
    port: 5432,
    database: "postgres",
    username: "postgres",
    password: "Welcome123",
  });

  // -------------------------------
  // Schema
  // -------------------------------

  const [migration, setMigration] = useState({
    mysqlTables: [],
    postgresTables: [],
  });
  const [schemas, setSchemas] = useState({ mysql: [], postgres: [] });
  const [postgresDatabaseOptions, setPostgresDatabaseOptions] = useState([]);
  const [selectedSchemas, setSelectedSchemas] = useState({ mysql: "", postgres: "" });

  // -------------------------------
  // Table Mapping
  // -------------------------------

  const [tableMappings, setTableMappings] = useState({});
  const [columnMappings, setColumnMappings] = useState({});
  const [selectedTable, setSelectedTable] = useState(null);
  const [columns, setColumns] = useState({ mysql: [], postgres: [] });

  const [loading, setLoading] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [columnLoading, setColumnLoading] = useState(false);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [duplicatesLog, setDuplicatesLog] = useState("");
  const [savedProjects, setSavedProjects] = useState([]);
  const [selectedSavedProject, setSelectedSavedProject] = useState("");
  const [configurationRoot, setConfigurationRoot] = useState(null);
  const [projectSaving, setProjectSaving] = useState(false);
  const [dockerOutput, setDockerOutput] = useState("");
  const [dockerRunning, setDockerRunning] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const projectFileInput = useRef(null);

  const pgloaderFiles = generatePgloaderConfig({
    mysqlConnection,
    postgresConnection,
    tableMappings,
    columnMappings,
    selectedSchemas,
  });

  // -------------------------------
  // Load Tables
  // -------------------------------

  const loadTables = async () => {
    try {
      setLoading(true);
      setError("");

      const mysqlResponse = await mysqlTables({ ...mysqlConnection, schema_name: selectedSchemas.mysql });
      const postgresResponse = await postgresTables({ ...postgresConnection, schema_name: selectedSchemas.postgres });
        
      setMigration({
        mysqlTables: mysqlResponse.data,
        postgresTables: postgresResponse.data,
      });
      setTableMappings({});
      setColumnMappings({});
      setSelectedTable(null);
      setColumns({ mysql: [], postgres: [] });

    } catch (err) {
      setError(err.response?.data?.detail || "Unable to load tables");
    } finally {
      setLoading(false);
    }
  };

  const loadSchemas = async () => {
    try {
      setSchemaLoading(true);
      setError("");

      const [mysqlResponse, postgresResponse] = await Promise.all([
        mysqlSchemas(mysqlConnection),
        postgresDatabases(postgresConnection),
      ]);
      const currentDatabaseExists = postgresResponse.data.some(
        (database) => database.database_name === postgresConnection.database,
      );
      const postgresSchemaResponse = currentDatabaseExists
        ? await postgresSchemas(postgresConnection)
        : { data: [] };

      setSchemas({ mysql: mysqlResponse.data, postgres: postgresSchemaResponse.data });
      setPostgresDatabaseOptions(postgresResponse.data);
      const mysqlSchemaExists = mysqlResponse.data.some(
        (schema) => schema.schema_name === DEFAULT_MYSQL_SCHEMA,
      );
      const postgresSchemaExists = postgresSchemaResponse.data.some(
        (schema) => schema.schema_name === DEFAULT_POSTGRES_SCHEMA,
      );
      setSelectedSchemas({
        mysql: mysqlSchemaExists ? DEFAULT_MYSQL_SCHEMA : "",
        postgres: postgresSchemaExists ? DEFAULT_POSTGRES_SCHEMA : "",
      });
      setMigration({ mysqlTables: [], postgresTables: [] });
      setTableMappings({});
      setColumnMappings({});
      setSelectedTable(null);
      setColumns({ mysql: [], postgres: [] });
    } catch (err) {
      setError(err.response?.data?.detail || "Unable to load databases");
    } finally {
      setSchemaLoading(false);
    }
  };

  const selectPostgresDatabase = async (database) => {
    const nextConnection = { ...postgresConnection, database };
    setPostgresConnection(nextConnection);
    setSelectedSchemas((previous) => ({ ...previous, postgres: "" }));
    setSchemas((previous) => ({ ...previous, postgres: [] }));
    setMigration({ mysqlTables: [], postgresTables: [] });
    setTableMappings({});
    setColumnMappings({});
    setSelectedTable(null);
    setColumns({ mysql: [], postgres: [] });

    try {
      setSchemaLoading(true);
      setError("");
      const response = await postgresSchemas(nextConnection);
      setSchemas((previous) => ({ ...previous, postgres: response.data }));
    } catch (err) {
      setError(err.response?.data?.detail || "Unable to load PostgreSQL schemas");
    } finally {
      setSchemaLoading(false);
    }
  };

  const loadColumns = async (sourceTable) => {
    const destinationTable = tableMappings[sourceTable]?.destination;

    if (!destinationTable) return;

    try {
      setColumnLoading(true);
      setError("");
      setSelectedTable(sourceTable);

      if (sourceTable.startsWith("no table")) {
        const postgresResponse = await postgresColumns({ ...postgresConnection, schema_name: selectedSchemas.postgres, table_name: destinationTable });
        setColumns({
          mysql: [],
          postgres: postgresResponse.data,
        });
      } else {
        const [mysqlResponse, postgresResponse] = await Promise.all([
          mysqlColumns({ ...mysqlConnection, schema_name: selectedSchemas.mysql, table_name: sourceTable }),
          postgresColumns({ ...postgresConnection, schema_name: selectedSchemas.postgres, table_name: destinationTable }),
        ]);

        setColumns({
          mysql: mysqlResponse.data,
          postgres: postgresResponse.data,
        });
      }
    } catch (err) {
      setSelectedTable(null);
      setColumns({ mysql: [], postgres: [] });
      setError(err.response?.data?.detail || "Unable to load columns");
    } finally {
      setColumnLoading(false);
    }
  };

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(pgloaderFiles.config);
      setCopyMessage("Config copied to clipboard.");
    } catch {
      setCopyMessage("Could not copy automatically. Select the config text and copy it manually.");
    }
  };

  const downloadConfig = () => {
    const file = new Blob([pgloaderFiles.config], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mysql-to-postgres.load";
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadExportScript = () => {
    const file = new Blob([pgloaderFiles.exportScript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mysql-to-pgloader.sh";
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadLookupHelper = () => {
    const file = new Blob([pgloaderFiles.lookupHelper], { type: "text/x-python;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lookup-transform.py";
    link.click();
    URL.revokeObjectURL(url);
  };

  const currentProject = () => ({
      version: 1,
      mysqlConnection,
      postgresConnection,
      selectedSchemas,
      migration,
      tableMappings,
      columnMappings,
    });

  const saveProject = () => {
    const project = currentProject();
    const file = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mysql-to-postgres-project.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const applyProject = (project) => {
    if (
      project.version !== 1 ||
      !project.mysqlConnection ||
      !project.postgresConnection ||
      !project.selectedSchemas ||
      !project.migration ||
      !project.tableMappings ||
      !project.columnMappings
    ) {
      throw new Error("This is not a valid migration project.");
    }
    setMysqlConnection(project.mysqlConnection);
    setPostgresConnection(project.postgresConnection);
    setSelectedSchemas(project.selectedSchemas);
    setMigration(project.migration);
    setTableMappings(project.tableMappings);
    setColumnMappings(project.columnMappings);
    setSelectedTable(null);
    setColumns({ mysql: [], postgres: [] });
    setError("");
  };

  const scanConfigurationFolder = async (directory) => {
    const projects = [];
    for await (const entry of directory.values()) {
      if (entry.kind !== "directory") continue;
      try {
        const projectFileHandle = await entry.getFileHandle("project.json");
        const project = JSON.parse(await (await projectFileHandle.getFile()).text());
        const schemaName = project.selectedSchemas?.postgres || "unknown-schema";
        const tableNames = Object.entries(project.tableMappings || {})
          .filter(([, mapping]) => mapping.selected && mapping.destination)
          .map(([, mapping]) => mapping.destination);
        projects.push({
          name: entry.name,
          label: `${schemaName} / ${tableNames.join(", ") || "no table"}`,
          handle: entry,
        });
      } catch {
        // Ignore folders that are not saved migration configurations.
      }
    }
    projects.sort((left, right) => left.name.localeCompare(right.name));
    setSavedProjects(projects);
    setSelectedSavedProject((previous) =>
      projects.some(({ name }) => name === previous) ? previous : ""
    );
  };

  const selectConfigurationRoot = async () => {
    try {
      setError("");
      if (!window.showDirectoryPicker) {
        throw new Error("Folder selection requires a current version of Microsoft Edge or Google Chrome.");
      }
      const directory = await window.showDirectoryPicker({ mode: "readwrite" });
      setConfigurationRoot(directory);
      await scanConfigurationFolder(directory);
      setCopyMessage(`Selected configuration folder: ${directory.name}`);
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message || "Unable to select configuration folder");
    }
  };

  const saveToProjectFolder = async () => {
    if (!configurationRoot) {
      setError("Select a configuration folder before saving.");
      return;
    }
    if (!pgloaderFiles.config) {
      setError(pgloaderFiles.error || "Complete at least one table and column mapping before saving.");
      return;
    }
    try {
      setProjectSaving(true);
      setError("");
      const destinationTables = Object.entries(tableMappings)
        .filter(([, mapping]) => mapping.selected && mapping.destination)
        .map(([, mapping]) => mapping.destination);
      const folderParts = [selectedSchemas.postgres, ...destinationTables]
        .map((value) => String(value).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, ""))
        .filter(Boolean);
      const configurationName = folderParts.join("__").slice(0, 180);
      if (!configurationName) throw new Error("Select a PostgreSQL schema and destination table before saving.");
      const directory = await configurationRoot.getDirectoryHandle(configurationName, { create: true });
      const files = [
        ["project.json", JSON.stringify(currentProject(), null, 2)],
        ["mysql-to-postgres.load", pgloaderFiles.config],
        ["mysql-to-pgloader.sh", pgloaderFiles.exportScript],
        ["lookup-transform.py", pgloaderFiles.lookupHelper],
      ];
      for (const [name, contents] of files) {
        const fileHandle = await directory.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(contents);
        await writable.close();
      }
      await scanConfigurationFolder(configurationRoot);
      setSelectedSavedProject(configurationName);
      setCopyMessage(`Saved configuration: ${configurationName}`);
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message || "Unable to save configuration folder");
    } finally {
      setProjectSaving(false);
    }
  };

  const loadSelectedProject = async () => {
    if (!selectedSavedProject) return;
    try {
      setError("");
      const savedProject = savedProjects.find((project) => project.name === selectedSavedProject);
      if (!savedProject) throw new Error("Select the configuration folder again.");
      const fileHandle = await savedProject.handle.getFileHandle("project.json");
      const project = JSON.parse(await (await fileHandle.getFile()).text());
      applyProject(project);
      setCopyMessage(`Loaded saved configuration: ${selectedSavedProject}`);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Unable to load saved configuration");
    }
  };

  const executeDockerMigration = async () => {
    try {
      setDockerRunning(true);
      setDockerOutput("Starting Docker migration...\n");
      setDuplicatesLog("");
      const response = await runDockerMigration({
        pgloader_config: pgloaderFiles.dockerConfig,
        docker_script: pgloaderFiles.dockerScript,
        lookup_helper: pgloaderFiles.lookupHelper,
      });
      setDockerOutput(response.data.output || "The command produced no output.");
      if (response.data.duplicates) {
        setDuplicatesLog(response.data.duplicates);
      }
      if (!response.data.success) {
        setError(`Docker migration failed with exit code ${response.data.exit_code}.`);
      } else {
        setError("");
      }
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Unable to run the Docker migration";
      setDockerOutput(String(detail));
      setError("Unable to run the Docker migration.");
    } finally {
      setDockerRunning(false);
    }
  };

  const downloadDuplicatesLog = () => {
    const file = new Blob([duplicatesLog], { type: "text/plain" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lookup-duplicates.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  const loadProject = async (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;

    try {
      const project = JSON.parse(await file.text());
      applyProject(project);
      setCopyMessage("Project loaded. Click Map columns for any table you want to edit.");
    } catch (loadError) {
      setError(loadError.message || "Unable to load the project file.");
    }
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4 }}>

      <Typography variant="h3" gutterBottom>
        MySQL → PostgreSQL Migration Tool
      </Typography>

      <Typography
        variant="body1"
        sx={{ mb: 4 }}
      >
        Connect the databases and load the schema.
      </Typography>

      <Grid container spacing={3}>

        <Grid size={{ xs: 12, md: 6 }}>
          <DatabaseCard
            title="MySQL"
            connection={mysqlConnection}
            setConnection={setMysqlConnection}
            onTest={testMysql}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <DatabaseCard
            title="PostgreSQL"
            connection={postgresConnection}
            setConnection={setPostgresConnection}
            onTest={testPostgres}
          />
        </Grid>

      </Grid>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 4 }}>
        <Button
          variant="outlined"
          size="large"
          onClick={loadSchemas}
          disabled={schemaLoading}
        >
          {schemaLoading ? "Loading..." : "Load Databases"}
        </Button>
        <Button variant="outlined" size="large" onClick={saveProject}>
          Save project
        </Button>
        <Button variant="outlined" size="large" onClick={() => projectFileInput.current?.click()}>
          Load project
        </Button>
        <input
          ref={projectFileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={loadProject}
        />
      </Stack>

      <Grid container spacing={2} sx={{ mt: 2 }} alignItems="center">
        <Grid size={{ xs: 12, md: 2 }}>
          <Button
            variant="outlined"
            onClick={selectConfigurationRoot}
            fullWidth
          >
            Select folder
          </Button>
        </Grid>
        <Grid size={{ xs: 12, md: 2 }}>
          <Button
            variant="contained"
            onClick={saveToProjectFolder}
            disabled={projectSaving || !configurationRoot}
            fullWidth
          >
            {projectSaving ? "Saving..." : "Save"}
          </Button>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <FormControl fullWidth>
            <InputLabel id="saved-project-label">Saved configuration</InputLabel>
            <Select
              labelId="saved-project-label"
              label="Saved configuration"
              value={selectedSavedProject}
              onChange={(event) => setSelectedSavedProject(event.target.value)}
            >
              {savedProjects.map((project) => (
                <MenuItem key={project.name} value={project.name}>{project.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, md: 2 }}>
          <Button
            variant="outlined"
            onClick={loadSelectedProject}
            disabled={!selectedSavedProject}
            fullWidth
          >
            Load selected
          </Button>
        </Grid>
      </Grid>
      {configurationRoot && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Selected folder: {configurationRoot.name}
        </Typography>
      )}

      <Divider sx={{ my: 3 }} />

      <Tabs
        value={activeTab}
        onChange={(e, val) => setActiveTab(val)}
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label="1. Database Migration (MySQL → PostgreSQL)" sx={{ fontWeight: "bold", textTransform: "none", fontSize: "1.05rem" }} />
        <Tab label="2. PostgreSQL ID Remapping & Cascading" sx={{ fontWeight: "bold", textTransform: "none", fontSize: "1.05rem" }} />
      </Tabs>

      {activeTab === 1 && (
        <IdRemappingTool
          postgresConnection={postgresConnection}
          postgresTables={migration.postgresTables}
          selectedSchema={selectedSchemas.postgres}
        />
      )}

      {activeTab === 0 && (
        <>
          {schemas.mysql.length > 0 && postgresDatabaseOptions.length > 0 && (
        <Grid container spacing={3} sx={{ mt: 1 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <FormControl fullWidth>
              <InputLabel id="mysql-schema-label">MySQL schema</InputLabel>
              <Select
                labelId="mysql-schema-label"
                label="MySQL schema"
                value={selectedSchemas.mysql}
                onChange={(event) => setSelectedSchemas((previous) => ({ ...previous, mysql: event.target.value }))}
              >
                {schemas.mysql.map((schema) => (
                  <MenuItem key={schema.schema_name} value={schema.schema_name}>{schema.schema_name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <FormControl fullWidth>
              <InputLabel id="postgres-database-label">PostgreSQL database</InputLabel>
              <Select
                labelId="postgres-database-label"
                label="PostgreSQL database"
                value={postgresConnection.database}
                onChange={(event) => selectPostgresDatabase(event.target.value)}
              >
                {postgresDatabaseOptions.map((database) => (
                  <MenuItem key={database.database_name} value={database.database_name}>{database.database_name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          {schemas.postgres.length > 0 && (
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel id="postgres-schema-label">PostgreSQL schema</InputLabel>
                <Select
                  labelId="postgres-schema-label"
                  label="PostgreSQL schema"
                  value={selectedSchemas.postgres}
                  onChange={(event) => setSelectedSchemas((previous) => ({ ...previous, postgres: event.target.value }))}
                >
                  {schemas.postgres.map((schema) => (
                    <MenuItem key={schema.schema_name} value={schema.schema_name}>{schema.schema_name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}
        </Grid>
      )}

      <Button
        sx={{ mt: 3 }}
        variant="contained"
        size="large"
        onClick={loadTables}
        disabled={loading || !selectedSchemas.mysql || !selectedSchemas.postgres}
      >
        {loading ? "Loading..." : "Load Tables"}
      </Button>

      <Divider sx={{ mt: 4, mb: 4 }} />

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      {migration.mysqlTables.length > 0 && (

        <TableList
          mysqlTables={migration.mysqlTables}
          postgresTables={migration.postgresTables}
          mappings={tableMappings}
          setMappings={setTableMappings}
          selectedTable={selectedTable}
          onSelectTable={loadColumns}
        />

      )}

      {columnLoading && <Alert severity="info" sx={{ mt: 3 }}>Loading columns...</Alert>}

      {selectedTable && !columnLoading && (
        <ColumnMapping
          mysqlColumns={columns.mysql}
          postgresColumns={columns.postgres}
          mappings={columnMappings[selectedTable] || {}}
          setMappings={(updater) =>
            setColumnMappings((previous) => ({
              ...previous,
              [selectedTable]: typeof updater === "function"
                ? updater(previous[selectedTable] || {})
                : updater,
            }))
          }
          mysqlTables={migration.mysqlTables}
          postgresTables={migration.postgresTables}
          mysqlConnection={mysqlConnection}
          postgresConnection={postgresConnection}
          selectedSchemas={selectedSchemas}
          availableSchemas={schemas}
        />
      )}

      {Object.keys(tableMappings).length > 0 && (
        <>
          <Divider sx={{ mt: 4, mb: 2 }} />

          <Typography variant="h5" gutterBottom>
            Selected-column pgloader files
          </Typography>

          {pgloaderFiles.config ? (
            <Stack spacing={2}>
              <Alert severity="info">
                Download both files into the same folder, open a terminal there, and run
                <code>chmod +x mysql-to-pgloader.sh &amp;&amp; ./mysql-to-pgloader.sh</code>. The script exports
                only the selected fields and runs the native Linux pgloader command. Existing destination tables are
                preserved; pgloader inserts into the columns you mapped.
              </Alert>

              <TextField
                label="Generated .load file"
                value={pgloaderFiles.config}
                multiline
                minRows={14}
                fullWidth
                InputProps={{ readOnly: true }}
              />

              <Stack direction="row" spacing={2}>
                <Button variant="contained" onClick={downloadConfig}>Download .load file</Button>
                <Button variant="contained" onClick={downloadExportScript}>Download export script</Button>
                <Button variant="outlined" onClick={downloadLookupHelper}>Download lookup helper</Button>
                <Button variant="outlined" onClick={copyConfig}>Copy configuration</Button>
              </Stack>

              {copyMessage && <Alert severity="info">{copyMessage}</Alert>}
            </Stack>
          ) : (
            <Alert severity="info">{pgloaderFiles.error}</Alert>
          )}
        </>
      )}

      <Divider sx={{ mt: 4, mb: 2 }} />
      <Typography variant="h5" gutterBottom>Run migration with Docker Desktop</Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        Runs the selected MySQL export and pgloader migration locally from Windows using Docker containers. Docker Desktop must be installed and running.
      </Alert>
      <Stack direction="row" spacing={2} alignItems="center">
        <Button
          variant="contained"
          onClick={executeDockerMigration}
          disabled={dockerRunning || !pgloaderFiles.dockerConfig || !pgloaderFiles.dockerScript}
        >
          {dockerRunning ? "Running migration..." : "Run with Docker"}
        </Button>
        {duplicatesLog && (
          <Button variant="contained" color="warning" onClick={downloadDuplicatesLog}>
            Download Duplicates Log
          </Button>
        )}
      </Stack>
      <TextField
        sx={{ mt: 2 }}
        label="Docker migration output"
        value={dockerOutput}
        multiline
        minRows={12}
        fullWidth
        InputProps={{ readOnly: true }}
      />
        </>
      )}

    </Container>
  );
}
