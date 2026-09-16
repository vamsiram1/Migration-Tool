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
    --execute='SELECT CASE WHEN `ADM_NO` IS NULL OR CAST(`ADM_NO` AS CHAR) = '''' THEN ''\\N'' ELSE `ADM_NO` END AS `stud_adms_id`, CASE WHEN `CONCESSION_REASON_ID` IS NULL OR CAST(`CONCESSION_REASON_ID` AS CHAR) = '''' THEN ''\\N'' ELSE `CONCESSION_REASON_ID` END AS `conc_reason_id`, CASE WHEN `REQUEST_AMOUNT` IS NULL OR CAST(`REQUEST_AMOUNT` AS CHAR) = '''' THEN ''\\N'' ELSE `REQUEST_AMOUNT` END AS `requested_conc`, CASE WHEN `APPROVED_AMOUNT` IS NULL OR CAST(`APPROVED_AMOUNT` AS CHAR) = '''' THEN ''\\N'' ELSE `APPROVED_AMOUNT` END AS `approved_conc`, CASE WHEN `APPROVED_EMP_ID` IS NULL OR CAST(`APPROVED_EMP_ID` AS CHAR) = '''' THEN ''\\N'' ELSE `APPROVED_EMP_ID` END AS `approved_by`, CASE WHEN `APPROVED_DATE` IS NULL OR CAST(`APPROVED_DATE` AS CHAR) = '''' THEN ''\\N'' ELSE `APPROVED_DATE` END AS `approved_date`, CASE WHEN `CREATED_BY` IS NULL OR CAST(`CREATED_BY` AS CHAR) = '''' THEN ''\\N'' ELSE `CREATED_BY` END AS `created_by`, CASE WHEN `CREATED_ON` IS NULL OR CAST(`CREATED_ON` AS CHAR) = '''' THEN ''\\N'' ELSE `CREATED_ON` END AS `created_date`, CASE WHEN `MODIFIED_BY` IS NULL OR CAST(`MODIFIED_BY` AS CHAR) = '''' THEN ''\\N'' ELSE `MODIFIED_BY` END AS `updated_by`, CASE WHEN `MODIFIED_ON` IS NULL OR CAST(`MODIFIED_ON` AS CHAR) = '''' THEN ''\\N'' ELSE `MODIFIED_ON` END AS `updated_date`, COALESCE(NULLIF(CASE `STATUS` WHEN ''CONFIRM'' THEN ''1'' WHEN ''APPROVED'' THEN ''1'' WHEN ''MANUAL_CONFIRM'' THEN ''1'' WHEN ''APPROVED-APK'' THEN ''1'' WHEN ''CONFIRMED'' THEN ''1'' WHEN ''REJECTED'' THEN ''5'' WHEN ''REJECTED-APK'' THEN ''5'' WHEN ''REJECT'' THEN ''5'' WHEN ''REJECTD'' THEN ''5'' WHEN ''REQUEST'' THEN ''4'' WHEN ''REQUEST-APK'' THEN ''4'' WHEN ''REQUEST_JUL'' THEN ''4'' WHEN ''REQ_A_MAR'' THEN ''4'' WHEN ''REQ_A_27_NOV_2019'' THEN ''4'' ELSE `STATUS` END, ''''), ''12'') AS `approval_status_id`, ''1'' AS `is_active`, ''1'' AS `conc_type_id` FROM `esaplive`.`t_concession_processing` LIMIT 1000;' | Out-File -FilePath 'pgloader-data/t_concession_processing.tsv' -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'MySQL export failed.' }
  Write-Host ('Export phase completed in {0:n1} seconds.' -f ((Get-Date) - $exportStarted).TotalSeconds)
  $lookupStarted = Get-Date
  Write-Host 'Performance check: index esaplive.t_student.ADM_NO and esaplive.t_concession_processing.ADM_NO; also index PostgreSQL lookup match columns on sce_student.sce_stud_acdc_detl.'
  docker exec -e MYSQL_PWD $mysqlClient mysql --batch --raw --skip-column-names --host=192.168.20.9 --port=3306 --user=vamsi --database=esaplive --execute='SELECT DISTINCT `l`.`ADM_NO`, REPLACE(REPLACE(REPLACE(CAST(`l`.`ADM_NO` AS CHAR), ''\\r'', '' ''), ''\\n'', '' ''), ''\\t'', '' '') FROM `esaplive`.`t_student` AS `l` JOIN (SELECT `ADM_NO` FROM `esaplive`.`t_concession_processing` LIMIT 1000) AS `s` ON `s`.`ADM_NO` = `l`.`ADM_NO`;' | Out-File 'pgloader-data/lookup-old-0.tsv' -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'MySQL lookup export failed.' }
  $pgLookupQuery_0 = 'SELECT REPLACE(REPLACE(REPLACE(CAST("stud_adms_no" AS TEXT), CHR(13), '' ''), CHR(10), '' ''), CHR(9), '' ''), "stud_adms_id" FROM "sce_student"."sce_stud_acdc_detl";'
  if (Test-Path 'pgloader-data/lookup-old-0.tsv') {
    $matchCount_0 = 1
    $oldLines_0 = Get-Content 'pgloader-data/lookup-old-0.tsv' | Where-Object { $_.Trim() -ne '' }
    if ($oldLines_0.Count -gt 0 -and $oldLines_0.Count -le 50000) {
      if ($matchCount_0 -eq 1) {
        $keys_0 = $oldLines_0 | ForEach-Object {
          $parts = $_ -split "`t"
          if ($parts.Count -gt 1) {
            $k = $parts[1].Trim().Trim("'`"").Trim()
            if ($k -ne '') { "'" + $k.Replace("'", "''") + "'" }
          }
        } | Select-Object -Unique
        if ($keys_0.Count -gt 0) {
          $inList_0 = $keys_0 -join ','
          $pgLookupQuery_0 = ('SELECT ' + 'REPLACE(REPLACE(REPLACE(CAST("stud_adms_no" AS TEXT), CHR(13), '' ''), CHR(10), '' ''), CHR(9), '' ''), "stud_adms_id"' + ' FROM ' + '"sce_student"."sce_stud_acdc_detl"' + ' WHERE ' + '"stud_adms_no"' + ' IN (' + $inList_0 + ');')
        }
      } else {
        $tuples_0 = $oldLines_0 | ForEach-Object {
          $parts = $_ -split "`t"
          if ($parts.Count -gt $matchCount_0) {
            $vals = for ($i = 1; $i -le $matchCount_0; $i++) {
              $k = $parts[$i].Trim().Trim("'`"").Trim()
              "'" + $k.Replace("'", "''") + "'"
            }
            "(" + ($vals -join ',') + ")"
          }
        } | Select-Object -Unique
        if ($tuples_0.Count -gt 0) {
          $inList_0 = $tuples_0 -join ','
          $pgLookupQuery_0 = ('SELECT ' + 'REPLACE(REPLACE(REPLACE(CAST("stud_adms_no" AS TEXT), CHR(13), '' ''), CHR(10), '' ''), CHR(9), '' ''), "stud_adms_id"' + ' FROM ' + '"sce_student"."sce_stud_acdc_detl"' + ' WHERE (' + '"stud_adms_no"' + ') IN (' + $inList_0 + ');')
        }
      }
    }
  }
  $env:PGPASSWORD = 'Welcome123'
  docker exec -e PGPASSWORD $postgresClient psql --host=192.168.20.220 --port=5432 --username=postgres --dbname=sce_prod --no-align --tuples-only --field-separator=$tab --command=$pgLookupQuery_0 | Out-File 'pgloader-data/lookup-new-0.tsv' -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL lookup export failed.' }
  py -3 lookup-transform.py 'pgloader-data/t_concession_processing.tsv' '0' 'pgloader-data/lookup-old-0.tsv' 'pgloader-data/lookup-new-0.tsv' '1' '-' '0'
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
