const express = require("express");
const youtubedl = require("youtube-dl-exec");
const { google } = require("googleapis");
const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
require("dotenv").config();

const app = express();
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));

// Инициализация Google Drive API с OAuth2
let auth;
const drive = google.drive({ version: "v3" });
let playlists = [];
const ARCHIVE_FOLDER_NAME = "ArchiveYoutubePlaylist";

// Задержка для синхронизации Google Drive
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Функция для загрузки cookies из Google Drive
async function loadCookiesFromDrive() {
  try {
    if (!auth) {
      const { OAuth2Client } = require("google-auth-library");
      const credentials = {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      };
      console.log("Инициализация OAuth2Client с:", credentials);
      auth = new OAuth2Client(credentials.client_id, credentials.client_secret);
      await auth.setCredentials({ refresh_token: credentials.refresh_token });
      console.log("Аутентификация успешна, токен установлен.");
    }
    const driveClient = google.drive({
      version: "v3",
      auth,
      params: { key: process.env.GOOGLE_API_KEY },
    });

    // Ищем или используем существующую папку ArchiveYoutubePlaylist
    const parentId = await initializeArchiveFolder();
    console.log("ID папки ArchiveYoutubePlaylist:", parentId);

    // Даём Google Drive время на синхронизацию
    console.log("Ожидание синхронизации Google Drive (10 секунд)...");
    await delay(10000);

    // Выводим все файлы в папке для отладки
    const listResponse = await driveClient.files.list({
      q: `'${parentId}' in parents and trashed=false`,
      fields: "files(id, name, mimeType, permissions)",
      supportsAllDrives: true,
    });
    console.log(
      "Список файлов в папке ArchiveYoutubePlaylist:",
      JSON.stringify(listResponse.data.files, null, 2),
    );

    // Ищем файл cookies.txt или cookies.json
    const cookieFile = listResponse.data.files.find((file) =>
      ["cookies.txt", "cookies.json"].includes(file.name.toLowerCase()),
    );
    let cookieFileId = cookieFile ? cookieFile.id : null;

    if (!cookieFileId) {
      console.warn(
        "Файл cookies.txt или cookies.json не найден в папке ArchiveYoutubePlaylist.",
      );
      // Пробуем загрузить по известному ID из переменной COOKIES_FILE_ID
      const knownCookieId = process.env.COOKIES_FILE_ID;
      if (knownCookieId) {
        console.log("Попытка загрузки файла по ID:", knownCookieId);
        try {
          const fileCheck = await driveClient.files.get({
            fileId: knownCookieId,
            fields: "id, name, mimeType, permissions",
          });
          console.log(
            "Проверка файла с ID",
            knownCookieId,
            ":",
            fileCheck.data,
          );
          cookieFileId = knownCookieId;
        } catch (idError) {
          console.error(
            "Файл с ID",
            knownCookieId,
            "не найден или недоступен:",
            idError.message,
          );
          if (idError.response) {
            console.error(
              "Детали ошибки:",
              JSON.stringify(idError.response.data, null, 2),
            );
          }
          return null; // Возвращаем null, если файл не найден
        }
      } else {
        console.warn("Переменная COOKIES_FILE_ID не задана.");
        return null;
      }
    }
    console.log("Найден файл с ID:", cookieFileId);

    // Проверяем права доступа
    if (cookieFile) {
      console.log(
        "Права доступа для найденного файла:",
        cookieFile.permissions,
      );
    }

    // Загружаем содержимое файла
    const fileResponse = await driveClient.files.get(
      { fileId: cookieFileId, alt: "media" },
      { responseType: "stream" },
    );
    const dest = "/tmp/cookies.txt";
    await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(dest);
      fileResponse.data
        .on("end", () => {
          console.log("Cookies загружены в /tmp/cookies.txt");
          fs.chmodSync(dest, 0o444); // Устанавливаем атрибут "только для чтения"
          resolve();
        })
        .on("error", reject)
        .pipe(fileStream);
    });
    return dest;
  } catch (error) {
    console.error("Ошибка загрузки cookies из Google Drive:", error.message);
    if (error.response) {
      console.error(
        "Детали ошибки:",
        JSON.stringify(error.response.data, null, 2),
      );
    }
    return null; // Избегаем краха приложения
  }
}

// Инициализация корневой папки ArchiveYoutubePlaylist
async function initializeArchiveFolder() {
  try {
    const driveClient = google.drive({
      version: "v3",
      auth,
      params: { key: process.env.GOOGLE_API_KEY },
    });
    let folderId = process.env.ARCHIVE_FOLDER_ID; // Используем заданный ID, если есть
    if (!folderId) {
      const response = await driveClient.files.list({
        q: `name='${ARCHIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id, name)",
        supportsAllDrives: true,
      });
      folderId = response.data.files[0]?.id;
    }
    if (!folderId) {
      const fileMetadata = {
        name: ARCHIVE_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
      };
      const folder = await driveClient.files.create({
        resource: fileMetadata,
        fields: "id",
      });
      folderId = folder.data.id;
      console.log("Создана новая папка ArchiveYoutubePlaylist с ID:", folderId);
    }
    return folderId;
  } catch (error) {
    console.error(
      "Ошибка инициализации ArchiveYoutubePlaylist:",
      error.message,
    );
    if (error.response) {
      console.error(
        "Детали ошибки:",
        JSON.stringify(error.response.data, null, 2),
      );
    }
    throw error;
  }
}

// Получение или создание папки плейлиста
async function getOrCreateFolder(folderName, parentId) {
  try {
    const driveClient = google.drive({
      version: "v3",
      auth,
      params: { key: process.env.GOOGLE_API_KEY },
    });
    const response = await driveClient.files.list({
      q: `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
      supportsAllDrives: true,
    });
    let folderId = response.data.files[0]?.id;
    if (!folderId) {
      const fileMetadata = {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      };
      const folder = await driveClient.files.create({
        resource: fileMetadata,
        fields: "id",
      });
      folderId = folder.data.id;
    }
    return folderId;
  } catch (error) {
    console.error("Ошибка получения/создания папки:", error.message);
    throw error;
  }
}

// Получение списка папок
async function getFolders(parentId) {
  try {
    const driveClient = google.drive({
      version: "v3",
      auth,
      params: { key: process.env.GOOGLE_API_KEY },
    });
    const response = await driveClient.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
      supportsAllDrives: true,
    });
    return response.data.files;
  } catch (error) {
    console.error("Ошибка получения папок:", error.message);
    throw error;
  }
}

