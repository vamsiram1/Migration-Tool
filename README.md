# MySQL to PostgreSQL migration mapper (Windows application, Linux migration runner)

This Windows web app reads MySQL and PostgreSQL metadata, lets you choose the tables and fields to migrate, and generates a pgloader `.load` file plus a Linux Bash runner. PostgreSQL destination tables must already exist.

## Windows application requirements

- Windows 10/11 and PowerShell
- Python 3.11 or newer (`py` launcher enabled)
- Node.js LTS

## Install and start on Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
powershell -ExecutionPolicy Bypass -File .\start-windows.ps1
```

Open <http://127.0.0.1:5173>. Connect both databases, load their schemas and tables, add the wanted table mappings, and use **Map columns** for every included table.

To keep reusable configurations, choose **Select folder** and select a parent Windows folder, then choose **Save**. Each save creates or updates a subfolder named from the selected PostgreSQL schema and destination table names, such as `sce_course__test_stream`. It contains `project.json`, `mysql-to-postgres.load`, `mysql-to-pgloader.sh`, and `lookup-transform.py`. Selecting the parent folder scans its configuration subfolders and displays readable `schema / table` labels in the **Saved configuration** dropdown. Folder access requires a current version of Microsoft Edge or Google Chrome. These files contain database credentials and must be protected.

## Run the generated migration on Linux

The Linux server needs Bash, Python 3, the MySQL and PostgreSQL command-line clients, and pgloader installed natively. Download `mysql-to-postgres.load`, `mysql-to-pgloader.sh`, and `lookup-transform.py` from the Windows application, copy them into the same directory on the Linux server, and run:

```bash
chmod +x mysql-to-pgloader.sh
./mysql-to-pgloader.sh
```

Large migrations export up to four tables concurrently by default. Override the bounded concurrency when the database and migration host have enough CPU, memory, disk, and network capacity:

```bash
MIGRATION_EXPORT_JOBS=8 ./mysql-to-pgloader.sh
```

Start conservatively: excessive concurrency can make a shared MySQL server or disk slower. The runner reports separate export, lookup, load, and total elapsed times. It also prints index recommendations for configured lookups. Review those recommendations with a database administrator; the application never creates indexes or disables PostgreSQL constraints, triggers, or indexes automatically.

The generated Bash script exports selected MySQL fields into `pgloader-data` and inserts them into the mapped columns of existing PostgreSQL tables. Database host names are used exactly as entered in the Windows application.

For foreign keys that changed during migration, use **Add lookup replacement** on the mapped source column. Configure the MySQL old-ID and matching-value columns plus the PostgreSQL matching-value and new-ID columns. The runner builds a crosswalk and replaces old IDs before pgloader starts. Missing matches and duplicate PostgreSQL matching values stop the migration rather than silently writing an incorrect ID.

The Linux server must be able to reach both database hosts. If a database runs on the Windows machine, enter an address reachable from the Linux server rather than `localhost`.

## Run from the Windows page with Docker

The **Run migration with Docker Desktop** section exports the selected MySQL data and runs pgloader in Docker containers directly from the Windows application. Docker Desktop must be installed and running. The combined MySQL and pgloader output and exit status are displayed after the process finishes. The separately downloaded Bash runner remains intended for native execution on Linux.

Docker execution reuses temporary MySQL and PostgreSQL client containers during a run to reduce container startup overhead, then removes them. For repeatable deployments, set `PGLOADER_IMAGE` to an approved immutable image tag or digest before starting the Windows application; otherwise the existing `dimitri/pgloader:latest` default is retained for compatibility.

Passwords are included in saved projects and generated files. Restrict file permissions and delete these files when they are no longer needed.
