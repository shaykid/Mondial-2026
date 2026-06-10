// אימות JWT - דורש Bearer token ב-Authorization header
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'mondial2026-secret';

function auth(required = true) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      if (!required) return next();
      return res.status(401).json({ error: 'יש להתחבר תחילה' });
    }
    try {
      req.user = jwt.verify(token, SECRET);
      next();
    } catch (e) {
      return res.status(401).json({ error: 'הזדהות לא תקינה' });
    }
  };
}

function adminOnly(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'גישה זו מוגבלת למנהלי מערכת' });
  }
  next();
}

// גישה למנהל מערכת מלא (admin) או למנהל-משנה (manager)
function managerOrAdmin(req, res, next) {
  if (!req.user || !(req.user.isAdmin || req.user.role === 'manager')) {
    return res.status(403).json({ error: 'גישה זו מוגבלת לצוות הניהול' });
  }
  next();
}

// תפקיד אפקטיבי מתוך שורת המשתמש. is_admin הוא הדגל הסמכותי לתאימות לאחור:
// כל שורה עם is_admin=1 נחשבת admin גם אם עמודת role נשארה בברירת המחדל 'user'.
function effectiveRole(user) {
  if (user.is_admin) return 'admin';
  return user.role || 'user';
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin, role: effectiveRole(user) },
    SECRET,
    { expiresIn: '40d' }
  );
}

module.exports = { auth, adminOnly, managerOrAdmin, effectiveRole, signToken };
