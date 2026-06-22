const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { initDatabase, run, get, all } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'ZHANERKE_LMS_SECRET_KEY_2026';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files from root
app.use(express.static(path.join(__dirname)));
// Support asset folders explicitly
app.use('/Фото', express.static(path.join(__dirname, 'Фото')));
app.use('/Лого и картинки ', express.static(path.join(__dirname, 'Лого и картинки ')));
app.use('/Дипломы и Сертификаты', express.static(path.join(__dirname, 'Дипломы и Сертификаты')));

// Authentication Middleware
const authenticateUser = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await get('SELECT id, email, name, role, status FROM users WHERE id = ?', [decoded.id]);
    if (!user || user.status !== 'active') {
      res.clearCookie('token');
      req.user = null;
    } else {
      req.user = user;
    }
  } catch (err) {
    res.clearCookie('token');
    req.user = null;
  }
  next();
};

const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется авторизация.' });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Доступ запрещен. Требуются права администратора.' });
  }
  next();
};

app.use(authenticateUser);

// --- AUTH API ---

// Register student
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Пожалуйста, заполните все поля.' });
  }

  try {
    const existing = await get('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing) {
      return res.status(400).json({ error: 'Пользователь с таким email уже зарегистрирован.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await run(
      'INSERT INTO users (email, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)',
      [email.toLowerCase().trim(), hash, name.trim(), 'student', 'active']
    );

    const token = jwt.sign({ id: result.id, email, role: 'student' }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });

    res.json({
      user: { id: result.id, email, name, role: 'student' }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при регистрации.' });
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Введите email и пароль.' });
  }

  try {
    const user = await get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      return res.status(400).json({ error: 'Неверный email или пароль.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Ваш аккаунт заблокирован или приостановлен.' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(400).json({ error: 'Неверный email или пароль.' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });

    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при авторизации.' });
  }
});

// Logout user
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// Get current user info
app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ user: null });
  }
  res.json({ user: req.user });
});


// --- COURSES & STUDENT API ---

// Get published courses list for landing/catalog
app.get('/api/courses', async (req, res) => {
  try {
    const courses = await all('SELECT * FROM courses WHERE status = "published" ORDER BY price ASC');
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: 'Не удалось загрузить список курсов.' });
  }
});

