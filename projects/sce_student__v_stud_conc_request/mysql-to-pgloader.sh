#!/usr/bin/env bash
set -Eeuo pipefail
work_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$work_dir"

command -v mysql >/dev/null 2>&1 || { echo 'MySQL client was not found.' >&2; exit 1; }
command -v pgloader >/dev/null 2>&1 || { echo 'pgloader was not found.' >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo 'PostgreSQL client was not found.' >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo 'Python 3 was not found.' >&2; exit 1; }

mkdir -p pgloader-data
rm -f lookup-duplicates.txt
migration_started=$SECONDS
export_started=$SECONDS

export MYSQL_PWD='Vamsi@123'
echo "[1/1] Exporting t_concession_processing..."
mysql --batch \
  --host='192.168.20.9' --port='3306' \
  --user='vamsi' --database='esaplive' \
  --execute="SELECT CASE WHEN \`ADM_NO\` IS NULL OR CAST(\`ADM_NO\` AS CHAR) = '' THEN '\\N' ELSE \`ADM_NO\` END AS \`stud_adms_id\`, CASE WHEN \`CONCESSION_REASON_ID\` IS NULL OR CAST(\`CONCESSION_REASON_ID\` AS CHAR) = '' THEN '\\N' ELSE \`CONCESSION_REASON_ID\` END AS \`conc_reason_id\`, CASE WHEN \`REQUEST_AMOUNT\` IS NULL OR CAST(\`REQUEST_AMOUNT\` AS CHAR) = '' THEN '\\N' ELSE \`REQUEST_AMOUNT\` END AS \`requested_conc\`, CASE WHEN \`APPROVED_AMOUNT\` IS NULL OR CAST(\`APPROVED_AMOUNT\` AS CHAR) = '' THEN '\\N' ELSE \`APPROVED_AMOUNT\` END AS \`approved_conc\`, CASE WHEN \`APPROVED_EMP_ID\` IS NULL OR CAST(\`APPROVED_EMP_ID\` AS CHAR) = '' THEN '\\N' ELSE \`APPROVED_EMP_ID\` END AS \`approved_by\`, CASE WHEN \`APPROVED_DATE\` IS NULL OR CAST(\`APPROVED_DATE\` AS CHAR) = '' THEN '\\N' ELSE \`APPROVED_DATE\` END AS \`approved_date\`, CASE WHEN \`CREATED_BY\` IS NULL OR CAST(\`CREATED_BY\` AS CHAR) = '' THEN '\\N' ELSE \`CREATED_BY\` END AS \`created_by\`, CASE WHEN \`CREATED_ON\` IS NULL OR CAST(\`CREATED_ON\` AS CHAR) = '' THEN '\\N' ELSE \`CREATED_ON\` END AS \`created_date\`, CASE WHEN \`MODIFIED_BY\` IS NULL OR CAST(\`MODIFIED_BY\` AS CHAR) = '' THEN '\\N' ELSE \`MODIFIED_BY\` END AS \`updated_by\`, CASE WHEN \`MODIFIED_ON\` IS NULL OR CAST(\`MODIFIED_ON\` AS CHAR) = '' THEN '\\N' ELSE \`MODIFIED_ON\` END AS \`updated_date\`, CASE WHEN ((\`LEVEL2_APPROVED_AMOUNT\` IS NOT NULL AND \`LEVEL2_APPROVED_AMOUNT\` > 0) OR (\`LEVEL2_APPROVED_EMP_ID\` IS NOT NULL AND \`LEVEL2_APPROVED_EMP_ID\` > 0) OR (\`LEVEL2_DATE\` IS NOT NULL AND TRIM(CAST(\`LEVEL2_DATE\` AS CHAR)) <> '')) THEN 'APPROVED BY CO' WHEN ((\`LEVEL1_APPROVED_AMOUNT\` IS NOT NULL AND \`LEVEL1_APPROVED_AMOUNT\` > 0) OR (\`LEVEL1_APPROVED_EMP_ID\` IS NOT NULL AND \`LEVEL1_APPROVED_EMP_ID\` > 0) OR (\`LEVEL1_DATE\` IS NOT NULL AND TRIM(CAST(\`LEVEL1_DATE\` AS CHAR)) <> '')) THEN 'APPROVED BY AGM' WHEN ((\`APPROVED_AMOUNT\` IS NOT NULL AND \`APPROVED_AMOUNT\` > 0) OR (TRIM(CAST(\`STATUS\` AS CHAR)) IN ('CONFIRM', 'APPROVED', 'MANUAL_CONFIRM', 'APPROVED-APK', 'CONFIRMED'))) THEN 'APPROVED BY CO' WHEN ((TRIM(CAST(\`STATUS\` AS CHAR)) IN ('REJECTED', 'REJECTED-APK', 'REJECT', 'REJECTD'))) THEN 'REJECTED BY CO' WHEN ((TRIM(CAST(\`STATUS\` AS CHAR)) IN ('REQUEST', 'REQUEST-APK', 'REQUEST_JUL', 'REQ_A_MAR', 'REQ_A_27_NOV_2019'))) THEN 'PENDING WITH CO' ELSE 'OTHERS' END AS \`approval_status_id\`, '1' AS \`is_active\`, '1' AS \`conc_type_id\` FROM \`esaplive\`.\`t_concession_processing\`;" > 'pgloader-data/t_concession_processing.tsv'

