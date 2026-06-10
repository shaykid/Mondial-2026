const db = require('../db');
const defaults = require('../data/footer-documents');

const FOOTER_DOCS_DDL = `
  CREATE TABLE IF NOT EXISTS footer_documents (
    id            INT             AUTO_INCREMENT PRIMARY KEY,
    doc_key       VARCHAR(40)     NOT NULL UNIQUE,
    label         VARCHAR(120)    NOT NULL,
    file_url      VARCHAR(500)    NULL,
    file_name     VARCHAR(255)    NULL,
    file_type     VARCHAR(20)     NOT NULL DEFAULT 'pdf',
    sort_order    INT             NOT NULL DEFAULT 0,
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_footer_docs_sort (sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const CONTACT_MESSAGES_DDL = `
  CREATE TABLE IF NOT EXISTS contact_messages (
    id            INT             AUTO_INCREMENT PRIMARY KEY,
    user_id       INT             NULL,
    name          VARCHAR(120)    NOT NULL,
    phone_number  VARCHAR(32)     NULL,
    message       TEXT            NOT NULL,
    image_url     VARCHAR(500)    NULL,
    handled_at    DATETIME        NULL,
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_contact_created (created_at),
    CONSTRAINT fk_contact_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

async function ensureFooterContentTables(tx = db) {
  await tx.query(FOOTER_DOCS_DDL);
  await tx.query(CONTACT_MESSAGES_DDL);
  const handledCol = await tx.one(`
    SELECT COUNT(*) AS n
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'contact_messages'
      AND column_name = 'handled_at'
  `);
  if (!handledCol?.n) {
    await tx.query('ALTER TABLE contact_messages ADD COLUMN handled_at DATETIME NULL AFTER image_url');
  }
  // שם הקובץ המקורי שהועלה (להצגה בלוח הניהול)
  const fileNameCol = await tx.one(`
    SELECT COUNT(*) AS n
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'footer_documents'
      AND column_name = 'file_name'
  `);
  if (!fileNameCol?.n) {
    await tx.query('ALTER TABLE footer_documents ADD COLUMN file_name VARCHAR(255) NULL AFTER file_url');
  }
}

async function seedFooterDocuments(tx = db) {
  await ensureFooterContentTables(tx);
  for (const item of defaults) {
    await tx.run(`
      INSERT INTO footer_documents (doc_key, label, file_url, file_type, sort_order)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        label = VALUES(label),
        file_url = COALESCE(footer_documents.file_url, VALUES(file_url)),
        file_type = footer_documents.file_type,
        sort_order = VALUES(sort_order)
    `, [item.doc_key, item.label, item.file_url || null, item.file_type, item.sort_order]);
  }
  return defaults.length;
}

module.exports = {
  footerDocumentDefaults: defaults,
  ensureFooterContentTables,
  seedFooterDocuments
};
