const escapeUriPart = (value) => String(value ?? "")
  .replaceAll(":", "::")
  .replaceAll("@", "@@");

const postgresUri = (connection) => {
  const credentials = `${escapeUriPart(connection.username)}:${escapeUriPart(connection.password)}@`;
  return `postgresql://${credentials}${connection.host}:${connection.port}/${connection.database}`;
};

const quoteSqlIdentifier = (value) => `\`${String(value).replaceAll("`", "``")}\``;
const quoteSqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
const quotePowerShell = (value) => `'${String(value).replaceAll("'", "''")}'`;
const quoteBash = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;
const quoteLoadString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const quotePgIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const quotePgTable = (schema, table) => `${quotePgIdentifier(schema)}.${quotePgIdentifier(table)}`;
const quoteMysqlTable = (schema, table) => `${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(table)}`;
const synchronizeTableSequences = (schema, table) => [
  "$$ DO $synchronize_sequences$",
  "DECLARE",
  "  sequence_record record;",
  "  maximum_value bigint;",
  "BEGIN",
  "  FOR sequence_record IN",
  "    SELECT sequence_namespace.nspname AS sequence_schema,",
  "           sequence_class.relname AS sequence_name,",
  "           table_attribute.attname AS column_name",
  "    FROM pg_class AS table_class",
  "    JOIN pg_namespace AS table_namespace ON table_namespace.oid = table_class.relnamespace",
  "    JOIN pg_depend AS dependency ON dependency.refobjid = table_class.oid",
  "      AND dependency.refobjsubid > 0 AND dependency.deptype IN ('a', 'i')",
  "    JOIN pg_attribute AS table_attribute ON table_attribute.attrelid = table_class.oid",
  "      AND table_attribute.attnum = dependency.refobjsubid",
  "    JOIN pg_class AS sequence_class ON sequence_class.oid = dependency.objid AND sequence_class.relkind = 'S'",
  "    JOIN pg_namespace AS sequence_namespace ON sequence_namespace.oid = sequence_class.relnamespace",
  `    WHERE table_namespace.nspname = ${quoteSqlLiteral(schema)} AND table_class.relname = ${quoteSqlLiteral(table)}`,
  "  LOOP",
  `    EXECUTE format('SELECT max(%I) FROM %I.%I', sequence_record.column_name, ${quoteSqlLiteral(schema)}, ${quoteSqlLiteral(table)}) INTO maximum_value;`,
  "    IF maximum_value IS NULL THEN",
  "      PERFORM setval(format('%I.%I', sequence_record.sequence_schema, sequence_record.sequence_name)::regclass, 1, false);",
  "    ELSE",
  "      PERFORM setval(format('%I.%I', sequence_record.sequence_schema, sequence_record.sequence_name)::regclass, maximum_value, true);",
  "    END IF;",
  "  END LOOP;",
  "END",
  "$synchronize_sequences$; $$",
].join("\n");
const LOOKUP_HELPER = `#!/usr/bin/env python3
import sys
from pathlib import Path

data_path, *arguments = sys.argv[1:]
if not arguments or len(arguments) % 6:
    raise SystemExit("Expected one or more lookup groups of 6 arguments")

def log_duplicate(message):
    with open("lookup-duplicates.txt", "a", encoding="utf-8") as stream:
        stream.write(message + "\\n")

def rows(path):
    with open(path, encoding="utf-8-sig") as stream:
        for line in stream:
            yield line.rstrip("\\r\\n").split("\\t")

jobs = []
for offset in range(0, len(arguments), 6):
    column_text, old_path, new_path, match_count_text, source_indexes_text, insensitive_text = arguments[offset:offset + 6]
    column = int(column_text)
    match_count = int(match_count_text)
    source_indexes = [] if source_indexes_text == "-" else [int(value) for value in source_indexes_text.split(",") if value]
    insensitive = insensitive_text == "1"

    def normalized(value, insensitive=insensitive):
        value = value.strip()
        return value.casefold() if insensitive else value

    backfill = old_path == "-"
    value_map = old_path == "="

    new_ids = {}
    for row in rows(new_path):
        if len(row) < match_count + 1:
            continue
        match = tuple(normalized(value) for value in row[:match_count])
        result_id = row[match_count]
        if match in new_ids:
            if new_ids[match] != result_id:
                log_duplicate(
                    f"[PostgreSQL Lookup Duplicate]\\n"
                    f"Match Columns: {match!r}\\n"
                    f"Assigned ID (Kept): {new_ids[match]}\\n"
                    f"Duplicate ID (Skipped): {result_id}\\n"
                    f"----------------------------------------"
                )
            continue
        new_ids[match] = result_id

    if value_map:
        jobs.append((column, source_indexes, normalized, None, new_ids, "value_map"))
        continue

    if backfill:
        jobs.append((column, source_indexes, normalized, None, new_ids, "backfill"))
        continue

    crosswalk = {}
    for row in rows(old_path):
        if len(row) < match_count + 1:
            continue
        match = tuple(normalized(value) for value in row[1:match_count + 1])
        if match not in new_ids:
            log_duplicate(
                f"[Missing PostgreSQL Lookup Match]\\n"
                f"MySQL ID: {row[0]}\\n"
                f"Match Columns: {match!r}\\n"
                f"Status: Skipped substitution (value kept as original)\\n"
                f"----------------------------------------"
            )
            continue
        result_id = new_ids[match]
        source_values = row[match_count - len(source_indexes) + 1:match_count + 1]
        crosswalk_key = (row[0], *(normalized(value) for value in source_values))
        if crosswalk_key in crosswalk:
            if crosswalk[crosswalk_key] != result_id:
                log_duplicate(
                    f"[MySQL Lookup Key Resolves to Multiple PostgreSQL IDs]\\n"
                    f"MySQL ID: {row[0]}\\n"
                    f"Match Columns: {match!r}\\n"
                    f"Assigned PG ID (Kept): {crosswalk[crosswalk_key]}\\n"
                    f"Duplicate PG ID (Skipped): {result_id}\\n"
                    f"----------------------------------------"
                )
            continue
        crosswalk[crosswalk_key] = result_id
    jobs.append((column, source_indexes, normalized, crosswalk, None, "crosswalk"))

source = Path(data_path)
temporary = source.with_suffix(source.suffix + ".lookup")
with source.open(encoding="utf-8-sig") as input_stream, temporary.open("w", encoding="utf-8", newline="") as output_stream:
    for line_number, line in enumerate(input_stream):
        row = line.rstrip("\\r\\n").split("\\t")
        if line_number > 0:
            for column, source_indexes, normalized, crosswalk, new_ids, mode in jobs:
                if column >= len(row):
                    continue
                cell_is_empty = row[column].strip() in ("", "\\\\N", "\\\\\\\\N", "NULL", "null", "None") or row[column].strip().replace("\\\\\\\\", "") in ("", "N", "null", "NULL")
                if mode == "backfill":
                    if not cell_is_empty:
                        continue
                    backfill_key = tuple(normalized(row[index]) for index in source_indexes)
                    if backfill_key not in new_ids:
                        log_duplicate(
                            f"[Missing Null Backfill Match for Data Row]\\n"
                            f"Target Table: {source.name}\\n"
                            f"Line Number: {line_number + 1}\\n"
                            f"Input Match Key: {backfill_key!r}\\n"
                            f"Status: Value kept as NULL\\n"
                            f"----------------------------------------"
                        )
                        continue
                    row[column] = new_ids[backfill_key]
                    continue
                if mode == "value_map":
                    if cell_is_empty:
                        continue
                    relation_key = (normalized(row[column]),)
                    if relation_key not in new_ids:
                        log_duplicate(
                            f"[Missing Relation Lookup for Data Row]\\n"
                            f"Target Table: {source.name}\\n"
                            f"Line Number: {line_number + 1}\\n"
                            f"Relation Name: {row[column]!r}\\n"
                            f"Status: Value kept as original '{row[column]}'\\n"
                            f"----------------------------------------"
                        )
                        continue
                    row[column] = new_ids[relation_key]
                    continue
                if cell_is_empty:
                    continue
                crosswalk_key = (row[column], *(normalized(row[index]) for index in source_indexes))
                if crosswalk_key not in crosswalk:
                    log_duplicate(
                        f"[Missing Lookup Mapping for Data Row]\\n"
                        f"Target Table: {source.name}\\n"
                        f"Line Number: {line_number + 1}\\n"
                        f"Input Lookup Key: {crosswalk_key!r}\\n"
                        f"Status: Value kept as original '{row[column]}'\\n"
                        f"----------------------------------------"
                    )
                    continue
                row[column] = crosswalk[crosswalk_key]
        output_stream.write("\\t".join(row) + "\\n")
temporary.replace(source)
`;
const sqlDefaultExpression = (value) => {
  const normalized = String(value).trim().toUpperCase();
  if (normalized === "CURRENT_DATE") return "CURRENT_DATE";
  if (normalized === "CURRENT_TIMESTAMP") return "CURRENT_TIMESTAMP";
  if (normalized === "NULL") return "NULL";
  return quoteSqlLiteral(value);
};
const lookupMatchPairs = (lookup) => (
  lookup.mode === "backfill_null"
    ? []
    : [{ mysqlColumn: lookup.mysqlMatchColumn, postgresColumn: lookup.postgresMatchColumn }]
);
const lookupSourceMatchPairs = (lookup) => lookup.sourceMatchColumns || [];

