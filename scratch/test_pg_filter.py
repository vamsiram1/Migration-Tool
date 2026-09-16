import pymysql
import psycopg
import time

conn_mysql = pymysql.connect(host='192.168.20.9', port=3306, user='vamsi', password='Vamsi@123', database='esaplive')
cur_mysql = conn_mysql.cursor()
t0 = time.time()
query_mysql = "SELECT DISTINCT `l`.`ADM_NO`, REPLACE(REPLACE(REPLACE(CAST(`l`.`ADM_NO` AS CHAR), '\\r', ' '), '\\n', ' '), '\\t', ' ') FROM `esaplive`.`t_student` AS `l` JOIN (SELECT `ADM_NO` FROM `esaplive`.`t_concession_processing` LIMIT 1000) AS `s` ON `s`.`ADM_NO` = `l`.`ADM_NO`;"
cur_mysql.execute(query_mysql)
mysql_rows = cur_mysql.fetchall()
print(f"MySQL lookup returned {len(mysql_rows)} rows in {time.time()-t0:.4f}s")

match_keys = list({r[1] for r in mysql_rows if r[1]})
print(f"Unique match keys count: {len(match_keys)}")

conn_pg = psycopg.connect('postgresql://postgres:Welcome123@192.168.20.220:5432/sce_prod')
cur_pg = conn_pg.cursor()

t1 = time.time()
in_list = ",".join(f"'{k.replace('\'', '\'\'')}'" for k in match_keys)
pg_query = f'SELECT REPLACE(REPLACE(REPLACE(CAST("stud_adms_no" AS TEXT), CHR(13), \' \'), CHR(10), \' \'), CHR(9), \' \'), "stud_adms_id" FROM "sce_student"."sce_stud_acdc_detl" WHERE "stud_adms_no" IN ({in_list});'
cur_pg.execute(pg_query)
pg_rows = cur_pg.fetchall()
print(f"PostgreSQL filtered query returned {len(pg_rows)} rows in {time.time()-t1:.4f}s")