// Get purchased courses (for student dashboard)
app.get('/api/my-courses', requireAuth, async (req, res) => {
  try {
    const myCourses = await all(`
      SELECT c.*, a.start_date, a.expires_at, a.current_lesson_id,
             (a.expires_at < datetime('now', 'localtime')) as is_expired
      FROM access a
      JOIN courses c ON a.course_id = c.id
      WHERE a.user_id = ?
    `, [req.user.id]);

    // Enhance courses with progress info (total lessons vs completed)
    for (let course of myCourses) {
      const lessons = await all(`
        SELECT l.id FROM lessons l
        JOIN modules m ON l.module_id = m.id
        WHERE m.course_id = ?
      `, [course.id]);

      const completed = await all(`
        SELECT up.lesson_id FROM user_progress up
        JOIN lessons l ON up.lesson_id = l.id
        JOIN modules m ON l.module_id = m.id
        WHERE up.user_id = ? AND m.course_id = ?
      `, [req.user.id, course.id]);

      course.total_lessons = lessons.length;
      course.completed_lessons_count = completed.length;
    }

    res.json(myCourses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить ваши курсы.' });
  }
});

// Get course lessons (drip content tree + state)
app.get('/api/courses/:courseId/lessons', requireAuth, async (req, res) => {
  const { courseId } = req.params;
  try {
    // 1. Check access
    const subscription = await get(`
      SELECT *, (expires_at < datetime('now', 'localtime')) as is_expired
      FROM access 
      WHERE user_id = ? AND course_id = ?
    `, [req.user.id, courseId]);

    if (!subscription) {
      return res.status(403).json({ error: 'У вас нет доступа к этому курсу. Пожалуйста, оплатите подписку.' });
    }

    if (subscription.is_expired) {
      return res.status(403).json({
        error: 'Срок действия вашей подписки истек.',
        expired: true,
        expires_at: subscription.expires_at
      });
    }

    // 2. Fetch modules
    const modules = await all('SELECT * FROM modules WHERE course_id = ? ORDER BY sort_order ASC, id ASC', [courseId]);
    
    // 3. Fetch lessons
    const lessons = await all(`
      SELECT l.*, m.id as module_id
      FROM lessons l
      JOIN modules m ON l.module_id = m.id
      WHERE m.course_id = ?
      ORDER BY m.sort_order ASC, l.sort_order ASC, l.id ASC
    `, [courseId]);

    // 4. Fetch completed lesson IDs
    const progressList = await all(`
      SELECT lesson_id FROM user_progress
      WHERE user_id = ?
    `, [req.user.id]);
    const completedLessonIds = new Set(progressList.map(p => p.lesson_id));

    // Determine unlocked state based on sequential unlock
    // Lesson 1 is always unlocked.
    // Lesson N is unlocked if Lesson N-1 is completed.
    let nextShouldBeUnlocked = true; // The first item will be unlocked

    const lessonsWithStatus = lessons.map((lesson, idx) => {
      const isCompleted = completedLessonIds.has(lesson.id);
      const isUnlocked = nextShouldBeUnlocked;
      
      // Setup condition for the next lesson
      // Next lesson is unlocked ONLY if this current one is completed
      nextShouldBeUnlocked = isCompleted;

      // Clean/secure youtube link for student: only expose embedded URL format, hide source parameters
      let embedLink = '';
      if (isUnlocked) {
        embedLink = formatYoutubeEmbed(lesson.youtube_link);
      }

      return {
        id: lesson.id,
        module_id: lesson.module_id,
        title: lesson.title,
        is_completed: isCompleted,
        is_unlocked: isUnlocked,
        youtube_link: isUnlocked ? embedLink : '' // Hide video link if locked
      };
    });

    // Group lessons inside modules
    const courseTree = modules.map(mod => {
      return {
        id: mod.id,
        title: mod.title,
        lessons: lessonsWithStatus.filter(l => l.module_id === mod.id)
      };
    });

    res.json({
      course_id: courseId,
      expires_at: subscription.expires_at,
      modules: courseTree
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить уроки курса.' });
  }
});

// Mark lesson completed -> unlocks next lesson
app.post('/api/lessons/:lessonId/complete', requireAuth, async (req, res) => {
  const { lessonId } = req.params;
  try {
    // Find lesson and course
    const lesson = await get(`
      SELECT l.*, m.course_id 
      FROM lessons l
      JOIN modules m ON l.module_id = m.id
      WHERE l.id = ?
    `, [lessonId]);

    if (!lesson) {
      return res.status(404).json({ error: 'Урок не найден.' });
    }

    // Verify course access
    const subscription = await get(`
      SELECT *, (expires_at < datetime('now', 'localtime')) as is_expired
      FROM access
      WHERE user_id = ? AND course_id = ?
    `, [req.user.id, lesson.course_id]);

    if (!subscription || subscription.is_expired) {
      return res.status(403).json({ error: 'Доступ ограничен или подписка истекла.' });
    }

    // Record completion in progress
    await run(
      'INSERT OR IGNORE INTO user_progress (user_id, lesson_id) VALUES (?, ?)',
      [req.user.id, lessonId]
    );

    // Find the next lesson in sequence to update the current_lesson_id in subscription
    const allLessons = await all(`
      SELECT l.id
      FROM lessons l
      JOIN modules m ON l.module_id = m.id
      WHERE m.course_id = ?
      ORDER BY m.sort_order ASC, l.sort_order ASC, l.id ASC
    `, [lesson.course_id]);

    const currentIndex = allLessons.findIndex(l => l.id === parseInt(lessonId));
    let nextLessonId = null;
    if (currentIndex !== -1 && currentIndex + 1 < allLessons.length) {
      nextLessonId = allLessons[currentIndex + 1].id;
      // Update subscription current lesson
      await run(
        'UPDATE access SET current_lesson_id = ? WHERE user_id = ? AND course_id = ?',
        [nextLessonId, req.user.id, lesson.course_id]
      );
    }

    res.json({
      success: true,
      next_lesson_id: nextLessonId
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при сохранении прогресса.' });
  }
});


// --- KASPI CHECKOUT & WEBHOOK SIMULATION ---

// Checkout creation
app.post('/api/payments/checkout', requireAuth, async (req, res) => {
  const { course_id } = req.body;
  if (!course_id) {
    return res.status(400).json({ error: 'Укажите ID курса.' });
  }

  try {
    const course = await get('SELECT * FROM courses WHERE id = ?', [course_id]);
    if (!course) {
      return res.status(404).json({ error: 'Курс не найден.' });
    }

    // Generate unique transaction ID
    const kaspi_tx_id = 'KSP_' + Math.random().toString(36).substr(2, 9).toUpperCase();

    // Save pending payment record
    await run(
      'INSERT INTO payments (user_id, course_id, amount, kaspi_tx_id, status) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, course_id, course.price, kaspi_tx_id, 'pending']
    );

    // In a production system, we would call the Kaspi Pay API to get a payment URL.
    // For our project, we redirect the user to our custom simulated checkout page.
    res.json({
      checkout_url: `/pay.html?tx_id=${kaspi_tx_id}`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось создать сессию оплаты.' });
  }
});

// Get payment status
app.get('/api/payments/:txId', requireAuth, async (req, res) => {
  try {
    const payment = await get('SELECT * FROM payments WHERE kaspi_tx_id = ? AND user_id = ?', [req.params.txId, req.user.id]);
    if (!payment) {
      return res.status(404).json({ error: 'Платеж не найден.' });
    }
    res.json(payment);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера.' });
  }
});

// Webhook endpoint (Simulates incoming callback from Kaspi Pay server)
app.post('/api/webhooks/kaspi', async (req, res) => {
  const { kaspi_tx_id, status } = req.body;
  if (!kaspi_tx_id || !status) {
    return res.status(400).json({ error: 'Неверные параметры вебхука.' });
  }

  try {
    // Find payment record
    const payment = await get('SELECT * FROM payments WHERE kaspi_tx_id = ?', [kaspi_tx_id]);
    if (!payment) {
      return res.status(404).json({ error: 'Платежная транзакция не найдена.' });
    }

    if (payment.status !== 'pending') {
      return res.json({ success: true, message: 'Статус уже обновлен.' });
    }

    if (status === 'paid') {
      // 1. Update Payment Status
      await run('UPDATE payments SET status = "paid" WHERE id = ?', [payment.id]);

      // 2. Fetch course configuration
      const course = await get('SELECT * FROM courses WHERE id = ?', [payment.course_id]);
      const duration = course.duration_days || 90;

      // 3. Grant access. Set expires_at
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + duration);
      // Format as YYYY-MM-DD HH:MM:SS
      const expiresAtStr = expiresAt.toISOString().replace('T', ' ').substr(0, 19);

      // Find first lesson to initialize current_lesson_id
      const firstLesson = await get(`
        SELECT l.id 
        FROM lessons l
        JOIN modules m ON l.module_id = m.id
        WHERE m.course_id = ?
        ORDER BY m.sort_order ASC, l.sort_order ASC, l.id ASC
        LIMIT 1
      `, [payment.course_id]);

      const firstLessonId = firstLesson ? firstLesson.id : null;

      // Upsert access record
      await run(`
        INSERT INTO access (user_id, course_id, expires_at, current_lesson_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, course_id) DO UPDATE SET
          start_date = datetime('now', 'localtime'),
          expires_at = ?,
          current_lesson_id = coalesce(current_lesson_id, ?)
      `, [payment.user_id, payment.course_id, expiresAtStr, firstLessonId, expiresAtStr, firstLessonId]);

      // 4. Simulate sending access email -> Log receipt to file
      const user = await get('SELECT email, name FROM users WHERE id = ?', [payment.user_id]);
      const emailContent = `
=== MOCK EMAIL SERVICE ===
To: ${user.name} <${user.email}>
Subject: Доступ к курсу "${course.title}" активирован!
------------------------------------------------------
Здравствуйте, ${user.name}!

Ваш платеж по транзакции Kaspi ${kaspi_tx_id} успешно обработан.
Сумма: ${payment.amount} KZT

Вам предоставлен доступ к курсу "${course.title}" до ${expiresAtStr}.
Вы можете войти в личный кабинет ученика по адресу: http://localhost:3000/student.html

Приятного обучения!
Команда Жанерке Скаковой.
==========================
`;
      const emailLogDir = path.join(__dirname, 'mock_emails');
      if (!fs.existsSync(emailLogDir)) {
        fs.mkdirSync(emailLogDir);
      }
      fs.writeFileSync(path.join(emailLogDir, `${kaspi_tx_id}.txt`), emailContent);
      console.log(`Mock Email generated for Transaction ${kaspi_tx_id}: saved to mock_emails/`);

      res.json({ success: true, message: 'Платеж успешно проведен, доступ открыт.' });
    } else {
      await run('UPDATE payments SET status = "failed" WHERE id = ?', [payment.id]);
      res.json({ success: true, message: 'Статус платежа обновлен на failed.' });
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Внутренняя ошибка обработчика вебхука.' });
  }
});


// --- ADMIN API ---

// Get all courses (admin version)
app.get('/api/admin/courses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const courses = await all('SELECT * FROM courses ORDER BY id DESC');
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера.' });
  }
});

// Create course
app.post('/api/admin/courses', requireAuth, requireAdmin, async (req, res) => {
  const { title, description, price, duration_days, status } = req.body;
  if (!title || price === undefined) {
    return res.status(400).json({ error: 'Название и цена обязательны.' });
  }

  try {
    const result = await run(
      'INSERT INTO courses (title, description, price, duration_days, status) VALUES (?, ?, ?, ?, ?)',
      [title, description, price, duration_days || 90, status || 'draft']
    );
    const newCourse = await get('SELECT * FROM courses WHERE id = ?', [result.id]);
    res.json(newCourse);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при создании курса.' });
  }
});

// Update course
app.put('/api/admin/courses/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { title, description, price, duration_days, status } = req.body;

  try {
    await run(
      'UPDATE courses SET title = ?, description = ?, price = ?, duration_days = ?, status = ? WHERE id = ?',
      [title, description, price, duration_days, status, id]
    );
    const updated = await get('SELECT * FROM courses WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при изменении курса.' });
  }
});

// Delete course
app.delete('/api/admin/courses/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await run('DELETE FROM courses WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при удалении.' });
  }
});

// Modules CRUD
app.get('/api/admin/courses/:courseId/modules', requireAuth, requireAdmin, async (req, res) => {
  try {
    const modules = await all('SELECT * FROM modules WHERE course_id = ? ORDER BY sort_order ASC, id ASC', [req.params.courseId]);
    res.json(modules);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка.' });
  }
});

app.post('/api/admin/courses/:courseId/modules', requireAuth, requireAdmin, async (req, res) => {
  const { title, sort_order } = req.body;
  const { courseId } = req.params;

  try {
    const result = await run(
      'INSERT INTO modules (course_id, title, sort_order) VALUES (?, ?, ?)',
      [courseId, title, sort_order || 0]
    );
    const mod = await get('SELECT * FROM modules WHERE id = ?', [result.id]);
    res.json(mod);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при создании блока.' });
  }
});

app.put('/api/admin/modules/:id', requireAuth, requireAdmin, async (req, res) => {
  const { title, sort_order } = req.body;
  try {
    await run('UPDATE modules SET title = ?, sort_order = ? WHERE id = ?', [title, sort_order, req.params.id]);
    const updated = await get('SELECT * FROM modules WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при обновлении блока.' });
  }
});

