import psycopg


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