// Сохранение плейлистов в Google Drive
async function savePlaylistsToDrive() {
  try {
    const driveClient = google.drive({
      version: "v3",
      auth,
      params: { key: process.env.GOOGLE_API_KEY },
    });
    const parentId = await initializeArchiveFolder();
    const response = await driveClient.files.list({
      q: `name='playlists.json' and '${parentId}' in parents and trashed=false`,
      fields: "files(id)",
      supportsAllDrives: true,
    });
    const fileId = response.data.files[0]?.id;
    const fileMetadata = { name: "playlists.json", parents: [parentId] };
    const media = {
      mimeType: "application/json",
      body: JSON.stringify(playlists, null, 2),
    };
    if (fileId) {
      await driveClient.files.update({
        fileId,
        resource: fileMetadata,
        media,
      });
    } else {
      await driveClient.files.create({
        resource: fileMetadata,
        media,
      });
    }
  } catch (error) {
    console.error("Ошибка сохранения плейлистов:", error.message);
    throw error;
  }
}

// Загрузка плейлистов из Google Drive
async function loadPlaylistsFromDrive() {
  try {
    const driveClient = google.drive({
      version: "v3",
      auth,
      params: { key: process.env.GOOGLE_API_KEY },
    });
    const parentId = await initializeArchiveFolder();
    const response = await driveClient.files.list({
      q: `name='playlists.json' and '${parentId}' in parents and trashed=false`,
      fields: "files(id)",
      supportsAllDrives: true,
    });
    const fileId = response.data.files[0]?.id;
    if (fileId) {
      const file = await driveClient.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "stream" },
      );
      const chunks = [];
      for await (const chunk of file.data) {
        chunks.push(chunk);
      }
      playlists = JSON.parse(Buffer.concat(chunks).toString());
    }
  } catch (error) {
    console.error("Ошибка загрузки плейлистов:", error.message);
    playlists = [];
  }
}

// Маршруты
app.get("/", async (req, res) => {
  try {
    const archiveFolderId = await initializeArchiveFolder();
    const folders = await getFolders(archiveFolderId);
    res.render("index", { folders });
  } catch (error) {
    console.error("Ошибка загрузки главной страницы:", error.message);
    res.status(500).send("Ошибка сервера: " + error.message);
  }
});

app.post("/download", async (req, res) => {
  const youtubeUrl = req.body.youtube_url;
  const newFolderName = req.body.new_folder_name;
  let folderId = req.body.folder_id;

  try {
    console.log("Attempting to download from URL:", youtubeUrl);

    // Проверка, что cookies загружены
    if (!global.cookiesPath) {
      console.warn("Cookies не загружены. Загрузка может быть невозможна.");
      res
        .status(400)
        .send(
          "Ошибка: Cookies не загружены. Проверь файл cookies.json в папке ArchiveYoutubePlaylist.",
        );
      return;
    }

    const metadata = await youtubedl(youtubeUrl, {
      dumpSingleJson: true,
      cookies: global.cookiesPath,
      ffmpegLocation: process.env.FFMPEG_PATH,
    });
    const title = metadata.title.replace(/[/\\?%*:|"<>]/g, "");
    const fileName = `${title}-${Date.now()}.mp3`;

    await youtubedl(youtubeUrl, {
      extractAudio: true,
      audioFormat: "mp3",
      output: fileName,
      cookies: global.cookiesPath,
      ffmpegLocation: process.env.FFMPEG_PATH,
    });
    await fsPromises.access(fileName);

    const archiveFolderId = await initializeArchiveFolder();
    if (!folderId && newFolderName)
      folderId = await getOrCreateFolder(newFolderName, archiveFolderId);
    else if (!folderId)
      folderId = await getOrCreateFolder("playlist", archiveFolderId);

    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = {
      mimeType: "audio/mp3",
      body: fs.createReadStream(fileName),
    };
    const driveClient = google.drive({
      version: "v3",
      auth,
      params: { key: process.env.GOOGLE_API_KEY },
    });
    const driveResponse = await driveClient.files.create({
      resource: fileMetadata,
      media,
      fields: "id",
    });

    const playlist = playlists.find((p) => p.id === folderId);
    if (playlist) {
      playlist.songs.push({ title, driveId: driveResponse.data.id });
      await savePlaylistsToDrive();
    }

    await fsPromises.unlink(fileName);
    const folders = await getFolders(archiveFolderId);
    res.render("success", { title, driveId: driveResponse.data.id, folders });
  } catch (error) {
    console.error("Download error:", error.message);
    res.status(500).send("Ошибка: " + error.message);
  }
});

// Инициализация при старте приложения
(async () => {
  try {
    // Загружаем cookies перед запуском сервера
    const cookiesPath = await loadCookiesFromDrive();
    global.cookiesPath = cookiesPath || null; // Устанавливаем null, если файл не найден

    // Загружаем плейлисты
    await loadPlaylistsFromDrive();

    // Запуск сервера
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error("Ошибка при запуске:", error.message);
    process.exit(1);
  }
})();