const cleanSource = (src) => src && src.includes("__dup__") ? src.split("__dup__")[0] : src;

const selectedColumnsForTable = (columnMappings, sourceTable) => {
  const mappings = columnMappings[sourceTable] || {};
  const selectedColumns = Object.entries(mappings)
    .filter(([source]) => !source.startsWith("__"))
    .filter(([, mapping]) => mapping.selected && mapping.destination)
    .map(([source, mapping]) => ({ source, ...mapping }));
  const mappedDestinations = new Set(selectedColumns.map(({ destination }) => destination));

  const splitColumns = [];
  const dup = mappings.__rowDuplication;
  if (dup && dup.active) {
    if (dup.parts) {
      dup.parts.forEach((part) => {
        if (part.destination && !mappedDestinations.has(part.destination)) {
          splitColumns.push({
            source: dup.primarySource, // temporary source, replaced per branch
            destination: part.destination,
            isSplit: true,
            delimiter: dup.delimiter,
            matchType: part.matchType || "index",
            pattern: part.pattern || "",
            partIndex: part.index || 0,
          });
          mappedDestinations.add(part.destination);
        }
      });
    }
    if (dup.typeColumn && !mappedDestinations.has(dup.typeColumn)) {
      splitColumns.push({
        destination: dup.typeColumn,
        constantValue: dup.primaryValue,
      });
      mappedDestinations.add(dup.typeColumn);
    }
  } else if (mappings.__splits) {
    mappings.__splits.forEach((split) => {
      if (split.source && split.delimiter && split.parts) {
        split.parts.forEach((part) => {
          if (part.destination && !mappedDestinations.has(part.destination)) {
            splitColumns.push({
              source: split.source,
              destination: part.destination,
              isSplit: true,
              delimiter: split.delimiter,
              matchType: part.matchType || "index",
              pattern: part.pattern || "",
              partIndex: part.index || 0,
            });
            mappedDestinations.add(part.destination);
          }
        });
      }
    });
  }

  const defaultColumns = (mappings.__postgresDefaults || [])
    .filter(({ destination, value }) => destination && value !== "" && !mappedDestinations.has(destination))
    .map(({ destination, value }) => ({ destination, constantValue: value }));

  const relationColumns = [];
  const relationRows = mappings.__relationRows;
  const hasRelationBranches = relationRows
    && relationRows.active
    && (relationRows.branches || []).some((branch) => branch.sourceColumn && branch.relationName);
  if (hasRelationBranches) {
    if (relationRows.nameColumn && !mappedDestinations.has(relationRows.nameColumn)) {
      relationColumns.push({ destination: relationRows.nameColumn, isRelationName: true });
      mappedDestinations.add(relationRows.nameColumn);
    }
    if (relationRows.relationIdColumn && !mappedDestinations.has(relationRows.relationIdColumn)) {
      const relationConfig = relationRows.relation || {};
      relationColumns.push({
        destination: relationRows.relationIdColumn,
        isRelationId: true,
        lookup: {
          mode: "value_map",
          postgresSchema: relationConfig.postgresSchema || "",
          postgresTable: relationConfig.postgresTable || "",
          postgresMatchColumn: relationConfig.postgresMatchColumn || "",
          postgresResultColumn: relationConfig.postgresResultColumn || "",
          sourceMatchColumns: [],
          caseInsensitive: Boolean(relationConfig.caseInsensitive),
        },
      });
      mappedDestinations.add(relationRows.relationIdColumn);
    }
  }

  return [...selectedColumns, ...splitColumns, ...defaultColumns, ...relationColumns];
};

