import { defineConfig } from "drizzle-kit";
import { databaseFile, dataDirectory } from "./src/server/db/location";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: { url: databaseFile(dataDirectory()) },
});
