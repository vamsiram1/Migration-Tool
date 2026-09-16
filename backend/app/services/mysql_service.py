import pymysql


def quote_identifier(value):
    return "`" + str(value).replace("`", "``") + "`"


def get_connection(data):
    return pymysql.connect(
        host=data.host,
        port=data.port,
        user=data.username,
        password=data.password,
        database=data.database,
        cursorclass=pymysql.cursors.DictCursor,
    )


def test_connection(data):
    conn = get_connection(data)
    conn.close()
    return True


def get_schemas(data):
    conn = get_connection(data)

    with conn.cursor() as cur:
        cur.execute("""
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
            ORDER BY schema_name
        """)
        rows = cur.fetchall()

    conn.close()
    return [{"schema_name": row["schema_name"]} for row in rows]


def get_tables(data):
    conn = get_connection(data)

    with conn.cursor() as cur:
        cur.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema=%s
            ORDER BY table_name
        """, (data.schema_name,))

        rows = cur.fetchall()

    conn.close()

    return [
        {
            "table_name": row["table_name"]
        }
        for row in rows
    ]

def get_columns(data, table_name):
    conn = get_connection(data)

    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                column_name,
                data_type,
                is_nullable,
                column_key
            FROM information_schema.columns
            WHERE table_schema=%s
              AND table_name=%s
            ORDER BY ordinal_position
        """, (data.schema_name, table_name))

        columns = cur.fetchall()

    conn.close()

    return [
        {
            "column_name": column["column_name"],
            "data_type": column["data_type"],
            "is_nullable": column["is_nullable"],
            "column_key": column["column_key"],
        }
        for column in columns
    ]


def get_distinct_values(data, table_name, column_name, limit=500):
    """Return distinct values for a single column, used to populate value-mapping
    dropdowns without pulling the whole source table. NULL is reported separately
    (has_null) so it is never confused with the literal string "NULL"."""
    conn = get_connection(data)

    with conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*) AS matches
            FROM information_schema.columns
            WHERE table_schema=%s AND table_name=%s AND column_name=%s
        """, (data.schema_name, table_name, column_name))
        if cur.fetchone()["matches"] == 0:
            conn.close()
            raise ValueError(f"Column '{column_name}' does not exist on '{table_name}'")

        safe_table = quote_identifier(table_name)
        safe_schema = quote_identifier(data.schema_name)
        safe_column = quote_identifier(column_name)
        qualified_table = f"{safe_schema}.{safe_table}"

        cur.execute(f"SELECT EXISTS(SELECT 1 FROM {qualified_table} WHERE {safe_column} IS NULL) AS has_null")
        has_null = bool(list(cur.fetchone().values())[0])

        safe_limit = int(limit)
        cur.execute(
            f"SELECT DISTINCT {safe_column} AS value FROM {qualified_table} "
            f"WHERE {safe_column} IS NOT NULL LIMIT {safe_limit}"
        )
        values = [row["value"] for row in cur.fetchall()]

    conn.close()

    return {"values": values, "has_null": has_null}
