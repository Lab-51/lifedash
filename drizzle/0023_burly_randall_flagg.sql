CREATE TABLE "sync_tracking" (
	"table_name" varchar(100) PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp with time zone
);
