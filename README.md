# Archive Playlist

![Лицензия GitHub](https://img.shields.io/github/license/pinkynail/archiveplaylist)
![Node.js](https://img.shields.io/badge/Node.js-22.12.0-зелёный)
![Bun](https://img.shields.io/badge/Bun-1.1.0-синий)
![Развёрнут на Render](https://img.shields.io/badge/Развёрнут%20на-Render-фиолетовый)

Добро пожаловать в **Archive Playlist** — мой личный пет-проект, созданный для архивации плейлистов с YouTube и сохранения их аудиоконтента в Google Drive. Этот проект был запущен как увлекательный эксперимент для изучения веб-разработки, интеграции API и процессов деплоя. Он позволяет пользователям скачивать аудио с видео YouTube, организовывать их в плейлисты и безопасно хранить в облаке.

## Возможности

- **Скачивание аудио с YouTube**: Извлечение аудио из видео YouTube с помощью `youtube-dl-exec` (на основе `yt-dlp`).
- **Интеграция с Google Drive**: Загрузка и организация аудиофайлов в папках Google Drive.
- **Управление плейлистами**: Создание и управление плейлистами с динамической структурой папок.
- **Веб-интерфейс**: Простой интерфейс на основе EJS с использованием Bootstrap для элегантного дизайна.
- **Развёртывание на Render**: Хостинг на бесплатном тарифе Render с автоматическими проверками состояния.

## Технологический стек

- **Бэкенд**: Node.js (v22.12.0) с Express.js
- **Рантайм**: Bun (v1.1.0) для дополнительной гибкости
- **Зависимости**:
  - `youtube-dl-exec` для скачивания с YouTube
  - `googleapis` для интеграции с Google Drive API
  - `ejs` для шаблонов
  - `bootstrap` для стилизации
- **Деплой**: Render (бесплатный тариф)
- **Контроль версий**: Git и GitHub

## Установка

Проект уже развёрнут и готов к использованию, но если ты хочешь запустить его локально для разработки или экспериментов, следуй этим шагам:

### 1. Клонирование репозитория
```bash
git clone https://github.com/pinkynail/archiveplaylist.git
cd archiveplaylist
```

### 2. Установка зависимостей
```bash
npm install
```

### 3. Настройка переменных окружения
Создай файл `.env` в корневой директории с содержимым:
```plaintext
GOOGLE_CLIENT_ID=твой_клиент_id
GOOGLE_CLIENT_SECRET=твой_секрет
GOOGLE_REDIRECT_URI=https://archiveplaylist.onrender.com/auth/callback
GOOGLE_REFRESH_TOKEN=твой_рефреш_токен
COOKIES_FILE=/etc/secrets/cookies.txt  # Для Render, настрой локально при необходимости
FFMPEG_PATH=/usr/bin/ffmpeg  # Путь к ffmpeg (установи локально, если нужно)
PORT=3000
```
- Получи `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` и `GOOGLE_REFRESH_TOKEN` в Google Cloud Console после настройки API Drive.
- Экспортируй cookies YouTube в `cookies.txt`:
```bash
yt-dlp --cookies-from-browser chrome > cookies.txt
```

### 4. Установка ffmpeg (для macOS)
```bash
brew install ffmpeg
```

### 5. Запуск сервера
```bash
node index.js
```
- Открой приложение по адресу `http://localhost:3000`.

## Использование

1. Посети развёрнутое приложение: [https://archiveplaylist.onrender.com](https://archiveplaylist.onrender.com).
2. Введи URL видео YouTube в форму.
3. Выбери или создай папку плейлиста для сохранения аудио.
4. Аудио будет скачано, преобразовано в MP3 и загружено в твою Google Drive.

## Путь разработки

Этот пет-проект начался как способ изучить Node.js, интегрировать сторонние API и поэкспериментировать с деплоем на Render. По пути я столкнулся с вызовами, такими как:
- Обход защиты от ботов YouTube с помощью cookies.
- Решение проблем с read-only файловой системой на Render с использованием Secret Files.
- Оптимизация времени холодного старта с помощью эндпоинтов состояния.
- Обеспечение безопасности с переменными окружения и игнорированием файлов в Git.

Проект эволюционировал от простого скрипта к полноценному веб-приложению, с вкладом от отладочных сессий и советов сообщества (особая благодарность моему виртуальному помощнику!).

## Вклад в развитие

Это личный пет-проект, но вклад приветствуется! Ты можешь:
- Открывать [проблемы](https://github.com/pinkynail/archiveplaylist/issues) для сообщений об ошибках или предложений.
- Присылать пулл-реквесты с улучшениями.

Учти, что проект использует мои личные API-ключи и cookies, поэтому, если хочешь работать с ним, сделай форк и настрой свои собственные переменные окружения.

## Лицензия

Этот проект лицензирован под [лицензией MIT](LICENSE). Ты можешь использовать, модифицировать и распространять его по своему усмотрению.

## Благодарности

- **Render** за предоставление бесплатной платформы хостинга.
- **yt-dlp** и **youtube-dl-exec** за возможность скачивания с YouTube.
- **Google Drive API** за интеграцию с облачным хранилищем.
- Сообществу open-source за инструменты и вдохновение.
