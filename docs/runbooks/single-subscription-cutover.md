# Single-subscription cutover

Do not run this procedure without a maintenance window and tested restore.

1. Back up **both PostgreSQL databases** (STEALTHNET and Remnawave) and the deployment directory before any `--apply` command.

   ```sh
   pg_dump "$DATABASE_URL" > stealthnet-before-cutover.sql
   pg_dump "$REMNA_DATABASE_URL" > remnawave-before-cutover.sql
   tar -czf deployment-before-cutover.tgz /opt/stealthnet
   ```

2. Inventory only (default dry-run):

   ```sh
   cd backend
   npm run migrate:single-subscription -- --dry-run
   ```

3. Apply one test subscription, inspect its verified direct `sub.lazeika.xyz` URL and local switch, then resume batch processing:

   ```sh
   npm run migrate:single-subscription -- --apply --subscription TEST_SUBSCRIPTION_ID
   npm run migrate:single-subscription -- --apply --resume
   ```

4. Only after every replacement has both verified and switched journal proof, clean eligible legacy users:

   ```sh
   npm run migrate:single-subscription -- --cleanup-legacy --apply
   ```

5. Before legacy cleanup, rollback switches by restoring the old UUID from the `subscription.cutover.snapshot` AdminEvent. Never delete a legacy user until the replacement URL proof and switched proof exist.

Tombstones are cleanup-only: they never receive a replacement user.
