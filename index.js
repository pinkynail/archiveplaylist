const express = require("express");
const youtubedl = require("youtube-dl-exec");
const fsPromises = require("fs").promises;
const fs = require("fs");
const { google } = require("googleapis");
const path = require("path");
const app = express();

app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Google Drive setup (оставляем как есть)
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const credentials = {
  web: {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uris: [process.env.GOOGLE_REDIRECT_URI],
  },
};
const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0],
);
oAuth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});
const drive = google.drive({ version: "v3", auth: oAuth2Client });

let archiveFolderIdCache = null;
let playlists = [];
let playlistsFileId = null;
let initializingPromise = null;

// Функции Google Drive (оставляем без изменений)
async function loadPlaylistsFromDrive() {
  console.log("Попытка загрузить playlists.json с Google Drive...");
  try {
    if (!archiveFolderIdCache) {
      console.log("archiveFolderIdCache не установлен, инициализируем...");
      await initializeArchiveFolder();
    }
    console.log("Поиск playlists.json в папке:", archiveFolderIdCache);
    const response = await drive.files.list({
      q: `'${archiveFolderIdCache}' in parents name='playlists.json'`,
      fields: "files(id, name)",
      spaces: "drive",
    });
    const files = response.data.files;
    if (files && files.length > 0) {
      playlistsFileId = files[0].id;
      const file = await drive.files.get({
        fileId: playlistsFileId,
        alt: "media",
      });
      playlists = file.data || [];
      console.log("Успешно загружены плейлисты из Google Drive:", playlists);
    } else {
      console.log("Файл playlists.json не найден, создаём новый...");
      playlists = [];
      await savePlaylistsToDrive();
    }
  } catch (error) {
    console.error(
      "Ошибка при загрузке плейлистов с Google Drive:",
      error.message,
    );
    playlists = [];
    await savePlaylistsToDrive();
  }
}
async function savePlaylistsToDrive() {
  /* ... */
}
async function initializeArchiveFolder() {
  if (archiveFolderIdCache) {
    console.log(
      "ArchiveYoutubePlaylist уже инициализирована с ID:",
      archiveFolderIdCache,
    );
    return archiveFolderIdCache;
  }

  try {
    console.log("Поиск существующей ArchiveYoutubePlaylist...");
    const response = await drive.files.list({
      q: "'root' in parents name='ArchiveYoutubePlaylist' mimeType='application/vnd.google-apps.folder'",
      fields: "files(id)",
      spaces: "drive",
    });
    const files = response.data.files;
    if (files && files.length > 0) {
      archiveFolderIdCache = files[0].id;
      console.log(
        "Найдена существующая ArchiveYoutubePlaylist с ID:",
        archiveFolderIdCache,
      );
    } else {
      const folderId = await getOrCreateFolder("ArchiveYoutubePlaylist");
      archiveFolderIdCache = folderId;
      console.log(
        "Создана новая ArchiveYoutubePlaylist с ID:",
        archiveFolderIdCache,
      );
    }
  } catch (error) {
    console.error("Ошибка при поиске ArchiveYoutubePlaylist:", error.message);
    const folderId = await getOrCreateFolder("ArchiveYoutubePlaylist");
    archiveFolderIdCache = folderId;
    console.log(
      "Создан запасной ID для ArchiveYoutubePlaylist:",
      archiveFolderIdCache,
    );
  }

  if (!archiveFolderIdCache) {
    throw new Error("Не удалось инициализировать archiveFolderIdCache");
  }
  return archiveFolderIdCache;
}
async function getOrCreateFolder(folderName, parentId = null) {
  try {
    if (
      folderName === "ArchiveYoutubePlaylist" &&
      archiveFolderIdCache &&
      !parentId
    ) {
      console.log(
        "Используем кэшированный ID для ArchiveYoutubePlaylist:",
        archiveFolderIdCache,
      );
      return archiveFolderIdCache;
    }

    if (parentId) {
      const existingPlaylist = playlists.find(
        (p) => p.name === folderName && p.parentId === parentId,
      );
      if (existingPlaylist) {
        console.log(
          `Используем существующий плейлист "${folderName}" с ID:`,
          existingPlaylist.id,
        );
        return existingPlaylist.id;
      }
    }

    const folderMetadata = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : ["root"], // Явно указываем root, если нет parentId
    };
    const folder = await drive.files.create({
      resource: folderMetadata,
      fields: "id",
    });
    const folderId = folder.data.id;
    if (!folderId) {
      throw new Error(`Не удалось создать папку "${folderName}"`);
    }
    console.log(
      `Создана папка "${folderName}" с ID: ${folderId}${parentId ? ` (внутри ${parentId})` : ""}`,
    );

    if (folderName === "ArchiveYoutubePlaylist" && !parentId) {
      archiveFolderIdCache = folderId;
    } else if (parentId) {
      const newPlaylist = {
        id: folderId,
        name: folderName,
        parentId,
        songs: [],
      };
      playlists.push(newPlaylist);
      await savePlaylistsToDrive();
    }

    return folderId;
  } catch (error) {
    console.error(`Ошибка при создании папки "${folderName}":`, error.message);
    throw error; // Пробрасываем ошибку, чтобы её можно было поймать выше
  }
}
async function getFolders(parentId) {
  try {
    const folders = playlists.filter((p) => p.parentId === parentId);
    console.log(`Плейлисты из памяти для ${parentId}:`, folders);
    return folders || []; // Если фильтр ничего не нашёл, возвращаем пустой массив
  } catch (error) {
    console.error("Ошибка в getFolders:", error.message);
    return []; // В случае ошибки возвращаем пустой массив
  }
}