echo "Export phase completed in $((SECONDS - export_started)) seconds."
lookup_started=$SECONDS

# Export crosswalk 0: ADM_NO -> stud_adms_id
mysql --batch --raw --skip-column-names --host='192.168.20.9' --port='3306' --user='vamsi' --database='esaplive' --execute='SELECT DISTINCT `l`.`ADM_NO`, REPLACE(REPLACE(REPLACE(CAST(`l`.`ADM_NO` AS CHAR), '''\r''', ''' '''), '''\n''', ''' '''), '''\t''', ''' ''') FROM `esaplive`.`t_concession_processing` AS `l` JOIN `esaplive`.`t_concession_processing` AS `s` ON `s`.`ADM_NO` = `l`.`ADM_NO`;' > 'pgloader-data/lookup-old-0.tsv'
PGPASSWORD='Welcome123' psql --host='192.168.20.220' --port='5432' --username='postgres' --dbname='sce_prod' --no-align --tuples-only --field-separator=$'\t' --command='SELECT REPLACE(REPLACE(REPLACE(CAST("stud_adms_no" AS TEXT), CHR(13), ''' '''), CHR(10), ''' '''), CHR(9), ''' '''), "stud_adms_id" FROM "sce_student"."sce_stud_acdc_detl";' > 'pgloader-data/lookup-new-0.tsv'

# Export value_map 1: approval_status -> approval_status_id
PGPASSWORD='Welcome123' psql --host='192.168.20.220' --port='5432' --username='postgres' --dbname='sce_prod' --no-align --tuples-only --field-separator=$'\t' --command='SELECT REPLACE(REPLACE(REPLACE(CAST("approval_status" AS TEXT), CHR(13), ''' '''), CHR(10), ''' '''), CHR(9), ''' '''), "approval_status_id" FROM "sce_student"."sce_approval_status";' > 'pgloader-data/lookup-new-1.tsv'

# Transform TSV
python3 lookup-transform.py 'pgloader-data/t_concession_processing.tsv' '0' 'pgloader-data/lookup-old-0.tsv' 'pgloader-data/lookup-new-0.tsv' '1' '-' '1' '10' '=' 'pgloader-data/lookup-new-1.tsv' '1' '-' '1'

echo "Lookup phase completed in $((SECONDS - lookup_started)) seconds."
unset MYSQL_PWD

load_started=$SECONDS
pgloader mysql-to-postgres.load
echo "Load phase completed in $((SECONDS - load_started)) seconds."
echo "Migration completed in $((SECONDS - migration_started)) seconds."
