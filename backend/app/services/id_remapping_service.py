import uuid
from datetime import datetime
import psycopg
from fastapi import HTTPException

from app.schemas.id_remapping import (
    IdMappingItem,
    IdRemapPreviewRequest,
    IdRemapPreviewResponse,
    RelatedTableInfo,
    IdRemapExecuteRequest,
    IdRemapExecuteResponse,
    IdRemapRevertRequest,
    IdRemapHistoryItem,
    IdRemapHistoryResponse,
    SelectedChildTable,
    UpdatedChildResult,
    TableDiscoveryRequest,
    TableDiscoveryResponse,
    DiscoveredRelatedTable,
)

# In-memory history of executed ID remapping operations
_operation_history = []


def get_pg_connection(conn_data):
    return psycopg.connect(
        host=conn_data.host,
        port=conn_data.port,
        dbname=conn_data.database,
        user=conn_data.username,
        password=conn_data.password,
    )


def parse_schema_and_table(table_input: str, default_schema: str = "public"):
    """Extracts (schema, table) from an input like 'sce_student.v_class' or 'v_class'."""
    clean_input = table_input.strip()
    if "." in clean_input:
        parts = clean_input.split(".", 1)
        return parts[0].strip(), parts[1].strip()
    return (default_schema.strip() or "public"), clean_input


def resolve_parent_table_and_schema(cur, table_input: str, default_schema: str = "public"):
    """Finds the actual real (schema, table_name, pk_col, pk_type) from PostgreSQL catalog."""
    clean_input = table_input.strip()
    if "." in clean_input:
        parts = clean_input.split(".", 1)
        schema, table = parts[0].strip(), parts[1].strip()
    else:
        schema, table = (default_schema.strip() or "public"), clean_input

    # 1. Check if table exists in specified schema
    cur.execute(
        """
        SELECT ns.nspname, cls.relname
        FROM pg_class cls
        JOIN pg_namespace ns ON cls.relnamespace = ns.oid
        WHERE LOWER(ns.nspname) = LOWER(%s) AND LOWER(cls.relname) = LOWER(%s)
          AND cls.relkind IN ('r', 'p', 'v', 'm')
        LIMIT 1;
        """,
        (schema, table),
    )
    row = cur.fetchone()

    # 2. If not found and user didn't explicitly prefix schema with '.', search across all schemas
    if not row and "." not in clean_input:
        cur.execute(
            """
            SELECT ns.nspname, cls.relname
            FROM pg_class cls
            JOIN pg_namespace ns ON cls.relnamespace = ns.oid
            WHERE LOWER(cls.relname) = LOWER(%s)
              AND ns.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
              AND cls.relkind IN ('r', 'p', 'v', 'm')
            ORDER BY (ns.nspname = 'public') DESC, ns.nspname ASC
            LIMIT 1;
            """,
            (table,),
        )
        row = cur.fetchone()

    if row:
        real_schema, real_table = row[0], row[1]
        pk_col, pk_type = get_primary_key_info(cur, real_schema, real_table)
        return real_schema, real_table, pk_col, pk_type

    pk_col, pk_type = get_primary_key_info(cur, schema, table)
    return schema, table, pk_col, pk_type