(async () => {
  try {
    const folderId = await initializeArchiveFolder();
    console.log("Инициализирован archiveFolderIdCache:", folderId);
    await loadPlaylistsFromDrive();
    console.log("Инициализация завершена");
  } catch (error) {
    console.error("Критическая ошибка при инициализации:", error.message);
    process.exit(1); // Завершаем процесс, если всё сломалось
  }
})();

(async () => {
  await initializeArchiveFolder();
  await loadPlaylistsFromDrive();
  console.log("Инициализация завершена");
})();

app.get("/", async (req, res) => {
  try {
    const archiveFolderId = await initializeArchiveFolder();
    const folders = (await getFolders(archiveFolderId)) || []; // Если undefined, возвращаем пустой массив
    console.log("Folders for render:", folders); // Логируем для отладки
    res.render("index", { folders });
  } catch (error) {
    console.error("Ошибка в GET /:", error.message); // Более точный лог
    res.status(500).render("error", { message: error.message }); // Отдельный шаблон для ошибок
  }
});

app.post("/download", async (req, res) => {
  const youtubeUrl = req.body.youtube_url;
  const newFolderName = req.body.new_folder_name;
  let folderId = req.body.folder_id;

  try {
    const metadata = await youtubedl(youtubeUrl, {
      dumpSingleJson: true,
      cookies: "cookies.txt",
    });
    const title = metadata.title.replace(/[/\\?%*:|"<>]/g, "");
    const fileName = `${title}-${Date.now()}.mp3`;

    await youtubedl(youtubeUrl, {
      extractAudio: true,
      audioFormat: "mp3",
      output: fileName,
      cookies: "cookies.txt",
    });
    console.log("Скачано:", youtubeUrl);

    await fsPromises.access(fileName);

    const archiveFolderId = await initializeArchiveFolder();
    if (!folderId && newFolderName) {
      folderId = await getOrCreateFolder(newFolderName, archiveFolderId);
    } else if (!folderId) {
      folderId = await getOrCreateFolder("playlist", archiveFolderId);
    }

    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = {
      mimeType: "audio/mp3",
      body: fs.createReadStream(fileName),
    };
    const driveResponse = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id",
    });
    console.log("Загружено на Drive, ID:", driveResponse.data.id);

    const playlist = playlists.find((p) => p.id === folderId);
    if (playlist) {
      playlist.songs.push({ title, driveId: driveResponse.data.id });
      await savePlaylistsToDrive();
      console.log(`Добавлена песня "${title}" в плейлист "${playlist.name}"`);
    }

    await fsPromises.unlink(fileName);

    const folders = await getFolders(archiveFolderId);
    res.render("success", { title, driveId: driveResponse.data.id, folders });
  } catch (error) {
    console.error("Ошибка в POST /download:", error);
    res.send(`Ошибка: ${error.message}`);
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