const selectExpression = ({
  source,
  destination,
  replacements = [],
  defaultValue = "",
  constantValue,
  lookup,
  nullWhenEmpty = true,
  isSplit,
  delimiter,
  matchType,
  pattern,
  partIndex,
}) => {
  if (source === undefined) {
    return `${sqlDefaultExpression(constantValue)} AS ${quoteSqlIdentifier(destination)}`;
  }
  const realSource = cleanSource(source);
  if (isSplit) {
    const rawSourceColumn = quoteSqlIdentifier(realSource);
    const sourceColumn = `REPLACE(REPLACE(${rawSourceColumn}, '\\r', ''), '\\n', ' ')`;
    const escapedDelimiter = quoteSqlLiteral(delimiter);
    const delims = `(CHAR_LENGTH(${sourceColumn}) - CHAR_LENGTH(REPLACE(${sourceColumn}, ${escapedDelimiter}, '')))`;
    const isPinCodeCol = ["pin_code", "pincode", "zip_code", "zipcode", "postal_code"].includes(destination.toLowerCase());
    const getPartExpr = (idx) => {
      const sqlPartIndex = idx + 1;
      const expr = `TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(${sourceColumn}, ${escapedDelimiter}, ${sqlPartIndex}), ${escapedDelimiter}, -1))`;
      return isPinCodeCol
        ? expr
        : `CASE WHEN TRIM(${expr}) REGEXP '^[0-9]{5,6}$' THEN ${quoteSqlLiteral("\\\\N")} ELSE ${expr} END`;
    };

    const isIntCol = ["id", "pin_code", "pincode", "zip_code", "zipcode", "postal_code"].includes(destination.toLowerCase()) || destination.toLowerCase().endsWith("_id");
    const wrapInt = (expr) => isIntCol
      ? `CASE WHEN TRIM(${expr}) REGEXP '^[0-9]+$' THEN TRIM(${expr}) WHEN TRIM(REPLACE(${expr}, '.', '')) REGEXP '^[0-9]+$' THEN TRIM(REPLACE(${expr}, '.', '')) ELSE ${quoteSqlLiteral("\\\\N")} END`
      : expr;

    if (matchType === "regex" && pattern) {
      const escapedPattern = quoteSqlLiteral(pattern);
      const cases = [];
      for (let i = 0; i < 8; i++) {
        if (i === 0) {
          cases.push(`WHEN ${getPartExpr(0)} REGEXP ${escapedPattern} THEN ${wrapInt(getPartExpr(0))}`);
        } else {
          cases.push(`WHEN ${delims} >= ${i} AND ${getPartExpr(i)} REGEXP ${escapedPattern} THEN ${wrapInt(getPartExpr(i))}`);
        }
      }
      const regexExpression = `CASE WHEN ${sourceColumn} IS NULL OR ${sourceColumn} = '' THEN ${quoteSqlLiteral("\\\\N")} ${cases.join(" ")} ELSE ${quoteSqlLiteral("\\\\N")} END`;
      return `${regexExpression} AS ${quoteSqlIdentifier(destination)}`;
    } else {
      if (isPinCodeCol) {
        const sqlPartIndex = (partIndex !== undefined ? partIndex : 0) + 1;
        const configuredExpr = getPartExpr(sqlPartIndex - 1);

        const getSpaceWordExpr = (str, idx) => `TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(${str}, ' ', ${idx + 1}), ' ', -1))`;
        const cleanWord = (word) => `REPLACE(REPLACE(REPLACE(${word}, '.', ''), ',', ''), ';', '')`;

        const whenClauses = [];
        // 1. Scan space-separated words of the user-configured part first (words 0 to 4)
        for (let w = 0; w < 5; w++) {
          const word = getSpaceWordExpr(configuredExpr, w);
          const cleaned = cleanWord(word);
          whenClauses.push(`WHEN ${cleaned} REGEXP '^[0-9]{5,6}$' THEN ${cleaned}`);
        }

        // 2. Scan space-separated words of the entire address string as a fallback (words 0 to 14)
        for (let w = 0; w < 15; w++) {
          const word = getSpaceWordExpr(sourceColumn, w);
          const cleaned = cleanWord(word);
          whenClauses.push(`WHEN ${cleaned} REGEXP '^[0-9]{5,6}$' THEN ${cleaned}`);
        }

        const pinExpression = `CASE WHEN ${sourceColumn} IS NULL OR ${sourceColumn} = '' THEN ${quoteSqlLiteral("\\\\N")} ${whenClauses.join(" ")} ELSE ${quoteSqlLiteral("\\\\N")} END`;
        return `${pinExpression} AS ${quoteSqlIdentifier(destination)}`;
      }

      const sqlPartIndex = (partIndex !== undefined ? partIndex : 0) + 1;
      const partExpr = getPartExpr(sqlPartIndex - 1);
      const indexExpression = `CASE WHEN ${sourceColumn} IS NULL OR ${sourceColumn} = '' THEN ${quoteSqlLiteral("\\\\N")} WHEN ${delims} >= (${sqlPartIndex} - 1) THEN ${wrapInt(partExpr)} ELSE ${quoteSqlLiteral("\\\\N")} END`;
      return `${indexExpression} AS ${quoteSqlIdentifier(destination)}`;
    }
  }
  const sourceColumn = quoteSqlIdentifier(realSource);
  const validReplacements = replacements.filter(({ from, to }) => from !== "" && to !== "");
  const valueExpression = lookup || validReplacements.length === 0
    ? sourceColumn
    : `CASE ${sourceColumn} ${validReplacements
      .map(({ from, to }) => `WHEN ${quoteSqlLiteral(from)} THEN ${quoteSqlLiteral(to)}`)
      .join(" ")} ELSE ${sourceColumn} END`;
  const expressionWithDefault = defaultValue === ""
    ? (nullWhenEmpty
      ? `CASE WHEN ${sourceColumn} IS NULL OR CAST(${sourceColumn} AS CHAR) = '' THEN ${quoteSqlLiteral("\\\\N")} ELSE ${valueExpression} END`
      : valueExpression)
    : `COALESCE(NULLIF(${valueExpression}, ''), ${sqlDefaultExpression(defaultValue)})`;

  return `${expressionWithDefault} AS ${quoteSqlIdentifier(destination)}`;
};

