import pymysql


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
