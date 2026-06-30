const bcrypt = require('bcryptjs');
const path = require('path');

let db, run, get, all;

if (process.env.TURSO_DATABASE_URL) {
  // Cloud Database (Turso) for Vercel / Production
  console.log('Connecting to remote Turso database...');
  const { createClient } = require('@libsql/client/web');
  db = createClient({
    url: process.env.TURSO_DATABASE_URL.trim(),
    authToken: process.env.TURSO_AUTH_TOKEN ? process.env.TURSO_AUTH_TOKEN.trim() : undefined,
  });

  run = async (sql, params = []) => {
    try {
      const res = await db.execute({ sql, args: params });
      const lastInsertRowid = res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null;
      return { id: lastInsertRowid, changes: res.rowsAffected };
    } catch (err) {
      console.error('Turso Execute Run Error:', err, 'SQL:', sql, 'Params:', params);
      throw err;
    }
  };

  get = async (sql, params = []) => {
    try {
      const res = await db.execute({ sql, args: params });
      return res.rows[0] || null;
    } catch (err) {
      console.error('Turso Execute Get Error:', err, 'SQL:', sql, 'Params:', params);
      throw err;
    }
  };

  all = async (sql, params = []) => {
    try {
      const res = await db.execute({ sql, args: params });
      return res.rows;
    } catch (err) {
      console.error('Turso Execute All Error:', err, 'SQL:', sql, 'Params:', params);
      throw err;
    }
  };
} else {
  // Local Database (sqlite3) for Development
  console.log('Connecting to local SQLite database...');
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'database.sqlite');
  db = new sqlite3.Database(dbPath);

  // Enable foreign keys
  db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON;');
  });

  run = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  };

  get = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  };

  all = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  };
}

