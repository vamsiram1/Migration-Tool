#!/usr/bin/env python3
import sys
from pathlib import Path

data_path, *arguments = sys.argv[1:]
if not arguments or len(arguments) % 6:
    raise SystemExit("Expected one or more lookup groups of 6 arguments")

def log_duplicate(message):
    with open("lookup-duplicates.txt", "a", encoding="utf-8") as stream:
        stream.write(message + "\n")

def rows(path):
    with open(path, encoding="utf-8-sig") as stream:
        for line in stream:
            yield line.rstrip("\r\n").split("\t")

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
                    f"[PostgreSQL Lookup Duplicate]\n"
                    f"Match Columns: {match!r}\n"
                    f"Assigned ID (Kept): {new_ids[match]}\n"
                    f"Duplicate ID (Skipped): {result_id}\n"
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
                f"[Missing PostgreSQL Lookup Match]\n"
                f"MySQL ID: {row[0]}\n"
                f"Match Columns: {match!r}\n"
                f"Status: Skipped substitution (value kept as original)\n"
                f"----------------------------------------"
            )
            continue
        result_id = new_ids[match]
        source_values = row[match_count - len(source_indexes) + 1:match_count + 1]
        crosswalk_key = (row[0], *(normalized(value) for value in source_values))
        if crosswalk_key in crosswalk:
            if crosswalk[crosswalk_key] != result_id:
                log_duplicate(
                    f"[MySQL Lookup Key Resolves to Multiple PostgreSQL IDs]\n"
                    f"MySQL ID: {row[0]}\n"
                    f"Match Columns: {match!r}\n"
                    f"Assigned PG ID (Kept): {crosswalk[crosswalk_key]}\n"
                    f"Duplicate PG ID (Skipped): {result_id}\n"
                    f"----------------------------------------"
                )
            continue
        crosswalk[crosswalk_key] = result_id
    jobs.append((column, source_indexes, normalized, crosswalk, None, "crosswalk"))

source = Path(data_path)
temporary = source.with_suffix(source.suffix + ".lookup")
with source.open(encoding="utf-8-sig") as input_stream, temporary.open("w", encoding="utf-8", newline="") as output_stream:
    for line_number, line in enumerate(input_stream):
        row = line.rstrip("\r\n").split("\t")
        if line_number > 0:
            for column, source_indexes, normalized, crosswalk, new_ids, mode in jobs:
                if column >= len(row):
                    continue
                cell_is_empty = row[column].strip() in ("", "\\N", "\\\\N", "NULL", "null", "None") or row[column].strip().replace("\\\\", "") in ("", "N", "null", "NULL")
                if mode == "backfill":
                    if not cell_is_empty:
                        continue
                    backfill_key = tuple(normalized(row[index]) for index in source_indexes)
                    if backfill_key not in new_ids:
                        log_duplicate(
                            f"[Missing Null Backfill Match for Data Row]\n"
                            f"Target Table: {source.name}\n"
                            f"Line Number: {line_number + 1}\n"
                            f"Input Match Key: {backfill_key!r}\n"
                            f"Status: Value kept as NULL\n"
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
                            f"[Missing Relation Lookup for Data Row]\n"
                            f"Target Table: {source.name}\n"
                            f"Line Number: {line_number + 1}\n"
                            f"Relation Name: {row[column]!r}\n"
                            f"Status: Value kept as original '{row[column]}'\n"
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
                        f"[Missing Lookup Mapping for Data Row]\n"
                        f"Target Table: {source.name}\n"
                        f"Line Number: {line_number + 1}\n"
                        f"Input Lookup Key: {crosswalk_key!r}\n"
                        f"Status: Value kept as original '{row[column]}'\n"
                        f"----------------------------------------"
                    )
                    continue
                row[column] = crosswalk[crosswalk_key]
        output_stream.write("\t".join(row) + "\n")
temporary.replace(source)