app.delete('/api/admin/modules/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await run('DELETE FROM modules WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при удалении блока.' });
  }
});

// Lessons CRUD
app.get('/api/admin/modules/:moduleId/lessons', requireAuth, requireAdmin, async (req, res) => {
  try {
    const lessons = await all('SELECT * FROM lessons WHERE module_id = ? ORDER BY sort_order ASC, id ASC', [req.params.moduleId]);
    res.json(lessons);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка.' });
  }
});

app.post('/api/admin/modules/:moduleId/lessons', requireAuth, requireAdmin, async (req, res) => {
  const { title, youtube_link, sort_order } = req.body;
  const { moduleId } = req.params;

  try {
    const result = await run(
      'INSERT INTO lessons (module_id, title, youtube_link, sort_order) VALUES (?, ?, ?, ?)',
      [moduleId, title, youtube_link, sort_order || 0]
    );
    const lesson = await get('SELECT * FROM lessons WHERE id = ?', [result.id]);
    res.json(lesson);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка создания урока.' });
  }
});

app.put('/api/admin/lessons/:id', requireAuth, requireAdmin, async (req, res) => {
  const { title, youtube_link, sort_order } = req.body;
  try {
    await run(
      'UPDATE lessons SET title = ?, youtube_link = ?, sort_order = ? WHERE id = ?',
      [title, youtube_link, sort_order, req.params.id]
    );
    const lesson = await get('SELECT * FROM lessons WHERE id = ?', [req.params.id]);
    res.json(lesson);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка изменения урока.' });
  }
});

