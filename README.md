# 🏆 מונדיאל 2026 · מערכת ניחושי חברת שיח

מערכת מלאה לניהול משחק ניחושים פנים-ארגוני לגביע העולם 2026.
**React + Node.js + MySQL 8** · עיצוב מגזין ספורט עיתונאי · עברית RTL.

---

## ⚡ התחלה בפקודה אחת

נדרש: **Node.js 18+** ו-**MySQL 8** רץ ונגיש.

```bash
# 1) שכפול
git clone <repo> mondial2026 && cd mondial2026

# 2) עריכת קובץ סביבה (פרטי MySQL + סיסמת מנהל)
cp server/.env.example server/.env
nano server/.env

# 3) פקודה אחת מקצה לקצה - מתקין הכל, יוצר DB, מאכלס, ומפעיל
npm install && npm run all
```

`npm run all` עושה את **הכל**:
1. מתקין את כל החבילות (root + server + client)
2. יוצר את ה-DATABASE ב-MySQL
3. יוצר את כל הטבלאות
4. מאכלס 48 קבוצות, 72 משחקים, משתמש מנהל, הגדרות
5. מריץ במקביל את השרת (פורט 4026) ואת ה-Vite dev של הלקוח (פורט 5173)

לאחר מכן: גלוש ל-**http://localhost:5173** והתחבר עם `admin@company.local` / הסיסמה מה-.env.

---

## 📜 כל הפקודות

```bash
npm install                # שלב 1 - מתקין את ה-root (concurrently)
npm run install:all        # מתקין את הכל (root + server + client)

# DB
npm run db:create          # יוצר את ה-DATABASE (utf8mb4)
npm run db:init            # יוצר את כל הטבלאות
npm run db:seed            # ממלא 48 קבוצות, 72 משחקים, מנהל, הגדרות
npm run db:setup           # שלושת אלה ברצף - הכל בבת אחת
npm run db:reset           # ⚠️ DROP DATABASE + setup מחדש (פיתוח בלבד!)

# הפעלה
npm run server             # רק שרת (production: node server.js)
npm run server:dev         # שרת בנודמון (אוטו-ריסטרט)
npm run client             # רק לקוח (Vite dev server)
npm run client:build       # בונה את הלקוח לפרודקשן (client/dist)
npm run dev                # שרת + לקוח במקביל (concurrently)
npm run prod               # build של הלקוח + שרת (יחיד) שמגיש את הכל
npm start                  # === npm run dev
npm run all                # setup + dev = הכל מהתחלה
```

---

## 🗂️ קונפיגורציה (`server/.env`)

```ini
PORT=4026
JWT_SECRET=<מחרוזת אקראית ארוכה - שנה לפרודקשן!>

ADMIN_EMAIL=admin@company.local
ADMIN_PASSWORD=changeme123

# MySQL 8
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=mondial2026

# אופציונלי - Unix socket במקום TCP (מהיר יותר על שרת יחיד)
# DB_SOCKET=/var/run/mysqld/mysqld.sock

# סקרייפר תוצאות: manual / espn / api-football
SCRAPER_MODE=manual
API_FOOTBALL_KEY=

# נעילת ניחושים - שעות לפני בעיטת הפתיחה
LOCK_HOURS_BEFORE=1
```

---

## 🔐 פרטי מנהל

נוצרים בהרצה הראשונה של `npm run db:seed` (או `npm run db:setup`) על-פי `ADMIN_EMAIL` ו-`ADMIN_PASSWORD` ב-`.env`.

**⚠️ חובה לשנות את הסיסמה מ-`changeme123`** לפני ההרצה הראשונה!

---

## 📁 מבנה הפרויקט

```
mondial2026/
├── package.json              # ⭐ root - הסקריפטים המאוחדים
├── README.md
├── server/                   # Node.js + Express + MySQL 8
│   ├── package.json
│   ├── .env.example
│   ├── db.js                 # mysql2 pool + helpers (query/one/run/tx)
│   ├── schema.js             # כל ה-CREATE TABLE
│   ├── seed.js               # אכלוס DB
│   ├── server.js             # נקודת כניסה + cron
│   ├── scripts/
│   │   ├── db-create.js      # CREATE DATABASE IF NOT EXISTS
│   │   ├── db-init.js        # מריץ את schema.js
│   │   └── db-reset.js       # DROP + setup
│   ├── data/
│   │   ├── teams.js          # 48 קבוצות
│   │   └── matches.js        # 72 משחקי בית
│   ├── middleware/auth.js    # JWT
│   ├── routes/               # auth · matches · predictions · leaderboard · admin
│   └── services/             # scoring · scraper
└── client/                   # React 18 + Vite
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── public/favicon.svg
    └── src/
        ├── api/client.js     # axios + JWT
        ├── components/       # Header · Flag · MatchCard · ProtectedRoute
        ├── context/AuthContext.jsx
        ├── pages/            # Login · Home · Predictions · Matches · Groups · Leaderboard · Admin
        ├── styles/theme.css  # מערכת עיצוב מלאה
        ├── App.jsx
        └── main.jsx
```

