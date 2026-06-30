document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. Мобильное меню (Burger) ---
    const burger = document.querySelector('.burger');
    const nav = document.querySelector('.nav');
    const navLinks = document.querySelectorAll('.nav a');

    if (burger) {
        burger.addEventListener('click', () => {
            nav.classList.toggle('active');
            // Анимация линий бургера (опционально можно добавить классы для крестика)
            const spans = burger.querySelectorAll('span');
            if (nav.classList.contains('active')) {
                spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
                spans[1].style.opacity = '0';
                spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
            } else {
                spans[0].style.transform = 'none';
                spans[1].style.opacity = '1';
                spans[2].style.transform = 'none';
            }
        });

        // Закрытие меню при клике на ссылку
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                nav.classList.remove('active');
                const spans = burger.querySelectorAll('span');
                spans[0].style.transform = 'none';
                spans[1].style.opacity = '1';
                spans[2].style.transform = 'none';
            });
        });
    }

    // --- 2. Анимация появления при скролле (Reveal) ---
    const revealElements = document.querySelectorAll('.reveal');

    const revealOnScroll = () => {
        const windowHeight = window.innerHeight;
        const revealPoint = 100;

        revealElements.forEach(el => {
            const revealTop = el.getBoundingClientRect().top;
            if (revealTop < windowHeight - revealPoint) {
                el.classList.add('active');
            }
        });
    };

    window.addEventListener('scroll', revealOnScroll);
    revealOnScroll(); // Проверка при загрузке


    // --- 3. Логика AI-Теста (Квиза) - удалена по запросу ---
    // --- 4. Lightbox для дипломов ---
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxClose = document.querySelector('.lightbox-close');
    const diplomaImages = document.querySelectorAll('.diploma-card img');

    if (lightbox && lightboxImg) {
        diplomaImages.forEach(img => {
            img.addEventListener('click', () => {
                lightboxImg.src = img.src;
                lightbox.classList.add('active');
                document.body.style.overflow = 'hidden'; // Отключаем скролл
            });
            img.style.cursor = 'pointer'; // Добавляем курсор-указатель
        });

        // Закрытие по крестику
        if (lightboxClose) {
            lightboxClose.addEventListener('click', () => {
                lightbox.classList.remove('active');
                document.body.style.overflow = '';
            });
        }

        // Закрытие по клику на фон
        lightbox.addEventListener('click', (e) => {
            if (e.target !== lightboxImg) {
                lightbox.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }

    // --- 5. LMS Platform Auth & Payment Integration ---
    let currentUser = null;
    let pendingCourseId = null;

    const authModal = document.getElementById('auth-modal');
    const closeAuthModal = document.getElementById('close-auth-modal');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginError = document.getElementById('login-error');
    const regError = document.getElementById('reg-error');
    const userNavStatus = document.getElementById('user-nav-status');

    // Fetch user status
    async function checkAuthStatus() {
        try {
            const res = await fetch('/api/auth/me');
            const data = await res.json();
            currentUser = data.user;
            updateNavUI();
        } catch (err) {
            console.error('Error fetching auth status:', err);
            currentUser = null;
            updateNavUI();
        }
    }

    function updateNavUI() {
        if (!userNavStatus) return;
        if (currentUser) {
            const dashboardLink = currentUser.role === 'admin' ? '/admin.html' : '/student.html';
            const dashboardName = currentUser.role === 'admin' ? 'Админка' : 'Кабинет';
            userNavStatus.innerHTML = `
                <span class="user-welcome" style="font-size: 0.95rem; color: var(--text-gray); margin-right: 5px;">Привет, <strong>${currentUser.name}</strong></span>
                <a href="${dashboardLink}" class="btn btn-outline" style="padding: 8px 18px; font-size: 0.9rem;">${dashboardName}</a>
                <button id="logout-btn" class="btn btn-link" style="color: var(--text-gray); border: none; background: transparent; cursor: pointer; font-size: 0.9rem; padding: 0; margin-left: 5px;">Выйти</button>
            `;
            // Attach logout listener
            document.getElementById('logout-btn').addEventListener('click', logout);
        } else {
            userNavStatus.innerHTML = `
                <button id="nav-login-btn" class="btn btn-primary" style="padding: 8px 18px; font-size: 0.9rem; margin-left: 10px;">Войти</button>
            `;
            document.getElementById('nav-login-btn').addEventListener('click', () => openModal());
        }
    }

    async function logout() {
        try {
            const res = await fetch('/api/auth/logout', { method: 'POST' });
            if (res.ok) {
                currentUser = null;
                updateNavUI();
                window.location.reload();
            }
        } catch (err) {
            console.error('Logout error:', err);
        }
    }

    function openModal(courseId = null) {
        if (courseId) {
            pendingCourseId = courseId;
        }
        // По умолчанию активируем вкладку регистрации при открытии модального окна
        if (tabRegister) {
            tabRegister.click();
        }
        if (authModal) {
            authModal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    }

    function closeModal() {
        if (authModal) {
            authModal.style.display = 'none';
            document.body.style.overflow = '';
            loginError.textContent = '';
            regError.textContent = '';
            const forgotError = document.getElementById('forgot-error');
            const forgotSuccess = document.getElementById('forgot-success');
            const forgotForm = document.getElementById('forgot-password-form');
            const modalTabs = document.querySelector('.modal-tabs');
            if (forgotError) forgotError.textContent = '';
            if (forgotSuccess) forgotSuccess.textContent = '';
            if (forgotForm) {
                forgotForm.reset();
                forgotForm.style.display = 'none';
            }
            if (modalTabs) modalTabs.style.display = 'flex';
            loginForm.reset();
            registerForm.reset();
        }
    }

    if (closeAuthModal) {
        closeAuthModal.addEventListener('click', closeModal);
        authModal.addEventListener('click', (e) => {
            if (e.target === authModal) {
                closeModal();
            }
        });
    }

    const forgotLink = document.getElementById('forgot-password-link');
    const backToLoginLink = document.getElementById('back-to-login-link');
    const forgotForm = document.getElementById('forgot-password-form');
    const modalTabs = document.querySelector('.modal-tabs');

    if (forgotLink && forgotForm && modalTabs) {
        forgotLink.addEventListener('click', (e) => {
            e.preventDefault();
            modalTabs.style.display = 'none';
            loginForm.style.display = 'none';
            registerForm.style.display = 'none';
            forgotForm.style.display = 'block';
        });
    }

    if (backToLoginLink && forgotForm && modalTabs) {
        backToLoginLink.addEventListener('click', (e) => {
            e.preventDefault();
            modalTabs.style.display = 'flex';
            forgotForm.style.display = 'none';
            tabLogin.click();
        });
    }

    if (tabLogin && tabRegister) {
        tabLogin.addEventListener('click', () => {
            tabLogin.classList.add('active');
            tabRegister.classList.remove('active');
            loginForm.style.display = 'block';
            registerForm.style.display = 'none';
            if (forgotForm) forgotForm.style.display = 'none';
        });

        tabRegister.addEventListener('click', () => {
            tabRegister.classList.add('active');
            tabLogin.classList.remove('active');
            registerForm.style.display = 'block';
            loginForm.style.display = 'none';
            if (forgotForm) forgotForm.style.display = 'none';
        });
    }

    // Login Form Submit
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            loginError.textContent = '';
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || 'Ошибка входа');
                }
                currentUser = data.user;
                updateNavUI();
                closeModal();

                if (pendingCourseId) {
                    processCheckout(pendingCourseId);
                    pendingCourseId = null;
                } else {
                    if (currentUser.role === 'admin') {
                        window.location.href = '/admin.html';
                    } else {
                        window.location.href = '/student.html';
                    }
                }
            } catch (err) {
                loginError.textContent = err.message;
            }
        });
    }

    // Register Form Submit
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            regError.textContent = '';
            const name = document.getElementById('reg-name').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;

            try {
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password })
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || 'Ошибка регистрации');
                }
                currentUser = data.user;
                updateNavUI();
                closeModal();

                if (pendingCourseId) {
                    processCheckout(pendingCourseId);
                    pendingCourseId = null;
                } else {
                    window.location.href = '/student.html';
                }
            } catch (err) {
                regError.textContent = err.message;
            }
        });
    }

    // Forgot Password Form Submit
    if (forgotForm) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const forgotError = document.getElementById('forgot-error');
            const forgotSuccess = document.getElementById('forgot-success');
            forgotError.textContent = '';
            forgotSuccess.textContent = '';
            
            const email = document.getElementById('forgot-email').value;
            
            try {
                const res = await fetch('/api/auth/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || 'Ошибка запроса сброса пароля');
                }
                if (data.link) {
                    forgotSuccess.innerHTML = `${data.message}<br><a href="${data.link}" target="_blank" style="color: var(--gold); word-break: break-all; display: inline-block; margin-top: 10px;">${data.link}</a>`;
                } else {
                    forgotSuccess.textContent = data.message || 'Ссылка отправлена!';
                }
                forgotForm.reset();
            } catch (err) {
                forgotError.textContent = err.message;
            }
        });
    }

    // Purchase processing function
    async function processCheckout(courseId) {
        try {
            const res = await fetch('/api/payments/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_id: courseId })
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Ошибка оформления заказа');
            }
            if (data.checkout_url) {
                window.location.href = data.checkout_url;
            }
        } catch (err) {
            alert('Не удалось начать оплату: ' + err.message);
        }
    }

    // Bind click events on all purchase buttons
    document.querySelectorAll('.buy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const courseId = btn.getAttribute('data-course-id');
            if (currentUser) {
                processCheckout(courseId);
            } else {
                openModal(courseId);
            }
        });
    });

    // Run auth check on load
    checkAuthStatus();
});