app.delete('/api/admin/lessons/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await run('DELETE FROM lessons WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка удаления урока.' });
  }
});

// User & Access Management (Admin)
app.get('/api/admin/students', requireAuth, requireAdmin, async (req, res) => {
  try {
    const students = await all(`
      SELECT id, email, name, role, status, created_at,
             (SELECT count(*) FROM access WHERE user_id = users.id) as courses_count
      FROM users
      ORDER BY id DESC
    `);
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера.' });
  }
});

// Add student manually
app.post('/api/admin/students', requireAuth, requireAdmin, async (req, res) => {
  const { email, name, password, role } = req.body;
  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Email, имя и пароль обязательны.' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await run(
      'INSERT INTO users (email, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)',
      [email.toLowerCase().trim(), hash, name.trim(), role || 'student', 'active']
    );
    const newUser = await get('SELECT id, email, name, role, status, created_at FROM users WHERE id = ?', [result.id]);
    res.json(newUser);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует.' });
    }
    res.status(500).json({ error: 'Ошибка сервера.' });
  }
});

// Toggle student block status
app.put('/api/admin/students/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (status !== 'active' && status !== 'suspended') {
    return res.status(400).json({ error: 'Неверный статус.' });
  }

  try {
    // Prevent blocking oneself
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Вы не можете заблокировать собственную учетную запись.' });
    }

    await run('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при изменении статуса.' });
  }
});