def get_primary_key_info(cur, schema: str, table: str):
    """Finds primary key column name and data type for a given PostgreSQL table or view."""
    # 1. First check explicit PRIMARY KEY constraint
    cur.execute(
        """
        SELECT kcu.column_name, c.data_type
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.columns c
          ON c.table_schema = kcu.table_schema
          AND c.table_name = kcu.table_name
          AND c.column_name = kcu.column_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND LOWER(tc.table_schema) = LOWER(%s)
          AND LOWER(tc.table_name) = LOWER(%s)
        ORDER BY kcu.ordinal_position
        LIMIT 1;
        """,
        (schema, table),
    )
    row = cur.fetchone()
    if row:
        return row[0], row[1]

    # 2. If no constraint found (common in views or tables without formal PK constraint),
    # query information_schema.columns to find the primary identity column
    cur.execute(
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE LOWER(table_schema) = LOWER(%s)
          AND LOWER(table_name) = LOWER(%s)
        ORDER BY ordinal_position;
        """,
        (schema, table),
    )
    cols = cur.fetchall()
    if cols:
        p_lower = table.lower()
        base_name = p_lower
        for prefix in ("v_", "t_", "tbl_", "m_", "tb_", "view_"):
            if base_name.startswith(prefix):
                base_name = base_name[len(prefix):]
                break

        # Priority 1: base_name + '_id' (e.g. 'class_id' for 'v_class')
        for col_name, d_type in cols:
            if col_name.lower() == f"{base_name}_id" or col_name.lower() == f"{p_lower}_id":
                return col_name, d_type

        # Priority 2: Exact 'id'
        for col_name, d_type in cols:
            if col_name.lower() == "id":
                return col_name, d_type

        # Priority 3: Any column ending in '_id' or 'id'
        for col_name, d_type in cols:
            if col_name.lower().endswith("_id") or col_name.lower().endswith("id"):
                return col_name, d_type

        # Fallback to first column
        return cols[0][0], cols[0][1]

    return "id", "integer"


def get_candidate_fk_column_names(parent_table: str, pk_col: str):
    """Generates candidate column names used in logical foreign key references."""
    candidates = set()
    p_lower = parent_table.lower().strip()
    pk_lower = pk_col.lower().strip()

    # Base name without prefixes
    base_name = p_lower
    for prefix in ("v_", "t_", "tbl_", "m_", "tb_", "view_"):
        if base_name.startswith(prefix):
            base_name = base_name[len(prefix):]
            break

    # Also strip common suffixes
    for suffix in ("_master", "_mst", "_tbl", "_table", "_info", "_details", "_data", "_list"):
        if base_name.endswith(suffix):
            base_name = base_name[:-len(suffix)]
            break

    # 1. Primary key column itself (e.g. 'class_id', 'course_id', 'student_id')
    if pk_lower:
        candidates.add(pk_lower)
        candidates.add(f"fk_{pk_lower}")
        candidates.add(f"ref_{pk_lower}")

    # 2. Base name variations
    candidates.add(f"{base_name}_id")
    candidates.add(f"{base_name}id")
    candidates.add(f"{base_name}")
    candidates.add(f"fk_{base_name}")
    candidates.add(f"fk_{base_name}_id")
    candidates.add(f"ref_{base_name}")
    candidates.add(f"ref_{base_name}_id")
    candidates.add(f"{base_name}_code")
    candidates.add(f"{base_name}_cd")
    candidates.add(f"{base_name}_no")
    candidates.add(f"{base_name}_num")
    candidates.add(f"{base_name}_pk")
    candidates.add(f"{base_name}_fk")
    candidates.add(f"{base_name}_key")
    candidates.add(f"{base_name}_ref")

    # Common domain abbreviations
    if base_name == "class":
        candidates.update(["cls_id", "clsid", "cls", "vclass", "vclass_id", "vclassid", "class_sec_id", "class_section_id"])
    elif base_name == "course":
        candidates.update(["crs_id", "crsid", "crs", "vcourse", "vcourse_id", "course_code"])
    elif base_name == "student":
        candidates.update(["std_id", "stud_id", "stdnt_id", "student_no", "student_code"])

    # 3. Full parent table variations
    candidates.add(f"{p_lower}_id")
    candidates.add(f"{p_lower}id")
    candidates.add(f"{p_lower}")
    candidates.add(f"fk_{p_lower}")
    candidates.add(f"fk_{p_lower}_id")
    candidates.add(f"ref_{p_lower}")
    candidates.add(f"ref_{p_lower}_id")

    # 4. Singular versions of base_name
    if base_name.endswith("ies") and len(base_name) > 3:
        sing = base_name[:-3] + "y"
        candidates.add(f"{sing}_id")
        candidates.add(f"{sing}id")
        candidates.add(f"{sing}")
    elif base_name.endswith("es") and len(base_name) > 2:
        sing = base_name[:-2]
        candidates.add(f"{sing}_id")
        candidates.add(f"{sing}id")
        candidates.add(f"{sing}")
    elif base_name.endswith("s") and len(base_name) > 1:
        sing = base_name[:-1]
        candidates.add(f"{sing}_id")
        candidates.add(f"{sing}id")
        candidates.add(f"{sing}")

    return [c for c in candidates if c]


def get_unused_temp_ids(cur, schema: str, parent_table: str, pk_col: str, data_type: str, count: int):
    """Generates `count` guaranteed unique, collision-free unused temporary IDs."""
    if count <= 0:
        return []
    is_numeric = data_type.lower() in (
        "integer", "bigint", "smallint", "numeric", "decimal", "int", "int4", "int8", "int2"
    )
    if is_numeric:
        cur.execute(f'SELECT COALESCE(MAX("{pk_col}"), 0) FROM "{schema}"."{parent_table}"')
        max_val = cur.fetchone()[0]
        try:
            base_temp = int(max_val) + 9000000
        except Exception:
            base_temp = 99990000
        return [str(base_temp + i + 1) for i in range(count)]
    else:
        prefix = uuid.uuid4().hex[:8]
        return [f"__temp_swap_{prefix}_{i}__" for i in range(count)]


def get_unused_temp_id(cur, schema: str, parent_table: str, pk_col: str, data_type: str):
    """Generates a single guaranteed unused temporary ID for backwards compatibility."""
    ids = get_unused_temp_ids(cur, schema, parent_table, pk_col, data_type, 1)
    return ids[0] if ids else "__temp_swap_0__"


def get_next_available_id(cur, schema: str, parent_table: str, pk_col: str, pk_type: str, offset: int = 0, excluded_ids: set = None):
    """Finds the next guaranteed unused, collision-free available ID in the parent table for auto-displacement."""
    is_numeric = pk_type.lower() in (
        "integer", "bigint", "smallint", "numeric", "decimal", "int", "int4", "int8", "int2"
    )
    if is_numeric:
        cur.execute(f'SELECT COALESCE(MAX("{pk_col}"), 0) FROM "{schema}"."{parent_table}"')
        max_val = cur.fetchone()[0]
        try:
            candidate = int(max_val) + 1 + offset
        except Exception:
            candidate = 1000 + offset + 1
        
        if excluded_ids:
            while str(candidate) in excluded_ids:
                candidate += 1
        return str(candidate)
    else:
        new_uuid = str(uuid.uuid4())
        if excluded_ids:
            while new_uuid in excluded_ids:
                new_uuid = str(uuid.uuid4())
        return new_uuid


def extract_and_validate_mappings(mappings_input, single_old_id, single_new_id, require_mappings: bool = False, is_auto_displace: bool = False):
    """Extracts, cleans, and validates mapping list from request payload."""
    raw_list = []
    if mappings_input and len(mappings_input) > 0:
        for m in mappings_input:
            o = (m.old_id if hasattr(m, "old_id") else m.get("old_id", "")).strip()
            n = (m.new_id if hasattr(m, "new_id") else m.get("new_id", "")).strip()
            if o or n:
                raw_list.append((o, n))
    elif single_old_id or single_new_id:
        o = str(single_old_id or "").strip()
        n = str(single_new_id or "").strip()
        if o or n:
            raw_list.append((o, n))

    if not raw_list:
        if require_mappings:
            raise HTTPException(status_code=400, detail="At least one ID mapping must be specified.")
        return []

    if is_auto_displace:
        # In auto-displace mode, only old_id is required; new_id will be auto-generated if omitted
        for idx, (o, n) in enumerate(raw_list):
            if not o:
                raise HTTPException(status_code=400, detail=f"Mapping row #{idx + 1}: Existing ID cannot be empty.")
        return raw_list

    # Standard remap/swap: validate non-empty and old_id != new_id for each step
    for idx, (o, n) in enumerate(raw_list):
        if not o:
            raise HTTPException(status_code=400, detail=f"Mapping row #{idx + 1}: Old ID cannot be empty.")
        if not n:
            raise HTTPException(status_code=400, detail=f"Mapping row #{idx + 1}: New ID cannot be empty.")
        if o == n:
            raise HTTPException(
                status_code=400,
                detail=f"Mapping row #{idx + 1}: Old ID '{o}' and New ID '{n}' cannot be the same.",
            )

    return raw_list


def batch_count_child_references(cur, candidate_items, all_source_ids_list, all_swap_new_ids_list):
    """
    Batches count queries across multiple child tables into chunks to minimize network roundtrips.
    candidate_items: list of (child_schema, child_table, fk_col, data_type) or (child_schema, child_table, fk_col)
    Returns: dict mapping (c_schema, child_tbl, fk_col) -> (count_old, count_new)
    """
    if not candidate_items:
        return {}

    results = {}
    for item in candidate_items:
        c_sch, c_tbl, fk_col = item[0], item[1], item[2]
        results[(c_sch.lower(), c_tbl.lower(), fk_col.lower())] = (0, 0)

    # Check if IDs are all numeric
    all_source_is_num = len(all_source_ids_list) > 0 and all(x.strip().lstrip('-').isdigit() for x in all_source_ids_list if x.strip())
    all_swap_is_num = len(all_swap_new_ids_list) > 0 and all(x.strip().lstrip('-').isdigit() for x in all_swap_new_ids_list if x.strip())
    all_ids_str = list(set(all_source_ids_list + all_swap_new_ids_list))
    all_ids_is_num = len(all_ids_str) > 0 and all(x.strip().lstrip('-').isdigit() for x in all_ids_str if x.strip())

    # Process in chunks of 25 to balance SQL size and minimize roundtrips
    chunk_size = 25
    for i in range(0, len(candidate_items), chunk_size):
        chunk = candidate_items[i : i + chunk_size]
        queries = []
        params = []
        valid_items_in_chunk = []

        for idx, item in enumerate(chunk):
            c_sch = item[0]
            c_tbl = item[1]
            fk_col = item[2]
            d_typ = (item[3] if len(item) > 3 else "text").lower()

            is_numeric_type = d_typ in (
                "int2", "int4", "int8", "integer", "bigint", "smallint", "numeric", "decimal", "int"
            )
            is_text_type = d_typ in ("varchar", "text", "bpchar", "char", "name", "character varying")

            # Build fast index-compatible clauses
            if is_numeric_type:
                if not all_ids_is_num:
                    # IDs are non-numeric strings, cannot match integer columns
                    continue
                old_clause = f'"{fk_col}" = ANY(%s::bigint[])'
                new_clause = f'"{fk_col}" = ANY(%s::bigint[])'
                where_clause = f'"{fk_col}" = ANY(%s::bigint[])'
                old_p = [int(x) for x in all_source_ids_list]
                new_p = [int(x) for x in all_swap_new_ids_list] if all_swap_new_ids_list else []
                where_p = [int(x) for x in all_ids_str]
            elif is_text_type:
                old_clause = f'"{fk_col}" = ANY(%s::text[])'
                new_clause = f'"{fk_col}" = ANY(%s::text[])'
                where_clause = f'"{fk_col}" = ANY(%s::text[])'
                old_p = all_source_ids_list
                new_p = all_swap_new_ids_list
                where_p = all_ids_str
            else:
                old_clause = f'"{fk_col}"::text = ANY(%s)'
                new_clause = f'"{fk_col}"::text = ANY(%s)'
                where_clause = f'"{fk_col}"::text = ANY(%s)'
                old_p = all_source_ids_list
                new_p = all_swap_new_ids_list
                where_p = all_ids_str

            valid_items_in_chunk.append((idx, c_sch, c_tbl, fk_col, d_typ, is_numeric_type, is_text_type))

            if all_swap_new_ids_list:
                queries.append(
                    f'SELECT {idx} AS item_idx, '
                    f'COUNT(*) FILTER (WHERE {old_clause}) AS count_old, '
                    f'COUNT(*) FILTER (WHERE {new_clause}) AS count_new '
                    f'FROM "{c_sch}"."{c_tbl}" '
                    f'WHERE {where_clause}'
                )
                params.extend([old_p, new_p, where_p])
            else:
                queries.append(
                    f'SELECT {idx} AS item_idx, '
                    f'COUNT(*) AS count_old, '
                    f'0::bigint AS count_new '
                    f'FROM "{c_sch}"."{c_tbl}" '
                    f'WHERE {where_clause}'
                )
                params.append(old_p)

        if not queries:
            continue

        union_sql = " UNION ALL ".join(queries)
        try:
            cur.execute(union_sql, params)
            for row in cur.fetchall():
                item_idx = row[0]
                c_old = int(row[1] or 0)
                c_new = int(row[2] or 0)
                item = chunk[item_idx]
                results[(item[0].lower(), item[1].lower(), item[2].lower())] = (c_old, c_new)
        except Exception:
            # Fallback to individual safe execution for this chunk if any table is locked / restricted
            for idx, c_sch, c_tbl, fk_col, d_typ, is_numeric_type, is_text_type in valid_items_in_chunk:
                c_old = 0
                c_new = 0
                try:
                    if is_numeric_type and all_source_is_num:
                        cur.execute(
                            f'SELECT COUNT(*) FROM "{c_sch}"."{c_tbl}" WHERE "{fk_col}" = ANY(%s::bigint[])',
                            ([int(x) for x in all_source_ids_list],),
                        )
                    else:
                        cur.execute(
                            f'SELECT COUNT(*) FROM "{c_sch}"."{c_tbl}" WHERE "{fk_col}"::text = ANY(%s)',
                            (all_source_ids_list,),
                        )
                    c_old = cur.fetchone()[0]
                except Exception:
                    pass
                if all_swap_new_ids_list:
                    try:
                        if is_numeric_type and all_swap_is_num:
                            cur.execute(
                                f'SELECT COUNT(*) FROM "{c_sch}"."{c_tbl}" WHERE "{fk_col}" = ANY(%s::bigint[])',
                                ([int(x) for x in all_swap_new_ids_list],),
                            )
                        else:
                            cur.execute(
                                f'SELECT COUNT(*) FROM "{c_sch}"."{c_tbl}" WHERE "{fk_col}"::text = ANY(%s)',
                                (all_swap_new_ids_list,),
                            )
                        c_new = cur.fetchone()[0]
                    except Exception:
                        pass
                results[(c_sch.lower(), c_tbl.lower(), fk_col.lower())] = (c_old, c_new)

    return results


def discover_related_tables(req: TableDiscoveryRequest) -> TableDiscoveryResponse:
    """Discovers foreign-key and logical column relationships for a parent table instantly from metadata without querying row counts."""
    conn_info = req.connection
    default_schema = req.parent_schema or conn_info.schema_name or "public"

    try:
        conn = get_pg_connection(conn_info)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Database connection failed: {str(e)}")

    try:
        with conn.cursor() as cur:
            schema, parent_table, pk_col, pk_type = resolve_parent_table_and_schema(
                cur, req.parent_table, default_schema
            )

            target_sch = (req.target_schema or "").strip()
            is_all_schemas = not target_sch or target_sch.upper() == "__ALL__"

            base_p_tbl = parent_table.lower()
            for prefix in ("v_", "t_", "tbl_", "m_", "tb_", "view_"):
                if base_p_tbl.startswith(prefix):
                    base_p_tbl = base_p_tbl[len(prefix):]
                    break

            # 1. Discover Formal Foreign Keys
            fk_query = """
                SELECT
                    src_ns.nspname AS child_schema,
                    src_cls.relname AS child_table,
                    src_att.attname AS foreign_key_column,
                    ref_ns.nspname AS parent_schema,
                    ref_cls.relname AS parent_table,
                    ref_att.attname AS parent_primary_key,
                    c.conname AS constraint_name,
                    src_typ.typname AS data_type
                FROM pg_constraint c
                JOIN pg_class src_cls ON src_cls.oid = c.conrelid
                JOIN pg_namespace src_ns ON src_ns.oid = src_cls.relnamespace
                JOIN pg_attribute src_att ON src_att.attrelid = src_cls.oid AND src_att.attnum = ANY(c.conkey)
                JOIN pg_type src_typ ON src_att.atttypid = src_typ.oid
                JOIN pg_class ref_cls ON ref_cls.oid = c.confrelid
                JOIN pg_namespace ref_ns ON ref_ns.oid = ref_cls.relnamespace
                JOIN pg_attribute ref_att ON ref_att.attrelid = ref_cls.oid AND ref_att.attnum = ANY(c.confkey)
                WHERE c.contype = 'f'
                  AND (LOWER(ref_cls.relname) = LOWER(%s) OR LOWER(ref_cls.relname) = LOWER(%s))
            """
            fk_params = [parent_table, base_p_tbl]

            if not is_all_schemas:
                fk_query += " AND LOWER(TRIM(src_ns.nspname)) = LOWER(TRIM(%s))"
                fk_params.append(target_sch)
            fk_query += " ORDER BY src_ns.nspname, src_cls.relname, src_att.attname;"

            cur.execute(fk_query, fk_params)
            fk_rows = cur.fetchall()

            discovered_keys = set()
            related_tables = []

            for row in fk_rows:
                c_schema, child_tbl, fk_col, p_schema, p_tbl, p_pk, c_name, d_type = row
                key = (c_schema.lower(), child_tbl.lower(), fk_col.lower())
                discovered_keys.add(key)
                related_tables.append(
                    DiscoveredRelatedTable(
                        child_schema=c_schema,
                        child_table=child_tbl,
                        foreign_key_column=fk_col,
                        parent_schema=p_schema,
                        parent_table=p_tbl,
                        parent_primary_key=p_pk or pk_col,
                        constraint_name=c_name or "SQL Foreign Key",
                        match_type="foreign_key",
                        data_type=d_type or "integer",
                    )
                )

            # 2. Discover Logical Column Name Matches via information_schema.columns
            candidate_cols = list(get_candidate_fk_column_names(parent_table, pk_col))
            if candidate_cols:
                logical_query = """
                    SELECT
                        c.table_schema AS child_schema,
                        c.table_name AS child_table,
                        c.column_name AS foreign_key_column,
                        c.data_type AS data_type
                    FROM information_schema.columns c
                    WHERE c.table_schema NOT IN ('information_schema', 'pg_catalog')
                      AND c.table_schema NOT LIKE 'pg_toast%%'
                      AND (
                          LOWER(c.column_name) = ANY(%s)
                          OR LOWER(c.column_name) LIKE %s
                          OR LOWER(c.column_name) LIKE %s
                          OR LOWER(c.column_name) LIKE %s
                          OR LOWER(c.column_name) LIKE %s
                          OR LOWER(c.column_name) LIKE %s
                          OR LOWER(c.column_name) LIKE %s
                          OR LOWER(c.column_name) LIKE %s
                      )
                """
                logical_params = [
                    candidate_cols,
                    f"%_{base_p_tbl}_id%",
                    f"%{base_p_tbl}_id%",
                    f"%_{base_p_tbl}%",
                    f"%{base_p_tbl}%",
                    f"%_{pk_col.lower()}%",
                    f"%{pk_col.lower()}%",
                    f"{base_p_tbl}_%",
                ]
                if not is_all_schemas:
                    logical_query += " AND LOWER(TRIM(c.table_schema)) = LOWER(TRIM(%s))"
                    logical_params.append(target_sch)
                logical_query += " ORDER BY c.table_schema, c.table_name, c.column_name;"

                cur.execute(logical_query, logical_params)
                logical_rows = cur.fetchall()

                for log_row in logical_rows:
                    c_schema, child_tbl, fk_col, d_type = log_row
                    if (
                        c_schema.lower() == schema.lower()
                        and child_tbl.lower() == parent_table.lower()
                        and fk_col.lower() == pk_col.lower()
                    ):
                        continue

                    key = (c_schema.lower(), child_tbl.lower(), fk_col.lower())
                    if key in discovered_keys:
                        continue

                    discovered_keys.add(key)
                    related_tables.append(
                        DiscoveredRelatedTable(
                            child_schema=c_schema,
                            child_table=child_tbl,
                            foreign_key_column=fk_col,
                            parent_schema=schema,
                            parent_table=parent_table,
                            parent_primary_key=pk_col,
                            constraint_name="Column Pattern Match",
                            match_type="logical_column",
                            data_type=d_type or "text",
                        )
                    )

            return TableDiscoveryResponse(
                success=True,
                parent_schema=schema,
                parent_table=parent_table,
                primary_key_column=pk_col,
                related_tables=related_tables,
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to discover related tables: {str(e)}")
    finally:
        conn.close()


def preview_id_remapping(req: IdRemapPreviewRequest) -> IdRemapPreviewResponse:
    conn_info = req.connection
    default_schema = req.parent_schema or conn_info.schema_name or "public"
    target_schemas_list = req.target_schemas or []
    conflict_mode = (req.conflict_mode or "swap").lower()

    raw_mappings = []
    is_auto_displace = (conflict_mode == "auto_displace")
    if req.mappings or req.old_id or req.new_id:
        try:
            raw_mappings = extract_and_validate_mappings(
                req.mappings, req.old_id, req.new_id, is_auto_displace=is_auto_displace
            )
        except Exception:
            raw_mappings = []

    try:
        conn = get_pg_connection(conn_info)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Database connection failed: {str(e)}")

    try:
        with conn.cursor() as cur:
            # 1. Discover Primary Key and exact schema of Parent Table
            schema, parent_table, pk_col, pk_type = resolve_parent_table_and_schema(
                cur, req.parent_table, default_schema
            )
            is_pk_num = pk_type.lower() in (
                "integer", "bigint", "smallint", "int", "int4", "int8", "int2", "numeric"
            )

            # 2. Check existence of Old IDs and determine swap/remap/displace status
            processed_mappings = []
            all_source_ids = set()
            all_swap_new_ids = set()
            total_displaces = 0
            total_swaps = 0

            if is_auto_displace:
                # In auto_displace mode, old_id is changed to next available unused ID (Max + 1)
                in_flight_allocated = set()
                for step_idx, (old_id, _) in enumerate(raw_mappings):
                    cur.execute(
                        f'SELECT COUNT(*) FROM "{schema}"."{parent_table}" WHERE "{pk_col}"::text = %s',
                        (str(old_id),),
                    )
                    if cur.fetchone()[0] == 0:
                        return IdRemapPreviewResponse(
                            success=False,
                            parent_schema=schema,
                            parent_table=parent_table,
                            primary_key_column=pk_col,
                            old_id=old_id,
                            new_id="",
                            is_swap=False,
                            operation_type="auto_displace",
                            conflict_mode=conflict_mode,
                            parent_rows_old=0,
                            parent_rows_new=0,
                            parent_row_exists=False,
                            new_id_exists=False,
                            conflict_message=f"Existing ID '{old_id}' does not exist in table '{schema}.{parent_table}'.",
                            related_tables=[],
                            total_affected_records=0,
                            mappings=[],
                            total_mappings_count=len(raw_mappings),
                            total_swaps_count=0,
                            total_remaps_count=0,
                            total_displaces_count=0,
                        )

                    auto_new_id = get_next_available_id(
                        cur, schema, parent_table, pk_col, pk_type, offset=step_idx, excluded_ids=in_flight_allocated
                    )
                    in_flight_allocated.add(auto_new_id)
                    total_displaces += 1

                    processed_mappings.append(
                        IdMappingItem(
                            old_id=old_id,
                            new_id=auto_new_id,
                            is_swap=False,
                            is_displace=True,
                            displaced_new_id=auto_new_id,
                            parent_rows_old=1,
                            parent_rows_new=0,
                        )
                    )
                    all_source_ids.add(old_id)

            elif conflict_mode == "child_only":
                # In child_only mode, new_id MUST exist in parent table to maintain referential integrity
                all_new_ids = [m[1] for m in raw_mappings if m[1]]
                cur.execute(
                    f'SELECT "{pk_col}"::text FROM "{schema}"."{parent_table}" WHERE "{pk_col}"::text = ANY(%s)',
                    (all_new_ids,),
                )
                existing_parent_new_ids = set(row[0] for row in cur.fetchall())

                for step_idx, (old_id, new_id) in enumerate(raw_mappings):
                    if new_id not in existing_parent_new_ids:
                        return IdRemapPreviewResponse(
                            success=False,
                            parent_schema=schema,
                            parent_table=parent_table,
                            primary_key_column=pk_col,
                            old_id=old_id,
                            new_id=new_id,
                            is_swap=False,
                            operation_type="child_only",
                            conflict_mode=conflict_mode,
                            parent_rows_old=0,
                            parent_rows_new=0,
                            parent_row_exists=False,
                            new_id_exists=False,
                            conflict_message=f"Step #{step_idx + 1}: New Foreign Key ID '{new_id}' does not exist in parent table '{schema}.{parent_table}'. Please enter an ID that exists in '{parent_table}'.",
                            related_tables=[],
                            total_affected_records=0,
                            mappings=[],
                            total_mappings_count=len(raw_mappings),
                            total_swaps_count=0,
                            total_remaps_count=0,
                            total_displaces_count=0,
                        )

                    processed_mappings.append(
                        IdMappingItem(
                            old_id=old_id,
                            new_id=new_id,
                            is_swap=False,
                            is_displace=False,
                            parent_rows_old=0,
                            parent_rows_new=1,
                        )
                    )
                    all_source_ids.add(old_id)
                    all_source_ids.add(new_id)

            else:
                all_mentioned_ids = list(set([m[0] for m in raw_mappings] + [m[1] for m in raw_mappings]))
                cur.execute(
                    f'SELECT "{pk_col}"::text FROM "{schema}"."{parent_table}" WHERE "{pk_col}"::text = ANY(%s)',
                    (all_mentioned_ids,),
                )
                simulated_existing_ids = set(row[0] for row in cur.fetchall())

                for step_idx, (old_id, new_id) in enumerate(raw_mappings):
                    if old_id not in simulated_existing_ids:
                        return IdRemapPreviewResponse(
                            success=False,
                            parent_schema=schema,
                            parent_table=parent_table,
                            primary_key_column=pk_col,
                            old_id=raw_mappings[0][0],
                            new_id=raw_mappings[0][1],
                            is_swap=False,
                            operation_type="remap",
                            conflict_mode=conflict_mode,
                            parent_rows_old=0,
                            parent_rows_new=0,
                            parent_row_exists=False,
                            new_id_exists=False,
                            conflict_message=f"Step #{step_idx + 1}: Old ID '{old_id}' does not exist in table '{schema}.{parent_table}'.",
                            related_tables=[],
                            total_affected_records=0,
                            mappings=[],
                            total_mappings_count=len(raw_mappings),
                            total_swaps_count=0,
                            total_remaps_count=0,
                            total_displaces_count=0,
                        )

                    is_swap = new_id in simulated_existing_ids
                    if is_swap:
                        total_swaps += 1
                    else:
                        simulated_existing_ids.remove(old_id)
                        simulated_existing_ids.add(new_id)

                    processed_mappings.append(
                        IdMappingItem(
                            old_id=old_id,
                            new_id=new_id,
                            is_swap=is_swap,
                            parent_rows_old=1,
                            parent_rows_new=1 if is_swap else 0,
                        )
                    )

                    all_source_ids.add(old_id)
                    all_source_ids.add(new_id)
                    if is_swap:
                        all_swap_new_ids.add(new_id)

            total_parent_affected = 0 if conflict_mode == "child_only" else len(all_source_ids)
            all_source_ids_list = list(all_source_ids)
            all_swap_new_ids_list = list(all_swap_new_ids)

            base_p_tbl = parent_table.lower()
            for prefix in ("v_", "t_", "tbl_", "m_", "tb_", "view_"):
                if base_p_tbl.startswith(prefix):
                    base_p_tbl = base_p_tbl[len(prefix):]
                    break

            # 3. Discover Formal SQL Foreign Key Constraints
            fk_query = """
                SELECT
                    src_ns.nspname AS child_schema,
                    src_cls.relname AS child_table,
                    src_att.attname AS foreign_key_column,
                    ref_ns.nspname AS parent_schema,
                    ref_cls.relname AS parent_table,
                    ref_att.attname AS parent_primary_key,
                    c.conname AS constraint_name,
                    src_typ.typname AS data_type
                FROM pg_constraint c
                JOIN pg_class src_cls ON src_cls.oid = c.conrelid
                JOIN pg_namespace src_ns ON src_ns.oid = src_cls.relnamespace
                JOIN pg_attribute src_att ON src_att.attrelid = src_cls.oid AND src_att.attnum = ANY(c.conkey)
                JOIN pg_type src_typ ON src_att.atttypid = src_typ.oid
                JOIN pg_class ref_cls ON ref_cls.oid = c.confrelid
                JOIN pg_namespace ref_ns ON ref_ns.oid = ref_cls.relnamespace
                JOIN pg_attribute ref_att ON ref_att.attrelid = ref_cls.oid AND ref_att.attnum = ANY(c.confkey)
                WHERE c.contype = 'f'
                  AND (LOWER(ref_cls.relname) = LOWER(%s) OR LOWER(ref_cls.relname) = LOWER(%s))
            """
            fk_params = [parent_table, base_p_tbl]

            if target_schemas_list:
                fk_query += " AND LOWER(src_ns.nspname) = ANY(%s)"
                fk_params.append([s.lower() for s in target_schemas_list])
            fk_query += " ORDER BY src_ns.nspname, src_cls.relname, src_att.attname;"

            cur.execute(fk_query, fk_params)
            fk_rows = cur.fetchall()

            discovered_keys = set()
            candidate_fks = []

            for row in fk_rows:
                c_schema, child_tbl, fk_col, p_schema, p_tbl, p_pk, c_name, d_type = row
                key = (c_schema.lower(), child_tbl.lower(), fk_col.lower())
                discovered_keys.add(key)
                candidate_fks.append((c_schema, child_tbl, fk_col, p_schema, p_tbl, p_pk, c_name, d_type))

            # 4. Discover Logical / Column Name References
            candidate_cols = list(get_candidate_fk_column_names(parent_table, pk_col))
            candidate_logical = []
            if candidate_cols:
                logical_query = """
                    SELECT
                        c.table_schema AS child_schema,
                        c.table_name AS child_table,
                        c.column_name AS foreign_key_column,
                        c.data_type AS data_type
                    FROM information_schema.columns c
                    WHERE c.table_schema NOT IN ('information_schema', 'pg_catalog')
                      AND c.table_schema NOT LIKE 'pg_toast%%'
                      AND (
                          LOWER(c.column_name) = ANY(%s)
                          OR LOWER(c.column_name) LIKE %s
                          OR LOWER(c.column_name) LIKE %s
                          OR LOWER(c.column_name) LIKE %s
                          OR LOWER(c.column_name) LIKE %s
                          OR LOWER(c.column_name) LIKE %s
                          OR LOWER(c.column_name) LIKE %s
                          OR LOWER(c.column_name) LIKE %s
                      )
                """
                logical_params = [
                    candidate_cols,
                    f"%_{base_p_tbl}_id%",
                    f"%{base_p_tbl}_id%",
                    f"%_{base_p_tbl}%",
                    f"%{base_p_tbl}%",
                    f"%_{pk_col.lower()}%",
                    f"%{pk_col.lower()}%",
                    f"{base_p_tbl}_%",
                ]
                if target_schemas_list:
                    logical_query += " AND LOWER(TRIM(c.table_schema)) = ANY(%s)"
                    logical_params.append([s.lower().strip() for s in target_schemas_list])
                logical_query += " ORDER BY c.table_schema, c.table_name, c.column_name;"

                cur.execute(logical_query, logical_params)
                logical_rows = cur.fetchall()

                for log_row in logical_rows:
                    c_schema, child_tbl, fk_col, d_type = log_row
                    if (
                        c_schema.lower() == schema.lower()
                        and child_tbl.lower() == parent_table.lower()
                        and fk_col.lower() == pk_col.lower()
                    ):
                        continue

                    key = (c_schema.lower(), child_tbl.lower(), fk_col.lower())
                    if key in discovered_keys:
                        continue

                    discovered_keys.add(key)
                    candidate_logical.append((c_schema, child_tbl, fk_col, d_type))

            # If specific child tables were selected, only count and inspect those
            if req.selected_child_tables and len(req.selected_child_tables) > 0:
                selected_set = set(
                    (t.child_schema.lower(), t.child_table.lower(), t.foreign_key_column.lower())
                    for t in req.selected_child_tables
                )
                candidate_fks = [
                    f for f in candidate_fks
                    if (f[0].lower(), f[1].lower(), f[2].lower()) in selected_set
                ]
                candidate_logical = [
                    l for l in candidate_logical
                    if (l[0].lower(), l[1].lower(), l[2].lower()) in selected_set
                ]

            # 5. Fast Batch Counting for all discovered referencing tables using native type index scans
            all_candidate_triplets = [
                (f[0], f[1], f[2], f[7]) for f in candidate_fks
            ] + candidate_logical

            count_results = batch_count_child_references(
                cur, all_candidate_triplets, all_source_ids_list, all_swap_new_ids_list
            )

            related_tables = []
            total_child_records = 0

            # Build Formal FK results
            for row in candidate_fks:
                c_schema, child_tbl, fk_col, p_schema, p_tbl, p_pk, c_name, d_type = row
                c_key = (c_schema.lower(), child_tbl.lower(), fk_col.lower())
                count_old, count_new = count_results.get(c_key, (0, 0))
                affected_for_table = count_old + count_new
                total_child_records += affected_for_table

                related_tables.append(
                    RelatedTableInfo(
                        child_schema=c_schema,
                        child_table=child_tbl,
                        foreign_key_column=fk_col,
                        parent_schema=p_schema,
                        parent_table=p_tbl,
                        parent_primary_key=p_pk or pk_col,
                        constraint_name=c_name or "SQL Foreign Key Constraint",
                        match_type="foreign_key",
                        records_count_old=count_old,
                        records_count_new=count_new,
                        affected_rows_count=affected_for_table,
                        selected=True,
                    )
                )

            # Build Logical Match results
            for row in candidate_logical:
                c_schema, child_tbl, fk_col, d_type = row
                c_key = (c_schema.lower(), child_tbl.lower(), fk_col.lower())
                count_old, count_new = count_results.get(c_key, (0, 0))
                affected_for_table = count_old + count_new
                total_child_records += affected_for_table

                related_tables.append(
                    RelatedTableInfo(
                        child_schema=c_schema,
                        child_table=child_tbl,
                        foreign_key_column=fk_col,
                        parent_schema=schema,
                        parent_table=parent_table,
                        parent_primary_key=pk_col,
                        constraint_name=f"Logical Column Match ({fk_col})",
                        match_type="logical_column",
                        records_count_old=count_old,
                        records_count_new=count_new,
                        affected_rows_count=affected_for_table,
                        selected=True,
                    )
                )

            total_swaps = sum(1 for m in processed_mappings if m.is_swap)
            total_displaces = sum(1 for m in processed_mappings if m.is_displace)
            total_remaps = len(processed_mappings) - total_swaps - total_displaces
            is_overall_swap = total_swaps > 0

            if not processed_mappings:
                op_type = "discovery"
            elif conflict_mode == "child_only":
                op_type = "child_only"
            elif len(processed_mappings) == 1:
                if total_displaces > 0:
                    op_type = "auto_displace"
                elif is_overall_swap:
                    op_type = "swap"
                else:
                    op_type = "remap"
            else:
                if total_displaces > 0:
                    op_type = "sequential_displace"
                elif total_swaps > 0:
                    op_type = "sequential_swap"
                else:
                    op_type = "sequential_remap"

            first_m = processed_mappings[0] if processed_mappings else None

            return IdRemapPreviewResponse(
                success=True,
                parent_schema=schema,
                parent_table=parent_table,
                primary_key_column=pk_col,
                old_id=first_m.old_id if first_m else "",
                new_id=first_m.new_id if first_m else "",
                is_swap=is_overall_swap,
                operation_type=op_type if processed_mappings else "discovery",
                conflict_mode=conflict_mode,
                parent_rows_old=first_m.parent_rows_old if first_m else 0,
                parent_rows_new=first_m.parent_rows_new if first_m else 0,
                parent_row_exists=True,
                new_id_exists=(first_m.is_swap or first_m.is_displace) if first_m else False,
                conflict_message=None,
                related_tables=related_tables,
                total_affected_records=total_parent_affected + total_child_records,
                mappings=processed_mappings,
                total_mappings_count=len(processed_mappings),
                total_swaps_count=total_swaps,
                total_remaps_count=total_remaps,
                total_displaces_count=total_displaces,
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Preview failed: {str(e)}")
    finally:
        conn.close()


def execute_id_remapping(req: IdRemapExecuteRequest) -> IdRemapExecuteResponse:
    conn_info = req.connection
    default_schema = conn_info.schema_name or "public"
    schema = req.parent_schema or default_schema
    parsed_schema, parent_table = parse_schema_and_table(req.parent_table, schema)
    schema = parsed_schema
    pk_col = req.primary_key_column.strip() if req.primary_key_column else ""
    selected_children = req.selected_child_tables
    conflict_mode = (req.conflict_mode or "swap").lower()
    is_auto_displace = (conflict_mode == "auto_displace")

    raw_mappings = extract_and_validate_mappings(
        req.mappings, req.old_id, req.new_id, require_mappings=True, is_auto_displace=is_auto_displace
    )

    try:
        conn = get_pg_connection(conn_info)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Database connection failed: {str(e)}")

    updated_child_results = []
    timestamp_str = datetime.now().isoformat()
    processed_mappings = []

    try:
        # Execute EVERYTHING in a single atomic database transaction
        with conn.transaction():
            with conn.cursor() as cur:
                real_schema, real_parent_table, pk_name, pk_type = resolve_parent_table_and_schema(
                    cur, req.parent_table, schema
                )
                schema = real_schema or schema
                parent_table = real_parent_table or parent_table
                pk_col = pk_name or pk_col or "id"

                # 1. Lock all initially involved rows in parent table
                all_initial_ids = list(set([m[0] for m in raw_mappings] + [m[1] for m in raw_mappings if m[1]]))
                cur.execute(
                    f'SELECT "{pk_col}"::text FROM "{schema}"."{parent_table}" WHERE "{pk_col}"::text = ANY(%s) FOR UPDATE',
                    (all_initial_ids,),
                )

                # 2. Defer constraints if supported
                try:
                    cur.execute("SET CONSTRAINTS ALL DEFERRED;")
                except Exception:
                    pass

                # 3. Use transaction-local session_replication_role for atomic multi-table safety if permitted
                try:
                    cur.execute("SET LOCAL session_replication_role = 'replica';")
                except Exception:
                    pass

                # 4. Execute operation
                if is_auto_displace:
                    in_flight_allocated_ids = set()
                    unique_parent_rows_touched = set()
                    all_final_ids = []

                    for step_idx, (old_id, _) in enumerate(raw_mappings):
                        cur.execute(
                            f'SELECT COUNT(*) FROM "{schema}"."{parent_table}" WHERE "{pk_col}"::text = %s',
                            (str(old_id),),
                        )
                        if cur.fetchone()[0] == 0:
                            raise Exception(
                                f"Row with ID '{old_id}' was not found in table '{schema}.{parent_table}'. Transaction aborted."
                            )

                        auto_new_id = get_next_available_id(
                            cur, schema, parent_table, pk_col, pk_type, offset=step_idx, excluded_ids=in_flight_allocated_ids
                        )
                        in_flight_allocated_ids.add(auto_new_id)

                        # Update child tables
                        for child in selected_children:
                            c_sch = child.child_schema or "public"
                            cur.execute(
                                f'UPDATE "{c_sch}"."{child.child_table}" SET "{child.foreign_key_column}" = %s WHERE "{child.foreign_key_column}"::text = %s',
                                (auto_new_id, str(old_id)),
                            )

                        # Update parent table
                        cur.execute(
                            f'UPDATE "{schema}"."{parent_table}" SET "{pk_col}" = %s WHERE "{pk_col}"::text = %s',
                            (auto_new_id, str(old_id)),
                        )

                        unique_parent_rows_touched.add(str(old_id))
                        unique_parent_rows_touched.add(str(auto_new_id))
                        all_final_ids.append(auto_new_id)

                        processed_mappings.append(
                            IdMappingItem(
                                old_id=str(old_id),
                                new_id=str(auto_new_id),
                                is_swap=False,
                                is_displace=True,
                                displaced_new_id=str(auto_new_id),
                            )
                        )

                    # Count updated rows in selected child tables
                    for child in selected_children:
                        c_sch = child.child_schema or "public"
                        try:
                            cur.execute(
                                f'SELECT COUNT(*) FROM "{c_sch}"."{child.child_table}" WHERE "{child.foreign_key_column}"::text = ANY(%s)',
                                (all_final_ids,),
                            )
                            child_count = cur.fetchone()[0]
                        except Exception:
                            child_count = 0

                        updated_child_results.append(
                            UpdatedChildResult(
                                child_schema=c_sch,
                                child_table=child.child_table,
                                foreign_key_column=child.foreign_key_column,
                                updated_rows=child_count,
                            )
                        )

                    # Reset session replication role
                    try:
                        cur.execute("SET LOCAL session_replication_role = 'origin';")
                    except Exception:
                        pass

                    first_m = processed_mappings[0]
                    success_msg = f"Successfully changed ID from {first_m.old_id} to auto-generated ID {first_m.new_id} in {schema}.{parent_table} and {len(updated_child_results)} related tables."
                    op_id = str(uuid.uuid4())
                    _operation_history.append({
                        "operation_id": op_id,
                        "timestamp": timestamp_str,
                        "parent_schema": schema,
                        "parent_table": parent_table,
                        "primary_key_column": pk_col,
                        "operation_type": "auto_displace",
                        "conflict_mode": "auto_displace",
                        "mappings": processed_mappings,
                        "selected_child_tables": selected_children,
                        "message": success_msg,
                        "is_reverted": False,
                    })

                    return IdRemapExecuteResponse(
                        success=True,
                        is_swap=False,
                        operation_type="auto_displace",
                        conflict_mode="auto_displace",
                        message=success_msg,
                        parent_schema=schema,
                        parent_table=parent_table,
                        old_id=first_m.old_id,
                        new_id=first_m.new_id,
                        mappings=processed_mappings,
                        updated_parent_rows=len(processed_mappings),
                        displaced_rows_count=len(processed_mappings),
                        updated_child_tables=updated_child_results,
                        timestamp=timestamp_str,
                        operation_id=op_id,
                    )

                elif conflict_mode == "child_only":
                    all_final_ids = []
                    for step_idx, (old_id, new_id) in enumerate(raw_mappings):
                        # Verify that new_id exists in parent table
                        cur.execute(
                            f'SELECT COUNT(*) FROM "{schema}"."{parent_table}" WHERE "{pk_col}"::text = %s',
                            (str(new_id),),
                        )
                        if cur.fetchone()[0] == 0:
                            raise Exception(
                                f"Step #{step_idx + 1}: New Foreign Key ID '{new_id}' was not found in parent table '{schema}.{parent_table}'. Transaction aborted."
                            )

                        for child in selected_children:
                            c_sch = child.child_schema or "public"
                            cur.execute(
                                f'UPDATE "{c_sch}"."{child.child_table}" SET "{child.foreign_key_column}" = %s WHERE "{child.foreign_key_column}"::text = %s',
                                (str(new_id), str(old_id)),
                            )

                        all_final_ids.append(str(new_id))
                        processed_mappings.append(
                            IdMappingItem(
                                old_id=str(old_id),
                                new_id=str(new_id),
                                is_swap=False,
                                is_displace=False,
                                parent_rows_old=0,
                                parent_rows_new=1,
                            )
                        )

                    # Count updated rows in selected child tables
                    for child in selected_children:
                        c_sch = child.child_schema or "public"
                        try:
                            cur.execute(
                                f'SELECT COUNT(*) FROM "{c_sch}"."{child.child_table}" WHERE "{child.foreign_key_column}"::text = ANY(%s)',
                                (all_final_ids,),
                            )
                            child_count = cur.fetchone()[0]
                        except Exception:
                            child_count = 0

                        updated_child_results.append(
                            UpdatedChildResult(
                                child_schema=c_sch,
                                child_table=child.child_table,
                                foreign_key_column=child.foreign_key_column,
                                updated_rows=child_count,
                            )
                        )

                    # Reset session replication role
                    try:
                        cur.execute("SET LOCAL session_replication_role = 'origin';")
                    except Exception:
                        pass

                    first_m = processed_mappings[0]
                    success_msg = f"Successfully updated foreign key IDs from {first_m.old_id} to {first_m.new_id} in {len(updated_child_results)} related tables (Parent table '{schema}.{parent_table}' was not modified)."
                    op_id = str(uuid.uuid4())
                    _operation_history.append({
                        "operation_id": op_id,
                        "timestamp": timestamp_str,
                        "parent_schema": schema,
                        "parent_table": parent_table,
                        "primary_key_column": pk_col,
                        "operation_type": "child_only",
                        "conflict_mode": "child_only",
                        "mappings": processed_mappings,
                        "selected_child_tables": selected_children,
                        "message": success_msg,
                        "is_reverted": False,
                    })

                    return IdRemapExecuteResponse(
                        success=True,
                        is_swap=False,
                        operation_type="child_only",
                        conflict_mode="child_only",
                        message=success_msg,
                        parent_schema=schema,
                        parent_table=parent_table,
                        old_id=first_m.old_id,
                        new_id=first_m.new_id,
                        mappings=processed_mappings,
                        updated_parent_rows=0,
                        displaced_rows_count=0,
                        updated_child_tables=updated_child_results,
                        timestamp=timestamp_str,
                        operation_id=op_id,
                    )

                else:
                    # Standard sequential swap / remap execution
                    total_swaps = 0
                    total_displaces = 0
                    displaced_details = []
                    unique_parent_rows_touched = set()

                    for step_idx, (old_id, new_id) in enumerate(raw_mappings):
                        cur.execute(
                            f'SELECT COUNT(*) FROM "{schema}"."{parent_table}" WHERE "{pk_col}"::text = %s',
                            (str(old_id),),
                        )
                        if cur.fetchone()[0] == 0:
                            raise Exception(
                                f"Step #{step_idx + 1}: Row with ID '{old_id}' was not found in table '{schema}.{parent_table}'. Transaction aborted."
                            )

                        cur.execute(
                            f'SELECT COUNT(*) FROM "{schema}"."{parent_table}" WHERE "{pk_col}"::text = %s',
                            (str(new_id),),
                        )
                        is_swap = cur.fetchone()[0] > 0

                        if is_swap:
                            total_swaps += 1
                            temp_id = get_unused_temp_ids(cur, schema, parent_table, pk_col, pk_type, 1)[0]

                            # Phase a: old_id -> temp_id
                            for child in selected_children:
                                c_sch = child.child_schema or "public"
                                cur.execute(
                                    f'UPDATE "{c_sch}"."{child.child_table}" SET "{child.foreign_key_column}" = %s WHERE "{child.foreign_key_column}"::text = %s',
                                    (temp_id, str(old_id)),
                                )
                            cur.execute(
                                f'UPDATE "{schema}"."{parent_table}" SET "{pk_col}" = %s WHERE "{pk_col}"::text = %s',
                                (temp_id, str(old_id)),
                            )

                            # Phase b: new_id -> old_id
                            for child in selected_children:
                                c_sch = child.child_schema or "public"
                                cur.execute(
                                    f'UPDATE "{c_sch}"."{child.child_table}" SET "{child.foreign_key_column}" = %s WHERE "{child.foreign_key_column}"::text = %s',
                                    (str(old_id), str(new_id)),
                                )
                            cur.execute(
                                f'UPDATE "{schema}"."{parent_table}" SET "{pk_col}" = %s WHERE "{pk_col}"::text = %s',
                                (str(old_id), str(new_id)),
                            )

                            # Phase c: temp_id -> new_id
                            for child in selected_children:
                                c_sch = child.child_schema or "public"
                                cur.execute(
                                    f'UPDATE "{c_sch}"."{child.child_table}" SET "{child.foreign_key_column}" = %s WHERE "{child.foreign_key_column}"::text = %s',
                                    (str(new_id), temp_id),
                                )
                            cur.execute(
                                f'UPDATE "{schema}"."{parent_table}" SET "{pk_col}" = %s WHERE "{pk_col}"::text = %s',
                                (str(new_id), temp_id),
                            )
                        else:
                            # Direct remap
                            for child in selected_children:
                                c_sch = child.child_schema or "public"
                                cur.execute(
                                    f'UPDATE "{c_sch}"."{child.child_table}" SET "{child.foreign_key_column}" = %s WHERE "{child.foreign_key_column}"::text = %s',
                                    (str(new_id), str(old_id)),
                                )
                            cur.execute(
                                f'UPDATE "{schema}"."{parent_table}" SET "{pk_col}" = %s WHERE "{pk_col}"::text = %s',
                                (str(new_id), str(old_id)),
                            )

                        unique_parent_rows_touched.add(str(old_id))
                        unique_parent_rows_touched.add(str(new_id))

                        processed_mappings.append(
                            IdMappingItem(
                                old_id=old_id,
                                new_id=new_id,
                                is_swap=is_swap,
                                is_displace=False,
                            )
                        )

                    # Count total updated rows for each selected child table
                    all_touched_ids = list(unique_parent_rows_touched)
                    for child in selected_children:
                        c_sch = child.child_schema or "public"
                        try:
                            cur.execute(
                                f'SELECT COUNT(*) FROM "{c_sch}"."{child.child_table}" WHERE "{child.foreign_key_column}"::text = ANY(%s)',
                                (all_touched_ids,),
                            )
                            child_count = cur.fetchone()[0]
                        except Exception:
                            child_count = 0

                        updated_child_results.append(
                            UpdatedChildResult(
                                child_schema=c_sch,
                                child_table=child.child_table,
                                foreign_key_column=child.foreign_key_column,
                                updated_rows=child_count,
                            )
                        )

                    # Reset session replication role
                    try:
                        cur.execute("SET LOCAL session_replication_role = 'origin';")
                    except Exception:
                        pass

    except HTTPException:
        raise
    except Exception as e:
        # Any failure automatically rolls back the entire transaction via with conn.transaction()
        raise HTTPException(
            status_code=400,
            detail=f"ID operation failed and was rolled back completely: {str(e)}",
        )
    finally:
        conn.close()

    is_overall_swap = total_swaps > 0
    first_m = raw_mappings[0]
    if len(raw_mappings) == 1:
        first_old, first_new = raw_mappings[0]
        if total_displaces > 0:
            first_disp = processed_mappings[0].displaced_new_id
            success_msg = f"Successfully remapped ID from {first_old} to {first_new} and auto-displaced existing row {first_new} to new ID {first_disp} in {schema}.{parent_table} ({len(unique_parent_rows_touched)} parent rows) and {len(updated_child_results)} related tables."
            op_type = "auto_displace"
        elif is_overall_swap:
            success_msg = f"Successfully swapped IDs {first_old} ↔ {first_new} in {schema}.{parent_table} ({len(unique_parent_rows_touched)} rows) and {len(updated_child_results)} related tables."
            op_type = "swap"
        else:
            success_msg = f"Successfully remapped ID from {first_old} to {first_new} in {schema}.{parent_table} ({len(unique_parent_rows_touched)} rows) and {len(updated_child_results)} related tables."
            op_type = "remap"
    else:
        displace_note = f" (Auto-displaced: {', '.join(displaced_details)})" if displaced_details else ""
        if total_displaces > 0:
            op_type = "sequential_displace"
        elif total_swaps > 0:
            op_type = "sequential_swap"
        else:
            op_type = "sequential_remap"
        success_msg = f"Successfully executed {len(raw_mappings)} sequential ID steps in {schema}.{parent_table}{displace_note} ({len(unique_parent_rows_touched)} parent row(s) updated) and {len(updated_child_results)} related tables."

    op_id = str(uuid.uuid4())
    _operation_history.append({
        "operation_id": op_id,
        "timestamp": timestamp_str,
        "parent_schema": schema,
        "parent_table": parent_table,
        "primary_key_column": pk_col,
        "operation_type": op_type,
        "conflict_mode": conflict_mode,
        "mappings": processed_mappings,
        "selected_child_tables": selected_children,
        "message": success_msg,
        "is_reverted": False,
    })

    return IdRemapExecuteResponse(
        success=True,
        is_swap=is_overall_swap,
        operation_type=op_type,
        conflict_mode=conflict_mode,
        message=success_msg,
        parent_schema=schema,
        parent_table=parent_table,
        old_id=first_m[0],
        new_id=first_m[1],
        mappings=processed_mappings,
        updated_parent_rows=len(unique_parent_rows_touched),
        displaced_rows_count=total_displaces,
        updated_child_tables=updated_child_results,
        timestamp=timestamp_str,
        operation_id=op_id,
    )


def revert_last_id_remapping(req: IdRemapRevertRequest) -> IdRemapExecuteResponse:
    global _operation_history
    if not _operation_history:
        raise HTTPException(status_code=400, detail="No operation history available to revert.")

    # Find the target operation to revert
    target_op = None
    target_index = -1
    if req.operation_id:
        for idx in range(len(_operation_history) - 1, -1, -1):
            if _operation_history[idx]["operation_id"] == req.operation_id and not _operation_history[idx].get("is_reverted", False):
                target_op = _operation_history[idx]
                target_index = idx
                break
    else:
        for idx in range(len(_operation_history) - 1, -1, -1):
            if not _operation_history[idx].get("is_reverted", False):
                target_op = _operation_history[idx]
                target_index = idx
                break

    if not target_op:
        raise HTTPException(
            status_code=400,
            detail="No revertible operation found. The last operation may have already been reverted."
        )

    conn_info = req.connection
    schema = target_op["parent_schema"]
    parent_table = target_op["parent_table"]
    pk_col = target_op["primary_key_column"]
    conflict_mode = target_op["conflict_mode"]
    mappings = target_op["mappings"]
    selected_children = target_op["selected_child_tables"]
    timestamp_str = datetime.now().isoformat()

    try:
        conn = get_pg_connection(conn_info)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Database connection failed: {str(e)}")

    updated_child_results = []
    reverted_mappings = []

    try:
        with conn.transaction():
            with conn.cursor() as cur:
                real_schema, real_parent_table, pk_name, pk_type = resolve_parent_table_and_schema(
                    cur, parent_table, schema
                )
                schema = real_schema or schema
                parent_table = real_parent_table or parent_table
                pk_col = pk_name or pk_col or "id"

                try:
                    cur.execute("SET CONSTRAINTS ALL DEFERRED;")
                except Exception:
                    pass
                try:
                    cur.execute("SET LOCAL session_replication_role = 'replica';")
                except Exception:
                    pass

                # Revert in reverse order of execution
                rev_mappings = list(reversed(mappings))
                all_restored_ids = []

                if conflict_mode == "child_only":
                    for m in rev_mappings:
                        orig_old = m.old_id if hasattr(m, "old_id") else m["old_id"]
                        orig_new = m.new_id if hasattr(m, "new_id") else m["new_id"]

                        for child in selected_children:
                            c_sch = child.child_schema if hasattr(child, "child_schema") else child.get("child_schema", "public")
                            c_tbl = child.child_table if hasattr(child, "child_table") else child["child_table"]
                            c_fk = child.foreign_key_column if hasattr(child, "foreign_key_column") else child["foreign_key_column"]
                            cur.execute(
                                f'UPDATE "{c_sch}"."{c_tbl}" SET "{c_fk}" = %s WHERE "{c_fk}"::text = %s',
                                (str(orig_old), str(orig_new)),
                            )

                        all_restored_ids.append(str(orig_old))
                        reverted_mappings.append(
                            IdMappingItem(
                                old_id=str(orig_new),
                                new_id=str(orig_old),
                                is_swap=False,
                                is_displace=False,
                                parent_rows_old=0,
                                parent_rows_new=0,
                            )
                        )

                    for child in selected_children:
                        c_sch = child.child_schema if hasattr(child, "child_schema") else child.get("child_schema", "public")
                        c_tbl = child.child_table if hasattr(child, "child_table") else child["child_table"]
                        c_fk = child.foreign_key_column if hasattr(child, "foreign_key_column") else child["foreign_key_column"]
                        try:
                            cur.execute(
                                f'SELECT COUNT(*) FROM "{c_sch}"."{c_tbl}" WHERE "{c_fk}"::text = ANY(%s)',
                                (all_restored_ids,),
                            )
                            child_count = cur.fetchone()[0]
                        except Exception:
                            child_count = 0

                        updated_child_results.append(
                            UpdatedChildResult(
                                child_schema=c_sch,
                                child_table=c_tbl,
                                foreign_key_column=c_fk,
                                updated_rows=child_count,
                            )
                        )

                    success_msg = f"Successfully reverted ID changes in {len(updated_child_results)} related tables (Restored foreign keys to original IDs). Parent table was untouched."

                elif conflict_mode == "auto_displace":
                    for m in rev_mappings:
                        orig_old = m.old_id if hasattr(m, "old_id") else m["old_id"]
                        displaced_new = m.new_id if hasattr(m, "new_id") else m["new_id"]

                        # Revert child tables
                        for child in selected_children:
                            c_sch = child.child_schema if hasattr(child, "child_schema") else child.get("child_schema", "public")
                            c_tbl = child.child_table if hasattr(child, "child_table") else child["child_table"]
                            c_fk = child.foreign_key_column if hasattr(child, "foreign_key_column") else child["foreign_key_column"]
                            cur.execute(
                                f'UPDATE "{c_sch}"."{c_tbl}" SET "{c_fk}" = %s WHERE "{c_fk}"::text = %s',
                                (str(orig_old), str(displaced_new)),
                            )

                        # Revert parent table
                        cur.execute(
                            f'UPDATE "{schema}"."{parent_table}" SET "{pk_col}" = %s WHERE "{pk_col}"::text = %s',
                            (str(orig_old), str(displaced_new)),
                        )

                        all_restored_ids.append(str(orig_old))
                        reverted_mappings.append(
                            IdMappingItem(
                                old_id=str(displaced_new),
                                new_id=str(orig_old),
                                is_swap=False,
                                is_displace=True,
                                displaced_new_id=str(orig_old),
                            )
                        )

                    for child in selected_children:
                        c_sch = child.child_schema if hasattr(child, "child_schema") else child.get("child_schema", "public")
                        c_tbl = child.child_table if hasattr(child, "child_table") else child["child_table"]
                        c_fk = child.foreign_key_column if hasattr(child, "foreign_key_column") else child["foreign_key_column"]
                        try:
                            cur.execute(
                                f'SELECT COUNT(*) FROM "{c_sch}"."{c_tbl}" WHERE "{c_fk}"::text = ANY(%s)',
                                (all_restored_ids,),
                            )
                            child_count = cur.fetchone()[0]
                        except Exception:
                            child_count = 0

                        updated_child_results.append(
                            UpdatedChildResult(
                                child_schema=c_sch,
                                child_table=c_tbl,
                                foreign_key_column=c_fk,
                                updated_rows=child_count,
                            )
                        )

                    success_msg = f"Successfully reverted auto-displacement: Restored ID {reverted_mappings[0].old_id} back to original ID {reverted_mappings[0].new_id} in {schema}.{parent_table} and {len(updated_child_results)} related tables."

                else:
                    # Swap / Remap revert
                    for m in rev_mappings:
                        orig_old = m.old_id if hasattr(m, "old_id") else m["old_id"]
                        orig_new = m.new_id if hasattr(m, "new_id") else m["new_id"]
                        is_swap = m.is_swap if hasattr(m, "is_swap") else m.get("is_swap", False)

                        if is_swap:
                            # Swap back: orig_new <-> orig_old using temporary safe ID
                            temp_id = get_unused_temp_ids(cur, schema, parent_table, pk_col, pk_type, 1)[0]
                            for child in selected_children:
                                c_sch = child.child_schema if hasattr(child, "child_schema") else child.get("child_schema", "public")
                                c_tbl = child.child_table if hasattr(child, "child_table") else child["child_table"]
                                c_fk = child.foreign_key_column if hasattr(child, "foreign_key_column") else child["foreign_key_column"]
                                cur.execute(
                                    f'UPDATE "{c_sch}"."{c_tbl}" SET "{c_fk}" = %s WHERE "{c_fk}"::text = %s',
                                    (temp_id, str(orig_new)),
                                )
                            cur.execute(
                                f'UPDATE "{schema}"."{parent_table}" SET "{pk_col}" = %s WHERE "{pk_col}"::text = %s',
                                (temp_id, str(orig_new)),
                            )

                            for child in selected_children:
                                c_sch = child.child_schema if hasattr(child, "child_schema") else child.get("child_schema", "public")
                                c_tbl = child.child_table if hasattr(child, "child_table") else child["child_table"]
                                c_fk = child.foreign_key_column if hasattr(child, "foreign_key_column") else child["foreign_key_column"]
                                cur.execute(
                                    f'UPDATE "{c_sch}"."{c_tbl}" SET "{c_fk}" = %s WHERE "{c_fk}"::text = %s',
                                    (str(orig_new), str(orig_old)),
                                )
                            cur.execute(
                                f'UPDATE "{schema}"."{parent_table}" SET "{pk_col}" = %s WHERE "{pk_col}"::text = %s',
                                (str(orig_new), str(orig_old)),
                            )

                            for child in selected_children:
                                c_sch = child.child_schema if hasattr(child, "child_schema") else child.get("child_schema", "public")
                                c_tbl = child.child_table if hasattr(child, "child_table") else child["child_table"]
                                c_fk = child.foreign_key_column if hasattr(child, "foreign_key_column") else child["foreign_key_column"]
                                cur.execute(
                                    f'UPDATE "{c_sch}"."{c_tbl}" SET "{c_fk}" = %s WHERE "{c_fk}"::text = %s',
                                    (str(orig_old), temp_id),
                                )
                            cur.execute(
                                f'UPDATE "{schema}"."{parent_table}" SET "{pk_col}" = %s WHERE "{pk_col}"::text = %s',
                                (str(orig_old), temp_id),
                            )

                        else:
                            for child in selected_children:
                                c_sch = child.child_schema if hasattr(child, "child_schema") else child.get("child_schema", "public")
                                c_tbl = child.child_table if hasattr(child, "child_table") else child["child_table"]
                                c_fk = child.foreign_key_column if hasattr(child, "foreign_key_column") else child["foreign_key_column"]
                                cur.execute(
                                    f'UPDATE "{c_sch}"."{c_tbl}" SET "{c_fk}" = %s WHERE "{c_fk}"::text = %s',
                                    (str(orig_old), str(orig_new)),
                                )
                            cur.execute(
                                f'UPDATE "{schema}"."{parent_table}" SET "{pk_col}" = %s WHERE "{pk_col}"::text = %s',
                                (str(orig_old), str(orig_new)),
                            )

                        all_restored_ids.append(str(orig_old))
                        all_restored_ids.append(str(orig_new))
                        reverted_mappings.append(
                            IdMappingItem(
                                old_id=str(orig_new),
                                new_id=str(orig_old),
                                is_swap=is_swap,
                                is_displace=False,
                            )
                        )

                    for child in selected_children:
                        c_sch = child.child_schema if hasattr(child, "child_schema") else child.get("child_schema", "public")
                        c_tbl = child.child_table if hasattr(child, "child_table") else child["child_table"]
                        c_fk = child.foreign_key_column if hasattr(child, "foreign_key_column") else child["foreign_key_column"]
                        try:
                            cur.execute(
                                f'SELECT COUNT(*) FROM "{c_sch}"."{c_tbl}" WHERE "{c_fk}"::text = ANY(%s)',
                                (all_restored_ids,),
                            )
                            child_count = cur.fetchone()[0]
                        except Exception:
                            child_count = 0

                        updated_child_results.append(
                            UpdatedChildResult(
                                child_schema=c_sch,
                                child_table=c_tbl,
                                foreign_key_column=c_fk,
                                updated_rows=child_count,
                            )
                        )

                    success_msg = f"Successfully reverted ID changes: Restored IDs in {schema}.{parent_table} and {len(updated_child_results)} related tables back to original values."

                try:
                    cur.execute("SET LOCAL session_replication_role = 'origin';")
                except Exception:
                    pass

                # Mark as reverted in history
                _operation_history[target_index]["is_reverted"] = True

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Revert operation failed and was rolled back completely: {str(e)}",
        )
    finally:
        conn.close()

    first_rev = reverted_mappings[0] if reverted_mappings else IdMappingItem(old_id="", new_id="")

    return IdRemapExecuteResponse(
        success=True,
        is_swap=False,
        operation_type="revert",
        conflict_mode=conflict_mode,
        message=success_msg,
        parent_schema=schema,
        parent_table=parent_table,
        old_id=first_rev.old_id,
        new_id=first_rev.new_id,
        mappings=reverted_mappings,
        updated_parent_rows=0 if conflict_mode == "child_only" else len(reverted_mappings),
        displaced_rows_count=0,
        updated_child_tables=updated_child_results,
        timestamp=timestamp_str,
        operation_id=target_op["operation_id"],
    )


def get_id_remapping_history(connection_info=None) -> IdRemapHistoryResponse:
    global _operation_history
    history_items = []
    last_revertible = None

    for item in _operation_history:
        h_item = IdRemapHistoryItem(
            operation_id=item["operation_id"],
            timestamp=item["timestamp"],
            parent_schema=item["parent_schema"],
            parent_table=item["parent_table"],
            primary_key_column=item["primary_key_column"],
            operation_type=item["operation_type"],
            conflict_mode=item["conflict_mode"],
            mappings=item["mappings"],
            selected_child_tables=item["selected_child_tables"],
            message=item["message"],
            is_reverted=item.get("is_reverted", False),
        )
        history_items.append(h_item)

    for item in reversed(history_items):
        if not item.is_reverted:
            last_revertible = item
            break

    return IdRemapHistoryResponse(
        success=True,
        history=history_items,
        last_revertible_operation=last_revertible,
    )
