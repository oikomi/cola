import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(4);
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 5,
  idle_timeout: 2,
});

try {
  const [row] = await sql`
    select
      to_regclass('public.cola_event') as event_table,
      to_regclass('public.cola_task') as task_table
  `;

  if (row?.event_table && row?.task_table) {
    console.log("Virtual Office schema is ready.");
    process.exit(0);
  }

  console.log("Virtual Office schema is missing.");
  process.exit(2);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Unknown database connection error",
  );
  process.exit(3);
} finally {
  await sql.end({ timeout: 1 }).catch(() => undefined);
}
