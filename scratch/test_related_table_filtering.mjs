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

// Test 1: Standard migration without any filter
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
  };
  const columnMappings = {
    t_student: {
      adm_no: { selected: true, destination: "adm_no" },
      student_name: { selected: true, destination: "name" },
    },
  };

  const result = generatePgloaderConfig({
    mysqlConnection: baseMysqlConn,
    postgresConnection: basePgConn,
    tableMappings,
    columnMappings,
    selectedSchemas: schemas,
  });

  assert(result.error === "", "Test 1: No error when related table filter is omitted");
  assert(result.exportScript.includes("FROM `testdb`.`t_student`;"), "Test 1: Script has full dump without WHERE clause");
  assert(!result.exportScript.includes("EXISTS"), "Test 1: Script has no EXISTS clause");
}

// Test 2: Migration WITH related table filter (std_consolidate.overall_due > 0)
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
  };
  const columnMappings = {
    t_student: {
      adm_no: { selected: true, destination: "adm_no" },
      student_name: { selected: true, destination: "name" },
      __relatedTableFilter: {
        sourceJoinColumn: "adm_no",
        relatedTable: "std_consolidate",
        relatedJoinColumn: "adm_no",
        conditionColumn: "overall_due",
        operator: ">",
        conditionValue: "0",
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

  assert(result.error === "", "Test 2: No error when valid related table filter is provided");
  assert(
    result.exportScript.includes("WHERE EXISTS (SELECT 1 FROM `testdb`.`std_consolidate` AS `__rel_filter__` WHERE `__rel_filter__`.`adm_no` = `testdb`.`t_student`.`adm_no` AND `__rel_filter__`.`overall_due` > 0)"),
    "Test 2: Bash export query has correctly formatted EXISTS correlated subquery with numeric 0"
  );
  assert(
    result.dockerScript.includes("WHERE EXISTS (SELECT 1 FROM `testdb`.`std_consolidate` AS `__rel_filter__` WHERE `__rel_filter__`.`adm_no` = `testdb`.`t_student`.`adm_no` AND `__rel_filter__`.`overall_due` > 0)"),
    "Test 2: Docker PowerShell script has correctly formatted EXISTS subquery"
  );
}

// Test 3: Migration WITH BOTH Date Range Filter AND Related Table Filter
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
  };
  const columnMappings = {
    t_student: {
      adm_no: { selected: true, destination: "adm_no" },
      admission_date: { selected: true, destination: "admission_date" },
      __dateFilter: {
        column: "admission_date",
        fromDate: "2025-01-01",
        toDate: "2025-12-31",
      },
      __relatedTableFilter: {
        sourceJoinColumn: "adm_no",
        relatedTable: "std_consolidate",
        relatedJoinColumn: "adm_no",
        conditionColumn: "overall_due",
        operator: ">",
        conditionValue: "0",
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

  assert(result.error === "", "Test 3: No error when both Date Range Filter and Related Table Filter are active");
  assert(
    result.exportScript.includes("WHERE (`admission_date` >= '\\''2025-01-01 00:00:00'\\'' AND `admission_date` <= '\\''2025-12-31 23:59:59'\\'') OR (EXISTS (SELECT 1 FROM `testdb`.`std_consolidate` AS `__rel_filter__` WHERE `__rel_filter__`.`adm_no` = `testdb`.`t_student`.`adm_no` AND `__rel_filter__`.`overall_due` > 0))"),
    "Test 3: Query correctly combines Date Range Filter OR Related Table Filter with OR"
  );
}

// Test 4: Validation Case 1 - Missing sourceJoinColumn
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
  };
  const columnMappings = {
    t_student: {
      adm_no: { selected: true, destination: "adm_no" },
      __relatedTableFilter: {
        sourceJoinColumn: "",
        relatedTable: "std_consolidate",
        relatedJoinColumn: "adm_no",
        conditionColumn: "overall_due",
        operator: ">",
        conditionValue: "0",
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

  assert(result.error.includes("Select Main Table Join Column for related table filter on 'std_consolidate'"), "Test 4: Properly rejects missing sourceJoinColumn");
}

// Test 5: Validation Case 2 - Missing relatedJoinColumn
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
  };
  const columnMappings = {
    t_student: {
      adm_no: { selected: true, destination: "adm_no" },
      __relatedTableFilter: {
        sourceJoinColumn: "adm_no",
        relatedTable: "std_consolidate",
        relatedJoinColumn: "",
        conditionColumn: "overall_due",
        operator: ">",
        conditionValue: "0",
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

  assert(result.error.includes("Select Related Table Join Column for related table filter on 'std_consolidate'"), "Test 5: Properly rejects missing relatedJoinColumn");
}

// Test 6: Validation Case 3 - Missing conditionColumn
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
  };
  const columnMappings = {
    t_student: {
      adm_no: { selected: true, destination: "adm_no" },
      __relatedTableFilter: {
        sourceJoinColumn: "adm_no",
        relatedTable: "std_consolidate",
        relatedJoinColumn: "adm_no",
        conditionColumn: "",
        operator: ">",
        conditionValue: "0",
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

  assert(result.error.includes("Select Condition Column for related table filter on 'std_consolidate'"), "Test 6: Properly rejects missing conditionColumn");
}

// Test 7: Validation Case 4 - Missing conditionValue when operator is binary
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
  };
  const columnMappings = {
    t_student: {
      adm_no: { selected: true, destination: "adm_no" },
      __relatedTableFilter: {
        sourceJoinColumn: "adm_no",
        relatedTable: "std_consolidate",
        relatedJoinColumn: "adm_no",
        conditionColumn: "overall_due",
        operator: ">",
        conditionValue: "",
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

  assert(result.error.includes("Enter Condition Value for related table filter on 'std_consolidate'"), "Test 7: Properly rejects missing conditionValue for operator '>'");
}

// Test 8: Unary Operator - IS NOT NULL without conditionValue
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
  };
  const columnMappings = {
    t_student: {
      adm_no: { selected: true, destination: "adm_no" },
      __relatedTableFilter: {
        sourceJoinColumn: "adm_no",
        relatedTable: "std_consolidate",
        relatedJoinColumn: "adm_no",
        conditionColumn: "overall_due",
        operator: "IS NOT NULL",
        conditionValue: "",
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

  assert(result.error === "", "Test 8: No error for IS NOT NULL operator without conditionValue");
  assert(
    result.exportScript.includes("`__rel_filter__`.`overall_due` IS NOT NULL"),
    "Test 8: Properly formats IS NOT NULL operator in subquery"
  );
}

// Test 9: String condition value (e.g. status = 'ACTIVE')
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
  };
  const columnMappings = {
    t_student: {
      adm_no: { selected: true, destination: "adm_no" },
      __relatedTableFilter: {
        sourceJoinColumn: "adm_no",
        relatedTable: "std_consolidate",
        relatedJoinColumn: "adm_no",
        conditionColumn: "status",
        operator: "=",
        conditionValue: "ACTIVE",
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

  assert(result.error === "", "Test 9: No error for string condition value");
  assert(
    result.exportScript.includes("`__rel_filter__`.`status` = '\\''ACTIVE'\\''"),
    "Test 9: Properly quotes string condition value 'ACTIVE'"
  );
}

// Test 10: Multi-table migration with mixed filtering
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
    t_courses: { selected: true, destination: "courses" },
  };
  const columnMappings = {
    t_student: {
      adm_no: { selected: true, destination: "adm_no" },
      __relatedTableFilter: {
        sourceJoinColumn: "adm_no",
        relatedTable: "std_consolidate",
        relatedJoinColumn: "adm_no",
        conditionColumn: "overall_due",
        operator: ">",
        conditionValue: "0",
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

  assert(result.error === "", "Test 10: Mixed multi-table migration produces no error");
  assert(result.exportScript.includes("WHERE EXISTS (SELECT 1 FROM `testdb`.`std_consolidate`"), "Test 10: t_student has related table filter");
  assert(result.exportScript.includes("FROM `testdb`.`t_courses`;"), "Test 10: t_courses has full dump without filter");
}

// Test 11: Row Duplication WITH Related Table Filter
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
  };
  const columnMappings = {
    t_student: {
      student_name: { selected: true, destination: "name" },
      phone: { selected: true, destination: "contact_number", isSplit: true },
      type: { selected: true, destination: "record_type" },
      __rowDuplication: {
        active: true,
        primarySource: "phone_primary",
        secondarySource: "phone_secondary",
        typeColumn: "record_type",
        primaryValue: "PRIMARY",
        secondaryValue: "SECONDARY",
      },
      __relatedTableFilter: {
        sourceJoinColumn: "adm_no",
        relatedTable: "std_consolidate",
        relatedJoinColumn: "adm_no",
        conditionColumn: "overall_due",
        operator: ">",
        conditionValue: "0",
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

  assert(result.error === "", "Test 11: No error for row duplication with related table filter");
  assert(
    result.exportScript.includes("WHERE EXISTS (SELECT 1 FROM `testdb`.`std_consolidate` AS `__rel_filter__` WHERE `__rel_filter__`.`adm_no` = `testdb`.`t_student`.`adm_no` AND `__rel_filter__`.`overall_due` > 0)")
    && result.exportScript.includes("UNION ALL"),
    "Test 11: Both primary and secondary branches have EXISTS related table filter"
  );
}

// Test 12: Relation Rows WITH Related Table Filter and Date Range Filter
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
  };
  const columnMappings = {
    t_student: {
      student_name: { selected: true, destination: "name", isRelationName: true },
      relation_type: { selected: true, destination: "rel_type", isRelationId: true },
      __relationRows: {
        active: true,
        skipEmpty: true,
        branches: [
          { sourceColumn: "father_name", relationName: "Father" },
          { sourceColumn: "mother_name", relationName: "Mother" },
        ],
      },
      __dateFilter: {
        column: "admission_date",
        fromDate: "2025-01-01",
        toDate: "2025-12-31",
      },
      __relatedTableFilter: {
        sourceJoinColumn: "adm_no",
        relatedTable: "std_consolidate",
        relatedJoinColumn: "adm_no",
        conditionColumn: "overall_due",
        operator: ">",
        conditionValue: "0",
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

  assert(result.error === "", "Test 12: No error for relation rows with both date and related table filters");
  assert(
    result.exportScript.includes("(`admission_date` >= '\\''2025-01-01 00:00:00'\\'' AND `admission_date` <= '\\''2025-12-31 23:59:59'\\'') OR (EXISTS (SELECT 1 FROM `testdb`.`std_consolidate` AS `__rel_filter__` WHERE `__rel_filter__`.`adm_no` = `testdb`.`t_student`.`adm_no` AND `__rel_filter__`.`overall_due` > 0))"),
    "Test 12: Relation rows statement includes both date filter and related table filter combined with OR"
  );
}

// Test 13: Migration WITH BOTH Date Range Filter AND Related Table Filter with limitEnabled: true
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
  };
  const columnMappings = {
    t_student: {
      adm_no: { selected: true, destination: "adm_no" },
      admission_date: { selected: true, destination: "admission_date" },
      __dateFilter: {
        column: "admission_date",
        fromDate: "2025-01-01",
        toDate: "2025-12-31",
      },
      __relatedTableFilter: {
        sourceJoinColumn: "adm_no",
        relatedTable: "std_consolidate",
        relatedJoinColumn: "adm_no",
        conditionColumn: "overall_due",
        operator: ">",
        conditionValue: "0",
        limitEnabled: true,
        limitRows: 2000,
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

  assert(result.error === "", "Test 13: No error when both Date Range Filter and Related Table Filter with limit are active");
  assert(
    result.exportScript.includes("UNION") &&
    result.exportScript.includes("LIMIT 2000"),
    "Test 13: Query combines date filter and related table filter via UNION with LIMIT 2000 for related filter"
  );
  assert(
    result.dockerScript.includes("UNION") &&
    result.dockerScript.includes("LIMIT 2000"),
    "Test 13: Docker script also correctly combines via UNION with LIMIT 2000"
  );
}

// Test 14: Migration WITH ONLY Related Table Filter and limitEnabled: true
{
  const tableMappings = {
    t_student: { selected: true, destination: "stud_acdc_detl" },
  };
  const columnMappings = {
    t_student: {
      adm_no: { selected: true, destination: "adm_no" },
      __relatedTableFilter: {
        sourceJoinColumn: "adm_no",
        relatedTable: "std_consolidate",
        relatedJoinColumn: "adm_no",
        conditionColumn: "overall_due",
        operator: ">",
        conditionValue: "0",
        limitEnabled: true,
        limitRows: 500,
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

  assert(result.error === "", "Test 14: No error for single related table filter with limit");
  assert(
    result.exportScript.includes("LIMIT 500"),
    "Test 14: Query includes LIMIT 500 when limitEnabled is true"
  );
}

console.log(`\nAll related-table filtering tests completed: ${passed}/${total} passed.`);

