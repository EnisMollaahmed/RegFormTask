**Използвани технологии**

- **Проект:** Чисто Vanilla приложение — Node.js (без уеб фреймуърци), Vanilla JavaScript, HTML, CSS и MySQL.
- **Забележка:** Няма използвани рамки като Express, React, Vue, или друг frontend/backend framework.

**Реализирани функционалности**

- **Клиент-сървър рутиране (custom routing):** Рутингът е реализиран в [server.js](server.js) чрез карта от маршрути (`routes.GET`, `routes.POST`, `routes.PUT`). Всяка заявка се анализира в `requestHandler` (парсване на URL и метод) и, ако има съвпадащ маршрут, се извиква съответния обработчик. За статични файлове се използва собствена функция `serveStatic` която намира файловете в папката public и връща правилен Content-Type.

- **Валидация на данни:** Валидацията е имплементирана в `server.js` чрез помощни функции `isValidEmail()` и `isStrongPassword()` и проверки в API обработчиците (`/api/register`, `/api/login`, `/api/user` PUT). Проверяват се формати на email, минимална дължина на парола, наличност на букви и цифри, и празни полета за имена.

- **MySQL интеграция:** Връзката към базата е реализирана в [db.js](db.js) с пакета `mysql2/promise`. Създава се pool чрез `mysql.createPool(...)` с конфигурируеми променливи за среда (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`). Изпълнението на заявки се прави през асинхронната функция `query(sql, params)` която използва `pool.execute(sql, params)` и връща резултата.

- **CAPTCHA:** Персонализирана CAPTCHA в [captcha.js](captcha.js) генерира случайна текстова последователност, пази я в памет (in-memory `sessions` Map) с TTL и връща SVG, закодиран като data URI. Функциите: `createCaptcha()` (генерира sessionId и SVG data URI), `verifyCaptcha(sessionId, provided)` (верификация с еднократна употреба) и помощна `getCaptchaTextForTesting()` за тестове.

- **Аутентикация:** Логин/Логаут е реализиран чрез сървърни сесии, запазвани в памет (`authSessions`) и HTTP-only cookie `auth`. При успешен логин се генерира токен, който се слага в `Set-Cookie` с флаг `HttpOnly` и `SameSite=Lax`. Frontend логиката пренасочва потребителя към страницата на профила със `window.location.href = '/profile.html'` след успешно влизане (вж. [public/app.js](public/app.js)). Логаутът изтрива сесията и изпраща cookie със `Max-Age=0`.

- **Профил (Profile):** Има отделна страница [public/profile.html](public/profile.html) и логика в [public/app.js](public/app.js). При зареждане фронтенд прави `GET /api/user` за получаване на `email` и `names` (автентикация чрез cookie). За ъпдейт се прави `PUT /api/user` с нови `names` и/или `password`. Сървърът валидира входните данни и обновява MySQL чрез `db.query(...)`.

**Използвани готови функции (вградени модули и пакети)**

- **http:** Основният вграден модул, използван за създаване на HTTP сървъра (`http.createServer`) и обработка на входящи заявки.
- **fs / fs.promises:** Четене на статични файлове за `serveStatic` и стрийминг към отговора.
- **path:** Създаване на безопасни пътища към публичните файлове и нормализация (предотвратяване на path traversal).
- **crypto:** Хеширане на пароли (`scrypt`), генериране на случайни токени за сесии и captcha (`randomBytes`) и безопасно сравнение на хешове (`timingSafeEqual`).
- **node:test:** Вграден тестов ранър, използван във `test/*.test.js` за изпълнение на unit тестовете без външен фреймуърк.
- **node:assert:** Вграден модул за асерции в тестовете (Assertions API).
- **mysql2 (външен пакет):** Използван само за MySQL клиент (promise API). Създава connection pool и позволява изпълнение на параметризирани заявки.

**Структура на проекта (файлова структура и отговорности)**

Проектно дърво (актуално):

- [captcha.js](captcha.js) — генерация и верификация на CAPTCHA (SVG data URI), in-memory сесии за CAPTCHA.
- [db.js](db.js) — MySQL connection pool (`mysql2/promise`) и обща функция `query(sql, params)` за изпълнение на заявки.
- [server.js](server.js) — Основен HTTP сървър, custom router (`routes`), API обработчици за `/api/register`, `/api/login`, `/api/logout`, `/api/user`, `/api/captcha`, статично обслужване на файлове от `public/`, и помощни функции (валидация, сесии, хеширане).
- [schema.sql](schema.sql) — SQL схема / инструкции за създаване на таблицата `users` (ид, email, names, password_hash, timestamps).
- [package.json](package.json) — декларация на проекта с зависимост `mysql2` и стартиращ скрипт.

Публични файлове (frontend):

- public/index.html — основната SPA страница, съдържа формите за регистрация, вход и вградена секция за профил (за по-лесно тестване).
- public/app.js — фронтенд логика (fetch calls към API, регистрация, логин, пренасочване към `/profile.html`, зареждане и запис на профил); използва `credentials: 'same-origin'` за изпращане на cookie.
- public/style.css — основни стилове за приложението.
- public/profile.html — самостоятелна страница за профил; при зареждане прави `GET /api/user` и позволява `PUT /api/user` за ъпдейт.

Тестове:

- test/captcha.test.js — тестове за CAPTCHA (генерация, проверка, one-time use behaviour).
- test/utils.test.js — тестове за валидации, пароли, cookie parsing и helper функции от `server.js`.
- test/server.test.js — интеграционни единични тестове, които извикват `server` без стартиране на мрежов порт; имитира входящи `req`/`res` обекти.
- test/edge-cases.test.js — допълнителни тестове за покриване на гранични случаи: невалидни заявки, CAPTCHA грешки, симулирани DB грешки, неправилен логин, опити за достъп без auth и т.н. Тестовете мокват `db.query` за симулация на успех/грешка.

**Използвани технологии (Technologies used)**
- **Pure Node.js:** Проектът използва единствено вградените възможности на Node.js за HTTP сървър и криптография, без уеб фреймворкове като Express.
- **Vanilla JS:** Клиентската логика е написана с чист JavaScript (без библиотеки или рамки като React/Vue).
- **HTML и CSS:** Интерфейсът е реализиран с чист HTML и CSS, без CSS рамки като Bootstrap.
- **MySQL:** За съхранение на потребителски данни се използва MySQL база данни.
- **Без външни уеб-фреймворкове:** Няма използвани Express, Koa, Fastify или клиентски библиотеки като React — всичко е ръчно реализирано.

**Реализирани функционалности и начин на имплементация (Implemented features and how they work)**
- **Client-server архитектура без фреймворк:**
  - Сървърът е реализиран чрез вградения модул `http`. Ръчно е имплементиран прост маршрутизатор: карти за GET/POST пътища, които свързват URL пътища с обработващи функции. Статичните файлове се сервираt директно от папката public чрез stream-ване на файлове.
- **Валидация на данни (email, names, password):**
  - Имплементирани са сървърни валидатори: `isValidEmail` (регулярен израз за базова форма на имейл), `isStrongPassword` (минимална дължина и изискване за букви и цифри), и контрол на непразни имена. Валидирането се извършва преди запис в базата или приемане на заявки.
- **Интеграция с база данни (MySQL):**
  - Използва се пакетът `mysql2` с pool за връзки. Наличен е модул за връзка (`db.js`), който експортира `pool` и удобна `query()` функция, която използва параметризирани заявки (prepared statements) за защита от SQL инжекции. Регистрацията записва `email`, `names` и `password_hash` в таблицата `users`.
- **Аутентикация (Login/Logout чрез cookies/sessions):**
  - При успешно влизане сървърът генерира сигурен session token чрез `crypto.randomBytes`, съхранява го в сървърна памет (in-memory authSessions) заедно с потребителския id и expiry, и връща HttpOnly cookie `auth` към клиента. За изход (logout) сесията се изтрива и cookie-то се изчиства.
  - За защита при сравнение на пароли се използва `crypto.timingSafeEqual` за избягване на timing атаки.
- **Профил (смяна на имена и парола):**
  - Защитен маршрут `GET /api/user` връща имейл и имена на вписания потребител въз основа на auth cookie-а и сървърната сесия.
  - `PUT /api/user` позволява промяна на полето names и/или паролата. Новата парола се валидира (силна парола) и се хешира с `crypto.scrypt` (salt + derived key), след което се обновява в базата.
- **Кастъм CAPTCHA (от нулата):**
  - Модулът `captcha.js` генерира произволен 6-символен код от безопасни символи, рендерира текста като SVG (с шум и леко завъртане на символите) и връща data URI (`data:image/svg+xml;base64,...`). Правилният код се съхранява в in-memory store, привързан към session id (5 минути TTL). Функцията `verifyCaptcha` проверява подадения код срещу записаната стойност и изтрива записа след верификация (one-time use).

**Използвани готови функции и модули (Built-in functions and packages)**
- Вградени Node.js модули и тяхното приложение в проекта:
  - **http:** Създаване на HTTP сървър и обработка на входящи заявки.
  - **fs / fs.promises:** Четене и stream-ване на статични файлове от диска (public/).
  - **path:** Нормализиране и безопасно сключване на пътища при обслужване на файлове.
  - **url:** Парсване на URL и query параметри (използва се при маршрутизацията).
  - **crypto:** Криптографски операции: генериране на случайни байтове (session токени, salt), хеширане на пароли чрез scrypt (или scryptSync), timing-safe сравнение и други крипто-операции.
  - **util (promisify):** Промени `crypto.scrypt` в промис-ориентирана функция при нужда.
  - **node:test и node:assert:** Вградени модули за unit тестове (без външни тестови рамки). Използвани за покриване на валидационна логика, captcha и utility функции.
- Външен пакет:
  - **mysql2:** Единственият външен dependency. Използва се за връзка с MySQL, създаване на пул и изпълнение на параметризирани заявки.

**Структура на проекта (File structure and responsibilities)**
- Дървовиден преглед:
  - [package.json](package.json)
  - [schema.sql](schema.sql)
  - [db.js](db.js)
  - [server.js](server.js)
  - [captcha.js](captcha.js)
  - public/
    - [index.html](public/index.html)
    - [app.js](public/app.js)
    - [style.css](public/style.css)
  - test/
    - [captcha.test.js](test/captcha.test.js)
    - [utils.test.js](test/utils.test.js)

- Кратко обяснение за всяка част:
  - **package.json:** Мета-информация за проекта и зависимостта `mysql2`. Съдържа script `start` (node index.js / node server.js) ако е добавен.
  - **schema.sql:** SQL скрипт, който създава базата данни `regform_db` и таблицата `users` със следните полета: id, email (unique), names, password_hash, created_at.
  - **db.js:** Модулът за MySQL връзка — създава connection pool чрез `mysql2/promise` и експортира удобна `query()` функция за изпълнение на параметризирани заявки.
  - **server.js:** Основният HTTP сървър. Отговаря за:
    - маршрутизация на API пътища (GET/POST/PUT както е дефинирано),
    - обслужване на статични файлове от папката public,
    - реализиране на API endpoints: `/api/captcha`, `/api/register`, `/api/login`, `/api/logout`, `/api/user` (GET/PUT) и други примерни пътища,
    - сесии за аутентикация (in-memory authSessions), управление на HttpOnly куки, проверка и обновяване на сесии,
    - експортиране на някои полезни utilities (валидация, хеширане) за тестване.
  - **captcha.js:** Модул за генериране на CAPTCHA. Съдържа функции:
    - `createCaptcha(sessionId?)` — генерира 6-символен код, записва в in-memory store с TTL и връща data URI за SVG плюс sessionId;
    - `verifyCaptcha(sessionId, provided)` — проверява и премахва записаната стойност (one-time);
    - `getCaptchaTextForTesting(sessionId)` — възможност да се прочете текстът за unit тестове (само за тестови цели);
    - автоматично почистване на изтекли CAPTCHA записи.
  - **public/index.html:** Клиентски интерфейс (SPA) с три раздела: Регистрация, Вход и Профил. HTML структурата съдържа формите и място за CAPTCHA изображението.
  - **public/app.js:** Клиентски скрипт (Vanilla JS) който:
    - навигира между секциите (register/login/profile),
    - зарежда CAPTCHA от `/api/captcha` и задава cookie sid,
    - изпраща заявки чрез fetch към `/api/register`, `/api/login`, `/api/profile`, `/api/logout`,
    - обработва отговори и показва съобщения на потребителя.
  - **public/style.css:** Основни стилове за формите, бутони и оформление.
  - **test/captcha.test.js:** Unit тестове за captcha модула: тестване на генериране, извличане на текст за тест и правилна/грешна верификация.
  - **test/utils.test.js:** Unit тестове за утилити функции (валидация на имейл и парола, парсване на cookie, хеширане и верификация на парола). Използва `node:test` и `node:assert`.

