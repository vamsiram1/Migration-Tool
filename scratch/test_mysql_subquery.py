import pymysql
import time

conn = pymysql.connect(host='192.168.20.9', port=3306, user='vamsi', password='Vamsi@123', database='esaplive')
cur = conn.cursor()
t0 = time.time()
query = "SELECT DISTINCT `l`.`ADM_NO`, REPLACE(REPLACE(REPLACE(CAST(`l`.`ADM_NO` AS CHAR), '\\r', ' '), '\\n', ' '), '\\t', ' ') FROM `esaplive`.`t_student` AS `l` JOIN (SELECT `ADM_NO` FROM `esaplive`.`t_concession_processing` LIMIT 1000) AS `s` ON `s`.`ADM_NO` = `l`.`ADM_NO`;"
cur.execute(query)
rows = cur.fetchall()
print(f"MySQL lookup returned {len(rows)} rows in {time.time()-t0:.4f}s")