const buildQuery = (source, columns, mysqlSchema, rowDuplication, relationRows, limitRows = null) => {
  const limitClause = (limitRows && Number(limitRows) > 0) ? ` LIMIT ${Number(limitRows)}` : "";
  if (source.startsWith("no table")) {
    const maxRows = Math.max(...columns.map(col => {
      const val = col.constantValue !== undefined ? col.constantValue : col.defaultValue;
      return String(val || "").split(",").map(s => s.trim()).length;
    }), 1);
    const effectiveMaxRows = (limitRows && Number(limitRows) > 0) ? Math.min(maxRows, Number(limitRows)) : maxRows;

    const selectStatements = [];
    for (let i = 0; i < effectiveMaxRows; i++) {
      const rowExpressions = columns.map(col => {
        const val = col.constantValue !== undefined ? col.constantValue : col.defaultValue;
        const valList = String(val || "").split(",").map(s => s.trim());
        const value = valList[i] !== undefined ? valList[i] : (valList[valList.length - 1] || "");
        return `${sqlDefaultExpression(value)} AS ${quoteSqlIdentifier(col.destination)}`;
      });
      selectStatements.push(`SELECT ${rowExpressions.join(", ")}`);
    }
    return selectStatements.join(" UNION ALL ") + ";";
  }

  if (relationRows && relationRows.active) {
    const branches = (relationRows.branches || []).filter(
      (branch) => branch.sourceColumn && branch.relationName
    );
    const hasRelationTargets = columns.some((col) => col.isRelationName)
      && columns.some((col) => col.isRelationId);
    if (branches.length > 0 && hasRelationTargets) {
      // Emit one target row per relationship branch while scanning the source
      // table only once: cross join it to a tiny per-branch numbers table and
      // select the branch's name expression / relationship label with CASE. The
      // set of rows produced and every column expression are identical to a
      // per-branch UNION ALL; only the row order in the exported .tsv differs
      // (grouped per source row instead of per branch).
      const branchTableAlias = quoteSqlIdentifier("__relation_branch__");
      const branchNumberColumn = quoteSqlIdentifier("__branch_no__");
      const branchRef = `${branchTableAlias}.${branchNumberColumn}`;

      const stripAlias = (expression, destination) => {
        const suffix = ` AS ${quoteSqlIdentifier(destination)}`;
        return expression.endsWith(suffix) ? expression.slice(0, -suffix.length) : expression;
      };

      const selectList = columns
        .map((col) => {
          if (col.isRelationName) {
            const cases = branches
              .map((branch, index) => {
                const inner = stripAlias(
                  selectExpression({
                    source: branch.sourceColumn,
                    destination: col.destination,
                    nullWhenEmpty: true,
                  }),
                  col.destination,
                );
                return `WHEN ${index + 1} THEN ${inner}`;
              })
              .join(" ");
            return `CASE ${branchRef} ${cases} END AS ${quoteSqlIdentifier(col.destination)}`;
          }
          if (col.isRelationId) {
            const cases = branches
              .map((branch, index) => `WHEN ${index + 1} THEN ${sqlDefaultExpression(branch.relationName)}`)
              .join(" ");
            return `CASE ${branchRef} ${cases} END AS ${quoteSqlIdentifier(col.destination)}`;
          }
          return selectExpression(col);
        })
        .join(", ");

      const branchNumbersTable = branches
        .map((branch, index) => `SELECT ${index + 1} AS ${branchNumberColumn}`)
        .join(" UNION ALL ");

      let statement = `SELECT ${selectList} FROM ${quoteMysqlTable(mysqlSchema, source)} CROSS JOIN (${branchNumbersTable}) AS ${branchTableAlias}`;

      if (relationRows.skipEmpty !== false) {
        const conditions = branches.map((branch, index) => {
          const sourceColumn = quoteSqlIdentifier(branch.sourceColumn);
          return `(${branchRef} = ${index + 1} AND ${sourceColumn} IS NOT NULL AND TRIM(${sourceColumn}) <> '')`;
        });
        statement += ` WHERE ${conditions.join(" OR ")}`;
      }

      return `${statement}${limitClause};`;
    }
  }

  if (rowDuplication && rowDuplication.active) {
    const getColumnsForBranch = (branch) => {
      return columns.map((col) => {
        if (col.isSplit) {
          return {
            ...col,
            source: branch === "primary" ? rowDuplication.primarySource : rowDuplication.secondarySource,
          };
        }
        if (col.destination === rowDuplication.typeColumn) {
          return {
            destination: col.destination,
            constantValue: branch === "primary" ? rowDuplication.primaryValue : rowDuplication.secondaryValue,
          };
        }
        return col;
      });
    };

    const primaryColumns = getColumnsForBranch("primary");
    const secondaryColumns = getColumnsForBranch("secondary");

    const queryPrimary = `SELECT ${primaryColumns.map(selectExpression).join(", ")} FROM ${quoteMysqlTable(mysqlSchema, source)}`;
    const querySecondary = `SELECT ${secondaryColumns.map(selectExpression).join(", ")} FROM ${quoteMysqlTable(mysqlSchema, source)}`;

    return `(${queryPrimary}) UNION ALL (${querySecondary})${limitClause};`;
  }

  return `SELECT ${columns.map(selectExpression).join(", ")} FROM ${quoteMysqlTable(mysqlSchema, source)}${limitClause};`;
};

