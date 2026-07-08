export async function getOrCreateAttemptRecord(ipAddress: string) {
  console.log("[getOrCreateAttemptRecord] START for IP:", ipAddress);
  const db = await getDb();
  if (!db) {
    console.error("[getOrCreateAttemptRecord] Database not available!");
    throw new Error("Database not available");
  }

  try {
    // Użyj surowego SQL z mysql2
    const connection = (db as any).connection || db._connection;
    if (!connection) {
      console.error("[getOrCreateAttemptRecord] No connection available!");
      throw new Error("No database connection");
    }

    console.log("[getOrCreateAttemptRecord] Executing raw SQL query...");
    
    // Sprawdź, czy rekord istnieje
    const [rows] = await connection.execute(
      'SELECT * FROM angle_attempts WHERE ipAddress = ?',
      [ipAddress]
    );

    console.log("[getOrCreateAttemptRecord] Raw SQL result:", rows);

    if (rows && Array.isArray(rows) && rows.length > 0) {
      console.log("[getOrCreateAttemptRecord] Found existing record");
      return rows[0];
    }

    console.log("[getOrCreateAttemptRecord] No record found, creating new...");
    await connection.execute(
      'INSERT INTO angle_attempts (ipAddress, failedAttempts) VALUES (?, ?)',
      [ipAddress, 0]
    );

    const [newRows] = await connection.execute(
      'SELECT * FROM angle_attempts WHERE ipAddress = ?',
      [ipAddress]
    );

    console.log("[getOrCreateAttemptRecord] Created new record:", newRows);
    return newRows[0];
  } catch (error) {
    console.error("[getOrCreateAttemptRecord] Error:", error);
    throw error;
  }
}