---

## 🗄️ סכמת MySQL 8

InnoDB · utf8mb4 · `utf8mb4_unicode_ci` - תמיכה מלאה בעברית ובאמוג'ים.

```
users               id, email (UNIQUE), name, password_hash, is_admin, created_at
teams               code (PK VARCHAR(10)), name_en, name_he, group_letter
matches             id (PK), stage, group_letter, home_code (FK), away_code (FK),
                    kickoff DATETIME, venue, home_score, away_score, status, updated_at
predictions         id (AUTO_INCREMENT), user_id (FK CASCADE), match_id (FK),
                    home_score, away_score, points, submitted_at
                    UNIQUE(user_id, match_id)
special_predictions user_id (PK FK CASCADE), champion_code, runner_up_code, top_scorer
settings            `key` (PK VARCHAR(80)), `value`
```

כל ה-FK עם `ON DELETE CASCADE` למשתמש (מחיקת משתמש מנקה ניחושים).

---

## 🎯 שיטת הניקוד

| הישג                        | ברירת מחדל |
|-----------------------------|------------|
| ניחוש מדויק (3:1 = 3:1)      | 5 נק'      |
| כיוון נכון (1/X/2)            | 3 נק'      |
| הפרש שערים נכון (תוספת)      | +1 נק'     |
| **בונוס:** אלופה             | 20 נק'     |
| **בונוס:** סגן האלופה        | 10 נק'     |
| **בונוס:** מלך השערים        | 15 נק'     |

כל המשקלים עריכים בזמן אמת מהפאנל (`/admin → הגדרות`).
אחרי שינוי לחץ **"חשב מחדש את כל הנקודות"** בלשונית "פעולות".

---

## 🤖 עדכון תוצאות

3 מצבים, ניתנים להחלפה ב-`.env` או דרך הפאנל:

| מצב            | תיאור                                                      |
|-----------------|-----------------------------------------------------------|
| `manual`        | ידני בלבד (ברירת מחדל) - הזנה דרך פאנל הניהול             |
| `espn`          | סקרייפינג HTML מ-ESPN (חינמי, שביר)                       |
| `api-football`  | API מסחרי (100 קריאות/יום חינם, מומלץ לאמינות)            |

`api-football`: הירשם ב-https://dashboard.api-football.com, העתק key, הוסף ל-`.env`.

**לוז קרון אוטומטי:**
- כל יום ב-04:00 בלילה
- כל שעתיים במהלך הטורניר (11.6.26 - 20.7.26)
- הפעלה ידנית מתוך הפאנל: "פעולות" → "הרץ עדכון עכשיו"

---

## 🏟️ הקבוצות

72 משחקי בתים זרועים מראש לפי הגרלת 5.12.2025 + פלייאוף מרץ 2026:

| בית | קבוצות |
|-----|--------|
| A   | מקסיקו · דרום קוריאה · דרום אפריקה · צ׳כיה          |
| B   | קנדה · שוויץ · קטר · בוסניה                          |
| C   | ברזיל · מרוקו · סקוטלנד · האיטי                      |
| D   | ארה״ב · פרגוואי · אוסטרליה · טורקיה                  |
| E   | גרמניה · אקוודור · חוף השנהב · קוראסאו                |
| F   | הולנד · יפן · תוניסיה · שוודיה                        |
| G   | בלגיה · איראן · מצרים · ניו זילנד                    |
| H   | ספרד · אורוגוואי · ערב הסעודית · קייפ ורדה            |
| I   | צרפת · סנגל · נורווגיה · עיראק                       |
| J   | ארגנטינה · אוסטריה · אלג׳יריה · ירדן                  |
| K   | פורטוגל · קולומביה · אוזבקיסטן · קונגו                |
| L   | אנגליה · קרואטיה · פנמה · גאנה                        |

