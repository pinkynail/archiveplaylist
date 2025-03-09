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

// Инициализация Google Drive API
let auth;
const drive = google.drive({ version: "v3" });
let playlists = [];
const ARCHIVE_FOLDER_NAME = "ArchivePlaylist";

// Функция для загрузки cookies.txt из Google Drive
async function loadCookiesFromDrive() {
  try {
    // Инициализация auth, если не определён
    if (!auth) {
      const { GoogleAuth } = require("google-auth-library");
      const keys = {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      };
      auth = new GoogleAuth({
        credentials: keys,
        scopes: ["https://www.googleapis.com/auth/drive"],
      });
    }
    const driveClient = google.drive({ version: "v3", auth });
    const fileId = "1HTewN8jUeX7BQeKlWbxkQ1kefwHvVI7o"; // ID файла cookies.txt
    const dest = "/tmp/cookies.txt";

    // Скачиваем файл
    const response = await driveClient.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" },
    );
    await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(dest);
      response.data
        .on("end", () => {
          console.log("Cookies загружены в /tmp/cookies.txt");
          // Устанавливаем атрибут "только для чтения"
          fs.chmodSync(dest, 0o444); // Чтение только
          resolve();
        })
        .on("error", reject)
        .pipe(fileStream);
    });
    return dest;
  } catch (error) {
    console.error("Ошибка загрузки cookies из Google Drive:", error.message);
    throw new Error(
      "Не удалось загрузить cookies. Проверь подключение к Google Drive или переменные окружения.",
    );
  }
}

// Инициализация корневой папки ArchivePlaylist
async function initializeArchiveFolder() {
  try {
    const response = await drive.files.list({
      q: `name='${ARCHIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
    });
    let folderId = response.data.files[0]?.id;
    if (!folderId) {
      const fileMetadata = {
        name: ARCHIVE_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
      };
      const folder = await drive.files.create({
        resource: fileMetadata,
        fields: "id",
      });
      folderId = folder.data.id;
    }
    return folderId;
  } catch (error) {
    console.error("Ошибка инициализации ArchivePlaylist:", error.message);
    throw error;
  }
}

// Получение или создание папки плейлиста
async function getOrCreateFolder(folderName, parentId) {
  try {
    const response = await drive.files.list({
      q: `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
    });
    let folderId = response.data.files[0]?.id;
    if (!folderId) {
      const fileMetadata = {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      };
      const folder = await drive.files.create({
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
    const response = await drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
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
    const parentId = await initializeArchiveFolder();
    const response = await drive.files.list({
      q: `name='playlists.json' and '${parentId}' in parents and trashed=false`,
      fields: "files(id)",
    });
    const fileId = response.data.files[0]?.id;
    const fileMetadata = { name: "playlists.json", parents: [parentId] };
    const media = {
      mimeType: "application/json",
      body: JSON.stringify(playlists, null, 2),
    };
    if (fileId) {
      await drive.files.update({
        fileId,
        resource: fileMetadata,
        media,
      });
    } else {
      await drive.files.create({
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
    const parentId = await initializeArchiveFolder();
    const response = await drive.files.list({
      q: `name='playlists.json' and '${parentId}' in parents and trashed=false`,
      fields: "files(id)",
    });
    const fileId = response.data.files[0]?.id;
    if (fileId) {
      const file = await drive.files.get(
        { fileId, alt: "media" },
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
      throw new Error("Cookies не загружены. Перезапустите приложение.");
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
    const driveResponse = await drive.files.create({
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
    global.cookiesPath = cookiesPath; // Делаем путь доступным глобально

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
