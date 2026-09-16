$q = 'SELECT "approval_status" FROM "sce_student"."sce_approval_status" WHERE "approval_status" IN (''CONFIRM'');'
Write-Host "Direct literal in PS1:"
Write-Host $q

$key = "CONFIRM"
$inList = "'$($key.Replace("'", "''"))'"
$pgLookupQuery = "SELECT `"approval_status`" FROM `"sce_student`".`"sce_approval_status`" WHERE `"approval_status`" IN ($inList);"
Write-Host "Constructed query:"
Write-Host $pgLookupQuery