**שלב הנוקאאוט** אינו זרוע מראש - המנהל יוסיף משחקים דרך:
```
POST /api/admin/matches
{ "stage":"round_of_32", "home_code":"ar", "away_code":"fr",
  "kickoff":"2026-06-28T20:00:00Z", "venue":"MetLife Stadium, NJ" }
```

---

## 🛣️ API

### פתוח
- `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me`

### מצריך התחברות
- `GET  /api/teams` · `/matches` · `/matches/:id` · `/standings`
- `GET  /api/predictions/my`
- `POST /api/predictions/match/:id` · `/predictions/special`
- `GET  /api/leaderboard`

### מנהל בלבד
- `GET    /api/admin/overview · /users · /settings`
- `DELETE /api/admin/users/:id`
- `GET    /api/admin/users/:id/predictions`
- `POST   /api/admin/matches` (הוסף/עדכן · לנוקאאוט)
- `POST   /api/admin/matches/:id/score`
- `DELETE /api/admin/matches/:id/score`
- `POST   /api/admin/scrape-now` · `/recalculate`
- `POST   /api/admin/settings`

### בריאות
- `GET /api/health` - בודק חיבור ל-MySQL ומחזיר `{ ok: true, db: "mysql", t: "..." }`

---

## 🚀 הפצה לפרודקשן

### VPS אחד עם nginx (מומלץ)

```bash
# הכנה
git clone ... mondial2026 && cd mondial2026
cp server/.env.example server/.env
nano server/.env                       # סיסמאות, MySQL, JWT_SECRET

# התקנת MySQL 8 (Ubuntu)
sudo apt install mysql-server
sudo mysql_secure_installation

# התקנה + DB + build
npm install
npm run install:all
npm run db:setup
npm run client:build

# הפעלה עם pm2
npm install -g pm2
pm2 start server/server.js --name mondial2026
pm2 save && pm2 startup
```

מאחורי nginx על `mondial.example.com` → `localhost:4026`. השרת מגיש את `client/dist`.

### Docker (לעתיד)
שני שירותים ב-`docker-compose.yml`: `mysql:8` ו-`node` שמריץ `npm run prod`.
חבר ב-`DB_HOST=mysql` ב-`.env`.

---

## 🛠️ שינויים נפוצים

- **משקלי ניקוד**: פאנל → הגדרות → שמור → פעולות → "חשב מחדש"
- **הוספת משחק נוקאאוט**: POST `/api/admin/matches` (ראה למעלה)
- **בונוסי אלופה/סגן/מלך שערים**: פאנל → הגדרות → "תוצאות סופיות" → שמור → "חשב מחדש"
- **איפוס מלא**: `npm run db:reset` ⚠️ הורס את כל הנתונים!

---

## 📦 תלויות מרכזיות

**שרת:** express · mysql2 · jsonwebtoken · bcryptjs · node-cron · axios · cheerio · cors · dotenv

**לקוח:** react 18 · react-dom · react-router-dom 6 · axios · vite 5

**Root:** concurrently (להרצה במקביל של שרת + לקוח)

**פונטים** (Google Fonts CDN): Bebas Neue · Heebo · Frank Ruhl Libre · Anton

**דגלים** (flagcdn.com CDN): כולל gb-sct לסקוטלנד, gb-eng לאנגליה

---

## 🐛 פתרון בעיות

| בעיה                                                | פתרון                                                       |
|------------------------------------------------------|--------------------------------------------------------------|
| `ECONNREFUSED 127.0.0.1:3306`                       | MySQL לא רץ. `sudo systemctl start mysql`                  |
| `Access denied for user 'root'@'localhost'`         | סיסמה שגויה ב-`.env` או הרשאות חסרות                       |
| `ER_NO_SUCH_TABLE`                                  | טרם הרצת `npm run db:init && npm run db:seed`              |
| `אין גישה ל-DATABASE`                                | טרם הרצת `npm run db:create`                                |
| הפקודה `npm run all` נעצרת באמצע                    | בדוק שה-MySQL רץ ושפרטי ה-.env מדויקים                     |
| השרת לא מאזין                                       | בדוק שאין תהליך אחר על PORT (`lsof -i :4026`)              |

---

בנוי לתאריך ה-11.6.2026 🇲🇽 vs 🇿🇦 באצטדיון אצטקה.