export function generatePgloaderConfig({
  mysqlConnection,
  postgresConnection,
  tableMappings,
  columnMappings,
  selectedSchemas,
  limitRows = null,
}) {
  const selectedTables = Object.entries(tableMappings)
    .filter(([, mapping]) => mapping.selected && mapping.destination)
    .map(([source, mapping]) => ({
      source,
      destination: mapping.destination,
      columns: selectedColumnsForTable(columnMappings, source),
      rowDuplication: columnMappings[source]?.__rowDuplication,
      relationRows: columnMappings[source]?.__relationRows,
    }));

  if (selectedTables.length === 0) {
    return { config: "", exportScript: "", error: "Select at least one source table and destination table." };
  }

  const missingColumnMappings = selectedTables.filter(({ columns }) => columns.length === 0);
  if (missingColumnMappings.length > 0) {
    return {
      config: "",
      exportScript: "",
      error: `Map at least one column for: ${missingColumnMappings.map(({ source }) => source).join(", ")}.`,
    };
  }
  const isBackfillConfigIncomplete = (config, columns) => {
    const pairs = lookupSourceMatchPairs(config);
    return (
      ![config.postgresSchema, config.postgresTable, config.postgresResultColumn].every(Boolean)
      || pairs.length === 0
      || pairs.some(({ mysqlSourceColumn, postgresColumn }) => !mysqlSourceColumn || !postgresColumn)
      || pairs.some(({ mysqlSourceColumn }) => !columns.some(({ source: mappedSource }) => cleanSource(mappedSource) === mysqlSourceColumn))
    );
  };
  const isLookupIncomplete = (lookup, columns) => {
    if (lookup.mode === "value_map") {
      return ![
        lookup.postgresSchema,
        lookup.postgresTable,
        lookup.postgresMatchColumn,
        lookup.postgresResultColumn,
      ].every(Boolean);
    }
    const sourcePairs = lookupSourceMatchPairs(lookup);
    const sourcePairsInvalid =
      sourcePairs.some(({ mysqlSourceColumn, postgresColumn }) => !mysqlSourceColumn || !postgresColumn)
      || sourcePairs.some(({ mysqlSourceColumn }) => !columns.some(({ source: mappedSource }) => cleanSource(mappedSource) === mysqlSourceColumn));
    if (lookup.mode === "backfill_null") {
      return isBackfillConfigIncomplete(lookup, columns);
    }
    const crosswalkIncomplete = (
      ![
        lookup.mysqlTable,
        lookup.mysqlIdColumn,
        lookup.mysqlMatchColumn,
        lookup.postgresSchema,
        lookup.postgresTable,
        lookup.postgresMatchColumn,
        lookup.postgresResultColumn,
      ].every(Boolean)
      || lookupMatchPairs(lookup).some(({ mysqlColumn, postgresColumn }) => !mysqlColumn || !postgresColumn)
      || sourcePairsInvalid
    );
    if (crosswalkIncomplete) return true;
    if (lookup.alsoBackfillNull) return isBackfillConfigIncomplete(lookup.backfill || {}, columns);
    return false;
  };
  const invalidLookups = selectedTables.flatMap(({ source, columns }) =>
    columns
      .filter(({ lookup }) => lookup && isLookupIncomplete(lookup, columns))
      .map(({ destination }) => `${source}.${destination}`)
  );
  if (invalidLookups.length > 0) {
    return { config: "", exportScript: "", error: `Complete lookup settings for: ${invalidLookups.join(", ")}.` };
  }

  const makeConfigCommands = (targetConnection) => selectedTables.map(({ source, destination, columns }) => {
    const targetColumns = columns.map(({ destination: column }) => quotePgIdentifier(column)).join(", ");
    const sourceFields = columns
      .map(({ destination: column }) => `${column} [null if "\\\\N", null if "NULL"]`)
      .join(", ");

    const command = [
      "LOAD CSV",
      `  FROM ${quoteLoadString(`pgloader-data/${source}.tsv`)}`,
      `  HAVING FIELDS (${sourceFields})`,
      `  INTO ${postgresUri(targetConnection)}`,
      `  TARGET TABLE ${quotePgTable(selectedSchemas.postgres, destination)}`,
      `  TARGET COLUMNS (${targetColumns})`,
      "  WITH skip header = 1,",
      "       workers = 4,",
      "       concurrency = 1,",
      "       batch rows = 50000,",
      "       prefetch rows = 100000,",
      "       fields terminated by '\\t',",
      "       fields not enclosed,",
      "       fields escaped by backslash-quote,",
      "       csv escape mode following,",
      "       on error resume next",
    ];
    if (source.startsWith("no table")) {
      command.push("  BEFORE LOAD DO", synchronizeTableSequences(selectedSchemas.postgres, destination));
    }
    command.push(";");
    return command.join("\n");
  });
  const configCommands = makeConfigCommands(postgresConnection);
  const dockerPostgresConnection = {
    ...postgresConnection,
    host: ["localhost", "127.0.0.1", "::1"].includes(postgresConnection.host)
      ? "host.docker.internal"
      : postgresConnection.host,
  };
  const dockerMysqlHost = ["localhost", "127.0.0.1", "::1"].includes(mysqlConnection.host)
    ? "host.docker.internal"
    : mysqlConnection.host;
  const dockerConfigCommands = makeConfigCommands(dockerPostgresConnection);

  const exportCommands = selectedTables.map(({ source, columns, rowDuplication, relationRows }) => {
    const query = buildQuery(source, columns, selectedSchemas.mysql, rowDuplication, relationRows, limitRows);
    const outputPath = `pgloader-data/${source}.tsv`;
    return [
      "mysql --batch \\",
      `  ${quoteBash(`--host=${mysqlConnection.host}`)} ${quoteBash(`--port=${mysqlConnection.port}`)} \\`,
      `  ${quoteBash(`--user=${mysqlConnection.username}`)} ${quoteBash(`--database=${mysqlConnection.database}`)} \\`,
      `  ${quoteBash(`--execute=${query}`)} > ${quoteBash(outputPath)}`,
    ].join("\n");
  });
  const lookupJobs = selectedTables.flatMap(({ source, columns }) =>
    columns.flatMap((column, index) => {
      if (!column.lookup) return [];
      const entries = [{ source, column, index }];
      if (column.lookup.mode !== "backfill_null" && column.lookup.alsoBackfillNull) {
        entries.push({ source, column, index, backfillOnly: true });
      }
      return entries;
    })
  );
  const lookupJobDetails = lookupJobs.map(({ source, column, index, backfillOnly }, jobIndex) => {
    const lookup = column.lookup;
    const isBackfill = backfillOnly || lookup.mode === "backfill_null";
    const isValueMap = !backfillOnly && lookup.mode === "value_map";
    const settings = backfillOnly ? (lookup.backfill || {}) : lookup;
    const lookupPairs = isBackfill ? [] : lookupMatchPairs(lookup);
    const sourcePairs = lookupSourceMatchPairs(settings);
    const matchPairs = [...lookupPairs, ...sourcePairs];
    const sourceIndexes = sourcePairs.map(({ mysqlSourceColumn }) => selectedTables.find(({ source: table }) => table === source).columns.findIndex(({ source: field }) => cleanSource(field) === mysqlSourceColumn));
    const cleanMysql = (expr) => `REPLACE(REPLACE(REPLACE(CAST(${expr} AS CHAR), '\\\\r', ' '), '\\\\n', ' '), '\\\\t', ' ')`;
    const cleanPg = (expr) => `REPLACE(REPLACE(REPLACE(CAST(${expr} AS TEXT), CHR(13), ' '), CHR(10), ' '), CHR(9), ' ')`;

    const oldColumns = [
      `${quoteSqlIdentifier("l")}.${quoteSqlIdentifier(lookup.mysqlIdColumn)}`,
      ...lookupPairs.map(({ mysqlColumn }) => cleanMysql(`${quoteSqlIdentifier("l")}.${quoteSqlIdentifier(mysqlColumn)}`)),
      ...sourcePairs.map(({ mysqlSourceColumn }) => cleanMysql(`${quoteSqlIdentifier("s")}.${quoteSqlIdentifier(mysqlSourceColumn)}`)),
    ];
    const realColumnSource = cleanSource(column.source);
    const oldQuery = (isBackfill || isValueMap)
      ? ""
      : `SELECT DISTINCT ${oldColumns.join(", ")} FROM ${quoteMysqlTable(lookup.mysqlSchema || selectedSchemas.mysql, lookup.mysqlTable)} AS ${quoteSqlIdentifier("l")} JOIN ${quoteMysqlTable(selectedSchemas.mysql, source)} AS ${quoteSqlIdentifier("s")} ON ${quoteSqlIdentifier("s")}.${quoteSqlIdentifier(realColumnSource)} = ${quoteSqlIdentifier("l")}.${quoteSqlIdentifier(lookup.mysqlIdColumn)};`;

    const pgColumns = [
      ...matchPairs.map(({ postgresColumn }) => cleanPg(quotePgIdentifier(postgresColumn))),
      quotePgIdentifier(settings.postgresResultColumn),
    ];
    const pgQuery = `SELECT ${pgColumns.join(", ")} FROM ${quotePgTable(settings.postgresSchema, settings.postgresTable)};`;
    return {
      source,
      arguments: [
        index,
        isBackfill ? "-" : isValueMap ? "=" : `pgloader-data/lookup-old-${jobIndex}.tsv`,
        `pgloader-data/lookup-new-${jobIndex}.tsv`,
        matchPairs.length,
        sourceIndexes.join(",") || "-",
        settings.caseInsensitive ? 1 : 0,
      ],
      linuxCommands: [
        ...((isBackfill || isValueMap) ? [] : [
          `mysql --batch --raw --skip-column-names ${quoteBash(`--host=${mysqlConnection.host}`)} ${quoteBash(`--port=${mysqlConnection.port}`)} ${quoteBash(`--user=${mysqlConnection.username}`)} ${quoteBash(`--database=${mysqlConnection.database}`)} ${quoteBash(`--execute=${oldQuery}`)} > ${quoteBash(`pgloader-data/lookup-old-${jobIndex}.tsv`)}`,
        ]),
        `PGPASSWORD=${quoteBash(postgresConnection.password)} psql ${quoteBash(`--host=${postgresConnection.host}`)} ${quoteBash(`--port=${postgresConnection.port}`)} ${quoteBash(`--username=${postgresConnection.username}`)} ${quoteBash(`--dbname=${postgresConnection.database}`)} --no-align --tuples-only --field-separator=$'\\t' --command=${quoteBash(pgQuery)} > ${quoteBash(`pgloader-data/lookup-new-${jobIndex}.tsv`)}`,
      ],
      dockerCommands: [
        ...((isBackfill || isValueMap) ? [] : [
          `docker exec -e MYSQL_PWD $mysqlClient mysql --batch --raw --skip-column-names --host=${dockerMysqlHost} --port=${mysqlConnection.port} --user=${mysqlConnection.username} --database=${mysqlConnection.database} --execute=${quotePowerShell(oldQuery)} | Out-File ${quotePowerShell(`pgloader-data/lookup-old-${jobIndex}.tsv`)} -Encoding utf8`,
          "if ($LASTEXITCODE -ne 0) { throw 'MySQL lookup export failed.' }",
        ]),
        `$env:PGPASSWORD = ${quotePowerShell(postgresConnection.password)}`,
        `docker exec -e PGPASSWORD $postgresClient psql --host=${dockerPostgresConnection.host} --port=${postgresConnection.port} --username=${postgresConnection.username} --dbname=${postgresConnection.database} --no-align --tuples-only --field-separator=$tab --command=${quotePowerShell(pgQuery)} | Out-File ${quotePowerShell(`pgloader-data/lookup-new-${jobIndex}.tsv`)} -Encoding utf8`,
        "if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL lookup export failed.' }",
      ],
    };
  });
  const linuxLookupCommands = lookupJobDetails.flatMap(({ linuxCommands }) => linuxCommands);
  const linuxLookupTransforms = selectedTables.flatMap(({ source }) => {
    const jobs = lookupJobDetails.filter((job) => job.source === source);
    if (jobs.length === 0) return [];
    const argumentsText = jobs.flatMap(({ arguments: values }) => values.map(quoteBash)).join(" ");
    return [`python3 lookup-transform.py ${quoteBash(`pgloader-data/${source}.tsv`)} ${argumentsText}`];
  });
  const dockerExportCommands = selectedTables.map(({ source, columns, rowDuplication, relationRows }) => {
    const query = buildQuery(source, columns, selectedSchemas.mysql, rowDuplication, relationRows, limitRows);
    return [
      "docker exec -e MYSQL_PWD $mysqlClient mysql --batch `",
      `  --host=${dockerMysqlHost} --port=${mysqlConnection.port} \``,
      `  --user=${mysqlConnection.username} --database=${mysqlConnection.database} \``,
      `  --execute=${quotePowerShell(query)} | Out-File -FilePath ${quotePowerShell(`pgloader-data/${source}.tsv`)} -Encoding utf8`,
      "if ($LASTEXITCODE -ne 0) { throw 'MySQL export failed.' }",
    ].join("\n");
  });
  const dockerLookupCommands = lookupJobDetails.flatMap(({ dockerCommands }) => dockerCommands);
  const dockerLookupTransforms = selectedTables.flatMap(({ source }) => {
    const jobs = lookupJobDetails.filter((job) => job.source === source);
    if (jobs.length === 0) return [];
    const argumentsText = jobs.flatMap(({ arguments: values }) => values.map(quotePowerShell)).join(" ");
    return [
      `py -3 lookup-transform.py ${quotePowerShell(`pgloader-data/${source}.tsv`)} ${argumentsText}`,
      "if ($LASTEXITCODE -ne 0) { throw 'Lookup replacement failed.' }",
    ];
  });
  const parallelExportCommands = exportCommands.flatMap((command, index) => [
    `echo "[$(( ${index} + 1 ))/${exportCommands.length}] Exporting ${selectedTables[index].source}..."`,
    `(${command}\necho "Exported ${selectedTables[index].source}") &`,
    "export_pids+=(\"$!\")",
    "if (( ${#export_pids[@]} >= export_jobs )); then wait \"${export_pids[0]}\"; export_pids=(\"${export_pids[@]:1}\"); fi",
  ]);
  const lookupIndexAdvice = lookupJobs.map(({ source, column, backfillOnly }) => {
    const lookup = column.lookup;
    if (backfillOnly || lookup.mode === "backfill_null") {
      const config = backfillOnly ? (lookup.backfill || {}) : lookup;
      return `# Performance check: index PostgreSQL match columns on ${config.postgresSchema}.${config.postgresTable} used to backfill NULL ${source}.${column.destination}.`;
    }
    if (lookup.mode === "value_map") {
      return `# Performance check: index PostgreSQL relation lookup column ${lookup.postgresSchema}.${lookup.postgresTable}.${lookup.postgresMatchColumn} used to resolve ${source}.${column.destination}.`;
    }
    return `# Performance check: index ${lookup.mysqlSchema || selectedSchemas.mysql}.${lookup.mysqlTable}.${lookup.mysqlIdColumn} and ${selectedSchemas.mysql}.${source}.${column.source}; also index PostgreSQL lookup match columns on ${lookup.postgresSchema}.${lookup.postgresTable}.`;
  });

  return {
    config: [
      "-- Generated by MySQL to PostgreSQL Migration Tool for Linux",
      "-- Run mysql-to-pgloader.sh first to create the TSV files and start pgloader.",
      "-- PostgreSQL destination tables must already exist.",
      "",
      configCommands.join("\n\n"),
      "",
    ].join("\n"),
    exportScript: [
      "#!/usr/bin/env bash",
      "set -Eeuo pipefail",
      "work_dir=\"$(cd -- \"$(dirname -- \"${BASH_SOURCE[0]}\")\" && pwd)\"",
      "cd \"$work_dir\"",
      "",
      "command -v mysql >/dev/null 2>&1 || { echo 'MySQL client was not found.' >&2; exit 1; }",
      "command -v pgloader >/dev/null 2>&1 || { echo 'pgloader was not found.' >&2; exit 1; }",
      ...(lookupJobs.length > 0 ? ["command -v psql >/dev/null 2>&1 || { echo 'PostgreSQL client was not found.' >&2; exit 1; }", "command -v python3 >/dev/null 2>&1 || { echo 'Python 3 was not found.' >&2; exit 1; }"] : []),
      "mkdir -p pgloader-data",
      "rm -f lookup-duplicates.txt",
      "migration_started=$SECONDS",
      "export_started=$SECONDS",
      "export_jobs=${MIGRATION_EXPORT_JOBS:-4}",
      "[[ $export_jobs =~ ^[1-9][0-9]*$ ]] || { echo 'MIGRATION_EXPORT_JOBS must be a positive integer.' >&2; exit 1; }",
      "export_pids=()",
      `export MYSQL_PWD=${quoteBash(mysqlConnection.password)}`,
      ...parallelExportCommands,
      "for export_pid in \"${export_pids[@]}\"; do wait \"$export_pid\"; done",
      "echo \"Export phase completed in $((SECONDS - export_started)) seconds.\"",
      ...(lookupJobs.length > 0 ? ["lookup_started=$SECONDS", ...lookupIndexAdvice] : []),
      ...linuxLookupCommands,
      ...linuxLookupTransforms,
      ...(lookupJobs.length > 0 ? ["echo \"Lookup phase completed in $((SECONDS - lookup_started)) seconds.\""] : []),
      "unset MYSQL_PWD",
      "",
      "load_started=$SECONDS",
      "pgloader mysql-to-postgres.load",
      "echo \"Load phase completed in $((SECONDS - load_started)) seconds.\"",
      "echo \"Migration completed in $((SECONDS - migration_started)) seconds.\"",
      "",
    ].join("\n"),
    dockerConfig: [
      "-- Generated for Docker Desktop on Windows",
      "",
      dockerConfigCommands.join("\n\n"),
      "",
    ].join("\n"),
    dockerScript: [
      "$ErrorActionPreference = 'Stop'",
      "$workDir = Split-Path -Parent $MyInvocation.MyCommand.Path",
      "$tab = [char]9",
      "$migrationStarted = Get-Date",
      "Set-Location $workDir",
      "if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop was not found.' }",
      "$savedErrorActionPreference = $ErrorActionPreference",
      "$ErrorActionPreference = 'SilentlyContinue'",
      "docker info *> $null",
      "$dockerInfoExitCode = $LASTEXITCODE",
      "$ErrorActionPreference = $savedErrorActionPreference",
      "if ($dockerInfoExitCode -ne 0) { throw 'Docker Desktop is installed, but its Linux container engine is not running. Start Docker Desktop, wait until it reports Engine running, select Linux containers if prompted, and try again.' }",
      "New-Item -ItemType Directory -Force -Path 'pgloader-data' | Out-Null",
      "Remove-Item -Path 'lookup-duplicates.txt' -ErrorAction SilentlyContinue | Out-Null",
      "$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)",
      "$mysqlClient = \"migration-mysql-client-$runId\"",
      "$mysqlClientStarted = $false",
      ...(lookupJobs.length > 0 ? ["$postgresClient = \"migration-postgres-client-$runId\""] : []),
      ...(lookupJobs.length > 0 ? ["$postgresClientStarted = $false"] : []),
      `$env:MYSQL_PWD = ${quotePowerShell(mysqlConnection.password)}`,
      "try {",
      "  docker run --detach --rm --name $mysqlClient --add-host host.docker.internal:host-gateway -e MYSQL_PWD --entrypoint sh mysql:8.4 -c 'while :; do sleep 3600; done' | Out-Null",
      "  if ($LASTEXITCODE -ne 0) { throw 'Unable to start the reusable MySQL client container.' }",
      "  $mysqlClientStarted = $true",
      ...(lookupJobs.length > 0 ? [
        "  $env:PGPASSWORD = " + quotePowerShell(postgresConnection.password),
        "  docker run --detach --rm --name $postgresClient --add-host host.docker.internal:host-gateway -e PGPASSWORD --entrypoint sh postgres:17 -c 'while :; do sleep 3600; done' | Out-Null",
        "  if ($LASTEXITCODE -ne 0) { throw 'Unable to start the reusable PostgreSQL client container.' }",
        "  $postgresClientStarted = $true",
      ] : []),
      "  $exportStarted = Get-Date",
      ...dockerExportCommands.map((command) => command.split("\n").map((line) => `  ${line}`).join("\n")),
      "  Write-Host ('Export phase completed in {0:n1} seconds.' -f ((Get-Date) - $exportStarted).TotalSeconds)",
      ...(lookupJobs.length > 0 ? ["  $lookupStarted = Get-Date", ...lookupIndexAdvice.map((line) => `  Write-Host ${quotePowerShell(line.slice(2))}`)] : []),
      ...dockerLookupCommands.map((command) => `  ${command}`),
      ...dockerLookupTransforms.map((command) => `  ${command}`),
      ...(lookupJobs.length > 0 ? ["  Write-Host ('Lookup phase completed in {0:n1} seconds.' -f ((Get-Date) - $lookupStarted).TotalSeconds)"] : []),
      "} finally {",
      "  Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue",
      "  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue",
      "  if ($mysqlClientStarted) { docker rm -f $mysqlClient *> $null }",
      ...(lookupJobs.length > 0 ? ["  if ($postgresClientStarted) { docker rm -f $postgresClient *> $null }"] : []),
      "}",
      "$loadStarted = Get-Date",
      "$pgloaderImage = if ($env:PGLOADER_IMAGE) { $env:PGLOADER_IMAGE } else { 'dimitri/pgloader:latest' }",
      "docker run --rm --add-host host.docker.internal:host-gateway -v \"${workDir}:/work\" -w /work $pgloaderImage pgloader mysql-to-postgres.load",
      "if ($LASTEXITCODE -ne 0) { throw 'pgloader failed.' }",
      "Write-Host ('Load phase completed in {0:n1} seconds.' -f ((Get-Date) - $loadStarted).TotalSeconds)",
      "Write-Host ('Migration completed in {0:n1} seconds.' -f ((Get-Date) - $migrationStarted).TotalSeconds)",
      "",
    ].join("\n"),
    lookupHelper: LOOKUP_HELPER,
    error: "",
  };
}

