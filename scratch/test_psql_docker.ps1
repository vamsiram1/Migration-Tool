$ErrorActionPreference = 'Stop'
$tab = [char]9
$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$postgresClient = "test-postgres-client-$runId"
$env:PGPASSWORD = 'Welcome123'
try {
  docker run --detach --rm --name $postgresClient --add-host host.docker.internal:host-gateway -e PGPASSWORD --entrypoint sh postgres:17 -c 'while :; do sleep 3600; done' | Out-Null
  Write-Host "Postgres container started: $postgresClient"
  
  $inList = "'10001','10002'"
  $pgLookupQuery = "SELECT `"stud_adms_no`", `"stud_adms_id`" FROM `"sce_student`".`"sce_stud_acdc_detl`" WHERE `"stud_adms_no`" IN ($inList);"
  Write-Host "Running query: $pgLookupQuery"
  
  docker exec -e PGPASSWORD $postgresClient psql --host=192.168.20.220 --port=5432 --username=postgres --dbname=sce_prod --no-align --tuples-only --field-separator=$tab --command=$pgLookupQuery
  Write-Host "Query completed successfully! Exit code: $LASTEXITCODE"
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  docker rm -f $postgresClient *> $null
}
