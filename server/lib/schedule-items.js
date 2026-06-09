const db = require('../db');
const defaults = require('../data/schedule-items');

const SCHEDULE_ITEMS_DDL = `
  CREATE TABLE IF NOT EXISTS schedule_items (
    id              INT             AUTO_INCREMENT PRIMARY KEY,
    title           VARCHAR(160)    NOT NULL UNIQUE,
    date_label      VARCHAR(120)    NOT NULL,
    description     VARCHAR(255)    NOT NULL,
    start_at        DATETIME        NOT NULL,
    end_at          DATETIME        NOT NULL,
    sort_order      INT             NOT NULL DEFAULT 0,
    prize_slot      TINYINT         NULL,
    prize_image_url VARCHAR(500)    NULL,
    winner_user_id  INT             NULL,
    popup_enabled   TINYINT(1)      NOT NULL DEFAULT 0,
    popup_title     VARCHAR(160)    NULL,
    popup_image_url VARCHAR(500)    NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_schedule_sort (sort_order, start_at),
    INDEX idx_schedule_prize (prize_slot),
    CONSTRAINT fk_schedule_winner FOREIGN KEY (winner_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

async function ensureScheduleItemsTable(tx = db) {
  await tx.query(SCHEDULE_ITEMS_DDL);
}

async function seedScheduleItems(tx = db) {
  await ensureScheduleItemsTable(tx);
  const row = await tx.one('SELECT COUNT(*) AS n FROM schedule_items');
  if (Number(row?.n || 0) > 0) return 0;
  for (const item of defaults) {
    await tx.run(`
      INSERT INTO schedule_items (
        title, date_label, description, start_at, end_at, sort_order, prize_slot,
        prize_image_url, winner_user_id, popup_enabled, popup_title, popup_image_url
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, NULL)
    `, [
      item.title,
      item.date_label,
      item.description,
      item.start_at,
      item.end_at,
      item.sort_order,
      item.prize_slot
    ]);
  }
  return defaults.length;
}

module.exports = { scheduleDefaults: defaults, ensureScheduleItemsTable, seedScheduleItems };