// Grant / extend course access manually
app.post('/api/admin/students/:id/grant-access', requireAuth, requireAdmin, async (req, res) => {
  const { course_id, duration_days } = req.body;
  if (!course_id || !duration_days) {
    return res.status(400).json({ error: 'Укажите ID курса и срок доступа (в днях).' });
  }

  try {
    // Set expires_at
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(duration_days));
    const expiresAtStr = expiresAt.toISOString().replace('T', ' ').substr(0, 19);

    const firstLesson = await get(`
      SELECT l.id FROM lessons l
      JOIN modules m ON l.module_id = m.id
      WHERE m.course_id = ?
      ORDER BY m.sort_order ASC, l.sort_order ASC, l.id ASC
      LIMIT 1
    `, [course_id]);

    const firstLessonId = firstLesson ? firstLesson.id : null;

    await run(`
      INSERT INTO access (user_id, course_id, expires_at, current_lesson_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, course_id) DO UPDATE SET
        expires_at = ?,
        current_lesson_id = coalesce(current_lesson_id, ?)
    `, [req.params.id, course_id, expiresAtStr, firstLessonId, expiresAtStr, firstLessonId]);

    res.json({ success: true, expires_at: expiresAtStr });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось предоставить доступ.' });
  }
});

// Get payment transaction history logs
app.get('/api/admin/payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const logs = await all(`
      SELECT p.*, u.email as user_email, u.name as user_name, c.title as course_title
      FROM payments p
      JOIN users u ON p.user_id = u.id
      JOIN courses c ON p.course_id = c.id
      ORDER BY p.id DESC
    `);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера при загрузке логов.' });
  }
});


// Helper to convert standard Youtube URL into an embed link
function formatYoutubeEmbed(url) {
  if (!url) return '';
  // Match standard embed URL
  if (url.includes('youtube.com/embed/')) {
    return url + (url.includes('?') ? '&' : '?') + 'controls=1&rel=0&modestbranding=1';
  }
  // Match standard watch URL or short URL share
  let videoId = '';
  const watchRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = url.match(watchRegex);
  if (match && match[1]) {
    videoId = match[1];
  }
  
  if (videoId) {
    return `https://www.youtube.com/embed/${videoId}?controls=1&rel=0&modestbranding=1`;
  }
  return url; // return as-is fallback
}

// Redirect endpoints to make browser navigation clean
app.get('/student', (req, res) => {
  res.sendFile(path.join(__dirname, 'student.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin_login.html'));
});

app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Run DB init and start listening
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Zhanerke LMS Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
});
