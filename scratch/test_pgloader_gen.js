import { generatePgloaderConfig } from "../frontend/src/services/pgloader.js";

const mysqlConnection = {
  host: "192.168.20.9",
  port: 3306,
  database: "esaplive",
  username: "vamsi",
  password: "Vamsi@123",
};

const postgresConnection = {
  host: "192.168.20.220",
  port: 5432,
  database: "sce_prod",
  username: "postgres",
  password: "Welcome123",
};

const selectedSchemas = {
  mysql: "esaplive",
  postgres: "sce_student",
};

const tableMappings = {
  t_concession_processing: {
    selected: true,
    destination: "v_stud_conc_request",
  },
};

const columnMappings = {
  t_concession_processing: {
    ADM_NO: {
      selected: true,
      destination: "stud_adms_id",
      lookup: {
        mode: "crosswalk",
        mysqlSchema: "esaplive",
        mysqlTable: "t_student",
        mysqlIdColumn: "ADM_NO",
        mysqlMatchColumn: "ADM_NO",
        postgresSchema: "sce_student",
        postgresTable: "sce_stud_acdc_detl",
        postgresMatchColumn: "stud_adms_no",
        postgresResultColumn: "stud_adms_id",
      },
    },
    REQUEST_AMOUNT: {
      selected: true,
      destination: "requested_conc",
    },
  },
};

const resultLimited = generatePgloaderConfig({
  mysqlConnection,
  postgresConnection,
  tableMappings,
  columnMappings,
  selectedSchemas,
  limitRows: 1000,
});

console.log("=== LIMITED DOCKER SCRIPT ===");
console.log(resultLimited.dockerScript);

const resultUnlimited = generatePgloaderConfig({
  mysqlConnection,
  postgresConnection,
  tableMappings,
  columnMappings,
  selectedSchemas,
  limitRows: null,
});

console.log("=== UNLIMITED DOCKER SCRIPT ===");
console.log(resultUnlimited.dockerScript);
