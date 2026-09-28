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
$env:MYSQL_PWD = 'Vamsi@123'
try {
  docker run --detach --rm --name $mysqlClient --add-host host.docker.internal:host-gateway -e MYSQL_PWD --entrypoint sh mysql:8.4 -c 'while :; do sleep 3600; done' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to start the reusable MySQL client container.' }
  $mysqlClientStarted = $true
  $exportStarted = Get-Date
  docker exec -e MYSQL_PWD $mysqlClient mysql --batch `
    --host=192.168.20.9 --port=3306 `
    --user=vamsi --database=esaplive `
    --execute='SELECT ''NEW'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date` UNION ALL SELECT ''OLD'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date` UNION ALL SELECT ''DAMAGED'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date` UNION ALL SELECT ''RECHARGED'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date` UNION ALL SELECT ''NEW'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date` UNION ALL SELECT ''OLD'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date` UNION ALL SELECT ''BUTTONED'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date` UNION ALL SELECT ''RE-BUTTONED'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date` UNION ALL SELECT ''DAMAGED'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date` UNION ALL SELECT ''NEW'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date` UNION ALL SELECT ''RUNNING'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date` UNION ALL SELECT ''UNDER MAINTENANCE'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date` UNION ALL SELECT ''BREAKDOWN'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date` UNION ALL SELECT ''ACCIDENT'' AS `condition_type`, ''1'' AS `attach_type_id`, ''1'' AS `is_active`, ''1'' AS `created_by`, CURRENT_TIMESTAMP AS `created_date`;' | Out-File -FilePath 'pgloader-data/no table (sce_condition_type).tsv' -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'MySQL export failed.' }
  Write-Host ('Export phase completed in {0:n1} seconds.' -f ((Get-Date) - $exportStarted).TotalSeconds)
} finally {
  Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($mysqlClientStarted) { docker rm -f $mysqlClient *> $null }
}
$loadStarted = Get-Date
$pgloaderImage = if ($env:PGLOADER_IMAGE) { $env:PGLOADER_IMAGE } else { 'dimitri/pgloader:latest' }
docker run --rm --add-host host.docker.internal:host-gateway -v "${workDir}:/work" -w /work $pgloaderImage pgloader mysql-to-postgres.load
if ($LASTEXITCODE -ne 0) { throw 'pgloader failed.' }
Write-Host ('Load phase completed in {0:n1} seconds.' -f ((Get-Date) - $loadStarted).TotalSeconds)
Write-Host ('Migration completed in {0:n1} seconds.' -f ((Get-Date) - $migrationStarted).TotalSeconds)
