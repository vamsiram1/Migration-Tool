import { generatePgloaderConfig } from "../frontend/src/services/pgloader.js";

const baseMysqlConn = {
  host: "127.0.0.1",
  port: 3306,
  database: "testdb",
  username: "root",
  password: "password",
};

const basePgConn = {
  host: "127.0.0.1",
  port: 5432,
  database: "targetdb",
  username: "postgres",
  password: "password",
};

const schemas = {
  mysql: "testdb",
  postgres: "public",
};

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
    passed++;
  }
}

// Test 1: Standard migration without date filter
{
  const tableMappings = {
    t_student: { selected: true, destination: "student" },
  };
  const columnMappings = {
    t_student: {
      student_id: { selected: true, destination: "id" },
      student_name: { selected: true, destination: "name" },
      admission_date: { selected: true, destination: "admission_date" },
    },
  };

  const result = generatePgloaderConfig({
    mysqlConnection: baseMysqlConn,
    postgresConnection: basePgConn,
    tableMappings,
    columnMappings,
    selectedSchemas: schemas,
  });

  assert(result.error === "", "Test 1: No error when date filter is omitted");
  assert(result.exportScript.includes("FROM `testdb`.`t_student`;"), "Test 1: Script has full dump without WHERE clause");
  assert(!result.exportScript.includes("WHERE `admission_date`"), "Test 1: Script has no date WHERE clause");
}

// Test 2: Migration WITH valid date filter (admission_date: 2025-01-01 to 2025-01-31)
{
  const tableMappings = {
    t_student: { selected: true, destination: "student" },
  };
  const columnMappings = {
    t_student: {
      student_id: { selected: true, destination: "id" },
      student_name: { selected: true, destination: "name" },
      admission_date: { selected: true, destination: "admission_date" },
      __dateFilter: {
        column: "admission_date",
        fromDate: "2025-01-01",
        toDate: "2025-01-31",
      },
    },
  };

  const result = generatePgloaderConfig({
    mysqlConnection: baseMysqlConn,
    postgresConnection: basePgConn,
    tableMappings,
    columnMappings,
    selectedSchemas: schemas,
  });

  assert(result.error === "", "Test 2: No error when valid date filter is provided");
  assert(result.exportScript.includes("WHERE `admission_date` >= '\\''2025-01-01 00:00:00'\\'' AND `admission_date` <= '\\''2025-01-31 23:59:59'\\''"), "Test 2: Bash export query has correctly formatted date filter including 23:59:59 end-of-day");
  assert(result.dockerScript.includes("WHERE `admission_date` >= ''2025-01-01 00:00:00'' AND `admission_date` <= ''2025-01-31 23:59:59''"), "Test 2: Docker PowerShell script has correctly formatted date filter");
}

// Test 3: Validation Case 1 - Date column selected but dates missing
{
  const tableMappings = {
    t_student: { selected: true, destination: "student" },
  };
  const columnMappings = {
    t_student: {
      student_id: { selected: true, destination: "id" },
      __dateFilter: {
        column: "admission_date",
        fromDate: "",
        toDate: "",
      },
    },
  };

  const result = generatePgloaderConfig({
    mysqlConnection: baseMysqlConn,
    postgresConnection: basePgConn,
    tableMappings,
    columnMappings,
    selectedSchemas: schemas,
  });

  assert(result.error.includes("Select From Date and To Date for date column 'admission_date'"), "Test 3: Properly rejects date column with missing dates");
}

// Test 4: Validation Case 2 - Only From Date selected
{
  const tableMappings = {
    t_student: { selected: true, destination: "student" },
  };
  const columnMappings = {
    t_student: {
      student_id: { selected: true, destination: "id" },
      __dateFilter: {
        column: "admission_date",
        fromDate: "2025-01-01",
        toDate: "",
      },
    },
  };

  const result = generatePgloaderConfig({
    mysqlConnection: baseMysqlConn,
    postgresConnection: basePgConn,
    tableMappings,
    columnMappings,
    selectedSchemas: schemas,
  });

  assert(result.error.includes("Select To Date for date column 'admission_date'"), "Test 4: Properly rejects missing To Date");
}

// Test 5: Validation Case 3 - Only To Date selected
{
  const tableMappings = {
    t_student: { selected: true, destination: "student" },
  };
  const columnMappings = {
    t_student: {
      student_id: { selected: true, destination: "id" },
      __dateFilter: {
        column: "admission_date",
        fromDate: "",
        toDate: "2025-01-31",
      },
    },
  };

  const result = generatePgloaderConfig({
    mysqlConnection: baseMysqlConn,
    postgresConnection: basePgConn,
    tableMappings,
    columnMappings,
    selectedSchemas: schemas,
  });

  assert(result.error.includes("Select From Date for date column 'admission_date'"), "Test 5: Properly rejects missing From Date");
}

// Test 6: Validation Case 4 - From Date > To Date
{
  const tableMappings = {
    t_student: { selected: true, destination: "student" },
  };
  const columnMappings = {
    t_student: {
      student_id: { selected: true, destination: "id" },
      __dateFilter: {
        column: "admission_date",
        fromDate: "2025-02-01",
        toDate: "2025-01-01",
      },
    },
  };

  const result = generatePgloaderConfig({
    mysqlConnection: baseMysqlConn,
    postgresConnection: basePgConn,
    tableMappings,
    columnMappings,
    selectedSchemas: schemas,
  });

  assert(result.error.includes("From Date (2025-02-01) cannot be greater than To Date (2025-01-01)"), "Test 6: Properly rejects From Date > To Date");
}

// Test 7: Multi-table migration where only one table has date filtering
{
  const tableMappings = {
    t_student: { selected: true, destination: "student" },
    t_courses: { selected: true, destination: "courses" },
  };
  const columnMappings = {
    t_student: {
      student_id: { selected: true, destination: "id" },
      __dateFilter: {
        column: "created_at",
        fromDate: "2024-01-01",
        toDate: "2024-12-31",
      },
    },
    t_courses: {
      course_id: { selected: true, destination: "id" },
    },
  };

  const result = generatePgloaderConfig({
    mysqlConnection: baseMysqlConn,
    postgresConnection: basePgConn,
    tableMappings,
    columnMappings,
    selectedSchemas: schemas,
  });

  assert(result.error === "", "Test 7: No error for mixed table migration");
  assert(result.exportScript.includes("WHERE `created_at` >= '\\''2024-01-01 00:00:00'\\'' AND `created_at` <= '\\''2024-12-31 23:59:59'\\''"), "Test 7: t_student has date filter");
  assert(result.exportScript.includes("FROM `testdb`.`t_courses`;"), "Test 7: t_courses has full dump without date filter");
}

console.log(`\nAll tests completed: ${passed}/${total} passed.`);
