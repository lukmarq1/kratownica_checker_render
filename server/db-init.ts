/**
 * Database initialization script.
 * Ensures the angle_attempts and attempt_history tables exist on server startup.
 * This is a workaround for environments where migrations cannot be applied manually.
 */

import { getDb } from "./db";

export async function initializeDatabase() {
  const db = await getDb();
  if (!db) {
    console.warn("[Database Init] Database not available, skipping initialization");
    return;
  }

  try {
    // Create angle_attempts table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS angle_attempts (
        id int AUTO_INCREMENT NOT NULL,
        ipAddress varchar(45) NOT NULL,
        failedAttempts int NOT NULL DEFAULT 0,
        lastAttemptAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        lockedUntil timestamp NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY angle_attempts_ipAddress_unique (ipAddress)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("[Database Init] angle_attempts table initialized successfully");

    // Create attempt_history table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS attempt_history (
        id int AUTO_INCREMENT NOT NULL,
        ipAddress varchar(45) NOT NULL,
        angle varchar(10) NOT NULL,
        isCorrect tinyint NOT NULL DEFAULT 0,
        attemptNumber int NOT NULL,
        userAgent text,
        country varchar(100),
        city varchar(100),
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY attempt_history_ipAddress_idx (ipAddress),
        KEY attempt_history_createdAt_idx (createdAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("[Database Init] attempt_history table initialized successfully");
  } catch (error) {
    console.error("[Database Init] Failed to initialize tables:", error);
    throw error;
  }
}
