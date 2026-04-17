CREATE TABLE "cola_zone_setting" (
	"zoneId" "cola_zone" PRIMARY KEY NOT NULL,
	"workstationCapacity" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
