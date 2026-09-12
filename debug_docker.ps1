$ErrorActionPreference = 'Stop'
$workDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$tab = [char]9
$migrationStarted = Get-Date
Set-Location $workDir
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop was not found.' }
$savedErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
docker info *> $null
$dockerInfoExitCode = $LASTEXITCODE
$ErrorActionPreference = $savedErrorActionPreference
if ($dockerInfoExitCode -ne 0) { throw 'Docker Desktop is installed, but its Linux container engine is not running. Start Docker Desktop, wait until it reports Engine running, select Linux containers if prompted, and try again.' }
New-Item -ItemType Directory -Force -Path 'pgloader-data' | Out-Null
Remove-Item -Path 'lookup-duplicates.txt' -ErrorAction SilentlyContinue | Out-Null
$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$mysqlClient = "migration-mysql-client-$runId"
$mysqlClientStarted = $false
$postgresClient = "migration-postgres-client-$runId"
$postgresClientStarted = $false
$env:MYSQL_PWD = 'Vamsi@123'
try {
  docker run --detach --rm --name $mysqlClient --add-host host.docker.internal:host-gateway -e MYSQL_PWD --entrypoint sh mysql:8.4 -c 'while :; do sleep 3600; done' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to start the reusable MySQL client container.' }
  $mysqlClientStarted = $true
  $env:PGPASSWORD = 'Welcome123'
  docker run --detach --rm --name $postgresClient --add-host host.docker.internal:host-gateway -e PGPASSWORD --entrypoint sh postgres:17 -c 'while :; do sleep 3600; done' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to start the reusable PostgreSQL client container.' }
  $postgresClientStarted = $true
  $exportStarted = Get-Date
  docker exec -e MYSQL_PWD $mysqlClient mysql --batch `
    --host=192.168.20.9 --port=3306 `
    --user=vamsi --database=esaplive `
    --execute='SELECT CASE WHEN `ADM_NO` IS NULL OR CAST(`ADM_NO` AS CHAR) = '''' THEN ''\\N'' ELSE `ADM_NO` END AS `stud_adms_id`, CASE WHEN `OCCUPATION` IS NULL OR CAST(`OCCUPATION` AS CHAR) = '''' THEN ''\\N'' ELSE `OCCUPATION` END AS `occupation`, CASE WHEN `MOBILENO` IS NULL OR CAST(`MOBILENO` AS CHAR) = '''' THEN ''\\N'' ELSE `MOBILENO` END AS `mobile_no`, CASE WHEN `EMAIL` IS NULL OR CAST(`EMAIL` AS CHAR) = '''' THEN ''\\N'' ELSE `EMAIL` END AS `email`, ''1'' AS `is_mail_varified`, ''1'' AS `is_app_reg`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date`, CASE `__relation_branch__`.`__branch_no__` WHEN 1 THEN CASE WHEN `PARENT_NAME` IS NULL OR CAST(`PARENT_NAME` AS CHAR) = '''' THEN ''\\N'' ELSE `PARENT_NAME` END WHEN 2 THEN CASE WHEN `MOTHER_NAME` IS NULL OR CAST(`MOTHER_NAME` AS CHAR) = '''' THEN ''\\N'' ELSE `MOTHER_NAME` END WHEN 3 THEN CASE WHEN `GUARDIAN_NAME` IS NULL OR CAST(`GUARDIAN_NAME` AS CHAR) = '''' THEN ''\\N'' ELSE `GUARDIAN_NAME` END END AS `name`, CASE `__relation_branch__`.`__branch_no__` WHEN 1 THEN ''FATHER'' WHEN 2 THEN ''MOTHER'' WHEN 3 THEN ''GUARDIAN'' END AS `student_relation_id` FROM `esaplive`.`t_parent_details` CROSS JOIN (SELECT 1 AS `__branch_no__` UNION ALL SELECT 2 AS `__branch_no__` UNION ALL SELECT 3 AS `__branch_no__`) AS `__relation_branch__` WHERE (`__relation_branch__`.`__branch_no__` = 1 AND `PARENT_NAME` IS NOT NULL AND TRIM(`PARENT_NAME`) <> '''') OR (`__relation_branch__`.`__branch_no__` = 2 AND `MOTHER_NAME` IS NOT NULL AND TRIM(`MOTHER_NAME`) <> '''') OR (`__relation_branch__`.`__branch_no__` = 3 AND `GUARDIAN_NAME` IS NOT NULL AND TRIM(`GUARDIAN_NAME`) <> '''') LIMIT 1000;' | Out-File -FilePath 'pgloader-data/t_parent_details.tsv' -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'MySQL export failed.' }
  Write-Host ('Export phase completed in {0:n1} seconds.' -f ((Get-Date) - $exportStarted).TotalSeconds)
  $lookupStarted = Get-Date
  Write-Host 'Performance check: index esaplive.t_student.ADM_NO and esaplive.t_parent_details.ADM_NO; also index PostgreSQL lookup match columns on sce_student.sce_stud_acdc_detl.'
  Write-Host 'Performance check: index PostgreSQL relation lookup column sce_student.sce_relation.relation_type used to resolve t_parent_details.student_relation_id.'
  docker exec -e MYSQL_PWD $mysqlClient mysql --batch --raw --skip-column-names --host=192.168.20.9 --port=3306 --user=vamsi --database=esaplive --execute='SELECT DISTINCT `l`.`ADM_NO`, REPLACE(REPLACE(REPLACE(CAST(`l`.`ADM_NO` AS CHAR), ''\\r'', '' ''), ''\\n'', '' ''), ''\\t'', '' '') FROM `esaplive`.`t_student` AS `l` JOIN `esaplive`.`t_parent_details` AS `s` ON `s`.`ADM_NO` = `l`.`ADM_NO`;' | Out-File 'pgloader-data/lookup-old-0.tsv' -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'MySQL lookup export failed.' }
  $env:PGPASSWORD = 'Welcome123'
  docker exec -e PGPASSWORD $postgresClient psql --host=192.168.20.220 --port=5432 --username=postgres --dbname=sce_prod --no-align --tuples-only --field-separator=$tab --command='SELECT REPLACE(REPLACE(REPLACE(CAST("stud_adms_no" AS TEXT), CHR(13), '' ''), CHR(10), '' ''), CHR(9), '' ''), "stud_adms_id" FROM "sce_student"."sce_stud_acdc_detl";' | Out-File 'pgloader-data/lookup-new-0.tsv' -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL lookup export failed.' }
  $env:PGPASSWORD = 'Welcome123'
  docker exec -e PGPASSWORD $postgresClient psql --host=192.168.20.220 --port=5432 --username=postgres --dbname=sce_prod --no-align --tuples-only --field-separator=$tab --command='SELECT REPLACE(REPLACE(REPLACE(CAST("relation_type" AS TEXT), CHR(13), '' ''), CHR(10), '' ''), CHR(9), '' ''), "relation_id" FROM "sce_student"."sce_relation";' | Out-File 'pgloader-data/lookup-new-1.tsv' -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL lookup export failed.' }
  py -3 lookup-transform.py 'pgloader-data/t_parent_details.tsv' '0' 'pgloader-data/lookup-old-0.tsv' 'pgloader-data/lookup-new-0.tsv' '1' '-' '0' '10' '=' 'pgloader-data/lookup-new-1.tsv' '1' '-' '1'
  if ($LASTEXITCODE -ne 0) { throw 'Lookup replacement failed.' }
  Write-Host ('Lookup phase completed in {0:n1} seconds.' -f ((Get-Date) - $lookupStarted).TotalSeconds)
} finally {
  Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($mysqlClientStarted) { docker rm -f $mysqlClient *> $null }
  if ($postgresClientStarted) { docker rm -f $postgresClient *> $null }
}
$loadStarted = Get-Date
$pgloaderImage = if ($env:PGLOADER_IMAGE) { $env:PGLOADER_IMAGE } else { 'dimitri/pgloader:latest' }
docker run --rm --add-host host.docker.internal:host-gateway -v "${workDir}:/work" -w /work $pgloaderImage pgloader mysql-to-postgres.load
if ($LASTEXITCODE -ne 0) { throw 'pgloader failed.' }
Write-Host ('Load phase completed in {0:n1} seconds.' -f ((Get-Date) - $loadStarted).TotalSeconds)
Write-Host ('Migration completed in {0:n1} seconds.' -f ((Get-Date) - $migrationStarted).TotalSeconds)