// Initialize schema and seed data
async function initDatabase() {
  console.log('Initializing database schema...');

  // Create Users table
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Courses table
  await run(`
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      price INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      duration_days INTEGER DEFAULT 90,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Modules table
  await run(`
    CREATE TABLE IF NOT EXISTS modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Create Lessons table
  await run(`
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      youtube_link TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Create Access/Subscriptions table
  await run(`
    CREATE TABLE IF NOT EXISTS access (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      current_lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
      PRIMARY KEY (user_id, course_id)
    )
  `);

  // Create User Progress table
  await run(`
    CREATE TABLE IF NOT EXISTS user_progress (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, lesson_id)
    )
  `);

  // Create Payments table
  await run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      kaspi_tx_id TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Database schema created successfully.');

  // Seeding default courses if table is empty
  const coursesCount = await get('SELECT count(*) as count FROM courses');
  if (coursesCount.count === 0) {
    console.log('Seed: Database is empty. Seeding default courses and modules/lessons...');

    // 1. Практикум "Стресс"
    const stressCourse = await run(
      'INSERT INTO courses (title, description, price, status, duration_days) VALUES (?, ?, ?, ?, ?)',
      [
        'Практикум "Стресс"',
        'Определение стрессовых реакций по лицу. Практические методы саморегуляции.',
        10000,
        'published',
        30
      ]
    );

    // Modules & Lessons for Stress
    const stressM1 = await run('INSERT INTO modules (course_id, title, sort_order) VALUES (?, ?, ?)', [stressCourse.id, 'Блок 1: Природа стресса', 1]);
    const stressM2 = await run('INSERT INTO modules (course_id, title, sort_order) VALUES (?, ?, ?)', [stressCourse.id, 'Блок 2: Практика и инструменты', 2]);

    await run('INSERT INTO lessons (module_id, title, youtube_link, sort_order) VALUES (?, ?, ?, ?)', [
      stressM1.id,
      'Введение: Стресс и его отражение на лице',
      'https://www.youtube.com/watch?v=W_CXOVWHzXQ',
      1
    ]);
    await run('INSERT INTO lessons (module_id, title, youtube_link, sort_order) VALUES (?, ?, ?, ?)', [
      stressM1.id,
      'Маркеры хронического стресса по чертам лица',
      'https://www.youtube.com/watch?v=W_CXOVWHzXQ',
      2
    ]);
    await run('INSERT INTO lessons (module_id, title, youtube_link, sort_order) VALUES (?, ?, ?, ?)', [
      stressM2.id,
      'Методики экспресс-саморегуляции',
      'https://www.youtube.com/watch?v=W_CXOVWHzXQ',
      1
    ]);

    // 2. Практикум "Психопат"
    const psychopathCourse = await run(
      'INSERT INTO courses (title, description, price, status, duration_days) VALUES (?, ?, ?, ?, ?)',
      [
        'Практикум "Психопат"',
        'Выявление скрытой агрессии и манипуляций. Разбор профиля "тёмной триады".',
        10000,
        'published',
        30
      ]
    );

    const psychM1 = await run('INSERT INTO modules (course_id, title, sort_order) VALUES (?, ?, ?)', [psychopathCourse.id, 'Модуль 1: Лицо манипулятора', 1]);
    await run('INSERT INTO lessons (module_id, title, youtube_link, sort_order) VALUES (?, ?, ?, ?)', [
      psychM1.id,
      'Психотипы тёмной триады',
      'https://www.youtube.com/watch?v=W_CXOVWHzXQ',
      1
    ]);
    await run('INSERT INTO lessons (module_id, title, youtube_link, sort_order) VALUES (?, ?, ?, ?)', [
      psychM1.id,
      'Скрытые угрозы: Распознаем психопата по мимике',
      'https://www.youtube.com/watch?v=W_CXOVWHzXQ',
      2
    ]);

    // 3. Базовый
    const baseCourse = await run(
      'INSERT INTO courses (title, description, price, status, duration_days) VALUES (?, ?, ?, ?, ?)',
      [
        'Базовый курс',
        'Фундамент метода. 10 модулей разбора основных черт лица и домашние задания.',
        399000,
        'published',
        90
      ]
    );

    const baseM1 = await run('INSERT INTO modules (course_id, title, sort_order) VALUES (?, ?, ?)', [baseCourse.id, 'Модуль 1: Форма лица и челюсть', 1]);
    const baseM2 = await run('INSERT INTO modules (course_id, title, sort_order) VALUES (?, ?, ?)', [baseCourse.id, 'Модуль 2: Глаза и брови', 2]);

    await run('INSERT INTO lessons (module_id, title, youtube_link, sort_order) VALUES (?, ?, ?, ?)', [
      baseM1.id,
      'Основы физиогномики и пропорции лица',
      'https://www.youtube.com/watch?v=W_CXOVWHzXQ',
      1
    ]);
    await run('INSERT INTO lessons (module_id, title, youtube_link, sort_order) VALUES (?, ?, ?, ?)', [
      baseM1.id,
      'Нижняя челюсть: Воля, агрессия и напор',
      'https://www.youtube.com/watch?v=W_CXOVWHzXQ',
      2
    ]);
    await run('INSERT INTO lessons (module_id, title, youtube_link, sort_order) VALUES (?, ?, ?, ?)', [
      baseM2.id,
      'Глаза: Восприимчивость и скрытность',
      'https://www.youtube.com/watch?v=W_CXOVWHzXQ',
      1
    ]);

    // 4. Эксперт
    await run(
      'INSERT INTO courses (title, description, price, status, duration_days) VALUES (?, ?, ?, ?, ?)',
      [
        'Курс "Эксперт"',
        'Все материалы Базового + углубленное чтение морщин, кожи, ZOOM-разборы и чат обратной связи.',
        699000,
        'published',
        180
      ]
    );

    // 5. Мастер PRO
    await run(
      'INSERT INTO courses (title, description, price, status, duration_days) VALUES (?, ?, ?, ?, ?)',
      [
        'Курс "Мастер PRO"',
        'Личная работа с Жанерке, разбор вашего окружения, синемология и бессрочный доступ.',
        999000,
        'published',
        36500 // ~100 years
      ]
    );

    console.log('Seed: Finished seeding courses, modules, and lessons.');
  }

  // Seeding default administrator if not exists
  const adminEmail = 'admin@faceread.kz';
  const existingAdmin = await get('SELECT * FROM users WHERE email = ?', [adminEmail]);
  if (!existingAdmin) {
    const adminPasswordHash = await bcrypt.hash('AdminPassword123', 10);
    await run(
      'INSERT INTO users (email, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)',
      [adminEmail, adminPasswordHash, 'Жанерке Скакова', 'admin', 'active']
    );
    console.log('Seed: Default administrator account seeded (admin@faceread.kz / AdminPassword123)');
  }

  // Seeding default student if not exists
  const studentEmail = 'student@faceread.kz';
  const existingStudent = await get('SELECT * FROM users WHERE email = ?', [studentEmail]);
  if (!existingStudent) {
    const studentPasswordHash = await bcrypt.hash('StudentPassword123', 10);
    const studentResult = await run(
      'INSERT INTO users (email, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)',
      [studentEmail, studentPasswordHash, 'Иван Тестов', 'student', 'active']
    );

    const now = new Date();
    
    const exp1 = new Date();
    exp1.setDate(now.getDate() + 30);
    const exp1Str = exp1.toISOString().replace('T', ' ').substr(0, 19);

    const exp3 = new Date();
    exp3.setDate(now.getDate() + 90);
    const exp3Str = exp3.toISOString().replace('T', ' ').substr(0, 19);

    // Grant access 1 (Stress)
    await run(
      'INSERT INTO access (user_id, course_id, expires_at, current_lesson_id) VALUES (?, 1, ?, 1)',
      [studentResult.id, exp1Str]
    );

    // Grant access 3 (Base)
    await run(
      'INSERT INTO access (user_id, course_id, expires_at, current_lesson_id) VALUES (?, 3, ?, 6)',
      [studentResult.id, exp3Str]
    );

    // Seed transaction payments
    await run(
      'INSERT INTO payments (user_id, course_id, amount, kaspi_tx_id, status) VALUES (?, ?, ?, ?, ?)',
      [studentResult.id, 1, 10000, 'KSP_INIT_STRESS', 'paid']
    );
    await run(
      'INSERT INTO payments (user_id, course_id, amount, kaspi_tx_id, status) VALUES (?, ?, ?, ?, ?)',
      [studentResult.id, 3, 399000, 'KSP_INIT_BASE', 'paid']
    );

    console.log('Seed: Default student account seeded (student@faceread.kz / StudentPassword123)');
  }
}

module.exports = {
  db,
  run,
  get,
  all,
  initDatabase
};
