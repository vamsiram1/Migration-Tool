$ErrorActionPreference = 'Stop'
$tab = [char]9
$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$mysqlClient = "test-mysql-client-$runId"
$mysqlClientStarted = $false
$postgresClient = "test-postgres-client-$runId"
$postgresClientStarted = $false
$env:MYSQL_PWD = 'Vamsi@123'
try {
  docker run --detach --rm --name $mysqlClient --add-host host.docker.internal:host-gateway -e MYSQL_PWD --entrypoint sh mysql:8.4 -c 'while :; do sleep 3600; done' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to start MySQL client container.' }
  $mysqlClientStarted = $true

  $env:PGPASSWORD = 'Welcome123'
  docker run --detach --rm --name $postgresClient --add-host host.docker.internal:host-gateway -e PGPASSWORD --entrypoint sh postgres:17 -c 'while :; do sleep 3600; done' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to start PostgreSQL client container.' }
  $postgresClientStarted = $true

  New-Item -ItemType Directory -Force -Path 'pgloader-data' | Out-Null

  # Step 1: Export limited rows from MySQL
  $oldQuery_0 = 'SELECT DISTINCT `l`.`ADM_NO`, REPLACE(REPLACE(REPLACE(CAST(`l`.`ADM_NO` AS CHAR), ''\r'', '' ''), ''\n'', '' ''), ''\t'', '' '') FROM `esaplive`.`t_student` AS `l` JOIN (SELECT `ADM_NO` FROM `esaplive`.`t_concession_processing` LIMIT 1000) AS `s` ON `s`.`ADM_NO` = `l`.`ADM_NO`;'
  docker exec -e MYSQL_PWD $mysqlClient mysql --batch --raw --skip-column-names --host=192.168.20.9 --port=3306 --user=vamsi --database=esaplive --execute=$oldQuery_0 | Out-File 'pgloader-data/lookup-old-0.tsv' -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'MySQL lookup export failed.' }
  Write-Host "MySQL lookup-old-0 exported."

  # Step 2: Query filtered rows from PostgreSQL
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
          $pgLookupQuery_0 = ('SELECT REPLACE(REPLACE(REPLACE(CAST("stud_adms_no" AS TEXT), CHR(13), '' ''), CHR(10), '' ''), CHR(9), '' ''), "stud_adms_id" FROM "sce_student"."sce_stud_acdc_detl" WHERE "stud_adms_no" IN (' + $inList_0 + ');')
        }
      }
    }
  }

  $env:PGPASSWORD = 'Welcome123'
  docker exec -e PGPASSWORD $postgresClient psql --host=192.168.20.220 --port=5432 --username=postgres --dbname=sce_prod --no-align --tuples-only --field-separator=$tab --command=$pgLookupQuery_0 | Out-File 'pgloader-data/lookup-new-0.tsv' -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL lookup export failed.' }
  Write-Host "PostgreSQL lookup-new-0 exported successfully!"

} finally {
  Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($mysqlClientStarted) { docker rm -f $mysqlClient *> $null }
  if ($postgresClientStarted) { docker rm -f $postgresClient *> $null }
}
