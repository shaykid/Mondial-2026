// סכמת מסד הנתונים של מונדיאל 2026 - MySQL 8 / utf8mb4
// מופעלת על-ידי `npm run db:init` (יוצר טבלאות אם לא קיימות)

module.exports = [

  // ────────── משתמשים ──────────
  `CREATE TABLE IF NOT EXISTS users (
    id            INT             AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(190)    NOT NULL UNIQUE,
    name          VARCHAR(120)    NOT NULL,
    phone_number  VARCHAR(32)     NULL,
    preferred_language VARCHAR(8) NOT NULL DEFAULT 'he',
    profile_image_url VARCHAR(500) NULL,
    department    VARCHAR(120)    NULL,
    password_hash VARCHAR(120)    NOT NULL,
    password_changed TINYINT(1)   NOT NULL DEFAULT 0,
    is_admin      TINYINT(1)      NOT NULL DEFAULT 0,
    can_guess_groups TINYINT(1)   NOT NULL DEFAULT 0,
    role          ENUM('user','manager','admin') NOT NULL DEFAULT 'user',
    is_guest      TINYINT(1)      NOT NULL DEFAULT 0,
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ────────── קבוצות ──────────
  // code הוא קוד flagcdn (לדוגמה: 'br', 'gb-sct')
  `CREATE TABLE IF NOT EXISTS teams (
    code          VARCHAR(10)     NOT NULL PRIMARY KEY,
    name_en       VARCHAR(80)     NOT NULL,
    name_he       VARCHAR(80)     NOT NULL,
    name_ar       VARCHAR(80)     NULL,
    group_letter  CHAR(1)         NOT NULL,
    INDEX idx_teams_group (group_letter)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ────────── שחקנים ──────────
  `CREATE TABLE IF NOT EXISTS players (
    id            INT             AUTO_INCREMENT PRIMARY KEY,
    external_id   INT             NULL UNIQUE,
    name_en       VARCHAR(160)    NOT NULL,
    name_he       VARCHAR(160)    NOT NULL,
    country_en    VARCHAR(120)    NULL,
    country_he    VARCHAR(120)    NULL,
    team_code     VARCHAR(10)     NULL,
    image_url     VARCHAR(500)    NULL,
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_players_name_en (name_en),
    INDEX idx_players_country_en (country_en),
    CONSTRAINT fk_players_team FOREIGN KEY (team_code) REFERENCES teams(code) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ────────── משחקים ──────────
  // status: scheduled / live / finished
  `CREATE TABLE IF NOT EXISTS matches (
    id            INT             NOT NULL PRIMARY KEY,
    stage         VARCHAR(40)     NOT NULL DEFAULT 'group',
    group_letter  CHAR(1)         NULL,
    home_code     VARCHAR(10)     NULL,
    away_code     VARCHAR(10)     NULL,
    home_label_he VARCHAR(120)    NULL,
    home_label_en VARCHAR(120)    NULL,
    home_label_ar VARCHAR(120)    NULL,
    away_label_he VARCHAR(120)    NULL,
    away_label_en VARCHAR(120)    NULL,
    away_label_ar VARCHAR(120)    NULL,
    kickoff       DATETIME        NOT NULL,
    venue         VARCHAR(160)    NULL,
    home_score    INT             NULL,
    away_score    INT             NULL,
    status        VARCHAR(20)     NOT NULL DEFAULT 'scheduled',
    updated_at    DATETIME        NULL,
    INDEX idx_matches_kickoff (kickoff),
    INDEX idx_matches_status (status),
    CONSTRAINT fk_matches_home FOREIGN KEY (home_code) REFERENCES teams(code),
    CONSTRAINT fk_matches_away FOREIGN KEY (away_code) REFERENCES teams(code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ────────── ניחושים ──────────
  `CREATE TABLE IF NOT EXISTS predictions (
    id            INT             AUTO_INCREMENT PRIMARY KEY,
    user_id       INT             NOT NULL,
    match_id      INT             NOT NULL,
    home_score    INT             NOT NULL,
    away_score    INT             NOT NULL,
    points        INT             NOT NULL DEFAULT 0,
    submitted_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_predictions_user_match (user_id, match_id),
    INDEX idx_predictions_user (user_id),
    INDEX idx_predictions_match (match_id),
    CONSTRAINT fk_predictions_user  FOREIGN KEY (user_id)  REFERENCES users(id)   ON DELETE CASCADE,
    CONSTRAINT fk_predictions_match FOREIGN KEY (match_id) REFERENCES matches(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ────────── ניחושים מיוחדים (אלופה / סגן / מלך) ──────────
  `CREATE TABLE IF NOT EXISTS special_predictions (
    user_id        INT            NOT NULL PRIMARY KEY,
    champion_code  VARCHAR(10)    NULL,
    runner_up_code VARCHAR(10)    NULL,
    top_scorer_player_id INT      NULL,
    top_scorer     VARCHAR(120)   NULL,
    submitted_at   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_special_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_special_player FOREIGN KEY (top_scorer_player_id) REFERENCES players(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ────────── לוז ופרסים ──────────
  `CREATE TABLE IF NOT EXISTS schedule_items (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ────────── מסמכי פוטר + צור קשר ──────────
  `CREATE TABLE IF NOT EXISTS footer_documents (
    id            INT             AUTO_INCREMENT PRIMARY KEY,
    doc_key       VARCHAR(40)     NOT NULL UNIQUE,
    label         VARCHAR(120)    NOT NULL,
    file_url      VARCHAR(500)    NULL,
    file_type     VARCHAR(20)     NOT NULL DEFAULT 'pdf',
    sort_order    INT             NOT NULL DEFAULT 0,
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_footer_docs_sort (sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS contact_messages (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ────────── ניחוש קבוצתי (Guess-Groups) ──────────
  // קבוצת ניחוש: מספר חברים מחזיקים סט משותף של הימורי תוצאה (1/X/2)
  `CREATE TABLE IF NOT EXISTS guess_groups (
    id             INT             AUTO_INCREMENT PRIMARY KEY,
    name           VARCHAR(120)    NOT NULL,
    description    VARCHAR(255)    NULL,
    leader_user_id INT             NOT NULL,
    entry_cost     INT             NOT NULL DEFAULT 0,
    created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_guess_groups_leader (leader_user_id),
    CONSTRAINT fk_guess_groups_leader FOREIGN KEY (leader_user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS guess_group_members (
    id         INT      AUTO_INCREMENT PRIMARY KEY,
    group_id   INT      NOT NULL,
    user_id    INT      NOT NULL,
    role       ENUM('leader','member') NOT NULL DEFAULT 'member',
    paid_points INT     NOT NULL DEFAULT 0,
    joined_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_group_member (group_id, user_id),
    INDEX idx_group_member_user (user_id),
    CONSTRAINT fk_group_member_group FOREIGN KEY (group_id) REFERENCES guess_groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_group_member_user  FOREIGN KEY (user_id)  REFERENCES users(id)        ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // pick: home / draw / away (1 / X / 2). points = בונוס הקבוצה להימור זה לאחר סיום המשחק
  `CREATE TABLE IF NOT EXISTS guess_group_bets (
    id         INT      AUTO_INCREMENT PRIMARY KEY,
    group_id   INT      NOT NULL,
    match_id   INT      NOT NULL,
    pick       ENUM('home','draw','away') NOT NULL,
    points     INT      NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_group_match (group_id, match_id),
    INDEX idx_group_bet_match (match_id),
    CONSTRAINT fk_group_bet_group FOREIGN KEY (group_id) REFERENCES guess_groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_group_bet_match FOREIGN KEY (match_id) REFERENCES matches(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS email_campaigns (
    id                    INT             AUTO_INCREMENT PRIMARY KEY,
    created_by_user_id    INT             NULL,
    subject               VARCHAR(255)    NOT NULL,
    body                  MEDIUMTEXT      NOT NULL,
    include_login_details TINYINT(1)      NOT NULL DEFAULT 0,
    department_filter     VARCHAR(120)    NULL,
    recipient_count       INT             NOT NULL DEFAULT 0,
    attachments_json      MEDIUMTEXT      NULL,
    user_delivery_mode    VARCHAR(20)     NOT NULL DEFAULT 'smtp',
    sender_email          VARCHAR(190)    NULL,
    manager_email         VARCHAR(190)    NULL,
    manager_report_sent   TINYINT(1)      NOT NULL DEFAULT 0,
    created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email_campaigns_created (created_at),
    CONSTRAINT fk_email_campaigns_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS email_campaign_recipients (
    id                 INT             AUTO_INCREMENT PRIMARY KEY,
    campaign_id        INT             NOT NULL,
    user_id            INT             NULL,
    recipient_name     VARCHAR(120)    NULL,
    recipient_email    VARCHAR(190)    NOT NULL,
    recipient_phone    VARCHAR(32)     NULL,
    recipient_department VARCHAR(120)  NULL,
    status             VARCHAR(20)     NOT NULL DEFAULT 'pending',
    error_message      TEXT            NULL,
    sent_at            DATETIME        NULL,
    created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email_recipients_campaign (campaign_id),
    INDEX idx_email_recipients_status (status),
    CONSTRAINT fk_email_recipients_campaign FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE,
    CONSTRAINT fk_email_recipients_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ────────── תרגומים ──────────
  `CREATE TABLE IF NOT EXISTS translations (
    id                INT             AUTO_INCREMENT PRIMARY KEY,
    translation_key   VARCHAR(160)    NOT NULL,
    language_code     VARCHAR(8)      NOT NULL,
    translation_value TEXT            NOT NULL,
    updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_translations_key_lang (translation_key, language_code),
    INDEX idx_translations_lang (language_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ────────── הגדרות מערכת ──────────
  `CREATE TABLE IF NOT EXISTS settings (
    \`key\`   VARCHAR(80)    NOT NULL PRIMARY KEY,
    \`value\` TEXT           NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`

];
