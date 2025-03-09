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
const ARCHIVE_FOLDER_NAME = "ArchivePlaylist";

// Функция для загрузки cookies.txt из Google Drive
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

    // Ищем папку ArchivePlaylist
    const parentId = await initializeArchiveFolder();

    // Выводим все файлы в папке для отладки
    const listResponse = await driveClient.files.list({
      q: `'${parentId}' in parents and trashed=false`,
      fields: "files(id, name)",
      supportsAllDrives: true,
    });
    console.log(
      "Список файлов в папке ArchivePlaylist:",
      listResponse.data.files,
    );

    // Ищем файл cookies.txt (с учетом регистра и вариантов)
    const cookieFile = listResponse.data.files.find((file) =>
      file.name.toLowerCase().includes("cookies.txt"),
    );
    if (!cookieFile) {
      console.warn("Файл cookies.txt не найден в папке ArchivePlaylist.");
      return null; // Возвращаем null, если файл отсутствует
    }
    console.log("Найден файл cookies.txt с ID:", cookieFile.id);

    // Загружаем содержимое cookies.txt
    const fileResponse = await driveClient.files.get(
      { fileId: cookieFile.id, alt: "media" },
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
    throw new Error(
      "Не удалось загрузить cookies. Проверь наличие cookies.txt в папке ArchivePlaylist.",
    );
  }
}

// Инициализация корневой папки ArchivePlaylist
async function initializeArchiveFolder() {
  try {
    const driveClient = google.drive({
      version: "v3",
      auth,
      params: { key: process.env.GOOGLE_API_KEY },
    });
    const response = await driveClient.files.list({
      q: `name='${ARCHIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
      supportsAllDrives: true,
    });
    let folderId = response.data.files[0]?.id;
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
    }
    return folderId;
  } catch (error) {
    console.error("Ошибка инициализации ArchivePlaylist:", error.message);
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
      throw new Error(
        "Cookies не загружены. Убедись, что cookies.txt находится в папке ArchivePlaylist.",
      );
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

    const fileMetadata = { name: fileName, parents: [parentId] };
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
