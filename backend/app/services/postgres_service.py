import psycopg


def quote_identifier(value):
    return '"' + str(value).replace('"', '""') + '"'


def get_connection(data):
    return psycopg.connect(
        host=data.host,
        port=data.port,
        user=data.username,
        password=data.password,
        dbname=data.database,
    )


def test_connection(data):
    conn = get_connection(data)
    conn.close()
    return True


def get_databases(data):
    conn = get_connection(data)
    cur = conn.cursor()
    cur.execute("""
        SELECT datname
        FROM pg_database
        WHERE datallowconn
          AND NOT datistemplate
          AND has_database_privilege(current_user, datname, 'CONNECT')
        ORDER BY datname
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [{"database_name": row[0]} for row in rows]


def get_schemas(data):
    conn = get_connection(data)
    cur = conn.cursor()

    cur.execute("""
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name NOT IN ('information_schema', 'pg_catalog')
          AND schema_name NOT LIKE 'pg_toast%'
        ORDER BY schema_name
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    return [{"schema_name": row[0]} for row in rows]


def get_tables(data):

    conn = get_connection(data)

    cur = conn.cursor()

    cur.execute("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema=%s
        ORDER BY table_name
    """, (data.schema_name,))

    tables = cur.fetchall()

    cur.close()

    conn.close()

    return [
        {"table_name": row[0]}
        for row in tables
    ]

def get_columns(data, table_name):
    conn = get_connection(data)

    cur = conn.cursor()

    cur.execute("""
        SELECT
            column_name,
            data_type,
            is_nullable
        FROM information_schema.columns
        WHERE table_schema=%s
        AND table_name=%s
        ORDER BY ordinal_position
    """, (data.schema_name, table_name))

    rows = cur.fetchall()

    cur.close()
    conn.close()

    return [
        {
            "column_name": row[0],
            "data_type": row[1],
            "is_nullable": row[2],
        }
        for row in rows
    ]


def get_master_table_rows(data, table_name, id_column, display_column, limit=1000):
    """Return {id, label} rows from a generic master/lookup table, for populating
    a target-value dropdown during column-value mapping. Any table/column can be
    used as a master table - nothing here is specific to a particular schema."""
    conn = get_connection(data)
    cur = conn.cursor()

    cur.execute("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema=%s AND table_name=%s AND column_name IN (%s, %s)
    """, (data.schema_name, table_name, id_column, display_column))
    found = {row[0] for row in cur.fetchall()}
    if id_column not in found or display_column not in found:
        cur.close()
        conn.close()
        raise ValueError(f"Column(s) not found on '{table_name}'")

    safe_table = quote_identifier(table_name)
    safe_schema = quote_identifier(data.schema_name)
    safe_id = quote_identifier(id_column)
    safe_display = quote_identifier(display_column)
    safe_limit = int(limit)

    cur.execute(
        f"SELECT {safe_id}, {safe_display} FROM {safe_schema}.{safe_table} "
        f"ORDER BY {safe_display} LIMIT {safe_limit}"
    )
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return [{"id": row[0], "label": row[1]} for row in rows]
